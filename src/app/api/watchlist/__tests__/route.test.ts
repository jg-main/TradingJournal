/**
 * watchlist route test
 *
 * Tests GET (list with status filter) and POST (create, validation).
 *
 * Run: npx vitest run --reporter verbose src/app/api/watchlist/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, ne, desc } from 'drizzle-orm';

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

const DB_FILE = process.env.DB_FILE_NAME || './.test-watchlist.db';
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
    name TEXT,
    industry TEXT,
    sector TEXT,
    setup_id TEXT,
    direction TEXT NOT NULL DEFAULT 'long',
    thesis TEXT,
    market_context TEXT,
    key_level REAL,
    trigger_price REAL,
    planned_stop REAL,
    target_price REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    promoted_trade_id TEXT,
    alert_config TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetWatchlist(params: { status?: string } = {}): { status: number; data: unknown } {
  try {
    const query = db
      .select()
      .from(schema.watchlistItems)
      .orderBy(desc(schema.watchlistItems.createdAt));

    if (params.status) {
      query.where(eq(schema.watchlistItems.status, params.status as 'pending' | 'watching' | 'triggered' | 'skipped' | 'expired'));
    } else {
      // Default view excludes soft-deleted (expired) rows; only an explicit
      // ?status=expired request returns them.
      query.where(ne(schema.watchlistItems.status, 'expired'));
    }

    const rows = query.all();
    return { status: 200, data: rows };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch watchlist items', details: String(error) } };
  }
}

function doPostWatchlist(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const symbol = body.symbol;
    if (!symbol || typeof symbol !== 'string' || symbol.toString().trim().length === 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { symbol: ['Symbol is required'] } } } };
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.watchlistItems)
      .values({
        id,
        dateAdded: now,
        symbol: (symbol as string).trim(),
        name: null,
        sector: null,
        industry: null,
        keyLevel: (body.keyLevel as number) ?? null,
        alertConfig: body.alertConfig != null ? JSON.stringify(body.alertConfig) : null,
        createdAt: now,
        updatedAt: now,
        direction: 'long',
        status: 'pending',
      })
      .run();

    const row = db
      .select()
      .from(schema.watchlistItems)
      .where(eq(schema.watchlistItems.id, id))
      .get();

    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create watchlist item', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM watchlist_items;');
  sqlite.exec('DELETE FROM lookup_values;');
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

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Watchlist API Tests ---\n');

// ── 1. GET: Empty list ─────────────────────────────────────────────

console.log('\n1. GET returns empty list:');
{
  cleanup();
  const result = doGetWatchlist();
  assert(result.status === 200, 'returns 200');
  const data = result.data as unknown[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 0, 'array is empty');
}

// ── 2. GET: Excludes expired items when no filter; returns them on demand ──

console.log('\n2. GET excludes expired items by default; returns them with status=expired:');
{
  cleanup();
  seedWatchlistItem({ symbol: 'AAPL', status: 'pending' });
  seedWatchlistItem({ symbol: 'MSFT', status: 'watching' });
  seedWatchlistItem({ symbol: 'GOOGL', status: 'triggered' });
  seedWatchlistItem({ symbol: 'NFLX', status: 'expired' });

  const result = doGetWatchlist();
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 3, 'returns 3 active items (expired excluded)');

  const expired = doGetWatchlist({ status: 'expired' });
  assert(expired.status === 200, 'status=expired returns 200');
  const de = expired.data as Record<string, unknown>[];
  assertEqual(de.length, 1, 'status=expired returns only the expired item');
  assertEqual(de[0].symbol, 'NFLX', 'expired item symbol matches');
}

// ── 3. GET: Status filter ──────────────────────────────────────────

console.log('\n3. GET filters by status:');
{
  cleanup();
  seedWatchlistItem({ symbol: 'AAPL', status: 'pending' });
  seedWatchlistItem({ symbol: 'MSFT', status: 'watching' });

  const pending = doGetWatchlist({ status: 'pending' });
  assert(pending.status === 200, 'status filter returns 200');
  const dp = pending.data as Record<string, unknown>[];
  assertEqual(dp.length, 1, 'returns 1 pending item');
  assertEqual(dp[0].symbol, 'AAPL', 'symbol matches');
  assertEqual(dp[0].status, 'pending', 'status is pending');

  const watching = doGetWatchlist({ status: 'watching' });
  assert(watching.status === 200, 'watching filter returns 200');
  const dw = watching.data as Record<string, unknown>[];
  assertEqual(dw.length, 1, 'returns 1 watching item');
  assertEqual(dw[0].symbol, 'MSFT', 'symbol matches');
  assertEqual(dw[0].status, 'watching', 'status is watching');
}

// ── 4. POST: Create with valid data ─────────────────────────────────

console.log('\n4. POST creates a watchlist item with valid data:');
{
  cleanup();
  const result = doPostWatchlist({ symbol: 'AAPL' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
  assertEqual(data.status, 'pending', 'default status is pending');
  assertNotNull(data.dateAdded, 'has dateAdded');
  assertNotNull(data.createdAt, 'has createdAt');
  assertNotNull(data.updatedAt, 'has updatedAt');
}

// ── 5. POST: Validates empty symbol ─────────────────────────────────

console.log('\n5. POST returns 400 for empty symbol:');
{
  cleanup();
  const result = doPostWatchlist({ symbol: '' });
  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Creates with keyLevel ──────────────────────────────────

console.log('\n6. POST creates with keyLevel:');
{
  cleanup();
  const result = doPostWatchlist({
    symbol: 'AAPL',
    keyLevel: 150,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
  assertEqual(data.keyLevel, 150, 'keyLevel matches');
}

// ── 7. POST: Persists alertConfig as JSON ──────────────────────────

console.log('\n7. POST persists alertConfig as JSON string:');
{
  cleanup();
  const alertConfig = {
    priceAboveKeyLevel: { enabled: true },
    rsiAbove: { enabled: true, threshold: 70 },
  };

  const result = doPostWatchlist({
    symbol: 'AAPL',
    alertConfig,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.alertConfig, 'has alertConfig');
  assertEqual(typeof data.alertConfig, 'string', 'alertConfig is a string (JSON serialized)');
  const parsed = JSON.parse(data.alertConfig as string);
  assertEqual(parsed.priceAboveKeyLevel.enabled, true, 'priceAboveKeyLevel.enabled is true');
  assertEqual(parsed.rsiAbove.enabled, true, 'rsiAbove.enabled is true');
  assertEqual(parsed.rsiAbove.threshold, 70, 'rsiAbove.threshold is 70');
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
