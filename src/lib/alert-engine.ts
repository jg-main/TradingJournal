/**
 * alert-engine.ts
 *
 * Pure (no side effects) alert computation functions for watchlist items.
 * Computes RSI (Relative Strength Index) and evaluates alert conditions
 * against current price data.
 *
 * Decoupled from any database or schema — uses its own type definitions
 * so it can be tested independently.
 */

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * A single OHLC price bar. Only the fields needed for RSI computation
 * are required: close prices over time.
 */
export interface OhlcBar {
  /** Trading date in YYYY-MM-DD format */
  date: string;
  /** Adjusted close price */
  close: number;
}

/**
 * Per-condition alert configuration for a single watchlist item.
 * Stored as JSON in the alert_config TEXT column.
 */
export interface AlertConfig {
  // Price crossing alerts — threshold is the item's keyLevel/triggerPrice/stop/target
  priceAboveKeyLevel?: { enabled: boolean };
  priceBelowKeyLevel?: { enabled: boolean };
  priceAboveTrigger?: { enabled: boolean };
  priceBelowTrigger?: { enabled: boolean };
  priceAboveStop?: { enabled: boolean };
  priceBelowStop?: { enabled: boolean };
  priceAboveTarget?: { enabled: boolean };
  priceBelowTarget?: { enabled: boolean };
  // RSI alerts
  rsiAbove?: { enabled: boolean; threshold: number };
  rsiBelow?: { enabled: boolean; threshold: number };
}

/**
 * Price data snapshot passed to evaluateAlertConditions.
 */
export interface PriceSnapshot {
  /** Latest known market price for the symbol */
  currentPrice: number;
  /** Computed RSI value (null if insufficient data) */
  rsi: number | null;
  /** Key price levels from the watchlist item */
  keyLevel?: number | null;
  triggerPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
}

/**
 * A single triggered alert condition.
 */
export interface TriggeredAlert {
  /** Machine-readable condition identifier */
  condition: string;
  /** Human-readable alert message */
  message: string;
}

// ── RSI Computation ──────────────────────────────────────────────────────

/**
 * Compute the Relative Strength Index (RSI) for an array of OHLC bars using
 * Wilder's smoothing method.
 *
 * @param bars - Array of OHLC bars sorted by date ASC. Requires at least
 *               `period + 1` bars to produce the first RSI value.
 * @param period - Lookback period (default 14). Standard values are 14, 9, 25.
 * @returns An array of the same length as `bars`. Entries before index
 *          `period` are `null` (insufficient data to compute).
 *          Subsequent entries contain the RSI value (0-100).
 *
 * Algorithm (Wilder's smoothing):
 *   1. Compute daily price changes: change[i] = close[i] - close[i-1]
 *   2. Separate into gains (positive changes) and losses (absolute negative changes)
 *   3. First average gain/loss: simple mean over first `period` changes
 *   4. Subsequent averages: smoothed = (prevAvg * (period - 1) + current) / period
 *   5. RS = avgGain / avgLoss
 *   6. RSI = 100 - (100 / (1 + RS))
 */
export function computeRSI(bars: OhlcBar[], period: number = 14): (number | null)[] {
  if (!Array.isArray(bars) || bars.length === 0) {
    return [];
  }

  if (period < 1) {
    throw new Error(`Alert engine error: RSI period must be >= 1, got ${period}`);
  }

  // Need at least period + 1 bars to compute one price change and then
  // average over `period` changes for the first RSI value
  if (bars.length < period + 1) {
    return bars.map(() => null);
  }

  // Initialize result array — all nulls by default.
  // RSI values will be filled at indices >= period.
  const result: (number | null)[] = new Array(bars.length).fill(null);

  // Step 1: Compute daily price changes (close[i] - close[i-1])
  // changes[i] corresponds to bars[i+1] - bars[i]
  const changes: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    changes.push(bars[i].close - bars[i - 1].close);
  }

  // Step 2: First average gain/loss over initial `period` changes
  // This uses changes[0] through changes[period-1] which correspond to
  // bars[1] through bars[period]. The first RSI goes at bars[period].
  let sumGain = 0;
  let sumLoss = 0;

  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      sumGain += changes[i];
    } else {
      sumLoss += Math.abs(changes[i]);
    }
  }

  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;

  // First RSI value at bars[period] (index = period)
  result[period] = avgLoss === 0
    ? 100
    : Math.round((100 - (100 / (1 + avgGain / avgLoss))) * 100) / 100;

  // Step 3: Compute RSI for subsequent bars using Wilder's smoothing
  // changes[i] corresponds to bars[i+1];
  // the next unprocessed change after the first avg is changes[period],
  // which gives RSI for bars[period + 1]
  for (let i = period; i < changes.length; i++) {
    const currentGain = changes[i] > 0 ? changes[i] : 0;
    const currentLoss = changes[i] < 0 ? Math.abs(changes[i]) : 0;

    // Wilder's smoothing
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    // RSI formula: 100 - (100 / (1 + RS))
    // changes[i] → bars[i+1]
    result[i + 1] = avgLoss === 0
      ? 100
      : Math.round((100 - (100 / (1 + avgGain / avgLoss))) * 100) / 100;
  }

  return result;
}

// ── Alert Condition Evaluation ───────────────────────────────────────────

/**
 * Evaluate alert conditions against current price data.
 *
 * Pure function — no external state. Takes the saved alert configuration
 * and a price snapshot, returns all currently triggered conditions.
 *
 * Condition transition tracking (e.g., "just crossed above" vs
 * "has been above") is handled in S04 which maintains prior evaluation
 * state.
 *
 * @param config - Alert configuration from the watchlist item
 * @param prices - Current price data snapshot
 * @returns Array of triggered alerts (empty if none triggered)
 */
export function evaluateAlertConditions(
  config: AlertConfig,
  prices: PriceSnapshot,
): TriggeredAlert[] {
  const triggered: TriggeredAlert[] = [];
  const price = prices.currentPrice;

  // ── Price crossing alerts ───────────────────────────────────────────

  if (config.priceAboveKeyLevel?.enabled && prices.keyLevel != null) {
    if (price > prices.keyLevel) {
      triggered.push({
        condition: 'price_above_keyLevel',
        message: `${formatPrice(price)} is above key level ${formatPrice(prices.keyLevel)}`,
      });
    }
  }

  if (config.priceBelowKeyLevel?.enabled && prices.keyLevel != null) {
    if (price < prices.keyLevel) {
      triggered.push({
        condition: 'price_below_keyLevel',
        message: `${formatPrice(price)} is below key level ${formatPrice(prices.keyLevel)}`,
      });
    }
  }

  if (config.priceAboveTrigger?.enabled && prices.triggerPrice != null) {
    if (price > prices.triggerPrice) {
      triggered.push({
        condition: 'price_above_trigger',
        message: `${formatPrice(price)} is above trigger price ${formatPrice(prices.triggerPrice)}`,
      });
    }
  }

  if (config.priceBelowTrigger?.enabled && prices.triggerPrice != null) {
    if (price < prices.triggerPrice) {
      triggered.push({
        condition: 'price_below_trigger',
        message: `${formatPrice(price)} is below trigger price ${formatPrice(prices.triggerPrice)}`,
      });
    }
  }

  if (config.priceAboveStop?.enabled && prices.stopPrice != null) {
    if (price > prices.stopPrice) {
      triggered.push({
        condition: 'price_above_stop',
        message: `${formatPrice(price)} is above stop price ${formatPrice(prices.stopPrice)}`,
      });
    }
  }

  if (config.priceBelowStop?.enabled && prices.stopPrice != null) {
    if (price < prices.stopPrice) {
      triggered.push({
        condition: 'price_below_stop',
        message: `${formatPrice(price)} is below stop price ${formatPrice(prices.stopPrice)}`,
      });
    }
  }

  if (config.priceAboveTarget?.enabled && prices.targetPrice != null) {
    if (price > prices.targetPrice) {
      triggered.push({
        condition: 'price_above_target',
        message: `${formatPrice(price)} is above target price ${formatPrice(prices.targetPrice)}`,
      });
    }
  }

  if (config.priceBelowTarget?.enabled && prices.targetPrice != null) {
    if (price < prices.targetPrice) {
      triggered.push({
        condition: 'price_below_target',
        message: `${formatPrice(price)} is below target price ${formatPrice(prices.targetPrice)}`,
      });
    }
  }

  // ── RSI alerts ──────────────────────────────────────────────────────

  if (config.rsiAbove?.enabled && prices.rsi != null) {
    if (prices.rsi > config.rsiAbove.threshold) {
      triggered.push({
        condition: 'rsi_above',
        message: `RSI ${prices.rsi.toFixed(1)} is above ${config.rsiAbove.threshold}`,
      });
    }
  }

  if (config.rsiBelow?.enabled && prices.rsi != null) {
    if (prices.rsi < config.rsiBelow.threshold) {
      triggered.push({
        condition: 'rsi_below',
        message: `RSI ${prices.rsi.toFixed(1)} is below ${config.rsiBelow.threshold}`,
      });
    }
  }

  return triggered;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a price value for display in alert messages.
 */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  return `$${price.toFixed(4)}`;
}
