/**
 * account by id route test
 *
 * Tests GET (rollforward + KPI), PUT (update), and DELETE (soft-deactivate) handlers.
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, inArray, and } from 'drizzle-orm';

import * as schema from '@/db/schema';

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
  DROP TABLE IF EXISTS financial_events;
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
    backup_enabled INTEGER DEFAULT 0,
    backup_retention_count INTEGER DEFAULT 3,
    backup_last_run_at TEXT,
    backup_last_run_status TEXT,
    backup_cron_time TEXT DEFAULT '02:00',
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
    current_price REAL,
    current_price_fetched_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    gross_realized_pnl REAL,
    net_realized_pnl REAL,
    realized_fees REAL,
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

  CREATE TABLE IF NOT EXISTS financial_events (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    event_type TEXT NOT NULL,
    idempotency_key TEXT,
    description TEXT,
    payload TEXT,
    effect TEXT,
    posted_at TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS account_performance (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    computed_as_of TEXT,
    net_cash TEXT,
    nav TEXT,
    marked_positions TEXT,
    realized_pnl TEXT,
    unrealized_pnl TEXT,
    total_pnl TEXT,
    realized_fees TEXT,
    gross_exposure TEXT,
    net_exposure TEXT,
    warnings TEXT DEFAULT '[]',
    positions_json TEXT DEFAULT '[]',
    rebuild_count INTEGER DEFAULT 0,
    last_rebuilt_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Seed function for accounting projection ────────────────────────

function seedAccountingProjection(
  accountId: string,
  overrides?: Record<string, string | null>,
): void {
  const defaults = {
    nav: '0.00',
    net_cash: '0.00',
    marked_positions: '0.00',
    realized_pnl: '0.00',
    unrealized_pnl: '0.00',
    total_pnl: '0.00',
    realized_fees: '0.00',
    gross_exposure: '0.00',
    net_exposure: '0.00',
    computed_as_of: new Date().toISOString(),
    last_rebuilt_at: new Date().toISOString(),
    rebuild_count: 1,
  };
  const vals = { ...defaults, ...overrides };
  sqlite.prepare(`
    INSERT OR REPLACE INTO account_performance
      (id, account_id, computed_as_of, net_cash, nav, marked_positions,
       realized_pnl, unrealized_pnl, total_pnl, realized_fees,
       gross_exposure, net_exposure, rebuild_count, last_rebuilt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    randomUUID(), accountId, vals.computed_as_of,
    vals.net_cash, vals.nav, vals.marked_positions,
    vals.realized_pnl, vals.unrealized_pnl, vals.total_pnl,
    vals.realized_fees, vals.gross_exposure, vals.net_exposure,
    vals.rebuild_count, vals.last_rebuilt_at,
  );
}

// ── Simulated route logic ───────────────────────────────────────────

function doGetAccount(id: string): { status: number; data: unknown } {
  try {
    const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    if (!account) {
      return { status: 404, data: { error: 'Account not found' } };
    }

    // Query accounting projection (authoritative source post-cutover)
    const projection = sqlite
      .prepare('SELECT * FROM account_performance WHERE account_id = ?')
      .get(id) as Record<string, unknown> | undefined;

    const nav = projection?.nav ? parseFloat(projection.nav as string) : null;
    const realizedPnl = projection?.realized_pnl ? parseFloat(projection.realized_pnl as string) : null;
    const netCash = projection?.net_cash ? parseFloat(projection.net_cash as string) : null;
    const markedPositions = projection?.marked_positions ? parseFloat(projection.marked_positions as string) : null;
    const unrealizedPnl = projection?.unrealized_pnl ? parseFloat(projection.unrealized_pnl as string) : null;
    const totalPnl = projection?.total_pnl ? parseFloat(projection.total_pnl as string) : null;
    const realizedFees = projection?.realized_fees ? parseFloat(projection.realized_fees as string) : null;
    const grossExposure = projection?.gross_exposure ? parseFloat(projection.gross_exposure as string) : null;
    const netExposure = projection?.net_exposure ? parseFloat(projection.net_exposure as string) : null;

    return {
      status: 200,
      data: {
        ...account,
        nav,
        netCash,
        markedPositions,
        currentBalance: nav,
        realizedPnl,
        unrealizedPnl,
        totalPnl,
        realizedFees,
        grossExposure,
        netExposure,
        kpis: null,
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

    // Currency mutation guard (D4): base currency is fixed once the account has
    // financial history (financial_events rows). Mirrors the real PUT handler.
    if (body.currency !== undefined && body.currency !== existing.currency) {
      const eventRow = sqlite
        .prepare('SELECT COUNT(*) AS count FROM financial_events WHERE account_id = ?')
        .get(id) as { count: number };
      if (eventRow.count > 0) {
        return {
          status: 409,
          data: {
            error:
              'Cannot change base currency: account has financial history. ' +
              'Base currency is fixed once financial events are posted; ' +
              'create a new account for a different base currency.',
          },
        };
      }
    }

    // Validate trading default fields (mirrors real PUT zod schema)
    if (body.maxRiskPerTradePct !== undefined && body.maxRiskPerTradePct !== null && (typeof body.maxRiskPerTradePct !== 'number' || (body.maxRiskPerTradePct as number) <= 0)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { maxRiskPerTradePct: ['Number must be greater than 0'] } } } };
    }
    if (body.defaultCommission !== undefined && body.defaultCommission !== null && (typeof body.defaultCommission !== 'number' || (body.defaultCommission as number) < 0)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { defaultCommission: ['Number must be greater than or equal to 0'] } } } };
    }
    if (body.startingBalance !== undefined && body.startingBalance !== null && (typeof body.startingBalance !== 'number' || (body.startingBalance as number) < 0)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { startingBalance: ['Number must be greater than or equal to 0'] } } } };
    }

    const updateData: Partial<typeof schema.accounts.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.broker !== undefined) updateData.broker = body.broker;
    if (body.currency !== undefined) updateData.currency = body.currency;
    if (body.maxRiskPerTradePct !== undefined) updateData.maxRiskPerTradePct = body.maxRiskPerTradePct as number | null | undefined;
    if (body.defaultCommission !== undefined) updateData.defaultCommission = body.defaultCommission as number | null | undefined;
    if (body.startingBalance !== undefined) updateData.startingBalance = body.startingBalance as number | null | undefined;

    const accountTrades = db.select({ status: schema.trades.status }).from(schema.trades).where(eq(schema.trades.accountId, id)).all();

    if (body.isActive === false && !canDeactivateAccount(accountTrades)) {
      return { status: 409, data: { error: 'Cannot deactivate account with open trades' } };
    }

    if (body.isActive === true && !canReactivateAccount(accountTrades)) {
      return { status: 409, data: { error: 'Cannot reactivate account with open trades' } };
    }

    if (body.isActive !== undefined) updateData.isActive = body.isActive as boolean | null | undefined;

    db.update(schema.accounts)
      .set(updateData)
      .where(eq(schema.accounts.id, id))
      .run();

    // Default-account coherence (D6): deactivating the settings default
    // clears the stale reference so resolution falls back to first active.
    if (body.isActive === false) {
      sqlite.prepare(
        'UPDATE settings SET default_account_id = NULL, updated_at = ? WHERE default_account_id = ?',
      ).run(new Date().toISOString(), id);
    }

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
  sqlite.exec('DELETE FROM financial_events;');
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

function seedFinancialEvent(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.financialEvents)
    .values({
      id,
      accountId: overrides.accountId as string,
      eventType: 'opening_balance',
      postedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.financialEvents).where(eq(schema.financialEvents.id, id)).get() as Record<string, unknown>;
}

function seedSettings(defaultAccountId: string | null) {
  const now = new Date().toISOString();
  db.insert(schema.settings)
    .values({
      id: 'settings-default',
      defaultAccountId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
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

// ── 11. Accounting projection: populated values ──────────────────────

console.log('\n11. GET returns accounting projection values:');
{
  cleanup();
  const account = seedAccount({ name: 'Proj Test', startingBalance: 10000 });
  seedAccountingProjection(account.id as string, {
    nav: '1002.20',
    net_cash: '632.50',
    marked_positions: '369.70',
    realized_pnl: '-17.00',
    unrealized_pnl: '19.20',
    total_pnl: '2.20',
    realized_fees: '0.00',
    gross_exposure: '369.70',
    net_exposure: '369.70',
  });

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.nav, 1002.2, 'nav matches projection');
  assertEqual(data.netCash, 632.5, 'netCash matches projection');
  assertEqual(data.markedPositions, 369.7, 'markedPositions matches projection');
  assertEqual(data.currentBalance, 1002.2, 'currentBalance = nav');
  assertEqual(data.realizedPnl, -17, 'realizedPnl = -17.00 from projection');
  assertEqual(data.unrealizedPnl, 19.2, 'unrealizedPnl = 19.20 from projection');
  assertEqual(data.totalPnl, 2.2, 'totalPnl = 2.20 from projection');
  assertEqual(data.realizedFees, 0, 'realizedFees is 0');
  assertEqual(data.grossExposure, 369.7, 'grossExposure matches');
  assertEqual(data.netExposure, 369.7, 'netExposure matches');
  assertEqual(data.kpis, null, 'kpis is null (accounting does not track trade-level KPIs)');
}

// ── 12. Accounting projection: null values (no projection) ─────────────

console.log('\n12. GET returns null values when no projection exists:');
{
  cleanup();
  const account = seedAccount({ name: 'No Proj', startingBalance: null });

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.nav, null, 'nav is null');
  assertEqual(data.netCash, null, 'netCash is null');
  assertEqual(data.currentBalance, null, 'currentBalance is null');
  assertEqual(data.realizedPnl, null, 'realizedPnl is null');
  assertEqual(data.kpis, null, 'kpis is null');
}

// ── 16. GET: Realized P&L from projection ─────────────────────────────

console.log('\n16. GET uses projection realizedPnl:');
{
  cleanup();
  const account = seedAccount({ id: 'test-account-id', name: 'Pnl Check' });
  seedAccountingProjection(account.id as string, {
    nav: '1000.00',
    net_cash: '1000.00',
    realized_pnl: '-28.50',
    unrealized_pnl: '0.00',
    total_pnl: '-28.50',
  });

  const result = doGetAccount(account.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  assertEqual(data.realizedPnl, -28.5, 'realizedPnl = -28.50 from projection');
  assertEqual(data.totalPnl, -28.5, 'totalPnl = -28.50');
}

// ═══════════════════════════════════════════════════════════════════
// PUT trading default fields and lifecycle edge cases
// ═══════════════════════════════════════════════════════════════════

// ── 20. PUT: Update maxRiskPerTradePct ───────────────────────────────

console.log('\n20. PUT updates maxRiskPerTradePct:');
{
  cleanup();
  const account = seedAccount({ name: 'Risk Limit', maxRiskPerTradePct: 1.5 });
  const result = doPutAccount(account.id as string, { maxRiskPerTradePct: 3.0 });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.maxRiskPerTradePct, 3.0, 'maxRiskPerTradePct updated to 3.0');
}

// ── 21. PUT: Update defaultCommission ─────────────────────────────────

console.log('\n21. PUT updates defaultCommission:');
{
  cleanup();
  const account = seedAccount({ name: 'Commission Test', defaultCommission: 0.50 });
  const result = doPutAccount(account.id as string, { defaultCommission: 1.25 });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.defaultCommission, 1.25, 'defaultCommission updated to 1.25');
}

// ── 22. PUT: Update startingBalance ───────────────────────────────────

console.log('\n22. PUT updates startingBalance:');
{
  cleanup();
  const account = seedAccount({ name: 'Start Bal Test', startingBalance: 10000 });
  const result = doPutAccount(account.id as string, { startingBalance: 25000 });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.startingBalance, 25000, 'startingBalance updated to 25000');
}

// ── 23. PUT: Set nullable fields to null (NULL fallback) ──────────────

console.log('\n23. PUT sets nullable trading default fields to null:');
{
  cleanup();
  const account = seedAccount({
    name: 'Null Fallback',
    maxRiskPerTradePct: 2.5,
    defaultCommission: 1.00,
    startingBalance: 50000,
  });

  // Clear all three nullable fields to null
  const result = doPutAccount(account.id as string, {
    maxRiskPerTradePct: null,
    defaultCommission: null,
    startingBalance: null,
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.maxRiskPerTradePct, null, 'maxRiskPerTradePct is null');
  assertEqual(data.defaultCommission, null, 'defaultCommission is null');
  assertEqual(data.startingBalance, null, 'startingBalance is null');
  assertEqual(data.name, 'Null Fallback', 'name unchanged');
}

// ── 24. PUT: Reject zero/negative maxRiskPerTradePct ─────────────────

console.log('\n24. PUT rejects zero maxRiskPerTradePct:');
{
  cleanup();
  const account = seedAccount({ name: 'Bad Risk', maxRiskPerTradePct: 2.0 });
  const result = doPutAccount(account.id as string, { maxRiskPerTradePct: 0 });
  assert(result.status === 400, 'returns 400');

  // Verify the value was not persisted
  const current = db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id as string)).get() as Record<string, unknown>;
  assertEqual(current.maxRiskPerTradePct, 2.0, 'value unchanged');
}

// ── 25. PUT: Blocks reactivation with open trades ────────────────────

console.log('\n25. PUT blocks reactivation with open trade:');
{
  cleanup();
  const account = seedAccount({ name: 'Reactivation Block', isActive: false });
  seedTrade({ accountId: account.id as string, status: 'open' });
  const result = doPutAccount(account.id as string, { isActive: true });

  assert(result.status === 409, 'returns 409');
  assertEqual((result.data as { error: string }).error, 'Cannot reactivate account with open trades', 'error message');
  const current = db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id as string)).get() as Record<string, unknown>;
  assertEqual(current.isActive, false, 'account remains inactive');
}

// ── 26. PUT: Allows reactivation when inactive with no trades ────────

console.log('\n26. PUT allows reactivation when inactive with no trades:');
{
  cleanup();
  const account = seedAccount({ name: 'Clean Reactivate', isActive: false });
  const result = doPutAccount(account.id as string, { isActive: true });

  assert(result.status === 200, 'returns 200');
  const updated = result.data as Record<string, unknown>;
  assertEqual(updated.isActive, true, 'account is reactivated');
}

// ═══════════════════════════════════════════════════════════════════
// NEW: Currency mutation guard (D4)
// ═══════════════════════════════════════════════════════════════════

// ── 27. PUT: Blocks currency change when account has financial history ──

console.log('\n27. PUT blocks currency change with financial history:');
{
  cleanup();
  const account = seedAccount({ name: 'Currency Guard', currency: 'USD' });
  seedFinancialEvent({ accountId: account.id as string, eventType: 'opening_balance' });
  const result = doPutAccount(account.id as string, { currency: 'EUR' });

  assert(result.status === 409, 'returns 409');
  const data = result.data as { error: string };
  assert(data.error.includes('base currency'), 'error message is descriptive and actionable');
  const current = db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id as string)).get() as Record<string, unknown>;
  assertEqual(current.currency, 'USD', 'currency unchanged');
}

// ── 28. PUT: Allows currency change when no financial history ─────────

console.log('\n28. PUT allows currency change without financial history:');
{
  cleanup();
  const account = seedAccount({ name: 'Currency Free', currency: 'USD' });
  const result = doPutAccount(account.id as string, { currency: 'EUR' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currency, 'EUR', 'currency is updated');
}

// ── 29. PUT: Same-currency no-op allowed even with financial history ──

console.log('\n29. PUT allows same-currency update with financial history:');
{
  cleanup();
  const account = seedAccount({ name: 'Currency Noop', currency: 'USD' });
  seedFinancialEvent({ accountId: account.id as string, eventType: 'deposit' });
  const result = doPutAccount(account.id as string, { currency: 'USD' });

  assert(result.status === 200, 'returns 200 (no actual mutation)');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currency, 'USD', 'currency unchanged');
}

// ═══════════════════════════════════════════════════════════════════
// NEW: Default-account clearing on deactivation (D6)
// ═══════════════════════════════════════════════════════════════════

// ── 30. PUT: Deactivating the default account clears defaultAccountId ──

console.log('\n30. PUT deactivating the default account clears defaultAccountId:');
{
  cleanup();
  const account = seedAccount({ name: 'Default Deactivate', isActive: true });
  seedSettings(account.id as string);
  const result = doPutAccount(account.id as string, { isActive: false });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.isActive, false, 'account deactivated');
  const settingsRow = db.select().from(schema.settings).where(eq(schema.settings.id, 'settings-default')).get() as Record<string, unknown>;
  assertEqual(settingsRow.defaultAccountId, null, 'defaultAccountId cleared');
}

// ── 31. PUT: Deactivating a non-default account preserves default ──

console.log('\n31. PUT deactivating a non-default account preserves defaultAccountId:');
{
  cleanup();
  const other = seedAccount({ name: 'Other Acct', isActive: true });
  seedAccount({ name: 'Default Acct', id: 'default-account', isActive: true });
  seedSettings('default-account');
  const result = doPutAccount(other.id as string, { isActive: false });

  assert(result.status === 200, 'returns 200');
  const settingsRow = db.select().from(schema.settings).where(eq(schema.settings.id, 'settings-default')).get() as Record<string, unknown>;
  assertEqual(settingsRow.defaultAccountId, 'default-account', 'defaultAccountId preserved');
}

// ── 32. PUT: Guard-blocked deactivation preserves default reference ──

console.log('\n32. PUT guard-blocked deactivation preserves defaultAccountId:');
{
  cleanup();
  const account = seedAccount({ name: 'Blocked Default', isActive: true });
  seedSettings(account.id as string);
  seedTrade({ accountId: account.id as string, status: 'open' });
  const result = doPutAccount(account.id as string, { isActive: false });

  assert(result.status === 409, 'returns 409 (open-trade guard)');
  const settingsRow = db.select().from(schema.settings).where(eq(schema.settings.id, 'settings-default')).get() as Record<string, unknown>;
  assertEqual(settingsRow.defaultAccountId, account.id as string, 'defaultAccountId preserved when deactivation blocked');
}


// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  throw new Error(`${failed}/${total} assertions FAILED in account-by-id route test`);
} else {
  console.log('         All tests passed!\n');
}

// Vitest integration: the standalone-runner assertions above execute at
// module scope during collection, which is the repo pattern for both
// `npx tsx <file>` (run-all-tests.ts) and vitest. Expose a minimal suite so
// `npx vitest run <file>` reports a passing file instead of
// "No test suite found in file". Guarded so the plain tsx path stays valid.
if (process.env.VITEST) {
  it('account-by-id standalone assertion runner completed without failures', () => {
    expect(failed).toBe(0);
  });
}
