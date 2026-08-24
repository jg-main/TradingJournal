/**
 * /api/performance/analytics route integration tests
 *
 * Uses an in-memory SQLite DB via vi.mock('@/db') — the same pattern as the
 * app-profile and account route tests. Exercises the full GET handler with
 * seeded accounts, trades, executions, risk snapshots, grades, and rollforward.
 *
 * Run: npx vitest run src/app/api/performance/analytics/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '@/db/schema';

const sqlite = new Database(':memory:');
const db = drizzle(sqlite, { schema });

// ── Minimal schema: only the tables the route reads ───────────────────────

sqlite.exec(`
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
  risk_override_reason TEXT,
  opened_at TEXT,
  closed_at TEXT,
  reviewed_at TEXT,
  exit_notes TEXT,
  lesson TEXT,
  current_price REAL,
  current_price_fetched_at TEXT,
  created_at TEXT DEFAULT (current_timestamp),
  updated_at TEXT DEFAULT (current_timestamp)
);
CREATE TABLE trade_executions (
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
CREATE TABLE trade_risk_snapshots (
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
CREATE TABLE trade_grades (
  id TEXT PRIMARY KEY NOT NULL,
  trade_id TEXT NOT NULL UNIQUE,
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
  updated_at TEXT DEFAULT (current_timestamp)
);
CREATE TABLE lookup_values (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (current_timestamp),
  updated_at TEXT DEFAULT (current_timestamp)
);
CREATE TABLE setup_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  how_to_play TEXT,
  entry_rules TEXT,
  exit_rules TEXT,
  tags TEXT,
  default_risk_pct REAL,
  position_sizing_rules TEXT,
  chart_patterns TEXT,
  analysis_config TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (current_timestamp),
  updated_at TEXT DEFAULT (current_timestamp)
);
`);

vi.mock('@/db', () => ({ db }));

// ── No-N+1 instrumentation ────────────────────────────────────────────────
// Count SELECT statements issued against the setup lookup tables. The batched
// setup-name resolution must touch lookup_values + setup_definitions exactly
// once per request regardless of trade count — a per-trade lookup would
// increment this with every trade. Drizzle issues SQL through the shared
// in-memory connection, so counting at the prepare level is robust.
let setupLookupQueryCount = 0;
const rawPrepare = sqlite.prepare.bind(sqlite);
sqlite.prepare = ((sql: string) => {
  if (/lookup_values|setup_definitions/i.test(sql)) {
    setupLookupQueryCount += 1;
  }
  return rawPrepare(sql);
}) as typeof sqlite.prepare;

async function loadRoute() {
  return import('../route');
}

function get(query: string) {
  return new NextRequest(`http://localhost/api/performance/analytics${query}`);
}

// ── Seeds ─────────────────────────────────────────────────────────────────

const ACC_USD = 'acc-usd';
const ACC_EUR = 'acc-eur';

// Trade that entered Jan 28 and closed Feb 3 — the close-date boundary trade.
// net = (120-100)*100 - 10 fees = 1990
const TRADE_BOUNDARY = 't-boundary';
// Closed Jan 10. net = (210-200)*50 - 10 = 490
const TRADE_JAN = 't-jan';
// Open trade (no closedAt) — counts toward totalTrades, never realized P&L.
const TRADE_OPEN = 't-open';
// Deleted (scratch) — must be excluded everywhere (D057/R027).
const TRADE_DELETED = 't-deleted';
// Short loss closed Jan 12. net = (100-110)*50 - 10 = -510
const TRADE_LOSS = 't-loss';
// EUR-account trade closed Feb 5. net = (110-100)*10 - 4 = 96
const TRADE_EUR = 't-eur';

function seedAccount(id: string, currency: string, startingBalance: number) {
  db.insert(schema.accounts)
    .values({ id, name: id, currency, startingBalance })
    .run();
}

function seedTrade(t: {
  id: string;
  accountId: string;
  symbol: string;
  direction: 'long' | 'short';
  status: 'open' | 'closed' | 'deleted';
  setupId?: string;
  openedAt?: string | null;
  closedAt?: string | null;
}) {
  db.insert(schema.trades)
    .values({
      id: t.id,
      tradeCode: `TC-${t.id}`,
      accountId: t.accountId,
      symbol: t.symbol,
      direction: t.direction,
      status: t.status,
      setupId: t.setupId ?? null,
      openedAt: t.openedAt ?? null,
      closedAt: t.closedAt ?? null,
    })
    .run();
}

function seedExecution(tradeId: string, action: 'buy' | 'sell' | 'buy_to_cover' | 'sell_short' | 'add' | 'reduce', quantity: number, price: number, fees: number, executedAt: string) {
  db.insert(schema.tradeExecutions)
    .values({ id: randomUUID(), tradeId, action, quantity, price, fees, executedAt })
    .run();
}

function seedRisk(tradeId: string, initialRiskAmount: number) {
  db.insert(schema.tradeRiskSnapshots)
    .values({ id: randomUUID(), tradeId, initialRiskAmount })
    .run();
}

function seedGrade(tradeId: string, totalScore: number | null) {
  db.insert(schema.tradeGrades)
    .values({ id: randomUUID(), tradeId, totalScore })
    .run();
}

/** Seed the canonical setup bridge: setupDefinitions.name (display case) +
 *  lookupValues.value (lowercased, as resolveSetup stores it). */
function seedSetup(id: string, name: string) {
  db.insert(schema.setupDefinitions)
    .values({ id, name, isActive: true })
    .run();
  db.insert(schema.lookupValues)
    .values({ id, type: 'setup', value: name.toLowerCase(), isActive: true })
    .run();
}

function seedRollforward(accountId: string, date: string, endingEquity: number, drawdownAmount = 0, drawdownPct = 0) {
  db.insert(schema.accountRollforward)
    .values({
      id: randomUUID(),
      accountId,
      date,
      endingEquity,
      cumulativePnl: endingEquity,
      highWaterMark: endingEquity,
      drawdownAmount,
      drawdownPct,
    })
    .run();
}

function seedAll() {
  seedAccount(ACC_USD, 'USD', 50000);
  seedAccount(ACC_EUR, 'EUR', 100000);

  // Canonical setup bridge: display name in setup_definitions, lowercased
  // lookup value in lookup_values (both keyed by the same setup UUID).
  seedSetup('setup-breakout', 'Breakout');
  seedSetup('setup-pullback', 'Pullback');

  // acc-usd trades
  seedTrade({
    id: TRADE_BOUNDARY, accountId: ACC_USD, symbol: 'AAPL', direction: 'long', status: 'closed',
    setupId: 'setup-breakout', openedAt: '2024-01-28T10:00:00Z', closedAt: '2024-02-03T15:00:00Z',
  });
  seedExecution(TRADE_BOUNDARY, 'buy', 100, 100, 5, '2024-01-28T10:00:00Z');
  seedExecution(TRADE_BOUNDARY, 'sell', 100, 120, 5, '2024-02-03T15:00:00Z');
  seedRisk(TRADE_BOUNDARY, 500);

  seedTrade({
    id: TRADE_JAN, accountId: ACC_USD, symbol: 'MSFT', direction: 'long', status: 'closed',
    setupId: 'setup-pullback', openedAt: '2024-01-05T10:00:00Z', closedAt: '2024-01-10T15:00:00Z',
  });
  seedExecution(TRADE_JAN, 'buy', 50, 200, 5, '2024-01-05T10:00:00Z');
  seedExecution(TRADE_JAN, 'sell', 50, 210, 5, '2024-01-10T15:00:00Z');
  seedRisk(TRADE_JAN, 250);

  seedTrade({
    id: TRADE_OPEN, accountId: ACC_USD, symbol: 'TSLA', direction: 'long', status: 'open',
    openedAt: '2024-03-01T10:00:00Z', closedAt: null,
  });
  seedExecution(TRADE_OPEN, 'buy', 10, 250, 2, '2024-03-01T10:00:00Z');

  seedTrade({
    id: TRADE_DELETED, accountId: ACC_USD, symbol: 'AAPL', direction: 'long', status: 'deleted',
    openedAt: '2024-01-14T10:00:00Z', closedAt: '2024-01-15T10:00:00Z',
  });
  seedExecution(TRADE_DELETED, 'buy', 20, 180, 2, '2024-01-14T10:00:00Z');
  seedExecution(TRADE_DELETED, 'sell', 20, 182, 2, '2024-01-15T10:00:00Z');

  seedTrade({
    id: TRADE_LOSS, accountId: ACC_USD, symbol: 'NVDA', direction: 'short', status: 'closed',
    setupId: 'setup-breakout', openedAt: '2024-01-10T09:00:00Z', closedAt: '2024-01-12T14:00:00Z',
  });
  seedExecution(TRADE_LOSS, 'sell_short', 50, 100, 5, '2024-01-10T09:00:00Z');
  seedExecution(TRADE_LOSS, 'buy_to_cover', 50, 110, 5, '2024-01-12T14:00:00Z');
  seedRisk(TRADE_LOSS, 300);

  // acc-eur trade
  seedTrade({
    id: TRADE_EUR, accountId: ACC_EUR, symbol: 'VWAGY', direction: 'long', status: 'closed',
    setupId: 'setup-pullback', openedAt: '2024-02-04T10:00:00Z', closedAt: '2024-02-05T15:00:00Z',
  });
  seedExecution(TRADE_EUR, 'buy', 10, 100, 2, '2024-02-04T10:00:00Z');
  seedExecution(TRADE_EUR, 'sell', 10, 110, 2, '2024-02-05T15:00:00Z');
  seedRisk(TRADE_EUR, 100);

  // Grades: one graded trade, one graded with NULL totalScore (must not count)
  seedGrade(TRADE_BOUNDARY, 87.5);
  seedGrade(TRADE_JAN, null);

  // Rollforward — acc-usd has an April row with a real drawdown; acc-eur stops in March.
  seedRollforward(ACC_USD, '2024-01-31', 51000);
  seedRollforward(ACC_USD, '2024-02-29', 53000);
  seedRollforward(ACC_USD, '2024-03-31', 54000);
  seedRollforward(ACC_USD, '2024-04-30', 52000, 2000, 0.037);
  seedRollforward(ACC_EUR, '2024-01-31', 100500);
  seedRollforward(ACC_EUR, '2024-02-29', 100600);
  seedRollforward(ACC_EUR, '2024-03-31', 101000);
}

function cleanup() {
  for (const table of ['account_rollforward', 'trade_grades', 'trade_risk_snapshots', 'trade_executions', 'trades', 'accounts', 'lookup_values', 'setup_definitions']) {
    sqlite.exec(`DELETE FROM ${table};`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/performance/analytics', () => {
  beforeEach(() => {
    cleanup();
    seedAll();
  });

  it('returns typed analytics for all accounts with mixed-currency warning', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get(''));
    expect(response.status).toBe(200);
    const body = await response.json();

    // metadata
    expect(body.metadata.accountCount).toBe(2);
    expect(body.metadata.mixedCurrencies).toBe(true);
    expect(body.metadata.tradeCount).toBe(4); // boundary, jan, loss, eur (deleted excluded)
    expect(body.metadata.totalInitialRisk).toBe(1150); // 500+250+300+100
    expect(body.metadata.periodStartEquity).toBe(151500); // aggregated Jan 31 equity
    // Distinct-symbol facet: all non-deleted trades across both accounts,
    // sorted and deduplicated (AAPL appears twice — one deleted, excluded).
    expect(body.metadata.distinctSymbols).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA', 'VWAGY']);

    // kpiMetrics — all 4 closed trades, deleted excluded from totalTrades
    expect(body.kpiMetrics.totalTrades).toBe(5); // 4 closed + 1 open, no deleted
    expect(body.kpiMetrics.closedTrades).toBe(4);
    expect(body.kpiMetrics.netPnl).toBeCloseTo(2066, 5); // 1990 + 490 - 510 + 96

    // new kernels
    expect(body.kpiMetrics.grossPnl.grossProfit).toBeCloseTo(2576, 5);
    expect(body.kpiMetrics.grossPnl.grossLoss).toBeCloseTo(510, 5);
    expect(body.kpiMetrics.grossPnl.grossPnl).toBeCloseTo(2066, 5);
    expect(body.kpiMetrics.medianR).toBeCloseTo(1.46, 5); // median of [-1.7, 0.96, 1.96, 3.98]
    expect(body.kpiMetrics.dayWinRate).toBeCloseTo(0.75, 5); // (1 + 0 + 1 + 1) / 4

    // charts present and typed
    expect(Array.isArray(body.charts.monthlyPerformance)).toBe(true);
    expect(Array.isArray(body.charts.rDistribution)).toBe(true);
    expect(Array.isArray(body.charts.dailyNetPnl)).toBe(true);
    expect(Array.isArray(body.charts.cumulativeDailyPnl)).toBe(true);
    expect(Array.isArray(body.charts.equityCurve)).toBe(true);
    expect(Array.isArray(body.charts.drawdownCurve)).toBe(true);
    expect(Array.isArray(body.charts.tradeDurationPerformance)).toBe(true);
    expect(Array.isArray(body.charts.tradeDurationPoints)).toBe(true);
    expect(Array.isArray(body.charts.performanceByDayOfWeek)).toBe(true);
    expect(Array.isArray(body.charts.performanceByTimeOfDay)).toBe(true);

    // Setup display names resolve through the canonical lookup bridge — the
    // raw setup UUID must never surface as a user-facing label.
    const setupNames = body.charts.setupPerformance.map((s: { setupName: string }) => s.setupName);
    expect(setupNames).toContain('Breakout');
    expect(setupNames).toContain('Pullback');
    expect(setupNames.every((n: string) => !n.startsWith('setup-'))).toBe(true);

    // cumulative P&L ends at total net P&L
    const cumulative = body.charts.cumulativeDailyPnl;
    expect(cumulative[cumulative.length - 1].cumulativePnl).toBeCloseTo(2066, 5);
  });

  it('attributes realized P&L by close date: Jan window excludes the Feb-closed trade', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?accountScope=single&accountIds=acc-usd&dateFrom=2024-01-01&dateTo=2024-01-31'));
    expect(response.status).toBe(200);
    const body = await response.json();

    // boundary trade closed Feb 3 is excluded; jan (Jan 10) and loss (Jan 12) included
    expect(body.kpiMetrics.closedTrades).toBe(2);
    expect(body.kpiMetrics.netPnl).toBeCloseTo(-20, 5); // 490 - 510

    const dates = body.charts.dailyNetPnl.map((d: { date: string }) => d.date);
    expect(dates).toEqual(['2024-01-10', '2024-01-12']);

    // open trade still counts toward totalTrades in a dated window
    expect(body.kpiMetrics.totalTrades).toBe(4); // boundary+jan+open+loss (no deleted)
    expect(body.kpiMetrics.openTrades).toBe(1);
    expect(body.metadata.tradeCount).toBe(2);
  });

  it('includes the boundary trade in a February window (close-date attribution)', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?accountScope=single&accountIds=acc-usd&dateFrom=2024-02-01'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kpiMetrics.closedTrades).toBe(1);
    expect(body.kpiMetrics.netPnl).toBeCloseTo(1990, 5);
    expect(body.charts.dailyNetPnl[0].date).toBe('2024-02-03');
  });

  it('excludes soft-deleted (scratched) trades from every aggregation (D057/R027)', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?accountScope=single&accountIds=acc-usd'));
    expect(response.status).toBe(200);
    const body = await response.json();
    // deleted trade would add 1 to totalTrades and ~20 to netPnl if not excluded
    expect(body.kpiMetrics.totalTrades).toBe(4);
    expect(body.kpiMetrics.closedTrades).toBe(3);
    expect(body.kpiMetrics.netPnl).toBeCloseTo(1990 + 490 - 510, 5);
  });

  it('applies the setupIds advanced filter', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?accountScope=single&accountIds=acc-usd&setupIds=setup-breakout'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kpiMetrics.closedTrades).toBe(2); // boundary + loss
    expect(body.kpiMetrics.netPnl).toBeCloseTo(1480, 5); // 1990 - 510
  });

  it('applies the directions advanced filter', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?accountScope=single&accountIds=acc-usd&directions=short'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kpiMetrics.closedTrades).toBe(1);
    expect(body.kpiMetrics.netPnl).toBeCloseTo(-510, 5);
    // The facet responds to non-symbol filters (only the short NVDA trade remains).
    expect(body.metadata.distinctSymbols).toEqual(['NVDA']);
  });

  it('applies the symbols advanced filter', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?accountScope=single&accountIds=acc-usd&symbols=NVDA'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kpiMetrics.closedTrades).toBe(1);
    expect(body.kpiMetrics.netPnl).toBeCloseTo(-510, 5);
    // The symbol facet stays stable under the symbol filter itself (checkbox
    // options never vanish while narrowing the dimension).
    expect(body.metadata.distinctSymbols).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
  });

  it('applies the tradeResults advanced filter (win/loss derived from realized P&L)', async () => {
    const { GET } = await loadRoute();
    const wins = await (await GET(get('?tradeResults=win'))).json();
    expect(wins.kpiMetrics.closedTrades).toBe(3); // boundary, jan, eur
    expect(wins.kpiMetrics.netPnl).toBeCloseTo(2576, 5);

    const losses = await (await GET(get('?tradeResults=loss'))).json();
    expect(losses.kpiMetrics.closedTrades).toBe(1);
    expect(losses.kpiMetrics.netPnl).toBeCloseTo(-510, 5);

    const multi = await (await GET(get('?tradeResults=win,loss'))).json();
    expect(multi.kpiMetrics.closedTrades).toBe(4);
  });

  it('rejects malformed date parameters with 400 field errors', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?dateFrom=not-a-date'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.details.fieldErrors.dateFrom).toBeDefined();
  });

  it('returns 400 when no accounts are resolvable', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?accountScope=multiple'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('No accounts found');
  });

  it('aggregates multi-account rollforward into one portfolio series without duplicate dates', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get(''));
    expect(response.status).toBe(200);
    const body = await response.json();

    const curve = body.charts.equityCurve as Array<{ date: string; equity: number }>;
    const dates = curve.map((p) => p.date);
    expect(new Set(dates).size).toBe(dates.length); // no duplicate x-values
    const feb = curve.find((p) => p.date === '2024-02-29');
    expect(feb).toBeDefined();
    expect(feb!.equity).toBeCloseTo(153600, 5); // 53000 + 100600

    // single-account rollforward passes through unchanged (parity)
    const single = await (await GET(get('?accountScope=single&accountIds=acc-usd'))).json();
    const singleFeb = single.charts.equityCurve.find((p: { date: string }) => p.date === '2024-02-29');
    expect(singleFeb.equity).toBeCloseTo(53000, 5);
  });

  it('computes max drawdown from the rollforward series and reports period start equity', async () => {
    const { GET } = await loadRoute();
    const body = await (await GET(get('?accountScope=single&accountIds=acc-usd'))).json();
    expect(body.kpiMetrics.maxDrawdown).toEqual({ amount: 2000, pct: 0.037 });
    expect(body.metadata.mixedCurrencies).toBe(false);
    expect(body.metadata.periodStartEquity).toBe(51000);
  });

  it('returns graceful empty analytics for a window with no trades', async () => {
    const { GET } = await loadRoute();
    const response = await GET(get('?accountScope=single&accountIds=acc-usd&dateFrom=2025-01-01&dateTo=2025-12-31'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.metadata.tradeCount).toBe(0);
    expect(body.kpiMetrics.closedTrades).toBe(0);
    expect(body.kpiMetrics.netPnl).toBe(0);
    expect(body.kpiMetrics.winRate).toBeNull();
    expect(body.kpiMetrics.medianR).toBeNull();
    expect(body.kpiMetrics.dayWinRate).toBeNull();
    expect(body.kpiMetrics.grossPnl.grossPnl).toBe(0);
    expect(body.kpiMetrics.maxDrawdown).toBeNull();
    expect(body.charts.dailyNetPnl).toEqual([]);
    expect(body.charts.equityCurve).toEqual([]);
  });

  it('resolves setup display names through a batched lookup (no N+1) and degrades unresolvable IDs', async () => {
    const { GET } = await loadRoute();

    // Instrumented counter is per-module; reset before the request.
    setupLookupQueryCount = 0;
    const body = await (await GET(get(''))).json();

    // Setup names come from the canonical lookup bridge, not the raw UUID.
    const byName = new Map<string, { setupName: string; setupId: string | null; count: number }>(
      body.charts.setupPerformance.map((s: { setupName: string; setupId: string | null; count: number }) => [s.setupName, s]),
    );
    expect(byName.get('Breakout')).toBeDefined();
    expect(byName.get('Breakout')!.count).toBe(2);
    expect(byName.get('Pullback')).toBeDefined();
    expect(byName.get('Pullback')!.count).toBe(2);

    // Exactly two batched setup queries (lookup_values + setup_definitions)
    // regardless of the trade count — no per-trade database access.
    expect(setupLookupQueryCount).toBe(2);

    // Unresolvable setup ID degrades to a readable fallback, never the UUID.
    seedTrade({
      id: 't-orphan', accountId: ACC_USD, symbol: 'ORPH', direction: 'long', status: 'closed',
      setupId: '00000000-0000-0000-0000-000000000000',
      openedAt: '2024-02-10T10:00:00Z', closedAt: '2024-02-11T10:00:00Z',
    });
    seedExecution('t-orphan', 'buy', 10, 50, 1, '2024-02-10T10:00:00Z');
    seedExecution('t-orphan', 'sell', 10, 60, 1, '2024-02-11T10:00:00Z');
    const body2 = await (await GET(get(''))).json();
    const orphan = body2.charts.setupPerformance.find((s: { setupId: string }) => s.setupId === '00000000-0000-0000-0000-000000000000');
    expect(orphan).toBeDefined();
    expect(orphan.setupName).toBe('Unknown setup');
  });

  it('exposes one trade-duration point per closed trade with individual canonical metrics', async () => {
    const { GET } = await loadRoute();
    const body = await (await GET(get('?accountScope=single&accountIds=acc-usd'))).json();

    // acc-usd scope: boundary (Jan 28 → Feb 3), jan (Jan 5 → Jan 10), loss
    // (Jan 10 → Jan 12). The open trade and the soft-deleted trade are excluded.
    const points = body.charts.tradeDurationPoints as Array<{
      tradeId: string;
      symbol: string;
      holdingDurationMinutes: number;
      netPnl: number;
      rMultiple: number | null;
      setupId: string | null;
      setupName: string | null;
      closedAt: string;
    }>;
    expect(points).toHaveLength(3);

    const bySymbol = new Map(points.map((p) => [p.symbol, p]));

    // Trade A: AAPL, entered Jan 28 10:00Z → closed Feb 3 15:00Z = 6d5h = 8940m
    const aapl = bySymbol.get('AAPL')!;
    expect(aapl.tradeId).toBe(TRADE_BOUNDARY);
    expect(aapl.holdingDurationMinutes).toBeCloseTo(8940, 5);
    expect(aapl.netPnl).toBeCloseTo(1990, 5);
    expect(aapl.rMultiple).toBeCloseTo(3.98, 5); // 1990 / 500
    expect(aapl.setupName).toBe('Breakout');
    expect(aapl.closedAt).toBe('2024-02-03T15:00:00Z');

    // Trade B: MSFT, Jan 5 10:00Z → Jan 10 15:00Z = 5d5h = 7500m
    const msft = bySymbol.get('MSFT')!;
    expect(msft.tradeId).toBe(TRADE_JAN);
    expect(msft.holdingDurationMinutes).toBeCloseTo(7500, 5);
    expect(msft.netPnl).toBeCloseTo(490, 5);
    expect(msft.rMultiple).toBeCloseTo(1.96, 5); // 490 / 250
    expect(msft.setupName).toBe('Pullback');

    // Trade C: NVDA short, Jan 10 09:00Z → Jan 12 14:00Z = 2d5h = 3180m, loss
    const nvda = bySymbol.get('NVDA')!;
    expect(nvda.tradeId).toBe(TRADE_LOSS);
    expect(nvda.holdingDurationMinutes).toBeCloseTo(3180, 5);
    expect(nvda.netPnl).toBeCloseTo(-510, 5);
    expect(nvda.rMultiple).toBeCloseTo(-1.7, 5); // -510 / 300
    expect(nvda.setupName).toBe('Breakout');

    // Deterministic order: shortest holding first.
    expect(points.map((p) => p.symbol)).toEqual(['NVDA', 'MSFT', 'AAPL']);

    // A trade without a risk snapshot has rMultiple = null (not fabricated).
    seedTrade({
      id: 't-norisk', accountId: ACC_USD, symbol: 'NORISK', direction: 'long', status: 'closed',
      openedAt: '2024-02-15T10:00:00Z', closedAt: '2024-02-16T11:00:00Z',
    });
    seedExecution('t-norisk', 'buy', 5, 100, 1, '2024-02-15T10:00:00Z');
    seedExecution('t-norisk', 'sell', 5, 120, 1, '2024-02-16T11:00:00Z');
    const body2 = await (await GET(get('?accountScope=single&accountIds=acc-usd'))).json();
    const noRisk = (body2.charts.tradeDurationPoints as Array<{ symbol: string; rMultiple: number | null; setupName: string | null; setupId: string | null }>).find((p) => p.symbol === 'NORISK');
    expect(noRisk).toBeDefined();
    expect(noRisk!.rMultiple).toBeNull();
    expect(noRisk!.setupId).toBeNull();
    expect(noRisk!.setupName).toBeNull();
  });
});
