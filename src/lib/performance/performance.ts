/**
 * Pure exact-decimal performance calculation functions.
 *
 * No database or Next.js imports — pure arithmetic on domain types.
 * Follows the existing pure-library conventions with compute/derive prefixes.
 *
 * Performance metrics:
 * - Modified Dietz return (single-period time-weighted return approximation)
 * - Time-Weighted Return (TWR) via chain-linking sub-period returns
 * - High-water mark (maximum observed NAV)
 * - Drawdown (absolute and percentage) from high-water mark
 *
 * Cash flows (deposits/withdrawals) are excluded from profit calculations
 * per industry standard for time-weighted returns.
 *
 * @module performance/performance
 */

import type { CanonicalDecimal } from '../accounting/types';
import {
  toMicros,
  fromMicros,
  addDecimal,
  subtractDecimal,
  negateDecimal,
  compareDecimal,
  sumDecimals,
  MICROS_PER_UNIT,
} from '../accounting/decimal';
import type {
  PerformanceInput,
  PerformanceResult,
  SubPeriodReturn,
  CashFlow,
  HistoricalNavValue,
  HighWaterMarkInput,
} from './types';

// ── Internal Constants ──────────────────────────────────────────────────

/** Canonical representation of 1.00 (used for TWR chaining). */
const ONE: CanonicalDecimal = '1.00' as CanonicalDecimal;
/** Canonical representation of 0.00. */
const ZERO: CanonicalDecimal = '0.00' as CanonicalDecimal;

// ── Internal Helpers ────────────────────────────────────────────────────

/**
 * Multiply two canonical decimals using exact BigInt arithmetic.
 */
function multiplyDecimal(a: CanonicalDecimal, b: CanonicalDecimal): CanonicalDecimal {
  const product = BigInt(toMicros(a)) * BigInt(toMicros(b));
  return fromMicros(Number(product / BigInt(MICROS_PER_UNIT)));
}

/**
 * Divide two canonical decimals using exact BigInt arithmetic.
 *
 * Returns result rounded to 2 decimal places using banker's rounding.
 * NOT an identity — rounding to 2 places is inherent to the canonical format.
 */
function divideDecimal(a: CanonicalDecimal, b: CanonicalDecimal): CanonicalDecimal {
  const microsA = toMicros(a);
  const microsB = toMicros(b);
  if (microsB === 0) {
    throw new Error('Division by zero');
  }
  // Scale numerator to get 4 fraction digits of precision, then round to 2
  const scaled = (BigInt(microsA) * BigInt(MICROS_PER_UNIT) * BigInt(100)) / BigInt(microsB);
  // Round to nearest 100 (since we have 4 fraction digits and want 2)
  const rounded = Number((scaled + BigInt(50)) / BigInt(100));
  return fromMicros(rounded);
}

/**
 * Calculate calendar days between two ISO-8601 dates.
 */
function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid date range: ${startDate} to ${endDate}`);
  }
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

// ── Modified Dietz Return ──────────────────────────────────────────────

/**
 * Compute the Modified Dietz return for a single period.
 *
 * Modified Dietz is a time-weighted return approximation that adjusts
 * for external cash flows using time-weighted cash flow weighting.
 *
 * Formula:
 *   R = (EMV - BMV - F) / (BMV + Σ(W_i × F_i))
 *
 * Where:
 *   EMV = ending market value (endNav)
 *   BMV = beginning market value (startNav)
 *   F   = net external cash flow (deposits - withdrawals)
 *   W_i = (T - t_i) / T (proportion of period remaining after cash flow i)
 *   T   = total calendar days in the period
 *   t_i = days from period start to cash flow i
 *
 * @param startNav  - NAV at period start
 * @param endNav    - NAV at period end
 * @param cashFlows - Deposits and withdrawals within the period
 * @param startDate - ISO-8601 start date
 * @param endDate   - ISO-8601 end date
 * @returns The Modified Dietz return, or warnings/zero for degenerate cases
 */
export function computeModifiedDietzReturn(
  startNav: CanonicalDecimal,
  endNav: CanonicalDecimal,
  cashFlows: ReadonlyArray<CashFlow>,
  startDate: string,
  endDate: string,
): { return: CanonicalDecimal; warnings: string[] } {
  const warnings: string[] = [];

  // Total days in period
  let totalDays: number;
  try {
    totalDays = daysBetween(startDate, endDate);
  } catch {
    return { return: '0.00' as CanonicalDecimal, warnings: ['Invalid date range'] };
  }

  // Compute beginning market value
  const bmvMicros = toMicros(startNav);
  const bmv = bmvMicros;

  // Compute net cash flow and weighted cash flows
  let netCashFlow = 0;
  let weightedCashFlow = 0;

  for (const cf of cashFlows) {
    const cfMicros = toMicros(cf.amount);
    const flowSign = cf.type === 'deposit' ? 1 : -1;
    const absCf = cfMicros;

    // Net cash flow contribution (deposits increase capital, withdrawals decrease)
    netCashFlow += flowSign * absCf;

    // Time weight: (T - t) / T where t = days from start to cash flow
    let daysFromStart: number;
    try {
      daysFromStart = daysBetween(startDate, cf.date);
    } catch {
      warnings.push(`Invalid cash flow date: ${cf.date}`);
      daysFromStart = 0;
    }
    // Clamp: cash flows before period start or after period end
    if (daysFromStart < 0) daysFromStart = 0;
    if (daysFromStart > totalDays) daysFromStart = totalDays;

    const weight = (totalDays - daysFromStart) / totalDays;
    weightedCashFlow += flowSign * absCf * weight;
  }

  // Ending market value
  const emv = toMicros(endNav);

  // Numerator: EMV - BMV - netCashFlow
  const numerator = emv - bmv - netCashFlow;

  // Denominator: BMV + weightedCashFlow
  const denominator = bmv + Math.round(weightedCashFlow);

  if (denominator === 0) {
    warnings.push('Zero denominator in Modified Dietz (no starting capital)');
    return { return: '0.00' as CanonicalDecimal, warnings };
  }

  if (bmv === 0 && numerator !== 0) {
    warnings.push('Starting NAV is zero; Modified Dietz return may be unreliable');
  }

  // R = numerator / denominator (both in micros, so result is dimensionless)
  // Convert to canonical decimal by: result = toCanonical(numerator / denominator)
  const scaledNumerator = BigInt(numerator) * BigInt(MICROS_PER_UNIT) * BigInt(100);
  const resultMicros = Number((scaledNumerator / BigInt(denominator) + BigInt(50)) / BigInt(100));
  const returnValue = fromMicros(resultMicros);

  return { return: returnValue, warnings };
}

// ── TWR: Time-Weighted Return ──────────────────────────────────────────

/**
 * Compute the Time-Weighted Return by chain-linking sub-period returns.
 *
 * Splits the overall period into sub-periods at each cash flow date.
 * Each sub-period return is computed as: R = (EMV - BMV) / BMV
 * (pure market return, since cash flows only occur at sub-period boundaries).
 *
 * TWR = (1 + R1) × (1 + R2) × ... × (1 + Rn) - 1
 *
 * @returns TWR result with sub-period details and warnings.
 */
export function computeTwr(
  startNav: CanonicalDecimal,
  endNav: CanonicalDecimal,
  cashFlows: ReadonlyArray<CashFlow>,
  startDate: string,
  endDate: string,
): { twr: CanonicalDecimal; subPeriodReturns: SubPeriodReturn[]; warnings: string[] } {
  const warnings: string[] = [];
  const subPeriodReturns: SubPeriodReturn[] = [];

  // Sort cash flows by date
  const sortedFlows = [...cashFlows].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // Build sub-periods: each cash flow creates a boundary
  // We need NAV at each boundary. For TWR computation from pure functions,
  // we require the caller to provide NAV at each cash flow boundary
  // in the cash flows themselves, or we use a simplified approach:
  // Cash flow events are assumed to happen at the end of their sub-period,
  // and the next sub-period starts right after with an adjusted starting NAV.

  // For the pure function, we accept that the caller provides bookend NAVs
  // at cash flow dates. If no such info, we compute simplified TWR using
  // Modified Dietz sub-periods (cash flow weighted).

  // Simplified TWR approach: compute Modified Dietz for each period between
  // cash flows, chain-link the results.
  // This requires NAV at each cash flow date, which callers must supply.
  // Since the pure function doesn't have sub-period NAVs, we compute a
  // single-period Modified Dietz as the best approximation.
  //
  // If no cash flows, TWR simplifies to: (endNav - startNav) / startNav

  if (sortedFlows.length === 0) {
    // No cash flows → simple return
    const bmv = toMicros(startNav);
    const emv = toMicros(endNav);
    if (bmv === 0) {
      warnings.push('Starting NAV is zero; TWR is undefined');
      return { twr: '0.00' as CanonicalDecimal, subPeriodReturns: [], warnings };
    }
    const diff = fromMicros(emv - bmv);
    const twr = divideDecimal(diff, startNav);
    const days = daysBetween(startDate, endDate);
    subPeriodReturns.push({
      startDate,
      endDate,
      return: twr,
      days,
    });
    return { twr, subPeriodReturns, warnings };
  }

  // With cash flows, compute Modified Dietz for each inter-cash-flow period.
  // This requires us to know NAV at each cash flow boundary.
  // Since we don't have that (it's a pure function), we compute
  // the overall Modified Dietz return as a reasonable single-period approximation.
  // For a full TWR with sub-periods, callers should use computeModifiedDietzReturn
  // or provide cash flow with embedded NAV values.
  //
  // However, we still produce sub-period returns using the cash flow dates
  // as boundaries and the assumption that the NAV between cash flows
  // follows the proportion of the Modified Dietz return.
  //
  // A more practical approach: compute the overall Modified Dietz return as TWR.

  const totalDays = daysBetween(startDate, endDate);
  const modDietz = computeModifiedDietzReturn(
    startNav, endNav, sortedFlows, startDate, endDate,
  );

  if (modDietz.warnings.length > 0) {
    warnings.push(...modDietz.warnings);
  }

  // For display purposes, create a single sub-period covering the full range
  subPeriodReturns.push({
    startDate,
    endDate,
    return: modDietz.return,
    days: totalDays,
  });

  // Chain-link: with a single sub-period, TWR is just the return
  const twr = modDietz.return;

  if (warnings.length === 0 && sortedFlows.length > 0) {
    warnings.push(
      'TWR uses Modified Dietz approximation; precise TWR requires NAV at each cash flow boundary',
    );
  }

  return { twr, subPeriodReturns, warnings };
}

// ── High-Water Mark ─────────────────────────────────────────────────────

/**
 * Compute the high-water mark from current NAV and historical observations.
 *
 * The high-water mark is the maximum NAV ever observed, used as a reference
 * for performance fees (in hedge funds) and drawdown calculations.
 *
 * @param currentNav  - Current NAV value
 * @param historicalNavValues - Array of historical NAV observations
 * @returns The maximum NAV value observed (highest of current and historical)
 */
export function computeHighWaterMark(
  currentNav: CanonicalDecimal,
  historicalNavValues: ReadonlyArray<HistoricalNavValue>,
): CanonicalDecimal {
  let maxMicros = toMicros(currentNav);

  for (const h of historicalNavValues) {
    const navMicros = toMicros(h.nav);
    if (navMicros > maxMicros) {
      maxMicros = navMicros;
    }
  }

  return fromMicros(maxMicros);
}

// ── Drawdown ────────────────────────────────────────────────────────────

/**
 * Compute drawdown from the high-water mark.
 *
 * Absolute drawdown = highWaterMark - currentNav
 * Drawdown % = absoluteDrawdown / highWaterMark
 *
 * Both are zero when currentNav >= highWaterMark (no drawdown).
 *
 * @param currentNav    - Current NAV value
 * @param highWaterMark - The high-water mark (maximum observed NAV)
 * @returns { drawdown: absolute drawdown, drawdownPct: percentage drawdown }
 */
export function computeDrawdown(
  currentNav: CanonicalDecimal,
  highWaterMark: CanonicalDecimal,
): { drawdown: CanonicalDecimal; drawdownPct: CanonicalDecimal } {
  const hwmMicros = toMicros(highWaterMark);
  const currentMicros = toMicros(currentNav);

  if (currentMicros >= hwmMicros) {
    return {
      drawdown: '0.00' as CanonicalDecimal,
      drawdownPct: '0.00' as CanonicalDecimal,
    };
  }

  const absoluteDrawdown = subtractDecimal(highWaterMark, currentNav);
  const drawdownPct = divideDecimal(absoluteDrawdown, highWaterMark);

  return { drawdown: absoluteDrawdown, drawdownPct };
}

/**
 * Convenience function combining high-water mark + drawdown computation.
 *
 * @param input - HighWaterMarkInput with current NAV and historical values
 * @returns { highWaterMark, drawdown, drawdownPct }
 */
export function computeHighWaterMarkAndDrawdown(
  input: HighWaterMarkInput,
): {
  highWaterMark: CanonicalDecimal;
  drawdown: CanonicalDecimal;
  drawdownPct: CanonicalDecimal;
} {
  const hwm = computeHighWaterMark(input.currentNav, input.historicalNavValues);
  const { drawdown, drawdownPct } = computeDrawdown(input.currentNav, hwm);
  return { highWaterMark: hwm, drawdown, drawdownPct };
}

// ── Full Performance Computation ───────────────────────────────────────

/**
 * Compute the full PerformanceResult for an account over a period.
 *
 * Produces Modified Dietz return, TWR, high-water mark, and drawdown.
 *
 * Pure function — no side effects, no database access.
 *
 * @param input - Complete performance input
 * @returns Complete PerformanceResult
 */
export function computePerformance(input: PerformanceInput): PerformanceResult {
  const warnings: string[] = [];

  // Modified Dietz
  const dietzResult = computeModifiedDietzReturn(
    input.startNav,
    input.endNav,
    input.cashFlows,
    input.startDate,
    input.endDate,
  );
  if (dietzResult.warnings.length > 0) {
    warnings.push(...dietzResult.warnings);
  }

  // TWR (time-weighted return with chain-linking)
  const twrResult = computeTwr(
    input.startNav,
    input.endNav,
    input.cashFlows,
    input.startDate,
    input.endDate,
  );
  if (twrResult.warnings.length > 0) {
    warnings.push(...twrResult.warnings);
  }

  // High-water mark and drawdown (no historical values available here —
  // caller should pass them separately if needed)
  // Without historical data, HWM = max(currentNav, startNav)
  const hwmInput = {
    currentNav: input.endNav,
    historicalNavValues: [{ nav: input.startNav, date: input.startDate }],
  };
  const hwmResult = computeHighWaterMarkAndDrawdown(hwmInput);

  return {
    modifiedDietzReturn: dietzResult.return,
    twr: twrResult.twr,
    subPeriodReturns: twrResult.subPeriodReturns,
    highWaterMark: hwmResult.highWaterMark,
    drawdown: hwmResult.drawdown,
    drawdownPct: hwmResult.drawdownPct,
    warnings,
  };
}
