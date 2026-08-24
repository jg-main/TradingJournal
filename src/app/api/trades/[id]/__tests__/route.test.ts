/**
 * trade by id route test
 *
 * Tests GET (by id), PUT (update), and DELETE (planned-only soft-delete /
 * scratch) handlers.
 * GET now uses computeTradeMetrics() for realizedPnl, unrealizedPnl,
 * returnPct, riskPct, and nested metrics.
 *
 * Run: npx tsx src/app/api/trades/\[id\]/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/[id]/__tests__/route.test.ts`)
 */
/// <reference types="vitest/globals" />

import { testDbPath } from '../../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, desc } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput } from '@/lib/trade-metrics';

// R019/T02: planning-geometry fields frozen once a trade leaves 'planned'
// status (mirrors the PUT route guard in src/app/api/trades/[id]/route.ts).
const PLANNING_FIELDS = [
  'direction', 'symbol', 'plannedEntry', 'plannedStop',
  'plannedTarget1', 'plannedTarget2', 'plannedQuantity',
  'setupId', 'setup', 'sectorId', 'marketConditionId',
];

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

function assertApprox(actual: number | null, expected: number, tolerance: number, msg: string) {
  if (actual === null) { failed++; console.error(`  ❌ ${msg} — got null, expected ~${expected} (FAILED)`); return; }
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) { passed++; console.log(`  ✅ ${msg} (${actual.toFixed(4)} ≈ ${expected})`); }
  else { failed++; console.error(`  ❌ ${msg} — got ${actual}, expected ~${expected} (diff ${diff.toFixed(4)}) (FAILED)`); }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('trades-by-id');
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
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_performance;
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
  DROP TABLE IF EXISTS settings;
  CREATE TABLE settings (
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
  CREATE TABLE IF NOT EXISTS watchlist_items (
    id TEXT PRIMARY KEY NOT NULL,
    date_added TEXT,
    symbol TEXT NOT NULL,
    sector_id TEXT,
    setup_id TEXT,
    direction TEXT NOT NULL,
    thesis TEXT,
    market_context TEXT,
    key_level REAL,
    trigger_price REAL,
    planned_stop REAL,
    target_price REAL,
    status TEXT NOT NULL,
    notes TEXT,
    promoted_trade_id TEXT,
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
    risk_override_reason TEXT,
    opened_at TEXT,
    closed_at TEXT,
    reviewed_at TEXT,
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
    idempotency_key TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL UNIQUE,
    account_equity_at_open REAL,
    account_equity_source TEXT,
    account_equity_as_of TEXT,
    initial_entry_price REAL,
    initial_stop_price REAL,
    initial_quantity REAL,
    risk_per_share REAL,
    initial_risk_amount REAL,
    account_risk_pct REAL,
    planned_reward_risk REAL,
    created_at TEXT DEFAULT (current_timestamp)
  );
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_performance;
  DROP TABLE IF EXISTS watchlist_items;
  CREATE TABLE IF NOT EXISTS account_rollforward (
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
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS account_performance (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL UNIQUE,
    computed_as_of TEXT NOT NULL,
    net_cash TEXT NOT NULL,
    nav TEXT NOT NULL,
    marked_positions TEXT NOT NULL,
    realized_pnl TEXT NOT NULL,
    unrealized_pnl TEXT NOT NULL,
    total_pnl TEXT NOT NULL,
    realized_fees TEXT NOT NULL,
    gross_exposure TEXT NOT NULL,
    net_exposure TEXT NOT NULL,
    modified_dietz_return TEXT,
    twr TEXT,
    high_water_mark TEXT,
    drawdown TEXT,
    drawdown_pct TEXT,
    warnings TEXT NOT NULL DEFAULT '[]',
    positions_json TEXT NOT NULL DEFAULT '[]',
    rebuild_count INTEGER NOT NULL DEFAULT 0,
    last_rebuilt_at TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS watchlist_items (
    id TEXT PRIMARY KEY NOT NULL,
    date_added TEXT,
    symbol TEXT NOT NULL,
    sector_id TEXT,
    name TEXT,
    sector TEXT,
    industry TEXT,
    setup_id TEXT,
    direction TEXT NOT NULL,
    thesis TEXT,
    market_context TEXT,
    key_level REAL,
    trigger_price REAL,
    planned_stop REAL,
    target_price REAL,
    status TEXT NOT NULL DEFAULT 'watching',
    notes TEXT,
    promoted_trade_id TEXT,
    alert_config TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_stop_adjustments (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    adjusted_at TEXT,
    previous_stop REAL,
    new_stop REAL,
    reason TEXT,
    rule_based INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetTrade(id: string): { status: number; data: unknown } {
  try {
    const row = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, id))
      .get();

    if (!row) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    // Fetch executions
    const executions = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, id))
      .all();

    // Fetch account for equity cascade and name/currency resolution
    const accountRow = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, row.accountId))
      .get() as Record<string, unknown> | undefined;

    // Settings fallback
    const settingsRow = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, 'default'))
      .get() as Record<string, unknown> | undefined;

    // Primary equity source: account_performance.nav (TEXT → parseFloat)
    const perfRow = db
      .select({ nav: schema.accountPerformance.nav })
      .from(schema.accountPerformance)
      .where(eq(schema.accountPerformance.accountId, row.accountId))
      .get() as { nav: string | null } | undefined;
    const navValue = perfRow?.nav ? parseFloat(perfRow.nav) : null;

    // Secondary equity source: latest account_rollforward.endingEquity
    const rollforwardRow = db
      .select()
      .from(schema.accountRollforward)
      .where(eq(schema.accountRollforward.accountId, row.accountId))
      .orderBy(desc(schema.accountRollforward.date))
      .limit(1)
      .get() as Record<string, unknown> | undefined;

    const currentAccountEquity =
      navValue ??
      (rollforwardRow?.endingEquity as number | undefined) ??
      (accountRow?.startingBalance as number | undefined) ??
      (settingsRow?.startingAccountValue as number | undefined) ??
      null;

    // Compute trade metrics
    const metricsInput: TradeMetricsInput = {
      executions: executions.map((e: Record<string, unknown>) => ({
        id: e.id as string,
        action: e.action as string,
        quantity: e.quantity as number,
        price: e.price as number,
        fees: (e.fees as number) ?? null,
        executedAt: (e.executedAt as string) ?? '',
      })),
      direction: row.direction as 'long' | 'short',
      riskSnapshot: (() => {
        const rs = db
          .select()
          .from(schema.tradeRiskSnapshots)
          .where(eq(schema.tradeRiskSnapshots.tradeId, id))
          .get() as Record<string, unknown> | undefined;
        return rs
          ? {
              initialRiskAmount: rs.initialRiskAmount as number,
              accountEquityAtOpen: rs.accountEquityAtOpen as number | null,
              initialStopPrice: rs.initialStopPrice as number | null,
              initialEntryPrice: rs.initialEntryPrice as number | null,
            }
          : null;
      })(),
      stopAdjustments: (() => {
        const adjRows = db
          .select()
          .from(schema.tradeStopAdjustments)
          .where(eq(schema.tradeStopAdjustments.tradeId, id))
          .orderBy(desc(schema.tradeStopAdjustments.adjustedAt))
          .all() as Array<Record<string, unknown>>;
        return adjRows
          .filter((s) => s.newStop != null)
          .map((s) => ({
            stopPrice: s.newStop as number,
            adjustedAt: (s.adjustedAt as string) ?? '',
          }));
      })(),
      currentMark:
        row.currentPrice != null
          ? { price: row.currentPrice, markedAt: row.currentPriceFetchedAt ?? new Date().toISOString() }
          : null,
      currentAccountEquity,
    };

    const metrics = computeTradeMetrics(metricsInput);

    const accountName = accountRow?.name ?? null;
    const accountCurrency = accountRow?.currency ?? null;

    // Fetch sector name from lookup_values
    let sectorName: string | null = null;
    if (row.sectorId) {
      const sectorRow = db
        .select({ value: schema.lookupValues.value })
        .from(schema.lookupValues)
        .where(eq(schema.lookupValues.id, row.sectorId))
        .get() as { value: string } | undefined;
      sectorName = sectorRow?.value ?? null;
    }

    // Shape matches route: nested metrics — consumers read metrics.realizedPnl, etc.
    return {
      status: 200,
      data: {
        ...row,
        accountName,
        accountCurrency,
        sectorName,
        metrics,
      },
    };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch trade', details: String(error) } };
  }
}

function doPutTrade(id: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    const existing = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, id))
      .get();

    if (!existing) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    // R019/T02: all planning fields are immutable once a trade leaves
    // 'planned' status (generalized from the original plannedStop-only
    // freeze). Null values are still update attempts and are rejected.
    if (existing.status !== 'planned') {
      const frozenPresent = PLANNING_FIELDS.filter((f) => body[f] !== undefined);
      if (frozenPresent.length > 0) {
        return {
          status: 400,
          data: {
            error: 'Planning fields can only be changed while the trade is planned.',
            details: { fields: frozenPresent },
          },
        };
      }
    }

    // Map 'setup' back to 'setupId' for the DB column
    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.setup !== undefined) {
      if (body.setup === null) {
        updateData.setupId = null;
      } else {
        const lowerValue = (body.setup as string).toLowerCase();
        const lookup = db
          .select()
          .from(schema.lookupValues)
          .where(and(eq(schema.lookupValues.type, 'setup'), eq(schema.lookupValues.value, lowerValue)))
          .get() as Record<string, unknown> | undefined;
        if (!lookup) {
          return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { setup: ['Unknown setup value'] } } } };
        }
        updateData.setupId = lookup.id;
      }
    }
    if (body.sectorId !== undefined) updateData.sectorId = body.sectorId;
    if (body.marketConditionId !== undefined) updateData.marketConditionId = body.marketConditionId;
    if (body.thesis !== undefined) updateData.thesis = body.thesis;
    if (body.plannedEntry !== undefined) updateData.plannedEntry = body.plannedEntry;
    if (body.plannedStop !== undefined) updateData.plannedStop = body.plannedStop;
    if (body.symbol !== undefined) updateData.symbol = body.symbol;
    if (body.direction !== undefined) updateData.direction = body.direction;
    if (body.plannedTarget1 !== undefined) updateData.plannedTarget1 = body.plannedTarget1;
    if (body.plannedTarget2 !== undefined) updateData.plannedTarget2 = body.plannedTarget2;
    if (body.plannedQuantity !== undefined) updateData.plannedQuantity = body.plannedQuantity;
    if (body.invalidationCondition !== undefined) updateData.invalidationCondition = body.invalidationCondition;
    if (body.preTradePlan !== undefined) updateData.preTradePlan = body.preTradePlan;

    db.update(schema.trades)
      .set(updateData)
      .where(eq(schema.trades.id, id))
      .run();

    const row = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, id))
      .get();

    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update trade', details: String(error) } };
  }
}

function doDeleteTrade(id: string): { status: number; data: unknown } {
  try {
    const existing = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, id))
      .get();

    if (!existing) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    // D057/R027: planned-only soft-delete (scratch). Non-planned trades are
    // rejected with 400; the row is preserved with status='deleted' and
    // updatedAt stamped for audit. watchlist_items.promotedTradeId is
    // intentionally NOT nullified so the promotion audit trail survives.
    if (existing.status !== 'planned') {
      const error =
        existing.status === 'deleted'
          ? 'Trade is already scratched.'
          : `Only planned trades can be scratched; this trade is ${existing.status}.`;
      return { status: 400, data: { error } };
    }

    db.update(schema.trades)
      .set({ status: 'deleted', updatedAt: new Date().toISOString() })
      .where(eq(schema.trades.id, id))
      .run();

    return { status: 200, data: { message: 'Trade scratched' } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to scratch trade', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM watchlist_items;');
  sqlite.exec('DELETE FROM trade_risk_snapshots');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM account_rollforward;');
  sqlite.exec('DELETE FROM account_performance;');
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

function seedWatchlistItem(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.watchlistItems)
    .values({
      id,
      symbol: 'AAPL',
      direction: 'long',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trade By ID API Tests ---\n');

// ── 1. GET: Returns trade by id ─────────────────────────────────────

console.log('\n1. GET returns trade by id:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', thesis: 'My thesis' });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.id, trade.id, 'id matches');
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
  assertEqual(data.direction, 'long', 'direction matches');
  assertEqual(data.thesis, 'My thesis', 'thesis matches');
  assertNotNull(data.metrics, 'metrics object is present');
  const m = data.metrics as Record<string, unknown>;
  assert(m.realizedPnl != null, 'metrics.realizedPnl is present');
  assert(m.returnMetrics != null, 'metrics.returnMetrics is present');
  assert(m.risk != null, 'metrics.risk is present');
  assertEqual((m.realizedPnl as Record<string, unknown>).netRealizedPnl as number, 0, 'metrics.realizedPnl.netRealizedPnl = 0 for planned trade');
  assert((m.unrealizedPnl as Record<string, unknown>).grossUnrealizedPnl === null, 'metrics.unrealizedPnl.grossUnrealizedPnl is null for planned trade');
  assert((m.returnMetrics as Record<string, unknown>).returnPct === null, 'metrics.returnMetrics.returnPct is null for planned trade');
  assert((m.risk as Record<string, unknown>).riskToAccount === null, 'metrics.risk.riskToAccount is null for planned trade');
}

// ── 2. GET: 404 for nonexistent id ──────────────────────────────────

console.log('\n2. GET returns 404 for nonexistent id:');
{
  cleanup();
  const result = doGetTrade('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 3. PUT: Updates fields via spread ──────────────────────────────

console.log('\n3. PUT updates fields via spread:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', thesis: 'Old thesis' });

  const result = doPutTrade(trade.id as string, { thesis: 'Updated thesis' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.thesis, 'Updated thesis', 'thesis is updated');
  assertEqual(data.symbol, 'AAPL', 'symbol preserved');
  assertEqual(data.direction, 'long', 'direction preserved');
}

// ── 4. PUT: Resolves setup to setupId ──────────────────────────────

console.log('\n4. PUT resolves setup string to setupId:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const lookup = seedLookupValue({ type: 'setup', value: 'breakout' });
  const trade = seedTrade({ accountId: 'test-account-id', setupId: null });

  const result = doPutTrade(trade.id as string, { setup: 'breakout' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.setupId, lookup.id, 'setupId matches lookup id');
}

// ── 5. PUT: Validates unknown setup value ──────────────────────────

console.log('\n5. PUT returns 400 for unknown setup value:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPutTrade(trade.id as string, { setup: 'nonexistent-setup' });

  assert(result.status === 400, 'returns 400');
  const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
  assertNotNull(data.details, 'has details');
  assertNotNull(data.details.fieldErrors, 'has fieldErrors');
  assertNotNull(data.details.fieldErrors.setup, 'has setup field error');
}

// ── 6. PUT: 404 for nonexistent id ─────────────────────────────────

console.log('\n6. PUT returns 404 for nonexistent id:');
{
  cleanup();
  const result = doPutTrade('nonexistent-id', { thesis: 'Ghost' });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 7. DELETE: Scratches a planned trade (soft-delete, row preserved) ──

console.log('\n7. DELETE scratches a planned trade (soft-delete, row preserved):');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  // Seed with a stale updatedAt so the scratch timestamp is provably stamped,
  // plus a full planned-trade payload to prove the row is preserved field-by-field.
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'planned',
    updatedAt: '2024-01-01T00:00:00.000Z',
    thesis: 'Scratch me',
    plannedEntry: 150.5,
    plannedStop: 148.0,
    plannedQuantity: 100,
  });

  const result = doDeleteTrade(trade.id as string);

  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'Trade scratched', 'message distinguishes scratch from hard-delete');

  // Dataset-level proof: a soft-delete preserves the row, so the trades table
  // still contains exactly one row after the DELETE (a hard-delete would drop it).
  assertEqual(db.select().from(schema.trades).all().length, 1, 'row count unchanged — soft-delete preserves the row');

  // Verify DB: row preserved with status='deleted' and updatedAt stamped
  const updated = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertNotNull(updated, 'trade row is preserved (not hard-deleted)');
  assertEqual(updated.status, 'deleted', 'status transitions to deleted');
  assert(updated.updatedAt != null && updated.updatedAt !== '2024-01-01T00:00:00.000Z', 'updatedAt is stamped on scratch (auditable scratch time)');
  // Only status and updatedAt may change on scratch — every other field survives
  assertEqual(updated.symbol, 'AAPL', 'symbol preserved after scratch');
  assertEqual(updated.direction, 'long', 'direction preserved after scratch');
  assertEqual(updated.thesis, 'Scratch me', 'thesis preserved after scratch');
  assertEqual(updated.plannedEntry, 150.5, 'plannedEntry preserved after scratch');
  assertEqual(updated.plannedStop, 148.0, 'plannedStop preserved after scratch');
  assertEqual(updated.plannedQuantity, 100, 'plannedQuantity preserved after scratch');
}

// ── 8. DELETE: 404 for nonexistent id ──────────────────────────────

console.log('\n8. DELETE returns 404 for nonexistent id:');
{
  cleanup();
  const result = doDeleteTrade('nonexistent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// 9. DELETE: Rejects non-planned trade with 400 and preserves promotedTradeId

console.log('\n9. DELETE rejects open trade with 400 and preserves promotedTradeId:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
  const wlItem = seedWatchlistItem({
    symbol: 'AAPL',
    direction: 'long',
    status: 'triggered',
    promotedTradeId: trade.id as string,
  });

  const result = doDeleteTrade(trade.id as string);
  assert(result.status === 400, 'returns 400 for non-planned trade');
  assert((result.data as { error: string }).error.includes('Only planned trades'), 'descriptive error names the planned-only rule');

  // Watchlist promotedTradeId preserved — the audit link survives (row never deleted)
  const wl = db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.id, wlItem.id as string)).get() as Record<string, unknown>;
  assertEqual(wl.promotedTradeId, trade.id, 'promotedTradeId preserved (not nullified)');

  // Trade row untouched
  const row = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(row.status, 'open', 'trade row unchanged after rejected scratch');
}

// 9b. DELETE: Rejects closed trade with 400

console.log('\n9b. DELETE rejects closed trade with 400:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'closed' });

  const result = doDeleteTrade(trade.id as string);
  assert(result.status === 400, 'returns 400 for closed trade');
  const row = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(row.status, 'closed', 'closed trade row unchanged');
}

// 9c. DELETE: Rejects already-deleted trade with 400

console.log('\n9c. DELETE rejects already-deleted trade with 400:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'deleted' });

  const result = doDeleteTrade(trade.id as string);
  assert(result.status === 400, 'returns 400 for already-deleted trade');
  assertEqual((result.data as { error: string }).error, 'Trade is already scratched.', 'descriptive error for already-scratched trade');
}

// 9d. DELETE: Successful scratch preserves watchlist promotedTradeId

console.log('\n9d. DELETE scratch preserves watchlist promotedTradeId audit link:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
  const wlItem = seedWatchlistItem({
    symbol: 'AAPL',
    direction: 'long',
    status: 'triggered',
    promotedTradeId: trade.id as string,
  });

  const result = doDeleteTrade(trade.id as string);
  assert(result.status === 200, 'returns 200 for planned trade');

  // Row preserved and watchlist link intact — the promotion audit trail survives
  const wl = db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.id, wlItem.id as string)).get() as Record<string, unknown>;
  assertEqual(wl.promotedTradeId, trade.id, 'promotedTradeId still points at scratched trade');
  const row = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(row.status, 'deleted', 'trade row preserved as deleted');
}

// 9e. DELETE: Second scratch attempt is a 400 no-op (idempotency boundary)

console.log('\n9e. DELETE second scratch attempt returns 400 and is a no-op:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', updatedAt: '2024-01-01T00:00:00.000Z' });

  // First scratch: transitions planned → deleted and stamps updatedAt
  const first = doDeleteTrade(trade.id as string);
  assert(first.status === 200, 'first scratch returns 200');
  const rowAfterFirst = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  const firstScratchAt = rowAfterFirst.updatedAt;
  assertEqual(rowAfterFirst.status, 'deleted', 'first scratch transitions status to deleted');
  assert(firstScratchAt != null && firstScratchAt !== '2024-01-01T00:00:00.000Z', 'first scratch stamps updatedAt');

  // Second scratch on the same trade: rejected — a scratched trade is idempotently
  // impossible to scratch again (this exercises the real transition path, unlike 9c
  // which seeds a pre-deleted row).
  const second = doDeleteTrade(trade.id as string);
  assert(second.status === 400, 'second scratch returns 400');
  assertEqual((second.data as { error: string }).error, 'Trade is already scratched.', 'descriptive error for repeated scratch');

  // Rejection is a no-op: status and updatedAt are untouched by the failed attempt
  const rowAfterSecond = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(rowAfterSecond.status, 'deleted', 'status unchanged after rejected second scratch');
  assertEqual(rowAfterSecond.updatedAt, firstScratchAt, 'updatedAt unchanged — rejected scratch does not re-stamp');
  assertEqual(db.select().from(schema.trades).all().length, 1, 'row count still 1 — no row created or removed');
}

// 9f. GET detail: Scratched trade is still fetchable by id (deliberate)

console.log('\n9f. GET detail returns the scratched trade with status deleted:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', symbol: 'AAPL' });

  const scratch = doDeleteTrade(trade.id as string);
  assert(scratch.status === 200, 'scratch succeeds');

  // The detail route is a targeted lookup, not an unfiltered listing: it still
  // returns the scratched row so its audit trail remains reachable. S03 may decide
  // to change this — this test pins the current deliberate behavior so any change
  // is an explicit contract decision, not a silent regression.
  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'detail GET returns 200 for scratched trade');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.id, trade.id, 'scratched trade id returned');
  assertEqual(data.status, 'deleted', 'scratched trade status is deleted');
}

// ── 10. GET: Returns plannedQuantity matching what was posted ───────

console.log('\n10. GET returns plannedQuantity matching what was posted:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', plannedQuantity: 100 });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.plannedQuantity, 100, 'plannedQuantity = 100 returned by GET');
}

// ── 11. PUT: Can clear plannedQuantity by sending null ───────────────

console.log('\n11. PUT clears plannedQuantity when sent null:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', plannedQuantity: 200 });

  const result = doPutTrade(trade.id as string, { plannedQuantity: null });
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.plannedQuantity, null, 'plannedQuantity is cleared to null');
}

// ── 12. GET: Returns currentPrice and currentPriceFetchedAt ──────────

console.log('\n12. GET returns currentPrice and currentPriceFetchedAt fields:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const now = new Date().toISOString();
  const trade = seedTrade({
    accountId: 'test-account-id',
    currentPrice: 155.50,
    currentPriceFetchedAt: now,
  });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currentPrice, 155.50, 'currentPrice matches seed');
  assertEqual(data.currentPriceFetchedAt, now, 'currentPriceFetchedAt matches seed');
}

// ── 13. GET: Returns null currentPrice fields when not set ──────────

console.log('\n13. GET returns null when no current_price set:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currentPrice, null, 'currentPrice is null');
  assertEqual(data.currentPriceFetchedAt, null, 'currentPriceFetchedAt is null');
  const m13 = data.metrics as Record<string, unknown>;
  assert((m13.unrealizedPnl as Record<string, unknown>).grossUnrealizedPnl === null, 'metrics.unrealizedPnl.grossUnrealizedPnl is null when no current_price');
}

// ── 14. GET: Returns unrealizedPnl for open trade with executions ──

console.log('\n14. GET computes unrealizedPnl for open trade with executions:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    currentPrice: 160.00,
    currentPriceFetchedAt: new Date().toISOString(),
  });
  const tradeId = trade.id as string;

  db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action: 'buy',
    quantity: 100,
    price: 150.00,
    fees: 10,
    executedAt: new Date().toISOString(),
  }).run();

  const result = doGetTrade(tradeId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currentPrice, 160.00, 'currentPrice is 160');
  assertNotNull(data.metrics, 'metrics object is present');
  const m14 = data.metrics as Record<string, unknown>;
  assertNotNull(m14.unrealizedPnl, 'metrics.unrealizedPnl is present');
  assertNotNull(m14.size, 'metrics.size is present');
  // metrics.unrealizedPnl.grossUnrealizedPnl = (160 - 150) * 100 = 1000
  assertApprox((m14.unrealizedPnl as Record<string, unknown>).grossUnrealizedPnl as number, 1000, 0.01, 'metrics.unrealizedPnl.grossUnrealizedPnl = (160-150)*100 = 1000');
  // realizedPnl.netRealizedPnl is 0 for open trade with no exits
  assertEqual((m14.realizedPnl as Record<string, unknown>).netRealizedPnl as number, 0, 'metrics.realizedPnl.netRealizedPnl = 0 for open trade (no exits)');
}

// ── 15. GET: Returns null unrealizedPnl for closed trade with currentPrice ──

console.log('\n15. GET returns null unrealizedPnl for closed trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'closed',
    currentPrice: 170.00,
  });

  const result = doGetTrade(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currentPrice, 170.00, 'currentPrice is still returned');
  const m15 = data.metrics as Record<string, unknown>;
  assert((m15.unrealizedPnl as Record<string, unknown>).grossUnrealizedPnl === null, 'metrics.unrealizedPnl.grossUnrealizedPnl is null for closed trade');
}

// ── 16. GET: Computes unrealizedPnl for short trade ─────────────────

console.log('\n16. GET computes unrealizedPnl for short trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'TSLA',
    direction: 'short',
    status: 'open',
    currentPrice: 250.00,
    currentPriceFetchedAt: new Date().toISOString(),
  });
  const tradeId = trade.id as string;

  db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action: 'sell_short',
    quantity: 50,
    price: 280.00,
    fees: 5,
    executedAt: new Date().toISOString(),
  }).run();

  const result = doGetTrade(tradeId);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.currentPrice, 250.00, 'currentPrice is 250');
  const m16 = data.metrics as Record<string, unknown>;
  assertNotNull(m16.unrealizedPnl, 'metrics.unrealizedPnl is not null for short trade');
  // metrics.unrealizedPnl.grossUnrealizedPnl = (280 - 250) * 50 = 1500
  assertApprox((m16.unrealizedPnl as Record<string, unknown>).grossUnrealizedPnl as number, 1500, 0.01, 'metrics.unrealizedPnl.grossUnrealizedPnl = (280-250)*50 = 1500');
}

// ── 17. GET: Returns metrics for trade with executions ───────────────

console.log('\n17. GET returns structured metrics object for trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    currentPrice: 160.00,
    currentPriceFetchedAt: new Date().toISOString(),
  });
  const tradeId = trade.id as string;

  db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action: 'buy',
    quantity: 100,
    price: 150.00,
    fees: 10,
    executedAt: new Date().toISOString(),
  }).run();

  const result = doGetTrade(tradeId);
  const data = result.data as Record<string, unknown>;
  const m = data.metrics as Record<string, unknown>;

  assertNotNull(m.size, 'size metrics');
  assertNotNull(m.averagePrices, 'averagePrices metrics');
  assertNotNull(m.fees, 'fee metrics');
  assertNotNull(m.realizedPnl, 'realizedPnl metrics');
  assertNotNull(m.unrealizedPnl, 'unrealizedPnl metrics');
  assertNotNull(m.risk, 'risk metrics');
  assertNotNull(m.returnMetrics, 'returnMetrics');
  assertNotNull(m.position, 'position metrics');
}

// ── 18. GET: Returns accountName, accountCurrency, and sectorName ──────

console.log('\n18. GET returns accountName, accountCurrency, and sectorName:');
{
  cleanup();
  const account = seedAccount({
    id: 'test-account-ib',
    name: 'Interactive Brokers',
    currency: 'EUR',
  });
  const sector = seedLookupValue({
    type: 'sector',
    value: 'Technology',
  });

  // Trade with sectorId set
  const tradeWithSector = seedTrade({
    accountId: 'test-account-ib',
    sectorId: sector.id,
    symbol: 'AAPL',
  });

  const r1 = doGetTrade(tradeWithSector.id as string);
  assert(r1.status === 200, 'returns 200 for trade with sector');
  const d1 = r1.data as Record<string, unknown>;
  assertEqual(d1.accountName, 'Interactive Brokers', 'accountName is resolved');
  assertEqual(d1.accountCurrency, 'EUR', 'accountCurrency is resolved');
  assertEqual(d1.sectorName, 'Technology', 'sectorName is resolved');

  // Trade with null sectorId
  const tradeNoSector = seedTrade({
    accountId: 'test-account-ib',
    sectorId: null,
    symbol: 'MSFT',
  });

  const r2 = doGetTrade(tradeNoSector.id as string);
  assert(r2.status === 200, 'returns 200 for trade with null sector');
  const d2 = r2.data as Record<string, unknown>;
  assertEqual(d2.accountName, 'Interactive Brokers', 'accountName from same account');
  assertEqual(d2.accountCurrency, 'EUR', 'accountCurrency from same account');
  assertEqual(d2.sectorName, null, 'sectorName is null when sectorId is null');

  // Trade with unknown sectorId (non-existent UUID)
  const tradeUnknownSector = seedTrade({
    accountId: 'test-account-ib',
    sectorId: '00000000-0000-0000-0000-000000000000',
    symbol: 'GOOGL',
  });

  const r3 = doGetTrade(tradeUnknownSector.id as string);
  assert(r3.status === 200, 'returns 200 for trade with unknown sector');
  const d3 = r3.data as Record<string, unknown>;
  assertEqual(d3.accountName, 'Interactive Brokers', 'accountName from same account');
  assertEqual(d3.accountCurrency, 'EUR', 'accountCurrency from same account');
  assertEqual(d3.sectorName, null, 'sectorName is null when sector UUID does not exist');
}

// ── 19. GET: account_performance.nav is primary equity source ──────────

console.log('\n19. GET uses account_performance.nav over rollforward.endingEquity:');
{
  cleanup();
  const accId = randomUUID();
  seedAccount({ id: accId, startingBalance: 50000 });

  // Seed an open trade with executions (so riskToAccount is meaningful)
  const trade = seedTrade({
    accountId: accId,
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    currentPrice: 160.00,
    currentPriceFetchedAt: new Date().toISOString(),
  });
  const tradeId = trade.id as string;

  db.insert(schema.tradeRiskSnapshots).values({
    id: randomUUID(),
    tradeId,
    initialRiskAmount: 1000,
    accountEquityAtOpen: 25000,
  }).run();

  db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action: 'buy',
    quantity: 100,
    price: 150.00,
    fees: 10,
    executedAt: new Date().toISOString(),
  }).run();

  // account_performance.nav=25000 should be used over rollforward.endingEquity=20000
  const now = new Date().toISOString();
  db.insert(schema.accountPerformance).values({
    id: randomUUID(),
    accountId: accId,
    computedAsOf: now,
    netCash: '10000',
    nav: '25000',
    markedPositions: '[]',
    realizedPnl: '0',
    unrealizedPnl: '100',
    totalPnl: '100',
    realizedFees: '0',
    grossExposure: '15000',
    netExposure: '15000',
    warnings: '[]',
    positionsJson: '[]',
    rebuildCount: 0,
    lastRebuiltAt: now,
  }).run();

  db.insert(schema.accountRollforward).values({
    id: randomUUID(),
    accountId: accId,
    date: new Date(Date.now() - 86400000).toISOString(),
    endingEquity: 20000,
    realizedGrossPnl: 0,
    fees: 0,
  }).run();

  const result = doGetTrade(tradeId);
  assert(result.status === 200, 'returns 200');
  const m = (result.data as Record<string, unknown>).metrics as Record<string, unknown>;
  // riskToAccount = initialRiskAmount / nav = 1000 / 25000 = 0.04
  assertApprox((m.risk as Record<string, unknown>).riskToAccount as number, 0.04, 0.001, 'riskToAccount uses nav=25000 (0.04) over rollforward (would be 0.05)');
}

// ── 20. GET: No account_performance row → rollforward fallback ──────────

console.log('\n20. GET falls back to rollforward.endingEquity when no account_performance:');
{
  cleanup();
  const accId = randomUUID();
  seedAccount({ id: accId, startingBalance: 50000 });

  const trade = seedTrade({
    accountId: accId,
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    currentPrice: 160.00,
    currentPriceFetchedAt: new Date().toISOString(),
  });
  const tradeId = trade.id as string;

  db.insert(schema.tradeRiskSnapshots).values({
    id: randomUUID(),
    tradeId,
    initialRiskAmount: 1000,
    accountEquityAtOpen: 20000,
  }).run();

  db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action: 'buy',
    quantity: 100,
    price: 150.00,
    fees: 10,
    executedAt: new Date().toISOString(),
  }).run();

  // No account_performance row, but rollforward exists
  db.insert(schema.accountRollforward).values({
    id: randomUUID(),
    accountId: accId,
    date: new Date(Date.now() - 86400000).toISOString(),
    endingEquity: 20000,
    realizedGrossPnl: 0,
    fees: 0,
  }).run();

  const result = doGetTrade(tradeId);
  assert(result.status === 200, 'returns 200');
  const m = (result.data as Record<string, unknown>).metrics as Record<string, unknown>;
  // riskToAccount = 1000 / 20000 = 0.05
  assertApprox((m.risk as Record<string, unknown>).riskToAccount as number, 0.05, 0.001, 'riskToAccount uses rollforward=20000 (0.05)');
}

// ── 21. GET: No performance/rollforward → startingBalance fallback ─────

console.log('\n21. GET falls back to account.startingBalance when no performance or rollforward:');
{
  cleanup();
  const accId = randomUUID();
  seedAccount({ id: accId, startingBalance: 50000 });

  const trade = seedTrade({
    accountId: accId,
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    currentPrice: 160.00,
    currentPriceFetchedAt: new Date().toISOString(),
  });
  const tradeId = trade.id as string;

  db.insert(schema.tradeRiskSnapshots).values({
    id: randomUUID(),
    tradeId,
    initialRiskAmount: 1000,
    accountEquityAtOpen: 50000,
  }).run();

  db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action: 'buy',
    quantity: 100,
    price: 150.00,
    fees: 10,
    executedAt: new Date().toISOString(),
  }).run();

  // No account_performance, no rollforward — should fall back to startingBalance
  const result = doGetTrade(tradeId);
  assert(result.status === 200, 'returns 200');
  const m = (result.data as Record<string, unknown>).metrics as Record<string, unknown>;
  // riskToAccount = 1000 / 50000 = 0.02
  assertApprox((m.risk as Record<string, unknown>).riskToAccount as number, 0.02, 0.001, 'riskToAccount uses startingBalance=50000 (0.02)');
}

// ── 22. PUT: Rejects plannedStop for open trade (400, no mutation) ───────

console.log('\n22. PUT rejects plannedStop for an open trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'open',
    plannedStop: 605.02,
  });

  const result = doPutTrade(trade.id as string, { plannedStop: 590.0 });

  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string; details: { fields: string[] } };
  assert(
    data.error === 'Planning fields can only be changed while the trade is planned.',
    'error message explains lifecycle restriction',
  );
  assertEqual(JSON.stringify(data.details.fields), JSON.stringify(['plannedStop']), 'details.fields names plannedStop');
  // DB must be untouched — plannedStop preserved, no partial write
  const row = db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, trade.id as string))
    .get() as Record<string, unknown>;
  assertEqual(row.plannedStop, 605.02, 'plannedStop unchanged in DB after rejection');
}

// ── 23. PUT: Rejects null plannedStop for open trade too ────────────────

console.log('\n23. PUT rejects null plannedStop for an open trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'open',
    plannedStop: 100.0,
  });

  const result = doPutTrade(trade.id as string, { plannedStop: null });

  assert(result.status === 400, 'returns 400 (null is still an update attempt)');
  const row = db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, trade.id as string))
    .get() as Record<string, unknown>;
  assertEqual(row.plannedStop, 100.0, 'plannedStop not cleared in DB');
}

// ── 24. PUT: Open trade still updatable on other fields ────────────────

console.log('\n24. PUT allows other fields on an open trade (no plannedStop):');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'open',
    plannedStop: 605.02,
    thesis: 'Old thesis',
  });

  const result = doPutTrade(trade.id as string, { thesis: 'Updated thesis' });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.thesis, 'Updated thesis', 'thesis is updated');
  assertEqual(data.plannedStop, 605.02, 'plannedStop preserved');
}

// ── 25. PUT: plannedStop still allowed for planned trades ────────────

console.log('\n25. PUT allows plannedStop for a planned trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const planned = seedTrade({
    accountId: 'test-account-id',
    status: 'planned',
    plannedStop: 10.0,
  });

  const r1 = doPutTrade(planned.id as string, { plannedStop: 11.5 });
  assert(r1.status === 200, 'returns 200 for planned trade');
  assertEqual((r1.data as Record<string, unknown>).plannedStop, 11.5, 'planned trade plannedStop updated');
}

// ── 26. PUT: Rejects plannedStop for a closed trade (400, no mutation) ─

console.log('\n26. PUT rejects plannedStop for a closed trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const closed = seedTrade({
    accountId: 'test-account-id',
    status: 'closed',
    plannedStop: 20.0,
  });

  const result = doPutTrade(closed.id as string, { plannedStop: 21.5 });

  assert(result.status === 400, 'returns 400 for closed trade');
  const data = result.data as { error: string };
  assertEqual(
    data.error,
    'Planning fields can only be changed while the trade is planned.',
    'error message matches generalized lifecycle message',
  );
  const row = db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, closed.id as string))
    .get() as Record<string, unknown>;
  assertEqual(row.plannedStop, 20.0, 'plannedStop unchanged in DB for closed trade');
}

// ── 27. PUT: Rejects null plannedStop for closed trade too ────────────

console.log('\n27. PUT rejects null plannedStop for a closed trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const closed = seedTrade({
    accountId: 'test-account-id',
    status: 'closed',
    plannedStop: 20.0,
  });

  const result = doPutTrade(closed.id as string, { plannedStop: null });

  assert(result.status === 400, 'returns 400 (null is still an update attempt)');
  const row = db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, closed.id as string))
    .get() as Record<string, unknown>;
  assertEqual(row.plannedStop, 20.0, 'plannedStop not cleared in DB for closed trade');
}

// ── 28. PUT: Rejects plannedStop for a deleted trade ──────────────────

console.log('\n28. PUT rejects plannedStop for a deleted trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const deleted = seedTrade({
    accountId: 'test-account-id',
    status: 'deleted',
    plannedStop: 30.0,
  });

  const result = doPutTrade(deleted.id as string, { plannedStop: 31.0 });

  assert(result.status === 400, 'returns 400 for deleted trade');
  const data = result.data as { error: string };
  assertEqual(
    data.error,
    'Planning fields can only be changed while the trade is planned.',
    'error message matches generalized lifecycle message',
  );
  const row = db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, deleted.id as string))
    .get() as Record<string, unknown>;
  assertEqual(row.plannedStop, 30.0, 'plannedStop unchanged in DB for deleted trade');
}

// ── 29. PUT: Rejects direction change on open trade ─────────────────

console.log('\n29. PUT rejects direction change for an open trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'open',
    direction: 'long',
  });

  const result = doPutTrade(trade.id as string, { direction: 'short' });

  assert(result.status === 400, 'returns 400 for direction edit on open trade');
  const data = result.data as { error: string; details: { fields: string[] } };
  assertEqual(data.error, 'Planning fields can only be changed while the trade is planned.', 'generalized lifecycle error');
  assertEqual(JSON.stringify(data.details.fields), JSON.stringify(['direction']), 'details.fields names direction');
  const row = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(row.direction, 'long', 'direction unchanged in DB — P&L sign cannot be flipped retroactively');
}

// ── 30. PUT: Rejects symbol change on open trade ────────────────────

console.log('\n30. PUT rejects symbol change for an open trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open', symbol: 'AAPL' });

  const result = doPutTrade(trade.id as string, { symbol: 'MSFT' });
  assert(result.status === 400, 'returns 400 for symbol edit on open trade');
  const data = result.data as { error: string; details: { fields: string[] } };
  assertEqual(JSON.stringify(data.details.fields), JSON.stringify(['symbol']), 'details.fields names symbol');
  const row = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(row.symbol, 'AAPL', 'symbol unchanged in DB');
}

// ── 31. PUT: Rejects setup change on open trade (setup and setupId) ──

console.log('\n31. PUT rejects setup change for an open trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const lookup = seedLookupValue({ type: 'setup', value: 'breakout' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open', setupId: null });

  const byName = doPutTrade(trade.id as string, { setup: 'breakout' });
  assert(byName.status === 400, 'returns 400 for setup (name) edit on open trade');
  assertEqual(JSON.stringify((byName.data as { details: { fields: string[] } }).details.fields), JSON.stringify(['setup']), 'details.fields names setup');

  const byId = doPutTrade(trade.id as string, { setupId: lookup.id as string });
  assert(byId.status === 400, 'returns 400 for setupId edit on open trade');
  assertEqual(JSON.stringify((byId.data as { details: { fields: string[] } }).details.fields), JSON.stringify(['setupId']), 'details.fields names setupId');

  const row = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(row.setupId, null, 'setupId unchanged in DB');
}

// ── 32. PUT: Rejects entry/target/quantity changes on open trade ─────

console.log('\n32. PUT rejects entry, target, and quantity changes for an open trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'open',
    plannedEntry: 150,
    plannedTarget1: 160,
    plannedTarget2: 170,
    plannedQuantity: 100,
  });

  const entry = doPutTrade(trade.id as string, { plannedEntry: 155 });
  assert(entry.status === 400, 'returns 400 for plannedEntry edit on open trade');

  const target1 = doPutTrade(trade.id as string, { plannedTarget1: 165 });
  assert(target1.status === 400, 'returns 400 for plannedTarget1 edit on open trade');

  const target2 = doPutTrade(trade.id as string, { plannedTarget2: 175 });
  assert(target2.status === 400, 'returns 400 for plannedTarget2 edit on open trade');

  const qty = doPutTrade(trade.id as string, { plannedQuantity: 200 });
  assert(qty.status === 400, 'returns 400 for plannedQuantity edit on open trade');

  const row = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(row.plannedEntry, 150, 'plannedEntry unchanged in DB');
  assertEqual(row.plannedQuantity, 100, 'plannedQuantity unchanged in DB');
}

// ── 33. PUT: Rejects sectorId/marketConditionId on open trade ────────

console.log('\n33. PUT rejects sectorId and marketConditionId for an open trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

  const sector = doPutTrade(trade.id as string, { sectorId: '00000000-0000-0000-0000-000000000001' });
  assert(sector.status === 400, 'returns 400 for sectorId edit on open trade');
  assertEqual(JSON.stringify((sector.data as { details: { fields: string[] } }).details.fields), JSON.stringify(['sectorId']), 'details.fields names sectorId');

  const mkt = doPutTrade(trade.id as string, { marketConditionId: '00000000-0000-0000-0000-000000000002' });
  assert(mkt.status === 400, 'returns 400 for marketConditionId edit on open trade');
  assertEqual(JSON.stringify((mkt.data as { details: { fields: string[] } }).details.fields), JSON.stringify(['marketConditionId']), 'details.fields names marketConditionId');
}

// ── 34. PUT: Narrative fields stay editable on open trade ────────────

console.log('\n34. PUT allows narrative fields (thesis, invalidation, preTradePlan) on open trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'open',
    thesis: 'Old thesis',
    invalidationCondition: 'Old invalidation',
    preTradePlan: 'Old plan',
  });

  const result = doPutTrade(trade.id as string, {
    thesis: 'Updated thesis',
    invalidationCondition: 'Updated invalidation',
    preTradePlan: 'Updated plan',
  });

  assert(result.status === 200, 'returns 200 for narrative field edits on open trade');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.thesis, 'Updated thesis', 'thesis updated on open trade');
  assertEqual(data.invalidationCondition, 'Updated invalidation', 'invalidationCondition updated on open trade');
  assertEqual(data.preTradePlan, 'Updated plan', 'preTradePlan updated on open trade');
  assertEqual(data.symbol, 'AAPL', 'planning geometry untouched');
}

// ── 35. PUT: All planning fields still editable while planned ────────

console.log('\n35. PUT allows all planning fields for a planned trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const lookup = seedLookupValue({ type: 'setup', value: 'breakout' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'planned',
    symbol: 'AAPL',
    direction: 'long',
  });

  const result = doPutTrade(trade.id as string, {
    symbol: 'MSFT',
    direction: 'short',
    setup: 'breakout',
    plannedEntry: 200,
    plannedStop: 205,
    plannedTarget1: 210,
    plannedTarget2: 220,
    plannedQuantity: 50,
    sectorId: '00000000-0000-0000-0000-000000000003',
    marketConditionId: '00000000-0000-0000-0000-000000000004',
  });

  assert(result.status === 200, 'returns 200 for full planning-field update while planned');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.symbol, 'MSFT', 'symbol updated');
  assertEqual(data.direction, 'short', 'direction updated');
  assertEqual(data.setupId, lookup.id, 'setupId updated');
  assertEqual(data.plannedEntry, 200, 'plannedEntry updated');
  assertEqual(data.plannedStop, 205, 'plannedStop updated');
  assertEqual(data.plannedTarget1, 210, 'plannedTarget1 updated');
  assertEqual(data.plannedTarget2, 220, 'plannedTarget2 updated');
  assertEqual(data.plannedQuantity, 50, 'plannedQuantity updated');
}

// ── 36. PUT: Null planning field on non-planned trade is still rejected ──

console.log('\n36. PUT rejects null planning fields for an open trade (still an update attempt):');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({
    accountId: 'test-account-id',
    status: 'open',
    plannedEntry: 150,
  });

  const result = doPutTrade(trade.id as string, { plannedEntry: null });
  assert(result.status === 400, 'returns 400 (null is still an update attempt)');
  const row = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(row.plannedEntry, 150, 'plannedEntry not cleared in DB');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);

// Dual-mode finish: this file is both a standalone tsx harness (Run:
// `npx tsx <file>`) and a vitest suite (registered in the include list in
// vitest.config.ts so the S02/T02 verification surface `npx vitest run <file>`
// executes it). The harness assertions run during module import; vitest
// requires at least one test suite per file, so the pass/fail verdict is
// surfaced through a single test below. `test` is a global only inside the
// vitest runner (globals: true in vitest.config.ts) — the `typeof test` guard
// keeps the tsx path import-free; under tsx the summary exits directly.
if (typeof test !== 'undefined') {
  test('standalone route harness (assertions run at import)', () => {
    if (failed > 0) {
      throw new Error(`         ${failed}/${total} FAILED`);
    }
    console.log('         All tests passed!');
  });
} else {
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED`);
    process.exit(1);
  }
  console.log('         All tests passed!');
}
