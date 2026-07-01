/**
 * trade stop-adjustments route test
 *
 * Tests GET (list by tradeId) and POST (create with validation).
 *
 * Run: npx vitest run --reporter verbose src/app/api/trades/\[id\]/stop-adjustments/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

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

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-stop-adjustments.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL,
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    opened_at TEXT,
    closed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_stop_adjustments (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    adjusted_at TEXT,
    previous_stop REAL,
    new_stop REAL,
    reason TEXT,
    rule_based INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetStopAdjustments(tradeId: string): { status: number; data: unknown } {
  try {
    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const adjustments = db
      .select()
      .from(schema.tradeStopAdjustments)
      .where(eq(schema.tradeStopAdjustments.tradeId, tradeId))
      .orderBy(schema.tradeStopAdjustments.adjustedAt, schema.tradeStopAdjustments.createdAt)
      .all();

    return { status: 200, data: adjustments };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch stop adjustments', details: String(error) } };
  }
}

function doPostStopAdjustment(tradeId: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const previousStop = body.previousStop;
    if (typeof previousStop !== 'number' || previousStop <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { previousStop: ['Previous stop must be positive'] } } } };
    }

    const newStop = body.newStop;
    if (typeof newStop !== 'number' || newStop <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { newStop: ['New stop must be positive'] } } } };
    }

    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const adjustmentId = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.tradeStopAdjustments)
      .values({
        id: adjustmentId,
        tradeId,
        previousStop: previousStop as number,
        newStop: newStop as number,
        adjustedAt: (body.adjustedAt as string) ?? now,
        reason: (body.reason as string) ?? null,
        ruleBased: (body.ruleBased as boolean | null) ?? null,
        notes: (body.notes as string) ?? null,
        createdAt: now,
      })
      .run();

    const created = db
      .select()
      .from(schema.tradeStopAdjustments)
      .where(eq(schema.tradeStopAdjustments.id, adjustmentId))
      .get();

    return { status: 201, data: created };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create stop adjustment', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_stop_adjustments;');
  sqlite.exec('DELETE FROM trades;');
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

function seedTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `T-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      accountId: 'test-account-id',
      symbol: 'AAPL',
      direction: 'long',
      status: 'planned',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedStopAdjustment(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.tradeStopAdjustments)
    .values({
      id,
      tradeId,
      previousStop: 145.0,
      newStop: 147.0,
      adjustedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.tradeStopAdjustments).where(eq(schema.tradeStopAdjustments.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trade Stop Adjustments API Tests ---\n');

// ── 1. GET: Returns empty list for trade with no adjustments ────────

console.log('\n1. GET returns empty list for trade with no adjustments:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doGetStopAdjustments(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as unknown[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 0, 'array is empty');
}

// ── 2. GET: 404 for nonexistent trade ───────────────────────────────

console.log('\n2. GET returns 404 for nonexistent trade:');
{
  cleanup();
  const result = doGetStopAdjustments('nonexistent-trade');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 3. GET: Returns adjustments ordered by adjustedAt ───────────────

console.log('\n3. GET returns adjustments ordered by adjustedAt:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const adj1 = seedStopAdjustment(trade.id as string, { previousStop: 145.0, newStop: 147.0, adjustedAt: '2025-06-01T10:00:00Z' });
  const adj2 = seedStopAdjustment(trade.id as string, { previousStop: 147.0, newStop: 149.0, adjustedAt: '2025-06-02T10:00:00Z' });

  const result = doGetStopAdjustments(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 2, 'returns 2 adjustments');
  assertEqual(data[0].id, adj1.id, 'first adjustment is earliest');
  assertEqual(data[1].id, adj2.id, 'second adjustment is later');
  assertEqual(data[0].previousStop, 145.0, 'first previousStop matches');
  assertEqual(data[0].newStop, 147.0, 'first newStop matches');
  assertEqual(data[1].previousStop, 147.0, 'second previousStop matches');
  assertEqual(data[1].newStop, 149.0, 'second newStop matches');
}

// ── 4. POST: Creates stop adjustment with valid data ────────────────

console.log('\n4. POST creates stop adjustment with valid data:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostStopAdjustment(trade.id as string, {
    previousStop: 145.0,
    newStop: 147.50,
    reason: 'Trailing stop adjustment',
    ruleBased: true,
    notes: 'Adjusted after 2R move',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.previousStop, 145.0, 'previousStop matches');
  assertEqual(data.newStop, 147.50, 'newStop matches');
  assertEqual(data.reason, 'Trailing stop adjustment', 'reason matches');
  assertEqual(data.ruleBased, true, 'ruleBased matches');
  assertEqual(data.notes, 'Adjusted after 2R move', 'notes matches');
  assertEqual(data.tradeId, trade.id, 'tradeId matches');
  assertNotNull(data.adjustedAt, 'has adjustedAt');
  assertNotNull(data.createdAt, 'has createdAt');
}

// ── 5. POST: Creates stop adjustment with optional fields omitted ───

console.log('\n5. POST creates stop adjustment with only required fields:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostStopAdjustment(trade.id as string, {
    previousStop: 145.0,
    newStop: 147.0,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.previousStop, 145.0, 'previousStop matches');
  assertEqual(data.newStop, 147.0, 'newStop matches');
  assertEqual(data.reason, null, 'reason defaults to null');
  assertEqual(data.ruleBased, null, 'ruleBased defaults to null');
  assertEqual(data.notes, null, 'notes defaults to null');
  assertNotNull(data.adjustedAt, 'adjustedAt defaults to now');
}

// ── 6. POST: Validates previousStop positive ────────────────────────

console.log('\n6. POST returns 400 for non-positive previousStop:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostStopAdjustment(trade.id as string, {
    previousStop: -10,
    newStop: 150.0,
  });

  assert(result.status === 400, 'returns 400 for negative previousStop');

  const result2 = doPostStopAdjustment(trade.id as string, {
    previousStop: 0,
    newStop: 150.0,
  });

  assert(result2.status === 400, 'returns 400 for zero previousStop');
}

// ── 7. POST: Validates newStop positive ─────────────────────────────

console.log('\n7. POST returns 400 for non-positive newStop:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostStopAdjustment(trade.id as string, {
    previousStop: 145.0,
    newStop: 0,
  });

  assert(result.status === 400, 'returns 400 for zero newStop');
}

// ── 8. POST: 404 for nonexistent trade ──────────────────────────────

console.log('\n8. POST returns 404 for nonexistent trade:');
{
  cleanup();
  const result = doPostStopAdjustment('nonexistent-trade', {
    previousStop: 145.0,
    newStop: 147.0,
  });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 9. POST: Accepts nullable optional fields ───────────────────────

console.log('\n9. POST accepts explicit null for optional fields:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostStopAdjustment(trade.id as string, {
    previousStop: 145.0,
    newStop: 147.0,
    adjustedAt: null,
    reason: null,
    ruleBased: null,
    notes: null,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  // adjustedAt will default to "now" because we use ?? now in the simulate
  assertNotNull(data.adjustedAt, 'adjustedAt defaults when null passed');
  assertEqual(data.reason, null, 'reason is null');
  assertEqual(data.ruleBased, null, 'ruleBased is null');
  assertEqual(data.notes, null, 'notes is null');
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
