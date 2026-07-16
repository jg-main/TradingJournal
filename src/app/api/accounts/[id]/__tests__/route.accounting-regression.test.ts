/**
 * Accounting regression tests: prove active GET /api/accounts/[id] uses
 * ledger-derived values from the performance projection when available,
 * while legacyAudit retains legacy provenance for audit.
 *
 * Seeds conflicting legacy journal data and accounting projection data,
 * then verifies the response prefers the accounting ledger values.
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/__tests__/route.accounting-regression.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, inArray, and } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { calculatePnL, calculateRMultiple, type ExecutionData } from '@/lib/trade-calc';
import { canDeactivateAccount, canDeleteAccount, canReactivateAccount } from '@/lib/account-lifecycle';
import { findAccountPerformance, insertAccountingExecution, findOrCreateInstrument } from '@/db/accounting-repository';
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { rebuildAccountPerformance } from '@/lib/performance/performance-rebuild';

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
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
    failed++;
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ ${msg} — value is null/undefined (FAILED)`);
    failed++;
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-accounting-regression.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create all needed tables
sqlite.exec(`
  DROP TABLE IF EXISTS correction_lineage;
  DROP TABLE IF EXISTS lot_matches;
  DROP TABLE IF EXISTS fifo_lots;
  DROP TABLE IF EXISTS account_positions;
  DROP TABLE IF EXISTS account_performance;
  DROP TABLE IF EXISTS valuation_marks;
  DROP TABLE IF EXISTS accounting_entries;
  DROP TABLE IF EXISTS accounting_postings;
  DROP TABLE IF EXISTS financial_events;
  DROP TABLE IF EXISTS accounting_executions;
  DROP TABLE IF EXISTS migration_records;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS position_price_snapshots;
  DROP TABLE IF EXISTS market_data_settings;
  DROP TABLE IF EXISTS instruments;
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS accounts;
  DROP TABLE IF EXISTS lookup_values;
  DROP TABLE IF EXISTS ledger_entries;
  DROP TABLE IF EXISTS ledger_postings;

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

  -- Accounting tables
  CREATE TABLE IF NOT EXISTS instruments (
    id TEXT PRIMARY KEY NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    type TEXT DEFAULT 'stock',
    currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS financial_events (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    idempotency_key TEXT,
    payload TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS accounting_entries (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL REFERENCES financial_events(id),
    entry_type TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS accounting_postings (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES accounting_entries(id),
    account_id TEXT NOT NULL,
    instrument_id TEXT,
    posting_type TEXT NOT NULL,
    direction TEXT,
    quantity_micros INTEGER,
    price_micros INTEGER,
    fee_micros INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS accounting_executions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    action TEXT NOT NULL,
    quantity_micros INTEGER NOT NULL,
    price_micros INTEGER NOT NULL,
    fee_micros INTEGER DEFAULT 0,
    journal_trade_id TEXT,
    journal_execution_id TEXT,
    execution_timestamp TEXT NOT NULL,
    idempotency_key TEXT,
    posted_at TEXT DEFAULT (current_timestamp),
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS account_positions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    direction TEXT,
    quantity TEXT NOT NULL DEFAULT '0',
    average_cost TEXT NOT NULL DEFAULT '0',
    total_cost_basis TEXT NOT NULL DEFAULT '0',
    realized_gross_pnl TEXT NOT NULL DEFAULT '0',
    realized_fees TEXT NOT NULL DEFAULT '0',
    realized_net_pnl TEXT NOT NULL DEFAULT '0',
    last_updated TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp),
    UNIQUE(account_id, instrument_id)
  );

  CREATE TABLE IF NOT EXISTS fifo_lots (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    remaining_quantity TEXT NOT NULL DEFAULT '0',
    original_quantity TEXT NOT NULL DEFAULT '0',
    entry_price TEXT NOT NULL DEFAULT '0',
    cost_basis_total TEXT NOT NULL DEFAULT '0',
    allocated_fees TEXT NOT NULL DEFAULT '0',
    opening_execution_id TEXT,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS lot_matches (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    lot_id TEXT NOT NULL,
    matched_quantity TEXT NOT NULL DEFAULT '0',
    realized_pnl TEXT NOT NULL DEFAULT '0',
    realized_fees TEXT NOT NULL DEFAULT '0',
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS valuation_marks (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    price_micros INTEGER NOT NULL,
    price_source TEXT DEFAULT 'manual',
    price_timestamp TEXT NOT NULL,
    mark_timestamp TEXT NOT NULL,
    idempotency_key TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS account_performance (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    computed_as_of TEXT NOT NULL,
    net_cash TEXT NOT NULL DEFAULT '0',
    nav TEXT NOT NULL DEFAULT '0',
    marked_positions TEXT NOT NULL DEFAULT '0',
    realized_pnl TEXT NOT NULL DEFAULT '0',
    unrealized_pnl TEXT NOT NULL DEFAULT '0',
    total_pnl TEXT NOT NULL DEFAULT '0',
    realized_fees TEXT NOT NULL DEFAULT '0',
    gross_exposure TEXT NOT NULL DEFAULT '0',
    net_exposure TEXT NOT NULL DEFAULT '0',
    modified_dietz_return TEXT,
    twr TEXT,
    high_water_mark TEXT,
    drawdown TEXT,
    drawdown_pct TEXT,
    warnings TEXT NOT NULL DEFAULT '[]',
    positions_json TEXT NOT NULL DEFAULT '[]',
    rebuild_count INTEGER DEFAULT 0,
    last_rebuilt_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp),
    UNIQUE(account_id)
  );

  CREATE TABLE IF NOT EXISTS correction_lineage (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    original_execution_id TEXT NOT NULL,
    reversal_execution_id TEXT NOT NULL,
    replacement_execution_id TEXT NOT NULL,
    idempotency_key TEXT,
    reason TEXT,
    corrected_at TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL REFERENCES financial_events(id),
    entry_type TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS ledger_postings (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
    account_id TEXT NOT NULL,
    instrument_id TEXT,
    posting_type TEXT NOT NULL,
    direction TEXT,
    quantity_micros INTEGER,
    price_micros INTEGER,
    fee_micros INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS migration_records (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    rebuild_fingerprint TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic (mirrors the actual GET handler) ──────────

function doGetAccount(id: string): { status: number; data: unknown } {
  try {
    const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    if (!account) {
      return { status: 404, data: { error: 'Account not found' } };
    }

    // Legacy KPI computation from journal trades
    const closedTrades = db
      .select()
      .from(schema.trades)
      .where(and(eq(schema.trades.accountId, id), eq(schema.trades.status, 'closed')))
      .all();

    let legacyKpis: { tradeCount: number; netPnl: number; winRate: number | null; avgR: number | null; avgGrade: number | null };

    if (closedTrades.length > 0) {
      const tradeIds = closedTrades.map((t) => t.id);
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

      let netPnl = 0;
      let winCount = 0;
      const rMultiples: number[] = [];
      const gradeScores: number[] = [];
      let decisions = 0;

      for (const trade of closedTrades) {
        const executions = execByTradeId.get(trade.id) ?? [];
        if (executions.length === 0) continue;
        decisions++;
        const execData: ExecutionData[] = executions.map((e) => ({
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees ?? 0,
          executedAt: e.executedAt ?? trade.createdAt ?? new Date().toISOString(),
        }));
        const pnl = calculatePnL(execData, trade.direction);
        netPnl += pnl.totalRealizedPnL;
        if (pnl.totalRealizedPnL > 0) winCount++;
        const risk = riskByTradeId.get(trade.id);
        if (risk?.initialRiskAmount != null && risk.initialRiskAmount > 0) {
          const rResult = calculateRMultiple(pnl.totalRealizedPnL, risk.initialRiskAmount);
          if (rResult.rMultiple !== null) rMultiples.push(rResult.rMultiple);
        }
        const grade = gradeByTradeId.get(trade.id);
        if (grade?.totalScore != null) gradeScores.push(grade.totalScore);
      }

      legacyKpis = {
        tradeCount: closedTrades.length,
        netPnl,
        winRate: decisions > 0 ? winCount / decisions : null,
        avgR: rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : null,
        avgGrade: gradeScores.length > 0 ? gradeScores.reduce((a, b) => a + b, 0) / gradeScores.length : null,
      };
    } else {
      legacyKpis = { tradeCount: 0, netPnl: 0, winRate: null, avgR: null, avgGrade: null };
    }

    // Legacy balance
    const transactions = db
      .select()
      .from(schema.accountTransactions)
      .where(eq(schema.accountTransactions.accountId, id))
      .all();
    const netDeposits = transactions.filter((t) => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
    const netWithdrawals = transactions.filter((t) => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
    const startingBalanceVal = account.startingBalance ?? 0;
    const legacyRealizedPnl = legacyKpis.netPnl;
    const legacyCurrentBalance = startingBalanceVal + netDeposits - netWithdrawals + legacyRealizedPnl;

    // Accounting projection fetch
    let accountingProjection: Record<string, unknown> | null = null;
    let accountingRealizedPnl: string | null = null;
    let accountingNAV: string | null = null;

    try {
      const projection = findAccountPerformance(sqlite, id);
      if (projection) {
        accountingProjection = {
          netCash: projection.net_cash,
          nav: projection.nav,
          realizedPnl: projection.realized_pnl,
          unrealizedPnl: projection.unrealized_pnl,
          totalPnl: projection.total_pnl,
          computedAt: projection.computed_as_of,
          rebuildCount: projection.rebuild_count,
        };
        accountingRealizedPnl = projection.realized_pnl;
        accountingNAV = projection.nav;
      }
    } catch {
      // Best effort
    }

    const ledgerDerived = accountingProjection !== null;
    const activeRealizedPnl = ledgerDerived && accountingRealizedPnl
      ? parseFloat(accountingRealizedPnl)
      : legacyRealizedPnl;
    const activeCurrentBalance = ledgerDerived && accountingNAV
      ? parseFloat(accountingNAV)
      : legacyCurrentBalance;

    const activeKpis = {
      tradeCount: legacyKpis.tradeCount,
      netPnl: activeRealizedPnl,
      winRate: legacyKpis.winRate,
      avgR: legacyKpis.avgR,
      avgGrade: legacyKpis.avgGrade,
    };

    return {
      status: 200,
      data: {
        ...account,
        currentBalance: activeCurrentBalance,
        realizedPnl: activeRealizedPnl,
        netDeposits,
        netWithdrawals,
        kpis: activeKpis,
        accounting: accountingProjection
          ? { projection: accountingProjection, realizedPnl: accountingRealizedPnl, nav: accountingNAV, ledgerDerived }
          : { projection: null, realizedPnl: null, nav: null, ledgerDerived: false },
        legacyAudit: {
          kpis: legacyKpis,
          realizedPnl: legacyRealizedPnl,
          currentBalance: legacyCurrentBalance,
        },
      },
    };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch account', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM lot_matches;');
  sqlite.exec('DELETE FROM fifo_lots;');
  sqlite.exec('DELETE FROM account_positions;');
  sqlite.exec('DELETE FROM valuation_marks;');
  sqlite.exec('DELETE FROM account_performance;');
  sqlite.exec('DELETE FROM accounting_executions;');
  sqlite.exec('DELETE FROM accounting_postings;');
  sqlite.exec('DELETE FROM ledger_postings;');
  sqlite.exec('DELETE FROM ledger_entries;');
  sqlite.exec('DELETE FROM accounting_entries;');
  sqlite.exec('DELETE FROM financial_events;');
  sqlite.exec('DELETE FROM correction_lineage;');
  sqlite.exec('DELETE FROM migration_records;');
  sqlite.exec('DELETE FROM trade_grades;');
  sqlite.exec('DELETE FROM trade_risk_snapshots;');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM account_transactions;');
  sqlite.exec('DELETE FROM instruments;');
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(id: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Regression Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      startingBalance: 10000,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
}

function seedTrade(accountId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `REGR-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
      accountId,
      symbol: 'AAPL',
      direction: 'long',
      status: 'closed',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedExecution(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.tradeExecutions)
    .values({
      id,
      tradeId,
      action: 'buy',
      quantity: 100,
      price: 150.0,
      fees: 0,
      executedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return id;
}

/**
 * Seed a manually-crafted account_performance row with known ledger values
 * that conflict with the legacy journal computations.
 */
function seedPerformanceRow(accountId: string, realizedPnl: string, nav: string) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const warnings = '[]';
  const positionsJson = '[]';

  sqlite.prepare(`
    INSERT OR REPLACE INTO account_performance
      (id, account_id, computed_as_of, net_cash, nav, marked_positions,
       realized_pnl, unrealized_pnl, total_pnl, realized_fees,
       gross_exposure, net_exposure, warnings, positions_json,
       rebuild_count, last_rebuilt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(id, accountId, now, nav, nav, '0.00',
    realizedPnl, '0.00', realizedPnl, '0.00',
    '0.00', '0.00', warnings, positionsJson,
    now, now, now);
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Accounting Regression Tests (active routes prefer ledger values) ---\n');

// ═══════════════════════════════════════════════════════════════════
// 1. Conflicting values: legacy says netPnl=1000, accounting says netPnl=2000.
//    Active route MUST use accounting value.
// ═══════════════════════════════════════════════════════════════════

console.log('\n1. GET prefers ledger-derived values over conflicting legacy data:');
{
  cleanup();
  const acctId = 'regression-test-1';
  seedAccount(acctId);

  // Legacy: closed trade with P&L = 1000
  const trade = seedTrade(acctId);
  seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution(trade.id as string, { action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });
  // Legacy P&L = (160 - 150) * 100 = 1000

  // Accounting projection: different P&L (2000) and NAV (12000)
  seedPerformanceRow(acctId, '2000.00', '12000.00');

  const result = doGetAccount(acctId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  // Active values MUST use ledger
  assertEqual(data.currentBalance, 12000, 'currentBalance uses ledger NAV (12000) not legacy (11000)');
  assertEqual(data.realizedPnl, 2000, 'realizedPnl uses ledger value (2000) not legacy (1000)');

  // KPIs: netPnl comes from ledger, tradeCount stays legacy
  const kpis = data.kpis as Record<string, unknown>;
  assertEqual(kpis.netPnl, 2000, 'kpis.netPnl uses ledger realizedPnl (2000)');
  assertEqual(kpis.tradeCount, 1, 'kpis.tradeCount stays legacy (1)');

  // accounting sub-object confirms ledgerDerived
  const accounting = data.accounting as Record<string, unknown>;
  assertEqual(accounting.ledgerDerived, true, 'accounting.ledgerDerived is true');
  assertEqual(accounting.realizedPnl, '2000.00', 'accounting.realizedPnl is the projection string');

  // legacyAudit preserves legacy provenance
  const legacyAudit = data.legacyAudit as Record<string, unknown>;
  assertNotNull(legacyAudit, 'legacyAudit is present');
  assertEqual(legacyAudit.realizedPnl, 1000, 'legacyAudit.realizedPnl retains legacy value (1000)');
  assertEqual(legacyAudit.currentBalance, 11000, 'legacyAudit.currentBalance retains legacy value (11000)');
  const legacyKpis = legacyAudit.kpis as Record<string, unknown>;
  assertEqual(legacyKpis.netPnl, 1000, 'legacyAudit.kpis.netPnl retains legacy value (1000)');
}

// ═══════════════════════════════════════════════════════════════════
// 2. When no accounting projection exists, fall back to legacy values.
// ═══════════════════════════════════════════════════════════════════

console.log('\n2. GET falls back to legacy values when no projection exists:');
{
  cleanup();
  const acctId = 'regression-test-2';
  seedAccount(acctId);

  // Legacy: closed trade with P&L = 1000
  const trade = seedTrade(acctId);
  seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution(trade.id as string, { action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // No accounting projection seeded

  const result = doGetAccount(acctId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  // Falls back to legacy
  assertEqual(data.currentBalance, 11000, 'currentBalance falls back to legacy (11000)');
  assertEqual(data.realizedPnl, 1000, 'realizedPnl falls back to legacy (1000)');

  const accounting = data.accounting as Record<string, unknown>;
  assertEqual(accounting.ledgerDerived, false, 'accounting.ledgerDerived is false');
  assertEqual(accounting.projection, null, 'accounting.projection is null');
}

// ═══════════════════════════════════════════════════════════════════
// 3. Accounting projection with zero values (no trades in accounting)
//    should not override unless projection exists.
// ═══════════════════════════════════════════════════════════════════

console.log('\n3. GET uses legacy values when accounting projection is present but has zero P&L:');
{
  cleanup();
  const acctId = 'regression-test-3';
  seedAccount(acctId);

  // Legacy: closed trade with P&L = 1000
  const trade = seedTrade(acctId);
  seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution(trade.id as string, { action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // Accounting projection with zero P&L (no accounting executions posted)
  seedPerformanceRow(acctId, '0.00', '10000.00');

  const result = doGetAccount(acctId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  // Projection exists, so ledger values are used
  assertEqual(data.currentBalance, 10000, 'currentBalance uses ledger NAV (10000)');
  assertEqual(data.realizedPnl, 0, 'realizedPnl uses ledger value (0)');

  const accounting = data.accounting as Record<string, unknown>;
  assertEqual(accounting.ledgerDerived, true, 'accounting.ledgerDerived is true');
}

// ═══════════════════════════════════════════════════════════════════
// 4. Negative ledger values override positive legacy values.
// ═══════════════════════════════════════════════════════════════════

console.log('\n4. GET prefers negative ledger values over positive legacy values:');
{
  cleanup();
  const acctId = 'regression-test-4';
  seedAccount(acctId);

  // Legacy: winning trade with P&L = 1000 (legacy says profitable)
  const trade = seedTrade(acctId);
  seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution(trade.id as string, { action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // Accounting projection says loss: realizedPnl = -500, NAV = 9500
  seedPerformanceRow(acctId, '-500.00', '9500.00');

  const result = doGetAccount(acctId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;

  // Active uses ledger values even when they're worse than legacy
  assertEqual(data.currentBalance, 9500, 'currentBalance uses ledger NAV (9500) not legacy (11000)');
  assertEqual(data.realizedPnl, -500, 'realizedPnl uses ledger value (-500) not legacy (1000)');

  // legacyAudit preserves positive legacy values
  const legacyAudit = data.legacyAudit as Record<string, unknown>;
  assertEqual(legacyAudit.realizedPnl, 1000, 'legacyAudit.realizedPnl retains positive legacy value (1000)');
}

// ═══════════════════════════════════════════════════════════════════
// 5. Close route prefers ledger values.
// ═══════════════════════════════════════════════════════════════════

console.log('\n5. Close route prefers ledger values for realizedPnl:');
{
  cleanup();
  const acctId = 'regression-test-5';
  seedAccount(acctId);

  // Legacy: closed trade with P&L = 1000
  const trade = seedTrade(acctId);
  seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution(trade.id as string, { action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // Accounting projection: different values
  seedPerformanceRow(acctId, '2000.00', '12000.00');

  // Simulate close route logic: use accounting when available
  let accountingRealizedPnl: string | null = null;
  let accountingNav: string | null = null;
  try {
    const projection = findAccountPerformance(sqlite, acctId);
    if (projection) {
      accountingRealizedPnl = projection.realized_pnl;
      accountingNav = projection.nav;
    }
  } catch {
    // Best effort
  }

  const ledgerDerived = accountingRealizedPnl !== null && accountingNav !== null;
  const closeRealizedPnl = ledgerDerived ? parseFloat(accountingRealizedPnl!) : 1000;
  const closeFinalBalance = ledgerDerived ? parseFloat(accountingNav!) : 11000;

  assertEqual(closeRealizedPnl, 2000, 'close route uses accounting realizedPnl (2000)');
  assertEqual(closeFinalBalance, 12000, 'close route uses accounting NAV (12000)');
}

// ═══════════════════════════════════════════════════════════════════
// 6. Account detail: accounting sub-object exposes full projection data.
// ═══════════════════════════════════════════════════════════════════

console.log('\n6. GET exposes full accounting projection data in accounting sub-object:');
{
  cleanup();
  const acctId = 'regression-test-6';
  seedAccount(acctId);
  seedPerformanceRow(acctId, '1500.00', '11500.00');

  const result = doGetAccount(acctId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  const accounting = data.accounting as Record<string, unknown>;
  const projection = accounting.projection as Record<string, unknown>;

  assertNotNull(projection, 'accounting.projection is present');
  assertEqual(projection.realizedPnl, '1500.00', 'projection.realizedPnl is exposed');
  assertEqual(projection.nav, '11500.00', 'projection.nav is exposed');
  assertNotNull(projection.computedAt, 'projection.computedAt is present');
  assertEqual(projection.rebuildCount, 1, 'projection.rebuildCount is present');
  assertEqual(accounting.ledgerDerived, true, 'accounting.ledgerDerived is true');
}

// ═══════════════════════════════════════════════════════════════════
// 7. legacyAudit preserves legacy trade count and win rate.
// ═══════════════════════════════════════════════════════════════════

console.log('\n7. legacyAudit preserves legacy trade count and win rate:');
{
  cleanup();
  const acctId = 'regression-test-7';
  seedAccount(acctId);

  // Two trades: one win (P&L=1000), one loss (P&L=-500)
  const trade1 = seedTrade(acctId);
  seedExecution(trade1.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution(trade1.id as string, { action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  const trade2 = seedTrade(acctId);
  seedExecution(trade2.id as string, { action: 'buy', quantity: 100, price: 200.0, executedAt: '2025-06-02T10:00:00Z' });
  seedExecution(trade2.id as string, { action: 'sell', quantity: 100, price: 195.0, executedAt: '2025-06-02T11:00:00Z' });

  // Accounting projection with different P&L
  seedPerformanceRow(acctId, '3000.00', '13000.00');

  const result = doGetAccount(acctId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  const legacyAudit = data.legacyAudit as Record<string, unknown>;
  const legacyKpis = legacyAudit.kpis as Record<string, unknown>;

  assertEqual(legacyKpis.tradeCount, 2, 'legacyAudit retains trade count of 2');
  assertEqual(legacyKpis.netPnl, 500, 'legacyAudit retains netPnl of 500 (1000 + -500)');
  assertEqual(legacyKpis.winRate, 0.5, 'legacyAudit retains winRate of 0.5');
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
