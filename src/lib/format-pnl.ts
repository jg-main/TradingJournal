/**
 * Pure P&L formatting functions with negative-zero safety.
 *
 * All functions are pure — they take a value and return a formatted string
 * or a CSS class.  Null/undefined values render as "—" rather than "$0.00"
 * to prevent fabricated zero values from missing marks or unset data.
 *
 * Negative-zero normalization ensures that "-0.00" is always displayed
 * as "0.00" to avoid confusing visual artifacts.
 *
 * @module format-pnl
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

/**
 * Format a raw number with locale-aware formatting and 2 decimal places.
 */
function formatPlainNumber(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Exported Formatting Functions ──────────────────────────────────────

/**
 * Format a P&L value with $ and +/- prefix.
 *
 * - null / undefined → "—"
 * - NaN → "—"
 * - 0 / -0 → "$0.00"
 * - positive → "+$1,234.50"
 * - negative → "-$1,234.50"
 *
 * @param v - Numeric value, decimal string, or null/undefined.
 * @returns Formatted string or "—".
 */
export function formatPnl(v: string | number | null | undefined): string {
  const n = parseValue(v);
  if (n === null) return '—';
  const normalized = normalizeNegativeZero(n);
  const formatted = formatPlainNumber(Math.abs(normalized));
  if (normalized === 0) return `$${formatted}`;
  return normalized > 0 ? `+$${formatted}` : `-$${formatted}`;
}

/**
 * Return a Tailwind CSS class for P&L coloring.
 *
 * - null / undefined → "text-muted-foreground"
 * - NaN → "text-muted-foreground"
 * - 0 / -0 → "text-muted-foreground"
 * - positive → "text-positive"
 * - negative → "text-negative"
 *
 * @param v - Numeric value, decimal string, or null/undefined.
 * @returns CSS class string for the P&L value.
 */
export function formatPnlClass(v: string | number | null | undefined): string {
  const n = parseValue(v);
  if (n === null) return 'text-muted-foreground';
  const normalized = normalizeNegativeZero(n);
  if (normalized === 0) return 'text-muted-foreground';
  return normalized > 0
    ? 'text-positive'
    : 'text-negative';
}

/**
 * Format a P&L value with $ and sign but without the "+" for positive
 * values for compact display (e.g. column total).
 *
 * - null / undefined → "—"
 * - NaN → "—"
 * - 0 / -0 → "$0.00"
 * - positive → "$1,234.50"
 * - negative → "-$1,234.50"
 *
 * @param v - Numeric value, decimal string, or null/undefined.
 * @returns Formatted string or "—".
 */
export function formatPnlCompact(v: string | number | null | undefined): string {
  const n = parseValue(v);
  if (n === null) return '—';
  const normalized = normalizeNegativeZero(n);
  const formatted = formatPlainNumber(Math.abs(normalized));
  if (normalized === 0) return `$${formatted}`;
  return normalized < 0 ? `-$${formatted}` : `$${formatted}`;
}
