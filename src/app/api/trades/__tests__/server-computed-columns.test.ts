/**
 * server-computed-columns test
 *
 * Tests the GET /api/trades route enhancement: realizedPnl, unrealizedPnl,
 * returnPct, riskPct, and nested metrics on each trade row, computed via
 * computeTradeMetrics().
 *
 * Run: npx tsx src/app/api/trades/__tests__/server-computed-columns.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, inArray } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput } from '@/lib/trade-metrics';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg} (FAILED)`); }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`); }
}

function assertApprox(actual: number | null | undefined, expected: number, tolerance: number, msg: string) {
  if (actual === null || actual === undefined) { failed++; console.error(`  ❌ ${msg} — got ${actual}, expected ~${expected} (FAILED)`); return; }
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) { passed++; console.log(`  ✅ ${msg} (${actual.toFixed(4)} ≈ ${expected})`); }
  else { failed++; console.error(`  ❌ ${msg} — got ${actual}, expected ~${expected} (diff ${diff.toFixed(4)}) (FAILED)`); }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg} — value is null/undefined (FAILED)`); }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('server-computed');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trades;
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
  CREATE TABLE trades (
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
  CREATE TABLE trade_executions (
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
  CREATE TABLE trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE CASCADE,
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
`);

// ── Simulated route logic (enhanced via computeTradeMetrics) ──────────

function doEnhancedGetTrades(): { status: number; data: unknown } {
  try {
    const rows = db
      .select({
        id: schema.trades.id,
        tradeCode: schema.trades.tradeCode,
        accountId: schema.trades.accountId,
        symbol: schema.trades.symbol,
        direction: schema.trades.direction,
        status: schema.trades.status,
        plannedEntry: schema.trades.plannedEntry,
        plannedStop: schema.trades.plannedStop,
        plannedTarget1: schema.trades.plannedTarget1,
        plannedQuantity: schema.trades.plannedQuantity,
        openedAt: schema.trades.openedAt,
        closedAt: schema.trades.closedAt,
        currentPrice: schema.trades.currentPrice,
        currentPriceFetchedAt: schema.trades.currentPriceFetchedAt,
      })
      .from(schema.trades)
      .all();

    // Batch-fetch executions
    const tradeIds = rows.map((r) => r.id);
    const execRows =
      tradeIds.length > 0
        ? db
            .select()
            .from(schema.tradeExecutions)
            .where(inArray(schema.tradeExecutions.tradeId, tradeIds))
            .all()
        : [];

    const execMap = new Map<string, (typeof schema.tradeExecutions.$inferSelect)[]>();
    for (const ex of execRows) {
      const list = execMap.get(ex.tradeId) ?? [];
      list.push(ex);
      execMap.set(ex.tradeId, list);
    }

    // Batch-fetch risk snapshots
    const riskRows =
      tradeIds.length > 0
        ? db
            .select()
            .from(schema.tradeRiskSnapshots)
            .where(inArray(schema.tradeRiskSnapshots.tradeId, tradeIds))
            .all()
        : [];
    const riskMap = new Map<string, typeof schema.tradeRiskSnapshots.$inferSelect>();
    for (const risk of riskRows) {
      riskMap.set(risk.tradeId, risk);
    }

    const enhancedRows = rows.map((row) => {
      const exs = execMap.get(row.id) ?? [];
      const riskSnapshot = riskMap.get(row.id) ?? null;

      const metricsInput: TradeMetricsInput = {
        executions: exs.map((e) => ({
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
        unrealizedPnl: metrics.unrealizedPnl.netUnrealizedPnl,
        returnPct: metrics.returnMetrics.returnPct,
        riskPct: metrics.risk.riskToAccount,
        metrics,
      };
    });

    return { status: 200, data: enhancedRows };
  } catch (error) {
    return { status: 500, data: { error: 'Failed', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_risk_snapshots');
  sqlite.exec('DELETE FROM trade_executions');
  sqlite.exec('DELETE FROM trades');
  sqlite.exec('DELETE FROM accounts');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({ id, name: 'Test Account', broker: null, currency: 'USD', isActive: true, createdAt: now, updatedAt: now, ...overrides })
    .run();
  return id;
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
  return id;
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

function seedRiskSnapshot(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  db.insert(schema.tradeRiskSnapshots)
    .values({
      id,
      tradeId: '__missing__',
      ...overrides,
    })
    .run();
  return id;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Server-Computed Columns Tests ---\n');

// ── 1. Closed trade with long direction ────────────────────────────

console.log('\n1. Closed long trade returns computed realizedPnl:');
{
  cleanup();
  const accountId = seedAccount({ id: 'test-account-id' });
  const tradeId = seedTrade({
    accountId,
    symbol: 'AAPL',
    direction: 'long',
    status: 'closed',
    plannedQuantity: 100,
  });

  // Buy 100 shares at $100
  seedExecution({ tradeId, action: 'buy', quantity: 100, price: 100, fees: 5 });
  // Sell 100 shares at $110
  seedExecution({ tradeId, action: 'sell', quantity: 100, price: 110, fees: 3 });

  const result = doEnhancedGetTrades();
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 1, '1 trade returned');

  const trade = data[0] as Record<string, unknown>;
  // Realized P&L = (110 - 100) * 100 - 5 - 3 = 1000 - 8 = 992
  assertApprox(trade.realizedPnl as number, 992, 0.01, 'realizedPnl = 992 (P&L 1000 - fees 8)');
  // Return% = 992 / (100 * 100) * 100 = 9.92%
  assertApprox(trade.returnPct as number, 9.92, 0.01, 'returnPct = 9.92%');
  assert(trade.unrealizedPnl === null, 'unrealizedPnl is null for closed trade');
  assert(trade.riskPct === null, 'riskPct is null without snapshot');
  // Verify nested metrics
  assertNotNull(trade.metrics, 'metrics object is present');
  const m = trade.metrics as Record<string, unknown>;
  assertNotNull(m.realizedPnl, 'metrics.realizedPnl is present');
  assertNotNull(m.size, 'metrics.size is present');
  assertNotNull(m.fees, 'metrics.fees is present');
}

// ── 2. Closed short trade ──────────────────────────────────────────

console.log('\n2. Closed short trade returns realizedPnl:');
{
  cleanup();
  const accountId = seedAccount({ id: 'test-account-id' });
  const tradeId = seedTrade({
    accountId,
    symbol: 'TSLA',
    direction: 'short',
    status: 'closed',
    plannedQuantity: 50,
  });

  // Sell short 50 shares at $200
  seedExecution({ tradeId, action: 'sell_short', quantity: 50, price: 200, fees: 4 });
  // Buy to cover 50 shares at $180
  seedExecution({ tradeId, action: 'buy_to_cover', quantity: 50, price: 180, fees: 2 });

  const result = doEnhancedGetTrades();
  const data = result.data as Record<string, unknown>[];
  const trade = data[0] as Record<string, unknown>;

  // Realized P&L = (200 - 180) * 50 - 4 - 2 = 1000 - 6 = 994
  assertApprox(trade.realizedPnl as number, 994, 0.01, 'realizedPnl = 994 (P&L 1000 - fees 6)');
  // Return% = 994 / (200 * 50) * 100 = 9.94%
  assertApprox(trade.returnPct as number, 9.94, 0.01, 'returnPct = 9.94%');
  assertNotNull(trade.realizedPnl, 'realizedPnl is not null');
}

// ── 3. Open trade with currentPrice ─────────────────────────────────

console.log('\n3. Open trade with currentPrice returns unrealizedPnl:');
{
  cleanup();
  const accountId = seedAccount({ id: 'test-account-id' });
  const tradeId = seedTrade({
    accountId,
    symbol: 'MSFT',
    direction: 'long',
    status: 'open',
    plannedQuantity: 100,
    currentPrice: 420,
    currentPriceFetchedAt: new Date().toISOString(),
  });

  // Buy 100 shares at $400
  seedExecution({ tradeId, action: 'buy', quantity: 100, price: 400, fees: 5 });

  const result = doEnhancedGetTrades();
  const data = result.data as Record<string, unknown>[];
  const trade = data[0] as Record<string, unknown>;

  // Unrealized P&L = (420 - 400) * 100 = 2000 (gross, exclude_entry_fees)
  assertApprox(trade.unrealizedPnl as number, 1995, 0.01, 'unrealizedPnl = 1995 (net of $5 open fees)');
  // returnPct = totalNetPnl / totalEntryNotional * 100
  // totalNetPnl = 0 (realized) + (2000 - 5) (net unrealized) = 1995
  // returnPct = 1995 / (400 * 100) * 100 = 4.9875
  assertApprox(trade.returnPct as number, 4.9875, 0.01, 'returnPct = 4.9875% (fees deducted)');
  assertEqual(trade.realizedPnl as number, 0, 'realizedPnl is 0 for open trade (no exits)');
  assert(trade.riskPct === null, 'riskPct is null');
}

// ── 4. Open trade without currentPrice ─────────────────────────────

console.log('\n4. Open trade without currentPrice has null computed fields:');
{
  cleanup();
  const accountId = seedAccount({ id: 'test-account-id' });
  const tradeId = seedTrade({
    accountId,
    symbol: 'GOOGL',
    direction: 'long',
    status: 'open',
    plannedQuantity: 10,
    currentPrice: null,
  });

  seedExecution({ tradeId, action: 'buy', quantity: 10, price: 180, fees: 2 });

  const result = doEnhancedGetTrades();
  const data = result.data as Record<string, unknown>[];
  const trade = data[0] as Record<string, unknown>;

  assert(trade.unrealizedPnl === null, 'unrealizedPnl is null (no currentPrice)');
  assertEqual(trade.realizedPnl as number, 0, 'realizedPnl is 0 (no exits, no realized P&L)');
  assertEqual(trade.returnPct as number, 0, 'returnPct is 0 (no mark, no unrealized P&L)');
}

// ── 5. Planned trade ───────────────────────────────────────────────

console.log('\n5. Planned trade has null computed fields:');
{
  cleanup();
  const accountId = seedAccount({ id: 'test-account-id' });
  seedTrade({
    accountId,
    symbol: 'NFLX',
    direction: 'long',
    status: 'planned',
    plannedQuantity: 50,
  });

  const result = doEnhancedGetTrades();
  const data = result.data as Record<string, unknown>[];
  const trade = data[0] as Record<string, unknown>;

  assertEqual(trade.realizedPnl as number, 0, 'realizedPnl is 0 (no executions)');
  assert(trade.unrealizedPnl === null, 'unrealizedPnl is null');
  assert(trade.returnPct === null, 'returnPct is null');
  assert(trade.riskPct === null, 'riskPct is null');
}

// ── 6. riskPct via computeTradeMetrics (no initialRiskAmount) ──────

console.log('\n6. riskPct from computeTradeMetrics (null when no stop/initialRisk):');
{
  cleanup();
  const accountId = seedAccount({ id: 'test-account-id' });
  const tradeId = seedTrade({
    accountId,
    symbol: 'AMZN',
    direction: 'long',
    status: 'open',
    currentPrice: 190,
  });

  seedExecution({ tradeId, action: 'buy', quantity: 50, price: 180, fees: 3 });
  seedRiskSnapshot({ tradeId, accountRiskPct: 2.5 });

  const result = doEnhancedGetTrades();
  const data = result.data as Record<string, unknown>[];
  const trade = data[0] as Record<string, unknown>;

  // riskToAccount is null because computeTradeMetrics needs activeStop or
  // initialRiskAmount, and our risk snapshot has no initialRiskAmount
  assert(trade.riskPct === null, 'riskPct is null (no initialRiskAmount in snapshot)');
  assertNotNull(trade.unrealizedPnl, 'unrealizedPnl is not null');
  assertNotNull(trade.metrics, 'metrics object is present');
}

// ── 7. R-multiple with initialRiskAmount ──────────────────────────

console.log('\n7. R-multiple computed when initialRiskAmount is present:');
{
  cleanup();
  const accountId = seedAccount({ id: 'test-account-id' });
  const tradeId = seedTrade({
    accountId,
    symbol: 'TSLA',
    direction: 'long',
    status: 'closed',
    plannedQuantity: 100,
  });

  seedExecution({ tradeId, action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution({ tradeId, action: 'sell', quantity: 100, price: 110, fees: 3 });
  seedRiskSnapshot({ tradeId, initialRiskAmount: 500, accountRiskPct: 2.5 });

  const result = doEnhancedGetTrades();
  const data = result.data as Record<string, unknown>[];
  const trade = data[0] as Record<string, unknown>;
  const m = trade.metrics as Record<string, unknown>;

  // R = netRealizedPnl / initialRisk = 992 / 500 = 1.984
  const rm = m.returnMetrics as Record<string, unknown>;
  assertApprox(rm.rMultiple as number, 1.984, 0.01, 'r-multiple = 992/500 = 1.984');
  assertNotNull(trade.metrics, 'metrics object is present');
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
