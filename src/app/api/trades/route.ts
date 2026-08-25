import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, settings, accounts, lookupValues, setupDefinitions, tradeRiskSnapshots, tradeExecutions, tradeStopAdjustments, tradeTargetAdjustments } from '@/db/schema';
import { eq, and, asc, desc, sql, inArray, gte, lte, ne } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { resolveSetup } from '@/lib/setup-resolver';
import { computePlannedRiskAmount } from '@/lib/planned-risk';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput, TradeListMetrics } from '@/lib/trade-metrics';
import { isAccountEligibleAsDefault } from '@/lib/accounting/default-account-guard';
import { deriveWorkflowPhase, hasManagementActivity } from '@/lib/workflow-phase';
import { resolveTradeMetricsExecutions } from '@/lib/trade-correction-lifecycle';
import { resolveExecutionEquityContext } from '@/lib/execution-equity';

const createTradeSchema = z.object({
  symbol: z.string().trim().min(1, 'Symbol is required').max(20),
  direction: z.enum(['long', 'short']),
  accountId: z.string().uuid().optional(),
  setup: z.string().nullable().optional(),
  setupId: z.string().uuid().nullable().optional(),
  sectorId: z.string().nullable().optional(),
  marketConditionId: z.string().nullable().optional(),
  thesis: z.string().nullable().optional(),
  plannedEntry: z.number().nullable().optional(),
  plannedStop: z.number().nullable().optional(),
  plannedTarget1: z.number().nullable().optional(),
  plannedQuantity: z.number().nullable().optional(),

  invalidationCondition: z.string().nullable().optional(),
  preTradePlan: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50));
    const offset = (page - 1) * limit;

    type TradeStatus = 'planned' | 'open' | 'closed' | 'deleted';

    // Parse filter params
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const accountIdFilter = searchParams.get('accountId');
    const directionFilter = searchParams.get('direction');

    // Validate date params with zod if present
    if (from) {
      const parsed = z.string().datetime({ offset: true }).or(z.string().datetime()).safeParse(from);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: 'from must be a valid ISO 8601 date string' },
          { status: 400 }
        );
      }
    }
    if (to) {
      const parsed = z.string().datetime({ offset: true }).or(z.string().datetime()).safeParse(to);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: 'to must be a valid ISO 8601 date string' },
          { status: 400 }
        );
      }
    }

    // Build filters array (conditions that narrow the result set)
    const filters: SQL<unknown>[] = [];

    if (status) {
      filters.push(eq(trades.status, status as TradeStatus));
    } else {
      // D057/R027: soft-deleted (scratched) trades are excluded from the
      // unfiltered listing by default. Callers that need deleted rows must opt
      // in explicitly with ?status=deleted (Deleted tab, S03). Without this,
      // scratched rows would leak into every unfiltered view — the same leak
      // class as the watchlist soft-delete bug (MEM315). allMatchingIdsR below
      // reuses whereClause, so totals and counts stay consistent with the list.
      filters.push(ne(trades.status, 'deleted'));
    }
    // Status-aware date filtering
    // open → date filters ignored (all open positions visible regardless of date)
    // closed → filter by closedAt
    // planned → filter by createdAt
    // default (no status or other) → filter by openedAt (backward compatible)
    const dateColumn = status === 'closed'
      ? trades.closedAt
      : status === 'planned'
        ? trades.createdAt
        : trades.openedAt;

    if (status === 'open') {
      if (from || to) {
        console.warn('[trades GET] Date range filters ignored for status=open — open positions are always visible');
      }
    } else {
      if (from) {
        filters.push(gte(dateColumn, from));
      }
      if (to) {
        filters.push(lte(dateColumn, to));
      }
    }
    if (accountIdFilter) {
      filters.push(eq(trades.accountId, accountIdFilter));
    }
    if (directionFilter) {
      if (!['long', 'short'].includes(directionFilter)) {
        return NextResponse.json(
          { error: 'Validation failed', details: 'direction must be "long" or "short"' },
          { status: 400 }
        );
      }
      filters.push(eq(trades.direction, directionFilter as 'long' | 'short'));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    // Total count
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .where(whereClause)
      .get();

    const total = countResult?.count ?? 0;

    // Paginated data with setup name from lookup values
    const rows = db
      .select({
        id: trades.id,
        tradeCode: trades.tradeCode,
        accountId: trades.accountId,
        symbol: trades.symbol,
        direction: trades.direction,
        setupId: trades.setupId,
        // Prefer setupDefinitions.name (preserves original case), fall back to lookupValues.value
        setupName: sql<string | null>`COALESCE(${setupDefinitions.name}, ${lookupValues.value})`,
        sectorId: trades.sectorId,
        marketConditionId: trades.marketConditionId,
        status: trades.status,
        thesis: trades.thesis,
        plannedEntry: trades.plannedEntry,
        plannedStop: trades.plannedStop,
        plannedTarget1: trades.plannedTarget1,
        plannedQuantity: trades.plannedQuantity,

        invalidationCondition: trades.invalidationCondition,
        preTradePlan: trades.preTradePlan,
        openedAt: trades.openedAt,
        closedAt: trades.closedAt,
        currentPrice: trades.currentPrice,
        // NOTE: AVG(price) SQL subqueries removed — actualEntry and avgExitPrice
        // are now computed via computeTradeMetrics().averagePrices in the enriched rows below.
        exitNotes: trades.exitNotes,
        lesson: trades.lesson,
        reviewedAt: trades.reviewedAt,
        createdAt: trades.createdAt,
        updatedAt: trades.updatedAt,
        currentPriceFetchedAt: trades.currentPriceFetchedAt,
        // NOTE: riskPct removed from SQL — now computed via metrics.risk.riskToAccount
      })
      .from(trades)
      .leftJoin(setupDefinitions, eq(trades.setupId, setupDefinitions.id))
      .leftJoin(lookupValues, eq(trades.setupId, lookupValues.id))
      .where(whereClause)
      .orderBy(desc(trades.openedAt), desc(trades.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Batch-fetch related data for all returned trades
    const tradeIds = rows.map((r) => r.id);

    const execRows = tradeIds.length > 0
      ? db.select().from(tradeExecutions).where(inArray(tradeExecutions.tradeId, tradeIds)).all()
      : [];
    const riskRows = tradeIds.length > 0
      ? db.select().from(tradeRiskSnapshots).where(inArray(tradeRiskSnapshots.tradeId, tradeIds)).all()
      : [];
    const stopRows = tradeIds.length > 0
      ? db.select().from(tradeStopAdjustments).where(inArray(tradeStopAdjustments.tradeId, tradeIds)).orderBy(desc(tradeStopAdjustments.adjustedAt), desc(tradeStopAdjustments.createdAt), desc(tradeStopAdjustments.id)).all()
      : [];
    const targetRows = tradeIds.length > 0
      ? db.select().from(tradeTargetAdjustments).where(inArray(tradeTargetAdjustments.tradeId, tradeIds)).all()
      : [];

    // Group by trade ID
    const execMap = new Map<string, (typeof tradeExecutions.$inferSelect)[]>();
    for (const ex of execRows) {
      const list = execMap.get(ex.tradeId) ?? [];
      list.push(ex);
      execMap.set(ex.tradeId, list);
    }
    const riskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();
    for (const risk of riskRows) {
      riskMap.set(risk.tradeId, risk);
    }
    const stopMap = new Map<string, (typeof tradeStopAdjustments.$inferSelect)[]>();
    for (const stop of stopRows) {
      const list = stopMap.get(stop.tradeId) ?? [];
      list.push(stop);
      stopMap.set(stop.tradeId, list);
    }
    const targetMap = new Map<string, (typeof tradeTargetAdjustments.$inferSelect)[]>();
    for (const target of targetRows) {
      const list = targetMap.get(target.tradeId) ?? [];
      list.push(target);
      targetMap.set(target.tradeId, list);
    }

    // Batch-fetch accounts for equity cascade per account
    const uniqueAccountIds = [...new Set(rows.map((r) => r.accountId))];
    const accountRows = db
      .select()
      .from(accounts)
      .where(inArray(accounts.id, uniqueAccountIds))
      .all();
    const accountMap = new Map(accountRows.map((a) => [a.id, a]));

    // M002-A9: current account equity resolves through the SAME canonical
    // resolver execution readiness uses (current_projection → bounded
    // rollforward → reconstruction → explicit legacy compatibility →
    // unavailable). Resolved ONCE per unique account with a single request
    // timestamp (deterministic source/asOf within one response); canonical
    // zero stays zero and settings.startingAccountValue can never fabricate
    // canonical funding. No local startingBalance/startingAccountValue
    // fallback cascade remains on this surface.
    const now = new Date().toISOString();
    const sqlite = getSqliteHandle();
    const equityContextByAccount = new Map<string, ReturnType<typeof resolveExecutionEquityContext>>();
    for (const accId of uniqueAccountIds) {
      if (!accId) continue;
      equityContextByAccount.set(accId, resolveExecutionEquityContext(sqlite, accId, now));
    }

    // Batch-fetch sector lookupValues for sector name resolution
    const uniqueSectorIds: string[] = [...new Set(rows.map((r) => r.sectorId).filter((id): id is string => id !== null))];
    const sectorRows: Array<{ id: string; value: string }> = uniqueSectorIds.length > 0
      ? (getSqliteHandle()
          .prepare(`SELECT id, value FROM lookup_values WHERE id IN (${uniqueSectorIds.map(() => '?').join(',')})`)
          .all(...uniqueSectorIds) as Array<{ id: string; value: string }>)
      : [];
    const sectorMap = new Map(sectorRows.map((s) => [s.id, s.value]));

    // Batch-fetch market condition lookupValues for name resolution (same pattern as sector)
    const uniqueMarketConditionIds: string[] = [...new Set(rows.map((r) => r.marketConditionId).filter((id): id is string => id !== null))];
    const marketConditionRows: Array<{ id: string; value: string }> = uniqueMarketConditionIds.length > 0
      ? (getSqliteHandle()
          .prepare(`SELECT id, value FROM lookup_values WHERE id IN (${uniqueMarketConditionIds.map(() => '?').join(',')})`)
          .all(...uniqueMarketConditionIds) as Array<{ id: string; value: string }>)
      : [];
    const marketConditionMap = new Map(marketConditionRows.map((s) => [s.id, s.value]));

    // Compute enhanced rows with computeTradeMetrics()
    const enhancedRows = rows.map((row) => {
      const executions = execMap.get(row.id) ?? [];
      const riskSnapshot = riskMap.get(row.id) ?? null;
      const stopAdjustments = stopMap.get(row.id) ?? [];
      const targetAdjustments = targetMap.get(row.id) ?? [];

      // S05/T02: derived workflow phase — 'managed' when an open trade has
      // add/reduce executions or any stop/target adjustment. S07/T02: the
      // 'reviewed' phase is driven by the durable reviewedAt marker written by
      // POST /api/trades/[id]/review; closed trades without the marker report
      // 'closed'.
      const managementActivity = hasManagementActivity(executions, stopAdjustments, targetAdjustments);
      const workflowPhase = deriveWorkflowPhase(row.status, row.reviewedAt, managementActivity);

      // M002-A9: canonical current account equity (never a local legacy fallback).
      const account = accountMap.get(row.accountId);
      const currentAccountEquity = equityContextByAccount.get(row.accountId)?.equity ?? null;

      const metricsInput: TradeMetricsInput = {
        // S08 zero-divergence: derive metrics from the effective execution
        // set when corrections exist so list never disagrees with accounting.
        executions: resolveTradeMetricsExecutions(getSqliteHandle(), row.id, executions),
        direction: row.direction as 'long' | 'short',
        riskSnapshot: riskSnapshot
          ? {
              initialRiskAmount: riskSnapshot.initialRiskAmount,
              accountEquityAtOpen: riskSnapshot.accountEquityAtOpen,
              initialStopPrice: riskSnapshot.initialStopPrice,
              initialEntryPrice: riskSnapshot.initialEntryPrice,
            }
          : null,
        stopAdjustments: stopAdjustments
          .filter((s): s is typeof s & { newStop: number } => s.newStop != null)
          .map((s) => ({
            stopPrice: s.newStop,
            adjustedAt: s.adjustedAt ?? '',
            createdAt: s.createdAt ?? '',
            id: s.id,
          })),
        currentMark:
          row.currentPrice != null
            ? { price: row.currentPrice, markedAt: row.currentPriceFetchedAt ?? new Date().toISOString() }
            : null,
        currentAccountEquity,
      };

      const metrics = computeTradeMetrics(metricsInput);

      // Compute planned risk-to-account for planned trades
      // Planned risk = direction-aware |entry - stop| * plannedQuantity
      // (shared helper returns null for invalid stop directions) as a
      // percentage of current account equity.
      let plannedRiskToAccount: number | null = null;
      if (row.status === 'planned' && currentAccountEquity != null && currentAccountEquity > 0) {
        const plannedRiskAmount = computePlannedRiskAmount(
          row.direction,
          row.plannedEntry,
          row.plannedStop,
          row.plannedQuantity,
        );
        if (plannedRiskAmount != null) {
          plannedRiskToAccount = new Decimal(plannedRiskAmount).div(new Decimal(currentAccountEquity)).toNumber();
        }
      }

      // Strip FIFO debugging detail for the list view; full metrics remain available
      // for the trade-detail endpoint via GET /api/trades/[id]
      const { remainingLots: _remainingLots, matches: _matches, ...metricsForList } = metrics;

      // Backward-compatible flat fields + compact nested metrics
      return {
        ...row,
        accountName: account?.name ?? null,
        accountCurrency: account?.currency ?? null,
        sectorName: row.sectorId ? (sectorMap.get(row.sectorId) ?? null) : null,
        marketConditionName: row.marketConditionId ? (marketConditionMap.get(row.marketConditionId) ?? null) : null,
        realizedPnl: metrics.realizedPnl.netRealizedPnl,
        unrealizedPnl: metrics.unrealizedPnl.netUnrealizedPnl,
        returnPct: metrics.returnMetrics.returnPct,
        riskPct: metrics.risk.riskToAccount,
        plannedRiskToAccount,
        workflowPhase,
        metrics: metricsForList satisfies TradeListMetrics,
      };
    });

    // ── Server-computed totals: aggregate across the full filtered dataset, NOT just the current page ──

    // Get all matching trade IDs (no pagination) for full-dataset aggregation
    const allMatchingIdsR = db
      .select({
        id: trades.id,
        accountId: trades.accountId,
        symbol: trades.symbol,
        direction: trades.direction,
        currentPrice: trades.currentPrice,
        currentPriceFetchedAt: trades.currentPriceFetchedAt,
      })
      .from(trades)
      .where(whereClause)
      .all();

    // M013/S01: unrealized P&L aggregates are null-able. When any open position
    // (openQuantity > 0) in the filtered dataset lacks a currentPrice market mark,
    // computeTradeMetrics returns null for that position's unrealized P&L. The
    // aggregate must NOT convert that unknown to 0 — a partially-known or entirely
    // unknown aggregate is returned as null (never a complete-looking number).
    // unpricedOpenPositions provides a machine-readable count of the positions
    // blocking the aggregate (used for monitoring and footer completeness states).
    let fullTotals: {
      grossRealizedPnl: number;
      netRealizedPnl: number;
      totalFees: number;
      grossUnrealizedPnl: number | null;
      netUnrealizedPnl: number | null;
      totalOpenRisk: number;
      portfolioHeatAmount: number;
      portfolioHeatPct: number | null;
      unpricedOpenPositions: number;
    } = {
      grossRealizedPnl: 0,
      netRealizedPnl: 0,
      totalFees: 0,
      grossUnrealizedPnl: 0,
      netUnrealizedPnl: 0,
      totalOpenRisk: 0,
      portfolioHeatAmount: 0,
      portfolioHeatPct: 0,
      unpricedOpenPositions: 0,
    };

    // Open positions lacking a market mark (M013/S01): count of open positions
    // (metrics.size.openQuantity > 0) with no currentPrice mark, matching the
    // computeTradeMetrics guard for unrealized P&L (currentMark != null
    // && openAvgCost != null && openQuantity > 0). Planned/closed rows contribute
    // openQuantity 0 and can never block the aggregate.
    let unpricedOpenPositions = 0;

    if (allMatchingIdsR.length > 0) {
      const allTradeIds = allMatchingIdsR.map((r) => r.id);
      const allUniqueAccountIds = [...new Set(allMatchingIdsR.map((r) => r.accountId))];

      // Batch-fetch related data for ALL matching trades
      const allExecRows = db.select().from(tradeExecutions).where(inArray(tradeExecutions.tradeId, allTradeIds)).all();
      const allRiskRows = db.select().from(tradeRiskSnapshots).where(inArray(tradeRiskSnapshots.tradeId, allTradeIds)).all();
      const allStopRows = db.select().from(tradeStopAdjustments).where(inArray(tradeStopAdjustments.tradeId, allTradeIds)).orderBy(desc(tradeStopAdjustments.adjustedAt), desc(tradeStopAdjustments.createdAt), desc(tradeStopAdjustments.id)).all();

      const allExecMap = new Map<string, (typeof tradeExecutions.$inferSelect)[]>();
      for (const ex of allExecRows) {
        const list = allExecMap.get(ex.tradeId) ?? [];
        list.push(ex);
        allExecMap.set(ex.tradeId, list);
      }
      const allRiskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();
      for (const risk of allRiskRows) {
        allRiskMap.set(risk.tradeId, risk);
      }
      const allStopMap = new Map<string, (typeof tradeStopAdjustments.$inferSelect)[]>();
      for (const stop of allStopRows) {
        const list = allStopMap.get(stop.tradeId) ?? [];
        list.push(stop);
        allStopMap.set(stop.tradeId, list);
      }

      const allAccountRows = db
        .select()
        .from(accounts)
        .where(inArray(accounts.id, allUniqueAccountIds.filter(Boolean)))
        .all();
      const allAccountMap = new Map(allAccountRows.map((a) => [a.id, a]));

      // M002-A9: canonical current equity for the FULL dataset accounts, resolved
      // once per account with the SAME request timestamp (page-independent
      // portfolioHeat denominator). No local legacy fallback cascade.
      const allEquityContextByAccount = new Map<string, ReturnType<typeof resolveExecutionEquityContext>>();
      for (const accId of allUniqueAccountIds) {
        if (!accId) continue;
        allEquityContextByAccount.set(accId, resolveExecutionEquityContext(sqlite, accId, now));
      }

      // Track unique account equities for portfolioHeat denominator
      // (one equity per account to avoid double-counting) and per-account OPEN
      // RISK (M002-A9: an account contributing open risk whose canonical
      // equity is unavailable/zero must make the percentage unavailable).
      // Monetary values are held as Decimal.js throughout the aggregation
      // (P2 hardening).
      const totalEquityByAccount = new Map<string, Decimal>();
      const openRiskByAccount = new Map<string, Decimal>();

      // Decimal.js accumulators — no plain floating-point reduction of monetary
      // aggregates anywhere in the totals pipeline.
      const decTotals = {
        grossRealizedPnl: new Decimal(0),
        netRealizedPnl: new Decimal(0),
        totalFees: new Decimal(0),
        grossUnrealizedPnl: new Decimal(0),
        netUnrealizedPnl: new Decimal(0),
        totalOpenRisk: new Decimal(0),
      };
      // Compute metrics for every matching trade and aggregate
      for (const row of allMatchingIdsR) {
        const executions = allExecMap.get(row.id) ?? [];
        const riskSnapshot = allRiskMap.get(row.id) ?? null;
        const stopAdjustments = allStopMap.get(row.id) ?? [];
        const account = allAccountMap.get(row.accountId);
        const currentAccountEquity = allEquityContextByAccount.get(row.accountId)?.equity ?? null;

        const metricsInput: TradeMetricsInput = {
          // S08 zero-divergence: derive metrics from the effective execution
          // set when corrections exist so list totals never disagree with
          // accounting.
          executions: resolveTradeMetricsExecutions(getSqliteHandle(), row.id, executions),
          direction: row.direction as 'long' | 'short',
          riskSnapshot: riskSnapshot
            ? {
                initialRiskAmount: riskSnapshot.initialRiskAmount,
                accountEquityAtOpen: riskSnapshot.accountEquityAtOpen,
                initialStopPrice: riskSnapshot.initialStopPrice,
                initialEntryPrice: riskSnapshot.initialEntryPrice,
              }
            : null,
          stopAdjustments: stopAdjustments
            .filter((s): s is typeof s & { newStop: number } => s.newStop != null)
            .map((s) => ({
              stopPrice: s.newStop,
              adjustedAt: s.adjustedAt ?? '',
              createdAt: s.createdAt ?? '',
              id: s.id,
            })),
          currentMark:
            row.currentPrice != null
              ? { price: row.currentPrice, markedAt: row.currentPriceFetchedAt ?? new Date().toISOString() }
              : null,
          currentAccountEquity,
        };

        const metrics = computeTradeMetrics(metricsInput);

        // M013/S01: count open positions without a market mark so the aggregate
        // unrealized P&L is reported null when any position is unpriced.
        if (metrics.size.openQuantity > 0 && row.currentPrice == null) {
          unpricedOpenPositions += 1;
        }

        // Track unique per-account equity for portfolioHeat denominator
        if (currentAccountEquity != null && !totalEquityByAccount.has(row.accountId)) {
          totalEquityByAccount.set(row.accountId, new Decimal(currentAccountEquity));
        }

        const gRP = new Decimal(metrics.realizedPnl.grossRealizedPnl ?? 0);
        const nRP = new Decimal(metrics.realizedPnl.netRealizedPnl ?? 0);
        const tF = new Decimal(metrics.fees.totalFees ?? 0);
        const gUP = new Decimal(metrics.unrealizedPnl.grossUnrealizedPnl ?? 0);
        const nUP = new Decimal(metrics.unrealizedPnl.netUnrealizedPnl ?? 0);
        const oR = new Decimal(metrics.risk.openRisk ?? 0);
        openRiskByAccount.set(
          row.accountId,
          (openRiskByAccount.get(row.accountId) ?? new Decimal(0)).plus(oR),
        );

        decTotals.grossRealizedPnl = decTotals.grossRealizedPnl.plus(gRP);
        decTotals.netRealizedPnl = decTotals.netRealizedPnl.plus(nRP);
        decTotals.totalFees = decTotals.totalFees.plus(tF);
        decTotals.grossUnrealizedPnl = decTotals.grossUnrealizedPnl.plus(gUP);
        decTotals.netUnrealizedPnl = decTotals.netUnrealizedPnl.plus(nUP);
        decTotals.totalOpenRisk = decTotals.totalOpenRisk.plus(oR);
      }

      // Top-level portfolioHeat — single authoritative value for the open tab footer.
      // portfolioHeatAmount = sum of open risk across all currencies (== totalOpenRisk).
      // portfolioHeatPct = decimal fraction of total account equity (0.0125 = 1.25%),
      // following the M010 decimal-fraction contract (displayed via ×100 formatting).
      // The denominator sums one equity per account (unique, not per trade) to avoid
      // double-counting when multiple open positions share an account.
      const totalEquityAcrossAccounts = [...totalEquityByAccount.values()].reduce((s, v) => s.plus(v), new Decimal(0));
      // M013/S01: any unpriced open position makes the aggregate unrealized P&L
      // unknown — report null (never a partial sum or 0).
      const unrealizedUnknown = unpricedOpenPositions > 0;
      // M002-A9: portfolio-heat % requires a usable canonical equity denominator
      // for EVERY account contributing open risk. If a risk-bearing account's
      // canonical equity is unavailable (null) or zero, the percentage is
      // unavailable (never a partial denominator or a misleading 0% — 0% would
      // imply no risk). The absolute amount stays available. Accounts with no
      // open risk never poison the percentage.
      let portfolioHeatPct: number | null = 0;
      if (decTotals.totalOpenRisk.gt(0)) {
        const unusableDenominator = [...openRiskByAccount.entries()].some(([accId, risk]) => {
          if (risk.lte(0)) return false;
          const eq = allEquityContextByAccount.get(accId)?.equity ?? null;
          return eq == null || eq <= 0;
        });
        if (unusableDenominator) {
          portfolioHeatPct = null;
        } else {
          portfolioHeatPct = totalEquityAcrossAccounts.gt(0)
            ? decTotals.totalOpenRisk.div(totalEquityAcrossAccounts).toNumber()
            : null;
        }
      }
      fullTotals = {
        grossRealizedPnl: decTotals.grossRealizedPnl.toNumber(),
        netRealizedPnl: decTotals.netRealizedPnl.toNumber(),
        totalFees: decTotals.totalFees.toNumber(),
        grossUnrealizedPnl: unrealizedUnknown ? null : decTotals.grossUnrealizedPnl.toNumber(),
        netUnrealizedPnl: unrealizedUnknown ? null : decTotals.netUnrealizedPnl.toNumber(),
        totalOpenRisk: decTotals.totalOpenRisk.toNumber(),
        portfolioHeatAmount: decTotals.totalOpenRisk.toNumber(),
        portfolioHeatPct,
        unpricedOpenPositions,
      };
    }

    // ── plannedTotals: aggregate risk/capital across all planned trades ──
    // Respects accountId and direction filters. When status=planned (Planned tab
    // active), also applies the from/to date filters against createdAt so the
    // footer plannedTotals.count matches the filtered tab count. When status is
    // NOT planned (open/closed tabs), plannedTotals keeps the full pipeline view
    // — date filters must not leak into it.
    const plannedFilters: SQL<unknown>[] = [eq(trades.status, 'planned')];
    if (accountIdFilter) {
      plannedFilters.push(eq(trades.accountId, accountIdFilter));
    }
    if (directionFilter) {
      plannedFilters.push(eq(trades.direction, directionFilter as 'long' | 'short'));
    }
    if (status === 'planned') {
      if (from) {
        plannedFilters.push(gte(trades.createdAt, from));
      }
      if (to) {
        plannedFilters.push(lte(trades.createdAt, to));
      }
    }
    const plannedWhere = plannedFilters.length > 0 ? and(...plannedFilters) : undefined;

    const plannedRows = db
      .select({
        direction: trades.direction,
        plannedEntry: trades.plannedEntry,
        plannedStop: trades.plannedStop,
        plannedQuantity: trades.plannedQuantity,
      })
      .from(trades)
      .where(plannedWhere)
      .all();

    const plannedTotals = {
      totalPlannedRisk: plannedRows.reduce((sum, r) => {
        const risk = computePlannedRiskAmount(r.direction, r.plannedEntry, r.plannedStop, r.plannedQuantity);
        if (risk != null) {
          return sum.plus(new Decimal(risk));
        }
        return sum;
      }, new Decimal(0)).toNumber(),
      totalPlannedCapital: plannedRows.reduce((sum, r) => {
        if (r.plannedEntry != null && r.plannedQuantity != null && r.plannedQuantity > 0) {
          return sum.plus(new Decimal(r.plannedEntry).mul(new Decimal(r.plannedQuantity)));
        }
        return sum;
      }, new Decimal(0)).toNumber(),
      count: plannedRows.length,
    };

    return NextResponse.json({
      data: enhancedRows,
      total,
      page,
      limit,
      totals: fullTotals,
      plannedTotals,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch trades', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createTradeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // R025: reject wrong-side planned stops before any insert. When both
    // plannedEntry and plannedStop are supplied, computePlannedRiskAmount is the
    // canonical direction-aware validity check (R021): it returns null when the
    // stop sits on the wrong side of the entry (long stop >= entry, short stop
    // <= entry). Null/partial field combinations (only entry, only stop, neither)
    // skip this check entirely and are unaffected.
    if (parsed.data.plannedEntry != null && parsed.data.plannedStop != null) {
      const risk = computePlannedRiskAmount(
        parsed.data.direction,
        parsed.data.plannedEntry,
        parsed.data.plannedStop,
        1,
      );
      if (risk == null) {
        const stopMsg =
          parsed.data.direction === 'long'
            ? 'Planned stop must be below the planned entry for a long trade.'
            : 'Planned stop must be above the planned entry for a short trade.';
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: {
              fieldErrors: { plannedStop: [stopMsg] },
              formErrors: [],
            },
          },
          { status: 400 },
        );
      }
    }

    // M002-A10: explicit account selection is authoritative. When the request
    // supplies accountId, the server uses EXACTLY that account or rejects the
    // request — the automatic default/ready-active/first-active fallback chain
    // below runs ONLY when accountId was omitted (presence semantics, never
    // truthiness; accountId is already UUID-validated by Zod). A missing
    // explicit account is a 404 (ACCOUNT_NOT_FOUND) and never substitutes
    // another account; an existing but planning-ineligible account is a 409
    // (ACCOUNT_NOT_ELIGIBLE_FOR_PLANNING) by the shared eligibility check
    // below — the user-selected account is reported, never silently replaced.
    let accountId: string | undefined;

    if (parsed.data.accountId !== undefined) {
      const provided = db
        .select()
        .from(accounts)
        .where(eq(accounts.id, parsed.data.accountId))
        .get();
      if (!provided) {
        return NextResponse.json(
          {
            error: 'Account not found',
            code: 'ACCOUNT_NOT_FOUND',
            details: 'The explicitly selected account does not exist.',
          },
          { status: 404 },
        );
      }
      accountId = provided.id;
    } else {
      // Automatic mode (unchanged — deferred to a separate audit): the saved
      // default / ready-active / first-active chain below may run only when
      // accountId was omitted.
      const setting = db.select().from(settings).get();
      if (setting?.defaultAccountId) {
        // A8: a saved default is usable only when it references an existing
        // ACTIVE supported-currency account. A stale historical default
        // (missing / draft / deactivated / legacy non-USD) is ignored and
        // falls through to the eligible-account chain below — it must not
        // poison automatic resolution or 409 the readiness guard. Settings
        // are NOT mutated during resolution.
        const sqlite = getSqliteHandle();
        if (isAccountEligibleAsDefault(sqlite, setting.defaultAccountId)) {
          accountId = setting.defaultAccountId;
        }
      }
      if (!accountId) {
        // M002-A11: automatic PLANNING resolution considers only planning
        // eligibility (active + USD) and saved user preference — never
        // execution readiness. The previous ready-active ranking step
        // (max_risk_per_trade_pct / default_commission / opening_balance /
        // deposit) is REMOVED: whether the chosen plan can later execute is
        // the first-fill boundary's decision (checkExecutionReadiness /
        // executeTradeFill), and effective risk/commission resolve through
        // the M002-A1 cascade there. A plan-only account (no risk config,
        // no commission, no funding) is a valid planning target.
        const firstActive = db
          .select()
          .from(accounts)
          .where(and(eq(accounts.isActive, true), eq(accounts.currency, 'USD')))
          .orderBy(asc(accounts.createdAt))
          .limit(1)
          .get();
        accountId = firstActive?.id;
      }
    }

    if (!accountId) {
      return NextResponse.json(
        { error: 'No active account found. Create an account first or set a default account in settings.' },
        { status: 400 }
      );
    }

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    // T02/S02: planning-eligibility is deliberately distinct from
    // trading-readiness. Creating a planned trade requires only an existing,
    // active, USD account — risk parameters (maxRiskPerTradePct), default
    // commission, and posted opening cash are execution-time requirements
    // enforced by the execution readiness gate (T04), NOT planning
    // requirements. A user can build a complete plan before the account is
    // configured for execution. The trading-ready predicate is preserved as
    // an exported function (isAccountTradingReady in
    // src/lib/accounting/default-account-guard.ts) for execution-time use.
    // M002-A1: execution readiness resolves effective risk/commission through
    // account override → global default → unavailable (see
    // src/lib/execution-config.ts).
    if (!account || !account.isActive || account.currency !== 'USD') {
      return NextResponse.json(
        {
          error: 'Account not eligible for planning',
          details:
            'Planning requires an active USD account. Trading additionally requires effective risk parameters, a default commission, and posted opening cash.',
        },
        { status: 409 },
      );
    }

    const preTradePlanValue = parsed.data.preTradePlan ?? null;

    // Use setupId directly if provided, otherwise resolve setup name to UUID
    let resolvedSetupId: string | null = parsed.data.setupId ?? null;
    if (!resolvedSetupId && parsed.data.setup) {
      const resolved = resolveSetup(parsed.data.setup);
      if (resolved) {
        resolvedSetupId = resolved.id;
      }
    }

    // Retry loop: trade_code generation uses MAX(trade_code) which can race
    // under concurrent inserts. Retry up to 3 times on UNIQUE constraint.
    const MAX_RETRIES = 3;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const row = db.transaction(() => {
          // Generate tradeCode: T-XXXX
          // Use MAX(trade_code) to find the highest existing code, handling gaps from
          // stale data, deletions, or re-used test databases.
          const maxResult = db
            .select({ max: sql<string | null>`MAX(trade_code)` })
            .from(trades)
            .get();

          let nextNumber = 1;
          if (maxResult?.max) {
            const match = maxResult.max.match(/T-(\d+)/);
            if (match) {
              nextNumber = parseInt(match[1], 10) + 1;
            }
          }
          const tradeCode = `T-${String(nextNumber).padStart(4, '0')}`;

          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          db.insert(trades)
            .values({
              id,
              tradeCode,
              accountId,
              symbol: parsed.data.symbol,
              direction: parsed.data.direction,
              setupId: resolvedSetupId,
              sectorId: parsed.data.sectorId ?? null,
              marketConditionId: parsed.data.marketConditionId ?? null,
              status: 'planned',
              thesis: parsed.data.thesis ?? null,
              plannedEntry: parsed.data.plannedEntry ?? null,
              plannedStop: parsed.data.plannedStop ?? null,
              plannedTarget1: parsed.data.plannedTarget1 ?? null,
              plannedQuantity: parsed.data.plannedQuantity ?? null,
              invalidationCondition: parsed.data.invalidationCondition ?? null,
              preTradePlan: preTradePlanValue,
              createdAt: now,
              updatedAt: now,
            })
            .run();

          return db
            .select()
            .from(trades)
            .where(eq(trades.id, id))
            .get()!;
        });

        return NextResponse.json(row, { status: 201 });
      } catch (error) {
        lastError = error;
        // Only retry on UNIQUE constraint violation (concurrent trade_code collision)
        if (
          error instanceof Error &&
          error.message.includes('UNIQUE constraint failed: trades.trade_code')
        ) {
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create trade', details: String(error) },
      { status: 500 }
    );
  }
}
