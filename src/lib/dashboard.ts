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
}

/**
 * A single row from the account_rollforward table.
 */
export interface RollforwardRow {
  endingEquity: number;
  drawdownAmount: number;
  drawdownPct: number;
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
