#!/usr/bin/env tsx
/**
 * timezone.test.ts
 *
 * Canonical timezone helper unit tests (D8).
 *
 * Run: npx tsx src/lib/timezone.test.ts
 *
 * Pattern: src/lib/dashboard.test.ts — standalone tsx harness, no DB.
 * Tests explicitly state timezone and must pass identically regardless of
 * the machine/process timezone (pure Intl-based conversion).
 */

import {
  instantToLocalDateKey,
  localDateTimeToUtc,
  localDateStartToUtc,
  localDateEndExclusiveToUtc,
  localDateToUtcRange,
  isValidTimezone,
  assertValidTimezone,
  addLocalDays,
  getLocalDayOfWeek,
  getLocalISOMonday,
  getISOWeekNumber,
  DEFAULT_APP_TIMEZONE,
} from './timezone';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${msg} — got ${JSON.stringify(actual)}`);
}

// ── A. UTC instant → Bogotá previous date ───────────────────────────────

console.log('\nA. UTC instant → Bogotá previous date:');
assertEqual(instantToLocalDateKey('2026-03-10T00:30:00.000Z', 'America/Bogota'), '2026-03-09', '2026-03-10T00:30Z in Bogotá = 2026-03-09');
assertEqual(instantToLocalDateKey('2026-03-09T05:00:00.000Z', 'America/Bogota'), '2026-03-09', '2026-03-09T05:00Z in Bogotá = 2026-03-09 (local midnight)');
assertEqual(instantToLocalDateKey('2026-03-09T04:59:59.999Z', 'America/Bogota'), '2026-03-08', '2026-03-09T04:59:59.999Z in Bogotá = 2026-03-08 (local 23:59)');

// ── B. UTC instant → UTC same date ──────────────────────────────────────

console.log('\nB. UTC instant → UTC same date:');
assertEqual(instantToLocalDateKey('2026-03-10T00:30:00.000Z', 'UTC'), '2026-03-10', '2026-03-10T00:30Z in UTC = 2026-03-10');

// ── C. Year boundary ────────────────────────────────────────────────────

console.log('\nC. Year boundary:');
assertEqual(instantToLocalDateKey('2027-01-01T02:00:00.000Z', 'America/New_York'), '2026-12-31', '2027-01-01T02:00Z in America/New_York = 2026-12-31');
assertEqual(instantToLocalDateKey('2027-01-01T04:59:59.999Z', 'America/New_York'), '2026-12-31', '2027-01-01T04:59:59.999Z in America/New_York = 2026-12-31 (23:59 EST)');
assertEqual(instantToLocalDateKey('2027-01-01T05:00:00.000Z', 'America/New_York'), '2027-01-01', '2027-01-01T05:00Z in America/New_York = 2027-01-01 (local midnight)');

// ── D. Month boundary (Bogotá) ──────────────────────────────────────────

console.log('\nD. Month boundary:');
assertEqual(instantToLocalDateKey('2026-04-01T03:30:00.000Z', 'America/Bogota'), '2026-03-31', '2026-04-01T03:30Z in Bogotá = 2026-03-31');
assertEqual(instantToLocalDateKey('2026-04-01T05:00:00.000Z', 'America/Bogota'), '2026-04-01', '2026-04-01T05:00Z in Bogotá = 2026-04-01 (local midnight)');

// ── E. Quarter boundary ─────────────────────────────────────────────────

console.log('\nE. Quarter boundary:');
assertEqual(instantToLocalDateKey('2026-04-01T03:30:00.000Z', 'America/Bogota'), '2026-03-31', 'Q2 starts 04-01 UTC but Bogotá local is still 03-31 (Q1)');

// ── F. Local date → UTC start boundary ──────────────────────────────────

console.log('\nF. Local date → UTC start boundary:');
assertEqual(localDateStartToUtc('2026-03-09', 'America/Bogota'), '2026-03-09T05:00:00.000Z', 'Bogotá 2026-03-09 00:00 = 2026-03-09T05:00Z');
assertEqual(localDateStartToUtc('2026-03-10', 'UTC'), '2026-03-10T00:00:00.000Z', 'UTC 2026-03-10 00:00 = 2026-03-10T00:00Z');
// Round-trip: start instant maps back to the same local date
assertEqual(instantToLocalDateKey(localDateStartToUtc('2026-03-09', 'America/Bogota'), 'America/Bogota'), '2026-03-09', 'round-trip Bogotá start');
assertEqual(instantToLocalDateKey(localDateStartToUtc('2026-07-01', 'America/New_York'), 'America/New_York'), '2026-07-01', 'round-trip NY EDT start (UTC-4)');
assertEqual(instantToLocalDateKey(localDateStartToUtc('2027-01-01', 'America/New_York'), 'America/New_York'), '2027-01-01', 'round-trip NY EST start (UTC-5)');

// ── F1. Local datetime → UTC instant ───────────────────────────────────

console.log('\nF1. Local datetime → UTC instant:');
assertEqual(localDateTimeToUtc('2026-09-02T09:30', 'America/Bogota'), '2026-09-02T14:30:00.000Z', 'Bogotá 09:30 execution time serializes as 14:30Z');
assertEqual(localDateTimeToUtc('2026-07-01T09:30', 'America/New_York'), '2026-07-01T13:30:00.000Z', 'New York EDT execution time honors DST');

// ── G. Local next-date → UTC exclusive end boundary ─────────────────────

console.log('\nG. Local next-date → UTC exclusive end boundary:');
assertEqual(localDateEndExclusiveToUtc('2026-03-09', 'America/Bogota'), '2026-03-10T05:00:00.000Z', 'Bogotá 2026-03-10 00:00 = exclusive end of 2026-03-09');
const range = localDateToUtcRange('2026-03-09', 'America/Bogota');
assertEqual(range.startUtc, '2026-03-09T05:00:00.000Z', 'range start');
assertEqual(range.endExclusiveUtc, '2026-03-10T05:00:00.000Z', 'range end exclusive');

// ── H. DST-zone boundary ────────────────────────────────────────────────

console.log('\nH. DST-zone boundary:');
// America/New_York 2026 DST: spring forward 2026-03-08 02:00 → 03:00 EST→EDT.
// The week Monday 2026-03-02 → Monday 2026-03-09 spans the transition; the
// UTC span is NOT exactly 7*24h. Verify local boundaries resolve correctly.
assertEqual(localDateStartToUtc('2026-03-02', 'America/New_York'), '2026-03-02T05:00:00.000Z', 'NY Mon 2026-03-02 00:00 EST = 05:00Z');
assertEqual(localDateStartToUtc('2026-03-09', 'America/New_York'), '2026-03-09T04:00:00.000Z', 'NY Mon 2026-03-09 00:00 EDT = 04:00Z (after spring forward)');
// The week Mon 03-02 → Mon 03-09 is 7 local days but 167 UTC hours (DST).
const weekStart = Date.parse(localDateStartToUtc('2026-03-02', 'America/New_York'));
const nextWeekStart = Date.parse(localDateStartToUtc('2026-03-09', 'America/New_York'));
assert((nextWeekStart - weekStart) === 167 * 3600_000, `DST week is 167h not 168h (got ${(nextWeekStart - weekStart) / 3600_000}h)`);
// Fall back: 2026-11-01 02:00 EDT → 01:00 EST; the week Mon 2026-10-26 →
// Mon 2026-11-02 spans the transition and is 169h.
const fallStart = Date.parse(localDateStartToUtc('2026-10-26', 'America/New_York'));
const fallNext = Date.parse(localDateStartToUtc('2026-11-02', 'America/New_York'));
assert((fallNext - fallStart) === 169 * 3600_000, `fall-back week is 169h not 168h (got ${(fallNext - fallStart) / 3600_000}h)`);

// ── I. Invalid IANA timezone ────────────────────────────────────────────

console.log('\nI. Invalid IANA timezone:');
assert(!isValidTimezone('Not/AZone'), 'invalid zone rejected');
assert(!isValidTimezone(''), 'empty string rejected');
assert(isValidTimezone('America/Bogota'), 'valid zone accepted');
assert(isValidTimezone('UTC'), 'UTC accepted');
let threw = false;
try {
  assertValidTimezone('Bogus/Zone');
} catch {
  threw = true;
}
assert(threw, 'assertValidTimezone throws for invalid zone');
let threw2 = false;
try {
  instantToLocalDateKey('2026-03-10T00:30:00.000Z', 'Bogus/Zone');
} catch {
  threw2 = true;
}
assert(threw2, 'instantToLocalDateKey throws for invalid zone (no silent machine fallback)');

// ── Local date arithmetic ───────────────────────────────────────────────

console.log('\nLocal date arithmetic:');
assertEqual(addLocalDays('2026-03-09', 6), '2026-03-15', 'add 6 days = Sunday');
assertEqual(addLocalDays('2026-03-09', 7), '2026-03-16', 'add 7 days = next Monday');
assertEqual(addLocalDays('2026-01-01', -1), '2025-12-31', 'negative across year');
assertEqual(addLocalDays('2026-12-31', 1), '2027-01-01', 'positive across year');
assertEqual(addLocalDays('2028-02-28', 1), '2028-02-29', 'leap year Feb 29');
assertEqual(getLocalDayOfWeek('2026-03-09'), 1, '2026-03-09 is Monday');
assertEqual(getLocalDayOfWeek('2026-03-15'), 0, '2026-03-15 is Sunday');
assertEqual(getLocalISOMonday('2026-03-11'), '2026-03-09', 'ISO Monday of 2026-03-11');
assertEqual(getLocalISOMonday('2026-03-15'), '2026-03-09', 'Sunday belongs to week starting Mon 03-09');
assertEqual(getLocalISOMonday('2026-03-08'), '2026-03-02', 'Sunday 03-08 belongs to previous week');
assertEqual(getISOWeekNumber('2026-01-01'), 1, '2026-01-01 is ISO week 1');
assertEqual(DEFAULT_APP_TIMEZONE, 'America/Bogota', 'default app timezone = America/Bogota');

// ── Same instant, different configured timezones (D8 §17) ───────────────

console.log('\nSame instant, different configured timezones:');
assertEqual(instantToLocalDateKey('2026-03-10T00:30:00Z', 'UTC'), '2026-03-10', 'UTC -> 2026-03-10');
assertEqual(instantToLocalDateKey('2026-03-10T00:30:00Z', 'America/Bogota'), '2026-03-09', 'America/Bogota -> 2026-03-09');
assertEqual(instantToLocalDateKey('2026-03-10T00:30:00Z', 'America/New_York'), '2026-03-09', 'America/New_York -> 2026-03-09 (19:30 EST)');

// ── Machine/process timezone independence (D8 §16) ──────────────────────

console.log('\nMachine/process timezone independence:');
// The helper is pure Intl — same result no matter what process.env.TZ is.
const prevTz = process.env.TZ;
process.env.TZ = 'UTC';
assertEqual(instantToLocalDateKey('2026-03-10T00:30:00Z', 'America/Bogota'), '2026-03-09', 'result under process TZ=UTC');
assertEqual(localDateStartToUtc('2026-03-09', 'America/Bogota'), '2026-03-09T05:00:00.000Z', 'start under process TZ=UTC');
process.env.TZ = 'America/Bogota';
assertEqual(instantToLocalDateKey('2026-03-10T00:30:00Z', 'America/Bogota'), '2026-03-09', 'result under process TZ=America/Bogota');
assertEqual(localDateStartToUtc('2026-03-09', 'America/Bogota'), '2026-03-09T05:00:00.000Z', 'start under process TZ=America/Bogota');
process.env.TZ = prevTz ?? 'UTC';

console.log(`\n${failed === 0 ? 'timezone.test.ts — ALL PASSED' : 'timezone.test.ts — FAILED'}`);
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
