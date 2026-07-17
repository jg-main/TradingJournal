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

import { calculatePnL, calculateRMultiple, type ExecutionData } from './trade-calc';
import { computeWinRate as computeMetricsWinRate, averageRMultiples } from './metrics';

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
 * Format a Date as YYYY-MM-DD string.
 */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Get the Monday of the ISO week containing the given date.
 *
 * ISO weeks start on Monday.  JavaScript getDay() returns 0 for Sunday,
 * 1 for Monday, ..., 6 for Saturday.  We adjust Sunday (day=0) to use
 * the previous Monday (day - 6 = -6 → setDate(date.getDate() - 6)).
 */
function getISOMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the ISO week number for a given date (1-53).
 *
 * Follows ISO 8601: the week containing the first Thursday of the year
 * is week 1.
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Determine the period descriptor (periodId, label, startDate, endDate)
 * for the period of the given type that CONTAINS the given date.
 *
 * @param dateStr Date string in ISO format (YYYY-MM-DD or full timestamp)
 * @param type    Period comparison type
 * @returns PeriodDescriptor describing the containing period
 */
export function getPeriodFromDate(dateStr: string, type: PeriodComparisonType): PeriodDescriptor {
  const date = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  const year = date.getFullYear();

  switch (type) {
    case 'wow': {
      const monday = getISOMonday(date);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const weekNum = getISOWeekNumber(date);
      return {
        periodId: `${year}-W${String(weekNum).padStart(2, '0')}`,
        periodLabel: `Week ${weekNum}`,
        startDate: formatDate(monday),
        endDate: formatDate(sunday),
      };
    }
    case 'mom': {
      const month = date.getMonth(); // 0-indexed
      const first = new Date(year, month, 1);
      const last = new Date(year, month + 1, 0); // Day 0 of next month = last day
      const monthStr = String(month + 1).padStart(2, '0');
      const monthLabel = date.toLocaleString('en-US', { month: 'short' });
      return {
        periodId: `${year}-${monthStr}`,
        periodLabel: `${monthLabel} ${year}`,
        startDate: formatDate(first),
        endDate: formatDate(last),
      };
    }
    case 'qoq': {
      const quarter = Math.floor(date.getMonth() / 3); // 0=Q1, 1=Q2, 2=Q3, 3=Q4
      const firstMonth = quarter * 3; // 0, 3, 6, 9
      const first = new Date(year, firstMonth, 1);
      const last = new Date(year, firstMonth + 3, 0); // Last day of quarter's last month
      return {
        periodId: `${year}-Q${quarter + 1}`,
        periodLabel: `Q${quarter + 1} ${year}`,
        startDate: formatDate(first),
        endDate: formatDate(last),
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
): PeriodDescriptor[] {
  const reference = getPeriodFromDate(referenceDateStr, type);
  const periods: PeriodDescriptor[] = [reference];

  for (let i = 1; i < count; i++) {
    const prev = getPreviousPeriod(periods[0], type);
    periods.unshift(prev);
  }

  return periods;
}

/**
 * Get the period descriptor for the period immediately preceding the
 * given period.
 */
function getPreviousPeriod(period: PeriodDescriptor, type: PeriodComparisonType): PeriodDescriptor {
  const startDate = new Date(period.startDate + 'T00:00:00');

  switch (type) {
    case 'wow': {
      // Go back 7 days from the start of this period to get the previous Monday
      const prevMonday = new Date(startDate);
      prevMonday.setDate(startDate.getDate() - 7);
      return getPeriodFromDate(formatDate(prevMonday), 'wow');
    }
    case 'mom': {
      // Go to the 1st of the previous month
      const prevMonth = startDate.getMonth() - 1;
      const year = prevMonth < 0 ? startDate.getFullYear() - 1 : startDate.getFullYear();
      const month = prevMonth < 0 ? 11 : prevMonth;
      const midOfPrevMonth = new Date(year, month, 15);
      return getPeriodFromDate(formatDate(midOfPrevMonth), 'mom');
    }
    case 'qoq': {
      // Go back 3 months
      const prevQuarterStart = new Date(startDate);
      prevQuarterStart.setMonth(startDate.getMonth() - 3);
      return getPeriodFromDate(formatDate(prevQuarterStart), 'qoq');
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
): Map<string, PeriodMatrixTradeInput[]> {
  const map = new Map<string, PeriodMatrixTradeInput[]>();

  for (const p of periods) {
    map.set(p.periodId, []);
  }

  for (const trade of trades) {
    if (!trade.closedAt) continue;
    const tradeDate = trade.closedAt.slice(0, 10);

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
    const { totalRealizedPnL } = calculatePnL(trade.executions, trade.direction);
    totalPnl += totalRealizedPnL;
    pnls.push(totalRealizedPnL);

    const initialRiskAmount = trade.riskSnapshot?.initialRiskAmount ?? null;
    const { rMultiple } = calculateRMultiple(totalRealizedPnL, initialRiskAmount);
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
 * @param maxPeriods Maximum number of periods to include (default 4, minimum 2)
 * @returns PeriodMatrixResult with comparison rows
 */
export function computePeriodMatrix(
  trades: PeriodMatrixTradeInput[],
  type: PeriodComparisonType,
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
  const periods = generatePriorPeriods(latestDate, type, maxPeriodsClamped);

  // Assign trades to periods
  const assigned = assignTradesToPeriods(trades, periods);

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
