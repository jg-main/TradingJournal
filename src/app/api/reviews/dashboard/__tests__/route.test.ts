/**
 * reviews/dashboard route tests
 *
 * Tests the GET handler for the dashboard API:
 *  - setupPerformance[]  Per-setup metrics
 *  - mistakeFrequency[]  Mistakes grouped by type with severity breakdown
 *  - ungradedTrades[]    Closed trades with non-null setupId and no grade
 *  - empty states        Account with no trades → empty arrays
 *  - null setupId        Excluded from setupPerformance
 *  - account isolation   Per-account filtering verified
 *
 * Run: DB_FILE_NAME=./.test-m04-s03-db npx tsx src/app/api/reviews/dashboard/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, inArray, isNotNull } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { computeSetupPerformance, type SetupPerfTradeInput } from '@/lib/review-dashboard';

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

function assertDeepEqual(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`  ❌ ${msg} — expected ${e}, got ${a} (FAILED)`);
  } else {
    passed++;
    console.log(`  ✅ ${msg}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function assertClose(actual: number | null | undefined, expected: number | null, msg: string, tolerance = 0.01) {
  if (actual === null || actual === undefined) {
    if (expected === null) {
      passed++;
      console.log(`  ✅ ${msg} (both null)`);
    } else {
      failed++;
      console.error(`  ❌ ${msg} — expected ${expected}, got null (FAILED)`);
    }
    return;
  }
  if (expected === null) {
    failed++;
    console.error(`  ❌ ${msg} — expected null, got ${actual} (FAILED)`);
    return;
  }
  if (Math.abs(actual - expected) > tolerance) {
    failed++;
    console.error(`  ❌ ${msg} — expected ${expected}, got ${actual} (FAILED)`);
  } else {
    passed++;
    console.log(`  ✅ ${msg}`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-m04-s03-db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create all tables needed for dashboard tests
sqlite.exec(`
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trades;
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

  CREATE TABLE trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long','short')),
    sector_id TEXT,
    setup_id TEXT REFERENCES lookup_values(id),
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

  CREATE TABLE trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    executed_at TEXT,
    action TEXT NOT NULL CHECK(action IN ('buy','sell','buy_to_cover','sell_short','add','reduce')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trade_grades (
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

  CREATE TABLE trade_risk_snapshots (
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

  CREATE TABLE trade_mistakes (
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

// ── Helper: replicate the route GET logic ───────────────────────────────

interface MistakeFreqEntry {
  mistakeType: string;
  minor: number;
  moderate: number;
  major: number;
  critical: number;
  total: number;
}

interface UngradedTradeEntry {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: string;
  closedAt: string | null;
}

interface DashboardResult {
  status: number;
  data: Record<string, unknown>;
}

function doGetDashboard(accountId: string | null): DashboardResult {
  if (!accountId) {
    return {
      status: 400,
      data: { error: 'accountId is required' },
    };
  }

  // 1. Select all closed trades with non-null setupId for this account
  const closedTrades = db
    .select()
    .from(schema.trades)
    .where(
      and(
        eq(schema.trades.accountId, accountId),
        eq(schema.trades.status, 'closed'),
        isNotNull(schema.trades.setupId),
      ),
    )
    .all();

  const tradeIds = closedTrades.map((t: Record<string, unknown>) => t.id as string);
  const setupIds = [...new Set(closedTrades.map((t: Record<string, unknown>) => t.setupId).filter(Boolean))] as string[];

  // 2. Batch-fetch related data
  const executionsMap = new Map<string, Record<string, unknown>[]>();
  const gradesMap = new Map<string, Record<string, unknown>>();
  const riskMap = new Map<string, Record<string, unknown>>();
  const setupNameMap: Record<string, string> = {};

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

    if (setupIds.length > 0) {
      const setupLookups = db
        .select()
        .from(schema.lookupValues)
        .where(
          and(
            inArray(schema.lookupValues.id, setupIds),
            eq(schema.lookupValues.type, 'setup'),
          ),
        )
        .all();
      for (const lv of setupLookups) {
        setupNameMap[lv.id] = lv.value;
      }
    }
  }

  // 3. Build SetupPerfTradeInput array
  const perfInputs: SetupPerfTradeInput[] = closedTrades.map((trade: Record<string, unknown>) => ({
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
    setupId: trade.setupId as string,
  }));

  // 4. Compute setup performance
  const dashboardMetrics = computeSetupPerformance(perfInputs, setupNameMap);

  // 5. Mistake frequency breakdown
  let mistakeFrequency: MistakeFreqEntry[] = [];

  if (tradeIds.length > 0) {
    const mistakes = db
      .select()
      .from(schema.tradeMistakes)
      .where(inArray(schema.tradeMistakes.tradeId, tradeIds))
      .all();

    if (mistakes.length > 0) {
      const mistakeTypeIds = [...new Set(mistakes.map((m: Record<string, unknown>) => m.mistakeTypeId).filter(Boolean))] as string[];

      const mistakeTypeNameMap: Record<string, string> = {};
      if (mistakeTypeIds.length > 0) {
        const typeLookups = db
          .select()
          .from(schema.lookupValues)
          .where(
            and(
              inArray(schema.lookupValues.id, mistakeTypeIds),
              eq(schema.lookupValues.type, 'mistake_type'),
            ),
          )
          .all();
        for (const lv of typeLookups) {
          mistakeTypeNameMap[lv.id] = lv.value;
        }
      }

      const grouped = new Map<string, { minor: number; moderate: number; major: number; critical: number }>();

      for (const mistake of mistakes) {
        const typeName = mistake.mistakeTypeId
          ? mistakeTypeNameMap[mistake.mistakeTypeId] ?? mistake.mistakeTypeId
          : 'unknown';
        const entry = grouped.get(typeName) ?? { minor: 0, moderate: 0, major: 0, critical: 0 };
        const severity = mistake.severity as string;
        if (severity === 'minor') entry.minor++;
        else if (severity === 'moderate') entry.moderate++;
        else if (severity === 'major') entry.major++;
        else if (severity === 'critical') entry.critical++;
        grouped.set(typeName, entry);
      }

      mistakeFrequency = Array.from(grouped.entries())
        .map(([mistakeType, counts]) => ({
          mistakeType,
          ...counts,
          total: counts.minor + counts.moderate + counts.major + counts.critical,
        }))
        .sort((a, b) => b.total - a.total);
    }
  }

  // 6. Ungraded trades
  const ungradedTrades: UngradedTradeEntry[] = closedTrades
    .filter((trade: Record<string, unknown>) => !gradesMap.has(trade.id as string))
    .map((trade: Record<string, unknown>) => ({
      id: trade.id as string,
      tradeCode: trade.tradeCode as string,
      symbol: trade.symbol as string,
      direction: trade.direction as string,
      closedAt: trade.closedAt as string | null,
    }));

  return {
    status: 200,
    data: {
      setupPerformance: dashboardMetrics.setupPerformance as unknown as Record<string, unknown>[],
      totalTrades: dashboardMetrics.totalTrades,
      ungroupedTrades: dashboardMetrics.ungroupedTrades,
      mistakeFrequency,
      ungradedTrades,
    } as unknown as Record<string, unknown>,
  };
}

// ── Seed data ───────────────────────────────────────────────────────────

const account1Id = randomUUID();
const account2Id = randomUUID();

// Lookup values
const setupAId = randomUUID();  // "Momentum"
const setupBId = randomUUID();  // "Breakout"
const mistakeEarlyId = randomUUID();  // "Early Entry"
const mistakeStopId = randomUUID();   // "Stop Too Tight"

// Trade IDs (account 1)
const t1Id = randomUUID();  // AAPL, long, closed, setup-a, has grade (80), has risk ($200)
const t2Id = randomUUID();  // MSFT, short, closed, setup-b, has grade (70), has risk ($100), has mistake
const t3Id = randomUUID();  // GOOGL, long, closed, setup-a, NO grade, has risk ($150), has mistake
const t4Id = randomUUID();  // NFLX, long, closed, setup-b, NO grade, NO risk
const t5Id = randomUUID();  // TSLA, long, closed, null setupId (excluded from perf)
const t6Id = randomUUID();  // AMZN, long, open (excluded, not closed)

// Trade IDs (account 2 — isolation test)
const t7Id = randomUUID();  // NVDA, long, closed, setup-a, has grade (90), has risk ($300)

db.insert(schema.accounts).values([
  { id: account1Id, name: 'Main Test Account' },
  { id: account2Id, name: 'Isolation Test Account' },
]).run();

db.insert(schema.lookupValues).values([
  { id: setupAId, type: 'setup', value: 'Momentum' },
  { id: setupBId, type: 'setup', value: 'Breakout' },
  { id: mistakeEarlyId, type: 'mistake_type', value: 'Early Entry' },
  { id: mistakeStopId, type: 'mistake_type', value: 'Stop Too Tight' },
]).run();

const now = new Date().toISOString();

// ── Account 1 trades ────────────────────────────────────────────────────

db.insert(schema.trades).values([
  {
    id: t1Id, tradeCode: 'DB-T1', accountId: account1Id, symbol: 'AAPL',
    direction: 'long', setupId: setupAId, status: 'closed', closedAt: now,
  },
  {
    id: t2Id, tradeCode: 'DB-T2', accountId: account1Id, symbol: 'MSFT',
    direction: 'short', setupId: setupBId, status: 'closed', closedAt: now,
  },
  {
    id: t3Id, tradeCode: 'DB-T3', accountId: account1Id, symbol: 'GOOGL',
    direction: 'long', setupId: setupAId, status: 'closed', closedAt: now,
  },
  {
    id: t4Id, tradeCode: 'DB-T4', accountId: account1Id, symbol: 'NFLX',
    direction: 'long', setupId: setupBId, status: 'closed', closedAt: now,
  },
  {
    id: t5Id, tradeCode: 'DB-T5', accountId: account1Id, symbol: 'TSLA',
    direction: 'long', setupId: null, status: 'closed', closedAt: now,
  },
  {
    id: t6Id, tradeCode: 'DB-T6', accountId: account1Id, symbol: 'AMZN',
    direction: 'long', setupId: setupAId, status: 'open',
  },
]).run();

// ── Account 2 trades ────────────────────────────────────────────────────

db.insert(schema.trades).values([
  {
    id: t7Id, tradeCode: 'DB-T7', accountId: account2Id, symbol: 'NVDA',
    direction: 'long', setupId: setupAId, status: 'closed', closedAt: now,
  },
]).run();

// ── Executions ──────────────────────────────────────────────────────────

// t1: long AAPL — buy 10@100, sell 10@110 → PnL = (110-100)*10 = 100 (win)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: t1Id, executedAt: now, action: 'buy', quantity: 10, price: 100 },
  { id: randomUUID(), tradeId: t1Id, executedAt: now, action: 'sell', quantity: 10, price: 110 },
]).run();

// t2: short MSFT — sell_short 5@200, buy_to_cover 5@190 → PnL = (200-190)*5 = 50 (win)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: t2Id, executedAt: now, action: 'sell_short', quantity: 5, price: 200 },
  { id: randomUUID(), tradeId: t2Id, executedAt: now, action: 'buy_to_cover', quantity: 5, price: 190 },
]).run();

// t3: long GOOGL — buy 20@150, sell 20@140 → PnL = (140-150)*20 = -200 (loss)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: t3Id, executedAt: now, action: 'buy', quantity: 20, price: 150 },
  { id: randomUUID(), tradeId: t3Id, executedAt: now, action: 'sell', quantity: 20, price: 140 },
]).run();

// t4: long NFLX — buy 15@200, sell 15@210 → PnL = (210-200)*15 = 150 (win)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: t4Id, executedAt: now, action: 'buy', quantity: 15, price: 200 },
  { id: randomUUID(), tradeId: t4Id, executedAt: now, action: 'sell', quantity: 15, price: 210 },
]).run();

// t5 (null setupId): long TSLA — buy 10@300, sell 10@310 → PnL = 100 (win)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: t5Id, executedAt: now, action: 'buy', quantity: 10, price: 300 },
  { id: randomUUID(), tradeId: t5Id, executedAt: now, action: 'sell', quantity: 10, price: 310 },
]).run();

// t7 (account 2): long NVDA — buy 8@400, sell 8@450 → PnL = (450-400)*8 = 400 (win)
db.insert(schema.tradeExecutions).values([
  { id: randomUUID(), tradeId: t7Id, executedAt: now, action: 'buy', quantity: 8, price: 400 },
  { id: randomUUID(), tradeId: t7Id, executedAt: now, action: 'sell', quantity: 8, price: 450 },
]).run();

// ── Grades ──────────────────────────────────────────────────────────────

db.insert(schema.tradeGrades).values([
  { id: randomUUID(), tradeId: t1Id, totalScore: 80, gradeLabel: 'A' },
  { id: randomUUID(), tradeId: t2Id, totalScore: 70, gradeLabel: 'B' },
  // t3, t4 have no grade → ungraded
  // t7 (account 2)
  { id: randomUUID(), tradeId: t7Id, totalScore: 90, gradeLabel: 'A' },
]).run();

// ── Risk snapshots ──────────────────────────────────────────────────────

db.insert(schema.tradeRiskSnapshots).values([
  { id: randomUUID(), tradeId: t1Id, initialRiskAmount: 200 },
  { id: randomUUID(), tradeId: t2Id, initialRiskAmount: 100 },
  { id: randomUUID(), tradeId: t3Id, initialRiskAmount: 150 },
  // t4 has no risk snapshot
  // t7 (account 2)
  { id: randomUUID(), tradeId: t7Id, initialRiskAmount: 300 },
]).run();

// ── Mistakes ────────────────────────────────────────────────────────────

db.insert(schema.tradeMistakes).values([
  { id: randomUUID(), tradeId: t2Id, mistakeTypeId: mistakeEarlyId, phase: 'entry', severity: 'moderate', status: 'addressed' },
  { id: randomUUID(), tradeId: t3Id, mistakeTypeId: mistakeStopId, phase: 'management', severity: 'major', status: 'open' },
]).run();

// ── Expected computations ──────────────────────────────────────────────

// Setup A (Momentum): t1, t3  (count=2)
//   t1: PnL=100, risk=200, R=0.5, grade=80, win
//   t3: PnL=-200, risk=150, R=-1.333, no grade, loss
//   winRate = 1/2 = 0.5
//   avgR = (0.5 + -1.333) / 2 = -0.4167
//   avgProcessScore = 80 / 1 = 80 (only t1 graded)
//   sampleSize: 2 → very_small
const expectedSetupAWinRate = 0.5;
const expectedSetupAAvgR = (100 / 200 + (-200) / 150) / 2;  // (0.5 + -1.333) / 2
const expectedSetupAAvgProcessScore = 80;

// Setup B (Breakout): t2, t4  (count=2)
//   t2: PnL=50, risk=100, R=0.5, grade=70, win
//   t4: PnL=150, no risk, R skipped, no grade, win
//   winRate = 2/2 = 1
//   avgR = 0.5 / 1 = 0.5 (only t2 has risk)
//   avgProcessScore = 70 / 1 = 70 (only t2 graded)
//   sampleSize: 2 → very_small
const expectedSetupBWinRate = 1;
const expectedSetupBAvgR = 0.5;
const expectedSetupBAvgProcessScore = 70;

// Mistake frequency:
//   Early Entry: moderate=1, total=1
//   Stop Too Tight: major=1, total=1
// (sorted by total descending — both have total=1, insertion-order stable)

// Ungraded trades (closed, non-null setupId, no grade): t3, t4

// Total trades (closed, non-null setupId): t1, t2, t3, t4 = 4

// ── Tests ───────────────────────────────────────────────────────────────

console.log('\n--- Dashboard GET Handler Tests ---\n');

// ── Test 1: Missing accountId returns 400 ───────────────────────────

console.log('1. Missing accountId returns 400:');
{
  const result = doGetDashboard(null);
  assert(result.status === 400, 'returns 400');
  assert((result.data as { error: string }).error === 'accountId is required', 'error message is "accountId is required"');
}

// ── Test 2: Dashboard sections populated correctly ──────────────────

console.log('\n2. Dashboard returns all sections for account with trades:');
{
  const result = doGetDashboard(account1Id);
  assert(result.status === 200, 'returns 200');

  const data = result.data as Record<string, unknown>;
  const sp = data.setupPerformance as Record<string, unknown>[];
  const mf = data.mistakeFrequency as MistakeFreqEntry[];
  const ut = data.ungradedTrades as UngradedTradeEntry[];

  // Setup performance
  assert(sp.length === 2, '2 setup groups (Momentum, Breakout)');
  assert(data.totalTrades === 4, 'totalTrades = 4');
  assert(data.ungroupedTrades === 0, 'ungroupedTrades = 0');

  // Verify Setup A (Momentum) — first sorted by count desc (both=2, setupA first)
  const setupA = sp.find((s: Record<string, unknown>) => s.setupName === 'Momentum')!;
  assert(setupA !== undefined, 'Momentum group found');
  assert(setupA.setupId === setupAId, 'Momentum setupId matches');
  assert(setupA.count === 2, 'Momentum count = 2');
  assertClose(setupA.winRate as number, expectedSetupAWinRate, 'Momentum winRate = 0.5');
  assertClose(setupA.avgR as number, expectedSetupAAvgR, 'Momentum avgR correct');
  assertClose(setupA.avgProcessScore as number, expectedSetupAAvgProcessScore, 'Momentum avgProcessScore = 80');
  assert(setupA.sampleSizeWarning === 'very_small', 'Momentum sampleSizeWarning = very_small');

  // Verify Setup B (Breakout)
  const setupB = sp.find((s: Record<string, unknown>) => s.setupName === 'Breakout')!;
  assert(setupB !== undefined, 'Breakout group found');
  assert(setupB.setupId === setupBId, 'Breakout setupId matches');
  assert(setupB.count === 2, 'Breakout count = 2');
  assertClose(setupB.winRate as number, expectedSetupBWinRate, 'Breakout winRate = 1');
  assertClose(setupB.avgR as number, expectedSetupBAvgR, 'Breakout avgR = 0.5');
  assertClose(setupB.avgProcessScore as number, expectedSetupBAvgProcessScore, 'Breakout avgProcessScore = 70');
  assert(setupB.sampleSizeWarning === 'very_small', 'Breakout sampleSizeWarning = very_small');

  // Mistake frequency
  assert(mf.length === 2, '2 mistake types');
  // Sorted by total desc — both have total=1, sort-stable by insertion order
  const earlyEntry = mf.find((m) => m.mistakeType === 'Early Entry')!;
  assert(earlyEntry !== undefined, 'Early Entry mistake found');
  assert(earlyEntry.moderate === 1, 'Early Entry moderate = 1');
  assert(earlyEntry.total === 1, 'Early Entry total = 1');

  const stopTight = mf.find((m) => m.mistakeType === 'Stop Too Tight')!;
  assert(stopTight !== undefined, 'Stop Too Tight mistake found');
  assert(stopTight.major === 1, 'Stop Too Tight major = 1');
  assert(stopTight.total === 1, 'Stop Too Tight total = 1');

  // Ungraded trades
  assert(ut.length === 2, '2 ungraded trades (t3, t4)');
  const utIds = ut.map((t) => t.tradeCode).sort();
  assertDeepEqual(utIds, ['DB-T3', 'DB-T4'], 'ungraded trades have correct trade codes');
  ut.forEach((t: UngradedTradeEntry) => {
    assert(t.id !== undefined, 'ungraded trade has id');
    assert(t.symbol !== undefined, 'ungraded trade has symbol');
    assert(t.direction !== undefined, 'ungraded trade has direction');
  });
}

// ── Test 3: Empty account — no trades ───────────────────────────────

console.log('\n3. Dashboard with no trades for account returns empty arrays:');
{
  // Use a new account that has no trades at all
  const emptyAccountId = randomUUID();
  db.insert(schema.accounts).values([
    { id: emptyAccountId, name: 'Empty Account' },
  ]).run();

  const result = doGetDashboard(emptyAccountId);
  assert(result.status === 200, 'returns 200');

  const data = result.data as Record<string, unknown>;
  const sp = data.setupPerformance as Record<string, unknown>[];
  const mf = data.mistakeFrequency as MistakeFreqEntry[];
  const ut = data.ungradedTrades as UngradedTradeEntry[];

  assert(sp.length === 0, 'empty setupPerformance array');
  assert(mf.length === 0, 'empty mistakeFrequency array');
  assert(ut.length === 0, 'empty ungradedTrades array');
  assert(data.totalTrades === 0, 'totalTrades = 0');
}

// ── Test 4: Null setupId trades excluded from setupPerformance ──────

console.log('\n4. Trades with null setupId excluded from setupPerformance:');
{
  const result = doGetDashboard(account1Id);
  const data = result.data as Record<string, unknown>;
  const sp = data.setupPerformance as Record<string, unknown>[];

  // t5 has null setupId, should not appear as a setup group
  const hasNullGroup = sp.some((s: Record<string, unknown>) => s.setupId === null);
  assert(!hasNullGroup, 'no null-setupId group in setupPerformance');

  // Total trades should still be 4 (t1,t2,t3,t4) — null-setupId trades not counted
  assert(data.totalTrades === 4, 'totalTrades = 4 (excludes null-setupId trades)');
}

// ── Test 5: Account isolation — second account returns own data ─────

console.log('\n5. Second account returns its own dashboard data (isolation):');
{
  const result = doGetDashboard(account2Id);
  assert(result.status === 200, 'returns 200');

  const data = result.data as Record<string, unknown>;
  const sp = data.setupPerformance as Record<string, unknown>[];

  assert(sp.length === 1, '1 setup group for account 2');
  const s = sp[0];
  assert(s.setupName === 'Momentum', 'setup name = Momentum');
  assert(s.count === 1, 'count = 1');
  // t7: PnL = (450-400)*8 = 400, risk = 300, R = 400/300 = 1.333, grade = 90
  assertClose(s.winRate as number, 1, 'winRate = 1');
  assertClose(s.avgR as number, 400 / 300, 'avgR = 1.333');
  assertClose(s.avgProcessScore as number, 90, 'avgProcessScore = 90');

  // No mistakes for account 2
  const mf = data.mistakeFrequency as MistakeFreqEntry[];
  assert(mf.length === 0, 'no mistakes for account 2');

  // No ungraded trades for account 2
  const ut = data.ungradedTrades as UngradedTradeEntry[];
  assert(ut.length === 0, 'no ungraded trades for account 2');
}

// ── Test 6: Account 1 data not leaked to account 2 ──────────────────

console.log('\n6. Account 1 trade data not visible in account 2:');
{
  const result = doGetDashboard(account2Id);
  const data = result.data as Record<string, unknown>;
  const sp = data.setupPerformance as Record<string, unknown>[];

  // Only NVDA (t7) should be visible, not AAPL/MSFT/GOOGL/NFLX/TSLA
  assert(sp.length === 1, 'account 2 has only 1 setup group');

  // Verify no setup groups that belong to account 1
  const groupNames = sp.map((s: Record<string, unknown>) => s.setupName as string);
  assert(!groupNames.includes('Breakout'), 'Breakout not in account 2 results');
}

// ── Test 7: Open trades excluded ────────────────────────────────────

console.log('\n7. Open trades (not closed) excluded from results:');
{
  const result = doGetDashboard(account1Id);
  const data = result.data as Record<string, unknown>;

  // t6 is open (status='open') with setup='setup-a' — should not appear
  // Only t1-t4 are closed with non-null setupId
  assert(data.totalTrades === 4, 'totalTrades = 4 (t6 open excluded)');
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
