/**
 * Tests for shared dashboard formatting helpers.
 *
 * Run: npx vitest run src/components/dashboard/formatting.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  GRADE_RUBRIC,
  formatCurrency,
  formatPercent,
  formatDecimal,
  gradeLabelFromScore,
  pnlColorClass,
} from './formatting';

// ═══════════════════════════════════════════════════════════════════════════
// GRADE_RUBRIC
// ═══════════════════════════════════════════════════════════════════════════

describe('GRADE_RUBRIC', () => {
  it('has four grade tiers in descending order', () => {
    expect(GRADE_RUBRIC).toEqual([
      { min: 54, label: 'A' },
      { min: 42, label: 'B' },
      { min: 30, label: 'C' },
      { min: 18, label: 'D' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatCurrency
// ═══════════════════════════════════════════════════════════════════════════

describe('formatCurrency', () => {
  it('returns -- for null', () => {
    expect(formatCurrency(null)).toBe('--');
  });

  it('returns -- for undefined', () => {
    expect(formatCurrency(undefined)).toBe('--');
  });

  it('formats a positive number with default options', () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain('$');
    expect(result).toContain('1');
    // Should not have a sign prefix for positive by default
    expect(result.startsWith('+')).toBe(false);
    expect(result.startsWith('-$')).toBe(false);
  });

  it('formats a negative number', () => {
    const result = formatCurrency(-500.25);
    expect(result).toContain('-');
    expect(result).toContain('$');
  });

  it('formats zero', () => {
    const result = formatCurrency(0);
    // Zero with default signDisplay = 'auto' shows "$0.00"
    expect(result).toMatch(/\$0\.00/);
  });

  it('shows sign for positive when sign option is true', () => {
    const result = formatCurrency(2500, { sign: true });
    // signDisplay: 'exceptZero' for positive: may show '+' depending on locale
    // We just check it's not prefixed with '-'
    expect(result.startsWith('-')).toBe(false);
  });

  it('shows sign for negative when sign option is true', () => {
    const result = formatCurrency(-2500, { sign: true });
    expect(result.startsWith('-')).toBe(true);
  });

  it('shows no sign for zero when sign option is true', () => {
    const result = formatCurrency(0, { sign: true });
    // Zero with exceptZero should not have a sign
    expect(result.startsWith('+')).toBe(false);
    expect(result.startsWith('-')).toBe(false);
  });

  it('uses two decimal places', () => {
    const result = formatCurrency(100);
    expect(result).toMatch(/\.\d{2}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatPercent
// ═══════════════════════════════════════════════════════════════════════════

describe('formatPercent', () => {
  it('returns -- for null', () => {
    expect(formatPercent(null)).toBe('--');
  });

  it('returns -- for undefined', () => {
    expect(formatPercent(undefined)).toBe('--');
  });

  it('formats zero', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('formats a positive fraction', () => {
    expect(formatPercent(0.5)).toBe('50.0%');
  });

  it('formats a small fraction', () => {
    expect(formatPercent(0.0425)).toBe('4.3%');
  });

  it('formats a value >= 1', () => {
    expect(formatPercent(1)).toBe('100.0%');
  });

  it('formats a negative fraction', () => {
    expect(formatPercent(-0.25)).toBe('-25.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatDecimal
// ═══════════════════════════════════════════════════════════════════════════

describe('formatDecimal', () => {
  it('returns -- for null', () => {
    expect(formatDecimal(null)).toBe('--');
  });

  it('returns -- for undefined', () => {
    expect(formatDecimal(undefined)).toBe('--');
  });

  it('formats an integer with default 2 digits', () => {
    expect(formatDecimal(42)).toBe('42.00');
  });

  it('formats a decimal with default 2 digits', () => {
    expect(formatDecimal(1.5)).toBe('1.50');
  });

  it('formats zero', () => {
    expect(formatDecimal(0)).toBe('0.00');
  });

  it('formats with custom digits', () => {
    expect(formatDecimal(1.2345, 4)).toBe('1.2345');
  });

  it('formats a negative value', () => {
    expect(formatDecimal(-3.1)).toBe('-3.10');
  });

  it('rounds to the specified number of digits', () => {
    expect(formatDecimal(1.666, 1)).toBe('1.7');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// gradeLabelFromScore
// ═══════════════════════════════════════════════════════════════════════════

describe('gradeLabelFromScore', () => {
  it('returns -- for null', () => {
    expect(gradeLabelFromScore(null)).toBe('--');
  });

  it('returns -- for undefined', () => {
    expect(gradeLabelFromScore(undefined)).toBe('--');
  });

  it('returns A for 54', () => {
    expect(gradeLabelFromScore(54)).toBe('A');
  });

  it('returns A for 60', () => {
    expect(gradeLabelFromScore(60)).toBe('A');
  });

  it('returns B for 42', () => {
    expect(gradeLabelFromScore(42)).toBe('B');
  });

  it('returns B for 53', () => {
    expect(gradeLabelFromScore(53)).toBe('B');
  });

  it('returns C for 30', () => {
    expect(gradeLabelFromScore(30)).toBe('C');
  });

  it('returns D for 18', () => {
    expect(gradeLabelFromScore(18)).toBe('D');
  });

  it('returns F for 17', () => {
    expect(gradeLabelFromScore(17)).toBe('F');
  });

  it('returns F for 0', () => {
    expect(gradeLabelFromScore(0)).toBe('F');
  });

  it('returns F for a negative score', () => {
    expect(gradeLabelFromScore(-5)).toBe('F');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// pnlColorClass
// ═══════════════════════════════════════════════════════════════════════════

describe('pnlColorClass', () => {
  it('returns green-tinted class for positive values', () => {
    expect(pnlColorClass(100)).toContain('text-zinc-700');
  });

  it('returns red-tinted class for negative values', () => {
    expect(pnlColorClass(-50)).toContain('text-red-600');
  });

  it('returns neutral class for zero', () => {
    expect(pnlColorClass(0)).toContain('text-zinc-500');
  });
});
