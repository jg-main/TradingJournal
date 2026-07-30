import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeExecutions, tradeRiskSnapshots, accounts, accountTransactions, settings as settingsTable, checklistDefinitions, tradeCheckResults, lookupValues, setupDefinitions } from '@/db/schema';
import { eq, and, lte, asc, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { computeTradeMetrics, type ExecutionData, type Direction } from '@/lib/trade-metrics';
import {
  computeEquityAtOpen,
  computeRealizedPnLFromClosedTrades,
  computeRiskSnapshotValues,
  type PriorClosedTradeData,
} from '@/lib/risk-snapshot';
import { syncAndRebuildPositions } from '@/lib/positions/trade-execution-sync';
import { getSqliteHandle } from '@/db';

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
        { status: 400 },
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

      // Find checklist items that are missing from submitted results or not passed
      const missing: string[] = [];
      const notPassed: string[] = [];

      for (const check of mergedChecks) {
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

    // ── Execute within a transaction ──────────────────────────────────

    const now = new Date().toISOString();
    const execTimestamp = executedAt ?? now;

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
        })
        .where(eq(trades.id, id))
        .run();

      // 6. Upsert risk snapshot on first entry (skip if one exists)
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

              // ── Compute accountEquityAtOpen ────────────────────────
              if (trade.accountId) {
                const account = tx
                  .select()
                  .from(accounts)
                  .where(eq(accounts.id, trade.accountId))
                  .get();

                if (account) {
                  const allTxns = tx
                    .select()
                    .from(accountTransactions)
                    .where(
                      and(
                        eq(accountTransactions.accountId, trade.accountId),
                        lte(accountTransactions.date, execTimestamp),
                      ),
                    )
                    .all();

                  const sumDeposits = allTxns
                    .filter((txn) => txn.type === 'deposit')
                    .reduce((s, txn) => s + txn.amount, 0);
                  const sumWithdrawals = allTxns
                    .filter((txn) => txn.type === 'withdrawal')
                    .reduce((s, txn) => s + txn.amount, 0);

                  const priorClosedTrades = tx
                    .select()
                    .from(trades)
                    .where(eq(trades.accountId, trade.accountId))
                    .all()
                    .filter(
                      (t) => t.closedAt != null && t.closedAt <= execTimestamp,
                    );

                  const priorTradeData: PriorClosedTradeData[] = priorClosedTrades.map((ct) => {
                    const execs = tx
                      .select()
                      .from(tradeExecutions)
                      .where(eq(tradeExecutions.tradeId, ct.id))
                      .orderBy(
                        tradeExecutions.executedAt,
                        tradeExecutions.createdAt,
                      )
                      .all();
                    return {
                      direction: ct.direction as Direction,
                      executions: toExecutionData(execs),
                    };
                  });

                  const realizedPnL = computeRealizedPnLFromClosedTrades(priorTradeData);

                  const globalSettings = tx
                    .select()
                    .from(settingsTable)
                    .get();

                  const equityAtOpen = computeEquityAtOpen({
                    startingBalance: account.startingBalance ?? 0,
                    deposits: sumDeposits,
                    withdrawals: sumWithdrawals,
                    realizedPnL,
                    hasNoAccountData:
                      account.startingBalance == null &&
                      allTxns.length === 0 &&
                      priorClosedTrades.length === 0,
                    fallbackValue: globalSettings?.startingAccountValue ?? null,
                  });

                  if (equityAtOpen != null) {
                    snapshotValues.accountEquityAtOpen = equityAtOpen;
                  }

                  // Compute derived risk snapshot values
                  const riskValues = computeRiskSnapshotValues({
                    avgEntryPrice,
                    initialQuantity: metrics.size.entryQuantity,
                    initialStopPrice: effectiveStopPrice ?? null,
                    direction: trade.direction as Direction,
                    accountEquityAtOpen: equityAtOpen,
                  });

                  snapshotValues.riskPerShare = riskValues.riskPerShare;
                  snapshotValues.initialRiskAmount = riskValues.initialRiskAmount;
                  snapshotValues.accountRiskPct = riskValues.accountRiskPct;
                }
              }

              tx.insert(tradeRiskSnapshots)
                .values(snapshotValues as unknown as typeof tradeRiskSnapshots.$inferInsert)
                .run();
            }
          }
        }
      }

      // 7. Persist trade check results atomically within the transaction
      const submitted = parsed.data.checkResults ?? [];
      const nowTime = now;
      for (const cr of submitted) {
        tx.insert(tradeCheckResults)
          .values({
            id: randomUUID(),
            tradeId: id,
            checklistDefinitionId: cr.checklistDefinitionId,
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
