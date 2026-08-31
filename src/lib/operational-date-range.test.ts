/**
 * Tests for the pure operational date-range module (M004/T9A).
 *
 * Proves the canonical preset vocabulary, timezone-correct calendar
 * resolution, calendar-month/year arithmetic with clamping, Custom
 * validation, and the versioned persistence contract.
 *
 * Run: npx vitest run src/lib/operational-date-range.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  addCalendarMonths,
  addCalendarYears,
  defaultOperationalDateRangeSelection,
  deserializeOperationalDateRange,
  isValidCustomRange,
  millisecondsUntilNextOperationalLocalDay,
  resolveOperationalDateRange,
  sanitizePersistedOperationalDateRange,
  serializeOperationalDateRange,
  todayInTimezone,
  zonedDayEndIso,
  zonedDayStartIso,
  OPERATIONAL_DATE_PRESETS,
  OPERATIONAL_DATE_RANGE_STORAGE_KEY,
  OPERATIONAL_DATE_RANGE_VERSION,
  DEFAULT_OPERATIONAL_DATE_PRESET,
  type OperationalDateRangeSelection,
} from './operational-date-range';

const UTC = 'UTC';
const HOUR_MS = 3_600_000;
const sel = (preset: OperationalDateRangeSelection['preset'], from = '', to = ''): OperationalDateRangeSelection =>
  ({ preset, from, to });

describe('preset vocabulary and defaults', () => {
  it('exposes exactly the canonical presets in order', () => {
    expect(OPERATIONAL_DATE_PRESETS).toEqual(['Max', 'YTD', '1Y', '6M', '3M', 'MTD', '1M', 'Custom']);
  });

  it('defaults to YTD with empty bounds', () => {
    expect(defaultOperationalDateRangeSelection()).toEqual({ preset: 'YTD', from: '', to: '' });
    expect(DEFAULT_OPERATIONAL_DATE_PRESET).toBe('YTD');
  });
});

describe('resolution — Max', () => {
  it('resolves Max to an empty range', () => {
    expect(resolveOperationalDateRange(sel('Max'), UTC, new Date('2026-07-15T12:00:00Z'))).toEqual({ from: '', to: '' });
  });
});

describe('resolution — YTD', () => {
  it('derives the first day of the current year in the configured timezone', () => {
    expect(resolveOperationalDateRange(sel('YTD'), UTC, new Date('2026-07-15T12:00:00Z'))).toEqual({
      from: '2026-01-01',
      to: '',
    });
  });

  it('recomputes against the current calendar year (no stale resolved date)', () => {
    expect(resolveOperationalDateRange(sel('YTD'), UTC, new Date('2027-01-02T12:00:00Z'))).toEqual({
      from: '2027-01-01',
      to: '',
    });
  });
});

describe('resolution — MTD', () => {
  it('derives the first day of the current month', () => {
    expect(resolveOperationalDateRange(sel('MTD'), UTC, new Date('2026-07-15T12:00:00Z'))).toEqual({
      from: '2026-07-01',
      to: '',
    });
  });
});

describe('resolution — relative calendar-month presets', () => {
  const now = new Date('2026-07-15T12:00:00Z');

  it('1M uses calendar-month arithmetic', () => {
    expect(resolveOperationalDateRange(sel('1M'), UTC, now)).toEqual({ from: '2026-06-15', to: '' });
  });

  it('3M uses calendar-month arithmetic', () => {
    expect(resolveOperationalDateRange(sel('3M'), UTC, now)).toEqual({ from: '2026-04-15', to: '' });
  });

  it('6M uses calendar-month arithmetic', () => {
    expect(resolveOperationalDateRange(sel('6M'), UTC, now)).toEqual({ from: '2026-01-15', to: '' });
  });
});

describe('resolution — 1Y', () => {
  it('uses calendar-year arithmetic', () => {
    expect(resolveOperationalDateRange(sel('1Y'), UTC, new Date('2026-07-15T12:00:00Z'))).toEqual({
      from: '2025-07-15',
      to: '',
    });
  });
});

describe('calendar clamping', () => {
  it('clamps month-end: 2026-03-31 minus 1 month => 2026-02-28', () => {
    expect(addCalendarMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('clamps month-end: 2026-05-31 minus 1 month => 2026-04-30', () => {
    expect(addCalendarMonths('2026-05-31', -1)).toBe('2026-04-30');
  });

  it('clamps leap day: 2024-02-29 minus 1 year => 2023-02-28', () => {
    expect(addCalendarYears('2024-02-29', -1)).toBe('2023-02-28');
  });

  it('preserves a leap year where the target is a leap year (2024-02-29 - 4Y => 2020-02-29)', () => {
    expect(addCalendarYears('2024-02-29', -4)).toBe('2020-02-29');
  });
});

describe('timezone correctness', () => {
  it('the configured timezone determines the calendar date, not UTC/browser assumptions', () => {
    // 2026-01-01T00:30:00Z is 2026-01-01 in UTC but 2025-12-31 in America/New_York.
    const instant = new Date('2026-01-01T00:30:00Z');
    expect(todayInTimezone('UTC', instant)).toBe('2026-01-01');
    expect(todayInTimezone('America/New_York', instant)).toBe('2025-12-31');

    // YTD therefore resolves to 2025 for America/New_York at that instant.
    expect(resolveOperationalDateRange(sel('YTD'), 'UTC', instant)).toEqual({ from: '2026-01-01', to: '' });
    expect(resolveOperationalDateRange(sel('YTD'), 'America/New_York', instant)).toEqual({ from: '2025-01-01', to: '' });
  });
});

describe('Custom resolution and validation', () => {
  it('preserves valid explicit bounds', () => {
    const s = sel('Custom', '2026-01-01', '2026-06-30');
    expect(resolveOperationalDateRange(s, UTC, new Date('2026-07-15T12:00:00Z'))).toEqual({
      from: '2026-01-01',
      to: '2026-06-30',
    });
  });

  it('allows a one-sided custom bound (empty from)', () => {
    expect(isValidCustomRange('', '2026-06-30')).toBe(true);
    expect(resolveOperationalDateRange(sel('Custom', '', '2026-06-30'), UTC, new Date())).toEqual({
      from: '',
      to: '2026-06-30',
    });
  });

  it('rejects from > to', () => {
    expect(isValidCustomRange('2026-06-30', '2026-01-01')).toBe(false);
    expect(sanitizePersistedOperationalDateRange({ version: 1, preset: 'Custom', from: '2026-06-30', to: '2026-01-01' })).toBeNull();
  });

  it('rejects malformed date strings', () => {
    expect(isValidCustomRange('2026-02-30', '')).toBe(false);
    expect(isValidCustomRange('not-a-date', '2026-01-01')).toBe(false);
  });
});

describe('persistence contract', () => {
  it('uses the canonical storage key and version', () => {
    expect(OPERATIONAL_DATE_RANGE_STORAGE_KEY).toBe('app:date-range');
    expect(OPERATIONAL_DATE_RANGE_VERSION).toBe(1);
  });

  it('persists relative presets semantically (no resolved dates)', () => {
    expect(serializeOperationalDateRange(sel('YTD'))).toBe('{"version":1,"preset":"YTD"}');
    expect(serializeOperationalDateRange(sel('1M'))).toBe('{"version":1,"preset":"1M"}');
  });

  it('persists Custom with explicit bounds', () => {
    expect(serializeOperationalDateRange(sel('Custom', '2026-01-01', '2026-06-30'))).toBe(
      '{"version":1,"preset":"Custom","from":"2026-01-01","to":"2026-06-30"}',
    );
  });

  it('round-trips a valid persisted payload', () => {
    const json = serializeOperationalDateRange(sel('Custom', '2026-01-01', '2026-06-30'));
    expect(deserializeOperationalDateRange(json)).toEqual({ preset: 'Custom', from: '2026-01-01', to: '2026-06-30' });
  });

  it('rejects malformed JSON', () => {
    expect(deserializeOperationalDateRange('{not json')).toBeNull();
  });

  it('rejects unknown presets', () => {
    expect(sanitizePersistedOperationalDateRange({ version: 1, preset: 'Quarterly' })).toBeNull();
  });

  it('rejects unknown versions', () => {
    expect(sanitizePersistedOperationalDateRange({ version: 99, preset: 'YTD' })).toBeNull();
  });

  it('rejects a persisted relative payload carrying resolved dates', () => {
    expect(sanitizePersistedOperationalDateRange({ version: 1, preset: 'YTD', from: '2026-01-01' })).toEqual({
      preset: 'YTD',
      from: '',
      to: '',
    });
  });

  it('returns null for null input (caller falls back to default)', () => {
    expect(deserializeOperationalDateRange(null)).toBeNull();
  });
});

describe('configured-timezone day boundaries', () => {
  it('America/Bogota start of day maps to 05:00Z (UTC-5, no DST)', () => {
    expect(zonedDayStartIso('2026-06-30', 'America/Bogota')).toBe('2026-06-30T05:00:00.000Z');
  });

  it('America/Bogota end of day is one millisecond before the next local day', () => {
    expect(zonedDayEndIso('2026-06-30', 'America/Bogota')).toBe('2026-07-01T04:59:59.999Z');
  });

  it('America/New_York winter local midnight uses UTC-5', () => {
    expect(zonedDayStartIso('2026-01-15', 'America/New_York')).toBe('2026-01-15T05:00:00.000Z');
  });

  it('America/New_York summer local midnight uses UTC-4 (DST-aware)', () => {
    expect(zonedDayStartIso('2026-07-15', 'America/New_York')).toBe('2026-07-15T04:00:00.000Z');
  });

  it('America/New_York end of day tracks the local day length, not 24h', () => {
    // Winter day: 24h → next-day start 05:00Z minus 1ms.
    expect(zonedDayEndIso('2026-01-15', 'America/New_York')).toBe('2026-01-16T04:59:59.999Z');
    // Summer day: 24h → next-day start 04:00Z minus 1ms.
    expect(zonedDayEndIso('2026-07-15', 'America/New_York')).toBe('2026-07-16T03:59:59.999Z');
  });

  it('handles month-end and year-end boundaries', () => {
    expect(zonedDayStartIso('2026-12-31', 'UTC')).toBe('2026-12-31T00:00:00.000Z');
    expect(zonedDayEndIso('2026-12-31', 'UTC')).toBe('2026-12-31T23:59:59.999Z');
    expect(zonedDayStartIso('2026-02-28', 'America/Bogota')).toBe('2026-02-28T05:00:00.000Z');
  });
});

describe('next local midnight scheduling (M004/T9E)', () => {
  it('America/Bogota partial day schedules the real absolute delay', () => {
    // 2026-08-31T12:00Z is 07:00 local in Bogotá; the next local midnight is
    // 2026-09-01T05:00:00.000Z (UTC-5, no DST) → 17 hours.
    expect(millisecondsUntilNextOperationalLocalDay('America/Bogota', new Date('2026-08-31T12:00:00Z'))).toBe(17 * HOUR_MS);
  });

  it('America/Bogota a normal local day is 24 hours (no DST assumption)', () => {
    // Exactly at Bogotá midnight: the NEXT boundary is one full local day later.
    expect(millisecondsUntilNextOperationalLocalDay('America/Bogota', new Date('2026-09-01T05:00:00.000Z'))).toBe(24 * HOUR_MS);
  });

  it('America/New_York spring DST day is 23 hours', () => {
    // 2026-03-08 00:00 local (EST, UTC-5) → 2026-03-09 00:00 local (EDT,
    // UTC-4). The local day between the two midnights is 23 hours.
    expect(millisecondsUntilNextOperationalLocalDay('America/New_York', new Date('2026-03-08T05:00:00.000Z'))).toBe(23 * HOUR_MS);
  });

  it('America/New_York fall DST day is 25 hours', () => {
    // 2026-11-01 00:00 local (EDT, UTC-4) → 2026-11-02 00:00 local (EST,
    // UTC-5). The local day between the two midnights is 25 hours.
    expect(millisecondsUntilNextOperationalLocalDay('America/New_York', new Date('2026-11-01T04:00:00.000Z'))).toBe(25 * HOUR_MS);
  });

  it('does not assume a fixed 24-hour interval across a UTC day boundary', () => {
    // The helper derives the delay from the next local date's midnight
    // instant — a partially elapsed day returns the remaining hours, never
    // a hardcoded 24h.
    expect(millisecondsUntilNextOperationalLocalDay('UTC', new Date('2026-08-31T18:00:00Z'))).toBe(6 * HOUR_MS);
  });
});
