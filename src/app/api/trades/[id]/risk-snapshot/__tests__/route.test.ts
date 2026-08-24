/**
 * Trade risk snapshot route test — REAL handler invocation (M002-A3)
 *
 * Tests GET + PUT /api/trades/[id]/risk-snapshot by invoking the ACTUAL
 * route handlers from route.ts with mock NextRequest objects against a real
 * migrated SQLite database.
 *
 * M002-A3 contract under test:
 *   - GET remains read-only: 200 + row (incl. A2 provenance) / 404 missing.
 *   - PUT is retired: 405 + stable { error, code: 'RISK_SNAPSHOT_IMMUTABLE' },
 *     Allow: GET, and NEVER mutates — cannot create, cannot edit, for
 *     planned/open/closed trades alike.
 *   - Rejected client mutation cannot change R multiple or account-risk%:
 *     the snapshot is server-owned derived historical evidence.
 *   - No alternate PATCH/POST/DELETE mutation path exists on the route.
 *
 * Run: npx tsx src/app/api/trades/\[id\]/risk-snapshot/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/\[id\]/risk-snapshot/__tests__/route.test.ts`)
 */
/// <reference types="vitest/globals" />

// ────────────────────────────────────────────────────────────────────────────
// 0. Node/tsx runtime shims
// ────────────────────────────────────────────────────────────────────────────
//
// `src/db/index.ts` imports 'server-only' (a Next.js marker package). Under
// plain `tsx` the react-server export condition is not active, so the real
// package throws. Short-circuit it before any module that transitively
// requires it is loaded. Same pattern as the correction route test.
import { testDbPath } from '../../../../../../lib/testing/test-db';
import Module from 'node:module';

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

// Point @/db at a dedicated throwaway test database BEFORE it initializes.
const TEST_DB_FILE = testDbPath('risk-snapshot-route-a3');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ────────────────────────────────────────────────────────────────────────────
// 1. Static imports (all safe under plain tsx)
// ────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { NextRequest, NextResponse } from 'next/server';

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

// ────────────────────────────────────────────────────────────────────────────
// 2. Real-module handles (populated in main() via dynamic import)
// ────────────────────────────────────────────────────────────────────────────

type RouteModule = {
  GET: (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>;
  PUT: (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>;
};

let route: RouteModule | null = null;
let NextRequestCtor: typeof NextRequest | null = null;
let db: (typeof import('@/db'))['db'] | null = null;
let computeTradeMetrics: (typeof import('@/lib/trade-metrics'))['computeTradeMetrics'] | null = null;

function requireDb() {
  if (!db) throw new Error('db not initialized — call main() first');
  return db;
}

// ── Route invocation helpers (REAL handlers, REAL NextRequest) ─────────

async function callGet(tradeId: string): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/risk-snapshot`;
  const res = await route.GET(new NextRequestCtor(url, { method: 'GET' }), {
    params: Promise.resolve({ id: tradeId }),
  });
  return { status: res.status, data: await res.json() };
}

async function callPut(
  tradeId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/risk-snapshot`;
  const res = await route.PUT(
    new NextRequestCtor(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tradeId }) },
  );
  return { status: res.status, data: await res.json() };
}

// ── Setup: seed/cleanup against the real migrated DB ───────────────────

/** Wipe tables between/after cases against the real migrated DB. */
async function cleanupRaw() {
  const dbMod = await import('@/db');
  const raw = dbMod.getSqliteHandle();
  raw.exec('PRAGMA foreign_keys = OFF;');
  raw.exec(`
    DELETE FROM ledger_postings;
    DELETE FROM ledger_entries;
    DELETE FROM financial_events;
    DELETE FROM valuation_marks;
    DELETE FROM correction_lineage;
    DELETE FROM lot_matches;
    DELETE FROM fifo_lots;
    DELETE FROM account_positions;
    DELETE FROM accounting_executions;
    DELETE FROM account_performance;
    DELETE FROM trade_executions;
    DELETE FROM trade_risk_snapshots;
    DELETE FROM trades;
    DELETE FROM accounts;
  `);
  raw.exec('PRAGMA foreign_keys = ON;');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      maxRiskPerTradePct: null,
      defaultCommission: null,
      startingBalance: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.accounts.$inferInsert)
    .run();
  return requireDb().select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().insert(schema.trades)
    .values({
      id,
      tradeCode: `TC-${randomUUID().slice(0, 8)}`,
      accountId: 'test-account-id',
      symbol: 'AAPL',
      direction: 'long',
      status: 'open',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.trades.$inferInsert)
    .run();
  return requireDb().select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedExecution(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().insert(schema.tradeExecutions)
    .values({
      id,
      tradeId,
      action: 'buy',
      quantity: 100,
      price: 50.0,
      fees: 0,
      executedAt: now,
      createdAt: now,
      ...overrides,
    } as typeof schema.tradeExecutions.$inferInsert)
    .run();
  return requireDb().select().from(schema.tradeExecutions).where(eq(schema.tradeExecutions.id, id)).get() as Record<string, unknown>;
}

/** Seed a trade_risk_snapshots row (what the execution engine creates on first fill). */
function seedRiskSnapshot(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().insert(schema.tradeRiskSnapshots)
    .values({
      id,
      tradeId,
      accountEquityAtOpen: 10000,
      accountEquitySource: 'current_projection',
      accountEquityAsOf: '2026-01-01T00:00:00.000Z',
      initialEntryPrice: 50.0,
      initialStopPrice: 48.0,
      initialQuantity: 100,
      riskPerShare: 2.0,
      initialRiskAmount: 200.0,
      accountRiskPct: 2.0,
      plannedRewardRisk: 3.0,
      createdAt: now,
      ...overrides,
    } as typeof schema.tradeRiskSnapshots.$inferInsert)
    .run();
  return requireDb().select().from(schema.tradeRiskSnapshots).where(eq(schema.tradeRiskSnapshots.tradeId, tradeId)).get() as Record<string, unknown>;
}

function getRiskSnapshot(tradeId: string): Record<string, unknown> | undefined {
  return requireDb()
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, tradeId))
    .get() as Record<string, unknown> | undefined;
}

/** Snapshot of every mutable client-facing risk field (economically relevant). */
function riskFields(row: Record<string, unknown>): Record<string, unknown> {
  return {
    accountEquityAtOpen: row.accountEquityAtOpen,
    accountEquitySource: row.accountEquitySource,
    accountEquityAsOf: row.accountEquityAsOf,
    initialEntryPrice: row.initialEntryPrice,
    initialStopPrice: row.initialStopPrice,
    initialQuantity: row.initialQuantity,
    riskPerShare: row.riskPerShare,
    initialRiskAmount: row.initialRiskAmount,
    accountRiskPct: row.accountRiskPct,
    plannedRewardRisk: row.plannedRewardRisk,
  };
}

/** R multiple for a closed trade via the canonical trade-metrics library. */
function computeR(tradeId: string): number | null {
  const trade = requireDb()
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, tradeId))
    .get() as Record<string, unknown>;
  const execs = requireDb()
    .select()
    .from(schema.tradeExecutions)
    .where(eq(schema.tradeExecutions.tradeId, tradeId))
    .all() as Array<Record<string, unknown>>;
  const snapshot = getRiskSnapshot(tradeId);
  if (!computeTradeMetrics) throw new Error('computeTradeMetrics not initialized');
  const metrics = computeTradeMetrics({
    executions: execs.map((e) => ({
      id: String(e.id),
      action: String(e.action),
      quantity: Number(e.quantity),
      price: Number(e.price),
      fees: e.fees == null ? null : Number(e.fees),
      executedAt: String(e.executedAt ?? e.createdAt ?? ''),
    })),
    direction: trade.direction as 'long' | 'short',
    riskSnapshot: snapshot ? {
      initialEntryPrice: snapshot.initialEntryPrice as number | null,
      initialStopPrice: snapshot.initialStopPrice as number | null,
      initialRiskAmount: snapshot.initialRiskAmount as number | null,
      accountEquityAtOpen: snapshot.accountEquityAtOpen as number | null,
    } : null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
    now: Date.parse('2026-02-01T00:00:00.000Z'),
  });
  return metrics.returnMetrics.rMultiple;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. main(): dynamic import of @/db + real route module, then the cases
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const dbMod = await import('@/db');
  db = dbMod.db;
  const routeMod = await import('../route');
  route = routeMod as RouteModule;
  const { NextRequest: NR } = await import('next/server');
  NextRequestCtor = NR;
  const tm = await import('@/lib/trade-metrics');
  computeTradeMetrics = tm.computeTradeMetrics;

  await cleanupRaw();

  // FK target for all seeded trades (trades.account_id NOT NULL).
  const acct = seedAccount({ id: 'test-account-id' });
  void acct;

  // ── 1. GET missing → 404 ─────────────────────────────────────────────
  console.log('\n1. GET missing snapshot → 404:');
  {
    const trade = seedTrade({ status: 'planned' });
    const r = await callGet(String(trade.id));
    assertEqual(r.status, 404, 'GET missing → 404');
    const data = r.data as { error: string };
    assertEqual(data.error, 'Risk snapshot not found', '404 error message');
  }

  // ── 2. GET existing → 200 incl. A2 provenance ────────────────────────
  console.log('\n2. GET existing snapshot → 200 with provenance:');
  {
    const trade = seedTrade({ status: 'open' });
    seedRiskSnapshot(String(trade.id));
    const r = await callGet(String(trade.id));
    assertEqual(r.status, 200, 'GET existing → 200');
    const data = r.data as Record<string, unknown>;
    assertEqual(data.initialRiskAmount, 200, 'initialRiskAmount exposed');
    assertEqual(data.accountEquitySource, 'current_projection', 'equitySource exposed (A2)');
    assertEqual(data.accountEquityAsOf, '2026-01-01T00:00:00.000Z', 'equityAsOf exposed (A2)');
  }

  // ── 3. §19 planned trade PUT → 405, no row created ───────────────────
  console.log('\n3. §19 planned trade PUT → 405, no snapshot created:');
  {
    const trade = seedTrade({ status: 'planned' });
    const r = await callPut(String(trade.id), {
      accountEquityAtOpen: 50000,
      initialEntryPrice: 50,
      initialStopPrice: 48,
      initialQuantity: 100,
      riskPerShare: 2,
      initialRiskAmount: 200,
      accountRiskPct: 0.4,
      plannedRewardRisk: 3,
    });
    assertEqual(r.status, 405, 'PUT planned trade → 405');
    const data = r.data as { error: string; code: string };
    assertEqual(data.error, 'Risk snapshot is immutable', 'stable error message');
    assertEqual(data.code, 'RISK_SNAPSHOT_IMMUTABLE', 'stable error code');
    assertEqual(getRiskSnapshot(String(trade.id)), undefined, 'no snapshot row created');
  }

  // ── 4. §20 open trade PUT → 405, row economically unchanged ──────────
  console.log('\n4. §20 open trade PUT → 405, snapshot unchanged:');
  {
    const trade = seedTrade({ status: 'open' });
    const before = seedRiskSnapshot(String(trade.id));
    const r = await callPut(String(trade.id), {
      accountEquityAtOpen: 100000,
      initialEntryPrice: 999,
      initialStopPrice: 999,
      initialQuantity: 999,
      riskPerShare: 999,
      initialRiskAmount: 25,
      accountRiskPct: 0.001,
      plannedRewardRisk: 99,
    });
    assertEqual(r.status, 405, 'PUT open trade → 405');
    const after = getRiskSnapshot(String(trade.id));
    assert(after !== undefined, 'snapshot still exists');
    assertEqual(
      JSON.stringify(riskFields(after as Record<string, unknown>)),
      JSON.stringify(riskFields(before as Record<string, unknown>)),
      'every risk field + provenance byte-identical after rejected PUT',
    );
    assertEqual((after as Record<string, unknown>).accountEquityAtOpen, 10000, 'accountEquityAtOpen unchanged');
    assertEqual((after as Record<string, unknown>).initialRiskAmount, 200, 'initialRiskAmount unchanged');
    assertEqual((after as Record<string, unknown>).accountRiskPct, 2, 'accountRiskPct unchanged (§28)');
    assertEqual((after as Record<string, unknown>).accountEquitySource, 'current_projection', 'provenance unchanged');
  }

  // ── 5. §21 closed trade PUT → 405 ────────────────────────────────────
  console.log('\n5. §21 closed trade PUT → 405:');
  {
    const trade = seedTrade({ status: 'closed' });
    const before = seedRiskSnapshot(String(trade.id));
    const r = await callPut(String(trade.id), { initialRiskAmount: 1, accountEquityAtOpen: 1 });
    assertEqual(r.status, 405, 'PUT closed trade → 405');
    assertEqual(
      JSON.stringify(riskFields(getRiskSnapshot(String(trade.id)) as Record<string, unknown>)),
      JSON.stringify(riskFields(before as Record<string, unknown>)),
      'closed history not editable',
    );
  }

  // ── 6. §27 R multiple unchanged after rejected PUT ───────────────────
  console.log('\n6. §27 R multiple unchanged after rejected PUT:');
  {
    const trade = seedTrade({ status: 'closed', direction: 'long' });
    // Full round trip: buy 100@50, sell 100@55 → realized 500.
    seedExecution(String(trade.id), { action: 'buy', quantity: 100, price: 50, executedAt: '2026-01-05T10:00:00.000Z' });
    seedExecution(String(trade.id), { action: 'sell', quantity: 100, price: 55, executedAt: '2026-01-06T10:00:00.000Z' });
    seedRiskSnapshot(String(trade.id), { initialEntryPrice: 50, initialStopPrice: 48, initialQuantity: 100, riskPerShare: 2, initialRiskAmount: 200 });

    const rBefore = computeR(String(trade.id));
    assertEqual(rBefore, 2.5, 'R before rejected PUT = 500/200 = 2.5');

    const r = await callPut(String(trade.id), { initialRiskAmount: 25, accountEquityAtOpen: 100000 });
    assertEqual(r.status, 405, 'PUT closed trade → 405');

    const rAfter = computeR(String(trade.id));
    assertEqual(rAfter, rBefore, 'R unchanged — client cannot rewrite the R denominator');
  }

  // ── 7. No alternate mutation verb on the route ───────────────────────
  console.log('\n7. Route module exports only GET + PUT (immutable):');
  {
    const routeKeys = Object.keys(route as RouteModule).sort();
    assertEqual(JSON.stringify(routeKeys), JSON.stringify(['GET', 'PUT']), 'no PATCH/POST/DELETE mutation path');
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
}

// Dual-mode finish: this file is both a standalone tsx harness (Run:
// `npx tsx <file>`) and a vitest suite (registered in the include list in
// vitest.config.ts so the T02 verification surface `npx vitest run <file>`
// executes it). main() is async (real route imports + awaits), so the vitest
// test awaits the shared main() promise; under tsx main() runs to completion
// and exits non-zero on failure.
const mainPromise = main();

if (typeof test !== 'undefined') {
  test('standalone risk-snapshot route harness (assertions run at import)', async () => {
    await mainPromise;
    if (failed > 0) {
      throw new Error(`         ${failed}/${passed + failed} FAILED`);
    }
    console.log('         All tests passed!');
  });
} else {
  mainPromise.catch((e) => {
    console.error('route.test.ts: unexpected error', e);
    process.exit(1);
  });
}
