/**
 * valuation.test.ts
 *
 * Table-driven tests for the valuation pure functions.
 *
 * Coverage areas:
 * 1. Mark status classification (fresh, stale, missing)
 * 2. Mark age computation
 * 3. Marked position value (long, short, flat, no mark)
 * 4. Unrealized P&L (long, short, no mark, flat)
 * 5. deriveValuationPosition integration
 * 6. NAV computation
 * 7. Aggregate realized P&L
 * 8. Aggregate unrealized P&L
 * 9. Total fees (no event fees, with event fees)
 * 10. Gross/net exposure
 * 11. Full AccountValuation derived from positions
 * 12. Warnings for missing/stale marks
 */

import { describe, it, expect } from 'vitest';
import type { CanonicalDecimal } from '../accounting/types';
import type { PositionDirection } from '../positions/types';
import type { MarkSource, ValuationPosition } from './types';
import {
  computeMarkStatus,
  computeMarkAgeMinutes,
  absoluteQuantity,
  computeMarkedValue,
  computeUnrealizedPnl,
  computeUnrealizedPnlFromMarkMicros,
  deriveValuationPosition,
  computeNav,
  computeNavBreakdown,
  computeRealizedPnl,
  computeAggregateUnrealizedPnl,
  computeTotalFees,
  computeGrossExposure,
  computeNetExposure,
  deriveValuationWarnings,
  computeAccountValuation,
  DEFAULT_FRESHNESS_THRESHOLD_MINUTES,
} from './valuation';

// ── Helpers ──────────────────────────────────────────────────────────────

const CD = (v: string) => v as CanonicalDecimal;

function makeTimestamp(isoDate: string): string {
  return `${isoDate}T12:00:00.000Z`;
}

// ── computeMarkStatus ───────────────────────────────────────────────────

describe('computeMarkStatus', () => {
  it('returns missing when markTimestamp is null', () => {
    expect(computeMarkStatus(null, makeTimestamp('2026-01-15'))).toBe('missing');
  });

  it('returns fresh for a mark within the threshold', () => {
    const markTs = makeTimestamp('2026-01-15');
    const nowTs = makeTimestamp('2026-01-15'); // same day
    expect(computeMarkStatus(markTs, nowTs, 1440)).toBe('fresh');

    // 23 hours later (still within 1440 min)
    const laterTs = '2026-01-16T11:00:00.000Z';
    expect(computeMarkStatus(markTs, laterTs, 1440)).toBe('fresh');
  });

  it('returns stale for a mark older than the threshold', () => {
    const markTs = makeTimestamp('2026-01-10');
    const nowTs = makeTimestamp('2026-01-15'); // 5 days = 7200 min
    expect(computeMarkStatus(markTs, nowTs, 1440)).toBe('stale');
  });

  it('returns fresh for a future-dated mark', () => {
    const markTs = makeTimestamp('2026-01-20');
    const nowTs = makeTimestamp('2026-01-15');
    expect(computeMarkStatus(markTs, nowTs, 1440)).toBe('fresh');
  });

  it('uses default threshold of 1440 minutes (24h)', () => {
    expect(DEFAULT_FRESHNESS_THRESHOLD_MINUTES).toBe(1440);
    const markTs = makeTimestamp('2026-01-14');
    const nowTs = makeTimestamp('2026-01-15'); // 24h later (exactly at threshold)
    expect(computeMarkStatus(markTs, nowTs)).toBe('fresh');

    const nowTs2 = makeTimestamp('2026-01-16'); // 48h later
    expect(computeMarkStatus(markTs, nowTs2)).toBe('stale');
  });

  describe('table-driven edge cases', () => {
    const cases: Array<{
      label: string;
      markTs: string | null;
      nowTs: string;
      threshold: number;
      expected: string;
    }> = [
      { label: 'null mark → missing', markTs: null, nowTs: makeTimestamp('2026-01-15'), threshold: 1440, expected: 'missing' },
      { label: 'invalid mark date → missing', markTs: 'not-a-date', nowTs: makeTimestamp('2026-01-15'), threshold: 1440, expected: 'missing' },
      { label: 'invalid now date → missing', markTs: makeTimestamp('2026-01-14'), nowTs: 'not-a-date', threshold: 1440, expected: 'missing' },
      { label: '1 minute old with 2 min threshold → fresh', markTs: '2026-01-15T11:59:00.000Z', nowTs: '2026-01-15T12:00:00.000Z', threshold: 2, expected: 'fresh' },
      { label: '3 minutes old with 2 min threshold → stale', markTs: '2026-01-15T11:57:00.000Z', nowTs: '2026-01-15T12:00:00.000Z', threshold: 2, expected: 'stale' },
      { label: 'exactly at threshold → fresh', markTs: '2026-01-15T10:00:00.000Z', nowTs: '2026-01-15T12:00:00.000Z', threshold: 120, expected: 'fresh' },
      { label: '1 min past threshold → stale', markTs: '2026-01-15T09:59:00.000Z', nowTs: '2026-01-15T12:00:00.000Z', threshold: 120, expected: 'stale' },
    ];

    for (const c of cases) {
      it(`${c.label}`, () => {
        expect(computeMarkStatus(c.markTs, c.nowTs, c.threshold)).toBe(c.expected);
      });
    }
  });
});

// ── computeMarkAgeMinutes ────────────────────────────────────────────────

describe('computeMarkAgeMinutes', () => {
  it('returns null for null markTimestamp', () => {
    expect(computeMarkAgeMinutes(null, makeTimestamp('2026-01-15'))).toBeNull();
  });

  it('returns 0 for a mark made now', () => {
    const ts = makeTimestamp('2026-01-15');
    expect(computeMarkAgeMinutes(ts, ts)).toBe(0);
  });

  it('returns positive minutes for an older mark', () => {
    const markTs = makeTimestamp('2026-01-14');
    const nowTs = makeTimestamp('2026-01-15');
    expect(computeMarkAgeMinutes(markTs, nowTs)).toBe(1440); // 24 hours
  });

  it('returns null for invalid timestamps', () => {
    expect(computeMarkAgeMinutes('bad-date', makeTimestamp('2026-01-15'))).toBeNull();
  });
});

// ── absoluteQuantity ─────────────────────────────────────────────────────

describe('absoluteQuantity', () => {
  it('returns positive for positive input', () => {
    expect(absoluteQuantity(CD('100.00'))).toBe(CD('100.00'));
  });

  it('returns positive for negative input', () => {
    expect(absoluteQuantity(CD('-100.00'))).toBe(CD('100.00'));
  });

  it('returns zero for zero', () => {
    expect(absoluteQuantity(CD('0.00'))).toBe(CD('0.00'));
  });
});

// ── computeMarkedValue ──────────────────────────────────────────────────

describe('computeMarkedValue', () => {
  it('returns null for flat position (quantity = 0)', () => {
    expect(computeMarkedValue(CD('0.00'), CD('150.00'))).toBeNull();
  });

  it('returns null when markPrice is null', () => {
    expect(computeMarkedValue(CD('100.00'), null)).toBeNull();
  });

  it('computes positive marked value for long position', () => {
    expect(computeMarkedValue(CD('100.00'), CD('150.00'))).toBe(CD('15000.00'));
  });

  it('computes negative marked value for short position', () => {
    expect(computeMarkedValue(CD('-100.00'), CD('150.00'))).toBe(CD('-15000.00'));
  });

  it('computes zero marked value for zero price', () => {
    expect(computeMarkedValue(CD('100.00'), CD('0.00'))).toBe(CD('0.00'));
  });

  describe('table-driven', () => {
    const cases: Array<{
      label: string;
      quantity: CanonicalDecimal;
      price: CanonicalDecimal | null;
      expected: CanonicalDecimal | null;
    }> = [
      { label: 'long 10 @ 50 = 500', quantity: CD('10.00'), price: CD('50.00'), expected: CD('500.00') },
      { label: 'long 0.01 @ 10000 = 100', quantity: CD('0.01'), price: CD('10000.00'), expected: CD('100.00') },
      { label: 'short 10 @ 50 = -500', quantity: CD('-10.00'), price: CD('50.00'), expected: CD('-500.00') },
      { label: 'short 0.01 @ 10000 = -100', quantity: CD('-0.01'), price: CD('10000.00'), expected: CD('-100.00') },
      { label: 'flat → null', quantity: CD('0.00'), price: CD('100.00'), expected: null },
      { label: 'null price → null', quantity: CD('10.00'), price: null, expected: null },
    ];

    for (const c of cases) {
      it(`${c.label}`, () => {
        expect(computeMarkedValue(c.quantity, c.price)).toBe(c.expected);
      });
    }
  });
});

// ── computeUnrealizedPnl ───────────────────────────────────────────────

describe('computeUnrealizedPnl', () => {
  it('returns null when markPrice is null', () => {
    expect(computeUnrealizedPnl(CD('100.00'), null, CD('10.00'), 'long')).toBeNull();
  });

  it('returns null when quantity is flat', () => {
    expect(computeUnrealizedPnl(CD('100.00'), CD('110.00'), CD('0.00'), 'long')).toBeNull();
  });

  it('returns null when direction is null', () => {
    expect(computeUnrealizedPnl(CD('100.00'), CD('110.00'), CD('0.00'), null)).toBeNull();
  });

  it('computes positive unrealized P&L for long above cost', () => {
    // (110 - 100) × 10 = 100
    expect(computeUnrealizedPnl(CD('100.00'), CD('110.00'), CD('10.00'), 'long')).toBe(CD('100.00'));
  });

  it('computes negative unrealized P&L for long below cost', () => {
    // (90 - 100) × 10 = -100
    expect(computeUnrealizedPnl(CD('100.00'), CD('90.00'), CD('10.00'), 'long')).toBe(CD('-100.00'));
  });

  it('computes positive unrealized P&L for short below cost', () => {
    // (100 - 90) × |10| = 100
    expect(computeUnrealizedPnl(CD('100.00'), CD('90.00'), CD('-10.00'), 'short')).toBe(CD('100.00'));
  });

  it('computes negative unrealized P&L for short above cost', () => {
    // (100 - 110) × |10| = -100
    expect(computeUnrealizedPnl(CD('100.00'), CD('110.00'), CD('-10.00'), 'short')).toBe(CD('-100.00'));
  });

  describe('table-driven', () => {
    const cases: Array<{
      label: string;
      avgCost: CanonicalDecimal;
      markPrice: CanonicalDecimal | null;
      quantity: CanonicalDecimal;
      direction: PositionDirection | null;
      expected: CanonicalDecimal | null;
    }> = [
      { label: 'long 100@100 → 110@100 = +1000', avgCost: CD('100.00'), markPrice: CD('110.00'), quantity: CD('100.00'), direction: 'long', expected: CD('1000.00') },
      { label: 'long 100@100 → 90@100 = -1000', avgCost: CD('100.00'), markPrice: CD('90.00'), quantity: CD('100.00'), direction: 'long', expected: CD('-1000.00') },
      { label: 'long same price → 0', avgCost: CD('100.00'), markPrice: CD('100.00'), quantity: CD('100.00'), direction: 'long', expected: CD('0.00') },
      { label: 'short 100@100 → 90@-100 = +1000', avgCost: CD('100.00'), markPrice: CD('90.00'), quantity: CD('-100.00'), direction: 'short', expected: CD('1000.00') },
      { label: 'short 100@100 → 110@-100 = -1000', avgCost: CD('100.00'), markPrice: CD('110.00'), quantity: CD('-100.00'), direction: 'short', expected: CD('-1000.00') },
      { label: 'short same price → 0', avgCost: CD('100.00'), markPrice: CD('100.00'), quantity: CD('-100.00'), direction: 'short', expected: CD('0.00') },
      { label: 'null price → null', avgCost: CD('100.00'), markPrice: null, quantity: CD('10.00'), direction: 'long', expected: null },
      { label: 'flat → null', avgCost: CD('100.00'), markPrice: CD('110.00'), quantity: CD('0.00'), direction: null, expected: null },
    ];

    for (const c of cases) {
      it(`${c.label}`, () => {
        expect(computeUnrealizedPnl(c.avgCost, c.markPrice, c.quantity, c.direction)).toBe(c.expected);
      });
    }
  });
});

// ── computeUnrealizedPnlFromMarkMicros ──────────────────────────────────

describe('computeUnrealizedPnlFromMarkMicros', () => {
  it('preserves a sub-cent market quote until the P&L result is rounded', () => {
    // (11.615 - 11.30) × 10 = 3.15. Rounding the mark to 11.62 first would
    // incorrectly report 3.20 and diverge from the Trades mark-to-market.
    expect(
      computeUnrealizedPnlFromMarkMicros(
        CD('11.30'),
        11_615_000,
        CD('10.00'),
        'long',
      ),
    ).toBe(CD('3.15'));
  });

  it('returns null for an absent mark', () => {
    expect(
      computeUnrealizedPnlFromMarkMicros(CD('11.30'), null, CD('10.00'), 'long'),
    ).toBeNull();
  });
});

// ── deriveValuationPosition ─────────────────────────────────────────────

describe('deriveValuationPosition', () => {
  const basePosition = {
    instrumentId: 'AAPL',
    direction: 'long' as PositionDirection,
    quantity: CD('100.00'),
    averageCost: CD('150.00'),
    totalCostBasis: CD('15000.00'),
    realizedPnl: CD('500.00'),
    realizedFees: CD('25.00'),
    realizedNetPnl: CD('475.00'),
  };

  const nowTs = makeTimestamp('2026-01-15');

  it('produces correct ValuationPosition with a fresh mark', () => {
    const result = deriveValuationPosition(
      basePosition,
      { price: CD('160.00'), timestamp: nowTs, source: 'user' as MarkSource },
      nowTs,
    );

    expect(result.instrumentId).toBe('AAPL');
    expect(result.direction).toBe('long');
    expect(result.quantity).toBe(CD('100.00'));
    expect(result.markPrice).toBe(CD('160.00'));
    expect(result.markStatus).toBe('fresh');
    expect(result.markedValue).toBe(CD('16000.00'));
    expect(result.unrealizedPnl).toBe(CD('1000.00'));
    expect(result.markSource).toBe('user');
    expect(result.markAgeMinutes).toBe(0);
  });

  it('retains a quote micro price for valuation while exposing its display price', () => {
    const position = {
      ...basePosition,
      quantity: CD('10.00'),
      averageCost: CD('11.30'),
      totalCostBasis: CD('113.00'),
    };

    const result = deriveValuationPosition(
      position,
      {
        price: CD('11.62'),
        priceMicros: 11_615_000,
        timestamp: nowTs,
        source: 'market_data' as MarkSource,
      },
      nowTs,
    );

    // 10 × 11.615 = 116.15 and (11.615 - 11.30) × 10 = 3.15.
    // Rounding before the calculation would incorrectly return 116.20 / 3.20.
    expect(result.markPrice).toBe(CD('11.62'));
    expect(result.markedValue).toBe(CD('116.15'));
    expect(result.unrealizedPnl).toBe(CD('3.15'));
  });

  it('produces missing status with null mark', () => {
    const result = deriveValuationPosition(basePosition, null, nowTs);

    expect(result.markStatus).toBe('missing');
    expect(result.markPrice).toBeNull();
    expect(result.markedValue).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.markSource).toBeNull();
    expect(result.markAgeMinutes).toBeNull();
  });

  it('produces stale status with old mark', () => {
    const oldTs = makeTimestamp('2026-01-10');
    const result = deriveValuationPosition(
      basePosition,
      { price: CD('155.00'), timestamp: oldTs, source: 'market_data' as MarkSource },
      nowTs,
      60, // 1 hour threshold
    );

    expect(result.markStatus).toBe('stale');
    expect(result.markPrice).toBe(CD('155.00'));
    expect(result.markSource).toBe('market_data');
    expect(result.markAgeMinutes).toBeGreaterThan(0);
  });

  it('sets flat position with null mark values', () => {
    const flatPos = { ...basePosition, quantity: CD('0.00'), direction: null };
    const result = deriveValuationPosition(flatPos, null, nowTs);

    expect(result.markedValue).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
  });
});

// ── computeNav ──────────────────────────────────────────────────────────

describe('computeNav', () => {
  it('adds cash and marked positions', () => {
    expect(computeNav(CD('50000.00'), CD('15000.00'))).toBe(CD('65000.00'));
  });

  it('handles zero cash', () => {
    expect(computeNav(CD('0.00'), CD('15000.00'))).toBe(CD('15000.00'));
  });

  it('handles zero positions', () => {
    expect(computeNav(CD('50000.00'), CD('0.00'))).toBe(CD('50000.00'));
  });

  it('handles negative positions (short)', () => {
    // Negative marked positions reduce NAV
    expect(computeNav(CD('50000.00'), CD('-15000.00'))).toBe(CD('35000.00'));
  });
});

// ── computeNavBreakdown ─────────────────────────────────────────────────

describe('computeNavBreakdown', () => {
  it('returns cash and markedPositions', () => {
    const result = computeNavBreakdown(CD('50000.00'), CD('15000.00'));
    expect(result.cash).toBe(CD('50000.00'));
    expect(result.markedPositions).toBe(CD('15000.00'));
  });
});

// ── computeRealizedPnl ──────────────────────────────────────────────────

describe('computeRealizedPnl', () => {
  it('sums realizedNetPnl from multiple positions', () => {
    const positions = [
      { realizedNetPnl: CD('500.00') },
      { realizedNetPnl: CD('-200.00') },
      { realizedNetPnl: CD('300.00') },
    ];
    expect(computeRealizedPnl(positions)).toBe(CD('600.00'));
  });

  it('returns 0.00 for empty array', () => {
    expect(computeRealizedPnl([])).toBe(CD('0.00'));
  });

  it('handles single position', () => {
    expect(computeRealizedPnl([{ realizedNetPnl: CD('475.00') }])).toBe(CD('475.00'));
  });
});

// ── computeAggregateUnrealizedPnl ────────────────────────────────────────

describe('computeAggregateUnrealizedPnl', () => {
  it('sums non-null unrealized P&L values', () => {
    const positions = [
      { unrealizedPnl: CD('1000.00') },
      { unrealizedPnl: CD('-500.00') },
      { unrealizedPnl: CD('200.00') },
    ];
    expect(computeAggregateUnrealizedPnl(positions)).toBe(CD('700.00'));
  });

  it('skips null values', () => {
    const positions = [
      { unrealizedPnl: CD('1000.00') },
      { unrealizedPnl: null },
      { unrealizedPnl: CD('-200.00') },
    ];
    expect(computeAggregateUnrealizedPnl(positions)).toBe(CD('800.00'));
  });

  it('returns 0.00 when all null', () => {
    const positions = [
      { unrealizedPnl: null },
      { unrealizedPnl: null },
    ];
    expect(computeAggregateUnrealizedPnl(positions)).toBe(CD('0.00'));
  });

  it('returns 0.00 for empty array', () => {
    expect(computeAggregateUnrealizedPnl([])).toBe(CD('0.00'));
  });
});

// ── computeTotalFees ────────────────────────────────────────────────────

describe('computeTotalFees', () => {
  it('sums position fees without event fees', () => {
    expect(computeTotalFees([CD('25.00'), CD('15.00'), CD('10.00')])).toBe(CD('50.00'));
  });

  it('sums position fees with event fees', () => {
    expect(computeTotalFees([CD('25.00'), CD('15.00')], [CD('5.00')])).toBe(CD('45.00'));
  });

  it('returns 0.00 for empty arrays', () => {
    expect(computeTotalFees([])).toBe(CD('0.00'));
  });

  it('returns position fees when event fees is empty array', () => {
    expect(computeTotalFees([CD('25.00')], [])).toBe(CD('25.00'));
  });
});

// ── computeGrossExposure ────────────────────────────────────────────────

describe('computeGrossExposure', () => {
  it('sums absolute values of non-null marked values', () => {
    const values: (CanonicalDecimal | null)[] = [CD('15000.00'), CD('-8000.00'), CD('2000.00')];
    expect(computeGrossExposure(values)).toBe(CD('25000.00'));
  });

  it('skips null values', () => {
    const values: (CanonicalDecimal | null)[] = [CD('15000.00'), null, CD('5000.00')];
    expect(computeGrossExposure(values)).toBe(CD('20000.00'));
  });

  it('returns 0.00 when all null or empty', () => {
    expect(computeGrossExposure([])).toBe(CD('0.00'));
    expect(computeGrossExposure([null, null])).toBe(CD('0.00'));
  });
});

// ── computeNetExposure ──────────────────────────────────────────────────

describe('computeNetExposure', () => {
  it('sums signed values', () => {
    const values: (CanonicalDecimal | null)[] = [CD('15000.00'), CD('-8000.00'), CD('2000.00')];
    expect(computeNetExposure(values)).toBe(CD('9000.00'));
  });

  it('skips null values', () => {
    const values: (CanonicalDecimal | null)[] = [CD('15000.00'), null];
    expect(computeNetExposure(values)).toBe(CD('15000.00'));
  });

  it('returns 0.00 when all null or empty', () => {
    expect(computeNetExposure([])).toBe(CD('0.00'));
    expect(computeNetExposure([null, null])).toBe(CD('0.00'));
  });
});

// ── deriveValuationWarnings ─────────────────────────────────────────────

describe('deriveValuationWarnings', () => {
  const openLongPos = (overrides: Partial<ValuationPosition> = {}): ValuationPosition => ({
    instrumentId: 'AAPL',
    direction: 'long',
    quantity: CD('100.00'),
    averageCost: CD('150.00'),
    totalCostBasis: CD('15000.00'),
    realizedPnl: CD('0.00'),
    realizedFees: CD('0.00'),
    realizedNetPnl: CD('0.00'),
    markPrice: CD('160.00'),
    markStatus: 'fresh',
    markedValue: CD('16000.00'),
    unrealizedPnl: CD('1000.00'),
    markTimestamp: makeTimestamp('2026-01-15'),
    markSource: 'user',
    markAgeMinutes: 0,
    ...overrides,
  });

  it('returns empty warnings for all-fresh positions', () => {
    const warnings = deriveValuationWarnings([
      openLongPos({ instrumentId: 'AAPL' }),
      openLongPos({ instrumentId: 'MSFT' }),
    ]);
    expect(warnings).toEqual([]);
  });

  it('warns for missing mark on open position', () => {
    const warnings = deriveValuationWarnings([
      openLongPos({ markStatus: 'missing', markPrice: null, markedValue: null, unrealizedPnl: null }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Missing mark for AAPL');
    expect(warnings[0]).toContain('long');
    expect(warnings[0]).toContain('100.00');
  });

  it('warns for stale mark on open position', () => {
    const warnings = deriveValuationWarnings([
      openLongPos({ markStatus: 'stale', markAgeMinutes: 2880 }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Stale mark for AAPL');
    expect(warnings[0]).toContain('2880');
  });

  it('skips flat positions even with missing marks', () => {
    const warnings = deriveValuationWarnings([
      openLongPos({ quantity: CD('0.00'), direction: null, markStatus: 'missing', markPrice: null, markedValue: null, unrealizedPnl: null }),
    ]);
    expect(warnings).toEqual([]);
  });

  it('generates multiple warnings', () => {
    const warnings = deriveValuationWarnings([
      openLongPos({ instrumentId: 'AAPL', markStatus: 'missing', markPrice: null, markedValue: null, unrealizedPnl: null }),
      openLongPos({ instrumentId: 'MSFT', markStatus: 'stale', markAgeMinutes: 1441 }),
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('AAPL');
    expect(warnings[1]).toContain('MSFT');
  });
});

// ── computeAccountValuation ─────────────────────────────────────────────

describe('computeAccountValuation', () => {
  const nowTs = makeTimestamp('2026-01-15');

  const makePos = (overrides: Partial<ValuationPosition>): ValuationPosition => ({
    instrumentId: 'INST',
    direction: 'long',
    quantity: CD('100.00'),
    averageCost: CD('100.00'),
    totalCostBasis: CD('10000.00'),
    realizedPnl: CD('200.00'),
    realizedFees: CD('10.00'),
    realizedNetPnl: CD('190.00'),
    markPrice: CD('110.00'),
    markStatus: 'fresh',
    markedValue: CD('11000.00'),
    unrealizedPnl: CD('1000.00'),
    markTimestamp: nowTs,
    markSource: 'user' as MarkSource,
    markAgeMinutes: 0,
    ...overrides,
  });

  it('computes full AccountValuation from long position', () => {
    const result = computeAccountValuation(
      {
        accountId: 'acc-1',
        netCash: CD('50000.00'),
        positions: [makePos({ instrumentId: 'AAPL' })],
      },
      nowTs,
    );

    expect(result.accountId).toBe('acc-1');
    expect(result.netCash).toBe(CD('50000.00'));
    expect(result.markedPositions).toBe(CD('11000.00'));
    expect(result.nav).toBe(CD('61000.00'));
    expect(result.navDetail.cash).toBe(CD('50000.00'));
    expect(result.navDetail.markedPositions).toBe(CD('11000.00'));
    expect(result.realizedPnl).toBe(CD('190.00'));
    expect(result.unrealizedPnl).toBe(CD('1000.00'));
    expect(result.totalPnl).toBe(CD('1190.00'));
    expect(result.realizedFees).toBe(CD('10.00'));
    expect(result.grossExposure).toBe(CD('11000.00'));
    expect(result.netExposure).toBe(CD('11000.00'));
    expect(result.warnings).toEqual([]);
    expect(result.computedAt).toBe(nowTs);
    expect(result.positions).toHaveLength(1);
  });

  it('handles multiple positions with mixed directions', () => {
    const result = computeAccountValuation(
      {
        accountId: 'acc-1',
        netCash: CD('10000.00'),
        positions: [
          makePos({ instrumentId: 'AAPL', quantity: CD('100.00'), markedValue: CD('11000.00'), unrealizedPnl: CD('1000.00'), realizedPnl: CD('200.00'), realizedFees: CD('10.00'), realizedNetPnl: CD('190.00') }),
          makePos({ instrumentId: 'TSLA', direction: 'short', quantity: CD('-50.00'), averageCost: CD('200.00'), totalCostBasis: CD('-10000.00'), markPrice: CD('190.00'), markedValue: CD('-9500.00'), unrealizedPnl: CD('500.00'), realizedPnl: CD('100.00'), realizedFees: CD('5.00'), realizedNetPnl: CD('95.00') }),
        ],
      },
      nowTs,
    );

    expect(result.markedPositions).toBe(CD('1500.00')); // 11000 + (-9500)
    expect(result.nav).toBe(CD('11500.00')); // 10000 + 1500
    expect(result.realizedPnl).toBe(CD('285.00')); // 190 + 95
    expect(result.unrealizedPnl).toBe(CD('1500.00')); // 1000 + 500
    expect(result.totalPnl).toBe(CD('1785.00'));
    expect(result.realizedFees).toBe(CD('15.00')); // 10 + 5
    expect(result.grossExposure).toBe(CD('20500.00')); // |11000| + |-9500|
    expect(result.netExposure).toBe(CD('1500.00')); // 11000 + (-9500)
  });

  it('generates warnings for missing marks', () => {
    const result = computeAccountValuation(
      {
        accountId: 'acc-1',
        netCash: CD('50000.00'),
        positions: [
          makePos({ instrumentId: 'AAPL', markStatus: 'missing', markPrice: null, markedValue: null, unrealizedPnl: null }),
        ],
      },
      nowTs,
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Missing mark for AAPL');
    expect(result.markedPositions).toBe(CD('0.00'));
    expect(result.nav).toBe(CD('50000.00'));
    expect(result.unrealizedPnl).toBe(CD('0.00'));
    expect(result.netExposure).toBe(CD('0.00'));
  });

  it('handles empty positions', () => {
    const result = computeAccountValuation(
      {
        accountId: 'acc-empty',
        netCash: CD('1000.00'),
        positions: [],
      },
      nowTs,
    );

    expect(result.accountId).toBe('acc-empty');
    expect(result.nav).toBe(CD('1000.00'));
    expect(result.markedPositions).toBe(CD('0.00'));
    expect(result.netExposure).toBe(CD('0.00'));
    expect(result.warnings).toEqual([]);
  });
});
