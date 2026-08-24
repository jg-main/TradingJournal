/**
 * trade review completion route test (S07/T01)
 *
 * Tests POST (mark as reviewed) and DELETE (reopen / unmark review) against
 * the REAL route handlers in src/app/api/trades/[id]/review/route.ts, plus
 * the grade-route integration (a grade upsert clears reviewedAt so the trade
 * must be re-reviewed).
 *
 * Evidence contract under test: a closed trade can only be marked reviewed
 * when a non-empty lesson (after trim) is persisted AND a tradeGrades row
 * exists for the trade. The reviewedAt marker is the durable driver of the
 * 'reviewed' workflow phase.
 *
 * Run: npx tsx src/app/api/trades/[id]/review/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/[id]/review/__tests__/route.test.ts`)
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
process.env.DB_FILE_NAME = testDbPath('review-route');

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

type ReviewRouteModule = {
  POST: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => Promise<NextResponse>;
  DELETE: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => Promise<NextResponse>;
};

type GradeRouteModule = {
  PUT: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => Promise<NextResponse>;
};

let reviewRoute: ReviewRouteModule | null = null;
let gradeRoute: GradeRouteModule | null = null;
let NextRequestCtor: typeof NextRequest | null = null;
let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => import('better-sqlite3').Database) | null = null;

function requireDb() {
  if (!db || !getSqliteHandle) throw new Error('db not initialized — call main() first');
  return { db, getSqliteHandle };
}

// ── Route invocation helpers (REAL handlers, REAL NextRequest) ─────────

async function callPost(
  tradeId: string,
  body: string | Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  if (!reviewRoute || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/review`;
  const res = await reviewRoute.POST(
    new NextRequestCtor(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tradeId }) }
  );
  return { status: res.status, data: await res.json() };
}

async function callDelete(tradeId: string): Promise<{ status: number; data: unknown }> {
  if (!reviewRoute || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/review`;
  const res = await reviewRoute.DELETE(
    new NextRequestCtor(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: tradeId }) }
  );
  return { status: res.status, data: await res.json() };
}

async function callGradePut(
  tradeId: string,
  body: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  if (!gradeRoute || !NextRequestCtor) throw new Error('grade route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/grade`;
  const res = await gradeRoute.PUT(
    new NextRequestCtor(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tradeId }) }
  );
  return { status: res.status, data: await res.json() };
}

// ── Setup: seed/cleanup against the real migrated DB ───────────────────

function cleanup() {
  const sqlite = requireDb().getSqliteHandle();
  sqlite.exec('PRAGMA foreign_keys = OFF;');
  sqlite.exec(`
    DELETE FROM watchlist_items;
    DELETE FROM trade_grades;
    DELETE FROM trades;
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
      status: 'closed',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.trades.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedGrade(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.tradeGrades)
    .values({
      id,
      tradeId,
      setupQualityScore: 8,
      riskQualityScore: 7,
      entryQualityScore: 6,
      managementQualityScore: 7,
      exitQualityScore: 8,
      reviewQualityScore: 7,
      totalScore: 43,
      gradeLabel: 'B',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.tradeGrades.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.tradeGrades).where(eq(schema.tradeGrades.id, id)).get() as Record<string, unknown>;
}

function getTradeRow(tradeId: string): Record<string, unknown> {
  const row = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!row) throw new Error(`trade ${tradeId} not found`);
  return row as Record<string, unknown>;
}

// ── Tests ──────────────────────────────────────────────────────────────

async function main() {
  const [{ POST, DELETE }, gradeMod, nextMod, dbMod, sqliteMod] = await Promise.all([
    import('@/app/api/trades/[id]/review/route'),
    import('@/app/api/trades/[id]/grade/route'),
    import('next/server'),
    import('@/db'),
    import('better-sqlite3'),
  ]);
  reviewRoute = { POST, DELETE };
  gradeRoute = { PUT: gradeMod.PUT };
  NextRequestCtor = nextMod.NextRequest;
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  // Ensure the migrated schema has the review columns before testing.
  const cols = requireDb().getSqliteHandle().prepare('PRAGMA table_info(trades)').all() as Array<{ name: string }>;
  const colNames = cols.map((c) => c.name);
  if (!colNames.includes('reviewed_at') || !colNames.includes('lesson') || !colNames.includes('exit_notes')) {
    throw new Error(`migrated trades table missing review columns: ${colNames.join(', ')}`);
  }

  console.log('\n--- Trade Review Completion API Tests ---\n');

  // ── 1. POST: 404 for nonexistent trade ──────────────────────────────

  console.log('\n1. POST returns 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callPost('nonexistent-id', { lesson: 'Lesson' });
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 2. POST: 409 for planned trade ──────────────────────────────────

  console.log('\n2. POST returns 409 for planned trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    seedGrade(trade.id as string);

    const result = await callPost(trade.id as string, { lesson: 'Lesson' });
    assert(result.status === 409, 'returns 409');
    assert((result.data as { error: string }).error.includes('Only closed trades'), 'error names the closed-only rule');
    // No mutation: reviewedAt stays null.
    assertEqual(getTradeRow(trade.id as string).reviewedAt, null, 'reviewedAt untouched after rejected POST');
  }

  // ── 3. POST: 409 for open trade ─────────────────────────────────────

  console.log('\n3. POST returns 409 for open trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
    seedGrade(trade.id as string);

    const result = await callPost(trade.id as string, { lesson: 'Lesson' });
    assert(result.status === 409, 'returns 409');
    assert((result.data as { error: string }).error.includes('Only closed trades'), 'error names the closed-only rule');
  }

  // ── 4. POST: 422 when lesson is missing (grade exists) ──────────────

  console.log('\n4. POST returns 422 when lesson is missing (grade exists):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: null });
    seedGrade(trade.id as string);

    const result = await callPost(trade.id as string, {});
    assert(result.status === 422, 'returns 422');
    const data = result.data as { error: string; missing: string[] };
    assertEqual(data.error, 'Review evidence incomplete', 'error message');
    assertEqual(JSON.stringify(data.missing), JSON.stringify(['lesson']), 'missing lists lesson');
    assertEqual(getTradeRow(trade.id as string).reviewedAt, null, 'reviewedAt not set on failed contract');
  }

  // ── 5. POST: 422 when grade is missing (lesson set) ─────────────────

  console.log('\n5. POST returns 422 when grade is missing (lesson set):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: 'Lesson' });

    const result = await callPost(trade.id as string, {});
    assert(result.status === 422, 'returns 422');
    const data = result.data as { error: string; missing: string[] };
    assertEqual(data.error, 'Review evidence incomplete', 'error message');
    assertEqual(JSON.stringify(data.missing), JSON.stringify(['grade']), 'missing lists grade');
    assertEqual(getTradeRow(trade.id as string).reviewedAt, null, 'reviewedAt not set on failed contract');
  }

  // ── 6. POST: 422 when lesson is whitespace-only (trim validation) ───

  console.log('\n6. POST returns 422 for whitespace-only lesson:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: null });
    seedGrade(trade.id as string);

    const result = await callPost(trade.id as string, { lesson: '   ' });
    assert(result.status === 422, 'returns 422');
    const data = result.data as { error: string; missing: string[] };
    assertEqual(data.error, 'Review evidence incomplete', 'error message');
    assertEqual(JSON.stringify(data.missing), JSON.stringify(['lesson']), 'whitespace-only lesson counts as missing');
    // The route persists body-provided review fields as-is (plan: "If `lesson`
    // provided: update trades.lesson to the provided value"); the evidence
    // contract gates reviewedAt on the TRIMMED value only.
    assertEqual(getTradeRow(trade.id as string).lesson, '   ', 'whitespace lesson persisted as provided; contract gates on trimmed value');
  }

  // ── 7. POST: 400 for malformed body ─────────────────────────────────

  console.log('\n7. POST returns 400 for malformed body:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed' });

    const result = await callPost(trade.id as string, { lesson: 42 });
    assert(result.status === 400, 'returns 400');
    assertEqual((result.data as { error: string }).error, 'Validation failed', 'error message');
  }

  // ── 8. POST: 200 happy path — lesson + grade sets reviewedAt ────────

  console.log('\n8. POST returns 200 and sets reviewedAt when lesson and grade exist:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: 'Wait for the retest', exitNotes: 'Exited at market open' });
    seedGrade(trade.id as string);

    const result = await callPost(trade.id as string, {});
    assert(result.status === 200, 'returns 200');
    const data = result.data as { reviewedAt: string; workflowPhase: string };
    assertNotNull(data.reviewedAt, 'response includes reviewedAt');
    assertEqual(data.workflowPhase, 'reviewed', 'response workflowPhase is reviewed');
    // Durable marker persisted.
    const row = getTradeRow(trade.id as string);
    assertEqual(row.reviewedAt, data.reviewedAt, 'reviewedAt persisted matches response');
    assertEqual(row.lesson, 'Wait for the retest', 'existing lesson preserved');
    assertEqual(row.exitNotes, 'Exited at market open', 'existing exitNotes preserved');
  }

  // ── 9. POST: lesson + exitNotes supplied in body — all three set ────

  console.log('\n9. POST with body lesson + exitNotes sets lesson, exitNotes, reviewedAt atomically:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: null, exitNotes: null });
    seedGrade(trade.id as string);

    const result = await callPost(trade.id as string, {
      lesson: 'Journal the thesis before entry',
      exitNotes: 'Chased the move; stopped at -1R',
    });
    assert(result.status === 200, 'returns 200');
    const row = getTradeRow(trade.id as string);
    assertEqual(row.lesson, 'Journal the thesis before entry', 'lesson persisted from body');
    assertEqual(row.exitNotes, 'Chased the move; stopped at -1R', 'exitNotes persisted from body');
    assertNotNull(row.reviewedAt, 'reviewedAt persisted');
    assertEqual((result.data as { workflowPhase: string }).workflowPhase, 'reviewed', 'workflowPhase is reviewed');
  }

  // ── 10. POST: partial evidence edit persists without marking reviewed ─

  console.log('\n10. POST persists exitNotes (partial evidence) but 422s without lesson:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: null, exitNotes: null });
    seedGrade(trade.id as string);

    const result = await callPost(trade.id as string, { exitNotes: 'Review pending' });
    assert(result.status === 422, 'returns 422 (lesson still missing)');
    const data = result.data as { missing: string[] };
    assertEqual(JSON.stringify(data.missing), JSON.stringify(['lesson']), 'missing lists lesson');
    const row = getTradeRow(trade.id as string);
    assertEqual(row.exitNotes, 'Review pending', 'exitNotes saved despite failed contract');
    assertEqual(row.reviewedAt, null, 'reviewedAt not set');
  }

  // ── 11. DELETE: 200 clears reviewedAt ───────────────────────────────

  console.log('\n11. DELETE returns 200 and clears reviewedAt:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: 'Lesson', reviewedAt: new Date().toISOString() });
    seedGrade(trade.id as string);

    const result = await callDelete(trade.id as string);
    assert(result.status === 200, 'returns 200');
    const data = result.data as { reviewedAt: null; workflowPhase: string };
    assertEqual(data.reviewedAt, null, 'response reviewedAt is null');
    assertEqual(data.workflowPhase, 'closed', 'response workflowPhase is closed');
    assertEqual(getTradeRow(trade.id as string).reviewedAt, null, 'reviewedAt cleared in DB');
  }

  // ── 12. DELETE: idempotent on already-unreviewed trade ──────────────

  console.log('\n12. DELETE on already-unreviewed trade is idempotent:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: 'Lesson' });

    const result = await callDelete(trade.id as string);
    assert(result.status === 200, 'returns 200');
    const data = result.data as { reviewedAt: null; workflowPhase: string };
    assertEqual(data.reviewedAt, null, 'response reviewedAt is null');
    assertEqual(data.workflowPhase, 'closed', 'workflowPhase is closed');
  }

  // ── 13. DELETE: 404 for nonexistent trade ───────────────────────────

  console.log('\n13. DELETE returns 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callDelete('nonexistent-id');
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 14. DELETE: 409 for non-closed trade ────────────────────────────

  console.log('\n14. DELETE returns 409 for open trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open', reviewedAt: null });

    const result = await callDelete(trade.id as string);
    assert(result.status === 409, 'returns 409');
    assert((result.data as { error: string }).error.includes('Only closed trades'), 'error names the closed-only rule');
  }

  // ── 15. Review reopen cycle: POST → DELETE → POST again ─────────────

  console.log('\n15. Review can be reopened and re-completed (POST → DELETE → POST):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: 'Lesson' });
    seedGrade(trade.id as string);

    const first = await callPost(trade.id as string, {});
    assert(first.status === 200, 'first POST returns 200');
    assertNotNull((first.data as { reviewedAt: string }).reviewedAt, 'reviewedAt set on first POST');

    const reopened = await callDelete(trade.id as string);
    assert(reopened.status === 200, 'DELETE returns 200');
    assertEqual(getTradeRow(trade.id as string).reviewedAt, null, 'reviewedAt cleared after reopen');

    const second = await callPost(trade.id as string, {});
    assert(second.status === 200, 'second POST returns 200 after reopen');
    assertNotNull((second.data as { reviewedAt: string }).reviewedAt, 'reviewedAt set again after reopen');
  }

  // ── 16. Grade change clears reviewedAt (grade route integration) ────

  console.log('\n16. PUT /grade clears reviewedAt after a grade change:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'closed', lesson: 'Lesson' });
    seedGrade(trade.id as string);

    // Mark reviewed first.
    const reviewed = await callPost(trade.id as string, {});
    assert(reviewed.status === 200, 'POST marks reviewed');
    assertNotNull(getTradeRow(trade.id as string).reviewedAt, 'reviewedAt set');

    // Grade upsert via the REAL grade route clears the durable marker.
    const grade = await callGradePut(trade.id as string, {
      setupScore: 9,
      riskScore: 8,
      entryScore: 8,
      managementScore: 7,
      exitScore: 9,
      reviewScore: 8,
    });
    assert(grade.status === 200, 'grade PUT returns 200');
    assertEqual(getTradeRow(trade.id as string).reviewedAt, null, 'reviewedAt cleared by grade change');
    assertEqual(getTradeRow(trade.id as string).lesson, 'Lesson', 'lesson preserved after grade change');
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
  test('standalone review route harness (assertions run at import)', async () => {
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
