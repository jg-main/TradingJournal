/**
 * account-executions-a7.test.ts — REAL handler invocation (M002-A7)
 *
 * POST /api/accounts/[id]/executions must post the immutable accounting
 * execution, all cash/fee effects, the FIFO projection, and the
 * account-performance projection as ONE atomic transaction. HTTP 201 means
 * every projection succeeded; any projection failure rolls back the source
 * execution and leaves the idempotency key retryable.
 *
 * Deterministic real-DB failures are forced with SQLite triggers
 * (RAISE(ABORT)) — never mocked ordering.
 *
 * Run: npx tsx src/app/api/accounts/\[id\]/executions/__tests__/a7-atomicity.test.ts
 *      (also registered in vitest.config.ts include)
 */
/// <reference types="vitest/globals" />

// ── 0. Node/tsx runtime shims ─────────────────────────────────────────────
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

const TEST_DB_FILE = testDbPath('account-executions-a7');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ── 1. Static imports ─────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
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

type RouteModule = { POST: (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse> };
let route: RouteModule | null = null;
let NextRequestCtor: typeof NextRequest | null = null;
let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => import('better-sqlite3').Database) | null = null;

function requireHandle() {
  if (!getSqliteHandle) throw new Error('db not initialized');
  return getSqliteHandle();
}

async function callPost(accountId: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const res = await route.POST(
    new NextRequestCtor(`http://localhost:3000/api/accounts/${accountId}/executions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: accountId }) },
  );
  return { status: res.status, data: await res.json() };
}

function seedAccount(): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db!.insert(schema.accounts)
    .values({ id, name: 'A7 Test', broker: null, currency: 'USD', isActive: true, maxRiskPerTradePct: null, defaultCommission: null, startingBalance: null, createdAt: now, updatedAt: now } as typeof schema.accounts.$inferInsert)
    .run();
  return id;
}

let postFinancialEventFn: ((sqlite: import('better-sqlite3').Database, input: import('@/lib/accounting/posting').PostFinancialEventInput) => { event: { id: string } }) | null = null;
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
  });
}

function count(table: string, whereClause?: string): number {
  const h = requireHandle();
  const where = whereClause ? ` WHERE ${whereClause}` : '';
  const row = h.prepare(`SELECT count(*) AS n FROM ${table}${where}`).get() as { n: number };
  return row.n;
}

function netCash(accountId: string): number | null {
  const h = requireHandle();
  const row = h.prepare('SELECT net_cash FROM account_performance WHERE account_id = ?').get(accountId) as { net_cash: string } | undefined;
  return row ? Number(row.net_cash) : null;
}

/** Force a deterministic real-DB failure on the next account_performance write. */
function armPerformanceTrigger(): void {
  requireHandle().exec(`
    CREATE TRIGGER a7_perf_fail BEFORE INSERT ON account_performance
    BEGIN SELECT RAISE(ABORT, 'a7: performance write blocked'); END;
  `);
}
function disarmPerformanceTrigger(): void {
  requireHandle().exec('DROP TRIGGER IF EXISTS a7_perf_fail;');
}
/** Force a deterministic real-DB failure on the next account_positions write. */
function armPositionTrigger(): void {
  requireHandle().exec(`
    CREATE TRIGGER a7_pos_fail BEFORE INSERT ON account_positions
    BEGIN SELECT RAISE(ABORT, 'a7: position write blocked'); END;
  `);
}
function disarmPositionTrigger(): void {
  requireHandle().exec('DROP TRIGGER IF EXISTS a7_pos_fail;');
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

  const h = requireHandle();
  h.exec('PRAGMA foreign_keys = OFF;');
  h.exec(`
    DELETE FROM ledger_postings; DELETE FROM ledger_entries; DELETE FROM financial_events;
    DELETE FROM lot_matches; DELETE FROM fifo_lots; DELETE FROM account_positions;
    DELETE FROM accounting_executions; DELETE FROM account_performance; DELETE FROM trades;
    DELETE FROM accounts; DELETE FROM instruments;
  `);
  h.exec('PRAGMA foreign_keys = ON;');

  // ── 1. §27 normal success: 201 + coherent surfaces ──────────────────
  console.log('\n1. §27 normal direct execution success (buy 100@50 fee 10):');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const r = await callPost(accountId, { symbol: 'AAPL', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00' });
    assertEqual(r.status, 201, '201 created');
    const data = r.data as Record<string, unknown>;
    assertEqual((data.execution as Record<string, unknown>).fees, '10.00', 'execution fees persisted');
    assertEqual(netCash(accountId), 4990, 'net cash 4990 (10000 - 5000 - 10)');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), 1, 'one accounting execution');
    assertEqual(count('financial_events', `account_id = '${accountId}'`), 3, 'opening + gross + fee events');
    assertEqual(count('fifo_lots', `account_id = '${accountId}'`), 1, 'one FIFO lot');
    assertEqual(count('account_positions', `account_id = '${accountId}'`), 1, 'one account position');
    assertEqual(count('account_performance', `account_id = '${accountId}'`), 1, 'performance projection persisted');
  }

  // ── 2. §15/§17/§26 performance-failure rollback ─────────────────────
  console.log('\n2. §15 performance-failure → full rollback (500):');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const before = {
      executions: count('accounting_executions', `account_id = '${accountId}'`),
      events: count('financial_events', `account_id = '${accountId}'`),
      postings: count('ledger_postings', `account_id = '${accountId}'`),
      lots: count('fifo_lots', `account_id = '${accountId}'`),
      matches: count('lot_matches', `lot_id IN (SELECT id FROM fifo_lots WHERE account_id = '${accountId}')`),
      positions: count('account_positions', `account_id = '${accountId}'`),
    };
    armPerformanceTrigger();
    const r = await callPost(accountId, { symbol: 'MSFT', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00' });
    disarmPerformanceTrigger();
    assertEqual(r.status, 500, '500 projection failure');
    assertEqual((r.data as { code: string }).code, 'ACCOUNT_EXECUTION_PROJECTION_FAILED', 'stable code');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), before.executions, 'no execution committed');
    assertEqual(count('financial_events', `account_id = '${accountId}'`), before.events, 'no gross/fee event committed');
    assertEqual(count('ledger_postings', `account_id = '${accountId}'`), before.postings, 'no ledger postings committed');
    assertEqual(count('fifo_lots', `account_id = '${accountId}'`), before.lots, 'no FIFO lot committed');
    assertEqual(count('lot_matches', `lot_id IN (SELECT id FROM fifo_lots WHERE account_id = '${accountId}')`), before.matches, 'no lot match committed');
    assertEqual(count('account_positions', `account_id = '${accountId}'`), before.positions, 'no account position committed');
  }

  // ── 3. §14 FIFO-failure rollback ────────────────────────────────────
  console.log('\n3. §14 FIFO rebuild failure → full rollback (500):');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const before = {
      executions: count('accounting_executions', `account_id = '${accountId}'`),
      events: count('financial_events', `account_id = '${accountId}'`),
      postings: count('ledger_postings', `account_id = '${accountId}'`),
    };
    armPositionTrigger();
    const r = await callPost(accountId, { symbol: 'NFLX', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00' });
    disarmPositionTrigger();
    assertEqual(r.status, 500, '500 projection failure');
    assertEqual((r.data as { code: string }).code, 'ACCOUNT_EXECUTION_PROJECTION_FAILED', 'stable code');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), before.executions, 'no execution committed');
    assertEqual(count('financial_events', `account_id = '${accountId}'`), before.events, 'no events committed (incl. fee)');
    assertEqual(count('ledger_postings', `account_id = '${accountId}'`), before.postings, 'no ledger committed');
  }

  // ── 4. §16/§28 retry: key X survives a rolled-back failure ──────────
  console.log('\n4. §28 idempotency key retryable after rollback (X: 500 → 201 → 409):');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const key = randomUUID();
    armPerformanceTrigger();
    const first = await callPost(accountId, { symbol: 'GOOG', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', idempotencyKey: key });
    disarmPerformanceTrigger();
    assertEqual(first.status, 500, 'attempt 1 → 500');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), 0, 'nothing committed');

    const second = await callPost(accountId, { symbol: 'GOOG', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', idempotencyKey: key });
    assertEqual(second.status, 201, 'attempt 2 same key → 201 (key reusable)');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), 1, 'exactly one execution');

    const third = await callPost(accountId, { symbol: 'GOOG', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00', idempotencyKey: key });
    assertEqual(third.status, 409, 'attempt 3 same key → 409 duplicate');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), 1, 'still exactly one execution');
    assertEqual(netCash(accountId), 4990, 'cash reflects exactly one fee deduction');
  }

  // ── 5. §18 position-projection rollback leaves prior state intact ───
  console.log('\n5. §18 existing position + failed close → prior projection unchanged:');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    // Open a long position first.
    const open = await callPost(accountId, { symbol: 'AMD', action: 'buy', quantity: '100.00', price: '50.00', fees: '10.00' });
    assertEqual(open.status, 201, 'opening execution succeeds');
    const posBefore = requireHandle().prepare('SELECT quantity, realized_fees FROM account_positions WHERE account_id = ?').get(accountId) as { quantity: string; realized_fees: string };
    const lotsBefore = count('fifo_lots', `account_id = '${accountId}'`);

    // Close 40 @ 55 fee 4, forcing the performance rebuild to fail.
    armPerformanceTrigger();
    const close = await callPost(accountId, { symbol: 'AMD', action: 'sell', quantity: '40.00', price: '55.00', fees: '4.00' });
    disarmPerformanceTrigger();
    assertEqual(close.status, 500, 'failed close → 500');

    const posAfter = requireHandle().prepare('SELECT quantity, realized_fees FROM account_positions WHERE account_id = ?').get(accountId) as { quantity: string; realized_fees: string };
    assertEqual(posAfter.quantity, posBefore.quantity, 'position quantity unchanged (still 100)');
    assertEqual(posAfter.realized_fees, posBefore.realized_fees, 'realized fees unchanged (still 0)');
    assertEqual(count('fifo_lots', `account_id = '${accountId}'`), lotsBefore, 'FIFO lots unchanged');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`), 1, 'only the opening execution remains');
  }

  // ── 5b. §13/§31 short Add atomic with A5+A6 semantics (+900 gross, -3 fee) ──
  console.log('\n5b. §31 short add 20@45 fee 3 → sell_short, net +897, committed atomically:');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    // Open a short position first (100 @ 50 fee 0).
    const open = await callPost(accountId, { symbol: 'SHORT7', action: 'sell_short', quantity: '100.00', price: '50.00' });
    assertEqual(open.status, 201, 'short opening succeeds');
    const cashAfterOpen = netCash(accountId);
    assertEqual(cashAfterOpen, 15000, 'cash 15000 after sell_short 100@50');

    const add = await callPost(accountId, { symbol: 'SHORT7', action: 'add', quantity: '20.00', price: '45.00', fees: '3.00' });
    assertEqual(add.status, 201, 'short add succeeds');
    assertEqual((add.data as { execution: { action: string } }).execution.action, 'sell_short', 'A5: add resolves to sell_short');
    assertEqual(netCash(accountId), 15897, 'net +897 (15000 + 900 - 3)');
    const pos = requireHandle().prepare('SELECT quantity FROM account_positions WHERE account_id = ?').get(accountId) as { quantity: string };
    assertEqual(pos.quantity, '120.00', 'short position increased to 120');
  }

  // ── 6. §29 preflight rejection preserved (422, zero mutation) ────────
  console.log('\n6. §29 over-close preflight → 422, zero mutation:');
  {
    const accountId = seedAccount();
    seedOpening(accountId);
    const before = count('accounting_executions', `account_id = '${accountId}'`) + count('financial_events', `account_id = '${accountId}'`);
    const r = await callPost(accountId, { symbol: 'TSLA', action: 'sell', quantity: '10.00', price: '100.00' });
    assertEqual(r.status, 422, '422 FIFO preflight rejection');
    assertEqual(count('accounting_executions', `account_id = '${accountId}'`) + count('financial_events', `account_id = '${accountId}'`), before, 'no mutation');
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
  test('standalone account-executions A7 handler harness (assertions run at import)', async () => {
    await mainPromise;
    if (failed > 0) throw new Error(`         ${failed}/${passed + failed} FAILED`);
    console.log('         All tests passed!');
  });
} else {
  mainPromise.catch((e) => { console.error('a7 test: unexpected error', e); process.exit(1); });
}
