/**
 * Unit tests for the Distance to Stop and Distance to Trigger column
 * calculations (M011/S04).
 *
 * The column accessorFns in `src/app/(trades)/trades/page.tsx` delegate to
 * `computeDistanceToStop` / `computeDistanceToTrigger` in
 * `src/lib/trade-formatters.tsx`. These tests cover:
 * - Long and short directions (Math.abs keeps both positive)
 * - Null inputs and zero-price/zero-trigger division guards
 * - Equal value edge cases
 * - The display contract: accessorFns return decimal fractions (not
 *   percentages) because formatPercent multiplies by 100 internally
 *
 * Run: npx vitest run "src/app/(trades)/trades/__tests__/distance-columns.test.ts"
 */

import { describe, it, expect } from 'vitest';
import { computeDistanceToStop, computeDistanceToTrigger, formatPercent } from '@/lib/trade-formatters';

describe('computeDistanceToStop', () => {
  it('returns the stop distance as a decimal fraction for a long (stop below market)', () => {
    // Market $100, Long stop $95 → 5.00%
    expect(computeDistanceToStop(100, 95)).toBe(0.05);
  });

  it('returns a positive distance for a short (stop above market)', () => {
    // Market $100, Short stop $105 → 5.00% (positive, not -500%)
    expect(computeDistanceToStop(100, 105)).toBe(0.05);
  });

  it('computes non-trivial distances correctly', () => {
    expect(computeDistanceToStop(50, 45)).toBe(0.1);
    expect(computeDistanceToStop(200, 150)).toBe(0.25);
  });

  it('returns 0 when market price equals the stop', () => {
    expect(computeDistanceToStop(100, 100)).toBe(0);
  });

  it('returns null when the market price is missing', () => {
    expect(computeDistanceToStop(null, 95)).toBeNull();
    expect(computeDistanceToStop(undefined, 95)).toBeNull();
  });

  it('returns null when the stop is missing', () => {
    expect(computeDistanceToStop(100, null)).toBeNull();
    expect(computeDistanceToStop(100, undefined)).toBeNull();
  });

  it('returns null when both inputs are missing', () => {
    expect(computeDistanceToStop(null, null)).toBeNull();
  });

  it('guards against division by zero when market price is 0', () => {
    expect(computeDistanceToStop(0, 95)).toBeNull();
  });
});

describe('computeDistanceToTrigger', () => {
  it('returns the trigger distance as a decimal fraction for a long (trigger below market)', () => {
    // Planned entry $50, market $48 → 4.00%
    expect(computeDistanceToTrigger(48, 50)).toBe(0.04);
  });

  it('returns the same positive distance when market is above the trigger', () => {
    // Planned entry $50, market $52 → 4.00% (e.g. short, trigger above market)
    expect(computeDistanceToTrigger(52, 50)).toBe(0.04);
  });

  it('computes non-trivial distances correctly', () => {
    expect(computeDistanceToTrigger(95, 100)).toBe(0.05);
    expect(computeDistanceToTrigger(120, 100)).toBe(0.2);
  });

  it('returns 0 when market price equals the trigger', () => {
    expect(computeDistanceToTrigger(50, 50)).toBe(0);
  });

  it('returns null when the current price is missing', () => {
    expect(computeDistanceToTrigger(null, 50)).toBeNull();
    expect(computeDistanceToTrigger(undefined, 50)).toBeNull();
  });

  it('returns null when the trigger (planned entry) is missing', () => {
    expect(computeDistanceToTrigger(48, null)).toBeNull();
    expect(computeDistanceToTrigger(48, undefined)).toBeNull();
  });

  it('guards against division by zero when the trigger is 0', () => {
    expect(computeDistanceToTrigger(48, 0)).toBeNull();
  });
});

describe('Distance column display contract', () => {
  it('formats stop distances as percentages without double-multiplying by 100', () => {
    // Regression guard for T01: the old accessorFn multiplied by 100 AND
    // formatPercent multiplies by 100, rendering "500.00%" instead of "5.00%".
    expect(formatPercent(computeDistanceToStop(100, 95) as number)).toBe('+5.00%');
    expect(formatPercent(computeDistanceToStop(100, 105) as number)).toBe('+5.00%');
  });

  it('formats trigger distances as percentages without double-multiplying by 100', () => {
    expect(formatPercent(computeDistanceToTrigger(48, 50) as number)).toBe('+4.00%');
    expect(formatPercent(computeDistanceToTrigger(52, 50) as number)).toBe('+4.00%');
  });

  it('renders an em dash when distance cannot be computed', () => {
    expect(formatPercent(computeDistanceToStop(null, null))).toBe('—');
    expect(formatPercent(computeDistanceToTrigger(null, 50))).toBe('—');
  });
});
