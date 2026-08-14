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
 */

// ────────────────────────────────────────────────────────────────────────────
// 0. Node/tsx runtime shims
// ────────────────────────────────────────────────────────────────────────────
//
// `src/db/index.ts` imports 'server-only' (a Next.js marker package). Under
// plain `tsx` the react-server export condition is not active, so the real
// package throws. Short-circuit it before any module that transitively
// requires it is loaded. Same pattern as the execId route test.
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
const TEST_DB_FILE = './.test-trade-correction-route.db';
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

  const routePath = fileURLToPath(new URL('../route.ts', import.meta.url)).replace(`${process.cwd()}/`, '');

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
      reversalExecution: { id: string; action: string; quantity: string; price: string; fees: string; symbol: string };
      replacementExecution: { id: string; action: string; quantity: string; price: string; fees: string; symbol: string };
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

    // Trade status untouched by the correction.
    const updatedTrade = db!
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, trade.id as string))
      .get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status unchanged after correction');
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
    const routeSource = (await import('fs')).readFileSync(
      fileURLToPath(new URL('../route.ts', import.meta.url)),
      'utf-8',
    );
    assert(
      routeSource.includes('tradeExecutionIdempotencyKey(execId)') &&
        routeSource.includes("from '@/lib/positions/trade-execution-sync'"),
      'the route resolves the mirror via the shared tradeExecutionIdempotencyKey builder',
    );
  }

  // ── 10. Source evidence: NO_ACCOUNTING_RECORD guard ─────────────────

  console.log('\n10. Source evidence — NO_ACCOUNTING_RECORD guard present:');
  {
    const routeSource = (await import('fs')).readFileSync(
      fileURLToPath(new URL('../route.ts', import.meta.url)),
      'utf-8',
    );
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
