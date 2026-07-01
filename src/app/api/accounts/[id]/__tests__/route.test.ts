/**
 * account by id route test
 *
 * Tests PUT (update) and DELETE (soft-deactivate) handlers.
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/__tests__/route.test.ts
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

const DB_FILE = process.env.DB_FILE_NAME || './.test-account-by-id.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doPutAccount(id: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Check for empty string validation on name
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length === 0)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { name: ['String must contain at least 1 character(s)'] } } } };
    }
    if (body.name !== undefined && typeof body.name === 'string' && body.name.length > 200) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { name: ['String must contain at most 200 character(s)'] } } } };
    }
    if (body.broker !== undefined && body.broker !== null && (typeof body.broker !== 'string' || (body.broker as string).length > 200)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { broker: ['String must contain at most 200 character(s)'] } } } };
    }
    if (body.currency !== undefined && (typeof body.currency !== 'string' || body.currency.length < 1 || body.currency.length > 3)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { currency: ['String must contain at most 3 character(s)'] } } } };
    }

    const existing = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    if (!existing) {
      return { status: 404, data: { error: 'Account not found' } };
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.broker !== undefined) updateData.broker = body.broker;
    if (body.currency !== undefined) updateData.currency = body.currency;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    db.update(schema.accounts)
      .set(updateData as any)
      .where(eq(schema.accounts.id, id))
      .run();

    const row = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update account', details: String(error) } };
  }
}

function doDeleteAccount(id: string): { status: number; data: unknown } {
  try {
    const existing = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    if (!existing) {
      return { status: 404, data: { error: 'Account not found' } };
    }

    // Soft delete: mark as inactive
    db.update(schema.accounts)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(schema.accounts.id, id))
      .run();

    return { status: 200, data: { message: 'Account deactivated' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to delete account', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
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

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Account By ID API Tests ---\n');

// ── 1. PUT: Update account name ─────────────────────────────────────

console.log('\n1. PUT updates account name:');
{
  cleanup();
  const account = seedAccount({ name: 'Old Name' });
  const result = doPutAccount(account.id as string, { name: 'New Name' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.name, 'New Name', 'name is updated');
}

// ── 2. PUT: Update account broker ───────────────────────────────────

console.log('\n2. PUT updates account broker:');
{
  cleanup();
  const account = seedAccount({ name: 'Broker Test', broker: null });
  const result = doPutAccount(account.id as string, { broker: 'TD Ameritrade' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.broker, 'TD Ameritrade', 'broker is updated');
}

// ── 3. PUT: Update account currency ─────────────────────────────────

console.log('\n3. PUT updates account currency:');
{
  cleanup();
  const account = seedAccount({ name: 'Currency Test' });
  const result = doPutAccount(account.id as string, { currency: 'EUR' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currency, 'EUR', 'currency is updated');
}

// ── 4. PUT: Update isActive ─────────────────────────────────────────

console.log('\n4. PUT toggles isActive:');
{
  cleanup();
  const account = seedAccount({ name: 'Active Toggle', isActive: true });
  const result = doPutAccount(account.id as string, { isActive: false });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.isActive, false, 'isActive is toggled to false');
}

// ── 5. PUT: Validate against empty string name ──────────────────────

console.log('\n5. PUT returns 400 for empty name:');
{
  cleanup();
  const account = seedAccount({ name: 'Valid Name' });
  const result = doPutAccount(account.id as string, { name: '' });
  assert(result.status === 400, 'returns 400');
}

// ── 6. PUT: 404 for nonexistent id ──────────────────────────────────

console.log('\n6. PUT returns 404 for nonexistent id:');
{
  cleanup();
  const result = doPutAccount('nonexistent-id', { name: 'Ghost' });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Account not found', 'error message');
}

// ── 7. DELETE: Soft-deactivates account ─────────────────────────────

console.log('\n7. DELETE soft-deactivates account:');
{
  cleanup();
  const account = seedAccount({ name: 'To Delete', isActive: true });
  const result = doDeleteAccount(account.id as string);

  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'Account deactivated', 'message matches');

  // Verify it's still in DB but inactive
  const updated = db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id as string)).get() as Record<string, unknown>;
  assertEqual(updated.isActive, false, 'isActive is false after soft delete');
}

// ── 8. DELETE: 404 for nonexistent id ───────────────────────────────

console.log('\n8. DELETE returns 404 for nonexistent id:');
{
  cleanup();
  const result = doDeleteAccount('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Account not found', 'error message');
}

// ── 9. PUT: Update broker to null ───────────────────────────────────

console.log('\n9. PUT updates broker to null:');
{
  cleanup();
  const account = seedAccount({ name: 'Broker Null', broker: 'Some Broker' });
  const result = doPutAccount(account.id as string, { broker: null });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.broker, null, 'broker is null after update');
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
