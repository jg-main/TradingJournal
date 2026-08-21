/**
 * Performance Analytics Computation Functions
 *
 * Pure computation functions for the /performance analytical dashboard.
 * These functions compute chart data and KPI metrics not covered by
 * the existing dashboard.ts library.
 *
 * Pattern: src/lib/dashboard.ts, src/lib/review-dashboard.ts
 */

import { computeTradeMetrics, type ExecutionData, type TradeMetricsResult } from './trade-metrics';
import { computeWinRate } from './metrics';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PerformanceTradeInput {
  id: string;
  direction: 'long' | 'short';
  status: string;
  symbol: string;
  setupId: string | null;
  executions: ExecutionData[];
  riskSnapshot: { initialRiskAmount: number | null } | null;
  closedAt: string | null;
  openedAt: string | null;
}

/**
 * Shared per-trade metrics cache: computed once per trade and reused across
 * every aggregation function to avoid O(functions × trades) FIFO recomputation.
 */
export type TradeMetricsCache = Map<string, TradeMetricsResult>;

/**
 * Compute trade metrics for every input trade in one pass.
 * Callers should build this once per analytics request and thread it through.
 */
export function computeTradeMetricsCache(trades: PerformanceTradeInput[]): TradeMetricsCache {
  const cache: TradeMetricsCache = new Map();
  for (const trade of trades) {
    cache.set(trade.id, computeTradeMetrics({
      executions: trade.executions,
      direction: trade.direction,
      riskSnapshot: trade.riskSnapshot
        ? { initialRiskAmount: trade.riskSnapshot.initialRiskAmount, accountEquityAtOpen: null }
        : null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    }));
  }
  return cache;
}

function metricsFor(trade: PerformanceTradeInput, cache?: TradeMetricsCache) {
  if (cache) {
    const m = cache.get(trade.id);
    if (m) return m;
  }
  return computeTradeMetrics({
    executions: trade.executions,
    direction: trade.direction,
    riskSnapshot: trade.riskSnapshot
      ? { initialRiskAmount: trade.riskSnapshot.initialRiskAmount, accountEquityAtOpen: null }
      : null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  });
}

export interface DailyPnlDataPoint {
  date: string; // ISO date (YYYY-MM-DD)
  netPnl: number;
}

export interface CumulativePnlDataPoint {
  date: string;
  cumulativePnl: number;
}

export interface DurationBucket {
  bucket: string; // e.g., '0-1 days', '2-5 days', '6-10 days', '11+ days'
  netPnl: number;
  count: number;
  winRate: number | null;
}

export interface DayOfWeekData {
  day: string; // 'Monday', 'Tuesday', etc.
  netPnl: number;
  count: number;
  winRate: number | null;
}

export interface TimeOfDayData {
  hour: string; // '00:00', '01:00', etc.
  netPnl: number;
  count: number;
}

// ── Missing KPI Metrics ─────────────────────────────────────────────────────

/**
 * Compute gross P&L (sum of absolute P&L before fees).
 * Returns gross profit (sum of wins), gross loss (sum of absolute losses), and gross P&L.
 */
export function computeGrossPnl(closedTrades: PerformanceTradeInput[], cache?: TradeMetricsCache): {
  grossProfit: number;
  grossLoss: number;
  grossPnl: number;
} {
  let grossProfit = 0;
  let grossLoss = 0;

  for (const trade of closedTrades) {
    const metrics = metricsFor(trade, cache);
    const pnl = metrics.realizedPnl.netRealizedPnl;
    if (pnl > 0) {
      grossProfit += pnl;
    } else {
      grossLoss += Math.abs(pnl);
    }
  }

  return {
    grossProfit,
    grossLoss,
    grossPnl: grossProfit - grossLoss,
  };
}

/**
 * Compute median R-multiple.
 */
export function computeMedianR(closedTrades: PerformanceTradeInput[], cache?: TradeMetricsCache): number | null {
  const rMultiples: number[] = [];

  for (const trade of closedTrades) {
    const metrics = metricsFor(trade, cache);
    const rMultiple = metrics.returnMetrics.rMultiple;
    if (rMultiple !== null) {
      rMultiples.push(rMultiple);
    }
  }

  if (rMultiples.length === 0) return null;

  const sorted = [...rMultiples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute day win rate (win rate computed per-day then averaged).
 * For each day, compute the win rate for trades closed on that day.
 * Then average all daily win rates.
 */
export function computeDayWinRate(closedTrades: PerformanceTradeInput[], cache?: TradeMetricsCache): number | null {
  // Group trades by close date
  const tradesByDate = new Map<string, number[]>();

  for (const trade of closedTrades) {
    if (!trade.closedAt) continue;

    const metrics = metricsFor(trade, cache);
    const pnl = metrics.realizedPnl.netRealizedPnl;
    const date = trade.closedAt.split('T')[0];

    if (!tradesByDate.has(date)) {
      tradesByDate.set(date, []);
    }
    tradesByDate.get(date)!.push(pnl);
  }

  if (tradesByDate.size === 0) return null;

  // Compute win rate for each day, then average
  const dailyWinRates: number[] = [];
  for (const pnls of tradesByDate.values()) {
    const winRate = computeWinRate(pnls, 'includeZeroAsLoss');
    if (winRate !== null) {
      dailyWinRates.push(winRate);
    }
  }

  if (dailyWinRates.length === 0) return null;
  return dailyWinRates.reduce((sum, wr) => sum + wr, 0) / dailyWinRates.length;
}

/**
 * Compute max drawdown (peak-to-trough max value).
 * Extracts the maximum drawdown amount and percentage from rollforward data.
 */
export function computeMaxDrawdown(rollforwardData: Array<{
  drawdownAmount: number | null;
  drawdownPct: number | null;
}>): { amount: number; pct: number } | null {
  let maxAmount = 0;
  let maxPct = 0;
  let hasData = false;

  for (const row of rollforwardData) {
    if (row.drawdownAmount !== null && row.drawdownAmount > maxAmount) {
      maxAmount = row.drawdownAmount;
      hasData = true;
    }
    if (row.drawdownPct !== null && row.drawdownPct > maxPct) {
      maxPct = row.drawdownPct;
    }
  }

  if (!hasData) return null;
  return { amount: maxAmount, pct: maxPct };
}

// ── Chart Data Functions ────────────────────────────────────────────────────

/**
 * Compute daily net P&L (per-day net P&L bars by close date).
 */
export function computeDailyNetPnl(closedTrades: PerformanceTradeInput[], cache?: TradeMetricsCache): DailyPnlDataPoint[] {
  const pnlByDate = new Map<string, number>();

  for (const trade of closedTrades) {
    if (!trade.closedAt) continue;

    const metrics = metricsFor(trade, cache);
    const pnl = metrics.realizedPnl.netRealizedPnl;
    const date = trade.closedAt.split('T')[0];

    pnlByDate.set(date, (pnlByDate.get(date) ?? 0) + pnl);
  }

  return Array.from(pnlByDate.entries())
    .map(([date, netPnl]) => ({ date, netPnl }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compute daily cumulative P&L (cumulative sum of daily net P&L by close date).
 */
export function computeCumulativeDailyPnl(
  closedTrades: PerformanceTradeInput[],
  cache?: TradeMetricsCache,
): CumulativePnlDataPoint[] {
  const dailyPnl = computeDailyNetPnl(closedTrades, cache);
  let cumulative = 0;

  return dailyPnl.map(({ date, netPnl }) => {
    cumulative += netPnl;
    return { date, cumulativePnl: cumulative };
  });
}

/**
 * Compute trade duration performance (P&L grouped by holding-duration buckets).
 * Retained for compatibility: the default Trade Duration widget uses the
 * per-trade scatter dataset (computeTradeDurationPoints) instead.
 */
export function computeTradeDurationPerformance(
  closedTrades: PerformanceTradeInput[],
  cache?: TradeMetricsCache,
): DurationBucket[] {
  const buckets: Record<string, { pnls: number[]; netPnl: number }> = {
    '0-1 days': { pnls: [], netPnl: 0 },
    '2-5 days': { pnls: [], netPnl: 0 },
    '6-10 days': { pnls: [], netPnl: 0 },
    '11+ days': { pnls: [], netPnl: 0 },
  };

  for (const trade of closedTrades) {
    const metrics = metricsFor(trade, cache);

    const holdingDays = metrics.position.holdingPeriodDays;
    if (holdingDays === null) continue;

    const pnl = metrics.realizedPnl.netRealizedPnl;

    let bucket: string;
    if (holdingDays <= 1) {
      bucket = '0-1 days';
    } else if (holdingDays <= 5) {
      bucket = '2-5 days';
    } else if (holdingDays <= 10) {
      bucket = '6-10 days';
    } else {
      bucket = '11+ days';
    }

    buckets[bucket].pnls.push(pnl);
    buckets[bucket].netPnl += pnl;
  }

  return Object.entries(buckets).map(([bucket, data]) => ({
    bucket,
    netPnl: data.netPnl,
    count: data.pnls.length,
    winRate: data.pnls.length > 0 ? computeWinRate(data.pnls, 'includeZeroAsLoss') : null,
  }));
}

/**
 * One observation per eligible closed trade for the Trade Duration scatter.
 * Only fields required for the analytical visualization are exposed — never
 * full trade objects. holdingDurationMinutes is a continuous numeric duration
 * (presentation formatting happens in the chart layer).
 */
export interface TradeDurationPoint {
  tradeId: string;
  symbol: string;
  /** Continuous holding duration in minutes (canonical elapsed-time semantics). */
  holdingDurationMinutes: number;
  /** Canonical individual net realized P&L. */
  netPnl: number;
  /** Canonical individual R-multiple; null when initial-risk data is missing/invalid. */
  rMultiple: number | null;
  setupId: string | null;
  /** Human-readable setup display name (resolved via the setup name map). */
  setupName: string | null;
  /** ISO close timestamp. */
  closedAt: string;
}

/**
 * Compute the per-trade duration scatter dataset: one observation per closed
 * trade with a computable holding duration. Reuses the canonical elapsed-time
 * semantics (closedAt − openedAt) and the shared metrics cache — no React-local
 * P&L or R calculation, no per-trade database access.
 *
 * @param setupNameMap Optional setupId → display-name map (batched lookup done
 *   by the caller); unmapped IDs resolve to null so a UUID never leaks into
 *   user-facing labels.
 */
export function computeTradeDurationPoints(
  closedTrades: PerformanceTradeInput[],
  setupNameMap?: Record<string, string>,
  cache?: TradeMetricsCache,
): TradeDurationPoint[] {
  const points: TradeDurationPoint[] = [];
  for (const trade of closedTrades) {
    // Only closed trades carry a deterministic holding period; open trades are
    // excluded from the realized-outcome analysis (matches the aggregate scope).
    if (trade.openedAt == null || trade.closedAt == null) continue;
    const openedMs = new Date(trade.openedAt).getTime();
    const closedMs = new Date(trade.closedAt).getTime();
    if (!Number.isFinite(openedMs) || !Number.isFinite(closedMs)) continue;
    const holdingDurationMinutes = (closedMs - openedMs) / (1000 * 60);
    // Zero/negative durations are data defects, not observations.
    if (holdingDurationMinutes <= 0) continue;

    const metrics = metricsFor(trade, cache);
    points.push({
      tradeId: trade.id,
      symbol: trade.symbol,
      holdingDurationMinutes,
      netPnl: metrics.realizedPnl.netRealizedPnl,
      rMultiple: metrics.returnMetrics.rMultiple,
      setupId: trade.setupId,
      setupName: trade.setupId ? (setupNameMap?.[trade.setupId] ?? null) : null,
      closedAt: trade.closedAt,
    });
  }
  // Deterministic order: shortest holding first (ties by close time).
  points.sort((a, b) => a.holdingDurationMinutes - b.holdingDurationMinutes || a.closedAt.localeCompare(b.closedAt));
  return points;
}

/**
 * Compute performance by day of week (P&L/win-rate grouped by weekday of close date).
 */
export function computePerformanceByDayOfWeek(
  closedTrades: PerformanceTradeInput[],
  cache?: TradeMetricsCache,
): DayOfWeekData[] {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dataByDay = new Map<string, number[]>();

  for (let i = 0; i < 7; i++) {
    dataByDay.set(days[i], []);
  }

  for (const trade of closedTrades) {
    if (!trade.closedAt) continue;

    const metrics = metricsFor(trade, cache);
    const pnl = metrics.realizedPnl.netRealizedPnl;

    const date = new Date(trade.closedAt);
    const dayName = days[date.getDay()];

    dataByDay.get(dayName)!.push(pnl);
  }

  return days.map((day) => {
    const pnls = dataByDay.get(day)!;
    const netPnl = pnls.reduce((sum, p) => sum + p, 0);
    return {
      day,
      netPnl,
      count: pnls.length,
      winRate: pnls.length > 0 ? computeWinRate(pnls, 'includeZeroAsLoss') : null,
    };
  });
}

/**
 * Compute performance by time of day (P&L grouped by entry/exit hour).
 * Uses the hour of the close timestamp.
 */
export function computePerformanceByTimeOfDay(
  closedTrades: PerformanceTradeInput[],
  cache?: TradeMetricsCache,
): TimeOfDayData[] {
  const pnlByHour = new Map<string, number>();

  // Initialize all hours
  for (let h = 0; h < 24; h++) {
    const hour = `${h.toString().padStart(2, '0')}:00`;
    pnlByHour.set(hour, 0);
  }

  for (const trade of closedTrades) {
    if (!trade.closedAt) continue;

    const metrics = metricsFor(trade, cache);
    const pnl = metrics.realizedPnl.netRealizedPnl;

    const date = new Date(trade.closedAt);
    const hour = `${date.getHours().toString().padStart(2, '0')}:00`;

    pnlByHour.set(hour, (pnlByHour.get(hour) ?? 0) + pnl);
  }

  return Array.from(pnlByHour.entries())
    .map(([hour, netPnl]) => ({ hour, netPnl, count: 0 })) // Count not tracked per-hour for simplicity
    .sort((a, b) => a.hour.localeCompare(b.hour));
}
