import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, tradeExecutions, tradeRiskSnapshots, checklistDefinitions, tradeCheckResults, lookupValues, setupDefinitions } from '@/db/schema';
import { eq, and, asc, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { computeTradeMetrics, type ExecutionData, type Direction } from '@/lib/trade-metrics';
import { computeRiskSnapshotValues } from '@/lib/risk-snapshot';
import { syncAndRebuildPositions } from '@/lib/positions/trade-execution-sync';
import { checkExecutionReadiness } from '@/lib/execution-readiness';
import { computeExecutionContext } from '@/lib/execution-context';

const executeTradeSchema = z.object({
  entryPrice: z.number().positive(),
  entryQuantity: z.number().positive(),
  stopPrice: z.number().optional(),
  exit1Price: z.number().positive().optional(),
  exit1Quantity: z.number().positive().optional(),
  exit2Price: z.number().positive().optional(),
  exit2Quantity: z.number().positive().optional(),
  executedAt: z.string().optional(),
  fees: z.number().min(0).optional().default(0),
  checkResults: z.array(z.object({
    checklistDefinitionId: z.string(),
    passed: z.boolean(),
    comment: z.string().optional(),
  })).optional(),
  riskOverrideReason: z.string().min(1).max(500).optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

function toExecutionData(
  rows: typeof tradeExecutions.$inferSelect[],
): ExecutionData[] {
  return rows.map((r) => ({
    action: r.action,
    quantity: r.quantity,
    price: r.price,
    fees: r.fees,
    executedAt: r.executedAt ?? r.createdAt ?? '',
  }));
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = executeTradeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      entryPrice,
      entryQuantity,
      stopPrice,
      exit1Price,
      exit1Quantity,
      exit2Price,
      exit2Quantity,
      executedAt,
      fees,
    } = parsed.data;

    // ── Validate exit quantities don't exceed entry quantity ──────────

    const exitQty1 = exit1Quantity ?? 0;
    const exitQty2 = exit2Quantity ?? 0;
    if (exitQty1 + exitQty2 > entryQuantity) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exitQuantity: [
                `Total exit quantity (${exitQty1 + exitQty2}) exceeds entry quantity (${entryQuantity})`,
              ],
            },
          },
        },
        { status: 409 },
      );
    }

    // Exit prices must be provided when exit quantities are given, and vice versa
    if ((exit1Price != null && exit1Quantity == null) || (exit1Quantity != null && exit1Price == null)) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit1: ['Both exit1Price and exit1Quantity must be provided together'],
            },
          },
        },
        { status: 400 },
      );
    }

    if ((exit2Price != null && exit2Quantity == null) || (exit2Quantity != null && exit2Price == null)) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit2: ['Both exit2Price and exit2Quantity must be provided together'],
            },
          },
        },
        { status: 400 },
      );
    }

    // Exit 2 requires exit 1
    if (exit2Price != null && exit1Price == null) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit2: ['Exit 2 requires Exit 1 to be provided first'],
            },
          },
        },
        { status: 400 },
      );
    }

    // ── Fetch and validate trade ──────────────────────────────────────

    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    if (trade.status === 'deleted') {
      return NextResponse.json(
        { error: 'Cannot execute a deleted trade' },
        { status: 400 },
      );
    }

    if (trade.status !== 'planned') {
      return NextResponse.json(
        { error: 'Trade is not in planned status' },
        { status: 400 },
      );
    }

    // ── Validate action-direction rules ───────────────────────────────

    const DIRECTION_ACTIONS: Record<string, string[]> = {
      long: ['buy', 'add', 'sell', 'reduce'],
      short: ['sell_short', 'buy_to_cover'],
    };

    const entryAction = trade.direction === 'long' ? 'buy' : 'sell_short';
    const exitAction = trade.direction === 'long' ? 'sell' : 'buy_to_cover';

    if (!DIRECTION_ACTIONS[trade.direction]?.includes(entryAction)) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              action: [
                `Action "${entryAction}" is not valid for a ${trade.direction} trade. ` +
                `Valid actions: ${DIRECTION_ACTIONS[trade.direction].join(', ')}`,
              ],
            },
          },
        },
        { status: 400 },
      );
    }

    // ── Checklist validation ──────────────────────────────────────────

    // Resolve setup definition ID from the trade's setup lookup value
    let setupDefId: string | undefined;
    if (trade.setupId) {
      const lookupVal = db
        .select()
        .from(lookupValues)
        .where(eq(lookupValues.id, trade.setupId))
        .get();

      if (lookupVal) {
        const setupDef = db
          .select()
          .from(setupDefinitions)
          .where(eq(setupDefinitions.name, lookupVal.value))
          .get();
        if (setupDef) {
          setupDefId = setupDef.id;
        }
      }
    }

    // Fetch merged checklist for this trade's account + resolved setup
    const mergedChecks = db
      .select()
      .from(checklistDefinitions)
      .where(
        and(
          or(
            eq(checklistDefinitions.accountId, trade.accountId),
            ...(setupDefId ? [eq(checklistDefinitions.setupId, setupDefId)] : []),
          ),
          isNull(checklistDefinitions.deletedAt),
        ),
      )
      .orderBy(asc(checklistDefinitions.sortOrder), asc(checklistDefinitions.createdAt))
      .all();

    if (mergedChecks.length > 0) {
      const submitted = parsed.data.checkResults ?? [];

      // Map submitted results by checklistDefinitionId for quick lookup
      const submittedMap = new Map(submitted.map((cr) => [cr.checklistDefinitionId, cr.passed]));

      // Find checklist items that are missing from submitted results or not passed.
      // Only required items gate execution (D3): optional items may be omitted,
      // but if submitted they are still recorded below.
      const missing: string[] = [];
      const notPassed: string[] = [];

      for (const check of mergedChecks) {
        if (!check.isRequired) continue;
        const passedResult = submittedMap.get(check.id);
        if (passedResult === undefined) {
          missing.push(check.description);
        } else if (!passedResult) {
          notPassed.push(check.description);
        }
      }

      if (missing.length > 0 || notPassed.length > 0) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: {
              fieldErrors: {
                checkResults: [
                  ...(missing.length > 0
                    ? [`Missing check results for: ${missing.join(', ')}`]
                    : []),
                  ...(notPassed.length > 0
                    ? [`Checklist items must be passed before execution: ${notPassed.join(', ')}`]
                    : []),
                ],
              },
            },
          },
          { status: 400 },
        );
      }
    }

    // Build the item-text snapshot map before the transaction: for each
    // submitted check result we snapshot the checklist definition's description
    // at check time (F7) so historical evidence is not re-interpreted when
    // checklist templates are edited later.
    const checkItemTextById = new Map<string, string>();
    for (const check of mergedChecks) {
      checkItemTextById.set(check.id, check.description);
    }
    for (const cr of parsed.data.checkResults ?? []) {
      if (!checkItemTextById.has(cr.checklistDefinitionId)) {
        const def = db
          .select()
          .from(checklistDefinitions)
          .where(eq(checklistDefinitions.id, cr.checklistDefinitionId))
          .get();
        if (def) {
          checkItemTextById.set(cr.checklistDefinitionId, def.description);
        }
      }
    }

    // ── Execution readiness gate (T04) ────────────────────────────────
    //
    // Planning eligibility (active + USD) is verified at trade creation;
    // execution additionally requires a trading-ready account, a planned
    // trade, required checklist items passed, and — when a max-risk threshold
    // is configured — proposed initial risk within the limit. The max-risk
    // block is overrideable: a riskOverrideReason in the request body lifts it
    // and is stored on the trade record for the audit trail (D2).

    const now = new Date().toISOString();
    const execTimestamp = executedAt ?? now;

    // Initial risk (D1: null when no valid stop — never 0).
    const effectiveStopPrice = stopPrice ?? trade.plannedStop;
    const initialRiskAmount =
      effectiveStopPrice != null
        ? Math.abs(entryPrice - effectiveStopPrice) * entryQuantity
        : null;

    const equityContext = computeExecutionContext(db, trade.accountId, execTimestamp);
    const account = equityContext.account;

    const readiness = checkExecutionReadiness({
      account: {
        isActive: account?.isActive ?? false,
        currency: account?.currency ?? 'USD',
        maxRiskPerTradePct: account?.maxRiskPerTradePct ?? null,
        defaultCommission: account?.defaultCommission ?? null,
      },
      settings: {
        maxRiskPerTradePct: equityContext.globalSettings?.maxRiskPerTradePct ?? null,
        startingAccountValue: equityContext.globalSettings?.startingAccountValue ?? null,
      },
      tradeStatus: trade.status,
      initialRiskAmount,
      equityAtOpen: equityContext.equityAtOpen,
      hasOpeningCash: equityContext.hasOpeningCash,
      // Required items were enforced by the checklist gate above.
      requiredChecklistPassed: true,
    });

    // Non-max-risk failures block unconditionally (no override contract).
    const nonMaxRiskFailure = readiness.failures.find(
      (f) => f.code !== 'max-risk-exceeded',
    );
    if (nonMaxRiskFailure) {
      const status =
        nonMaxRiskFailure.code === 'account-not-active' ||
        nonMaxRiskFailure.code === 'account-not-trading-ready'
          ? 409
          : 400;
      return NextResponse.json({ error: nonMaxRiskFailure.message }, { status });
    }

    const maxRiskFailure = readiness.failures.find(
      (f) => f.code === 'max-risk-exceeded',
    );
    const riskOverrideReason = parsed.data.riskOverrideReason ?? null;
    if (maxRiskFailure && !riskOverrideReason) {
      return NextResponse.json(
        {
          error: 'Max risk exceeded',
          details: {
            limit: maxRiskFailure.limit ?? null,
            computed: maxRiskFailure.computed ?? null,
            overrideable: true,
          },
        },
        { status: 422 },
      );
    }

    // ── Execute within a transaction ──────────────────────────────────

    const result = db.transaction((tx) => {
      // 1. Insert entry execution
      const entryId = randomUUID();
      tx.insert(tradeExecutions)
        .values({
          id: entryId,
          tradeId: id,
          action: entryAction,
          quantity: entryQuantity,
          price: entryPrice,
          fees,
          executedAt: execTimestamp,
          notes: null,
          createdAt: now,
        })
        .run();

      // 2. Insert exit 1 execution if provided
      let exit1Id: string | null = null;
      if (exit1Price != null && exit1Quantity != null) {
        exit1Id = randomUUID();
        tx.insert(tradeExecutions)
          .values({
            id: exit1Id,
            tradeId: id,
            action: exitAction,
            quantity: exit1Quantity,
            price: exit1Price,
            fees: 0,
            executedAt: execTimestamp,
            notes: null,
            createdAt: now,
          })
          .run();
      }

      // 3. Insert exit 2 execution if provided
      let exit2Id: string | null = null;
      if (exit2Price != null && exit2Quantity != null) {
        exit2Id = randomUUID();
        tx.insert(tradeExecutions)
          .values({
            id: exit2Id,
            tradeId: id,
            action: exitAction,
            quantity: exit2Quantity,
            price: exit2Price,
            fees: 0,
            executedAt: execTimestamp,
            notes: null,
            createdAt: now,
          })
          .run();
      }

      // 4. Reload all executions and derive new status
      const allExecutions = tx
        .select()
        .from(tradeExecutions)
        .where(eq(tradeExecutions.tradeId, id))
        .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
        .all();

      const execData = toExecutionData(allExecutions);
      const metrics = computeTradeMetrics({
        executions: execData,
        direction: trade.direction as Direction,
        riskSnapshot: null,
        stopAdjustments: [],
        currentMark: null,
        currentAccountEquity: null,
      });

      // 5. Update trade row
      tx.update(trades)
        .set({
          status: metrics.position.status,
          openedAt: metrics.position.openedAt,
          closedAt: metrics.position.closedAt,
          updatedAt: now,
          ...(riskOverrideReason ? { riskOverrideReason } : {}),
        })
        .where(eq(trades.id, id))
        .run();

      // 6. Upsert risk snapshot on first entry (skip if one exists).
      //    Equity context is hoisted from the readiness gate (T04): the
      //    pre-transaction reads are identical to what this section computed
      //    inline before, and no writes occur between the two.
      if (metrics.size.entryQuantity > 0) {
        const existingSnapshot = tx
          .select()
          .from(tradeRiskSnapshots)
          .where(eq(tradeRiskSnapshots.tradeId, id))
          .get();

        if (!existingSnapshot) {
          const entryExecs = allExecutions.filter((e) =>
            trade.direction === 'long'
              ? e.action === 'buy' || e.action === 'add'
              : e.action === 'sell_short',
          );

          if (entryExecs.length > 0) {
            const avgEntryPrice = metrics.averagePrices.avgEntryPrice;

            if (avgEntryPrice !== null) {
              const snapshotValues: Record<string, unknown> = {
                id: randomUUID(),
                tradeId: id,
                initialEntryPrice: avgEntryPrice,
                initialQuantity: metrics.size.entryQuantity,
                createdAt: now,
              };

              // Use stopPrice from request body, fall back to trade.plannedStop
              const effectiveStopPrice = stopPrice ?? trade.plannedStop;
              if (effectiveStopPrice != null) {
                snapshotValues.initialStopPrice = effectiveStopPrice;
              }

              if (equityContext.equityAtOpen != null) {
                snapshotValues.accountEquityAtOpen = equityContext.equityAtOpen;
              }

              // Compute derived risk snapshot values
              const riskValues = computeRiskSnapshotValues({
                avgEntryPrice,
                initialQuantity: metrics.size.entryQuantity,
                initialStopPrice: effectiveStopPrice ?? null,
                direction: trade.direction as Direction,
                accountEquityAtOpen: equityContext.equityAtOpen,
              });

              snapshotValues.riskPerShare = riskValues.riskPerShare;
              snapshotValues.initialRiskAmount = riskValues.initialRiskAmount;
              snapshotValues.accountRiskPct = riskValues.accountRiskPct;

              tx.insert(tradeRiskSnapshots)
                .values(snapshotValues as unknown as typeof tradeRiskSnapshots.$inferInsert)
                .run();
            }
          }
        }
      }

      // 7. Persist trade check results atomically within the transaction,
      // snapshotting the item text (F7) at check time.
      const submitted = parsed.data.checkResults ?? [];
      const nowTime = now;
      for (const cr of submitted) {
        tx.insert(tradeCheckResults)
          .values({
            id: randomUUID(),
            tradeId: id,
            checklistDefinitionId: cr.checklistDefinitionId,
            itemText: checkItemTextById.get(cr.checklistDefinitionId) ?? null,
            passed: cr.passed,
            comment: cr.comment ?? null,
            checkedAt: nowTime,
            createdAt: nowTime,
          })
          .run();
      }

      // Return the created executions for the response
      const createdExecutions = tx
        .select()
        .from(tradeExecutions)
        .where(eq(tradeExecutions.tradeId, id))
        .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
        .all();

      const updatedTrade = tx
        .select()
        .from(trades)
        .where(eq(trades.id, id))
        .get();

      return { executions: createdExecutions, trade: updatedTrade };
    });

    // ── Sync positions to accounting (non-fatal) ────────────────
    try {
      const sqlite = getSqliteHandle();
      for (const execution of result.executions) {
        syncAndRebuildPositions(
          sqlite,
          {
            id: execution.id,
            tradeId: execution.tradeId,
            action: execution.action,
            quantity: execution.quantity,
            price: execution.price,
            fees: execution.fees,
            executedAt: execution.executedAt,
          },
          trade.accountId,
          trade.symbol,
        );
      }
    } catch (_syncErr) {
      // Non-fatal: sync failures are logged by syncAndRebuildPositions
      // and do not affect the trade execution response.
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to execute trade', details: String(error) },
      { status: 500 },
    );
  }
}
