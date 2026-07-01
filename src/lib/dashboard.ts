/**
 * dashboard.ts
 *
 * Pure (no side effects) dashboard KPI computation library.
 * Computes aggregate key performance indicators from trade data
 * for the dashboard home page. Decoupled from Drizzle — uses
 * its own input types so tests run independently without a database.
 *
 * Pattern: src/lib/weekly-review.ts, src/lib/review-dashboard.ts
 */

import { calculatePnL, calculateRMultiple, type ExecutionData } from './trade-calc';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * A single trade with pre-fetched related data for KPI computation.
 *
 * - executions:   All trade_executions for this trade (used by calculatePnL)
 * - grade:        trade_grades row, or null if the trade was not graded
 * - riskSnapshot: trade_risk_snapshots row, or null if not assessed
 */
export interface KpiTradeInput {
  id: string;
  direction: 'long' | 'short';
  status: string;
  executions: ExecutionData[];
  grade: { totalScore: number } | null;
  riskSnapshot: { initialRiskAmount: number | null } | null;
  closedAt: string | null;
}

/**
 * A single row from the account_rollforward table.
 */
export interface RollforwardRow {
  date: string;
  endingEquity: number | null;
  drawdownAmount: number | null;
  drawdownPct: number | null;
  cumulativePnl: number | null;
  highWaterMark: number | null;
}

/**
 * Dashboard KPI metrics returned by computeKpiMetrics.
 *
 * - totalTrades:       Total number of all trades (any status)
 * - openTrades:        Count of trades with active status (open, partially_closed)
 * - winRate:           Fraction of closed trades with positive P&L (0-1).
 *                      $0 P&L is counted as loss (per D013).
 *                      Null when there are no closed trades.
 * - netPnl:            Sum of realized P&L across all closed trades
 * - avgR:              Mean R-multiple across closed trades with valid risk data,
 *                      or null when none have valid risk
 * - avgGrade:          Mean trade_grades.totalScore across graded closed trades,
 *                      or null when none are graded
 * - currentDrawdown:   Latest account drawdown in currency, or null
 * - currentDrawdownPct: Latest account drawdown as percentage, or null
 * - accountValue:      Latest account value (rollforward endingEquity, fallback
 *                      to settings.startingAccountValue, fallback to null)
 */
export interface KpiMetrics {
  totalTrades: number;
  openTrades: number;
  winRate: number | null;
  netPnl: number;
  avgR: number | null;
  avgGrade: number | null;
  currentDrawdown: number | null;
  currentDrawdownPct: number | null;
  accountValue: number | null;
}

/**
 * A single monthly performance data point.
 *
 * - month:        YYYY-MM string identifying the month
 * - netPnl:       Sum of realized P&L for all closed trades in this month
 * - winRate:      Win rate for this month (per D013), or null if no trades
 * - tradeCount:   Number of closed decisions (wins + losses) in this month
 */
export interface MonthlyPerformanceItem {
  month: string;
  netPnl: number;
  winRate: number | null;
  tradeCount: number;
}

/**
 * A single bin for the R-multiple distribution histogram.
 *
 * - label:   Human-readable bin label (e.g. "-3 to -2", "> 3")
 * - count:   Number of trades whose R-multiple falls in this bin
 */
export interface RDistributionBin {
  label: string;
  count: number;
}

/**
 * Directional performance breakdown for long vs short closed trades.
 * Each side has netPnl, winRate (null if no trades), and tradeCount.
 */
export interface DirectionalPerformanceResult {
  long: { netPnl: number; winRate: number | null; tradeCount: number };
  short: { netPnl: number; winRate: number | null; tradeCount: number };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Compute win rate as wins / decisions.
 *
 * Returns null when decisions === 0 (no trades with meaningful win/loss outcome).
 */
export function computeWinRate(wins: number, decisions: number): number | null {
  if (decisions === 0) return null;
  return wins / decisions;
}

// ────────────────────────────────────────────────────────────────────────────
// Monthly Performance & R Distribution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Monthly performance bins for bar-chart display.
 *
 * For each month with closed trades, computes:
 * - netPnl:  Sum of realized P&L
 * - winRate: Per-month win rate using D013 win/loss semantics
 * - tradeCount: Number of closed trade decisions
 *
 * Months are sorted chronologically by YYYY-MM.
 * Only months with at least one closed trade appear (no zero-filled gaps).
 */
export function computeMonthlyPerformance(
  closedTrades: KpiTradeInput[],
): MonthlyPerformanceItem[] {
  const closed = closedTrades.filter(
    (t) => t.status === 'closed' && t.closedAt !== null && t.closedAt !== undefined,
  );

  const groups = new Map<string, { netPnl: number; wins: number; decisions: number }>();

  for (const trade of closed) {
    const month = (trade.closedAt as string).substring(0, 7); // YYYY-MM
    const { totalRealizedPnL } = calculatePnL(trade.executions, trade.direction);

    let g = groups.get(month);
    if (!g) {
      g = { netPnl: 0, wins: 0, decisions: 0 };
      groups.set(month, g);
    }

    g.netPnl += totalRealizedPnL;

    // Per D013: >0 P&L = win, <=0 = loss
    if (totalRealizedPnL > 0) {
      g.wins++;
    }
    g.decisions++;
  }

  const months = Array.from(groups.keys()).sort();

  return months.map((month) => {
    const g = groups.get(month)!;
    return {
      month,
      netPnl: g.netPnl,
      winRate: computeWinRate(g.wins, g.decisions),
      tradeCount: g.decisions,
    };
  });
}

/**
 * R-multiple distribution bins for histogram display.
 *
 * Assigns each closed trade with a valid (non-null) R-multiple into one of 8 bins.
 * Returns all 8 bins with zero-fill for empty bins.
 * Trades without valid risk data are excluded.
 */
export function computeRDistribution(
  closedTrades: KpiTradeInput[],
): RDistributionBin[] {
  // Bin definitions: [label, lowerBound (inclusive), upperBound (exclusive)]
  // The last bin (>3) has no upper bound.
  const binDefs: { label: string; min: number; max: number | null }[] = [
    { label: '<= -3', min: -Infinity, max: -3 },
    { label: '-3 to -2', min: -3, max: -2 },
    { label: '-2 to -1', min: -2, max: -1 },
    { label: '-1 to 0', min: -1, max: 0 },
    { label: '0 to 1', min: 0, max: 1 },
    { label: '1 to 2', min: 1, max: 2 },
    { label: '2 to 3', min: 2, max: 3 },
    { label: '> 3', min: 3, max: null },
  ];

  const counts = new Array<number>(binDefs.length).fill(0);

  for (const trade of closedTrades) {
    const { totalRealizedPnL } = calculatePnL(trade.executions, trade.direction);
    const initialRiskAmount = trade.riskSnapshot?.initialRiskAmount ?? null;
    const { rMultiple } = calculateRMultiple(totalRealizedPnL, initialRiskAmount);

    if (rMultiple === null) continue;

    for (let i = 0; i < binDefs.length; i++) {
      const bin = binDefs[i];
      if (i === binDefs.length - 1) {
        // Last bin: >= min
        if (rMultiple >= bin.min) {
          counts[i]++;
          break;
        }
      } else if (bin.max !== null && rMultiple >= bin.min && rMultiple < bin.max) {
        counts[i]++;
        break;
      }
    }
  }

  return binDefs.map((bin, i) => ({
    label: bin.label,
    count: counts[i],
  }));
}

/**
 * Compute directional performance breakdown (long vs short) for closed trades.
 *
 * Each trade is bucketed by direction, then:
 * - netPnl: Sum of realized P&L via calculatePnL
 * - winRate: Win rate per D013 (P&L > 0 = win, null if no trades in bucket)
 * - tradeCount: Number of closed trade decisions in bucket
 *
 * Returns a DirectionalPerformanceResult with long and short sides.
 */
export function computeDirectionalPerformance(
  closedTrades: KpiTradeInput[],
): DirectionalPerformanceResult {
  const buckets: Record<string, { netPnl: number; wins: number; decisions: number }> = {
    long: { netPnl: 0, wins: 0, decisions: 0 },
    short: { netPnl: 0, wins: 0, decisions: 0 },
  };

  for (const trade of closedTrades) {
    const dir = trade.direction as keyof typeof buckets;
    if (!buckets[dir]) continue;

    const { totalRealizedPnL } = calculatePnL(trade.executions, trade.direction);
    buckets[dir].netPnl += totalRealizedPnL;

    // Per D013: >0 P&L = win, <=0 = loss
    if (totalRealizedPnL > 0) {
      buckets[dir].wins++;
    }
    buckets[dir].decisions++;
  }

  return {
    long: {
      netPnl: buckets.long.netPnl,
      winRate: computeWinRate(buckets.long.wins, buckets.long.decisions),
      tradeCount: buckets.long.decisions,
    },
    short: {
      netPnl: buckets.short.netPnl,
      winRate: computeWinRate(buckets.short.wins, buckets.short.decisions),
      tradeCount: buckets.short.decisions,
    },
  };
}

// ── Library ─────────────────────────────────────────────────────────────

/**
 * Compute dashboard KPI metrics from trade data.
 *
 * Pure function — no database queries. All trade relations must be pre-loaded.
 *
 * Win definition (per D013): >0 realized P&L = win.
 *                             <=0 realized P&L = loss (including $0 scratches).
 *
 * R-multiple:     Skipped (null) when initialRiskAmount is missing or <= 0.
 * Grade:          Skipped (null) when grade or grade.totalScore is null.
 * Account value:  Uses latestRollforward.endingEquity when available,
 *                 falls back to startingAccountValue (from settings),
 *                 falls back to null when neither is provided.
 *
 * @param allTrades            All trades in the account (any status)
 * @param closedTrades         Subset of allTrades that are closed (for P&L metrics)
 * @param latestRollforward    Most recent account_rollforward row, or null
 * @param startingAccountValue settings.startingAccountValue, or null
 */
export function computeKpiMetrics(
  allTrades: KpiTradeInput[],
  closedTrades: KpiTradeInput[],
  latestRollforward: RollforwardRow | null,
  startingAccountValue: number | null,
): KpiMetrics {
  // ── Trade counts ─────────────────────────────────────────────────
  const totalTrades = allTrades.length;
  const openTrades = allTrades.filter(
    (t) => t.status === 'open' || t.status === 'partially_closed',
  ).length;

  // ── Closed trade metrics ─────────────────────────────────────────
  let netPnl = 0;
  let wins = 0;
  let decisions = 0; // wins + losses (all trades, scratches counted as losses per D013)
  const rMultiples: number[] = [];
  const gradeScores: number[] = [];

  for (const trade of closedTrades) {
    // P&L
    const { totalRealizedPnL } = calculatePnL(trade.executions, trade.direction);
    netPnl += totalRealizedPnL;

    // Win rate: >0 = win, <=0 = loss (D013: $0 counted as loss)
    if (totalRealizedPnL > 0) {
      wins++;
    }
    decisions++;

    // R-multiple
    const initialRiskAmount = trade.riskSnapshot?.initialRiskAmount ?? null;
    const { rMultiple } = calculateRMultiple(totalRealizedPnL, initialRiskAmount);
    if (rMultiple !== null) {
      rMultiples.push(rMultiple);
    }

    // Grade
    if (trade.grade !== null && trade.grade.totalScore !== null && trade.grade.totalScore !== undefined) {
      gradeScores.push(trade.grade.totalScore);
    }
  }

  // ── Averages ─────────────────────────────────────────────────────
  const winRate = computeWinRate(wins, decisions);
  const avgR =
    rMultiples.length > 0
      ? rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length
      : null;
  const avgGrade =
    gradeScores.length > 0
      ? gradeScores.reduce((sum, s) => sum + s, 0) / gradeScores.length
      : null;

  // ── Account value ────────────────────────────────────────────────
  const accountValue = latestRollforward?.endingEquity ?? startingAccountValue ?? null;

  // ── Drawdown ─────────────────────────────────────────────────────
  const currentDrawdown = latestRollforward?.drawdownAmount ?? null;
  const currentDrawdownPct = latestRollforward?.drawdownPct ?? null;

  return {
    totalTrades,
    openTrades,
    winRate,
    netPnl,
    avgR,
    avgGrade,
    currentDrawdown,
    currentDrawdownPct,
    accountValue,
  };
}
