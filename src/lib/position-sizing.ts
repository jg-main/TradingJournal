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
