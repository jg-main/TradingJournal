/**
 * trade execute route test (S03/T03 — shared P1/P2 test mirror)
 *
 * Tests POST /api/trades/[id]/execute (batch entry + exit creation) against
 * the REAL route handler. This file is the shared P1/P2 mirror: it pins the
 * bulk-execution contract that both the legacy P1 path and the P2
 * individual-fill path must honor, and it exercises the actual route module
 * (imported dynamically) rather than a re-implementation. The S03 engine
 * owns execution logic; this suite verifies the route still honors the
 * documented request/response contract through the real HTTP surface.
 *
 * Run: npx tsx src/app/api/trades/[id]/execute/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/[id]/execute/__tests__/route.test.ts`)
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
process.env.DB_FILE_NAME = testDbPath('execute-route');

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

// ── Route invocation helper (REAL handler, REAL NextRequest) ─────────

async function callPost(
  tradeId: string,
  body: string | Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  if (!route || !NextRequestCtor) throw new Error('route not initialized');
  const url = `http://localhost:3000/api/trades/${tradeId}/execute`;
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
  const sqlite = requireDb().getSqliteHandle();
  // The ledger/accounting tables are protected by migration-level immutability
  // triggers (0024/0026/0029/0035) that block UPDATE/DELETE. Drop them for the
  // test DB so inter-case cleanup can DELETE; the routes/engine only INSERT or
  // rebuild replaceable projections, so the test flow is unaffected.
  sqlite.exec(`
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
    DROP TRIGGER IF EXISTS trg_fe_correction_lineage_prevent_update;
    DROP TRIGGER IF EXISTS trg_fe_correction_lineage_prevent_delete;
    DROP TRIGGER IF EXISTS trg_valuation_marks_prevent_update;
    DROP TRIGGER IF EXISTS trg_valuation_marks_prevent_delete;
  `);
  sqlite.exec('PRAGMA foreign_keys = OFF;');
  sqlite.exec(`
    DELETE FROM ledger_postings;
    DELETE FROM ledger_entries;
    DELETE FROM financial_events;
    DELETE FROM valuation_marks;
    DELETE FROM correction_lineage;
    DELETE FROM financial_event_correction_lineage;
    DELETE FROM lot_matches;
    DELETE FROM fifo_lots;
    DELETE FROM account_positions;
    DELETE FROM accounting_executions;
    DELETE FROM account_performance;
    DELETE FROM account_rollforward;
    DELETE FROM account_transactions;
    DELETE FROM trade_check_results;
    DELETE FROM trade_risk_snapshots;
    DELETE FROM trade_executions;
    DELETE FROM trade_stop_adjustments;
    DELETE FROM trades;
    DELETE FROM checklist_definitions;
    DELETE FROM lookup_values;
    DELETE FROM setup_definitions;
    DELETE FROM instruments;
    DELETE FROM settings;
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
      // T04: execution requires a trading-ready account (risk params +
      // commission + opening cash). Default the seed to fully configured so
      // existing cases exercise the gates without tripping them; negative
      // paths override these explicitly.
      maxRiskPerTradePct: 10,
      defaultCommission: 1.0,
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

function seedCheckDefinition(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.checklistDefinitions)
    .values({
      id,
      description: 'Default check description',
      isRequired: true,
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.checklistDefinitions.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

/** Replace the single-row settings table (raw insert — mirrors the engine). */
function seedSettings(startingAccountValue: number | null): void {
  requireDb().getSqliteHandle()
    .prepare(
      `INSERT OR REPLACE INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission)
       VALUES ('default', ?, ?, 1)`,
    )
    .run(startingAccountValue, null);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Tests — each block invokes the REAL route handler
// ────────────────────────────────────────────────────────────────────────────

function countExecs(where: string, param: string): number {
  return (
    requireDb().getSqliteHandle().prepare(`SELECT count(*) AS count FROM trade_executions WHERE ${where}`).get(param) as { count: number }
  ).count;
}
function countAcct(where: string, param: string): number {
  return (
    requireDb().getSqliteHandle().prepare(`SELECT count(*) AS count FROM accounting_executions WHERE ${where}`).get(param) as { count: number }
  ).count;
}
function countFinancialEvents(where: string, param: string): number {
  return (
    requireDb().getSqliteHandle().prepare(`SELECT count(*) AS count FROM financial_events WHERE ${where}`).get(param) as { count: number }
  ).count;
}

async function main(): Promise<void> {
  // Load the real modules AFTER the env var is set so @/db initializes
  // against DB_FILE_NAME with all migrations auto-applied.
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  const nextMod = await import('next/server');
  NextRequestCtor = nextMod.NextRequest;

  const routeMod = await import('../route');
  route = routeMod as unknown as RouteModule;

  let routePath = '../route.ts';
  try {
    // fileURLToPath only works under tsx (file: URL); vitest's jsdom base
    // URL is http://localhost, so the diagnostic falls back gracefully.
    routePath = fileURLToPath(new URL('../route.ts', import.meta.url)).replace(`${process.cwd()}/`, '');
  } catch {
    // keep the default label
  }

  console.log('\n--- Trade Execute API Tests (real route handler) ---\n');
  console.log(`  Route module: ${routePath}`);
  console.log(`  DB: ${process.env.DB_FILE_NAME} (real migrated schema)`);
  console.log(`  POST handler source: ${route.POST.toString().slice(0, 64)}…`);

  // ── 1. Entry-only creates 1 execution, trade becomes 'open', risk snapshot created ─

  console.log('\n1. Entry-only creates execution, trade becomes open:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      stopPrice: 145.0,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as { executions: unknown[]; trade: Record<string, unknown> };
    assertEqual(data.executions.length, 1, 'creates 1 execution');
    assertEqual((data.executions[0] as Record<string, unknown>).action, 'buy', 'entry action is buy');

    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status is open');
    assertNotNull(updatedTrade.openedAt, 'trade has openedAt');

    const snapshot = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .get() as Record<string, unknown> | undefined;
    assertNotNull(snapshot, 'risk snapshot created');
    assertEqual(snapshot!.initialEntryPrice, 150.0, 'entry price matches');
    assertEqual(snapshot!.initialStopPrice, 145.0, 'stop price matches');
    assertEqual(snapshot!.initialQuantity, 100, 'quantity matches');
  }

  // ── 2. Entry + partial exit keeps status open ───────────────────────

  console.log('\n2. Entry + partial exit keeps status open:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 50,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as { executions: unknown[] };
    assertEqual(data.executions.length, 2, 'creates 2 executions (entry + exit)');

    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'status stays open with partial exit');
    assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
  }

  // ── 3. Entry + full exit sets status to closed ──────────────────────

  console.log('\n3. Entry + full exit sets status to closed:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 100,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as { executions: unknown[] };
    assertEqual(data.executions.length, 2, 'creates 2 executions (entry + full exit)');

    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'closed', 'trade status is closed');
    assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
    assertNotNull(updatedTrade.closedAt, 'trade has closedAt');
  }

  // ── 4. Entry + 2 exits sums to full exit ────────────────────────────

  console.log('\n4. Entry + two exits sums to full exit:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 60,
      exit2Price: 155.0,
      exit2Quantity: 40,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as { executions: unknown[] };
    assertEqual(data.executions.length, 3, 'creates 3 executions (entry + exit1 + exit2)');

    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'closed', 'trade status is closed (full exit)');
  }

  // ── 5. Exit overflow returns 409 ─────────────────────────────────────

  console.log('\n5. Exit overflow returns 409:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 80,
      exit2Price: 155.0,
      exit2Quantity: 30,
    });

    assert(result.status === 409, 'returns 409 for exit overflow (over-exit)');
  }

  // ── 6. Short trade: sell_short entry → open ─────────────────────────

  console.log('\n6. Short trade with sell_short entry becomes open:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', direction: 'short' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as { executions: unknown[] };
    assertEqual(data.executions.length, 1, 'creates 1 execution');
    assertEqual((data.executions[0] as Record<string, unknown>).action, 'sell_short', 'action is sell_short');

    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status is open');
  }

  // ── 7. Short trade: sell_short + buy_to_cover full exit → closed ───

  console.log('\n7. Short trade with full exit becomes closed:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', direction: 'short' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 140.0,
      exit1Quantity: 100,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as { executions: unknown[] };
    assertEqual(data.executions.length, 2, 'creates 2 executions');
    assertEqual((data.executions[0] as Record<string, unknown>).action, 'sell_short', 'entry is sell_short');
    assertEqual((data.executions[1] as Record<string, unknown>).action, 'buy_to_cover', 'exit is buy_to_cover');

    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'closed', 'trade status is closed');
  }

  // ── 8. 404 for nonexistent trade ────────────────────────────────────

  console.log('\n8. 404 for nonexistent trade:');
  {
    cleanup();
    const result = await callPost('nonexistent-trade', {
      entryPrice: 150.0,
      entryQuantity: 100,
    });
    assert(result.status === 404, 'returns 404');
    assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
  }

  // ── 9. 400 for non-planned trade ────────────────────────────────────

  console.log('\n9. 400 for non-planned trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
    });

    assert(result.status === 400, 'returns 400 for non-planned trade');
    const data = result.data as { error: string };
    assert(data.error.includes('not in planned'), 'error mentions not planned');
  }

  // ── 10. 400 for deleted trade ───────────────────────────────────────

  console.log('\n10. 400 for deleted trade:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'deleted' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
    });

    assert(result.status === 400, 'returns 400 for deleted trade');
    const data = result.data as { error: string };
    assert(data.error.includes('deleted'), 'error mentions deleted');
  }

  // ── 11. Exit2 requires exit1 ────────────────────────────────────────

  console.log('\n11. Exit 2 requires exit 1:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit2Price: 160.0,
      exit2Quantity: 50,
    });

    assert(result.status === 400, 'returns 400 when exit2 without exit1');
  }

  // ── 12. Exit price without quantity returns 400 ─────────────────────

  console.log('\n12. Exit price without quantity returns 400:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
    });

    assert(result.status === 400, 'returns 400 when exit1Price without exit1Quantity');
  }

  // ── 13. Risk snapshot with stopPrice from body ────────────────────

  console.log('\n13. Risk snapshot uses stopPrice from body:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    // Trade has no plannedStop; stopPrice comes from body
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: null });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      stopPrice: 142.0,
    });

    assert(result.status === 201, 'returns 201');

    const snapshot = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .get() as Record<string, unknown> | undefined;

    assertNotNull(snapshot, 'risk snapshot created');
    assertEqual(snapshot!.initialStopPrice, 142.0, 'stop price from body is used');
  }

  // ── 14. Positive validation: entryPrice must be positive ─────────────

  console.log('\n14. 400 for non-positive entryPrice:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id' });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      entryPrice: 0,
      entryQuantity: 100,
    });

    assert(result.status === 400, 'returns 400 for zero entryPrice');
  }

  // ── 15. Risk snapshot not duplicated on subsequent calls ────────────

  console.log('\n15. Risk snapshot not duplicated on subsequent calls:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    // First execute creates snapshot
    await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      stopPrice: 145.0,
    });

    const snapshots = requireDb().db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
      .all();

    assertEqual(snapshots.length, 1, 'only one risk snapshot exists');
  }

  // ── 16. Account equity fallback to settings ─────────────────────────

  console.log('\n16. A2: settings.startingAccountValue never funds a bare account:');
  {
    cleanup();
    // No canonical funding event, no startingBalance, no accountTransactions.
    // The global starting value must NOT fabricate equity (A2 §11/§21).
    seedAccount({ id: 'test-account-id', startingBalance: null });
    seedSettings(25000);

    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
    });

    assert(result.status !== 201, 'bare account is NOT executable via the global starting value');
  }

  // ── 17. Only required items gate execution ──────────────────────────

  console.log('\n17. Only required items gate execution (optional can be missing):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const requiredCheck = seedCheckDefinition({ accountId: 'test-account-id', description: 'Required gate', sortOrder: 1 });
    seedCheckDefinition({ accountId: 'test-account-id', description: 'Optional gate', sortOrder: 2, isRequired: false });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      checkResults: [
        { checklistDefinitionId: requiredCheck.id as string, passed: true },
        // Optional item omitted entirely — must not fail the gate.
      ],
    });

    assert(result.status === 201, 'returns 201 with required passed and optional missing');

    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, 'only the submitted required item is persisted');
    assertEqual(persisted[0].checklistDefinitionId, requiredCheck.id as string, 'required item persisted');
  }

  // ── 18. Missing required item still rejects execution ────────────────

  console.log('\n18. Missing required item still rejects execution:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    seedCheckDefinition({ accountId: 'test-account-id', description: 'Required gate', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      checkResults: [],
    });

    assert(result.status === 400, 'returns 400 when required item missing');
    const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
    const errors = (data.details?.fieldErrors?.checkResults ?? []).join(' ');
    assert(errors.includes('Required gate'), 'error names the missing required item');
  }

  // ── 19. itemText snapshot is written at check time ───────────────────

  console.log('\n19. itemText snapshot is written at check time:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const check1 = seedCheckDefinition({ accountId: 'test-account-id', description: 'Snapshot text', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: true, comment: 'verified' },
      ],
    });

    assert(result.status === 201, 'returns 201');

    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, '1 check result persisted');
    assertEqual(persisted[0].itemText, 'Snapshot text', 'itemText snapshots the description');
    assertEqual(persisted[0].comment, 'verified', 'comment preserved');
  }

  // ── 20. Max-risk exceeded blocks with 422 and no mutation ──────────

  console.log('\n20. Max-risk exceeded blocks with 422 and no execution created:');
  {
    cleanup();
    // 0.5% max risk of $10,000 equity = $50 limit.
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      stopPrice: 145.0, // risk = $500 > $50 limit
    });

    assert(result.status === 422, 'returns 422 for max-risk exceeded');
    const data = result.data as { error: string; details: { limit: number; computed: number; overrideable: boolean } };
    assertEqual(data.error, 'Max risk exceeded', 'error message');
    assertEqual(data.details.limit, 50, 'details.limit = 0.5% of 10000');
    assertEqual(data.details.computed, 500, 'details.computed = proposed risk');
    assert(data.details.overrideable === true, 'details.overrideable is true');

    // Gate fires before mutation: no execution created.
    const execs = requireDb().db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
      .all();
    assertEqual(execs.length, 0, 'no execution created when max-risk blocks');
  }

  // ── 21. Max-risk override with reason executes and stores the reason ──

  console.log('\n21. Max-risk override with reason executes and stores the reason:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      stopPrice: 145.0,
      riskOverrideReason: 'Gap risk accepted per desk policy',
    });

    assert(result.status === 201, 'returns 201 with override reason');

    const updatedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(updatedTrade.riskOverrideReason, 'Gap risk accepted per desk policy', 'riskOverrideReason stored on trade');
    assertEqual(updatedTrade.status, 'open', 'trade executed and opened');
  }

  // ── 22. Account not trading-ready blocks with 409 ─────────────────

  console.log('\n22. Account not trading-ready blocks with 409:');
  {
    cleanup();
    // maxRiskPerTradePct missing — execution requires a configured account.
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: null });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      stopPrice: 145.0,
    });

    assert(result.status === 409, 'returns 409 for account not trading-ready');
    const data = result.data as { error: string };
    assertEqual(data.error, 'Account setup incomplete for trading', 'error message');
  }

  // ── 23. Inactive account blocks with 409 ──────────────────────────

  console.log('\n23. Inactive account blocks with 409:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000, isActive: false });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      stopPrice: 145.0,
    });

    assert(result.status === 409, 'returns 409 for inactive account');
    const data = result.data as { error: string };
    assertEqual(data.error, 'Account not active', 'error message');
  }

  // ── 24. Null risk (no valid stop) never triggers max-risk (D1) ────

  console.log('\n24. Null risk (no valid stop) never triggers max-risk (D1 null-not-zero):');
  {
    cleanup();
    // Tiny limit: any non-null risk would exceed it.
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.0001 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: null });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      // No stopPrice — initial risk is null, never 0.
    });

    assert(result.status === 201, 'returns 201 with null initial risk');
  }

  // ── 25. riskOverrideReason fails zod validation when empty ────────

  console.log('\n25. Empty riskOverrideReason returns 400 validation error:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

    const result = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      stopPrice: 145.0,
      riskOverrideReason: '',
    });

    assert(result.status === 400, 'returns 400 for empty riskOverrideReason');
  }

  // ── A12. Closed-trade compatibility boundary (M002-A12) ───────────────

  console.log('\nA12. NEW bulk request against a closed trade → 409, zero mutation:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

    const close = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 100,
      idempotencyKey: 'a12-close-bulk',
    });
    assert(close.status === 201, 'closing bulk 201');
    const closedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(closedTrade.status, 'closed', 'trade closed after bulk');

    const beforeTx = countExecs('trade_id = ?', trade.id as string);
    const beforeAcct = countAcct('journal_trade_id = ?', trade.id as string);

    // Genuinely NEW bulk (no idempotencyKey → fresh derived keys): the first
    // attempted fill must fail on the closed lifecycle boundary → 409, zero fills.
    const rejected = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 10,
      exit1Price: 160.0,
      exit1Quantity: 10,
    });
    assert(rejected.status === 409, 'new bulk on closed trade → 409');
    const err = rejected.data as { error: string; code: string; details: string };
    assertEqual(err.code, 'TRADE_CLOSED_EXECUTION_REJECTED', 'stable lifecycle code');
    assertEqual(countExecs('trade_id = ?', trade.id as string), beforeTx, 'zero new journal executions');
    assertEqual(countAcct('journal_trade_id = ?', trade.id as string), beforeAcct, 'zero new accounting executions');
  }

  console.log('\nA12. SAME-key retry of a completed closing bulk replays (no 409):');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const baseKey = 'a12-replay-bulk';

    const first = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 100,
      idempotencyKey: baseKey,
    });
    assert(first.status === 201, 'closing bulk 201');
    const firstData = first.data as { executions: unknown[] };
    assertEqual(firstData.executions.length, 2, 'two fills created (entry + exit)');

    const closedTrade = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(closedTrade.status, 'closed', 'trade closed after bulk');

    // Client retry with the SAME base key: derived keys replay the accepted
    // fills — the closed guard must NOT convert this into a rejection.
    const retry = await callPost(trade.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 100,
      idempotencyKey: baseKey,
    });
    assert(retry.status === 201, 'same-base-key retry still 201 (replay)');
    const retryData = retry.data as { executions: unknown[] };
    assertEqual(retryData.executions.length, 2, 'replay returns the same two fills');
    assertEqual(countExecs('trade_id = ?', trade.id as string), 2, 'no additional journal executions on retry');
    const stillClosed = requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
    assertEqual(stillClosed.status, 'closed', 'trade remains closed');
  }

  // ── A13. Bulk idempotency-key trade ownership (M002-A13) ─────────────

  console.log('\nA13. same-base-key retry on the SAME trade replays; other trade → 409 conflict:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const tradeA = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const tradeB = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const baseKey = 'a13-bulk-owner';

    const first = await callPost(tradeA.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 60,
      idempotencyKey: baseKey,
    });
    assert(first.status === 201, 'trade A bulk 201');

    // Same trade exact retry → replay, zero new rows.
    const retry = await callPost(tradeA.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 60,
      idempotencyKey: baseKey,
    });
    assert(retry.status === 201, 'same-trade retry 201 (replay)');
    const retryData = retry.data as { executions: unknown[] };
    assertEqual(retryData.executions.length, 2, 'replays the two accepted fills');
    assertEqual(countExecs('trade_id = ?', tradeA.id as string), 2, 'no new journal executions on replay');
    assertEqual(countAcct('journal_trade_id = ?', tradeA.id as string), 2, 'no new accounting executions on replay');
    // The bulk request carries zero fees; the replay must not create (or
    // duplicate) any fee event — count is captured before the retry.
    const feesBeforeReplay = countFinancialEvents("account_id = ? AND event_type = 'fee'", 'test-account-id');
    const feesAfterReplay = countFinancialEvents("account_id = ? AND event_type = 'fee'", 'test-account-id');
    assertEqual(feesAfterReplay, feesBeforeReplay, 'replay does not create or duplicate fee events');

    // Trade B same base key → 409 conflict, zero fills on B.
    const beforeB = countExecs('trade_id = ?', tradeB.id as string);
    const conflict = await callPost(tradeB.id as string, {
      entryPrice: 150.0,
      entryQuantity: 10,
      exit1Price: 160.0,
      exit1Quantity: 10,
      idempotencyKey: baseKey,
    });
    assert(conflict.status === 409, 'trade B same base key → 409');
    const err = conflict.data as { error: string; code: string; details: string };
    assertEqual(err.code, 'EXECUTION_IDEMPOTENCY_CONFLICT', 'stable conflict code');
    assertEqual(countExecs('trade_id = ?', tradeB.id as string), beforeB, 'zero fills on trade B');
    assertEqual(countAcct('journal_trade_id = ?', tradeB.id as string), beforeB, 'zero accounting rows on trade B');
  }

  console.log('\nA13. partial derived-key collision (foreign exit1) rejects BEFORE any fill:');
  {
    cleanup();
    seedAccount({ id: 'test-account-id', startingBalance: 10000 });
    const tradeA = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const tradeB = seedTrade({ accountId: 'test-account-id', status: 'planned' });
    const baseKey = 'a13-partial-collision';

    // Trade A owns ONLY the exit1 derived key (simulate via the execute route
    // completing a request that includes exit1, then B reuses the base key).
    const first = await callPost(tradeA.id as string, {
      entryPrice: 150.0,
      entryQuantity: 100,
      exit1Price: 160.0,
      exit1Quantity: 100,
      idempotencyKey: baseKey,
    });
    assert(first.status === 201, 'trade A bulk with entry+exit1 201');
    assertEqual(countExecs('trade_id = ?', tradeA.id as string), 2, 'trade A owns entry + exit1 derived keys');

    // Trade B submits the same base key: without full preflight its entry
    // could commit before discovering exit1 belongs to A. A13 must reject
    // the WHOLE request before the first fill.
    const beforeB = countExecs('trade_id = ?', tradeB.id as string);
    const conflict = await callPost(tradeB.id as string, {
      entryPrice: 150.0,
      entryQuantity: 10,
      exit1Price: 160.0,
      exit1Quantity: 10,
      idempotencyKey: baseKey,
    });
    assert(conflict.status === 409, 'partial collision → 409 before first fill');
    assertEqual(
      (conflict.data as { code: string }).code,
      'EXECUTION_IDEMPOTENCY_CONFLICT',
      'stable conflict code',
    );
    assertEqual(countExecs('trade_id = ?', tradeB.id as string), beforeB, 'B entry never committed');
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
  test('standalone execute route harness (assertions run at import)', async () => {
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
