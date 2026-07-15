/**
 * watchlist item by id route test
 *
 * Tests GET (by id), PUT (update), and DELETE (soft-delete) handlers.
 *
 * Run: npx vitest run --reporter verbose src/app/api/watchlist/\[id\]/__tests__/route.test.ts
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

const DB_FILE = process.env.DB_FILE_NAME || './.test-watchlist-item.db';
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
    sector TEXT,
    name TEXT,
    industry TEXT,
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

function doGetWatchlistItem(id: string): { status: number; data: unknown } {
  try {
    const row = db
      .select()
      .from(schema.watchlistItems)
      .where(eq(schema.watchlistItems.id, id))
      .get();

    if (!row) {
      return { status: 404, data: { error: 'Watchlist item not found' } };
    }

    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch watchlist item', details: String(error) } };
  }
}

function doPutWatchlistItem(id: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    const existing = db
      .select()
      .from(schema.watchlistItems)
      .where(eq(schema.watchlistItems.id, id))
      .get();

    if (!existing) {
      return { status: 404, data: { error: 'Watchlist item not found' } };
    }

    // Update fields passed in body
    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.symbol !== undefined) updateData.symbol = body.symbol;
    if (body.keyLevel !== undefined) updateData.keyLevel = body.keyLevel;
    if (body.alertConfig !== undefined) updateData.alertConfig = body.alertConfig != null ? JSON.stringify(body.alertConfig) : null;

    db.update(schema.watchlistItems)
      .set(updateData)
      .where(eq(schema.watchlistItems.id, id))
      .run();

    const row = db
      .select()
      .from(schema.watchlistItems)
      .where(eq(schema.watchlistItems.id, id))
      .get();

    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update watchlist item', details: String(error) } };
  }
}

function doDeleteWatchlistItem(id: string): { status: number; data: unknown } {
  try {
    const existing = db
      .select()
      .from(schema.watchlistItems)
      .where(eq(schema.watchlistItems.id, id))
      .get();

    if (!existing) {
      return { status: 404, data: { error: 'Watchlist item not found' } };
    }

    // Soft delete: mark as expired
    db.update(schema.watchlistItems)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(schema.watchlistItems.id, id))
      .run();

    return { status: 200, data: { message: 'Watchlist item expired' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to delete watchlist item', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM watchlist_items;');
  sqlite.exec('DELETE FROM lookup_values;');
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

console.log('\n--- Watchlist Item By ID API Tests ---\n');

// ── 1. GET: Returns item by id ──────────────────────────────────────

console.log('\n1. GET returns watchlist item by id:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL' });

  const result = doGetWatchlistItem(item.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.id, item.id, 'id matches');
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
}

// ── 2. GET: 404 for nonexistent id ──────────────────────────────────

console.log('\n2. GET returns 404 for nonexistent id:');
{
  cleanup();
  const result = doGetWatchlistItem('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Watchlist item not found', 'error message');
}

// ── 3. PUT: Updates keyLevel ────────────────────────────────────────

console.log('\n3. PUT updates keyLevel:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL' });

  const result = doPutWatchlistItem(item.id as string, {
    keyLevel: 150,
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.keyLevel, 150, 'keyLevel updated');
  assertEqual(data.symbol, 'AAPL', 'symbol preserved');
}

// ── 4. PUT: 404 for nonexistent id ─────────────────────────────────

console.log('\n4. PUT returns 404 for nonexistent id:');
{
  cleanup();
  const result = doPutWatchlistItem('nonexistent-id', { keyLevel: 150 });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Watchlist item not found', 'error message');
}

// ── 5. PUT: Persists alertConfig as JSON ────────────────────────────

console.log('\n5. PUT persists alertConfig as JSON string:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL' });
  const alertConfig = {
    priceBelowKeyLevel: { enabled: true },
    rsiBelow: { enabled: true, threshold: 30 },
  };

  const result = doPutWatchlistItem(item.id as string, { alertConfig });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.alertConfig, 'has alertConfig');
  assertEqual(typeof data.alertConfig, 'string', 'alertConfig is a string (JSON serialized)');
  const parsed = JSON.parse(data.alertConfig as string);
  assertEqual(parsed.priceBelowKeyLevel.enabled, true, 'priceBelowKeyLevel.enabled is true');
  assertEqual(parsed.rsiBelow.enabled, true, 'rsiBelow.enabled is true');
  assertEqual(parsed.rsiBelow.threshold, 30, 'rsiBelow.threshold is 30');

  // Verify null/removal
  const resultNull = doPutWatchlistItem(item.id as string, { alertConfig: null });
  assert(resultNull.status === 200, 'returns 200');
  const dataNull = resultNull.data as Record<string, unknown>;
  assertEqual(dataNull.alertConfig, null, 'alertConfig is null after removal');
}

// ── 6. DELETE: Soft-deletes by setting status to expired ───────────

console.log('\n6. DELETE soft-deletes watchlist item by setting status to expired:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL', status: 'pending' });

  const result = doDeleteWatchlistItem(item.id as string);

  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'Watchlist item expired', 'message matches');

  // Verify DB: item.status = 'expired'
  const updated = db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.id, item.id as string)).get() as Record<string, unknown>;
  assertEqual(updated.status, 'expired', 'status is expired after soft delete');
}

// ── 7. DELETE: 404 for nonexistent id ──────────────────────────────

console.log('\n7. DELETE returns 404 for nonexistent id:');
{
  cleanup();
  const result = doDeleteWatchlistItem('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Watchlist item not found', 'error message');
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
