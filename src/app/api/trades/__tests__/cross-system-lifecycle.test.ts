#!/usr/bin/env tsx
/**
 * cross-system-lifecycle.test.ts
 *
 * M002 / S08 — Cross-system lifecycle integrity harness.
 *
 * Drives the REAL canonical execution engine (executeTradeFill) and REAL
 * route handlers against a migrated temp DB through deterministic lifecycle
 * scenarios and asserts ZERO divergence across every product surface after
 * every lifecycle step.
 *
 * Scenarios:
 *   1. Long lifecycle  — plan → entry → add → reduce → close → grade → review
 *   2. Short lifecycle — plan → entry → add → reduce → close
 *   3. Backdated fill  — entry with executedAt in the past, then a later fill
 *   4. Correction      — correct an execution through the REAL correction
 *      route; assert the trade row lifecycle is rebuilt from the effective
 *      execution set, reviewedAt is invalidated, and every surface reflects
 *      the corrected economics (journal-derived metrics and accounting
 *      surfaces must agree — the S08 divergence contract).
 *
 * Surfaces checked after every step:
 *   S1. GET /api/trades            (list rows: status/lifecycle/P&L)
 *   S2. GET /api/trades/[id]       (detail: same + full metrics)
 *   S3. GET /api/dashboard         (kpis.realizedPnl, mtm.netUnrealizedPnl)
 *   S4. GET /api/accounts/[id]/overview    (snapshot.nav/realizedPnl/unrealizedPnl)
 *   S5. GET /api/accounts/[id]/positions   (open quantity, realized net P&L)
 *   S6. GET /api/accounts/[id]/ledger      (trade_execution events per fill)
 *   S7. GET /api/accounts/[id]/performance (nav / realizedPnl / unrealizedPnl)
 *
 * Coherence contract (S08):
 *   - Trade row lifecycle fields (status/openedAt/closedAt/reviewedAt) are
 *     identical across list, detail, and the trade row itself.
 *   - Journal-derived metrics (list, detail, dashboard) agree with each other.
 *   - Accounting-derived surfaces (overview, positions, ledger, performance)
 *     agree with each other.
 *   - Journal P&L == accounting P&L for the same effective execution set
 *     (zero divergence — the core S08 assertion).
 *   - After a correction: the trade row lifecycle matches the effective-set
 *     recomputation, reviewedAt is cleared, and both journal and accounting
 *     surfaces reflect the replacement execution (documented in D016 as the
 *     trade row being the authoritative lifecycle source while the journal
 *     execution table stays immutable — the harness asserts the surfaces
 *     that display economics all agree on the corrected values).
 *
 * Run: npx tsx src/app/api/trades/__tests__/cross-system-lifecycle.test.ts
 * Registered in scripts/run-all-tests.ts (make test-all).
 */

// ────────────────────────────────────────────────────────────────────────────
// 0. Node/tsx runtime shims
// ────────────────────────────────────────────────────────────────────────────
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

const TEST_DB_FILE = testDbPath('cross-system-lifecycle');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ────────────────────────────────────────────────────────────────────────────
// 1. Static imports (all safe under plain tsx)
// ────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Database } from 'better-sqlite3';

// ── Assertion helpers ───────────────────────────────────────────────────────

let failureCount = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    failureCount += 1;
    throw new Error(`assert failed: ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    failureCount += 1;
    throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertApprox(actual: number | null | undefined, expected: number, tolerance: number, msg: string): void {
  if (actual == null || Number.isNaN(actual)) {
    failureCount += 1;
    throw new Error(`${msg} — got ${actual}, expected ~${expected}`);
  }
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    failureCount += 1;
    throw new Error(`${msg} — got ${actual}, expected ~${expected} (diff ${diff.toFixed(8)})`);
  }
}

/** Parse a canonical decimal string to a number (null-safe). */
function decToNum(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Test database helpers (real schema via @/db + migrations)
// ────────────────────────────────────────────────────────────────────────────

let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => Database) | null = null;

function requireDb() {
  if (!db || !getSqliteHandle) throw new Error('db not initialized — call main() first');
  return { db, getSqliteHandle };
}

const nowIso = () => new Date().toISOString();

interface SeedAccountOptions {
  id?: string;
  startingBalance?: number;
  maxRiskPerTradePct?: number;
  defaultCommission?: number;
}

function seedAccount(opts: SeedAccountOptions = {}): string {
  const id = opts.id ?? randomUUID();
  requireDb().db.insert(schema.accounts).values({
    id,
    name: 'Cross-System Account',
    broker: 'Paper',
    currency: 'USD',
    isActive: false, // pristine draft — the REAL initialize route activates it
    maxRiskPerTradePct: opts.maxRiskPerTradePct ?? 10,
    defaultCommission: opts.defaultCommission ?? 1,
    startingBalance: opts.startingBalance ?? 10000,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } as typeof schema.accounts.$inferInsert).run();
  return id;
}

function seedInstrument(symbol: string): string {
  const id = randomUUID();
  requireDb().db.insert(schema.instruments).values({
    id,
    symbol,
    name: symbol,
    type: 'stock',
    currency: 'USD',
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).run();
  return id;
}

/** Seed one required checklist item (exercises the first-fill gate realistically). */
function seedChecklistItem(accountId: string, description = 'Confirm risk parameters'): string {
  const id = randomUUID();
  requireDb().db.insert(schema.checklistDefinitions).values({
    id,
    accountId,
    description,
    isRequired: true,
    sortOrder: 0,
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } as typeof schema.checklistDefinitions.$inferInsert).run();
  return id;
}

/** Seed the singleton settings row (equity fallback). */
function seedSettings(startingAccountValue: number): void {
  requireDb().db.insert(schema.settings).values({
    id: 'default',
    startingAccountValue,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } as typeof schema.settings.$inferInsert).run();
}

let tradeSeq = 0;

/**
 * Deterministic fill timeline: each call returns an ISO timestamp stepping
 * 1 minute forward from a base 5 minutes ago. Fills posted through the real
 * engine default to now() (ms precision), which in a fast test run can land
 * inside the 1-2ms correction-anchor window and make the correction scenario
 * flaky. Explicit, realistically-spaced fill times keep every scenario
 * deterministic (S08 contract: deterministic lifecycles, zero divergence).
 */
function fillTimeline(): () => string {
  const base = Date.now() - 5 * 60_000;
  let cursor = 0;
  return () => {
    cursor += 60_000;
    return new Date(base + cursor).toISOString();
  };
}

interface SeedTradeOptions {
  accountId: string;
  symbol?: string;
  direction?: 'long' | 'short';
  plannedEntry?: number;
  plannedStop?: number | null;
  plannedQuantity?: number;
  status?: 'planned' | 'open' | 'closed';
  id?: string;
}

function seedTrade(opts: SeedTradeOptions): string {
  const id = opts.id ?? randomUUID();
  tradeSeq += 1;
  const now = nowIso();
  requireDb().db.insert(schema.trades).values({
    id,
    tradeCode: `XSY-${String(tradeSeq).padStart(4, '0')}`,
    accountId: opts.accountId,
    symbol: opts.symbol ?? 'AAPL',
    direction: opts.direction ?? 'long',
    status: opts.status ?? 'planned',
    plannedEntry: opts.plannedEntry ?? 100,
    plannedStop: opts.plannedStop ?? 95,
    plannedQuantity: opts.plannedQuantity ?? 10,
    createdAt: now,
    updatedAt: now,
  } as typeof schema.trades.$inferInsert).run();
  return id;
}

/** Wipe every table the fixtures touch, in FK-safe order (immutability triggers dropped + restored). */
function resetDb(): void {
  const h = requireDb().getSqliteHandle();
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
      DELETE FROM trade_check_results;
      DELETE FROM trade_risk_snapshots;
      DELETE FROM trade_grades;
      DELETE FROM trade_executions;
      DELETE FROM trades;
      DELETE FROM account_performance;
      DELETE FROM account_rollforward;
      DELETE FROM valuation_marks;
      DELETE FROM account_positions;
      DELETE FROM lot_matches;
      DELETE FROM fifo_lots;
      DELETE FROM correction_lineage;
      DELETE FROM financial_event_correction_lineage;
      DELETE FROM accounting_executions;
      DELETE FROM ledger_postings;
      DELETE FROM ledger_entries;
      DELETE FROM financial_events;
      DELETE FROM instruments;
      DELETE FROM lookup_values;
      DELETE FROM setup_definitions;
      DELETE FROM checklist_definitions;
      DELETE FROM accounts;
      DELETE FROM settings;
    `);
  } finally {
    for (const t of triggers) {
      h.exec(t.sql);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Engine driver (REAL canonical execution path)
// ────────────────────────────────────────────────────────────────────────────

import { executeTradeFill, type TradeExecutionAction } from '@/lib/trade-execution-engine';

interface EngineFillOptions {
  action: TradeExecutionAction;
  quantity: number;
  price: number;
  fees?: number;
  executedAt?: string;
  idempotencyKey?: string;
  stopPrice?: number;
  riskOverrideReason?: string;
  /** First-fill checklist results (required items must pass). */
  checkResults?: Array<{ checklistDefinitionId: string; passed: boolean }>;
}

function engineFill(tradeId: string, opts: EngineFillOptions) {
  const { db: dbHandle, getSqliteHandle: handle } = requireDb();
  return executeTradeFill(
    {
      tradeId,
      action: opts.action,
      quantity: opts.quantity,
      price: opts.price,
      fees: opts.fees ?? 0,
      executedAt: opts.executedAt,
      idempotencyKey: opts.idempotencyKey ?? randomUUID(),
      stopPrice: opts.stopPrice,
      riskOverrideReason: opts.riskOverrideReason,
      checkResults: opts.checkResults,
    },
    { db: dbHandle, sqlite: handle() },
  );
}

/** Build first-fill checklist results for every seeded required item. */
function passChecklist(accountId: string): Array<{ checklistDefinitionId: string; passed: boolean }> {
  const rows = requireDb().db
    .select()
    .from(schema.checklistDefinitions)
    .where(eq(schema.checklistDefinitions.accountId, accountId))
    .all();
  return rows.map((r) => ({ checklistDefinitionId: r.id, passed: true }));
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Route invocation helpers (REAL handlers, REAL NextRequest)
// ────────────────────────────────────────────────────────────────────────────

type NextReq = import('next/server').NextRequest;
type NextRes = import('next/server').NextResponse;

type RouteHandler = (req: NextReq, ctx?: { params: Promise<Record<string, string>> }) => Promise<NextRes>;

interface RouteModule {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  DELETE?: RouteHandler;
}

let listRoute: RouteModule | null = null;
let detailRoute: RouteModule | null = null;
let dashboardRoute: RouteModule | null = null;
let accountRoute: RouteModule | null = null;
let correctRoute: RouteModule | null = null;
let gradeRoute: RouteModule | null = null;
let reviewRoute: RouteModule | null = null;
let initializeRoute: RouteModule | null = null;
let NextRequestCtor: typeof import('next/server').NextRequest | null = null;

async function jsonOf(res: NextRes): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function getTradesList(accountId?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!listRoute || !NextRequestCtor) throw new Error('list route not initialized');
  const q = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
  const res = await listRoute.GET!(new NextRequestCtor(`http://localhost:3000/api/trades${q}`));
  return { status: res.status, body: await jsonOf(res) };
}

async function getTradeDetail(tradeId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!detailRoute || !NextRequestCtor) throw new Error('detail route not initialized');
  const res = await detailRoute.GET!(new NextRequestCtor(`http://localhost:3000/api/trades/${tradeId}`), {
    params: Promise.resolve({ id: tradeId }),
  });
  return { status: res.status, body: await jsonOf(res) };
}

async function getDashboard(accountId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!dashboardRoute || !NextRequestCtor) throw new Error('dashboard route not initialized');
  const res = await dashboardRoute.GET!(new NextRequestCtor(`http://localhost:3000/api/dashboard?accountId=${encodeURIComponent(accountId)}`));
  return { status: res.status, body: await jsonOf(res) };
}

async function getAccountSurface(accountId: string, surface: 'overview' | 'positions' | 'ledger' | 'performance'): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!accountRoute || !NextRequestCtor) throw new Error('account route not initialized');
  const res = await accountRoute.GET!(new NextRequestCtor(`http://localhost:3000/api/accounts/${accountId}/${surface}`), {
    params: Promise.resolve({ id: accountId }),
  });
  return { status: res.status, body: await jsonOf(res) };
}

async function callGrade(tradeId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!gradeRoute || !NextRequestCtor) throw new Error('grade route not initialized');
  const res = await gradeRoute.PUT!(
    new NextRequestCtor(`http://localhost:3000/api/trades/${tradeId}/grade`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        setupScore: 8, riskScore: 8, entryScore: 8, managementScore: 8, exitScore: 8, reviewScore: 8,
        followedPlan: true, ruleViolation: false, notes: 'S08 grade',
      }),
    }),
    { params: Promise.resolve({ id: tradeId }) },
  );
  return { status: res.status, body: await jsonOf(res) };
}

async function callReviewPost(tradeId: string, lesson: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!reviewRoute || !NextRequestCtor) throw new Error('review route not initialized');
  const res = await reviewRoute.POST!(
    new NextRequestCtor(`http://localhost:3000/api/trades/${tradeId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lesson, exitNotes: 'S08 exit note' }),
    }),
    { params: Promise.resolve({ id: tradeId }) },
  );
  return { status: res.status, body: await jsonOf(res) };
}

/**
 * Initialize a seeded draft account through the REAL initialize route
 * (mode opening_balance). Posts the immutable opening_balance financial
 * event so the ledger-derived NAV starts from the actual opening capital —
 * the account-performance projection is only meaningful when the opening
 * funding is part of the ledger (S08: coherent NAV across overview /
 * performance / ledger).
 */
async function initializeAccount(accountId: string, amount: number): Promise<void> {
  if (!initializeRoute || !NextRequestCtor) throw new Error('initialize route not initialized');
  const res = await initializeRoute.POST!(
    new NextRequestCtor(`http://localhost:3000/api/accounts/${accountId}/initialize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'opening_balance',
        amount: amount.toFixed(2),
        idempotencyKey: randomUUID(),
        description: 'S08 opening balance',
      }),
    }),
    { params: Promise.resolve({ id: accountId }) },
  );
  assert(res.status === 201, `initialize account ${accountId} returns 201 (got ${res.status})`);
}

interface CorrectBody {
  symbol: string;
  action: string;
  quantity: string;
  price: string;
  fees?: string;
  reason?: string;
  idempotencyKey?: string;
}

async function callCorrect(tradeId: string, execId: string, body: CorrectBody): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!correctRoute || !NextRequestCtor) throw new Error('correct route not initialized');
  const res = await correctRoute.POST!(
    new NextRequestCtor(`http://localhost:3000/api/trades/${tradeId}/executions/${execId}/correct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tradeId, execId }) },
  );
  return { status: res.status, body: await jsonOf(res) };
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Coherence assertions (the S08 contract)
// ────────────────────────────────────────────────────────────────────────────

interface SurfaceSnapshot {
  tradeRow: typeof schema.trades.$inferSelect;
  listRow: Record<string, unknown> | null;
  detail: Record<string, unknown>;
  dashboard: Record<string, unknown>;
  overview: Record<string, unknown>;
  positions: Record<string, unknown>;
  ledger: Record<string, unknown>;
  performance: Record<string, unknown>;
}

/**
 * Query every surface and assert the S08 coherence contract. Called after
 * every lifecycle step.
 *
 * @param accountId  account owning the trade
 * @param tradeId    the trade under test (single trade in the account)
 * @param label      step label for failure messages
 */
async function assertCoherent(accountId: string, tradeId: string, label: string): Promise<void> {
  const tradeRow = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get() as typeof schema.trades.$inferSelect | undefined;
  assert(!!tradeRow, `${label}: trade row exists`);

  const list = await getTradesList(accountId);
  assert(list.status === 200, `${label}: trades list returns 200 (got ${list.status})`);
  const listRows = (list.body.data as Array<Record<string, unknown>>) ?? [];
  const listRow = listRows.find((r) => r.id === tradeId) ?? null;

  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, `${label}: trade detail returns 200 (got ${detail.status})`);

  const dashboard = await getDashboard(accountId);
  assert(dashboard.status === 200, `${label}: dashboard returns 200 (got ${dashboard.status})`);

  const overview = await getAccountSurface(accountId, 'overview');
  assert(overview.status === 200, `${label}: overview returns 200 (got ${overview.status})`);
  const positions = await getAccountSurface(accountId, 'positions');
  assert(positions.status === 200, `${label}: positions returns 200 (got ${positions.status})`);
  const ledger = await getAccountSurface(accountId, 'ledger');
  assert(ledger.status === 200, `${label}: ledger returns 200 (got ${ledger.status})`);
  const performance = await getAccountSurface(accountId, 'performance');
  assert(performance.status === 200, `${label}: performance returns 200 (got ${performance.status})`);

  const snap: SurfaceSnapshot = {
    tradeRow: tradeRow!,
    listRow,
    detail: detail.body,
    dashboard: dashboard.body,
    overview: overview.body,
    positions: positions.body,
    ledger: ledger.body,
    performance: performance.body,
  };

  assertSurfaceCoherence(snap, label);
}

function assertSurfaceCoherence(s: SurfaceSnapshot, label: string): void {
  const row = s.tradeRow;

  // ── 1. Lifecycle fields identical across list, detail, trade row ──────
  if (s.listRow) {
    assertEqual(s.listRow.status as string, row.status, `${label}: list.status == trade row`);
    assertEqual(s.listRow.openedAt as string | null, row.openedAt, `${label}: list.openedAt == trade row`);
    assertEqual(s.listRow.closedAt as string | null, row.closedAt, `${label}: list.closedAt == trade row`);
    assertEqual(s.listRow.reviewedAt as string | null, row.reviewedAt, `${label}: list.reviewedAt == trade row`);
  } else {
    // Trade may be excluded from the unfiltered list only when deleted.
    assert(row.status === 'deleted', `${label}: trade present in unfiltered list unless deleted`);
  }
  assertEqual(s.detail.status as string, row.status, `${label}: detail.status == trade row`);
  assertEqual(s.detail.openedAt as string | null, row.openedAt, `${label}: detail.openedAt == trade row`);
  assertEqual(s.detail.closedAt as string | null, row.closedAt, `${label}: detail.closedAt == trade row`);
  assertEqual(s.detail.reviewedAt as string | null, row.reviewedAt, `${label}: detail.reviewedAt == trade row`);

  // ── 2. Journal-derived metrics agree (list == detail == dashboard) ─────
  const detailMetrics = s.detail.metrics as Record<string, unknown> | undefined;
  assert(!!detailMetrics, `${label}: detail has metrics`);
  const detailRealized = (detailMetrics!.realizedPnl as Record<string, unknown>).netRealizedPnl as number | null;
  const detailUnrealized = (detailMetrics!.unrealizedPnl as Record<string, unknown>).netUnrealizedPnl as number | null;

  if (s.listRow) {
    const listRealized = s.listRow.realizedPnl as number | null;
    const listUnrealized = s.listRow.unrealizedPnl as number | null;
    // Realized is a number on both surfaces (0 when nothing closed).
    assertApprox(listRealized, detailRealized ?? 0, 0.01, `${label}: list.realizedPnl == detail metrics`);
    // Unrealized is null on both when no mark exists (coherent null).
    if (listUnrealized != null || detailUnrealized != null) {
      assertApprox(listUnrealized, detailUnrealized ?? 0, 0.01, `${label}: list.unrealizedPnl == detail metrics`);
    }
  }

  // Dashboard: realized P&L aggregates CLOSED trades; MTM aggregates open.
  const kpis = s.dashboard.kpis as Record<string, unknown> | undefined;
  const mtm = s.dashboard.mtm as Record<string, unknown> | undefined;
  if (kpis) {
    const dashRealized = kpis.realizedPnl as number | null;
    if (row.status === 'closed') {
      // Single-trade account with a closed trade: dashboard realized == detail realized.
      assertApprox(dashRealized, detailRealized ?? 0, 0.01, `${label}: dashboard kpis.realizedPnl == detail metrics`);
    } else {
      // Open/reopened trade contributes zero to the closed-trade aggregate.
      assertApprox(dashRealized, 0, 0.01, `${label}: dashboard kpis.realizedPnl is 0 for a non-closed trade`);
    }
  }
  if (mtm && row.status === 'open') {
    const dashUnrealized = mtm.netUnrealizedPnl as number | null;
    if (dashUnrealized != null || detailUnrealized != null) {
      assertApprox(dashUnrealized, detailUnrealized ?? 0, 0.01, `${label}: dashboard mtm.netUnrealizedPnl == detail metrics`);
    }
  }

  // ── 3. Accounting surfaces agree with each other ──────────────────────
  const snapshot = s.overview.snapshot as Record<string, unknown> | undefined;
  assert(!!snapshot, `${label}: overview has snapshot`);
  const perfRealized = decToNum(s.performance.realizedPnl as string | null);
  const perfUnrealized = decToNum(s.performance.unrealizedPnl as string | null);
  const perfNav = decToNum(s.performance.nav as string | null);
  const ovRealized = decToNum(snapshot!.realizedPnl as string | null);
  const ovUnrealized = decToNum(snapshot!.unrealizedPnl as string | null);
  const ovNav = decToNum(snapshot!.nav as string | null);

  assertApprox(ovRealized, perfRealized ?? 0, 0.01, `${label}: overview.realizedPnl == performance.realizedPnl`);
  assertApprox(ovUnrealized, perfUnrealized ?? 0, 0.01, `${label}: overview.unrealizedPnl == performance.unrealizedPnl`);
  assertApprox(ovNav, perfNav ?? 0, 0.01, `${label}: overview.nav == performance.nav`);

  // ── 4. Position surface matches trade metrics open quantity ───────────
  const positionsArr = (s.positions.positions as Array<Record<string, unknown>>) ?? [];
  const openQty = (detailMetrics!.size as Record<string, unknown>).openQuantity as number;
  const position = positionsArr.find((p) => p.symbol === row.symbol) ?? null;
  if (openQty > 0) {
    assert(!!position, `${label}: open position present for ${row.symbol}`);
    assertApprox(decToNum(position!.quantity as string), openQty, 0.01, `${label}: positions.quantity == trade metrics openQuantity`);
  } else {
    assert(!position || decToNum(position.quantity as string) === 0, `${label}: flat position absent or zero`);
  }

  // ── 5. Ledger reflects every posted fill (trade_execution events) ─────
  const ledgerEvents = (s.ledger.events as Array<Record<string, unknown>>) ?? [];
  const execRows = requireDb().db.select().from(schema.tradeExecutions).where(eq(schema.tradeExecutions.tradeId, row.id)).all();
  const tradeExecEvents = ledgerEvents.filter((e) => e.eventType === 'trade_execution' || e.category === 'Trade');
  assert(
    tradeExecEvents.length >= execRows.length,
    `${label}: ledger has >= 1 trade_execution event per fill (${tradeExecEvents.length} events vs ${execRows.length} fills)`,
  );

  // ── 6. Journal P&L == accounting P&L (ZERO DIVERGENCE contract) ───────
  // Realized: journal (detail metrics) must equal accounting (performance).
  assertApprox(detailRealized, perfRealized ?? 0, 0.01, `${label}: journal realized P&L == accounting realized P&L`);
  // Unrealized on an open position: journal (detail metrics, fee-adjusted)
  // must equal accounting (performance valuation).
  if (row.status === 'open' && detailUnrealized != null && perfUnrealized != null) {
    assertApprox(detailUnrealized, perfUnrealized, 0.01, `${label}: journal unrealized P&L == accounting unrealized P&L`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 6. Scenarios
// ────────────────────────────────────────────────────────────────────────────

interface ScenarioResult {
  id: string;
  name: string;
  ok: boolean;
  error: string | null;
}

const results: ScenarioResult[] = [];

async function runScenario(id: string, name: string, run: () => Promise<void>): Promise<void> {
  resetDb();
  const started = Date.now();
  try {
    await run();
    results.push({ id, name, ok: true, error: null });
    console.log(`  ✅ [${id}] ${name} — PASS (${Date.now() - started}ms)`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    results.push({ id, name, ok: false, error: message });
    console.error(`  ❌ [${id}] ${name} — FAIL (${Date.now() - started}ms)`);
    console.error(`     ${message}`);
  }
}

/** Scenario 1: full long lifecycle with review. */
async function scenarioLongLifecycle(): Promise<void> {
  const accountId = seedAccount();
  seedInstrument('AAPL');
  await initializeAccount(accountId, 10000);
  seedChecklistItem(accountId);
  seedSettings(10000);
  const tradeId = seedTrade({ accountId, symbol: 'AAPL', direction: 'long', plannedEntry: 100, plannedStop: 95, plannedQuantity: 10 });

  // Step 1: entry
  const t = fillTimeline();
  const checklist = passChecklist(accountId);
  const entry = engineFill(tradeId, { action: 'buy', quantity: 10, price: 100, fees: 0, executedAt: t(), checkResults: checklist });
  assertEqual(entry.trade.status, 'open', 'entry: trade open');
  await assertCoherent(accountId, tradeId, 'long:after-entry');

  // Step 2: add
  const add = engineFill(tradeId, { action: 'add', quantity: 5, price: 102, fees: 0, executedAt: t() });
  assertEqual(add.trade.status, 'open', 'add: trade open');
  await assertCoherent(accountId, tradeId, 'long:after-add');

  // Step 3: reduce
  const reduce = engineFill(tradeId, { action: 'reduce', quantity: 3, price: 105, fees: 0, executedAt: t() });
  assertEqual(reduce.trade.status, 'open', 'reduce: trade open');
  await assertCoherent(accountId, tradeId, 'long:after-reduce');

  // Step 4: close
  const close = engineFill(tradeId, { action: 'sell', quantity: 12, price: 108, fees: 0, executedAt: t() });
  assertEqual(close.trade.status, 'closed', 'close: trade closed');
  assert(close.trade.closedAt != null, 'close: closedAt set');
  await assertCoherent(accountId, tradeId, 'long:after-close');

  // Step 5: grade + review
  const grade = await callGrade(tradeId);
  assert(grade.status === 200, `long: grade returns 200 (got ${grade.status})`);
  const review = await callReviewPost(tradeId, 'Followed the plan; exited into strength.');
  assert(review.status === 200, `long: review returns 200 (got ${review.status})`);
  await assertCoherent(accountId, tradeId, 'long:after-review');
  const rowAfter = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get()!;
  assert(rowAfter.reviewedAt != null, 'long: reviewedAt set after review');
  const detailAfter = await getTradeDetail(tradeId);
  assertEqual(detailAfter.body.workflowPhase as string, 'reviewed', 'long: workflowPhase reviewed');
}

/** Scenario 2: full short lifecycle. */
async function scenarioShortLifecycle(): Promise<void> {
  const accountId = seedAccount();
  seedInstrument('AAPL');
  await initializeAccount(accountId, 10000);
  seedChecklistItem(accountId);
  seedSettings(10000);
  const tradeId = seedTrade({ accountId, symbol: 'AAPL', direction: 'short', plannedEntry: 100, plannedStop: 105, plannedQuantity: 10 });

  const t = fillTimeline();
  const checklist = passChecklist(accountId);
  const entry = engineFill(tradeId, { action: 'sell_short', quantity: 10, price: 100, fees: 0, executedAt: t(), checkResults: checklist });
  assertEqual(entry.trade.status, 'open', 'short: trade open after entry');
  await assertCoherent(accountId, tradeId, 'short:after-entry');

  const add = engineFill(tradeId, { action: 'add', quantity: 5, price: 102, fees: 0, executedAt: t() });
  assertEqual(add.trade.status, 'open', 'short: trade open after add');
  await assertCoherent(accountId, tradeId, 'short:after-add');

  const reduce = engineFill(tradeId, { action: 'reduce', quantity: 3, price: 98, fees: 0, executedAt: t() });
  assertEqual(reduce.trade.status, 'open', 'short: trade open after reduce');
  await assertCoherent(accountId, tradeId, 'short:after-reduce');

  const close = engineFill(tradeId, { action: 'buy_to_cover', quantity: 12, price: 96, fees: 0, executedAt: t() });
  assertEqual(close.trade.status, 'closed', 'short: trade closed');
  assert(close.trade.closedAt != null, 'short: closedAt set');
  await assertCoherent(accountId, tradeId, 'short:after-close');
}

/** Scenario 3: backdated first fill — openedAt comes from the effective first fill. */
async function scenarioBackdatedFill(): Promise<void> {
  const accountId = seedAccount();
  seedInstrument('AAPL');
  await initializeAccount(accountId, 10000);
  seedChecklistItem(accountId);
  seedSettings(10000);
  const tradeId = seedTrade({ accountId, symbol: 'AAPL', direction: 'long', plannedEntry: 100, plannedStop: 95, plannedQuantity: 10 });

  const backdated = '2025-06-01T10:00:00.000Z';
  const t = fillTimeline();
  const checklist = passChecklist(accountId);
  const entry = engineFill(tradeId, { action: 'buy', quantity: 10, price: 100, fees: 0, executedAt: backdated, checkResults: checklist });
  assertEqual(entry.trade.status, 'open', 'backdate: trade open');
  assertEqual(entry.trade.openedAt as string | null, backdated, 'backdate: openedAt == effective first fill timestamp');
  await assertCoherent(accountId, tradeId, 'backdate:after-entry');

  const later = engineFill(tradeId, { action: 'add', quantity: 5, price: 103, fees: 0, executedAt: t() });
  assertEqual(later.trade.status, 'open', 'backdate: still open after later fill');
  await assertCoherent(accountId, tradeId, 'backdate:after-add');

  const close = engineFill(tradeId, { action: 'sell', quantity: 15, price: 106, fees: 0, executedAt: t() });
  assertEqual(close.trade.status, 'closed', 'backdate: trade closed');
  await assertCoherent(accountId, tradeId, 'backdate:after-close');
}

/** Scenario 4: execution correction — lifecycle rebuilt, reviewedAt invalidated, surfaces coherent. */
async function scenarioCorrection(): Promise<void> {
  const accountId = seedAccount();
  seedInstrument('AAPL');
  await initializeAccount(accountId, 10000);
  seedChecklistItem(accountId);
  seedSettings(10000);
  const tradeId = seedTrade({ accountId, symbol: 'AAPL', direction: 'long', plannedEntry: 100, plannedStop: 95, plannedQuantity: 10 });

  const t = fillTimeline();
  const checklist = passChecklist(accountId);
  const entry = engineFill(tradeId, { action: 'buy', quantity: 10, price: 100, fees: 0, executedAt: t(), checkResults: checklist });
  const close = engineFill(tradeId, { action: 'sell', quantity: 10, price: 110, fees: 0, executedAt: t() });
  assertEqual(close.trade.status, 'closed', 'correction: trade closed before correction');

  // Grade + review so we can assert reviewedAt invalidation.
  await callGrade(tradeId);
  const review = await callReviewPost(tradeId, 'Reviewed before correction.');
  assert(review.status === 200, `correction: review returns 200 (got ${review.status})`);

  // Correct the ENTRY execution: quantity 10 -> 15 @ 100 (replacement economics change).
  const correct = await callCorrect(tradeId, entry.execution.id, {
    symbol: 'AAPL',
    action: 'buy',
    quantity: '15.00',
    price: '100.00',
    fees: '0.00',
    reason: 'S08 correction: entry quantity was 10, should be 15',
    idempotencyKey: randomUUID(),
  });
  assert(correct.status === 200, `correction: correct returns 200 (got ${correct.status})`);

  // The correction route rebuilds the lifecycle from the effective set and
  // returns it as tradeLifecycle; the trade row must match it.
  const tl = correct.body.tradeLifecycle as { status: string; openedAt: string | null; closedAt: string | null };
  const rowAfter = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get()!;
  assertEqual(rowAfter.status, tl.status, 'correction: trade row status == returned tradeLifecycle');
  assertEqual(rowAfter.openedAt, tl.openedAt, 'correction: trade row openedAt == returned tradeLifecycle');
  assertEqual(rowAfter.closedAt, tl.closedAt, 'correction: trade row closedAt == returned tradeLifecycle');
  assertEqual(rowAfter.reviewedAt, null, 'correction: reviewedAt cleared (economic correction invalidates review)');

  // Every surface must agree on the corrected economics.
  await assertCoherent(accountId, tradeId, 'correction:after');

  // The replacement execution must be visible in accounting_executions with
  // the trade linkage preserved (S06 contract: reversal/replacement carry journal_trade_id).
  const h = requireDb().getSqliteHandle();
  const accountingRows = h
    .prepare(
      `SELECT id, action, quantity, journal_trade_id FROM accounting_executions WHERE journal_trade_id = ? ORDER BY posted_at ASC`,
    )
    .all(tradeId) as Array<{ id: string; action: string; quantity: string; journal_trade_id: string }>;
  // 4 rows: entry (original), exit, reversal, replacement — every one carries
  // the trade linkage (S06 contract: reversal/replacement preserve journalTradeId).
  assert(accountingRows.length === 4, `correction: 4 accounting rows (entry+exit+reversal+replacement), got ${accountingRows.length}`);
  for (const r of accountingRows) {
    assertEqual(r.journal_trade_id, tradeId, 'correction: accounting row keeps journal_trade_id');
  }
  const replacement = accountingRows.find((r) => r.action === 'buy' && r.quantity === '15.00');
  assert(!!replacement, 'correction: replacement execution present with quantity 15.00');
}

// ────────────────────────────────────────────────────────────────────────────
// 7. Main runner
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  const nextMod = await import('next/server');
  NextRequestCtor = nextMod.NextRequest;

  const listMod = await import('../route');
  listRoute = listMod as unknown as typeof listRoute;
  const detailMod = await import('../[id]/route');
  detailRoute = detailMod as unknown as typeof detailRoute;
  const dashboardMod = await import('../../dashboard/route');
  dashboardRoute = dashboardMod as unknown as typeof dashboardRoute;
  const accountOverviewMod = await import('../../accounts/[id]/overview/route');
  const accountPositionsMod = await import('../../accounts/[id]/positions/route');
  const accountLedgerMod = await import('../../accounts/[id]/ledger/route');
  const accountPerformanceMod = await import('../../accounts/[id]/performance/route');
  accountRoute = (accountOverviewMod as unknown as typeof accountRoute);
  // The four account surfaces have the same handler shape; bind the GET
  // dispatch by registering each module under a small facade.
  accountRoute = {
    GET: async (req: NextReq, ctx: { params: Promise<{ id: string }> }) => {
      const url = new URL(req.url);
      const surface = url.pathname.split('/').pop();
      const handler =
        surface === 'overview' ? accountOverviewMod.GET
        : surface === 'positions' ? accountPositionsMod.GET
        : surface === 'ledger' ? accountLedgerMod.GET
        : surface === 'performance' ? accountPerformanceMod.GET
        : undefined;
      if (!handler) throw new Error(`unknown account surface ${surface}`);
      return handler(req, ctx);
    },
  } as unknown as typeof accountRoute;

  const correctMod = await import('../[id]/executions/[execId]/correct/route');
  correctRoute = correctMod as unknown as typeof correctRoute;
  const gradeMod = await import('../[id]/grade/route');
  gradeRoute = gradeMod as unknown as typeof gradeRoute;
  const reviewMod = await import('../[id]/review/route');
  reviewRoute = reviewMod as unknown as typeof reviewRoute;
  const initializeMod = await import('../../accounts/[id]/initialize/route');
  initializeRoute = initializeMod as unknown as typeof initializeRoute;

  console.log('━'.repeat(72));
  console.log('  M002 · S08 — Cross-system lifecycle integrity');
  console.log(`  DB: ${TEST_DB_FILE} (real migrated schema)`);
  console.log('━'.repeat(72));
  console.log();

  await runScenario('long', 'Long lifecycle (entry/add/reduce/close/grade/review)', scenarioLongLifecycle);
  await runScenario('short', 'Short lifecycle (entry/add/reduce/close)', scenarioShortLifecycle);
  await runScenario('backdate', 'Backdated first fill (openedAt from effective fill)', scenarioBackdatedFill);
  await runScenario('correction', 'Execution correction (lifecycle rebuild, review invalidation, zero divergence)', scenarioCorrection);

  console.log();
  console.log('━'.repeat(72));
  console.log('  Summary');
  console.log('━'.repeat(72));
  for (const r of results) {
    console.log(`  ${r.id.padEnd(12)} ${r.name.padEnd(60)} ${r.ok ? 'PASS' : 'FAIL'}`);
  }
  console.log('─'.repeat(72));
  const passed = results.filter((r) => r.ok).length;
  console.log(`  ${passed}/${results.length} scenarios passed (failureCount=${failureCount})`);
  if (results.some((r) => !r.ok) || failureCount > 0) {
    console.error('  CROSS-SYSTEM DIVERGENCE DETECTED — see failures above.');
    console.error('─'.repeat(72));
    process.exit(1);
  }
  console.log('  Zero divergence across /trades, dashboard, overview, positions, ledger, performance.');
  console.log('━'.repeat(72));
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
