/**
 * account-executions-a5.test.ts — REAL handler invocation (M002-A5 §43)
 *
 * POST /api/accounts/[id]/executions resolves generic management aliases
 * (add/reduce) to concrete economic actions from the CURRENT canonical
 * position direction BEFORE posting:
 *
 *   long + add     → buy
 *   long + reduce  → sell
 *   short + add    → sell_short
 *   short + reduce → buy_to_cover
 *
 * With no resolvable position direction, add/reduce are REJECTED (400
 * AMBIGUOUS_EXECUTION_ACTION) — the accounting boundary never guesses.
 * Concrete actions pass through unchanged.
 *
 * Run: npx tsx src/app/api/accounts/\[id\]/executions/__tests__/a5-economic-action.test.ts
 *      (also registered in vitest.config.ts include)
 */
/// <reference types="vitest/globals" />

// ── 0. Node/tsx runtime shims (server-only short-circuit, test DB) ──────
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

const TEST_DB_FILE = testDbPath('account-executions-a5');
process.env.DB_FILE_NAME = TEST_DB_FILE;

// ── 1. Static imports ─────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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

type RouteModule = { POST: (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse> };
let route: RouteModule | null = null;
let NextRequestCtor: typeof NextRequest | null = null;
let db: (typeof import('@/db'))['db'] | null = null;
let getSqliteHandle: (() => import('better-sqlite3').Database) | null = null;

function requireDb() {
  if (!db || !getSqliteHandle) throw new Error('db not initialized');
  return { db, getSqliteHandle };
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
  requireDb().db.insert(schema.accounts)
    .values({ id, name: 'A5 Test', broker: null, currency: 'USD', isActive: true, maxRiskPerTradePct: null, defaultCommission: null, startingBalance: null, createdAt: now, updatedAt: now } as typeof schema.accounts.$inferInsert)
    .run();
  return id;
}

function seedInstrument(symbol: string): string {
  const h = requireDb().getSqliteHandle();
  const existing = h.prepare('SELECT id FROM instruments WHERE symbol = ?').get(symbol) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  h.prepare('INSERT INTO instruments (id, symbol, name) VALUES (?, ?, ?)').run(id, symbol, symbol);
  return id;
}

/** Post a concrete first fill directly (establishes the position direction). */
function seedPosition(accountId: string, symbol: string, action: string, quantity: string, price: string): void {
  const h = requireDb().getSqliteHandle();
  const instrumentId = seedInstrument(symbol);
  const id = randomUUID();
  h.prepare(
    `INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key, journal_trade_id, description, posted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '0.00', NULL, NULL, NULL, ?, ?)`,
  ).run(id, accountId, instrumentId, action, quantity, price, new Date().toISOString(), new Date().toISOString());
  h.prepare(
    `INSERT INTO account_positions (id, account_id, instrument_id, direction, quantity, average_cost, total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl, last_updated, created_at)
     VALUES (?, ?, ?, ?, ?, '0.00', '0.00', '0.00', '0.00', '0.00', ?, ?)`,
  ).run(randomUUID(), accountId, instrumentId, action === 'sell_short' ? 'short' : 'long', quantity, new Date().toISOString(), new Date().toISOString());
  // Matching FIFO lot so close-type preflight allocations succeed.
  h.prepare(
    `INSERT INTO fifo_lots (id, account_id, instrument_id, direction, remaining_quantity, original_quantity, entry_price, cost_basis_total, allocated_fees, opening_execution_id, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '0.00', '0.00', ?, ?)`,
  ).run(randomUUID(), accountId, instrumentId, action === 'sell_short' ? 'short' : 'long', quantity, quantity, price, id, new Date().toISOString());
}

function accountingActionFor(accountId: string, instrumentSymbol: string): string | null {
  const h = requireDb().getSqliteHandle();
  const instrumentId = seedInstrument(instrumentSymbol);
  const row = h
    .prepare(
      `SELECT action FROM accounting_executions WHERE account_id = ? AND instrument_id = ?
       ORDER BY posted_at DESC, created_at DESC LIMIT 1`,
    )
    .get(accountId, instrumentId) as { action: string } | undefined;
  return row?.action ?? null;
}

function netCash(accountId: string): number {
  const h = requireDb().getSqliteHandle();
  const row = h.prepare('SELECT net_cash FROM account_performance WHERE account_id = ?').get(accountId) as { net_cash: string } | undefined;
  return row ? Number(row.net_cash) : Number.NaN;
}

async function main() {
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;
  const routeMod = await import('../route');
  route = routeMod as RouteModule;
  const { NextRequest: NR } = await import('next/server');
  NextRequestCtor = NR;

  // Clean slate
  const h = getSqliteHandle();
  h.exec('PRAGMA foreign_keys = OFF;');
  h.exec(`
    DELETE FROM ledger_postings; DELETE FROM ledger_entries; DELETE FROM financial_events;
    DELETE FROM account_positions; DELETE FROM accounting_executions; DELETE FROM trades;
    DELETE FROM accounts; DELETE FROM instruments;
  `);
  h.exec('PRAGMA foreign_keys = ON;');

  // ── 1. Short position: add resolves to sell_short (cash INCREASE) ────
  console.log('\n1. short + add → sell_short, cash increases:');
  {
    const accountId = seedAccount();
    seedPosition(accountId, 'SHORT1', 'sell_short', '100.00', '50.00');
    const r = await callPost(accountId, { symbol: 'SHORT1', action: 'add', quantity: '20.00', price: '45.00' });
    assertEqual(r.status, 201, '201 created');
    assertEqual(accountingActionFor(accountId, 'SHORT1'), 'sell_short', 'accounting action = sell_short');
    assertEqual(netCash(accountId), 900, 'cash +900 (never -900)');
  }

  // ── 2. Short position: reduce resolves to buy_to_cover (cash DECREASE) ─
  console.log('\n2. short + reduce → buy_to_cover, cash decreases:');
  {
    const accountId = seedAccount();
    seedPosition(accountId, 'SHORT2', 'sell_short', '100.00', '50.00');
    const r = await callPost(accountId, { symbol: 'SHORT2', action: 'reduce', quantity: '20.00', price: '40.00' });
    assertEqual(r.status, 201, '201 created');
    assertEqual(accountingActionFor(accountId, 'SHORT2'), 'buy_to_cover', 'accounting action = buy_to_cover');
    assertEqual(netCash(accountId), -800, 'cash -800 (never +800)');
  }

  // ── 3. Long position: add → buy, reduce → sell ────────────────────────
  console.log('\n3. long + add → buy; long + reduce → sell:');
  {
    const accountId = seedAccount();
    seedPosition(accountId, 'LONG1', 'buy', '100.00', '50.00');
    const r1 = await callPost(accountId, { symbol: 'LONG1', action: 'add', quantity: '20.00', price: '45.00' });
    assertEqual(r1.status, 201, 'add 201');
    assertEqual(accountingActionFor(accountId, 'LONG1'), 'buy', 'accounting action = buy');
    const r2 = await callPost(accountId, { symbol: 'LONG1', action: 'reduce', quantity: '20.00', price: '55.00' });
    assertEqual(r2.status, 201, 'reduce 201');
    assertEqual(accountingActionFor(accountId, 'LONG1'), 'sell', 'accounting action = sell');
  }

  // ── 4. No position: add/reduce rejected, no guess ─────────────────────
  console.log('\n4. no position + add → 400 AMBIGUOUS_EXECUTION_ACTION:');
  {
    const accountId = seedAccount();
    const r = await callPost(accountId, { symbol: 'FLAT1', action: 'add', quantity: '20.00', price: '45.00' });
    assertEqual(r.status, 400, '400 rejected');
    assertEqual((r.data as { code: string }).code, 'AMBIGUOUS_EXECUTION_ACTION', 'stable code');
    // No accounting row created.
    const h2 = getSqliteHandle();
    const n = (h2.prepare('SELECT count(*) AS n FROM accounting_executions WHERE account_id = ?').get(accountId) as { n: number }).n;
    assertEqual(n, 0, 'no accounting execution created');
  }

  // ── 5. Concrete actions pass through unchanged ────────────────────────
  console.log('\n5. concrete sell_short on flat account → 201 (unambiguous):');
  {
    const accountId = seedAccount();
    const r = await callPost(accountId, { symbol: 'DIRECT1', action: 'sell_short', quantity: '10.00', price: '100.00' });
    assertEqual(r.status, 201, '201 created');
    assertEqual(accountingActionFor(accountId, 'DIRECT1'), 'sell_short', 'action preserved');
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
  test('standalone account-executions A5 handler harness (assertions run at import)', async () => {
    await mainPromise;
    if (failed > 0) throw new Error(`         ${failed}/${passed + failed} FAILED`);
    console.log('         All tests passed!');
  });
} else {
  mainPromise.catch((e) => { console.error('a5 test: unexpected error', e); process.exit(1); });
}
