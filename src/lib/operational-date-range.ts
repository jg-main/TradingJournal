/**
 * Global operational date-range: canonical types, calendar math, validation,
 * and browser persistence (M004/T9A).
 *
 * The global operational period is the second shared app-wide context after
 * Account. Consumers (Workstation, Trades, Performance in later tasks) select
 * one canonical preset or an explicit Custom range; this module owns the
 * preset vocabulary, the timezone-correct calendar resolution, and the
 * versioned `app:date-range` persistence contract.
 *
 * Semantics:
 * - Relative presets (YTD/MTD/1M/3M/6M/1Y) are ALWAYS recomputed from the
 *   current calendar date in the CONFIGURED application timezone when
 *   resolved. Never persist a resolved relative date.
 * - Calendar arithmetic uses calendar months/years with end-of-month and
 *   leap-year clamping (2026-03-31 - 1M => 2026-02-28; 2024-02-29 - 1Y =>
 *   2023-02-28).
 * - Custom bounds are validated: empty bounds are allowed; if both exist,
 *   from must not be later than to.
 *
 * This module is pure — it has no React, no storage access, and no imports.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type OperationalDatePreset =
  | 'Max'
  | 'YTD'
  | '1Y'
  | '6M'
  | '3M'
  | 'MTD'
  | '1M'
  | 'Custom';

export const OPERATIONAL_DATE_PRESETS: readonly OperationalDatePreset[] = [
  'Max',
  'YTD',
  '1Y',
  '6M',
  '3M',
  'MTD',
  '1M',
  'Custom',
] as const;

export const DEFAULT_OPERATIONAL_DATE_PRESET: OperationalDatePreset = 'YTD';

/** A user selection. `from`/`to` are meaningful only for Custom. */
export interface OperationalDateRangeSelection {
  preset: OperationalDatePreset;
  /** YYYY-MM-DD or '' (unbounded). '' for every relative preset. */
  from: string;
  /** YYYY-MM-DD or '' (unbounded). '' for every relative preset. */
  to: string;
}

/** The resolved concrete range used by consumers. */
export interface ResolvedOperationalDateRange {
  from: string;
  to: string;
}

export const OPERATIONAL_DATE_RANGE_VERSION = 1;

export const OPERATIONAL_DATE_RANGE_STORAGE_KEY = 'app:date-range';

/** Versioned browser-persistence shape (semantic selection, never resolved dates). */
export interface PersistedOperationalDateRange {
  version: number;
  preset: OperationalDatePreset;
  from?: string;
  to?: string;
}

// ── Calendar helpers (pure) ─────────────────────────────────────────────

function formatYmd(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/** Last day of a 1-based month, via UTC so the result is pure calendar math. */
function lastDayOfMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

/** "Today" as YYYY-MM-DD in the configured application timezone (not UTC). */
export function todayInTimezone(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  return `${m.year}-${m.month}-${m.day}`;
}

/** Calendar-month arithmetic with end-of-month clamping. */
export function addCalendarMonths(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) + delta;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth1 = ((totalMonths % 12) + 12) % 12 + 1;
  const day = Math.min(d, lastDayOfMonth(targetYear, targetMonth1));
  return formatYmd(targetYear, targetMonth1, day);
}

/** Calendar-year arithmetic with leap-day clamping (02-29 → 02-28). */
export function addCalendarYears(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const targetYear = y + delta;
  const day = Math.min(d, lastDayOfMonth(targetYear, m));
  return formatYmd(targetYear, m, day);
}

// ── Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a selection into a concrete range using the configured application
 * timezone. Relative presets are computed from `now` every call — callers
 * never receive or persist stale resolved dates.
 */
export function resolveOperationalDateRange(
  selection: OperationalDateRangeSelection,
  timezone: string,
  now: Date,
): ResolvedOperationalDateRange {
  switch (selection.preset) {
    case 'Max':
      return { from: '', to: '' };
    case 'YTD': {
      const today = todayInTimezone(timezone, now);
      return { from: `${today.slice(0, 4)}-01-01`, to: '' };
    }
    case 'MTD': {
      const today = todayInTimezone(timezone, now);
      return { from: `${today.slice(0, 7)}-01`, to: '' };
    }
    case '1M':
      return { from: addCalendarMonths(todayInTimezone(timezone, now), -1), to: '' };
    case '3M':
      return { from: addCalendarMonths(todayInTimezone(timezone, now), -3), to: '' };
    case '6M':
      return { from: addCalendarMonths(todayInTimezone(timezone, now), -6), to: '' };
    case '1Y':
      return { from: addCalendarYears(todayInTimezone(timezone, now), -1), to: '' };
    case 'Custom':
      return { from: selection.from, to: selection.to };
  }
}

// ── Validation ──────────────────────────────────────────────────────────

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(value: string): boolean {
  if (!YMD_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Canonical Custom validation: empty bounds are allowed; every present bound
 * must be a real calendar date; if both are present, from must not be later
 * than to (lexicographic comparison is valid for YYYY-MM-DD).
 */
export function isValidCustomRange(from: string, to: string): boolean {
  if (from !== '' && !isValidYmd(from)) return false;
  if (to !== '' && !isValidYmd(to)) return false;
  if (from !== '' && to !== '' && from > to) return false;
  return true;
}

export function isOperationalDatePreset(value: unknown): value is OperationalDatePreset {
  return typeof value === 'string' && (OPERATIONAL_DATE_PRESETS as readonly string[]).includes(value);
}

// ── Defaults ────────────────────────────────────────────────────────────

export function defaultOperationalDateRangeSelection(): OperationalDateRangeSelection {
  return { preset: DEFAULT_OPERATIONAL_DATE_PRESET, from: '', to: '' };
}

// ── Persistence ─────────────────────────────────────────────────────────

/**
 * Validate an unknown persisted payload. Returns the canonical selection or
 * null when the payload is malformed, an unknown version, an unknown preset,
 * or an invalid Custom range (callers fall back to the default).
 */
export function sanitizePersistedOperationalDateRange(raw: unknown): OperationalDateRangeSelection | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== OPERATIONAL_DATE_RANGE_VERSION) return null;
  if (!isOperationalDatePreset(obj.preset)) return null;
  if (obj.preset === 'Custom') {
    const from = typeof obj.from === 'string' ? obj.from : '';
    const to = typeof obj.to === 'string' ? obj.to : '';
    if (!isValidCustomRange(from, to)) return null;
    return { preset: 'Custom', from, to };
  }
  // Relative presets are stored semantically — no resolved dates persisted.
  return { preset: obj.preset, from: '', to: '' };
}

/** Serialize a selection to the versioned semantic storage shape. */
export function serializeOperationalDateRange(selection: OperationalDateRangeSelection): string {
  const persisted: PersistedOperationalDateRange =
    selection.preset === 'Custom'
      ? { version: OPERATIONAL_DATE_RANGE_VERSION, preset: 'Custom', from: selection.from, to: selection.to }
      : { version: OPERATIONAL_DATE_RANGE_VERSION, preset: selection.preset };
  return JSON.stringify(persisted);
}

/** Parse + validate persisted JSON; null when unusable (fall back to default). */
export function deserializeOperationalDateRange(json: string | null): OperationalDateRangeSelection | null {
  if (json == null) return null;
  try {
    return sanitizePersistedOperationalDateRange(JSON.parse(json));
  } catch {
    return null;
  }
}
