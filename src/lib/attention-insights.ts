/**
 * attention-insights.ts
 *
 * Pure computation library for deterministic, data-driven observations
 * surfaced from trade data. Follows the M026 pattern: no DB imports,
 * no NextResponse — pure functions only.
 *
 * Takes an array of closed/open trades with their executions, grades,
 * risk snapshots, and metadata. Computes observations like:
 *   - "Your win rate on Tuesdays is 3x higher than Wednesdays"
 *   - "5 trades last week had no stop recorded"
 *   - "You're on a 4-trade losing streak"
 *
 * Each observation is a deterministic calculation — no ML, no heuristics
 * that change between runs for the same data.
 */

import { computeTradeMetrics, type ExecutionData } from './trade-metrics';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Severity level for an attention insight.
 * - 'critical': Actionable issue that may impact risk or account health
 * - 'warning': Notable pattern worth reviewing
 * - 'info': Positive or neutral observation
 */
export type InsightSeverity = 'critical' | 'warning' | 'info';

/**
 * A single deterministic observation surfaced from trade data.
 */
export interface AttentionInsight {
  /** Machine-readable category for the observation type */
  type: string;
  /** Urgency classification */
  severity: InsightSeverity;
  /** Short headline (e.g. "Tuesday is your best trading day") */
  title: string;
  /** Human-readable description of the observation */
  message: string;
  /** Optional numeric value backing the insight */
  value?: number | string;
}

/**
 * Input shape for a single trade to be analyzed.
 * Pre-joined data — no DB references.
 */
export interface AttentionInsightTradeInput {
  id: string;
  direction: 'long' | 'short';
  executions: ExecutionData[];
  /** Risk snapshot at trade open, or null if no stop was recorded */
  riskSnapshot: { initialRiskAmount: number | null } | null;
  /** Grade assigned at trade close, or null if ungraded */
  grade: { totalScore: number | null } | null;
  /** ISO date string of when the trade closed, or null if still open */
  closedAt: string | null;
  /** ISO date string of when the trade opened, or null */
  openedAt?: string | null;
  /** Setup lookup ID, or null if no setup was recorded */
  setupId: string | null;
}

/**
 * Result from the attention insights computation.
 */
export interface AttentionInsightsResult {
  /** Ordered array of insights (most important first) */
  insights: AttentionInsight[];
  /** Total number of trades analyzed */
  tradeCount: number;
}

// ── Day-of-week helpers ─────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getDayOfWeek(isoDate: string): number | null {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;
  return d.getUTCDay();
}

// ── Streak detection ────────────────────────────────────────────────────

/**
 * Determine if a trade's P&L (excluding entry fees) is positive.
 * Trades with zero P&L are scratches (neither win nor loss).
 */
function classifyTradeOutcome(pnl: number): 'win' | 'loss' | 'scratch' {
  if (pnl > 0) return 'win';
  if (pnl < 0) return 'loss';
  return 'scratch';
}

// ── 1. Day-of-week win rate comparison ─────────────────────────────────

/**
 * Compute win rate by day of the week from closed trades.
 *
 * Uses excludeScratches semantics: trades with P&L === 0 are excluded
 * from both the numerator and denominator.
 */
function computeDayOfWeekWinRates(
  trades: AttentionInsightTradeInput[],
): { dayName: string; dayIndex: number; wins: number; losses: number; winRate: number | null }[] {
  const dayStats = new Map<number, { wins: number; losses: number }>();

  for (const trade of trades) {
    if (!trade.closedAt) continue;
    const dayIndex = getDayOfWeek(trade.closedAt);
    if (dayIndex === null) continue;

    const metrics = computeTradeMetrics({
      executions: trade.executions,
      direction: trade.direction,
      riskSnapshot: null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    });
    const totalRealizedPnL = metrics.realizedPnl.netRealizedPnl;

    // Skip scratches (PnL === 0) following excludeScratches semantics
    if (totalRealizedPnL === 0) continue;

    const stats = dayStats.get(dayIndex) ?? { wins: 0, losses: 0 };
    if (totalRealizedPnL > 0) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    dayStats.set(dayIndex, stats);
  }

  const results: { dayName: string; dayIndex: number; wins: number; losses: number; winRate: number | null }[] = [];

  for (const [dayIndex, stats] of dayStats) {
    const total = stats.wins + stats.losses;
    const winRate = total > 0 ? stats.wins / total : null;
    results.push({
      dayName: DAY_NAMES[dayIndex] ?? `Day ${dayIndex}`,
      dayIndex,
      wins: stats.wins,
      losses: stats.losses,
      winRate,
    });
  }

  results.sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
  return results;
}

/**
 * Find the best and worst trading days by win rate.
 * Returns insights only when there are at least 2 days with data and
 * the gap between best and worst is meaningful (>20 percentage points).
 */
function createDayOfWeekInsights(
  trades: AttentionInsightTradeInput[],
): AttentionInsight[] {
  const dayRates = computeDayOfWeekWinRates(trades);

  // Need at least 2 days with data
  const daysWithData = dayRates.filter((d) => d.winRate !== null);
  if (daysWithData.length < 2) return [];

  const bestDay = daysWithData[0];
  const worstDay = daysWithData[daysWithData.length - 1];

  if (bestDay.winRate == null || worstDay.winRate == null) return [];

  const gap = bestDay.winRate - worstDay.winRate;

  // Only surface if the gap is meaningful (>20pp) or if the worst day has <=30% WR
  if (gap <= 0.2 && worstDay.winRate >= 0.3) return [];

  const multiplier = worstDay.winRate > 0
    ? (bestDay.winRate / worstDay.winRate).toFixed(1)
    : '∞';

  const totalBestTrades = bestDay.wins + bestDay.losses;
  const totalWorstTrades = worstDay.wins + worstDay.losses;

  const insights: AttentionInsight[] = [];

  // Best day insight
  insights.push({
    type: 'day_of_week_best',
    severity: 'info',
    title: `${bestDay.dayName} is your best trading day`,
    message: `${bestDay.dayName}: ${(bestDay.winRate * 100).toFixed(0)}% win rate across ${totalBestTrades} trades. That's ${multiplier}x better than ${worstDay.dayName} (${(worstDay.winRate * 100).toFixed(0)}% across ${totalWorstTrades} trades).`,
    value: `${(bestDay.winRate * 100).toFixed(0)}%`,
  });

  // Worst day insight (only if severity warrants)
  if (worstDay.winRate < 0.4 && totalWorstTrades >= 3) {
    insights.push({
      type: 'day_of_week_worst',
      severity: 'warning',
      title: `Avoid trading on ${worstDay.dayName}?`,
      message: `${worstDay.dayName} has a ${(worstDay.winRate * 100).toFixed(0)}% win rate across ${totalWorstTrades} trades. Review your trading on this day to identify any recurring issues.`,
      value: `${(worstDay.winRate * 100).toFixed(0)}%`,
    });
  }

  return insights;
}

// ── 2. Trades without stop loss ──────────────────────────────────────────

function createNoStopInsights(
  trades: AttentionInsightTradeInput[],
): AttentionInsight[] {
  const closedTrades = trades.filter((t) => t.closedAt !== null);
  const noStopTrades = closedTrades.filter(
    (t) => t.riskSnapshot === null || t.riskSnapshot.initialRiskAmount === null,
  );

  if (noStopTrades.length === 0) return [];

  const pct = ((noStopTrades.length / closedTrades.length) * 100).toFixed(0);

  return [
    {
      type: 'no_stop_loss',
      severity: noStopTrades.length >= 5 ? 'critical' : 'warning',
      title: `${noStopTrades.length} trade${noStopTrades.length === 1 ? '' : 's'} had no stop loss recorded`,
      message: `${noStopTrades.length} of ${closedTrades.length} closed trade${closedTrades.length === 1 ? '' : 's'} (${pct}%) had no stop loss recorded. Trades without predefined risk limits can lead to outsized losses.`,
      value: noStopTrades.length,
    },
  ];
}

// ── 3. Ungraded trades ───────────────────────────────────────────────────

function createUngradedTradeInsights(
  trades: AttentionInsightTradeInput[],
): AttentionInsight[] {
  const closedTrades = trades.filter((t) => t.closedAt !== null);
  const ungradedTrades = closedTrades.filter(
    (t) => t.grade === null || t.grade.totalScore === null,
  );

  if (ungradedTrades.length === 0) return [];

  const pct = ((ungradedTrades.length / closedTrades.length) * 100).toFixed(0);

  return [
    {
      type: 'ungraded_trades',
      severity: ungradedTrades.length >= 5 ? 'warning' : 'info',
      title: `${ungradedTrades.length} closed trade${ungradedTrades.length === 1 ? '' : 's'} not graded`,
      message: `${ungradedTrades.length} of ${closedTrades.length} closed trade${closedTrades.length === 1 ? '' : 's'} (${pct}%) were never graded. Grading helps track process discipline and identify improvement areas.`,
      value: ungradedTrades.length,
    },
  ];
}

// ── 4. Top & worst trades by R-multiple ─────────────────────────────────

function createExtremeTradeInsights(
  trades: AttentionInsightTradeInput[],
): AttentionInsight[] {
  const closedTrades = trades.filter((t) => t.closedAt !== null);

  const tradeResults: { id: string; pnl: number; rMultiple: number | null; trade: AttentionInsightTradeInput }[] = [];

  for (const trade of closedTrades) {
    const metrics = computeTradeMetrics({
      executions: trade.executions,
      direction: trade.direction,
      riskSnapshot: trade.riskSnapshot != null
        ? { initialRiskAmount: trade.riskSnapshot.initialRiskAmount, accountEquityAtOpen: null }
        : null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    });
    const totalRealizedPnL = metrics.realizedPnl.netRealizedPnl;
    const rMultiple = metrics.returnMetrics.rMultiple;
    tradeResults.push({ id: trade.id, pnl: totalRealizedPnL, rMultiple, trade });
  }

  const insights: AttentionInsight[] = [];

  // Best trade by R-multiple
  const tradesWithR = tradeResults.filter((t) => t.rMultiple !== null && t.rMultiple > 0);
  if (tradesWithR.length > 0) {
    tradesWithR.sort((a, b) => b.rMultiple! - a.rMultiple!);
    const best = tradesWithR[0];
    insights.push({
      type: 'top_trade',
      severity: 'info',
      title: `Best trade: ${best.rMultiple!.toFixed(1)}R`,
      message: `Your best trade returned ${best.rMultiple!.toFixed(1)}R with a P&L of $${best.pnl.toFixed(2)}.`,
      value: `${best.rMultiple!.toFixed(1)}R`,
    });
  }

  // Worst trade by R-multiple (most negative)
  const tradesWithNegativeR = tradeResults.filter((t) => t.rMultiple !== null && t.rMultiple < 0);
  if (tradesWithNegativeR.length > 0) {
    tradesWithNegativeR.sort((a, b) => a.rMultiple! - b.rMultiple!);
    const worst = tradesWithNegativeR[0];
    insights.push({
      type: 'worst_trade',
      severity: worst.rMultiple! < -3 ? 'critical' : worst.rMultiple! < -2 ? 'warning' : 'info',
      title: `Worst trade: ${worst.rMultiple!.toFixed(1)}R`,
      message: `Your worst trade returned ${worst.rMultiple!.toFixed(1)}R with a P&L of $${worst.pnl.toFixed(2)}. Review what went wrong to avoid similar outcomes.`,
      value: `${worst.rMultiple!.toFixed(1)}R`,
    });
  }

  return insights;
}

// ── 5. Current win/loss streak ──────────────────────────────────────────

function createStreakInsights(
  trades: AttentionInsightTradeInput[],
): AttentionInsight[] {
  // Only analyze closed trades, ordered by closedAt ascending
  const closedTrades = trades
    .filter((t) => t.closedAt !== null)
    .sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''));

  if (closedTrades.length < 3) return [];

  const outcomes: ('win' | 'loss' | 'scratch')[] = closedTrades.map((trade) => {
    const metrics = computeTradeMetrics({
      executions: trade.executions,
      direction: trade.direction,
      riskSnapshot: null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    });
    return classifyTradeOutcome(metrics.realizedPnl.netRealizedPnl);
  });

  // Find the current streak (from most recent trade backwards)
  const currentStreak: ('win' | 'loss' | 'scratch')[] = [];
  for (let i = outcomes.length - 1; i >= 0; i--) {
    const outcome = outcomes[i];
    if (outcome === 'scratch') continue; // skip scratches in streaks
    if (currentStreak.length === 0 || outcome === currentStreak[0]) {
      currentStreak.push(outcome);
    } else {
      break;
    }
  }

  if (currentStreak.length < 2) return [];

  const streakType = currentStreak[0];
  const streakCount = currentStreak.length;

  if (streakType === 'win') {
    return [
      {
        type: 'win_streak',
        severity: streakCount >= 5 ? 'info' : 'info',
        title: `On a ${streakCount}-trade winning streak`,
        message: `You've won ${streakCount} consecutive trade${streakCount === 1 ? '' : 's'}. Keep following your process.`,
        value: streakCount,
      },
    ];
  }

  return [
    {
      type: 'losing_streak',
      severity: streakCount >= 3 ? 'warning' : streakCount >= 2 ? 'info' : 'info',
      title: `On a ${streakCount}-trade losing streak`,
      message: `You've lost ${streakCount} consecutive trade${streakCount === 1 ? '' : 's'}. Consider reducing position size or taking a break to reassess.`,
      value: streakCount,
    },
  ];
}

// ── 6. Setup concentration ──────────────────────────────────────────────

function createSetupConcentrationInsights(
  trades: AttentionInsightTradeInput[],
): AttentionInsight[] {
  const closedTrades = trades.filter((t) => t.closedAt !== null);
  if (closedTrades.length < 10) return [];

  const setupCounts = new Map<string | '__null__', number>();
  for (const trade of closedTrades) {
    const key = trade.setupId ?? '__null__';
    setupCounts.set(key, (setupCounts.get(key) ?? 0) + 1);
  }

  const uniqueSetups = setupCounts.size;
  const nullCount = setupCounts.get('__null__') ?? 0;
  const tradesWithSetups = closedTrades.length - nullCount;

  // Check if most trades come from one setup
  let maxCount = 0;
  let maxSetup = '';
  for (const [setup, count] of setupCounts) {
    if (count > maxCount && setup !== '__null__') {
      maxCount = count;
      maxSetup = setup;
    }
  }

  const insights: AttentionInsight[] = [];

  if (uniqueSetups >= 5) {
    insights.push({
      type: 'setup_diversity',
      severity: 'info',
      title: `Traded ${uniqueSetups} different setups`,
      message: `Your ${closedTrades.length} closed trades span ${uniqueSetups} unique setups. ${tradesWithSetups > 0 ? `${(maxCount / tradesWithSetups * 100).toFixed(0)}% of setup-tagged trades used ${maxSetup}.` : ''}`,
      value: uniqueSetups,
    });
  } else if (uniqueSetups <= 2 && tradesWithSetups >= 5) {
    insights.push({
      type: 'setup_concentration',
      severity: 'info',
      title: `Heavy concentration in ${uniqueSetups} setup${uniqueSetups === 1 ? '' : 's'}`,
      message: `Your ${closedTrades.length} closed trades only use ${uniqueSetups} setup${uniqueSetups === 1 ? '' : 's'}. Consider exploring additional setups for diversification.`,
      value: uniqueSetups,
    });
  }

  // Warning for many unclassified trades
  if (nullCount >= 5) {
    insights.push({
      type: 'unclassified_setups',
      severity: 'warning',
      title: `${nullCount} trade${nullCount === 1 ? '' : 's'} have no setup recorded`,
      message: `${nullCount} of ${closedTrades.length} closed trade${closedTrades.length === 1 ? '' : 's'} (${((nullCount / closedTrades.length) * 100).toFixed(0)}%) have no setup assigned. Assigning setups helps identify your edge.`,
      value: nullCount,
    });
  }

  return insights;
}

// ── Orchestrator ────────────────────────────────────────────────────────

/**
 * Compute deterministic attention insights from trade data.
 *
 * Analyzes an array of trades (closed + open, with pre-joined related data)
 * and surfaces objective observations about trading patterns, risks, and
 * performance.
 *
 * Observations computed:
 * 1. Day-of-week win rate comparison — best/worst trading days
 * 2. Trades without stop loss — missing risk management
 * 3. Ungraded trades — missed process steps
 * 4. Top/worst trades by R-multiple — extreme performance
 * 5. Current win/loss streak — recent momentum
 * 6. Setup concentration — trading variety
 *
 * Pure function — no side effects, no database access.
 *
 * @param trades Array of trades with pre-loaded executions, grades, risk data
 * @returns Ordered insights array with severity and metadata
 */
export function computeAttentionInsights(
  trades: AttentionInsightTradeInput[],
): AttentionInsightsResult {
  const insights: AttentionInsight[] = [];

  // Order of insertion determines priority (first = most important)
  insights.push(...createNoStopInsights(trades));
  insights.push(...createDayOfWeekInsights(trades));
  insights.push(...createUngradedTradeInsights(trades));
  insights.push(...createSetupConcentrationInsights(trades));
  insights.push(...createExtremeTradeInsights(trades));
  insights.push(...createStreakInsights(trades));

  // Sort by severity: critical first, then warning, then info
  const severityOrder: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    insights,
    tradeCount: trades.length,
  };
}
