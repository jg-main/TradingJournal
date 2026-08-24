/**
 * account transactions route test
 *
 * Tests GET (list transactions, current balance) and POST (create deposit/withdrawal,
 * balance validation, account existence).
 *
 * Run: DB_FILE_NAME=./.test-txns.db npx tsx src/app/api/accounts/[id]/transactions/__tests__/route.test.ts
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

function doPostTransaction(
  accountId: string,
  body: Record<string, unknown>,
): { status: number; data: unknown } {
  try {
    const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
    if (!account) {
      return { status: 404, data: { error: 'Account not found' } };
    }

    const txnType = body.type as string;
    if (txnType !== 'deposit' && txnType !== 'withdrawal') {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { type: ['Invalid type'] } } } };
    }

    const amount = body.amount as number;
    if (!amount || amount <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { amount: ['Amount must be positive'] } } } };
    }

    // Compute current balance
    const allTxns = db
      .select()
      .from(schema.accountTransactions)
      .where(eq(schema.accountTransactions.accountId, accountId))
      .all();

    const totalDeposits = allTxns.reduce((sum, t) => sum + (t.type === 'deposit' ? t.amount : 0), 0);
    const totalWithdrawals = allTxns.reduce((sum, t) => sum + (t.type === 'withdrawal' ? t.amount : 0), 0);
    const currentBalance = totalDeposits - totalWithdrawals;

    if (txnType === 'withdrawal' && amount > currentBalance) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              amount: [`Withdrawal of $${amount.toFixed(2)} exceeds current balance of $${currentBalance.toFixed(2)}`],
            },
          },
        },
      };
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const balanceAfter = txnType === 'deposit' ? currentBalance + amount : currentBalance - amount;

    db.insert(schema.accountTransactions)
      .values({
        id,
        accountId,
        type: txnType as 'deposit' | 'withdrawal',
        amount,
        balanceAfter,
        date: (body.date as string) ?? now.split('T')[0],
        notes: (body.notes as string) ?? null,
        createdAt: now,
      })
      .run();

    const row = db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.id, id)).get();
    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create transaction', details: String(error) } };
  }
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

// ── 3. POST: Deposit increases balance ───────────────────────────────

console.log('\n3. POST deposit increases balance:');
{
  cleanup();
  const acctId = seedAccount();
  const r1 = doPostTransaction(acctId, { type: 'deposit', amount: 10000 });
  assert(r1.status === 201, 'deposit returns 201');
  const d1 = r1.data as Record<string, unknown>;
  assertEqual(d1.type, 'deposit', 'type is deposit');
  assertEqual(d1.amount, 10000, 'amount is 10000');
  assertEqual(d1.balanceAfter, 10000, 'balanceAfter is 10000');

  const r2 = doPostTransaction(acctId, { type: 'deposit', amount: 5000 });
  assert(r2.status === 201, 'second deposit returns 201');
  const d2 = r2.data as Record<string, unknown>;
  assertEqual(d2.balanceAfter, 15000, 'balanceAfter is 15000 after second deposit');
}

// ── 4. POST: Withdrawal decreases balance ────────────────────────────

console.log('\n4. POST withdrawal decreases balance:');
{
  cleanup();
  const acctId = seedAccount();
  doPostTransaction(acctId, { type: 'deposit', amount: 10000 });

  const result = doPostTransaction(acctId, { type: 'withdrawal', amount: 3000 });
  assert(result.status === 201, 'withdrawal returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.type, 'withdrawal', 'type is withdrawal');
  assertEqual(data.amount, 3000, 'amount is 3000');
  assertEqual(data.balanceAfter, 7000, 'balanceAfter is 7000');
}

// ── 5. POST: Withdrawal exceeding balance returns 400 ────────────────

console.log('\n5. POST withdrawal exceeding balance returns 400:');
{
  cleanup();
  const acctId = seedAccount();
  doPostTransaction(acctId, { type: 'deposit', amount: 1000 });

  const result = doPostTransaction(acctId, { type: 'withdrawal', amount: 2000 });
  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Invalid account returns 404 ─────────────────────────────

console.log('\n6. POST returns 404 for unknown account:');
{
  cleanup();
  const result = doPostTransaction(randomUUID(), { type: 'deposit', amount: 100 });
  assert(result.status === 404, 'returns 404');
}

// ── 7. POST: Invalid type returns 400 ────────────────────────────────

console.log('\n7. POST returns 400 for invalid type:');
{
  cleanup();
  const acctId = seedAccount();
  const result = doPostTransaction(acctId, { type: 'transfer', amount: 100 });
  assert(result.status === 400, 'returns 400');
}

// ── 8. POST: Zero/negative amount returns 400 ────────────────────────

console.log('\n8. POST returns 400 for zero amount:');
{
  cleanup();
  const acctId = seedAccount();
  const result = doPostTransaction(acctId, { type: 'deposit', amount: 0 });
  assert(result.status === 400, 'returns 400');
}

// ── 9. POST: Multiple deposits and withdrawals compute correct balance ─

console.log('\n9. Multiple deposits and withdrawals compute correct balance:');
{
  cleanup();
  const acctId = seedAccount();
  doPostTransaction(acctId, { type: 'deposit', amount: 5000 });
  doPostTransaction(acctId, { type: 'deposit', amount: 3000 });
  doPostTransaction(acctId, { type: 'withdrawal', amount: 1000 });
  doPostTransaction(acctId, { type: 'withdrawal', amount: 500 });

  const result = doGetTransactions(acctId);
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: unknown[]; currentBalance: number };
  assertEqual(body.currentBalance, 6500, 'balance is 5000 + 3000 - 1000 - 500 = 6500');
  assertEqual(body.data.length, 4, 'has 4 transactions');
}

// ── 10. POST: With custom date and notes ───────────────────────────

console.log('\n10. POST accepts custom date and notes:');
{
  cleanup();
  const acctId = seedAccount();
  const result = doPostTransaction(acctId, {
    type: 'deposit',
    amount: 2000,
    date: '2026-06-15',
    notes: 'Initial deposit',
  });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.date, '2026-06-15', 'date matches');
  assertEqual(data.notes, 'Initial deposit', 'notes match');
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
