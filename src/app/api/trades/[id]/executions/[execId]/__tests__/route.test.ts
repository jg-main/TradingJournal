/**
 * Trade execution by id route test — REAL handler invocation
 *
 * Tests PUT (update execution + recalc trade status) and DELETE (delete
 * execution + recalc trade status) by invoking the ACTUAL route handlers
 * exported from route.ts with mock NextRequest objects. Every case runs
 * through the real request path (params resolution → request.json() →
 * zod validation → DB access → NextResponse) against a real migrated
 * SQLite database.
 *
 * Covers the M019 S01 T04 contract — the accounting-bypass guard:
 *   - PUT/DELETE on a non-planned trade → 422, no mutation
 *   - PUT/DELETE on a planned trade → 200 with status recalc
 *   - 404 for missing trade / missing execution preserved
 *   - PUT validation (400) and real-pipeline evidence (malformed JSON → 500)
 *
 * Run: npx tsx src/app/api/trades/\[id\]/executions/\[execId\]/__tests__/route.test.ts
 */

// ────────────────────────────────────────────────────────────────────────────
// 0. Node/tsx runtime shims
// ────────────────────────────────────────────────────────────────────────────
//
// `src/db/index.ts` imports 'server-only' (a Next.js marker package). Under
// plain `tsx` the react-server export condition is not active, so the real
// package throws. Short-circuit it before any module that transitively
// requires it is loaded. Same pattern as cross-surface-integration.test.ts.
import { testDbPath } from '../../../../../../../lib/testing/test-db';
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
// (This must happen before the dynamic import of '@/db' inside main().)
const TEST_DB_FILE = testDbPath('execution-by-id-route');
process.env.DB_FILE_NAME = TEST_DB_FILE;

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

// ────────────────────────────────────────────────────────────────────────────
// 2. Real-module handles (populated in main() via dynamic import)
// ────────────────────────────────────────────────────────────────────────────

type RouteModule = {
  PUT: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string; execId: string }> }
  ) => Promise<NextResponse>;
  DELETE: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string; execId: string }> }
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

async function callPut(
  tradeId: string,
  execId: string,
  body: string | Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/executions/${execId}`;
  const res = await route.PUT(
    new NextRequestCtor(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tradeId, execId }) }
  );
  return { status: res.status, data: await res.json() };
}

async function callDelete(tradeId: string, execId: string): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/executions/${execId}`;
  const res = await route.DELETE(
    new NextRequestCtor(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    { params: Promise.resolve({ id: tradeId, execId }) }
  );
  return { status: res.status, data: await res.json() };
}

// ── Setup: seed/cleanup against the real migrated DB ───────────────────

function cleanup() {
  const h = requireDb().getSqliteHandle();
  h.exec('DELETE FROM trade_executions;');
  h.exec('DELETE FROM trades;');
  h.exec('DELETE FROM accounts;');
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
      maxRiskPerTradePct: null,
      defaultCommission: null,
      startingBalance: null,
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

function seedExecution(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.tradeExecutions)
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
    } as typeof schema.tradeExecutions.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.tradeExecutions).where(eq(schema.tradeExecutions.id, id)).get() as Record<string, unknown>;
}

function executionCount(tradeId: string): number {
  return requireDb().db
    .select()
    .from(schema.tradeExecutions)
    .where(eq(schema.tradeExecutions.tradeId, tradeId))
    .all().length;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Tests — each block invokes the REAL route handlers
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load the real modules AFTER the env var is set so @/db initializes
  // against TEST_DB_FILE with all migrations auto-applied.
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  const nextMod = await import('next/server');
  NextRequestCtor = nextMod.NextRequest;

  const routeMod = await import('../route');
  route = routeMod as unknown as RouteModule;

  const routePath = fileURLToPath(new URL('../route.ts', import.meta.url)).replace(`${process.cwd()}/`, '');

  console.log('\n--- Trade Execution By ID API Tests (real route handlers) ---\n');
  console.log(`  Route module: ${routePath}`);
  console.log(`  DB: ${TEST_DB_FILE} (real migrated schema)`);
  // Function source proves the imported handlers are the real route exports.
  console.log(`  PUT handler source: ${route.PUT.toString().slice(0, 64)}…`);

  // ── 1. DELETE: Rejects open trade with 422, no mutation ─────────────

  console.log('\n1. DELETE rejects an open trade with 422 and does not mutate:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open', openedAt: '2025-06-01T10:00:00Z' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });

    const result = await callDelete(trade.id as string, exec.id as string);

    assert(result.status === 422, 'returns 422');
    assertEqual(
      (result.data as { error: string }).error,
      'Execution changes are only allowed for planned trades',
      'error message explains lifecycle restriction',
    );

    // No mutation — execution must still exist and trade must be unchanged.
    assertEqual(executionCount(trade.id as string), 1, 'execution still present (no delete)');
    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status unchanged');
    assertEqual(updatedTrade.openedAt, '2025-06-01T10:00:00Z', 'trade openedAt unchanged');
  }

  // ── 2. PUT: Rejects open trade with 422, no mutation ────────────────

  console.log('\n2. PUT rejects an open trade with 422 and does not mutate:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open', openedAt: '2025-06-01T10:00:00Z' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });

    const result = await callPut(trade.id as string, exec.id as string, { quantity: 200 });

    assert(result.status === 422, 'returns 422');
    assertEqual(
      (result.data as { error: string }).error,
      'Execution changes are only allowed for planned trades',
      'error message explains lifecycle restriction',
    );

    // No mutation — execution fields and trade must be unchanged.
    const persisted = db!
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.id, exec.id as string))
      .get() as Record<string, unknown>;
    assertEqual(persisted.quantity, 100, 'execution quantity unchanged');
    assertEqual(persisted.price, 150.0, 'execution price unchanged');
    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status unchanged');
  }

  // ── 3. DELETE: Rejects closed trade with 422 (revert path closed) ───

  console.log('\n3. DELETE rejects a closed trade with 422 (legacy revert path closed):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      status: 'closed',
      openedAt: '2025-06-01T10:00:00Z',
      closedAt: '2025-06-05T14:00:00Z',
    });
    seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
    const exit = seedExecution(trade.id as string, { action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-05T14:00:00Z' });

    const result = await callDelete(trade.id as string, exit.id as string);

    assert(result.status === 422, 'returns 422');
    assertEqual(executionCount(trade.id as string), 2, 'both executions still present (no delete)');
    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'closed', 'trade status unchanged (still closed)');
  }

  // ── 4. DELETE: Planned trade -> 200, execution removed, status recalc ─

  console.log('\n4. DELETE on a planned trade returns 200, removes execution, recalcs status:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });

    const result = await callDelete(trade.id as string, exec.id as string);

    assert(result.status === 200, 'returns 200');
    assertEqual((result.data as { message: string }).message, 'Execution deleted', 'message matches');

    // Execution was removed and the trade status was recalculated from
    // the remaining executions (none) → planned, openedAt cleared.
    assertEqual(executionCount(trade.id as string), 0, 'no executions remain');
    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'planned', 'trade status recalced to planned');
    assertEqual(updatedTrade.openedAt, null, 'openedAt is null');
  }

  // ── 5. PUT: Planned trade -> 200, execution updated, status recalc ──

  console.log('\n5. PUT on a planned trade returns 200, updates execution, recalcs status:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });

    const result = await callPut(trade.id as string, exec.id as string, {
      quantity: 150,
      price: 152.0,
      notes: 'Adjusted during planning',
    });

    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.quantity, 150, 'execution quantity updated');
    assertEqual(data.price, 152.0, 'execution price updated');
    assertEqual(data.notes, 'Adjusted during planning', 'execution notes updated');

    // Status recalc: an entry execution now exists → trade is open.
    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status recalced to open');
    assertNotNull(updatedTrade.openedAt, 'openedAt set from entry execution');
  }

  // ── 6. PUT: Validation behavior preserved (400, no mutation) ────────

  console.log('\n6. PUT invalid body returns 400 without mutation:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });

    const badQuantity = await callPut(trade.id as string, exec.id as string, { quantity: 0 });
    assert(badQuantity.status === 400, 'returns 400 for non-positive quantity');
    assertEqual(
      (badQuantity.data as { error: string }).error,
      'Invalid execution data',
      'validation error shape preserved',
    );

    const badAction = await callPut(trade.id as string, exec.id as string, { action: 'not_an_action' });
    assert(badAction.status === 400, 'returns 400 for invalid action');

    const persisted = db!
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.id, exec.id as string))
      .get() as Record<string, unknown>;
    assertEqual(persisted.quantity, 100, 'execution unchanged after rejected validation');
  }

  // ── 7. DELETE: 404 for nonexistent trade ────────────────────────────

  console.log('\n7. DELETE returns 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callDelete('nonexistent-trade', 'some-exec-id');
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 8. DELETE: 404 for nonexistent execution (planned trade passes gate) ─

  console.log('\n8. DELETE returns 404 for nonexistent execution:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callDelete(trade.id as string, 'nonexistent-exec');
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Execution not found', 'error message');
  }

  // ── 9. PUT: 404 for nonexistent trade ───────────────────────────────

  console.log('\n9. PUT returns 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callPut('nonexistent-trade', 'some-exec-id', { quantity: 150 });
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 10. PUT: 404 for nonexistent execution ──────────────────────────

  console.log('\n10. PUT returns 404 for nonexistent execution:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPut(trade.id as string, 'nonexistent-exec', { quantity: 150 });
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Execution not found', 'error message');
  }

  // ── 11. Route invocation evidence — real request pipeline ───────────

  console.log('\n11. Route invocation evidence — real request pipeline:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });

    // A malformed JSON body can only fail inside the REAL handler's
    // request.json() call — a simulated function that received a parsed
    // object would never hit this path. The route catches it and returns
    // a 500 whose details expose the JSON parse error.
    const result = await callPut(trade.id as string, exec.id as string, '{this-is-not-valid-json');
    assert(result.status === 500, 'malformed JSON reaches real request.json() and returns 500');
    const data = result.data as { error: string; details: string };
    assertEqual(data.error, 'Failed to update execution', '500 body uses route error shape');
    assert(
      data.details.includes('JSON') || data.details.includes('Unexpected') || data.details.includes('token'),
      `details expose JSON parse error (got: ${String(data.details).slice(0, 80)})`,
    );

    // No mutation may have happened for the failed request.
    const persisted = db!
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.id, exec.id as string))
      .get() as Record<string, unknown>;
    assertEqual(persisted.quantity, 100, 'execution unchanged after failed request');
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

main().catch((e) => {
  console.error('route.test.ts: unexpected error', e);
  process.exit(1);
});
