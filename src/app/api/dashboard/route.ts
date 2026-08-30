/**
 * /api/dashboard route handler
 *
 * GET /api/dashboard?accountId=xxx
 *
 * Returns consolidated dashboard KPI metrics computed from real trade data.
 * Follows the shared batch-fetch pattern: multiple IN queries to join related
 * tables in application code, then passes them to the pure-function
 * computeKpiMetrics() library for aggregation.
 *
 * Error shape follows the standardized pattern from other route handlers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, tradeExecutions, tradeGrades, tradeRiskSnapshots, accountPerformance, accountRollforward, settings, accounts, lookupValues } from '@/db/schema';
import { eq, inArray, desc, and, ne } from 'drizzle-orm';
import { type ExecutionData } from '@/lib/trade-metrics';
import { computeMarkToMarketSummary } from '@/lib/mark-to-market';
import { resolveTradeMetricsExecutions } from '@/lib/trade-correction-lifecycle';
import {
  computeKpiMetrics,
  computeMonthlyPerformance,
  computeRDistribution,
  computeDirectionalPerformance,
  computeProcessScoreDistribution,
  type KpiTradeInput,
  type RollforwardRow,
} from '@/lib/dashboard';
import {
  computeEquityCurve,
  computeDrawdown,
  computeTradeMarkers,
} from '@/lib/equity';
import { computeCalendarHeatmap, type CalendarHeatmapTradeInput } from '@/lib/calendar-heatmap';
import { computePeriodMatrix, type PeriodMatrixTradeInput } from '@/lib/period-matrix';
import { computeSetupPerformance, type SetupPerfTradeInput } from '@/lib/review-dashboard';
import { computeAttentionInsights, type AttentionInsightTradeInput } from '@/lib/attention-insights';
import { getConfiguredTimezone } from '@/lib/app-profile-server';
import { instantToLocalDateKey } from '@/lib/timezone';

/**
 * Chunk an array of IDs into batches of CHUNK_SIZE and run a query for each chunk,
 * concatenating results. Avoids SQLite's parameter count limit (~999 per statement).
 */
function batchInArray<T>(ids: string[], queryFn: (chunk: string[]) => T[], chunkSize = 999): T[] {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    results.push(...queryFn(ids.slice(i, i + chunkSize)));
  }
  return results;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let accountId = searchParams.get('accountId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Validate date parameters if provided
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      return NextResponse.json(
        {
          error: 'Invalid dateFrom parameter',
          details: { fieldErrors: { dateFrom: ['Invalid date format. Use ISO date (YYYY-MM-DD).'] } },
        },
        { status: 400 },
      );
    }
    if (dateTo && isNaN(Date.parse(dateTo))) {
      return NextResponse.json(
        {
          error: 'Invalid dateTo parameter',
          details: { fieldErrors: { dateTo: ['Invalid date format. Use ISO date (YYYY-MM-DD).'] } },
        },
        { status: 400 },
      );
    }

    // Resolve account: provided param -> settings.defaultAccountId -> first active account
    if (!accountId) {
      const setting = db.select().from(settings).get();
      if (setting?.defaultAccountId) {
        accountId = setting.defaultAccountId ?? null;
      } else {
        const firstActive = db
          .select()
          .from(accounts)
          .where(eq(accounts.isActive, true))
          .get();
        accountId = firstActive?.id ?? null;
      }
    }

    if (!accountId) {
      return NextResponse.json(
        {
          error: 'No active account found. Create an account first or set a default account in settings.',
          details: { fieldErrors: { accountId: ['No account resolved'] } },
        },
        { status: 400 },
      );
    }

    // 1. Fetch all trades for this account in a single query.
    // D057/R027: soft-deleted (scratched) trades are excluded from every
    // unfiltered aggregation — they must only surface in the Deleted tab
    // (?status=deleted). Without this ne() the deleted rows would flow into
    // allKpiInputs (inflating totalTrades) and drive batch-fetches of
    // executions/grades/risk snapshots for rows the dashboard never displays.
    const allTrades = db
      .select()
      .from(trades)
      .where(and(eq(trades.accountId, accountId), ne(trades.status, 'deleted')))
      .all();

    const allTradeIds = allTrades.map((t) => t.id);

    // 2. Separate closed trades from non-closed trades
    const closedTrades = allTrades.filter((t) => t.status === 'closed');

    // Resolve the configured analytical timezone once per request (D8).
    // app_profile.timezone is authoritative; UTC is never used as the
    // user's analytical calendar.
    const timezone = getConfiguredTimezone();

    // Apply date filter to closed trades (scope P&L metrics to date range)
    // Attribution uses the LOCAL calendar date in the configured timezone.
    const dateFilteredClosedTrades =
      dateFrom || dateTo
        ? closedTrades.filter((t) => {
            if (!t.closedAt) return false;
            let closedDate: string;
            try {
              closedDate = instantToLocalDateKey(t.closedAt, timezone);
            } catch {
              return false;
            }
            if (dateFrom && closedDate < dateFrom) return false;
            if (dateTo && closedDate > dateTo) return false;
            return true;
          })
        : closedTrades;

    // 3. Batch-fetch related data for ALL trade IDs (follows review-dashboard pattern)
    const executionsMap = new Map<string, (typeof tradeExecutions.$inferSelect)[]>();
    const gradesMap = new Map<string, typeof tradeGrades.$inferSelect>();
    const riskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();
    // S08 zero-divergence: after an economic correction, journal rows are
    // immutable but the effective accounting set is authoritative. Resolve
    // the effective execution set once per trade (cheap no-op when no
    // corrections exist) and use it for every metric computation below so
    // the dashboard never disagrees with positions/overview/ledger/
    // performance after a correction.
    const effectiveExecutionsMap = new Map<string, ExecutionData[]>();

    if (allTradeIds.length > 0) {
      // Executions — batch in chunks of 999 to avoid SQLite parameter limit
      const execs = batchInArray(allTradeIds, (chunk) =>
        db
          .select()
          .from(tradeExecutions)
          .where(inArray(tradeExecutions.tradeId, chunk))
          .all(),
      );
      for (const exec of execs) {
        const list = executionsMap.get(exec.tradeId) ?? [];
        list.push(exec);
        executionsMap.set(exec.tradeId, list);
      }

      const sqliteHandle = getSqliteHandle();
      for (const tradeId of allTradeIds) {
        effectiveExecutionsMap.set(
          tradeId,
          resolveTradeMetricsExecutions(sqliteHandle, tradeId, executionsMap.get(tradeId) ?? []),
        );
      }

      // Grades — batch in chunks of 999
      const gradeRows = batchInArray(allTradeIds, (chunk) =>
        db
          .select()
          .from(tradeGrades)
          .where(inArray(tradeGrades.tradeId, chunk))
          .all(),
      );
      for (const grade of gradeRows) {
        gradesMap.set(grade.tradeId, grade);
      }

      // Risk snapshots — batch in chunks of 999
      const snapshots = batchInArray(allTradeIds, (chunk) =>
        db
          .select()
          .from(tradeRiskSnapshots)
          .where(inArray(tradeRiskSnapshots.tradeId, chunk))
          .all(),
      );
      for (const snap of snapshots) {
        riskMap.set(snap.tradeId, snap);
      }
    }

    // 4. Build KpiTradeInput array from ALL trades (allTrades for counts, dateFilteredClosedTrades for P&L metrics)
    const closedKpiInputs: KpiTradeInput[] = dateFilteredClosedTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      status: trade.status,
      executions: effectiveExecutionsMap.get(trade.id) ?? [],
      grade: (() => {
        const gradeRow = gradesMap.get(trade.id);
        const totalScore = gradeRow?.totalScore;
        return totalScore != null ? { totalScore } : null;
      })(),
      riskSnapshot: riskMap.has(trade.id)
        ? { initialRiskAmount: riskMap.get(trade.id)!.initialRiskAmount ?? null }
        : null,
      closedAt: trade.closedAt ?? null,
    }));

    // Build all-trades KpiTradeInput for counts (non-closed trades have no P&L contribution)
    const allKpiInputs: KpiTradeInput[] = allTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      status: trade.status,
      executions: effectiveExecutionsMap.get(trade.id) ?? [],
      grade: (() => {
        const gradeRow = gradesMap.get(trade.id);
        const totalScore = gradeRow?.totalScore;
        return totalScore != null ? { totalScore } : null;
      })(),
      riskSnapshot: riskMap.has(trade.id)
        ? { initialRiskAmount: riskMap.get(trade.id)!.initialRiskAmount ?? null }
        : null,
      closedAt: trade.closedAt ?? null,
    }));

    // 5. Compute MTM (mark-to-market) aggregate from open trades with current prices
    const openTrades = allTrades
      .filter((t) => t.status === 'open')
      .map((trade) => ({
        executions: effectiveExecutionsMap.get(trade.id) ?? [],
        direction: trade.direction as 'long' | 'short',
        currentPrice: trade.currentPrice ?? null,
      }));

    const mtm = computeMarkToMarketSummary(openTrades);

    // 6. Fetch latest account_rollforward row for this account
    const rollforwardRow = db
      .select()
      .from(accountRollforward)
      .where(eq(accountRollforward.accountId, accountId))
      .orderBy(desc(accountRollforward.date))
      .limit(1)
      .get();

    const latestRollforward: RollforwardRow | null = rollforwardRow
      ? {
          date: rollforwardRow.date,
          endingEquity: rollforwardRow.endingEquity ?? 0,
          drawdownAmount: rollforwardRow.drawdownAmount ?? 0,
          drawdownPct: rollforwardRow.drawdownPct ?? 0,
          cumulativePnl: rollforwardRow.cumulativePnl ?? null,
          highWaterMark: rollforwardRow.highWaterMark ?? null,
        }
      : null;

    // 6. Fetch ALL account_rollforward rows ordered by date ASC for equity curve and drawdown charts
    const allRollforwardRows = db
      .select()
      .from(accountRollforward)
      .where(eq(accountRollforward.accountId, accountId))
      .orderBy(accountRollforward.date)
      .all();

    // Apply date filter to rollforward rows for charts
    const dateFilteredRollforwardRows = dateFrom || dateTo
      ? allRollforwardRows.filter((r) => {
          const d = r.date;
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
          return true;
        })
      : allRollforwardRows;

    const rollforwardRowsForCharts: RollforwardRow[] = dateFilteredRollforwardRows.map((r) => ({
      date: r.date,
      endingEquity: r.endingEquity ?? null,
      drawdownAmount: r.drawdownAmount ?? null,
      drawdownPct: r.drawdownPct ?? null,
      cumulativePnl: r.cumulativePnl ?? null,
      highWaterMark: r.highWaterMark ?? null,
    }));

    const equityCurve = computeEquityCurve(rollforwardRowsForCharts);
    const drawdown = computeDrawdown(rollforwardRowsForCharts);

    // 7. Fetch settings.startingAccountValue for fallback
    const setting = db.select().from(settings).get();
    const startingAccountValue = setting?.startingAccountValue ?? null;

    // 8. Compute period KPIs. The rebuildable performance projection is the
    // authoritative source for current NAV; rollforwards remain the historical
    // source for equity and drawdown charts.
    const computedKpis = computeKpiMetrics(
      allKpiInputs,
      closedKpiInputs,
      latestRollforward,
      startingAccountValue,
    );
    const performanceProjection = db
      .select({ nav: accountPerformance.nav })
      .from(accountPerformance)
      .where(eq(accountPerformance.accountId, accountId))
      .get();
    const projectedNav = performanceProjection ? Number(performanceProjection.nav) : null;
    const kpis = projectedNav !== null && Number.isFinite(projectedNav)
      ? { ...computedKpis, accountValue: projectedNav }
      : computedKpis;

    // 9. Compute monthly performance, R distribution, directional performance, and process score distribution
    const monthlyPerformance = computeMonthlyPerformance(closedKpiInputs, timezone);
    const rDistribution = computeRDistribution(closedKpiInputs);
    const directionalPerformance = computeDirectionalPerformance(closedKpiInputs);
    const processScoreDistribution = computeProcessScoreDistribution(closedKpiInputs);

    // 10. Compute trade markers for equity curve chart
    const dateFilteredClosedInputs: { id: string; direction: 'long' | 'short'; executions: ExecutionData[]; closedAt: string | null }[] =
      dateFilteredClosedTrades.map((trade) => ({
        id: trade.id,
        direction: trade.direction as 'long' | 'short',
        executions: effectiveExecutionsMap.get(trade.id) ?? [],
        closedAt: trade.closedAt ?? null,
      }));

    const tradeMarkers = computeTradeMarkers(dateFilteredClosedInputs, rollforwardRowsForCharts);

    // 11. Compute calendar heatmap and period matrix from closed trade data
    const heatmapInputs: CalendarHeatmapTradeInput[] = closedKpiInputs.map((input) => ({
      id: input.id,
      direction: input.direction,
      executions: input.executions,
      closedAt: input.closedAt,
    }));

    const periodInputs: PeriodMatrixTradeInput[] = closedKpiInputs.map((input) => ({
      id: input.id,
      direction: input.direction,
      executions: input.executions,
      riskSnapshot: input.riskSnapshot,
      closedAt: input.closedAt,
    }));

    const calendarHeatmap = computeCalendarHeatmap(heatmapInputs, timezone);
    const periodMatrix = {
      wow: computePeriodMatrix(periodInputs, 'wow', timezone),
      mom: computePeriodMatrix(periodInputs, 'mom', timezone),
      qoq: computePeriodMatrix(periodInputs, 'qoq', timezone),
    };

    // 12. Compute setup ranking (per-setup performance sorted by trade count)
    const uniqueSetupIds = [...new Set(dateFilteredClosedTrades.map((t) => t.setupId).filter(Boolean))] as string[];
    const setupNameMap: Record<string, string> = {};

    if (uniqueSetupIds.length > 0) {
      const setupLookups = batchInArray(uniqueSetupIds, (chunk) =>
        db
          .select()
          .from(lookupValues)
          .where(and(inArray(lookupValues.id, chunk), eq(lookupValues.type, 'setup')))
          .all(),
      );
      for (const lv of setupLookups) {
        setupNameMap[lv.id] = lv.value;
      }
    }

    const setupPerfInputs: SetupPerfTradeInput[] = dateFilteredClosedTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      executions: effectiveExecutionsMap.get(trade.id) ?? [],
      grade: (() => {
        const gradeRow = gradesMap.get(trade.id);
        const totalScore = gradeRow?.totalScore;
        return totalScore != null ? { totalScore } : null;
      })(),
      riskSnapshot: riskMap.has(trade.id)
        ? { initialRiskAmount: riskMap.get(trade.id)!.initialRiskAmount ?? null }
        : null,
      setupId: trade.setupId,
    }));

    const dashboardMetrics = computeSetupPerformance(setupPerfInputs, setupNameMap, true);
    const setupRanking = dashboardMetrics.setupPerformance;

    // 13. Compute attention insights from date-filtered closed trades
    const insightInputs: AttentionInsightTradeInput[] = dateFilteredClosedTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      executions: effectiveExecutionsMap.get(trade.id) ?? [],
      riskSnapshot: riskMap.has(trade.id)
        ? { initialRiskAmount: riskMap.get(trade.id)!.initialRiskAmount ?? null }
        : null,
      grade: (() => {
        const gradeRow = gradesMap.get(trade.id);
        const totalScore = gradeRow?.totalScore;
        return totalScore != null ? { totalScore } : null;
      })(),
      closedAt: trade.closedAt ?? null,
      setupId: trade.setupId,
    }));

    const attentionInsights = computeAttentionInsights(insightInputs, timezone);

    return NextResponse.json({
      kpis,
      mtm,
      equityCurve,
      drawdown,
      monthlyPerformance,
      rDistribution,
      directionalPerformance,
      processScoreDistribution,
      tradeMarkers,
      calendarHeatmap,
      periodMatrix,
      setupRanking,
      attentionInsights,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch dashboard KPIs', details: String(error) },
      { status: 500 },
    );
  }
}
