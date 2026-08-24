/**
 * Trade stop-adjustments route test — REAL handler invocation
 *
 * Tests GET (list by tradeId) and POST (create with validation) by invoking
 * the ACTUAL route handlers exported from route.ts with mock NextRequest
 * objects. There are no simulated doGetStopAdjustments / doPostStopAdjustment
 * functions anymore: every case runs through the real request path
 * (params resolution → request.json() → zod validation → DB access →
 * NextResponse) against a real migrated SQLite database.
 *
 * Covers (13 original cases, adapted to real handlers):
 *   1. GET empty list (200)
 *   2. GET 404 for nonexistent trade
 *   3. GET ordering (adjustedAt DESC, createdAt/id tiebreak)
 *   4. POST create with full payload (201)
 *   5. POST create with only required fields (201, defaults)
 *   6. POST 400 for non-positive previousStop
 *   7. POST 400 for non-positive newStop
 *   8. POST 404 for nonexistent trade
 *   9. POST nullable optionals + real-contract null handling
 *  10. POST 409 planned trade (no mutation)
 *  11. POST 409 closed trade (no mutation)
 *  12. POST 409 deleted trade (no mutation)
 *  13. POST 201 still allowed for open trade
 *  14. Route invocation evidence — real request pipeline (malformed JSON → 500)
 *
 * Run: npx tsx src/app/api/trades/\[id\]/stop-adjustments/__tests__/route.test.ts
 * Also registered in scripts/run-all-tests.ts (TSX_TESTS).
 */

// ────────────────────────────────────────────────────────────────────────────
// 0. Node/tsx runtime shims
// ────────────────────────────────────────────────────────────────────────────
//
// `src/db/index.ts` imports 'server-only' (a Next.js marker package). Under
// plain `tsx` the react-server export condition is not active, so the real
// package throws. Short-circuit it before any module that transitively
// requires it is loaded. Same pattern as cross-surface-integration.test.ts.
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
// (This must happen before the dynamic import of '@/db' inside main().)
const TEST_DB_FILE = testDbPath('stop-adjustments-route');
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
  const url = `http://localhost:3000/api/trades/${tradeId}/stop-adjustments`;
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
  const url = `http://localhost:3000/api/trades/${tradeId}/stop-adjustments`;
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
  const h = requireDb().getSqliteHandle();
  h.exec('DELETE FROM trade_stop_adjustments;');
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

function seedStopAdjustment(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.tradeStopAdjustments)
    .values({
      id,
      tradeId,
      previousStop: 145.0,
      newStop: 147.0,
      adjustedAt: now,
      createdAt: now,
      ...overrides,
    } as typeof schema.tradeStopAdjustments.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.tradeStopAdjustments).where(eq(schema.tradeStopAdjustments.id, id)).get() as Record<string, unknown>;
}

function seedRiskSnapshot(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.tradeRiskSnapshots)
    .values({
      id,
      tradeId,
      initialEntryPrice: 150.0,
      initialStopPrice: 138.5,
      initialQuantity: 100,
      createdAt: now,
      ...overrides,
    } as typeof schema.tradeRiskSnapshots.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.tradeRiskSnapshots).where(eq(schema.tradeRiskSnapshots.id, id)).get() as Record<string, unknown>;
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

  console.log('\n--- Trade Stop Adjustments API Tests (real route handlers) ---\n');
  console.log(`  Route module: ${routePath}`);
  console.log(`  DB: ${TEST_DB_FILE} (real migrated schema)`);
  // Function source proves the imported handlers are the real route exports.
  console.log(`  POST handler source: ${route.POST.toString().slice(0, 64)}…`);

  // ── 1. GET: Returns empty list for trade with no adjustments ────────

  console.log('\n1. GET returns empty list for trade with no adjustments:');
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

  // ── 3. GET: Returns adjustments ordered by adjustedAt DESC (newest first) ──

  console.log('\n3. GET returns adjustments ordered by adjustedAt DESC (newest first):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const adj1 = seedStopAdjustment(trade.id as string, { previousStop: 145.0, newStop: 147.0, adjustedAt: '2025-06-01T10:00:00Z' });
    const adj2 = seedStopAdjustment(trade.id as string, { previousStop: 147.0, newStop: 149.0, adjustedAt: '2025-06-02T10:00:00Z' });

    const result = await callGet(trade.id as string);
    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>[];
    assertEqual(data.length, 2, 'returns 2 adjustments');
    assertEqual(data[0].id, adj2.id, 'first adjustment is latest (newest first)');
    assertEqual(data[1].id, adj1.id, 'second adjustment is earlier');
    assertEqual(data[0].previousStop, 147.0, 'first previousStop matches');
    assertEqual(data[0].newStop, 149.0, 'first newStop matches');
    assertEqual(data[1].previousStop, 145.0, 'second previousStop matches');
    assertEqual(data[1].newStop, 147.0, 'second newStop matches');
  }

  // ── 4. POST: Creates stop adjustment with valid data ────────────────

  console.log('\n4. POST creates stop adjustment with valid data:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    const result = await callPost(trade.id as string, {
      newStop: 147.50,
      reason: 'Trailing stop adjustment',
      ruleBased: true,
      notes: 'Adjusted after 2R move',
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.id, 'has id');
    assertEqual(data.previousStop, null, 'previousStop derived (null: no chain, no snapshot, no planned stop)');
    assertEqual(data.newStop, 147.50, 'newStop matches');
    assertEqual(data.reason, 'Trailing stop adjustment', 'reason matches');
    assertEqual(data.ruleBased, true, 'ruleBased matches');
    assertEqual(data.notes, 'Adjusted after 2R move', 'notes matches');
    assertEqual(data.tradeId, trade.id, 'tradeId matches');
    assertNotNull(data.adjustedAt, 'has adjustedAt');
    assertNotNull(data.createdAt, 'has createdAt');
  }

  // ── 5. POST: Creates stop adjustment with only required fields ────────

  console.log('\n5. POST creates stop adjustment with only required fields (newStop):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    const result = await callPost(trade.id as string, {
      newStop: 147.0,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.id, 'has id');
    assertEqual(data.newStop, 147.0, 'newStop matches');
    assertEqual(data.reason, null, 'reason defaults to null');
    assertEqual(data.ruleBased, null, 'ruleBased defaults to null');
    assertEqual(data.notes, null, 'notes defaults to null');
    assertNotNull(data.adjustedAt, 'adjustedAt defaults to now');
  }

  // ── 6. POST: previousStop is server-derived (M019) ────────────────────

  console.log('\n6. POST derives previousStop server-side (chain, snapshot, planned fallbacks):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });

    // 6a. No chain, no snapshot -> planned stop.
    const tradeA = seedTrade({ accountId: 'test-account-id', status: 'open', plannedStop: 141.0 });
    const resA = await callPost(tradeA.id as string, { newStop: 143.0 });
    assert(resA.status === 201, '6a: returns 201');
    assertEqual((resA.data as Record<string, unknown>).previousStop, 141.0, '6a: previousStop falls back to plannedStop');

    // 6b. Risk snapshot initial stop overrides planned stop.
    const tradeB = seedTrade({ accountId: 'test-account-id', status: 'open', plannedStop: 141.0 });
    seedRiskSnapshot(tradeB.id as string, { initialStopPrice: 138.5 });
    const resB = await callPost(tradeB.id as string, { newStop: 143.0 });
    assert(resB.status === 201, '6b: returns 201');
    assertEqual((resB.data as Record<string, unknown>).previousStop, 138.5, '6b: previousStop uses initial stop from risk snapshot');

    // 6c. Existing chain: latest adjustment newStop wins over snapshot.
    const tradeC = seedTrade({ accountId: 'test-account-id', status: 'open', plannedStop: 141.0 });
    seedRiskSnapshot(tradeC.id as string, { initialStopPrice: 138.5 });
    seedStopAdjustment(tradeC.id as string, { previousStop: 138.5, newStop: 144.0, adjustedAt: '2025-06-01T10:00:00Z' });
    seedStopAdjustment(tradeC.id as string, { previousStop: 144.0, newStop: 145.5, adjustedAt: '2025-06-02T10:00:00Z' });
    const resC = await callPost(tradeC.id as string, { newStop: 147.0 });
    assert(resC.status === 201, '6c: returns 201');
    assertEqual((resC.data as Record<string, unknown>).previousStop, 145.5, '6c: previousStop is the latest adjustment newStop');

    // 6d. Client-sent previousStop is ignored (stripped by zod).
    const tradeD = seedTrade({ accountId: 'test-account-id', status: 'open', plannedStop: 141.0 });
    const resD = await callPost(tradeD.id as string, { previousStop: 999.0, newStop: 143.0 });
    assert(resD.status === 201, '6d: returns 201');
    assertEqual((resD.data as Record<string, unknown>).previousStop, 141.0, '6d: client previousStop ignored, derived value used');
  }

  // ── 7. POST: Validates newStop positive ─────────────────────────────

  console.log('\n7. POST returns 400 for non-positive newStop:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const result = await callPost(trade.id as string, {
      newStop: 0,
    });

    assert(result.status === 400, 'returns 400 for zero newStop');
  }

  // ── 8. POST: 404 for nonexistent trade ──────────────────────────────

  console.log('\n8. POST returns 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callPost('nonexistent-trade', {
      newStop: 147.0,
    });
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 9. POST: Nullable optionals + real-contract null handling ───────

  console.log('\n9. POST explicit null for nullable optionals (real contract):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    // adjustedAt is `z.string().optional()` (NOT nullable) in the real
    // schema — an explicit null must be rejected by the real handler,
    // unlike the old simulation which silently defaulted it to now.
    const rejected = await callPost(trade.id as string, {
      newStop: 147.0,
      adjustedAt: null,
    });
    assert(rejected.status === 400, 'explicit null adjustedAt rejected (real zod contract)');

    // Omitting adjustedAt and passing explicit nulls for the genuinely
    // nullable fields succeeds; adjustedAt defaults to now.
    const result = await callPost(trade.id as string, {
      newStop: 147.0,
      reason: null,
      ruleBased: null,
      notes: null,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.adjustedAt, 'adjustedAt defaults to now when omitted');
    assertEqual(data.reason, null, 'reason is null');
    assertEqual(data.ruleBased, null, 'ruleBased is null');
    assertEqual(data.notes, null, 'notes is null');
  }

  // ── 10. POST: Rejects planned trade with 409 (no mutation) ────────────

  console.log('\n10. POST rejects stop adjustment for a planned trade (409):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      newStop: 147.0,
      reason: 'Should be rejected',
    });

    assert(result.status === 409, 'returns 409');
    const data = result.data as { error: string };
    assertEqual(
      data.error,
      'Stop adjustments are only allowed for open trades.',
      'error message explains lifecycle restriction',
    );
    // No mutation — the audit trail must not gain a row for a planned trade.
    const rows = db!
      .select()
      .from(schema.tradeStopAdjustments)
      .where(eq(schema.tradeStopAdjustments.tradeId, trade.id as string))
      .all();
    assertEqual(rows.length, 0, 'no adjustment row created for planned trade');
  }

  // ── 11. POST: Rejects closed trade with 409 (no mutation) ─────────────

  console.log('\n11. POST rejects stop adjustment for a closed trade (409):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed' });

    const result = await callPost(trade.id as string, {
      newStop: 147.0,
      reason: 'Should be rejected',
    });

    assert(result.status === 409, 'returns 409');
    const data = result.data as { error: string };
    assertEqual(
      data.error,
      'Stop adjustments are only allowed for open trades.',
      'error message explains lifecycle restriction',
    );
    const rows = db!
      .select()
      .from(schema.tradeStopAdjustments)
      .where(eq(schema.tradeStopAdjustments.tradeId, trade.id as string))
      .all();
    assertEqual(rows.length, 0, 'no adjustment row created for closed trade');
  }

  // ── 12. POST: Rejects deleted trade with 409 (no mutation) ────────────

  console.log('\n12. POST rejects stop adjustment for a deleted trade (409):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'deleted' });

    const result = await callPost(trade.id as string, {
      newStop: 147.0,
      reason: 'Should be rejected',
    });

    assert(result.status === 409, 'returns 409');
    const data = result.data as { error: string };
    assertEqual(
      data.error,
      'Stop adjustments are only allowed for open trades.',
      'error message explains lifecycle restriction',
    );
    const rows = db!
      .select()
      .from(schema.tradeStopAdjustments)
      .where(eq(schema.tradeStopAdjustments.tradeId, trade.id as string))
      .all();
    assertEqual(rows.length, 0, 'no adjustment row created for deleted trade');
  }

  // ── 13. POST: Open trade still creates adjustment (guard does not block) ──

  console.log('\n13. POST still allows stop adjustment for an open trade (derived previousStop):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      newStop: 148.0,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.id, 'has id');
    assertEqual(data.previousStop, 145.0, 'previousStop derived from planned stop');
    assertEqual(data.newStop, 148.0, 'newStop matches');
    assertEqual(data.tradeId, trade.id, 'tradeId matches');
  }

  // ── 14. Route invocation evidence — real request pipeline ────────────

  console.log('\n14. Route invocation evidence — real request pipeline:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    // A malformed JSON body can only fail inside the REAL handler's
    // request.json() call — a simulated function that received a parsed
    // object would never hit this path. The route catches it and returns
    // a 500 whose details expose the JSON parse error.
    const result = await callPost(trade.id as string, '{this-is-not-valid-json');
    assert(result.status === 500, 'malformed JSON reaches real request.json() and returns 500');
    const data = result.data as { error: string; details: string };
    assertEqual(data.error, 'Failed to create stop adjustment', '500 body uses route error shape');
    assert(
      data.details.includes('JSON') || data.details.includes('Unexpected') || data.details.includes('token'),
      `details expose JSON parse error (got: ${String(data.details).slice(0, 80)})`,
    );

    // No adjustment may have been written by the failed request.
    const rows = db!
      .select()
      .from(schema.tradeStopAdjustments)
      .where(eq(schema.tradeStopAdjustments.tradeId, trade.id as string))
      .all();
    assertEqual(rows.length, 0, 'no adjustment row written by failed request');
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
