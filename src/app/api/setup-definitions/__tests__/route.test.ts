/**
 * setup-definitions route test
 *
 * Tests POST (create with dual-write), GET (list), GET (single by ID),
 * PUT (update with lookup sync, inactive-edit guard), DELETE (hard-delete with trade check).
 *
 * Run: DB_FILE_NAME=./.test-setups.db npx tsx src/app/api/setup-definitions/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc } from 'drizzle-orm';

import * as schema from '@/db/schema';

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

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — value is null/undefined (FAILED)`);
  }
}

function assertNull(value: unknown, msg: string) {
  if (value === null || value === undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected null, got ${JSON.stringify(value)} (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('setups');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS setup_definitions (
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

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long','short')),
    setup_id TEXT REFERENCES lookup_values(id),
    status TEXT NOT NULL CHECK(status IN ('planned','open','closed','deleted')),
    entry_price REAL,
    exit_price REAL,
    quantity REAL,
    planned_quantity REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
  );
`);

// ── Simulated route logic ──────────────────────────────────────────

function doGetSetups(includeInactive = false): { status: number; data: unknown } {
  try {
    if (includeInactive) {
      const rows = db.select().from(schema.setupDefinitions).orderBy(desc(schema.setupDefinitions.createdAt)).all();
      return { status: 200, data: { data: rows } };
    }
    const rows = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.isActive, true)).orderBy(desc(schema.setupDefinitions.createdAt)).all();
    return { status: 200, data: { data: rows } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch setup definitions', details: String(error) } };
  }
}

function doGetSetupById(id: string): { status: number; data: unknown } {
  try {
    const row = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get();
    if (!row) {
      return { status: 404, data: { error: 'Setup definition not found' } };
    }
    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch setup definition', details: String(error) } };
  }
}

function doPostSetup(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    const name = body.name;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { name: ['Name is required'] } } } };
    }

    // Check duplicate
    const existing = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.name, name as string)).get();
    if (existing) {
      return { status: 409, data: { error: 'Validation failed', details: { fieldErrors: { name: ['A setup with this name already exists'] } } } };
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.setupDefinitions)
      .values({
        id,
        name: name as string,
        description: (body.description as string) ?? null,
        howToPlay: (body.howToPlay as string) ?? null,
        entryRules: (body.entryRules as string) ?? null,
        exitRules: (body.exitRules as string) ?? null,
        tags: (body.tags as string) ?? null,
        defaultRiskPct: (body.defaultRiskPct as number) ?? null,
        positionSizingRules: (body.positionSizingRules as string) ?? null,
        chartPatterns: (body.chartPatterns as string) ?? null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Dual-write to lookupValues
    db.insert(schema.lookupValues)
      .values({
        id,
        type: 'setup',
        value: (name as string).toLowerCase(),
        description: (body.description as string) ?? null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get();
    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create setup definition', details: String(error) } };
  }
}

function doPutSetup(id: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    const existing = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get();
    if (!existing) {
      return { status: 404, data: { error: 'Setup definition not found' } };
    }

    const now = new Date().toISOString();

    // Inactive plays cannot be edited (only reactivated)
    const existingRecord = existing as Record<string, unknown>;
    if (!existingRecord.isActive) {
      const nonActiveFields = Object.keys(body).filter(k => k !== 'isActive');
      if (nonActiveFields.length > 0) {
        return { status: 400, data: { error: 'Inactive plays cannot be edited. Only reactivation is allowed.' } };
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: now };

    const stringFields = ['name', 'description', 'howToPlay', 'entryRules', 'exitRules', 'tags', 'positionSizingRules', 'chartPatterns'] as const;
    for (const field of stringFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }
    if (body.defaultRiskPct !== undefined) updateData.defaultRiskPct = body.defaultRiskPct;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    if (body.name !== undefined && body.name !== (existing as Record<string, unknown>).name) {
      const dup = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.name, body.name as string)).get();
      if (dup) {
        return { status: 409, data: { error: 'Validation failed', details: { fieldErrors: { name: ['A setup with this name already exists'] } } } };
      }
    }

    db.update(schema.setupDefinitions)
      .set(updateData)
      .where(eq(schema.setupDefinitions.id, id))
      .run();

    // Sync lookupValues
    const lookupUpdate: Record<string, unknown> = { updatedAt: now };
    if (body.name !== undefined) lookupUpdate.value = (body.name as string).toLowerCase();
    if (body.description !== undefined) lookupUpdate.description = body.description;
    if (body.isActive !== undefined) lookupUpdate.isActive = body.isActive;

    if (Object.keys(lookupUpdate).length > 1) {
      db.update(schema.lookupValues)
        .set(lookupUpdate)
        .where(eq(schema.lookupValues.id, id))
        .run();
    }

    const row = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get();
    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update setup definition', details: String(error) } };
  }
}

function doDeleteSetup(id: string): { status: number; data: unknown } {
  try {
    const existing = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get();
    if (!existing) {
      return { status: 404, data: { error: 'Setup definition not found' } };
    }

    // Check if any trades reference this setup
    const linkedTrades = db.select({ id: schema.trades.id }).from(schema.trades).where(eq(schema.trades.setupId, id)).all();
    if (linkedTrades.length > 0) {
      return { status: 409, data: { error: 'Cannot delete this play because it is linked to ' + linkedTrades.length + ' trade(s). Deactivate it instead to hide it from new trades.', tradeCount: linkedTrades.length } };
    }

    // Hard delete
    db.delete(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).run();
    db.delete(schema.lookupValues).where(eq(schema.lookupValues.id, id)).run();

    return { status: 200, data: { message: 'Setup definition permanently deleted' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to delete setup definition', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trades; DELETE FROM setup_definitions; DELETE FROM lookup_values; DELETE FROM accounts;');
}

function seedSetup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const values: Partial<typeof schema.setupDefinitions.$inferInsert> = {
    id,
    name: 'Test Setup',
    description: null,
    howToPlay: null,
    entryRules: null,
    exitRules: null,
    tags: null,
    defaultRiskPct: null,
    positionSizingRules: null,
    chartPatterns: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  db.insert(schema.setupDefinitions)
    .values(values as typeof schema.setupDefinitions.$inferInsert)
    .run();

  // Also seed the corresponding lookupValue
  db.insert(schema.lookupValues)
    .values({
      id,
      type: 'setup',
      value: (values.name as string).toLowerCase(),
      description: values.description as string | null,
      isActive: values.isActive as boolean,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Setup Definitions API Tests ---\n');

// ── 1. GET: Empty list ──────────────────────────────────────────────

console.log('\n1. GET returns [] when no setups:');
{
  cleanup();
  const result = doGetSetups();
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: unknown[] };
  assert(Array.isArray(body.data), 'response has data array');
  assertEqual(body.data.length, 0, 'data is empty');
}

// ── 2. GET: List active setups ───────────────────────────────────────

console.log('\n2. GET returns only active setups:');
{
  cleanup();
  seedSetup({ name: 'Active Setup A' });
  seedSetup({ name: 'Active Setup B' });
  seedSetup({ name: 'Inactive Setup', isActive: false });

  const result = doGetSetups();
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: Record<string, unknown>[] };
  assertEqual(body.data.length, 2, 'only 2 active setups returned');
  assertEqual(body.data[0].name, 'Active Setup B', 'first active setup (newest first)');
}

// ── 3. GET: Include inactive ─────────────────────────────────────────

console.log('\n3. GET with includeInactive=true returns all:');
{
  cleanup();
  seedSetup({ name: 'Setup Alpha' });
  seedSetup({ name: 'Setup Beta', isActive: false });

  const result = doGetSetups(true);
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: Record<string, unknown>[] };
  assertEqual(body.data.length, 2, 'both setups returned');
}

// ── 4. POST: Create with full metadata ───────────────────────────────

console.log('\n4. POST creates with full metadata and dual-writes to lookupValues:');
{
  cleanup();
  const result = doPostSetup({
    name: 'Breakout Pullback',
    description: 'A breakout that pulls back to support before continuing',
    howToPlay: 'Wait for pullback to 20ema after breakout',
    entryRules: 'Enter on touch of 20ema with confirmation',
    exitRules: 'Exit on 20ema break or target hit',
    tags: '["breakout","pullback","trend"]',
    defaultRiskPct: 1.5,
    positionSizingRules: 'Risk 1% of account',
    chartPatterns: 'Flag, Pennant',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.name, 'Breakout Pullback', 'name matches');
  assertEqual(data.description, 'A breakout that pulls back to support before continuing', 'description matches');
  assertEqual(data.howToPlay, 'Wait for pullback to 20ema after breakout', 'howToPlay matches');
  assertEqual(data.entryRules, 'Enter on touch of 20ema with confirmation', 'entryRules matches');
  assertEqual(data.exitRules, 'Exit on 20ema break or target hit', 'exitRules matches');
  assertEqual(data.tags, '["breakout","pullback","trend"]', 'tags matches');
  assertEqual(data.defaultRiskPct, 1.5, 'defaultRiskPct matches');
  assertEqual(data.isActive, true, 'isActive defaults to true');

  // Verify dual-write to lookupValues
  const lookup = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, data.id as string)).get();
  assertNotNull(lookup, 'lookupValues entry exists');
  assertEqual(lookup!.type, 'setup', 'lookup type is setup');
  assertEqual(lookup!.value, 'breakout pullback', 'lookup value is lowercased name');
}

// ── 5. POST: Create minimal ──────────────────────────────────────────

console.log('\n5. POST creates with name only:');
{
  cleanup();
  const result = doPostSetup({ name: 'Minimal' });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.name, 'Minimal', 'name matches');
  assertNull(data.description, 'description is null');
  assertNull(data.defaultRiskPct, 'defaultRiskPct is null');
  assertEqual(data.isActive, true, 'isActive defaults to true');
}

// ── 6. POST: Duplicate name ──────────────────────────────────────────

console.log('\n6. POST returns 409 for duplicate name:');
{
  cleanup();
  doPostSetup({ name: 'Duplicate' });
  const result = doPostSetup({ name: 'Duplicate' });
  assert(result.status === 409, 'returns 409');
}

// ── 7. POST: Missing name ────────────────────────────────────────────

console.log('\n7. POST returns 400 for missing name:');
{
  cleanup();
  const result = doPostSetup({ description: 'No name provided' });
  assert(result.status === 400, 'returns 400');
}

// ── 8. GET by ID: Existing setup ─────────────────────────────────────

console.log('\n8. GET by ID returns existing setup:');
{
  cleanup();
  const seed = seedSetup({
    name: 'ByID Test',
    description: 'Test description for by-id lookup',
  });
  const result = doGetSetupById(seed.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.name, 'ByID Test', 'name matches');
  assertEqual(data.description, 'Test description for by-id lookup', 'description matches');
}

// ── 9. GET by ID: Unknown ID ─────────────────────────────────────────

console.log('\n9. GET by ID returns 404 for unknown:');
{
  cleanup();
  const result = doGetSetupById(randomUUID());
  assert(result.status === 404, 'returns 404');
}

// ── 10. PUT: Update metadata ─────────────────────────────────────────

console.log('\n10. PUT updates setup metadata and syncs lookupValues:');
{
  cleanup();
  const seed = seedSetup({ name: 'Original Name', description: 'Original' });
  const result = doPutSetup(seed.id as string, {
    name: 'Updated Name',
    description: 'Updated description',
    defaultRiskPct: 2.0,
    tags: '["updated"]',
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.name, 'Updated Name', 'name updated');
  assertEqual(data.description, 'Updated description', 'description updated');
  assertEqual(data.defaultRiskPct, 2.0, 'defaultRiskPct updated');
  assertEqual(data.tags, '["updated"]', 'tags updated');

  // Verify lookupValues sync
  const lookup = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, seed.id as string)).get();
  assertEqual(lookup!.value, 'updated name', 'lookup value synced');
  assertEqual(lookup!.description, 'Updated description', 'lookup description synced');
}

// ── 11. PUT: Duplicate name ──────────────────────────────────────────

console.log('\n11. PUT returns 409 for duplicate name:');
{
  cleanup();
  seedSetup({ name: 'Existing A' });
  const seedB = seedSetup({ name: 'Existing B' });
  const result = doPutSetup(seedB.id as string, { name: 'Existing A' });
  assert(result.status === 409, 'returns 409');
}

// ── 12. PUT: Unknown ID ──────────────────────────────────────────────

console.log('\n12. PUT returns 404 for unknown ID:');
{
  cleanup();
  const result = doPutSetup(randomUUID(), { name: 'Any' });
  assert(result.status === 404, 'returns 404');
}

// ── 13. DELETE: Hard-deletes setup when no trades reference it ─────────

console.log('\n13. DELETE hard-deletes setup from both tables when no trades reference it:');
{
  cleanup();
  const seed = seedSetup({ name: 'To Delete Permanently' });
  const result = doDeleteSetup(seed.id as string);
  assert(result.status === 200, 'returns 200');

  const row = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, seed.id as string)).get();
  assertNull(row, 'setupDefinitions row is gone');

  const lookup = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, seed.id as string)).get();
  assertNull(lookup, 'lookupValues row is gone');
}

// ── 14. DELETE: Unknown ID ───────────────────────────────────────────

console.log('\n14. DELETE returns 404 for unknown ID:');
{
  cleanup();
  const result = doDeleteSetup(randomUUID());
  assert(result.status === 404, 'returns 404');
}

// ── 15. PUT: Inactive setup reject edit ─────────────────────────────────

console.log('\n15. PUT on inactive setup with field changes returns 400:');
{
  cleanup();
  const seed = seedSetup({ name: 'Will Be Inactive', isActive: false });
  const result = doPutSetup(seed.id as string, { name: 'Should Not Work' });
  assert(result.status === 400, 'returns 400');
}

// ── 16. PUT: Inactive setup reactivate ──────────────────────────────────

console.log('\n16. PUT on inactive setup with isActive=true succeeds:');
{
  cleanup();
  const seed = seedSetup({ name: 'Sleepy Setup', isActive: false });
  const result = doPutSetup(seed.id as string, { isActive: true });
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.isActive, true, 'isActive set to true');

  // Verify lookupValues also updated
  const lookup = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, seed.id as string)).get();
  assertEqual(lookup!.isActive, true, 'lookupValues isActive synced to true');
}

// ── 17. DELETE: Setup linked to trades ──────────────────────────────────

console.log('\n17. DELETE on setup linked to trades returns 409:');
{
  cleanup();
  const seed = seedSetup({ name: 'Linked Setup' });

  // Create a trade that references this setup
  const accountId = randomUUID();
  const tradeId = randomUUID();
  const now = new Date().toISOString();

  sqlite.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').run(accountId, 'Test Account');
  sqlite.prepare('INSERT INTO trades (id, trade_code, account_id, symbol, direction, setup_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(tradeId, 'TC-001', accountId, 'AAPL', 'long', seed.id as string, 'closed', now, now);

  const result = doDeleteSetup(seed.id as string);
  assert(result.status === 409, 'returns 409');
  const data = result.data as { error: string; tradeCount: number };
  assert(data.tradeCount === 1, 'tradeCount is 1');

  // Verify the setup still exists (not deleted)
  const row = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, seed.id as string)).get();
  assertNotNull(row, 'setup still exists after failed delete');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
