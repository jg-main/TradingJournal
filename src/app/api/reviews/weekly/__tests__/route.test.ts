/**
 * weekly review route tests
 *
 * Tests the GET, POST, PUT, DELETE handlers for weekly reviews.
 * POST auto-populates metrics from closed trades in the given week.
 * GET lists reviews, optionally filtered by accountId.
 * PUT updates notes/focusNextWeek only; immutable fields are rejected.
 * DELETE removes a review.
 *
 * Run: DB_FILE_NAME=./.test-ms02-t06.db npx tsx src/app/api/reviews/weekly/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { testDbPath, disposeSqliteFile } from '../../../../../lib/testing/test-db';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { computeWeeklyMetrics, type WeekReviewTradeInput } from '@/lib/weekly-review';

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

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('reviews-weekly');
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

  CREATE TABLE IF NOT EXISTS trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    executed_at TEXT,
    action TEXT NOT NULL CHECK(action IN ('buy','sell','buy_to_cover','sell_short','add','reduce')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    idempotency_key TEXT,
    created_at TEXT DEFAULT (current_timestamp)
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

  CREATE TABLE IF NOT EXISTS trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    account_equity_at_open REAL,
  account_equity_source TEXT,
  account_equity_as_of TEXT,
    initial_entry_price REAL,
    initial_stop_price REAL,
    initial_quantity REAL,
    risk_per_share REAL,
    initial_risk_amount REAL,
    account_risk_pct REAL,
    planned_reward_risk REAL,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS weekly_reviews (
    id TEXT PRIMARY KEY NOT NULL,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    closed_trades INTEGER DEFAULT 0,
    net_pnl REAL DEFAULT 0,
    avg_r REAL DEFAULT 0,
    win_rate REAL DEFAULT 0,
    avg_process_score REAL DEFAULT 0,
    notes TEXT,
    focus_next_week TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp),
    UNIQUE(account_id, week_start, week_end)
  );
`);

// ── Helpers (mirrors route.ts logic) ────────────────────────────────

function doPost(weekStart: string, accountId: string): {
  status: number;
  data: Record<string, unknown>;
} {
  // Validate
  if (!weekStart || weekStart.trim() === '') {
    return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { weekStart: ['Required'] } } } };
  }
  if (!accountId || accountId.trim() === '') {
    return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { accountId: ['Required'] } } } };
  }

  // Compute week boundaries
  const startDate = new Date(weekStart);
  startDate.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  endDate.setUTCHours(23, 59, 59, 999);

  const weekStartStr = startDate.toISOString().split('T')[0];
  const weekEndStr = endDate.toISOString().split('T')[0];
  const weekStartISO = startDate.toISOString();
  const weekEndISO = endDate.toISOString();

  const tradesInRange = db
    .select()
    .from(schema.trades)
    .where(
      and(
        eq(schema.trades.accountId, accountId),
        eq(schema.trades.status, 'closed'),
        gte(schema.trades.closedAt, weekStartISO),
        lte(schema.trades.closedAt, weekEndISO),
      ),
    )
    .all();

  const tradeIds = tradesInRange.map((t: Record<string, unknown>) => t.id as string);

  // Batch fetch related data
  const executionsMap = new Map<string, Record<string, unknown>[]>();
  const gradesMap = new Map<string, Record<string, unknown>>();
  const riskMap = new Map<string, Record<string, unknown>>();

  if (tradeIds.length > 0) {
    const execs = db
      .select()
      .from(schema.tradeExecutions)
      .where(inArray(schema.tradeExecutions.tradeId, tradeIds))
      .all();

    for (const exec of execs) {
      const list = executionsMap.get(exec.tradeId) ?? [];
      list.push(exec);
      executionsMap.set(exec.tradeId, list);
    }

    const gradeRows = db
      .select()
      .from(schema.tradeGrades)
      .where(inArray(schema.tradeGrades.tradeId, tradeIds))
      .all();

    for (const grade of gradeRows) {
      gradesMap.set(grade.tradeId, grade);
    }

    const snapshots = db
      .select()
      .from(schema.tradeRiskSnapshots)
      .where(inArray(schema.tradeRiskSnapshots.tradeId, tradeIds))
      .all();

    for (const snap of snapshots) {
      riskMap.set(snap.tradeId, snap);
    }
  }

  // Convert to WeekReviewTradeInput[]
  const reviewInputs: WeekReviewTradeInput[] = tradesInRange.map((trade: Record<string, unknown>) => ({
    id: trade.id as string,
    direction: trade.direction as 'long' | 'short',
    executions: (executionsMap.get(trade.id as string) ?? []).map((ex: Record<string, unknown>) => ({
      action: ex.action as string,
      quantity: ex.quantity as number,
      price: ex.price as number,
      fees: (ex.fees ?? null) as number | null,
      executedAt: (ex.executedAt ?? '') as string,
    })),
    grade: (() => {
      const gradeRow = gradesMap.get(trade.id as string);
      const totalScore = gradeRow?.totalScore as number | undefined;
      return totalScore != null ? { totalScore } : null;
    })(),
    riskSnapshot: riskMap.has(trade.id as string)
      ? { initialRiskAmount: (riskMap.get(trade.id as string)!.initialRiskAmount as number | null) ?? null }
      : null,
  }));

  const metrics = computeWeeklyMetrics(reviewInputs);

  const now = new Date().toISOString();
  const reviewId = randomUUID();

  db.insert(schema.weeklyReviews)
    .values({
      id: reviewId,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      accountId,
      closedTrades: metrics.closedTrades,
      netPnl: metrics.netPnl,
      avgR: metrics.avgR ?? null,
      winRate: metrics.winRate,
      avgProcessScore: metrics.avgProcessScore ?? null,
      notes: null,
      focusNextWeek: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.weeklyReviews.accountId, schema.weeklyReviews.weekStart, schema.weeklyReviews.weekEnd],
      set: {
        closedTrades: metrics.closedTrades,
        netPnl: metrics.netPnl,
        avgR: metrics.avgR ?? null,
        winRate: metrics.winRate,
        avgProcessScore: metrics.avgProcessScore ?? null,
        updatedAt: now,
      },
    })
    .run();

  const row = db
    .select()
    .from(schema.weeklyReviews)
    .where(
      and(
        eq(schema.weeklyReviews.accountId, accountId),
        eq(schema.weeklyReviews.weekStart, weekStartStr),
        eq(schema.weeklyReviews.weekEnd, weekEndStr),
      ),
    )
    .get();

  return { status: 201, data: row as unknown as Record<string, unknown> };
}

function doGetList(accountId?: string): { status: number; data: Record<string, unknown>[] } {
  const conditions: ReturnType<typeof eq>[] = [];

  if (accountId) {
    conditions.push(eq(schema.weeklyReviews.accountId, accountId));
  }

  const query = db
    .select()
    .from(schema.weeklyReviews)
    .orderBy(schema.weeklyReviews.weekStart);

  const items = conditions.length > 0
    ? query.where(and(...conditions)).all()
    : query.all();

  return { status: 200, data: items as unknown as Record<string, unknown>[] };
}

function doGetSingle(id: string): { status: number; data: Record<string, unknown> } {
  const row = db
    .select()
    .from(schema.weeklyReviews)
    .where(eq(schema.weeklyReviews.id, id))
    .get();

  if (!row) {
    return { status: 404, data: { error: 'Weekly review not found' } };
  }

  return { status: 200, data: row as unknown as Record<string, unknown> };
}

const IMMUTABLE_FIELDS = [
  'weekStart', 'weekEnd', 'accountId',
  'closedTrades', 'netPnl', 'avgR', 'winRate', 'avgProcessScore',
];

function doPut(
  id: string,
  body: Record<string, unknown>,
): { status: number; data: Record<string, unknown> } {
  const existing = db
    .select()
    .from(schema.weeklyReviews)
    .where(eq(schema.weeklyReviews.id, id))
    .get();

  if (!existing) {
    return { status: 404, data: { error: 'Weekly review not found' } };
  }

  // Reject immutable field modifications
  const attemptedImmutable = Object.keys(body).filter((k) =>
    IMMUTABLE_FIELDS.includes(k),
  );
  if (attemptedImmutable.length > 0) {
    return {
      status: 400,
      data: { error: 'Cannot modify immutable fields', details: { fields: attemptedImmutable } },
    };
  }

  // Validate: at least one of notes or focusNextWeek
  const hasNotes = body.notes !== undefined;
  const hasFocus = body.focusNextWeek !== undefined;
  if (!hasNotes && !hasFocus) {
    return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { _errors: ['At least one of notes or focusNextWeek must be provided'] } } } };
  }

  const now = new Date().toISOString();
  const updateValues: Record<string, string | null> = { updatedAt: now };

  if (body.notes !== undefined) {
    updateValues.notes = body.notes as string;
  }
  if (body.focusNextWeek !== undefined) {
    updateValues.focusNextWeek = body.focusNextWeek as string;
  }

  db.update(schema.weeklyReviews)
    .set(updateValues)
    .where(eq(schema.weeklyReviews.id, id))
    .run();

  const updated = db
    .select()
    .from(schema.weeklyReviews)
    .where(eq(schema.weeklyReviews.id, id))
    .get();

  return { status: 200, data: updated as unknown as Record<string, unknown> };
}

function doDelete(id: string): { status: number; data: Record<string, unknown> } {
  const existing = db
    .select()
    .from(schema.weeklyReviews)
    .where(eq(schema.weeklyReviews.id, id))
    .get();

  if (!existing) {
    return { status: 404, data: { error: 'Weekly review not found' } };
  }

  db.delete(schema.weeklyReviews)
    .where(eq(schema.weeklyReviews.id, id))
    .run();

  return { status: 200, data: { message: 'Weekly review removed' } };
}

// ── Seed data ───────────────────────────────────────────────────────

const accountId = randomUUID();
const account2Id = randomUUID();
const trade1Id = randomUUID();
const trade2Id = randomUUID();
const trade3Id = randomUUID();
const trade4Id = randomUUID(); // outside week, should not be counted

// Monday June 1 2026
const weekStart = '2026-06-01';
// Sunday June 7 2026
// June 3 2026 (within week)
const inWeek = '2026-06-03T12:00:00.000Z';
// June 14 2026 (outside week)
const outOfWeek = '2026-06-14T12:00:00.000Z';

db.insert(schema.accounts).values([
  { id: accountId, name: 'Test Account' },
  { id: account2Id, name: 'Second Account' },
]).run();

db.insert(schema.trades).values([
  {
    id: trade1Id, tradeCode: 'WR-TEST-001', accountId, symbol: 'AAPL',
    direction: 'long', status: 'closed', closedAt: inWeek,
  },
  {
    id: trade2Id, tradeCode: 'WR-TEST-002', accountId, symbol: 'MSFT',
    direction: 'short', status: 'closed', closedAt: inWeek,
  },
  {
    id: trade3Id, tradeCode: 'WR-TEST-003', accountId, symbol: 'GOOGL',
    direction: 'long', status: 'closed', closedAt: inWeek,
  },
  {
    id: trade4Id, tradeCode: 'WR-TEST-OUT', accountId, symbol: 'NFLX',
    direction: 'long', status: 'closed', closedAt: outOfWeek,
  },
]).run();

// Trade 1: long AAPL — buy 10@100, sell 10@110, fees=$5
// PnL = (110-100)*10 - 5 = $95 (win)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: trade1Id, executedAt: '2026-06-01T10:00:00.000Z', action: 'buy', quantity: 10, price: 100, fees: 2 },
  { id: randomUUID(), tradeId: trade1Id, executedAt: '2026-06-03T14:00:00.000Z', action: 'sell', quantity: 10, price: 110, fees: 3 },
]).run();

// Trade 2: short MSFT — sell_short 20@200, buy_to_cover 20@190, fees=$10
// PnL = (200-190)*20 - 10 = $190 (win)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: trade2Id, executedAt: '2026-06-02T09:00:00.000Z', action: 'sell_short', quantity: 20, price: 200, fees: 5 },
  { id: randomUUID(), tradeId: trade2Id, executedAt: '2026-06-04T16:00:00.000Z', action: 'buy_to_cover', quantity: 20, price: 190, fees: 5 },
]).run();

// Trade 3: long GOOGL — buy 5@150, sell 5@140, fees=$3
// PnL = (140-150)*5 - 3 = -$53 (loss)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: trade3Id, executedAt: '2026-06-01T11:00:00.000Z', action: 'buy', quantity: 5, price: 150, fees: 1 },
  { id: randomUUID(), tradeId: trade3Id, executedAt: '2026-06-05T15:00:00.000Z', action: 'sell', quantity: 5, price: 140, fees: 2 },
]).run();

// Trade 4 (outside week): long NFLX — buy 10@200, sell 10@210, fees=$4
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: trade4Id, executedAt: '2026-06-10T10:00:00.000Z', action: 'buy', quantity: 10, price: 200, fees: 2 },
  { id: randomUUID(), tradeId: trade4Id, executedAt: '2026-06-14T14:00:00.000Z', action: 'sell', quantity: 10, price: 210, fees: 2 },
]).run();

// Grades: trade1 (score 80/60=avg ~46.67?), trade2 (score 60/60=60)
// Let me use actual totals from computeWeeklyMetrics expectations
// totalScores: 80, 60 → avgProcessScore = 70
db.insert(schema.tradeGrades).values([
  { id: randomUUID(), tradeId: trade1Id, totalScore: 80, gradeLabel: 'A' },
  { id: randomUUID(), tradeId: trade2Id, totalScore: 60, gradeLabel: 'B' },
  // trade3 has no grade → ungraded
]).run();

// Risk snapshots: trade1 (initialRiskAmount=100), trade2 (initialRiskAmount=200)
// trade3 has none → unassessedRisk
// trade4 has none (but it's outside week)
db.insert(schema.tradeRiskSnapshots).values([
  { id: randomUUID(), tradeId: trade1Id, initialRiskAmount: 100 },
  { id: randomUUID(), tradeId: trade2Id, initialRiskAmount: 200 },
]).run();

// Expected computed metrics:
// Trade1 PnL = 95, R = 95/100 = 0.95, gradeTotal=80
// Trade2 PnL = 190, R = 190/200 = 0.95, gradeTotal=60
// Trade3 PnL = -53, no risk, no grade
// closedTrades = 3 (excluding trade4 out of week)
// netPnl = 95 + 190 + (-53) = 232
// winRate = 2/3 = 0.6667
// avgR = (0.95 + 0.95) / 2 = 0.95
// avgProcessScore = (80 + 60) / 2 = 70

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Weekly Review POST Handler Tests ---\n');

// ── Test 1: POST with no weekStart returns 400 ─────────────────────

console.log('1. POST with missing weekStart returns 400:');
{
  const result = doPost('', accountId);
  assert(result.status === 400, 'returns 400 for missing weekStart');
}

// ── Test 2: POST with no accountId returns 400 ─────────────────────

console.log('\n2. POST with missing accountId returns 400:');
{
  const result = doPost(weekStart, '');
  assert(result.status === 400, 'returns 400 for missing accountId');
}

// ── Test 3: POST generates correct aggregated metrics ──────────────

console.log('\n3. POST generates correct aggregated metrics from seed trades:');
{
  const result = doPost(weekStart, accountId);
  assert(result.status === 201, 'returns 201 for created review');
  const data = result.data as Record<string, unknown>;
  assert(data.id !== undefined, 'review has an id');
  assert(data.weekStart === weekStart, 'weekStart matches');
  assert(data.weekEnd === '2026-06-07', 'weekEnd = 2026-06-07 (Sunday)');
  assert(data.closedTrades === 3, 'closedTrades = 3 (excludes trade outside week)');
  assert(data.netPnl === 232, 'netPnl = 232 (95 + 190 - 53)');
  assert(data.winRate === 2 / 3, 'winRate = 2/3');
  assert(data['avgProcessScore'] as number === 70, 'avgProcessScore = 70');

  // avgR = (95/100 + 190/200) / 2 = (0.95 + 0.95) / 2 = 0.95
  assert(data['avgR'] as number === 0.95, 'avgR = 0.95');
}

// ── Test 4: POST with no closed trades returns review with zeros ───

console.log('\n4. POST with no closed trades in week returns review with zeros:');
{
  // Use account2Id which has no trades
  const result = doPost(weekStart, account2Id);
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assert(data.closedTrades === 0, 'closedTrades = 0');
  assert(data.netPnl === 0, 'netPnl = 0');
  assert(data.winRate === 0, 'winRate = 0');
}

// ── Test 5: POST upserts on duplicate (accountId + weekStart + weekEnd) ──

console.log('\n5. POST same week again upserts (idempotent):');
{
  const result1 = doPost(weekStart, accountId);
  assert(result1.status === 201, 'first call returns 201');
  const data1 = result1.data as Record<string, unknown>;

  // Second call should still succeed (upsert)
  const result2 = doPost(weekStart, accountId);
  assert(result2.status === 201, 'second call returns 201');
  const data2 = result2.data as Record<string, unknown>;
  assert(data2.id === data1.id, 'same review id on upsert (conflict resolved)');
}

// ── Test 6: GET lists all reviews ──────────────────────────────────

console.log('\n6. GET lists all reviews:');
{
  const result = doGetList();
  assert(result.status === 200, 'returns 200');
  const items = result.data;
  assert(items.length >= 2, 'has at least 2 reviews');
}

// ── Test 7: GET lists reviews filtered by accountId ────────────────

console.log('\n7. GET filters by accountId:');
{
  const result = doGetList(account2Id);
  assert(result.status === 200, 'returns 200');
  const items = result.data;
  assert(items.length === 1, 'only 1 review for account2');
  const item = items[0] as Record<string, unknown>;
  assert(item.accountId === account2Id, 'accountId matches filter');
}

// ── Test 8: GET single review by id ────────────────────────────────

console.log('\n8. GET single review by id:');
{
  // Fetch the review we created for account2
  const list = doGetList(account2Id);
  const reviewId = (list.data[0] as Record<string, unknown>).id as string;

  const result = doGetSingle(reviewId);
  assert(result.status === 200, 'returns 200');
  const data = result.data;
  assert(data.id === reviewId, 'id matches');
}

// ── Test 9: GET single review with non-existent id returns 404 ─────

console.log('\n9. GET with non-existent id returns 404:');
{
  const result = doGetSingle('non-existent-id');
  assert(result.status === 404, 'returns 404');
  assert(
    (result.data as { error: string }).error === 'Weekly review not found',
    'error message is "Weekly review not found"',
  );
}

// ── Test 10: PUT updates notes only ────────────────────────────────

console.log('\n10. PUT updates notes:');
{
  const list = doGetList(accountId);
  const reviewId = (list.data[0] as Record<string, unknown>).id as string;

  // Store original netPnl to verify it doesn't change
  const origData = doGetSingle(reviewId).data as Record<string, unknown>;
  const origNetPnl = origData.netPnl;

  const result = doPut(reviewId, { notes: 'Good week of trading' });
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assert(data.notes === 'Good week of trading', 'notes updated');
  assert(data.netPnl === origNetPnl, 'netPnl unchanged');
}

// ── Test 11: PUT updates focusNextWeek ─────────────────────────────

console.log('\n11. PUT updates focusNextWeek:');
{
  const list = doGetList(accountId);
  const reviewId = (list.data[0] as Record<string, unknown>).id as string;

  const result = doPut(reviewId, { focusNextWeek: 'Reduce overtrading' });
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assert(data.focusNextWeek === 'Reduce overtrading', 'focusNextWeek updated');
}

// ── Test 12: PUT rejects immutable field modifications ─────────────

console.log('\n12. PUT with immutable field returns 400:');
{
  const list = doGetList(accountId);
  const reviewId = (list.data[0] as Record<string, unknown>).id as string;

  const result = doPut(reviewId, { netPnl: 999 });
  assert(result.status === 400, 'returns 400 for immutable field');
  const data = result.data as { error: string };
  assert(data.error === 'Cannot modify immutable fields', 'error message matches');
}

// ── Test 13: PUT with non-existent id returns 404 ──────────────────

console.log('\n13. PUT with non-existent id returns 404:');
{
  const result = doPut('non-existent-id', { notes: 'test' });
  assert(result.status === 404, 'returns 404');
}

// ── Test 14: DELETE removes a review ───────────────────────────────

console.log('\n14. DELETE removes a review:');
{
  const list = doGetList(account2Id);
  const reviewId = (list.data[0] as Record<string, unknown>).id as string;

  const result = doDelete(reviewId);
  assert(result.status === 200, 'returns 200');
  assert(
    (result.data as { message: string }).message === 'Weekly review removed',
    'message is "Weekly review removed"',
  );

  // Verify it's gone
  const getResult = doGetSingle(reviewId);
  assert(getResult.status === 404, 'returns 404 after delete');
}

// ── Test 15: DELETE with non-existent id returns 404 ───────────────

console.log('\n15. DELETE with non-existent id returns 404:');
{
  const result = doDelete('non-existent-id');
  assert(result.status === 404, 'returns 404');
  assert(
    (result.data as { error: string }).error === 'Weekly review not found',
    'error message is "Weekly review not found"',
  );
}

// ── Cleanup (root-hygiene guard: no disposable DBs in the repo root) ──
try {
  disposeSqliteFile(DB_FILE);
} catch {
  // ignore cleanup errors
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
