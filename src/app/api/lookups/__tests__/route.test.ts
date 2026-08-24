/**
 * lookups route test
 *
 * Tests GET (list, grouped, filtered) and POST (create, validation, duplicate).
 *
 * Run: npx vitest run --reporter verbose src/app/api/lookups/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, asc, and } from 'drizzle-orm';

import * as schema from '@/db/schema';

const VALID_TYPES = [
  'sector', 'setup', 'market_condition', 'mistake_type',
  'execution_reason', 'asset_type', 'phase', 'severity',
  'source_type', 'action_item_status',
] as const;

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

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('lookups');
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
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetLookups(typeFilter?: string): { status: number; data: unknown } {
  try {
    const rows = typeFilter && (VALID_TYPES as readonly string[]).includes(typeFilter)
      ? db.select().from(schema.lookupValues).where(eq(schema.lookupValues.type, typeFilter as typeof VALID_TYPES[number])).orderBy(asc(schema.lookupValues.sortOrder)).all()
      : db.select().from(schema.lookupValues).orderBy(asc(schema.lookupValues.type), asc(schema.lookupValues.sortOrder)).all();

    if (!typeFilter) {
      const grouped: Record<string, typeof rows> = {};
      for (const row of rows) {
        if (!grouped[row.type]) grouped[row.type] = [];
        grouped[row.type].push(row);
      }
      return { status: 200, data: grouped };
    }

    return { status: 200, data: rows };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch lookups', details: String(error) } };
  }
}

function doPostLookup(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const type = body.type as string;
    if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { type: ['Invalid enum value'] } } } };
    }

    const value = body.value as string;
    if (!value || typeof value !== 'string' || value.length < 1) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { value: ['Value is required'] } } } };
    }
    if (value.length > 200) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { value: ['String must contain at most 200 character(s)'] } } } };
    }

    const description = body.description !== undefined ? (body.description as string | null) : null;
    if (description !== null && typeof description === 'string' && description.length > 500) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { description: ['String must contain at most 500 character(s)'] } } } };
    }

    const sortOrder = body.sortOrder !== undefined ? (body.sortOrder as number) : 0;
    if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder) || sortOrder < 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { sortOrder: ['Number must be greater than or equal to 0'] } } } };
    }

    // Check for duplicate type+value
    const existing = db
      .select()
      .from(schema.lookupValues)
      .where(and(eq(schema.lookupValues.type, type as typeof VALID_TYPES[number]), eq(schema.lookupValues.value, value)))
      .get();

    if (existing) {
      return { status: 409, data: { error: `A lookup value "${value}" already exists for type "${type}".` } };
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.lookupValues)
      .values({
        id,
        type: type as typeof VALID_TYPES[number],
        value,
        description: description ?? null,
        sortOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get();
    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create lookup', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM lookup_values;');
}

function seedLookup(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.lookupValues)
    .values({
      id,
      type: 'sector',
      value: 'Technology',
      description: null,
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Lookups API Tests ---\n');

// ── 1. GET without ?type returns grouped object ─────────────────────

console.log('\n1. GET without ?type returns grouped object:');
{
  cleanup();
  seedLookup({ type: 'sector', value: 'Technology', sortOrder: 1 });
  seedLookup({ type: 'sector', value: 'Healthcare', sortOrder: 2 });
  seedLookup({ type: 'setup', value: 'Breakout', sortOrder: 1 });

  const result = doGetLookups();
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown[]>;
  assertNotNull(data.sector, 'has sector key');
  assertEqual((data.sector as unknown[]).length, 2, 'sector has 2 entries');
  assertNotNull(data.setup, 'has setup key');
  assertEqual((data.setup as unknown[]).length, 1, 'setup has 1 entry');
}

// ── 2. GET with ?type=setup returns flat array filtered by type ─────

console.log('\n2. GET with ?type=setup returns flat array:');
{
  cleanup();
  seedLookup({ type: 'sector', value: 'Technology' });
  seedLookup({ type: 'setup', value: 'Breakout' });
  seedLookup({ type: 'setup', value: 'Pullback' });

  const result = doGetLookups('setup');
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 2, 'has 2 entries');
  for (const entry of data) {
    assertEqual(entry.type, 'setup', `entry has type=setup`);
  }
}

// ── 3. GET with ?type=setup when no setup rows exist returns [] ─────

console.log('\n3. GET with ?type=setup returns [] when no setup rows:');
{
  cleanup();
  seedLookup({ type: 'sector', value: 'Technology' });

  const result = doGetLookups('setup');
  assert(result.status === 200, 'returns 200');
  const data = result.data as unknown[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 0, 'array is empty');
}

// ── 4. POST validates type against VALID_TYPES ──────────────────────

console.log('\n4. POST returns 400 for invalid type:');
{
  cleanup();
  const result = doPostLookup({ type: 'invalid_type', value: 'test' });
  assert(result.status === 400, 'returns 400');
}

// ── 5. POST validates empty value ───────────────────────────────────

console.log('\n5. POST returns 400 for empty value:');
{
  cleanup();
  const result = doPostLookup({ type: 'setup', value: '' });
  assert(result.status === 400, 'returns 400');
}

// ── 6. POST returns 409 on duplicate type+value ─────────────────────

console.log('\n6. POST returns 409 on duplicate type+value:');
{
  cleanup();
  seedLookup({ type: 'setup', value: 'breakout' });
  const result = doPostLookup({ type: 'setup', value: 'breakout' });
  assert(result.status === 409, 'returns 409');
}

// ── 7. POST returns 201 with created lookup ─────────────────────────

console.log('\n7. POST creates lookup with all fields:');
{
  cleanup();
  const result = doPostLookup({
    type: 'setup',
    value: 'breakout',
    description: 'Test',
    sortOrder: 5,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.type, 'setup', 'type matches');
  assertEqual(data.value, 'breakout', 'value matches');
  assertEqual(data.description, 'Test', 'description matches');
  assertEqual(data.sortOrder, 5, 'sortOrder matches');
  assertEqual(data.isActive, true, 'isActive defaults to true');
}

// ── 8. POST sortOrder defaults to 0 ─────────────────────────────────

console.log('\n8. POST sortOrder defaults to 0:');
{
  cleanup();
  const result = doPostLookup({ type: 'setup', value: 'default-order' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.sortOrder, 0, 'sortOrder defaults to 0');
}

// ── 9. POST description can be null ─────────────────────────────────

console.log('\n9. POST handles null description:');
{
  cleanup();
  const result = doPostLookup({ type: 'setup', value: 'no-desc' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.description, null, 'description is null');
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
