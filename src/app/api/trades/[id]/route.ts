import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, lookupValues, setupDefinitions, tradeExecutions, tradeRiskSnapshots, tradeStopAdjustments, tradeTargetAdjustments, accounts } from '@/db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { resolveSetup } from '@/lib/setup-resolver';
import { deriveWorkflowPhase, hasManagementActivity } from '@/lib/workflow-phase';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput } from '@/lib/trade-metrics';
import { resolveTradeMetricsExecutions } from '@/lib/trade-correction-lifecycle';
import { resolveExecutionEquityContext } from '@/lib/execution-equity';

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

// M002-A4: the COMPLETE pre-trade decision context is historical evidence once
// the first economic execution exists. R019/T02 froze the planning geometry;
// A4 extends the same historical-integrity contract to the narrative decision
// fields (thesis / invalidationCondition / preTradePlan). The freeze trigger is
// EXECUTION HISTORY (hasTradeExecutionHistory), not derived status — trade
// status can change through correction, but original pre-trade intent remains
// immutable once any execution has been accepted. Post-entry learning belongs
// in management notes / exit notes / lesson / review / mistakes / grade, not in
// a rewrite of the original plan.
//
// One canonical list: geometry + narrative classification + narrative intent.
const PRE_TRADE_CONTEXT_FIELDS = [
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
  'thesis',
  'invalidationCondition',
  'preTradePlan',
] as const;

/**
 * Deterministic execution-history predicate (M002-A4).
 *
 * True when the trade has an accepted economic execution record. The
 * repository audit proves every accepted trade fill creates a
 * trade_executions row (engine + both execution routes) and no production
 * path deletes them. Historical compatibility also recognizes linked
 * accounting_executions (journal_trade_id). Status / open quantity / risk
 * snapshot are NOT the criterion — a legacy executed trade with an
 * inconsistent stored status must stay frozen, and a genuine planned trade
 * with no executions must stay editable regardless of derived state.
 */
function hasTradeExecutionHistory(sqlite: ReturnType<typeof getSqliteHandle>, tradeId: string): boolean {
  const journalRow = sqlite
    .prepare('SELECT 1 FROM trade_executions WHERE trade_id = ? LIMIT 1')
    .get(tradeId);
  if (journalRow) return true;
  const accountingRow = sqlite
    .prepare('SELECT 1 FROM accounting_executions WHERE journal_trade_id = ? LIMIT 1')
    .get(tradeId);
  return Boolean(accountingRow);
}

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
        reviewedAt: trades.reviewedAt,
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

    // M002-A9: current account equity resolves through the SAME canonical
    // resolver execution readiness uses (current_projection → bounded
    // rollforward → reconstruction → explicit legacy compatibility →
    // unavailable), resolved with one stable request timestamp. Canonical zero
    // stays zero; settings.startingAccountValue can never fabricate canonical
    // funding. No local startingBalance/startingAccountValue fallback cascade
    // remains. The account row lookup is retained only for display metadata.
    const now = new Date().toISOString();
    const currentEquityContext = resolveExecutionEquityContext(getSqliteHandle(), row.accountId, now);
    const currentAccountEquity = currentEquityContext.equity;

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
      // S08 zero-divergence: when the trade has economic corrections, derive
      // metrics from the effective execution set (accounting_executions +
      // correction_lineage) so this surface never disagrees with positions /
      // overview / ledger / performance after a correction.
      executions: resolveTradeMetricsExecutions(getSqliteHandle(), id, executionRows),
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
    // add/reduce executions or any stop/target adjustment. S07/T02: the
    // 'reviewed' phase is driven by the durable reviewedAt marker written by
    // POST /api/trades/[id]/review; closed trades without the marker report
    // 'closed'.
    const managementActivity = hasManagementActivity(
      executionRows,
      stopAdjustmentRows,
      targetAdjustmentRows,
    );
    const workflowPhase = deriveWorkflowPhase(row.status, row.reviewedAt, managementActivity);

    // M002-A4: expose the freeze signal so clients render pre-trade context
    // read-only instead of presenting controls that can never succeed. Based
    // on execution history, not derived status.
    const preTradeFrozen = hasTradeExecutionHistory(getSqliteHandle(), id);

    // Metrics returned via nested metrics: TradeMetricsResult — consumers read
    // metrics.realizedPnl, metrics.unrealizedPnl, metrics.returnMetrics, metrics.risk
    return NextResponse.json({
      ...row,
      reviewedAt: row.reviewedAt ?? null,
      accountName,
      accountCurrency,
      sectorName,
      workflowPhase,
      preTradeFrozen,
      metrics,
      // A2: expose risk-snapshot equity provenance (nullable for historical
      // snapshots that predate the provenance migration).
      riskSnapshotProvenance: riskSnapshotRow
        ? {
            accountEquityAtOpen: riskSnapshotRow.accountEquityAtOpen,
            accountEquitySource: riskSnapshotRow.accountEquitySource ?? null,
            accountEquityAsOf: riskSnapshotRow.accountEquityAsOf ?? null,
          }
        : null,
      // M002-A9: current canonical account-equity context (debuggable risk
      // trust — equity/source/asOf for the CURRENT risk denominator, distinct
      // from the historical riskSnapshotProvenance).
      currentAccountEquityContext: {
        equity: currentEquityContext.equity,
        source: currentEquityContext.source,
        asOf: currentEquityContext.asOf,
      },
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

    // M002-A4: the complete pre-trade context (geometry + narrative intent) is
    // immutable once the trade has ANY accepted economic execution history.
    // Status is derived state and may change through correction — the freeze
    // key is execution history. Null values are still update attempts and are
    // rejected. The whole request is rejected before any mutation (atomic),
    // listing every offending field for actionable clients.
    const sqlite = getSqliteHandle();
    if (hasTradeExecutionHistory(sqlite, id)) {
      const frozenPresent = PRE_TRADE_CONTEXT_FIELDS.filter(
        (field) => parsed.data[field] !== undefined,
      );
      if (frozenPresent.length > 0) {
        return NextResponse.json(
          {
            error: 'Pre-trade context is immutable after execution.',
            code: 'PRE_TRADE_CONTEXT_FROZEN',
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
