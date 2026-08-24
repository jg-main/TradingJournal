/**
 * risk-propagation-s05.test.ts
 *
 * S05/T04 — proves the open-risk propagation chain end to end:
 *
 *   trade-levels.deriveCurrentStop (latest stop adjustment → initial stop
 *   → planned stop)
 *     → trade-metrics.computeTradeMetrics (risk.activeStop)
 *     → accounting/dashboard-v2 computeRiskToStop (per-position
 *       currentRiskToStop = |avgCost − stop| × qty, clamped ≥ 0)
 *     → openRiskToStop = Σ currentRiskToStop
 *     → portfolioHeat = openRiskToStop / NAV × 100
 *
 * Three layers:
 *   1. Kernel chain — computeTradeMetrics with a plain TradeMetricsInput:
 *      activeStop starts at the risk snapshot's initial stop, then follows
 *      a stop adjustment on recompute.
 *   2. Dashboard boundary — computeDashboardV2 against a REAL migrated
 *      SQLite database: after inserting a stop adjustment, a fresh
 *      computation ("normal refresh") reflects the new stop in the
 *      per-position currentRiskToStop, the openRiskToStop aggregate, and
 *      portfolioHeat.
 *   3. Workflow-phase transition — the real GET /api/trades/[id] handler
 *      reports 'open' for a plain open trade; the real
 *      POST /api/trades/[id]/stop-adjustments handler flips it to
 *      'managed'; adding an add execution keeps it 'managed'.
 *
 * Run: npx vitest run src/lib/__tests__/risk-propagation-s05.test.ts
 */

/// <reference types="vitest/globals" />

// ────────────────────────────────────────────────────────────────────────────
// 0. Test database bootstrap (BEFORE any dynamic import of '@/db')
// ────────────────────────────────────────────────────────────────────────────
//
// `src/db/index.ts` reads DB_FILE_NAME at import time. The env var must be
// set at module top — before beforeAll() dynamically imports '@/db' — so the
// singleton binds to a throwaway temp DB, never the dev journal.
import { testDbPath } from '../testing/test-db';
import Module from 'node:module';

// `src/db/index.ts` imports 'server-only' (a Next.js marker package). Under
// plain `tsx` the react-server export condition is not active, so the real
// package throws. Short-circuit it before any module that transitively
// requires it is loaded. (Vitest resolves the 'server-only' alias declared
// in vitest.config.ts; the shim keeps the tsx path working.)
const originalLoad = (Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load;
(Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const TEST_DB_FILE = testDbPath('risk-propagation-s05');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ────────────────────────────────────────────────────────────────────────────
// 1. Static imports (all pure — no DB initialization at module load)
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { computeTradeMetrics } from '../trade-metrics';
import type { TradeMetricsInput } from '../trade-metrics';
import { computeDashboardV2 } from '../accounting/dashboard-v2';
import { deriveCurrentStop } from '../trade-levels';

// ────────────────────────────────────────────────────────────────────────────
// 2. Lazily-acquired real DB + route handles (dynamic import in beforeAll)
// ────────────────────────────────────────────────────────────────────────────

type DetailRoute = {
  GET: (
    request: import('next/server').NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<import('next/server').NextResponse>;
};

type StopAdjustmentsRoute = {
  POST: (
    request: import('next/server').NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<import('next/server').NextResponse>;
};

let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => import('better-sqlite3').Database) | null = null;
let detailRoute: DetailRoute | null = null;
let stopAdjustmentsRoute: StopAdjustmentsRoute | null = null;
let NextRequestCtor: typeof import('next/server').NextRequest | null = null;

function requireDb() {
  if (!db || !getSqliteHandle) throw new Error('db not initialized — call beforeAll first');
  return { db, getSqliteHandle };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Real-handler invocation helpers
// ────────────────────────────────────────────────────────────────────────────

interface DetailBody {
  id: string;
  status: string;
  workflowPhase?: string;
  [key: string]: unknown;
}

async function getTradeDetail(tradeId: string): Promise<{ status: number; body: DetailBody }> {
  if (!detailRoute || !NextRequestCtor) throw new Error('detail route not initialized');
  const res = await detailRoute.GET(new NextRequestCtor(`http://localhost:3000/api/trades/${tradeId}`), {
    params: Promise.resolve({ id: tradeId }),
  });
  return { status: res.status, body: (await res.json()) as DetailBody };
}

async function postStopAdjustment(
  tradeId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  if (!stopAdjustmentsRoute || !NextRequestCtor) throw new Error('stop-adjustments route not initialized');
  const res = await stopAdjustmentsRoute.POST(
    new NextRequestCtor(`http://localhost:3000/api/trades/${tradeId}/stop-adjustments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tradeId }) },
  );
  return { status: res.status, data: await res.json() };
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Seeding + reset helpers (real migrated schema via @/db)
// ────────────────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

/**
 * Wipe every table the fixtures touch, in FK-safe order.
 *
 * Immutability triggers from migrations 0024/0026/0027 (trg_*_prevent_delete)
 * block DELETEs on financial_events, ledger_entries, ledger_postings,
 * accounting_executions and valuation_marks. Capture their DDL, drop them for
 * the wipe, then restore them so the test DB stays fully realistic.
 */
function resetDb(): void {
  const { getSqliteHandle: handle } = requireDb();
  const h = handle();
  const triggers = h
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger' AND sql IS NOT NULL
         AND (sql LIKE '%prevent_update%' OR sql LIKE '%prevent_delete%')`,
    )
    .all() as Array<{ name: string; sql: string }>;
  for (const t of triggers) {
    h.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
  }
  try {
    h.exec(`
      DELETE FROM trade_target_adjustments;
      DELETE FROM trade_stop_adjustments;
      DELETE FROM trade_risk_snapshots;
      DELETE FROM trade_executions;
      DELETE FROM trades;
      DELETE FROM account_performance;
      DELETE FROM account_rollforward;
      DELETE FROM valuation_marks;
      DELETE FROM account_positions;
      DELETE FROM lot_matches;
      DELETE FROM fifo_lots;
      DELETE FROM correction_lineage;
      DELETE FROM accounting_executions;
      DELETE FROM ledger_postings;
      DELETE FROM ledger_entries;
      DELETE FROM financial_events;
      DELETE FROM instruments;
      DELETE FROM lookup_values;
      DELETE FROM setup_definitions;
      DELETE FROM accounts;
      DELETE FROM settings;
    `);
  } finally {
    for (const t of triggers) {
      h.exec(t.sql);
    }
  }
}

/** Seed an account row (startingBalance 100000 feeds the equity cascade). */
function seedAccount(accountId: string): void {
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, ?, 'Unit Test Broker', 'USD', 1, 100000, ?, ?)`,
    )
    .run(accountId, `${accountId} Account`, nowIso(), nowIso());
}

/** Seed an instrument row; returns its id. */
function seedInstrument(symbol: string): string {
  const instrumentId = randomUUID();
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'stock', 'USD', 1, ?, ?)`,
    )
    .run(instrumentId, symbol, `${symbol} Inc.`, nowIso(), nowIso());
  return instrumentId;
}

/** Seed an open long trade; returns its id. */
function seedOpenTrade(symbol: string, accountId: string): string {
  const id = randomUUID();
  const ts = nowIso();
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO trades
       (id, trade_code, account_id, symbol, direction, status, opened_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'long', 'open', ?, ?, ?)`,
    )
    .run(id, `T-${id.slice(0, 8)}`, accountId, symbol, ts, ts, ts);
  return id;
}

type ExecutionAction = 'buy' | 'sell' | 'buy_to_cover' | 'sell_short' | 'add' | 'reduce';

/** Seed an execution row for a trade. */
function seedExecution(tradeId: string, action: ExecutionAction, quantity = 100, price = 100): void {
  const ts = nowIso();
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(randomUUID(), tradeId, ts, action, quantity, price, ts);
}

/** Seed a risk snapshot with a stored initial stop price. */
function seedRiskSnapshot(
  tradeId: string,
  initialStopPrice: number,
  initialRiskAmount: number,
  quantity = 100,
): void {
  const ts = nowIso();
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO trade_risk_snapshots
       (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price,
        initial_quantity, risk_per_share, initial_risk_amount, created_at)
       VALUES (?, ?, 100000, 100, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      tradeId,
      initialStopPrice,
      quantity,
      initialRiskAmount / quantity,
      initialRiskAmount,
      ts,
    );
}

/** Seed a stop adjustment row (newStop wins as the current stop). */
function seedStopAdjustment(tradeId: string, newStop: number, previousStop: number): void {
  const ts = nowIso();
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO trade_stop_adjustments
       (id, trade_id, adjusted_at, previous_stop, new_stop, reason, created_at)
       VALUES (?, ?, ?, ?, ?, 'S05 risk propagation test', ?)`,
    )
    .run(randomUUID(), tradeId, ts, previousStop, newStop, ts);
}

/** Seed an account position (the dashboard's per-position risk input). */
function seedAccountPosition(accountId: string, instrumentId: string): void {
  const ts = nowIso();
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, 'long', '100.00', '100.00', '10000.00', '0.00', '0.00', '0.00', ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, instrumentId, ts, ts, ts);
}

/** Seed a fresh valuation mark for the position. */
function seedMark(accountId: string, instrumentId: string): void {
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO valuation_marks
       (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
       VALUES (?, ?, ?, '100.00', 100000000, 'user', ?)`,
    )
    .run(randomUUID(), accountId, instrumentId, nowIso());
}

/** Seed an account_performance row so NAV (portfolioHeat denominator) is known. */
function seedPerformance(accountId: string): void {
  const ts = nowIso();
  requireDb()
    .getSqliteHandle()
    .prepare(
      `INSERT INTO account_performance
       (id, account_id, computed_as_of, net_cash, nav, marked_positions,
        realized_pnl, unrealized_pnl, total_pnl, realized_fees,
        gross_exposure, net_exposure, modified_dietz_return, twr,
        high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
        rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, '0.00', '100000.00', '1', '0.00', '0.00', '0.00', '0.00',
        '10000.00', '10000.00', NULL, NULL, NULL, NULL, NULL, '[]', '[]',
        1, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, ts, ts, ts, ts);
}

/** Seed a full dashboard scenario: account + instrument + open trade + position + mark + NAV. */
function seedDashboardScenario(): { accountId: string; tradeId: string } {
  const accountId = 'acc-risk-prop';
  const symbol = 'RPT';
  seedAccount(accountId);
  const instrumentId = seedInstrument(symbol);
  const tradeId = seedOpenTrade(symbol, accountId);
  seedExecution(tradeId, 'buy', 100, 100);
  seedRiskSnapshot(tradeId, 95, 500);
  seedAccountPosition(accountId, instrumentId);
  seedMark(accountId, instrumentId);
  seedPerformance(accountId);
  return { accountId, tradeId };
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Tests
// ────────────────────────────────────────────────────────────────────────────

const EXECUTED_AT = '2026-08-24T12:00:00.000Z';

/** Kernel input mirroring the seeded dashboard scenario (buy 100 @ 100, stop 95). */
function kernelInput(overrides: Partial<TradeMetricsInput> = {}): TradeMetricsInput {
  return {
    executions: [
      { id: 'e1', action: 'buy', quantity: 100, price: 100, fees: 0, executedAt: EXECUTED_AT },
    ],
    direction: 'long',
    riskSnapshot: {
      initialRiskAmount: 500,
      accountEquityAtOpen: 100000,
      initialStopPrice: 95,
      initialEntryPrice: 100,
    },
    stopAdjustments: [],
    currentMark: { price: 100, markedAt: EXECUTED_AT },
    currentAccountEquity: 100000,
    ...overrides,
  };
}

describe('risk propagation — kernel chain (computeTradeMetrics)', () => {
  it('derives activeStop from the risk snapshot initial stop, then follows a stop adjustment', () => {
    // Initial state: no adjustments → activeStop = snapshot initial stop.
    const before = computeTradeMetrics(kernelInput());
    expect(before.risk.activeStop).toBe(95);
    expect(before.risk.openRisk).toBe((100 - 95) * 100);

    // Stop adjustment → activeStop = latest adjustment's newStop.
    const after = computeTradeMetrics(
      kernelInput({
        stopAdjustments: [
          { id: 'adj-1', stopPrice: 97, adjustedAt: '2026-08-24T13:00:00.000Z' },
        ],
      }),
    );
    expect(after.risk.activeStop).toBe(97);
    expect(after.risk.openRisk).toBe((100 - 97) * 100);

    // The trade-levels chain used by both the kernel and the dashboard agrees.
    expect(deriveCurrentStop(null, 95, [])).toBe(95);
    expect(
      deriveCurrentStop(null, 95, [
        { id: 'adj-1', newStop: 97, adjustedAt: '2026-08-24T13:00:00.000Z', createdAt: null },
      ]),
    ).toBe(97);
  });
});

describe('risk propagation — dashboard boundary (computeDashboardV2)', () => {
  it('reflects a stop adjustment in currentRiskToStop, openRiskToStop, and portfolioHeat on refresh', () => {
    const { accountId, tradeId } = seedDashboardScenario();
    const sqlite = requireDb().getSqliteHandle();

    // Refresh #1 — before any adjustment: stop 95 → risk (100−95)×100 = 500.
    const first = computeDashboardV2(sqlite, accountId)!;
    expect(first).toBeDefined();
    const pos1 = first.valuation.positions[0];
    expect(pos1.risk.hasValidStop).toBe(true);
    expect(pos1.risk.stopPrice).toBe(95);
    expect(pos1.risk.currentRiskToStop).toBe('500.00');
    expect(first.riskSummary.openRiskToStop).toBe('500.00');
    // portfolioHeat = openRiskToStop / NAV × 100 = 500 / 100000 × 100 = 0.50
    expect(first.riskSummary.portfolioHeat).toBe('0.50');
    // openRisk is the initial-risk snapshot sum for the open trade.
    expect(first.riskSummary.openRisk).toBe('500.00');

    // Refresh #2 — after a stop adjustment to 97: risk (100−97)×100 = 300.
    seedStopAdjustment(tradeId, 97, 95);

    const second = computeDashboardV2(sqlite, accountId)!;
    const pos2 = second.valuation.positions[0];
    expect(pos2.risk.stopPrice).toBe(97);
    expect(pos2.risk.currentRiskToStop).toBe('300.00');
    expect(second.riskSummary.openRiskToStop).toBe('300.00');
    expect(second.riskSummary.portfolioHeat).toBe('0.30');

    // Sanity: the values actually changed (the refresh picked up the new stop).
    expect(pos2.risk.stopPrice).not.toBe(pos1.risk.stopPrice);
    expect(second.riskSummary.openRiskToStop).not.toBe(first.riskSummary.openRiskToStop);
  });
});

describe('workflow phase transition — through the trade API', () => {
  it("moves an open trade from 'open' to 'managed' after a stop adjustment, and stays 'managed' after an add execution", async () => {
    const accountId = 'acc-wf-transition';
    seedAccount(accountId);
    const tradeId = seedOpenTrade('WFX', accountId);
    seedExecution(tradeId, 'buy', 100, 100); // entry — NOT management

    // Phase 1: open trade with only an entry execution → 'open'.
    const plain = await getTradeDetail(tradeId);
    expect(plain.status).toBe(200);
    expect(plain.body.workflowPhase).toBe('open');

    // Phase 2: POST a stop adjustment via the real handler → 'managed'.
    const created = await postStopAdjustment(tradeId, { newStop: 97, reason: 'S05 transition' });
    expect(created.status).toBe(201);
    const afterStop = await getTradeDetail(tradeId);
    expect(afterStop.body.workflowPhase).toBe('managed');

    // Phase 3: add an add execution → remains 'managed'.
    seedExecution(tradeId, 'add', 10, 100);
    const afterAdd = await getTradeDetail(tradeId);
    expect(afterAdd.body.workflowPhase).toBe('managed');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Lifecycle
// ────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  const nextMod = await import('next/server');
  NextRequestCtor = nextMod.NextRequest;

  const detailMod = await import('@/app/api/trades/[id]/route');
  detailRoute = detailMod as unknown as DetailRoute;
  const stopMod = await import('@/app/api/trades/[id]/stop-adjustments/route');
  stopAdjustmentsRoute = stopMod as unknown as StopAdjustmentsRoute;

  resetDb();
});

afterAll(() => {
  // Close the shared handle; remove db/wal/shm companions from the temp dir.
  const handle = getSqliteHandle?.();
  if (handle) {
    try {
      handle.close();
    } catch {
      // already closed
    }
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      unlinkSync(TEST_DB_FILE + suffix);
    } catch {
      // already gone
    }
  }
});
