/**
 * trade executions route test (S03/T03)
 *
 * Tests GET (list by tradeId) and POST (create) against the REAL route
 * handlers with the canonical atomic execution engine underneath. The POST
 * handler is a thin HTTP adapter over executeTradeFill — no independent
 * execution logic lives in the route anymore (S03). Every scenario drives the
 * actual route through a real NextRequest; the engine owns the transaction,
 * readiness/checklist gates, risk snapshot, accounting posting, FIFO position
 * rebuild and performance rebuild.
 *
 * Run: npx tsx src/app/api/trades/[id]/executions/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/[id]/executions/__tests__/route.test.ts`)
 */
/// <reference types="vitest/globals" />

// ────────────────────────────────────────────────────────────────────────────
// 0. Intercept Next.js's 'server-only' marker (throws under plain tsx) and
//    point @/db at a dedicated throwaway test database BEFORE it initializes.
//    (Both must happen before the dynamic import of '@/db' inside main().)
//    The vitest path resolves 'server-only' via the alias in
//    vitest.config.ts (src/lib/testing/server-only-stub.ts) instead.
// ────────────────────────────────────────────────────────────────────────────

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

import { testDbPath } from '../../../../../../lib/testing/test-db';
process.env.DB_FILE_NAME = testDbPath('executions-route');

// ────────────────────────────────────────────────────────────────────────────
// 1. Static imports (all safe under plain tsx)
// ────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — value is null/undefined (FAILED)`);
  }
}

/** Loose shape of the engine result serialized by the POST route. */
type EngineResultShape = {
  execution: Record<string, unknown>;
  trade: Record<string, unknown>;
  riskSnapshot: Record<string, unknown> | null;
  accountingExecution: Record<string, unknown> | null;
  replayed: boolean;
};

// ────────────────────────────────────────────────────────────────────────────
// 2. Real-module handles (populated in main() via dynamic import)
// ────────────────────────────────────────────────────────────────────────────

type RouteModule = {
  GET: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => Promise<NextResponse>;
  POST: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => Promise<NextResponse>;
};

let route: RouteModule | null = null;
let NextRequestCtor: typeof NextRequest | null = null;
let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => import('better-sqlite3').Database) | null = null;

function requireDb() {
  if (!db || !getSqliteHandle) throw new Error('db not initialized — call main() first');
  return { db, getSqliteHandle };
}

// ── Route invocation helpers (REAL handlers, REAL NextRequest) ─────────

async function callGet(tradeId: string): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/executions`;
  const res = await route.GET(new NextRequestCtor(url), {
    params: Promise.resolve({ id: tradeId }),
  });
  return { status: res.status, data: await res.json() };
}

async function callPost(
  tradeId: string,
  body: string | Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/executions`;
  const res = await route.POST(
    new NextRequestCtor(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tradeId }) }
  );
  return { status: res.status, data: await res.json() };
}

// ── Setup: seed/cleanup against the real migrated DB ───────────────────

function cleanup() {
  const sqlite = requireDb().getSqliteHandle();
  // The ledger/accounting tables are protected by migration-level immutability
  // triggers (0024/0026/0029/0035) that block UPDATE/DELETE. Drop them for the
  // test DB so inter-case cleanup can DELETE; the engine only INSERTs/rebuilds
  // replaceable projections, so the test flow is unaffected.
  sqlite.exec(`
    DROP TRIGGER IF EXISTS trg_financial_events_prevent_update;
    DROP TRIGGER IF EXISTS trg_financial_events_prevent_delete;
    DROP TRIGGER IF EXISTS trg_ledger_entries_prevent_update;
    DROP TRIGGER IF EXISTS trg_ledger_entries_prevent_delete;
    DROP TRIGGER IF EXISTS trg_ledger_postings_prevent_update;
    DROP TRIGGER IF EXISTS trg_ledger_postings_prevent_delete;
    DROP TRIGGER IF EXISTS trg_accounting_executions_prevent_update;
    DROP TRIGGER IF EXISTS trg_accounting_executions_prevent_delete;
    DROP TRIGGER IF EXISTS trg_correction_lineage_prevent_update;
    DROP TRIGGER IF EXISTS trg_correction_lineage_prevent_delete;
    DROP TRIGGER IF EXISTS trg_fe_correction_lineage_prevent_update;
    DROP TRIGGER IF EXISTS trg_fe_correction_lineage_prevent_delete;
    DROP TRIGGER IF EXISTS trg_valuation_marks_prevent_update;
    DROP TRIGGER IF EXISTS trg_valuation_marks_prevent_delete;
  `);
  sqlite.exec('PRAGMA foreign_keys = OFF;');
  sqlite.exec(`
    DELETE FROM ledger_postings;
    DELETE FROM ledger_entries;
    DELETE FROM financial_events;
    DELETE FROM valuation_marks;
    DELETE FROM correction_lineage;
    DELETE FROM financial_event_correction_lineage;
    DELETE FROM lot_matches;
    DELETE FROM fifo_lots;
    DELETE FROM account_positions;
    DELETE FROM accounting_executions;
    DELETE FROM account_performance;
    DELETE FROM account_rollforward;
    DELETE FROM account_transactions;
    DELETE FROM trade_check_results;
    DELETE FROM trade_risk_snapshots;
    DELETE FROM trade_executions;
    DELETE FROM trade_stop_adjustments;
    DELETE FROM trades;
    DELETE FROM checklist_definitions;
    DELETE FROM lookup_values;
    DELETE FROM setup_definitions;
    DELETE FROM instruments;
    DELETE FROM settings;
    DELETE FROM accounts;
  `);
  sqlite.exec('PRAGMA foreign_keys = ON;');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      // Fully configured for trading by default so existing cases exercise
      // the gates without tripping them; negative paths override explicitly.
      startingBalance: 10000,
      maxRiskPerTradePct: 10,
      defaultCommission: 1.0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.accounts.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.trades)
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
    } as typeof schema.trades.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedExecution(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.tradeExecutions)
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
    } as typeof schema.tradeExecutions.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.tradeExecutions).where(eq(schema.tradeExecutions.id, id)).get() as Record<string, unknown>;
}

function seedCheckDefinition(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.checklistDefinitions)
    .values({
      id,
      description: 'Default check description',
      isRequired: true,
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.checklistDefinitions.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

/** Replace the single-row settings table (raw insert — mirrors the engine). */
function seedSettings(startingAccountValue: number | null, maxRiskPerTradePct: number | null = null): void {
  requireDb().getSqliteHandle()
    .prepare(
      `INSERT OR REPLACE INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission)
       VALUES ('default', ?, ?, 1)`,
    )
    .run(startingAccountValue, maxRiskPerTradePct);
}

/** Seed account_rollforward.ending_equity (canonical cascade fallback #2). */
function seedRollforward(accountId: string, endingEquity: number): void {
  const now = new Date().toISOString();
  requireDb().getSqliteHandle()
    .prepare(
      `INSERT INTO account_rollforward
         (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl,
          fees, ending_equity, cumulative_pnl, created_at, updated_at)
       VALUES (?, ?, '2026-01-01', 0, 0, 0, 0, ?, 0, ?, ?)`,
    )
    .run(randomUUID(), accountId, endingEquity, now, now);
}

/** Seed account_performance.nav (canonical cascade fallback #1). */
function seedAccountPerformance(accountId: string, nav: string): void {
  const now = new Date().toISOString();
  requireDb().getSqliteHandle()
    .prepare(
      `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions, realized_pnl,
          unrealized_pnl, total_pnl, realized_fees, gross_exposure, net_exposure,
          warnings, positions_json, rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00',
               '[]', '[]', 0, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, now, '0.00', nav, now, now, now);
}

function countRows(table: string, where: string, ...params: unknown[]): number {
  const row = requireDb().getSqliteHandle()
    .prepare(`SELECT count(*) AS count FROM ${table} WHERE ${where}`)
    .get(...params) as { count: number };
  return row.count;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Tests — each block invokes the REAL route handlers
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load the real modules AFTER the env var is set so @/db initializes
  // against DB_FILE_NAME with all migrations auto-applied.
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  const nextMod = await import('next/server');
  NextRequestCtor = nextMod.NextRequest;

  const routeMod = await import('../route');
  route = routeMod as unknown as RouteModule;

  let routePath = '../route.ts';
  try {
    // fileURLToPath only works under tsx (file: URL); vitest's jsdom base
    // URL is http://localhost, so the diagnostic falls back gracefully.
    routePath = fileURLToPath(new URL('../route.ts', import.meta.url)).replace(`${process.cwd()}/`, '');
  } catch {
    // keep the default label
  }

  console.log('\n--- Trade Executions API Tests (real route handlers + engine) ---\n');
  console.log(`  Route module: ${routePath}`);
  console.log(`  DB: ${process.env.DB_FILE_NAME} (real migrated schema)`);
  // Function source proves the imported handlers are the real route exports.
  console.log(`  POST handler source: ${route.POST.toString().slice(0, 64)}…`);

  // ── 1. GET: Returns empty list for trade with no executions ─────────

  console.log('\n1. GET returns empty list for trade with no executions:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const result = await callGet(trade.id as string);
    assert(result.status === 200, 'returns 200');
    const data = result.data as unknown[];
    assert(Array.isArray(data), 'response is an array');
    assertEqual(data.length, 0, 'array is empty');
  }

  // ── 2. GET: 404 for nonexistent trade ───────────────────────────────

  console.log('\n2. GET returns 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callGet('nonexistent-trade');
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 3. GET: Returns executions ordered by executedAt ────────────────

  console.log('\n3. GET returns executions ordered by executedAt:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    const exec1 = seedExecution({ tradeId: trade.id, action: 'buy', quantity: 50, price: 148.0, executedAt: '2025-06-01T10:00:00Z' });
    const exec2 = seedExecution({ tradeId: trade.id, action: 'add', quantity: 50, price: 150.0, executedAt: '2025-06-01T11:00:00Z' });

    const result = await callGet(trade.id as string);
    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>[];
    assertEqual(data.length, 2, 'returns 2 executions');
    assertEqual(data[0].id, exec1.id, 'first execution is the earliest');
    assertEqual(data[1].id, exec2.id, 'second execution is the later one');
    assertEqual(data[0].action, 'buy', 'first action is buy');
    assertEqual(data[1].action, 'add', 'second action is add');
  }

  // ── 4. POST: Creates execution with valid data ──────────────────────

  console.log('\n4. POST creates execution with valid data:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      fees: 5.0,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as EngineResultShape;
    assertNotNull(data.execution, 'response includes the created execution');
    assertEqual(data.execution.action, 'buy', 'action matches');
    assertEqual(data.execution.quantity, 100, 'quantity matches');
    assertEqual(data.execution.price, 150.0, 'price matches');
    assertEqual(data.execution.fees, 5.0, 'fees matches');
    assertEqual(data.execution.tradeId, trade.id, 'tradeId matches');
    // The route mints an idempotency key when the client does not send one.
    assertNotNull(data.execution.idempotencyKey, 'idempotency key auto-generated');
    assertEqual(data.replayed, false, 'not a replay');

    // Response carries the updated trade + risk snapshot (additive, backward
    // compatible with consumers that only read the execution row).
    assertNotNull(data.trade, 'response includes the updated trade');
    assertEqual(data.trade.status, 'open', 'response trade status is open');
    assertEqual(data.trade.id, trade.id, 'response trade id matches');

    // Verify trade status updated to 'open'
    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status updated to open');
    assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
  }

  // ── 5. POST: Validates action enum ──────────────────────────────────

  console.log('\n5. POST returns 400 for invalid action:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const result = await callPost(trade.id as string, {
      action: 'invalid',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 400, 'returns 400');
  }

  // ── 6. POST: Validates positive quantity ────────────────────────────

  console.log('\n6. POST returns 400 for non-positive quantity:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: -10,
      price: 150.0,
    });

    assert(result.status === 400, 'returns 400 for negative quantity');

    const result2 = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 0,
      price: 150.0,
    });

    assert(result2.status === 400, 'returns 400 for zero quantity');
  }

  // ── 7. POST: Validates positive price ───────────────────────────────

  console.log('\n7. POST returns 400 for non-positive price:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 0,
    });

    assert(result.status === 400, 'returns 400 for zero price');
  }

  // ── 8. POST: Validates fees >= 0 ────────────────────────────────────

  console.log('\n8. POST returns 400 for negative fees:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      fees: -1,
    });

    assert(result.status === 400, 'returns 400 for negative fees');
  }

  // ── 9. POST: 404 for nonexistent trade ──────────────────────────────

  console.log('\n9. POST returns 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callPost('nonexistent-trade', {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 10. POST: Recalculates status from planned to closed on full exit ─

  console.log('\n10. POST recalculates status from open to closed on full exit:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    // First entry
    await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    // Full exit
    const result = await callPost(trade.id as string, {
      action: 'sell',
      quantity: 100,
      price: 160.0,
    });

    assert(result.status === 201, 'returns 201');
    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'closed', 'trade status is closed');
    assertNotNull(updatedTrade.closedAt, 'trade has closedAt');
    assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
  }

  // ── 11. POST: Returns 400 for deleted trade ─────────────────────────

  console.log('\n11. POST returns 400 for deleted (scratched) trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'deleted' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 400, 'returns 400');
    const data = result.data as { error: string };
    assertEqual(data.error, 'Cannot add executions to a deleted trade', 'error names the deleted trade');
    assertEqual(countRows('trade_executions', 'trade_id = ?', trade.id as string), 0, 'no execution created');
  }

  // ── 12. POST: Over-close exit rejected pre-flight with 400, zero mutations ─

  console.log('\n12. POST rejects an over-close exit pre-flight with 400 (zero orphan rows):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    // Entry opens the trade; full exit closes it (accounting position flat).
    await callPost(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });
    await callPost(trade.id as string, { action: 'sell', quantity: 100, price: 160.0 });

    // A third exit exceeds the flat position: the engine's S04 pre-flight
    // quantity guard rejects it with a typed error BEFORE any mutation, so
    // the route returns a friendly 400 instead of a 500 rollback.
    const result = await callPost(trade.id as string, {
      action: 'sell',
      quantity: 100,
      price: 162.0,
    });

    assert(result.status === 400, 'returns 400 for the rejected over-close fill');
    const data = result.data as { error: string; details: { requestedQuantity: number; openQuantity: number } };
    assertEqual(data.error, 'Over-close rejected', 'error names the over-close');
    assertEqual(data.details.requestedQuantity, 100, 'details carries the requested quantity');
    assertEqual(data.details.openQuantity, 0, 'details carries the open quantity');
    assertEqual(countRows('trade_executions', 'trade_id = ?', trade.id as string), 2, 'no orphan journal execution');
    assertEqual(countRows('accounting_executions', 'journal_trade_id = ?', trade.id as string), 2, 'no orphan accounting execution');
    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'closed', 'trade status unchanged after rejection');
  }

  // ── 12b. POST: Over-close on an open position (partial close) → 400 ─

  console.log('\n12b. POST rejects an over-close against an open position with 400:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    await callPost(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });

    // Only 100 are open; selling 150 exceeds the open quantity.
    const result = await callPost(trade.id as string, {
      action: 'sell',
      quantity: 150,
      price: 160.0,
    });

    assert(result.status === 400, 'returns 400');
    const data = result.data as { error: string; details: { requestedQuantity: number; openQuantity: number } };
    assertEqual(data.error, 'Over-close rejected', 'error names the over-close');
    assertEqual(data.details.requestedQuantity, 150, 'details carries the requested quantity');
    assertEqual(data.details.openQuantity, 100, 'details carries the open quantity');
    assertEqual(countRows('trade_executions', 'trade_id = ?', trade.id as string), 1, 'no new journal execution');
  }

  // ── 12c. POST: add/reduce on a planned trade → 400 (open position required) ─

  console.log('\n12c. POST rejects add/reduce on a planned trade with 400 (open position required):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const addResult = await callPost(trade.id as string, {
      action: 'add',
      quantity: 50,
      price: 152.0,
    });
    assert(addResult.status === 400, 'add on planned returns 400');
    assertEqual(
      (addResult.data as { error: string }).error,
      'Action requires open position',
      'add error names the open-position requirement',
    );

    const reduceResult = await callPost(trade.id as string, {
      action: 'reduce',
      quantity: 25,
      price: 152.0,
    });
    assert(reduceResult.status === 400, 'reduce on planned returns 400');
    assertEqual(
      (reduceResult.data as { error: string }).error,
      'Action requires open position',
      'reduce error names the open-position requirement',
    );

    assertEqual(countRows('trade_executions', 'trade_id = ?', trade.id as string), 0, 'no execution created');
  }

  // ── 13. POST: Validates action-direction compatibility for long trade ──

  console.log('\n13. POST validates action-direction compatibility for long trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', direction: 'long' });

    const result = await callPost(trade.id as string, {
      action: 'sell_short',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 400, 'returns 400 for incompatible action');
    const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
    assertNotNull(data.details, 'has details');
    assertNotNull(data.details.fieldErrors?.action, 'has action field error');
  }

  // ── 14. POST: Validates action-direction compatibility for short trade ─

  console.log('\n14. POST validates action-direction compatibility for short trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', direction: 'short' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 400, 'returns 400 for incompatible action');
  }

  // ── 15. POST: Creates risk snapshot on first entry with plannedStop ───

  console.log('\n15. POST creates risk snapshot on first entry when plannedStop is set:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 201, 'returns 201');

    const snapshot = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .get() as Record<string, unknown> | undefined;

    assertNotNull(snapshot, 'risk snapshot was created');
    assertEqual(snapshot!.initialEntryPrice, 150.0, 'initialEntryPrice matches buy price');
    assertEqual(snapshot!.initialQuantity, 100, 'initialQuantity matches');
    assertEqual(snapshot!.initialStopPrice, 145.0, 'initialStopPrice matches plannedStop');
  }

  // ── 16. POST: Creates risk snapshot on first entry without plannedStop ─

  console.log('\n16. POST creates risk snapshot without initialStopPrice when plannedStop is null:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: null });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 201, 'returns 201');

    const snapshot = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .get() as Record<string, unknown> | undefined;

    assertNotNull(snapshot, 'risk snapshot was created');
    assertEqual(snapshot!.initialEntryPrice, 150.0, 'initialEntryPrice matches');
    assertEqual(snapshot!.initialStopPrice, null, 'initialStopPrice is null');
  }

  // ── 17. POST: Populates accountEquityAtOpen from account.startingBalance ─

  console.log('\n17. POST populates accountEquityAtOpen from account.startingBalance:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 201, 'returns 201');

    const snapshot = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .get() as Record<string, unknown> | undefined;

    assertNotNull(snapshot, 'risk snapshot was created');
    assertEqual(snapshot!.accountEquityAtOpen, 10000, 'accountEquityAtOpen matches startingBalance');
  }

  // ── 18. POST: Canonical cascade — rollforward.ending_equity wins ────

  console.log('\n18. POST uses account_rollforward.ending_equity over startingBalance:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 5000 });
    seedRollforward('test-account-id', 8000);
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 201, 'returns 201');

    const snapshot = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .get() as Record<string, unknown> | undefined;

    assertNotNull(snapshot, 'risk snapshot was created');
    assertEqual(snapshot!.accountEquityAtOpen, 8000, 'equity = rollforward.ending_equity (canonical cascade)');
  }

  // ── 19. POST: Canonical cascade — performance.nav wins over all ────

  console.log('\n19. POST uses account_performance.nav over rollforward/startingBalance:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 5000 });
    seedRollforward('test-account-id', 8000);
    seedAccountPerformance('test-account-id', '9000.00');
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 201, 'returns 201');

    const snapshot = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .get() as Record<string, unknown> | undefined;

    assertNotNull(snapshot, 'risk snapshot was created');
    assertEqual(snapshot!.accountEquityAtOpen, 9000, 'equity = account_performance.nav (canonical cascade)');
  }

  // ── 20. POST: Falls back to settings.startingAccountValue when no account data ─

  console.log('\n20. POST falls back to settings.startingAccountValue:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: null });
    seedSettings(25000);

    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 201, 'returns 201');

    const snapshot = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .get() as Record<string, unknown> | undefined;

    assertNotNull(snapshot, 'risk snapshot was created');
    assertEqual(snapshot!.accountEquityAtOpen, 25000, 'equity falls back to settings.startingAccountValue');
  }

  // ── 21. POST: Blocks execution when the account has no cash/equity ──

  console.log('\n21. POST blocks execution when the account has no cash (equity unavailable):');
  {
    cleanup();
    // No settings row, account has no startingBalance → equity null → no
    // opening cash → the readiness gate rejects before any mutation.
    seedAccount({ id: 'test-account-id', startingBalance: null });

    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 409, 'returns 409 when the account has no cash');
    const data = result.data as { error: string };
    assertEqual(data.error, 'Account setup incomplete for trading', 'error names the readiness failure');

    const execs = requireDb().db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
      .all();
    assertEqual(execs.length, 0, 'no execution created when readiness rejects');
  }

  // ── 22. First fill enforces required checklist items ─────────────────

  console.log('\n22. First fill enforces required checklist items:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    seedCheckDefinition({ accountId: 'test-account-id', description: 'Required pre-trade check', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 400, 'returns 400 when required checklist item missing on first fill');
    const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
    const errors = (data.details?.fieldErrors?.checkResults ?? []).join(' ');
    assert(errors.includes('Required pre-trade check'), 'error names the missing required item');

    // Gate fires before mutation: no execution created.
    const execs = requireDb().db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
      .all();
    assertEqual(execs.length, 0, 'no execution created when the gate rejects');
  }

  // ── 23. First fill passes with required submitted; optional omitted ──

  console.log('\n23. First fill passes with required items submitted (optional omitted) and persists itemText:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const check1 = seedCheckDefinition({ accountId: 'test-account-id', description: 'Required check A', sortOrder: 1 });
    seedCheckDefinition({ accountId: 'test-account-id', description: 'Optional check B', sortOrder: 2, isRequired: false });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: true },
        // Optional check B omitted — must not gate.
      ],
    });

    assert(result.status === 201, 'returns 201');
    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, '1 check result persisted');
    assertEqual(persisted[0].checklistDefinitionId, check1.id as string, 'required item persisted');
    assertEqual(persisted[0].itemText, 'Required check A', 'itemText snapshots the description');
  }

  // ── 24. Subsequent fills skip the checklist gate ─────────────────────

  console.log('\n24. Subsequent fills skip the checklist gate:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const check = seedCheckDefinition({ accountId: 'test-account-id', description: 'Required check', sortOrder: 1 });

    // First fill passes the gate (required item submitted) and opens the trade.
    const first = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      checkResults: [{ checklistDefinitionId: check.id as string, passed: true }],
    });
    assert(first.status === 201, 'first fill opens the trade');

    // Trade already open — an add fill must NOT re-enforce the gate (F8).
    const result = await callPost(trade.id as string, {
      action: 'add',
      quantity: 50,
      price: 152.0,
    });

    assert(result.status === 201, 'returns 201 on subsequent fill with no checkResults');
    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, 'no new check results persisted on subsequent fill');
  }

  // ── 25. Max-risk exceeded blocks the first fill with 422 ──────────

  console.log('\n25. Max-risk exceeded blocks the first fill with 422 and no mutation:');
  {
    cleanup();
    // 0.5% max risk of $10,000 equity = $50 limit.
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0, // risk = $500 > $50 limit
    });

    assert(result.status === 422, 'returns 422 for max-risk exceeded');
    const data = result.data as { error: string; details: { limit: number; computed: number; overrideable: boolean } };
    assertEqual(data.error, 'Max risk exceeded', 'error message');
    assertEqual(data.details.limit, 50, 'details.limit = 0.5% of 10000');
    assertEqual(data.details.computed, 500, 'details.computed = proposed risk');
    assert(data.details.overrideable === true, 'details.overrideable is true');

    const execs = requireDb().db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
      .all();
    assertEqual(execs.length, 0, 'no execution created when max-risk blocks');
  }

  // ── 26. Max-risk override executes and stores the reason ───────────

  console.log('\n26. Max-risk override with reason executes and stores the reason:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      riskOverrideReason: 'Gap risk accepted per desk policy',
    });

    assert(result.status === 201, 'returns 201 with override reason');
    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.riskOverrideReason, 'Gap risk accepted per desk policy', 'riskOverrideReason stored on trade');
    assertEqual(updatedTrade.status, 'open', 'trade opened');
  }

  // ── 27. Subsequent fills skip the readiness/max-risk gate ─────────

  console.log('\n27. Subsequent fills skip the readiness gate (no max-risk re-check):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    // Small first fill: risk $50 equals the $50 limit, so the gate passes and
    // the trade opens (keeps the max-risk gate quiet for the first fill).
    const first = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 10,
      price: 150.0,
    });
    assert(first.status === 201, 'first fill opens the trade');

    // This fill's risk ($500) exceeds the $50 limit, but the trade is already
    // open — the gate (first fill only) must NOT re-enforce max-risk.
    const result = await callPost(trade.id as string, {
      action: 'add',
      quantity: 100,
      price: 150.0,
      riskOverrideReason: 'ignored on subsequent fills',
    });

    assert(result.status === 201, 'returns 201 on subsequent fill despite risk');
    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.riskOverrideReason, null, 'override reason not stored on subsequent fills');
  }

  // ── 28. Account not trading-ready blocks the first fill with 409 ──

  console.log('\n28. Account not trading-ready blocks the first fill with 409:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: null });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });

    assert(result.status === 409, 'returns 409 for account not trading-ready');
    const data = result.data as { error: string };
    assertEqual(data.error, 'Account setup incomplete for trading', 'error message');
  }

  // ── 29. Empty riskOverrideReason fails zod validation ─────────────

  console.log('\n29. Empty riskOverrideReason returns 400 validation error:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      riskOverrideReason: '',
    });

    assert(result.status === 400, 'returns 400 for empty riskOverrideReason');
  }

  // ── 30. POST: Idempotent replay returns 200 with the original result ─

  console.log('\n30. POST with a repeated idempotency key replays the original result:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const key = randomUUID();

    const first = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      idempotencyKey: key,
    });
    assert(first.status === 201, 'first fill returns 201');
    assertEqual((first.data as EngineResultShape).replayed, false, 'first fill is not a replay');

    const replay = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      idempotencyKey: key,
    });
    // Pre-flight replay returns the original result (replayed: true) and the
    // route serializes it with 201; the 200 path is reserved for the
    // concurrent-duplicate IdempotentReplayError inside the transaction.
    assert(replay.status === 201, 'replay returns the original result');
    const replayData = replay.data as EngineResultShape;
    assertEqual(replayData.replayed, true, 'replay flag is set');
    assertEqual(replayData.execution.id, (first.data as EngineResultShape).execution.id, 'replay returns the original execution');
    assertEqual(replayData.trade.id, trade.id, 'replay returns the updated trade');

    // Zero new rows across the journal and accounting domains.
    assertEqual(countRows('trade_executions', 'trade_id = ?', trade.id as string), 1, 'no new journal execution');
    assertEqual(countRows('accounting_executions', 'journal_trade_id = ?', trade.id as string), 1, 'no new accounting execution');
    assertEqual(countRows('financial_events', 'account_id = ?', 'test-account-id'), 1, 'no new financial event');
  }

  // ── 31. POST: A supplied key is persisted and honored end-to-end ────

  console.log('\n31. POST persists a client-supplied idempotency key on the execution:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const key = randomUUID();

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
      idempotencyKey: key,
    });
    assert(result.status === 201, 'returns 201');
    assertEqual((result.data as EngineResultShape).execution.idempotencyKey, key, 'execution row stores the supplied key');
  }

  // ── 32. POST: Engine phases commit through the route (accounting side) ─

  console.log('\n32. POST commits accounting + FIFO + performance through the route:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      action: 'buy',
      quantity: 100,
      price: 150.0,
    });
    assert(result.status === 201, 'returns 201');

    const data = result.data as EngineResultShape;
    assertNotNull(data.riskSnapshot, 'response includes the risk snapshot');
    assertEqual(data.riskSnapshot!.initialEntryPrice, 150.0, 'snapshot entry price matches');
    assertNotNull(data.accountingExecution, 'response includes the accounting execution');

    // Accounting mirror + financial event + ledger + FIFO position + perf.
    assertEqual(countRows('accounting_executions', 'journal_trade_id = ?', trade.id as string), 1, 'accounting execution created');
    assertEqual(countRows('financial_events', "account_id = ? AND event_type = 'trade_execution'", 'test-account-id'), 1, 'financial event created');
    assertEqual(countRows('ledger_postings', 'account_id = ?', 'test-account-id') >= 2, true, 'balanced ledger postings created');
    assertEqual(countRows('account_positions', 'account_id = ? AND quantity = ?', 'test-account-id', '100.00'), 1, 'FIFO position rebuilt');
    assertEqual(countRows('account_performance', 'account_id = ?', 'test-account-id'), 1, 'account performance rebuilt');
  }

  // ── Summary ──────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED`);
    // The tsx path must exit non-zero; under vitest the verdict is surfaced
    // by the registered test below (process.exit would kill the runner).
    if (typeof test === 'undefined') {
      process.exit(1);
    }
  } else {
    console.log('         All tests passed!');
  }
}

// Dual-mode finish: this file is both a standalone tsx harness (Run:
// `npx tsx <file>`) and a vitest suite (registered in the include list in
// vitest.config.ts). main() is async (real route imports + awaits), so the
// vitest test awaits the shared main() promise; under tsx main() runs to
// completion and exits non-zero on failure.
const mainPromise = main();

if (typeof test !== 'undefined') {
  test('standalone executions route harness (assertions run at import)', async () => {
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
