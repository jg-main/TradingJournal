import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, tradeExecutions, tradeRiskSnapshots, checklistDefinitions, tradeCheckResults, lookupValues, setupDefinitions } from '@/db/schema';
import { eq, and, or, isNull, asc } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { computeTradeMetrics, type ExecutionData, type Direction } from '@/lib/trade-metrics';
import { computeRiskSnapshotValues } from '@/lib/risk-snapshot';
import { syncAndRebuildPositions } from '@/lib/positions/trade-execution-sync';
import { checkExecutionReadiness } from '@/lib/execution-readiness';
import { computeExecutionContext } from '@/lib/execution-context';

const createExecutionSchema = z.object({
  action: z.enum([
    'buy',
    'sell',
    'buy_to_cover',
    'sell_short',
    'add',
    'reduce',
  ]),
  quantity: z.number().positive(),
  price: z.number().positive(),
  executedAt: z.string().optional(),
  fees: z.number().min(0).optional().default(0),
  reasonId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
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

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    const executions = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.tradeId, id))
      .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
      .all();

    return NextResponse.json(executions);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch executions', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = createExecutionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

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
        { error: 'Cannot add executions to a deleted trade' },
        { status: 400 },
      );
    }


    // ── Action-direction validation ────────────────────────────

    const DIRECTION_ACTIONS: Record<string, string[]> = {
      long: ['buy', 'add', 'sell', 'reduce'],
      short: ['sell_short', 'buy_to_cover'],
    };

    if (!DIRECTION_ACTIONS[trade.direction]?.includes(parsed.data.action)) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              action: [
                `Action "${parsed.data.action}" is not valid for a ${trade.direction} trade. ` +
                `Valid actions: ${DIRECTION_ACTIONS[trade.direction].join(', ')}`,
              ],
            },
          },
        },
        { status: 400 },
      );
    }

    // ── Checklist gate: first fill only ──────────────────────────────
    //
    // When the trade is still 'planned' this is the first fill: enforce the
    // required items of the merged active checklist (account + resolved setup)
    // before any mutation, mirroring the P1 execute gate (D3). Subsequent
    // fills (status already 'open'/'closed') do NOT re-enforce the gate.
    // Submitted check results are persisted with an item-text snapshot (F7).
    let submittedCheckResults: {
      checklistDefinitionId: string;
      passed: boolean;
      comment?: string;
    }[] = [];
    const checkItemTextById = new Map<string, string>();

    // Shared execution timestamp + hoisted execution context (T04): the
    // equity/account reads are computed once in the first-fill gate and reused
    // by the risk-snapshot section below.
    const now = new Date().toISOString();
    const execTimestamp = parsed.data.executedAt ?? now;
    let riskOverrideReasonToStore: string | null = null;
    let equityContext: ReturnType<typeof computeExecutionContext> | undefined;

    if (trade.status === 'planned') {
      const submitted = parsed.data.checkResults ?? [];
      submittedCheckResults = submitted;

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
        const submittedMap = new Map(submitted.map((cr) => [cr.checklistDefinitionId, cr.passed]));

        // Only required items gate execution (D3): optional items may be
        // omitted, but if submitted they are still recorded below.
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

      // Build the item-text snapshot map (F7): snapshot each definition's
      // description at check time, with a direct fallback for any submitted
      // definition that is not part of the merged active set.
      for (const check of mergedChecks) {
        checkItemTextById.set(check.id, check.description);
      }
      for (const cr of submitted) {
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

      // ── Execution readiness gate (T04): first fill only ─────────────
      // Initial risk comes from the entry price and the planned stop (P2 has
      // no per-fill stopPrice; the risk snapshot uses trade.plannedStop).
      const initialRiskAmount =
        trade.plannedStop != null
          ? Math.abs(parsed.data.price - trade.plannedStop) * parsed.data.quantity
          : null;

      equityContext = computeExecutionContext(db, trade.accountId, execTimestamp);

      const readiness = checkExecutionReadiness({
        account: {
          isActive: equityContext.account?.isActive ?? false,
          currency: equityContext.account?.currency ?? 'USD',
          maxRiskPerTradePct: equityContext.account?.maxRiskPerTradePct ?? null,
          defaultCommission: equityContext.account?.defaultCommission ?? null,
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
      if (maxRiskFailure && !parsed.data.riskOverrideReason) {
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
      if (maxRiskFailure && parsed.data.riskOverrideReason) {
        riskOverrideReasonToStore = parsed.data.riskOverrideReason;
      }
    }
    const executionId = randomUUID();

    db.insert(tradeExecutions)
      .values({
        id: executionId,
        tradeId: id,
        action: parsed.data.action,
        quantity: parsed.data.quantity,
        price: parsed.data.price,
        fees: parsed.data.fees,
        executedAt: execTimestamp,
        reasonId: parsed.data.reasonId ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
      })
      .run();

    // ── Persist first-fill check results (item-text snapshot) ─────────
    if (trade.status === 'planned' && submittedCheckResults.length > 0) {
      for (const cr of submittedCheckResults) {
        db.insert(tradeCheckResults)
          .values({
            id: randomUUID(),
            tradeId: id,
            checklistDefinitionId: cr.checklistDefinitionId,
            itemText: checkItemTextById.get(cr.checklistDefinitionId) ?? null,
            passed: cr.passed,
            comment: cr.comment ?? null,
            checkedAt: now,
            createdAt: now,
          })
          .run();
      }
    }

    // ── Recalculate trade status and timestamps ──────────────────────

    const allExecutions = db
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

    db.update(trades)
      .set({
        status: metrics.position.status,
        openedAt: metrics.position.openedAt,
        closedAt: metrics.position.closedAt,
        updatedAt: now,
        ...(riskOverrideReasonToStore ? { riskOverrideReason: riskOverrideReasonToStore } : {}),
      })
      .where(eq(trades.id, id))
      .run();

    // ── Upsert risk snapshot on first entry ──────────────────────────

    if (metrics.position.status !== 'planned' && metrics.size.entryQuantity > 0) {
      const existingSnapshot = db
        .select()
        .from(tradeRiskSnapshots)
        .where(eq(tradeRiskSnapshots.tradeId, id))
        .get();

      if (!existingSnapshot) {
        const entryCount = execData.filter((e) =>
          trade.direction === 'long'
            ? e.action === 'buy' || e.action === 'add'
            : e.action === 'sell_short',
        ).length;

        if (entryCount > 0) {
          const avgEntryPrice = metrics.averagePrices.avgEntryPrice;

          if (avgEntryPrice !== null) {
            const snapshotValues: Record<string, unknown> = {
              id: randomUUID(),
              tradeId: id,
              initialEntryPrice: avgEntryPrice,
              initialQuantity: metrics.size.entryQuantity,
              createdAt: now,
            };

            if (trade.plannedStop != null) {
              snapshotValues.initialStopPrice = trade.plannedStop;
            }

            // Equity context is hoisted from the readiness gate (T04); the
            // reads are identical to the inline derivation this section
            // performed before, and no writes occur between the two.
            if (equityContext?.equityAtOpen != null) {
              snapshotValues.accountEquityAtOpen = equityContext.equityAtOpen;
            }

            // Compute derived risk snapshot values
            const riskValues = computeRiskSnapshotValues({
              avgEntryPrice,
              initialQuantity: metrics.size.entryQuantity,
              initialStopPrice: trade.plannedStop ?? null,
              direction: trade.direction as Direction,
              accountEquityAtOpen: equityContext?.equityAtOpen ?? null,
            });

            snapshotValues.riskPerShare = riskValues.riskPerShare;
            snapshotValues.initialRiskAmount = riskValues.initialRiskAmount;
            snapshotValues.accountRiskPct = riskValues.accountRiskPct;

            db.insert(tradeRiskSnapshots)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .values(snapshotValues as any)
              .run();
          }
        }
      }
    }

    // ── Sync positions to accounting (non-fatal) ────────────────
    try {
      const sqlite = getSqliteHandle();
      syncAndRebuildPositions(
        sqlite,
        {
          id: executionId,
          tradeId: id,
          action: parsed.data.action,
          quantity: parsed.data.quantity,
          price: parsed.data.price,
          fees: parsed.data.fees,
          executedAt: parsed.data.executedAt ?? now,
        },
        trade.accountId,
        trade.symbol,
      );
    } catch (_syncErr) {
      // Non-fatal: sync failures are logged by syncAndRebuildPositions
      // and do not affect the trade execution response.
    }

    const created = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.id, executionId))
      .get();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create execution', details: String(error) },
      { status: 500 },
    );
  }
}
