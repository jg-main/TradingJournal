/**
 * position-sizing.ts
 *
 * Pure (no side effects) position sizing calculation functions.
 * Computes risk per share, position size, risk amount, and reward-risk ratio
 * from account parameters, entry/stop prices, direction, and optional target.
 *
 * Decoupled from any database or schema — uses its own PositionSizingParams
 * shape so it can be tested independently.
 */

export type Direction = 'long' | 'short';

export interface PositionSizingParams {
  /** Total account equity in dollars */
  accountEquity: number;
  /** Percentage of account equity to risk on this trade (e.g. 1 for 1%) */
  riskPerTradePct: number;
  /** Entry price in dollars */
  entryPrice: number;
  /** Stop loss price in dollars */
  stopPrice: number;
  /** Trade direction */
  direction: Direction;
  /** Optional target price for reward-risk ratio calculation */
  targetPrice?: number;
}

export interface PositionSizingResult {
  /** Dollar risk per share (absolute difference between entry and stop) */
  riskPerShare: number;
  /** Number of shares/units to trade */
  positionSize: number;
  /** Total dollar amount at risk */
  riskAmount: number;
  /** Reward-risk ratio (undefined if no targetPrice provided) */
  rewardRiskRatio: number | undefined;
}

// ── Validation helpers ─────────────────────────────────────────────────

function validate(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Position sizing error: ${message}`);
  }
}

// ── 1. Position size calculation ───────────────────────────────────────

export function calculatePositionSize(
  params: PositionSizingParams,
): PositionSizingResult {
  const { accountEquity, riskPerTradePct, entryPrice, stopPrice, targetPrice } =
    params;

  // --- Input validation ---

  validate(
    typeof accountEquity === 'number' && !Number.isNaN(accountEquity),
    'accountEquity must be a valid number',
  );
  validate(accountEquity > 0, 'accountEquity must be positive');

  validate(
    typeof riskPerTradePct === 'number' && !Number.isNaN(riskPerTradePct),
    'riskPerTradePct must be a valid number',
  );
  validate(riskPerTradePct > 0, 'riskPerTradePct must be positive');

  validate(
    typeof entryPrice === 'number' && !Number.isNaN(entryPrice),
    'entryPrice must be a valid number',
  );
  validate(entryPrice > 0, 'entryPrice must be positive');

  validate(
    typeof stopPrice === 'number' && !Number.isNaN(stopPrice),
    'stopPrice must be a valid number',
  );
  validate(stopPrice > 0, 'stopPrice must be positive');

  // --- Core calculations ---

  const riskPerShare = Math.abs(entryPrice - stopPrice);

  validate(riskPerShare > 0, 'entryPrice and stopPrice must differ (riskPerShare would be 0)');

  const dollarRisk = (accountEquity * riskPerTradePct) / 100;
  const positionSize = dollarRisk / riskPerShare;

  validate(positionSize >= 0, `positionSize must not be negative (got ${positionSize})`);

  const riskAmount = positionSize * riskPerShare;

  // --- Optional reward-risk ratio ---

  let rewardRiskRatio: number | undefined;

  if (targetPrice !== undefined) {
    validate(
      typeof targetPrice === 'number' && !Number.isNaN(targetPrice),
      'targetPrice must be a valid number',
    );
    validate(targetPrice > 0, 'targetPrice must be positive');

    const targetDiff = Math.abs(targetPrice - entryPrice);
    rewardRiskRatio = targetDiff / riskPerShare;
  }

  return {
    riskPerShare,
    positionSize,
    riskAmount,
    rewardRiskRatio,
  };
}

// ── 2. Plan trade risk/reward preview ──────────────────────────────────

export interface PlanRiskRewardPreviewParams {
  /** Entry price in dollars */
  entryPrice: number;
  /** Trade direction */
  direction: Direction;
  /** Stop loss price in dollars (optional — risk can't be computed without it) */
  stopPrice?: number;
  /** Target price in dollars (optional — reward can't be computed without it) */
  targetPrice?: number;
  /** Number of shares/units (optional — dollar amounts are 0 without it) */
  quantity?: number;
}

export interface PlanRiskRewardPreviewResult {
  /** Risk as a percentage of entry price (null when stop is missing or entry is invalid) */
  riskPct: number | null;
  /** Risk in dollars (0 when quantity is 0, undefined, or NaN; null when riskPct is null) */
  riskDollar: number | null;
  /** Reward as a percentage of entry price (null when target is missing or entry is invalid) */
  rewardPct: number | null;
  /** Reward in dollars (0 when quantity is 0, undefined, or NaN; null when rewardPct is null) */
  rewardDollar: number | null;
  /** Reward-risk ratio (null when either risk or reward can't be computed, or risk is 0) */
  riskRewardRatio: number | null;
}

/**
 * Calculate risk/reward preview values for the Plan Trade form.
 *
 * Pure function matching the exact formulas used in the inline JSX IIFE
 * (plan-trade-form.tsx lines ~447-491). Returns the same numeric values
 * the form currently renders, with null for any computation that can't
 * be completed due to missing inputs.
 */
export function calculatePlanRiskRewardPreview(
  params: PlanRiskRewardPreviewParams,
): PlanRiskRewardPreviewResult {
  const { entryPrice, direction, stopPrice, targetPrice, quantity } = params;
  const isLong = direction === 'long';
  const qty = quantity ?? 0;

  // If entry is invalid, all calculations are meaningless
  if (!entryPrice || entryPrice <= 0) {
    return {
      riskPct: null,
      riskDollar: null,
      rewardPct: null,
      rewardDollar: null,
      riskRewardRatio: null,
    };
  }

  const canCalcRisk = stopPrice != null && stopPrice > 0;
  const canCalcReward = targetPrice != null && targetPrice > 0;

  let riskPct: number | null = null;
  let riskDollar: number | null = null;
  let rewardPct: number | null = null;
  let rewardDollar: number | null = null;

  if (canCalcRisk) {
    if (isLong) {
      riskPct = ((entryPrice - stopPrice!) / entryPrice) * 100;
    } else {
      riskPct = ((stopPrice! - entryPrice) / entryPrice) * 100;
    }
    riskDollar = (riskPct / 100) * entryPrice * qty;
  }

  if (canCalcReward) {
    if (isLong) {
      rewardPct = ((targetPrice! - entryPrice) / entryPrice) * 100;
    } else {
      rewardPct = ((entryPrice - targetPrice!) / entryPrice) * 100;
    }
    rewardDollar = (rewardPct / 100) * entryPrice * qty;
  }

  let riskRewardRatio: number | null = null;
  if (canCalcRisk && canCalcReward && riskPct != null && riskPct > 0) {
    riskRewardRatio = rewardPct! / riskPct;
  }

  return { riskPct, riskDollar, rewardPct, rewardDollar, riskRewardRatio };
}
