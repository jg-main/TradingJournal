/**
 * Decimal / micros validation and arithmetic helpers.
 *
 * Pure functions only — no database or Next.js imports.
 *
 * Canonical decimal format: optional minus sign, digits, period, exactly 2 fraction digits.
 *   Examples: "0.00", "1000.00", "-50.00", "123456789.99"
 *
 * Micros: integer representation where 1 unit = 1_000_000 micros.
 *   Examples: 1_000_000 → "1.00", -50_000_000 → "-50.00"
 */

import type { CanonicalDecimal } from './types';

// ── Constants ───────────────────────────────────────────────────────────

export const MICROS_PER_UNIT = 1_000_000;
export const DECIMAL_PLACES = 2;

// ── Validation ──────────────────────────────────────────────────────────

/**
 * Validate that a string is a well-formed canonical decimal.
 */
export function validateDecimal(value: string): {
  valid: boolean;
  error?: string;
} {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Value must be a string' };
  }
  if (value.length === 0) {
    return { valid: false, error: 'Value must not be empty' };
  }
  // Pattern: optional minus, digits, period, exactly 2 fraction digits
  const CANONICAL_DECIMAL_RE = /^-?\d+\.\d{2}$/;
  if (!CANONICAL_DECIMAL_RE.test(value)) {
    return {
      valid: false,
      error: `Value "${value}" is not a canonical decimal (expected format: "1234.56")`,
    };
  }
  // Guard against overflow (safe micros range fits in signed 64-bit integer)
  const absParts = value.startsWith('-') ? value.slice(1).split('.') : value.split('.');
  const intPart = absParts[0];
  // Max safe integer in JS is 2^53 - 1 ≈ 9e15
  // With micros, max canonical units ≈ 9e9
  if (intPart.length > 15) {
    return { valid: false, error: `Value "${value}" exceeds maximum representable range` };
  }
  return { valid: true };
}

// ── Conversion ──────────────────────────────────────────────────────────

/**
 * Convert a canonical decimal string to integer micros.
 * Throws on invalid input.
 */
export function toMicros(amount: string): number {
  const validation = validateDecimal(amount);
  if (!validation.valid) {
    throw new Error(`toMicros: ${validation.error}`);
  }
  const negative = amount.startsWith('-');
  const abs = negative ? amount.slice(1) : amount;
  const [intPart, fracPart] = abs.split('.');
  const micros = Number(intPart) * MICROS_PER_UNIT + Number(fracPart) * (MICROS_PER_UNIT / 100);
  return negative ? -micros : micros;
}

/**
 * Convert integer micros to canonical decimal string.
 */
export function fromMicros(micros: number): CanonicalDecimal {
  if (!Number.isInteger(micros)) {
    throw new Error('fromMicros: value must be an integer');
  }
  if (micros > Number.MAX_SAFE_INTEGER || micros < Number.MIN_SAFE_INTEGER) {
    throw new Error('fromMicros: value exceeds safe integer range');
  }
  // Convert micros to canonical 2-decimal-place form by rounding to cents
  // 1 micro = 1/1,000,000 unit; rounding to cents gives exactly 2 fraction digits
  const cents = Math.round(micros / (MICROS_PER_UNIT / 100));
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const intPart = Math.floor(abs / 100);
  const fracPart = abs % 100;
  const fracStr = String(fracPart).padStart(DECIMAL_PLACES, '0');
  return `${negative ? '-' : ''}${intPart}.${fracStr}` as CanonicalDecimal;
}

/**
 * Normalize a numeric value to canonical decimal format.
 * Accepts strings (already formatted or raw) and numbers.
 */
export function normalizeDecimal(value: string | number): CanonicalDecimal {
  if (typeof value === 'number') {
    return fromMicros(Math.round(value * MICROS_PER_UNIT));
  }
  if (typeof value === 'string') {
    // If it's already canonical, validate and return
    const existing = validateDecimal(value);
    if (existing.valid) {
      return value as CanonicalDecimal;
    }
    // Try parsing as a number
    const parsed = Number(value);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      throw new Error(`normalizeDecimal: "${value}" is not a valid numeric value`);
    }
    return fromMicros(Math.round(parsed * MICROS_PER_UNIT));
  }
  throw new Error(`normalizeDecimal: unsupported type ${typeof value}`);
}

// ── Arithmetic ──────────────────────────────────────────────────────────

/**
 * Add two canonical decimal strings, returning a normalized result.
 */
export function addDecimal(a: string, b: string): CanonicalDecimal {
  const microsA = toMicros(a);
  const microsB = toMicros(b);
  return fromMicros(microsA + microsB);
}

/**
 * Subtract b from a (a - b), returning a normalized result.
 */
export function subtractDecimal(a: string, b: string): CanonicalDecimal {
  const microsA = toMicros(a);
  const microsB = toMicros(b);
  return fromMicros(microsA - microsB);
}

/**
 * Negate a canonical decimal.
 */
export function negateDecimal(a: string): CanonicalDecimal {
  const micros = toMicros(a);
  return fromMicros(-micros);
}

/**
 * Compare two canonical decimals.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const microsA = toMicros(a);
  const microsB = toMicros(b);
  if (microsA < microsB) return -1;
  if (microsA > microsB) return 1;
  return 0;
}

/**
 * Check if two canonical decimals are equal.
 */
export function equalsDecimal(a: string, b: string): boolean {
  return compareDecimal(a, b) === 0;
}

/**
 * Sum an array of canonical decimal strings.
 */
export function sumDecimals(values: string[]): CanonicalDecimal {
  if (values.length === 0) {
    return '0.00' as CanonicalDecimal;
  }
  const total = values.reduce((acc, v) => acc + toMicros(v), 0);
  return fromMicros(total);
}
