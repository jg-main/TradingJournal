/**
 * grade route test
 *
 * Tests the GET and PUT handlers for trade grading.
 * PUT upserts with onConflictDoUpdate, auto-calculating totalScore and gradeLabel.
 * GET fetches grade row by tradeId.
 *
 * Run: npx tsx src/app/api/trades/\[id\]/grade/__tests__/route.test.ts
 * (uses testDbPath from src/lib/testing/test-db — OS temp, never the repo root)
 */

import { testDbPath } from '../../../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { calculateGrade } from '@/lib/grading';

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

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('trades');
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
    planned_quantity REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    risk_override_reason TEXT,
    opened_at TEXT,
    closed_at TEXT,
    reviewed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    current_price REAL,
    current_price_fetched_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_grades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    setup_quality_score INTEGER,
    risk_quality_score INTEGER,
    entry_quality_score INTEGER,
    management_quality_score INTEGER,
    exit_quality_score INTEGER,
    review_quality_score INTEGER,
    total_score REAL,
    grade_label TEXT,
    followed_plan INTEGER,
    rule_violation INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Helpers (mirrors route.ts logic) ────────────────────────────────

interface ValidationError {
  error: string;
  details: unknown;
}

function validateGradePayload(body: Record<string, unknown>):
  | { setupScore: number; riskScore: number; entryScore: number; managementScore: number; exitScore: number; reviewScore: number; followedPlan?: boolean; ruleViolation?: boolean; notes?: string }
  | ValidationError {
  const SCORE_FIELDS = ['setupScore', 'riskScore', 'entryScore', 'managementScore', 'exitScore', 'reviewScore'] as const;
  const OPTIONAL_FIELDS = ['followedPlan', 'ruleViolation', 'notes'] as const;
  const fieldErrors: Record<string, string[]> = {};

  // Check for unexpected fields
  const allAllowed = new Set<string>([...SCORE_FIELDS, ...OPTIONAL_FIELDS]);
  for (const key of Object.keys(body)) {
    if (!allAllowed.has(key)) {
      fieldErrors[key] = [`Unexpected field: ${key}`];
    }
  }

  // Validate each score field: required, integer, 1-10
  for (const field of SCORE_FIELDS) {
    const val = body[field];
    if (val === undefined) {
      fieldErrors[field] = ['Required'];
    } else if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 10) {
      fieldErrors[field] = [`Expected integer between 1 and 10, got ${JSON.stringify(val)}`];
    }
  }

  // Validate optional boolean fields
  for (const field of OPTIONAL_FIELDS) {
    if (field === 'notes') continue; // string, no validation needed
    const val = body[field];
    if (val !== undefined && val !== null && typeof val !== 'boolean') {
      fieldErrors[field] = [`Expected boolean, got ${typeof val}`];
    }
  }

  // Validate notes is string if present
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    fieldErrors.notes = [`Expected string, got ${typeof body.notes}`];
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Validation failed', details: { fieldErrors } };
  }

  return {
    setupScore: body.setupScore as number,
    riskScore: body.riskScore as number,
    entryScore: body.entryScore as number,
    managementScore: body.managementScore as number,
    exitScore: body.exitScore as number,
    reviewScore: body.reviewScore as number,
    followedPlan: body.followedPlan as boolean | undefined,
    ruleViolation: body.ruleViolation as boolean | undefined,
    notes: body.notes as string | undefined,
  };
}

function doPut(
  tradeId: string,
  body: Record<string, unknown>,
): { status: number; data: Record<string, unknown> } {
  // Validate
  const validated = validateGradePayload(body);
  if ('error' in validated) {
    return { status: 400, data: validated as unknown as Record<string, unknown> };
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

  // Calculate grade
  const { totalScore, gradeLabel } = calculateGrade({
    setupScore: validated.setupScore,
    riskScore: validated.riskScore,
    entryScore: validated.entryScore,
    managementScore: validated.managementScore,
    exitScore: validated.exitScore,
    reviewScore: validated.reviewScore,
  });

  const now = new Date().toISOString();

  // Check if grade already exists
  const existing = db
    .select()
    .from(schema.tradeGrades)
    .where(eq(schema.tradeGrades.tradeId, tradeId))
    .get();

  if (!existing) {
    // Insert
    const gradeId = randomUUID();
    db.insert(schema.tradeGrades)
      .values({
        id: gradeId,
        tradeId: tradeId,
        setupQualityScore: validated.setupScore,
        riskQualityScore: validated.riskScore,
        entryQualityScore: validated.entryScore,
        managementQualityScore: validated.managementScore,
        exitQualityScore: validated.exitScore,
        reviewQualityScore: validated.reviewScore,
        totalScore,
        gradeLabel,
        followedPlan: validated.followedPlan ?? null,
        ruleViolation: validated.ruleViolation ?? null,
        notes: validated.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = db
      .select()
      .from(schema.tradeGrades)
      .where(eq(schema.tradeGrades.id, gradeId))
      .get();

    return { status: 201, data: created as unknown as Record<string, unknown> };
  }

  // Update
  db.update(schema.tradeGrades)
    .set({
      setupQualityScore: validated.setupScore,
      riskQualityScore: validated.riskScore,
      entryQualityScore: validated.entryScore,
      managementQualityScore: validated.managementScore,
      exitQualityScore: validated.exitScore,
      reviewQualityScore: validated.reviewScore,
      totalScore,
      gradeLabel,
      followedPlan: validated.followedPlan ?? null,
      ruleViolation: validated.ruleViolation ?? null,
      notes: validated.notes ?? null,
      updatedAt: now,
    })
    .where(eq(schema.tradeGrades.tradeId, tradeId))
    .run();

  const updated = db
    .select()
    .from(schema.tradeGrades)
    .where(eq(schema.tradeGrades.tradeId, tradeId))
    .get();

  return { status: 200, data: updated as unknown as Record<string, unknown> };
}

function doGet(tradeId: string): { status: number; data: Record<string, unknown> } {
  const row = db
    .select()
    .from(schema.tradeGrades)
    .where(eq(schema.tradeGrades.tradeId, tradeId))
    .get();

  if (!row) {
    return { status: 404, data: { error: 'Grade not found' } };
  }

  return { status: 200, data: row as unknown as Record<string, unknown> };
}

// ── Seed data ───────────────────────────────────────────────────────

const accountId = randomUUID();
const trade1Id = randomUUID();
const trade2Id = randomUUID();
const trade3Id = randomUUID();

db.insert(schema.accounts).values({ id: accountId, name: 'Test Account' }).run();
db.insert(schema.trades).values([
  { id: trade1Id, tradeCode: 'TEST-GRADE-001', accountId, symbol: 'AAPL', direction: 'long', status: 'closed' },
  { id: trade2Id, tradeCode: 'TEST-GRADE-002', accountId, symbol: 'MSFT', direction: 'short', status: 'closed' },
  { id: trade3Id, tradeCode: 'TEST-GRADE-003', accountId, symbol: 'GOOGL', direction: 'long', status: 'closed' },
]).run();

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Grade PUT Handler Tests ---\n');

// ── Test 1: Trade not found ─────────────────────────────────────────

console.log('1. Trade not found returns 404:');
{
  const result = doPut('non-existent-id', {
    setupScore: 8, riskScore: 7, entryScore: 6,
    managementScore: 5, exitScore: 4, reviewScore: 3,
  });
  assert(result.status === 404, 'returns 404 for unknown trade');
  assert(
    (result.data as { error: string }).error === 'Trade not found',
    'error message is "Trade not found"',
  );
}

// ── Test 2: First PUT creates grade with calculation ────────────────

console.log('\n2. First PUT creates grade with auto-calculated totalScore and gradeLabel:');
{
  const result = doPut(trade1Id, {
    setupScore: 8, riskScore: 7, entryScore: 9,
    managementScore: 6, exitScore: 5, reviewScore: 8,
  });

  assert(result.status === 201, 'returns 201 for created grade');
  const data = result.data as Record<string, unknown>;
  assert(data.id !== undefined, 'grade has an id');
  assert(data.tradeId === trade1Id, 'tradeId matches');
  assert(data.setupQualityScore === 8, 'setupQualityScore = 8');
  assert(data.riskQualityScore === 7, 'riskQualityScore = 7');
  assert(data.entryQualityScore === 9, 'entryQualityScore = 9');
  assert(data.managementQualityScore === 6, 'managementQualityScore = 6');
  assert(data.exitQualityScore === 5, 'exitQualityScore = 5');
  assert(data.reviewQualityScore === 8, 'reviewQualityScore = 8');

  // total = 8+7+9+6+5+8 = 43, gradeLabel should be 'B' (>= 42)
  assert(data.totalScore === 43, 'totalScore = 8+7+9+6+5+8 = 43');
  assert(data.gradeLabel === 'B', 'gradeLabel = B for totalScore 43');
}

// ── Test 3: Second PUT updates existing grade (upsert) ──────────────

console.log('\n3. Second PUT updates existing grade:');
{
  const result = doPut(trade1Id, {
    setupScore: 10, riskScore: 9, entryScore: 10,
    managementScore: 8, exitScore: 7, reviewScore: 9,
  });

  assert(result.status === 200, 'returns 200 for update');
  const data = result.data as Record<string, unknown>;
  assert(data.setupQualityScore === 10, 'setupQualityScore updated to 10');
  assert(data.riskQualityScore === 9, 'riskQualityScore updated to 9');

  // total = 10+9+10+8+7+9 = 53, gradeLabel should be 'B' (< 54)
  assert(data.totalScore === 53, 'totalScore = 10+9+10+8+7+9 = 53');
  assert(data.gradeLabel === 'B', 'gradeLabel = B for totalScore 53');
}

// ── Test 4: Validation rejects non-integer score ────────────────────

console.log('\n4. PUT with non-integer score returns 400:');
{
  const result = doPut(trade2Id, {
    setupScore: 8.5, riskScore: 7, entryScore: 6,
    managementScore: 5, exitScore: 4, reviewScore: 3,
  });
  assert(result.status === 400, 'returns 400 for non-integer score');
  const data = result.data as { error: string };
  assert(data.error === 'Validation failed', 'error message is "Validation failed"');
}

// ── Test 5: Validation rejects out-of-range score ───────────────────

console.log('\n5. PUT with score 0 (below 1) returns 400:');
{
  const result = doPut(trade2Id, {
    setupScore: 0, riskScore: 7, entryScore: 6,
    managementScore: 5, exitScore: 4, reviewScore: 3,
  });
  assert(result.status === 400, 'returns 400 for score 0');
}

// ── Test 6: Validation rejects score above 10 ───────────────────────

console.log('\n6. PUT with score 11 (above 10) returns 400:');
{
  const result = doPut(trade2Id, {
    setupScore: 11, riskScore: 7, entryScore: 6,
    managementScore: 5, exitScore: 4, reviewScore: 3,
  });
  assert(result.status === 400, 'returns 400 for score 11');
}

// ── Test 7: Validation rejects missing score fields ─────────────────

console.log('\n7. PUT with missing score field returns 400:');
{
  const result = doPut(trade2Id, {
    setupScore: 8, riskScore: 7, entryScore: 6,
    managementScore: 5, exitScore: 4,
    // missing reviewScore
  });
  assert(result.status === 400, 'returns 400 for missing reviewScore');
}

// ── Test 8: Boolean fields are stored correctly ─────────────────────

console.log('\n8. PUT with followedPlan and ruleViolation stores correctly:');
{
  const result = doPut(trade2Id, {
    setupScore: 9, riskScore: 8, entryScore: 7,
    managementScore: 6, exitScore: 5, reviewScore: 4,
    followedPlan: true,
    ruleViolation: false,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assert(data.followedPlan === true, 'followedPlan stored as true');
  assert(data.ruleViolation === false, 'ruleViolation stored as false');
}

// ── Test 9: Grade A boundary (total >= 54) ──────────────────────────

console.log('\n9. Total score 54 produces grade A:');
{
  const result = doPut(trade3Id, {
    setupScore: 9, riskScore: 9, entryScore: 9,
    managementScore: 9, exitScore: 9, reviewScore: 9,
  });

  const data = result.data as Record<string, unknown>;
  assert(data.totalScore === 54, 'totalScore = 9+9+9+9+9+9 = 54');
  assert(data.gradeLabel === 'A', 'gradeLabel = A');
}

// ── Test 10: Grade F boundary (total < 18) ──────────────────────────

console.log('\n10. Total score 6 produces grade F:');
{
  const lowTradeId = randomUUID();
  db.insert(schema.trades).values({
    id: lowTradeId, tradeCode: 'TEST-GRADE-LOW', accountId, symbol: 'NFLX', direction: 'long', status: 'closed',
  }).run();

  const result = doPut(lowTradeId, {
    setupScore: 1, riskScore: 1, entryScore: 1,
    managementScore: 1, exitScore: 1, reviewScore: 1,
  });

  const data = result.data as Record<string, unknown>;
  assert(data.totalScore === 6, 'totalScore = 1+1+1+1+1+1 = 6');
  assert(data.gradeLabel === 'F', 'gradeLabel = F');
}

// ── Test 11: GET returns grade ──────────────────────────────────────

console.log('\n11. GET fetches existing grade:');
{
  // Use trade1Id which already has a grade from Test 3
  const result = doGet(trade1Id);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assert(data.tradeId === trade1Id, 'tradeId matches');
  assert((data as { totalScore: number }).totalScore !== undefined, 'totalScore present');
}

// ── Test 12: GET returns 404 for missing grade ──────────────────────

console.log('\n12. GET for non-existent grade returns 404:');
{
  const noGradeTradeId = randomUUID();
  db.insert(schema.trades).values({
    id: noGradeTradeId, tradeCode: 'TEST-GRADE-NOG', accountId, symbol: 'TSLA', direction: 'short', status: 'closed',
  }).run();

  const result = doGet(noGradeTradeId);
  assert(result.status === 404, 'returns 404');
  assert(
    (result.data as { error: string }).error === 'Grade not found',
    'error message is "Grade not found"',
  );
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
