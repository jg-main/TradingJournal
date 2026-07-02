/**
 * account by id route test
 *
 * Tests GET (rollforward + KPI), PUT (update), and DELETE (soft-deactivate) handlers.
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, inArray, and } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { calculatePnL, calculateRMultiple, type ExecutionData } from '@/lib/trade-calc';
import { canDeactivateAccount, canDeleteAccount, canReactivateAccount } from '@/lib/account-lifecycle';

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

// Create tables (FK-safe DROP order first, then CREATE order)
sqlite.exec(`
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS settings;
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

  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT REFERENCES accounts(id),
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL,
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    opened_at TEXT,
    closed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    executed_at TEXT,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    account_equity_at_open REAL,
    initial_entry_price REAL,
    initial_stop_price REAL,
    initial_quantity REAL,
    risk_per_share REAL,
    initial_risk_amount REAL,
    account_risk_pct REAL,
    planned_reward_risk REAL,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS trade_grades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    setup_quality_score INTEGER,
    risk_quality_score INTEGER,
    entry_quality_score INTEGER,
    management_quality_score INTEGER,
    exit_quality_score INTEGER,
    review_quality_score INTEGER,
    total_score REAL,
    grade_label TEXT,
    followed_plan INTEGER,
    rule_violation INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS account_transactions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetAccount(id: string): { status: number; data: unknown } {
  try {
    const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    if (!account) {
      return { status: 404, data: { error: 'Account not found' } };
    }

    // Fetch all closed trades for this account
    const closedTrades = db
      .select()
      .from(schema.trades)
      .where(and(eq(schema.trades.accountId, id), eq(schema.trades.status, 'closed')))
      .all();

    // Compute realized P&L across closed trades
    let realizedPnl = 0;
    let kpis = {
      tradeCount: 0,
      netPnl: 0,
      winRate: null as number | null,
      avgR: null as number | null,
      avgGrade: null as number | null,
    };

    if (closedTrades.length > 0) {
      const tradeIds = closedTrades.map((t) => t.id);

      // Fetch all executions for closed trades in one query
      const allExecutions = db
        .select()
        .from(schema.tradeExecutions)
        .where(inArray(schema.tradeExecutions.tradeId, tradeIds))
        .all();

      const execByTradeId = new Map<string, typeof allExecutions>();
      for (const exec of allExecutions) {
        const list = execByTradeId.get(exec.tradeId) ?? [];
        list.push(exec);
        execByTradeId.set(exec.tradeId, list);
      }

      // Compute P&L for each closed trade
      for (const trade of closedTrades) {
        const executions = execByTradeId.get(trade.id) ?? [];
        if (executions.length === 0) continue;

        const execData: ExecutionData[] = executions.map((e) => ({
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees ?? 0,
          executedAt: e.executedAt ?? trade.createdAt ?? new Date().toISOString(),
        }));

        const pnl = calculatePnL(execData, trade.direction);
        realizedPnl += pnl.totalRealizedPnL;
      }

      // Compute KPI metrics
      const riskSnapshots = db
        .select()
        .from(schema.tradeRiskSnapshots)
        .where(inArray(schema.tradeRiskSnapshots.tradeId, tradeIds))
        .all();

      const grades = db
        .select()
        .from(schema.tradeGrades)
        .where(inArray(schema.tradeGrades.tradeId, tradeIds))
        .all();

      const riskByTradeId = new Map(riskSnapshots.map((rs) => [rs.tradeId, rs]));
      const gradeByTradeId = new Map(grades.map((g) => [g.tradeId, g]));

      let winCount = 0;
      let netPnlForKpis = 0;
      const rMultiples: number[] = [];
      const gradeScores: number[] = [];

      for (const trade of closedTrades) {
        const executions = execByTradeId.get(trade.id) ?? [];
        if (executions.length === 0) continue;

        const execData: ExecutionData[] = executions.map((e) => ({
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees ?? 0,
          executedAt: e.executedAt ?? trade.createdAt ?? new Date().toISOString(),
        }));

        const pnl = calculatePnL(execData, trade.direction);
        netPnlForKpis += pnl.totalRealizedPnL;

        const risk = riskByTradeId.get(trade.id);
        if (risk?.initialRiskAmount != null && risk.initialRiskAmount > 0) {
          const rResult = calculateRMultiple(pnl.totalRealizedPnL, risk.initialRiskAmount);
          if (rResult.rMultiple !== null) rMultiples.push(rResult.rMultiple);
        }

        const grade = gradeByTradeId.get(trade.id);
        if (grade?.totalScore != null) gradeScores.push(grade.totalScore);

        if (pnl.totalRealizedPnL > 0) winCount++;
      }

      const decisions = closedTrades.filter(
        (t) => (execByTradeId.get(t.id)?.length ?? 0) > 0,
      ).length;

      kpis = {
        tradeCount: closedTrades.length,
        netPnl: netPnlForKpis,
        winRate: decisions > 0 ? winCount / decisions : null,
        avgR: rMultiples.length > 0
          ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
          : null,
        avgGrade: gradeScores.length > 0
          ? gradeScores.reduce((a, b) => a + b, 0) / gradeScores.length
          : null,
      };
    }

    // Fetch account transactions for deposits/withdrawals
    const transactions = db
      .select()
      .from(schema.accountTransactions)
      .where(eq(schema.accountTransactions.accountId, id))
      .all();

    const netDeposits = transactions
      .filter((t) => t.type === 'deposit')
      .reduce((s, t) => s + t.amount, 0);

    const netWithdrawals = transactions
      .filter((t) => t.type === 'withdrawal')
      .reduce((s, t) => s + t.amount, 0);

    // Compute current balance
    const startingBalance = account.startingBalance ?? 0;
    const currentBalance = startingBalance + netDeposits - netWithdrawals + realizedPnl;

    return {
      status: 200,
      data: {
        ...account,
        currentBalance,
        realizedPnl,
        netDeposits,
        netWithdrawals,
        kpis,
      },
    };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch account', details: String(error) } };
  }
}

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

    const accountTrades = db.select({ status: schema.trades.status }).from(schema.trades).where(eq(schema.trades.accountId, id)).all();

    if (body.isActive === false && !canDeactivateAccount(accountTrades)) {
      return { status: 409, data: { error: 'Cannot deactivate account with open trades' } };
    }

    if (body.isActive === true && !canReactivateAccount(accountTrades)) {
      return { status: 409, data: { error: 'Cannot reactivate account with open trades' } };
    }

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

    const accountTrades = db.select({ status: schema.trades.status }).from(schema.trades).where(eq(schema.trades.accountId, id)).all();

    if (!canDeleteAccount(accountTrades)) {
      return { status: 409, data: { error: 'Cannot delete account with any trade history' } };
    }

    db.delete(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .run();

    return { status: 200, data: { message: 'Account deleted' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to delete account', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_grades;');
  sqlite.exec('DELETE FROM trade_risk_snapshots;');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM account_transactions;');
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const genId = randomUUID();
  const id = overrides.id !== undefined ? (overrides.id as string) : genId;
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
      tradeCode: `TC-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
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

function seedExecution(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.tradeExecutions)
    .values({
      id,
      tradeId: overrides.tradeId as string,
      action: 'buy',
      quantity: 100,
      price: 150.0,
      fees: 0,
      executedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.tradeExecutions).where(eq(schema.tradeExecutions.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Account By ID API Tests ---\n');

// ═══════════════════════════════════════════════════════════════════
// EXISTING: PUT/DELETE tests (regression guard)
// ═══════════════════════════════════════════════════════════════════

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

// ── 7. PUT: Blocks inactivation while open trade exists ─────────────

console.log('\n7. PUT blocks inactivation with open trade:');
{
  cleanup();
  const account = seedAccount({ name: 'Open Trade Account', isActive: true });
  seedTrade({ accountId: account.id as string, status: 'open' });
  const result = doPutAccount(account.id as string, { isActive: false });

  assert(result.status === 409, 'returns 409');
  assertEqual((result.data as { error: string }).error, 'Cannot deactivate account with open trades', 'error message');
  const updated = db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id as string)).get() as Record<string, unknown>;
  assertEqual(updated.isActive, true, 'account remains active');
}

// ── 8. PUT: Reactivates inactive empty account ──────────────────────

console.log('\n8. PUT reactivates inactive account:');
{
  cleanup();
  const account = seedAccount({ name: 'Inactive Account', isActive: false });
  const result = doPutAccount(account.id as string, { isActive: true });

  assert(result.status === 200, 'returns 200');
  const updated = result.data as Record<string, unknown>;
  assertEqual(updated.isActive, true, 'response reports active account');
}

// ── 9. DELETE: Hard-deletes empty account ───────────────────────────

console.log('\n7. DELETE hard-deletes empty account:');
{
  cleanup();
  const account = seedAccount({ name: 'To Delete', isActive: true });
  const result = doDeleteAccount(account.id as string);

  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'Account deleted', 'message matches');

  const deleted = db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id as string)).get();
  assertEqual(deleted, undefined, 'account row is removed');
}

// ── 8. DELETE: 409 for historical-trade account ─────────────────────

console.log('\n8. DELETE blocks historical-trade account:');
{
  cleanup();
  const account = seedAccount({ name: 'Historical', isActive: true });
  seedTrade({ accountId: account.id as string, status: 'closed' });
  const result = doDeleteAccount(account.id as string);

  assert(result.status === 409, 'returns 409');
  assertEqual((result.data as { error: string }).error, 'Cannot delete account with any trade history', 'error message');
  const stillThere = db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id as string)).get() as Record<string, unknown>;
  assertEqual(stillThere.isActive, true, 'historical account remains active');
}

// ── 9. DELETE: 404 for nonexistent id ───────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════
// NEW: GET rollforward tests
// ═══════════════════════════════════════════════════════════════════

// ── 10. GET: 404 for nonexistent account ─────────────────────────────

console.log('\n10. GET returns 404 for nonexistent account:');
{
  cleanup();
  const result = doGetAccount('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Account not found', 'error message');
}

// ── 11. Rollforward: No trades, no transactions (with startingBalance) ──

console.log('\n11. Rollforward: no trades, no transactions (with startingBalance):');
{
  cleanup();
  const account = seedAccount({ name: 'Rollforward Test', startingBalance: 10000 });

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.currentBalance, 10000, 'currentBalance equals startingBalance');
  assertEqual(data.realizedPnl, 0, 'realizedPnl is 0');
  assertEqual(data.netDeposits, 0, 'netDeposits is 0');
  assertEqual(data.netWithdrawals, 0, 'netWithdrawals is 0');
}

// ── 12. Rollforward: No trades, no transactions (startingBalance = null) ─

console.log('\n12. Rollforward: no trades, no transactions (startingBalance = null):');
{
  cleanup();
  const account = seedAccount({ name: 'Null Start', startingBalance: null });

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.currentBalance, 0, 'currentBalance is 0 (null treated as 0)');
  assertEqual(data.realizedPnl, 0, 'realizedPnl is 0');
}

// ── 13. Rollforward: Closed trades, no transactions ────────────────────

console.log('\n13. Rollforward: closed trades (win), no transactions:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Trade Only', startingBalance: 10000 });

  const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: trade.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade.id, action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // P&L = (160 - 150) * 100 = 1000, fees = 0
  // currentBalance = 10000 + 0 - 0 + 1000 = 11000

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.currentBalance, 11000, 'currentBalance = startingBalance + realizedPnl');
  assertEqual(data.realizedPnl, 1000, 'realizedPnl = 1000 from winning trade');
  assertEqual(data.netDeposits, 0, 'netDeposits is 0');
  assertEqual(data.netWithdrawals, 0, 'netWithdrawals is 0');
}

// ── 14. Rollforward: Transactions AND closed trades ────────────────────

console.log('\n14. Rollforward: transactions AND closed trades:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Full Rollforward', startingBalance: 10000 });

  // Add a deposit of 2000
  const now = new Date().toISOString();
  db.insert(schema.accountTransactions)
    .values({
      id: randomUUID(),
      accountId: 'test-account-id',
      type: 'deposit',
      amount: 2000,
      balanceAfter: 12000,
      date: '2025-06-10T10:00:00Z',
      notes: null,
      createdAt: now,
    })
    .run();

  // Add a withdrawal of 500
  db.insert(schema.accountTransactions)
    .values({
      id: randomUUID(),
      accountId: 'test-account-id',
      type: 'withdrawal',
      amount: 500,
      balanceAfter: 11500,
      date: '2025-06-15T10:00:00Z',
      notes: null,
      createdAt: now,
    })
    .run();

  const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: trade.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade.id, action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // P&L = 1000, netDeposits = 2000, netWithdrawals = 500
  // currentBalance = 10000 + 2000 - 500 + 1000 = 12500

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.currentBalance, 12500, 'currentBalance = startingBalance + deposits - withdrawals + realizedPnl');
  assertEqual(data.realizedPnl, 1000, 'realizedPnl = 1000 from winning trade');
  assertEqual(data.netDeposits, 2000, 'netDeposits = 2000');
  assertEqual(data.netWithdrawals, 500, 'netWithdrawals = 500');
}

// ═══════════════════════════════════════════════════════════════════
// NEW: GET KPI tests
// ═══════════════════════════════════════════════════════════════════

// ── 15. KPI: No closed trades → tradeCount=0, netPnl=0, winRate=null, avgR=null, avgGrade=null ─

console.log('\n15. KPI: no closed trades returns empty KPIs:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'No Closed', startingBalance: 10000 });

  // Create an open trade (not closed) to verify it is excluded
  seedTrade({ accountId: 'test-account-id', status: 'open', symbol: 'TSLA' });

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  const kpis = data.kpis as Record<string, unknown>;

  assertEqual(kpis.tradeCount, 0, 'tradeCount is 0');
  assertEqual(kpis.netPnl, 0, 'netPnl is 0');
  assertEqual(kpis.winRate, null, 'winRate is null');
  assertEqual(kpis.avgR, null, 'avgR is null');
  assertEqual(kpis.avgGrade, null, 'avgGrade is null');
}

// ── 16. KPI: Closed trades with risk snapshots → avgR populated ────────

console.log('\n16. KPI: closed trades with risk snapshots populate avgR:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'AvgR Test', startingBalance: 10000 });

  // Trade 1: winning trade (P&L = +1000)
  const trade1 = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: trade1.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade1.id, action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // Risk snapshot for trade1 (initialRiskAmount = 500, so R = 1000/500 = 2.0)
  const now = new Date().toISOString();
  db.insert(schema.tradeRiskSnapshots)
    .values({
      id: randomUUID(),
      tradeId: trade1.id as string,
      initialRiskAmount: 500,
      accountEquityAtOpen: 10000,
      initialEntryPrice: 150.0,
      initialQuantity: 100,
      createdAt: now,
    })
    .run();

  // Trade 2: losing trade (P&L = -500)
  const trade2 = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'MSFT' });
  seedExecution({ tradeId: trade2.id, action: 'buy', quantity: 100, price: 200.0, executedAt: '2025-06-02T10:00:00Z' });
  seedExecution({ tradeId: trade2.id, action: 'sell', quantity: 100, price: 195.0, executedAt: '2025-06-02T11:00:00Z' });

  // Risk snapshot for trade2 (initialRiskAmount = 500, so R = -500/500 = -1.0)
  db.insert(schema.tradeRiskSnapshots)
    .values({
      id: randomUUID(),
      tradeId: trade2.id as string,
      initialRiskAmount: 500,
      accountEquityAtOpen: 10000,
      initialEntryPrice: 200.0,
      initialQuantity: 100,
      createdAt: now,
    })
    .run();

  // Expected: avgR = (2.0 + (-1.0)) / 2 = 0.5
  // netPnl = 1000 + (-500) = 500
  // tradeCount = 2
  // winRate = 1/2 = 0.5

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  const kpis = data.kpis as Record<string, unknown>;

  assertEqual(kpis.tradeCount, 2, 'tradeCount is 2');
  assertEqual(kpis.netPnl, 500, 'netPnl = 1000 + (-500) = 500');
  assertEqual(kpis.winRate, 0.5, 'winRate = 1/2 = 0.5');
  assertEqual(kpis.avgR, 0.5, 'avgR = (2.0 + (-1.0)) / 2 = 0.5');
  assertEqual(kpis.avgGrade, null, 'avgGrade is null (no grades)');
}

// ── 17. KPI: Closed trades with grades → avgGrade populated ────────────

console.log('\n17. KPI: closed trades with grades populate avgGrade:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'AvgGrade Test', startingBalance: 10000 });

  // Trade with grade
  const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: trade.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade.id, action: 'sell', quantity: 100, price: 155.0, executedAt: '2025-06-01T11:00:00Z' });

  const now = new Date().toISOString();
  db.insert(schema.tradeGrades)
    .values({
      id: randomUUID(),
      tradeId: trade.id as string,
      totalScore: 85,
      setupQualityScore: 8,
      riskQualityScore: 7,
      entryQualityScore: 9,
      managementQualityScore: 8,
      exitQualityScore: 8,
      reviewQualityScore: 9,
      gradeLabel: 'B+',
      followedPlan: true,
      ruleViolation: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  const kpis = data.kpis as Record<string, unknown>;

  assertEqual(kpis.tradeCount, 1, 'tradeCount is 1');
  assertEqual(kpis.avgGrade, 85, 'avgGrade = 85');
  assertEqual(kpis.avgR, null, 'avgR is null (no risk snapshots)');
}

// ── 18. KPI: Mixed trades with risk snapshots AND grades ──────────────

console.log('\n18. KPI: closed trades with both risk and grades:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Mixed KPI', startingBalance: 10000 });

  const now = new Date().toISOString();

  // Trade 1: win, P&L = 1000, R = 2.0, grade = 80
  const trade1 = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: trade1.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade1.id, action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  db.insert(schema.tradeRiskSnapshots)
    .values({
      id: randomUUID(),
      tradeId: trade1.id as string,
      initialRiskAmount: 500,
      createdAt: now,
    })
    .run();

  db.insert(schema.tradeGrades)
    .values({
      id: randomUUID(),
      tradeId: trade1.id as string,
      totalScore: 80,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Trade 2: loss, P&L = -600, R = -1.2, grade = 70
  const trade2 = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'MSFT' });
  seedExecution({ tradeId: trade2.id, action: 'buy', quantity: 100, price: 200.0, executedAt: '2025-06-02T10:00:00Z' });
  seedExecution({ tradeId: trade2.id, action: 'sell', quantity: 100, price: 194.0, executedAt: '2025-06-02T11:00:00Z' });

  db.insert(schema.tradeRiskSnapshots)
    .values({
      id: randomUUID(),
      tradeId: trade2.id as string,
      initialRiskAmount: 500,
      createdAt: now,
    })
    .run();

  db.insert(schema.tradeGrades)
    .values({
      id: randomUUID(),
      tradeId: trade2.id as string,
      totalScore: 70,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Expected: realizedPnl = 1000 + (-600) = 400
  // netPnl = 1000 + (-600) = 400
  // tradeCount = 2
  // winRate = 1/2 = 0.5
  // avgR = (1000/500 + (-600/500)) / 2 = (2.0 + (-1.2)) / 2 = 0.4
  // avgGrade = (80 + 70) / 2 = 75

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  const kpis = data.kpis as Record<string, unknown>;

  assertEqual(kpis.tradeCount, 2, 'tradeCount is 2');
  assertEqual(kpis.netPnl, 400, 'netPnl = 1000 + (-600) = 400');
  assertEqual(kpis.winRate, 0.5, 'winRate = 1/2 = 0.5');
  assertEqual(kpis.avgR, 0.4, 'avgR = (2.0 + (-1.2)) / 2 = 0.4');
  assertEqual(kpis.avgGrade, 75, 'avgGrade = (80 + 70) / 2 = 75');
}

// ── 19. GET: Returns rollforward fields even with no trades ────────────

console.log('\n19. GET returns all expected rollforward fields:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Field Check', startingBalance: 5000 });

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  // Verify all rollforward fields are present
  assertNotNull(data.currentBalance, 'currentBalance is present');
  assertNotNull(data.realizedPnl, 'realizedPnl is present');
  assertNotNull(data.netDeposits, 'netDeposits is present');
  assertNotNull(data.netWithdrawals, 'netWithdrawals is present');
  assertNotNull(data.kpis, 'kpis is present');

  // Verify account fields are preserved
  assertEqual(data.id, account.id, 'account id is preserved');
  assertEqual(data.name, 'Field Check', 'account name is preserved');
  assertEqual(data.startingBalance, 5000, 'startingBalance is preserved');
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
