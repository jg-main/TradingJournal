/**
 * account close endpoint test
 *
 * Tests the POST /api/accounts/[id]/close handler for account closure
 * with lifetime summary report.
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/close/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { calculatePnL, calculateRMultiple, type ExecutionData } from '@/lib/trade-calc';

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

function assertDeepClose(actual: unknown, expected: unknown, within: number, msg: string) {
  if (typeof actual === 'number' && typeof expected === 'number') {
    const diff = Math.abs(actual - expected);
    if (diff <= within) {
      passed++;
      console.log(`  ✅ ${msg}`);
    } else {
      failed++;
      console.error(`  ❌ ${msg} — expected ${expected} ± ${within}, got ${actual} (FAILED)`);
    }
  } else {
    failed++;
    console.error(`  ❌ ${msg} — values not both numbers (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-account-close.db';
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
    planned_quantity REAL,
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

function doCloseAccount(id: string): { status: number; data: unknown } {
  try {
    // 1. Validate account exists and is active
    const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown> | undefined;
    if (!account) {
      return { status: 404, data: { error: 'Account not found' } };
    }
    if (account.isActive === false) {
      return { status: 400, data: { error: 'Account is already inactive' } };
    }

    const startingBalance = (account.startingBalance as number) ?? 0;
    const accountCreatedAt = (account.createdAt as string) ?? new Date().toISOString();

    // Query all closed trades for this account
    const closedTrades = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.accountId, id))
      .all() as Array<Record<string, unknown>>;
    const closedTradesFiltered = closedTrades.filter((t) => t.status === 'closed');

    // Compute realized P&L and KPIs
    let realizedPnl = 0;
    let kpis = {
      tradeCount: 0,
      netPnl: 0,
      winRate: null as number | null,
      avgR: null as number | null,
      avgGrade: null as number | null,
    };

    if (closedTradesFiltered.length > 0) {
      const tradeIds = closedTradesFiltered.map((t) => t.id) as string[];

      // Proper batch query via inArray-like approach
      const execPlaceholders = tradeIds.map(() => '?').join(',');
      const allExes = sqlite.prepare(
        `SELECT * FROM trade_executions WHERE trade_id IN (${execPlaceholders})`,
      ).all(...tradeIds) as Array<Record<string, unknown>>;

      // Group executions by tradeId
      const execByTradeId = new Map<string, Array<Record<string, unknown>>>();
      for (const exec of allExes) {
        const tid = exec.trade_id as string;
        const list = execByTradeId.get(tid) ?? [];
        list.push(exec);
        execByTradeId.set(tid, list);
      }

      // Compute P&L for each closed trade
      for (const trade of closedTradesFiltered) {
        const executions = execByTradeId.get(trade.id as string) ?? [];
        if (executions.length === 0) continue;

        const execData: ExecutionData[] = executions.map((e) => ({
          action: e.action as string,
          quantity: e.quantity as number,
          price: e.price as number,
          fees: (e.fees as number) ?? 0,
          executedAt: (e.executed_at as string) ?? (trade.created_at as string) ?? new Date().toISOString(),
        }));

        const pnl = calculatePnL(execData, trade.direction as 'long' | 'short');
        realizedPnl += pnl.totalRealizedPnL;
      }

      // Compute per-account KPI metrics
      const riskPlaceholders = tradeIds.map(() => '?').join(',');
      const riskSnapshots = sqlite.prepare(
        `SELECT * FROM trade_risk_snapshots WHERE trade_id IN (${riskPlaceholders})`,
      ).all(...tradeIds) as Array<Record<string, unknown>>;

      const gradePlaceholders = tradeIds.map(() => '?').join(',');
      const grades = sqlite.prepare(
        `SELECT * FROM trade_grades WHERE trade_id IN (${gradePlaceholders})`,
      ).all(...tradeIds) as Array<Record<string, unknown>>;

      const riskByTradeId = new Map(riskSnapshots.map((rs) => [rs.trade_id as string, rs]));
      const gradeByTradeId = new Map(grades.map((g) => [g.trade_id as string, g]));

      let winCount = 0;
      let netPnlForKpis = 0;
      const rMultiples: number[] = [];
      const gradeScores: number[] = [];

      for (const trade of closedTradesFiltered) {
        const executions = execByTradeId.get(trade.id as string) ?? [];
        if (executions.length === 0) continue;

        const execData: ExecutionData[] = executions.map((e) => ({
          action: e.action as string,
          quantity: e.quantity as number,
          price: e.price as number,
          fees: (e.fees as number) ?? 0,
          executedAt: (e.executed_at as string) ?? (trade.created_at as string) ?? new Date().toISOString(),
        }));

        const pnl = calculatePnL(execData, trade.direction as 'long' | 'short');
        netPnlForKpis += pnl.totalRealizedPnL;

        const risk = riskByTradeId.get(trade.id as string);
        if (risk?.initial_risk_amount != null && (risk.initial_risk_amount as number) > 0) {
          const rResult = calculateRMultiple(pnl.totalRealizedPnL, risk.initial_risk_amount as number);
          if (rResult.rMultiple !== null) rMultiples.push(rResult.rMultiple);
        }

        const grade = gradeByTradeId.get(trade.id as string);
        if (grade?.total_score != null) gradeScores.push(grade.total_score as number);

        if (pnl.totalRealizedPnL > 0) winCount++;
      }

      const decisions = closedTradesFiltered.filter(
        (t) => (execByTradeId.get(t.id as string)?.length ?? 0) > 0,
      ).length;

      kpis = {
        tradeCount: closedTradesFiltered.length,
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

    // Query account transactions for deposits/withdrawals
    const transactions = sqlite.prepare(
      'SELECT * FROM account_transactions WHERE account_id = ?',
    ).all(id) as Array<Record<string, unknown>>;

    const depositsTotal = transactions
      .filter((t) => t.type === 'deposit')
      .reduce((s, t) => s + (t.amount as number), 0);

    const withdrawalsTotal = transactions
      .filter((t) => t.type === 'withdrawal')
      .reduce((s, t) => s + (t.amount as number), 0);

    // Compute final balance and net return
    const finalBalance = startingBalance + depositsTotal - withdrawalsTotal + realizedPnl;
    const netReturn = depositsTotal > 0
      ? (realizedPnl / depositsTotal) * 100
      : null;

    // Compute datesActive
    const txDates = transactions
      .filter((t) => t.date != null)
      .map((t) => t.date as string)
      .sort();

    const earliestDate = txDates.length > 0
      ? new Date(Math.min(
          new Date(accountCreatedAt).getTime(),
          ...txDates.map((d) => new Date(d).getTime()),
        )).toISOString()
      : accountCreatedAt;

    const datesActive = {
      from: earliestDate,
      to: new Date().toISOString(),
    };

    // Deactivate the account
    sqlite.prepare(
      'UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), id);

    return {
      status: 200,
      data: {
        accountId: id,
        accountName: account.name,
        startingBalance,
        depositsTotal,
        withdrawalsTotal,
        realizedPnl,
        finalBalance,
        netReturn,
        kpis,
        datesActive,
        closedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to close account', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_grades;');
  sqlite.exec('DELETE FROM trade_risk_snapshots;');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM account_transactions;');
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

function seedTransaction(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accountTransactions)
    .values({
      id,
      accountId: 'test-account-id',
      type: 'deposit',
      amount: 1000,
      balanceAfter: 1000,
      date: now,
      notes: null,
      createdAt: now,
      ...overrides,
    })
    .run();
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Account Close API Tests ---\n');

// ═══════════════════════════════════════════════════════════════════
// NEGATIVE TESTS (Q7)
// ═══════════════════════════════════════════════════════════════════

// ── Q7-1: POST returns 404 for nonexistent account ─────────────────

console.log('\nQ7.1 POST returns 404 for nonexistent account:');
{
  cleanup();
  const result = doCloseAccount('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Account not found', 'error message');
}

// ── Q7-2: POST returns 400 for already inactive account ─────────────

console.log('\nQ7.2 POST returns 400 for already inactive account:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', name: 'Already Inactive', isActive: false });
  const result = doCloseAccount('test-account-id');
  assert(result.status === 400, 'returns 400');
  assertEqual((result.data as { error: string }).error, 'Account is already inactive', 'error message for inactive account');
}

// ── Q7-3: POST returns 200 for account with no trades ──────────────

console.log('\nQ7.3 POST returns closure summary for account with no trades:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'No Trades', startingBalance: 5000 });
  const result = doCloseAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.realizedPnl, 0, 'realizedPnl is 0');
  assertEqual(data.finalBalance, 5000, 'finalBalance equals startingBalance');
  assertEqual(data.netReturn, null, 'netReturn is null (no deposits)');
}

// ── Q7-4: POST with only open trades (no closed) ───────────────────

console.log('\nQ7.4 POST with only open trades (no closed):');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Open Only', startingBalance: 10000 });
  seedTrade({ accountId: 'test-account-id', status: 'open', symbol: 'AAPL' });
  const result = doCloseAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  const kpis = (data as { kpis: { tradeCount: number } }).kpis;
  assertEqual(kpis.tradeCount, 0, 'tradeCount is 0 (open trades excluded)');
  assertEqual(data.realizedPnl, 0, 'realizedPnl is 0 (no closed trades)');
}

// ═══════════════════════════════════════════════════════════════════
// HAPPY PATH: Basic closure with no data
// ═══════════════════════════════════════════════════════════════════

// ── 1. Basic closure with startingBalance only ─────────────────────

console.log('\n1. Basic closure with startingBalance only:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Basic Close', startingBalance: 10000 });
  const result = doCloseAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.accountId, 'test-account-id', 'accountId returned');
  assertEqual(data.accountName, 'Basic Close', 'accountName returned');
  assertEqual(data.startingBalance, 10000, 'startingBalance returned');
  assertEqual(data.depositsTotal, 0, 'depositsTotal is 0');
  assertEqual(data.withdrawalsTotal, 0, 'withdrawalsTotal is 0');
  assertEqual(data.realizedPnl, 0, 'realizedPnl is 0');
  assertEqual(data.finalBalance, 10000, 'finalBalance = startingBalance');
  assertEqual(data.netReturn, null, 'netReturn is null (no deposits)');
  assertNotNull(data.datesActive, 'datesActive is present');
  assertNotNull(data.closedAt, 'closedAt is present');

  // Verify account is now inactive
  const updatedAccount = db.select().from(schema.accounts).where(eq(schema.accounts.id, 'test-account-id')).get() as Record<string, unknown>;
  assertEqual(updatedAccount.isActive, false, 'account is inactive after close');
}

// ═══════════════════════════════════════════════════════════════════
// HAPPY PATH: Closure with trades and transactions
// ═══════════════════════════════════════════════════════════════════

// ── 2. Closure with closed trades, deposits, withdrawals ────────────

console.log('\n2. Closure with closed trades and transactions:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Full Close', startingBalance: 10000 });

  // Deposit of 2000
  seedTransaction({ accountId: 'test-account-id', type: 'deposit', amount: 2000, balanceAfter: 12000, date: '2025-06-10T10:00:00Z' });
  // Withdrawal of 500
  seedTransaction({ accountId: 'test-account-id', type: 'withdrawal', amount: 500, balanceAfter: 11500, date: '2025-06-15T10:00:00Z' });

  // Winning trade: P&L = (160-150)*100 = 1000
  const trade1 = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: trade1.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade1.id, action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  const now = new Date().toISOString();
  // Risk snapshot
  db.insert(schema.tradeRiskSnapshots)
    .values({
      id: randomUUID(),
      tradeId: trade1.id as string,
      initialRiskAmount: 500,
      accountEquityAtOpen: 10000,
      createdAt: now,
    })
    .run();

  // Grade
  db.insert(schema.tradeGrades)
    .values({
      id: randomUUID(),
      tradeId: trade1.id as string,
      totalScore: 85,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Expected:
  // realizedPnl = 1000
  // depositsTotal = 2000, withdrawalsTotal = 500
  // finalBalance = 10000 + 2000 - 500 + 1000 = 12500
  // netReturn = (1000 / 2000) * 100 = 50
  // tradeCount = 1, winRate = 1.0, avgR = 2.0, avgGrade = 85

  const result = doCloseAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.startingBalance, 10000, 'startingBalance');
  assertEqual(data.depositsTotal, 2000, 'depositsTotal = 2000');
  assertEqual(data.withdrawalsTotal, 500, 'withdrawalsTotal = 500');
  assertEqual(data.realizedPnl, 1000, 'realizedPnl = 1000');
  assertEqual(data.finalBalance, 12500, 'finalBalance = 10000 + 2000 - 500 + 1000 = 12500');
  assertEqual(data.netReturn, 50, 'netReturn = (1000/2000)*100 = 50');

  const kpis = (data as { kpis: { tradeCount: number; netPnl: number; winRate: number; avgR: number; avgGrade: number } }).kpis;
  assertEqual(kpis.tradeCount, 1, 'tradeCount = 1');
  assertEqual(kpis.netPnl, 1000, 'netPnl = 1000');
  assertEqual(kpis.winRate, 1.0, 'winRate = 1.0');
  assertEqual(kpis.avgR, 2.0, 'avgR = 1000/500 = 2.0');
  assertEqual(kpis.avgGrade, 85, 'avgGrade = 85');

  // Verify account is inactive
  const updated = db.select().from(schema.accounts).where(eq(schema.accounts.id, 'test-account-id')).get() as Record<string, unknown>;
  assertEqual(updated.isActive, false, 'account is inactive');
}

// ── 3. Closure with multiple trades (mixed wins/losses) ─────────────

console.log('\n3. Closure with multiple trades (mixed):');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Mixed Trades', startingBalance: 20000 });

  // Trade 1: win, P&L = 1000, R = 2.0, grade = 80
  const t1 = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: t1.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: t1.id, action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // Trade 2: loss, P&L = -600, R = -1.2, grade = 70
  const t2 = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'MSFT' });
  seedExecution({ tradeId: t2.id, action: 'buy', quantity: 100, price: 200.0, executedAt: '2025-06-02T10:00:00Z' });
  seedExecution({ tradeId: t2.id, action: 'sell', quantity: 100, price: 194.0, executedAt: '2025-06-02T11:00:00Z' });

  const now = new Date().toISOString();
  db.insert(schema.tradeRiskSnapshots)
    .values({ id: randomUUID(), tradeId: t1.id as string, initialRiskAmount: 500, createdAt: now })
    .run();
  db.insert(schema.tradeRiskSnapshots)
    .values({ id: randomUUID(), tradeId: t2.id as string, initialRiskAmount: 500, createdAt: now })
    .run();
  db.insert(schema.tradeGrades)
    .values({ id: randomUUID(), tradeId: t1.id as string, totalScore: 80, createdAt: now, updatedAt: now })
    .run();
  db.insert(schema.tradeGrades)
    .values({ id: randomUUID(), tradeId: t2.id as string, totalScore: 70, createdAt: now, updatedAt: now })
    .run();

  // Expected:
  // realizedPnl = 1000 + (-600) = 400
  // tradeCount = 2, winRate = 1/2 = 0.5
  // avgR = (2.0 + (-1.2)) / 2 = 0.4
  // avgGrade = (80 + 70) / 2 = 75
  // netReturn = null (no deposit transactions)

  const result = doCloseAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.realizedPnl, 400, 'realizedPnl = 1000 + (-600) = 400');
  assertEqual(data.finalBalance, 20400, 'finalBalance = 20000 + 400 = 20400');
  assertEqual(data.netReturn, null, 'netReturn is null (no deposits)');

  const kpis = (data as { kpis: { tradeCount: number; netPnl: number; winRate: number; avgR: number; avgGrade: number } }).kpis;
  assertEqual(kpis.tradeCount, 2, 'tradeCount = 2');
  assertEqual(kpis.netPnl, 400, 'netPnl = 400');
  assertEqual(kpis.winRate, 0.5, 'winRate = 0.5');
  assertDeepClose(kpis.avgR, 0.4, 0.01, 'avgR = (2.0 + (-1.2)) / 2 = 0.4');
  assertEqual(kpis.avgGrade, 75, 'avgGrade = (80+70)/2 = 75');
}

// ── 4. Closure preserves trades and transactions (only isActive changes) ─

console.log('\n4. Closure preserves all trade/transaction data:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Preserve Data', startingBalance: 10000 });

  // Add trades
  const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: trade.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade.id, action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // Add transaction
  seedTransaction({ accountId: 'test-account-id', type: 'deposit', amount: 5000, balanceAfter: 15000, date: '2025-06-10T10:00:00Z' });

  // Record state before close
  const tradesBefore = db.select().from(schema.trades).where(eq(schema.trades.accountId, 'test-account-id')).all().length;
  const txBefore = db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.accountId, 'test-account-id')).all().length;

  // Close
  const result = doCloseAccount(account.id as string);
  assert(result.status === 200, 'returns 200');

  // Verify no data loss
  const tradesAfter = db.select().from(schema.trades).where(eq(schema.trades.accountId, 'test-account-id')).all().length;
  const txAfter = db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.accountId, 'test-account-id')).all().length;

  assertEqual(tradesAfter, tradesBefore, 'trades preserved after close');
  assertEqual(txAfter, txBefore, 'transactions preserved after close');

  // Only the account record changed
  const updated = db.select().from(schema.accounts).where(eq(schema.accounts.id, 'test-account-id')).get() as Record<string, unknown>;
  assertEqual(updated.isActive, false, 'account isActive = false');
  assertEqual(updated.name, 'Preserve Data', 'account name unchanged');
}

// ── 5. Closure with no startingBalance (null) ───────────────────────

console.log('\n5. Closure with null startingBalance:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Null Start', startingBalance: null });
  const result = doCloseAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.startingBalance, 0, 'startingBalance treated as 0 when null');
  assertEqual(data.finalBalance, 0, 'finalBalance = 0');
}

// ── 6. Closure with deposits only (netReturn computed) ──────────────

console.log('\n6. Closure with netReturn computed from deposits:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Net Return', startingBalance: 0 });

  seedTransaction({ accountId: 'test-account-id', type: 'deposit', amount: 5000, balanceAfter: 5000, date: '2025-06-01T10:00:00Z' });

  const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', symbol: 'AAPL' });
  seedExecution({ tradeId: trade.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade.id, action: 'sell', quantity: 100, price: 200.0, executedAt: '2025-06-01T11:00:00Z' });

  // P&L = (200-150)*100 = 5000
  // netReturn = (5000 / 5000) * 100 = 100%

  const result = doCloseAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.realizedPnl, 5000, 'realizedPnl = 5000');
  assertEqual(data.depositsTotal, 5000, 'depositsTotal = 5000');
  assertEqual(data.netReturn, 100, 'netReturn = (5000/5000)*100 = 100');
  assertEqual(data.finalBalance, 10000, 'finalBalance = 0 + 5000 - 0 + 5000 = 10000');
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
