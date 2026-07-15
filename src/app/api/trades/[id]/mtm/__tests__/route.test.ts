/**
 * Trade MTM route test
 *
 * Tests GET /api/trades/[id]/mtm — latest price snapshot retrieval.
 *
 * Run: DB_FILE_NAME=./.test-mtm.db npx tsx src/app/api/trades/\[id\]/mtm/__tests__/route.test.ts
 */

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

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-mtm.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS position_price_snapshots;
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
  DROP TABLE IF EXISTS lookup_values;
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
    current_price REAL,
    current_price_fetched_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS position_price_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'yahoo',
    market_state TEXT,
    previous_close REAL,
    day_high REAL,
    day_low REAL,
    price_change REAL,
    change_percent REAL,
    fetched_at TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE INDEX IF NOT EXISTS idx_position_price_snapshots_trade_id_fetched_at
    ON position_price_snapshots(trade_id, fetched_at);
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetMtm(tradeId: string): { status: number; data: unknown } {
  try {
    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const snapshot = db
      .select({
        price: schema.positionPriceSnapshots.price,
        marketState: schema.positionPriceSnapshots.marketState,
        previousClose: schema.positionPriceSnapshots.previousClose,
        dayHigh: schema.positionPriceSnapshots.dayHigh,
        dayLow: schema.positionPriceSnapshots.dayLow,
        change: schema.positionPriceSnapshots.change,
        changePercent: schema.positionPriceSnapshots.changePercent,
        fetchedAt: schema.positionPriceSnapshots.fetchedAt,
        source: schema.positionPriceSnapshots.source,
      })
      .from(schema.positionPriceSnapshots)
      .where(eq(schema.positionPriceSnapshots.tradeId, tradeId))
      .orderBy(desc(schema.positionPriceSnapshots.fetchedAt))
      .limit(1)
      .get();

    if (!snapshot) {
      return {
        status: 200,
        data: {
          price: null,
          marketState: null,
          previousClose: null,
          dayHigh: null,
          dayLow: null,
          change: null,
          changePercent: null,
          fetchedAt: null,
          source: null,
          message: 'No price snapshot',
        },
      };
    }

    return {
      status: 200,
      data: {
        price: snapshot.price,
        marketState: snapshot.marketState,
        previousClose: snapshot.previousClose ?? null,
        dayHigh: snapshot.dayHigh ?? null,
        dayLow: snapshot.dayLow ?? null,
        change: snapshot.change ?? null,
        changePercent: snapshot.changePercent ?? null,
        fetchedAt: snapshot.fetchedAt,
        source: snapshot.source,
      },
    };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch MTM snapshot', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM position_price_snapshots;');
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
      status: 'open',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedSnapshot(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.positionPriceSnapshots)
    .values({
      id,
      tradeId,
      price: 155.50,
      source: 'yahoo',
      marketState: 'REGULAR',
      fetchedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return db
    .select()
    .from(schema.positionPriceSnapshots)
    .where(eq(schema.positionPriceSnapshots.id, id))
    .get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trade MTM API Tests ---\n');

// ── 1. Trade with existing snapshot → returns price, marketState, fetchedAt, source ─

console.log('\n1. Trade with existing snapshot:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });
  seedSnapshot(trade.id as string, { price: 155.50, source: 'yahoo', marketState: 'REGULAR' });

  const result = doGetMtm(trade.id as string);
  const data = result.data as Record<string, unknown>;

  assert(result.status === 200, 'returns 200');
  assertEqual(data.price, 155.50, 'price matches');
  assertEqual(data.source, 'yahoo', 'source matches');
  assertEqual(data.marketState, 'REGULAR', 'marketState matches');
  assertNotNull(data.fetchedAt, 'fetchedAt is present');
}

// ── 2. Trade with no snapshot → returns null fields with message ──────────

console.log('\n2. Trade with no snapshot:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doGetMtm(trade.id as string);
  const data = result.data as Record<string, unknown>;

  assert(result.status === 200, 'returns 200');
  assertEqual(data.price, null, 'price is null');
  assertEqual(data.marketState, null, 'marketState is null');
  assertEqual(data.fetchedAt, null, 'fetchedAt is null');
  assertEqual(data.source, null, 'source is null');
  assertEqual(data.message, 'No price snapshot', 'message is No price snapshot');
}

// ── 3. Non-existent trade → 404 ────────────────────────────────────────────

console.log('\n3. Non-existent trade:');
{
  cleanup();
  const result = doGetMtm('nonexistent-trade');
  const data = result.data as Record<string, unknown>;

  assert(result.status === 404, 'returns 404');
  assertEqual(data.error, 'Trade not found', 'error message');
}

// ── 4. Multiple snapshots → returns latest by fetched_at ────────────────────

console.log('\n4. Multiple snapshots returns latest:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  seedSnapshot(trade.id as string, { price: 150.00, source: 'yahoo', marketState: 'PRE_MARKET', fetchedAt: '2025-01-01T09:00:00Z' });
  seedSnapshot(trade.id as string, { price: 155.50, source: 'yahoo', marketState: 'REGULAR', fetchedAt: '2025-01-01T10:30:00Z' });
  seedSnapshot(trade.id as string, { price: 152.25, source: 'yahoo', marketState: 'REGULAR', fetchedAt: '2025-01-01T09:45:00Z' });

  const result = doGetMtm(trade.id as string);
  const data = result.data as Record<string, unknown>;

  assert(result.status === 200, 'returns 200');
  assertEqual(data.price, 155.50, 'returns latest price');
  assertEqual(data.marketState, 'REGULAR', 'returns latest marketState');
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
