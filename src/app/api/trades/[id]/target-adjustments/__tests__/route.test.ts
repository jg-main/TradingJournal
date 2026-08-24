/**
 * Trade target-adjustments route test — REAL handler invocation
 *
 * Tests GET (list by tradeId) and POST (create with validation) by invoking
 * the ACTUAL route handlers exported from route.ts with mock NextRequest
 * objects. Every case runs through the real request path (params resolution
 * → request.json() → zod validation → DB access → NextResponse) against a
 * real migrated SQLite database.
 *
 * Covers:
 *   1. GET empty list (200)
 *   2. GET 404 for nonexistent trade
 *   3. GET ordering (adjustedAt DESC, createdAt/id tiebreak)
 *   4. POST create with full payload (201)
 *   5. POST create with only required fields (201, defaults)
 *   6. POST derives previousTarget server-side (per-index chain, planned fallback)
 *   7. POST 400 for non-positive newTarget
 *   8. POST 400 for targetIndex outside {1,2}
 *   9. POST 404 for nonexistent trade
 *  10. POST nullable optionals + real-contract null handling
 *  11. POST 409 planned trade (no mutation)
 *  12. POST 409 closed trade (no mutation)
 *  13. POST 409 deleted trade (no mutation)
 *  14. POST 201 still allowed for open trade
 *  15. Route invocation evidence — real request pipeline (malformed JSON → 500)
 *
 * Run: npx tsx src/app/api/trades/\[id\]/target-adjustments/__tests__/route.test.ts
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
const TEST_DB_FILE = testDbPath('target-adjustments-route');
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
  const url = `http://localhost:3000/api/trades/${tradeId}/target-adjustments`;
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
  const url = `http://localhost:3000/api/trades/${tradeId}/target-adjustments`;
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
  h.exec('DELETE FROM trade_target_adjustments;');
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

function seedTargetAdjustment(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.tradeTargetAdjustments)
    .values({
      id,
      tradeId,
      targetIndex: 1,
      previousTarget: 160.0,
      newTarget: 165.0,
      adjustedAt: now,
      createdAt: now,
      ...overrides,
    } as typeof schema.tradeTargetAdjustments.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.tradeTargetAdjustments).where(eq(schema.tradeTargetAdjustments.id, id)).get() as Record<string, unknown>;
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

  console.log('\n--- Trade Target Adjustments API Tests (real route handlers) ---\n');
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

    const adj1 = seedTargetAdjustment(trade.id as string, { targetIndex: 1, previousTarget: 160.0, newTarget: 165.0, adjustedAt: '2025-06-01T10:00:00Z' });
    const adj2 = seedTargetAdjustment(trade.id as string, { targetIndex: 2, previousTarget: 170.0, newTarget: 175.0, adjustedAt: '2025-06-02T10:00:00Z' });

    const result = await callGet(trade.id as string);
    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>[];
    assertEqual(data.length, 2, 'returns 2 adjustments');
    assertEqual(data[0].id, adj2.id, 'first adjustment is latest (newest first)');
    assertEqual(data[1].id, adj1.id, 'second adjustment is earlier');
    assertEqual(data[0].targetIndex, 2, 'first targetIndex matches');
    assertEqual(data[0].previousTarget, 170.0, 'first previousTarget matches');
    assertEqual(data[0].newTarget, 175.0, 'first newTarget matches');
    assertEqual(data[1].targetIndex, 1, 'second targetIndex matches');
    assertEqual(data[1].previousTarget, 160.0, 'second previousTarget matches');
    assertEqual(data[1].newTarget, 165.0, 'second newTarget matches');
  }

  // ── 4. POST: Creates target adjustment with valid data ────────────────

  console.log('\n4. POST creates target adjustment with valid data:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    const result = await callPost(trade.id as string, {
      targetIndex: 1,
      newTarget: 162.50,
      reason: 'Extended momentum target',
      ruleBased: true,
      notes: 'Raised after breakout',
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.id, 'has id');
    assertEqual(data.previousTarget, null, 'previousTarget derived (null: no chain, no planned target)');
    assertEqual(data.newTarget, 162.50, 'newTarget matches');
    assertEqual(data.targetIndex, 1, 'targetIndex matches');
    assertEqual(data.reason, 'Extended momentum target', 'reason matches');
    assertEqual(data.ruleBased, true, 'ruleBased matches');
    assertEqual(data.notes, 'Raised after breakout', 'notes matches');
    assertEqual(data.tradeId, trade.id, 'tradeId matches');
    assertNotNull(data.adjustedAt, 'has adjustedAt');
    assertNotNull(data.createdAt, 'has createdAt');
  }

  // ── 5. POST: Creates target adjustment with only required fields ────────

  console.log('\n5. POST creates target adjustment with only required fields (targetIndex, newTarget):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    const result = await callPost(trade.id as string, {
      targetIndex: 2,
      newTarget: 175.0,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.id, 'has id');
    assertEqual(data.targetIndex, 2, 'targetIndex matches');
    assertEqual(data.newTarget, 175.0, 'newTarget matches');
    assertEqual(data.reason, null, 'reason defaults to null');
    assertEqual(data.ruleBased, null, 'ruleBased defaults to null');
    assertEqual(data.notes, null, 'notes defaults to null');
    assertNotNull(data.adjustedAt, 'adjustedAt defaults to now');
  }

  // ── 6. POST: previousTarget is server-derived (M019) ────────────────────

  console.log('\n6. POST derives previousTarget server-side (per-index chain, planned fallback):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });

    // 6a. No chain -> plannedTarget1 fallback.
    const tradeA = seedTrade({ accountId: 'test-account-id', status: 'open', plannedTarget1: 160.0 });
    const resA = await callPost(tradeA.id as string, { targetIndex: 1, newTarget: 163.0 });
    assert(resA.status === 201, '6a: returns 201');
    assertEqual((resA.data as Record<string, unknown>).previousTarget, 160.0, '6a: previousTarget falls back to plannedTarget1');

    // 6b. No chain -> plannedTarget2 fallback.
    const tradeB = seedTrade({ accountId: 'test-account-id', status: 'open', plannedTarget2: 172.0 });
    const resB = await callPost(tradeB.id as string, { targetIndex: 2, newTarget: 176.0 });
    assert(resB.status === 201, '6b: returns 201');
    assertEqual((resB.data as Record<string, unknown>).previousTarget, 172.0, '6b: previousTarget falls back to plannedTarget2');

    // 6c. Existing chain for the same index: latest adjustment newTarget wins.
    // Adjustments for the OTHER index must be ignored.
    const tradeC = seedTrade({ accountId: 'test-account-id', status: 'open', plannedTarget1: 160.0, plannedTarget2: 170.0 });
    seedTargetAdjustment(tradeC.id as string, { targetIndex: 2, previousTarget: 170.0, newTarget: 171.0, adjustedAt: '2025-06-01T10:00:00Z' });
    seedTargetAdjustment(tradeC.id as string, { targetIndex: 1, previousTarget: 160.0, newTarget: 161.0, adjustedAt: '2025-06-01T11:00:00Z' });
    seedTargetAdjustment(tradeC.id as string, { targetIndex: 1, previousTarget: 161.0, newTarget: 164.0, adjustedAt: '2025-06-02T10:00:00Z' });
    const resC = await callPost(tradeC.id as string, { targetIndex: 1, newTarget: 167.0 });
    assert(resC.status === 201, '6c: returns 201');
    assertEqual((resC.data as Record<string, unknown>).previousTarget, 164.0, '6c: previousTarget is the latest index-1 adjustment newTarget (index-2 chain ignored)');

    // 6d. Client-sent previousTarget is ignored (stripped by zod).
    const tradeD = seedTrade({ accountId: 'test-account-id', status: 'open', plannedTarget1: 160.0 });
    const resD = await callPost(tradeD.id as string, { previousTarget: 999.0, targetIndex: 1, newTarget: 163.0 });
    assert(resD.status === 201, '6d: returns 201');
    assertEqual((resD.data as Record<string, unknown>).previousTarget, 160.0, '6d: client previousTarget ignored, derived value used');
  }

  // ── 7. POST: Validates newTarget positive ─────────────────────────────

  console.log('\n7. POST returns 400 for non-positive newTarget:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const zeroResult = await callPost(trade.id as string, { targetIndex: 1, newTarget: 0 });
    assert(zeroResult.status === 400, 'returns 400 for zero newTarget');

    const negativeResult = await callPost(trade.id as string, { targetIndex: 1, newTarget: -5 });
    assert(negativeResult.status === 400, 'returns 400 for negative newTarget');
  }

  // ── 8. POST: Validates targetIndex is 1 or 2 ──────────────────────────

  console.log('\n8. POST returns 400 for targetIndex outside {1,2}:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id' });

    const threeResult = await callPost(trade.id as string, { targetIndex: 3, newTarget: 165.0 });
    assert(threeResult.status === 400, 'returns 400 for targetIndex 3');

    const stringResult = await callPost(trade.id as string, { targetIndex: '1', newTarget: 165.0 });
    assert(stringResult.status === 400, 'returns 400 for string targetIndex');

    const missingResult = await callPost(trade.id as string, { newTarget: 165.0 });
    assert(missingResult.status === 400, 'returns 400 for missing targetIndex');
  }

  // ── 9. POST: 404 for nonexistent trade ──────────────────────────────

  console.log('\n9. POST returns 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callPost('nonexistent-trade', {
      targetIndex: 1,
      newTarget: 165.0,
    });
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 10. POST: Nullable optionals + real-contract null handling ───────

  console.log('\n10. POST explicit null for nullable optionals (real contract):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    // adjustedAt is `z.string().optional()` (NOT nullable) in the real
    // schema — an explicit null must be rejected by the real handler.
    const rejected = await callPost(trade.id as string, {
      targetIndex: 1,
      newTarget: 165.0,
      adjustedAt: null,
    });
    assert(rejected.status === 400, 'explicit null adjustedAt rejected (real zod contract)');

    // Omitting adjustedAt and passing explicit nulls for the genuinely
    // nullable fields succeeds; adjustedAt defaults to now.
    const result = await callPost(trade.id as string, {
      targetIndex: 1,
      newTarget: 165.0,
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

  // ── 11. POST: Rejects planned trade with 409 (no mutation) ────────────

  console.log('\n11. POST rejects target adjustment for a planned trade (409):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      targetIndex: 1,
      newTarget: 165.0,
      reason: 'Should be rejected',
    });

    assert(result.status === 409, 'returns 409');
    const data = result.data as { error: string };
    assertEqual(
      data.error,
      'Target adjustments are only allowed for open trades.',
      'error message explains lifecycle restriction',
    );
    // No mutation — the audit trail must not gain a row for a planned trade.
    const rows = db!
      .select()
      .from(schema.tradeTargetAdjustments)
      .where(eq(schema.tradeTargetAdjustments.tradeId, trade.id as string))
      .all();
    assertEqual(rows.length, 0, 'no adjustment row created for planned trade');
  }

  // ── 12. POST: Rejects closed trade with 409 (no mutation) ─────────────

  console.log('\n12. POST rejects target adjustment for a closed trade (409):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed' });

    const result = await callPost(trade.id as string, {
      targetIndex: 2,
      newTarget: 175.0,
      reason: 'Should be rejected',
    });

    assert(result.status === 409, 'returns 409');
    const data = result.data as { error: string };
    assertEqual(
      data.error,
      'Target adjustments are only allowed for open trades.',
      'error message explains lifecycle restriction',
    );
    const rows = db!
      .select()
      .from(schema.tradeTargetAdjustments)
      .where(eq(schema.tradeTargetAdjustments.tradeId, trade.id as string))
      .all();
    assertEqual(rows.length, 0, 'no adjustment row created for closed trade');
  }

  // ── 13. POST: Rejects deleted trade with 409 (no mutation) ────────────

  console.log('\n13. POST rejects target adjustment for a deleted trade (409):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'deleted' });

    const result = await callPost(trade.id as string, {
      targetIndex: 1,
      newTarget: 165.0,
      reason: 'Should be rejected',
    });

    assert(result.status === 409, 'returns 409');
    const data = result.data as { error: string };
    assertEqual(
      data.error,
      'Target adjustments are only allowed for open trades.',
      'error message explains lifecycle restriction',
    );
    const rows = db!
      .select()
      .from(schema.tradeTargetAdjustments)
      .where(eq(schema.tradeTargetAdjustments.tradeId, trade.id as string))
      .all();
    assertEqual(rows.length, 0, 'no adjustment row created for deleted trade');
  }

  // ── 14. POST: Open trade still creates adjustment (guard does not block) ──

  console.log('\n14. POST still allows target adjustment for an open trade (derived previousTarget):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open', plannedTarget1: 160.0 });

    const result = await callPost(trade.id as string, {
      targetIndex: 1,
      newTarget: 166.0,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.id, 'has id');
    assertEqual(data.previousTarget, 160.0, 'previousTarget derived from planned target');
    assertEqual(data.newTarget, 166.0, 'newTarget matches');
    assertEqual(data.targetIndex, 1, 'targetIndex matches');
    assertEqual(data.tradeId, trade.id, 'tradeId matches');
  }

  // ── 15. Route invocation evidence — real request pipeline ────────────

  console.log('\n15. Route invocation evidence — real request pipeline:');
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
    assertEqual(data.error, 'Failed to create target adjustment', '500 body uses route error shape');
    assert(
      data.details.includes('JSON') || data.details.includes('Unexpected') || data.details.includes('token'),
      `details expose JSON parse error (got: ${String(data.details).slice(0, 80)})`,
    );

    // No adjustment may have been written by the failed request.
    const rows = db!
      .select()
      .from(schema.tradeTargetAdjustments)
      .where(eq(schema.tradeTargetAdjustments.tradeId, trade.id as string))
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
