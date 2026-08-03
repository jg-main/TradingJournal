/**
 * trade stop-adjustment by id route test
 *
 * Tests DELETE (deletes stop adjustment).
 *
 * Run: npx vitest run --reporter verbose src/app/api/trades/\[id\]/stop-adjustments/\[adjustmentId\]/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
//
// Always use this test's OWN throwaway DB — never the ambient DB_FILE_NAME
// (this test used to read it, which let an exported workaround variable
// redirect table-DROPs onto another suite's database).
const DB_FILE = './.test-stop-adjustment-by-id.db';

// Start from a clean file so stale tables from previous runs cannot mask
// schema drift.
rmSync(DB_FILE, { force: true });
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Apply the project's real migrations instead of hand-written DDL so the
// test schema can never drift from src/db/schema.ts again (the previous
// inline CREATE TABLE block was missing current_price and other newer
// columns).
migrate(db, { migrationsFolder: join(process.cwd(), 'src/db/migrations') });

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
