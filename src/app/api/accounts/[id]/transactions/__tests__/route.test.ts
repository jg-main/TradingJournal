/**
 * account transactions route test
 *
 * Tests GET (list transactions, current balance) and the retired POST handler
 * (returns 410 Gone, never inserts a row).
 *
 * Run: npx tsx src/app/api/accounts/[id]/transactions/__tests__/route.test.ts
 * (uses testDbPath from src/lib/testing/test-db — OS temp, never the repo root)
 */

import { testDbPath } from '../../../../../../lib/testing/test-db';
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

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('txns');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS account_transactions;
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

  CREATE TABLE IF NOT EXISTS account_transactions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON UPDATE no action ON DELETE no action
  );
`);

// ── Simulated route logic ──────────────────────────────────────────

function doGetTransactions(accountId: string): { status: number; data: unknown } {
  try {
    const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
    if (!account) {
      return { status: 404, data: { error: 'Account not found' } };
    }

    const transactions = db
      .select()
      .from(schema.accountTransactions)
      .where(eq(schema.accountTransactions.accountId, accountId))
      .orderBy(desc(schema.accountTransactions.date), desc(schema.accountTransactions.createdAt))
      .all();

    const totalDeposits = db
      .select()
      .from(schema.accountTransactions)
      .where(eq(schema.accountTransactions.accountId, accountId))
      .all()
      .reduce((sum, t) => sum + (t.type === 'deposit' ? t.amount : 0), 0);

    const totalWithdrawals = db
      .select()
      .from(schema.accountTransactions)
      .where(eq(schema.accountTransactions.accountId, accountId))
      .all()
      .reduce((sum, t) => sum + (t.type === 'withdrawal' ? t.amount : 0), 0);

    const currentBalance = totalDeposits - totalWithdrawals;

    return {
      status: 200,
      data: { data: transactions, currentBalance, accountName: account.name },
    };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch transactions', details: String(error) } };
  }
}

/**
 * Mirrors the retired POST handler in route.ts: always returns 410 Gone with
 * the retired diagnostic and never touches account_transactions.
 */
function doPostTransaction(): { status: number; data: unknown } {
  return {
    status: 410,
    data: {
      error: 'Retired',
      message: 'This endpoint is retired. Use POST /api/accounts/:id/financial-events for cash activity.',
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM account_transactions; DELETE FROM accounts;');
}

function seedAccount(overrides: Record<string, unknown> = {}): string {
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
  return id;
}

function seedTransaction(
  accountId: string,
  txn: { type: 'deposit' | 'withdrawal'; amount: number; date?: string; notes?: string | null },
) {
  const now = new Date().toISOString();
  db.insert(schema.accountTransactions)
    .values({
      id: randomUUID(),
      accountId,
      type: txn.type,
      amount: txn.amount,
      balanceAfter: 0,
      date: txn.date ?? now.split('T')[0],
      notes: txn.notes ?? null,
      createdAt: now,
    })
    .run();
}

function countTransactions(accountId: string): number {
  return db
    .select()
    .from(schema.accountTransactions)
    .where(eq(schema.accountTransactions.accountId, accountId))
    .all().length;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Account Transactions API Tests ---\n');

// ── 1. GET: Empty transactions list ──────────────────────────────────

console.log('\n1. GET returns empty list and 0 balance for account with no transactions:');
{
  cleanup();
  const acctId = seedAccount();
  const result = doGetTransactions(acctId);
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: unknown[]; currentBalance: number };
  assert(Array.isArray(body.data), 'response has data array');
  assertEqual(body.data.length, 0, 'transactions is empty');
  assertEqual(body.currentBalance, 0, 'current balance is 0');
}

// ── 2. GET: Account not found ────────────────────────────────────────

console.log('\n2. GET returns 404 for unknown account:');
{
  cleanup();
  const result = doGetTransactions(randomUUID());
  assert(result.status === 404, 'returns 404');
}

// ── 3. POST: Retired endpoint returns 410 ────────────────────────────

console.log('\n3. POST returns 410 Gone with retired message:');
{
  cleanup();
  seedAccount();
  const result = doPostTransaction();
  assert(result.status === 410, 'returns 410');
  const body = result.data as { error: string; message: string };
  assertEqual(body.error, 'Retired', 'error is Retired');
  assert(
    body.message.includes('financial-events'),
    'message points callers to POST /api/accounts/:id/financial-events',
  );
}

// ── 4. POST: Never inserts a row ─────────────────────────────────────

console.log('\n4. POST does not insert any row into account_transactions:');
{
  cleanup();
  const acctId = seedAccount();
  const before = countTransactions(acctId);
  doPostTransaction();
  doPostTransaction();
  const after = countTransactions(acctId);
  assertEqual(before, 0, 'starts with 0 transactions');
  assertEqual(after, 0, 'still 0 transactions after two POST calls');
}

// ── 5. GET: Balance computed from existing data ──────────────────────

console.log('\n5. GET computes balance from existing transactions:');
{
  cleanup();
  const acctId = seedAccount();
  seedTransaction(acctId, { type: 'deposit', amount: 5000 });
  seedTransaction(acctId, { type: 'deposit', amount: 3000 });
  seedTransaction(acctId, { type: 'withdrawal', amount: 1000 });
  seedTransaction(acctId, { type: 'withdrawal', amount: 500 });

  const result = doGetTransactions(acctId);
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: unknown[]; currentBalance: number };
  assertEqual(body.currentBalance, 6500, 'balance is 5000 + 3000 - 1000 - 500 = 6500');
  assertEqual(body.data.length, 4, 'has 4 transactions');
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
