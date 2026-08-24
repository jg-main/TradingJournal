/**
 * Execute route checklist validation + atomic persistence test (S03/T04)
 *
 * Tests POST /api/trades/:id/execute against the REAL route handler with the
 * canonical execution engine underneath. The route is now a thin compatibility
 * adapter: it validates the bulk request (exit quantity guards, exit
 * pairing, exit2-requires-exit1), decomposes it into individual fills, and
 * delegates every fill to executeTradeFill. All execution logic — checklist
 * gate with item-text snapshots (F7), readiness gate, trade status derivation,
 * risk snapshot, accounting posting, FIFO rebuild — lives in the engine.
 *
 * Coverage preserved from the legacy suite:
 * - No gating when no checklist items exist
 * - Rejection when checklist items exist but checkResults are missing/incomplete
 * - Rejection when checks are not passed
 * - Success when all checks are passed, with atomic persistence
 * - itemText snapshots at check time (F7)
 * - Existing validation rules (exit overflow 409, 404, deleted, non-planned)
 * - Idempotency: retrying the same request with the same key does not
 *   duplicate executions (replay-safe per-fill keys derived by the adapter)
 *
 * Run: npx tsx src/app/api/trades/__tests__/execute.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/__tests__/execute.test.ts`)
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

import { testDbPath } from '../../../../lib/testing/test-db';
process.env.DB_FILE_NAME = testDbPath('execute-checks');

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
      // Execution requires a trading-ready account (risk params +
      // commission + opening cash); default the seed to fully configured so
      // the checklist cases exercise the gate without tripping it.
      maxRiskPerTradePct: 10,
      defaultCommission: 1.0,
      startingBalance: 10000,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.accounts.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedLookupSetup(value: string) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.lookupValues)
    .values({
      id,
      type: 'setup',
      value,
      sortOrder: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return requireDb().db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get() as Record<string, unknown>;
}

function seedSetupDefinition(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.setupDefinitions)
    .values({
      id,
      name: 'Momentum Breakout',
      description: 'A test setup definition',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return requireDb().db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get() as Record<string, unknown>;
}

function seedTrade(accountId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.trades)
    .values({
      id,
      tradeCode: `TC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      accountId,
      symbol: 'AAPL',
      direction: 'long',
      status: 'planned',
      plannedEntry: 100,
      plannedStop: 95,
      plannedQuantity: 10,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof schema.trades.$inferInsert)
    .run();
  return requireDb().db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedCheck(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  requireDb().db.insert(schema.checklistDefinitions)
    .values({
      id,
      description: 'Default check',
      isRequired: true,
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return requireDb().db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Tests — each block invokes the REAL route handler with the engine below
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load the real modules AFTER the env var is set so @/db initializes
  // against DB_FILE_NAME with all migrations auto-applied.
  const dbMod = await import('@/db');
  db = dbMod.db;
  getSqliteHandle = dbMod.getSqliteHandle;

  const nextMod = await import('next/server');
  NextRequestCtor = nextMod.NextRequest;

  const routeMod = await import('../[id]/execute/route');
  route = routeMod as unknown as RouteModule;

  let routePath = '../[id]/execute/route.ts';
  try {
    routePath = fileURLToPath(new URL('../[id]/execute/route.ts', import.meta.url)).replace(`${process.cwd()}/`, '');
  } catch {
    // keep the default label
  }

  console.log('\n--- Trade Execute API Tests (real route handler over engine) ---\n');
  console.log(`  Route module: ${routePath}`);
  console.log(`  DB: ${process.env.DB_FILE_NAME} (real migrated schema)`);

  // ── 1. Execute without checks (no gating) ────────────────────────────

  console.log('\n1. POST /trades/:id/execute succeeds when no checklist items exist:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      fees: 0,
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.executions, 'has executions');
    assertNotNull(data.trade, 'has trade');
    const updatedTrade = data.trade as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status set to open');

    const checkResults = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(checkResults.length, 0, 'no check results persisted');
  }

  // ── 2. Execute with account checks all passed ────────────────────────

  console.log('\n2. POST succeeds when account-level checks are all passed:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const check1 = seedCheck({ accountId: acc.id, description: 'Verify market data', sortOrder: 1 });
    const check2 = seedCheck({ accountId: acc.id, description: 'Check support level', sortOrder: 2 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: true },
        { checklistDefinitionId: check2.id as string, passed: true },
      ],
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.trade, 'has trade');
    const updatedTrade = data.trade as Record<string, unknown>;
    assertEqual(updatedTrade.status, 'open', 'trade status set to open');

    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 2, '2 check results persisted');
    assertEqual(persisted[0].checklistDefinitionId, check1.id as string, 'check1 result persisted');
    assertEqual(persisted[0].passed, true, 'check1 passed');
    assertEqual(persisted[1].checklistDefinitionId, check2.id as string, 'check2 result persisted');
    assertEqual(persisted[1].passed, true, 'check2 passed');
  }

  // ── 3. Execute with setup checks all passed ──────────────────────────

  console.log('\n3. POST succeeds when setup-level checks are all passed (resolves via lookup value):');
  {
    cleanup();
    const acc = seedAccount();

    const lookupVal = seedLookupSetup('Momentum Breakout');
    const setupDef = seedSetupDefinition({ name: 'Momentum Breakout' });

    const trade = seedTrade(acc.id as string, { setupId: lookupVal.id });

    const check1 = seedCheck({ setupId: setupDef.id as string, description: 'Setup check', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: true },
      ],
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.trade, 'has trade');
    assertEqual((data.trade as Record<string, unknown>).status, 'open', 'trade opened');

    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, '1 check result persisted');
    assertEqual(persisted[0].passed, true, 'check passed');
  }

  // ── 4. Merge account + setup checks, all passed ──────────────────────

  console.log('\n4. POST succeeds with merged account+setup checks all passed:');
  {
    cleanup();
    const acc = seedAccount();

    const lookupVal = seedLookupSetup('Momentum Breakout');
    const setupDef = seedSetupDefinition({ name: 'Momentum Breakout' });

    const trade = seedTrade(acc.id as string, { setupId: lookupVal.id });

    const accCheck = seedCheck({ accountId: acc.id, description: 'Account check', sortOrder: 1 });
    const setupCheck = seedCheck({ setupId: setupDef.id as string, description: 'Setup check', sortOrder: 2 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: accCheck.id as string, passed: true },
        { checklistDefinitionId: setupCheck.id as string, passed: true },
      ],
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    assertNotNull(data.trade, 'has trade');

    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 2, '2 check results persisted');
  }

  // ── 5. Reject when checks exist but no checkResults provided ──────────

  console.log('\n5. POST returns 400 when checks exist but no checkResults provided:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    seedCheck({ accountId: acc.id, description: 'Required verification check', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
    });

    assert(result.status === 400, 'returns 400');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.error, 'Validation failed', 'error matches');
    const details = data.details as Record<string, unknown>;
    const fieldErrors = details.fieldErrors as Record<string, unknown>;
    const checkErrors = fieldErrors.checkResults as string[];
    assert(checkErrors.length > 0, 'has checkResults field errors');
    const allErrorsText = checkErrors.join(' ');
    assert(allErrorsText.includes('Missing'), 'error mentions missing results');
  }

  // ── 6. Reject when some checks are passed=false ───────────────────────

  console.log('\n6. POST returns 400 when a check result has passed=false:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const check1 = seedCheck({ accountId: acc.id, description: 'Risk check', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: false },
      ],
    });

    assert(result.status === 400, 'returns 400');
    const data = result.data as Record<string, unknown>;
    const details = data.details as Record<string, unknown>;
    const fieldErrors = details.fieldErrors as Record<string, unknown>;
    const checkErrors = fieldErrors.checkResults as string[];
    assert(checkErrors.length > 0, 'has checkResults error');
    const allErrors = checkErrors.join(' ');
    assert(allErrors.includes('must be passed'), 'error mentions must be passed');
  }

  // ── 7. Reject when checkResults don't cover all items ────────────────

  console.log('\n7. POST returns 400 when not all checklist items have results:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const check1 = seedCheck({ accountId: acc.id, description: 'Check A', sortOrder: 1 });
    seedCheck({ accountId: acc.id, description: 'Check B', sortOrder: 2 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: true },
      ],
    });

    assert(result.status === 400, 'returns 400');
    const data = result.data as Record<string, unknown>;
    const details = data.details as Record<string, unknown>;
    const fieldErrors = details.fieldErrors as Record<string, unknown>;
    const checkErrors = fieldErrors.checkResults as string[];
    assert(checkErrors.length > 0, 'has checkResults error');
    const allErrors = checkErrors.join(' ');
    assert(allErrors.includes('Missing'), 'error mentions missing items');
    assert(allErrors.includes('Check B'), 'error names the missing item');
  }

  // ── 8. Reject with both missing and not-passed errors ─────────────────

  console.log('\n8. POST returns 400 with combined errors for missing + not-passed items:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const check1 = seedCheck({ accountId: acc.id, description: 'Check 1', sortOrder: 1 });
    seedCheck({ accountId: acc.id, description: 'Check 2', sortOrder: 2 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: false },
      ],
    });

    assert(result.status === 400, 'returns 400');
    const data = result.data as Record<string, unknown>;
    const details = data.details as Record<string, unknown>;
    const fieldErrors = details.fieldErrors as Record<string, unknown>;
    const checkErrors = fieldErrors.checkResults as string[];
    assert(checkErrors.length >= 2, 'has 2 checkResults errors');
    const allErrors = checkErrors.join(' ');
    assert(allErrors.includes('Missing'), 'error mentions missing');
    assert(allErrors.includes('must be passed'), 'error mentions not passed');
  }

  // ── 9. Atomic persistence: check results are NOT created on failure ───

  console.log('\n9. No check results are persisted when execution is rejected:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const check1 = seedCheck({ accountId: acc.id, description: 'Will not pass', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: false },
      ],
    });

    assert(result.status === 400, 'returns 400');

    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 0, 'no check results persisted');
  }

  // ── 10. Execute with check results including optional comment ─────────

  console.log('\n10. POST persists check results with optional comments:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const check1 = seedCheck({ accountId: acc.id, description: 'Check with comment', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: true, comment: 'All clear, support confirmed' },
      ],
    });

    assert(result.status === 201, 'returns 201');
    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, '1 check result persisted');
    assertEqual(persisted[0].comment, 'All clear, support confirmed', 'comment preserved');
  }

  // ── 11. Existing behavior: exit qty exceeds entry qty ────────────────

  console.log('\n11. POST returns 409 when total exit quantity exceeds entry quantity:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      exit1Quantity: 6,
      exit1Price: 110,
      exit2Quantity: 6,
      exit2Price: 115,
    });

    assert(result.status === 409, 'returns 409');
    const data = result.data as Record<string, unknown>;
    const details = data.details as Record<string, unknown>;
    const fieldErrors = details.fieldErrors as Record<string, unknown>;
    assertNotNull(fieldErrors.exitQuantity, 'has exitQuantity error');
  }

  // ── 12. Existing behavior: trade not found ────────────────────────────

  console.log('\n12. POST returns 404 for non-existent trade:');
  {
    cleanup();
    const result = await callPost('nonexistent-trade-id', {
      entryPrice: 100,
      entryQuantity: 10,
    });
    assert(result.status === 404, 'returns 404');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.error, 'Trade not found', 'error message matches');
  }

  // ── 13. Existing behavior: deleted trade rejected ─────────────────────

  console.log('\n13. POST returns 400 for deleted trade:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string, { status: 'deleted' });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
    });
    assert(result.status === 400, 'returns 400');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.error, 'Cannot execute a deleted trade', 'error message matches');
  }

  // ── 14. Existing behavior: only planned trades can execute ────────────

  console.log('\n14. POST returns 400 for non-planned trade:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string, { status: 'open' });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
    });
    assert(result.status === 400, 'returns 400');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.error, 'Trade is not in planned status', 'error message matches');
  }

  // ── 15. Execute with exit prices and quantities (full round trip) ─────

  console.log('\n15. POST succeeds with exits and check results all passed:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const check1 = seedCheck({ accountId: acc.id, description: 'Pre-trade check', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      exit1Price: 110,
      exit1Quantity: 5,
      exit2Price: 120,
      exit2Quantity: 5,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: true },
      ],
    });

    assert(result.status === 201, 'returns 201');
    const data = result.data as Record<string, unknown>;
    const tradeData = data.trade as Record<string, unknown>;
    assertEqual(tradeData.status, 'closed', 'fully exited trade is closed');
    const executions = data.executions as unknown[];
    assertEqual(executions.length, 3, '3 executions created (1 entry + 2 exits)');

    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, '1 check result persisted');
  }

  // ── 16. Soft-deleted checks are not gating (not part of merged) ──────

  console.log('\n16. POST allows execution when only soft-deleted checks exist:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    seedCheck({ accountId: acc.id, description: 'Deleted check', sortOrder: 1, deletedAt: new Date().toISOString() });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
    });
    assert(result.status === 201, 'returns 201');
  }

  // ── 17. Optional items can be missing without failing the gate ───────

  console.log('\n17. POST succeeds when only optional items are missing from checkResults:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const requiredCheck = seedCheck({ accountId: acc.id, description: 'Required check', sortOrder: 1 });
    seedCheck({ accountId: acc.id, description: 'Optional check', sortOrder: 2, isRequired: false });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: requiredCheck.id as string, passed: true },
      ],
    });

    assert(result.status === 201, 'returns 201 (optional item missing does not gate)');

    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, '1 check result persisted (optional omitted, not inserted)');
    assertEqual(persisted[0].checklistDefinitionId, requiredCheck.id as string, 'required check persisted');
  }

  // ── 18. All-optional merged list does not gate execution ─────────────

  console.log('\n18. POST succeeds when every merged item is optional and none are submitted:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    seedCheck({ accountId: acc.id, description: 'Optional A', sortOrder: 1, isRequired: false });
    seedCheck({ accountId: acc.id, description: 'Optional B', sortOrder: 2, isRequired: false });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
    });
    assert(result.status === 201, 'returns 201 with zero required items');
  }

  // ── 19. Optional item submitted is recorded with item-text snapshot ──

  console.log('\n19. POST records submitted optional items with itemText snapshot:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const optionalCheck = seedCheck({ accountId: acc.id, description: 'Optional evidence', sortOrder: 1, isRequired: false });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: optionalCheck.id as string, passed: true, comment: 'extra note' },
      ],
    });

    assert(result.status === 201, 'returns 201');
    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, '1 check result persisted');
    assertEqual(persisted[0].itemText, 'Optional evidence', 'itemText snapshots the description');
    assertEqual(persisted[0].comment, 'extra note', 'comment preserved');
  }

  // ── 20. itemText snapshots the description at check time ─────────────

  console.log('\n20. POST writes itemText snapshot for required items:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);

    const check1 = seedCheck({ accountId: acc.id, description: 'Snapshot me', sortOrder: 1 });

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 10,
      checkResults: [
        { checklistDefinitionId: check1.id as string, passed: true },
      ],
    });

    assert(result.status === 201, 'returns 201');
    const persisted = requireDb().db
      .select()
      .from(schema.tradeCheckResults)
      .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
      .all();
    assertEqual(persisted.length, 1, '1 check result persisted');
    assertEqual(persisted[0].itemText, 'Snapshot me', 'itemText equals the definition description at check time');
  }

  // ── 21. Idempotent retry with the same client key does not duplicate ──

  console.log('\n21. Retrying the same request with the same idempotency key does not duplicate executions:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string);
    const key = randomUUID();

    const body = {
      entryPrice: 100,
      entryQuantity: 10,
      exit1Price: 110,
      exit1Quantity: 10,
      idempotencyKey: key,
    };

    const first = await callPost(trade.id as string, body);
    assert(first.status === 201, 'first request returns 201');

    const retry = await callPost(trade.id as string, body);
    assert(retry.status === 201, 'retry returns 201');

    const execs = requireDb().db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
      .all();
    assertEqual(execs.length, 2, 'exactly 2 executions (entry + exit1), no duplicates');

    // The accounting side is replay-safe too.
    const accountingExecs = requireDb().getSqliteHandle()
      .prepare('SELECT count(*) AS count FROM accounting_executions WHERE journal_trade_id = ?')
      .get(trade.id as string) as { count: number };
    assertEqual(accountingExecs.count, 2, 'exactly 2 accounting executions, no duplicates');
  }

  // ── 22. Engine-level over-close via the P1 bulk adapter maps to 400 ──

  console.log('\n22. POST returns 400 (Over-close rejected) when the engine guard fires through the bulk adapter:');
  {
    cleanup();
    const acc = seedAccount();
    const trade = seedTrade(acc.id as string, { status: 'planned' });

    // Pre-insert a 10-share entry carrying the derived `:entry` key. The bulk
    // request replays it (no new row) while its exit1 (20 shares) exceeds the
    // PERSISTED open quantity (10) — the adapter-level guard only compares
    // against the REQUEST entry quantity (30), so the engine's S04 pre-flight
    // OverCloseError fires and the route maps it to a friendly 400 instead of
    // a 500 rollback.
    const key = randomUUID();
    const nowIso = new Date().toISOString();
    requireDb().db.insert(schema.tradeExecutions)
      .values({
        id: randomUUID(),
        tradeId: trade.id as string,
        action: 'buy',
        quantity: 10,
        price: 100,
        fees: 0,
        executedAt: nowIso,
        createdAt: nowIso,
        idempotencyKey: `${key}:entry`,
      })
      .run();

    const result = await callPost(trade.id as string, {
      entryPrice: 100,
      entryQuantity: 30,
      exit1Price: 110,
      exit1Quantity: 20,
      idempotencyKey: key,
    });

    assert(result.status === 400, 'returns 400');
    const data = result.data as { error: string; details: { requestedQuantity: number; openQuantity: number } };
    assertEqual(data.error, 'Over-close rejected', 'error names the over-close');
    assertEqual(data.details.requestedQuantity, 20, 'details carries the requested exit quantity');
    assertEqual(data.details.openQuantity, 10, 'details carries the persisted open quantity');

    const execs = requireDb().db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
      .all();
    assertEqual(execs.length, 1, 'no new execution created by the rejected exit fill');
  }

  // ── Summary ──────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED`);
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
    console.error('execute.test.ts: unexpected error', e);
    process.exit(1);
  });
}
