/**
 * mark-to-market.ts
 *
 * Pure (no side effects) MTM (mark-to-market) unrealized P&L computation.
 * Consolidates duplicated inline logic from dashboard/route.ts and
 * trades/[id]/route.ts into shared helpers with an explicit FeePolicy
 * parameter to preserve the existing fee-treatment divergence between
 * the two call sites.
 *
 * - Dashboard: uses FeePolicy='include_entry_fees' (subtracts entry fees)
 * - Trade detail: uses FeePolicy='exclude_entry_fees' (no fee subtraction)
 */

import { calculateAvgCost } from './trade-calc';
import type { ExecutionData, Direction } from './trade-calc';

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Controls whether entry fees are subtracted from unrealized P&L.
 *
 * - `'include_entry_fees'`: subtract entry fees from unrealized P&L
 *   (dashboard route behavior — fees are known costs already incurred)
 * - `'exclude_entry_fees'`: do NOT subtract entry fees from unrealized P&L
 *   (trade detail route behavior — raw mark-to-market delta)
 */
export type FeePolicy = 'include_entry_fees' | 'exclude_entry_fees';

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

// ── Internal helpers (mirrors trade-calc.ts private helpers) ───────────

function isEntryAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'buy' || action === 'add';
  return action === 'sell_short';
}

function isExitAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'sell' || action === 'reduce';
  return action === 'buy_to_cover';
}

// ── 1. Open position computation ───────────────────────────────────────

/**
 * Compute the open position from execution data.
 *
 * Filters executions into entry and exit actions based on the trade direction,
 * then computes the average entry price (via calculateAvgCost) and the remaining
 * open quantity.
 *
 * Returns `{ avgEntryPrice: null, openQuantity: 0 }` when the position is flat
 * (no entries or fully exited).
 */
export function computeOpenPosition(
  executions: ExecutionData[],
  direction: Direction,
): { avgEntryPrice: number | null; openQuantity: number } {
  const entries = executions.filter((e) => isEntryAction(e.action, direction));
  const exits = executions.filter((e) => isExitAction(e.action, direction));

  const { avgEntryPrice, totalEntryQty } = calculateAvgCost(entries);
  const totalExitQty = exits.reduce((s, e) => s + e.quantity, 0);
  const openQuantity = Math.max(0, totalEntryQty - totalExitQty);

  if (avgEntryPrice === null || openQuantity === 0) {
    return { avgEntryPrice: null, openQuantity: 0 };
  }

  return { avgEntryPrice, openQuantity };
}

// ── 2. Single-trade unrealized P&L ─────────────────────────────────────

/**
 * Calculate unrealized P&L for a single open trade.
 *
 * Uses `computeOpenPosition` to derive the average entry price and open
 * quantity, then computes the directional mark-to-market delta:
 *
 *   long:  (currentPrice - avgEntryPrice) * openQuantity
 *   short: (avgEntryPrice - currentPrice) * openQuantity
 *
 * When `feePolicy` is `'include_entry_fees'`, entry fees are subtracted
 * from the result.
 *
 * Returns `null` when the position is flat (no open quantity) or when the
 * average entry price is unknown.
 */
export function calculateUnrealizedPnL(params: {
  executions: ExecutionData[];
  direction: Direction;
  currentPrice: number;
  feePolicy: FeePolicy;
}): number | null {
  const { executions, direction, currentPrice, feePolicy } = params;
  const { avgEntryPrice, openQuantity } = computeOpenPosition(executions, direction);

  if (avgEntryPrice === null || openQuantity === 0) {
    return null;
  }

  let unrealizedPnl: number;

  if (direction === 'long') {
    unrealizedPnl = (currentPrice - avgEntryPrice) * openQuantity;
  } else {
    unrealizedPnl = (avgEntryPrice - currentPrice) * openQuantity;
  }

  if (feePolicy === 'include_entry_fees') {
    const entries = executions.filter((e) => isEntryAction(e.action, direction));
    const totalEntryFees = entries.reduce((s, e) => s + (e.fees ?? 0), 0);
    unrealizedPnl -= totalEntryFees;
  }

  return unrealizedPnl;
}

// ── 3. Aggregate MTM summary ────────────────────────────────────────────

/**
 * Aggregate mark-to-market summary across all open trades.
 *
 * Iterates the open trades array, computing per-trade unrealized P&L via
 * `calculateUnrealizedPnL`. Trades with a `null` or `undefined` currentPrice
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
  feePolicy: FeePolicy,
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

    const pnl = calculateUnrealizedPnL({
      executions,
      direction,
      currentPrice,
      feePolicy,
    });

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
