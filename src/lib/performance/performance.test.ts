/**
 * performance.test.ts
 *
 * Table-driven tests for the performance pure functions.
 *
 * Coverage areas:
 * 1. Modified Dietz return (no cash flows, with deposits, with withdrawals)
 * 2. TWR (no cash flows, with cash flows, zero starting NAV)
 * 3. High-water mark (current > historical, historical > current, empty)
 * 4. Drawdown (above HWM, below HWM, at HWM)
 * 5. Full computePerformance integration
 * 6. Zero/negative denominators
 * 7. Deposits/withdrawals excluded from profit
 * 8. Deterministic rebuild ordering (sort stability)
 */

import { describe, it, expect } from 'vitest';
import type { CanonicalDecimal } from '../accounting/types';
import type { CashFlow, HistoricalNavValue, HighWaterMarkInput } from './types';
import {
  computeModifiedDietzReturn,
  computeTwr,
  computeHighWaterMark,
  computeDrawdown,
  computeHighWaterMarkAndDrawdown,
  computePerformance,
} from './performance';

// ── Helpers ──────────────────────────────────────────────────────────────

const CD = (v: string) => v as CanonicalDecimal;

function cf(date: string, amount: string, type: 'deposit' | 'withdrawal'): CashFlow {
  return { date, amount: CD(amount), type };
}

// ── computeModifiedDietzReturn ──────────────────────────────────────────

describe('computeModifiedDietzReturn', () => {
  it('returns zero return when start and end NAV are equal with no flows', () => {
    const result = computeModifiedDietzReturn(CD('100000.00'), CD('100000.00'), [], '2026-01-01', '2026-01-31');
    expect(result.return).toBe(CD('0.00'));
    expect(result.warnings).toEqual([]);
  });

  it('computes positive return with no cash flows', () => {
    // Start: 100k, End: 110k, no flows → R = (110000 - 100000 - 0) / (100000 + 0) = 10000/100000 = 0.10
    const result = computeModifiedDietzReturn(CD('100000.00'), CD('110000.00'), [], '2026-01-01', '2026-01-31');
    expect(result.return).toBe(CD('0.10'));
    expect(result.warnings).toEqual([]);
  });

  it('computes negative return with no cash flows', () => {
    // Start: 100k, End: 90k, no flows → R = (90000 - 100000) / 100000 = -10000/100000 = -0.10
    const result = computeModifiedDietzReturn(CD('100000.00'), CD('90000.00'), [], '2026-01-01', '2026-01-31');
    expect(result.return).toBe(CD('-0.10'));
    expect(result.warnings).toEqual([]);
  });

  it('excludes deposits from profit in return calculation', () => {
    // Start: 100k, End: 120k, Deposit: 10k mid-month
    // Net cash flow = +10k
    // Weighted flow: deposit on Jan 15 of 30-day month (Jan 1→Jan 15 = 14 days)
    // weight = (30-14)/30 = 0.533333
    // denominator = 100k + 10k*0.5333 = 105333.33
    // R = (120000 - 100000 - 10000) / 105333.33 = 10000 / 105333.33 ≈ 0.0949 → 0.09
    const result = computeModifiedDietzReturn(
      CD('100000.00'), CD('120000.00'),
      [cf('2026-01-15', '10000.00', 'deposit')],
      '2026-01-01', '2026-01-31',
    );
    expect(result.return).toBe(CD('0.09'));
    expect(result.warnings).toEqual([]);
  });

  it('excludes withdrawals from profit in return calculation', () => {
    // Start: 100k, End: 90k, Withdrawal: 5k mid-month
    // Net cash flow = -5k
    // Weighted: withdrawal on day 15 → weight = 0.5 → -5k * 0.5 = -2500
    // R = (90000 - 100000 - (-5000)) / (100000 + (-2500)) = -5000 / 97500 ≈ -0.0513
    const result = computeModifiedDietzReturn(
      CD('100000.00'), CD('90000.00'),
      [cf('2026-01-15', '5000.00', 'withdrawal')],
      '2026-01-01', '2026-01-31',
    );
    expect(result.return).toBe(CD('-0.05')); // -5000/97500 = -0.05128... → -0.05
    expect(result.warnings).toEqual([]);
  });

  it('handles multiple cash flows', () => {
    // Start: 100k, End: 130k
    // Deposit 5k on day 5, Withdrawal 3k on day 20
    // 30-day month
    // Net cash flow = 5000 - 3000 = 2000
    // Weight: 5k * (30-5)/30 + (-3k) * (30-20)/30
    //       = 5k * 0.833 + (-3k) * 0.333
    //       = 4166.67 - 1000 = 3166.67
    // R = (130000 - 100000 - 2000) / (100000 + 3166.67)
    //   = 28000 / 103166.67 ≈ 0.2713
    const result = computeModifiedDietzReturn(
      CD('100000.00'), CD('130000.00'),
      [cf('2026-01-05', '5000.00', 'deposit'), cf('2026-01-20', '3000.00', 'withdrawal')],
      '2026-01-01', '2026-01-31',
    );
    expect(result.return).toBe(CD('0.27')); // 28000/103167 ≈ 0.2714 → 0.27
    expect(result.warnings).toEqual([]);
  });

  it('returns warning for zero starting NAV with deposits', () => {
    // With BMV=0 and a deposit, denominator = 0 + weightedFlow > 0, so
    // the 'Starting NAV is zero' warning fires, not the 'Zero denominator' one
    const result = computeModifiedDietzReturn(
      CD('0.00'), CD('1000.00'),
      [cf('2026-01-15', '10000.00', 'deposit')],
      '2026-01-01', '2026-01-31',
    );
    expect(result.warnings).toContain('Starting NAV is zero; Modified Dietz return may be unreliable');
  });

  it('returns warning and zero for zero denominator', () => {
    const result = computeModifiedDietzReturn(CD('0.00'), CD('0.00'), [cf('2026-01-01', '0.00', 'deposit')], '2026-01-01', '2026-01-31');
    expect(result.warnings).toContain('Zero denominator in Modified Dietz (no starting capital)');
    expect(result.return).toBe(CD('0.00'));
  });

  it('returns warning for invalid date range', () => {
    const result = computeModifiedDietzReturn(CD('100.00'), CD('110.00'), [], 'bad-date', '2026-01-31');
    expect(result.warnings).toContain('Invalid date range');
    expect(result.return).toBe(CD('0.00'));
  });

  describe('table-driven', () => {
    const cases: Array<{
      label: string;
      startNav: CanonicalDecimal;
      endNav: CanonicalDecimal;
      cashFlows: CashFlow[];
      startDate: string;
      endDate: string;
      expectedReturn: CanonicalDecimal;
      expectWarnings: boolean;
    }> = [
      { label: 'no change, no flows', startNav: CD('1000.00'), endNav: CD('1000.00'), cashFlows: [], startDate: '2026-01-01', endDate: '2026-01-31', expectedReturn: CD('0.00'), expectWarnings: false },
      { label: '10% gain, no flows', startNav: CD('1000.00'), endNav: CD('1100.00'), cashFlows: [], startDate: '2026-01-01', endDate: '2026-01-31', expectedReturn: CD('0.10'), expectWarnings: false },
      { label: '50% gain, no flows', startNav: CD('1000.00'), endNav: CD('1500.00'), cashFlows: [], startDate: '2026-01-01', endDate: '2026-01-31', expectedReturn: CD('0.50'), expectWarnings: false },
      { label: '100% gain, no flows', startNav: CD('1000.00'), endNav: CD('2000.00'), cashFlows: [], startDate: '2026-01-01', endDate: '2026-01-31', expectedReturn: CD('1.00'), expectWarnings: false },
      { label: '10% loss, no flows', startNav: CD('1000.00'), endNav: CD('900.00'), cashFlows: [], startDate: '2026-01-01', endDate: '2026-01-31', expectedReturn: CD('-0.10'), expectWarnings: false },
      { label: 'small return with mid-month deposit', startNav: CD('50000.00'), endNav: CD('52000.00'), cashFlows: [cf('2026-06-15', '1000.00', 'deposit')], startDate: '2026-06-01', endDate: '2026-06-30', expectedReturn: CD('0.02'), expectWarnings: false },
      { label: 'deposit at period end with zero numerator', startNav: CD('100000.00'), endNav: CD('110000.00'), cashFlows: [cf('2026-01-30', '10000.00', 'deposit')], startDate: '2026-01-01', endDate: '2026-01-31', expectedReturn: CD('0.00'), expectWarnings: false },
    ];

    for (const c of cases) {
      it(`${c.label}`, () => {
        const result = computeModifiedDietzReturn(c.startNav, c.endNav, c.cashFlows, c.startDate, c.endDate);
        expect(result.return).toBe(c.expectedReturn);
        if (c.expectWarnings) {
          expect(result.warnings.length).toBeGreaterThan(0);
        }
      });
    }
  });
});

// ── computeTwr ─────────────────────────────────────────────────────────

describe('computeTwr', () => {
  it('returns simple return when no cash flows', () => {
    // (1100 - 1000) / 1000 = 0.10
    const result = computeTwr(CD('1000.00'), CD('1100.00'), [], '2026-01-01', '2026-01-31');
    expect(result.twr).toBe(CD('0.10'));
    expect(result.subPeriodReturns).toHaveLength(1);
    expect(result.subPeriodReturns[0].days).toBeGreaterThan(0);
  });

  it('returns warning for zero starting NAV with no flows', () => {
    const result = computeTwr(CD('0.00'), CD('1000.00'), [], '2026-01-01', '2026-01-31');
    expect(result.warnings).toContain('Starting NAV is zero; TWR is undefined');
    expect(result.twr).toBe(CD('0.00'));
    expect(result.subPeriodReturns).toEqual([]);
  });

  it('falls back to Modified Dietz with cash flows', () => {
    // With cash flows, TWR uses Modified Dietz approximation
    const result = computeTwr(
      CD('100000.00'), CD('110000.00'),
      [cf('2026-01-15', '10000.00', 'deposit')],
      '2026-01-01', '2026-01-31',
    );
    expect(result.subPeriodReturns).toHaveLength(1);
    // TWR uses Modified Dietz → should match the dietz result
    expect(result.twr).toBe(CD('0.00')); // (110000 - 100000 - 10000) / (100000 + 5000) = 0 / 105000 = 0.00
  });

  it('includes approximation warning with cash flows', () => {
    const result = computeTwr(
      CD('100000.00'), CD('105000.00'),
      [cf('2026-01-15', '5000.00', 'deposit')],
      '2026-01-01', '2026-01-31',
    );
    expect(result.warnings.some(w => w.includes('approximation'))).toBe(true);
  });

  it('sorts cash flows by date', () => {
    // Unsorted input — should sort internally
    const result = computeTwr(
      CD('100000.00'), CD('105000.00'),
      [
        cf('2026-01-20', '3000.00', 'withdrawal'),
        cf('2026-01-05', '5000.00', 'deposit'),
      ],
      '2026-01-01', '2026-01-31',
    );
    // Should not crash and produce a result
    expect(typeof result.twr).toBe('string');
    expect(result.subPeriodReturns).toHaveLength(1);
  });
});

// ── computeHighWaterMark ────────────────────────────────────────────────

describe('computeHighWaterMark', () => {
  it('returns current NAV when no historical values provided', () => {
    expect(computeHighWaterMark(CD('100000.00'), [])).toBe(CD('100000.00'));
  });

  it('returns current NAV when it is the highest', () => {
    const historical: HistoricalNavValue[] = [
      { nav: CD('80000.00'), date: '2026-01-01' },
      { nav: CD('90000.00'), date: '2026-01-15' },
    ];
    expect(computeHighWaterMark(CD('100000.00'), historical)).toBe(CD('100000.00'));
  });

  it('returns historical max when higher than current', () => {
    const historical: HistoricalNavValue[] = [
      { nav: CD('120000.00'), date: '2026-01-10' },
      { nav: CD('110000.00'), date: '2026-01-20' },
    ];
    expect(computeHighWaterMark(CD('100000.00'), historical)).toBe(CD('120000.00'));
  });

  it('handles negative NAV values', () => {
    const historical: HistoricalNavValue[] = [
      { nav: CD('-10000.00'), date: '2026-01-01' },
    ];
    expect(computeHighWaterMark(CD('-5000.00'), historical)).toBe(CD('-5000.00'));
  });
});

// ── computeDrawdown ─────────────────────────────────────────────────────

describe('computeDrawdown', () => {
  it('returns zero when current NAV equals HWM', () => {
    const result = computeDrawdown(CD('100000.00'), CD('100000.00'));
    expect(result.drawdown).toBe(CD('0.00'));
    expect(result.drawdownPct).toBe(CD('0.00'));
  });

  it('returns zero when current NAV exceeds HWM', () => {
    const result = computeDrawdown(CD('110000.00'), CD('100000.00'));
    expect(result.drawdown).toBe(CD('0.00'));
    expect(result.drawdownPct).toBe(CD('0.00'));
  });

  it('computes drawdown when current NAV is below HWM', () => {
    // Drawdown = 120000 - 100000 = 20000
    // Drawdown% = 20000 / 120000 = 0.1666... → 0.17 (rounded)
    const result = computeDrawdown(CD('100000.00'), CD('120000.00'));
    expect(result.drawdown).toBe(CD('20000.00'));
    expect(result.drawdownPct).toBe(CD('0.17'));
  });

  it('handles 50% drawdown', () => {
    const result = computeDrawdown(CD('50000.00'), CD('100000.00'));
    expect(result.drawdown).toBe(CD('50000.00'));
    expect(result.drawdownPct).toBe(CD('0.50'));
  });

  it('handles 100% drawdown (NAV = 0)', () => {
    const result = computeDrawdown(CD('0.00'), CD('100000.00'));
    expect(result.drawdown).toBe(CD('100000.00'));
    expect(result.drawdownPct).toBe(CD('1.00'));
  });
});

// ── computeHighWaterMarkAndDrawdown ─────────────────────────────────────

describe('computeHighWaterMarkAndDrawdown', () => {
  it('computes both HWM and drawdown from input', () => {
    const input: HighWaterMarkInput = {
      currentNav: CD('95000.00'),
      historicalNavValues: [
        { nav: CD('100000.00'), date: '2026-01-01' },
        { nav: CD('110000.00'), date: '2026-01-15' },
        { nav: CD('105000.00'), date: '2026-01-20' },
      ],
    };
    const result = computeHighWaterMarkAndDrawdown(input);
    expect(result.highWaterMark).toBe(CD('110000.00'));
    expect(result.drawdown).toBe(CD('15000.00'));
    expect(result.drawdownPct).toBe(CD('0.14')); // 15000/110000 = 0.1363... → 0.14
  });
});

// ── computePerformance (integration) ────────────────────────────────────

describe('computePerformance', () => {
  it('computes full performance for a simple gain with no flows', () => {
    const result = computePerformance({
      startNav: CD('100000.00'),
      endNav: CD('110000.00'),
      cashFlows: [],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(result.modifiedDietzReturn).toBe(CD('0.10'));
    expect(result.twr).toBe(CD('0.10'));
    expect(result.subPeriodReturns).toHaveLength(1);
    expect(result.highWaterMark).toBe(CD('110000.00')); // max of start(100k) and end(110k)
    expect(result.drawdown).toBe(CD('0.00')); // at HWM
    expect(result.drawdownPct).toBe(CD('0.00'));
    expect(result.warnings).toEqual([]);
  });

  it('computes full performance with a deposit excluded from profit', () => {
    // 100k start, 115k end, 10k deposit mid-month
    // Modified Dietz: (115000 - 100000 - 10000) / (100000 + 5000) = 5000/105000 = 0.0476... → 0.05
    const result = computePerformance({
      startNav: CD('100000.00'),
      endNav: CD('115000.00'),
      cashFlows: [cf('2026-01-15', '10000.00', 'deposit')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(result.modifiedDietzReturn).toBe(CD('0.05'));
    expect(result.highWaterMark).toBe(CD('115000.00'));
    // Warnings should include TWR approximation notice
    expect(result.warnings.some(w => w.includes('approximation'))).toBe(true);
  });

  it('computes drawdown for a losing period', () => {
    const result = computePerformance({
      startNav: CD('100000.00'),
      endNav: CD('80000.00'),
      cashFlows: [],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(result.modifiedDietzReturn).toBe(CD('-0.20'));
    expect(result.twr).toBe(CD('-0.20'));
    // HWM = max(100k start, 80k end) = 100k
    expect(result.highWaterMark).toBe(CD('100000.00'));
    // Drawdown = 100000 - 80000 = 20000
    expect(result.drawdown).toBe(CD('20000.00'));
    // Drawdown% = 20000/100000 = 0.20
    expect(result.drawdownPct).toBe(CD('0.20'));
  });

  it('passes through warnings from sub-computations', () => {
    // Zero starting NAV should generate warnings
    const result = computePerformance({
      startNav: CD('0.00'),
      endNav: CD('1000.00'),
      cashFlows: [],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
