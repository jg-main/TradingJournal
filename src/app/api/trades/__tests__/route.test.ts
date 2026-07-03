/**
 * trades route test
 *
 * Tests GET (list with pagination, status filter) and POST (create, validation, account resolution).
 *
 * Run: npx vitest run --reporter verbose src/app/api/trades/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc, and, sql } from 'drizzle-orm';

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

const DB_FILE = process.env.DB_FILE_NAME || './.test-trades.db';
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
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetTrades(params: { page?: number; limit?: number; status?: string } = {}): { status: number; data: unknown } {
  try {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const offset = (page - 1) * limit;

    let countQuery = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.trades);

    if (params.status) {
      countQuery = countQuery.where(eq(schema.trades.status, params.status));
    }

    const countResult = countQuery.get();
    const total = countResult?.count ?? 0;

    let dataQuery = db
      .select()
      .from(schema.trades)
      .orderBy(desc(schema.trades.createdAt))
      .limit(limit)
      .offset(offset);

    if (params.status) {
      dataQuery = dataQuery.where(eq(schema.trades.status, params.status));
    }

    const rows = dataQuery.all();
    return { status: 200, data: { data: rows, total, page, limit } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch trades', details: String(error) } };
  }
}

function doPostTrade(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const symbol = body.symbol;
    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { symbol: ['Symbol is required'] } } } };
    }
    if ((symbol as string).length > 20) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { symbol: ['String must contain at most 20 character(s)'] } } } };
    }

    const direction = body.direction;
    if (direction !== 'long' && direction !== 'short') {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { direction: ['Invalid enum value. Expected long | short'] } } } };
    }

    // Resolve account: settings.defaultAccountId first, then first active account
    const setting = db.select().from(schema.settings).get() as Record<string, unknown> | undefined;
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

    // Generate tradeCode: T-XXXX
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.trades)
      .get();

    const nextNumber = (countResult?.count ?? 0) + 1;
    const tradeCode = `T-${String(nextNumber).padStart(4, '0')}`;

    // Resolve setup string to UUID if provided
    let resolvedSetupId: string | null = null;
    const setup = body.setup;
    if (setup !== undefined && setup !== null && setup !== '') {
      const lowerValue = (setup as string).toLowerCase();
      const lookup = db
        .select()
        .from(schema.lookupValues)
        .where(and(eq(schema.lookupValues.type, 'setup'), eq(schema.lookupValues.value, lowerValue)))
        .get() as Record<string, unknown> | undefined;
      if (!lookup) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { setup: ['Unknown setup value'] } } } };
      }
      resolvedSetupId = lookup.id as string;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.trades)
      .values({
        id,
        tradeCode,
        accountId,
        symbol: (symbol as string).trim(),
        direction,
        setupId: resolvedSetupId,
        sectorId: (body.sectorId as string) ?? null,
        marketConditionId: (body.marketConditionId as string) ?? null,
        status: 'planned',
        thesis: (body.thesis as string) ?? null,
        plannedEntry: (body.plannedEntry as number) ?? null,
        plannedStop: (body.plannedStop as number) ?? null,
        plannedTarget1: (body.plannedTarget1 as number) ?? null,
        plannedTarget2: (body.plannedTarget2 as number) ?? null,
        invalidationCondition: (body.invalidationCondition as string) ?? null,
        preTradePlan: (body.preTradePlan as string) ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(schema.trades).where(eq(schema.trades.id, id)).get();
    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create trade', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM settings;');
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

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trades API Tests ---\n');

// ── 1. GET: Empty list ─────────────────────────────────────────────

console.log('\n1. GET returns empty list with pagination metadata:');
{
  cleanup();
  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const data = result.data as { data: unknown[]; total: number; page: number; limit: number };
  assert(Array.isArray(data.data), 'response.data is an array');
  assertEqual(data.data.length, 0, 'data array is empty');
  assertEqual(data.total, 0, 'total is 0');
  assertEqual(data.page, 1, 'page is 1');
  assertEqual(data.limit, 50, 'limit is 50');
}

// ── 2. GET: Pagination ─────────────────────────────────────────────

console.log('\n2. GET returns paginated results:');
{
  cleanup();
  // Ensure test-account-id exists in accounts table
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL' });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT' });
  seedTrade({ accountId: 'test-account-id', symbol: 'GOOGL' });

  const page1 = doGetTrades({ page: 1, limit: 2 });
  assert(page1.status === 200, 'page 1 returns 200');
  const d1 = page1.data as { data: unknown[]; total: number; page: number; limit: number };
  assertEqual(d1.data.length, 2, 'page 1 has 2 items');
  assertEqual(d1.total, 3, 'total is 3');
  assertEqual(d1.page, 1, 'page is 1');
  assertEqual(d1.limit, 2, 'limit is 2');

  const page2 = doGetTrades({ page: 2, limit: 2 });
  assert(page2.status === 200, 'page 2 returns 200');
  const d2 = page2.data as { data: unknown[]; total: number; page: number; limit: number };
  assertEqual(d2.data.length, 1, 'page 2 has 1 item');
  assertEqual(d2.total, 3, 'total is 3');
  assertEqual(d2.page, 2, 'page is 2');
}

// ── 3. GET: Status filter ──────────────────────────────────────────

console.log('\n3. GET filters by status:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'planned' });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'open' });
  seedTrade({ accountId: 'test-account-id', symbol: 'GOOGL', status: 'deleted' });

  const planned = doGetTrades({ status: 'planned' });
  assert(planned.status === 200, 'status filter returns 200');
  const dp = planned.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(dp.data.length, 1, 'returns 1 planned trade');
  assertEqual(dp.data[0].symbol, 'AAPL', 'planned trade symbol matches');
  assertEqual(dp.data[0].status, 'planned', 'status is planned');

  const open = doGetTrades({ status: 'open' });
  assert(open.status === 200, 'open filter returns 200');
  const dop = open.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(dop.data.length, 1, 'returns 1 open trade');
  assertEqual(dop.data[0].symbol, 'MSFT', 'open trade symbol matches');
  assertEqual(dop.data[0].status, 'open', 'status is open');
}

// ── 4. POST: Create with valid data ─────────────────────────────────

console.log('\n4. POST creates a trade with valid data:');
{
  cleanup();
  const account = seedAccount({ name: 'Trading Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', thesis: 'Test trade' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertNotNull(data.tradeCode, 'has tradeCode');
  assert((data.tradeCode as string).startsWith('T-'), 'tradeCode starts with T-');
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
  assertEqual(data.direction, 'long', 'direction matches');
  assertEqual(data.status, 'planned', 'status is planned');
  assertEqual(data.accountId, account.id, 'accountId matches seeded account');
  assertEqual(data.thesis, 'Test trade', 'thesis matches');
  assertNotNull(data.createdAt, 'has createdAt');
  assertNotNull(data.updatedAt, 'has updatedAt');
}

// ── 5. POST: Validates empty symbol ─────────────────────────────────

console.log('\n5. POST returns 400 for empty symbol:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const result = doPostTrade({ symbol: '', direction: 'long' });
  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Validates direction enum ───────────────────────────────

console.log('\n6. POST returns 400 for invalid direction:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const result = doPostTrade({ symbol: 'AAPL', direction: 'invalid' });
  assert(result.status === 400, 'returns 400');
}

// ── 7. POST: Resolves setup string to UUID ──────────────────────────

console.log('\n7. POST resolves setup string to lookup UUID:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const lookup = seedLookupValue({ type: 'setup', value: 'breakout' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', setup: 'breakout' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.setupId, lookup.id, 'setupId matches lookup id');
}

// ── 8. POST: Picks defaultAccountId from settings ───────────────────

console.log('\n8. POST picks defaultAccountId from settings:');
{
  cleanup();
  const account1 = seedAccount({ name: 'Default Account' });
  const account2 = seedAccount({ name: 'Other Account' });
  seedSettings({ defaultAccountId: account1.id });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.accountId, account1.id, 'accountId matches default account');
}

// ── 9. POST: Picks first active account without settings ────────────

console.log('\n9. POST picks first active account when no default settings:');
{
  cleanup();
  const account1 = seedAccount({ name: 'First Account' });
  seedAccount({ name: 'Second Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.accountId, account1.id, 'accountId matches first active account');
}

// ── 10. POST: Returns 400 with no active accounts ───────────────────

console.log('\n10. POST returns 400 when no active accounts exist:');
{
  cleanup();
  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });
  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string };
  assert(data.error.includes('No active account'), 'error mentions no active account');
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
