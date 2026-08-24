/**
 * setup checks CRUD route test
 *
 * Tests GET (list), POST (create), GET (single), PUT (update),
 * DELETE (soft-delete) for /api/setups/:id/checks endpoints.
 *
 * Run: npx vitest run --reporter verbose src/app/api/setups/__tests__/checks.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, isNull, asc } from 'drizzle-orm';

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

function assertNull(value: unknown, msg: string) {
  if (value === null || value === undefined) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 value is ${JSON.stringify(value)} (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('setup-checks');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS checklist_definitions;
  DROP TABLE IF EXISTS setup_definitions;
  DROP TABLE IF EXISTS lookup_values;

  CREATE TABLE setup_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    how_to_play TEXT,
    entry_rules TEXT,
    exit_rules TEXT,
    tags TEXT,
    default_risk_pct REAL,
    position_sizing_rules TEXT,
    chart_patterns TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE checklist_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT,
    setup_id TEXT REFERENCES setup_definitions(id),
    description TEXT NOT NULL,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetSetupChecks(setupId: string): { status: number; data: unknown } {
  try {
    const setup = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, setupId)).get();
    if (!setup) {
      return { status: 404, data: { error: 'Setup not found' } };
    }

    const rows = db
      .select()
      .from(schema.checklistDefinitions)
      .where(
        and(
          eq(schema.checklistDefinitions.setupId, setupId),
          isNull(schema.checklistDefinitions.deletedAt),
        ),
      )
      .orderBy(asc(schema.checklistDefinitions.sortOrder), asc(schema.checklistDefinitions.createdAt))
      .all();

    return { status: 200, data: rows };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch setup checks', details: String(error) } };
  }
}

function doPostSetupCheck(setupId: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    const setup = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, setupId)).get();
    if (!setup) {
      return { status: 404, data: { error: 'Setup not found' } };
    }

    const description = body.description;
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { description: ['Description is required'] } } } };
    }
    if (description.length > 500) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { description: ['String must contain at most 500 character(s)'] } } } };
    }

    const checkId = randomUUID();
    const now = new Date().toISOString();

    let sortOrder = body.sortOrder as number | undefined;
    if (sortOrder === undefined) {
      const maxResult = db
        .select({ max: schema.checklistDefinitions.sortOrder })
        .from(schema.checklistDefinitions)
        .where(
          and(
            eq(schema.checklistDefinitions.setupId, setupId),
            isNull(schema.checklistDefinitions.deletedAt),
          ),
        )
        .all();
      const maxVal = (maxResult[0]?.max as number | null) ?? null;
      sortOrder = (maxVal ?? -1) + 1;
    }

    db.insert(schema.checklistDefinitions)
      .values({
        id: checkId,
        setupId,
        description: description as string,
        sortOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, checkId)).get();
    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create setup check', details: String(error) } };
  }
}

function doGetSetupCheck(setupId: string, checkId: string): { status: number; data: unknown } {
  try {
    const setup = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, setupId)).get();
    if (!setup) {
      return { status: 404, data: { error: 'Setup not found' } };
    }

    const row = db
      .select()
      .from(schema.checklistDefinitions)
      .where(
        and(
          eq(schema.checklistDefinitions.id, checkId),
          eq(schema.checklistDefinitions.setupId, setupId),
          isNull(schema.checklistDefinitions.deletedAt),
        ),
      )
      .get();

    if (!row) {
      return { status: 404, data: { error: 'Check not found' } };
    }

    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch setup check', details: String(error) } };
  }
}

function doPutSetupCheck(setupId: string, checkId: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    const setup = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, setupId)).get();
    if (!setup) {
      return { status: 404, data: { error: 'Setup not found' } };
    }

    const existing = db
      .select()
      .from(schema.checklistDefinitions)
      .where(
        and(
          eq(schema.checklistDefinitions.id, checkId),
          eq(schema.checklistDefinitions.setupId, setupId),
          isNull(schema.checklistDefinitions.deletedAt),
        ),
      )
      .get();

    if (!existing) {
      return { status: 404, data: { error: 'Check not found' } };
    }

    // Validate optional fields
    if (body.description !== undefined) {
      if (typeof body.description !== 'string' || (body.description as string).trim().length === 0) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { description: ['Description is required'] } } } };
      }
      if ((body.description as string).length > 500) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { description: ['String must contain at most 500 character(s)'] } } } };
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.description !== undefined) updates.description = body.description;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    db.update(schema.checklistDefinitions)
      .set(updates)
      .where(eq(schema.checklistDefinitions.id, checkId))
      .run();

    const row = db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, checkId)).get();
    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update setup check', details: String(error) } };
  }
}

function doDeleteSetupCheck(setupId: string, checkId: string): { status: number; data: unknown } {
  try {
    const setup = db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, setupId)).get();
    if (!setup) {
      return { status: 404, data: { error: 'Setup not found' } };
    }

    const existing = db
      .select()
      .from(schema.checklistDefinitions)
      .where(
        and(
          eq(schema.checklistDefinitions.id, checkId),
          eq(schema.checklistDefinitions.setupId, setupId),
          isNull(schema.checklistDefinitions.deletedAt),
        ),
      )
      .get();

    if (!existing) {
      return { status: 404, data: { error: 'Check not found' } };
    }

    db.update(schema.checklistDefinitions)
      .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.checklistDefinitions.id, checkId))
      .run();

    return { status: 200, data: { message: 'Check deleted' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to delete setup check', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM checklist_definitions;');
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM setup_definitions;');
}

function seedSetup(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.setupDefinitions)
    .values({
      id,
      name: 'Test Setup',
      description: 'A test setup definition',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  // Insert matching lookup for consistency with app pattern
  db.insert(schema.lookupValues)
    .values({
      id,
      type: 'setup',
      value: (overrides.name as string || 'Test Setup').toLowerCase(),
      description: overrides.description as string || 'A test setup definition',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get() as Record<string, unknown>;
}

function seedCheck(setupId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.checklistDefinitions)
    .values({
      id,
      setupId,
      description: 'Default check description',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Setup Checks API Tests ---\n');

let setupId: string;

// ── 1. GET: List returns [] when no checks ───────────────────────────

console.log('\n1. GET /setups/:id/checks returns [] when no checks:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const result = doGetSetupChecks(setupId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as unknown[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 0, 'array is empty');
}

// ── 2. GET: List returns checks ordered by sort_order ────────────────

console.log('\n2. GET returns checks ordered by sort_order:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  seedCheck(setupId, { description: 'Check B', sortOrder: 2 });
  seedCheck(setupId, { description: 'Check A', sortOrder: 1 });
  const result = doGetSetupChecks(setupId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 2, 'has 2 checks');
  assertEqual(data[0].description, 'Check A', 'first check by sort_order');
  assertEqual(data[1].description, 'Check B', 'second check by sort_order');
}

// ── 3. GET: List returns 404 for non-existing setup ────────────────

console.log('\n3. GET returns 404 for non-existing setup:');
{
  const result = doGetSetupChecks('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Setup not found', 'error message matches');
}

// ── 4. POST: Create a check with valid data ──────────────────────────

console.log('\n4. POST creates a setup check with valid data:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const result = doPostSetupCheck(setupId, {
    description: 'Verify support/resistance level',
    sortOrder: 5,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.description, 'Verify support/resistance level', 'description matches');
  assertEqual(data.sortOrder, 5, 'sortOrder matches');
  assertEqual(data.setupId, setupId, 'setupId matches');
  assertEqual(data.isActive, true, 'isActive defaults to true');
  assertNull(data.deletedAt, 'deletedAt is null');
  assertNotNull(data.createdAt, 'has createdAt');
  assertNotNull(data.updatedAt, 'has updatedAt');
}

// ── 5. POST: Create with auto-assigned sort_order ────────────────────

console.log('\n5. POST auto-assigns sort_order when not provided:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  seedCheck(setupId, { description: 'Existing check', sortOrder: 3 });
  const result = doPostSetupCheck(setupId, {
    description: 'Auto-sorted check',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.sortOrder, 4, 'sortOrder auto-assigned to previous max + 1');
  assertEqual(data.description, 'Auto-sorted check', 'description matches');
}

// ── 6. POST: Validation rejects missing description ──────────────────

console.log('\n6. POST returns 400 for missing description:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const result = doPostSetupCheck(setupId, { sortOrder: 1 });
  assert(result.status === 400, 'returns 400');
}

// ── 7. POST: Validation rejects empty description ─────────────────────

console.log('\n7. POST returns 400 for empty description string:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const result = doPostSetupCheck(setupId, { description: '', sortOrder: 1 });
  assert(result.status === 400, 'returns 400');
}

// ── 8. POST: Returns 404 for non-existing setup ────────────────────

console.log('\n8. POST returns 404 for non-existing setup:');
{
  const result = doPostSetupCheck('bad-setup-id', { description: 'Test check' });
  assert(result.status === 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Setup not found', 'error message matches');
}

// ── 9. GET (single): Fetch existing check ────────────────────────────

console.log('\n9. GET /setups/:id/checks/:checkId fetches existing check:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const check = seedCheck(setupId, { description: 'Check markdown entry', sortOrder: 2 });
  const checkId = check.id as string;
  const result = doGetSetupCheck(setupId, checkId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.description, 'Check markdown entry', 'description matches');
  assertEqual(data.sortOrder, 2, 'sortOrder matches');
}

// ── 10. GET (single): Returns 404 for non-existing check ─────────────

console.log('\n10. GET returns 404 for non-existing check:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const result = doGetSetupCheck(setupId, 'nonexistent-check-id');
  assert(result.status === 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Check not found', 'error message matches');
}

// ── 11. GET (single): Returns 404 for wrong setup ──────────────────

console.log('\n11. GET returns 404 when check belongs to different setup:');
{
  cleanup();
  const setup1 = seedSetup();
  const setup2 = seedSetup({ name: 'Other Setup' });
  const check = seedCheck(setup1.id as string, { description: 'Setup1 check' });
  const result = doGetSetupCheck(setup2.id as string, check.id as string);
  assert(result.status === 404, 'returns 404');
}

// ── 12. PUT: Update a check's description ────────────────────────────

console.log('\n12. PUT updates a check description:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const check = seedCheck(setupId, { description: 'Original description', sortOrder: 1 });
  const checkId = check.id as string;
  const result = doPutSetupCheck(setupId, checkId, {
    description: 'Updated description',
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.description, 'Updated description', 'description was updated');
  assertEqual(data.sortOrder, 1, 'sortOrder unchanged');
}

// ── 13. PUT: Update sort_order and isActive ──────────────────────────

console.log('\n13. PUT updates sort_order and isActive:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const check = seedCheck(setupId, { description: 'Reorder check', sortOrder: 1 });
  const checkId = check.id as string;
  const result = doPutSetupCheck(setupId, checkId, {
    sortOrder: 10,
    isActive: false,
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.sortOrder, 10, 'sortOrder updated');
  assertEqual(data.isActive, false, 'isActive set to false');
}

// ── 14. PUT: Returns 404 for non-existing check ─────────────────────

console.log('\n14. PUT returns 404 for non-existing check:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const result = doPutSetupCheck(setupId, 'bad-check-id', { description: 'Nope' });
  assert(result.status === 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Check not found', 'error message matches');
}

// ── 15. PUT: Returns 404 for wrong setup ──────────────────────────

console.log('\n15. PUT returns 404 when check belongs to different setup:');
{
  cleanup();
  const setup1 = seedSetup();
  const setup2 = seedSetup({ name: 'Other Setup' });
  const check = seedCheck(setup1.id as string, { description: 'Setup1 check' });
  const result = doPutSetupCheck(setup2.id as string, check.id as string, { description: 'Hack' });
  assert(result.status === 404, 'returns 404');
}

// ── 16. PUT: Validation rejects empty description ─────────────────────

console.log('\n16. PUT returns 400 for empty description:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const check = seedCheck(setupId, { description: 'Test' });
  const result = doPutSetupCheck(setupId, check.id as string, { description: '' });
  assert(result.status === 400, 'returns 400');
}

// ── 17. DELETE: Soft-deletes a check ─────────────────────────────────

console.log('\n17. DELETE soft-deletes a check:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const check = seedCheck(setupId, { description: 'To be deleted' });
  const checkId = check.id as string;
  const result = doDeleteSetupCheck(setupId, checkId);

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.message, 'Check deleted', 'message matches');

  // Verify soft-delete: should not appear in list
  const listResult = doGetSetupChecks(setupId);
  const listData = listResult.data as unknown[];
  assertEqual(listData.length, 0, 'deleted check excluded from list');

  // Verify soft-delete: direct GET returns 404
  const getResult = doGetSetupCheck(setupId, checkId);
  assert(getResult.status === 404, 'GET returns 404 after soft-delete');
}

// ── 18. DELETE: Returns 404 for non-existing check ───────────────────

console.log('\n18. DELETE returns 404 for non-existing check:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const result = doDeleteSetupCheck(setupId, 'nonexistent-id');
  assert(result.status === 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Check not found', 'error message matches');
}

// ── 19. DELETE: Returns 404 for already deleted check ────────────────

console.log('\n19. DELETE returns 404 for already soft-deleted check:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  const check = seedCheck(setupId, { description: 'Already gone' });
  const checkId = check.id as string;
  // Soft-delete first
  db.update(schema.checklistDefinitions)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.checklistDefinitions.id, checkId))
    .run();
  // Try to delete again
  const result = doDeleteSetupCheck(setupId, checkId);
  assert(result.status === 404, 'returns 404 for already deleted check');
}

// ── 20. POST: Creates multiple checks with different sort orders ──────

console.log('\n20. POST creates multiple checks maintaining sort order:');
{
  cleanup();
  const setup = seedSetup();
  setupId = setup.id as string;
  doPostSetupCheck(setupId, { description: 'First', sortOrder: 1 });
  doPostSetupCheck(setupId, { description: 'Second', sortOrder: 2 });
  doPostSetupCheck(setupId, { description: 'Third', sortOrder: 3 });

  const result = doGetSetupChecks(setupId);
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 3, 'has 3 checks');
  assertEqual(data[0].description, 'First', 'first by sort_order');
  assertEqual(data[1].description, 'Second', 'second by sort_order');
  assertEqual(data[2].description, 'Third', 'third by sort_order');
}

// ── 21. Explicit test: Setups without checks still return [] ────────

console.log('\n21. GET returns [] for setup with no checks, even with foreign checks:');
{
  cleanup();
  const setup1 = seedSetup();
  const setup2 = seedSetup({ name: 'Second Setup' });
  seedCheck(setup1.id as string, { description: 'Setup1 check' });
  const result = doGetSetupChecks(setup2.id as string);
  const data = result.data as unknown[];
  assertEqual(data.length, 0, 'setup2 has 0 checks');
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
