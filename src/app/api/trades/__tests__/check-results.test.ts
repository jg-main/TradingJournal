/**
 * Check Results route test
 *
 * Tests GET /api/trades/:id/check-results which returns check results
 * with joined checklist definition descriptions for audit display.
 *
 * Run: npx vitest run --reporter verbose src/app/api/trades/__tests__/check-results.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, asc } from 'drizzle-orm';
import { test, expect } from 'vitest';

import * as schema from '@/db/schema';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} — value is null/undefined (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-check-results.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS trade_check_results;
  DROP TABLE IF EXISTS checklist_definitions;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS setup_definitions;
  DROP TABLE IF EXISTS lookup_values;
  DROP TABLE IF EXISTS accounts;

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    starting_balance REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE setup_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    how_to_play TEXT,
    entry_rules TEXT,
    exit_rules TEXT,
    tags TEXT,
    default_risk_pct REAL,
    position_sizing_rules TEXT,
    chart_patterns TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT,
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT REFERENCES accounts(id) NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long', 'short')),
    sector_id TEXT,
    setup_id TEXT REFERENCES lookup_values(id),
    market_condition_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('planned', 'open', 'closed', 'deleted')),
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    planned_quantity REAL,
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

  CREATE TABLE trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE NOT NULL,
    executed_at TEXT,
    action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'buy_to_cover', 'sell_short', 'add', 'reduce')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE UNIQUE NOT NULL,
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

  CREATE TABLE account_transactions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT REFERENCES accounts(id) NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal')),
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE checklist_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    setup_id TEXT REFERENCES setup_definitions(id),
    description TEXT NOT NULL,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trade_check_results (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE NOT NULL,
    checklist_definition_id TEXT REFERENCES checklist_definitions(id) NOT NULL,
    passed INTEGER NOT NULL,
    comment TEXT,
    checked_at TEXT DEFAULT (current_timestamp),
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

interface CheckResultRow {
  id: string;
  tradeId: string;
  checklistDefinitionId: string;
  description: string;
  passed: boolean;
  comment: string | null;
  checkedAt: string | null;
  createdAt: string | null;
}

function doGetCheckResults(tradeId: string): { status: number; data: unknown } {
  try {
    const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const rows = db
      .select({
        id: schema.tradeCheckResults.id,
        tradeId: schema.tradeCheckResults.tradeId,
        checklistDefinitionId: schema.tradeCheckResults.checklistDefinitionId,
        description: schema.checklistDefinitions.description,
        passed: schema.tradeCheckResults.passed,
        comment: schema.tradeCheckResults.comment,
        checkedAt: schema.tradeCheckResults.checkedAt,
        createdAt: schema.tradeCheckResults.createdAt,
      })
      .from(schema.tradeCheckResults)
      .innerJoin(
        schema.checklistDefinitions,
        eq(schema.checklistDefinitions.id, schema.tradeCheckResults.checklistDefinitionId),
      )
      .where(eq(schema.tradeCheckResults.tradeId, tradeId))
      .orderBy(asc(schema.tradeCheckResults.checkedAt), asc(schema.tradeCheckResults.createdAt))
      .all();

    return { status: 200, data: rows };
  } catch (error) {
    return {
      status: 500,
      data: { error: 'Failed to fetch trade check results', details: String(error) },
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_check_results;');
  sqlite.exec('DELETE FROM checklist_definitions;');
  sqlite.exec('DELETE FROM trade_risk_snapshots;');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM account_transactions;');
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM setup_definitions;');
  sqlite.exec('DELETE FROM lookup_values;');
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

function seedTrade(accountId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
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
    })
    .run();
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedCheckDefinition(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.checklistDefinitions)
    .values({
      id,
      description: 'Default check description',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

function seedCheckResult(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.tradeCheckResults)
    .values({
      id,
      tradeId: overrides.tradeId as string,
      checklistDefinitionId: overrides.checklistDefinitionId as string,
      passed: true,
      checkedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.tradeCheckResults).where(eq(schema.tradeCheckResults.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

test('check results route', () => {

console.log('\n--- Check Results Route Tests ---\n');

let accountId: string;
let tradeId: string;

// ── 1. Returns check results for a trade with results ────────────────

console.log('\n1. GET /trades/:id/check-results returns check results:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheckDefinition({ accountId, description: 'Verify market data', sortOrder: 1 });
  const check2 = seedCheckDefinition({ accountId, description: 'Check support level', sortOrder: 2 });

  const result1 = seedCheckResult({
    tradeId,
    checklistDefinitionId: check1.id as string,
    passed: true,
    comment: null,
  });
  const result2 = seedCheckResult({
    tradeId,
    checklistDefinitionId: check2.id as string,
    passed: true,
    comment: 'Support confirmed at $95',
  });

  const res = doGetCheckResults(tradeId);
  assert(res.status === 200, 'returns 200');
  const rows = res.data as CheckResultRow[];
  assertEqual(rows.length, 2, 'returns 2 check results');
  assertEqual(rows[0].checklistDefinitionId, check1.id as string, 'first result matches check1 id');
  assertEqual(rows[1].checklistDefinitionId, check2.id as string, 'second result matches check2 id');
  assertEqual(rows[0].passed, true, 'first result has passed=true');
  assertEqual(rows[1].passed, true, 'second result has passed=true');
}

// ── 2. Returns descriptions from joined checklist definitions ────────

console.log('\n2. GET returns description from joined checklist definition:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check = seedCheckDefinition({ accountId, description: 'Pre-trade risk assessment', sortOrder: 1 });
  seedCheckResult({ tradeId, checklistDefinitionId: check.id as string, passed: true });

  const res = doGetCheckResults(tradeId);
  assert(res.status === 200, 'returns 200');
  const rows = res.data as CheckResultRow[];
  assertEqual(rows.length, 1, 'returns 1 check result');
  assertEqual(rows[0].description, 'Pre-trade risk assessment', 'description is joined from checklist_definitions');
}

// ── 3. Returns empty array for trade with no check results ───────────

console.log('\n3. GET returns empty array for trade with no check results:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const res = doGetCheckResults(tradeId);
  assert(res.status === 200, 'returns 200');
  const rows = res.data as CheckResultRow[];
  assertEqual(rows.length, 0, 'returns empty array');
}

// ── 4. Returns 404 for non-existent trade ────────────────────────────

console.log('\n4. GET returns 404 for non-existent trade:');
{
  cleanup();
  const res = doGetCheckResults('nonexistent-trade-id');
  assert(res.status === 404, 'returns 404');
  const data = res.data as Record<string, unknown>;
  assertEqual(data.error, 'Trade not found', 'error message matches');
}

// ── 5. Returns results ordered by checkedAt, then createdAt ──────────

console.log('\n5. GET returns results ordered by checkedAt then createdAt:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheckDefinition({ accountId, description: 'First check', sortOrder: 1 });
  const check2 = seedCheckDefinition({ accountId, description: 'Second check', sortOrder: 2 });
  const check3 = seedCheckDefinition({ accountId, description: 'Third check', sortOrder: 3 });

  // Insert out of temporal order to verify sorting
  const laterTime = '2025-06-15T12:00:00.000Z';
  const earlierTime = '2025-06-15T10:00:00.000Z';
  const middleTime = '2025-06-15T11:00:00.000Z';

  seedCheckResult({ tradeId, checklistDefinitionId: check3.id as string, passed: false, checkedAt: laterTime, createdAt: laterTime });
  seedCheckResult({ tradeId, checklistDefinitionId: check1.id as string, passed: true, checkedAt: earlierTime, createdAt: earlierTime });
  seedCheckResult({ tradeId, checklistDefinitionId: check2.id as string, passed: true, checkedAt: middleTime, createdAt: middleTime });

  const res = doGetCheckResults(tradeId);
  assert(res.status === 200, 'returns 200');
  const rows = res.data as CheckResultRow[];
  assertEqual(rows.length, 3, 'returns 3 check results');
  assertEqual(rows[0].checklistDefinitionId, check1.id as string, 'first by checkedAt (earliest)');
  assertEqual(rows[1].checklistDefinitionId, check2.id as string, 'second by checkedAt');
  assertEqual(rows[2].checklistDefinitionId, check3.id as string, 'third by checkedAt (latest)');
}

// ── 6. Returns passed=false and true correctly ───────────────────────

console.log('\n6. GET returns correct passed values:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheckDefinition({ accountId, description: 'Passed check', sortOrder: 1 });
  const check2 = seedCheckDefinition({ accountId, description: 'Failed check', sortOrder: 2 });

  seedCheckResult({ tradeId, checklistDefinitionId: check1.id as string, passed: true });
  seedCheckResult({ tradeId, checklistDefinitionId: check2.id as string, passed: false });

  const res = doGetCheckResults(tradeId);
  assert(res.status === 200, 'returns 200');
  const rows = res.data as CheckResultRow[];
  assertEqual(rows.length, 2, 'returns 2 check results');

  const passedRow = rows.find(r => r.checklistDefinitionId === check1.id);
  const failedRow = rows.find(r => r.checklistDefinitionId === check2.id);
  assertNotNull(passedRow, 'passed row exists');
  assertNotNull(failedRow, 'failed row exists');
  assertEqual(passedRow!.passed, true, 'passed value is true');
  assertEqual(failedRow!.passed, false, 'failed value is false');
}

// ── 7. Returns comments when present ─────────────────────────────────

console.log('\n7. GET returns comment values:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheckDefinition({ accountId, description: 'With comment', sortOrder: 1 });
  const check2 = seedCheckDefinition({ accountId, description: 'No comment', sortOrder: 2 });

  seedCheckResult({ tradeId, checklistDefinitionId: check1.id as string, passed: true, comment: 'All criteria met' });
  seedCheckResult({ tradeId, checklistDefinitionId: check2.id as string, passed: true, comment: null });

  const res = doGetCheckResults(tradeId);
  assert(res.status === 200, 'returns 200');
  const rows = res.data as CheckResultRow[];
  assertEqual(rows.length, 2, 'returns 2 check results');

  const withComment = rows.find(r => r.checklistDefinitionId === check1.id);
  const noComment = rows.find(r => r.checklistDefinitionId === check2.id);
  assertEqual(withComment!.comment, 'All criteria met', 'comment is returned when present');
  assertEqual(noComment!.comment, null, 'comment is null when not provided');
}

// ── 8. Cross-trade isolation ─────────────────────────────────────────

console.log('\n8. GET returns only results scoped to the requested trade:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade1 = seedTrade(accountId);
  const trade2 = seedTrade(accountId);
  const trade1Id = trade1.id as string;
  const trade2Id = trade2.id as string;

  const check = seedCheckDefinition({ accountId, description: 'Shared check', sortOrder: 1 });

  seedCheckResult({ tradeId: trade1Id, checklistDefinitionId: check.id as string, passed: true });
  seedCheckResult({ tradeId: trade2Id, checklistDefinitionId: check.id as string, passed: false });

  const res1 = doGetCheckResults(trade1Id);
  assert(res1.status === 200, 'trade1 returns 200');
  const rows1 = res1.data as CheckResultRow[];
  assertEqual(rows1.length, 1, 'trade1 has 1 result');
  assertEqual(rows1[0].passed, true, 'trade1 result is passed');

  const res2 = doGetCheckResults(trade2Id);
  assert(res2.status === 200, 'trade2 returns 200');
  const rows2 = res2.data as CheckResultRow[];
  assertEqual(rows2.length, 1, 'trade2 has 1 result');
  assertEqual(rows2[0].passed, false, 'trade2 result is not passed');
}

// ── 9. Soft-deleted checklist definitions are still joined ────────────

console.log('\n9. GET still returns results even if the definition was soft-deleted:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check = seedCheckDefinition({
    accountId,
    description: 'Now soft-deleted check',
    sortOrder: 1,
    deletedAt: new Date().toISOString(),
  });

  seedCheckResult({ tradeId, checklistDefinitionId: check.id as string, passed: true });

  // Soft-deleted definition still exists in the table, so inner join should work
  const res = doGetCheckResults(tradeId);
  assert(res.status === 200, 'returns 200');
  const rows = res.data as CheckResultRow[];
  assertEqual(rows.length, 1, 'returns the check result even with soft-deleted definition');
  assertEqual(rows[0].description, 'Now soft-deleted check', 'description is still joined');
}

// ── 10. Check results contain all expected fields ──────────────────

console.log('\n10. GET returns all expected fields in the response:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check = seedCheckDefinition({ accountId, description: 'Field completeness check', sortOrder: 1 });
  seedCheckResult({ tradeId, checklistDefinitionId: check.id as string, passed: true, comment: 'Looks good' });

  const res = doGetCheckResults(tradeId);
  assert(res.status === 200, 'returns 200');
  const rows = res.data as CheckResultRow[];
  const row = rows[0];
  assertNotNull(row.id, 'has id');
  assertNotNull(row.tradeId, 'has tradeId');
  assertNotNull(row.checklistDefinitionId, 'has checklistDefinitionId');
  assertNotNull(row.description, 'has description');
  assertNotNull(row.passed, 'has passed');
  assertEqual(row.comment, 'Looks good', 'has comment');
  assertNotNull(row.checkedAt, 'has checkedAt');
  assertNotNull(row.createdAt, 'has createdAt');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'\u2500'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
expect(failed).toBe(0);
if (failed === 0) {
  console.log('         All tests passed!\n');
}

});
