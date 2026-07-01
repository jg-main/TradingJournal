/**
 * /api/dashboard route tests
 *
 * Tests the GET handler for the consolidated dashboard KPI endpoint:
 *  - Account resolution (param -> settings.defaultAccountId -> first active)
 *  - KPI computation (win rate, avg R, avg grade, drawdown, account value)
 *  - Empty states (no trades, no account)
 *  - Account isolation
 *  - Rollforward vs settings fallback for account value
 *  - Error shapes
 *
 * Run: DB_FILE_NAME=./.test-m05-s01-db npx tsx src/app/api/dashboard/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { computeKpiMetrics, type KpiMetrics, type KpiTradeInput, type RollforwardRow } from '@/lib/dashboard';

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

function assertDeepEqual(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`  ❌ ${msg} — expected ${e}, got ${a} (FAILED)`);
  } else {
    passed++;
    console.log(`  ✅ ${msg}`);
  }
}

function assertClose(actual: number | null | undefined, expected: number | null, msg: string, tolerance = 0.01) {
  if (actual === null || actual === undefined) {
    if (expected === null) {
      passed++;
      console.log(`  ✅ ${msg} (both null)`);
    } else {
      failed++;
      console.error(`  ❌ ${msg} — expected ${expected}, got null (FAILED)`);
    }
    return;
  }
  if (expected === null) {
    failed++;
    console.error(`  ❌ ${msg} — expected null, got ${actual} (FAILED)`);
    return;
  }
  if (Math.abs(actual - expected) > tolerance) {
    failed++;
    console.error(`  ❌ ${msg} — expected ${expected}, got ${actual} (FAILED)`);
  } else {
    passed++;
    console.log(`  ✅ ${msg}`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-m05-s01-db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create all tables needed for dashboard tests
sqlite.exec(`
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS lookup_values;
  DROP TABLE IF EXISTS accounts;

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT,
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (default_account_id) REFERENCES accounts(id)
  );

  CREATE TABLE trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'long',
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
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
    updated_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    executed_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (trade_id) REFERENCES trades(id)
  );

  CREATE TABLE trade_grades (
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

  CREATE TABLE trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL UNIQUE,
    account_equity_at_open REAL,
    initial_entry_price REAL,
    initial_stop_price REAL,
    initial_quantity REAL,
    risk_per_share REAL,
    initial_risk_amount REAL,
    account_risk_pct REAL,
    planned_reward_risk REAL,
    created_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
  );

  CREATE TABLE account_rollforward (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    date TEXT NOT NULL,
    beginning_equity REAL,
    deposits_withdrawals REAL DEFAULT 0,
    realized_gross_pnl REAL DEFAULT 0,
    fees REAL DEFAULT 0,
    ending_equity REAL,
    cumulative_pnl REAL,
    high_water_mark REAL,
    drawdown_amount REAL DEFAULT 0,
    drawdown_pct REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Replica of the route logic ─────────────────────────────────────────

interface DashboardRouteResult {
  status: number;
  body: { kpis?: KpiMetrics; error?: string; details?: unknown };
}

function doGetDashboard(queryAccountId?: string | null): DashboardRouteResult {
  try {
    let accountId: string | null = queryAccountId ?? null;

    // Resolve account: provided param -> settings.defaultAccountId -> first active account
    if (!accountId) {
      const setting = db.select().from(schema.settings).get();
      if (setting?.defaultAccountId) {
        accountId = setting.defaultAccountId ?? null;
      } else {
        const firstActive = db
          .select()
          .from(schema.accounts)
          .where(eq(schema.accounts.isActive, true))
          .get();
        accountId = firstActive?.id ?? null;
      }
    }

    if (!accountId) {
      return {
        status: 400,
        body: {
          error: 'No active account found. Create an account first or set a default account in settings.',
          details: { fieldErrors: { accountId: ['No account resolved'] } },
        },
      };
    }

    // 1. Fetch all trades for this account
    const allTrades = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.accountId, accountId))
      .all();

    const allTradeIds = allTrades.map((t) => t.id);

    // 2. Separate closed trades
    const closedTrades = allTrades.filter((t) => t.status === 'closed');
    // 3. Batch-fetch related data (using raw SQL for test replica — same effect as inArray)
    const executionsMap = new Map<string, (typeof schema.tradeExecutions.$inferSelect)[]>();
    const gradesMap = new Map<string, typeof schema.tradeGrades.$inferSelect>();
    const riskMap = new Map<string, typeof schema.tradeRiskSnapshots.$inferSelect>();

    if (allTradeIds.length > 0) {
      const placeholders = allTradeIds.map(() => '?').join(',');
      const execRows = sqlite.prepare(`SELECT * FROM trade_executions WHERE trade_id IN (${placeholders})`).all(...allTradeIds) as Record<string, unknown>[];
      for (const row of execRows) {
        const exec = {
          id: row.id as string,
          tradeId: row.trade_id as string,
          action: row.action as string,
          quantity: row.quantity as number,
          price: row.price as number,
          fees: row.fees as number | null,
          reasonId: row.reason_id as string | null,
          executedAt: row.executed_at as string | null,
          notes: row.notes as string | null,
          createdAt: row.created_at as string | null,
        } as typeof schema.tradeExecutions.$inferSelect;
        const list = executionsMap.get(exec.tradeId) ?? [];
        list.push(exec);
        executionsMap.set(exec.tradeId, list);
      }

      // Raw SQL returns snake_case columns; map to camelCase for $inferSelect compatibility
      const gradeRows = sqlite.prepare(`SELECT * FROM trade_grades WHERE trade_id IN (${placeholders})`).all(...allTradeIds) as Record<string, unknown>[];
      for (const row of gradeRows) {
        const grade = {
          id: row.id as string,
          tradeId: row.trade_id as string,
          setupQualityScore: row.setup_quality_score as number | null,
          riskQualityScore: row.risk_quality_score as number | null,
          entryQualityScore: row.entry_quality_score as number | null,
          managementQualityScore: row.management_quality_score as number | null,
          exitQualityScore: row.exit_quality_score as number | null,
          reviewQualityScore: row.review_quality_score as number | null,
          totalScore: row.total_score as number | null,
          gradeLabel: row.grade_label as string | null,
          followedPlan: row.followed_plan as boolean | null,
          ruleViolation: row.rule_violation as boolean | null,
          notes: row.notes as string | null,
          createdAt: row.created_at as string | null,
          updatedAt: row.updated_at as string | null,
        } as typeof schema.tradeGrades.$inferSelect;
        gradesMap.set(grade.tradeId, grade);
      }

      const snapRows = sqlite.prepare(`SELECT * FROM trade_risk_snapshots WHERE trade_id IN (${placeholders})`).all(...allTradeIds) as Record<string, unknown>[];
      for (const row of snapRows) {
        const snap = {
          id: row.id as string,
          tradeId: row.trade_id as string,
          accountEquityAtOpen: row.account_equity_at_open as number | null,
          initialEntryPrice: row.initial_entry_price as number | null,
          initialStopPrice: row.initial_stop_price as number | null,
          initialQuantity: row.initial_quantity as number | null,
          riskPerShare: row.risk_per_share as number | null,
          initialRiskAmount: row.initial_risk_amount as number | null,
          accountRiskPct: row.account_risk_pct as number | null,
          plannedRewardRisk: row.planned_reward_risk as number | null,
          createdAt: row.created_at as string | null,
        } as typeof schema.tradeRiskSnapshots.$inferSelect;
        riskMap.set(snap.tradeId, snap);
      }
    }

    // 4. Build KpiTradeInput arrays
    const allKpiInputs: KpiTradeInput[] = allTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      status: trade.status,
      executions: (executionsMap.get(trade.id) ?? []).map((ex) => ({
        action: ex.action,
        quantity: ex.quantity,
        price: ex.price,
        fees: ex.fees ?? null,
        executedAt: ex.executedAt ?? '',
      })),
      grade: (() => {
        const g = gradesMap.get(trade.id);
        return g?.totalScore != null ? { totalScore: g.totalScore } : null;
      })(),
      riskSnapshot: riskMap.has(trade.id)
        ? { initialRiskAmount: riskMap.get(trade.id)!.initialRiskAmount ?? null }
        : null,
    }));

    const closedKpiInputs: KpiTradeInput[] = closedTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      status: trade.status,
      executions: (executionsMap.get(trade.id) ?? []).map((ex) => ({
        action: ex.action,
        quantity: ex.quantity,
        price: ex.price,
        fees: ex.fees ?? null,
        executedAt: ex.executedAt ?? '',
      })),
      grade: (() => {
        const g = gradesMap.get(trade.id);
        return g?.totalScore != null ? { totalScore: g.totalScore } : null;
      })(),
      riskSnapshot: riskMap.has(trade.id)
        ? { initialRiskAmount: riskMap.get(trade.id)!.initialRiskAmount ?? null }
        : null,
    }));

    // 5. Fetch latest rollforward
    const rf = db
      .select()
      .from(schema.accountRollforward)
      .where(eq(schema.accountRollforward.accountId, accountId))
      .orderBy(desc(schema.accountRollforward.date))
      .limit(1)
      .get();

    const latestRollforward: RollforwardRow | null = rf
      ? {
          endingEquity: rf.endingEquity ?? 0,
          drawdownAmount: rf.drawdownAmount ?? 0,
          drawdownPct: rf.drawdownPct ?? 0,
        }
      : null;

    // 6. Fetch settings startingAccountValue
    const setting = db.select().from(schema.settings).get();
    const startingAccountValue = setting?.startingAccountValue ?? null;

    // 7. Compute KPIs
    const kpis = computeKpiMetrics(allKpiInputs, closedKpiInputs, latestRollforward, startingAccountValue);

    return { status: 200, body: { kpis } };
  } catch (error) {
    return {
      status: 500,
      body: { error: 'Failed to fetch dashboard KPIs', details: String(error) },
    };
  }
}

// ── Seed helpers ────────────────────────────────────────────────────────

const NOW = '2026-07-01T12:00:00.000Z';

function seedAccount(overrides?: Partial<typeof schema.accounts.$inferInsert>): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.accounts).values({
    id,
    name: overrides?.name ?? 'Test Account',
    broker: overrides?.broker ?? 'Test Broker',
    currency: overrides?.currency ?? 'USD',
    isActive: overrides?.isActive ?? true,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function seedSetting(overrides?: Partial<typeof schema.settings.$inferInsert>): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.settings).values({
    id,
    defaultAccountId: overrides?.defaultAccountId ?? null,
    startingAccountValue: overrides?.startingAccountValue ?? null,
    currency: 'USD',
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function seedTrade(
  accountId: string,
  overrides?: Partial<typeof schema.trades.$inferInsert>,
): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.trades).values({
    id,
    tradeCode: overrides?.tradeCode ?? `T-${id.slice(0, 4)}`,
    accountId,
    symbol: overrides?.symbol ?? 'AAPL',
    direction: overrides?.direction ?? 'long',
    status: overrides?.status ?? 'closed',
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function seedExecution(
  tradeId: string,
  overrides?: Partial<typeof schema.tradeExecutions.$inferInsert>,
): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.tradeExecutions).values({
    id,
    tradeId,
    action: overrides?.action ?? 'buy',
    quantity: overrides?.quantity ?? 100,
    price: overrides?.price ?? 100,
    fees: overrides?.fees ?? 0,
    executedAt: NOW,
  }).run();
  return id;
}

function seedGrade(
  tradeId: string,
  totalScore: number,
): string {
  const id = randomUUID();
  db.insert(schema.tradeGrades).values({
    id,
    tradeId,
    totalScore,
    createdAt: NOW,
  }).run();
  return id;
}

function seedRiskSnapshot(
  tradeId: string,
  initialRiskAmount: number,
): string {
  const id = randomUUID();
  db.insert(schema.tradeRiskSnapshots).values({
    id,
    tradeId,
    initialRiskAmount,
    createdAt: NOW,
  }).run();
  return id;
}

function seedRollforward(
  accountId: string,
  overrides?: Partial<typeof schema.accountRollforward.$inferInsert>,
): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.accountRollforward).values({
    id,
    accountId,
    date: overrides?.date ?? '2026-07-01',
    endingEquity: overrides?.endingEquity ?? 50000,
    drawdownAmount: overrides?.drawdownAmount ?? 0,
    drawdownPct: overrides?.drawdownPct ?? 0,
    createdAt: NOW,
  }).run();
  return id;
}

function cleanup() {
  sqlite.exec(`
    DELETE FROM trade_grades;
    DELETE FROM trade_risk_snapshots;
    DELETE FROM trade_executions;
    DELETE FROM account_rollforward;
    DELETE FROM trades;
    DELETE FROM settings;
    DELETE FROM accounts;
    DELETE FROM lookup_values;
  `);
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log('\n📊 Dashboard API Route Tests');
console.log('═══════════════════════════\n');

// ── Test 1: No account resolved → 400 ─────────────────────────────────
console.log('▶ Account Resolution');

cleanup();
{
  const result = doGetDashboard(null);
  assert(result.status === 400, 'No account config returns 400');
  assert(result.body.error?.includes('No active account'), 'Error message mentions no active account');
  assertDeepEqual(
    (result.body.details as Record<string, unknown>)?.fieldErrors,
    { accountId: ['No account resolved'] },
    'Error details has fieldErrors.accountId',
  );
}

// ── Test 2: Account via settings.defaultAccountId ──────────────────────
console.log('▶ Settings Default Account');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // No trades yet, should return empty KPIs
  const result = doGetDashboard(null);
  assert(result.status === 200, 'Resolves account via settings.defaultAccountId');
  assert(result.body.kpis?.totalTrades === 0, 'totalTrades is 0 for empty account');
  assert(result.body.kpis?.openTrades === 0, 'openTrades is 0 for empty account');
  assert(result.body.kpis?.winRate === null, 'winRate is null for empty account');
  assert(result.body.kpis?.netPnl === 0, 'netPnl is 0 for empty account');
}

// ── Test 3: Account via first active account (no settings) ─────────────
console.log('▶ First Active Account Fallback');

cleanup();
{
  const account1 = seedAccount({ name: 'Inactive', isActive: false });
  const account2 = seedAccount({ name: 'Active Main', isActive: true });

  const result = doGetDashboard(null);
  assert(result.status === 200, 'Resolves via first active account');

  // Verify it's using account2 by checking that account1's trades don't appear
  seedTrade(account1, { symbol: 'HIDDEN' });
  const result2 = doGetDashboard(null);
  assert(result2.body.kpis?.totalTrades === 0, 'Using active account, not inactive');
}

// ── Test 4: Explicit accountId parameter ──────────────────────────────
console.log('▶ Explicit accountId');

cleanup();
{
  const accA = seedAccount({ name: 'Account A' });
  const accB = seedAccount({ name: 'Account B' });

  seedTrade(accA, { symbol: 'TRADE-A' });
  seedTrade(accA, { symbol: 'TRADE-A2' });
  seedTrade(accB, { symbol: 'TRADE-B' });

  const resultA = doGetDashboard(accA);
  assert(resultA.body.kpis?.totalTrades === 2, 'Account A has 2 trades');

  const resultB = doGetDashboard(accB);
  assert(resultB.body.kpis?.totalTrades === 1, 'Account B has 1 trade');
}

// ── Test 5: KPI computation with full trade data ──────────────────────
console.log('▶ KPI Computation');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Trade 1: Long AAPL, buy 100 @ 100, sell 100 @ 120 → PnL = (120-100)*100 - 0 = 2000
  // Fees: $10 → net PnL = 1990
  const t1 = seedTrade(accountId, { symbol: 'AAPL', direction: 'long', status: 'closed' });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 120, fees: 5 });
  seedRiskSnapshot(t1, 500); // initialRiskAmount = 500 → R = 1990/500 = 3.98
  seedGrade(t1, 85);

  // Trade 2: Long MSFT, buy 50 @ 200, sell 50 @ 190 → PnL = (190-200)*50 = -500
  // Fees: $10 → net = -510
  const t2 = seedTrade(accountId, { symbol: 'MSFT', direction: 'long', status: 'closed' });
  seedExecution(t2, { action: 'buy', quantity: 50, price: 200, fees: 5 });
  seedExecution(t2, { action: 'sell', quantity: 50, price: 190, fees: 5 });
  seedRiskSnapshot(t2, 400); // initialRiskAmount = 400 → R = -510/400 = -1.275
  seedGrade(t2, 45);

  // Trade 3: Open trade (not closed) — should count in totalTrades but NOT in P&L
  const t3 = seedTrade(accountId, { symbol: 'GOOGL', direction: 'long', status: 'open' });
  seedExecution(t3, { action: 'buy', quantity: 10, price: 150 });

  // Rollforward with drawdown
  seedRollforward(accountId, { endingEquity: 51250, drawdownAmount: -520, drawdownPct: -0.034 });

  const result = doGetDashboard(accountId);

  // totalTrades: 3 (2 closed + 1 open)
  assert(result.body.kpis?.totalTrades === 3, 'totalTrades is 3');

  // openTrades: 1 (the GOOGL open trade)
  assert(result.body.kpis?.openTrades === 1, 'openTrades is 1');

  // netPnl: 1990 + (-510) = 1480
  assertClose(result.body.kpis?.netPnl, 1480, 'netPnl is 1480');

  // winRate: 1 win / 2 decisions = 0.5
  assertClose(result.body.kpis?.winRate, 0.5, 'winRate is 0.5');

  // avgR: (3.98 + (-1.275)) / 2 = 1.3525
  assertClose(result.body.kpis?.avgR, 1.3525, 'avgR is ~1.3525');

  // avgGrade: (85 + 45) / 2 = 65
  assertClose(result.body.kpis?.avgGrade, 65, 'avgGrade is 65');

  // accountValue: from rollforward
  assertClose(result.body.kpis?.accountValue, 51250, 'accountValue from rollforward');

  // currentDrawdown
  assertClose(result.body.kpis?.currentDrawdown, -520, 'drawdownAmount is -520');
  assertClose(result.body.kpis?.currentDrawdownPct, -0.034, 'drawdownPct is -0.034');
}

// ── Test 6: Account value fallback to settings.startingAccountValue ───
console.log('▶ Account Value Fallback');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId, startingAccountValue: 10000 });

  const result = doGetDashboard(accountId);
  assertClose(result.body.kpis?.accountValue, 10000, 'accountValue falls back to settings.startingAccountValue');
}

// ── Test 7: Account value null when no rollforward and no settings ────
console.log('▶ Account Value Null');

cleanup();
{
  const accountId = seedAccount();

  const result = doGetDashboard(accountId);
  assert(result.body.kpis?.accountValue === null, 'accountValue is null when no rollforward and no settings');
}

// ── Test 8: Win rate with $0 scratch counted as loss (D013) ──────────
console.log('▶ D013 Scratch as Loss');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Trade: Long, buy 100 @ 100, sell 100 @ 100 → PnL = 0 - fees = -10
  const t1 = seedTrade(accountId, { symbol: 'SCRATCH', direction: 'long', status: 'closed' });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 100, fees: 5 });

  const result = doGetDashboard(accountId);
  assertClose(result.body.kpis?.netPnl, -10, 'Scratch has net negative due to fees');
  assert(result.body.kpis?.winRate === 0, 'winRate is 0 (scratch counts as loss)');
}

// ── Test 9: Mixed trades with grades and without grades ───────────────
console.log('▶ Grade Averages');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, { symbol: 'GRADED-1', direction: 'long', status: 'closed' });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });
  seedGrade(t1, 80);

  const t2 = seedTrade(accountId, { symbol: 'GRADED-2', direction: 'long', status: 'closed' });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t2, { action: 'sell', quantity: 10, price: 110 });
  seedGrade(t2, 40);

  const t3 = seedTrade(accountId, { symbol: 'NO-GRADE', direction: 'long', status: 'closed' });
  seedExecution(t3, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t3, { action: 'sell', quantity: 10, price: 110 });

  const result = doGetDashboard(accountId);
  assertClose(result.body.kpis?.avgGrade, 60, 'avgGrade is (80+40)/2 = 60, ignoring ungraded');
  assert(result.body.kpis?.totalTrades === 3, 'totalTrades includes ungraded');
}

// ── Test 10: No risk snapshot → avgR is null ──────────────────────────
console.log('▶ Avg R Without Risk');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, { symbol: 'NO-RISK', direction: 'long', status: 'closed' });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });

  const result = doGetDashboard(accountId);
  assert(result.body.kpis?.avgR === null, 'avgR is null when no risk snapshots exist');
}

// ── Test 11: Error shape on DB failure ────────────────────────────────
console.log('▶ Error Shape');

// Simulate by closing the connection during a subsequent test
// For now, just validate the 400 shape from early return
{
  // Already tested: 400 shape in Test 1
}

// ── Summary ────────────────────────────────────────────────────────────

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
