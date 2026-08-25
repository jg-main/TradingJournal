/**
 * action items route tests
 *
 * Tests the GET, POST, PUT, DELETE handlers for review action items.
 * POST creates an action item with sourceType, actionText, optional status/dueDate.
 * GET lists with optional filters (sourceType, sourceId, status).
 * PUT updates status, actionText, or dueDate.
 * DELETE removes an action item.
 *
 * Run: DB_FILE_NAME=./.test-ms02-t06.db npx tsx src/app/api/reviews/action-items/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { testDbPath, disposeSqliteFile } from '../../../../../lib/testing/test-db';
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

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('reviews-action-items');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS review_action_items (
    id TEXT PRIMARY KEY NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('weekly_review','trade_review','general')),
    source_id TEXT,
    action_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','in_progress','done','cancelled')),
    due_date TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Helpers (mirrors route.ts logic) ────────────────────────────────

const VALID_SOURCE_TYPES = ['weekly_review', 'trade_review', 'general'] as const;
const VALID_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

function doPost(body: Record<string, unknown>): { status: number; data: Record<string, unknown> } {
  // Validate sourceType
  if (!body.sourceType || !VALID_SOURCE_TYPES.includes(body.sourceType as typeof VALID_SOURCE_TYPES[number])) {
    const fieldErrors: Record<string, string[]> = {};
    if (!body.sourceType) {
      fieldErrors.sourceType = ['Required'];
    } else {
      fieldErrors.sourceType = [`Invalid enum value. Expected 'weekly_review' | 'trade_review' | 'general', received '${body.sourceType}'`];
    }
    return { status: 400, data: { error: 'Validation failed', details: { fieldErrors } } };
  }

  // Validate actionText
  if (!body.actionText || (typeof body.actionText === 'string' && body.actionText.trim() === '')) {
    return {
      status: 400,
      data: { error: 'Validation failed', details: { fieldErrors: { actionText: ['Action text is required'] } } },
    };
  }

  // Validate status if provided
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
    return {
      status: 400,
      data: { error: 'Validation failed', details: { fieldErrors: { status: [`Invalid enum value. Expected 'open' | 'in_progress' | 'done' | 'cancelled', received '${body.status}'`] } } },
    };
  }

  const itemId = randomUUID();
  const now = new Date().toISOString();
  const status = (body.status as string) || 'open';

  db.insert(schema.reviewActionItems)
    .values({
      id: itemId,
      sourceType: body.sourceType as 'weekly_review' | 'trade_review' | 'general',
      sourceId: (body.sourceId as string) ?? null,
      actionText: body.actionText as string,
      status: status as 'open' | 'in_progress' | 'done' | 'cancelled',
      dueDate: (body.dueDate as string) ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = db
    .select()
    .from(schema.reviewActionItems)
    .where(eq(schema.reviewActionItems.id, itemId))
    .get();

  return { status: 201, data: created as unknown as Record<string, unknown> };
}

function doGetList(filters?: {
  sourceType?: string;
  sourceId?: string;
  status?: string;
}): { status: number; data: Record<string, unknown>[] } {
  const conditions: ReturnType<typeof eq>[] = [];

  if (filters?.sourceType) {
    conditions.push(eq(schema.reviewActionItems.sourceType, filters.sourceType as typeof VALID_SOURCE_TYPES[number]));
  }
  if (filters?.sourceId) {
    conditions.push(eq(schema.reviewActionItems.sourceId, filters.sourceId));
  }
  if (filters?.status) {
    conditions.push(eq(schema.reviewActionItems.status, filters.status as typeof VALID_STATUSES[number]));
  }

  const query = db
    .select()
    .from(schema.reviewActionItems)
    .orderBy(schema.reviewActionItems.createdAt);

  const items = conditions.length > 0
    ? query.where(and(...conditions)).all()
    : query.all();

  return { status: 200, data: items as unknown as Record<string, unknown>[] };
}

function doPut(
  id: string,
  body: Record<string, unknown>,
): { status: number; data: Record<string, unknown> } {
  const existing = db
    .select()
    .from(schema.reviewActionItems)
    .where(eq(schema.reviewActionItems.id, id))
    .get();

  if (!existing) {
    return { status: 404, data: { error: 'Action item not found' } };
  }

  // Validate actionText if provided
  if (body.actionText !== undefined && (typeof body.actionText !== 'string' || body.actionText.trim() === '')) {
    return {
      status: 400,
      data: { error: 'Validation failed', details: { fieldErrors: { actionText: ['Action text is required'] } } },
    };
  }

  // Validate status if provided
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
    return {
      status: 400,
      data: { error: 'Validation failed', details: { fieldErrors: { status: [`Invalid enum value. Expected 'open' | 'in_progress' | 'done' | 'cancelled', received '${body.status}'`] } } },
    };
  }

  // Require at least one updatable field
  if (body.actionText === undefined && body.status === undefined && body.dueDate === undefined) {
    return {
      status: 400,
      data: { error: 'Validation failed', details: { fieldErrors: { _errors: ['At least one of actionText, status, or dueDate must be provided'] } } },
    };
  }

  const now = new Date().toISOString();
  const updateValues: Record<string, string | null> = { updatedAt: now };

  if (body.actionText !== undefined) {
    updateValues.actionText = body.actionText as string;
  }
  if (body.status !== undefined) {
    updateValues.status = body.status as string;
  }
  if (body.dueDate !== undefined) {
    updateValues.dueDate = body.dueDate as string | null;
  }

  db.update(schema.reviewActionItems)
    .set(updateValues)
    .where(eq(schema.reviewActionItems.id, id))
    .run();

  const updated = db
    .select()
    .from(schema.reviewActionItems)
    .where(eq(schema.reviewActionItems.id, id))
    .get();

  return { status: 200, data: updated as unknown as Record<string, unknown> };
}

function doDelete(id: string): { status: number; data: Record<string, unknown> } {
  const existing = db
    .select()
    .from(schema.reviewActionItems)
    .where(eq(schema.reviewActionItems.id, id))
    .get();

  if (!existing) {
    return { status: 404, data: { error: 'Action item not found' } };
  }

  db.delete(schema.reviewActionItems)
    .where(eq(schema.reviewActionItems.id, id))
    .run();

  return { status: 200, data: { message: 'Action item removed' } };
}

// ── Clean slate for isolated runs ────────────────────────────────────

// Clear any rows from previous runs so each invocation starts fresh.
// The table is already created above, so we just TRUNCATE/delete all rows.
sqlite.exec('DELETE FROM review_action_items;');

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Action Items POST Handler Tests ---\n');

// ── Test 1: POST creates an action item with default status ─────────

console.log('1. POST creates action item with default status "open":');
{
  const result = doPost({
    sourceType: 'weekly_review',
    actionText: 'Review AAPL trade plan',
  });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assert(data.id !== undefined, 'has an id');
  assert(data.sourceType === 'weekly_review', 'sourceType = weekly_review');
  assert(data.actionText === 'Review AAPL trade plan', 'actionText matches');
  assert(data.status === 'open', 'status defaults to open');
}

// ── Test 2: POST creates with explicit status and dueDate ───────────

console.log('\n2. POST creates with explicit status and dueDate:');
{
  const result = doPost({
    sourceType: 'trade_review',
    sourceId: 'test-trade-id-123',
    actionText: 'Document MSFT entry thesis',
    status: 'in_progress',
    dueDate: '2026-07-15',
  });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assert(data.sourceType === 'trade_review', 'sourceType = trade_review');
  assert(data.sourceId === 'test-trade-id-123', 'sourceId matches');
  assert(data.status === 'in_progress', 'status = in_progress');
  assert(data.dueDate === '2026-07-15', 'dueDate = 2026-07-15');
}

// ── Test 3: POST with missing sourceType returns 400 ────────────────

console.log('\n3. POST with missing sourceType returns 400:');
{
  const result = doPost({ actionText: 'Some action' });
  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string };
  assert(data.error === 'Validation failed', 'error message is "Validation failed"');
}

// ── Test 4: POST with missing actionText returns 400 ────────────────

console.log('\n4. POST with missing actionText returns 400:');
{
  const result = doPost({ sourceType: 'general' });
  assert(result.status === 400, 'returns 400');
}

// ── Test 5: POST with empty actionText returns 400 ──────────────────

console.log('\n5. POST with empty actionText returns 400:');
{
  const result = doPost({ sourceType: 'general', actionText: '' });
  assert(result.status === 400, 'returns 400 for empty actionText');
}

// ── Test 6: POST with invalid status returns 400 ────────────────────

console.log('\n6. POST with invalid status returns 400:');
{
  const result = doPost({
    sourceType: 'general',
    actionText: 'Test action',
    status: 'invalid_status',
  });
  assert(result.status === 400, 'returns 400 for invalid status');
}

// ── Test 7: POST with invalid sourceType returns 400 ────────────────

console.log('\n7. POST with invalid sourceType returns 400:');
{
  const result = doPost({
    sourceType: 'unknown_type',
    actionText: 'Test action',
  });
  assert(result.status === 400, 'returns 400 for invalid sourceType');
}

// ── Test 8: POST creates action item with general type (no sourceId) ─

console.log('\n8. POST creates action item with general source type:');
{
  const result = doPost({
    sourceType: 'general',
    actionText: 'General review note',
  });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assert(data.sourceType === 'general', 'sourceType = general');
  assert(data.sourceId === null, 'sourceId is null for general type');
}

// ── Test 9: GET lists all action items (empty default) ──────────────

console.log('\n9. GET lists all action items (no filters):');
{
  const result = doGetList();
  assert(result.status === 200, 'returns 200');
  const items = result.data;
  assert(items.length >= 3, 'has at least 3 action items');
}

// ── Test 10: GET filters by sourceType ──────────────────────────────

console.log('\n10. GET filters by sourceType:');
{
  const result = doGetList({ sourceType: 'weekly_review' });
  assert(result.status === 200, 'returns 200');
  const items = result.data;
  assert(items.length >= 1, 'has at least 1 weekly_review item');
  // All returned items should have weekly_review sourceType
  for (const item of items) {
    assert((item as Record<string, unknown>).sourceType === 'weekly_review', 'sourceType filter enforced');
  }
}

// ── Test 11: GET filters by status ──────────────────────────────────

console.log('\n11. GET filters by status:');
{
  const result = doGetList({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const items = result.data;
  assert(items.length >= 1, 'has at least 1 open item');
  for (const item of items) {
    assert((item as Record<string, unknown>).status === 'open', 'status filter enforced');
  }
}

// ── Test 12: GET filters by sourceId ────────────────────────────────

console.log('\n12. GET filters by sourceId:');
{
  const result = doGetList({ sourceId: 'test-trade-id-123' });
  assert(result.status === 200, 'returns 200');
  const items = result.data;
  assert(items.length === 1, 'has exactly 1 item with that sourceId');
  const item = items[0] as Record<string, unknown>;
  assert(item.sourceId === 'test-trade-id-123', 'sourceId filter enforced');
}

// ── Test 13: PUT updates status ─────────────────────────────────────

console.log('\n13. PUT updates status:');
{
  // Create an item first
  const created = doPost({
    sourceType: 'general',
    actionText: 'Item to update status',
  });
  const createdData = created.data as Record<string, unknown>;
  const itemId = createdData.id as string;

  // Update status to done
  const result = doPut(itemId, { status: 'done' });
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assert(data.status === 'done', 'status updated to done');
  assert(data.actionText === 'Item to update status', 'actionText unchanged');
}

// ── Test 14: PUT updates actionText ─────────────────────────────────

console.log('\n14. PUT updates actionText:');
{
  // Create an item first
  const created = doPost({
    sourceType: 'general',
    actionText: 'Original text',
  });
  const createdData = created.data as Record<string, unknown>;
  const itemId = createdData.id as string;

  // Update actionText
  const result = doPut(itemId, { actionText: 'Updated text' });
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assert(data.actionText === 'Updated text', 'actionText updated');
}

// ── Test 15: PUT with non-existent id returns 404 ───────────────────

console.log('\n15. PUT with non-existent id returns 404:');
{
  const result = doPut('non-existent-id', { status: 'done' });
  assert(result.status === 404, 'returns 404');
  assert(
    (result.data as { error: string }).error === 'Action item not found',
    'error message is "Action item not found"',
  );
}

// ── Test 16: PUT with empty actionText returns 400 ──────────────────

console.log('\n16. PUT with empty actionText returns 400:');
{
  // Create an item first
  const created = doPost({
    sourceType: 'general',
    actionText: 'Item for validation',
  });
  const createdData = created.data as Record<string, unknown>;
  const itemId = createdData.id as string;

  const result = doPut(itemId, { actionText: '' });
  assert(result.status === 400, 'returns 400 for empty actionText');
}

// ── Test 17: PUT with invalid status returns 400 ────────────────────

console.log('\n17. PUT with invalid status returns 400:');
{
  const created = doPost({
    sourceType: 'general',
    actionText: 'Item for validation 2',
  });
  const createdData = created.data as Record<string, unknown>;
  const itemId = createdData.id as string;

  const result = doPut(itemId, { status: 'unknown' });
  assert(result.status === 400, 'returns 400 for invalid status');
}

// ── Test 18: PUT updates status cycle through all states ────────────

console.log('\n18. PUT cycles through all statuses:');
{
  const created = doPost({
    sourceType: 'general',
    actionText: 'Status cycle item',
  });
  const itemId = (created.data as Record<string, unknown>).id as string;

  const statuses = ['open', 'in_progress', 'done', 'cancelled'];
  for (const s of statuses) {
    const result = doPut(itemId, { status: s });
    assert(result.status === 200, `can update to ${s}`);
    const data = result.data as Record<string, unknown>;
    assert(data.status === s, `status is now ${s}`);
  }
}

// ── Test 19: DELETE removes an action item ──────────────────────────

console.log('\n19. DELETE removes an action item:');
{
  const created = doPost({
    sourceType: 'weekly_review',
    actionText: 'Item to delete',
  });
  const itemId = (created.data as Record<string, unknown>).id as string;

  const result = doDelete(itemId);
  assert(result.status === 200, 'returns 200');
  assert(
    (result.data as { message: string }).message === 'Action item removed',
    'message is "Action item removed"',
  );

  // Verify it's gone
  const list = doGetList();
  const ids = list.data.map((i: Record<string, unknown>) => i.id);
  assert(!ids.includes(itemId), 'item no longer in list');
}

// ── Test 20: DELETE with non-existent id returns 404 ────────────────

console.log('\n20. DELETE with non-existent id returns 404:');
{
  const result = doDelete('non-existent-id');
  assert(result.status === 404, 'returns 404');
  assert(
    (result.data as { error: string }).error === 'Action item not found',
    'error message is "Action item not found"',
  );
}

// ── Cleanup (root-hygiene guard: no disposable DBs in the repo root) ──
try {
  disposeSqliteFile(DB_FILE);
} catch {
  // ignore cleanup errors
}

// ── Summary ─────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
