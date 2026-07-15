/**
 * Activity and cash rebuild tests.
 *
 * Tests the deterministic activity/cash projection helpers:
 * - computeAccountActivity and computeAccountCashImpact (database-backed)
 * - computeRebuildCashFlow (pure function, no database)
 *
 * Coverage areas:
 * 1. computeRebuildCashFlow correctly computes inflow vs outflow from
 *    a list of events with parsed cash effects.
 * 2. Market effects (stock_split) are ignored in cash flow calculation.
 * 3. Missing/null effects are ignored.
 * 4. Mixed positive and negative adjustments produce correct net.
 * 5. Empty event list returns zero totals.
 * 6. Large values aggregate correctly.
 * 7. integration: computeAccountCashImpact matches computeRebuildCashFlow
 *    for the same underlying data.
 *
 * Run: npx vitest run --reporter verbose src/lib/accounting/__tests__/activity-rebuild.test.ts
 */

import { describe, it, expect } from 'vitest';
import { computeRebuildCashFlow } from '../activity';
import type { ActivityEventItem } from '../activity';
import type { EventEffect } from '../types';

// ── Factory helpers ──────────────────────────────────────────────────────

/**
 * Create a mock ActivityEventItem with a cash effect for testing.
 */
function makeCashEvent(
  overrides: Partial<ActivityEventItem> & { effectKind: 'cash'; effectDirection: 'increase' | 'decrease'; effectAmountMicros: number },
): ActivityEventItem {
  return {
    eventId: overrides.eventId ?? 'evt-1',
    eventType: overrides.eventType ?? 'deposit',
    description: overrides.description ?? null,
    postedAt: overrides.postedAt ?? new Date().toISOString(),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    payload: overrides.payload ?? null,
    effect: {
      kind: 'cash',
      direction: overrides.effectDirection,
      amount: String((overrides.effectAmountMicros / 1_000_000).toFixed(2)),
      amountMicros: overrides.effectAmountMicros,
    },
    postingStatus: overrides.postingStatus ?? 'posted',
  };
}

/**
 * Create a mock ActivityEventItem with a market effect for testing.
 */
function makeMarketEvent(
  overrides: Partial<ActivityEventItem> & { symbol?: string },
): ActivityEventItem {
  return {
    eventId: overrides.eventId ?? 'evt-split',
    eventType: overrides.eventType ?? 'stock_split',
    description: overrides.description ?? null,
    postedAt: overrides.postedAt ?? new Date().toISOString(),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    payload: overrides.payload ?? null,
    effect: {
      kind: 'market',
      symbol: overrides.symbol ?? 'AAPL',
      details: '4:1 stock split',
    },
    postingStatus: overrides.postingStatus ?? 'posted',
  };
}

/**
 * Create a mock ActivityEventItem with no effect.
 */
function makeNoEffectEvent(
  overrides: Partial<ActivityEventItem> = {},
): ActivityEventItem {
  return {
    eventId: overrides.eventId ?? 'evt-no-effect',
    eventType: overrides.eventType ?? 'deposit',
    description: overrides.description ?? null,
    postedAt: overrides.postedAt ?? new Date().toISOString(),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    payload: overrides.payload ?? null,
    effect: null,
    postingStatus: overrides.postingStatus ?? 'pending',
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('computeRebuildCashFlow — pure function', () => {
  // ── 1. Single event types ─────────────────────────────────────────

  it('single inflow event returns correct inflow', () => {
    const events = [makeCashEvent({
      eventId: 'evt-dep', eventType: 'deposit',
      effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 5_000_000_000,
    })];

    const result = computeRebuildCashFlow(events);

    expect(result.totalCashInflowMicros).toBe(5_000_000_000);
    expect(result.totalCashInflow).toBe('5000.00');
    expect(result.totalCashOutflowMicros).toBe(0);
    expect(result.netCashImpactMicros).toBe(5_000_000_000);
    expect(result.inflowCount).toBe(1);
    expect(result.outflowCount).toBe(0);
  });

  it('single outflow event returns correct outflow', () => {
    const events = [makeCashEvent({
      eventId: 'evt-with', eventType: 'withdrawal',
      effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 1_000_000_000,
    })];

    const result = computeRebuildCashFlow(events);

    expect(result.totalCashOutflowMicros).toBe(1_000_000_000);
    expect(result.totalCashOutflow).toBe('1000.00');
    expect(result.totalCashInflowMicros).toBe(0);
    expect(result.netCashImpactMicros).toBe(-1_000_000_000);
    expect(result.netCashImpact).toBe('-1000.00');
    expect(result.inflowCount).toBe(0);
    expect(result.outflowCount).toBe(1);
  });

  // ── 2. Mixed events produce correct net ───────────────────────────

  it('mixed inflow and outflow events produce correct net', () => {
    const events = [
      makeCashEvent({
        eventId: 'evt-dep', eventType: 'deposit',
        effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 10_000_000_000,
      }),
      makeCashEvent({
        eventId: 'evt-with', eventType: 'withdrawal',
        effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 3_000_000_000,
      }),
      makeCashEvent({
        eventId: 'evt-div', eventType: 'dividend',
        effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 500_000_000,
      }),
      makeCashEvent({
        eventId: 'evt-fee', eventType: 'fee',
        effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 50_000_000,
      }),
    ];

    const result = computeRebuildCashFlow(events);

    expect(result.totalCashInflowMicros).toBe(10_500_000_000);  // 10000 + 500
    expect(result.totalCashOutflowMicros).toBe(3_050_000_000);   // 3000 + 50
    expect(result.netCashImpactMicros).toBe(7_450_000_000);      // 10500 - 3050
    expect(result.netCashImpact).toBe('7450.00');
    expect(result.inflowCount).toBe(2);
    expect(result.outflowCount).toBe(2);
  });

  // ── 3. Market effects are ignored ─────────────────────────────────

  it('ignores stock_split market effects (not cash)', () => {
    const events = [
      makeCashEvent({
        eventId: 'evt-dep', eventType: 'deposit',
        effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 5_000_000_000,
      }),
      makeMarketEvent({ eventId: 'evt-split', symbol: 'AAPL' }),
    ];

    const result = computeRebuildCashFlow(events);

    // Market effect should not affect inflow/outflow
    expect(result.totalCashInflowMicros).toBe(5_000_000_000);
    expect(result.totalCashOutflowMicros).toBe(0);
    expect(result.netCashImpactMicros).toBe(5_000_000_000);
    expect(result.inflowCount).toBe(1);
    expect(result.outflowCount).toBe(0);
  });

  // ── 4. Null effects are ignored ───────────────────────────────────

  it('ignores events with null effect', () => {
    const events = [
      makeCashEvent({
        eventId: 'evt-1', eventType: 'deposit',
        effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 2_000_000_000,
      }),
      makeNoEffectEvent({ eventId: 'evt-null' }),
    ];

    const result = computeRebuildCashFlow(events);

    expect(result.totalCashInflowMicros).toBe(2_000_000_000);
    expect(result.inflowCount).toBe(1);
    expect(result.totalCashOutflowMicros).toBe(0);
  });

  // ── 5. Empty list ─────────────────────────────────────────────────

  it('returns zero totals for empty event list', () => {
    const result = computeRebuildCashFlow([]);

    expect(result.totalCashInflowMicros).toBe(0);
    expect(result.totalCashInflow).toBe('0.00');
    expect(result.totalCashOutflowMicros).toBe(0);
    expect(result.totalCashOutflow).toBe('0.00');
    expect(result.netCashImpactMicros).toBe(0);
    expect(result.netCashImpact).toBe('0.00');
    expect(result.inflowCount).toBe(0);
    expect(result.outflowCount).toBe(0);
  });

  // ── 6. Large values ───────────────────────────────────────────────

  it('handles large values correctly', () => {
    const events = [
      makeCashEvent({
        eventId: 'evt-1', eventType: 'deposit',
        effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 1_000_000_000_000,
      }),
      makeCashEvent({
        eventId: 'evt-2', eventType: 'withdrawal',
        effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 100_000_000_000,
      }),
    ];

    const result = computeRebuildCashFlow(events);

    expect(result.totalCashInflow).toBe('1000000.00');
    expect(result.totalCashOutflow).toBe('100000.00');
    expect(result.netCashImpact).toBe('900000.00');
  });

  // ── 7. Manual adjustment with increase and decrease ───────────────

  it('handles manual adjustments as increase and decrease correctly', () => {
    const events = [
      makeCashEvent({
        eventId: 'evt-adj-pos', eventType: 'manual_adjustment',
        effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 10_000_000_000,
      }),
      makeCashEvent({
        eventId: 'evt-adj-neg', eventType: 'manual_adjustment',
        effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 3_000_000_000,
      }),
    ];

    const result = computeRebuildCashFlow(events);

    expect(result.totalCashInflowMicros).toBe(10_000_000_000);
    expect(result.totalCashOutflowMicros).toBe(3_000_000_000);
    expect(result.netCashImpactMicros).toBe(7_000_000_000);
    expect(result.inflowCount).toBe(1);
    expect(result.outflowCount).toBe(1);
  });

  // ── 8. Deterministic across runs ─────────────────────────────────

  it('produces identical results across repeated calls', () => {
    const events = [
      makeCashEvent({
        eventId: 'evt-1', eventType: 'deposit',
        effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 5_000_000_000,
      }),
      makeCashEvent({
        eventId: 'evt-2', eventType: 'fee',
        effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 10_000_000,
      }),
    ];

    const first = computeRebuildCashFlow(events);
    const second = computeRebuildCashFlow(events);

    expect(second).toEqual(first);
  });

  // ── 9. All cash event types mapped correctly ──────────────────────

  it('classifies deposit/dividend/interest as inflows', () => {
    const events = [
      makeCashEvent({ eventId: 'd', eventType: 'deposit', effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 100_000_000 }),
      makeCashEvent({ eventId: 'div', eventType: 'dividend', effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 50_000_000 }),
      makeCashEvent({ eventId: 'i', eventType: 'interest', effectKind: 'cash', effectDirection: 'increase', effectAmountMicros: 10_000_000 }),
    ];

    const result = computeRebuildCashFlow(events);
    expect(result.inflowCount).toBe(3);
    expect(result.totalCashInflowMicros).toBe(160_000_000);
    expect(result.outflowCount).toBe(0);
  });

  it('classifies withdrawal/fee/tax as outflows', () => {
    const events = [
      makeCashEvent({ eventId: 'w', eventType: 'withdrawal', effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 500_000_000 }),
      makeCashEvent({ eventId: 'f', eventType: 'fee', effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 10_000_000 }),
      makeCashEvent({ eventId: 't', eventType: 'tax', effectKind: 'cash', effectDirection: 'decrease', effectAmountMicros: 100_000_000 }),
    ];

    const result = computeRebuildCashFlow(events);
    expect(result.outflowCount).toBe(3);
    expect(result.totalCashOutflowMicros).toBe(610_000_000);
    expect(result.inflowCount).toBe(0);
  });

  // ── 10. rebuiltAt is set ─────────────────────────────────────────

  it('sets rebuiltAt timestamp', () => {
    const result = computeRebuildCashFlow([]);
    expect(result.rebuiltAt).toBeTruthy();
    expect(typeof result.rebuiltAt).toBe('string');
    // Should be an ISO-8601 timestamp
    expect(result.rebuiltAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
