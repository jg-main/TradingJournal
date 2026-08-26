/**
 * period-matrix.ts
 *
 * Pure (no side effects) period-over-period comparison matrix library.
 * Compares closed trade metrics across configurable time periods:
 * week-over-week (WoW), month-over-month (MoM), quarter-over-quarter (QoQ).
 *
 * Each period yields win rate, P&L, trade count, and avg R.  Consecutive
 * periods are compared with deltas (absolute change), and a final summary
 * gives the overall direction.
 *
 * Follows the M026 pattern established by dashboard.ts, calendar-heatmap.ts,
 * and metrics.ts — pure functions, own input types, no DB imports, no NextResponse.
 */

import { computeTradeMetrics, type ExecutionData } from './trade-metrics';
import { computeWinRate as computeMetricsWinRate, averageRMultiples } from './metrics';
import {
  instantToLocalDateKey,
  addLocalDays,
  getLocalDayOfWeek,
  getLocalISOMonday,
  getISOWeekNumber,
} from './timezone';

// ── Period Types ────────────────────────────────────────────────────────

/**
 * Supported period comparison types for the period-over-period matrix.
 *
 * - `wow`: Week-over-week (ISO week boundaries, Monday to Sunday)
 * - `mom`: Month-over-month (calendar month boundaries)
 * - `qoq`: Quarter-over-quarter (calendar quarter boundaries: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec)
 */
export type PeriodComparisonType = 'wow' | 'mom' | 'qoq';

// ── Input Type ─────────────────────────────────────────────────────────

/**
 * A single closed trade with pre-fetched related data for period-matrix
 * computation.
 *
 * - executions:   All trade_executions for this trade (used by calculatePnL)
 * - riskSnapshot: trade_risk_snapshots row, or null if not assessed
 * - closedAt:     Timestamp of when the trade was fully closed
 *
 * Fields mirror KpiTradeInput from dashboard.ts, omitting status and grade
 * which are not needed for period-over-period metric computation.
 */
export interface PeriodMatrixTradeInput {
  id: string;
  direction: 'long' | 'short';
  executions: ExecutionData[];
  riskSnapshot: { initialRiskAmount: number | null } | null;
  closedAt: string | null;
}

// ── Period Identity ────────────────────────────────────────────────────

/**
 * Metadata identifying a single time period within the comparison matrix.
 *
 * - periodId:   Stable identifier for the period (e.g. "2026-W27", "2026-07", "2026-Q2")
 * - periodLabel: Human-readable label (e.g. "Week 27", "Jul 2026", "Q2 2026")
 * - startDate:  Period start date (inclusive) in YYYY-MM-DD format
 * - endDate:    Period end date (inclusive) in YYYY-MM-DD format
 */
export interface PeriodDescriptor {
  periodId: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
}

// ── Metrics Output ─────────────────────────────────────────────────────

/**
 * Aggregate performance metrics for a single time period.
 *
 * - periodId:   Stable period identifier (matches PeriodDescriptor)
 * - periodLabel: Human-readable period label
 * - startDate:  Period start date in YYYY-MM-DD
 * - endDate:    Period end date in YYYY-MM-DD
 * - winRate:    Fraction of winning trades (0–1), or null when no trades
 * - pnl:        Sum of realised P&L (including fees) for the period
 * - tradeCount: Number of closed trades in this period
 * - avgR:       Mean R-multiple, or null when no trades have valid risk data
 */
export interface PeriodMetrics {
  periodId: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  winRate: number | null;
  pnl: number;
  tradeCount: number;
  avgR: number | null;
}

// ── Comparison Output ──────────────────────────────────────────────────

/**
 * Absolute deltas between two consecutive periods.
 *
 * Each field is the current-period value minus the previous-period value.
 * A null field means one or both values were null and cannot be compared.
 *
 * - winRate:    Change in percentage points (e.g. 0.05 means +5pp)
 * - pnl:        Absolute change in currency
 * - tradeCount: Absolute change in count
 * - avgR:       Absolute change in R-multiple
 */
export interface PeriodDelta {
  winRate: number | null;
  pnl: number | null;
  tradeCount: number | null;
  avgR: number | null;
}

/**
 * A single comparison row in the period-over-period matrix.
 *
 * Compares a period (current) against its immediate predecessor (previous),
 * with computed deltas for each metric.
 */
export interface PeriodComparisonRow {
  current: PeriodMetrics;
  previous: PeriodMetrics;
  delta: PeriodDelta;
}

/**
 * The complete period-over-period comparison result.
 *
 * - comparisonType: The type of comparison requested
 * - rows:           Array of comparison rows (current vs previous), ordered
 *                   most-recent-first by default
 */
export interface PeriodMatrixResult {
  comparisonType: PeriodComparisonType;
  rows: PeriodComparisonRow[];
}

// ── Internal: Period Boundary Helpers ───────────────────────────────────

/**
 * Normalize an input date to a LOCAL calendar date key (YYYY-MM-DD).
 *
 * - Full ISO timestamps (containing 'T') are converted from the instant
 *   using the configured IANA timezone (D8: never the UTC calendar day).
 * - Already-normalized YYYY-MM-DD keys are used as-is (intentional local
 *   calendar dates are never re-shifted).
 */
function toLocalDateKey(dateStr: string, timezone: string): string {
  if (dateStr.includes('T')) {
    return instantToLocalDateKey(dateStr, timezone);
  }
  const key = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error(`Invalid date string: ${JSON.stringify(dateStr)}`);
  }
  return key;
}

/**
 * Last calendar day of the month containing the given local date key.
 */
function lastDayOfMonth(dateKey: string): string {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/**
 * Add N months to a local date key (clamped to month length).
 */
function addMonths(dateKey: string, months: number): string {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(day, last);
  return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

/**
 * Determine the period descriptor (periodId, label, startDate, endDate)
 * for the period of the given type that CONTAINS the given local date.
 *
 * All boundaries derive from the LOCAL calendar date key in the configured
 * IANA timezone (D8): week starts are local Mondays, months are local
 * calendar months, quarters are local calendar quarters. No machine-timezone
 * Date methods are used for attribution.
 *
 * @param dateStr Date string in ISO format (YYYY-MM-DD or full timestamp)
 * @param type    Period comparison type
 * @param timezone IANA timezone controlling calendar attribution
 * @returns PeriodDescriptor describing the containing period
 */
export function getPeriodFromDate(
  dateStr: string,
  type: PeriodComparisonType,
  timezone: string,
): PeriodDescriptor {
  const key = toLocalDateKey(dateStr, timezone);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));

  switch (type) {
    case 'wow': {
      const monday = getLocalISOMonday(key);
      const sunday = addLocalDays(monday, 6);
      const weekNum = getISOWeekNumber(key);
      return {
        periodId: `${year}-W${String(weekNum).padStart(2, '0')}`,
        periodLabel: `Week ${weekNum}`,
        startDate: monday,
        endDate: sunday,
      };
    }
    case 'mom': {
      const first = `${year}-${String(month).padStart(2, '0')}-01`;
      const monthStr = String(month).padStart(2, '0');
      const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      return {
        periodId: `${year}-${monthStr}`,
        periodLabel: `${monthLabel} ${year}`,
        startDate: first,
        endDate: lastDayOfMonth(first),
      };
    }
    case 'qoq': {
      const quarter = Math.floor((month - 1) / 3); // 0=Q1, 1=Q2, 2=Q3, 3=Q4
      const firstMonth = quarter * 3 + 1; // 1, 4, 7, 10
      const first = `${year}-${String(firstMonth).padStart(2, '0')}-01`;
      const lastMonth = firstMonth + 2;
      const last = lastDayOfMonth(`${year}-${String(lastMonth).padStart(2, '0')}-01`);
      return {
        periodId: `${year}-Q${quarter + 1}`,
        periodLabel: `Q${quarter + 1} ${year}`,
        startDate: first,
        endDate: last,
      };
    }
  }
}

/**
 * Generate N consecutive period descriptors going backwards from a
 * reference period.
 *
 * Period 0 is the reference period itself.  Periods 1..N-1 are the
 * immediately preceding periods.
 *
 * @param referenceDateStr Date string in the reference period
 * @param type             Period comparison type
 * @param count            Total periods to generate (including reference)
 * @returns Array of PeriodDescriptors ordered chronologically (oldest first)
 */
export function generatePriorPeriods(
  referenceDateStr: string,
  type: PeriodComparisonType,
  count: number,
  timezone: string,
): PeriodDescriptor[] {
  const reference = getPeriodFromDate(referenceDateStr, type, timezone);
  const periods: PeriodDescriptor[] = [reference];

  for (let i = 1; i < count; i++) {
    const prev = getPreviousPeriod(periods[0], type, timezone);
    periods.unshift(prev);
  }

  return periods;
}

/**
 * Get the period descriptor for the period immediately preceding the
 * given period.
 */
function getPreviousPeriod(
  period: PeriodDescriptor,
  type: PeriodComparisonType,
  timezone: string,
): PeriodDescriptor {
  switch (type) {
    case 'wow': {
      // Go back 7 days from the start of this period to get the previous Monday
      const prevMonday = addLocalDays(period.startDate, -7);
      return getPeriodFromDate(prevMonday, 'wow', timezone);
    }
    case 'mom': {
      // Go to the 1st of the previous month
      const prevMonthStart = addMonths(`${period.startDate.slice(0, 8)}01`, -1);
      return getPeriodFromDate(prevMonthStart, 'mom', timezone);
    }
    case 'qoq': {
      // Go back 3 months
      const prevQuarterStart = addMonths(`${period.startDate.slice(0, 8)}01`, -3);
      return getPeriodFromDate(prevQuarterStart, 'qoq', timezone);
    }
  }
}

// ── Internal: Assignment ────────────────────────────────────────────────

/**
 * Assign trades to their corresponding periods based on closedAt date.
 *
 * Trades without a closedAt timestamp are skipped.  Each trade is placed
 * in the first period whose [startDate, endDate] range contains it.
 *
 * @param trades  Closed trades with pre-fetched executions
 * @param periods Period descriptors to assign into
 * @returns Map of periodId -> array of trades in that period
 */
function assignTradesToPeriods(
  trades: PeriodMatrixTradeInput[],
  periods: PeriodDescriptor[],
  timezone: string,
): Map<string, PeriodMatrixTradeInput[]> {
  const map = new Map<string, PeriodMatrixTradeInput[]>();

  for (const p of periods) {
    map.set(p.periodId, []);
  }

  for (const trade of trades) {
    if (!trade.closedAt) continue;
    let tradeDate: string;
    try {
      tradeDate = instantToLocalDateKey(trade.closedAt, timezone); // local YYYY-MM-DD
    } catch {
      // Malformed timestamp — skip deterministically, never fabricate a bucket.
      continue;
    }

    for (const p of periods) {
      if (tradeDate >= p.startDate && tradeDate <= p.endDate) {
        map.get(p.periodId)!.push(trade);
        break;
      }
    }
  }

  return map;
}

// ── Internal: Metric Computation ────────────────────────────────────────

/**
 * Compute aggregate period metrics for a set of trades.
 *
 * Computes: win rate (includeZeroAsLoss per D013), total P&L,
 * trade count, and mean R-multiple.
 *
 * @param trades       Trades in this period (can be empty)
 * @param periodDesc   Period descriptor for identity metadata
 * @returns PeriodMetrics with all fields populated
 */
function computePeriodMetrics(
  trades: PeriodMatrixTradeInput[],
  periodDesc: PeriodDescriptor,
): PeriodMetrics {
  if (trades.length === 0) {
    return {
      periodId: periodDesc.periodId,
      periodLabel: periodDesc.periodLabel,
      startDate: periodDesc.startDate,
      endDate: periodDesc.endDate,
      winRate: null,
      pnl: 0,
      tradeCount: 0,
      avgR: null,
    };
  }

  let totalPnl = 0;
  const pnls: number[] = [];
  const rMultiples: number[] = [];

  for (const trade of trades) {
    const metrics = computeTradeMetrics({
      executions: trade.executions,
      direction: trade.direction,
      riskSnapshot: trade.riskSnapshot
        ? { initialRiskAmount: trade.riskSnapshot.initialRiskAmount, accountEquityAtOpen: null }
        : null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    });
    const totalRealizedPnL = metrics.realizedPnl.netRealizedPnl;
    totalPnl += totalRealizedPnL;
    pnls.push(totalRealizedPnL);

    const rMultiple = metrics.returnMetrics.rMultiple;
    if (rMultiple !== null) {
      rMultiples.push(rMultiple);
    }
  }

  const winRate = computeMetricsWinRate(pnls, 'includeZeroAsLoss');
  const avgR = averageRMultiples(rMultiples);

  return {
    periodId: periodDesc.periodId,
    periodLabel: periodDesc.periodLabel,
    startDate: periodDesc.startDate,
    endDate: periodDesc.endDate,
    winRate,
    pnl: totalPnl,
    tradeCount: trades.length,
    avgR,
  };
}

/**
 * Compute deltas between two PeriodMetrics objects.
 *
 * Each delta is `current - previous` when both values are non-null.
 * When either value is null, the delta for that metric is null.
 *
 * @param current  Metrics for the more recent period
 * @param previous Metrics for the preceding period
 * @returns PeriodDelta with computed differences
 */
function computeDelta(current: PeriodMetrics, previous: PeriodMetrics): PeriodDelta {
  return {
    winRate:
      current.winRate !== null && previous.winRate !== null
        ? current.winRate - previous.winRate
        : null,
    pnl: current.pnl - previous.pnl, // Always non-null (pnl is always a number)
    tradeCount: current.tradeCount - previous.tradeCount, // Always non-null
    avgR:
      current.avgR !== null && previous.avgR !== null
        ? current.avgR - previous.avgR
        : null,
  };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Compute a period-over-period comparison matrix from closed trade data.
 *
 * This is the primary orchestrator.  It:
 *   1. Generates N consecutive period descriptors from the latest trade date
 *   2. Assigns each trade to its containing period
 *   3. Computes aggregate metrics (win rate, P&L, trade count, avg R) per period
 *   4. Builds comparison rows pairing each period with its predecessor
 *   5. Computes deltas for each pair
 *
 * The result is ordered most-recent-first (descending by period start date).
 * Periods with zero trades still appear in the results with null metrics.
 *
 * @param trades     Closed trades with pre-fetched executions and risk data
 * @param type       Period comparison type (wow, mom, or qoq)
 * @param timezone   IANA timezone controlling calendar attribution (D8)
 * @param maxPeriods Maximum number of periods to include (default 4, minimum 2)
 * @returns PeriodMatrixResult with comparison rows
 */
export function computePeriodMatrix(
  trades: PeriodMatrixTradeInput[],
  type: PeriodComparisonType,
  timezone: string,
  maxPeriods = 4,
): PeriodMatrixResult {
  // Find the latest trade date to anchor period generation
  const closedTrades = trades.filter((t) => t.closedAt !== null);
  const maxPeriodsClamped = Math.max(2, maxPeriods);

  if (closedTrades.length === 0) {
    // No closed trades — return empty rows
    return {
      comparisonType: type,
      rows: [],
    };
  }

  // Sort by closedAt descending to find the latest
  const sorted = [...closedTrades].sort(
    (a, b) => (b.closedAt as string).localeCompare(a.closedAt as string),
  );
  const latestDate = sorted[0].closedAt as string;

  // Generate period descriptors
  const periods = generatePriorPeriods(latestDate, type, maxPeriodsClamped, timezone);

  // Assign trades to periods
  const assigned = assignTradesToPeriods(trades, periods, timezone);

  // Compute metrics per period
  const metricsMap = new Map<string, PeriodMetrics>();
  for (const p of periods) {
    metricsMap.set(p.periodId, computePeriodMetrics(assigned.get(p.periodId) ?? [], p));
  }

  // Build comparison rows (most recent first)
  const rows: PeriodComparisonRow[] = [];
  for (let i = periods.length - 1; i >= 1; i--) {
    const current = metricsMap.get(periods[i].periodId)!;
    const previous = metricsMap.get(periods[i - 1].periodId)!;
    rows.push({
      current,
      previous,
      delta: computeDelta(current, previous),
    });
  }

  return {
    comparisonType: type,
    rows,
  };
}
