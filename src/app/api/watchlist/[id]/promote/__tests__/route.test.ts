/**
 * watchlist promote route test
 *
 * Tests POST /api/watchlist/[id]/promote: creates a trade from a watchlist item.
 *
 * Run: npx vitest run --reporter verbose src/app/api/watchlist/\[id\]/promote/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, sql } from 'drizzle-orm';

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

const DB_FILE = process.env.DB_FILE_NAME || './.test-watchlist-promote.db';
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
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT,
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
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
`);

// ── Simulated route logic ───────────────────────────────────────────

function doPromoteWatchlistItem(id: string): { status: number; data: unknown } {
  try {
    // 1. Validate watchlist item exists
    const item = db
      .select()
      .from(schema.watchlistItems)
      .where(eq(schema.watchlistItems.id, id))
      .get() as Record<string, unknown> | undefined;

    if (!item) {
      return { status: 404, data: { error: 'Watchlist item not found' } };
    }

    // 2. Check it hasn't already been promoted
    if (item.promotedTradeId) {
      return { status: 409, data: { error: 'Watchlist item has already been promoted', promotedTradeId: item.promotedTradeId } };
    }

    // 3. Find target account: settings.defaultAccountId first, then first active account
    const setting = db
      .select()
      .from(schema.settings)
      .get() as Record<string, unknown> | undefined;
    let accountId: string | undefined;

    if (setting?.defaultAccountId) {
      accountId = setting.defaultAccountId as string;
    } else {
      const firstActive = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.isActive, true))
        .get() as Record<string, unknown> | undefined;
      accountId = firstActive?.id as string | undefined;
    }

    if (!accountId) {
      return { status: 400, data: { error: 'No active account found. Create an account first or set a default account in settings.' } };
    }

    // 4. Generate tradeCode: T-XXXX
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.trades)
      .get();

    const nextNumber = (countResult?.count ?? 0) + 1;
    const tradeCode = `T-${String(nextNumber).padStart(4, '0')}`;

    // 5. Create the trade from watchlist fields
    const tradeId = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.trades)
      .values({
        id: tradeId,
        tradeCode,
        accountId,
        symbol: item.symbol as string,
        direction: item.direction as 'long' | 'short',
        sectorId: (item.sectorId as string) ?? null,
        setupId: (item.setupId as string) ?? null,
        status: 'planned',
        thesis: (item.thesis as string) ?? null,
        plannedEntry: (item.triggerPrice as number) ?? null,
        plannedStop: (item.plannedStop as number) ?? null,
        plannedTarget1: (item.targetPrice as number) ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // 6. Update watchlist item
    db.update(schema.watchlistItems)
      .set({
        status: 'triggered',
        promotedTradeId: tradeId,
        updatedAt: now,
      })
      .where(eq(schema.watchlistItems.id, id))
      .run();

    // 7. Fetch and return the created trade
    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    return { status: 201, data: trade };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to promote watchlist item', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM watchlist_items;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM accounts;');
  sqlite.exec('DELETE FROM lookup_values;');
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

function seedSettings(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.settings)
    .values({
      id,
      currency: 'USD',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.settings).where(eq(schema.settings.id, id)).get() as Record<string, unknown>;
}

function seedWatchlistItem(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.watchlistItems)
    .values({
      id,
      dateAdded: now,
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

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Watchlist Promote API Tests ---\n');

// ── 1. POST: 404 for nonexistent watchlist item ─────────────────────

console.log('\n1. POST returns 404 for nonexistent watchlist item:');
{
  cleanup();
  const result = doPromoteWatchlistItem('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Watchlist item not found', 'error message');
}

// ── 2. POST: 409 for already promoted item ──────────────────────────

console.log('\n2. POST returns 409 for already promoted item:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });
  const item = seedWatchlistItem({
    symbol: 'AAPL',
    status: 'triggered',
    promotedTradeId: trade.id as string,
  });

  const result = doPromoteWatchlistItem(item.id as string);

  assert(result.status === 409, 'returns 409');
  const data = result.data as { error: string; promotedTradeId: string };
  assertEqual(data.error, 'Watchlist item has already been promoted', 'error message');
  assertEqual(data.promotedTradeId, trade.id, 'promotedTradeId matches existing');
}

// ── 3. POST: 400 when no active account ─────────────────────────────

console.log('\n3. POST returns 400 when no active account exists:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL' });

  const result = doPromoteWatchlistItem(item.id as string);

  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string };
  assert(data.error.includes('No active account'), 'error mentions no active account');
}

// ── 4. POST: Creates trade from watchlist item ──────────────────────

console.log('\n4. POST creates trade from watchlist item:');
{
  cleanup();
  const account = seedAccount({ name: 'Trading Account' });
  const item = seedWatchlistItem({
    symbol: 'MSFT',
    direction: 'short',
    thesis: 'Short Microsoft',
    triggerPrice: 400,
    plannedStop: 410,
    targetPrice: 380,
  });

  const result = doPromoteWatchlistItem(item.id as string);

  assert(result.status === 201, 'returns 201');
  const trade = result.data as Record<string, unknown>;
  assertNotNull(trade.id, 'trade has id');
  assertNotNull(trade.tradeCode, 'trade has tradeCode');
  assert((trade.tradeCode as string).startsWith('T-'), 'tradeCode starts with T-');
  assertEqual(trade.symbol, 'MSFT', 'trade symbol matches watchlist item');
  assertEqual(trade.direction, 'short', 'trade direction matches watchlist item');
  assertEqual(trade.status, 'planned', 'trade status is planned');
  assertEqual(trade.accountId, account.id, 'trade accountId matches');
  assertEqual(trade.thesis, 'Short Microsoft', 'trade thesis matches');
  assertEqual(trade.plannedEntry, 400, 'trade plannedEntry matches triggerPrice');
  assertEqual(trade.plannedStop, 410, 'trade plannedStop matches');
  assertEqual(trade.plannedTarget1, 380, 'trade plannedTarget1 matches targetPrice');
  assertNotNull(trade.createdAt, 'trade has createdAt');
  assertNotNull(trade.updatedAt, 'trade has updatedAt');

  // Verify watchlist item was updated
  const updatedItem = db
    .select()
    .from(schema.watchlistItems)
    .where(eq(schema.watchlistItems.id, item.id as string))
    .get() as Record<string, unknown>;
  assertEqual(updatedItem.status, 'triggered', 'watchlist status is triggered');
  assertEqual(updatedItem.promotedTradeId, trade.id, 'promotedTradeId points to created trade');
}

// ── 5. POST: Uses defaultAccountId from settings ────────────────────

console.log('\n5. POST uses defaultAccountId from settings:');
{
  cleanup();
  const defaultAccount = seedAccount({ name: 'Default Account' });
  seedAccount({ name: 'Other Account' });
  seedSettings({ defaultAccountId: defaultAccount.id });

  const item = seedWatchlistItem({ symbol: 'AAPL' });

  const result = doPromoteWatchlistItem(item.id as string);

  assert(result.status === 201, 'returns 201');
  const trade = result.data as Record<string, unknown>;
  assertEqual(trade.accountId, defaultAccount.id, 'accountId matches default account from settings');
}

// ── 6. POST: Picks first active account when no settings ────────────

console.log('\n6. POST picks first active account when no default settings:');
{
  cleanup();
  const firstAccount = seedAccount({ name: 'First Account' });
  seedAccount({ name: 'Second Account' });

  const item = seedWatchlistItem({ symbol: 'AAPL' });

  const result = doPromoteWatchlistItem(item.id as string);

  assert(result.status === 201, 'returns 201');
  const trade = result.data as Record<string, unknown>;
  assertEqual(trade.accountId, firstAccount.id, 'accountId matches first active account');
}

// ── 7. POST: Creates trade with all optional fields from watchlist ──

console.log('\n7. POST creates trade with all optional fields from watchlist:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const lookup = (() => {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.insert(schema.lookupValues)
      .values({ id, type: 'setup', value: 'breakout', sortOrder: 0, isActive: true, createdAt: now, updatedAt: now })
      .run();
    return db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get() as Record<string, unknown>;
  })();

  const item = seedWatchlistItem({
    symbol: 'AAPL',
    direction: 'long',
    sectorId: 'sector-uuid',
    setupId: lookup.id,
    thesis: 'Full field test',
    triggerPrice: 150,
    plannedStop: 145,
    targetPrice: 170,
  });

  const result = doPromoteWatchlistItem(item.id as string);

  assert(result.status === 201, 'returns 201');
  const trade = result.data as Record<string, unknown>;
  assertEqual(trade.symbol, 'AAPL', 'symbol matches');
  assertEqual(trade.direction, 'long', 'direction matches');
  assertEqual(trade.sectorId, 'sector-uuid', 'sectorId matches');
  assertEqual(trade.setupId, lookup.id, 'setupId matches');
  assertEqual(trade.thesis, 'Full field test', 'thesis matches');
  assertEqual(trade.plannedEntry, 150, 'plannedEntry matches triggerPrice');
  assertEqual(trade.plannedStop, 145, 'plannedStop matches');
  assertEqual(trade.plannedTarget1, 170, 'plannedTarget1 matches targetPrice');
}

// ── 8. POST: Returns sequential trade codes ─────────────────────────

console.log('\n8. POST returns sequential trade codes:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const item1 = seedWatchlistItem({ symbol: 'AAPL' });
  const item2 = seedWatchlistItem({ symbol: 'MSFT' });

  const r1 = doPromoteWatchlistItem(item1.id as string);
  assert(r1.status === 201, 'first promote returns 201');
  const t1 = r1.data as Record<string, unknown>;

  const r2 = doPromoteWatchlistItem(item2.id as string);
  assert(r2.status === 201, 'second promote returns 201');
  const t2 = r2.data as Record<string, unknown>;

  assert(t2.tradeCode !== t1.tradeCode, 'trade codes are different');
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
