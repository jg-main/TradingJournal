/**
 * review-dashboard.ts
 *
 * Pure (no side effects) dashboard performance aggregation library.
 * Accepts closed trades with pre-fetched executions, grades, and risk
 * snapshots. Groups by setupId and computes per-setup metrics.
 * Decoupled from Drizzle — tests independently without a database.
 *
 * Pattern: src/lib/weekly-review.ts
 */

import { calculatePnL, calculateRMultiple, type ExecutionData } from './trade-calc';
import { computeWinRate, averageRMultiples, averageProcessScore } from './metrics';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * A single closed trade with pre-fetched related data, plus its setup.
 *
 * - executions:   All trade_executions for this trade (used by calculatePnL)
 * - grade:        trade_grades row, or null if the trade was not graded
 * - riskSnapshot: trade_risk_snapshots row, or null if not assessed
 * - setupId:      Foreign key into lookup_values with type='setup', or null
 */
export interface SetupPerfTradeInput {
  id: string;
  direction: 'long' | 'short';
  executions: ExecutionData[];
  grade: { totalScore: number | null } | null;
  riskSnapshot: { initialRiskAmount: number | null } | null;
  setupId: string | null;
}

/**
 * Sample size warning levels based on trade count thresholds.
 *
 * - very_small:  1–4 trades  (red — too few to draw conclusions)
 * - small:       5–19 trades (amber — interpret with caution)
 * - moderate:    20–29 trades (blue — trends may be forming)
 * - adequate:    30+ trades   (green — adequate for analysis)
 */
export type SampleSizeWarning = 'very_small' | 'small' | 'moderate' | 'adequate';

/**
 * Per-setup performance metrics.
 *
 * - setupName:       Display name resolved from setupNameMap, or raw setupId
 * - setupId:         The setup lookup value ID
 * - count:           Number of closed trades in this setup group
 * - winRate:         Fraction of decisions (excl. scratches) with positive P&L (0–1)
 *                    Scratches (PnL === 0) are excluded from the denominator.
 *                    Null when all trades in the group are scratches.
 * - avgR:            Mean R-multiple across trades with valid risk data, or null
 * - avgProcessScore: Mean grade totalScore across graded trades, or null
 * - sampleSizeWarning: Derived from count thresholds
 */
export interface SetupPerfResult {
  setupName: string;
  setupId: string | null;
  count: number;
  winRate: number | null;
  avgR: number | null;
  avgProcessScore: number | null;
  sampleSizeWarning: SampleSizeWarning;
}

/**
 * Overall dashboard metrics returned by computeSetupPerformance.
 *
 * - setupPerformance: Per-setup metrics array, sorted by count descending
 * - totalTrades:      Total number of trades analyzed
 * - ungroupedTrades:  Trades with null setupId, included only when
 *                     includeUnknownGroup is true
 */
export interface DashboardMetrics {
  setupPerformance: SetupPerfResult[];
  totalTrades: number;
  ungroupedTrades: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function deriveSampleSizeWarning(count: number): SampleSizeWarning {
  if (count <= 4) return 'very_small';
  if (count <= 19) return 'small';
  if (count <= 29) return 'moderate';
  return 'adequate';
}

// ── Library ─────────────────────────────────────────────────────────────

/**
 * Compute per-setup dashboard performance metrics from an array of closed
 * trades. Groups trades by setupId and computes aggregate metrics for each
 * setup group.
 *
 * Each trade must have its executions, grade, risk snapshot, and setupId
 * pre-loaded; this function performs no database queries.
 *
 * Win definition: >0 realized P&L (including fees) = win.
 *                 <0 realized P&L = loss.
 *                 === 0 realized P&L = scratch (excluded from win rate).
 * R-multiple:     Skipped (null) when initialRiskAmount is missing or <= 0.
 * Process score:  Skipped (null) when grade or grade.totalScore is null.
 *
 * @param trades         Array of closed trades with pre-loaded relations
 * @param setupNameMap   Optional map of setupId → display name. Unmapped IDs
 *                       use the raw setupId string as the display name.
 * @param includeUnknownGroup When true, trades with null setupId are grouped
 *                            under setupName "Unknown" / setupId null.
 *                            When false (default), null-setupId trades are
 *                            silently excluded from per-setup results.
 */
export function computeSetupPerformance(
  trades: SetupPerfTradeInput[],
  setupNameMap?: Record<string, string>,
  includeUnknownGroup = false,
): DashboardMetrics {
  // ── Group by setupId ──────────────────────────────────────────────
  const grouped = new Map<string | '__null__', SetupPerfTradeInput[]>();

  for (const trade of trades) {
    const key = trade.setupId ?? '__null__';
    const group = grouped.get(key);
    if (group) {
      group.push(trade);
    } else {
      grouped.set(key, [trade]);
    }
  }

  const setupPerformance: SetupPerfResult[] = [];
  let ungroupedTrades = 0;

  for (const [key, groupTrades] of grouped) {
    // Determine if this is the null-setupId group
    const isNullGroup = key === '__null__';

    if (isNullGroup) {
      ungroupedTrades = groupTrades.length;
      if (!includeUnknownGroup) continue;
    }

    const tradeCount = groupTrades.length;
    const pnls: number[] = [];
    const rMultiples: number[] = [];
    const processScores: number[] = [];

    for (const trade of groupTrades) {
      const { totalRealizedPnL } = calculatePnL(trade.executions, trade.direction);

      // Collect PnL for policy-based win rate computation (excludeScratches handles scratches)
      pnls.push(totalRealizedPnL);

      // R-multiple
      const initialRiskAmount = trade.riskSnapshot?.initialRiskAmount ?? null;
      const { rMultiple } = calculateRMultiple(totalRealizedPnL, initialRiskAmount);
      if (rMultiple !== null) {
        rMultiples.push(rMultiple);
      }

      // Process score
      if (trade.grade !== null && trade.grade.totalScore !== null && trade.grade.totalScore !== undefined) {
        processScores.push(trade.grade.totalScore);
      }
    }

    const winRate = computeWinRate(pnls, 'excludeScratches');
    const avgR = averageRMultiples(rMultiples);
    const avgProcessScore = averageProcessScore(processScores);

    const setupId = isNullGroup ? null : key;
    const setupName = isNullGroup
      ? 'Unknown'
      : (setupNameMap?.[key] ?? key);

    setupPerformance.push({
      setupName,
      setupId,
      count: tradeCount,
      winRate,
      avgR,
      avgProcessScore,
      sampleSizeWarning: deriveSampleSizeWarning(tradeCount),
    });
  }

  // Sort by count descending
  setupPerformance.sort((a, b) => b.count - a.count);

  return {
    setupPerformance,
    totalTrades: trades.length,
    ungroupedTrades,
  };
}
