/**
 * decimal.test.ts
 *
 * Tests for the decimal/micros validation and arithmetic helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  validateDecimal,
  toMicros,
  fromMicros,
  normalizeDecimal,
  addDecimal,
  subtractDecimal,
  negateDecimal,
  compareDecimal,
  equalsDecimal,
  sumDecimals,
  MICROS_PER_UNIT,
} from './decimal';

describe('validateDecimal', () => {
  it('accepts well-formed canonical decimals', () => {
    expect(validateDecimal('0.00').valid).toBe(true);
    expect(validateDecimal('1000.00').valid).toBe(true);
    expect(validateDecimal('-50.00').valid).toBe(true);
    expect(validateDecimal('123456789.99').valid).toBe(true);
    expect(validateDecimal('1.00').valid).toBe(true);
    expect(validateDecimal('999999999999999.99').valid).toBe(true);
  });

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(validateDecimal(123).valid).toBe(false);
  });

  it('rejects empty strings', () => {
    const result = validateDecimal('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects missing decimal places', () => {
    expect(validateDecimal('1000').valid).toBe(false);
    expect(validateDecimal('1000.0').valid).toBe(false);
    expect(validateDecimal('1000.1').valid).toBe(false);
  });

  it('rejects non-numeric text', () => {
    expect(validateDecimal('abc').valid).toBe(false);
    expect(validateDecimal('1.00abc').valid).toBe(false);
  });

  it('rejects values exceeding range', () => {
    const result = validateDecimal('9999999999999999.99');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds');
  });
});

describe('toMicros', () => {
  it('converts canonical decimals to micros', () => {
    expect(toMicros('1.00')).toBe(MICROS_PER_UNIT);
    expect(toMicros('1000.00')).toBe(1000 * MICROS_PER_UNIT);
    expect(toMicros('-50.00')).toBe(-50 * MICROS_PER_UNIT);
    expect(toMicros('0.01')).toBe(MICROS_PER_UNIT / 100);
    expect(toMicros('0.00')).toBe(0);
  });

  it('throws on invalid input', () => {
    expect(() => toMicros('abc')).toThrow();
    expect(() => toMicros('1.0')).toThrow();
  });
});

describe('fromMicros', () => {
  it('converts micros to canonical decimals', () => {
    expect(fromMicros(MICROS_PER_UNIT)).toBe('1.00');
    expect(fromMicros(1000 * MICROS_PER_UNIT)).toBe('1000.00');
    expect(fromMicros(-50 * MICROS_PER_UNIT)).toBe('-50.00');
    expect(fromMicros(0)).toBe('0.00');
    expect(fromMicros(1)).toBe('0.00');
    expect(fromMicros(MICROS_PER_UNIT / 100)).toBe('0.01');
  });

  it('throws on non-integer input', () => {
    expect(() => fromMicros(1.5)).toThrow();
  });
});

describe('normalizeDecimal', () => {
  it('normalizes numbers to canonical decimals', () => {
    expect(normalizeDecimal(1)).toBe('1.00');
    expect(normalizeDecimal(1000.5)).toBe('1000.50');
    expect(normalizeDecimal(-50.99)).toBe('-50.99');
    expect(normalizeDecimal(0.001)).toBe('0.00');
  });

  it('passes through valid canonical strings', () => {
    expect(normalizeDecimal('1000.00')).toBe('1000.00');
    expect(normalizeDecimal('-50.00')).toBe('-50.00');
  });

  it('converts raw numeric strings', () => {
    expect(normalizeDecimal('1')).toBe('1.00');
    expect(normalizeDecimal('1000.5')).toBe('1000.50');
  });

  it('throws on invalid strings', () => {
    expect(() => normalizeDecimal('abc')).toThrow();
  });
});

describe('arithmetic', () => {
  it('adds two decimals', () => {
    expect(addDecimal('100.00', '200.00')).toBe('300.00');
    expect(addDecimal('100.50', '200.50')).toBe('301.00');
    expect(addDecimal('-50.00', '25.00')).toBe('-25.00');
    expect(addDecimal('0.01', '0.02')).toBe('0.03');
  });

  it('subtracts two decimals', () => {
    expect(subtractDecimal('200.00', '100.00')).toBe('100.00');
    expect(subtractDecimal('100.00', '200.00')).toBe('-100.00');
    expect(subtractDecimal('0.05', '0.03')).toBe('0.02');
  });

  it('negates a decimal', () => {
    expect(negateDecimal('100.00')).toBe('-100.00');
    expect(negateDecimal('-50.00')).toBe('50.00');
    expect(negateDecimal('0.00')).toBe('0.00');
  });
});

describe('comparison', () => {
  it('compares decimals correctly', () => {
    expect(compareDecimal('100.00', '200.00')).toBe(-1);
    expect(compareDecimal('200.00', '100.00')).toBe(1);
    expect(compareDecimal('100.00', '100.00')).toBe(0);
    expect(compareDecimal('-100.00', '100.00')).toBe(-1);
  });

  it('checks equality', () => {
    expect(equalsDecimal('100.00', '100.00')).toBe(true);
    expect(equalsDecimal('100.00', '100.01')).toBe(false);
  });
});

describe('sumDecimals', () => {
  it('sums an array of decimals', () => {
    expect(sumDecimals(['100.00', '200.00', '300.00'])).toBe('600.00');
    expect(sumDecimals(['-50.00', '25.00', '25.00'])).toBe('0.00');
    expect(sumDecimals(['0.01', '0.02', '0.03'])).toBe('0.06');
  });

  it('returns 0.00 for empty array', () => {
    expect(sumDecimals([])).toBe('0.00');
  });
});
