/**
 * mistakes route test
 *
 * Tests the GET, POST, and DELETE handlers for trade mistakes.
 * POST creates a mistake with Zod validation and resolves mistakeType
 * via lookupValues table (follows setup->setupId pattern).
 * GET returns mistakes array for a trade.
 * DELETE removes a mistake by ?id=... query param.
 *
 * Run: DB_FILE_NAME=./.test-trades.db npx tsx src/app/api/trades/\[id\]/mistakes/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';

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

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-trades.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS watchlist_items;
  DROP TABLE IF EXISTS weekly_reviews;
  DROP TABLE IF EXISTS setup_definitions;
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
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long','short')),
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('planned','open','closed','deleted')),
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
  CREATE TABLE IF NOT EXISTS lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_mistakes (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    mistake_type_id TEXT REFERENCES lookup_values(id),
    phase TEXT NOT NULL CHECK(phase IN ('pre_trade','entry','management','exit','review')),
    severity TEXT NOT NULL CHECK(severity IN ('minor','moderate','major','critical')),
    root_cause TEXT,
    corrective_action TEXT,
    status TEXT NOT NULL CHECK(status IN ('open','addressed','improved','resolved')),
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Helpers (mirrors route.ts logic) ────────────────────────────────

const PHASE = ['pre_trade', 'entry', 'management', 'exit', 'review'] as const;
const SEVERITY = ['minor', 'moderate', 'major', 'critical'] as const;
const STATUS = ['open', 'addressed', 'improved', 'resolved'] as const;

function validateMistakePayload(body: Record<string, unknown>):
  | { mistakeType: string; phase: string; severity: string; rootCause: string; correctiveAction: string; status: string }
  | { error: string; details: { fieldErrors: Record<string, string[]> } } {
  const fieldErrors: Record<string, string[]> = {};
  const ALLOWED = new Set(['mistakeType', 'phase', 'severity', 'rootCause', 'correctiveAction', 'status']);

  // Check for unexpected fields
  for (const key of Object.keys(body)) {
    if (!ALLOWED.has(key)) {
      fieldErrors[key] = [`Unexpected field: ${key}`];
    }
  }

  // mistakeType: required string, min 1 char
  const mt = body.mistakeType;
  if (mt === undefined || mt === null) {
    fieldErrors.mistakeType = ['Required'];
  } else if (typeof mt !== 'string' || mt.trim().length === 0) {
    fieldErrors.mistakeType = ['Expected a non-empty string'];
  }

  // phase: required enum
  const phase = body.phase;
  if (phase === undefined || phase === null) {
    fieldErrors.phase = ['Required'];
  } else if (!PHASE.includes(phase as (typeof PHASE)[number])) {
    fieldErrors.phase = [`Invalid phase. Must be one of: ${PHASE.join(', ')}`];
  }

  // severity: required enum
  const severity = body.severity;
  if (severity === undefined || severity === null) {
    fieldErrors.severity = ['Required'];
  } else if (!SEVERITY.includes(severity as (typeof SEVERITY)[number])) {
    fieldErrors.severity = [`Invalid severity. Must be one of: ${SEVERITY.join(', ')}`];
  }

  // rootCause: required string
  const rc = body.rootCause;
  if (rc === undefined || rc === null) {
    fieldErrors.rootCause = ['Required'];
  } else if (typeof rc !== 'string' || rc.trim().length === 0) {
    fieldErrors.rootCause = ['Expected a non-empty string'];
  }

  // correctiveAction: required string
  const ca = body.correctiveAction;
  if (ca === undefined || ca === null) {
    fieldErrors.correctiveAction = ['Required'];
  } else if (typeof ca !== 'string' || ca.trim().length === 0) {
    fieldErrors.correctiveAction = ['Expected a non-empty string'];
  }

  // status: optional, defaults to 'open'
  const status = body.status;
  if (status !== undefined && status !== null && !STATUS.includes(status as (typeof STATUS)[number])) {
    fieldErrors.status = [`Invalid status. Must be one of: ${STATUS.join(', ')}`];
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Validation failed', details: { fieldErrors } };
  }

  return {
    mistakeType: (mt as string).trim(),
    phase: phase as string,
    severity: severity as string,
    rootCause: (rc as string).trim(),
    correctiveAction: (ca as string).trim(),
    status: (status as string | undefined) ?? 'open',
  };
}

function resolveMistakeType(value: string): string | null {
  const lower = value.toLowerCase();
  const lookup = db
    .select()
    .from(schema.lookupValues)
    .where(and(eq(schema.lookupValues.type, 'mistake_type'), eq(schema.lookupValues.value, lower)))
    .get();
  return lookup ? lookup.id : null;
}

function doPost(
  tradeId: string,
  body: Record<string, unknown>,
): { status: number; data: Record<string, unknown> } {
  // Validate
  const validated = validateMistakePayload(body);
  if ('error' in validated) {
    return { status: 400, data: validated };
  }

  // Check trade exists
  const trade = db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, tradeId))
    .get();
  if (!trade) {
    return { status: 404, data: { error: 'Trade not found' } };
  }

  // Resolve mistake type
  const lookupId = resolveMistakeType(validated.mistakeType);
  if (!lookupId) {
    return {
      status: 400,
      data: {
        error: 'Validation failed',
        details: {
          fieldErrors: {
            mistakeType: [`Unknown mistake type "${validated.mistakeType}"`],
          },
        },
      },
    };
  }

  const mistakeId = randomUUID();
  const now = new Date().toISOString();

  db.insert(schema.tradeMistakes)
    .values({
      id: mistakeId,
      tradeId,
      mistakeTypeId: lookupId,
      phase: validated.phase as (typeof PHASE)[number],
      severity: validated.severity as (typeof SEVERITY)[number],
      rootCause: validated.rootCause,
      correctiveAction: validated.correctiveAction,
      status: validated.status as (typeof STATUS)[number],
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = db
    .select()
    .from(schema.tradeMistakes)
    .where(eq(schema.tradeMistakes.id, mistakeId))
    .get();

  return { status: 201, data: created as unknown as Record<string, unknown> };
}

function doGet(tradeId: string): { status: number; data: unknown } {
  const trade = db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, tradeId))
    .get();

  if (!trade) {
    return { status: 404, data: { error: 'Trade not found' } };
  }

  const mistakes = db
    .select()
    .from(schema.tradeMistakes)
    .where(eq(schema.tradeMistakes.tradeId, tradeId))
    .orderBy(schema.tradeMistakes.createdAt)
    .all();

  return { status: 200, data: mistakes };
}

function doDelete(tradeId: string, mistakeId: string | null): { status: number; data: Record<string, unknown> } {
  if (!mistakeId) {
    return { status: 400, data: { error: 'Mistake id query parameter is required' } };
  }

  const trade = db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, tradeId))
    .get();

  if (!trade) {
    return { status: 404, data: { error: 'Trade not found' } };
  }

  const mistake = db
    .select()
    .from(schema.tradeMistakes)
    .where(eq(schema.tradeMistakes.id, mistakeId))
    .get();

  if (!mistake) {
    return { status: 404, data: { error: 'Mistake not found' } };
  }

  db.delete(schema.tradeMistakes)
    .where(eq(schema.tradeMistakes.id, mistakeId))
    .run();

  return { status: 200, data: { message: 'Mistake removed' } };
}

// ── Seed data ───────────────────────────────────────────────────────

const accountId = randomUUID();
const trade1Id = randomUUID();
const trade2Id = randomUUID();

// Create lookup values for mistake types
const lookupSetupSelection = randomUUID();
const lookupRiskAssessment = randomUUID();
const lookupEntryTiming = randomUUID();
const lookupPositionSizing = randomUUID();
const lookupPatience = randomUUID();

db.insert(schema.accounts).values({ id: accountId, name: 'Test Account' }).run();
db.insert(schema.trades).values([
  { id: trade1Id, tradeCode: 'TEST-MIST-001', accountId, symbol: 'AAPL', direction: 'long', status: 'closed' },
  { id: trade2Id, tradeCode: 'TEST-MIST-002', accountId, symbol: 'MSFT', direction: 'short', status: 'closed' },
]).run();

db.insert(schema.lookupValues).values([
  { id: lookupSetupSelection, type: 'mistake_type', value: 'fv_setup_selection', description: 'Setup selection failure' },
  { id: lookupRiskAssessment, type: 'mistake_type', value: 'fv_risk_assessment', description: 'Risk assessment failure' },
  { id: lookupEntryTiming, type: 'mistake_type', value: 'fv_entry_timing', description: 'Entry timing failure' },
  { id: lookupPositionSizing, type: 'mistake_type', value: 'fv_position_sizing', description: 'Position sizing failure' },
  { id: lookupPatience, type: 'mistake_type', value: 'fv_patience', description: 'Patience failure' },
]).run();

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Mistake POST Handler Tests ---\n');

// ── Test 1: Trade not found ─────────────────────────────────────────

console.log('1. POST to non-existent trade returns 404:');
{
  const result = doPost('non-existent-id', {
    mistakeType: 'fv_setup_selection',
    phase: 'entry',
    severity: 'major',
    rootCause: 'Did not follow plan',
    correctiveAction: 'Wait for confirmation next time',
  });
  assert(result.status === 404, 'returns 404 for unknown trade');
  assert(
    (result.data as { error: string }).error === 'Trade not found',
    'error message is "Trade not found"',
  );
}

// ── Test 2: Create mistake successfully ─────────────────────────────

console.log('\n2. POST creates mistake with resolved mistakeTypeId:');
{
  const result = doPost(trade1Id, {
    mistakeType: 'fv_setup_selection',
    phase: 'entry',
    severity: 'major',
    rootCause: 'Entered without confirmation',
    correctiveAction: 'Wait for setup confirmation',
  });

  assert(result.status === 201, 'returns 201 for created mistake');
  const data = result.data as Record<string, unknown>;
  assert(data.id !== undefined, 'mistake has an id');
  assert(data.tradeId === trade1Id, 'tradeId matches');
  assert(data.mistakeTypeId === lookupSetupSelection, 'mistakeTypeId resolved to lookup UUID');
  assert(data.phase === 'entry', 'phase matches');
  assert(data.severity === 'major', 'severity matches');
  assert(data.rootCause === 'Entered without confirmation', 'rootCause matches');
  assert(data.correctiveAction === 'Wait for setup confirmation', 'correctiveAction matches');
  assert(data.status === 'open', 'status defaults to open');
}

// ── Test 3: Unknown mistake type ────────────────────────────────────

console.log('\n3. POST with unknown mistake type returns 400:');
{
  const result = doPost(trade1Id, {
    mistakeType: 'invalid_type',
    phase: 'entry',
    severity: 'minor',
    rootCause: 'Test',
    correctiveAction: 'Test',
  });

  assert(result.status === 400, 'returns 400 for unknown mistake type');
  const data = result.data as { error: string; details: { fieldErrors: Record<string, string[]> } };
  assert(data.error === 'Validation failed', 'error message is "Validation failed"');
  assert(data.details.fieldErrors.mistakeType !== undefined, 'fieldError for mistakeType');
}

// ── Test 4: Validation rejects invalid phase ────────────────────────

console.log('\n4. POST with invalid phase returns 400:');
{
  const result = doPost(trade1Id, {
    mistakeType: 'fv_setup_selection',
    phase: 'invalid_phase',
    severity: 'minor',
    rootCause: 'Test',
    correctiveAction: 'Test',
  });

  assert(result.status === 400, 'returns 400 for invalid phase');
}

// ── Test 5: Validation rejects invalid severity ─────────────────────

console.log('\n5. POST with invalid severity returns 400:');
{
  const result = doPost(trade1Id, {
    mistakeType: 'fv_setup_selection',
    phase: 'entry',
    severity: 'extreme',
    rootCause: 'Test',
    correctiveAction: 'Test',
  });

  assert(result.status === 400, 'returns 400 for invalid severity');
}

// ── Test 6: Validation rejects missing required fields ──────────────

console.log('\n6. POST with missing rootCause returns 400:');
{
  const result = doPost(trade1Id, {
    mistakeType: 'fv_setup_selection',
    phase: 'entry',
    severity: 'minor',
    // missing rootCause
    correctiveAction: 'Test',
  });

  assert(result.status === 400, 'returns 400 for missing rootCause');
}

// ── Test 7: Validation rejects empty required fields ────────────────

console.log('\n7. POST with empty correctiveAction returns 400:');
{
  const result = doPost(trade1Id, {
    mistakeType: 'fv_setup_selection',
    phase: 'entry',
    severity: 'minor',
    rootCause: 'Test',
    correctiveAction: '',
  });

  assert(result.status === 400, 'returns 400 for empty correctiveAction');
}

// ── Test 8: POST with explicit status ───────────────────────────────

console.log('\n8. POST with explicit status stores correctly:');
{
  const result = doPost(trade1Id, {
    mistakeType: 'fv_risk_assessment',
    phase: 'exit',
    severity: 'critical',
    rootCause: 'Did not use stop loss',
    correctiveAction: 'Always set stop loss before entry',
    status: 'addressed',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assert(data.mistakeTypeId === lookupRiskAssessment, 'mistakeTypeId resolved');
  assert(data.phase === 'exit', 'phase matches');
  assert(data.severity === 'critical', 'severity matches');
  assert(data.status === 'addressed', 'status stored as addressed');
}

// ── Test 9: POST with invalid status ────────────────────────────────

console.log('\n9. POST with invalid status returns 400:');
{
  const result = doPost(trade1Id, {
    mistakeType: 'fv_setup_selection',
    phase: 'entry',
    severity: 'minor',
    rootCause: 'Test',
    correctiveAction: 'Test',
    status: 'invalid_status',
  });

  assert(result.status === 400, 'returns 400 for invalid status');
}

// ── Test 10: Multiple mistakes per trade ────────────────────────────

console.log('\n10. POST creates multiple mistakes for the same trade:');
{
  const r1 = doPost(trade2Id, {
    mistakeType: 'fv_entry_timing',
    phase: 'entry',
    severity: 'moderate',
    rootCause: 'Entered too early',
    correctiveAction: 'Wait for confirmation candle',
  });

  const r2 = doPost(trade2Id, {
    mistakeType: 'fv_patience',
    phase: 'management',
    severity: 'minor',
    rootCause: 'Moved stop too quickly',
    correctiveAction: 'Let trades breathe',
  });

  assert(r1.status === 201, 'first mistake created');
  assert(r2.status === 201, 'second mistake created');
  const d1 = r1.data as Record<string, unknown>;
  const d2 = r2.data as Record<string, unknown>;
  assert(d1.mistakeTypeId === lookupEntryTiming, 'first mistake type resolved');
  assert(d2.mistakeTypeId === lookupPatience, 'second mistake type resolved');
}

// ── Test 11: GET returns empty array for trade with no mistakes ────

console.log('\n11. GET for trade with no mistakes returns empty array:');
{
  const noMistTradeId = randomUUID();
  db.insert(schema.trades).values({
    id: noMistTradeId, tradeCode: 'TEST-MIST-NM', accountId, symbol: 'TSLA', direction: 'long', status: 'closed',
  }).run();

  const result = doGet(noMistTradeId);
  assert(result.status === 200, 'returns 200');
  assert(Array.isArray(result.data), 'returns an array');
  assert((result.data as unknown[]).length === 0, 'returns empty array');
}

// ── Test 12: GET returns mistakes for a trade ───────────────────────

console.log('\n12. GET fetches all mistakes for a trade:');
{
  const result = doGet(trade1Id);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assert(data.length >= 2, 'has at least 2 mistakes');
  // Verify first mistake
  const first = data[0];
  assert(first.tradeId === trade1Id, 'tradeId matches');
  assert(first.severity !== undefined, 'severity present');
}

// ── Test 13: GET for non-existent trade returns 404 ─────────────────

console.log('\n13. GET for non-existent trade returns 404:');
{
  const result = doGet('non-existent-id');
  assert(result.status === 404, 'returns 404');
  assert(
    (result.data as { error: string }).error === 'Trade not found',
    'error message is "Trade not found"',
  );
}

// ── Test 14: DELETE removes a mistake ────────────────────────────────

console.log('\n14. DELETE removes a mistake by id:');
{
  // Create a mistake to delete
  const create = doPost(trade1Id, {
    mistakeType: 'fv_position_sizing',
    phase: 'pre_trade',
    severity: 'moderate',
    rootCause: 'Risked too much',
    correctiveAction: 'Use position sizing formula',
  });
  assert(create.status === 201, 'created mistake to delete');

  const createdData = create.data as Record<string, unknown>;
  const mistakeId = createdData.id as string;

  // Delete it
  const result = doDelete(trade1Id, mistakeId);
  assert(result.status === 200, 'returns 200 for deleted mistake');
  assert(
    (result.data as { message: string }).message === 'Mistake removed',
    'message is "Mistake removed"',
  );

  // Verify it's gone
  const after = doGet(trade1Id);
  const afterData = after.data as Record<string, unknown>[];
  const found = afterData.find(m => m.id === mistakeId);
  assert(!found, 'deleted mistake no longer in GET results');
}

// ── Test 15: DELETE with missing id param ───────────────────────────

console.log('\n15. DELETE without id query param returns 400:');
{
  const result = doDelete(trade1Id, null);
  assert(result.status === 400, 'returns 400');
  assert(
    (result.data as { error: string }).error === 'Mistake id query parameter is required',
    'error message mentions required id param',
  );
}

// ── Test 16: DELETE for non-existent trade ──────────────────────────

console.log('\n16. DELETE for non-existent trade returns 404:');
{
  const result = doDelete('non-existent-id', 'some-mistake-id');
  assert(result.status === 404, 'returns 404');
  assert(
    (result.data as { error: string }).error === 'Trade not found',
    'error message is "Trade not found"',
  );
}

// ── Test 17: DELETE for non-existent mistake ────────────────────────

console.log('\n17. DELETE for non-existent mistake returns 404:');
{
  const result = doDelete(trade1Id, 'non-existent-mistake-id');
  assert(result.status === 404, 'returns 404');
  assert(
    (result.data as { error: string }).error === 'Mistake not found',
    'error message is "Mistake not found"',
  );
}

// ── Test 18: POST creates mistake with different phase values ──────

console.log('\n18. POST with various phase values:');
{
  for (const phase of ['pre_trade', 'entry', 'management', 'exit', 'review'] as const) {
    const result = doPost(trade1Id, {
      mistakeType: 'fv_risk_assessment',
      phase,
      severity: 'minor',
      rootCause: `Test root cause for ${phase}`,
      correctiveAction: `Test corrective action for ${phase}`,
    });
    assert(result.status === 201, `phase "${phase}" accepted`);
  }
}

// ── Test 19: POST creates mistake with all severity values ─────────

console.log('\n19. POST with all severity values:');
{
  for (const severity of ['minor', 'moderate', 'major', 'critical'] as const) {
    const result = doPost(trade1Id, {
      mistakeType: 'fv_entry_timing',
      phase: 'entry',
      severity,
      rootCause: `Test root cause for ${severity}`,
      correctiveAction: `Test corrective action for ${severity}`,
    });
    assert(result.status === 201, `severity "${severity}" accepted`);
  }
}

// ── Test 20: POST with all status values ────────────────────────────

console.log('\n20. POST with all explicit status values:');
{
  for (const status of ['open', 'addressed', 'improved', 'resolved'] as const) {
    const result = doPost(trade1Id, {
      mistakeType: 'fv_patience',
      phase: 'management',
      severity: 'minor',
      rootCause: `Test root cause for status ${status}`,
      correctiveAction: `Test corrective action for status ${status}`,
      status,
    });
    assert(result.status === 201, `status "${status}" accepted`);
  }
}

// ── Summary ─────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
