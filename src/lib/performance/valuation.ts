/**
 * Pure exact-decimal valuation functions for marked positions.
 *
 * No database or Next.js imports — pure arithmetic on domain types.
 * Follows the existing pure-library conventions (src/lib/trade-calc.ts,
 * src/lib/risk-snapshot.ts) with compute/derive function prefixes.
 *
 * Exports:
 * - computeMarkStatus — classify a mark as fresh, stale, or missing
 * - deriveValuationPosition — build a ValuationPosition from position state + mark
 * - computeMarkedValue — exact-decimal position value from quantity × price
 * - computeMarkedValueFromMarkMicros — same valuation retaining quote precision
 * - computeUnrealizedPnl — unrealized P&L given direction and cost vs mark
 * - computeUnrealizedPnlFromMarkMicros — same calculation while preserving
 *   the source quote's micro precision until the currency result is rounded
 * - computeNav — Net Asset Value = cash + marked positions
 * - computeRealizedPnl — aggregate realized P&L from positions
 * - computeTotalFees — aggregate fees (execution fees counted once)
 * - computeGrossExposure — sum of absolute marked position values
 * - computeNetExposure — sum of signed marked position values
 * - computeAccountValuation — full AccountValuation from input
 *
 * @module performance/valuation
 */

import type { CanonicalDecimal } from '../accounting/types';
import {
  toMicros,
  fromMicros,
  addDecimal,
  subtractDecimal,
  compareDecimal,
  sumDecimals,
  MICROS_PER_UNIT,
} from '../accounting/decimal';
import type { PositionDirection } from '../positions/types';
import type {
  ValuationPosition,
  MarkStatus,
  MarkSource,
  AccountValuationInput,
  AccountValuation,
  NavBreakdown,
} from './types';

// ── Internal Helpers ────────────────────────────────────────────────────

/**
 * Multiply two canonical decimals using exact BigInt arithmetic.
 *
 * Both inputs have exactly 2 fraction digits, making the product
 * after dividing by MICROS_PER_UNIT always an exact integer micros.
 */
function multiplyDecimal(a: CanonicalDecimal, b: CanonicalDecimal): CanonicalDecimal {
  const product = BigInt(toMicros(a)) * BigInt(toMicros(b));
  return fromMicros(Number(product / BigInt(MICROS_PER_UNIT)));
}

/**
 * Absolute value of a canonical decimal.
 */
function absoluteDecimal(a: CanonicalDecimal): CanonicalDecimal {
  const micros = toMicros(a);
  return micros < 0 ? fromMicros(-micros) : a;
}

// ── Default freshness threshold ─────────────────────────────────────────

/** Default freshness threshold in minutes. Marks older than this are 'stale'. */
export const DEFAULT_FRESHNESS_THRESHOLD_MINUTES = 24 * 60; // 24 hours

// ── Mark Status ─────────────────────────────────────────────────────────

/**
 * Classify a mark's status based on its age.
 *
 * @param markTimestamp  - ISO-8601 timestamp of the mark
 * @param nowTimestamp   - ISO-8601 timestamp of "now" (computation time)
 * @param thresholdMinutes - Minutes before a mark is considered stale (default 1440)
 * @returns 'fresh' if mark is within threshold, 'stale' if older, 'missing' if no mark
 */
export function computeMarkStatus(
  markTimestamp: string | null,
  nowTimestamp: string,
  thresholdMinutes: number = DEFAULT_FRESHNESS_THRESHOLD_MINUTES,
): MarkStatus {
  if (markTimestamp === null) {
    return 'missing';
  }
  const markMs = new Date(markTimestamp).getTime();
  const nowMs = new Date(nowTimestamp).getTime();
  if (isNaN(markMs) || isNaN(nowMs)) {
    return 'missing';
  }
  const diffMinutes = (nowMs - markMs) / 60_000;
  if (diffMinutes < 0) {
    // Future-dated mark — still fresh
    return 'fresh';
  }
  return diffMinutes <= thresholdMinutes ? 'fresh' : 'stale';
}

/**
 * Compute the age of a mark in minutes.
 *
 * @param markTimestamp - ISO-8601 timestamp of the mark (null = missing)
 * @param nowTimestamp  - ISO-8601 timestamp of "now"
 * @returns Minutes since the mark was recorded, or null if missing
 */
export function computeMarkAgeMinutes(
  markTimestamp: string | null,
  nowTimestamp: string,
): number | null {
  if (markTimestamp === null) return null;
  const markMs = new Date(markTimestamp).getTime();
  const nowMs = new Date(nowTimestamp).getTime();
  if (isNaN(markMs) || isNaN(nowMs)) return null;
  return Math.max(0, Math.round((nowMs - markMs) / 60_000));
}

// ── Quantity Absolute Value ─────────────────────────────────────────────

/**
 * Get the absolute quantity for a position.
 *
 * ValuationPosition.quantity is positive for long and negative for short.
 * Returns the absolute (non-negative) size.
 */
export function absoluteQuantity(quantity: CanonicalDecimal): CanonicalDecimal {
  return absoluteDecimal(quantity);
}

// ── Marked Position Value ───────────────────────────────────────────────

/**
 * Compute the marked-to-market value of a position.
 *
 * Long:  quantity (positive) × markPrice = positive value
 * Short: quantity (negative) × markPrice = negative value
 *
 * Returns null when the position is flat (quantity = "0.00").
 */
export function computeMarkedValue(
  quantity: CanonicalDecimal,
  markPrice: CanonicalDecimal | null,
): CanonicalDecimal | null {
  if (compareDecimal(quantity, '0.00') === 0) return null;
  if (markPrice === null) return null;
  return multiplyDecimal(quantity, markPrice);
}

/**
 * Compute a marked position value from the quote precision stored in
 * valuation_marks.price_micros. Display price remains cents-rounded, while
 * the monetary result is rounded only after quantity multiplication.
 */
export function computeMarkedValueFromMarkMicros(
  quantity: CanonicalDecimal,
  markPriceMicros: number | null,
): CanonicalDecimal | null {
  if (
    markPriceMicros === null ||
    !Number.isSafeInteger(markPriceMicros) ||
    compareDecimal(quantity, '0.00') === 0
  ) {
    return null;
  }

  const valueMicros = Number(
    (BigInt(toMicros(quantity)) * BigInt(markPriceMicros)) /
      BigInt(MICROS_PER_UNIT),
  );
  return fromMicros(valueMicros);
}

// ── Unrealized P&L ─────────────────────────────────────────────────────

/**
 * Compute unrealized P&L for a position given mark price and direction.
 *
 * Long:  (markPrice - averageCost) × quantity (quantity > 0)
 * Short: (averageCost - markPrice) × |quantity|
 *
 * Returns null if markPrice is null or quantity is flat.
 */
export function computeUnrealizedPnl(
  averageCost: CanonicalDecimal,
  markPrice: CanonicalDecimal | null,
  quantity: CanonicalDecimal,
  direction: PositionDirection | null,
): CanonicalDecimal | null {
  if (markPrice === null) return null;
  if (compareDecimal(quantity, '0.00') === 0) return null;
  if (direction === null) return null;

  if (direction === 'long') {
    const priceDiff = subtractDecimal(markPrice, averageCost);
    return multiplyDecimal(priceDiff, quantity);
  }

  // Short: (averageCost - markPrice) × |quantity|
  const priceDiff = subtractDecimal(averageCost, markPrice);
  const absQty = absoluteDecimal(quantity);
  return multiplyDecimal(priceDiff, absQty);
}

/**
 * Compute unrealized P&L from a market quote stored as integer micros.
 *
 * Account valuation marks preserve the provider quote in `price_micros`,
 * which can carry more precision than the canonical two-decimal display
 * price. Retain that precision through the calculation and round only the
 * final currency result, so account-position valuation agrees with the
 * Trades mark-to-market calculation at the same quote.
 */
export function computeUnrealizedPnlFromMarkMicros(
  averageCost: CanonicalDecimal,
  markPriceMicros: number | null,
  quantity: CanonicalDecimal,
  direction: PositionDirection | null,
): CanonicalDecimal | null {
  if (
    markPriceMicros === null ||
    !Number.isSafeInteger(markPriceMicros) ||
    compareDecimal(quantity, '0.00') === 0 ||
    direction === null
  ) {
    return null;
  }

  const costMicros = toMicros(averageCost);
  const quantityMicros = toMicros(quantity);
  const priceDifferenceMicros =
    direction === 'long'
      ? markPriceMicros - costMicros
      : costMicros - markPriceMicros;
  const absoluteQuantityMicros = Math.abs(quantityMicros);
  const pnlMicros = Number(
    (BigInt(priceDifferenceMicros) * BigInt(absoluteQuantityMicros)) /
      BigInt(MICROS_PER_UNIT),
  );

  return fromMicros(pnlMicros);
}

// ── Derive ValuationPosition ────────────────────────────────────────────

/**
 * Derive a ValuationPosition from a position state + optional mark.
 *
 * Computes mark status, age, marked value, and unrealized P&L
 * in a single call.
 */
export function deriveValuationPosition(
  position: {
    instrumentId: string;
    direction: PositionDirection | null;
    quantity: CanonicalDecimal;
    averageCost: CanonicalDecimal;
    totalCostBasis: CanonicalDecimal;
    realizedPnl: CanonicalDecimal;
    realizedFees: CanonicalDecimal;
    realizedNetPnl: CanonicalDecimal;
    /** M002-A6: remaining opening fees on still-open quantity. */
    openFees: CanonicalDecimal;
  },
  mark: {
    price: CanonicalDecimal;
    /** Provider quote precision; when present it is canonical for valuation. */
    priceMicros?: number | null;
    timestamp: string;
    source: MarkSource;
  } | null,
  nowTimestamp: string,
  freshnessThresholdMinutes?: number,
): ValuationPosition {
  const markStatus: MarkStatus = mark
    ? computeMarkStatus(mark.timestamp, nowTimestamp, freshnessThresholdMinutes)
    : 'missing';

  const marketPrice = mark?.price ?? null;
  const markAge = mark ? computeMarkAgeMinutes(mark.timestamp, nowTimestamp) : null;

  const markedValue = mark?.priceMicros !== undefined
    ? computeMarkedValueFromMarkMicros(position.quantity, mark.priceMicros)
    : computeMarkedValue(position.quantity, marketPrice);
  const grossUnrealizedPnl = mark?.priceMicros !== undefined
    ? computeUnrealizedPnlFromMarkMicros(
        position.averageCost,
        mark.priceMicros,
        position.quantity,
        position.direction,
      )
    : computeUnrealizedPnl(
        position.averageCost,
        marketPrice,
        position.quantity,
        position.direction,
      );

  // M002-A6: net unrealized = gross unrealized - remaining opening fees.
  // Open fees were paid in cash at entry; they are never double-counted in
  // NAV (NAV already reflects the cash outflow), but they explain the
  // mark-vs-cost P&L for the still-open quantity.
  const openFees = position.openFees;
  const netUnrealizedPnl = grossUnrealizedPnl != null
    ? subtractDecimal(grossUnrealizedPnl, openFees)
    : null;

  return {
    instrumentId: position.instrumentId,
    direction: position.direction,
    quantity: position.quantity,
    averageCost: position.averageCost,
    totalCostBasis: position.totalCostBasis,
    realizedPnl: position.realizedPnl,
    realizedFees: position.realizedFees,
    realizedNetPnl: position.realizedNetPnl,
    openFees,
    markPrice: marketPrice,
    markStatus,
    markedValue,
    grossUnrealizedPnl,
    unrealizedPnl: netUnrealizedPnl,
    netUnrealizedPnl,
    markTimestamp: mark?.timestamp ?? null,
    markSource: mark?.source ?? null,
    markAgeMinutes: markAge,
  };
}

// ── NAV ─────────────────────────────────────────────────────────────────

/**
 * Compute Net Asset Value = netCash + markedPositions.
 */
export function computeNav(
  netCash: CanonicalDecimal,
  markedPositions: CanonicalDecimal,
): CanonicalDecimal {
  return addDecimal(netCash, markedPositions);
}

/**
 * Build a NAV breakdown from cash and marked positions.
 */
export function computeNavBreakdown(
  cash: CanonicalDecimal,
  markedPositions: CanonicalDecimal,
): NavBreakdown {
  return { cash, markedPositions };
}

// ── Realized P&L ────────────────────────────────────────────────────────

/**
 * Compute aggregate realized P&L across all positions.
 *
 * Uses realizedNetPnl (realized P&L minus fees) from each position.
 */
export function computeRealizedPnl(
  positionResults: ReadonlyArray<{ realizedNetPnl: CanonicalDecimal }>,
): CanonicalDecimal {
  return sumDecimals(positionResults.map((p) => p.realizedNetPnl));
}

// ── Unrealized P&L (aggregate) ─────────────────────────────────────────

/**
 * Compute aggregate unrealized P&L across all positions.
 *
 * Sums unrealizedPnl for each position. Null entries (flat or unmarked)
 * contribute 0 to the aggregate.
 */
export function computeAggregateUnrealizedPnl(
  positions: ReadonlyArray<{ unrealizedPnl: CanonicalDecimal | null }>,
): CanonicalDecimal {
  const nonNull = positions
    .map((p) => p.unrealizedPnl)
    .filter((v): v is CanonicalDecimal => v !== null);
  if (nonNull.length === 0) return '0.00' as CanonicalDecimal;
  return sumDecimals(nonNull as string[]);
}

// ── Total Fees ──────────────────────────────────────────────────────────

/**
 * Compute aggregate fees across all positions.
 *
 * Sums realizedFees from each position. Execution/event fees are
 * counted exactly once in the PositionState via FIFO allocation.
 *
 * @param positionFees - realizedFees from each position
 * @param eventFees    - standalone event fee amounts (e.g., account-level fees)
 */
export function computeTotalFees(
  positionFees: ReadonlyArray<CanonicalDecimal>,
  eventFees?: ReadonlyArray<CanonicalDecimal>,
): CanonicalDecimal {
  const positionSum = sumDecimals(positionFees as unknown as string[]);
  if (!eventFees || eventFees.length === 0) return positionSum;
  const eventSum = sumDecimals(eventFees as unknown as string[]);
  return addDecimal(positionSum, eventSum);
}

// ── Exposure ────────────────────────────────────────────────────────────

/**
 * Compute gross exposure = sum of absolute marked position values.
 *
 * Gross exposure represents the total absolute market value of all
 * positions (ignoring direction).
 */
export function computeGrossExposure(
  markedValues: ReadonlyArray<CanonicalDecimal | null>,
): CanonicalDecimal {
  const absValues = markedValues
    .filter((v): v is CanonicalDecimal => v !== null)
    .map(absoluteDecimal);
  if (absValues.length === 0) return '0.00' as CanonicalDecimal;
  return sumDecimals(absValues as string[]);
}

/**
 * Compute net exposure = sum of signed marked position values.
 *
 * Long positions contribute positively, short positions negatively.
 * Net exposure reveals directional bias.
 */
export function computeNetExposure(
  markedValues: ReadonlyArray<CanonicalDecimal | null>,
): CanonicalDecimal {
  const signed = markedValues.filter((v): v is CanonicalDecimal => v !== null);
  if (signed.length === 0) return '0.00' as CanonicalDecimal;
  return sumDecimals(signed as string[]);
}

// ── Warnings ────────────────────────────────────────────────────────────

/**
 * Generate data-quality warnings from position valuations.
 *
 * Surfaces:
 * - Missing marks for open positions
 * - Stale marks for open positions
 * - Closed positions with stale marks (informational)
 */
export function deriveValuationWarnings(
  positions: ReadonlyArray<ValuationPosition>,
): string[] {
  const warnings: string[] = [];
  for (const pos of positions) {
    const isFlat = compareDecimal(pos.quantity, '0.00') === 0;
    if (isFlat) continue;

    if (pos.markStatus === 'missing') {
      warnings.push(
        `Missing mark for ${pos.instrumentId} (${pos.direction ?? 'flat'} position, ${absoluteQuantity(pos.quantity)} units)`,
      );
    } else if (pos.markStatus === 'stale') {
      warnings.push(
        `Stale mark for ${pos.instrumentId} — last marked ${pos.markAgeMinutes} minutes ago`,
      );
    }
  }
  return warnings;
}

// ── Account Valuation ───────────────────────────────────────────────────

/**
 * Compute the full AccountValuation from an AccountValuationInput.
 *
 * Aggregates net cash, position valuations, and derived metrics
 * (NAV, P&L, exposure) with warnings for data-quality issues.
 *
 * Pure function — no side effects, no database access.
 *
 * @param input       - Account cash + pre-derived ValuationPositions
 * @param nowTimestamp - ISO-8601 timestamp for "now" (determinism)
 * @returns Complete AccountValuation
 */
export function computeAccountValuation(
  input: AccountValuationInput,
  nowTimestamp: string,
): AccountValuation {
  const positions = [...input.positions];

  // Sum marked position values
  const markedValues = positions.map((p) => p.markedValue);
  const markedPositionsTotal = sumDecimals(
    markedValues.filter((v): v is CanonicalDecimal => v !== null) as string[],
  );

  // NAV
  const nav = computeNav(input.netCash, markedPositionsTotal);
  const navDetail = computeNavBreakdown(input.netCash, markedPositionsTotal);

  // P&L
  const realizedPnl = computeRealizedPnl(positions);
  const unrealizedPnl = computeAggregateUnrealizedPnl(positions);
  const totalPnl = addDecimal(realizedPnl, unrealizedPnl);

  // Fees
  const positionFees = positions.map((p) => p.realizedFees);
  const realizedFees = computeTotalFees(positionFees);

  // Exposure
  const grossExposure = computeGrossExposure(markedValues);
  const netExposure = computeNetExposure(markedValues);

  // Warnings
  const warnings = deriveValuationWarnings(positions);

  return {
    accountId: input.accountId,
    netCash: input.netCash,
    positions,
    markedPositions: markedPositionsTotal,
    nav,
    navDetail,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    realizedFees,
    grossExposure,
    netExposure,
    warnings,
    computedAt: nowTimestamp,
  };
}
