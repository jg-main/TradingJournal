/**
 * workflow-phase.test.ts
 *
 * S05/T02 — wires the derived `workflowPhase` field into the REAL
 * `GET /api/trades` (list) and `GET /api/trades/[id]` (detail) route
 * handlers and proves the derivation against a REAL migrated SQLite
 * database seeded with focused fixtures.
 *
 * Covered contract:
 *   - open trade, entry/exit executions only  → 'open'
 *   - open trade with add execution           → 'managed'
 *   - open trade with reduce execution        → 'managed'
 *   - open trade with stop adjustment         → 'managed'
 *   - open trade with target adjustment       → 'managed' (detail)
 *   - planned trade                           → 'planned'
 *   - closed trade                            → 'closed'
 *   - deleted trade                           → 'deleted'
 *   - every list row carries workflowPhase; detail carries workflowPhase
 *
 * Entry/exit actions (buy/sell/buy_to_cover/sell_short) never count as
 * management activity — only add/reduce executions, stop adjustments, and
 * target adjustments do (src/lib/workflow-phase.ts, S05/T01).
 *
 * Run: npx vitest run src/app/api/trades/__tests__/workflow-phase.test.ts
 *      (also runnable standalone via `npx tsx <file>`; registered in
 *       vitest.config.ts include so `make test-all` executes it)
 */

/// <reference types="vitest/globals" />

// ────────────────────────────────────────────────────────────────────────────
// 0. Node/tsx runtime shims
// ────────────────────────────────────────────────────────────────────────────
//
// `src/db/index.ts` imports 'server-only' (a Next.js marker package). Under
// plain `tsx` the react-server export condition is not active, so the real
// package throws. Short-circuit it before any module that transitively
// requires it is loaded. (Vitest instead resolves the 'server-only' alias
// declared in vitest.config.ts; the shim keeps the tsx path working.)
import { testDbPath } from '../../../../lib/testing/test-db';
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
const TEST_DB_FILE = testDbPath('trades-workflow-phase');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ────────────────────────────────────────────────────────────────────────────
// 1. Static imports (all safe under plain tsx)
// ────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import * as schema from '@/db/schema';
import type { WorkflowPhase } from '@/lib/workflow-phase';

// ────────────────────────────────────────────────────────────────────────────
// 2. Assertion helpers — collect pass/fail, never throw mid-category
// ────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Test database helpers (real schema via @/db + migrations)
// ────────────────────────────────────────────────────────────────────────────

let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => import('better-sqlite3').Database) | null = null;

function requireDb() {
  if (!db || !getSqliteHandle) throw new Error('db not initialized — call main() first');
  return { db, getSqliteHandle };
}

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
         AND (sql LIKE '%prevent_update%' OR sql LIKE '%prevent_delete%')`
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

const nowIso = () => new Date().toISOString();

const ACC_ID = 'acc-workflow-phase-test';

/** Seed an account row (fixed id; startingBalance feeds the equity cascade). */
function seedAccount(): void {
  requireDb().db.insert(schema.accounts).values({
    id: ACC_ID,
    name: 'Workflow Phase Test Account',
    broker: 'Paper',
    currency: 'USD',
    isActive: true,
    maxRiskPerTradePct: 2,
    defaultCommission: 1,
    startingBalance: 10000,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } as typeof schema.accounts.$inferInsert).run();
}

type TradeStatus = 'planned' | 'open' | 'closed' | 'deleted';

/** Seed a trade row; returns its id. */
function seedTrade(id: string, status: TradeStatus, overrides: Partial<typeof schema.trades.$inferInsert> = {}): void {
  requireDb().db.insert(schema.trades).values({
    id,
    tradeCode: `WF-${id}`,
    accountId: ACC_ID,
    symbol: 'AAPL',
    direction: 'long',
    status,
    openedAt: status === 'open' || status === 'closed' ? nowIso() : null,
    closedAt: status === 'closed' ? nowIso() : null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  } as typeof schema.trades.$inferInsert).run();
}

type ExecutionAction = 'buy' | 'sell' | 'buy_to_cover' | 'sell_short' | 'add' | 'reduce';

/** Seed an execution row for a trade. */
function seedExecution(tradeId: string, action: ExecutionAction, overrides: Partial<typeof schema.tradeExecutions.$inferInsert> = {}): void {
  requireDb().db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    executedAt: nowIso(),
    action,
    quantity: 100,
    price: 100,
    fees: 0,
    createdAt: nowIso(),
    ...overrides,
  } as typeof schema.tradeExecutions.$inferInsert).run();
}

/** Seed a stop adjustment row for a trade. */
function seedStopAdjustment(tradeId: string, newStop: number): void {
  requireDb().db.insert(schema.tradeStopAdjustments).values({
    id: randomUUID(),
    tradeId,
    adjustedAt: nowIso(),
    previousStop: 95,
    newStop,
    reason: 'Workflow phase test',
    createdAt: nowIso(),
  } as typeof schema.tradeStopAdjustments.$inferInsert).run();
}

/** Seed a target adjustment row for a trade. */
function seedTargetAdjustment(tradeId: string, targetIndex: number, newTarget: number): void {
  requireDb().db.insert(schema.tradeTargetAdjustments).values({
    id: randomUUID(),
    tradeId,
    targetIndex,
    adjustedAt: nowIso(),
    previousTarget: 110,
    newTarget,
    reason: 'Workflow phase test',
    createdAt: nowIso(),
  } as typeof schema.tradeTargetAdjustments.$inferInsert).run();
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Route invocation helpers (real handlers, real HTTP-ish NextRequest)
// ────────────────────────────────────────────────────────────────────────────

type ListRoute = {
  GET: (request: import('next/server').NextRequest) => Promise<import('next/server').NextResponse>;
};
type DetailRoute = {
  GET: (
    request: import('next/server').NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => Promise<import('next/server').NextResponse>;
};

let listRoute: ListRoute | null = null;
let detailRoute: DetailRoute | null = null;
let NextRequestCtor: typeof import('next/server').NextRequest | null = null;

interface ListRow {
  id: string;
  status: string;
  workflowPhase?: WorkflowPhase;
  [key: string]: unknown;
}

interface ListBody {
  data: ListRow[];
  total: number;
  [key: string]: unknown;
}

interface DetailBody {
  id: string;
  status: string;
  workflowPhase?: WorkflowPhase;
  [key: string]: unknown;
}

async function getTradesList(query = ''): Promise<{ status: number; body: ListBody }> {
  if (!listRoute || !NextRequestCtor) throw new Error('routes not initialized');
  const url = `http://localhost:3000/api/trades${query ? `?${query}` : ''}`;
  const res = await listRoute.GET(new NextRequestCtor(url));
  return { status: res.status, body: (await res.json()) as ListBody };
}

async function getTradeDetail(tradeId: string): Promise<{ status: number; body: DetailBody }> {
  if (!detailRoute || !NextRequestCtor) throw new Error('routes not initialized');
  const res = await detailRoute.GET(new NextRequestCtor(`http://localhost:3000/api/trades/${tradeId}`), {
    params: Promise.resolve({ id: tradeId }),
  });
  return { status: res.status, body: (await res.json()) as DetailBody };
}

function findListRow(body: ListBody, tradeId: string): ListRow {
  const row = body.data.find((r) => r.id === tradeId);
  if (!row) {
    throw new Error(
      `trade ${tradeId} missing from list response — got ${body.data.length} rows: ${body.data.map((r) => r.id).join(', ')}`
    );
  }
  return row;
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Test categories
// ────────────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  run: () => void | Promise<void>;
}

const categories: Category[] = [];

function registerCategory(id: string, name: string, run: () => void | Promise<void>): void {
  categories.push({ id, name, run });
}

const T_OPEN_NO_ACTIVITY = 'wf-open-plain';
const T_OPEN_ADD = 'wf-open-add';
const T_OPEN_REDUCE = 'wf-open-reduce';
const T_OPEN_STOP_ADJ = 'wf-open-stop';
const T_OPEN_TARGET_ADJ = 'wf-open-target';
const T_PLANNED = 'wf-planned';
const T_CLOSED = 'wf-closed';
const T_DELETED = 'wf-deleted';

registerCategory('wf-list', 'List surface: workflowPhase per row', async () => {
  seedAccount();
  seedTrade(T_OPEN_NO_ACTIVITY, 'open');
  seedExecution(T_OPEN_NO_ACTIVITY, 'buy'); // entry — NOT management

  seedTrade(T_OPEN_ADD, 'open');
  seedExecution(T_OPEN_ADD, 'buy');
  seedExecution(T_OPEN_ADD, 'add'); // management

  seedTrade(T_OPEN_REDUCE, 'open');
  seedExecution(T_OPEN_REDUCE, 'sell_short'); // entry for a short — NOT management
  seedExecution(T_OPEN_REDUCE, 'reduce', { quantity: 40 }); // management — partial size-down

  seedTrade(T_OPEN_STOP_ADJ, 'open');
  seedExecution(T_OPEN_STOP_ADJ, 'buy');
  seedStopAdjustment(T_OPEN_STOP_ADJ, 97);

  seedTrade(T_PLANNED, 'planned');
  seedTrade(T_CLOSED, 'closed');
  seedExecution(T_CLOSED, 'buy');
  seedExecution(T_CLOSED, 'sell');

  const res = await getTradesList();
  assert(res.status === 200, 'GET /api/trades returns 200');
  const rows = res.body.data;

  // Every row carries a workflowPhase value (no undefined / no null)
  const allCarryPhase = rows.length > 0 && rows.every((r) => typeof r.workflowPhase === 'string');
  assert(allCarryPhase, `every list row carries a string workflowPhase (${rows.length} rows)`);

  assertEqual(findListRow(res.body, T_OPEN_NO_ACTIVITY).workflowPhase, 'open', 'open trade with only an entry execution → open');
  assertEqual(findListRow(res.body, T_OPEN_ADD).workflowPhase, 'managed', 'open trade with add execution → managed');
  assertEqual(findListRow(res.body, T_OPEN_REDUCE).workflowPhase, 'managed', 'open trade with reduce execution → managed');
  assertEqual(findListRow(res.body, T_OPEN_STOP_ADJ).workflowPhase, 'managed', 'open trade with stop adjustment → managed');
  assertEqual(findListRow(res.body, T_PLANNED).workflowPhase, 'planned', 'planned trade → planned');
  assertEqual(findListRow(res.body, T_CLOSED).workflowPhase, 'closed', 'closed trade → closed');
});

registerCategory('wf-list-deleted', 'List surface: deleted trade passes through', async () => {
  seedAccount();
  seedTrade(T_DELETED, 'deleted');

  // Deleted trades are excluded from the default listing…
  const plain = await getTradesList();
  assert(plain.body.data.every((r) => r.id !== T_DELETED), 'deleted trade excluded from default listing');

  // …and reported with workflowPhase 'deleted' via the opt-in filter.
  const res = await getTradesList('status=deleted');
  assert(res.status === 200, 'GET /api/trades?status=deleted returns 200');
  assertEqual(findListRow(res.body, T_DELETED).workflowPhase, 'deleted', 'deleted trade → deleted');
});

registerCategory('wf-detail', 'Detail surface: workflowPhase present and derived', async () => {
  seedAccount();

  seedTrade(T_OPEN_TARGET_ADJ, 'open');
  seedExecution(T_OPEN_TARGET_ADJ, 'buy');
  seedTargetAdjustment(T_OPEN_TARGET_ADJ, 1, 115);

  seedTrade(T_OPEN_NO_ACTIVITY, 'open');
  seedExecution(T_OPEN_NO_ACTIVITY, 'buy');

  seedTrade(T_PLANNED, 'planned');

  const managedRes = await getTradeDetail(T_OPEN_TARGET_ADJ);
  assert(managedRes.status === 200, 'GET /api/trades/[id] returns 200 for open trade with target adjustment');
  assertEqual(managedRes.body.workflowPhase, 'managed', 'detail: open trade with target adjustment → managed');

  const openRes = await getTradeDetail(T_OPEN_NO_ACTIVITY);
  assert(openRes.status === 200, 'GET /api/trades/[id] returns 200 for plain open trade');
  assertEqual(openRes.body.workflowPhase, 'open', 'detail: open trade with only an entry execution → open');

  const plannedRes = await getTradeDetail(T_PLANNED);
  assert(plannedRes.status === 200, 'GET /api/trades/[id] returns 200 for planned trade');
  assertEqual(plannedRes.body.workflowPhase, 'planned', 'detail: planned trade → planned');
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Main
// ────────────────────────────────────────────────────────────────────────────

interface CategoryResult {
  id: string;
  ok: boolean;
  error: string | null;
}

const results: CategoryResult[] = [];

async function main(): Promise<void> {
  // Initialise the real database (migrations auto-apply to TEST_DB_FILE).
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  const nextMod = await import('next/server');
  NextRequestCtor = nextMod.NextRequest;

  const listMod = await import('../route');
  listRoute = listMod as unknown as ListRoute;
  const detailMod = await import('../[id]/route');
  detailRoute = detailMod as unknown as DetailRoute;

  console.log('━'.repeat(72));
  console.log('  S05 · T02 — workflowPhase on GET /api/trades and GET /api/trades/[id]');
  console.log(`  DB: ${TEST_DB_FILE} (real migrated schema)`);
  console.log('━'.repeat(72));
  console.log();

  for (const cat of categories) {
    resetDb();
    const started = Date.now();
    const failedBefore = failed;
    try {
      await cat.run();
      const ok = failed === failedBefore;
      results.push({ id: cat.id, ok, error: null });
      console.log(`  ${ok ? '✅' : '❌'} [${cat.id}] ${cat.name} — ${ok ? 'PASS' : 'FAIL'} (${Date.now() - started}ms)`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ id: cat.id, ok: false, error: message });
      console.error(`  ❌ [${cat.id}] ${cat.name} — FAIL (${Date.now() - started}ms)`);
      console.error(`     ${message}`);
    }
  }

  console.log();
  console.log('━'.repeat(72));
  console.log('  Summary');
  console.log('━'.repeat(72));
  for (const r of results) {
    console.log(`  ${r.id.padEnd(18)} ${r.ok ? 'PASS' : 'FAIL'}${r.error ? ` — ${r.error}` : ''}`);
  }
  console.log('─'.repeat(72));
  const totalChecks = passed + failed;
  console.log(`  ${passed}/${totalChecks} individual assertions passed`);
}

// Kick off initialization at module load so the vitest test below can await it
// and the tsx path can attach its exit handler.
const mainPromise = main();

// ────────────────────────────────────────────────────────────────────────────
// 7. Dual-mode finish
// ────────────────────────────────────────────────────────────────────────────
//
// This file is both a standalone tsx harness (Run: `npx tsx <file>`) and a
// vitest suite (registered in the include list in vitest.config.ts so
// `npx vitest run <file>` executes it). The harness assertions run during
// module import; vitest requires at least one test suite per file, so the
// pass/fail verdict is surfaced through a single test below. `test` is a
// global only inside the vitest runner (globals: true in vitest.config.ts) —
// the `typeof test` guard keeps the tsx path import-free.
if (typeof test !== 'undefined') {
  test('workflowPhase API surface (real handlers, assertions run at import)', async () => {
    await mainPromise;
    if (failed > 0) {
      throw new Error(`         ${failed}/${passed + failed} assertions FAILED`);
    }
    console.log('         All assertions passed!');
  });
} else {
  mainPromise
    .then(() => {
      if (failed > 0) {
        console.error(`         ${failed}/${passed + failed} assertions FAILED`);
        process.exit(1);
      }
      console.log('         All assertions passed!');
      process.exit(0);
    })
    .catch((e: unknown) => {
      console.error('workflow-phase.test.ts: unexpected error', e);
      process.exit(1);
    });
}
