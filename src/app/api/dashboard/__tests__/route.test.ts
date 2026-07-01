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
 * Run: npx tsx src/app/api/dashboard/__tests__/route.test.ts (sets its own DB_FILE_NAME)
 */

process.env.DB_FILE_NAME = './.test-m05-s03-db';

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc } from 'drizzle-orm';

import * as schema from '@/db/schema';
import {
  computeKpiMetrics,
  computeMonthlyPerformance,
  computeRDistribution,
  type KpiMetrics,
  type KpiTradeInput,
  type RollforwardRow,
  type MonthlyPerformanceItem,
  type RDistributionBin,
} from '@/lib/dashboard';
import {
  computeEquityCurve,
  computeDrawdown,
  type EquityDataPoint,
  type DrawdownDataPoint,
} from '@/lib/equity';

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

const DB_FILE = process.env.DB_FILE_NAME || './.test-m05-s03-db';
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
  body: { kpis?: KpiMetrics; equityCurve?: EquityDataPoint[]; drawdown?: DrawdownDataPoint[]; monthlyPerformance?: MonthlyPerformanceItem[]; rDistribution?: RDistributionBin[]; error?: string; details?: unknown };
}

function doGetDashboard(
  queryAccountId?: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
): DashboardRouteResult {
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

    // Apply date filter to closed trades (matches route.ts logic)
    const dateFilteredClosedTrades =
      dateFrom || dateTo
        ? closedTrades.filter((t) => {
            if (!t.closedAt) return false;
            const closedDate = t.closedAt.slice(0, 10);
            if (dateFrom && closedDate < dateFrom) return false;
            if (dateTo && closedDate > dateTo) return false;
            return true;
          })
        : closedTrades;

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
      closedAt: trade.closedAt ?? null,
    }));

    const closedKpiInputs: KpiTradeInput[] = dateFilteredClosedTrades.map((trade) => ({
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
      closedAt: trade.closedAt ?? null,
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
          date: rf.date,
          endingEquity: rf.endingEquity ?? 0,
          drawdownAmount: rf.drawdownAmount ?? 0,
          drawdownPct: rf.drawdownPct ?? 0,
          cumulativePnl: rf.cumulativePnl ?? null,
          highWaterMark: rf.highWaterMark ?? null,
        }
      : null;

    // 6. Fetch ALL account_rollforward rows ordered by date ASC for charts
    const allRfRows = db
      .select()
      .from(schema.accountRollforward)
      .where(eq(schema.accountRollforward.accountId, accountId))
      .orderBy(schema.accountRollforward.date)
      .all();

    // Apply date filter to rollforward rows for charts (matches route.ts logic)
    const dateFilteredRfRows = dateFrom || dateTo
      ? allRfRows.filter((r) => {
          const d = r.date;
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
          return true;
        })
      : allRfRows;

    const rollforwardRowsForCharts: RollforwardRow[] = dateFilteredRfRows.map((r) => ({
      date: r.date,
      endingEquity: r.endingEquity ?? null,
      drawdownAmount: r.drawdownAmount ?? null,
      drawdownPct: r.drawdownPct ?? null,
      cumulativePnl: r.cumulativePnl ?? null,
      highWaterMark: r.highWaterMark ?? null,
    }));

    const equityCurve = computeEquityCurve(rollforwardRowsForCharts);
    const drawdown = computeDrawdown(rollforwardRowsForCharts);

    // 7. Fetch settings startingAccountValue
    const setting = db.select().from(schema.settings).get();
    const startingAccountValue = setting?.startingAccountValue ?? null;

    // 8. Compute KPIs
    const kpis = computeKpiMetrics(allKpiInputs, closedKpiInputs, latestRollforward, startingAccountValue);

    // 9. Compute monthly performance and R distribution
    const monthlyPerformance = computeMonthlyPerformance(closedKpiInputs);
    const rDistribution = computeRDistribution(closedKpiInputs);

    return { status: 200, body: { kpis, equityCurve, drawdown, monthlyPerformance, rDistribution } };
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
    closedAt: overrides?.closedAt ?? null,
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
  // Use a spread of overrides so null values are passed through explicitly
  // (?? would convert null back to default, breaking null-filtering tests)
  const values: Record<string, unknown> = {
    id,
    accountId,
    date: '2026-07-01',
    endingEquity: 50000,
    drawdownAmount: 0,
    drawdownPct: 0,
    createdAt: NOW,
  };
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (overrides[key as keyof typeof overrides] !== undefined) {
        values[key] = overrides[key as keyof typeof overrides] as unknown;
      }
    }
  }
  db.insert(schema.accountRollforward).values(values as typeof schema.accountRollforward.$inferInsert).run();
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
  assert((result.body.error?.includes('No active account') ?? false), 'Error message mentions no active account');
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

// ── Equity Curve & Drawdown Tests ────────────────────────────────────

console.log('\n▶ Equity Curve & Drawdown');

// ── Test 12: equityCurve and drawdown are arrays (empty when no rollforward rows) ──
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const result = doGetDashboard(accountId);
  assert(Array.isArray(result.body.equityCurve), 'equityCurve is an array');
  assert(result.body.equityCurve!.length === 0, 'equityCurve is empty when no rollforward rows');
  assert(Array.isArray(result.body.drawdown), 'drawdown is an array');
  assert(result.body.drawdown!.length === 0, 'drawdown is empty when no rollforward rows');
}

// ── Test 13: equityCurve ordering and shape with multiple rollforward rows ──
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Seed 3 rollforward rows with increasing equity
  seedRollforward(accountId, {
    date: '2026-06-01',
    endingEquity: 10000,
    cumulativePnl: 500,
    highWaterMark: 10000,
    drawdownAmount: 0,
    drawdownPct: 0,
  });
  seedRollforward(accountId, {
    date: '2026-06-02',
    endingEquity: 10500,
    cumulativePnl: 1000,
    highWaterMark: 10500,
    drawdownAmount: 0,
    drawdownPct: 0,
  });
  seedRollforward(accountId, {
    date: '2026-06-03',
    endingEquity: 10200,
    cumulativePnl: 700,
    highWaterMark: 10500,
    drawdownAmount: -300,
    drawdownPct: -0.0286,
  });

  const result = doGetDashboard(accountId);

  assert(result.body.equityCurve!.length === 3, 'equityCurve has 3 points');
  assert(result.body.drawdown!.length === 3, 'drawdown has 3 points');

  // Equity curve ordering by date ASC
  assertDeepEqual(
    result.body.equityCurve![0],
    { date: '2026-06-01', equity: 10000, cumulativePnl: 500, highWaterMark: 10000 },
    'equityCurve[0] shape matches',
  );
  assertDeepEqual(
    result.body.equityCurve![1],
    { date: '2026-06-02', equity: 10500, cumulativePnl: 1000, highWaterMark: 10500 },
    'equityCurve[1] shape matches',
  );
  assertDeepEqual(
    result.body.equityCurve![2],
    { date: '2026-06-03', equity: 10200, cumulativePnl: 700, highWaterMark: 10500 },
    'equityCurve[2] shape matches',
  );

  // Drawdown ordering by date ASC
  assertDeepEqual(
    result.body.drawdown![2],
    { date: '2026-06-03', drawdownAmount: -300, drawdownPct: -0.0286 },
    'drawdown[2] has drawdown values',
  );
}

// ── Test 14: Drawdown filters rows where drawdownPct is null ──
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Row with null drawdownPct — should be filtered out by computeDrawdown
  seedRollforward(accountId, {
    date: '2026-06-01',
    endingEquity: 10000,
    drawdownPct: null as unknown as number,
    drawdownAmount: null as unknown as number,
  });
  seedRollforward(accountId, {
    date: '2026-06-02',
    endingEquity: 10200,
    drawdownPct: -0.02,
    drawdownAmount: -200,
  });

  const result = doGetDashboard(accountId);
  // Both rows have endingEquity set, so both appear in equityCurve
  // drawdown filters null drawdownPct, so only row 2 appears
  assert(result.body.drawdown!.length === 1, 'drawdown filters rows with null drawdownPct');
  assertDeepEqual(
    result.body.drawdown![0],
    { date: '2026-06-02', drawdownAmount: -200, drawdownPct: -0.02 },
    'drawdown[0] is the non-null row',
  );
}

// ── Test 15: Equity curve filters rows where endingEquity is null ──
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  seedRollforward(accountId, {
    date: '2026-06-01',
    endingEquity: null as unknown as number,
    drawdownPct: 0,
    drawdownAmount: 0,
  });
  seedRollforward(accountId, {
    date: '2026-06-02',
    endingEquity: 11000,
    drawdownPct: 0,
    drawdownAmount: 0,
  });

  const result = doGetDashboard(accountId);
  assert(result.body.equityCurve!.length === 1, 'equityCurve filters rows with null endingEquity');
  assertDeepEqual(
    result.body.equityCurve![0],
    { date: '2026-06-02', equity: 11000, cumulativePnl: 0, highWaterMark: 11000 },
    'equityCurve[0] is the non-null row',
  );
}

// ── Test 16: Existing KPI tests still pass alongside equity/drawdown ──
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, { symbol: 'AAPL', direction: 'long', status: 'closed' });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 120, fees: 5 });
  seedRiskSnapshot(t1, 500);
  seedGrade(t1, 85);

  seedRollforward(accountId, { endingEquity: 52000, drawdownAmount: -200, drawdownPct: -0.01 });

  const result = doGetDashboard(accountId);

  // KPI assertions (same as Test 5 subset)
  assertClose(result.body.kpis?.netPnl, 1990, 'netPnl still correct with equity/drawdown in response');
  assertClose(result.body.kpis?.accountValue, 52000, 'accountValue still correct');
  assertClose(result.body.kpis?.currentDrawdown, -200, 'currentDrawdown still correct');

  // Equity curve assertions
  assert(Array.isArray(result.body.equityCurve), 'equityCurve present alongside KPIs');
  assert(result.body.equityCurve!.length === 1, 'equityCurve has 1 point');
  assert(result.body.equityCurve![0].equity === 52000, 'equityCurve equity matches rollforward');

  // Drawdown assertions
  assert(Array.isArray(result.body.drawdown), 'drawdown present alongside KPIs');
  assert(result.body.drawdown!.length === 1, 'drawdown has 1 point');
}

// ── Monthly Performance Tests ──────────────────────────────────────────

console.log('\n▶ Monthly Performance');

// ── Test 17: Empty trades → monthlyPerformance empty ────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const result = doGetDashboard(accountId);
  assert(Array.isArray(result.body.monthlyPerformance), 'monthlyPerformance is an array');
  assert(result.body.monthlyPerformance!.length === 0, 'monthlyPerformance is empty when no trades');
}

// ── Test 18: Single month with multiple trades ───────────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Trade 1: Win in June — buy 100 @ 100, sell 100 @ 120, fees $10 → net $1990
  const t1 = seedTrade(accountId, {
    symbol: 'WIN1',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-15T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 120, fees: 5 });

  // Trade 2: Loss in June — buy 50 @ 200, sell 50 @ 190, fees $10 → net -$510
  const t2 = seedTrade(accountId, {
    symbol: 'LOSS1',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-20T14:00:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 50, price: 200, fees: 5 });
  seedExecution(t2, { action: 'sell', quantity: 50, price: 190, fees: 5 });

  seedRollforward(accountId, { endingEquity: 52000 });

  const result = doGetDashboard(accountId);
  assert(result.body.monthlyPerformance!.length === 1, 'Single month has 1 entry');
  assert(result.body.monthlyPerformance![0].month === '2026-06', 'Month is 2026-06');
  assertClose(result.body.monthlyPerformance![0].netPnl, 1480, 'June netPnl = 1990 + (-510) = 1480');
  assertClose(result.body.monthlyPerformance![0].winRate, 0.5, 'June winRate = 1/2 = 0.5');
  assert(result.body.monthlyPerformance![0].tradeCount === 2, 'June tradeCount = 2');
}

// ── Test 19: Multiple months ─────────────────────────────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // May: 1 win → net $1990
  const t1 = seedTrade(accountId, {
    symbol: 'MAY-WIN',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-05-10T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 120, fees: 5 });

  // June: 1 loss → net -$510
  const t2 = seedTrade(accountId, {
    symbol: 'JUN-LOSS',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-15T10:00:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 50, price: 200, fees: 5 });
  seedExecution(t2, { action: 'sell', quantity: 50, price: 190, fees: 5 });

  seedRollforward(accountId, { endingEquity: 52000 });

  const result = doGetDashboard(accountId);
  assert(result.body.monthlyPerformance!.length === 2, 'Two months have 2 entries');
  assert(result.body.monthlyPerformance![0].month === '2026-05', 'First month is May (chronological)');
  assert(result.body.monthlyPerformance![1].month === '2026-06', 'Second month is June');
  assertClose(result.body.monthlyPerformance![0].netPnl, 1990, 'May netPnl = 1990');
  assertClose(result.body.monthlyPerformance![0].winRate, 1, 'May winRate = 1.0');
  assert(result.body.monthlyPerformance![0].tradeCount === 1, 'May tradeCount = 1');
  assertClose(result.body.monthlyPerformance![1].netPnl, -510, 'June netPnl = -510');
  assertClose(result.body.monthlyPerformance![1].winRate, 0, 'June winRate = 0 (loss)');
  assert(result.body.monthlyPerformance![1].tradeCount === 1, 'June tradeCount = 1');
}

// ── Test 20: Open trades excluded from monthly performance ───────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Closed trade in June
  const t1 = seedTrade(accountId, {
    symbol: 'CLOSED-JUN',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-10T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100, fees: 2 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110, fees: 2 });

  // Open trade (should not appear)
  const t2 = seedTrade(accountId, {
    symbol: 'OPEN-TRADE',
    direction: 'long',
    status: 'open',
  });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 150 });

  seedRollforward(accountId, { endingEquity: 50000 });

  const result = doGetDashboard(accountId);
  assert(result.body.monthlyPerformance!.length === 1, 'Only 1 month from closed trade');
  assert(result.body.monthlyPerformance![0].tradeCount === 1, 'Open trade excluded from tradeCount');
}

// ── Test 21: Trades without closedAt excluded from monthly ───────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Trade with closedAt
  const t1 = seedTrade(accountId, {
    symbol: 'WITH-DATE',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-10T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100, fees: 2 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110, fees: 2 });

  // Trade without closedAt (should not appear)
  const t2 = seedTrade(accountId, {
    symbol: 'NO-DATE',
    direction: 'long',
    status: 'closed',
  });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t2, { action: 'sell', quantity: 10, price: 105 });

  seedRollforward(accountId, { endingEquity: 50000 });

  const result = doGetDashboard(accountId);
  assert(result.body.monthlyPerformance!.length === 1, 'Only the trade with closedAt contributes');
  assert(result.body.monthlyPerformance![0].tradeCount === 1, 'Trade without closedAt excluded');
}

// ── R Distribution Tests ────────────────────────────────────────────────

console.log('\n▶ R Distribution');

// ── Test 22: Empty trades → all bins at 0 ───────────────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const result = doGetDashboard(accountId);
  assert(Array.isArray(result.body.rDistribution), 'rDistribution is an array');
  assert(result.body.rDistribution!.length === 8, 'rDistribution has 8 bins');
  const allZero = result.body.rDistribution!.every((b) => b.count === 0);
  assert(allZero, 'All R distribution bins are 0 when no trades');
  // Verify bin labels
  const expectedLabels = ['<= -3', '-3 to -2', '-2 to -1', '-1 to 0', '0 to 1', '1 to 2', '2 to 3', '> 3'];
  assertDeepEqual(
    result.body.rDistribution!.map((b) => b.label),
    expectedLabels,
    'R distribution has correct bin labels',
  );
}

// ── Test 23: No risk snapshots → all bins at 0 ─────────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Closed trades but no risk snapshots
  const t1 = seedTrade(accountId, {
    symbol: 'NO-RISK-1',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-10T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });

  const t2 = seedTrade(accountId, {
    symbol: 'NO-RISK-2',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-15T10:00:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 200 });
  seedExecution(t2, { action: 'sell', quantity: 10, price: 190 });

  seedRollforward(accountId, { endingEquity: 50000 });

  const result = doGetDashboard(accountId);
  assert(result.body.rDistribution!.length === 8, 'rDistribution has 8 bins');
  const allZero = result.body.rDistribution!.every((b) => b.count === 0);
  assert(allZero, 'All R distribution bins are 0 when no risk snapshots');
}

// ── Test 24: Mixed R values across different bins ───────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Trade: R = (110-100)*10 / 200 = 100/200 = 0.5 → "0 to 1" bin
  const t1 = seedTrade(accountId, {
    symbol: 'R05',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-01T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100, fees: 0 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110, fees: 0 });
  seedRiskSnapshot(t1, 200);

  // Trade: R = (190-200)*50 / 400 = -500/400 = -1.25 → "-2 to -1" bin (index 2)
  const t2 = seedTrade(accountId, {
    symbol: 'R125',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-02T10:00:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 50, price: 200, fees: 0 });
  seedExecution(t2, { action: 'sell', quantity: 50, price: 190, fees: 0 });
  seedRiskSnapshot(t2, 400);

  // Trade: R = 3.98 → "> 3" bin
  const t3 = seedTrade(accountId, {
    symbol: 'R398',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-03T10:00:00.000Z',
  });
  seedExecution(t3, { action: 'buy', quantity: 100, price: 100, fees: 0 });
  seedExecution(t3, { action: 'sell', quantity: 100, price: 120, fees: 10 });
  seedRiskSnapshot(t3, 500);

  // Trade: R = -3.2 → "<= -3" bin
  const t4 = seedTrade(accountId, {
    symbol: 'R32',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-04T10:00:00.000Z',
  });
  seedExecution(t4, { action: 'buy', quantity: 10, price: 200, fees: 0 });
  seedExecution(t4, { action: 'sell', quantity: 10, price: 100, fees: 0 });
  seedRiskSnapshot(t4, 300);

  seedRollforward(accountId, { endingEquity: 50000 });

  const result = doGetDashboard(accountId);
  assert(result.body.rDistribution!.length === 8, 'rDistribution has 8 bins');
  assert(result.body.rDistribution![3].label === '-1 to 0', 'Bin -1 to 0 is at index 3');
  assert(result.body.rDistribution![4].label === '0 to 1', 'Bin 0 to 1 is at index 4');
  assert(result.body.rDistribution![1].label === '-3 to -2', 'Bin -3 to -2 is at index 1');
  assert(result.body.rDistribution![2].label === '-2 to -1', 'Bin -2 to -1 is at index 2');
  assert(result.body.rDistribution![7].label === '> 3', 'Bin > 3 is at index 7');
  assert(result.body.rDistribution![4].count === 1, '0 to 1 bin count = 1 (R=0.5)');
  assert(result.body.rDistribution![2].count === 1, '-2 to -1 bin count = 1 (R=-1.25)');
  assert(result.body.rDistribution![7].count === 1, '> 3 bin count = 1 (R=3.98)');
  assert(result.body.rDistribution![0].count === 1, '<= -3 bin count = 1 (R=-3.2)');
}

// ── Test 25: R = 0 goes to 0 to 1 bin (not -1 to 0) ─────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // PnL = 0, R = 0 / 500 = 0 → "0 to 1" bin (since 0 >= 0 and 0 < 1)
  const t1 = seedTrade(accountId, {
    symbol: 'RZERO',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-01T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 0 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 100, fees: 0 });
  seedRiskSnapshot(t1, 500);

  seedRollforward(accountId, { endingEquity: 50000 });

  const result = doGetDashboard(accountId);
  assert(result.body.rDistribution![4].label === '0 to 1', 'Bin 0 to 1 label correct');
  assert(result.body.rDistribution![4].count === 1, 'R=0 goes to 0 to 1 bin (edge: >= 0)');
  assert(result.body.rDistribution![3].count === 0, '-1 to 0 bin is empty');
}

// ── Test 26: R = -1 goes to -1 to 0 bin ────────────────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // PnL = -500, R = -500 / 500 = -1 → "-1 to 0" bin (since -1 >= -1 and -1 < 0)
  const t1 = seedTrade(accountId, {
    symbol: 'RNEG1',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-01T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 0 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 95, fees: 0 });
  seedRiskSnapshot(t1, 500);

  seedRollforward(accountId, { endingEquity: 50000 });

  const result = doGetDashboard(accountId);
  assert(result.body.rDistribution![3].label === '-1 to 0', 'Bin -1 to 0 label correct');
  assert(result.body.rDistribution![3].count === 1, 'R=-1.0 goes to -1 to 0 bin (edge: >= -1)');
  assert(result.body.rDistribution![1].count === 0, '-3 to -2 bin is empty');
}

// ── Test 27: Combined: monthlyPerformance and rDistribution present alongside KPIs ──
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, {
    symbol: 'COMBINED',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-15T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 120, fees: 5 });
  seedRiskSnapshot(t1, 500);
  seedGrade(t1, 80);

  seedRollforward(accountId, { endingEquity: 52000, drawdownAmount: -200, drawdownPct: -0.01 });

  const result = doGetDashboard(accountId);

  // Existing KPIs still present
  assert(result.body.kpis !== undefined, 'kpis present with new fields');
  assertClose(result.body.kpis?.netPnl, 1990, 'netPnl still correct');
  assert(result.body.kpis?.totalTrades === 1, 'totalTrades still correct');

  // Equity curve still present
  assert(Array.isArray(result.body.equityCurve), 'equityCurve present');

  // Drawdown still present
  assert(Array.isArray(result.body.drawdown), 'drawdown present');

  // New fields present
  assert(Array.isArray(result.body.monthlyPerformance), 'monthlyPerformance present');
  assert(result.body.monthlyPerformance!.length === 1, 'monthlyPerformance has data');
  assert(result.body.monthlyPerformance![0].month === '2026-06', 'monthlyPerformance month correct');
  assertClose(result.body.monthlyPerformance![0].netPnl, 1990, 'monthlyPerformance netPnl correct');

  assert(Array.isArray(result.body.rDistribution), 'rDistribution present');
  assert(result.body.rDistribution!.length === 8, 'rDistribution has 8 bins');
  // R = (120-100)*100 - 10 = 1990 / 500 = 3.98
  assert(result.body.rDistribution![7].count === 1, 'R=3.98 in > 3 bin');
}

// ── Test 28: Monthly performance sorted chronologically ─────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Insert out of order (Aug before July) — should sort by YYYY-MM
  const aug = seedTrade(accountId, {
    symbol: 'AUG-TRADE',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-08-10T10:00:00.000Z',
  });
  seedExecution(aug, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(aug, { action: 'sell', quantity: 10, price: 110 });

  const jul = seedTrade(accountId, {
    symbol: 'JUL-TRADE',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-07-10T10:00:00.000Z',
  });
  seedExecution(jul, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(jul, { action: 'sell', quantity: 10, price: 110 });

  seedRollforward(accountId, { endingEquity: 52000 });

  const result = doGetDashboard(accountId);
  assert(result.body.monthlyPerformance!.length === 2, 'Two months from different months');
  assert(result.body.monthlyPerformance![0].month === '2026-07', 'First is July (chronological)');
  assert(result.body.monthlyPerformance![1].month === '2026-08', 'Second is August');
}

// ── Test 29: Date filter - no dateFrom or dateTo (shows all) ────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, {
    symbol: 'DT-ALL',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-01T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });
  seedRiskSnapshot(t1, 100)

  const t2 = seedTrade(accountId, {
    symbol: 'DT-ALL2',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-07-01T10:00:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t2, { action: 'sell', quantity: 10, price: 120 });
  seedRiskSnapshot(t2, 100)

  seedRollforward(accountId, { endingEquity: 52000 });

  const result = doGetDashboard(accountId);
  assert(result.body.kpis!.totalTrades === 2, 'No date filter shows all 2 trades');
  assertClose(result.body.kpis!.netPnl, 300, 'No date filter netPnl = 100 + 200');
}

// ── Test 30: Date filter - only dateFrom ───────────────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, {
    symbol: 'DT-FROM1',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-01T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });
  seedRiskSnapshot(t1, 100)

  // This trade closed after dateFrom cutoff
  const t2 = seedTrade(accountId, {
    symbol: 'DT-FROM2',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-07-15T10:00:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t2, { action: 'sell', quantity: 10, price: 120 });
  seedRiskSnapshot(t2, 100)

  seedRollforward(accountId, { endingEquity: 52000 });

  // Only trades with closedAt >= 2026-07-01 should contribute P&L
  const result = doGetDashboard(accountId, '2026-07-01');

  // totalTrades still counts all trades (unfiltered)
  assert(result.body.kpis!.totalTrades === 2, 'totalTrades still = 2 (unfiltered)');
  // netPnl only includes trades closed on/after dateFrom
  assertClose(result.body.kpis!.netPnl, 200, 'dateFrom filter: netPnl only from July trade');
}

// ── Test 31: Date filter - only dateTo ─────────────────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, {
    symbol: 'DT-TO1',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-01T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });
  seedRiskSnapshot(t1, 100)

  const t2 = seedTrade(accountId, {
    symbol: 'DT-TO2',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-07-15T10:00:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t2, { action: 'sell', quantity: 10, price: 120 });
  seedRiskSnapshot(t2, 100)

  seedRollforward(accountId, { endingEquity: 52000 });

  // Only trades with closedAt <= 2026-06-30 should contribute P&L
  const result = doGetDashboard(accountId, null, '2026-06-30');

  assert(result.body.kpis!.totalTrades === 2, 'totalTrades still = 2 (unfiltered)');
  assertClose(result.body.kpis!.netPnl, 100, 'dateTo filter: netPnl only from June trade');
}

// ── Test 32: Date filter - both dateFrom and dateTo set ────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, {
    symbol: 'DT-BOTH1',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-05-01T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });
  seedRiskSnapshot(t1, 100)

  const t2 = seedTrade(accountId, {
    symbol: 'DT-BOTH2',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-15T10:00:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t2, { action: 'sell', quantity: 10, price: 120 });
  seedRiskSnapshot(t2, 100)

  const t3 = seedTrade(accountId, {
    symbol: 'DT-BOTH3',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-07-20T10:00:00.000Z',
  });
  seedExecution(t3, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t3, { action: 'sell', quantity: 10, price: 130 });
  seedRiskSnapshot(t3, 100)

  seedRollforward(accountId, { endingEquity: 52000 });

  // dateFrom=2026-06-01, dateTo=2026-06-30 — only t2 should contribute
  const result = doGetDashboard(accountId, '2026-06-01', '2026-06-30');

  assert(result.body.kpis!.totalTrades === 3, 'totalTrades still = 3 (unfiltered)');
  assertClose(result.body.kpis!.netPnl, 200, 'Both filters: netPnl only from June trade');
}

// ── Test 33: Date filter - no matching trades ──────────────────────────
cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const t1 = seedTrade(accountId, {
    symbol: 'DT-NONE1',
    direction: 'long',
    status: 'closed',
    closedAt: '2026-06-15T10:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });
  seedRiskSnapshot(t1, 100)

  seedRollforward(accountId, { endingEquity: 52000 });

  // Filter to a date range with no closed trades
  const result = doGetDashboard(accountId, '2025-01-01', '2025-01-31');

  assert(result.body.kpis!.totalTrades === 1, 'totalTrades still = 1 (unfiltered)');
  assertClose(result.body.kpis!.netPnl, 0, 'No matching closed trades → netPnl = 0');
  assert(result.body.kpis!.winRate === null, 'No matching closed trades → winRate = null');
  assert(result.body.kpis!.avgR === null, 'No matching closed trades → avgR = null');
}

// ── Summary ────────────────────────────────────────────────────────────

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
