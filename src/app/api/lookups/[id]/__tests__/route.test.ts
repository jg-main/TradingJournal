/**
 * lookup by id route test
 *
 * Tests PUT (update) and DELETE (soft-deactivate) handlers.
 *
 * Run: npx vitest run --reporter verbose src/app/api/lookups/\[id\]/__tests__/route.test.ts
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

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-lookups-by-id.db';
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

function doPutLookup(id: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    if (body.value !== undefined && (typeof body.value !== 'string' || body.value.length < 1)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { value: ['String must contain at least 1 character(s)'] } } } };
    }
    if (body.value !== undefined && typeof body.value === 'string' && body.value.length > 200) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { value: ['String must contain at most 200 character(s)'] } } } };
    }
    if (body.description !== undefined && body.description !== null && typeof body.description === 'string' && (body.description as string).length > 500) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { description: ['String must contain at most 500 character(s)'] } } } };
    }
    if (body.sortOrder !== undefined && (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder) || (body.sortOrder as number) < 0)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { sortOrder: ['Number must be greater than or equal to 0'] } } } };
    }

    const existing = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get();
    if (!existing) {
      return { status: 404, data: { error: 'Lookup not found' } };
    }

    const updateData: Partial<typeof schema.lookupValues.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (body.value !== undefined) updateData.value = body.value as string | undefined;
    if (body.description !== undefined) updateData.description = body.description as string | undefined;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder as number | null | undefined;
    if (body.isActive !== undefined) updateData.isActive = body.isActive as boolean | null | undefined;

    db.update(schema.lookupValues)
      .set(updateData)
      .where(eq(schema.lookupValues.id, id))
      .run();

    const row = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get();
    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update lookup', details: String(error) } };
  }
}

function doDeleteLookup(id: string): { status: number; data: unknown } {
  try {
    const existing = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get();
    if (!existing) {
      return { status: 404, data: { error: 'Lookup not found' } };
    }

    // Soft delete: mark as inactive
    db.update(schema.lookupValues)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(schema.lookupValues.id, id))
      .run();

    return { status: 200, data: { message: 'Lookup deactivated' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to delete lookup', details: String(error) } };
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

console.log('\n--- Lookup By ID API Tests ---\n');

// ── 1. PUT updates value, description, sortOrder ────────────────────

console.log('\n1. PUT updates value, description, sortOrder:');
{
  cleanup();
  const lookup = seedLookup({
    type: 'setup',
    value: 'original',
    description: 'Original desc',
    sortOrder: 1,
  });
  const result = doPutLookup(lookup.id as string, {
    value: 'new-value',
    description: 'new-desc',
    sortOrder: 10,
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.value, 'new-value', 'value is updated');
  assertEqual(data.description, 'new-desc', 'description is updated');
  assertEqual(data.sortOrder, 10, 'sortOrder is updated');
}

// ── 2. PUT returns 404 for nonexistent id ───────────────────────────

console.log('\n2. PUT returns 404 for nonexistent id:');
{
  cleanup();
  const result = doPutLookup('nonexistent-id', { value: 'ghost' });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Lookup not found', 'error message');
}

// ── 3. PUT validates sortOrder >= 0 ─────────────────────────────────

console.log('\n3. PUT returns 400 for negative sortOrder:');
{
  cleanup();
  const lookup = seedLookup({ type: 'setup', value: 'valid' });
  const result = doPutLookup(lookup.id as string, { sortOrder: -1 });
  assert(result.status === 400, 'returns 400');
}

// ── 4. DELETE soft-deactivates lookup ───────────────────────────────

console.log('\n4. DELETE soft-deactivates lookup:');
{
  cleanup();
  const lookup = seedLookup({ type: 'setup', value: 'To Delete', isActive: true });
  const result = doDeleteLookup(lookup.id as string);

  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'Lookup deactivated', 'message matches');

  // Verify it's still in DB but inactive
  const updated = db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, lookup.id as string)).get() as Record<string, unknown>;
  assertEqual(updated.isActive, false, 'isActive is false after soft delete');
}

// ── 5. DELETE returns 404 for nonexistent id ────────────────────────

console.log('\n5. DELETE returns 404 for nonexistent id:');
{
  cleanup();
  const result = doDeleteLookup('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Lookup not found', 'error message');
}

// ── 6. PUT updates value only (partial update) ──────────────────────

console.log('\n6. PUT updates value only, preserving other fields:');
{
  cleanup();
  const lookup = seedLookup({
    type: 'setup',
    value: 'original',
    description: 'orig desc',
    sortOrder: 5,
  });
  const result = doPutLookup(lookup.id as string, { value: 'updated' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.value, 'updated', 'value is updated');
  assertEqual(data.description, 'orig desc', 'description is preserved');
  assertEqual(data.sortOrder, 5, 'sortOrder is preserved');
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
