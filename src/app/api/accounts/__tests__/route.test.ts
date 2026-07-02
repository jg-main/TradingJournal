/**
 * accounts route test
 *
 * Tests GET (list, empty list) and POST (create, validation).
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc } from 'drizzle-orm';

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

const DB_FILE = process.env.DB_FILE_NAME || './.test-accounts.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
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
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetAccounts(): { status: number; data: unknown } {
  try {
    const rows = db.select().from(schema.accounts).orderBy(desc(schema.accounts.createdAt)).all();
    return { status: 200, data: rows };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch accounts', details: String(error) } };
  }
}

function doPostAccount(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const name = body.name;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { name: ['Name is required'] } } } };
    }
    if (name.length > 200) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { name: ['String must contain at most 200 character(s)'] } } } };
    }

    const broker = body.broker !== undefined ? body.broker : null;
    if (broker !== null && (typeof broker !== 'string' || broker.length > 200)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { broker: ['String must contain at most 200 character(s)'] } } } };
    }

    const currency = (body.currency as string) || 'USD';
    if (currency.length < 1 || currency.length > 3) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { currency: ['String must contain at most 3 character(s)'] } } } };
    }

    const isActive = body.isActive !== undefined ? !!body.isActive : true;

    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.accounts)
      .values({
        id,
        name: name as string,
        broker: broker as string | null,
        currency,
        isActive,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create account', details: String(error) } };
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

console.log('\n--- Accounts API Tests ---\n');

// ── 1. GET: Empty list returns [] ───────────────────────────────────

console.log('\n1. GET returns [] when no accounts:');
{
  cleanup();
  const result = doGetAccounts();
  assert(result.status === 200, 'returns 200');
  const data = result.data as unknown[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 0, 'array is empty');
}

// ── 2. GET: List all accounts ───────────────────────────────────────

console.log('\n2. GET returns all accounts:');
{
  cleanup();
  seedAccount({ name: 'Alpha' });
  seedAccount({ name: 'Beta' });
  const result = doGetAccounts();
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assert(data.length >= 2, 'has at least 2 accounts');
  const names = data.map((a) => a.name).sort();
  assertEqual(names[0], 'Alpha', 'first account name');
  assertEqual(names[1], 'Beta', 'second account name');
}

// ── 3. POST: Create with valid data ─────────────────────────────────

console.log('\n3. POST creates an account with valid data:');
{
  cleanup();
  const result = doPostAccount({
    name: 'My Trading Account',
    broker: 'Interactive Brokers',
    currency: 'USD',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.name, 'My Trading Account', 'name matches');
  assertEqual(data.broker, 'Interactive Brokers', 'broker matches');
  assertEqual(data.currency, 'USD', 'currency matches');
  assertEqual(data.isActive, true, 'isActive defaults to true');
  assertNotNull(data.createdAt, 'has createdAt');
  assertNotNull(data.updatedAt, 'has updatedAt');
}

// ── 4. POST: Create with minimal fields ─────────────────────────────

console.log('\n4. POST creates account with name only:');
{
  cleanup();
  const result = doPostAccount({ name: 'Minimal' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.name, 'Minimal', 'name matches');
  assertEqual(data.broker, null, 'broker defaults to null');
  assertEqual(data.currency, 'USD', 'currency defaults to USD');
  assertEqual(data.isActive, true, 'isActive defaults to true');
}

// ── 5. POST: Validation rejects missing name ─────────────────────────

console.log('\n5. POST returns 400 for missing name:');
{
  cleanup();
  const result = doPostAccount({ broker: 'IB' } as any);
  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Validation rejects empty name ───────────────────────────

console.log('\n6. POST returns 400 for empty name string:');
{
  cleanup();
  const result = doPostAccount({ name: '' });
  assert(result.status === 400, 'returns 400');
}

// ── 7. POST: Broker null handling ────────────────────────────────────

console.log('\n7. POST handles broker = null:');
{
  cleanup();
  const result = doPostAccount({ name: 'Null Broker', broker: null });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.broker, null, 'broker is null');
}

// ── 8. POST: Currency default handling ───────────────────────────────

console.log('\n8. POST handles currency default:');
{
  cleanup();
  const result = doPostAccount({ name: 'Default Currency' });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currency, 'USD', 'currency defaults to USD');
}

// ── 9. POST: Custom isActive false ─────────────────────────────────

console.log('\n9. POST accepts isActive = false:');
{
  cleanup();
  const result = doPostAccount({ name: 'Inactive', isActive: false });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.isActive, false, 'isActive is false');
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
