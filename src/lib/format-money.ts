/**
 * Pure money formatting functions with negative-zero safety.
 *
 * All functions are pure — they take a value and return a formatted string
 * or a CSS class.  Null/undefined values render as "—" rather than "$0.00"
 * to prevent fabricated zero values from missing marks or unset data.
 *
 * Negative-zero normalization ensures that "-0.00" is always displayed
 * as "0.00" to avoid confusing visual artifacts.
 *
 * @module format-money
 */

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a canonical decimal string to a number, returning null for
 * null, undefined, NaN, or non-numeric strings.
 */
function parseValue(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return null;
  return n;
}

/**
 * Normalize a number so that negative zero is treated as zero.
 *
 * In JavaScript, `-0 === 0` is true, but `String(-0)` is `"-0"` and
 * `Object.is(-0, 0)` is `false`.  This function coerces -0 to 0 for
 * display purposes.
 */
function normalizeNegativeZero(n: number): number {
  if (n === 0) return 0; // Coerces -0 to 0
  return n;
}

// ── Exported Formatting Functions ──────────────────────────────────────

/**
 * Format a money value with a leading dollar sign and 2 decimal places.
 *
 * - null / undefined → "—"
 * - NaN → "—"
 * - 0 / -0 → "$0.00"  (negative zero is normalised to zero)
 * - 1234.5 → "$1,234.50"
 *
 * @param v - Numeric value, decimal string, or null/undefined.
 * @returns Formatted string with $ prefix or "—".
 */
export function formatMoney(v: string | number | null | undefined): string {
  const n = parseValue(v);
  if (n === null) return '—';
  const normalized = normalizeNegativeZero(n);
  return `$${normalized.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a money value without a dollar sign, in locale-aware format.
 *
 * - null / undefined → "—"
 * - NaN → "—"
 * - 0 / -0 → "0.00"
 *
 * Useful for table cells where a sign indicator or column header
 * already supplies the currency context.
 *
 * @param v - Numeric value, decimal string, or null/undefined.
 * @returns Formatted number string or "—".
 */
export function formatMoneyPlain(v: string | number | null | undefined): string {
  const n = parseValue(v);
  if (n === null) return '—';
  const normalized = normalizeNegativeZero(n);
  return normalized.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a signed money value with $, +/- prefix, and 2 decimal places.
 *
 * - null / undefined → "—"
 * - NaN → "—"
 * - 0 / -0 → "$0.00"      (no positive sign for zero)
 * - positive → "+$1,234.50"
 * - negative → "-$1,234.50"
 *
 * @param v - Numeric value, decimal string, or null/undefined.
 * @returns Formatted string or "—".
 */
export function formatSignedMoney(v: string | number | null | undefined): string {
  const n = parseValue(v);
  if (n === null) return '—';
  const normalized = normalizeNegativeZero(n);
  const abs = Math.abs(normalized);
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (normalized === 0) return `$${formatted}`;
  return normalized > 0 ? `+$${formatted}` : `-$${formatted}`;
}

/**
 * Format a signed raw number string (without $) for columns where
 * the column header already provides the currency context.
 *
 * - null / undefined → "—"
 * - NaN → "—"
 * - 0 / -0 → "0.00"
 * - positive → "+1,234.50"
 * - negative → "-1,234.50"
 *
 * @param v - Numeric value, decimal string, or null/undefined.
 * @returns Formatted string or "—".
 */
export function formatSignedPlain(v: string | number | null | undefined): string {
  const n = parseValue(v);
  if (n === null) return '—';
  const normalized = normalizeNegativeZero(n);
  const abs = Math.abs(normalized);
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (normalized === 0) return formatted;
  return normalized > 0 ? `+${formatted}` : `-${formatted}`;
}
