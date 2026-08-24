import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, lookupValues, setupDefinitions, tradeExecutions, tradeRiskSnapshots, tradeStopAdjustments, tradeTargetAdjustments, settings, accounts, accountRollforward, accountPerformance } from '@/db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { resolveSetup } from '@/lib/setup-resolver';
import { deriveWorkflowPhase, hasManagementActivity } from '@/lib/workflow-phase';
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

// R019/T02: all planning-geometry fields are frozen once a trade leaves
// 'planned' status. Open trades manage their active stop exclusively through
// the Adjust Stop flow (trade_stop_adjustments); closed and deleted trades
// must keep their historical planning geometry intact. Editing planning
// fields on a non-planned trade would silently corrupt historical state —
// e.g. changing direction on an open trade reverses P&L sign, and rewriting
// the symbol rewrites the executed instrument. A null value is still an
// update attempt and is rejected. Thesis, invalidationCondition, and
// preTradePlan remain editable at any status — they are narrative/context
// fields, not planning geometry.
const PLANNING_FIELDS = [
  'direction',
  'symbol',
  'plannedEntry',
  'plannedStop',
  'plannedTarget1',
  'plannedTarget2',
  'plannedQuantity',
  'setupId',
  'setup',
  'sectorId',
  'marketConditionId',
] as const;

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
      .orderBy(desc(tradeStopAdjustments.adjustedAt), desc(tradeStopAdjustments.createdAt), desc(tradeStopAdjustments.id))
      .all();

    const targetAdjustmentRows = db
      .select()
      .from(tradeTargetAdjustments)
      .where(eq(tradeTargetAdjustments.tradeId, id))
      .orderBy(desc(tradeTargetAdjustments.adjustedAt), desc(tradeTargetAdjustments.createdAt), desc(tradeTargetAdjustments.id))
      .all();

    // Derive current account equity: account_performance.nav → rollforward.endingEquity
    // → account.startingBalance → settings.startingAccountValue → null
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

    // Primary equity source: account_performance.nav (TEXT → parseFloat)
    const perfRow = db
      .select({ nav: accountPerformance.nav })
      .from(accountPerformance)
      .where(eq(accountPerformance.accountId, row.accountId))
      .get();
    const navValue = perfRow?.nav ? parseFloat(perfRow.nav) : null;

    // Secondary equity source: latest account_rollforward.endingEquity
    const rollforwardRow = db
      .select()
      .from(accountRollforward)
      .where(eq(accountRollforward.accountId, row.accountId))
      .orderBy(desc(accountRollforward.date))
      .limit(1)
      .get();

    const currentAccountEquity =
      navValue ??
      rollforwardRow?.endingEquity ??
      account?.startingBalance ??
      settingsRow?.startingAccountValue ??
      null;

    // Resolve account display name and currency
    const accountName = account?.name ?? null;
    const accountCurrency = account?.currency ?? null;

    // Resolve sector name from lookup_values
    let sectorName: string | null = null;
    if (row.sectorId) {
      const sectorRow = db
        .select({ value: lookupValues.value })
        .from(lookupValues)
        .where(eq(lookupValues.id, row.sectorId))
        .get();
      sectorName = sectorRow?.value ?? null;
    }

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
          createdAt: s.createdAt ?? '',
          id: s.id,
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

    // S05/T02: derived workflow phase — 'managed' when an open trade has
    // add/reduce executions or any stop/target adjustment. reviewedAt is
    // always null today (the trades table now stores reviewed_at but no review workflow writes it yet), so
    // closed trades report 'closed'; the 'reviewed' phase lights up through
    // workflow-phase.ts once review storage exists.
    const managementActivity = hasManagementActivity(
      executionRows,
      stopAdjustmentRows,
      targetAdjustmentRows,
    );
    const workflowPhase = deriveWorkflowPhase(row.status, null, managementActivity);

    // Metrics returned via nested metrics: TradeMetricsResult — consumers read
    // metrics.realizedPnl, metrics.unrealizedPnl, metrics.returnMetrics, metrics.risk
    return NextResponse.json({
      ...row,
      accountName,
      accountCurrency,
      sectorName,
      workflowPhase,
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

    // R019/T02: all planning fields are immutable once a trade leaves
    // 'planned' status (generalized from the original plannedStop-only freeze).
    // Editing planning geometry on an open trade would corrupt live state
    // (direction flip reverses P&L sign; symbol rewrite detaches executions);
    // on closed/deleted trades it would rewrite history. Null values are still
    // update attempts and are rejected. Thesis, invalidationCondition, and
    // preTradePlan are narrative/context fields and stay editable at any
    // status. The response lists the offending fields for actionable clients.
    if (existing.status !== 'planned') {
      const frozenPresent = PLANNING_FIELDS.filter(
        (field) => parsed.data[field] !== undefined,
      );
      if (frozenPresent.length > 0) {
        return NextResponse.json(
          {
            error:
              'Planning fields can only be changed while the trade is planned.',
            details: { fields: frozenPresent },
          },
          { status: 400 },
        );
      }
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

    // D057/R027: planned-only soft-delete (scratch). Only planned trades can be
    // scratched — open/closed trades hold live or historical state that must not
    // be hidden, and an already-scratched trade is idempotently rejected. The
    // row is preserved with status='deleted' and updatedAt stamped for an
    // auditable scratch time. The watchlist_items.promotedTradeId link is
    // intentionally NOT nullified: the row still exists (no FK integrity issue),
    // so the promotion audit trail survives the scratch.
    if (existing.status !== 'planned') {
      const error =
        existing.status === 'deleted'
          ? 'Trade is already scratched.'
          : `Only planned trades can be scratched; this trade is ${existing.status}.`;
      return NextResponse.json({ error }, { status: 400 });
    }

    db.update(trades)
      .set({ status: 'deleted', updatedAt: new Date().toISOString() })
      .where(eq(trades.id, id))
      .run();

    return NextResponse.json({ message: 'Trade scratched' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to scratch trade', details: String(error) },
      { status: 500 }
    );
  }
}
