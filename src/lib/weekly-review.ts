/**
 * weekly-review.ts
 *
 * Pure (no side effects) weekly review aggregation library.
 * Accepts closed trades with pre-fetched executions, grades, and risk
 * snapshots. Computes aggregated metrics for a weekly review period.
 * Decoupled from Drizzle — tests independently without a database.
 *
 * Pattern: src/lib/trade-calc.ts, src/lib/grading.ts
 */

import { computeTradeMetrics, type ExecutionData } from './trade-metrics';
import { computeWinRate, averageRMultiples, averageProcessScore } from './metrics';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * A single closed trade with pre-fetched related data.
 *
 * - executions:   All trade_executions for this trade (used by calculatePnL)
 * - grade:        trade_grades row, or null if the trade was not graded
 * - riskSnapshot: trade_risk_snapshots row, or null if not assessed
 */
export interface WeekReviewTradeInput {
  id: string;
  direction: 'long' | 'short';
  executions: ExecutionData[];
  grade: { totalScore: number } | null;
  riskSnapshot: { initialRiskAmount: number | null } | null;
}

/**
 * Aggregated weekly metrics.
 *
 * - closedTrades:       Number of closed trades analyzed
 * - netPnl:             Sum of all realized P&L (including fees)
 * - avgR:               Mean R-multiple across trades with risk data, or null
 * - winRate:            Fraction of trades with positive P&L (0–1)
 * - avgProcessScore:    Mean grade totalScore across graded trades, or null
 * - ungradedCount:      Trades without a grade
 * - unassessedRiskCount: Trades without risk snapshot or initialRiskAmount
 */
export interface AggregatedMetrics {
  closedTrades: number;
  netPnl: number;
  avgR: number | null;
  winRate: number;
  avgProcessScore: number | null;
  ungradedCount: number;
  unassessedRiskCount: number;
}

// ── Library ─────────────────────────────────────────────────────────────

/**
 * Compute aggregated weekly review metrics from an array of closed trades.
 *
 * Each trade must have its executions, grade, and risk snapshot pre-loaded;
 * this function performs no database queries.
 *
 * Win definition: >0 realized P&L (including fees) = win.
 *                             <=0 realized P&L = loss.
 *
 * R-multiple:     Skipped (null) when initialRiskAmount is missing or <= 0.
 * Process score:  Skipped (null) when grade or grade.totalScore is null.
 */
export function computeWeeklyMetrics(trades: WeekReviewTradeInput[]): AggregatedMetrics {
  const closedTrades = trades.length;

  let netPnl = 0;
  const pnls: number[] = [];
  const rMultiples: number[] = [];
  const processScores: number[] = [];
  let ungradedCount = 0;
  let unassessedRiskCount = 0;

  for (const trade of trades) {
    // ── P&L ──────────────────────────────────────────────────────────
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
    netPnl += totalRealizedPnL;
    pnls.push(totalRealizedPnL);

    // ── R-multiple ───────────────────────────────────────────────────
    const initialRiskAmount = trade.riskSnapshot?.initialRiskAmount ?? null;
    if (initialRiskAmount === null || initialRiskAmount === undefined) {
      unassessedRiskCount++;
    }
    const rMultiple = metrics.returnMetrics.rMultiple;
    if (rMultiple !== null) {
      rMultiples.push(rMultiple);
    }

    // ── Process score ────────────────────────────────────────────────
    if (trade.grade !== null && trade.grade.totalScore !== null && trade.grade.totalScore !== undefined) {
      processScores.push(trade.grade.totalScore);
    } else {
      ungradedCount++;
    }
  }

  // ── Averages ─────────────────────────────────────────────────────
  const avgR = averageRMultiples(rMultiples);
  const avgProcessScore = averageProcessScore(processScores);
  const winRate = computeWinRate(pnls, 'allDecisions') ?? 0;

  return {
    closedTrades,
    netPnl,
    avgR,
    winRate,
    avgProcessScore,
    ungradedCount,
    unassessedRiskCount,
  };
}
