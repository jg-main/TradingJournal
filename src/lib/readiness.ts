/**
 * readiness.ts
 *
 * Shared readiness contract for "is the app ready for journaling?"
 * Reads from persisted tables (app_profile, settings, accounts, setups)
 * and returns a structured state with which steps are missing.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { appProfile, settings, accounts, lookupValues, setupDefinitions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import * as schema from '@/db/schema';

export interface MissingStep {
  id: string;
  label: string;
  href: string;
}

export interface ReadinessState {
  ready: boolean;
  missing: MissingStep[];
}

const ALL_STEPS: MissingStep[] = [
  { id: 'app_profile', label: 'App Profile', href: '/settings/app' },
  { id: 'settings', label: 'Risk Settings', href: '/settings/risk' },
  { id: 'accounts', label: 'Accounts', href: '/settings/accounts' },
  { id: 'setups', label: 'Trading Setups', href: '/settings/plays' },
];

type JournalDB = BetterSQLite3Database<typeof schema>;

/**
 * Check whether the app is ready for journaling by inspecting persisted data.
 *
 * @param db - Drizzle database instance (real or in-memory)
 * @returns ReadinessState with ready flag and ordered list of missing steps
 */
export function checkReadiness(db: JournalDB): ReadinessState {
  const missing: MissingStep[] = [];

  // 1. app_profile has at least one row with a non-empty displayName
  const profileRows = db.select().from(appProfile).all();
  const hasProfile =
    profileRows.length > 0 &&
    profileRows.some((r) => r.displayName != null && r.displayName.trim().length > 0);
  if (!hasProfile) {
    missing.push(ALL_STEPS[0]);
  }

  // 2. settings has at least one row with startingAccountValue and journalStartDate set
  const settingsRows = db.select().from(settings).all();
  const hasSettings =
    settingsRows.length > 0 &&
    settingsRows.some(
      (r) =>
        r.startingAccountValue != null &&
        r.journalStartDate != null &&
        r.journalStartDate.length > 0,
    );
  if (!hasSettings) {
    missing.push(ALL_STEPS[1]);
  }

  // 3. accounts has at least one active row
  const activeAccounts = db
    .select()
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .all();
  if (activeAccounts.length === 0) {
    missing.push(ALL_STEPS[2]);
  }

  // 4. Setups — active rows in lookupValues (type='setup') OR active rows in setupDefinitions
  const setupLookups = db
    .select()
    .from(lookupValues)
    .where(and(eq(lookupValues.type, 'setup'), eq(lookupValues.isActive, true)))
    .all();

  const setupDefs = db
    .select()
    .from(setupDefinitions)
    .where(eq(setupDefinitions.isActive, true))
    .all();

  if (setupLookups.length === 0 && setupDefs.length === 0) {
    missing.push(ALL_STEPS[3]);
  }

  return {
    ready: missing.length === 0,
    missing,
  };
}
