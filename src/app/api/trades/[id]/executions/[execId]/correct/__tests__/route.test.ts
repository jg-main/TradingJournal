/**
 * Trade-scoped execution correction route test — REAL handler invocation
 *
 * Tests POST /api/trades/[id]/executions/[execId]/correct by invoking the
 * ACTUAL route handler exported from route.ts with mock NextRequest objects,
 * against a real migrated SQLite database (all migrations auto-applied via
 * @/db initialization). Mirrors the exact M019/S04/T03 contract:
 *
 *   - 200: non-planned fill correction through the canonical accounting flow
 *     (reversal + replacement + correction_lineage), legacy row immutable
 *   - 404: missing trade / missing accounting execution (no accounting record)
 *   - 400: zod validation failure / malformed JSON body
 *   - 409: execution already corrected / duplicate correction idempotency key
 *   - 422: FIFO allocation rejection (cross-account mirror)
 *   - source evidence: NO_ACCOUNTING_RECORD guard (defensive — the current
 *     schema makes trades.account_id NOT NULL, so the 422 no-account branch
 *     is unreachable through real inserts; the CorrectionDialog renders the
 *     "No accounting record" state inline for that case instead)
 *
 * Run: npx tsx src/app/api/trades/\[id\]/executions/\[execId\]/correct/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/\[id\]/executions/\[execId\]/correct/__tests__/route.test.ts`)
 */
/// <reference types="vitest/globals" />

// ────────────────────────────────────────────────────────────────────────────
// 0. Node/tsx runtime shims
// ────────────────────────────────────────────────────────────────────────────
//
// `src/db/index.ts` imports 'server-only' (a Next.js marker package). Under
// plain `tsx` the react-server export condition is not active, so the real
// package throws. Short-circuit it before any module that transitively
// requires it is loaded. Same pattern as the execId route test.
import { testDbPath } from '../../../../../../../../lib/testing/test-db';
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
const TEST_DB_FILE = testDbPath('trade-correction-route');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ────────────────────────────────────────────────────────────────────────────
// 1. Static imports (all safe under plain tsx)
// ────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
  POST: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string; execId: string }> }
  ) => Promise<NextResponse>;
};

let route: RouteModule | null = null;
let NextRequestCtor: typeof NextRequest | null = null;
let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => import('better-sqlite3').Database) | null = null;
let syncAndRebuildPositions: (typeof import('@/lib/positions/trade-execution-sync'))['syncAndRebuildPositions'] | null = null;
let syncKeyBuilder: ((id: string) => string) | null = null;

function requireDb() {
  if (!db || !getSqliteHandle) throw new Error('db not initialized — call main() first');
  return { db, getSqliteHandle };
}

// ── Route invocation helper (REAL handler, REAL NextRequest) ─────────

async function callCorrect(
  tradeId: string,
  execId: string,
  body: string | Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/executions/${execId}/correct`;
  const res = await route.POST(
    new NextRequestCtor(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tradeId, execId }) }
  );
  return { status: res.status, data: await res.json() };
}

// ── Setup: seed/cleanup against the real migrated DB ───────────────────

function cleanup() {
  const h = requireDb().getSqliteHandle();
  // The ledger/accounting tables are protected by migration-level immutability
  // triggers (0024/0026/0029) that block UPDATE/DELETE. Drop them for the test
  // DB so inter-case cleanup can DELETE; the correction service only INSERTs,
  // so the test flow is unaffected.
  h.exec(`
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
  `);
  h.exec('PRAGMA foreign_keys = OFF;');
  h.exec(`
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
  h.exec('PRAGMA foreign_keys = ON;');
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
      tradeCode: `TC-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      accountId: 'test-account-id',
      symbol: 'AAPL',
      direction: 'long',
      status: 'open',
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

/** Seed a trade_risk_snapshots row (what the execution engine creates on first fill). */
function seedRiskSnapshot(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.tradeRiskSnapshots)
    .values({
      id,
      tradeId,
      accountEquityAtOpen: 100000,
      initialEntryPrice: 150.0,
      initialStopPrice: 145.0,
      initialQuantity: 100,
      riskPerShare: 5.0,
      initialRiskAmount: 500.0,
      accountRiskPct: 0.5,
      createdAt: now,
      ...overrides,
    } as typeof schema.tradeRiskSnapshots.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.tradeRiskSnapshots).where(eq(schema.tradeRiskSnapshots.tradeId, tradeId)).get() as Record<string, unknown>;
}

function getRiskSnapshot(tradeId: string): Record<string, unknown> | undefined {
  return requireDb().db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, tradeId))
    .get() as Record<string, unknown> | undefined;
}

/** Read the account_performance.nav that the canonical cascade resolves first. */
function readAccountNav(accountId: string): number | null {
  const row = requireDb().getSqliteHandle()
    .prepare('SELECT nav FROM account_performance WHERE account_id = ?')
    .get(accountId) as { nav: string | null } | undefined;
  return row?.nav ? Number(row.nav) : null;
}

/** computeRiskSnapshotValues' accountRiskPct formula (null when equity <= 0). */
function expectedRiskPct(initialRiskAmount: number, equity: number | null): number | null {
  return equity != null && equity > 0 ? (initialRiskAmount / equity) * 100 : null;
}

/**
 * Mirror a legacy trade execution into accounting_executions under the
 * `trade-execution-<id>` idempotency key — the exact path the executions
 * POST uses (syncAndRebuildPositions). Returns the mirrored row.
 */
function mirrorExecution(exec: Record<string, unknown>, accountId: string, symbol: string) {
  if (!syncAndRebuildPositions) throw new Error('sync not initialized');
  const h = requireDb().getSqliteHandle();
  const result = syncAndRebuildPositions(
    h,
    {
      id: exec.id as string,
      tradeId: exec.tradeId as string,
      action: exec.action as string,
      quantity: exec.quantity as number,
      price: exec.price as number,
      fees: (exec.fees as number | null) ?? 0,
      executedAt: (exec.executedAt as string | null) ?? new Date().toISOString(),
    },
    accountId,
    symbol,
  );
  if ('error' in result) throw new Error(`mirror failed: ${result.error}`);
  return result.accountingExecution;
}

function accountingExecutionCount(accountId: string): number {
  const h = requireDb().getSqliteHandle();
  const row = h
    .prepare('SELECT COUNT(*) AS count FROM accounting_executions WHERE account_id = ?')
    .get(accountId) as { count: number };
  return row.count;
}

function correctionLineageCount(): number {
  const h = requireDb().getSqliteHandle();
  const row = h.prepare('SELECT COUNT(*) AS count FROM correction_lineage').get() as { count: number };
  return row.count;
}

// ── Valid correction body helper ───────────────────────────────────────

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: 'AAPL',
    action: 'buy',
    quantity: '150.00',
    price: '152.00',
    fees: '1.00',
    reason: 'Correcting fill quantity',
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Tests — each block invokes the REAL route handler
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Resolve the route source path for source-evidence assertions. Under tsx,
  // import.meta.url is a file: URL; under vitest it is not (jsdom base URL),
  // so fall back to the cwd-relative path — both runners share repo-root cwd.
  const routeSourcePath = (() => {
    try {
      return fileURLToPath(new URL('../route.ts', import.meta.url));
    } catch {
      return path.join(process.cwd(), 'src/app/api/trades/[id]/executions/[execId]/correct/route.ts');
    }
  })();
  // Load the real modules AFTER the env var is set so @/db initializes
  // against TEST_DB_FILE with all migrations auto-applied.
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  const nextMod = await import('next/server');
  NextRequestCtor = nextMod.NextRequest;

  const routeMod = await import('../route');
  route = routeMod as unknown as RouteModule;

  const syncMod = await import('@/lib/positions/trade-execution-sync');
  syncAndRebuildPositions = syncMod.syncAndRebuildPositions;
  syncKeyBuilder = syncMod.tradeExecutionIdempotencyKey;

  const routePath = (() => {
    try {
      // fileURLToPath only works under tsx (file: URL); vitest's jsdom base
      // URL is http://localhost, so the diagnostic falls back gracefully.
      return fileURLToPath(new URL('../route.ts', import.meta.url)).replace(`${process.cwd()}/`, '');
    } catch {
      return '../route.ts';
    }
  })();

  console.log('\n--- Trade Execution Correction API Tests (real route handlers) ---\n');
  console.log(`  Route module: ${routePath}`);
  console.log(`  DB: ${TEST_DB_FILE} (real migrated schema)`);
  console.log(`  POST handler source: ${route.POST.toString().slice(0, 64)}…`);

  // ── 1. 200: non-planned fill corrected through the accounting flow ──

  console.log('\n1. 200 — non-planned fill correction returns canonical lineage:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open', openedAt: '2025-06-01T10:00:00Z' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 2.5, executedAt: '2025-06-01T10:00:00Z' });
    const mirror = mirrorExecution(exec, 'test-account-id', 'AAPL');

    const result = await callCorrect(trade.id as string, exec.id as string, validBody());

    assert(result.status === 200, 'returns 200');
    const data = result.data as {
      success: boolean;
      correction: { id: string; originalExecutionId: string; reversalExecutionId: string; replacementExecutionId: string };
      originalExecution: { id: string; action: string; quantity: string; price: string; fees: string };
      reversalExecution: { id: string; action: string; quantity: string; price: string; fees: string; symbol: string; journalTradeId: string | null };
      replacementExecution: { id: string; action: string; quantity: string; price: string; fees: string; symbol: string; journalTradeId: string | null };
      rebuildStatus: { executionCount: number; lotCount: number; matchCount: number };
    };
    assertEqual(data.success, true, 'success flag true');
    assertEqual(data.correction.originalExecutionId, mirror.id, 'lineage points at the mirrored accounting execution');
    assertEqual(data.originalExecution.id, mirror.id, 'original execution is the mirrored row');
    assertEqual(data.reversalExecution.action, 'sell', 'reversal mirrors the original buy with the opposite action');
    assertEqual(data.reversalExecution.quantity, '100.00', 'reversal carries the original quantity');
    assertEqual(data.reversalExecution.price, '150.00', 'reversal carries the original price');
    assertEqual(data.reversalExecution.fees, '2.50', 'reversal carries the original fees');
    assertEqual(data.reversalExecution.symbol, 'AAPL', 'reversal uses the original instrument symbol');
    assertEqual(data.replacementExecution.action, 'buy', 'replacement carries the corrected action');
    assertEqual(data.replacementExecution.quantity, '150.00', 'replacement carries the corrected quantity');
    assertEqual(data.replacementExecution.price, '152.00', 'replacement carries the corrected price');
    assertEqual(data.replacementExecution.fees, '1.00', 'replacement carries the corrected fees');
    assertEqual(data.replacementExecution.symbol, 'AAPL', 'replacement uses the requested symbol');
    assertEqual(data.reversalExecution.journalTradeId, trade.id, 'reversal preserves the trade linkage (journalTradeId)');
    assertEqual(data.replacementExecution.journalTradeId, trade.id, 'replacement preserves the trade linkage (journalTradeId)');
    assertNotNull(data.rebuildStatus, 'rebuild status included (execution/lot/match counts)');

    // Persisted state: 1 original + 1 reversal + 1 replacement, one lineage row.
    assertEqual(accountingExecutionCount('test-account-id'), 3, 'three accounting executions persist (original + reversal + replacement)');
    assertEqual(correctionLineageCount(), 1, 'one correction_lineage record links the trio');

    // Legacy trade_executions row stays immutable (audit trail).
    const persistedLegacy = db!
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.id, exec.id as string))
      .get() as Record<string, unknown>;
    assertEqual(persistedLegacy.quantity, 100, 'legacy execution quantity unchanged (immutable fill)');
    assertEqual(persistedLegacy.price, 150.0, 'legacy execution price unchanged (immutable fill)');

    // Trade lifecycle recomputed from the effective (post-correction)
    // execution set: a single-entry trade stays open.
    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status stays open after correction of a single-entry trade');
    assertEqual(updatedTrade.closedAt, null, 'closedAt stays null for an open trade');
    const tl = (result.data as { tradeLifecycle: { status: string; openedAt: string | null; closedAt: string | null } }).tradeLifecycle;
    assertEqual(updatedTrade.status, tl.status, 'persisted status matches the returned tradeLifecycle');
    assertEqual(updatedTrade.openedAt, tl.openedAt, 'persisted openedAt matches the returned tradeLifecycle');
    assertEqual(updatedTrade.closedAt, tl.closedAt, 'persisted closedAt matches the returned tradeLifecycle');
  }

  // ── 2. 404: nonexistent trade ───────────────────────────────────────

  console.log('\n2. 404 — nonexistent trade:');
  {
    cleanup();
    const result = await callCorrect('nonexistent-trade', 'some-exec-id', validBody());
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 3. 404: no accounting record for the trade execution ────────────

  console.log('\n3. 404 — trade execution has no mirrored accounting record:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });
    // No mirror — the fill was never synced to accounting (sync is non-fatal).

    const result = await callCorrect(trade.id as string, exec.id as string, validBody());

    assert(result.status === 404, 'returns 404');
    const data = result.data as { error: string; details: string };
    assertEqual(data.error, 'Execution not found', 'error message');
    assert(
      data.details.includes(`trade-execution-${exec.id}`),
      `details name the idempotency key used for lookup (got: ${data.details})`,
    );
  }

  // ── 4. 400: zod validation failure ──────────────────────────────────

  console.log('\n4. 400 — invalid replacement body:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });
    mirrorExecution(exec, 'test-account-id', 'AAPL');

    const badDecimal = await callCorrect(trade.id as string, exec.id as string, validBody({ quantity: '100' }));
    assert(badDecimal.status === 400, 'non-canonical decimal quantity returns 400');
    assertEqual(
      (badDecimal.data as { error: string }).error,
      'Validation failed',
      'validation error shape preserved',
    );

    const badAction = await callCorrect(trade.id as string, exec.id as string, validBody({ action: 'not_an_action' }));
    assert(badAction.status === 400, 'invalid action returns 400');

    const badIdem = await callCorrect(trade.id as string, exec.id as string, validBody({ idempotencyKey: 'not-a-uuid' }));
    assert(badIdem.status === 400, 'non-UUID idempotency key returns 400');

    // No mutation on rejected validation.
    assertEqual(accountingExecutionCount('test-account-id'), 1, 'only the original mirror exists after rejected validation');
    assertEqual(correctionLineageCount(), 0, 'no lineage created by rejected validation');
  }

  // ── 5. 400: malformed JSON body ─────────────────────────────────────

  console.log('\n5. 400 — malformed JSON body:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });
    mirrorExecution(exec, 'test-account-id', 'AAPL');

    const result = await callCorrect(trade.id as string, exec.id as string, '{this-is-not-valid-json');

    assert(result.status === 400, 'returns 400');
    assertEqual((result.data as { error: string }).error, 'Invalid JSON body', 'error message');
    assertEqual(accountingExecutionCount('test-account-id'), 1, 'no mutation from the failed parse');
  }

  // ── 6. 409: execution already corrected ─────────────────────────────

  console.log('\n6. 409 — execution already corrected:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });
    mirrorExecution(exec, 'test-account-id', 'AAPL');

    const first = await callCorrect(trade.id as string, exec.id as string, validBody());
    assert(first.status === 200, 'first correction succeeds');

    const second = await callCorrect(trade.id as string, exec.id as string, validBody());
    assert(second.status === 409, 'second correction returns 409');
    assertEqual(
      (second.data as { error: string }).error,
      'Execution already corrected',
      'error message',
    );
    assertEqual(accountingExecutionCount('test-account-id'), 3, 'no additional executions from the rejected replay');
    assertEqual(correctionLineageCount(), 1, 'still exactly one lineage record');
  }

  // ── 7. 409: duplicate correction idempotency key ────────────────────

  console.log('\n7. 409 — duplicate correction idempotency key:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
    const exec1 = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
    const exec2 = seedExecution(trade.id as string, { action: 'buy', quantity: 50, price: 148.0, executedAt: '2025-06-02T10:00:00Z' });
    mirrorExecution(exec1, 'test-account-id', 'AAPL');
    mirrorExecution(exec2, 'test-account-id', 'AAPL');

    const sharedIdem = randomUUID();
    const first = await callCorrect(trade.id as string, exec1.id as string, validBody({ idempotencyKey: sharedIdem }));
    assert(first.status === 200, 'first correction with the key succeeds');

    const second = await callCorrect(trade.id as string, exec2.id as string, validBody({ idempotencyKey: sharedIdem }));
    assert(second.status === 409, 'reusing the idempotency key returns 409');
    assertEqual(
      (second.data as { error: string }).error,
      'Duplicate correction idempotency key',
      'error message',
    );
    assertEqual(correctionLineageCount(), 1, 'no lineage written for the rejected duplicate');
  }

  // ── 8. 422: FIFO allocation rejection (cross-account mirror) ────────

  console.log('\n8. 422 — accounting execution belongs to a different account:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    seedAccount({ id: 'other-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });
    const exec = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0 });
    // Mirror the fill under the OTHER account — the trade-execution-<id> key
    // still resolves, but the mirror is not owned by the trade's account.
    mirrorExecution(exec, 'other-account-id', 'AAPL');

    const result = await callCorrect(trade.id as string, exec.id as string, validBody());

    assert(result.status === 422, 'returns 422');
    const data = result.data as { error: string; code: string };
    assertEqual(data.error, 'FIFO allocation rejected', 'error message');
    assertEqual(data.code, 'CROSS_ACCOUNT_CORRECTION', 'domain code exposed');
    assertEqual(correctionLineageCount(), 0, 'no lineage written for the rejected correction');
  }

  // ── 9. Idempotency-key derivation matches the sync contract ─────────

  console.log('\n9. Idempotency key derivation matches trade-execution-sync:');
  {
    const execId = 'abc-123';
    assertEqual(syncKeyBuilder!(execId), `trade-execution-${execId}`, 'sync key builder produces trade-execution-<execId>');
    const routeSource = readFileSync(routeSourcePath, 'utf-8');
    assert(
      routeSource.includes('tradeExecutionIdempotencyKey(execId)') &&
        routeSource.includes("from '@/lib/positions/trade-execution-sync'"),
      'the route resolves the mirror via the shared tradeExecutionIdempotencyKey builder',
    );
  }

  // ── 10. Source evidence: NO_ACCOUNTING_RECORD guard ─────────────────

  console.log('\n10. Source evidence — NO_ACCOUNTING_RECORD guard present:');
  {
    const routeSource = readFileSync(routeSourcePath, 'utf-8');
    assert(
      routeSource.includes("if (!trade.accountId) {") &&
        routeSource.includes("code: 'NO_ACCOUNTING_RECORD'") &&
        routeSource.includes('status: 422'),
      'route guards trades without an accountId with a 422 NO_ACCOUNTING_RECORD response',
    );
    // The current schema makes trades.account_id NOT NULL, so the branch is
    // defensive; the CorrectionDialog renders "No accounting record" inline
    // for that case (covered by the correction-dialog source-contract test).
  }

  // ── 11. Lifecycle: closed trade reopens when exit fill is reduced ──

  console.log('\n11. 200 — reducing an exit fill reopens a closed trade (and clears reviewedAt):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      direction: 'long',
      status: 'closed',
      openedAt: '2025-06-01T10:00:00Z',
      closedAt: '2025-06-01T15:00:00Z',
      reviewedAt: '2025-06-02T09:00:00Z',
    });
    const entry = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    const exit = seedExecution(trade.id as string, { action: 'sell', quantity: 100, price: 160.0, fees: 1.0, executedAt: '2025-06-01T15:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'AAPL');
    mirrorExecution(exit, 'test-account-id', 'AAPL');

    const result = await callCorrect(
      trade.id as string,
      exit.id as string,
      validBody({ action: 'sell', quantity: '50.00', price: '158.00', fees: '1.00' }),
    );

    assert(result.status === 200, 'exit correction returns 200');
    const data = result.data as { tradeLifecycle: { status: string; openedAt: string | null; closedAt: string | null } };
    assertEqual(data.tradeLifecycle.status, 'open', 'tradeLifecycle reports the trade reopened');
    assertEqual(data.tradeLifecycle.closedAt, null, 'tradeLifecycle closedAt cleared on reopen');
    assertNotNull(data.tradeLifecycle.openedAt, 'tradeLifecycle keeps an openedAt');

    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade row status reopens (closed → open)');
    assertEqual(updatedTrade.closedAt, null, 'trade row closedAt cleared');
    assertEqual(updatedTrade.reviewedAt, null, 'reviewedAt cleared by the economic correction');
    assertEqual(updatedTrade.status, data.tradeLifecycle.status, 'persisted status matches tradeLifecycle');
    assertEqual(updatedTrade.openedAt, data.tradeLifecycle.openedAt, 'persisted openedAt matches tradeLifecycle');
    assertEqual(updatedTrade.closedAt, data.tradeLifecycle.closedAt, 'persisted closedAt matches tradeLifecycle');
    assertEqual(accountingExecutionCount('test-account-id'), 4, 'entry + exit + reversal + replacement persist');
  }

  // ── 12. Lifecycle: open trade recloses when partial exit is increased ──

  console.log('\n12. 200 — increasing a partial exit fill recloses an open trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      direction: 'long',
      status: 'open',
      openedAt: '2025-06-01T10:00:00Z',
    });
    const entry = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    const partialExit = seedExecution(trade.id as string, { action: 'sell', quantity: 50, price: 155.0, fees: 1.0, executedAt: '2025-06-01T12:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'AAPL');
    mirrorExecution(partialExit, 'test-account-id', 'AAPL');

    const result = await callCorrect(
      trade.id as string,
      partialExit.id as string,
      validBody({ action: 'sell', quantity: '100.00', price: '156.00', fees: '1.00' }),
    );

    assert(result.status === 200, 'partial-exit correction returns 200');
    const data = result.data as { tradeLifecycle: { status: string; openedAt: string | null; closedAt: string | null } };
    assertEqual(data.tradeLifecycle.status, 'closed', 'tradeLifecycle reports the trade recloses');
    assertNotNull(data.tradeLifecycle.closedAt, 'tradeLifecycle closedAt set on reclose');

    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'closed', 'trade row status recloses (open → closed)');
    assertNotNull(updatedTrade.closedAt, 'trade row closedAt set');
    assertEqual(updatedTrade.status, data.tradeLifecycle.status, 'persisted status matches tradeLifecycle');
    assertEqual(updatedTrade.closedAt, data.tradeLifecycle.closedAt, 'persisted closedAt matches tradeLifecycle');
  }

  // ── 13. Lifecycle: correcting the entry fill shifts openedAt ────────

  console.log('\n13. 200 — correcting an entry fill shifts openedAt to the replacement timeline:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      direction: 'long',
      status: 'open',
      openedAt: '2025-06-01T10:00:00Z',
    });
    const entry = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'AAPL');

    const result = await callCorrect(trade.id as string, entry.id as string, validBody({ quantity: '150.00', price: '152.00' }));

    assert(result.status === 200, 'entry correction returns 200');
    const data = result.data as { tradeLifecycle: { status: string; openedAt: string | null; closedAt: string | null } };
    assertEqual(data.tradeLifecycle.status, 'open', 'tradeLifecycle still open');
    assert(
      data.tradeLifecycle.openedAt !== null && data.tradeLifecycle.openedAt !== '2025-06-01T10:00:00Z',
      `openedAt moved off the original entry timestamp (got: ${data.tradeLifecycle.openedAt})`,
    );

    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.openedAt, data.tradeLifecycle.openedAt, 'persisted openedAt matches tradeLifecycle');
    assertEqual(updatedTrade.status, 'open', 'trade row stays open');
  }

  // ── 14. Lifecycle: short trade reopens when exit fill is reduced ────

  console.log('\n14. 200 — reducing a short exit fill reopens the short trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      symbol: 'TSLA',
      direction: 'short',
      status: 'closed',
      openedAt: '2025-06-01T10:00:00Z',
      closedAt: '2025-06-01T15:00:00Z',
    });
    const entry = seedExecution(trade.id as string, { action: 'sell_short', quantity: 100, price: 200.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    const exit = seedExecution(trade.id as string, { action: 'buy_to_cover', quantity: 100, price: 195.0, fees: 1.0, executedAt: '2025-06-01T15:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'TSLA');
    mirrorExecution(exit, 'test-account-id', 'TSLA');

    const result = await callCorrect(
      trade.id as string,
      exit.id as string,
      validBody({ symbol: 'TSLA', action: 'buy_to_cover', quantity: '50.00', price: '196.00', fees: '1.00' }),
    );

    assert(result.status === 200, 'short exit correction returns 200');
    const data = result.data as { tradeLifecycle: { status: string; openedAt: string | null; closedAt: string | null } };
    assertEqual(data.tradeLifecycle.status, 'open', 'tradeLifecycle reports the short trade reopened');
    assertEqual(data.tradeLifecycle.closedAt, null, 'tradeLifecycle closedAt cleared on reopen');

    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade row status reopens for the short trade');
    assertEqual(updatedTrade.closedAt, null, 'trade row closedAt cleared');
  }

  // ── 15. Risk snapshot repair: first entry price corrected ────────────

  console.log('\n15. 200 — correcting the first entry price repairs the risk snapshot:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      direction: 'long',
      status: 'open',
      openedAt: '2025-06-01T10:00:00Z',
      plannedStop: 145.0,
    });
    const entry = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'AAPL');
    seedRiskSnapshot(trade.id as string); // initialEntryPrice 150, initialStopPrice 145, initialQuantity 100, riskPerShare 5, initialRiskAmount 500

    const result = await callCorrect(trade.id as string, entry.id as string, validBody({ quantity: '100.00', price: '152.00' }));

    assert(result.status === 200, 'entry-price correction returns 200');
    const data = result.data as { riskSnapshotRepair: { repaired: boolean; reason: string; oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null } };
    assertEqual(data.riskSnapshotRepair.repaired, true, 'repair reported as performed');
    assertEqual(data.riskSnapshotRepair.reason, 'repaired', 'repair reason is repaired');

    const snapshot = getRiskSnapshot(trade.id as string)!;
    assertEqual(snapshot.initialEntryPrice, 152.0, 'initialEntryPrice updated to the corrected price (152)');
    assertEqual(snapshot.initialStopPrice, 145.0, 'initialStopPrice preserved (open-time stop, never reconstructed)');
    assertEqual(snapshot.initialQuantity, 100, 'initialQuantity unchanged (quantity not corrected)');
    assertEqual(snapshot.riskPerShare, 7.0, 'riskPerShare recomputed as |152 - 145| = 7');
    assertEqual(snapshot.initialRiskAmount, 700.0, 'initialRiskAmount recomputed as 7 × 100 = 700');
    // A2: accountEquityAtOpen is re-resolved through the shared canonical
    // execution-equity resolver at repair time. This bare test account has NO
    // canonical funding history (no opening_balance/deposit financial events)
    // and no legacy startingBalance, so equity is UNAVAILABLE (null) — the
    // repair preserves the stored value rather than fabricating a ledger
    // derivation. accountRiskPct is computed from the stored equity.
    assertEqual(snapshot.accountEquityAtOpen, 100000, 'accountEquityAtOpen preserved (equity unavailable for a bare account)');
    assertEqual(snapshot.accountEquitySource, null, 'no provenance fabricated when equity is unavailable');
    // accountRiskPct is null because computeRiskSnapshotValues received null
    // equity at repair time (equity unavailable) — the preserved stored value
    // is retained for compatibility but no new risk-to-account is derived.
    assertEqual(snapshot.accountRiskPct, null, 'accountRiskPct null when equity unavailable');
  }

  // ── 16. Risk snapshot repair: first entry quantity corrected ─────────

  console.log('\n16. 200 — correcting the first entry quantity repairs the risk snapshot:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      direction: 'long',
      status: 'open',
      openedAt: '2025-06-01T10:00:00Z',
      plannedStop: 145.0,
    });
    const entry = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'AAPL');
    seedRiskSnapshot(trade.id as string);

    const result = await callCorrect(trade.id as string, entry.id as string, validBody({ price: '150.00', quantity: '150.00' }));

    assert(result.status === 200, 'entry-quantity correction returns 200');
    const data = result.data as { riskSnapshotRepair: { repaired: boolean } };
    assertEqual(data.riskSnapshotRepair.repaired, true, 'repair reported as performed');

    const snapshot = getRiskSnapshot(trade.id as string)!;
    assertEqual(snapshot.initialQuantity, 150, 'initialQuantity updated to the corrected quantity (150)');
    assertEqual(snapshot.initialEntryPrice, 150.0, 'initialEntryPrice unchanged (price not corrected)');
    assertEqual(snapshot.riskPerShare, 5.0, 'riskPerShare unchanged (|150 - 145| = 5)');
    assertEqual(snapshot.initialRiskAmount, 750.0, 'initialRiskAmount recomputed as 5 × 150 = 750');
    const nav = readAccountNav('test-account-id');
    assertEqual(snapshot.accountRiskPct, expectedRiskPct(750, nav), 'accountRiskPct consistent with computeRiskSnapshotValues');
  }

  // ── 17. Risk snapshot untouched: non-first execution corrected ────────

  console.log('\n17. 200 — correcting a later add leaves the risk snapshot unchanged:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      direction: 'long',
      status: 'open',
      openedAt: '2025-06-01T10:00:00Z',
    });
    const entry = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    const add = seedExecution(trade.id as string, { action: 'add', quantity: 50, price: 148.0, fees: 1.0, executedAt: '2025-06-01T12:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'AAPL');
    mirrorExecution(add, 'test-account-id', 'AAPL');
    seedRiskSnapshot(trade.id as string);

    const result = await callCorrect(
      trade.id as string,
      add.id as string,
      validBody({ action: 'add', quantity: '80.00', price: '149.00' }),
    );

    assert(result.status === 200, 'add correction returns 200');
    const data = result.data as { riskSnapshotRepair: { repaired: boolean; reason: string } };
    assertEqual(data.riskSnapshotRepair.repaired, false, 'repair skipped for a non-first execution');
    assertEqual(data.riskSnapshotRepair.reason, 'first-entry-unchanged', 'skip reason is first-entry-unchanged');

    const snapshot = getRiskSnapshot(trade.id as string)!;
    assertEqual(snapshot.initialEntryPrice, 150.0, 'initialEntryPrice unchanged (first entry untouched)');
    assertEqual(snapshot.initialQuantity, 100, 'initialQuantity unchanged (first entry untouched)');
    assertEqual(snapshot.riskPerShare, 5.0, 'riskPerShare unchanged');
    assertEqual(snapshot.initialRiskAmount, 500.0, 'initialRiskAmount unchanged');
    assertEqual(snapshot.accountRiskPct, 0.5, 'accountRiskPct unchanged');
  }

  // ── 18. No risk snapshot: correction succeeds, nothing created ────────

  console.log('\n18. 200 — trade without a risk snapshot is not repaired and no snapshot is created:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      direction: 'long',
      status: 'open',
      openedAt: '2025-06-01T10:00:00Z',
    });
    const entry = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'AAPL');
    // No risk snapshot seeded — e.g. the fill was synced without the execution engine.

    const result = await callCorrect(trade.id as string, entry.id as string, validBody({ price: '152.00' }));

    assert(result.status === 200, 'correction succeeds without a risk snapshot');
    const data = result.data as { riskSnapshotRepair: { repaired: boolean; reason: string; oldValues: unknown } };
    assertEqual(data.riskSnapshotRepair.repaired, false, 'repair reported as skipped');
    assertEqual(data.riskSnapshotRepair.reason, 'no-snapshot', 'skip reason is no-snapshot');
    assertEqual(data.riskSnapshotRepair.oldValues, null, 'no old values when no snapshot exists');
    assertEqual(getRiskSnapshot(trade.id as string), undefined, 'no risk snapshot row created by the correction');
  }

  // ── 19. A8: projection failure rolls back accounting + trade state ────

  console.log('\n19. 500 — forced performance failure rolls back correction + trade state (M002-A8):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({
      accountId: 'test-account-id',
      direction: 'long',
      status: 'open',
      openedAt: '2025-06-01T10:00:00Z',
    });
    const entry = seedExecution(trade.id as string, { action: 'buy', quantity: 100, price: 150.0, fees: 1.0, executedAt: '2025-06-01T10:00:00Z' });
    mirrorExecution(entry, 'test-account-id', 'AAPL');
    seedRiskSnapshot(trade.id as string);

    // Force a REAL account-performance persistence failure inside the
    // correction (the outer trade transaction owns everything).
    const h = requireDb().getSqliteHandle();
    h.exec(`CREATE TRIGGER a8_trd_perf_fail BEFORE INSERT ON account_performance
            BEGIN SELECT RAISE(ABORT, 'a8: trade correction perf block'); END;`);
    let result;
    try {
      result = await callCorrect(trade.id as string, entry.id as string, validBody({ price: '152.00', fees: '2.00' }));
    } finally {
      h.exec('DROP TRIGGER IF EXISTS a8_trd_perf_fail;');
    }

    assertEqual(result.status, 500, '500 projection failure');
    assertEqual((result.data as { code: string }).code, 'EXECUTION_CORRECTION_PROJECTION_FAILED', 'stable code');

    // Accounting + trade state fully rolled back.
    assertEqual(correctionLineageCount(), 0, 'no correction lineage');
    assertEqual(accountingExecutionCount('test-account-id'), 1, 'only the original execution');
    const tradeRow = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(tradeRow.status, 'open', 'trade status unchanged');
    assertEqual(tradeRow.openedAt, '2025-06-01T10:00:00Z', 'openedAt unchanged');
    const snap = getRiskSnapshot(trade.id as string);
    assertEqual(snap!.initialEntryPrice, 150.0, 'initial risk snapshot unchanged');
    assertEqual(snap!.initialRiskAmount, 500.0, 'initial risk amount unchanged');
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
  test('standalone trade correction route harness (assertions run at import)', async () => {
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
