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
import { eq, and } from 'drizzle-orm';

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
    if (body.symbol !== undefined) updateData.symbol = body.symbol;
    if (body.sectorId !== undefined) updateData.sectorId = body.sectorId;
    if (body.direction !== undefined) updateData.direction = body.direction;
    if (body.thesis !== undefined) updateData.thesis = body.thesis;
    if (body.marketContext !== undefined) updateData.marketContext = body.marketContext;
    if (body.keyLevel !== undefined) updateData.keyLevel = body.keyLevel;
    if (body.triggerPrice !== undefined) updateData.triggerPrice = body.triggerPrice;
    if (body.plannedStop !== undefined) updateData.plannedStop = body.plannedStop;
    if (body.targetPrice !== undefined) updateData.targetPrice = body.targetPrice;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.promotedTradeId !== undefined) updateData.promotedTradeId = body.promotedTradeId;

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

console.log('\n--- Watchlist Item By ID API Tests ---\n');

// ── 1. GET: Returns item by id ──────────────────────────────────────

console.log('\n1. GET returns watchlist item by id:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL', thesis: 'My thesis' });

  const result = doGetWatchlistItem(item.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.id, item.id, 'id matches');
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
  assertEqual(data.direction, 'long', 'direction matches');
  assertEqual(data.thesis, 'My thesis', 'thesis matches');
}

// ── 2. GET: 404 for nonexistent id ──────────────────────────────────

console.log('\n2. GET returns 404 for nonexistent id:');
{
  cleanup();
  const result = doGetWatchlistItem('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Watchlist item not found', 'error message');
}

// ── 3. PUT: Updates fields via spread ──────────────────────────────

console.log('\n3. PUT updates fields via spread:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL', thesis: 'Old thesis' });

  const result = doPutWatchlistItem(item.id as string, { thesis: 'Updated thesis' });

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
  const lookup = seedLookupValue({ type: 'setup', value: 'breakout' });
  const item = seedWatchlistItem({ symbol: 'AAPL', setupId: null });

  const result = doPutWatchlistItem(item.id as string, { setup: 'breakout' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.setupId, lookup.id, 'setupId matches lookup id');
}

// ── 5. PUT: Validates unknown setup value ──────────────────────────

console.log('\n5. PUT returns 400 for unknown setup value:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL' });

  const result = doPutWatchlistItem(item.id as string, { setup: 'nonexistent-setup' });

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
  const result = doPutWatchlistItem('nonexistent-id', { thesis: 'Ghost' });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Watchlist item not found', 'error message');
}

// ── 7. PUT: Updates multiple fields ────────────────────────────────

console.log('\n7. PUT updates multiple fields:');
{
  cleanup();
  const item = seedWatchlistItem({ symbol: 'AAPL', direction: 'long', status: 'pending' });

  const result = doPutWatchlistItem(item.id as string, {
    symbol: 'MSFT',
    direction: 'short',
    status: 'watching',
    thesis: 'Changed my mind',
    triggerPrice: 200,
    plannedStop: 210,
    targetPrice: 180,
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.symbol, 'MSFT', 'symbol updated');
  assertEqual(data.direction, 'short', 'direction updated');
  assertEqual(data.status, 'watching', 'status updated');
  assertEqual(data.thesis, 'Changed my mind', 'thesis updated');
  assertEqual(data.triggerPrice, 200, 'triggerPrice updated');
  assertEqual(data.plannedStop, 210, 'plannedStop updated');
  assertEqual(data.targetPrice, 180, 'targetPrice updated');
}

// ── 8. DELETE: Soft-deletes by setting status to expired ───────────

console.log('\n8. DELETE soft-deletes watchlist item by setting status to expired:');
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

// ── 9. DELETE: 404 for nonexistent id ──────────────────────────────

console.log('\n9. DELETE returns 404 for nonexistent id:');
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
