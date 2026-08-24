/**
 * reorder checks endpoint test
 *
 * Tests POST /api/checks/reorder
 * Batch-updates sort_order for multiple checks atomically.
 *
 * Run: npx vitest run --reporter verbose src/app/api/checks/__tests__/reorder.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, isNull, inArray } from 'drizzle-orm';

import * as schema from '@/db/schema';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 value is null/undefined (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('reorder-checks');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS checklist_definitions;
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

  CREATE TABLE checklist_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    setup_id TEXT,
    description TEXT NOT NULL,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doReorder(items: Array<{ id: string; sortOrder: number }>): { status: number; data: unknown } {
  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { items: ['At least one item is required'] } } } };
    }

    // Validate each item
    for (const item of items) {
      if (!item.id) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { id: ['Item id is required'] } } } };
      }
      if (typeof item.sortOrder !== 'number' || !Number.isInteger(item.sortOrder) || item.sortOrder < 0) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { sortOrder: ['sortOrder must be >= 0'] } } } };
      }
    }

    const ids = items.map((i) => i.id);

    // Verify all items exist and are not soft-deleted
    const existing = db
      .select({ id: schema.checklistDefinitions.id })
      .from(schema.checklistDefinitions)
      .where(
        and(
          inArray(schema.checklistDefinitions.id, ids),
          isNull(schema.checklistDefinitions.deletedAt),
        ),
      )
      .all();

    const existingIds = new Set(existing.map((r) => r.id));
    const missing = ids.filter((id) => !existingIds.has(id));

    if (missing.length > 0) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              items: missing.map((id) => `Check "${id}" not found or already deleted`),
            },
          },
        },
      };
    }

    const now = new Date().toISOString();

    // Atomic batch update via transaction
    const updatedItems = db.transaction(() => {
      for (const item of items) {
        db.update(schema.checklistDefinitions)
          .set({ sortOrder: item.sortOrder, updatedAt: now })
          .where(eq(schema.checklistDefinitions.id, item.id))
          .run();
      }
      return db
        .select()
        .from(schema.checklistDefinitions)
        .where(inArray(schema.checklistDefinitions.id, ids))
        .all();
    });

    return { status: 200, data: updatedItems };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to reorder checks', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM checklist_definitions;');
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

function createCheck(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.checklistDefinitions)
    .values({
      id,
      description: 'Check item',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

function getSortOrder(id: string): number | null {
  const row = db
    .select({ sortOrder: schema.checklistDefinitions.sortOrder })
    .from(schema.checklistDefinitions)
    .where(eq(schema.checklistDefinitions.id, id))
    .get();
  return (row?.sortOrder as number) ?? null;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Reorder Checks Endpoint Tests ---\n');

let acc: Record<string, unknown>;

// ── 1. POST: Reorder two items ────────────────────────────────────────

console.log('\n1. POST reorders two checks:');
{
  cleanup();
  acc = seedAccount();
  const c1 = createCheck({ accountId: acc.id, description: 'First', sortOrder: 1 });
  const c2 = createCheck({ accountId: acc.id, description: 'Second', sortOrder: 2 });
  const result = doReorder([
    { id: c1.id as string, sortOrder: 2 },
    { id: c2.id as string, sortOrder: 1 },
  ]);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 2, 'has 2 items');
  assertEqual(getSortOrder(c1.id as string), 2, 'c1 sortOrder updated to 2');
  assertEqual(getSortOrder(c2.id as string), 1, 'c2 sortOrder updated to 1');
}

// ── 2. POST: Reorder three items ──────────────────────────────────────

console.log('\n2. POST reorders three checks in sequence:');
{
  cleanup();
  acc = seedAccount();
  const c1 = createCheck({ accountId: acc.id, description: 'Check A', sortOrder: 1 });
  const c2 = createCheck({ accountId: acc.id, description: 'Check B', sortOrder: 2 });
  const c3 = createCheck({ accountId: acc.id, description: 'Check C', sortOrder: 3 });
  const result = doReorder([
    { id: c1.id as string, sortOrder: 3 },
    { id: c2.id as string, sortOrder: 2 },
    { id: c3.id as string, sortOrder: 1 },
  ]);
  assert(result.status === 200, 'returns 200');
  assertEqual(getSortOrder(c1.id as string), 3, 'c1 sortOrder=3');
  assertEqual(getSortOrder(c2.id as string), 2, 'c2 sortOrder=2');
  assertEqual(getSortOrder(c3.id as string), 1, 'c3 sortOrder=1');
}

// ── 3. POST: Returns 400 for empty items array ────────────────────────

console.log('\n3. POST returns 400 for empty items array:');
{
  const result = doReorder([]);
  assert(result.status === 400, 'returns 400');
}

// ── 4. POST: Returns 400 for non-existing check id ────────────────────

console.log('\n4. POST returns 400 for non-existing check id:');
{
  const result = doReorder([{ id: 'nonexistent-id', sortOrder: 1 }]);
  assert(result.status === 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  const details = data.details as Record<string, unknown>;
  const fieldErrors = details.fieldErrors as Record<string, unknown>;
  assertNotNull(fieldErrors.items, 'has field-level error for items');
}

// ── 5. POST: Returns 400 when one of several items is missing ────────

console.log('\n5. POST returns 400 when one item in batch is invalid:');
{
  cleanup();
  acc = seedAccount();
  const c1 = createCheck({ accountId: acc.id, description: 'Valid check', sortOrder: 1 });
  const result = doReorder([
    { id: c1.id as string, sortOrder: 2 },
    { id: 'bad-id', sortOrder: 1 },
  ]);
  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Returns 400 for items with negative sortOrder ────────────

console.log('\n6. POST returns 400 for negative sortOrder:');
{
  cleanup();
  acc = seedAccount();
  const c1 = createCheck({ accountId: acc.id, description: 'Check', sortOrder: 1 });
  const result = doReorder([{ id: c1.id as string, sortOrder: -1 }]);
  assert(result.status === 400, 'returns 400');
}

// ── 7. POST: Single item reorder still works ──────────────────────────

console.log('\n7. POST reorder with single item:');
{
  cleanup();
  acc = seedAccount();
  const c1 = createCheck({ accountId: acc.id, description: 'Solo check', sortOrder: 5 });
  const result = doReorder([{ id: c1.id as string, sortOrder: 10 }]);
  assert(result.status === 200, 'returns 200');
  assertEqual(getSortOrder(c1.id as string), 10, 'sortOrder updated to 10');
}

// ── 8. POST: Updated items returned in response body ──────────────────

console.log('\n8. POST response includes updated items:');
{
  cleanup();
  acc = seedAccount();
  const c1 = createCheck({ accountId: acc.id, description: 'Returned check', sortOrder: 1 });
  const result = doReorder([{ id: c1.id as string, sortOrder: 99 }]);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 1, 'has 1 item in response');
  assertEqual((data[0] as Record<string, unknown>).sortOrder, 99, 'sortOrder is 99 in response');
}

// ── 9. POST: Handles duplicate sortOrder values ───────────────────────

console.log('\n9. POST reorder with duplicate sort_order values:');
{
  cleanup();
  acc = seedAccount();
  const c1 = createCheck({ accountId: acc.id, description: 'Check A', sortOrder: 1 });
  const c2 = createCheck({ accountId: acc.id, description: 'Check B', sortOrder: 2 });
  const result = doReorder([
    { id: c1.id as string, sortOrder: 1 },
    { id: c2.id as string, sortOrder: 1 },
  ]);
  assert(result.status === 200, 'returns 200 (duplicate sort_order allowed)');
}

// ── 10. POST: Reorder across account-scoped checks only ───────────────

console.log('\n10. POST reorder affects only specified checks (account isolation):');
{
  cleanup();
  const acc1 = seedAccount();
  const acc2 = seedAccount();
  const c1 = createCheck({ accountId: acc1.id, description: 'Acc1 check', sortOrder: 1 });
  const c2 = createCheck({ accountId: acc2.id, description: 'Acc2 check', sortOrder: 5 });
  const result = doReorder([
    { id: c1.id as string, sortOrder: 10 },
    { id: c2.id as string, sortOrder: 20 },
  ]);
  assert(result.status === 200, 'returns 200');
  assertEqual(getSortOrder(c1.id as string), 10, 'acc1 check sortOrder=10');
  assertEqual(getSortOrder(c2.id as string), 20, 'acc2 check sortOrder=20');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'\u2500'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
