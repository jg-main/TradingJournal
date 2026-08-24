/**
 * cross-surface-integration.test.ts
 *
 * M010 / S07 — Cross-surface integration tests (audit Section 15).
 *
 * Executable documentation of the M010 contract. Exercises the REAL
 * `GET /api/trades` (list) and `GET /api/trades/[id]` (detail) route
 * handlers against a REAL migrated SQLite database seeded with
 * comprehensive fixtures (accounts, account_performance, instruments,
 * trades, executions, stop adjustments, risk snapshots, valuation marks,
 * lookup values).
 *
 * Audit Section 15 categories (all 10):
 *   1.  Percentage integration      — decimal fractions + formatPercent display
 *   2.  Stop propagation            — activeStop/initialStop identical across surfaces
 *   3.  Stop ordering               — latest adjustedAt, tiebreak createdAt then id
 *   4.  Scale-in                    — initial stop exact after additional fills
 *   5.  Partial exit                — FIFO cost basis + realized/unrealized P&L
 *   6.  Cross-surface reconciliation — list ≡ detail ≡ kernel for the same trade
 *   7.  Friendly names              — accountName/sectorName, not UUIDs  (T02)
 *   8.  NAV consistency             — riskToAccount uses account_performance.nav (T02)
 *   9.  Short position risk         — activeStop/openRisk for shorts      (T02)
 *   10. Missing mark                — open trade without mark → null P&L  (T02)
 *
 * T01 registers categories 1–6. T02 appends categories 7–10 and registers
 * this file in scripts/run-all-tests.ts.
 *
 * Run: npx tsx src/app/api/trades/__tests__/cross-surface-integration.test.ts
 */

// ────────────────────────────────────────────────────────────────────────────
// 0. Node/tsx runtime shims
// ────────────────────────────────────────────────────────────────────────────
//
// `src/db/index.ts` imports 'server-only' (a Next.js marker package). Under
// plain `tsx` the react-server export condition is not active, so the real
// package throws. Short-circuit it before any module that transitively
// requires it is loaded.
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
const TEST_DB_FILE = testDbPath('cross-surface');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ────────────────────────────────────────────────────────────────────────────
// 1. Static imports (all safe under plain tsx)
// ────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { formatPercent } from '@/lib/trade-formatters';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput, TradeMetricsResult } from '@/lib/trade-metrics';

// ────────────────────────────────────────────────────────────────────────────
// 2. Assertion helpers — throw on failure with expected-vs-actual diffs
// ────────────────────────────────────────────────────────────────────────────

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`assert failed: ${msg}`);
}

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertApprox(
  actual: number | null | undefined,
  expected: number,
  tolerance: number,
  msg: string
): void {
  if (actual == null || Number.isNaN(actual)) {
    throw new Error(`${msg} — got ${actual}, expected ~${expected}`);
  }
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${msg} — got ${actual}, expected ~${expected} (diff ${diff.toFixed(8)})`);
  }
}

/** Recursive deep-equality (floats compared within 1e-9 tolerance). */
function assertDeepEqual(actual: unknown, expected: unknown, path: string): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Math.abs(actual - expected) > 1e-9) {
      throw new Error(`${path} — expected ${expected}, got ${actual} (diff ${Math.abs(actual - expected)})`);
    }
    return;
  }
  if (typeof actual === 'object' && actual !== null && typeof expected === 'object' && expected !== null) {
    const aKeys = Object.keys(actual as Record<string, unknown>).sort();
    const eKeys = Object.keys(expected as Record<string, unknown>).sort();
    assert(JSON.stringify(aKeys) === JSON.stringify(eKeys), `${path} — key mismatch: [${aKeys}] vs [${eKeys}]`);
    for (const key of aKeys) {
      assertDeepEqual(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`
      );
    }
    return;
  }
  assertEqual(actual, expected, path);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Category registry + runner
// ────────────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  /** Audit §15 category name. */
  name: string;
  run: () => void | Promise<void>;
}

const categories: Category[] = [];

/** Register an audit §15 category. T01 registers 1–6; T02 appends 7–10. */
function registerCategory(id: string, name: string, run: () => void | Promise<void>): void {
  categories.push({ id, name, run });
}

interface CategoryResult {
  id: string;
  name: string;
  ok: boolean;
  error: string | null;
}

const results: CategoryResult[] = [];

// ────────────────────────────────────────────────────────────────────────────
// 4. Test database helpers (real schema via @/db + migrations)
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

/** Seed an account row; returns its id (fixed id for readable assertions). */
function seedAccount(id: string, overrides: Partial<typeof schema.accounts.$inferInsert> = {}): void {
  requireDb().db.insert(schema.accounts).values({
    id,
    name: 'Integration Test Account',
    broker: 'Paper',
    currency: 'USD',
    isActive: true,
    maxRiskPerTradePct: 2,
    defaultCommission: 1,
    startingBalance: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  } as typeof schema.accounts.$inferInsert).run();
}

/** Seed an account_performance row with a TEXT nav value (authoritative NAV). */
/** M002-A9: seed canonical funding (opening_balance financial event) so the
 *  seeded NAV is the canonical current_projection through the shared equity
 *  resolver (a derived projection alone is NOT canonical funding evidence). */
function seedCanonicalOpening(accountId: string, amount = 10000): void {
  requireDb().db.insert(schema.financialEvents).values({
    id: randomUUID(),
    accountId,
    eventType: 'opening_balance',
    description: 'Opening balance',
    payload: JSON.stringify({ amount: amount.toFixed(2) }),
    effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: amount.toFixed(2), amountMicros: Math.round(amount * 1_000_000) }),
    postedAt: nowIso(),
    createdAt: nowIso(),
  } as typeof schema.financialEvents.$inferInsert).run();
}

function seedAccountPerformance(accountId: string, nav: number | string): void {
  seedCanonicalOpening(accountId);
  requireDb().db.insert(schema.accountPerformance).values({
    id: randomUUID(),
    accountId,
    computedAsOf: nowIso(),
    netCash: '0.00',
    nav: String(nav),
    markedPositions: '[]',
    realizedPnl: '0.00',
    unrealizedPnl: '0.00',
    totalPnl: '0.00',
    realizedFees: '0.00',
    grossExposure: '0.00',
    netExposure: '0.00',
    warnings: '[]',
    positionsJson: '[]',
    lastRebuiltAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).run();
}

/** Seed a lookup_values row; returns its id. */
function seedLookup(
  id: string,
  type: 'sector' | 'setup' | 'market_condition',
  value: string
): void {
  requireDb().db.insert(schema.lookupValues).values({
    id,
    type,
    value,
    sortOrder: 0,
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).run();
}

/** Seed an instrument row (canonical symbol reference). */
function seedInstrument(id: string, symbol: string): void {
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
}

/** Seed a valuation mark row (immutable price observation). */
function seedValuationMark(accountId: string, instrumentId: string, price: number): void {
  requireDb().db.insert(schema.valuationMarks).values({
    id: randomUUID(),
    accountId,
    instrumentId,
    price: price.toFixed(2),
    priceMicros: Math.round(price * 1_000_000),
    source: 'system',
    markTimestamp: nowIso(),
    createdAt: nowIso(),
  }).run();
}

let tradeSeq = 0;

/** Seed a trade row; returns its id. */
function seedTrade(
  accountId: string,
  overrides: Partial<typeof schema.trades.$inferInsert> = {}
): string {
  const id = randomUUID();
  tradeSeq += 1;
  const now = nowIso();
  requireDb().db.insert(schema.trades).values({
    id,
    tradeCode: `T-IT-${String(tradeSeq).padStart(4, '0')}`,
    accountId,
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    openedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as typeof schema.trades.$inferInsert).run();
  return id;
}

/** Seed an execution row. */
function seedExecution(
  tradeId: string,
  action: 'buy' | 'sell' | 'buy_to_cover' | 'sell_short' | 'add' | 'reduce',
  quantity: number,
  price: number,
  fees: number,
  executedAt: string
): void {
  requireDb().db.insert(schema.tradeExecutions).values({
    id: randomUUID(),
    tradeId,
    action,
    quantity,
    price,
    fees,
    executedAt,
    createdAt: nowIso(),
  }).run();
}

/** Seed a risk snapshot row (one per trade). */
function seedRiskSnapshot(
  tradeId: string,
  overrides: Partial<typeof schema.tradeRiskSnapshots.$inferInsert> = {}
): void {
  requireDb().db.insert(schema.tradeRiskSnapshots).values({
    id: randomUUID(),
    tradeId,
    ...overrides,
  } as typeof schema.tradeRiskSnapshots.$inferInsert).run();
}

/** Seed a stop adjustment row. */
function seedStopAdjustment(
  tradeId: string,
  adjustedAt: string,
  newStop: number,
  previousStop: number | null,
  createdAt?: string
): void {
  requireDb().db.insert(schema.tradeStopAdjustments).values({
    id: randomUUID(),
    tradeId,
    adjustedAt,
    previousStop,
    newStop,
    createdAt: createdAt ?? nowIso(),
  }).run();
}

/** Seed an account_rollforward row (secondary equity source after NAV). */
function seedRollforward(accountId: string, date: string, endingEquity: number): void {
  requireDb().db.insert(schema.accountRollforward).values({
    id: randomUUID(),
    accountId,
    date,
    beginningEquity: 0,
    depositsWithdrawals: 0,
    realizedGrossPnl: 0,
    fees: 0,
    endingEquity,
    cumulativePnl: 0,
    highWaterMark: endingEquity,
    drawdownAmount: 0,
    drawdownPct: 0,
    notes: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).run();
}

/** Seed the singleton settings row (final equity fallback source). */
function seedSettings(startingAccountValue: number): void {
  requireDb().db.insert(schema.settings).values({
    id: 'default',
    startingAccountValue,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).run();
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Route invocation helpers (real handlers, real HTTP-ish NextRequest)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Structural types for the JSON bodies the real route handlers return.
 * Declared explicitly (no `any`) so lint passes and the contract is
 * self-documenting; runtime values always satisfy them for seeded fixtures.
 */
interface ApiRow {
  id: string;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  returnPct: number | null;
  riskPct: number | null;
  plannedRiskToAccount: number | null;
  metrics: TradeMetricsResult;
  [key: string]: unknown;
}

interface ApiListBody {
  data: ApiRow[];
  total: number;
  totals: Record<string, number>;
  [key: string]: unknown;
}

interface ApiDetailBody {
  id: string;
  accountName: string | null;
  accountCurrency: string | null;
  sectorName: string | null;
  metrics: TradeMetricsResult;
  [key: string]: unknown;
}

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

async function getTradesList(query = ''): Promise<{ status: number; body: ApiListBody }> {
  if (!listRoute || !NextRequestCtor) throw new Error('routes not initialized');
  const url = `http://localhost:3000/api/trades${query ? `?${query}` : ''}`;
  const res = await listRoute.GET(new NextRequestCtor(url));
  return { status: res.status, body: (await res.json()) as ApiListBody };
}

async function getTradeDetail(tradeId: string): Promise<{ status: number; body: ApiDetailBody }> {
  if (!detailRoute || !NextRequestCtor) throw new Error('routes not initialized');
  const res = await detailRoute.GET(new NextRequestCtor(`http://localhost:3000/api/trades/${tradeId}`), {
    params: Promise.resolve({ id: tradeId }),
  });
  return { status: res.status, body: (await res.json()) as ApiDetailBody };
}

/** Find a trade row in the list response; fails with a diff-style message. */
function findListRow(body: ApiListBody, tradeId: string): ApiRow {
  const row = body.data.find((r) => r.id === tradeId);
  if (!row) {
    throw new Error(
      `trade ${tradeId} missing from list response — got ${body.data.length} rows: ${body.data.map((r) => r.id).join(', ')}`
    );
  }
  return row;
}

/**
 * Rebuild the exact TradeMetricsInput the routes derive from the DB.
 * Mirrors the full equity cascade in both route handlers
 * (account_performance.nav → account_rollforward.endingEquity →
 *  account.startingBalance → settings.startingAccountValue → null).
 */
function buildMetricsInputFromDb(tradeId: string): TradeMetricsInput {
  const { db: d } = requireDb();
  const trade = d.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) throw new Error(`trade ${tradeId} not found while building metrics input`);

  const executions = d
    .select()
    .from(schema.tradeExecutions)
    .where(eq(schema.tradeExecutions.tradeId, tradeId))
    .all();
  const risk = d
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, tradeId))
    .get();
  const stops = d
    .select()
    .from(schema.tradeStopAdjustments)
    .where(eq(schema.tradeStopAdjustments.tradeId, tradeId))
    .orderBy(desc(schema.tradeStopAdjustments.adjustedAt), desc(schema.tradeStopAdjustments.newStop))
    .all();
  const perf = d
    .select({ nav: schema.accountPerformance.nav })
    .from(schema.accountPerformance)
    .where(eq(schema.accountPerformance.accountId, trade.accountId))
    .get();
  const account = d.select().from(schema.accounts).where(eq(schema.accounts.id, trade.accountId)).get();
  const rollforward = d
    .select()
    .from(schema.accountRollforward)
    .where(eq(schema.accountRollforward.accountId, trade.accountId))
    .orderBy(desc(schema.accountRollforward.date))
    .limit(1)
    .get();
  const settingsRow = d.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const navValue = perf?.nav ? parseFloat(perf.nav) : null;
  const currentAccountEquity =
    navValue ??
    rollforward?.endingEquity ??
    account?.startingBalance ??
    settingsRow?.startingAccountValue ??
    null;

  return {
    executions: executions.map((e) => ({
      id: e.id,
      action: e.action,
      quantity: e.quantity,
      price: e.price,
      fees: e.fees,
      executedAt: e.executedAt ?? '',
    })),
    direction: trade.direction as 'long' | 'short',
    riskSnapshot: risk
      ? {
          initialRiskAmount: risk.initialRiskAmount,
          accountEquityAtOpen: risk.accountEquityAtOpen,
          initialStopPrice: risk.initialStopPrice,
          initialEntryPrice: risk.initialEntryPrice,
        }
      : null,
    stopAdjustments: stops
      .filter((s): s is typeof s & { newStop: number } => s.newStop != null)
      .map((s) => ({ stopPrice: s.newStop, adjustedAt: s.adjustedAt ?? '' })),
    currentMark:
      trade.currentPrice != null
        ? { price: trade.currentPrice, markedAt: trade.currentPriceFetchedAt ?? nowIso() }
        : null,
    currentAccountEquity,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 6. AUDIT §15 categories 1–6 (T01 scope)
// ────────────────────────────────────────────────────────────────────────────

// ── C00. Fixture completeness ──────────────────────────────────────────────
// Seeding scaffolding proof: every table named in the slice must-haves exists
// in the migrated test DB and accepts rows.

registerCategory('C00', 'Fixture completeness', () => {
  const { db: d, getSqliteHandle: handle } = requireDb();

  seedAccount('acc-completeness');
  seedAccountPerformance('acc-completeness', 10000);
  seedLookup('sector-completeness', 'sector', 'Completeness Sector');
  seedInstrument('instr-completeness', 'ZZZ');
  seedValuationMark('acc-completeness', 'instr-completeness', 12.34);

  const tableCounts: Array<[string, string]> = [
    ['accounts', 'accounts'],
    ['account_performance', 'accountPerformance'],
    ['instruments', 'instruments'],
    ['valuation_marks', 'valuationMarks'],
    ['lookup_values', 'lookupValues'],
  ];
  for (const [tableName] of tableCounts) {
    const row = handle()
      .prepare(`SELECT COUNT(*) AS n FROM ${tableName}`)
      .get() as { n: number };
    assert(row.n >= 1, `${tableName} is seeded (${row.n} row(s))`);
  }

  // trades/executions/stop-adjustments/risk-snapshots also accept rows:
  const tradeId = seedTrade('acc-completeness', { symbol: 'ZZZ' });
  seedExecution(tradeId, 'buy', 10, 12, 0, '2026-07-01T10:00:00.000Z');
  seedRiskSnapshot(tradeId, { initialStopPrice: 11, initialRiskAmount: 10 });
  seedStopAdjustment(tradeId, '2026-07-02T10:00:00.000Z', 11.5, 11);
  const counts = {
    trades: d.select().from(schema.trades).all().length,
    executions: d.select().from(schema.tradeExecutions).all().length,
    riskSnapshots: d.select().from(schema.tradeRiskSnapshots).all().length,
    stopAdjustments: d.select().from(schema.tradeStopAdjustments).all().length,
  };
  assert(counts.trades === 1, `trades seedable (${counts.trades})`);
  assert(counts.executions === 1, `trade_executions seedable (${counts.executions})`);
  assert(counts.riskSnapshots === 1, `trade_risk_snapshots seedable (${counts.riskSnapshots})`);
  assert(counts.stopAdjustments === 1, `trade_stop_adjustments seedable (${counts.stopAdjustments})`);
});

// ── C01. Percentage integration ────────────────────────────────────────────
// Audit §15: Open Risk $45.60 / NAV $10,000 → API riskToAccount 0.00456 →
// UI (formatPercent) displays "+0.46%" — never "45.60%".

registerCategory('C01', 'Percentage integration', async () => {
  const accountId = 'acc-pct';
  seedAccount(accountId);
  seedAccountPerformance(accountId, 10000);

  const tradeId = seedTrade(accountId, { symbol: 'WKC', currentPrice: 102, currentPriceFetchedAt: nowIso() });
  seedExecution(tradeId, 'buy', 100, 100, 0, '2026-07-01T10:00:00.000Z');
  // risk/unit = 100 − 99.544 = 0.456 → open risk = $45.60
  seedRiskSnapshot(tradeId, {
    initialEntryPrice: 100,
    initialStopPrice: 99.544,
    initialQuantity: 100,
    initialRiskAmount: 45.6,
    accountEquityAtOpen: 10000,
  });

  const list = await getTradesList();
  assert(list.status === 200, `list route returns 200 (got ${list.status})`);
  const row = findListRow(list.body, tradeId);

  const riskToAccount = row.metrics.risk.riskToAccount as number;
  const openRisk = row.metrics.risk.openRisk as number;

  // Decimal-fraction contract: 0.0046 < 1.0 (NOT 45.60)
  assert(riskToAccount < 1.0, `riskToAccount is a decimal fraction < 1.0 (got ${riskToAccount})`);
  assertApprox(riskToAccount, 0.00456, 1e-6, 'riskToAccount = 0.00456 (45.60 / 10000)');
  assertApprox(openRisk, 45.6, 0.01, 'openRisk = $45.60');

  // formatPercent display correctness (audit: UI displays 0.46%)
  const display = formatPercent(riskToAccount);
  assertEqual(display, '+0.46%', 'formatPercent(riskToAccount) renders 0.46% (not 45.60%)');
  assert(display !== '+45.60%', 'display is not the double-multiplied 45.60%');

  // Same contract for the other percentage columns
  const initialRiskPct = row.metrics.risk.initialRiskPct as number;
  assertApprox(initialRiskPct, 0.00456, 1e-6, 'initialRiskPct = 0.00456 (decimal fraction)');
  assertEqual(formatPercent(initialRiskPct), '+0.46%', 'formatPercent(initialRiskPct) = +0.46%');

  const returnPct = row.metrics.returnMetrics.returnPct as number;
  // unrealized = (102 − 100) × 100 = 200 → returnPct = 200 / 10000 = 0.02
  assertApprox(returnPct, 0.02, 1e-9, 'returnPct = 0.02 (decimal fraction)');
  assertEqual(formatPercent(returnPct), '+2.00%', 'formatPercent(returnPct) = +2.00%');

  // Detail surface agrees
  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, `detail route returns 200 (got ${detail.status})`);
  assertDeepEqual(
    detail.body.metrics.risk.riskToAccount,
    riskToAccount,
    'detail.metrics.risk.riskToAccount matches list'
  );
});

// ── C02. Stop propagation ──────────────────────────────────────────────────
// Audit §15: after a stop adjustment, Active Stop / Open Risk / Risk to
// Account / Portfolio Heat update; activeStop and initialStop are identical
// across the list and detail endpoints.

registerCategory('C02', 'Stop propagation', async () => {
  const accountId = 'acc-stop';
  seedAccount(accountId);
  seedAccountPerformance(accountId, 10000);

  const tradeId = seedTrade(accountId, { symbol: 'WKC' });
  seedExecution(tradeId, 'buy', 100, 100, 0, '2026-07-01T10:00:00.000Z');
  seedRiskSnapshot(tradeId, {
    initialEntryPrice: 100,
    initialStopPrice: 98,
    initialQuantity: 100,
    initialRiskAmount: 200,
    accountEquityAtOpen: 10000,
  });

  // ── Pre-adjustment state ──
  const preList = await getTradesList();
  assert(preList.status === 200, 'list returns 200 (pre)');
  const preRow = findListRow(preList.body, tradeId);
  const preDetail = await getTradeDetail(tradeId);
  assert(preDetail.status === 200, 'detail returns 200 (pre)');

  // activeStop = initialStop = 98, propagated identically across surfaces
  assertEqual(preRow.metrics.risk.activeStop, 98, 'list activeStop = 98 (initial stop)');
  assertEqual(preDetail.body.metrics.risk.activeStop, 98, 'detail activeStop = 98');
  assertEqual(preRow.metrics.risk.initialStop, 98, 'list initialStop = 98');
  assertEqual(preDetail.body.metrics.risk.initialStop, 98, 'detail initialStop = 98');
  assertApprox(preRow.metrics.risk.openRisk, 200, 0.01, 'pre openRisk = $200');
  assertApprox(preRow.metrics.risk.riskToAccount, 0.02, 1e-9, 'pre riskToAccount = 0.02');
  // Top-level portfolioHeat contract (M010 decimal-fraction): amount = open risk,
  // pct = fraction of 1.0 (0.02 = 2.00%), NOT a ×100 percentage.
  assertApprox(preList.body.totals.portfolioHeatAmount, 200, 0.01, 'pre top-level portfolioHeatAmount = 200');
  assertApprox(preList.body.totals.portfolioHeatPct, 0.02, 1e-9, 'pre top-level portfolioHeatPct = 0.02 (200/10000, decimal fraction)');

  // ── Record the stop adjustment (the "edit stop on open trade" path) ──
  seedStopAdjustment(tradeId, '2026-07-02T10:00:00.000Z', 99.5, 98);

  // ── Post-adjustment state ──
  const postList = await getTradesList();
  const postRow = findListRow(postList.body, tradeId);
  const postDetail = await getTradeDetail(tradeId);

  // Active Stop updates on BOTH surfaces; Initial Stop stays exact (98)
  assertEqual(postRow.metrics.risk.activeStop, 99.5, 'list activeStop = 99.5 after adjustment');
  assertEqual(postDetail.body.metrics.risk.activeStop, 99.5, 'detail activeStop = 99.5 after adjustment');
  assertEqual(postRow.metrics.risk.initialStop, 98, 'list initialStop unchanged = 98');
  assertEqual(postDetail.body.metrics.risk.initialStop, 98, 'detail initialStop unchanged = 98');
  assertEqual(
    postRow.metrics.risk.activeStop,
    postDetail.body.metrics.risk.activeStop,
    'activeStop identical across list and detail'
  );
  assertEqual(
    postRow.metrics.risk.initialStop,
    postDetail.body.metrics.risk.initialStop,
    'initialStop identical across list and detail'
  );

  // Open Risk and Risk to Account update
  assertApprox(postRow.metrics.risk.openRisk, 50, 0.01, 'post openRisk = $50 (100−99.5)×100');
  assertApprox(postRow.metrics.risk.riskToAccount, 0.005, 1e-9, 'post riskToAccount = 0.005');
  assertApprox(postList.body.totals.portfolioHeatAmount, 50, 0.01, 'post top-level portfolioHeatAmount = 50');
  assertApprox(postList.body.totals.portfolioHeatPct, 0.005, 1e-9, 'post top-level portfolioHeatPct = 0.005 (50/10000, decimal fraction)');
  assert(
    postList.body.totals.portfolioHeatPct < preList.body.totals.portfolioHeatPct,
    'top-level portfolioHeatPct decreases after stop tightened'
  );
});

// ── C03. Stop ordering ─────────────────────────────────────────────────────
// Audit §15: multiple stop adjustments inserted out of order must select the
// latest timestamp; same-timestamp ties resolve chronologically (later createdAt,
// then id) — never by price magnitude.

registerCategory('C03', 'Stop ordering', async () => {
  const accountId = 'acc-order';
  seedAccount(accountId);
  seedAccountPerformance(accountId, 10000);

  const tradeId = seedTrade(accountId, { symbol: 'WKC' });
  seedExecution(tradeId, 'buy', 100, 100, 0, '2026-07-01T10:00:00.000Z');
  seedRiskSnapshot(tradeId, { initialEntryPrice: 100, initialStopPrice: 97, initialQuantity: 100 });

  // Insert deliberately OUT OF chronological order.
  seedStopAdjustment(tradeId, '2026-07-02T10:00:00.000Z', 98.5, 97);
  seedStopAdjustment(tradeId, '2026-07-03T10:00:00.000Z', 99.75, 98.5);
  seedStopAdjustment(tradeId, '2026-07-01T10:00:00.000Z', 99.0, 97);

  // Latest adjustedAt wins regardless of insert order
  const list = await getTradesList();
  assert(list.status === 200, 'list returns 200');
  const row = findListRow(list.body, tradeId);
  assertEqual(row.metrics.risk.activeStop, 99.75, 'activeStop = 99.75 (latest adjustedAt, out-of-order inserts)');

  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, 'detail returns 200');
  assertEqual(detail.body.metrics.risk.activeStop, 99.75, 'detail activeStop = 99.75');
  assertEqual(
    row.metrics.risk.activeStop,
    detail.body.metrics.risk.activeStop,
    'stop ordering deterministic across surfaces'
  );

  // ── Tiebreaker: two adjustments with the SAME adjustedAt → later createdAt wins ──
  // The later-created row carries the SMALLER newStop (99.5) — chronology must beat
  // price magnitude: activeStop becomes 99.5, not 100.0.
  seedStopAdjustment(tradeId, '2026-07-04T10:00:00.000Z', 100.0, 99.75, '2026-07-04T11:00:00.000Z');
  seedStopAdjustment(tradeId, '2026-07-04T10:00:00.000Z', 99.5, 100.0, '2026-07-04T12:00:00.000Z');

  const list2 = await getTradesList();
  const row2 = findListRow(list2.body, tradeId);
  assertEqual(row2.metrics.risk.activeStop, 99.5, 'tie → activeStop = 99.5 (later createdAt wins, not larger newStop)');

  const detail2 = await getTradeDetail(tradeId);
  assertEqual(detail2.body.metrics.risk.activeStop, 99.5, 'detail tie → activeStop = 99.5');

  // The deterministic selection drives downstream risk correctly:
  // stop (99.5) is below cost (100) → openRisk = (100−99.5)×100 = $50, lockedPnl = 0
  assertApprox(row2.metrics.risk.openRisk, 50, 1e-9, 'openRisk = $50 (100−99.5)×100 when stop below cost');
  assertApprox(row2.metrics.risk.lockedPnl, 0, 1e-9, 'lockedPnl = 0 when stop is below cost');
});

// ── C04. Scale-in ──────────────────────────────────────────────────────────
// Audit §15: an initial stop must remain exact after additional entry fills
// (never reconstructed from initialRiskAmount / current avg entry).

registerCategory('C04', 'Scale-in', async () => {
  const accountId = 'acc-scale';
  seedAccount(accountId);
  seedAccountPerformance(accountId, 10000);

  const tradeId = seedTrade(accountId, { symbol: 'WKC' });
  seedExecution(tradeId, 'buy', 100, 100, 0, '2026-07-01T10:00:00.000Z');
  seedRiskSnapshot(tradeId, {
    initialEntryPrice: 100,
    initialStopPrice: 98,
    initialQuantity: 100,
    initialRiskAmount: 200, // 2.00/share on 100 initial shares
    accountEquityAtOpen: 10000,
  });

  // Pre-scale-in baseline
  const preList = await getTradesList();
  const preRow = findListRow(preList.body, tradeId);
  assertEqual(preRow.metrics.risk.activeStop, 98, 'pre activeStop = 98');
  assertApprox(preRow.metrics.averagePrices.openAvgCost, 100, 1e-9, 'pre openAvgCost = 100');

  // Scale in: +100 @ 102 → FIFO avg cost = (100×100 + 102×100)/200 = 101
  seedExecution(tradeId, 'add', 100, 102, 0, '2026-07-02T10:00:00.000Z');

  const list = await getTradesList();
  assert(list.status === 200, 'list returns 200');
  const row = findListRow(list.body, tradeId);

  assertApprox(row.metrics.size.entryQuantity, 200, 1e-9, 'entryQuantity = 200 after scale-in');
  assertApprox(row.metrics.averagePrices.avgEntryPrice, 101, 1e-9, 'avgEntryPrice = 101');
  assertApprox(row.metrics.averagePrices.openAvgCost, 101, 1e-9, 'FIFO openAvgCost = 101');

  // The INITIAL STOP stays exact — never reconstructed:
  // buggy reconstruction would give avgEntry(101) − risk/share(200/100) = 99
  assertEqual(row.metrics.risk.activeStop, 98, 'activeStop remains 98 after scale-in (stored exact price)');
  assertEqual(row.metrics.risk.initialStop, 98, 'initialStop remains 98');
  assert(row.metrics.risk.activeStop !== 99, 'activeStop is NOT reconstructed from risk amount (≠ 99)');

  assertApprox(row.metrics.risk.openRisk, 600, 0.01, 'openRisk = $600 (101−98)×200');
  assertApprox(row.metrics.risk.riskToAccount, 0.06, 1e-9, 'riskToAccount = 0.06');

  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, 'detail returns 200');
  assertEqual(detail.body.metrics.risk.activeStop, 98, 'detail activeStop = 98 after scale-in');
  assertEqual(detail.body.metrics.risk.initialStop, 98, 'detail initialStop = 98 after scale-in');
  assertApprox(detail.body.metrics.averagePrices.openAvgCost, 101, 1e-9, 'detail openAvgCost = 101');
});

// ── C05. Partial exit ──────────────────────────────────────────────────────
// Audit §15: Open Quantity, FIFO Open Avg Cost, Gross/Net Realized P&L,
// Unrealized P&L and Open Risk after a partial exit.

registerCategory('C05', 'Partial exit', async () => {
  const accountId = 'acc-partial';
  seedAccount(accountId);
  seedAccountPerformance(accountId, 10000);

  const tradeId = seedTrade(accountId, {
    symbol: 'WKC',
    currentPrice: 112,
    currentPriceFetchedAt: nowIso(),
  });
  seedExecution(tradeId, 'buy', 200, 100, 4, '2026-07-01T10:00:00.000Z'); // entry fee $4
  seedExecution(tradeId, 'sell', 100, 110, 2, '2026-07-02T10:00:00.000Z'); // partial exit, fee $2
  seedRiskSnapshot(tradeId, {
    initialEntryPrice: 100,
    initialStopPrice: 98,
    initialQuantity: 200,
    initialRiskAmount: 400,
    accountEquityAtOpen: 10000,
  });

  const list = await getTradesList();
  assert(list.status === 200, 'list returns 200');
  const row = findListRow(list.body, tradeId);
  const m = row.metrics;

  // Open Quantity
  assertApprox(m.size.openQuantity, 100, 1e-9, 'openQuantity = 100 after partial exit');
  assertEqual(m.size.sizeDisplay, '200 / 100', 'sizeDisplay = "200 / 100"');

  // FIFO Open Avg Cost — exit matched the $100 lot, remainder still costs $100
  assertApprox(m.averagePrices.openAvgCost, 100, 1e-9, 'FIFO openAvgCost = 100');

  // Gross Realized = (110 − 100) × 100 = 1000
  assertApprox(m.realizedPnl.grossRealizedPnl, 1000, 0.01, 'grossRealizedPnl = 1000');
  // Entry fee allocation: $4 × (100/200) = $2 + exit fee $2 → realized fees $4
  assertApprox(m.fees.realizedFees, 4, 0.01, 'realizedFees = 4');
  assertApprox(m.realizedPnl.netRealizedPnl, 996, 0.01, 'netRealizedPnl = 996 (1000 − 4)');

  // Unrealized = (112 − 100) × 100 = 1200; remaining open fees = $2
  assertApprox(m.unrealizedPnl.grossUnrealizedPnl, 1200, 0.01, 'grossUnrealizedPnl = 1200');
  assertApprox(m.unrealizedPnl.netUnrealizedPnl, 1198, 0.01, 'netUnrealizedPnl = 1198 (1200 − 2 open fees)');

  // Open Risk = (100 − 98) × 100 = 200
  assertApprox(m.risk.openRisk, 200, 0.01, 'openRisk = 200');

  // Detail surface agrees on every audited field
  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, 'detail returns 200');
  for (const path of [
    'size.openQuantity',
    'averagePrices.openAvgCost',
    'realizedPnl.grossRealizedPnl',
    'realizedPnl.netRealizedPnl',
    'unrealizedPnl.netUnrealizedPnl',
    'risk.openRisk',
  ] as const) {
    const [group, field] = path.split('.') as [keyof TradeMetricsResult, string];
    assertDeepEqual(
      (m[group] as unknown as Record<string, unknown>)[field],
      (detail.body.metrics[group] as unknown as Record<string, unknown>)[field],
      `detail.metrics.${path} matches list`
    );
  }

  // Flat list fields agree with the nested metrics (same canonical source)
  assertApprox(row.realizedPnl as number, 996, 0.01, 'flat realizedPnl = 996');
  assertApprox(row.unrealizedPnl as number, 1198, 0.01, 'flat unrealizedPnl = 1198');
});

// ── C06. Cross-surface reconciliation ──────────────────────────────────────
// Audit §15: for the same trade, assert exact equality across the Trades row
// (list API), Trade Detail (detail API), and the canonical kernel
// (computeTradeMetrics with identical inputs).

registerCategory('C06', 'Cross-surface reconciliation', async () => {
  const accountId = 'acc-reconcile';
  seedAccount(accountId);
  seedAccountPerformance(accountId, 25000);

  const tradeId = seedTrade(accountId, {
    symbol: 'WKC',
    currentPrice: 54,
    currentPriceFetchedAt: nowIso(),
  });
  seedExecution(tradeId, 'buy', 150, 50, 3, '2026-07-01T10:00:00.000Z');
  seedExecution(tradeId, 'add', 50, 52, 2, '2026-07-02T10:00:00.000Z');
  seedExecution(tradeId, 'sell', 100, 55, 2, '2026-07-03T10:00:00.000Z');
  seedRiskSnapshot(tradeId, {
    initialEntryPrice: 50,
    initialStopPrice: 48,
    initialQuantity: 200,
    initialRiskAmount: 350,
    accountEquityAtOpen: 20000,
  });
  seedStopAdjustment(tradeId, '2026-07-04T10:00:00.000Z', 49.5, 48);
  seedStopAdjustment(tradeId, '2026-07-05T10:00:00.000Z', 50.5, 49.5);

  // 1) List surface
  const list = await getTradesList();
  assert(list.status === 200, 'list returns 200');
  const row = findListRow(list.body, tradeId);

  // 2) Detail surface
  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, 'detail returns 200');

  // 3) Kernel ground truth with the same inputs the routes derive
  const input = buildMetricsInputFromDb(tradeId);
  const kernel = computeTradeMetrics(input);

  // ── Exact equality: list.metrics ≡ detail.metrics (every public group) ──
  const listMetrics = row.metrics;
  const detailMetrics = detail.body.metrics;
  for (const group of [
    'size',
    'averagePrices',
    'fees',
    'realizedPnl',
    'unrealizedPnl',
    'risk',
    'returnMetrics',
  ] as const) {
    assertDeepEqual(listMetrics[group], detailMetrics[group], `list.metrics.${group} ≡ detail.metrics.${group}`);
  }

  // position group: holdingPeriodDays is now-based (Date.now()) so list and
  // detail are computed milliseconds apart — compare it within a clock-drift
  // tolerance instead of exact equality; all other position fields stay exact.
  {
    const lp = listMetrics.position as unknown as Record<string, unknown>;
    const dp = detailMetrics.position as unknown as Record<string, unknown>;
    assert(
      JSON.stringify(Object.keys(lp).sort()) === JSON.stringify(Object.keys(dp).sort()),
      'list.metrics.position ≡ detail.metrics.position (key match)',
    );
    for (const key of Object.keys(lp)) {
      if (key === 'holdingPeriodDays') continue;
      assertDeepEqual(lp[key], dp[key], `list.metrics.position.${key} ≡ detail.metrics.position.${key}`);
    }
    const lh = lp.holdingPeriodDays as number | null;
    const dh = dp.holdingPeriodDays as number | null;
    if (lh === null && dh === null) {
      assert(true, 'list.metrics.position.holdingPeriodDays ≡ detail (both null)');
    } else if (typeof lh === 'number' && typeof dh === 'number') {
      // Both surfaces use Date.now() milliseconds apart; allow up to ~1 second drift.
      const driftDays = 1 / (60 * 60 * 24);
      assert(
        Math.abs(lh - dh) < driftDays,
        `list.metrics.position.holdingPeriodDays ≡ detail within clock drift (diff ${Math.abs(lh - dh).toFixed(10)}d)`,
      );
    } else {
      throw new Error(`holdingPeriodDays mismatch: list=${lh} detail=${dh}`);
    }
  }

  // ── Exact equality: list flat fields ≡ nested metrics ──
  assertApprox(row.realizedPnl as number, listMetrics.realizedPnl.netRealizedPnl, 1e-9, 'flat realizedPnl ≡ metrics');
  assertApprox(row.unrealizedPnl as number, listMetrics.unrealizedPnl.netUnrealizedPnl as number, 1e-9, 'flat unrealizedPnl ≡ metrics');
  assertApprox(row.returnPct as number, listMetrics.returnMetrics.returnPct as number, 1e-9, 'flat returnPct ≡ metrics');
  assertApprox(row.riskPct as number, listMetrics.risk.riskToAccount as number, 1e-9, 'flat riskPct ≡ metrics');

  // ── Kernel ≡ API surfaces ──
  assertDeepEqual(listMetrics.risk, kernel.risk, 'kernel.risk ≡ list.metrics.risk');
  assertDeepEqual(listMetrics.returnMetrics, kernel.returnMetrics, 'kernel.returnMetrics ≡ list.metrics.returnMetrics');
  assertDeepEqual(listMetrics.realizedPnl, kernel.realizedPnl, 'kernel.realizedPnl ≡ list.metrics.realizedPnl');
  assertDeepEqual(listMetrics.unrealizedPnl, kernel.unrealizedPnl, 'kernel.unrealizedPnl ≡ list.metrics.unrealizedPnl');
  assertDeepEqual(listMetrics.averagePrices, kernel.averagePrices, 'kernel.averagePrices ≡ list.metrics.averagePrices');

  // ── Spot-check the reconciled values (documentation of the contract) ──
  // FIFO: exit 100 matched lot1 (150@50): gross 500, entry fee alloc 3×(100/150)=2,
  //       exit fee 2 → netRealized = 500 − 4 = 496
  assertApprox(kernel.realizedPnl.grossRealizedPnl, 500, 0.01, 'grossRealizedPnl = 500');
  assertApprox(kernel.realizedPnl.netRealizedPnl, 496, 0.01, 'netRealizedPnl = 496');
  assertApprox(kernel.averagePrices.openAvgCost, 51, 1e-9, 'openAvgCost = 51 (50×50 + 52×50)/100');
  // open fees = lot1 remaining 1 + lot2 2 = 3; unrealized = (54−51)×100 − 3 = 297
  assertApprox(kernel.fees.openFees, 3, 0.01, 'openFees = 3');
  assertApprox(kernel.unrealizedPnl.netUnrealizedPnl, 297, 0.01, 'netUnrealizedPnl = 297');
  assertApprox(kernel.risk.activeStop, 50.5, 1e-9, 'activeStop = 50.5 (latest adjustment)');
  assertApprox(kernel.risk.openRisk, 50, 0.01, 'openRisk = 50 (51−50.5)×100');
  assertApprox(kernel.risk.riskToAccount, 0.002, 1e-9, 'riskToAccount = 0.002 (50/25000)');
  assertApprox(kernel.returnMetrics.rMultiple, 793 / 350, 1e-6, 'rMultiple = 793/350');
});

// ── C07. Friendly names ────────────────────────────────────────────────────
// Audit §15: accountName/sectorName resolve to human-readable strings on both
// surfaces — never the raw UUID stored in trades.accountId / trades.sectorId.

registerCategory('C07', 'Friendly names', async () => {
  // Deliberately UUID-shaped ids so the assertion is meaningful:
  // the API must NOT echo the id back as the display name.
  const accountId = randomUUID();
  const sectorId = randomUUID();
  seedAccount(accountId, { name: 'Friendly Names Account' });
  seedLookup(sectorId, 'sector', 'Technology Semiconductors');

  const tradeId = seedTrade(accountId, { symbol: 'WKC', sectorId });
  seedExecution(tradeId, 'buy', 100, 100, 0, '2026-07-01T10:00:00.000Z');
  seedRiskSnapshot(tradeId, { initialEntryPrice: 100, initialStopPrice: 98, initialQuantity: 100 });

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ── List surface ──
  const list = await getTradesList();
  assert(list.status === 200, 'list returns 200');
  const row = findListRow(list.body, tradeId);

  const listAccountName = row.accountName as string | null;
  const listSectorName = row.sectorName as string | null;
  assertEqual(listAccountName, 'Friendly Names Account', 'list accountName is human-readable');
  assertEqual(listSectorName, 'Technology Semiconductors', 'list sectorName is human-readable');
  assert(
    listAccountName !== accountId,
    'list accountName is not the raw account UUID'
  );
  assert(
    listSectorName !== sectorId,
    'list sectorName is not the raw sector UUID'
  );
  assert(!uuidPattern.test(listAccountName ?? ''), 'list accountName is not UUID-shaped');
  assert(!uuidPattern.test(listSectorName ?? ''), 'list sectorName is not UUID-shaped');

  // ── Detail surface ──
  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, 'detail returns 200');
  assertEqual(detail.body.accountName, 'Friendly Names Account', 'detail accountName is human-readable');
  assertEqual(detail.body.sectorName, 'Technology Semiconductors', 'detail sectorName is human-readable');
  assert(!uuidPattern.test(detail.body.accountName ?? ''), 'detail accountName is not UUID-shaped');
  assert(!uuidPattern.test(detail.body.sectorName ?? ''), 'detail sectorName is not UUID-shaped');

  // Account metadata propagates too
  assertEqual(detail.body.accountCurrency, 'USD', 'detail accountCurrency = USD');
  assertEqual(row.accountCurrency as string, 'USD', 'list accountCurrency = USD');
});

// ── C08. NAV consistency ───────────────────────────────────────────────────
// Audit §15: riskToAccount must use account_performance.nav as the equity
// denominator, and fall through the full cascade (nav → rollforward →
// startingBalance → settings → null) as each source disappears.

registerCategory('C08', 'NAV consistency', async () => {
  const accountId = 'acc-nav';
  // startingBalance is deliberately misleading (100) — NAV (25000) must win.
  seedAccount(accountId, { startingBalance: 100 });
  seedAccountPerformance(accountId, 25000);
  seedRollforward(accountId, '2026-07-05T00:00:00.000Z', 15000);

  const tradeId = seedTrade(accountId, { symbol: 'WKC' });
  seedExecution(tradeId, 'buy', 100, 100, 0, '2026-07-01T10:00:00.000Z');
  // openRisk = (100 − 95) × 100 = 500
  seedRiskSnapshot(tradeId, { initialEntryPrice: 100, initialStopPrice: 95, initialQuantity: 100, initialRiskAmount: 500 });

  const riskToAccountFor = async (label: string) => {
    const list = await getTradesList();
    const row = findListRow(list.body, tradeId);
    const detail = await getTradeDetail(tradeId);
    const listValue = row.metrics.risk.riskToAccount as number | null;
    assertDeepEqual(
      listValue,
      detail.body.metrics.risk.riskToAccount as number | null,
      `${label}: detail riskToAccount matches list`
    );
    if (listValue != null) {
      assertApprox(row.riskPct as number, listValue, 1e-9, `${label}: flat riskPct matches metrics`);
    } else {
      assertEqual(row.riskPct, null, `${label}: flat riskPct is null when riskToAccount is null`);
    }
    return listValue;
  };

  // ── Phase 1: NAV present → 500 / 25000 = 0.02 (rollforward/startingBalance ignored) ──
  const withNav = await riskToAccountFor('with NAV');
  assertApprox(withNav, 0.02, 1e-9, 'riskToAccount = 0.02 (500 / NAV 25000)');
  assert(withNav !== 500 / 15000, 'NAV wins over rollforward (≠ 0.0333…)');
  assert(withNav !== 5, 'NAV wins over startingBalance (≠ 5.0)');

  // ── Phase 2: NAV removed → rollforward.endingEquity 15000 → 500/15000 ──
  requireDb().db.delete(schema.accountPerformance)
    .where(eq(schema.accountPerformance.accountId, accountId)).run();
  const withRollforward = await riskToAccountFor('after NAV removed');
  assertApprox(withRollforward, 500 / 15000, 1e-9, 'riskToAccount = 500/15000 (rollforward)' );
  assert(withRollforward !== 5, 'rollforward wins over startingBalance (≠ 5.0)');

  // ── Phase 3: rollforward removed → M002-A9 canonical reconstruction from
  //     the opening funding (10000) — legacy startingBalance 100 is IGNORED
  //     (canonical state beats contradictory legacy; no local fallback). ──
  requireDb().db.delete(schema.accountRollforward)
    .where(eq(schema.accountRollforward.accountId, accountId)).run();
  const withCanonicalCash = await riskToAccountFor('after rollforward removed');
  assertApprox(withCanonicalCash, 500 / 10000, 1e-9, 'riskToAccount = 500/10000 (canonical reconstruction)');
  assert(withCanonicalCash !== 5.0, 'canonical cash wins over legacy startingBalance (≠ 5.0)');

  // ── Phase 4: startingBalance removed + settings 40000 → still canonical 10000 ──
  requireDb().db.update(schema.accounts)
    .set({ startingBalance: null })
    .where(eq(schema.accounts.id, accountId))
    .run();
  seedSettings(40000);
  const withSettings = await riskToAccountFor('after startingBalance removed');
  assertApprox(withSettings, 500 / 10000, 1e-9, 'settings.startingAccountValue cannot fabricate canonical funding (500/10000)');

  // ── Phase 5: settings removed → canonical reconstruction still 10000 ──
  requireDb().db.delete(schema.settings).where(eq(schema.settings.id, 'default')).run();
  const withNoSettings = await riskToAccountFor('after settings removed');
  assertApprox(withNoSettings, 500 / 10000, 1e-9, 'riskToAccount stays 500/10000 — canonical equity independent of settings');
});

// ── C09. Short position risk ───────────────────────────────────────────────
// Audit §15: short trades compute risk in the opposite direction — stop ABOVE
// entry price produces openRisk; stop BELOW entry price locks profit.

registerCategory('C09', 'Short position risk', async () => {
  const accountId = 'acc-short';
  seedAccount(accountId);
  seedAccountPerformance(accountId, 10000);

  const tradeId = seedTrade(accountId, { symbol: 'WKC', direction: 'short', currentPrice: 101, currentPriceFetchedAt: nowIso() });
  seedExecution(tradeId, 'sell_short', 100, 100, 0, '2026-07-01T10:00:00.000Z');
  seedRiskSnapshot(tradeId, {
    initialEntryPrice: 100,
    initialStopPrice: 102, // stop ABOVE entry = risk for a short
    initialQuantity: 100,
    initialRiskAmount: 200,
    accountEquityAtOpen: 10000,
  });

  const list = await getTradesList();
  assert(list.status === 200, 'list returns 200');
  const row = findListRow(list.body, tradeId);

  // Direction-aware risk: openRisk = (102 − 100) × 100 = 200, not 0
  assertEqual(row.metrics.risk.activeStop, 102, 'short activeStop = 102 (stop above entry)');
  assertApprox(row.metrics.risk.openRisk, 200, 0.01, 'short openRisk = 200 (102−100)×100');
  assertApprox(row.metrics.risk.riskToAccount, 0.02, 1e-9, 'short riskToAccount = 0.02');
  assertApprox(row.metrics.risk.lockedPnl, 0, 1e-9, 'short lockedPnl = 0 (stop not past cost)');

  // Direction-aware unrealized P&L: short loses when price rises → (100−101)×100 = −100
  assertApprox(row.metrics.unrealizedPnl.grossUnrealizedPnl, -100, 0.01, 'short grossUnrealizedPnl = −100');

  // ── Stop moved BELOW entry → profit locked, openRisk clamps to 0 ──
  seedStopAdjustment(tradeId, '2026-07-02T10:00:00.000Z', 99, 102);
  const list2 = await getTradesList();
  const row2 = findListRow(list2.body, tradeId);
  assertEqual(row2.metrics.risk.activeStop, 99, 'short activeStop = 99 after adjustment');
  assertApprox(row2.metrics.risk.openRisk, 0, 1e-9, 'short openRisk clamps to 0 below entry');
  assertApprox(row2.metrics.risk.lockedPnl, 100, 0.01, 'short lockedPnl = 100 (100−99)×100');

  // Detail surface agrees on both phases
  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, 'detail returns 200');
  assertEqual(detail.body.metrics.risk.activeStop, 99, 'detail short activeStop = 99');
  assertApprox(detail.body.metrics.risk.lockedPnl, 100, 0.01, 'detail short lockedPnl = 100');
  assertApprox(detail.body.metrics.unrealizedPnl.grossUnrealizedPnl, -100, 0.01, 'detail short grossUnrealizedPnl = −100');
});

// ── C10. Missing mark ──────────────────────────────────────────────────────
// Audit §15: an open trade without a market price must return null P&L (never
// a fabricated zero or stale value), while risk fields that do not depend on
// the mark still compute.

registerCategory('C10', 'Missing mark', async () => {
  const accountId = 'acc-nomark';
  seedAccount(accountId);
  seedAccountPerformance(accountId, 10000);

  // Open trade WITHOUT currentPrice (no mark yet)
  const tradeId = seedTrade(accountId, { symbol: 'WKC' });
  seedExecution(tradeId, 'buy', 100, 100, 0, '2026-07-01T10:00:00.000Z');
  seedRiskSnapshot(tradeId, { initialEntryPrice: 100, initialStopPrice: 98, initialQuantity: 100, initialRiskAmount: 200 });

  const list = await getTradesList();
  assert(list.status === 200, 'list returns 200');
  const row = findListRow(list.body, tradeId);

  // Unrealized P&L is null — never 0, never a stale value
  assertEqual(row.metrics.unrealizedPnl.grossUnrealizedPnl, null, 'grossUnrealizedPnl = null (no mark)');
  assertEqual(row.metrics.unrealizedPnl.netUnrealizedPnl, null, 'netUnrealizedPnl = null (no mark)');
  assertEqual(row.metrics.returnMetrics.returnPct, null, 'returnPct = null (no mark)');
  assertEqual(row.metrics.returnMetrics.rMultiple, null, 'rMultiple = null (no mark)');
  assertEqual(row.metrics.position.totalNetPnl, null, 'totalNetPnl = null (no mark)');
  assertEqual(row.metrics.position.marketValue, null, 'marketValue = null (no mark)');
  assertEqual(row.metrics.position.positionWeight, null, 'positionWeight = null (no mark)');

  // Flat list fields agree (UI renders '—' via formatPercent/formatCurrency)
  assertEqual(row.unrealizedPnl, null, 'flat unrealizedPnl = null');
  assertEqual(row.returnPct, null, 'flat returnPct = null');
  assertEqual(formatPercent(row.metrics.returnMetrics.returnPct), '—', 'formatPercent(null) renders —');

  // Risk does NOT depend on the mark — still computed
  assertEqual(row.metrics.risk.activeStop, 98, 'activeStop still computes without mark');
  assertApprox(row.metrics.risk.openRisk, 200, 0.01, 'openRisk still computes without mark');
  assertApprox(row.metrics.risk.riskToAccount, 0.02, 1e-9, 'riskToAccount still computes without mark');

  // Detail surface agrees
  const detail = await getTradeDetail(tradeId);
  assert(detail.status === 200, 'detail returns 200');
  assertEqual(detail.body.metrics.unrealizedPnl.grossUnrealizedPnl, null, 'detail grossUnrealizedPnl = null');
  assertEqual(detail.body.metrics.returnMetrics.returnPct, null, 'detail returnPct = null');

  // ── Mark arrives → values populate ──
  requireDb().db.update(schema.trades)
    .set({ currentPrice: 105, currentPriceFetchedAt: nowIso() })
    .where(eq(schema.trades.id, tradeId))
    .run();
  const list2 = await getTradesList();
  const row2 = findListRow(list2.body, tradeId);
  assertApprox(row2.metrics.unrealizedPnl.grossUnrealizedPnl, 500, 0.01, 'grossUnrealizedPnl = 500 after mark (105−100)×100');
  assertApprox(row2.metrics.returnMetrics.returnPct, 0.05, 1e-9, 'returnPct = 0.05 after mark');
  assertApprox(row2.metrics.position.marketValue, 10500, 0.01, 'marketValue = 10500 after mark');
  assertEqual(formatPercent(row2.metrics.returnMetrics.returnPct), '+5.00%', 'formatPercent populates after mark');
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Main
// ────────────────────────────────────────────────────────────────────────────

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

  const { NextResponse } = nextMod;
  void NextResponse; // routes construct responses internally; import is a smoke check

  console.log('━'.repeat(72));
  console.log('  M010 · S07 — Cross-surface integration tests (audit §15)');
  console.log(`  DB: ${TEST_DB_FILE} (real migrated schema)`);
  console.log('━'.repeat(72));
  console.log();

  for (const cat of categories) {
    resetDb();
    const started = Date.now();
    try {
      await cat.run();
      results.push({ id: cat.id, name: cat.name, ok: true, error: null });
      console.log(`  ✅ [${cat.id}] ${cat.name} — PASS (${Date.now() - started}ms)`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ id: cat.id, name: cat.name, ok: false, error: message });
      console.error(`  ❌ [${cat.id}] ${cat.name} — FAIL (${Date.now() - started}ms)`);
      console.error(`     ${message}`);
    }
  }

  console.log();
  console.log('━'.repeat(72));
  console.log('  Summary');
  console.log('━'.repeat(72));
  console.log(`  ${'ID'.padEnd(6)} ${'Category'.padEnd(38)} Result`);
  console.log(`  ${'─'.repeat(6)} ${'─'.repeat(38)} ──────`);
  for (const r of results) {
    console.log(`  ${r.id.padEnd(6)} ${r.name.padEnd(38)} ${r.ok ? 'PASS' : 'FAIL'}`);
  }
  console.log('─'.repeat(72));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`  ${passed}/${results.length} audit categories passed (all 10 audit §15 categories: percentage integration, stop propagation, stop ordering, scale-in, partial exit, cross-surface reconciliation, friendly names, NAV consistency, short position risk, missing mark)`);
  if (failed > 0) {
    console.error(`  ${failed} category(ies) FAILED — see diff above`);
    console.error('─'.repeat(72));
    process.exit(1);
  }
  console.log('  All categories PASSED — M010 contract holds across list/detail/kernel.');
  console.log('━'.repeat(72));
  process.exit(0);
}

main().catch((e) => {
  console.error('cross-surface-integration.test.ts: unexpected error', e);
  process.exit(1);
});
