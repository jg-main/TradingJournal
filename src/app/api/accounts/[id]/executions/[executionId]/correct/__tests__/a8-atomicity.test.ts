/**
 * account-correction-a8.test.ts — REAL handler invocation (M002-A8)
 *
 * POST /api/accounts/[id]/executions/[executionId]/correct must post
 * reversal + replacement + fee economics + lineage + FIFO + account
 * performance as ONE atomic correction boundary. HTTP 200 means every
 * projection succeeded; a projection failure rolls back the whole
 * correction, leaves the idempotency key retryable, and does not mark the
 * original execution as already corrected.
 *
 * Deterministic real-DB failures are forced with SQLite triggers
 * (RAISE(ABORT)) — never mocked ordering.
 *
 * Run: npx tsx .../a8-atomicity.test.ts
 *      (also registered in vitest.config.ts include)
 */
/// <reference types="vitest/globals" />

// ── 0. Node/tsx runtime shims ─────────────────────────────────────────────
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

const TEST_DB_FILE = testDbPath('account-correction-a8');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ── 1. Static imports ─────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import * as schema from '@/db/schema';
import type { NextRequest, NextResponse } from 'next/server';

let passed = 0;
let failed = 0;
function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg} (FAILED)`); }
}
function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`); }
}

type RouteModule = { POST: (r: NextRequest, ctx: { params: Promise<{ id: string; executionId: string }> }) => Promise<NextResponse> };
let route: RouteModule | null = null;
let NextRequestCtor: typeof NextRequest | null = null;
let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => import('better-sqlite3').Database) | null = null;
let postFinancialEventFn: ((sqlite: import('better-sqlite3').Database, input: import('@/lib/accounting/posting').PostFinancialEventInput) => { event: { id: string } }) | null = null;
let postExecutionFillFn: ((sqlite: import('better-sqlite3').Database, input: import('@/lib/accounting/execution-posting').PostExecutionFillInput) => import('@/lib/accounting/execution-posting').PostExecutionFillResult) | null = null;

function requireHandle() {
  if (!getSqliteHandle) throw new Error('db not initialized');
  return getSqliteHandle();
}

async function callCorrect(accountId: string, executionId: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const res = await route.POST(
    new NextRequestCtor(`http://localhost:3000/api/accounts/${accountId}/executions/${executionId}/correct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: accountId, executionId }) },
  );
  return { status: res.status, data: await res.json() };
}

function seedAccount(): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db!.insert(schema.accounts)
    .values({ id, name: 'A8 Test', broker: null, currency: 'USD', isActive: true, maxRiskPerTradePct: null, defaultCommission: null, startingBalance: null, createdAt: now, updatedAt: now } as typeof schema.accounts.$inferInsert)
    .run();
  return id;
}

function seedOpening(accountId: string, amount = '10000.00'): void {
  if (!postFinancialEventFn) throw new Error('postFinancialEvent not initialized');
  postFinancialEventFn(requireHandle(), {
    accountId,
    eventType: 'opening_balance',
    amount,
    description: 'Opening balance',
    payload: JSON.stringify({ amount }),
    effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount, amountMicros: Math.round(Number(amount) * 1_000_000) }),
    postedAt: new Date().toISOString(),
  } as never);
}

function count(table: string, whereClause?: string): number {
  const where = whereClause ? ` WHERE ${whereClause}` : '';
  const row = requireHandle().prepare(`SELECT count(*) AS n FROM ${table}${where}`).get() as { n: number };
  return row.n;
}

function netCash(accountId: string): number | null {
  const row = requireHandle().prepare('SELECT net_cash FROM account_performance WHERE account_id = ?').get(accountId) as { net_cash: string } | undefined;
  return row ? Number(row.net_cash) : null;
}

function armPerformanceTrigger(): void {
  requireHandle().exec(`
    CREATE TRIGGER a8_perf_fail BEFORE INSERT ON account_performance
    BEGIN SELECT RAISE(ABORT, 'a8: performance write blocked'); END;
  `);
}
function disarmPerformanceTrigger(): void {
  requireHandle().exec('DROP TRIGGER IF EXISTS a8_perf_fail;');
}
function armPositionTrigger(): void {
  requireHandle().exec(`
    CREATE TRIGGER a8_pos_fail BEFORE INSERT ON account_positions
    BEGIN SELECT RAISE(ABORT, 'a8: position write blocked'); END;
  `);
}
function disarmPositionTrigger(): void {
  requireHandle().exec('DROP TRIGGER IF EXISTS a8_pos_fail;');
}

async function main() {
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;
  const routeMod = await import('../route');
  route = routeMod as RouteModule;
  const { NextRequest: NR } = await import('next/server');
  NextRequestCtor = NR;
  const postingMod = await import('@/lib/accounting/posting');
  postFinancialEventFn = postingMod.postFinancialEvent;
  const postingExec = await import('@/lib/accounting/execution-posting');
  postExecutionFillFn = postingExec.postExecutionFill;

  const h = requireHandle();
  h.exec('PRAGMA foreign_keys = OFF;');
  h.exec(`
    DELETE FROM ledger_postings; DELETE FROM ledger_entries; DELETE FROM financial_events;
    DELETE FROM correction_lineage; DELETE FROM lot_matches; DELETE FROM fifo_lots;
    DELETE FROM account_positions; DELETE FROM accounting_executions; DELETE FROM account_performance;
    DELETE FROM trades; DELETE FROM accounts; DELETE FROM instruments;
  `);
  h.exec('PRAGMA foreign_keys = ON;');

  // ── 1. §19 normal success: 200, all surfaces coherent ───────────────
  console.log('\n1. §19 direct correction success (buy 100@50 f10 → 80@49 f7):');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const fill = postExecutionFillFn!(requireHandle(), { accountId, symbol: 'AAPL', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', postedAt: new Date().toISOString() });
    const r = await callCorrect(accountId, fill.execution.id, {
      symbol: 'AAPL', action: 'buy', quantity: '80.00', price: '49.00', fees: '7.00', reason: 'A8 success',
    });
    assertEqual(r.status, 200, '200');
    const data = r.data as { correction: Record<string, unknown>; reversalExecution: Record<string, unknown>; replacementExecution: Record<string, unknown>; position: { quantity: string; averageCost: string } | null };
    assertEqual((data.correction.originalExecutionId as string), fill.execution.id, 'lineage links original');
    assertEqual(data.reversalExecution.action as string, 'sell', 'reversal = sell');
    assertEqual(data.replacementExecution.fees as string, '7.00', 'replacement fee 7');
    assertEqual(data.position!.quantity, '80.00', 'position 80');
    assertEqual(data.position!.averageCost, '49.00', 'position avg cost 49');
    // Cash: 10000 - 5000 - 10 + 5000 + 10 (reversal) - 3920 - 7 (replacement) = 6073
    assertEqual(netCash(accountId), 6073, 'net cash coherent (6073)');
    assertEqual(count('correction_lineage', `account_id = '${accountId}'`), 1, 'one lineage row');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), 3, 'original + reversal + replacement');
  }

  // ── 2. §20 performance-failure rollback ──────────────────────────────
  console.log('\n2. §20 performance failure → full rollback (500):');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const fill = postExecutionFillFn!(requireHandle(), { accountId, symbol: 'AAPL', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', postedAt: new Date().toISOString() });
    const before = {
      execs: count('accounting_executions', `account_id = '${accountId}'`),
      events: count('financial_events', `account_id = '${accountId}'`),
      lineage: count('correction_lineage', `account_id = '${accountId}'`),
      lots: count('fifo_lots', `account_id = '${accountId}'`),
      positions: count('account_positions', `account_id = '${accountId}'`),
      perf: count('account_performance', `account_id = '${accountId}'`),
    };
    armPerformanceTrigger();
    const r = await callCorrect(accountId, fill.execution.id, { symbol: 'AAPL', action: 'buy', quantity: '80.00', price: '49.00', fees: '7.00', reason: 'A8 perf fail' });
    disarmPerformanceTrigger();
    assertEqual(r.status, 500, '500');
    assertEqual((r.data as { code: string }).code, 'EXECUTION_CORRECTION_PROJECTION_FAILED', 'stable code');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), before.execs, 'no reversal/replacement executions');
    assertEqual(count('financial_events', `account_id = '${accountId}'`), before.events, 'no fee/refund/gross events');
    assertEqual(count('correction_lineage', `account_id = '${accountId}'`), before.lineage, 'no lineage');
    assertEqual(count('fifo_lots', `account_id = '${accountId}'`), before.lots, 'FIFO unchanged');
    assertEqual(count('account_positions', `account_id = '${accountId}'`), before.positions, 'position unchanged');
    assertEqual(count('account_performance', `account_id = '${accountId}'`), before.perf, 'performance unchanged');
  }

  // ── 3. §21 FIFO-failure rollback ─────────────────────────────────────
  console.log('\n3. §21 FIFO failure → full rollback (500):');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const fill = postExecutionFillFn!(requireHandle(), { accountId, symbol: 'MSFT', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', postedAt: new Date().toISOString() });
    const beforeExecs = count('accounting_executions', `account_id = '${accountId}'`);
    const beforeEvents = count('financial_events', `account_id = '${accountId}'`);
    armPositionTrigger();
    const r = await callCorrect(accountId, fill.execution.id, { symbol: 'MSFT', action: 'buy', quantity: '80.00', price: '49.00', fees: '7.00', reason: 'A8 fifo fail' });
    disarmPositionTrigger();
    assertEqual(r.status, 500, '500');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), beforeExecs, 'no executions');
    assertEqual(count('financial_events', `account_id = '${accountId}'`), beforeEvents, 'no events');
  }

  // ── 4. §17 idempotency retry (X: 500 → 200 → 409) ────────────────────
  console.log('\n4. §17 correction idempotency retryable after rollback:');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const fill = postExecutionFillFn!(requireHandle(), { accountId, symbol: 'NFLX', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', postedAt: new Date().toISOString() });
    const key = randomUUID();
    armPerformanceTrigger();
    const first = await callCorrect(accountId, fill.execution.id, { symbol: 'NFLX', action: 'buy', quantity: '80.00', price: '49.00', fees: '7.00', reason: 'A8 retry', idempotencyKey: key });
    disarmPerformanceTrigger();
    assertEqual(first.status, 500, 'attempt 1 → 500');
    assertEqual(count('correction_lineage', `account_id = '${accountId}'`), 0, 'no lineage committed');

    const second = await callCorrect(accountId, fill.execution.id, { symbol: 'NFLX', action: 'buy', quantity: '80.00', price: '49.00', fees: '7.00', reason: 'A8 retry', idempotencyKey: key });
    assertEqual(second.status, 200, 'attempt 2 same key → 200 (key reusable)');
    assertEqual(count('correction_lineage', `account_id = '${accountId}'`), 1, 'one lineage after retry');

    const third = await callCorrect(accountId, fill.execution.id, { symbol: 'NFLX', action: 'buy', quantity: '80.00', price: '49.00', fees: '7.00', reason: 'A8 retry', idempotencyKey: key });
    assertEqual(third.status, 409, 'attempt 3 → 409 duplicate key');
    assertEqual(count('correction_lineage', `account_id = '${accountId}'`), 1, 'still one lineage');
  }

  // ── 5. §11 fee rollback: original fee survives; refund/replacement roll back ──
  console.log('\n5. §11 fee rollback (original -10 intact, no refund, no replacement fee):');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const fill = postExecutionFillFn!(requireHandle(), { accountId, symbol: 'AMD', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', postedAt: new Date().toISOString() });
    const feeEventsBefore = count('financial_events', `account_id = '${accountId}' AND event_type = 'fee'`);
    armPerformanceTrigger();
    const r = await callCorrect(accountId, fill.execution.id, { symbol: 'AMD', action: 'buy', quantity: '80.00', price: '49.00', fees: '7.00', reason: 'A8 fee rollback' });
    disarmPerformanceTrigger();
    assertEqual(r.status, 500, '500');
    assertEqual(count('financial_events', `account_id = '${accountId}' AND event_type = 'fee'`), feeEventsBefore, 'only the original fee event survives (no replacement fee)');
    assertEqual(count('financial_events', `account_id = '${accountId}' AND event_type = 'manual_adjustment'`), 0, 'no refund posted');
    // The correction's own projection rebuild never persisted (trigger), and
    // no correction economics survive — only the original fill state remains.
    assertEqual(count('account_performance', `account_id = '${accountId}'`), 0, 'no performance projection from the failed correction');
    assertEqual(count('correction_lineage', `account_id = '${accountId}'`), 0, 'no lineage');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), 1, 'only the original execution');
  }

  // ── 6. §8/§19 symbol-changing correction: both instruments rebuilt ───
  console.log('\n6. symbol-changing correction (AAPL buy → MSFT buy) rebuilds both instruments:');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const fill = postExecutionFillFn!(requireHandle(), { accountId, symbol: 'AAPL', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', postedAt: new Date().toISOString() });
    const r = await callCorrect(accountId, fill.execution.id, { symbol: 'MSFT', action: 'buy', quantity: '100.00', price: '52.00', fees: '5.00', reason: 'A8 symbol change' });
    assertEqual(r.status, 200, '200');
    const data = r.data as { position: { quantity: string; averageCost: string } | null };
    assertEqual(data.position!.quantity, '100.00', 'replacement position 100');
    assertEqual(data.position!.averageCost, '52.00', 'replacement avg 52');
    // Original instrument (AAPL) is flat (reversal consumed it).
    const aaplLots = count('fifo_lots', `account_id = '${accountId}' AND instrument_id IN (SELECT id FROM instruments WHERE symbol = 'AAPL')`);
    const msftLots = count('fifo_lots', `account_id = '${accountId}' AND instrument_id IN (SELECT id FROM instruments WHERE symbol = 'MSFT')`);
    assertEqual(aaplLots, 0, 'AAPL stream flat after reversal (no open lots)');
    assertEqual(msftLots, 1, 'MSFT stream has one open lot');
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) { console.error(`         ${failed}/${total} FAILED\n`); process.exit(1); }
  else { console.log('         All tests passed!\n'); }
}

const mainPromise = main();
if (typeof test !== 'undefined') {
  test('standalone account-correction A8 handler harness (assertions run at import)', async () => {
    await mainPromise;
    if (failed > 0) throw new Error(`         ${failed}/${passed + failed} FAILED`);
    console.log('         All tests passed!');
  });
} else {
  mainPromise.catch((e) => { console.error('a8 test: unexpected error', e); process.exit(1); });
}
