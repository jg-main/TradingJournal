/**
 * timezone.ts
 *
 * Canonical server/pure timezone utility for ANALYTICAL calendar attribution.
 *
 * Invariant (D8):
 *   Calendar attribution is determined in app_profile.timezone.
 *   UTC remains the storage/instant representation.
 *   UTC must NOT be used as the user's analytical calendar.
 *
 * This module is pure: it never reads the database, never touches
 * NextResponse, and never depends on the machine/process timezone.
 * Every helper takes an explicit IANA timezone and validates it through
 * Intl.DateTimeFormat (platform facility — no new dependency).
 *
 * Client display keeps using TimezoneProvider (src/lib/timezone-context.tsx);
 * this module owns analytical calendar semantics only.
 */

export const DEFAULT_APP_TIMEZONE = 'America/Bogota';

/**
 * Validate an IANA timezone identifier using Intl.DateTimeFormat.
 * Returns true when Intl can construct a formatter for the zone.
 */
export function isValidTimezone(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Throw a descriptive Error when the timezone is not a valid IANA zone.
 * We fail predictably instead of silently falling back to the machine
 * timezone, which would make results non-deterministic across hosts.
 */
export function assertValidTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${JSON.stringify(timezone)}`);
  }
}

/**
 * Convert an absolute UTC instant (ISO string) to the local calendar date
 * key (YYYY-MM-DD) in the configured timezone.
 *
 * Throws on an invalid timestamp — callers that prefer skip semantics
 * must catch and skip (see calendar-heatmap / period-matrix handling of
 * malformed closedAt).
 */
export function instantToLocalDateKey(isoTimestamp: string, timezone: string): string {
  assertValidTimezone(timezone);
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${JSON.stringify(isoTimestamp)}`);
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Local UTC offset at a given instant: the number of milliseconds that
 * must be ADDED to the UTC instant to obtain the local wall time
 * (local = utc + offset).
 *
 * Computed via Intl.DateTimeFormat on the exact instant, so DST and
 * historical offset changes are honored.
 */
export function zoneOffsetMsAt(utcMs: number, timezone: string): number {
  assertValidTimezone(timezone);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return localAsUtc - utcMs;
}

/**
 * Convert a datetime-local control value into its UTC instant using the
 * configured application timezone, rather than the browser/process timezone.
 * Execution timestamps are financial records, so storage must be an
 * unambiguous ISO instant even when the trader's browser is in another zone.
 */
export function localDateTimeToUtc(localDateTime: string, timezone: string): string {
  assertValidTimezone(timezone);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(localDateTime);
  if (!match) {
    throw new Error(`Invalid local datetime: ${JSON.stringify(localDateTime)}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0') || 0);
  const wallTimeUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const wallDate = new Date(wallTimeUtc);
  if (
    month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59
    || wallDate.getUTCFullYear() !== year || wallDate.getUTCMonth() !== month - 1 || wallDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local datetime: ${JSON.stringify(localDateTime)}`);
  }

  // utc = local wall time - zone offset at the resulting instant. Repeating
  // handles normal DST transitions without relying on the browser timezone.
  let utc = wallTimeUtc;
  for (let i = 0; i < 5; i++) {
    const next = wallTimeUtc - zoneOffsetMsAt(utc, timezone);
    if (next === utc) break;
    utc = next;
  }

  return new Date(utc).toISOString();
}

/**
 * Convert a local calendar date key (YYYY-MM-DD) to the UTC instant of
 * LOCAL midnight (00:00) in the configured timezone, as an ISO string.
 *
 * The instant satisfies: instantToLocalDateKey(result, tz) === localDate
 * and the local wall time is 00:00:00.000. Iteration converges because
 * zone offsets change by at most a few hours at DST transitions, and
 * local midnight always exists (spring-forward transitions occur after
 * midnight in real-world zones).
 */
export function localDateStartToUtc(localDate: string, timezone: string): string {
  assertValidTimezone(timezone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    throw new Error(`Invalid local date key: ${JSON.stringify(localDate)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid local date key: ${JSON.stringify(localDate)}`);
  }

  // Wall-clock 00:00 expressed as if it were UTC, then corrected by the
  // zone offset at the converging instant: utc = wallTime - offset(utc).
  const wallTimeUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let utc = wallTimeUtc;
  for (let i = 0; i < 5; i++) {
    const next = wallTimeUtc - zoneOffsetMsAt(utc, timezone);
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc).toISOString();
}

/**
 * Convert a local calendar date key to the UTC instant of the NEXT local
 * midnight (exclusive end of the half-open local day interval):
 *   [localDateStartToUtc(d), localDateEndExclusiveToUtc(d))
 */
export function localDateEndExclusiveToUtc(localDate: string, timezone: string): string {
  return localDateStartToUtc(addLocalDays(localDate, 1), timezone);
}

/**
 * Half-open UTC interval covering one local calendar day:
 *   >= startUtc, < endExclusiveUtc
 */
export function localDateToUtcRange(
  localDate: string,
  timezone: string,
): { startUtc: string; endExclusiveUtc: string } {
  return {
    startUtc: localDateStartToUtc(localDate, timezone),
    endExclusiveUtc: localDateEndExclusiveToUtc(localDate, timezone),
  };
}

/**
 * Pure calendar-date arithmetic on YYYY-MM-DD keys (no timezone involved;
 * date keys are intentional local calendar dates).
 */
export function addLocalDays(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid local date key: ${JSON.stringify(dateKey)}`);
  }
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Day of week of a pure calendar date key (0=Sunday .. 6=Saturday).
 * Deterministic — uses UTC-only arithmetic on the date key, so it is
 * independent of the machine/process timezone.
 */
export function getLocalDayOfWeek(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid local date key: ${JSON.stringify(dateKey)}`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/**
 * Monday of the ISO week (Mon..Sun) containing the given local date key.
 */
export function getLocalISOMonday(dateKey: string): string {
  const day = getLocalDayOfWeek(dateKey); // 0=Sun .. 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addLocalDays(dateKey, diff);
}

/**
 * ISO 8601 week number (1-53) of a pure local date key.
 * Week 1 is the week containing the first Thursday of the year.
 */
export function getISOWeekNumber(dateKey: string): number {
  const d = new Date(Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10))));
  const dayNum = d.getUTCDay() || 7; // Sunday -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
