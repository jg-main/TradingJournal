/**
 * readiness route test
 *
 * Tests GET /api/readiness with empty, partial, and complete database states.
 *
 * Run: npx vitest run src/app/api/readiness/__tests__/route.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/db/schema';
import { checkReadiness } from '@/lib/readiness';

// ── Setup: test DB ──────────────────────────────────────────────────

const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables (accounts first due to FK ref from settings)
sqlite.exec(`
  CREATE TABLE app_profile (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT,
    timezone TEXT DEFAULT 'America/Bogota',
    default_currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    starting_balance REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT REFERENCES accounts(id),
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    backup_enabled INTEGER DEFAULT 0,
    backup_retention_count INTEGER DEFAULT 3,
    backup_last_run_at TEXT,
    backup_last_run_status TEXT,
    backup_cron_time TEXT DEFAULT '02:00',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE setup_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    how_to_play TEXT,
    entry_rules TEXT,
    exit_rules TEXT,
    tags TEXT,
    default_risk_pct REAL,
    position_sizing_rules TEXT,
    chart_patterns TEXT,
    analysis_config TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetReadiness(
  testDb?: ReturnType<typeof drizzle<typeof schema>>,
): { status: number; data: unknown } {
  try {
    const state = checkReadiness(testDb ?? db);
    return { status: 200, data: state };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to check readiness', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM setup_definitions;');
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM accounts;');
  sqlite.exec('DELETE FROM app_profile;');
}

function seedProfile() {
  const id = randomUUID();
  db.insert(schema.appProfile)
    .values({
      id,
      displayName: 'Test User',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
}

function seedAccount() {
  const id = randomUUID();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
}

function seedSettings() {
  const id = randomUUID();
  db.insert(schema.settings)
    .values({
      id,
      startingAccountValue: 10000,
      journalStartDate: '2025-01-01',
      currency: 'USD',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
}

function seedSetupDefinition() {
  const id = randomUUID();
  db.insert(schema.setupDefinitions)
    .values({
      id,
      name: 'Breakout',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
}

// ── Tests ───────────────────────────────────────────────────────────

describe('GET /api/readiness', () => {
  beforeEach(() => {
    cleanup();
  });

  it('returns ready: false with 4 missing on empty DB', () => {
    const result = doGetReadiness();
    expect(result.status).toBe(200);
    const data = result.data as { ready: boolean; missing: { id: string }[] };
    expect(data.ready).toBe(false);
    expect(data.missing).toHaveLength(4);
    expect(data.missing[0].id).toBe('app_profile');
    expect(data.missing[1].id).toBe('settings');
    expect(data.missing[2].id).toBe('accounts');
    expect(data.missing[3].id).toBe('setups');
  });

  it('returns ready: true with 0 missing on complete DB', () => {
    seedProfile();
    seedAccount();
    seedSettings();
    seedSetupDefinition();

    const result = doGetReadiness();
    expect(result.status).toBe(200);
    const data = result.data as { ready: boolean; missing: unknown[] };
    expect(data.ready).toBe(true);
    expect(data.missing).toHaveLength(0);
  });

  it('returns ready: false with 3 missing when only profile is seeded', () => {
    seedProfile();

    const result = doGetReadiness();
    expect(result.status).toBe(200);
    const data = result.data as { ready: boolean; missing: { id: string }[] };
    expect(data.ready).toBe(false);
    expect(data.missing).toHaveLength(3);
    expect(data.missing[0].id).toBe('settings');
    expect(data.missing[1].id).toBe('accounts');
    expect(data.missing[2].id).toBe('setups');
  });

  it('returns 500 when database has no tables', () => {
    const badSqlite = new Database(':memory:');
    const badDb = drizzle(badSqlite, { schema });

    const result = doGetReadiness(badDb);
    expect(result.status).toBe(500);
    const data = result.data as { error: string; details: string };
    expect(data.error).toBe('Failed to check readiness');
    expect(data.details).toBeDefined();
    expect(typeof data.details).toBe('string');
  });
});
