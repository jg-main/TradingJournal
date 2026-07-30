import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, tradeExecutions, tradeRiskSnapshots, accounts, accountTransactions, settings as settingsTable } from '@/db/schema';
import { eq, and, lte } from 'drizzle-orm';
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

    const executionId = randomUUID();
    const now = new Date().toISOString();

    db.insert(tradeExecutions)
      .values({
        id: executionId,
        tradeId: id,
        action: parsed.data.action,
        quantity: parsed.data.quantity,
        price: parsed.data.price,
        fees: parsed.data.fees,
        executedAt: parsed.data.executedAt ?? now,
        reasonId: parsed.data.reasonId ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
      })
      .run();

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

            // ── Compute accountEquityAtOpen ──────────────────────────
            if (trade.accountId) {
              const account = db
                .select()
                .from(accounts)
                .where(eq(accounts.id, trade.accountId))
                .get();

              if (account) {
                const executionDate = parsed.data.executedAt ?? now;

                const allTxns = db
                  .select()
                  .from(accountTransactions)
                  .where(
                    and(
                      eq(accountTransactions.accountId, trade.accountId),
                      lte(accountTransactions.date, executionDate),
                    ),
                  )
                  .all();

                const sumDeposits = allTxns
                  .filter((tx) => tx.type === 'deposit')
                  .reduce((s, tx) => s + tx.amount, 0);
                const sumWithdrawals = allTxns
                  .filter((tx) => tx.type === 'withdrawal')
                  .reduce((s, tx) => s + tx.amount, 0);

                const priorClosedTrades = db
                  .select()
                  .from(trades)
                  .where(eq(trades.accountId, trade.accountId))
                  .all()
                  .filter(
                    (t) => t.closedAt != null && t.closedAt <= executionDate,
                  );

                const priorTradeData: PriorClosedTradeData[] = priorClosedTrades.map((ct) => {
                  const execs = db
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

                const globalSettings = db
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
                  initialStopPrice: trade.plannedStop ?? null,
                  direction: trade.direction as Direction,
                  accountEquityAtOpen: equityAtOpen,
                });

                snapshotValues.riskPerShare = riskValues.riskPerShare;
                snapshotValues.initialRiskAmount = riskValues.initialRiskAmount;
                snapshotValues.accountRiskPct = riskValues.accountRiskPct;
              }
            }

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
