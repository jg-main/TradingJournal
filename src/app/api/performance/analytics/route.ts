/**
 * /api/performance/analytics route handler
 *
 * GET /api/performance/analytics?accountIds=xxx,yyy&dateFrom=2024-01-01&dateTo=2024-12-31&...
 *
 * Returns consolidated performance analytics for the /performance dashboard.
 * Supports multi-account scope, close-date filtering, and advanced filters.
 * Reuses canonical computation kernels (computeTradeMetrics, computeKpiMetrics, etc.).
 *
 * Pattern: mirrors /api/dashboard but with multi-account and advanced filter support.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  trades,
  tradeExecutions,
  tradeGrades,
  tradeRiskSnapshots,
  accountRollforward,
  settings,
  accounts,
} from '@/db/schema';
import { eq, inArray, and, gte, lte, sql } from 'drizzle-orm';
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
 */
function batchInArray<T>(ids: string[], queryFn: (chunk: string[]) => T[], chunkSize = 999): T[] {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    results.push(...queryFn(ids.slice(i, i + chunkSize)));
  }
  return results;
}

/**
 * Compute net P&L grouped by setup for the selected closed trades, in one pass.
 * Uses computeTradeMetrics on each trade's executions.
 */
function computeSetupNetPnlBySetup(trades: PerformanceTradeInput[], cache: ReturnType<typeof computeTradeMetricsCache>): Map<string, number> {
  const bySetup = new Map<string, number>();
  for (const trade of trades) {
    const metrics = cache.get(trade.id) ?? computeTradeMetrics({
      executions: trade.executions,
      direction: trade.direction,
      riskSnapshot: trade.riskSnapshot
        ? { initialRiskAmount: trade.riskSnapshot.initialRiskAmount, accountEquityAtOpen: null }
        : null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    });
    const key = trade.setupId ?? '__null__';
    bySetup.set(key, (bySetup.get(key) ?? 0) + metrics.realizedPnl.netRealizedPnl);
  }
  return bySetup;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse account scope
    const accountIdsParam = searchParams.get('accountIds');
    const accountScopeMode = searchParams.get('accountScope') || 'all'; // 'all' | 'single' | 'multiple'

    // Parse date range
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Parse advanced filters
    const setupIdsParam = searchParams.get('setupIds');
    const directionsParam = searchParams.get('directions');
    const symbolsParam = searchParams.get('symbols');
    const tradeResultsParam = searchParams.get('tradeResults');

    // Validate date parameters
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      return NextResponse.json(
        { error: 'Invalid dateFrom parameter', details: { fieldErrors: { dateFrom: ['Invalid date format'] } } },
        { status: 400 },
      );
    }
    if (dateTo && isNaN(Date.parse(dateTo))) {
      return NextResponse.json(
        { error: 'Invalid dateTo parameter', details: { fieldErrors: { dateTo: ['Invalid date format'] } } },
        { status: 400 },
      );
    }

    // Resolve account IDs
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

    // Check currency consistency
    const accountCurrencies = new Set<string>();
    for (const accountId of accountIds) {
      const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
      if (account) {
        accountCurrencies.add(account.currency || 'USD');
      }
    }
    const mixedCurrencies = accountCurrencies.size > 1;

    // Build trade query conditions
    const conditions = [inArray(trades.accountId, accountIds)];

    // Close-date filtering (attribute trades by close date)
    if (dateFrom) {
      conditions.push(gte(trades.closedAt, dateFrom));
    }
    if (dateTo) {
      conditions.push(lte(trades.closedAt, dateTo + 'T23:59:59.999Z'));
    }

    // Advanced filters
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

    // Fetch trades
    const allTrades = db
      .select()
      .from(trades)
      .where(and(...conditions))
      .all();

    // Filter to closed trades for realized metrics
    const closedTrades = allTrades.filter((t) => t.status === 'closed');

    // Apply trade result filter (win/loss/scratch) after P&L computation
    let filteredClosedTrades = closedTrades;
    if (tradeResultsParam) {
      const tradeResults = tradeResultsParam.split(',').filter(Boolean) as Array<'win' | 'loss' | 'scratch'>;
      if (tradeResults.length > 0) {
        filteredClosedTrades = closedTrades.filter((trade) => {
          const executions = batchInArray(
            [trade.id],
            (ids) =>
              db
                .select()
                .from(tradeExecutions)
                .where(inArray(tradeExecutions.tradeId, ids))
                .all(),
          );
          const riskSnapshot = db
            .select()
            .from(tradeRiskSnapshots)
            .where(eq(tradeRiskSnapshots.tradeId, trade.id))
            .get();

          const metrics = computeTradeMetrics({
            executions: executions as ExecutionData[],
            direction: trade.direction,
            riskSnapshot: riskSnapshot
              ? { initialRiskAmount: riskSnapshot.initialRiskAmount, accountEquityAtOpen: null }
              : null,
            stopAdjustments: [],
            currentMark: null,
            currentAccountEquity: null,
          });
          const pnl = metrics.realizedPnl.netRealizedPnl;
          const decision = classifyPnlDecision(pnl, 'includeZeroAsLoss');

          return tradeResults.includes(decision);
        });
      }
    }

    // Fetch related data for filtered trades
    const tradeIds = filteredClosedTrades.map((t) => t.id);
    const executions = batchInArray(tradeIds, (ids) =>
      db.select().from(tradeExecutions).where(inArray(tradeExecutions.tradeId, ids)).all(),
    );
    const grades = batchInArray(tradeIds, (ids) =>
      db.select().from(tradeGrades).where(inArray(tradeGrades.tradeId, ids)).all(),
    );
    const riskSnapshots = batchInArray(tradeIds, (ids) =>
      db.select().from(tradeRiskSnapshots).where(inArray(tradeRiskSnapshots.tradeId, ids)).all(),
    );

    // Build KpiTradeInput array
    const kpiTrades: KpiTradeInput[] = filteredClosedTrades.map((trade) => {
      const grade = grades.find((g) => g.tradeId === trade.id);
      return {
        id: trade.id,
        direction: trade.direction,
        status: trade.status,
        executions: executions.filter((e) => e.tradeId === trade.id) as ExecutionData[],
        grade: grade ? { totalScore: grade.totalScore ?? 0 } : null,
        riskSnapshot: riskSnapshots.find((r) => r.tradeId === trade.id) || null,
        closedAt: trade.closedAt,
      };
    });

    // Build PerformanceTradeInput array for new computations
    const perfTrades: PerformanceTradeInput[] = filteredClosedTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction,
      status: trade.status,
      symbol: trade.symbol,
      setupId: trade.setupId,
      executions: executions.filter((e) => e.tradeId === trade.id) as ExecutionData[],
      riskSnapshot: riskSnapshots.find((r) => r.tradeId === trade.id) || null,
      closedAt: trade.closedAt,
      openedAt: trade.openedAt,
    }));

    // Compute per-trade metrics ONCE and share across all aggregations.
    const metricsCache = computeTradeMetricsCache(perfTrades);

    // Fetch rollforward data for equity curve and drawdown
    const rollforwardRows: RollforwardRow[] = [];
    for (const accountId of accountIds) {
      const rows = db
        .select()
        .from(accountRollforward)
        .where(eq(accountRollforward.accountId, accountId))
        .orderBy(accountRollforward.date)
        .all();
      rollforwardRows.push(...rows);
    }

    // Sort by date and deduplicate (if multiple accounts, aggregate)
    rollforwardRows.sort((a, b) => a.date.localeCompare(b.date));

    // Get starting account value (sum of all accounts' starting balances)
    let startingAccountValue = 0;
    for (const accountId of accountIds) {
      const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
      if (account) {
        startingAccountValue += account.startingBalance || 0;
      }
    }

    // Period-start equity for % conversion: earliest available equity
    // (first rollforward row with positive ending equity), falling back to
    // the sum of account starting balances.
    let periodStartEquity = startingAccountValue;
    const earliestPositiveEquity = rollforwardRows.find((r) => r.endingEquity !== null && r.endingEquity > 0);
    if (earliestPositiveEquity && earliestPositiveEquity.endingEquity !== null) {
      periodStartEquity = earliestPositiveEquity.endingEquity;
    }

    const latestRollforward = rollforwardRows.length > 0 ? rollforwardRows[rollforwardRows.length - 1] : null;

    // Build allTrades as KpiTradeInput (for total trade count)
    const allTradesKpi: KpiTradeInput[] = allTrades.map((trade) => {
      const grade = grades.find((g) => g.tradeId === trade.id);
      return {
        id: trade.id,
        direction: trade.direction,
        status: trade.status,
        executions: executions.filter((e) => e.tradeId === trade.id) as ExecutionData[],
        grade: grade ? { totalScore: grade.totalScore ?? 0 } : null,
        riskSnapshot: riskSnapshots.find((r) => r.tradeId === trade.id) || null,
        closedAt: trade.closedAt,
      };
    });

    // Compute KPI metrics
    const kpiMetrics = computeKpiMetrics(allTradesKpi, kpiTrades, latestRollforward, startingAccountValue);

    // Compute missing KPI metrics
    const grossPnl = computeGrossPnl(perfTrades, metricsCache);
    const medianR = computeMedianR(perfTrades, metricsCache);
    const dayWinRate = computeDayWinRate(perfTrades, metricsCache);
    const maxDrawdown = computeMaxDrawdown(rollforwardRows);

    // Compute chart data
    const monthlyPerformance = computeMonthlyPerformance(kpiTrades);
    const rDistribution = computeRDistribution(kpiTrades);
    const directionalPerformance = computeDirectionalPerformance(kpiTrades);
    const dailyNetPnl = computeDailyNetPnl(perfTrades, metricsCache);
    const cumulativeDailyPnl = computeCumulativeDailyPnl(perfTrades, metricsCache);
    const tradeDurationPerformance = computeTradeDurationPerformance(perfTrades, metricsCache);
    const performanceByDayOfWeek = computePerformanceByDayOfWeek(perfTrades, metricsCache);
    const performanceByTimeOfDay = computePerformanceByTimeOfDay(perfTrades, metricsCache);

    // Compute equity curve and drawdown
    const equityCurve = computeEquityCurve(rollforwardRows);
    const drawdownCurve = computeDrawdown(rollforwardRows);

    // Compute setup performance (add netPnl per setup — required for metric selection)
    // Single pass: group net P&L by setup once, then merge into each setup row.
    const setupNetPnlBySetup = computeSetupNetPnlBySetup(perfTrades, metricsCache);
    const setupPerfTrades: SetupPerfTradeInput[] = perfTrades.map((t) => ({
      ...t,
      grade: grades.find((g) => g.tradeId === t.id) || null,
    }));
    const setupPerfResult = computeSetupPerformance(setupPerfTrades);
    const setupPerformanceWithNetPnl = setupPerfResult.setupPerformance.map((item) => ({
      ...item,
      netPnl: setupNetPnlBySetup.get(item.setupId ?? '__null__') ?? 0,
    }));

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
        setupPerformance: setupPerformanceWithNetPnl,
      },
      metadata: {
        accountCount: accountIds.length,
        mixedCurrencies,
        tradeCount: filteredClosedTrades.length,
        dateRange: { from: dateFrom, to: dateTo },
        // % baseline: earliest available equity across selected accounts.
        periodStartEquity: periodStartEquity > 0 ? periodStartEquity : null,
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
