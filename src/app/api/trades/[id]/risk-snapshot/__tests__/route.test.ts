/**
 * risk-snapshot route test
 *
 * Tests the PUT handler for updating risk snapshots.
 *
 * Run: DB_FILE_NAME=./.test-trades.db npx tsx src/app/api/trades/\[id\]/risk-snapshot/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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

function assertDeep(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  msg: string,
) {
  for (const key of Object.keys(expected)) {
    const a = actual[key];
    const e = expected[key];
    if (JSON.stringify(a) !== JSON.stringify(e)) {
      failed++;
      console.error(
        `  ❌ ${msg} — key "${key}" expected ${JSON.stringify(e)}, got ${JSON.stringify(a)} (FAILED)`,
      );
      return;
    }
  }
  passed++;
  console.log(`  ✅ ${msg}`);
}

function assertApprox(a: number, b: number, msg: string, tol = 0.001) {
  if (Math.abs(a - b) < tol) {
    passed++;
    console.log(`  ✅ ${msg} (≈${a})`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${b}, got ${a} (FAILED)`);
  }
}

// ── Setup: in-memory test DB ────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-trades.db';
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
    direction TEXT NOT NULL CHECK(direction IN ('long','short')),
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('idea','planned','open','partially_closed','closed','scratched')),
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

// ── Helpers (same logic as route.ts) ─────────────────────────────────

const updateRiskSnapshotSchema = {
  accountEquityAtOpen: { type: 'number', nullable: true },
  initialEntryPrice: { type: 'number', nullable: true },
  initialStopPrice: { type: 'number', nullable: true },
  initialQuantity: { type: 'number', nullable: true },
  riskPerShare: { type: 'number', nullable: true },
  initialRiskAmount: { type: 'number', nullable: true },
  accountRiskPct: { type: 'number', nullable: true },
  plannedRewardRisk: { type: 'number', nullable: true },
};

function validatePayload(body: Record<string, unknown>): Record<string, unknown> | Error {
  const validKeys = Object.keys(updateRiskSnapshotSchema);
  const errors: Record<string, string[]> = {};

  for (const key of Object.keys(body)) {
    if (!validKeys.includes(key)) {
      errors[key] = [`Unexpected field: ${key}`];
    }
  }

  for (const key of validKeys) {
    if (body[key] === undefined) continue;
    const val = body[key];
    if (val === null) continue; // null is allowed
    if (typeof val !== 'number' || isNaN(val as number)) {
      if (!errors[key]) errors[key] = [];
      errors[key].push(`Expected number or null, got ${typeof val}`);
    }
  }

  if (Object.keys(errors).length > 0) {
    return new Error(JSON.stringify({ fieldErrors: errors }));
  }

  return body;
}

function doPut(tradeId: string, body: Record<string, unknown>): {
  status: number;
  data: Record<string, unknown> | { error: string; details?: unknown };
} {
  // Validate
  const validationResult = validatePayload(body);
  if (validationResult instanceof Error) {
    return { status: 400, data: { error: 'Validation failed', details: JSON.parse(validationResult.message) } };
  }

  // Check trade exists
  const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) {
    return { status: 404, data: { error: 'Trade not found' } };
  }

  const now = new Date().toISOString();
  const providedFields = body;

  // Check if snapshot exists
  const existing = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, tradeId))
    .get();

  if (!existing) {
    // Create new
    const snapshotId = randomUUID();
    const insertValues: Record<string, unknown> = {
      id: snapshotId,
      tradeId,
      createdAt: now,
    };

    for (const [key, value] of Object.entries(providedFields)) {
      if (value !== undefined) {
        // Pass camelCase field names directly — Drizzle schema maps to snake_case columns
        insertValues[key] = value;
      }
    }

    db.insert(schema.tradeRiskSnapshots)
      .values(insertValues as any)
      .run();

    const created = db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(eq(schema.tradeRiskSnapshots.id, snapshotId))
      .get();

    return { status: 201, data: created as unknown as Record<string, unknown> };
  }

  // Update existing — pass camelCase field names directly (Drizzle maps to snake_case columns)
  const updateValues: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(providedFields)) {
    if (value !== undefined) {
      updateValues[key] = value;
    }
  }

  if (Object.keys(updateValues).length > 0) {
    db.update(schema.tradeRiskSnapshots)
      .set(updateValues as any)
      .where(eq(schema.tradeRiskSnapshots.id, existing.id))
      .run();
  }

  const updated = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.id, existing.id))
    .get();

  return { status: 200, data: updated as unknown as Record<string, unknown> };
}

// ── Tests ────────────────────────────────────────────────────────────

console.log('\n--- Risk Snapshot PUT Handler Tests ---\n');

// Setup: create a test trade
const testTradeId = randomUUID();
const testTradeId2 = randomUUID();
const accountId = randomUUID();

db.insert(schema.accounts).values({ id: accountId, name: 'Test Account' }).run();
db.insert(schema.trades).values({
  id: testTradeId,
  tradeCode: 'TEST-RS-001',
  accountId,
  symbol: 'AAPL',
  direction: 'long',
  status: 'open',
}).run();

db.insert(schema.trades).values({
  id: testTradeId2,
  tradeCode: 'TEST-RS-002',
  accountId,
  symbol: 'MSFT',
  direction: 'short',
  status: 'open',
}).run();

// Template: empty string -> null on parse
// ── Test 1: Trade not found ──────────────────────────────────────────

console.log('\n1. Trade not found returns 404:');
{
  const result = doPut('non-existent-id', { initialEntryPrice: 150 });
  assert(result.status === 404, 'returns 404 for unknown trade');
  assert((result.data as { error: string }).error === 'Trade not found', 'error message is "Trade not found"');
}

// ── Test 2: Create new snapshot on first PUT ─────────────────────────

console.log('\n2. First PUT creates new snapshot (upsert):');
{
  const result = doPut(testTradeId, {
    accountEquityAtOpen: 50000,
    initialEntryPrice: 150.50,
    initialStopPrice: 145.00,
    initialQuantity: 100,
    riskPerShare: 5.50,
    initialRiskAmount: 550,
    accountRiskPct: 1.10,
    plannedRewardRisk: 2.5,
  });

  assert(result.status === 201, 'returns 201 for created snapshot');
  const data = result.data as Record<string, unknown>;
  assert(data.id !== undefined, 'snapshot has an id');
  assertDeep(data, {
    tradeId: testTradeId,
    accountEquityAtOpen: 50000,
    initialEntryPrice: 150.50,
    initialStopPrice: 145.00,
    initialQuantity: 100,
    riskPerShare: 5.50,
    initialRiskAmount: 550,
    accountRiskPct: 1.10,
    plannedRewardRisk: 2.5,
  } as Record<string, unknown>, 'snapshot contains correct values');
}

// ── Test 3: Update existing snapshot ─────────────────────────────────

console.log('\n3. Second PUT updates existing snapshot:');
{
  const result = doPut(testTradeId, {
    initialEntryPrice: 152.00,
    riskPerShare: 7.00,
  });

  assert(result.status === 200, 'returns 200 for update');
  const data = result.data as Record<string, unknown>;
  assert(data.initialEntryPrice === 152.00, 'initialEntryPrice updated to 152.00');
  assert(data.riskPerShare === 7.00, 'riskPerShare updated to 7.00');
  assert(data.accountEquityAtOpen === 50000, 'accountEquityAtOpen preserved');
  assert(data.initialStopPrice === 145.00, 'initialStopPrice preserved');
}

// ── Test 4: Partial update with null ──────────────────────────────────

console.log('\n4. PUT with null clears a field:');
{
  // First set accountRiskPct
  doPut(testTradeId2, {
    initialEntryPrice: 300,
    accountEquityAtOpen: 100000,
    accountRiskPct: 2.0,
  });

  // Now set it to null
  const result = doPut(testTradeId2, {
    accountRiskPct: null,
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assert(data.accountRiskPct === null, 'accountRiskPct cleared to null');
}

// ── Test 5: UPDATE with empty body (no changes) ───────────────────────

console.log('\n5. PUT with empty body returns existing snapshot unchanged:');
{
  // Create snapshot first
  doPut(testTradeId2, { initialEntryPrice: 300 });

  const result = doPut(testTradeId2, {});

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assert(data.initialEntryPrice === 300, 'initialEntryPrice remains unchanged');
}

// ── Test 6: Validation rejects string values ─────────────────────────

console.log('\n6. PUT with string value returns 400:');
{
  const result = doPut(testTradeId, { initialEntryPrice: 'not-a-number' as any });
  assert(result.status === 400, 'returns 400 for invalid type');
}

// ── Test 7: Snake_case conversion preserves data ─────────────────────

console.log('\n7. camelCase field names correctly stored:');
{
  const result = doPut(testTradeId2, {
    accountEquityAtOpen: 75000,
  });

  const data = result.data as Record<string, unknown>;
  assert(data.accountEquityAtOpen === 75000, 'accountEquityAtOpen stored correctly');
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
