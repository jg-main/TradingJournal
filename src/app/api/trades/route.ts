import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, settings, accounts, lookupValues, setupDefinitions, tradeRiskSnapshots, tradeExecutions, tradeStopAdjustments, accountRollforward, accountPerformance } from '@/db/schema';
import { eq, and, asc, desc, sql, inArray, gte, lte, ne } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { resolveSetup } from '@/lib/setup-resolver';
import { computePlannedRiskAmount } from '@/lib/planned-risk';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput, TradeListMetrics } from '@/lib/trade-metrics';

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

    // Batch-fetch accounts for equity cascade per account
    const uniqueAccountIds = [...new Set(rows.map((r) => r.accountId))];
    const accountRows = db
      .select()
      .from(accounts)
      .where(inArray(accounts.id, uniqueAccountIds))
      .all();
    const accountMap = new Map(accountRows.map((a) => [a.id, a]));

    // Batch-fetch latest account_rollforward per unique account — endingEquity is
    // used as the secondary source for current account equity (after account_performance.nav).
    const latestRollforwardMap = new Map<string, typeof accountRollforward.$inferSelect>();
    for (const accId of uniqueAccountIds) {
      if (!accId) continue;
      const rf = db
        .select()
        .from(accountRollforward)
        .where(eq(accountRollforward.accountId, accId))
        .orderBy(desc(accountRollforward.date))
        .limit(1)
        .get();
      if (rf) {
        latestRollforwardMap.set(accId, rf);
      }
    }

    // Batch-fetch account_performance.nav per unique account — primary equity source
    // (more accurate than rollforward as it includes marked-to-market positions).
    const accountPerfMap = new Map<string, string>();
    for (const accId of uniqueAccountIds) {
      if (!accId) continue;
      const perf = db
        .select({ nav: accountPerformance.nav })
        .from(accountPerformance)
        .where(eq(accountPerformance.accountId, accId))
        .get();
      if (perf && perf.nav) {
        accountPerfMap.set(accId, perf.nav);
      }
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

    // Single settings row for equity fallback
    const settingsRow = db
      .select()
      .from(settings)
      .where(eq(settings.id, 'default'))
      .get();

    // Compute enhanced rows with computeTradeMetrics()
    const enhancedRows = rows.map((row) => {
      const executions = execMap.get(row.id) ?? [];
      const riskSnapshot = riskMap.get(row.id) ?? null;
      const stopAdjustments = stopMap.get(row.id) ?? [];

      // Account equity cascade: account_performance.nav → rollforward.endingEquity → account.startingBalance → settings.startingAccountValue → null
      const account = accountMap.get(row.accountId);
      const latestRollforward = latestRollforwardMap.get(row.accountId);
      const navRaw = accountPerfMap.get(row.accountId);
      const navValue = navRaw ? parseFloat(navRaw) : null;
      const currentAccountEquity =
        navValue ??
        latestRollforward?.endingEquity ??
        account?.startingBalance ??
        settingsRow?.startingAccountValue ??
        null;

      const metricsInput: TradeMetricsInput = {
        executions: executions.map((e) => ({
          id: e.id,
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees,
          executedAt: e.executedAt ?? '',
        })),
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
      portfolioHeatPct: number;
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

      // Batch-fetch latest rollforward per account for totals computation
      const allLatestRollforwardMap = new Map<string, typeof accountRollforward.$inferSelect>();
      for (const accId of allUniqueAccountIds) {
        if (!accId) continue;
        const rf = db
          .select()
          .from(accountRollforward)
          .where(eq(accountRollforward.accountId, accId))
          .orderBy(desc(accountRollforward.date))
          .limit(1)
          .get();
        if (rf) {
          allLatestRollforwardMap.set(accId, rf);
        }
      }

      // Batch-fetch account_performance.nav for ALL full-dataset accounts — primary
      // equity source for the totals denominator. Keyed by the FULL dataset (not the
      // paginated page) so totals.portfolioHeatPct stays identical across pagination
      // pages when a multi-account dataset spans accounts that don't all appear on
      // the requested page.
      const allAccountIdsFiltered = allUniqueAccountIds.filter(Boolean);
      const allPerfRows = allAccountIdsFiltered.length > 0
        ? db
            .select({ accountId: accountPerformance.accountId, nav: accountPerformance.nav })
            .from(accountPerformance)
            .where(inArray(accountPerformance.accountId, allAccountIdsFiltered))
            .all()
        : [];
      const allAccountPerfMap = new Map<string, string>();
      for (const perf of allPerfRows) {
        if (perf.nav) {
          allAccountPerfMap.set(perf.accountId, perf.nav);
        }
      }

      // Track unique account equities for portfolioHeat denominator
      // (one equity per account to avoid double-counting). Monetary values are
      // held as Decimal.js throughout the aggregation (P2 hardening).
      const totalEquityByAccount = new Map<string, Decimal>();

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
        const latestRollforward = allLatestRollforwardMap.get(row.accountId);
        const navRaw = allAccountPerfMap.get(row.accountId);
        const navValue = navRaw ? parseFloat(navRaw) : null;
        const currentAccountEquity =
          navValue ??
          latestRollforward?.endingEquity ??
          account?.startingBalance ??
          settingsRow?.startingAccountValue ??
          null;

        const metricsInput: TradeMetricsInput = {
          executions: executions.map((e) => ({
            id: e.id,
            action: e.action,
            quantity: e.quantity,
            price: e.price,
            fees: e.fees,
            executedAt: e.executedAt ?? '',
          })),
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
      fullTotals = {
        grossRealizedPnl: decTotals.grossRealizedPnl.toNumber(),
        netRealizedPnl: decTotals.netRealizedPnl.toNumber(),
        totalFees: decTotals.totalFees.toNumber(),
        grossUnrealizedPnl: unrealizedUnknown ? null : decTotals.grossUnrealizedPnl.toNumber(),
        netUnrealizedPnl: unrealizedUnknown ? null : decTotals.netUnrealizedPnl.toNumber(),
        totalOpenRisk: decTotals.totalOpenRisk.toNumber(),
        portfolioHeatAmount: decTotals.totalOpenRisk.toNumber(),
        portfolioHeatPct:
          totalEquityAcrossAccounts.gt(0) && decTotals.totalOpenRisk.gt(0)
            ? decTotals.totalOpenRisk.div(totalEquityAcrossAccounts).toNumber()
            : 0,
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

    // Resolve account: body.accountId overrides the default chain
    let accountId: string | undefined;

    if (parsed.data.accountId) {
      const provided = db
        .select()
        .from(accounts)
        .where(eq(accounts.id, parsed.data.accountId))
        .get();
      if (provided) {
        accountId = provided.id;
      }
    }

    if (!accountId) {
      const setting = db.select().from(settings).get();
      if (setting?.defaultAccountId) {
        accountId = setting.defaultAccountId;
      } else {
        // S06/T04: when no default is configured, prefer the first active
        // account that is ALSO trading-ready (risk params + commission +
        // opening cash posted). Shared databases can contain active accounts
        // that were never prepared for trading — resolving the raw first
        // active account would 409 the readiness guard below even when
        // trading-ready accounts exist. Fall through to the first active
        // account only when none are ready, so the actionable 409 guidance is
        // preserved for the genuinely-unprepared case. Ordering matches the
        // dashboard v2 first-active contract (ORDER BY created_at ASC).
        const readyActive = getSqliteHandle()
          .prepare(
            `SELECT a.id FROM accounts a
             WHERE a.is_active = 1
               AND a.max_risk_per_trade_pct IS NOT NULL
               AND a.default_commission IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM financial_events fe
                 WHERE fe.account_id = a.id
                   AND fe.event_type IN ('opening_balance', 'deposit')
               )
             ORDER BY a.created_at ASC
             LIMIT 1`,
          )
          .get() as { id: string } | undefined;
        accountId = readyActive?.id;
        if (!accountId) {
          const firstActive = db
            .select()
            .from(accounts)
            .where(eq(accounts.isActive, true))
            .orderBy(asc(accounts.createdAt))
            .limit(1)
            .get();
          accountId = firstActive?.id;
        }
      }
    }

    if (!accountId) {
      return NextResponse.json(
        { error: 'No active account found. Create an account first or set a default account in settings.' },
        { status: 400 }
      );
    }

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    const hasOpeningCash = getSqliteHandle()
      .prepare(`SELECT EXISTS(SELECT 1 FROM financial_events WHERE account_id = ? AND event_type IN ('opening_balance', 'deposit')) AS has_cash`)
      .get(accountId) as { has_cash: number };
    if (!account?.isActive || account.maxRiskPerTradePct === null || account.defaultCommission === null || !hasOpeningCash.has_cash) {
      return NextResponse.json(
        { error: 'Account setup incomplete', details: 'Set risk parameters, post opening cash, then activate the account before trading.' },
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
