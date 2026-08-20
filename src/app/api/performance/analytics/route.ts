/**
 * /api/performance/analytics route handler
 *
 * GET /api/performance/analytics?accountIds=xxx,yyy&dateFrom=2024-01-01&dateTo=2024-12-31&...
 *
 * Returns consolidated performance analytics for the /performance dashboard.
 * Supports multi-account scope, close-date filtering, and advanced filters.
 * Reuses canonical computation kernels (computeTradeMetrics, computeKpiMetrics,
 * computeDrawdown, computeSetupPerformance, etc.).
 *
 * Pattern: mirrors /api/dashboard but with multi-account and advanced filter support.
 *
 * Filter semantics (locked by the S01 contract):
 * - Multi-account scope: `accountScope=all` (default) selects every account;
 *   `single`/`multiple` select the comma-separated `accountIds`. Mixed currencies
 *   surface a `mixedCurrencies` warning flag — no implicit FX is applied.
 * - Close-date attribution: realized metrics attribute trades to the selected
 *   period by CLOSE DATE only (never entry date), using the same
 *   `closedAt.slice(0, 10)` string comparison as /api/dashboard.
 * - Advanced filters: `setupIds`, `directions`, `symbols` filter at the trade
 *   level; `tradeResults` (win/loss/scratch) is derived per trade from net
 *   realized P&L via classifyPnlDecision (includeZeroAsLoss).
 * - D057/R027: soft-deleted (scratched) trades are excluded from every
 *   aggregation, matching /api/dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  trades,
  tradeExecutions,
  tradeGrades,
  tradeRiskSnapshots,
  accountRollforward,
  accounts,
} from '@/db/schema';
import { eq, inArray, and, ne } from 'drizzle-orm';
import { type ExecutionData, computeTradeMetrics } from '@/lib/trade-metrics';
import {
  computeKpiMetrics,
  computeMonthlyPerformance,
  computeRDistribution,
  computeDirectionalPerformance,
  type KpiTradeInput,
  type RollforwardRow,
} from '@/lib/dashboard';
import { computeEquityCurve, computeDrawdown } from '@/lib/equity';
import { computeSetupPerformance, type SetupPerfTradeInput } from '@/lib/review-dashboard';
import {
  computeGrossPnl,
  computeMedianR,
  computeDayWinRate,
  computeMaxDrawdown,
  computeDailyNetPnl,
  computeCumulativeDailyPnl,
  computeTradeDurationPerformance,
  computePerformanceByDayOfWeek,
  computePerformanceByTimeOfDay,
  computeTradeMetricsCache,
  type PerformanceTradeInput,
} from '@/lib/performance-analytics';
import { classifyPnlDecision } from '@/lib/metrics';

/**
 * Chunk an array of IDs into batches of CHUNK_SIZE and run a query for each chunk.
 * Avoids the SQLite parameter limit (999) for large account/trade id sets.
 */
function batchInArray<T>(ids: string[], queryFn: (chunk: string[]) => T[], chunkSize = 999): T[] {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    results.push(...queryFn(ids.slice(i, i + chunkSize)));
  }
  return results;
}

/** Map a DB execution row to the canonical ExecutionData shape (as /api/dashboard does). */
function toExecutionData(ex: {
  action: string;
  quantity: number;
  price: number;
  fees: number | null;
  executedAt: string | null;
}): ExecutionData {
  return {
    action: ex.action,
    quantity: ex.quantity,
    price: ex.price,
    fees: ex.fees ?? null,
    executedAt: ex.executedAt ?? '',
  };
}

/**
 * Aggregate per-account account_rollforward rows into a single portfolio series.
 *
 * Multi-account rollforward tables share the same calendar dates; concatenating
 * them produces duplicate x-values that would corrupt computeEquityCurve /
 * computeDrawdown. This helper sums endingEquity and cumulativePnl per date and
 * derives highWaterMark, drawdownAmount and drawdownPct from the combined series
 * (peak-to-trough against the running high-water mark).
 *
 * Single-account input (one row per date) passes through unchanged, preserving
 * stored drawdown values and exact parity with /api/dashboard.
 *
 * Input must be sorted by date ASC. There is no implicit FX — the route's
 * `mixedCurrencies` flag warns when currencies differ across accounts.
 */
function aggregateRollforwardByDate(rows: RollforwardRow[]): RollforwardRow[] {
  // Group per date, summing equity and cumulative P&L across accounts.
  const byDate = new Map<string, { endingEquity: number; cumulativePnl: number }>();
  for (const row of rows) {
    if (row.endingEquity === null) continue;
    const agg = byDate.get(row.date) ?? { endingEquity: 0, cumulativePnl: 0 };
    agg.endingEquity += row.endingEquity;
    agg.cumulativePnl += row.cumulativePnl ?? 0;
    byDate.set(row.date, agg);
  }

  const dates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
  const result: RollforwardRow[] = [];
  let highWaterMark = 0;

  for (const date of dates) {
    const agg = byDate.get(date)!;
    highWaterMark = Math.max(highWaterMark, agg.endingEquity);
    const drawdownAmount = highWaterMark > 0 ? highWaterMark - agg.endingEquity : 0;
    result.push({
      date,
      endingEquity: agg.endingEquity,
      cumulativePnl: agg.cumulativePnl,
      drawdownAmount,
      drawdownPct: highWaterMark > 0 ? drawdownAmount / highWaterMark : null,
      highWaterMark,
    });
  }

  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // ── Parse query parameters ──────────────────────────────────────────
    const accountIdsParam = searchParams.get('accountIds');
    const accountScopeMode = searchParams.get('accountScope') || 'all'; // 'all' | 'single' | 'multiple'
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const setupIdsParam = searchParams.get('setupIds');
    const directionsParam = searchParams.get('directions');
    const symbolsParam = searchParams.get('symbols');
    const tradeResultsParam = searchParams.get('tradeResults');

    // ── Validate date parameters ────────────────────────────────────────
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      return NextResponse.json(
        { error: 'Invalid dateFrom parameter', details: { fieldErrors: { dateFrom: ['Invalid date format. Use ISO date (YYYY-MM-DD).'] } } },
        { status: 400 },
      );
    }
    if (dateTo && isNaN(Date.parse(dateTo))) {
      return NextResponse.json(
        { error: 'Invalid dateTo parameter', details: { fieldErrors: { dateTo: ['Invalid date format. Use ISO date (YYYY-MM-DD).'] } } },
        { status: 400 },
      );
    }

    // ── Resolve account scope ───────────────────────────────────────────
    let accountIds: string[] = [];
    if (accountScopeMode === 'all') {
      const allAccounts = db.select().from(accounts).all();
      accountIds = allAccounts.map((a) => a.id);
    } else if (accountIdsParam) {
      accountIds = accountIdsParam.split(',').filter(Boolean);
    }

    if (accountIds.length === 0) {
      return NextResponse.json(
        { error: 'No accounts found', details: { message: 'No accounts available for analytics' } },
        { status: 400 },
      );
    }

    // ── Batch account lookup: currency consistency + starting balances ──
    const accountRows = batchInArray(accountIds, (ids) =>
      db.select().from(accounts).where(inArray(accounts.id, ids)).all(),
    );
    const accountCurrencies = new Set(accountRows.map((a) => a.currency || 'USD'));
    const mixedCurrencies = accountCurrencies.size > 1;
    const startingAccountValue = accountRows.reduce((sum, a) => sum + (a.startingBalance ?? 0), 0);

    // ── Fetch trades ────────────────────────────────────────────────────
    // D057/R027: soft-deleted (scratched) trades are excluded from every
    // unfiltered aggregation — they must only surface in the Deleted tab
    // (?status=deleted). Matches /api/dashboard.
    // Date conditions are deliberately NOT applied here: open trades have a
    // NULL closedAt and would be dropped by a closedAt >= / <= predicate,
    // corrupting totalTrades/openTrades counts. Close-date attribution is
    // applied in JS to closed trades only (see below).
    const conditions = [
      inArray(trades.accountId, accountIds),
      ne(trades.status, 'deleted'),
    ];

    // Advanced filters (apply to the full trade set, open and closed alike)
    if (setupIdsParam) {
      const setupIds = setupIdsParam.split(',').filter(Boolean);
      if (setupIds.length > 0) {
        conditions.push(inArray(trades.setupId, setupIds));
      }
    }
    if (directionsParam) {
      const directions = directionsParam.split(',').filter(Boolean) as Array<'long' | 'short'>;
      if (directions.length > 0) {
        conditions.push(inArray(trades.direction, directions));
      }
    }
    if (symbolsParam) {
      const symbols = symbolsParam.split(',').filter(Boolean);
      if (symbols.length > 0) {
        conditions.push(inArray(trades.symbol, symbols));
      }
    }

    const allTrades = db
      .select()
      .from(trades)
      .where(and(...conditions))
      .all();

    const allTradeIds = allTrades.map((t) => t.id);

    // ── Close-date attribution ──────────────────────────────────────────
    // Realized metrics attribute trades to the selected period by CLOSE DATE
    // (never entry date), via the same closedAt.slice(0, 10) string comparison
    // as /api/dashboard. ISO dates sort correctly as strings.
    const closedTrades = allTrades.filter((t) => t.status === 'closed');
    const dateFilteredClosedTrades =
      dateFrom || dateTo
        ? closedTrades.filter((t) => {
            if (!t.closedAt) return false;
            const closedDate = t.closedAt.slice(0, 10);
            if (dateFrom && closedDate < dateFrom) return false;
            if (dateTo && closedDate > dateTo) return false;
            return true;
          })
        : closedTrades;

    // ── Batch-fetch related data for ALL trades (single pass, no N+1) ──
    // Mirrors the /api/dashboard map pattern. Fetching before the tradeResults
    // filter keeps the filter in-memory instead of running per-trade queries.
    const executionsByTrade = new Map<string, ExecutionData[]>();
    const gradesByTrade = new Map<string, { totalScore: number | null }>();
    const riskSnapshotsByTrade = new Map<string, { initialRiskAmount: number | null }>();

    if (allTradeIds.length > 0) {
      const execs = batchInArray(allTradeIds, (chunk) =>
        db.select().from(tradeExecutions).where(inArray(tradeExecutions.tradeId, chunk)).all(),
      );
      for (const exec of execs) {
        const list = executionsByTrade.get(exec.tradeId) ?? [];
        list.push(toExecutionData(exec));
        executionsByTrade.set(exec.tradeId, list);
      }

      const gradeRows = batchInArray(allTradeIds, (chunk) =>
        db.select().from(tradeGrades).where(inArray(tradeGrades.tradeId, chunk)).all(),
      );
      for (const grade of gradeRows) {
        gradesByTrade.set(grade.tradeId, { totalScore: grade.totalScore ?? null });
      }

      const snapshots = batchInArray(allTradeIds, (chunk) =>
        db.select().from(tradeRiskSnapshots).where(inArray(tradeRiskSnapshots.tradeId, chunk)).all(),
      );
      for (const snap of snapshots) {
        riskSnapshotsByTrade.set(snap.tradeId, { initialRiskAmount: snap.initialRiskAmount ?? null });
      }
    }

    /** Compute realized trade metrics from the in-memory maps. */
    function metricsForTradeRow(trade: (typeof allTrades)[number]) {
      const snapshot = riskSnapshotsByTrade.get(trade.id);
      return computeTradeMetrics({
        executions: executionsByTrade.get(trade.id) ?? [],
        direction: trade.direction,
        riskSnapshot: snapshot
          ? { initialRiskAmount: snapshot.initialRiskAmount, accountEquityAtOpen: null }
          : null,
        stopAdjustments: [],
        currentMark: null,
        currentAccountEquity: null,
      });
    }

    // ── Trade-result advanced filter (derived from realized P&L) ───────
    let filteredClosedTrades = dateFilteredClosedTrades;
    if (tradeResultsParam) {
      const tradeResults = tradeResultsParam.split(',').filter(Boolean) as Array<'win' | 'loss' | 'scratch'>;
      if (tradeResults.length > 0) {
        filteredClosedTrades = dateFilteredClosedTrades.filter((trade) => {
          const pnl = metricsForTradeRow(trade).realizedPnl.netRealizedPnl;
          return tradeResults.includes(classifyPnlDecision(pnl, 'includeZeroAsLoss'));
        });
      }
    }

    // ── Build typed computation inputs ──────────────────────────────────
    function toKpiTradeInput(trade: (typeof allTrades)[number]): KpiTradeInput {
      const grade = gradesByTrade.get(trade.id);
      const totalScore = grade?.totalScore;
      return {
        id: trade.id,
        direction: trade.direction,
        status: trade.status,
        executions: executionsByTrade.get(trade.id) ?? [],
        grade: totalScore != null ? { totalScore } : null,
        riskSnapshot: riskSnapshotsByTrade.get(trade.id) ?? null,
        closedAt: trade.closedAt ?? null,
      };
    }

    const kpiTrades: KpiTradeInput[] = filteredClosedTrades.map(toKpiTradeInput);
    const allTradesKpi: KpiTradeInput[] = allTrades.map(toKpiTradeInput);

    const perfTrades: PerformanceTradeInput[] = filteredClosedTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction,
      status: trade.status,
      symbol: trade.symbol,
      setupId: trade.setupId,
      executions: executionsByTrade.get(trade.id) ?? [],
      riskSnapshot: riskSnapshotsByTrade.get(trade.id) ?? null,
      closedAt: trade.closedAt ?? null,
      openedAt: trade.openedAt ?? null,
    }));

    // Per-trade metrics computed ONCE and shared across all aggregations
    // (O(trades), not O(functions × trades)).
    const metricsCache = computeTradeMetricsCache(perfTrades);

    // ── Rollforward: equity curve + drawdown ────────────────────────────
    const rollforwardRows: RollforwardRow[] = [];
    for (const accountId of accountIds) {
      const rows = db
        .select()
        .from(accountRollforward)
        .where(eq(accountRollforward.accountId, accountId))
        .orderBy(accountRollforward.date)
        .all();
      for (const r of rows) {
        rollforwardRows.push({
          date: r.date,
          endingEquity: r.endingEquity ?? null,
          drawdownAmount: r.drawdownAmount ?? null,
          drawdownPct: r.drawdownPct ?? null,
          cumulativePnl: r.cumulativePnl ?? null,
          highWaterMark: r.highWaterMark ?? null,
        });
      }
    }
    rollforwardRows.sort((a, b) => a.date.localeCompare(b.date));

    // Multi-account: merge per-account rows into one portfolio series.
    // Single-account: pass through unchanged (parity with /api/dashboard).
    const mergedRollforward = accountIds.length > 1 ? aggregateRollforwardByDate(rollforwardRows) : rollforwardRows;

    // Scope the series to the selected period (mirrors /api/dashboard).
    const dateFilteredRollforward = dateFrom || dateTo
      ? mergedRollforward.filter((r) => {
          if (dateFrom && r.date < dateFrom) return false;
          if (dateTo && r.date > dateTo) return false;
          return true;
        })
      : mergedRollforward;

    // Period-start equity for % conversion: earliest available equity within
    // the selected period, falling back to the sum of account starting balances.
    let periodStartEquity = startingAccountValue;
    const earliestPositiveEquity = dateFilteredRollforward.find((r) => r.endingEquity !== null && r.endingEquity > 0);
    if (earliestPositiveEquity && earliestPositiveEquity.endingEquity !== null) {
      periodStartEquity = earliestPositiveEquity.endingEquity;
    }

    // End-of-period rollforward state (period-scoped current drawdown/equity).
    const latestRollforward: RollforwardRow | null =
      dateFilteredRollforward.length > 0 ? dateFilteredRollforward[dateFilteredRollforward.length - 1] : null;

    // ── Compute KPI metrics ─────────────────────────────────────────────
    const kpiMetrics = computeKpiMetrics(allTradesKpi, kpiTrades, latestRollforward, startingAccountValue);

    // Missing KPI kernels (added in this milestone)
    const grossPnl = computeGrossPnl(perfTrades, metricsCache);
    const medianR = computeMedianR(perfTrades, metricsCache);
    const dayWinRate = computeDayWinRate(perfTrades, metricsCache);
    const maxDrawdown = computeMaxDrawdown(dateFilteredRollforward);

    // ── Compute chart data ──────────────────────────────────────────────
    const monthlyPerformance = computeMonthlyPerformance(kpiTrades);
    const rDistribution = computeRDistribution(kpiTrades);
    const directionalPerformance = computeDirectionalPerformance(kpiTrades);
    const dailyNetPnl = computeDailyNetPnl(perfTrades, metricsCache);
    const cumulativeDailyPnl = computeCumulativeDailyPnl(perfTrades, metricsCache);
    const tradeDurationPerformance = computeTradeDurationPerformance(perfTrades, metricsCache);
    const performanceByDayOfWeek = computePerformanceByDayOfWeek(perfTrades, metricsCache);
    const performanceByTimeOfDay = computePerformanceByTimeOfDay(perfTrades, metricsCache);

    const equityCurve = computeEquityCurve(dateFilteredRollforward);
    const drawdownCurve = computeDrawdown(dateFilteredRollforward);

    // ── Setup performance with per-setup net P&L (single pass) ─────────
    const setupNetPnlBySetup = new Map<string, number>();
    for (const trade of perfTrades) {
      const metrics = metricsCache.get(trade.id);
      if (!metrics) continue;
      const key = trade.setupId ?? '__null__';
      setupNetPnlBySetup.set(key, (setupNetPnlBySetup.get(key) ?? 0) + metrics.realizedPnl.netRealizedPnl);
    }
    const setupPerfTrades: SetupPerfTradeInput[] = perfTrades.map((t) => ({
      id: t.id,
      direction: t.direction,
      executions: t.executions,
      grade: gradesByTrade.get(t.id) ?? null,
      riskSnapshot: t.riskSnapshot,
      setupId: t.setupId,
    }));
    const setupPerfResult = computeSetupPerformance(setupPerfTrades);
    const setupPerformance = setupPerfResult.setupPerformance.map((item) => ({
      ...item,
      netPnl: setupNetPnlBySetup.get(item.setupId ?? '__null__') ?? 0,
    }));

    // Total initial risk across selected-period closed trades — denominator
    // for R conversion of currency metrics (applyUnit / currencyToR).
    const totalInitialRisk = perfTrades.reduce((sum, t) => {
      const ir = t.riskSnapshot?.initialRiskAmount ?? null;
      return ir !== null && ir > 0 ? sum + ir : sum;
    }, 0);

    return NextResponse.json({
      kpiMetrics: {
        ...kpiMetrics,
        grossPnl,
        medianR,
        dayWinRate,
        maxDrawdown,
      },
      charts: {
        monthlyPerformance,
        rDistribution,
        directionalPerformance,
        dailyNetPnl,
        cumulativeDailyPnl,
        tradeDurationPerformance,
        performanceByDayOfWeek,
        performanceByTimeOfDay,
        equityCurve,
        drawdownCurve,
        setupPerformance,
      },
      metadata: {
        accountCount: accountIds.length,
        mixedCurrencies,
        tradeCount: filteredClosedTrades.length,
        dateRange: { from: dateFrom, to: dateTo },
        // % baseline: earliest available equity across selected accounts in period.
        periodStartEquity: periodStartEquity > 0 ? periodStartEquity : null,
        // R baseline: sum of positive initial risk across selected-period closed trades.
        totalInitialRisk: totalInitialRisk > 0 ? totalInitialRisk : null,
      },
    });
  } catch (error) {
    console.error('Performance analytics error:', error);
    return NextResponse.json(
      {
        error: 'Failed to compute performance analytics',
        details: { message: error instanceof Error ? error.message : 'Unknown error' },
      },
      { status: 500 },
    );
  }
}
