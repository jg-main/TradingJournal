/**
 * trades route test
 *
 * Tests GET (list with pagination, status filter, date-range filter, account filter,
 * direction filter, totals aggregation) and POST (create, validation, account resolution).
 *
 * Enriched rows now use computeTradeMetrics() for realizedPnl, unrealizedPnl, returnPct,
 * riskPct, nested metrics, and server-computed totals.
 *
 * Run: npx tsx src/app/api/trades/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput } from '@/lib/trade-metrics';

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

function assertApprox(actual: number | null, expected: number, tolerance: number, msg: string) {
  if (actual === null) { failed++; console.error(`  ❌ ${msg} — got null, expected ~${expected} (FAILED)`); return; }
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) { passed++; console.log(`  ✅ ${msg} (${actual.toFixed(4)} ≈ ${expected})`); }
  else { failed++; console.error(`  ❌ ${msg} — got ${actual}, expected ~${expected} (diff ${diff.toFixed(4)}) (FAILED)`); }
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

const DB_FILE = process.env.DB_FILE_NAME || './.test-trades.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS watchlist_items;
  DROP TABLE IF EXISTS weekly_reviews;
  DROP TABLE IF EXISTS setup_definitions;
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
    default_account_id TEXT,
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
  CREATE TABLE IF NOT EXISTS lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_risk_snapshots (
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
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL,
    executed_at TEXT,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
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
    gross_realized_pnl REAL,
    net_realized_pnl REAL,
    realized_fees REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetTrades(params: {
  page?: number;
  limit?: number;
  status?: string;
  from?: string;
  to?: string;
  accountId?: string;
  direction?: string;
} = {}): { status: number; data: unknown } {
  try {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const offset = (page - 1) * limit;

    const statusFilter = params.status as 'open' | 'planned' | 'closed' | 'deleted' | undefined;

    // Build filters
    const filters: any[] = [];

    if (statusFilter) {
      filters.push(eq(schema.trades.status, statusFilter));
    }
    // Status-aware date filtering (matching route.ts logic)
    // open → date filters ignored (all open positions visible regardless of date)
    // closed → filter by closedAt
    // planned → filter by createdAt
    // default (no status or other) → filter by openedAt (backward compatible)
    const dateColumn = statusFilter === 'closed'
      ? schema.trades.closedAt
      : statusFilter === 'planned'
        ? schema.trades.createdAt
        : schema.trades.openedAt;

    if (statusFilter === 'open') {
      if (params.from || params.to) {
        console.warn('[doGetTrades] Date range filters ignored for status=open');
      }
    } else {
      if (params.from) {
        filters.push(sql`${dateColumn} >= ${params.from}`);
      }
      if (params.to) {
        filters.push(sql`${dateColumn} <= ${params.to}`);
      }
    }
    if (params.accountId) {
      filters.push(eq(schema.trades.accountId, params.accountId));
    }
    if (params.direction) {
      if (!['long', 'short'].includes(params.direction)) {
        return { status: 400, data: { error: 'Validation failed', details: 'direction must be "long" or "short"' } };
      }
      filters.push(eq(schema.trades.direction, params.direction as 'long' | 'short'));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    // Total count
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.trades)
      .where(whereClause)
      .get();
    const total = countResult?.count ?? 0;

    // Paginated data
    const dbRows = db
      .select()
      .from(schema.trades)
      .where(whereClause)
      .orderBy(desc(schema.trades.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Batch-fetch related data
    const tradeIds = dbRows.map((r) => r.id);
    const execRows = tradeIds.length > 0
      ? db.select().from(schema.tradeExecutions).where(inArray(schema.tradeExecutions.tradeId, tradeIds)).all()
      : [];
    const riskRows = tradeIds.length > 0
      ? db.select().from(schema.tradeRiskSnapshots).where(inArray(schema.tradeRiskSnapshots.tradeId, tradeIds)).all()
      : [];

    const execMap = new Map<string, (typeof schema.tradeExecutions.$inferSelect)[]>();
    for (const ex of execRows) {
      const list = execMap.get(ex.tradeId) ?? [];
      list.push(ex);
      execMap.set(ex.tradeId, list);
    }
    const riskMap = new Map<string, typeof schema.tradeRiskSnapshots.$inferSelect>();
    for (const risk of riskRows) {
      riskMap.set(risk.tradeId, risk);
    }

    // Compute enriched rows with computeTradeMetrics()
    const enhancedRows = dbRows.map((row) => {
      const executions = execMap.get(row.id) ?? [];
      const riskSnapshot = riskMap.get(row.id) ?? null;

      const metricsInput: TradeMetricsInput = {
        executions: executions.map((e) => ({
          id: e.id,
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees,
          executedAt: e.executedAt ?? '',
        })),
        direction: row.direction as 'long' | 'short',
        riskSnapshot: riskSnapshot
          ? {
              initialRiskAmount: riskSnapshot.initialRiskAmount,
              accountEquityAtOpen: riskSnapshot.accountEquityAtOpen,
            }
          : null,
        stopAdjustments: [],
        currentMark:
          row.currentPrice != null
            ? { price: row.currentPrice, markedAt: row.currentPriceFetchedAt ?? new Date().toISOString() }
            : null,
        currentAccountEquity: null,
      };

      const metrics = computeTradeMetrics(metricsInput);

      return {
        ...row,
        realizedPnl: metrics.realizedPnl.netRealizedPnl,
        unrealizedPnl: metrics.unrealizedPnl.grossUnrealizedPnl,
        returnPct: metrics.returnMetrics.returnPct,
        riskPct: metrics.risk.riskToAccount,
        metrics,
      };
    });

    // Server-computed totals aggregated across the full filtered dataset
    const totals = {
      grossRealizedPnl: enhancedRows.reduce((s, r) => s + (r.metrics?.realizedPnl.grossRealizedPnl ?? 0), 0),
      netRealizedPnl: enhancedRows.reduce((s, r) => s + (r.metrics?.realizedPnl.netRealizedPnl ?? 0), 0),
      totalFees: enhancedRows.reduce((s, r) => s + (r.metrics?.fees.totalFees ?? 0), 0),
    };

    return { status: 200, data: { data: enhancedRows, total, page, limit, totals } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch trades', details: String(error) } };
  }
}

function doPostTrade(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const symbol = body.symbol;
    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { symbol: ['Symbol is required'] } } } };
    }
    if ((symbol as string).length > 20) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { symbol: ['String must contain at most 20 character(s)'] } } } };
    }

    const direction = body.direction;
    if (direction !== 'long' && direction !== 'short') {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { direction: ['Invalid enum value. Expected long | short'] } } } };
    }

    // Resolve account: settings.defaultAccountId first, then first active account
    const setting = db.select().from(schema.settings).get() as Record<string, unknown> | undefined;
    let accountId: string | undefined;

    if (setting?.defaultAccountId) {
      accountId = setting.defaultAccountId as string;
    } else {
      const firstActive = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.isActive, true))
        .get() as Record<string, unknown> | undefined;
      accountId = firstActive?.id as string | undefined;
    }

    if (!accountId) {
      return { status: 400, data: { error: 'No active account found. Create an account first or set a default account in settings.' } };
    }

    // Generate tradeCode: T-XXXX
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.trades)
      .get();

    const nextNumber = (countResult?.count ?? 0) + 1;
    const tradeCode = `T-${String(nextNumber).padStart(4, '0')}`;

    // Resolve setup string to UUID if provided
    let resolvedSetupId: string | null = null;
    const setup = body.setup;
    if (setup !== undefined && setup !== null && setup !== '') {
      const lowerValue = (setup as string).toLowerCase();
      const lookup = db
        .select()
        .from(schema.lookupValues)
        .where(and(eq(schema.lookupValues.type, 'setup'), eq(schema.lookupValues.value, lowerValue)))
        .get() as Record<string, unknown> | undefined;
      if (!lookup) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { setup: ['Unknown setup value'] } } } };
      }
      resolvedSetupId = lookup.id as string;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.trades)
      .values({
        id,
        tradeCode,
        accountId,
        symbol: (symbol as string).trim(),
        direction,
        setupId: resolvedSetupId,
        sectorId: (body.sectorId as string) ?? null,
        marketConditionId: (body.marketConditionId as string) ?? null,
        status: 'planned',
        thesis: (body.thesis as string) ?? null,
        plannedEntry: (body.plannedEntry as number) ?? null,
        plannedStop: (body.plannedStop as number) ?? null,
        plannedTarget1: (body.plannedTarget1 as number) ?? null,
        plannedQuantity: (body.plannedQuantity as number) ?? null,
        invalidationCondition: (body.invalidationCondition as string) ?? null,
        preTradePlan: (body.preTradePlan as string) ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(schema.trades).where(eq(schema.trades.id, id)).get();
    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create trade', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_risk_snapshots');
  sqlite.exec('DELETE FROM trade_executions');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM settings;');
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

function seedSettings(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.settings)
    .values({
      id,
      currency: 'USD',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.settings).where(eq(schema.settings.id, id)).get() as Record<string, unknown>;
}

function seedLookupValue(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.lookupValues)
    .values({
      id,
      type: 'setup',
      value: 'breakout',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get() as Record<string, unknown>;
}

function seedTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `T-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
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
      tradeId: '__missing__',
      action: 'buy',
      quantity: 100,
      price: 100,
      fees: 0,
      executedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return id;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trades API Tests ---\n');

// ── 1. GET: Empty list ─────────────────────────────────────────────

console.log('\n1. GET returns empty list with pagination metadata:');
{
  cleanup();
  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const data = result.data as { data: unknown[]; total: number; page: number; limit: number; totals: unknown };
  assert(Array.isArray(data.data), 'response.data is an array');
  assertEqual(data.data.length, 0, 'data array is empty');
  assertEqual(data.total, 0, 'total is 0');
  assertEqual(data.page, 1, 'page is 1');
  assertEqual(data.limit, 50, 'limit is 50');
  assertNotNull(data.totals, 'totals object is present');
}

// ── 2. GET: Pagination ─────────────────────────────────────────────

console.log('\n2. GET returns paginated results:');
{
  cleanup();
  // Ensure test-account-id exists in accounts table
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL' });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT' });
  seedTrade({ accountId: 'test-account-id', symbol: 'GOOGL' });

  const page1 = doGetTrades({ page: 1, limit: 2 });
  assert(page1.status === 200, 'page 1 returns 200');
  const d1 = page1.data as { data: unknown[]; total: number; page: number; limit: number; totals: unknown };
  assertEqual(d1.data.length, 2, 'page 1 has 2 items');
  assertEqual(d1.total, 3, 'total is 3');
  assertEqual(d1.page, 1, 'page is 1');
  assertEqual(d1.limit, 2, 'limit is 2');

  const page2 = doGetTrades({ page: 2, limit: 2 });
  assert(page2.status === 200, 'page 2 returns 200');
  const d2 = page2.data as { data: unknown[]; total: number; page: number; limit: number; totals: unknown };
  assertEqual(d2.data.length, 1, 'page 2 has 1 item');
  assertEqual(d2.total, 3, 'total is 3');
  assertEqual(d2.page, 2, 'page is 2');
}

// ── 3. GET: Status filter ──────────────────────────────────────────

console.log('\n3. GET filters by status:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'planned' });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'open' });

  const planned = doGetTrades({ status: 'planned' });
  assert(planned.status === 200, 'status filter returns 200');
  const dp = planned.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(dp.data.length, 1, 'returns 1 planned trade');
  assertEqual(dp.data[0].symbol, 'AAPL', 'planned trade symbol matches');
  assertEqual(dp.data[0].status, 'planned', 'status is planned');
  assertNotNull(dp.totals, 'totals present in filtered response');

  const open = doGetTrades({ status: 'open' });
  assert(open.status === 200, 'open filter returns 200');
  const dop = open.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(dop.data.length, 1, 'returns 1 open trade');
  assertEqual(dop.data[0].symbol, 'MSFT', 'open trade symbol matches');
  assertEqual(dop.data[0].status, 'open', 'status is open');
}

// ── 4. POST: Create with valid data ─────────────────────────────────

console.log('\n4. POST creates a trade with valid data:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', thesis: 'Test trade' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertNotNull(data.tradeCode, 'has tradeCode');
  assert((data.tradeCode as string).startsWith('T-'), 'tradeCode starts with T-');
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
  assertEqual(data.direction, 'long', 'direction matches');
  assertEqual(data.status, 'planned', 'status is planned');
  assertEqual(data.thesis, 'Test trade', 'thesis matches');
  assertNotNull(data.createdAt, 'has createdAt');
  assertNotNull(data.updatedAt, 'has updatedAt');
}

// ── 5. POST: Validates empty symbol ─────────────────────────────────

console.log('\n5. POST returns 400 for empty symbol:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const result = doPostTrade({ symbol: '', direction: 'long' });
  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Validates direction enum ───────────────────────────────

console.log('\n6. POST returns 400 for invalid direction:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const result = doPostTrade({ symbol: 'AAPL', direction: 'invalid' });
  assert(result.status === 400, 'returns 400');
}

// ── 7. POST: Resolves setup string to UUID ──────────────────────────

console.log('\n7. POST resolves setup string to lookup UUID:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const lookup = seedLookupValue({ type: 'setup', value: 'breakout' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', setup: 'breakout' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.setupId, lookup.id, 'setupId matches lookup id');
}

// ── 8. POST: Picks defaultAccountId from settings ───────────────────

console.log('\n8. POST picks defaultAccountId from settings:');
{
  cleanup();
  const account1 = seedAccount({ name: 'Default Account' });
  seedAccount({ name: 'Other Account' });
  seedSettings({ defaultAccountId: account1.id });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.accountId, account1.id, 'accountId matches default account');
}

// ── 9. POST: Picks first active account without settings ────────────

console.log('\n9. POST picks first active account when no default settings:');
{
  cleanup();
  const account1 = seedAccount({ name: 'First Account' });
  seedAccount({ name: 'Second Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.accountId, account1.id, 'accountId matches first active account');
}

// ── 10. POST: With plannedQuantity 100 returns plannedQuantity in response ─

console.log('\n10. POST with plannedQuantity 100 returns plannedQuantity in response:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', plannedQuantity: 100 });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.plannedQuantity, 100, 'plannedQuantity = 100 in POST response');
}

// ── 11. POST: Without plannedQuantity returns null ────────────────────

console.log('\n11. POST without plannedQuantity returns null:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.plannedQuantity, null, 'plannedQuantity is null when not provided');
}

// ── 12. POST: Returns 400 with no active accounts ───────────────────

console.log('\n12. POST returns 400 when no active accounts exist:');
{
  cleanup();
  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });
  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string };
  assert(data.error.includes('No active account'), 'error mentions no active account');
}

// ── 13. GET: Date-range filter ─────────────────────────────────────

console.log('\n13. GET filters by date range:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'open', openedAt: '2024-01-15T10:00:00.000Z', createdAt: new Date().toISOString() });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'open', openedAt: '2024-06-15T10:00:00.000Z', createdAt: new Date().toISOString() });
  seedTrade({ accountId: 'test-account-id', symbol: 'GOOGL', status: 'open', openedAt: '2024-12-15T10:00:00.000Z', createdAt: new Date().toISOString() });

  const q1 = doGetTrades({ from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.000Z' });
  assert(q1.status === 200, 'Q1 filter returns 200');
  const d1 = q1.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d1.data.length, 1, 'Q1 has 1 trade');
  assertEqual(d1.data[0].symbol, 'AAPL', 'Q1 trade is AAPL');
  assertNotNull(d1.totals, 'totals present in date-filtered response');

  const q2 = doGetTrades({ from: '2024-04-01T00:00:00.000Z', to: '2024-09-30T23:59:59.000Z' });
  assert(q2.status === 200, 'Q2-Q3 filter returns 200');
  const d2 = q2.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d2.data.length, 1, 'Q2-Q3 has 1 trade');
  assertEqual(d2.data[0].symbol, 'MSFT', 'Q2-Q3 trade is MSFT');

  const all = doGetTrades({ from: '2024-01-01T00:00:00.000Z' });
  assert(all.status === 200, 'from-only filter returns 200');
  const da = all.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(da.data.length, 3, 'from-only returns all 3 trades');
}

// ── 14. GET: Account filter ────────────────────────────────────────

console.log('\n14. GET filters by accountId:');
{
  cleanup();
  seedAccount({ id: 'acc-1', name: 'Account 1' });
  seedAccount({ id: 'acc-2', name: 'Account 2' });
  seedTrade({ accountId: 'acc-1', symbol: 'AAPL', status: 'open' });
  seedTrade({ accountId: 'acc-2', symbol: 'TSLA', status: 'open' });

  const acc1 = doGetTrades({ accountId: 'acc-1' });
  assert(acc1.status === 200, 'account filter returns 200');
  const d1 = acc1.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(d1.data.length, 1, 'acc-1 has 1 trade');
  assertEqual(d1.data[0].symbol, 'AAPL', 'acc-1 trade is AAPL');

  const acc2 = doGetTrades({ accountId: 'acc-2' });
  const d2 = acc2.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(d2.data.length, 1, 'acc-2 has 1 trade');
  assertEqual(d2.data[0].symbol, 'TSLA', 'acc-2 trade is TSLA');

  const missing = doGetTrades({ accountId: 'acc-nonexistent' });
  const dm = missing.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(dm.data.length, 0, 'nonexistent account has 0 trades');
}

// ── 15. GET: Direction filter ──────────────────────────────────────

console.log('\n15. GET filters by direction:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open' });
  seedTrade({ accountId: 'test-account-id', symbol: 'TSLA', direction: 'short', status: 'open' });

  const longs = doGetTrades({ direction: 'long' });
  assert(longs.status === 200, 'direction=long returns 200');
  const dl = longs.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(dl.data.length, 1, '1 long trade');
  assertEqual(dl.data[0].symbol, 'AAPL', 'long trade is AAPL');

  const shorts = doGetTrades({ direction: 'short' });
  const ds = shorts.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(ds.data.length, 1, '1 short trade');
  assertEqual(ds.data[0].symbol, 'TSLA', 'short trade is TSLA');
}

// ── 16. GET: Invalid direction returns 400 ─────────────────────────

console.log('\n16. GET returns 400 for invalid direction:');
{
  cleanup();
  const result = doGetTrades({ direction: 'invalid' });
  assert(result.status === 400, 'returns 400');
}

// ── 17. GET: Totals aggregation ────────────────────────────────────

console.log('\n17. GET returns server-computed totals:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });

  // Closed long: realize 992 (P&L 1000 - fees 8)
  const trade1 = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'closed' });
  const t1Id = trade1.id as string;
  seedExecution({ tradeId: t1Id, action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution({ tradeId: t1Id, action: 'sell', quantity: 100, price: 110, fees: 3 });

  // Closed short: realizes 994 (P&L 1000 - fees 6)
  const trade2 = seedTrade({ accountId: 'test-account-id', symbol: 'TSLA', direction: 'short', status: 'closed' });
  const t2Id = trade2.id as string;
  seedExecution({ tradeId: t2Id, action: 'sell_short', quantity: 50, price: 200, fees: 4 });
  seedExecution({ tradeId: t2Id, action: 'buy_to_cover', quantity: 50, price: 180, fees: 2 });

  // Open trade contributes 0 to realized totals
  const trade3 = seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', direction: 'long', status: 'open' });

  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[]; totals: { grossRealizedPnl: number; netRealizedPnl: number; totalFees: number } };

  assertNotNull(d.totals, 'totals object is present');
  // grossRealizedPnl = 1000 (long) + 1000 (short) = 2000
  assertEqual(d.totals.grossRealizedPnl, 2000, 'totals.grossRealizedPnl = 2000');
  // netRealizedPnl = 992 + 994 = 1986
  assertEqual(d.totals.netRealizedPnl, 1986, 'totals.netRealizedPnl = 1986');
  // totalFees = 8 (long) + 6 (short) = 14
  assertEqual(d.totals.totalFees, 14, 'totals.totalFees = 14');
}

// ── 18. GET: Enriched rows have metrics object ─────────────────────

console.log('\n18. GET enriched rows have metrics and flat fields:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'closed' });
  const tId = trade.id as string;
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution({ tradeId: tId, action: 'sell', quantity: 100, price: 110, fees: 3 });

  const result = doGetTrades();
  const d = result.data as { data: Record<string, unknown>[]; totals: unknown };
  const row = d.data[0] as Record<string, unknown>;

  assertNotNull(row.metrics, 'metrics object is present');
  assertNotNull(row.realizedPnl, 'realizedPnl flat field is present');
  assertEqual(row.unrealizedPnl, null, 'unrealizedPnl is null for closed trade');
  assertNotNull(row.returnPct, 'returnPct flat field is present');

  const m = row.metrics as Record<string, unknown>;
  assertNotNull(m.size, 'metrics.size');
  assertNotNull(m.averagePrices, 'metrics.averagePrices');
  assertNotNull(m.fees, 'metrics.fees');
  assertNotNull(m.realizedPnl, 'metrics.realizedPnl');
  assertNotNull(m.returnMetrics, 'metrics.returnMetrics');
}

// ── 19. GET: Open trades ignore date filters ─────────────────────

console.log('\n19. GET status-aware: open trades ignore date filters:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'open', openedAt: '2024-01-15T10:00:00.000Z', createdAt: new Date().toISOString() });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'open', openedAt: '2024-06-15T10:00:00.000Z', createdAt: new Date().toISOString() });

  // Status=open with date range that matches NEITHER trade — open trades should ALL be returned
  const result = doGetTrades({ status: 'open', from: '2099-01-01T00:00:00.000Z' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d.data.length, 2, 'both open trades returned despite restrictive date filter');
  assertEqual(d.data[0].symbol, 'MSFT', 'first trade is MSFT (newer created_at)');
  assertEqual(d.data[1].symbol, 'AAPL', 'second trade is AAPL');
  assertNotNull(d.totals, 'totals present');
}

// ── 20. GET: Closed trades filtered by closedAt ────────────────────

console.log('\n20. GET status-aware: closed trades filtered by closedAt:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'closed', openedAt: '2024-01-15T10:00:00.000Z', closedAt: '2024-02-01T10:00:00.000Z', createdAt: new Date().toISOString() });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'closed', openedAt: '2024-03-15T10:00:00.000Z', closedAt: '2024-06-01T10:00:00.000Z', createdAt: new Date().toISOString() });

  // Filter by closedAt range
  const q1 = doGetTrades({ status: 'closed', from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.000Z' });
  assert(q1.status === 200, 'returns 200');
  const d1 = q1.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d1.data.length, 1, '1 closed trade in Q1');
  assertEqual(d1.data[0].symbol, 'AAPL', 'Q1 closed trade is AAPL (closedAt=Feb)');
  assertNotNull(d1.totals, 'totals present');

  const q2 = doGetTrades({ status: 'closed', from: '2024-04-01T00:00:00.000Z', to: '2024-12-31T23:59:59.000Z' });
  assert(q2.status === 200, 'returns 200');
  const d2 = q2.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d2.data.length, 1, '1 closed trade in Q2-Q4');
  assertEqual(d2.data[0].symbol, 'MSFT', 'Q2-Q4 closed trade is MSFT (closedAt=Jun)');
}

// ── 21. GET: Planned trades filtered by createdAt ──────────────────

console.log('\n21. GET status-aware: planned trades filtered by createdAt:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'planned', createdAt: '2024-01-15T10:00:00.000Z', openedAt: null });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'planned', createdAt: '2024-06-15T10:00:00.000Z', openedAt: null });
  // Also create an open trade to verify it does NOT appear when filtering by planned
  seedTrade({ accountId: 'test-account-id', symbol: 'GOOGL', status: 'open', createdAt: '2024-03-15T10:00:00.000Z', openedAt: '2024-03-15T10:00:00.000Z' });

  const q1 = doGetTrades({ status: 'planned', from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.000Z' });
  assert(q1.status === 200, 'returns 200');
  const d1 = q1.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d1.data.length, 1, '1 planned trade in Q1');
  assertEqual(d1.data[0].symbol, 'AAPL', 'Q1 planned trade is AAPL (createdAt=Jan)');
  assertNotNull(d1.totals, 'totals present');

  const q2 = doGetTrades({ status: 'planned', from: '2024-04-01T00:00:00.000Z', to: '2024-12-31T23:59:59.000Z' });
  assert(q2.status === 200, 'returns 200');
  const d2 = q2.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d2.data.length, 1, '1 planned trade in Q2-Q4');
  assertEqual(d2.data[0].symbol, 'MSFT', 'Q2-Q4 planned trade is MSFT (createdAt=Jun)');

  // Without status filter, date filters use openedAt (backward compatible)
  // Only GOOGL has a non-null openedAt, so it should be the only one returned
  const q3 = doGetTrades({ from: '2024-01-01T00:00:00.000Z' });
  assert(q3.status === 200, 'returns 200');
  const d3 = q3.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d3.data.length, 1, '1 trade returned with default openedAt filter (no status)');
  assertEqual(d3.data[0].symbol, 'GOOGL', 'default filter matches GOOGL (openedAt=March)');
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
