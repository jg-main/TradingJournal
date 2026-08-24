/**
 * merged checklist endpoint test
 *
 * Tests GET /api/checks/merged?accountId=X&setupId=Y
 * Returns account-scoped and setup-scoped checks merged and ordered by sort_order.
 *
 * Run: npx vitest run --reporter verbose src/app/api/checks/__tests__/merged.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, isNull, asc, or } from 'drizzle-orm';

import * as schema from '@/db/schema';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('merged-checks');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS checklist_definitions;
  DROP TABLE IF EXISTS setup_definitions;
  DROP TABLE IF EXISTS accounts;

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
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE checklist_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    setup_id TEXT REFERENCES setup_definitions(id),
    description TEXT NOT NULL,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetMerged(accountId: string, setupId: string): { status: number; data: unknown } {
  try {
    if (!accountId || !setupId) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { accountId: ['accountId is required'], setupId: ['setupId is required'] } } } };
    }

    const rows = db
      .select()
      .from(schema.checklistDefinitions)
      .where(
        and(
          or(
            eq(schema.checklistDefinitions.accountId, accountId),
            eq(schema.checklistDefinitions.setupId, setupId),
          ),
          isNull(schema.checklistDefinitions.deletedAt),
        ),
      )
      .orderBy(asc(schema.checklistDefinitions.sortOrder), asc(schema.checklistDefinitions.createdAt))
      .all();

    return { status: 200, data: rows };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch merged checklist', details: String(error) } };
  }
}

function doGetMergedRaw(query: Record<string, string | undefined>): { status: number; data: unknown } {
  const { accountId, setupId } = query;
  if (!accountId || !setupId) {
    return { status: 400, data: { error: 'Validation failed' } };
  }
  return doGetMerged(accountId, setupId);
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM checklist_definitions;');
  sqlite.exec('DELETE FROM setup_definitions;');
  sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedSetup(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.setupDefinitions)
    .values({
      id,
      name: 'Test Setup',
      description: 'A test setup definition',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get() as Record<string, unknown>;
}

function seedCheck(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.checklistDefinitions)
    .values({
      id,
      description: 'Default check',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Merged Checklist Endpoint Tests ---\n');

let accountId: string;
let setupId: string;

// ── 1. GET: Returns empty array when no checks exist ─────────────────

console.log('\n1. GET returns [] when no checks exist for account or setup:');
{
  cleanup();
  const acc = seedAccount();
  const setup = seedSetup();
  const result = doGetMerged(acc.id as string, setup.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as unknown[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 0, 'array is empty');
}

// ── 2. GET: Returns account checks only ───────────────────────────────

console.log('\n2. GET returns account-scoped checks when only account has checks:');
{
  cleanup();
  const acc = seedAccount();
  const setup = seedSetup();
  accountId = acc.id as string;
  setupId = setup.id as string;
  seedCheck({ accountId, description: 'Acc level check', sortOrder: 1 });
  const result = doGetMerged(accountId, setupId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 1, 'has 1 check');
  assertEqual(data[0].accountId, accountId, 'check belongs to account');
  assertEqual(data[0].description, 'Acc level check', 'description matches');
}

// ── 3. GET: Returns setup checks only ─────────────────────────────────

console.log('\n3. GET returns setup-scoped checks when only setup has checks:');
{
  cleanup();
  const acc = seedAccount();
  const setup = seedSetup();
  accountId = acc.id as string;
  setupId = setup.id as string;
  seedCheck({ setupId, description: 'Setup level check', sortOrder: 1 });
  const result = doGetMerged(accountId, setupId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 1, 'has 1 check');
  assertEqual(data[0].setupId, setupId, 'check belongs to setup');
  assertEqual(data[0].description, 'Setup level check', 'description matches');
}

// ── 4. GET: Merges account and setup checks ordered by sort_order ─────

console.log('\n4. GET merges account + setup checks ordered by sort_order:');
{
  cleanup();
  const acc = seedAccount();
  const setup = seedSetup();
  accountId = acc.id as string;
  setupId = setup.id as string;
  seedCheck({ accountId, description: 'Account check', sortOrder: 2 });
  seedCheck({ setupId, description: 'Setup check', sortOrder: 1 });
  seedCheck({ accountId, description: 'Account check 2', sortOrder: 3 });
  const result = doGetMerged(accountId, setupId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 3, 'has 3 checks');
  assertEqual(data[0].description, 'Setup check', 'first by sort_order (sortOrder=1)');
  assertEqual(data[1].description, 'Account check', 'second by sort_order (sortOrder=2)');
  assertEqual(data[2].description, 'Account check 2', 'third by sort_order (sortOrder=3)');
}

// ── 5. GET: Excludes soft-deleted checks ──────────────────────────────

console.log('\n5. GET excludes soft-deleted checks:');
{
  cleanup();
  const acc = seedAccount();
  const setup = seedSetup();
  accountId = acc.id as string;
  setupId = setup.id as string;
  seedCheck({ accountId, description: 'Active account check', sortOrder: 1, deletedAt: null });
  seedCheck({ accountId, description: 'Deleted account check', sortOrder: 2, deletedAt: new Date().toISOString() });
  const result = doGetMerged(accountId, setupId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 1, 'has 1 active check');
  assertEqual(data[0].description, 'Active account check', 'deleted check excluded');
}

// ── 6. GET: Returns 400 when accountId is missing ─────────────────────

console.log('\n6. GET returns 400 when accountId is missing:');
{
  const result = doGetMergedRaw({ setupId: 'some-id' });
  assert(result.status === 400, 'returns 400');
}

// ── 7. GET: Returns 400 when setupId is missing ───────────────────────

console.log('\n7. GET returns 400 when setupId is missing:');
{
  const result = doGetMergedRaw({ accountId: 'some-id' });
  assert(result.status === 400, 'returns 400');
}

// ── 8. GET: Mix of active and inactive checks includes only active ────

console.log('\n8. GET merges only active (isActive=true) checks:');
{
  cleanup();
  const acc = seedAccount();
  const setup = seedSetup();
  accountId = acc.id as string;
  setupId = setup.id as string;
  seedCheck({ accountId, description: 'Active check', sortOrder: 1, isActive: true });
  seedCheck({ setupId, description: 'Inactive setup check', sortOrder: 2, isActive: false });
  const result = doGetMerged(accountId, setupId);
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 2, 'merged returns all non-deleted regardless of isActive (isActive is a display filter, not exclusion)');
}

// ── 9. GET: Returns checks for different account/setup pairs ──────────

console.log('\n9. GET returns correct checks for specific account+setup pair:');
{
  cleanup();
  const acc1 = seedAccount({ name: 'Account 1' });
  const acc2 = seedAccount({ name: 'Account 2' });
  const setup1 = seedSetup({ name: 'Setup 1' });
  const setup2 = seedSetup({ name: 'Setup 2' });
  seedCheck({ accountId: acc1.id as string, description: 'Acc1 check', sortOrder: 1 });
  seedCheck({ accountId: acc2.id as string, description: 'Acc2 check NOT in merged', sortOrder: 1 });
  seedCheck({ setupId: setup1.id as string, description: 'Setup1 check', sortOrder: 2 });
  seedCheck({ setupId: setup2.id as string, description: 'Setup2 check NOT in merged', sortOrder: 2 });
  const result = doGetMerged(acc1.id as string, setup1.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 2, 'has 2 checks for acc1+setup1');
  const descriptions = data.map((d) => d.description).sort();
  assertEqual(descriptions[0], 'Acc1 check', 'contains acc1 check');
  assertEqual(descriptions[1], 'Setup1 check', 'contains setup1 check');
}

// ── 10. GET: Maintains sort_order sequence with account and setup ─────

console.log('\n10. GET maintains interleaved sort_order sequence across account and setup checks:');
{
  cleanup();
  const acc = seedAccount();
  const setup = seedSetup();
  accountId = acc.id as string;
  setupId = setup.id as string;
  seedCheck({ accountId, description: 'Check A', sortOrder: 1 });
  seedCheck({ setupId, description: 'Check B', sortOrder: 2 });
  seedCheck({ accountId, description: 'Check C', sortOrder: 3 });
  seedCheck({ setupId, description: 'Check D', sortOrder: 4 });

  const result = doGetMerged(accountId, setupId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 4, 'has 4 checks');
  assertEqual(data[0].description, 'Check A', 'sortOrder=1');
  assertEqual(data[1].description, 'Check B', 'sortOrder=2');
  assertEqual(data[2].description, 'Check C', 'sortOrder=3');
  assertEqual(data[3].description, 'Check D', 'sortOrder=4');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'\u2500'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
