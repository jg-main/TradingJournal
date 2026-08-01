/**
 * Unit tests for the Distance to Stop and Distance to Trigger column
 * calculations (M011/S04 → M012/S04 direction-aware remediation).
 *
 * The column accessorFns in `src/app/(trades)/trades/page.tsx` delegate to
 * `computeDistanceToStop` / `computeDistanceToTrigger` in
 * `src/lib/trade-formatters.tsx`. These tests cover the audit P1-6 signed,
 * direction-aware semantics:
 * - Distance to Stop:  long → (price - stop) / price; short → (stop - price) / price
 * - Distance to Trigger (positive = distance remaining):
 *   long → (trigger - current) / trigger; short → (current - trigger) / trigger
 * - Positive = level not reached; zero = at the level; negative = crossed
 * - Null inputs, zero-price/zero-trigger division guards
 * - The display contract: accessorFns return decimal fractions (not
 *   percentages) because formatPercent multiplies by 100 internally
 *
 * Run: npx vitest run "src/app/(trades)/trades/__tests__/distance-columns.test.ts"
 */

import { describe, it, expect } from 'vitest';
import { computeDistanceToStop, computeDistanceToTrigger, formatPercent } from '@/lib/trade-formatters';

describe('computeDistanceToStop', () => {
  it('returns a positive stop distance for a long with the stop below market', () => {
    // Market $100, Long stop $95 → +5.00%
    expect(computeDistanceToStop(100, 95, 'long')).toBe(0.05);
  });

  it('returns a positive stop distance for a short with the stop above market', () => {
    // Market $100, Short stop $105 → +5.00%
    expect(computeDistanceToStop(100, 105, 'short')).toBe(0.05);
  });

  it('computes non-trivial distances correctly for both directions', () => {
    expect(computeDistanceToStop(50, 45, 'long')).toBe(0.1);
    expect(computeDistanceToStop(200, 250, 'short')).toBe(0.25);
  });

  it('returns 0 when market price equals the stop', () => {
    expect(computeDistanceToStop(100, 100, 'long')).toBe(0);
    expect(computeDistanceToStop(100, 100, 'short')).toBe(0);
  });

  it('returns a negative signed distance when a long stop is crossed', () => {
    // Long market $94, stop $95 → the stop has been crossed → negative
    expect(computeDistanceToStop(94, 95, 'long')).toBeCloseTo(-1 / 94, 10);
    expect(computeDistanceToStop(94, 95, 'long')).toBeLessThan(0);
  });

  it('returns a negative signed distance when a short stop is crossed', () => {
    // Short market $106, stop $105 → the stop has been crossed → negative
    expect(computeDistanceToStop(106, 105, 'short')).toBeCloseTo(-1 / 106, 10);
    expect(computeDistanceToStop(106, 105, 'short')).toBeLessThan(0);
  });

  it('returns null when the market price is missing', () => {
    expect(computeDistanceToStop(null, 95, 'long')).toBeNull();
    expect(computeDistanceToStop(undefined, 95, 'long')).toBeNull();
  });

  it('returns null when the stop is missing', () => {
    expect(computeDistanceToStop(100, null, 'long')).toBeNull();
    expect(computeDistanceToStop(100, undefined, 'long')).toBeNull();
  });

  it('returns null when both inputs are missing', () => {
    expect(computeDistanceToStop(null, null, 'long')).toBeNull();
  });

  it('guards against division by zero when market price is 0', () => {
    expect(computeDistanceToStop(0, 95, 'long')).toBeNull();
  });

  it('falls back to absolute distance for an unknown/missing direction', () => {
    // Callers predating the direction argument keep historical behavior.
    expect(computeDistanceToStop(100, 95, null)).toBe(0.05);
    expect(computeDistanceToStop(100, 105, undefined)).toBe(0.05);
  });
});

describe('computeDistanceToTrigger', () => {
  it('returns distance remaining for a long with the trigger above market', () => {
    // Planned entry $50, market $48 → +4.00% remaining
    expect(computeDistanceToTrigger(48, 50, 'long')).toBe(0.04);
  });

  it('returns distance remaining for a short with the trigger below market', () => {
    // Planned entry $50, market $52 → +4.00% remaining
    expect(computeDistanceToTrigger(52, 50, 'short')).toBe(0.04);
  });

  it('computes non-trivial distances correctly for both directions', () => {
    expect(computeDistanceToTrigger(95, 100, 'long')).toBe(0.05);
    expect(computeDistanceToTrigger(120, 100, 'short')).toBe(0.2);
  });

  it('returns 0 when market price equals the trigger', () => {
    expect(computeDistanceToTrigger(50, 50, 'long')).toBe(0);
    expect(computeDistanceToTrigger(50, 50, 'short')).toBe(0);
  });

  it('returns a negative signed distance when a long trigger is crossed', () => {
    // Long market $52, planned entry $50 → the market rose past the trigger → negative
    expect(computeDistanceToTrigger(52, 50, 'long')).toBeCloseTo(-2 / 50, 10);
    expect(computeDistanceToTrigger(52, 50, 'long')).toBeLessThan(0);
  });

  it('returns a negative signed distance when a short trigger is crossed', () => {
    // Short market $48, planned entry $50 → the market fell past the trigger → negative
    expect(computeDistanceToTrigger(48, 50, 'short')).toBeCloseTo(-2 / 50, 10);
    expect(computeDistanceToTrigger(48, 50, 'short')).toBeLessThan(0);
  });

  it('returns null when the current price is missing', () => {
    expect(computeDistanceToTrigger(null, 50, 'long')).toBeNull();
    expect(computeDistanceToTrigger(undefined, 50, 'long')).toBeNull();
  });

  it('returns null when the trigger (planned entry) is missing', () => {
    expect(computeDistanceToTrigger(48, null, 'long')).toBeNull();
    expect(computeDistanceToTrigger(48, undefined, 'long')).toBeNull();
  });

  it('guards against division by zero when the trigger is 0', () => {
    expect(computeDistanceToTrigger(48, 0, 'long')).toBeNull();
  });

  it('falls back to absolute distance for an unknown/missing direction', () => {
    expect(computeDistanceToTrigger(48, 50, null)).toBe(0.04);
    expect(computeDistanceToTrigger(52, 50, undefined)).toBe(0.04);
  });
});

describe('Distance column display contract', () => {
  it('formats uncrossed stop distances as positive percentages without double-multiplying by 100', () => {
    // Regression guard: the old accessorFn multiplied by 100 AND
    // formatPercent multiplies by 100, rendering "500.00%" instead of "5.00%".
    expect(formatPercent(computeDistanceToStop(100, 95, 'long') as number)).toBe('+5.00%');
    expect(formatPercent(computeDistanceToStop(100, 105, 'short') as number)).toBe('+5.00%');
  });

  it('formats crossed stop distances as negative percentages', () => {
    expect(formatPercent(computeDistanceToStop(94, 95, 'long') as number)).toBe('-1.06%');
    expect(formatPercent(computeDistanceToStop(106, 105, 'short') as number)).toBe('-0.94%');
  });

  it('formats uncrossed trigger distances as positive percentages', () => {
    expect(formatPercent(computeDistanceToTrigger(48, 50, 'long') as number)).toBe('+4.00%');
    expect(formatPercent(computeDistanceToTrigger(52, 50, 'short') as number)).toBe('+4.00%');
  });

  it('formats crossed trigger distances as negative percentages', () => {
    expect(formatPercent(computeDistanceToTrigger(52, 50, 'long') as number)).toBe('-4.00%');
    expect(formatPercent(computeDistanceToTrigger(48, 50, 'short') as number)).toBe('-4.00%');
  });

  it('renders an em dash when distance cannot be computed', () => {
    expect(formatPercent(computeDistanceToStop(null, null, 'long'))).toBe('—');
    expect(formatPercent(computeDistanceToTrigger(null, 50, 'long'))).toBe('—');
  });
});
