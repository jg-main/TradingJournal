/**
 * trade by id route test
 *
 * Tests GET (by id), PUT (update), and DELETE (hard-delete) handlers.
 *
 * Run: npx vitest run --reporter verbose src/app/api/trades/\[id\]/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { calculatePnL } from '@/lib/trade-calc';
import type { ExecutionData, Direction } from '@/lib/trade-calc';

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

const DB_FILE = process.env.DB_FILE_NAME || './.test-trades-by-id.db';
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
  CREATE TABLE IF NOT EXISTS lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS watchlist_items (
    id TEXT PRIMARY KEY NOT NULL,
    date_added TEXT,
    symbol TEXT NOT NULL,
    sector_id TEXT,
    setup_id TEXT,
    direction TEXT NOT NULL,
    thesis TEXT,
    market_context TEXT,
    key_level REAL,
    trigger_price REAL,
    planned_stop REAL,
    target_price REAL,
    status TEXT NOT NULL,
    notes TEXT,
    promoted_trade_id TEXT,
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
  CREATE TABLE IF NOT EXISTS trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL,
    executed_at TEXT,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS watchlist_items (
    id TEXT PRIMARY KEY NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT DEFAULT 'watching',
    promoted_trade_id TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetTrade(id: string): { status: number; data: unknown } {
  try {
    const row = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, id))
      .get();

    if (!row) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    // Compute unrealized PnL for non-closed trades with a current price
    let unrealizedPnl: number | null = null;
    if (row.status !== 'closed' && row.currentPrice !== null && row.currentPrice !== undefined) {
      const executions = db
        .select()
        .from(schema.tradeExecutions)
        .where(eq(schema.tradeExecutions.tradeId, id))
        .all();

      if (executions.length > 0) {
        const executionData: ExecutionData[] = executions.map((e: Record<string, unknown>) => ({
          action: e.action as string,
          quantity: e.quantity as number,
          price: e.price as number,
          fees: (e.fees as number) ?? null,
          executedAt: e.executedAt as string,
        }));

        const direction = row.direction as Direction;
        const pnl = calculatePnL(executionData, direction);

        if (pnl.avgEntryPrice !== null && pnl.openQuantity > 0) {
          if (direction === 'long') {
            unrealizedPnl = (row.currentPrice - pnl.avgEntryPrice) * pnl.openQuantity;
          } else {
            unrealizedPnl = (pnl.avgEntryPrice - row.currentPrice) * pnl.openQuantity;
          }
        }
      }
    }

    return { status: 200, data: { ...row, unrealizedPnl } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch trade', details: String(error) } };
  }
}

function doPutTrade(id: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    const existing = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, id))
      .get();

    if (!existing) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    // Map 'setup' back to 'setupId' for the DB column
    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.setup !== undefined) {
      if (body.setup === null) {
        updateData.setupId = null;
      } else {
        const lowerValue = (body.setup as string).toLowerCase();
        const lookup = db
          .select()
          .from(schema.lookupValues)
          .where(and(eq(schema.lookupValues.type, 'setup'), eq(schema.lookupValues.value, lowerValue)))
          .get() as Record<string, unknown> | undefined;
        if (!lookup) {
          return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { setup: ['Unknown setup value'] } } } };
        }
        updateData.setupId = lookup.id;
      }
    }
    if (body.sectorId !== undefined) updateData.sectorId = body.sectorId;
    if (body.marketConditionId !== undefined) updateData.marketConditionId = body.marketConditionId;
    if (body.thesis !== undefined) updateData.thesis = body.thesis;
    if (body.plannedEntry !== undefined) updateData.plannedEntry = body.plannedEntry;
    if (body.plannedStop !== undefined) updateData.plannedStop = body.plannedStop;
    if (body.plannedTarget1 !== undefined) updateData.plannedTarget1 = body.plannedTarget1;
    if (body.plannedQuantity !== undefined) updateData.plannedQuantity = body.plannedQuantity;
    if (body.invalidationCondition !== undefined) updateData.invalidationCondition = body.invalidationCondition;
    if (body.preTradePlan !== undefined) updateData.preTradePlan = body.preTradePlan;

    db.update(schema.trades)
      .set(updateData)
      .where(eq(schema.trades.id, id))
      .run();

    const row = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, id))
      .get();

    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update trade', details: String(error) } };
  }
}

function doDeleteTrade(id: string): { status: number; data: unknown } {
  try {
    const existing = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, id))
      .get();

    if (!existing) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    // Hard delete: nullify watchlist FK references first, then delete
    db.update(schema.watchlistItems)
      .set({ promotedTradeId: null })
      .where(eq(schema.watchlistItems.promotedTradeId, id))
      .run();

    db.delete(schema.trades)
      .where(eq(schema.trades.id, id))
      .run();

    return { status: 200, data: { message: 'Trade deleted' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to delete trade', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM watchlist_items;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM lookup_values;');
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

function seedLookupValue(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.lookupValues)
    .values({
      id,
      type: 'setup',
      value: 'breakout',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get() as Record<string, unknown>;
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

function seedWatchlistItem(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.watchlistItems)
    .values({
      id,
      symbol: 'AAPL',
      direction: 'long',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trade By ID API Tests ---\n');

// ── 1. GET: Returns trade by id ─────────────────────────────────────

console.log('\n1. GET returns trade by id:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', thesis: 'My thesis' });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.id, trade.id, 'id matches');
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
  assertEqual(data.direction, 'long', 'direction matches');
  assertEqual(data.thesis, 'My thesis', 'thesis matches');
}

// ── 2. GET: 404 for nonexistent id ──────────────────────────────────

console.log('\n2. GET returns 404 for nonexistent id:');
{
  cleanup();
  const result = doGetTrade('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 3. PUT: Updates fields via spread ──────────────────────────────

console.log('\n3. PUT updates fields via spread:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', thesis: 'Old thesis' });

  const result = doPutTrade(trade.id as string, { thesis: 'Updated thesis' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.thesis, 'Updated thesis', 'thesis is updated');
  assertEqual(data.symbol, 'AAPL', 'symbol preserved');
  assertEqual(data.direction, 'long', 'direction preserved');
}

// ── 4. PUT: Resolves setup to setupId ──────────────────────────────

console.log('\n4. PUT resolves setup string to setupId:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const lookup = seedLookupValue({ type: 'setup', value: 'breakout' });
  const trade = seedTrade({ accountId: 'test-account-id', setupId: null });

  const result = doPutTrade(trade.id as string, { setup: 'breakout' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.setupId, lookup.id, 'setupId matches lookup id');
}

// ── 5. PUT: Validates unknown setup value ──────────────────────────

console.log('\n5. PUT returns 400 for unknown setup value:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPutTrade(trade.id as string, { setup: 'nonexistent-setup' });

  assert(result.status === 400, 'returns 400');
  const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
  assertNotNull(data.details, 'has details');
  assertNotNull(data.details.fieldErrors, 'has fieldErrors');
  assertNotNull(data.details.fieldErrors.setup, 'has setup field error');
}

// ── 6. PUT: 404 for nonexistent id ─────────────────────────────────

console.log('\n6. PUT returns 404 for nonexistent id:');
{
  cleanup();
  const result = doPutTrade('nonexistent-id', { thesis: 'Ghost' });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 7. DELETE: Hard-deletes trade permanently ───────────────────────

console.log('\n7. DELETE hard-deletes trade permanently from DB:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doDeleteTrade(trade.id as string);

  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'Trade deleted', 'message matches');

  // Verify DB: row no longer exists
  const updated = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown> | undefined;
  assert(updated === undefined, 'trade is permanently removed from DB');
}

// ── 8. DELETE: 404 for nonexistent id ──────────────────────────────

console.log('\n8. DELETE returns 404 for nonexistent id:');
{
  cleanup();
  const result = doDeleteTrade('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// 9. DELETE: Nullifies watchlist_items.promotedTradeId

console.log('\n9. DELETE nullifies watchlist promotedTradeId:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
  const wlItem = seedWatchlistItem({
    symbol: 'AAPL',
    direction: 'long',
    status: 'triggered',
    promotedTradeId: trade.id as string,
  });

  const result = doDeleteTrade(trade.id as string);
  assert(result.status === 204, 'returns 204');

  // Verify watchlist FK is nullified
  const wl = db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.id, wlItem.id as string)).get() as Record<string, unknown>;
  assertEqual(wl.promotedTradeId, null, 'promotedTradeId is null after trade delete');

  // Verify trade is gone
  const deleted = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get();
  assertEqual(deleted, undefined, 'trade row is removed from database');
}

// ── 10. GET: Returns plannedQuantity matching what was posted ───────

console.log('\n10. GET returns plannedQuantity matching what was posted:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', plannedQuantity: 100 });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.plannedQuantity, 100, 'plannedQuantity = 100 returned by GET');
}

// ── 11. PUT: Can clear plannedQuantity by sending null ───────────────

console.log('\n11. PUT clears plannedQuantity when sent null:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', plannedQuantity: 200 });

  const result = doPutTrade(trade.id as string, { plannedQuantity: null });
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.plannedQuantity, null, 'plannedQuantity is cleared to null');
}

// ── 12. GET: Returns currentPrice and currentPriceFetchedAt ──────────

console.log('\n12. GET returns currentPrice and currentPriceFetchedAt fields:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const now = new Date().toISOString();
  const trade = seedTrade({
    accountId: 'test-account-id',
    currentPrice: 155.50,
    currentPriceFetchedAt: now,
  });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currentPrice, 155.50, 'currentPrice matches seed');
  assertEqual(data.currentPriceFetchedAt, now, 'currentPriceFetchedAt matches seed');
}

// ── 13. GET: Returns null currentPrice fields when not set ──────────

console.log('\n13. GET returns null when no current_price set:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currentPrice, null, 'currentPrice is null');
  assertEqual(data.currentPriceFetchedAt, null, 'currentPriceFetchedAt is null');
  assertEqual(data.unrealizedPnl, null, 'unrealizedPnl is null when no current_price');
}

// ── 14. GET: Returns unrealizedPnl for open trade with executions ──

console.log('\n14. GET computes unrealizedPnl for open trade with executions:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    currentPrice: 160.00,
    currentPriceFetchedAt: new Date().toISOString(),
  });
  const tradeId = trade.id as string;

  db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action: 'buy',
    quantity: 100,
    price: 150.00,
    fees: 10,
    executedAt: new Date().toISOString(),
  }).run();

  const result = doGetTrade(tradeId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.unrealizedPnl, 'unrealizedPnl is not null');
  assertEqual(data.currentPrice, 160.00, 'currentPrice is 160');
  // unrealizedPnl = (160 - 150) * 100 = 1000 (fees subtracted from realized only)
  assertEqual(Math.round(data.unrealizedPnl as number), 1000, 'unrealizedPnl = (160-150)*100 = 1000');
}

// ── 15. GET: Returns null unrealizedPnl for closed trade with currentPrice ──

console.log('\n15. GET returns null unrealizedPnl for closed trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'closed',
    currentPrice: 170.00,
  });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currentPrice, 170.00, 'currentPrice is still returned');
  assertEqual(data.unrealizedPnl, null, 'unrealizedPnl is null for closed trade');
}

// ── 16. GET: Computes unrealizedPnl for short trade ─────────────────

console.log('\n16. GET computes unrealizedPnl for short trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'TSLA',
    direction: 'short',
    status: 'open',
    currentPrice: 250.00,
    currentPriceFetchedAt: new Date().toISOString(),
  });
  const tradeId = trade.id as string;

  db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action: 'sell_short',
    quantity: 50,
    price: 280.00,
    fees: 5,
    executedAt: new Date().toISOString(),
  }).run();

  const result = doGetTrade(tradeId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.unrealizedPnl, 'unrealizedPnl is not null for short trade');
  // short: unrealizedPnl = (avgEntryPrice - currentPrice) * openQuantity = (280 - 250) * 50 = 1500
  assertEqual(Math.round(data.unrealizedPnl as number), 1500, 'short unrealizedPnl = (280-250)*50 = 1500');
  assertEqual(data.currentPrice, 250.00, 'currentPrice is 250');
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
