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
  { id: 'app_profile', label: 'Workspace', href: '/settings/workspace' },
  { id: 'settings', label: 'Risk Defaults', href: '/settings/risk-defaults' },
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

  // 1. app_profile has at least one row with timezone set
  // (displayName is a hidden legacy field preserved through API round-trips
  // but no longer exposed in the Workspace UI)
  const profileRows = db.select().from(appProfile).all();
  const hasProfile =
    profileRows.length > 0 &&
    profileRows.some((r) => r.timezone != null);
  if (!hasProfile) {
    missing.push(ALL_STEPS[0]);
  }

  // 2. settings has at least one row with maxRiskPerTradePct set
  // (startingAccountValue and journalStartDate are hidden legacy fields preserved
  // through API round-trips but no longer exposed in the UI)
  const settingsRows = db.select().from(settings).all();
  const hasSettings =
    settingsRows.length > 0 &&
    settingsRows.some(
      (r) =>
        r.maxRiskPerTradePct != null,
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
