/**
 * mark-to-market.ts
 *
 * Pure (no side effects) MTM (mark-to-market) unrealized P&L computation.
 *
 * Refactored T02 (M008/S03): consumes computeTradeMetrics() from trade-metrics.ts,
 * dropping the old FeePolicy divergence. Unrealized P&L now uses the canonical
 * FIFO-based net unrealized P&L from computeTradeMetrics, which always includes
 * fee effects (no separate include/exclude entry fees behavior).
 */

import type {
  ExecutionData,
  Direction,
} from './trade-metrics';
import {
  computeTradeMetrics,
} from './trade-metrics';

// ── Types ──────────────────────────────────────────────────────────────

export interface OpenTrade {
  executions: ExecutionData[];
  direction: Direction;
  currentPrice: number | null;
}

export interface MarkToMarketSummary {
  netUnrealizedPnl: number | null;
  tradesWithPrices: number;
  tradesAwaitingData: number;
  openTradeCount: number;
}

// ── 1. Open position computation ───────────────────────────────────────

/**
 * Compute the open position from execution data.
 *
 * Uses `computeTradeMetrics` from trade-metrics.ts to derive the FIFO-based
 * open average cost and open quantity.
 *
 * Returns `{ avgEntryPrice: null, openQuantity: 0 }` when the position is flat
 * (no entries or fully exited).
 */
export function computeOpenPosition(
  executions: ExecutionData[],
  direction: Direction,
): { avgEntryPrice: number | null; openQuantity: number } {
  const metrics = computeTradeMetrics({
    executions,
    direction,
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  });

  return {
    avgEntryPrice: metrics.averagePrices.openAvgCost,
    openQuantity: metrics.size.openQuantity,
  };
}

// ── 2. Single-trade unrealized P&L ─────────────────────────────────────

/**
 * Calculate unrealized P&L for a single open trade.
 *
 * Uses `computeTradeMetrics` from trade-metrics.ts to derive the canonical
 * FIFO-based net unrealized P&L (including fee effects).
 *
 * Returns `null` when the position is flat (no open quantity) or when the
 * average entry price is unknown.
 */
export function calculateUnrealizedPnL(params: {
  executions: ExecutionData[];
  direction: Direction;
  currentPrice: number;
}): number | null {
  const { executions, direction, currentPrice } = params;

  const metrics = computeTradeMetrics({
    executions,
    direction,
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: { price: currentPrice, markedAt: new Date().toISOString() },
    currentAccountEquity: null,
  });

  return metrics.unrealizedPnl.netUnrealizedPnl;
}

// ── 3. Aggregate MTM summary ────────────────────────────────────────────

/**
 * Aggregate mark-to-market summary across all open trades.
 *
 * Iterates the open trades array, computing per-trade unrealized P&L via
 * `computeTradeMetrics`. Trades with a `null` or `undefined` currentPrice
 * are counted as "awaiting data" and skipped. The summary reports:
 *
 * - `netUnrealizedPnl`: sum of per-trade unrealized P&L (null if no trades
 *   have prices)
 * - `tradesWithPrices`: count of trades with a non-null currentPrice
 * - `tradesAwaitingData`: count of trades where currentPrice is null
 * - `openTradeCount`: total number of open trades
 */
export function computeMarkToMarketSummary(
  openTrades: OpenTrade[],
): MarkToMarketSummary {
  const openTradeCount = openTrades.length;
  let netUnrealizedPnl: number | null = null;
  let tradesWithPrices = 0;
  let tradesAwaitingData = 0;
  let totalUnrealizedPnl = 0;
  let anyWithPrices = false;

  for (const trade of openTrades) {
    const { executions, direction, currentPrice } = trade;

    if (currentPrice === null || currentPrice === undefined) {
      tradesAwaitingData++;
      continue;
    }

    tradesWithPrices++;
    anyWithPrices = true;

    const metrics = computeTradeMetrics({
      executions,
      direction,
      riskSnapshot: null,
      stopAdjustments: [],
      currentMark: { price: currentPrice, markedAt: new Date().toISOString() },
      currentAccountEquity: null,
    });

    const pnl = metrics.unrealizedPnl.netUnrealizedPnl;

    if (pnl !== null) {
      totalUnrealizedPnl += pnl;
    }
  }

  if (anyWithPrices) {
    netUnrealizedPnl = totalUnrealizedPnl;
  }

  return {
    netUnrealizedPnl,
    tradesWithPrices,
    tradesAwaitingData,
    openTradeCount,
  };
}
