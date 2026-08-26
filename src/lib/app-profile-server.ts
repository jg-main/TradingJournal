/**
 * app-profile-server.ts
 *
 * Server-only helper for the configured application timezone.
 *
 * Keeps the app_profile lookup in ONE narrow place so analytics modules
 * do not each re-implement `db.select().from(appProfile).limit(1).get()`.
 *
 * The lookup is performed per call — there is NO module-level caching —
 * so changing app_profile.timezone takes effect on the next aggregation
 * without a restart (D8 §21).
 *
 * Pure timezone conversion lives in src/lib/timezone.ts; this module only
 * resolves the configured value from the database.
 */

import { db } from '@/db';
import { appProfile } from '@/db/schema';
import { DEFAULT_APP_TIMEZONE } from './timezone';

/**
 * Resolve the configured application timezone from app_profile.
 *
 * Contract:
 *  - app_profile.timezone is authoritative when present and valid.
 *  - Missing profile or null timezone -> DEFAULT_APP_TIMEZONE (America/Bogota),
 *    matching the schema default and the product's existing fallback contract.
 *  - An invalid IANA value is NOT silently ignored: we return the default so
 *    the app stays usable, but the invalid value is surfaced via console.warn
 *    so operators can repair the profile. (Analytical helpers still validate
 *    any timezone passed to them and fail predictably for direct misuse.)
 */
export function getConfiguredTimezone(): string {
  let row: { timezone: string | null } | undefined;
  try {
    row = db.select().from(appProfile).limit(1).get();
  } catch (err) {
    // Minimal test harnesses may not create the app_profile table.
    // Treat a missing table like a missing profile (fallback default);
    // any other database error propagates so real faults stay visible.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('no such table: app_profile')) {
      return DEFAULT_APP_TIMEZONE;
    }
    throw err;
  }
  const configured = row?.timezone ?? null;
  if (configured == null || configured.trim() === '') {
    return DEFAULT_APP_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured });
    return configured;
  } catch {
    console.warn(
      `[app-profile] Invalid configured timezone "${configured}" — falling back to "${DEFAULT_APP_TIMEZONE}"`,
    );
    return DEFAULT_APP_TIMEZONE;
  }
}
