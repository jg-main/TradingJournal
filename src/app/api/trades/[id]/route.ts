import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, watchlistItems, lookupValues, setupDefinitions, tradeExecutions, tradeRiskSnapshots, tradeStopAdjustments, settings, accounts } from '@/db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { resolveSetup } from '@/lib/setup-resolver';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput } from '@/lib/trade-metrics';

const updateTradeSchema = z.object({
  symbol: z.string().min(1).max(20).optional(),
  direction: z.enum(['long', 'short']).optional(),
  setup: z.string().nullable().optional(),
  setupId: z.string().uuid().nullable().optional(),
  sectorId: z.string().nullable().optional(),
  marketConditionId: z.string().nullable().optional(),
  thesis: z.string().nullable().optional(),
  plannedEntry: z.number().nullable().optional(),
  plannedStop: z.number().nullable().optional(),
  plannedTarget1: z.number().nullable().optional(),
  plannedTarget2: z.number().nullable().optional(),
  plannedQuantity: z.number().nullable().optional(),

  invalidationCondition: z.string().nullable().optional(),
  preTradePlan: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const row = db
      .select({
        id: trades.id,
        tradeCode: trades.tradeCode,
        symbol: trades.symbol,
        direction: trades.direction,
        accountId: trades.accountId,
        sectorId: trades.sectorId,
        setupId: trades.setupId,
        marketConditionId: trades.marketConditionId,
        status: trades.status,
        plannedEntry: trades.plannedEntry,
        plannedStop: trades.plannedStop,
        plannedTarget1: trades.plannedTarget1,
        plannedTarget2: trades.plannedTarget2,
        plannedQuantity: trades.plannedQuantity,
        thesis: trades.thesis,
        invalidationCondition: trades.invalidationCondition,
        preTradePlan: trades.preTradePlan,
        openedAt: trades.openedAt,
        closedAt: trades.closedAt,
        exitNotes: trades.exitNotes,
        lesson: trades.lesson,
        createdAt: trades.createdAt,
        updatedAt: trades.updatedAt,
        currentPrice: trades.currentPrice,
        currentPriceFetchedAt: trades.currentPriceFetchedAt,
        setupName: sql<string | null>`COALESCE(${setupDefinitions.name}, ${lookupValues.value})`,
      })
      .from(trades)
      .leftJoin(lookupValues, eq(trades.setupId, lookupValues.id))
      .leftJoin(setupDefinitions, eq(trades.setupId, setupDefinitions.id))
      .where(eq(trades.id, id))
      .get();

    if (!row) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    // ── Fetch related data for trade metrics computation ───────────────

    const executionRows = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.tradeId, id))
      .all();

    const riskSnapshotRow = db
      .select()
      .from(tradeRiskSnapshots)
      .where(eq(tradeRiskSnapshots.tradeId, id))
      .get();

    const stopAdjustmentRows = db
      .select()
      .from(tradeStopAdjustments)
      .where(eq(tradeStopAdjustments.tradeId, id))
      .orderBy(desc(tradeStopAdjustments.adjustedAt), desc(tradeStopAdjustments.newStop), desc(tradeStopAdjustments.createdAt))
      .all();

    // Derive current account equity: account startingBalance, then settings fallback, then null
    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, row.accountId))
      .get();

    const settingsRow = db
      .select()
      .from(settings)
      .where(eq(settings.id, 'default'))
      .get();

    const currentAccountEquity =
      account?.startingBalance ?? settingsRow?.startingAccountValue ?? null;

    // ── Build TradeMetricsInput ───────────────────────────────────────

    const metricsInput: TradeMetricsInput = {
      executions: executionRows.map((e) => ({
        id: e.id,
        action: e.action,
        quantity: e.quantity,
        price: e.price,
        fees: e.fees,
        executedAt: e.executedAt ?? '',
      })),
      direction: row.direction as 'long' | 'short',
      riskSnapshot: riskSnapshotRow
        ? {
            initialRiskAmount: riskSnapshotRow.initialRiskAmount,
            accountEquityAtOpen: riskSnapshotRow.accountEquityAtOpen,
            initialStopPrice: riskSnapshotRow.initialStopPrice,
            initialEntryPrice: riskSnapshotRow.initialEntryPrice,
          }
        : null,
      stopAdjustments: stopAdjustmentRows
        .filter((s): s is typeof s & { newStop: number } => s.newStop != null)
        .map((s) => ({
          stopPrice: s.newStop,
          adjustedAt: s.adjustedAt ?? '',
        })),
      currentMark:
        row.currentPrice != null
          ? {
              price: row.currentPrice,
              markedAt: row.currentPriceFetchedAt ?? new Date().toISOString(),
            }
          : null,
      currentAccountEquity,
    };

    const metrics = computeTradeMetrics(metricsInput);

    // Metrics returned via nested metrics: TradeMetricsResult — consumers read
    // metrics.realizedPnl, metrics.unrealizedPnl, metrics.returnMetrics, metrics.risk
    return NextResponse.json({
      ...row,
      metrics,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch trade', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateTradeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    // Map 'setup' back to 'setupId' for the DB column
    const updateData: Record<string, unknown> = {};
    if (parsed.data.setupId !== undefined) {
      updateData.setupId = parsed.data.setupId;
    } else if (parsed.data.setup !== undefined) {
      if (parsed.data.setup === null) {
        updateData.setupId = null;
      } else {
        const resolved = resolveSetup(parsed.data.setup);
        if (!resolved) {
          // This shouldn't happen since resolveSetup always creates a record for non-null values
          updateData.setupId = null;
        } else {
          updateData.setupId = resolved.id;
        }
      }
    }
    if (parsed.data.sectorId !== undefined) updateData.sectorId = parsed.data.sectorId;
    if (parsed.data.marketConditionId !== undefined) updateData.marketConditionId = parsed.data.marketConditionId;
    if (parsed.data.thesis !== undefined) updateData.thesis = parsed.data.thesis;
    if (parsed.data.plannedEntry !== undefined) updateData.plannedEntry = parsed.data.plannedEntry;
    if (parsed.data.plannedStop !== undefined) updateData.plannedStop = parsed.data.plannedStop;
    if (parsed.data.symbol !== undefined) updateData.symbol = parsed.data.symbol;
    if (parsed.data.direction !== undefined) updateData.direction = parsed.data.direction;
    if (parsed.data.plannedTarget1 !== undefined) updateData.plannedTarget1 = parsed.data.plannedTarget1;
    if (parsed.data.plannedTarget2 !== undefined) updateData.plannedTarget2 = parsed.data.plannedTarget2;
    if (parsed.data.plannedQuantity !== undefined) updateData.plannedQuantity = parsed.data.plannedQuantity;

    if (parsed.data.invalidationCondition !== undefined) updateData.invalidationCondition = parsed.data.invalidationCondition;
    if (parsed.data.preTradePlan !== undefined) updateData.preTradePlan = parsed.data.preTradePlan;
    updateData.updatedAt = new Date().toISOString();

    db.update(trades)
      .set(updateData)
      .where(eq(trades.id, id))
      .run();

    const row = db
      .select({
        id: trades.id,
        tradeCode: trades.tradeCode,
        symbol: trades.symbol,
        direction: trades.direction,
        accountId: trades.accountId,
        sectorId: trades.sectorId,
        setupId: trades.setupId,
        marketConditionId: trades.marketConditionId,
        status: trades.status,
        plannedEntry: trades.plannedEntry,
        plannedStop: trades.plannedStop,
        plannedTarget1: trades.plannedTarget1,
        plannedTarget2: trades.plannedTarget2,
        plannedQuantity: trades.plannedQuantity,
        thesis: trades.thesis,
        invalidationCondition: trades.invalidationCondition,
        preTradePlan: trades.preTradePlan,
        openedAt: trades.openedAt,
        closedAt: trades.closedAt,
        exitNotes: trades.exitNotes,
        lesson: trades.lesson,
        createdAt: trades.createdAt,
        updatedAt: trades.updatedAt,
        setupName: sql<string | null>`COALESCE(${setupDefinitions.name}, ${lookupValues.value})`,
      })
      .from(trades)
      .leftJoin(lookupValues, eq(trades.setupId, lookupValues.id))
      .leftJoin(setupDefinitions, eq(trades.setupId, setupDefinitions.id))
      .where(eq(trades.id, id))
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update trade', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    // Hard delete: nullify watchlist FK references first, then delete
    db.update(watchlistItems)
      .set({ promotedTradeId: null })
      .where(eq(watchlistItems.promotedTradeId, id))
      .run();

    db.delete(trades)
      .where(eq(trades.id, id))
      .run();

    return NextResponse.json({ message: 'Trade deleted' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete trade', details: String(error) },
      { status: 500 }
    );
  }
}
