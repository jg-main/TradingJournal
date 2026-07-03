/**
 * readiness.test.ts
 *
 * Comprehensive vitest tests for the readiness contract helper.
 *
 * Covers:
 *   - Clean DB → not ready, all 4 missing
 *   - Each entity alone → not ready, 3 missing (per-step isolation)
 *   - All 4 present → ready, 0 missing
 *   - Inactive account → still missing "accounts"
 *   - app_profile without displayName → still missing "app_profile"
 *
 * Run: npx vitest run src/lib/readiness.test.ts
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import * as schema from '@/db/schema';
import { checkReadiness } from './readiness';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Create a fresh in-memory database with full schema applied via migrations.
 */
function createDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), 'src/db/migrations') });
  return db;
}

// ── Fixtures ───────────────────────────────────────────────────────────

function insertProfile(db: ReturnType<typeof createDb>, displayName?: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.appProfile).values({
    id,
    displayName: displayName ?? 'Test User',
    timezone: 'America/Bogota',
    defaultCurrency: 'USD',
    createdAt: now,
    updatedAt: now,
  }).run();
}

function insertSettings(db: ReturnType<typeof createDb>, opts?: { startingAccountValue?: number; journalStartDate?: string }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.settings).values({
    id,
    startingAccountValue: opts?.startingAccountValue ?? null,
    journalStartDate: opts?.journalStartDate ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
}

function insertAccount(db: ReturnType<typeof createDb>, isActive = true) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accounts).values({
    id,
    name: 'Test Account',
    broker: 'Test Broker',
    currency: 'USD',
    isActive,
    createdAt: now,
    updatedAt: now,
  }).run();
}

function insertSetupLookup(db: ReturnType<typeof createDb>, isActive = true) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.lookupValues).values({
    id,
    type: 'setup',
    value: 'test-setup',
    description: 'Test setup',
    sortOrder: 1,
    isActive,
    createdAt: now,
    updatedAt: now,
  }).run();
}

function insertSetupDefinition(db: ReturnType<typeof createDb>, isActive = true) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.setupDefinitions).values({
    id,
    name: 'Test Setup Def',
    description: 'A test setup definition',
    isActive,
    createdAt: now,
    updatedAt: now,
  }).run();
}

/**
 * Insert everything needed for a "fully ready" database.
 */
function insertAll(db: ReturnType<typeof createDb>) {
  insertProfile(db);
  insertSettings(db, { startingAccountValue: 10000, journalStartDate: '2024-01-01' });
  insertAccount(db, true);
  insertSetupLookup(db);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('checkReadiness', () => {
  it('returns not ready with all 4 missing on a clean database', () => {
    const db = createDb();
    const state = checkReadiness(db);

    expect(state.ready).toBe(false);
    expect(state.missing).toHaveLength(4);
    expect(state.missing.map((m) => m.id)).toEqual([
      'app_profile',
      'settings',
      'accounts',
      'setups',
    ]);
  });

  it('is not ready when only app_profile is present', () => {
    const db = createDb();
    insertProfile(db);

    const state = checkReadiness(db);

    expect(state.ready).toBe(false);
    expect(state.missing).toHaveLength(3);
    expect(state.missing.map((m) => m.id)).not.toContain('app_profile');
    expect(state.missing.map((m) => m.id)).toEqual([
      'settings',
      'accounts',
      'setups',
    ]);
  });

  it('is not ready when only settings are present', () => {
    const db = createDb();
    insertSettings(db, { startingAccountValue: 10000, journalStartDate: '2024-01-01' });

    const state = checkReadiness(db);

    expect(state.ready).toBe(false);
    expect(state.missing).toHaveLength(3);
    expect(state.missing.map((m) => m.id)).not.toContain('settings');
    expect(state.missing.map((m) => m.id)).toEqual([
      'app_profile',
      'accounts',
      'setups',
    ]);
  });

  it('is not ready when only accounts are present', () => {
    const db = createDb();
    insertAccount(db, true);

    const state = checkReadiness(db);

    expect(state.ready).toBe(false);
    expect(state.missing).toHaveLength(3);
    expect(state.missing.map((m) => m.id)).not.toContain('accounts');
    expect(state.missing.map((m) => m.id)).toEqual([
      'app_profile',
      'settings',
      'setups',
    ]);
  });

  it('is not ready when only setups are present', () => {
    const db = createDb();
    insertSetupLookup(db);

    const state = checkReadiness(db);

    expect(state.ready).toBe(false);
    expect(state.missing).toHaveLength(3);
    expect(state.missing.map((m) => m.id)).not.toContain('setups');
    expect(state.missing.map((m) => m.id)).toEqual([
      'app_profile',
      'settings',
      'accounts',
    ]);
  });

  it('is ready when all 4 requirements are met', () => {
    const db = createDb();
    insertAll(db);

    const state = checkReadiness(db);

    expect(state.ready).toBe(true);
    expect(state.missing).toHaveLength(0);
  });

  it('is not ready when account exists but is inactive', () => {
    const db = createDb();
    insertProfile(db);
    insertSettings(db, { startingAccountValue: 10000, journalStartDate: '2024-01-01' });
    insertAccount(db, false); // inactive account
    insertSetupLookup(db);

    const state = checkReadiness(db);

    expect(state.ready).toBe(false);
    expect(state.missing.map((m) => m.id)).toContain('accounts');
    expect(state.missing).toHaveLength(1);
  });

  it('is not ready when app_profile lacks displayName', () => {
    const db = createDb();
    insertProfile(db, ''); // empty displayName
    insertSettings(db, { startingAccountValue: 10000, journalStartDate: '2024-01-01' });
    insertAccount(db, true);
    insertSetupLookup(db);

    const state = checkReadiness(db);

    expect(state.ready).toBe(false);
    expect(state.missing.map((m) => m.id)).toContain('app_profile');
    expect(state.missing).toHaveLength(1);
  });

  it('is ready when setups exist via setupDefinitions only', () => {
    const db = createDb();
    insertProfile(db);
    insertSettings(db, { startingAccountValue: 10000, journalStartDate: '2024-01-01' });
    insertAccount(db, true);
    insertSetupDefinition(db); // no lookupValues setup — only setupDefinitions

    const state = checkReadiness(db);

    expect(state.ready).toBe(true);
    expect(state.missing).toHaveLength(0);
  });

  it('is not ready when all setups are inactive', () => {
    const db = createDb();
    insertProfile(db);
    insertSettings(db, { startingAccountValue: 10000, journalStartDate: '2024-01-01' });
    insertAccount(db, true);
    insertSetupLookup(db, false); // inactive setup

    const state = checkReadiness(db);

    expect(state.ready).toBe(false);
    expect(state.missing.map((m) => m.id)).toContain('setups');
    expect(state.missing).toHaveLength(1);
  });
});
