/**
 * trade stop-adjustment by id route test
 *
 * Tests DELETE (deletes stop adjustment).
 *
 * Run: npx vitest run --reporter verbose src/app/api/trades/\[id\]/stop-adjustments/\[adjustmentId\]/__tests__/route.test.ts
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

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-stop-adjustment-by-id.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS watchlist_items;
  DROP TABLE IF EXISTS weekly_reviews;
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
    planned_quantity REAL,
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

function doDeleteStopAdjustment(tradeId: string, adjustmentId: string): { status: number; data: unknown } {
  try {
    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const adjustment = db
      .select()
      .from(schema.tradeStopAdjustments)
      .where(eq(schema.tradeStopAdjustments.id, adjustmentId))
      .get();

    if (!adjustment) {
      return { status: 404, data: { error: 'Stop adjustment not found' } };
    }

    db.delete(schema.tradeStopAdjustments)
      .where(eq(schema.tradeStopAdjustments.id, adjustmentId))
      .run();

    return { status: 200, data: { message: 'Stop adjustment deleted' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to delete stop adjustment', details: String(error) } };
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

console.log('\n--- Trade Stop Adjustment By ID API Tests ---\n');

// ── 1. DELETE: Deletes stop adjustment ─────────────────────────────

console.log('\n1. DELETE deletes stop adjustment:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });
  const adj = seedStopAdjustment(trade.id as string);

  const result = doDeleteStopAdjustment(trade.id as string, adj.id as string);

  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'Stop adjustment deleted', 'message matches');

  // Verify adjustment was removed
  const remaining = db
    .select()
    .from(schema.tradeStopAdjustments)
    .where(eq(schema.tradeStopAdjustments.tradeId, trade.id as string))
    .all();
  assertEqual(remaining.length, 0, 'no adjustments remain');
}

// ── 2. DELETE: 404 for nonexistent trade ────────────────────────────

console.log('\n2. DELETE returns 404 for nonexistent trade:');
{
  cleanup();
  const result = doDeleteStopAdjustment('nonexistent-trade', 'some-adj-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 3. DELETE: 404 for nonexistent adjustment ───────────────────────

console.log('\n3. DELETE returns 404 for nonexistent adjustment:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doDeleteStopAdjustment(trade.id as string, 'nonexistent-adj');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Stop adjustment not found', 'error message');
}

// ── 4. DELETE: Leaves other adjustments intact ──────────────────────

console.log('\n4. DELETE removes only the specified adjustment:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const adj1 = seedStopAdjustment(trade.id as string, { previousStop: 145.0, newStop: 147.0, adjustedAt: '2025-06-01T10:00:00Z' });
  const adj2 = seedStopAdjustment(trade.id as string, { previousStop: 147.0, newStop: 149.0, adjustedAt: '2025-06-02T10:00:00Z' });

  const result = doDeleteStopAdjustment(trade.id as string, adj1.id as string);

  assert(result.status === 200, 'returns 200');

  const remaining = db
    .select()
    .from(schema.tradeStopAdjustments)
    .where(eq(schema.tradeStopAdjustments.tradeId, trade.id as string))
    .all();
  assertEqual(remaining.length, 1, 'one adjustment remains');
  assertEqual(remaining[0].id, adj2.id, 'remaining adjustment is the correct one');
  assertEqual(remaining[0].newStop, 149.0, 'remaining adjustment has correct newStop');
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
