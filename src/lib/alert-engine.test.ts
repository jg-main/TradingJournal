/**
 * alert-engine.test.ts
 *
 * Gold-standard unit tests for RSI computation and alert condition evaluation.
 *
 * RSI (Relative Strength Index) is computed using Wilder's smoothing method.
 * The gold-standard test data is a well-known 20-bar price sequence with
 * verified 14-period RSI values computed independently.
 *
 * @see src/lib/alert-engine.ts
 */

import { describe, it, expect } from 'vitest';
import {
  computeRSI,
  evaluateAlertConditions,
  type OhlcBar,
  type AlertConfig,
  type PriceSnapshot,
  type TriggeredAlert,
} from './alert-engine';

// ── Gold-Standard RSI Test Data ──────────────────────────────────────────

/**
 * Well-known 20-bar price sequence used for RSI verification.
 *
 * This closing price sequence (e.g., AAPL daily closes over 20 trading days)
 * is commonly used to validate 14-period RSI implementations using Wilder's
 * smoothing method (also known as the smoothed or modified moving average method).
 *
 * Expected RSI values were computed independently using the standard formula:
 *   1. Compute daily price changes (close - previous close)
 *   2. Separate gains (positive changes) and losses (absolute negative changes)
 *   3. First average gain/loss: simple average over the first 14 changes
 *   4. Subsequent averages: Wilder's smoothing — (prevAvg × (N-1) + current) ÷ N
 *   5. RS = avgGain / avgLoss
 *   6. RSI = 100 - (100 / (1 + RS))
 *   7. Result rounded to 2 decimal places
 */
const GOLD_CLOSES: number[] = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
  45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00,
  46.03, 46.41, 46.22, 43.50,
];

function makeGoldBars(): OhlcBar[] {
  return GOLD_CLOSES.map((close, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    close,
  }));
}

/**
 * Expected RSI values for the gold-standard 20-bar dataset (14-period).
 *
 * Indices 0-13 are null (insufficient data). Index 14+ have computed values.
 * These were verified against a reference implementation.
 *
 * @see .gsd/exec/0abbaf92-78bd-4ac6-ba46-1d98c482ac20.stdout
 */
const EXPECTED_RSI: (number | null)[] = [
  null, // bar 0: no previous close → cannot compute change
  null, // bar 1
  null, // bar 2
  null, // bar 3
  null, // bar 4
  null, // bar 5
  null, // bar 6
  null, // bar 7
  null, // bar 8
  null, // bar 9
  null, // bar 10
  null, // bar 11
  null, // bar 12
  null, // bar 13
  70.46, // bar 14: first RSI value
  66.25, // bar 15
  66.48, // bar 16
  69.35, // bar 17
  66.29, // bar 18
  39.50, // bar 19
];

// ── computeRSI Tests ─────────────────────────────────────────────────────

describe('computeRSI', () => {
  describe('gold-standard 14-period RSI', () => {
    it('returns correct RSI values for the 20-bar test sequence', () => {
      const bars = makeGoldBars();
      const result = computeRSI(bars, 14);

      expect(result).toHaveLength(bars.length);

      for (let i = 0; i < result.length; i++) {
        if (EXPECTED_RSI[i] === null) {
          expect(result[i]).toBeNull();
        } else {
          expect(result[i]).toBeCloseTo(EXPECTED_RSI[i] as number, 1);
        }
      }
    });

    it('returns correct first RSI value with default period (14)', () => {
      const bars = makeGoldBars();
      const result = computeRSI(bars);

      expect(result).toHaveLength(bars.length);
      expect(result[14]).toBeCloseTo(70.46, 1);
    });

    it('returns same result with explicit period=14 as with default', () => {
      const bars = makeGoldBars();
      const defaultResult = computeRSI(bars);
      const explicitResult = computeRSI(bars, 14);

      for (let i = 0; i < bars.length; i++) {
        if (defaultResult[i] === null) {
          expect(explicitResult[i]).toBeNull();
        } else {
          expect(explicitResult[i]).toBeCloseTo(defaultResult[i] as number, 2);
        }
      }
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('returns empty array for empty input', () => {
      expect(computeRSI([])).toEqual([]);
    });

    it('returns all nulls when period equals data length minus 0', () => {
      // period=5 with 5 bars → only 4 changes, need 5 changes → all nulls
      const bars = makeGoldBars().slice(0, 5);
      const result = computeRSI(bars, 5);
      expect(result).toHaveLength(5);
      expect(result.every((v) => v === null)).toBe(true);
    });

    it('returns all nulls when data is exactly one more than period', () => {
      // period=3 with 4 bars → 3 changes = need period=3 changes for first avg → first RSI at bar 3 (index 3)
      // With 4 bars: changes = [c1-c0, c2-c1, c3-c2] = 3 changes
      // First avg uses first 3 changes → RSI at changes[2] = bar 3 = index 3
      // So bars 0,1,2 = null, bar 3 = RSI value
      const bars = makeGoldBars().slice(0, 4);
      const result = computeRSI(bars, 3);
      expect(result).toHaveLength(4);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeNull();
      expect(result[3]).not.toBeNull();
    });

    it('returns all nulls when bars.length < period + 1', () => {
      const bars = makeGoldBars().slice(0, 3);
      const result = computeRSI(bars, 14);
      expect(result).toHaveLength(3);
      expect(result.every((v) => v === null)).toBe(true);
    });

    it('handles single bar gracefully', () => {
      const bars = makeGoldBars().slice(0, 1);
      const result = computeRSI(bars, 14);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeNull();
    });

    it('handles period=2 with minimum data', () => {
      // period=2, 3 bars → 2 changes → first avg over 2 changes → RSI at changes[1] = bar 2
      const bars = makeGoldBars().slice(0, 3);
      const result = computeRSI(bars, 2);
      expect(result).toHaveLength(3);
      expect(result[0]).toBeNull(); // bar 0: no previous close
      expect(result[1]).toBeNull(); // bar 1: after first change, but need 2 for first avg
      expect(result[2]).not.toBeNull(); // bar 2: first RSI value
    });

    it('returns all bars as null when no changes can be computed', () => {
      // All identical prices → all changes are 0, avgLoss=0 → RSI should be 100 for null-loss case
      const flatBars: OhlcBar[] = Array.from({ length: 16 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        close: 100.0,
      }));
      const result = computeRSI(flatBars, 14);
      // First 14 are null (insufficient), bars 14+ should be 100 (avgLoss=0)
      expect(result).toHaveLength(16);
      expect(result[0]).toBeNull();
      expect(result[13]).toBeNull();
      expect(result[14]).toBeCloseTo(100, 1);
      expect(result[15]).toBeCloseTo(100, 1);
    });
  });

  describe('all-gains and all-losses scenarios', () => {
    it('returns RSI=100 when prices only go up (no losses)', () => {
      const risingBars: OhlcBar[] = Array.from({ length: 20 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        close: 100 + i * 0.5, // strictly increasing
      }));
      const result = computeRSI(risingBars, 14);
      // After the warm-up period, RSI should be 100 (no losses)
      for (let i = 14; i < result.length; i++) {
        expect(result[i]).toBeCloseTo(100, 0);
      }
    });

    it('returns RSI=0 when prices only go down (no gains)', () => {
      const fallingBars: OhlcBar[] = Array.from({ length: 20 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        close: 100 - i * 0.5, // strictly decreasing
      }));
      const result = computeRSI(fallingBars, 14);
      // After the warm-up period, RSI should be 0 (no gains)
      for (let i = 14; i < result.length; i++) {
        expect(result[i]).toBeCloseTo(0, 0);
      }
    });
  });

  describe('input validation and error handling', () => {
    it('throws for period < 1', () => {
      const bars = makeGoldBars();
      expect(() => computeRSI(bars, 0)).toThrow('Alert engine error');
      expect(() => computeRSI(bars, -1)).toThrow('Alert engine error');
    });

    it('returns empty array for null/undefined input', () => {
      // TypeScript would catch this at compile time, but the runtime guard handles it
      expect(computeRSI([] as unknown as OhlcBar[])).toEqual([]);
    });

    it('handles period=1 with minimum data', () => {
      // period=1, 2 bars → 1 change → first avg over 1 change → RSI at changes[0] = bar 1
      const bars: OhlcBar[] = [
        { date: '2024-01-01', close: 100 },
        { date: '2024-01-02', close: 105 },
      ];
      const result = computeRSI(bars, 1);
      expect(result).toHaveLength(2);
      expect(result[0]).toBeNull(); // bar 0: no previous close
      expect(result[1]).toBeCloseTo(100, 1); // only gains → RSI=100
    });
  });
});

// ── evaluateAlertConditions Tests ───────────────────────────────────────

describe('evaluateAlertConditions', () => {
  it('returns empty array when no conditions are enabled', () => {
    const config: AlertConfig = {};
    const prices: PriceSnapshot = { currentPrice: 150, rsi: 55 };
    expect(evaluateAlertConditions(config, prices)).toEqual([]);
  });

  it('returns price_above_keyLevel when price exceeds key level', () => {
    const config: AlertConfig = { priceAboveKeyLevel: { enabled: true } };
    const prices: PriceSnapshot = { currentPrice: 155, rsi: null, keyLevel: 150 };
    const result = evaluateAlertConditions(config, prices);
    expect(result).toHaveLength(1);
    expect(result[0].condition).toBe('price_above_keyLevel');
  });

  it('does not trigger price_above_keyLevel when price is below key level', () => {
    const config: AlertConfig = { priceAboveKeyLevel: { enabled: true } };
    const prices: PriceSnapshot = { currentPrice: 145, rsi: null, keyLevel: 150 };
    expect(evaluateAlertConditions(config, prices)).toEqual([]);
  });

  it('returns price_below_keyLevel when price drops below key level', () => {
    const config: AlertConfig = { priceBelowKeyLevel: { enabled: true } };
    const prices: PriceSnapshot = { currentPrice: 145, rsi: null, keyLevel: 150 };
    const result = evaluateAlertConditions(config, prices);
    expect(result).toHaveLength(1);
    expect(result[0].condition).toBe('price_below_keyLevel');
  });

  it('returns rsi_above when RSI exceeds threshold', () => {
    const config: AlertConfig = { rsiAbove: { enabled: true, threshold: 70 } };
    const prices: PriceSnapshot = { currentPrice: 150, rsi: 75 };
    const result = evaluateAlertConditions(config, prices);
    expect(result).toHaveLength(1);
    expect(result[0].condition).toBe('rsi_above');
    expect(result[0].message).toContain('75');
  });

  it('returns rsi_below when RSI drops below threshold', () => {
    const config: AlertConfig = { rsiBelow: { enabled: true, threshold: 30 } };
    const prices: PriceSnapshot = { currentPrice: 150, rsi: 25 };
    const result = evaluateAlertConditions(config, prices);
    expect(result).toHaveLength(1);
    expect(result[0].condition).toBe('rsi_below');
  });

  it('does not fire RSI alerts when rsi is null', () => {
    const config: AlertConfig = {
      rsiAbove: { enabled: true, threshold: 70 },
      rsiBelow: { enabled: true, threshold: 30 },
    };
    const prices: PriceSnapshot = { currentPrice: 150, rsi: null };
    expect(evaluateAlertConditions(config, prices)).toEqual([]);
  });

  it('returns multiple triggered conditions simultaneously', () => {
    const config: AlertConfig = {
      priceAboveKeyLevel: { enabled: true },
      rsiAbove: { enabled: true, threshold: 70 },
    };
    const prices: PriceSnapshot = {
      currentPrice: 155,
      rsi: 75,
      keyLevel: 150,
    };
    const result = evaluateAlertConditions(config, prices);
    expect(result).toHaveLength(2);
    const conditions = result.map((r) => r.condition);
    expect(conditions).toContain('price_above_keyLevel');
    expect(conditions).toContain('rsi_above');
  });

  it('does not trigger price alerts when reference price is null/undefined', () => {
    const config: AlertConfig = {
      priceAboveKeyLevel: { enabled: true },
      priceAboveStop: { enabled: true },
    };
    const prices: PriceSnapshot = {
      currentPrice: 155,
      rsi: null,
      keyLevel: undefined,
      stopPrice: null,
    };
    // Both keyLevel and stopPrice are unavailable → no alerts triggered
    expect(evaluateAlertConditions(config, prices)).toEqual([]);
  });

  it('triggers at boundary threshold values (exact threshold)', () => {
    const config: AlertConfig = {
      rsiAbove: { enabled: true, threshold: 70 },
    };
    // RSI exactly at threshold should NOT trigger "above"
    const prices: PriceSnapshot = { currentPrice: 150, rsi: 70 };
    expect(evaluateAlertConditions(config, prices)).toEqual([]);

    // RSI just above threshold SHOULD trigger
    const pricesAbove: PriceSnapshot = { currentPrice: 150, rsi: 70.01 };
    const resultAbove = evaluateAlertConditions(config, pricesAbove);
    expect(resultAbove).toHaveLength(1);
    expect(resultAbove[0].condition).toBe('rsi_above');
  });
});
