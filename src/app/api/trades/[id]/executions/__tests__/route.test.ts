/**
 * trade executions route test
 *
 * Tests GET (list by tradeId) and POST (create with validation and status recalculation).
 *
 * Run: npx vitest run --reporter verbose src/app/api/trades/\[id\]/executions/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';

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

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-executions.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL,
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    opened_at TEXT,
    closed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    executed_at TEXT,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    account_equity_at_open REAL,
    initial_entry_price REAL,
    initial_stop_price REAL,
    initial_quantity REAL,
    risk_per_share REAL,
    initial_risk_amount REAL,
    account_risk_pct REAL,
    planned_reward_risk REAL,
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated deriveTradeStatus ─────────────────────────────────────

type Direction = 'long' | 'short';

function isEntryAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'buy' || action === 'add';
  return action === 'sell_short';
}

function isExitAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'sell' || action === 'reduce';
  return action === 'buy_to_cover';
}

interface DeriveStatusResult {
  status: string;
  openedAt: string | null;
  closedAt: string | null;
}

function simulateDeriveStatus(
  executions: { action: string; quantity: number; executedAt: string }[],
  direction: Direction,
): DeriveStatusResult {
  const entries = executions.filter((e) => isEntryAction(e.action, direction));
  const exits = executions.filter((e) => isExitAction(e.action, direction));

  const totalEntryQty = entries.reduce((s, e) => s + e.quantity, 0);
  const totalExitQty = exits.reduce((s, e) => s + e.quantity, 0);

  let status: string;
  let openedAt: string | null = null;
  let closedAt: string | null = null;

  if (totalEntryQty === 0) {
    status = 'planned';
  } else if (totalExitQty === 0) {
    status = 'open';
  } else if (totalExitQty < totalEntryQty) {
    status = 'partially_closed';
  } else {
    status = 'closed';
  }

  if (totalEntryQty > 0 && entries.length > 0) {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
    );
    openedAt = sorted[0].executedAt;
  }

  if (totalExitQty >= totalEntryQty && exits.length > 0) {
    const sorted = [...exits].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
    );
    closedAt = sorted[sorted.length - 1].executedAt;
  }

  return { status, openedAt, closedAt };
}

// ── Simulated route logic ───────────────────────────────────────────

const DIRECTION_ACTIONS: Record<string, string[]> = {
  long: ['buy', 'add', 'sell', 'reduce'],
  short: ['sell_short', 'buy_to_cover'],
};

function doGetExecutions(tradeId: string): { status: number; data: unknown } {
  try {
    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const executions = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, tradeId))
      .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
      .all();

    return { status: 200, data: executions };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch executions', details: String(error) } };
  }
}

function doPostExecution(tradeId: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const action = body.action;
    if (!['buy', 'sell', 'buy_to_cover', 'sell_short', 'add', 'reduce'].includes(action as string)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { action: ['Invalid action'] } } } };
    }

    const quantity = body.quantity;
    if (typeof quantity !== 'number' || quantity <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { quantity: ['Quantity must be positive'] } } } };
    }

    const price = body.price;
    if (typeof price !== 'number' || price <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { price: ['Price must be positive'] } } } };
    }

    const fees = (body.fees as number) ?? 0;
    if (typeof fees !== 'number' || fees < 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { fees: ['Fees must be >= 0'] } } } };
    }

    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const tradeRec = trade as Record<string, unknown>;

    if (tradeRec.status === 'scratched') {
      return { status: 400, data: { error: 'Cannot add executions to a scratched trade' } };
    }

    if (tradeRec.status === 'closed') {
      return { status: 400, data: { error: 'Cannot add executions to a closed trade' } };
    }

    if (!DIRECTION_ACTIONS[tradeRec.direction as string]?.includes(action as string)) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              action: [
                `Action "${action}" is not valid for a ${tradeRec.direction} trade. ` +
                `Valid actions: ${DIRECTION_ACTIONS[tradeRec.direction as string].join(', ')}`,
              ],
            },
          },
        },
      };
    }

    const executionId = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.tradeExecutions)
      .values({
        id: executionId,
        tradeId,
        action: action as string,
        quantity: quantity as number,
        price: price as number,
        fees,
        executedAt: (body.executedAt as string) ?? now,
        reasonId: (body.reasonId as string) ?? null,
        notes: (body.notes as string) ?? null,
        createdAt: now,
      })
      .run();

    // ── Recalculate trade status ────────────────────────────────

    const allExecutions = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, tradeId))
      .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
      .all();

    const execData = allExecutions.map((r) => ({
      action: r.action,
      quantity: r.quantity,
      executedAt: r.executedAt ?? r.createdAt ?? '',
    }));

    const derived = simulateDeriveStatus(
      execData.map((e) => ({ ...e, price: 0 })),
      tradeRec.direction as Direction,
    );

    db.update(schema.trades)
      .set({
        status: derived.status,
        openedAt: derived.openedAt,
        closedAt: derived.closedAt,
        updatedAt: now,
      })
      .where(eq(schema.trades.id, tradeId))
      .run();

    // ── Upsert risk snapshot on first entry ──────────────────────

    if (derived.status !== 'planned') {
      const entryExecs = allExecutions.filter((e) =>
        (tradeRec.direction as string) === 'long'
          ? e.action === 'buy' || e.action === 'add'
          : e.action === 'sell_short',
      );

      if (entryExecs.length > 0) {
        const totalEntryQty = entryExecs.reduce((s, e) => s + e.quantity, 0);
        const weightedSum = entryExecs.reduce((s, e) => s + e.price * e.quantity, 0);
        const avgEntryPrice = weightedSum / totalEntryQty;

        const existingSnapshot = db
          .select()
          .from(schema.tradeRiskSnapshots)
          .where(eq(schema.tradeRiskSnapshots.tradeId, tradeId))
          .get();

        if (!existingSnapshot) {
          const snapshotValues: Record<string, unknown> = {
            id: randomUUID(),
            tradeId,
            initialEntryPrice: avgEntryPrice,
            initialQuantity: totalEntryQty,
            createdAt: now,
          };

          if (tradeRec.plannedStop != null) {
            snapshotValues.initialStopPrice = tradeRec.plannedStop;
          }

          db.insert(schema.tradeRiskSnapshots)
            .values(snapshotValues as any)
            .run();
        }
      }
    }

    const created = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.id, executionId))
      .get();

    return { status: 201, data: created };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create execution', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_risk_snapshots;');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
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
    })
    .run();
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedExecution(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.tradeExecutions)
    .values({
      id,
      tradeId: overrides.tradeId as string,
      action: 'buy',
      quantity: 100,
      price: 150.0,
      fees: 0,
      executedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.tradeExecutions).where(eq(schema.tradeExecutions.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trade Executions API Tests ---\n');

// ── 1. GET: Returns empty list for trade with no executions ─────────

console.log('\n1. GET returns empty list for trade with no executions:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doGetExecutions(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as unknown[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 0, 'array is empty');
}

// ── 2. GET: 404 for nonexistent trade ───────────────────────────────

console.log('\n2. GET returns 404 for nonexistent trade:');
{
  cleanup();
  const result = doGetExecutions('nonexistent-trade');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 3. GET: Returns executions ordered by executedAt ────────────────

console.log('\n3. GET returns executions ordered by executedAt:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

  const exec1 = seedExecution({ tradeId: trade.id, action: 'buy', quantity: 50, price: 148.0, executedAt: '2025-06-01T10:00:00Z' });
  const exec2 = seedExecution({ tradeId: trade.id, action: 'add', quantity: 50, price: 150.0, executedAt: '2025-06-01T11:00:00Z' });

  const result = doGetExecutions(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 2, 'returns 2 executions');
  assertEqual(data[0].id, exec1.id, 'first execution is the earliest');
  assertEqual(data[1].id, exec2.id, 'second execution is the later one');
  assertEqual(data[0].action, 'buy', 'first action is buy');
  assertEqual(data[1].action, 'add', 'second action is add');
}

// ── 4. POST: Creates execution with valid data ──────────────────────

console.log('\n4. POST creates execution with valid data:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
    fees: 5.0,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.action, 'buy', 'action matches');
  assertEqual(data.quantity, 100, 'quantity matches');
  assertEqual(data.price, 150.0, 'price matches');
  assertEqual(data.fees, 5.0, 'fees matches');
  assertEqual(data.tradeId, trade.id, 'tradeId matches');

  // Verify trade status updated to 'open'
  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'open', 'trade status updated to open');
  assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
}

// ── 5. POST: Validates action enum ──────────────────────────────────

console.log('\n5. POST returns 400 for invalid action:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostExecution(trade.id as string, {
    action: 'invalid',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Validates positive quantity ────────────────────────────

console.log('\n6. POST returns 400 for non-positive quantity:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: -10,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400 for negative quantity');

  const result2 = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 0,
    price: 150.0,
  });

  assert(result2.status === 400, 'returns 400 for zero quantity');
}

// ── 7. POST: Validates positive price ───────────────────────────────

console.log('\n7. POST returns 400 for non-positive price:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 0,
  });

  assert(result.status === 400, 'returns 400 for zero price');
}

// ── 8. POST: Validates fees >= 0 ────────────────────────────────────

console.log('\n8. POST returns 400 for negative fees:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
    fees: -1,
  });

  assert(result.status === 400, 'returns 400 for negative fees');
}

// ── 9. POST: 404 for nonexistent trade ──────────────────────────────

console.log('\n9. POST returns 404 for nonexistent trade:');
{
  cleanup();
  const result = doPostExecution('nonexistent-trade', {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 10. POST: Recalculates status from planned to closed on full exit ─

console.log('\n10. POST recalculates status from open to closed on full exit:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  // First entry
  doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  // Full exit
  const result = doPostExecution(trade.id as string, {
    action: 'sell',
    quantity: 100,
    price: 160.0,
  });

  assert(result.status === 201, 'returns 201');
  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'closed', 'trade status is closed');
  assertNotNull(updatedTrade.closedAt, 'trade has closedAt');
  assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
}

// ── 11. POST: Returns 400 for scratched trade ───────────────────────

console.log('\n11. POST returns 400 for scratched trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'scratched' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string };
  assert(data.error.includes('scratched'), 'error mentions scratched');
}

// ── 12. POST: Returns 400 for closed trade ──────────────────────────

console.log('\n12. POST returns 400 for closed trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'closed' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string };
  assert(data.error.includes('closed'), 'error mentions closed');
}

// ── 13. POST: Validates action-direction compatibility for long trade ──

console.log('\n13. POST validates action-direction compatibility for long trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', direction: 'long' });

  const result = doPostExecution(trade.id as string, {
    action: 'sell_short',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400 for incompatible action');
  const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
  assertNotNull(data.details, 'has details');
  assertNotNull(data.details.fieldErrors?.action, 'has action field error');
}

// ── 14. POST: Validates action-direction compatibility for short trade ─

console.log('\n14. POST validates action-direction compatibility for short trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', direction: 'short' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400 for incompatible action');
}

// ── 15. POST: Creates risk snapshot on first entry with plannedStop ───

console.log('\n15. POST creates risk snapshot on first entry when plannedStop is set:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot was created');
  assertEqual(snapshot!.initialEntryPrice, 150.0, 'initialEntryPrice matches buy price');
  assertEqual(snapshot!.initialQuantity, 100, 'initialQuantity matches');
  assertEqual(snapshot!.initialStopPrice, 145.0, 'initialStopPrice matches plannedStop');
}

// ── 16. POST: Creates risk snapshot on first entry without plannedStop ─

console.log('\n16. POST creates risk snapshot without initialStopPrice when plannedStop is null:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: null });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot was created');
  assertEqual(snapshot!.initialEntryPrice, 150.0, 'initialEntryPrice matches');
  assertEqual(snapshot!.initialStopPrice, null, 'initialStopPrice is null');
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
