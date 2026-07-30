/**
 * assessment-engine.test.ts
 *
 * Comprehensive Vitest tests for src/lib/assessment-engine.ts.
 *
 * Uses an in-memory SQLite database (via vi.hoisted + vi.mock) so
 * gatherTradeData, buildAssessmentPrompt, and performAssessment all
 * operate against real queries without hitting a file-based DB.
 * ClickHouse and AI provider dependencies are mocked via the deps parameter.
 *
 * The drizzle instance is created without schema mappings in the mock
 * factory (since require can't resolve local source files at hoist time).
 * Drizzle reads table info from schema objects at query time (via .from()),
 * so the schema-less drizzle instance handles all queries correctly.
 *
 * Run: npx vitest run src/lib/__tests__/assessment-engine.test.ts
 */

import { vi, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

// ── Hoisted: in-memory SQLite DB + table creation ───────────────────────
// Only uses require for third-party packages (better-sqlite3) which work
// fine at hoist time. Local source files are NOT required here.

const testCtx = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF');

  // Create all tables the engine needs (matching src/db/schema.ts)
  sqlite.exec(`
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
      analysis_config TEXT,
      is_active INTEGER DEFAULT 1,
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
      current_price REAL,
      current_price_fetched_at TEXT,
      gross_realized_pnl REAL,
      net_realized_pnl REAL,
      realized_fees REAL,
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

    CREATE TABLE play_evaluation_fields (
      id TEXT PRIMARY KEY NOT NULL,
      setup_definition_id TEXT REFERENCES setup_definitions(id) ON DELETE CASCADE NOT NULL,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      field_type TEXT NOT NULL CHECK(field_type IN ('boolean', 'score_1_5', 'score_1_10', 'text')),
      weight REAL DEFAULT 1.0,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      min_lookback_days INTEGER,
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp),
      UNIQUE(setup_definition_id, field_key)
    );

    CREATE TABLE ai_settings (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('openai', 'ollama', 'anthropic', 'google', 'custom')),
      model TEXT NOT NULL,
      api_key TEXT,
      base_url TEXT,
      timeout_ms INTEGER DEFAULT 30000,
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 4096,
      system_prompt TEXT,
      clickhouse_host TEXT DEFAULT 'localhost',
      clickhouse_port INTEGER DEFAULT 8123,
      clickhouse_user TEXT DEFAULT 'default',
      clickhouse_password TEXT,
      clickhouse_database TEXT DEFAULT 'market',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );

    CREATE TABLE trade_assessment_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE NOT NULL,
      assessed_at TEXT DEFAULT (current_timestamp),
      assessment_type TEXT NOT NULL CHECK(assessment_type IN ('ai_quality', 'ai_review')),
      overall_score REAL,
      scorecard_json TEXT,
      model_used TEXT,
      prompt_text TEXT,
      raw_response TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
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

  return { sqlite };
});

// ── Mock @/db ───────────────────────────────────────────────────────────
// The assessment engine imports { db } from '@/db'. We replace it with a
// bare drizzle instance wrapping our in-memory SQLite. No schema is passed
// to drizzle here since require cannot resolve local source files at hoist
// time. Drizzle reads table definitions from schema objects at query time,
// so this schema-less instance works with all engine queries.

vi.mock('@/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const db = drizzle(testCtx.sqlite);
  return {
    db,
    getSqliteHandle: () => testCtx.sqlite,
    initializeDatabase: () => db,
  };
});

// ── Mock @/lib/market-data-resolver ────────────────────────────────────
// When deps.clickhouseClient is NOT provided, performAssessment calls
// resolveOhlcProvider() from the market-data-resolver module. We mock it
// here to return a controllable MarketOhlcProvider that returns fake OHLC
// data instead of connecting to a real ClickHouse server.

vi.mock('../market-data-resolver', () => ({
  resolveOhlcProvider: (providerName: string) => ({
    name: providerName === 'schwab' ? 'schwab' : 'clickhouse',
    getOhlc: async () => ({
      symbol: 'AAPL',
      secid: 12345,
      dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
      ohlc: [
        { date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 },
      ],
      notes: [],
    }),
    getFeatureTimeSeries: async () => [],
    checkFreshness: async () => ({
      status: 'fresh',
      latestDate: '2024-01-31',
      threshold: 'N/A',
      message: 'Mocked freshness check',
    }),
  }),
}));

// ── Module-level imports (ESM imports work with vitest's alias resolver) ─

import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import {
  gatherTradeData,
  buildAssessmentPrompt,
  performAssessment,
  AssessmentError,
  AssessmentErrorCode,
} from '../assessment-engine';
import {
  resolveOhlcProvider,
} from '../market-data-resolver';
import {
  AiProviderError,
} from '../ai-provider';
import type { MarketEvidence } from '../clickhouse-client';
import type { Scorecard } from '../scorecard';

// ── Assertion helpers (matching project pattern) ────────────────────────

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
    console.error(`  \u274c ${msg} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 value is null/undefined (FAILED)`);
  }
}

function assertIncludes(text: string, substring: string, msg: string) {
  if (text.includes(substring)) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 expected "${substring}" not found in "${text}" (FAILED)`);
  }
}

// ── Seed helpers ────────────────────────────────────────────────────────

import { drizzle } from 'drizzle-orm/better-sqlite3';

const sqlite = testCtx.sqlite;
// Create a fresh drizzle instance for seeding (schema needed for type safety)
const seedDb = drizzle(sqlite, { schema });

function cleanup() {
  sqlite.exec('DELETE FROM trade_assessment_snapshots;');
  sqlite.exec('DELETE FROM play_evaluation_fields;');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM ai_settings;');
  sqlite.exec('DELETE FROM setup_definitions;');
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(overrides: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  seedDb.insert(schema.accounts).values({
    id,
    name: 'Test Account',
    broker: null,
    currency: 'USD',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).run();
  return id;
}

function seedLookupSetup(value: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  seedDb.insert(schema.lookupValues).values({
    id,
    type: 'setup',
    value,
    sortOrder: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).run();
  return id;
}

function seedSetupDefinition(overrides: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  seedDb.insert(schema.setupDefinitions).values({
    id,
    name: 'Momentum Breakout',
    description: 'A test setup definition',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).run();
  return id;
}

function seedTrade(accountId: string, overrides: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  seedDb.insert(schema.trades).values({
    id,
    tradeCode: `TC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    accountId,
    symbol: 'AAPL',
    direction: 'long',
    status: 'planned',
    plannedEntry: 150,
    plannedStop: 145,
    plannedTarget1: 160,
    plannedQuantity: 100,
    thesis: 'Bullish breakout on support',
    invalidationCondition: 'Close below 145',
    preTradePlan: 'Wait for confirmation candle',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).run();
  return id;
}

function seedExecution(tradeId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  seedDb.insert(schema.tradeExecutions).values({
    id,
    tradeId,
    action: 'buy',
    quantity: 100,
    price: 150.25,
    fees: 5.0,
    executedAt: '2024-01-15T09:30:00.000Z',
    createdAt: now,
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).run();
  return id;
}

function seedPlayEvaluationField(setupDefId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  seedDb.insert(schema.playEvaluationFields).values({
    id,
    setupDefinitionId: setupDefId,
    fieldKey: 'followed_plan',
    label: 'Followed the Plan',
    description: 'Did the trader follow their plan?',
    fieldType: 'boolean',
    weight: 1.0,
    sortOrder: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).run();
  return id;
}

function seedAiSetting(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  seedDb.insert(schema.aiSettings).values({
    id,
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-test-key',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).run();
  return id;
}

// ── Mock factory helpers ────────────────────────────────────────────────

function makeValidScorecard(overrides?: Partial<Scorecard>): string {
  const sc: Scorecard = {
    dimensions: [
      { key: 'setup', label: 'Setup Quality', score: 8 },
      { key: 'risk', label: 'Risk Management', score: 7 },
      { key: 'entry', label: 'Entry Execution', score: 6 },
      { key: 'management', label: 'Trade Management', score: 9 },
      { key: 'exit', label: 'Exit Execution', score: 5 },
      { key: 'review', label: 'Review Quality', score: 7 },
    ],
    overallScore: 72,
    gradeLabel: 'B',
    assessmentType: 'ai_quality',
    ...overrides,
  };
  return JSON.stringify(sc);
}

function createMockClickHouseClient(
  returnValue: Partial<MarketEvidence> | Error,
  freshnessOverride?: { status: string; latestDate?: string; threshold: string; message: string },
) {
  return {
    getMarketEvidence: vi.fn().mockImplementation(async () => {
      if (returnValue instanceof Error) throw returnValue;
      return returnValue;
    }),
    checkFreshness: vi.fn().mockImplementation(async () => {
      return freshnessOverride ?? {
        status: 'fresh',
        latestDate: '2024-01-31',
        threshold: '2024-01-30',
        message: 'Data is fresh: latest tradedate 2024-01-31 is within 1 day(s)',
      };
    }),
    getFeatureTimeSeries: vi.fn().mockImplementation(async () => {
      return [];
    }),
    getAllFeatureColumns: vi.fn().mockImplementation(async () => {
      return [{ id: 'sma_20', label: 'SMA(20)' }];
    }),
  };
}

function createMockAiProvider(returnValue: string | Error) {
  return {
    getCompletion: vi.fn().mockImplementation(async () => {
      if (returnValue instanceof Error) throw returnValue;
      return {
        content: returnValue,
        usage: { promptTokens: 120, completionTokens: 340 },
      };
    }),
  };
}

// ── Test Suite ─────────────────────────────────────────────────────────

test('Assessment Engine \u2014 gatherTradeData, buildAssessmentPrompt, performAssessment', async () => {

console.log('\n=== gatherTradeData Tests ===\n');

// ── gatherTradeData: resolves trade, executions, and evaluation fields ──

console.log('\n1. gatherTradeData resolves trade, executions, and evaluation fields from DB:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });

  // Seed setup infrastructure for play evaluation fields
  // Use setupDefId as the lookup value ID so gatherTradeData can join
  // lookupValues.id = setupDefinitions.id
  const setupDefId = seedSetupDefinition({ name: 'Momentum Breakout' });
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at) ` +
    `VALUES ('${setupDefId}', 'setup', 'Momentum Breakout', 1, 1, '${now}', '${now}')`
  );
  seedPlayEvaluationField(setupDefId, {
    fieldKey: 'followed_plan',
    label: 'Followed the Plan',
    fieldType: 'boolean',
    weight: 1.0,
    sortOrder: 1,
  });
  seedPlayEvaluationField(setupDefId, {
    fieldKey: 'entry_discipline',
    label: 'Entry Discipline',
    fieldType: 'score_1_5',
    weight: 0.8,
    sortOrder: 2,
  });

  // Link trade to setup via lookup value (same ID as setup definition)
  sqlite.exec(`UPDATE trades SET setup_id = '${setupDefId}' WHERE id = '${tradeId}'`);

  // Seed executions
  seedExecution(tradeId, { action: 'buy', quantity: 50, price: 150.25, executedAt: '2024-01-15T09:30:00.000Z' });
  seedExecution(tradeId, { action: 'add', quantity: 50, price: 151.00, executedAt: '2024-01-15T10:15:00.000Z' });

  const result = await gatherTradeData(tradeId);

  assertNotNull(result, 'gatherTradeData returns result');
  assertEqual(result.trade.id, tradeId, 'trade id matches');
  assertEqual(result.trade.symbol, 'AAPL', 'trade symbol matches');
  assertEqual(result.trade.direction, 'long', 'trade direction matches');

  assertEqual(result.executions.length, 2, '2 executions returned');
  assertEqual(result.executions[0].action, 'buy', 'first execution action is buy');
  assertEqual(result.executions[1].action, 'add', 'second execution action is add');

  assertEqual(result.setupName, 'Momentum Breakout', 'setup name resolved');
  assertEqual(result.evaluationFields.length, 2, '2 evaluation fields resolved');
  assertEqual(result.evaluationFields[0].fieldKey, 'followed_plan', 'first field key matches');
  assertEqual(result.evaluationFields[1].fieldKey, 'entry_discipline', 'second field key matches');

  assertEqual(result.marketEvidence, null, 'market evidence is null (not fetched in gatherTradeData)');
  assertEqual(result.warnings.length, 0, 'no warnings for complete trade data');
}

// ── gatherTradeData: nonexistent trade throws TRADE_NOT_FOUND ────────────

console.log('\n2. gatherTradeData throws TRADE_NOT_FOUND for nonexistent trade:');
{
  cleanup();

  try {
    await gatherTradeData('nonexistent-id');
    failed++;
    console.error('  \u274c Expected AssessmentError but no exception thrown (FAILED)');
  } catch (err) {
    if (err instanceof AssessmentError && err.code === AssessmentErrorCode.TRADE_NOT_FOUND) {
      passed++;
      console.log('  \u2705 Throws AssessmentError with TRADE_NOT_FOUND code');
    } else {
      failed++;
      console.error(`  \u274c Expected AssessmentError with TRADE_NOT_FOUND, got ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)} (FAILED)`);
    }
  }
}

// ── gatherTradeData: trade with no symbol gets warning ───────────────────

console.log('\n3. gatherTradeData adds warning when trade has no symbol:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { symbol: '' });

  const result = await gatherTradeData(tradeId);
  assert(result.warnings.length > 0, 'has warnings');
  const warningText = result.warnings.join(' ');
  assertIncludes(warningText, 'no symbol', 'warning mentions no symbol');
}

// ── gatherTradeData: trade with no setupId gets warning ──────────────────

console.log('\n4. gatherTradeData adds warning when trade has no setupId:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { setupId: null });

  const result = await gatherTradeData(tradeId);
  assert(result.warnings.length > 0, 'has warnings');
  const warningText = result.warnings.join(' ');
  assertIncludes(warningText, 'no setup', 'warning mentions no setup');
  assertEqual(result.setupName, null, 'setupName is null');
  assertEqual(result.evaluationFields.length, 0, 'no evaluation fields');
}

// ── gatherTradeData: trade with setupId but no matching lookup ───────────

console.log('\n5. gatherTradeData handles trade with setupId but no matching lookup:');
{
  cleanup();
  const accountId = seedAccount();
  // setupId points to a nonexistent lookup — use raw SQL to bypass FK check
  const tradeId = randomUUID();
  const now = new Date().toISOString();
  const fakeSetupId = randomUUID();
  sqlite.exec(
    `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, setup_id, created_at, updated_at) ` +
    `VALUES ('${tradeId}', 'TC-FK-${Date.now()}', '${accountId}', 'AAPL', 'long', 'planned', '${fakeSetupId}', '${now}', '${now}')`
  );

  const result = await gatherTradeData(tradeId);
  assertEqual(result.setupName, null, 'setupName is null when lookup not found');
  assertEqual(result.evaluationFields.length, 0, 'no evaluation fields');
}


console.log('\n=== buildAssessmentPrompt Tests ===\n');

// ── buildAssessmentPrompt: produces structured prompt with all sections ──

console.log('\n6. buildAssessmentPrompt produces structured prompt with all sections present:');
{
  const mockMarketEvidence: MarketEvidence = {
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [
      { date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 },
      { date: '2024-01-03', open: 151.50, high: 153.00, low: 150.00, close: 152.75, volume: 45000000, vwap: 152.00 },
      { date: '2024-01-04', open: 152.75, high: 154.00, low: 151.50, close: 153.25, volume: 55000000, vwap: 152.90 },
      { date: '2024-01-05', open: 153.25, high: 155.00, low: 152.75, close: 154.50, volume: 48000000, vwap: 153.80 },
      { date: '2024-01-08', open: 154.50, high: 156.00, low: 154.00, close: 155.25, volume: 52000000, vwap: 155.00 },
    ],
    notes: [],
  };

  const accountId = seedAccount();
  const tradeId = seedTrade(accountId);

  const gathered = await gatherTradeData(tradeId);
  gathered.marketEvidence = mockMarketEvidence;

  const prompt = buildAssessmentPrompt(gathered);

  assertEqual(prompt.sectionCount, 5, '5 sections in prompt');
  assert(prompt.totalChars > 500, 'prompt is substantial');
  assert(prompt.systemMessage.includes('trade quality assessor'), 'system message has default persona');
  assert(prompt.userMessage.includes('TRADE DETAILS'), 'user message has trade details section');
  assert(prompt.userMessage.includes('EXECUTION RECORD'), 'user message has execution record section');
  assert(prompt.userMessage.includes('PLAY/SETUP CONTEXT'), 'user message has setup context section');
  assert(prompt.userMessage.includes('MARKET EVIDENCE'), 'user message has market evidence section');
  assert(prompt.userMessage.includes('OUTPUT FORMAT'), 'user message has output format section');
  assert(prompt.userMessage.includes('AAPL'), 'user message includes symbol');
  assert(prompt.userMessage.includes('Planned Entry: 150'), 'user message includes plannedEntry');
}

// ── buildAssessmentPrompt: handles trade with no symbol gracefully ───────

console.log('\n7. buildAssessmentPrompt handles trade with no symbol:');
{
  const gathered = {
    trade: {
      id: 'test-id',
      tradeCode: 'TC-001',
      accountId: 'acc-1',
      symbol: '',
      direction: 'long' as const,
      sectorId: null,
      setupId: null,
      marketConditionId: null,
      status: 'planned' as const,
      plannedEntry: 150,
      plannedStop: null,
      plannedTarget1: null,
      plannedTarget2: null,
      plannedQuantity: null,
      thesis: null,
      invalidationCondition: null,
      preTradePlan: null,
      openedAt: null,
      closedAt: null,
      exitNotes: null,
      lesson: null,
      grossRealizedPnl: null,
      netRealizedPnl: null,
      realizedFees: null,
      currentPrice: null,
      currentPriceFetchedAt: null,
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
    },
    executions: [] as never[],
    evaluationFields: [] as never[],
    setupName: null,
    analysisConfig: null,
    checklistItems: null,
    marketEvidence: null,
    featureTimeSeries: null,
    warnings: ['Trade has no symbol'],
  };

  const prompt = buildAssessmentPrompt(gathered);

  assertEqual(prompt.sectionCount, 5, '5 sections even with no symbol');
  assert(prompt.userMessage.includes('N/A'), 'uses N/A for empty symbol');
  assert(prompt.userMessage.includes('No market data'), 'shows no market data available');
}

// ── buildAssessmentPrompt: handles trade with no setupId ─────────────────

console.log('\n8. buildAssessmentPrompt handles trade with no setupId:');
{
  const gathered = {
    trade: {
      id: 'test-id-2',
      tradeCode: 'TC-002',
      accountId: 'acc-1',
      symbol: 'AAPL',
      direction: 'long' as const,
      sectorId: null,
      setupId: null,
      marketConditionId: null,
      status: 'planned' as const,
      plannedEntry: 150,
      plannedStop: null,
      plannedTarget1: null,
      plannedTarget2: null,
      plannedQuantity: null,
      thesis: null,
      invalidationCondition: null,
      preTradePlan: null,
      openedAt: null,
      closedAt: null,
      exitNotes: null,
      lesson: null,
      grossRealizedPnl: null,
      netRealizedPnl: null,
      realizedFees: null,
      currentPrice: null,
      currentPriceFetchedAt: null,
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
    },
    executions: [] as never[],
    evaluationFields: [] as never[],
    setupName: null,
    analysisConfig: null,
    checklistItems: null,
    marketEvidence: null,
    featureTimeSeries: null,
    warnings: ['Trade has no setup'],
  };

  const prompt = buildAssessmentPrompt(gathered);

  assert(prompt.userMessage.includes('No setup configured'), 'shows no setup message');
  assert(prompt.userMessage.includes('No evaluation fields'), 'shows no evaluation fields');
}


console.log('\n=== performAssessment Tests ===\n');

// ── performAssessment: happy path ────────────────────────────────────────

console.log('\n9. performAssessment happy path returns AssessmentResult with parsed scorecard:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });

  // Seed setup with evaluation fields
  const lookupId = seedLookupSetup('Momentum Breakout');
  const setupDefId = seedSetupDefinition({ name: 'Momentum Breakout' });
  seedPlayEvaluationField(setupDefId, { fieldKey: 'followed_plan', label: 'Followed the Plan', fieldType: 'boolean', sortOrder: 1 });
  sqlite.exec(`UPDATE trades SET setup_id = '${lookupId}' WHERE id = '${tradeId}'`);

  // Seed ai settings so readActiveAiConfig resolves
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [
      { date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 },
      { date: '2024-01-03', open: 151.50, high: 153.00, low: 150.00, close: 152.75, volume: 45000000, vwap: 152.00 },
    ],
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'performAssessment returns result');
  assertNotNull(result.scorecard, 'has scorecard');
  assertEqual(result.scorecard.overallScore, 72, 'overall score matches');
  assertEqual(result.scorecard.gradeLabel, 'B', 'grade label matches');
  assertEqual(result.scorecard.dimensions.length, 6, '6 dimensions in scorecard');
  assertEqual(result.scorecard.assessmentType, 'ai_quality', 'assessment type is ai_quality');

  assertNotNull(result.snapshot, 'has snapshot metadata');
  assertNotNull(result.snapshot.id, 'snapshot has id');
  assertNotNull(result.snapshot.assessedAt, 'snapshot has assessedAt');

  // Verify snapshot was persisted to DB
  const snapshot = seedDb
    .select()
    .from(schema.tradeAssessmentSnapshots)
    .where(eq(schema.tradeAssessmentSnapshots.id, result.snapshot.id))
    .get();

  assertNotNull(snapshot, 'snapshot persisted to DB');
  assertEqual(snapshot!.tradeId, tradeId, 'snapshot tradeId matches');
  assertEqual(snapshot!.overallScore, 72, 'snapshot overallScore matches');

  // Verify promptText and rawResponse are persisted and non-null
  assertNotNull(snapshot!.promptText, 'snapshot promptText persisted (non-null)');
  assertNotNull(snapshot!.rawResponse, 'snapshot rawResponse persisted (non-null)');
  assert(
    (snapshot!.promptText as string).includes('TRADE DETAILS'),
    'promptText contains trade details section',
  );
  assert(
    (snapshot!.rawResponse as string).includes('overallScore'),
    'rawResponse contains scorecard JSON',
  );

  // Verify result.snapshot also carries promptText and rawResponse
  assertNotNull(result.snapshot.promptText, 'result.snapshot.promptText is non-null');
  assertNotNull(result.snapshot.rawResponse, 'result.snapshot.rawResponse is non-null');

  // ── Metadata injection assertions ───────────────────────────────────

  // scorecard.metadata should be injected by performAssessment
  assertNotNull(result.scorecard.metadata, 'scorecard.metadata is populated (not undefined)');
  assertEqual(result.scorecard.metadata!.modelUsed, 'gpt-4o', 'scorecard.metadata.modelUsed is gpt-4o (from seedAiSetting)');
  assertEqual(result.scorecard.metadata!.promptTokens, 120, 'scorecard.metadata.promptTokens is 120 (from mock usage)');
  assertEqual(result.scorecard.metadata!.completionTokens, 340, 'scorecard.metadata.completionTokens is 340 (from mock usage)');
  assert(
    typeof result.scorecard.metadata!.durationMs === 'number' && result.scorecard.metadata!.durationMs >= 0,
    `scorecard.metadata.durationMs is a non-negative integer (got ${result.scorecard.metadata!.durationMs})`,
  );

  // result.snapshot should carry modelUsed, promptTokens, completionTokens
  assertEqual(result.snapshot.modelUsed, 'gpt-4o', 'result.snapshot.modelUsed is gpt-4o');
  assertEqual(result.snapshot.promptTokens, 120, 'result.snapshot.promptTokens is 120');
  assertEqual(result.snapshot.completionTokens, 340, 'result.snapshot.completionTokens is 340');

  // DB row should have modelUsed, promptTokens, completionTokens
  assertEqual(
    (snapshot as Record<string, unknown>).modelUsed ?? (snapshot as Record<string, unknown>).model_used,
    'gpt-4o',
    'DB snapshot modelUsed is gpt-4o',
  );
  const dbPromptTokens = (snapshot as Record<string, unknown>).promptTokens ?? (snapshot as Record<string, unknown>).prompt_tokens;
  assertEqual(dbPromptTokens, 120, 'DB snapshot promptTokens is 120');
  const dbCompletionTokens = (snapshot as Record<string, unknown>).completionTokens ?? (snapshot as Record<string, unknown>).completion_tokens;
  assertEqual(dbCompletionTokens, 340, 'DB snapshot completionTokens is 340');

  // The scorecardJson persisted in DB should contain the metadata fields
  const scorecardJsonRaw = (snapshot as Record<string, unknown>).scorecardJson ?? (snapshot as Record<string, unknown>).scorecard_json;
  assertNotNull(scorecardJsonRaw, 'scorecardJson persisted in DB');
  const persistedScorecard = JSON.parse(scorecardJsonRaw as string);
  assertNotNull(persistedScorecard.metadata, 'persisted scorecard has metadata');
  assertEqual(persistedScorecard.metadata.modelUsed, 'gpt-4o', 'persisted scorecard metadata.modelUsed is gpt-4o');
  assertEqual(persistedScorecard.metadata.promptTokens, 120, 'persisted scorecard metadata.promptTokens is 120');
  assertEqual(persistedScorecard.metadata.completionTokens, 340, 'persisted scorecard metadata.completionTokens is 340');
  assert(persistedScorecard.metadata.durationMs >= 0, 'persisted scorecard metadata.durationMs is a non-negative integer');
}


// ── performAssessment: with executions included in prompt ────────────────

console.log('\n10. performAssessment includes executions in prompt:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();
  seedExecution(tradeId, { executedAt: '2024-01-15T09:30:00.000Z' });

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');
  assert(result.snapshot.id.length > 0, 'snapshot created');
}

// ── performAssessment: with assessmentType='ai_review' ──────────────────

console.log('\n11. performAssessment with assessmentType ai_review passes through:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard({ assessmentType: 'ai_review' }));

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  }, { assessmentType: 'ai_review' });

  assertEqual(result.scorecard.assessmentType, 'ai_review', 'assessment type is ai_review');
}

// ── performAssessment: ClickHouse connection error → warnings but no fatal ──

console.log('\n12. performAssessment with ClickHouse connection error returns warnings:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient(
    new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:8123'),
  );
  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned despite CH error');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard still parsed');
  assert(result.warnings.length > 0, 'has warnings');
  const warningsText = result.warnings.join(' ');
  assertIncludes(warningsText, 'Failed to fetch', 'warning mentions CH failure');
}

// ── performAssessment: missing symbol via empty OHLC ─────────────────────

console.log('\n13. performAssessment with empty OHLC returns missingMarketData warning:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'UNKNOWN',
    secid: undefined,
    dataDateRange: undefined,
    ohlc: [],
    notes: ['Symbol not found'],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned');
  assert(result.warnings.length > 0, 'has warnings');
  const warningsText = result.warnings.join(' ');
  assertIncludes(warningsText, 'No market data', 'warning mentions no market data');
}

// ── performAssessment: AI provider AUTH_ERROR throws AI_PROVIDER_ERROR ──

console.log('\n14. performAssessment with AI AUTH_ERROR throws AssessmentError:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
    notes: [],
  });

  const authError = new AiProviderError('AUTH_ERROR', 'Incorrect API key provided', 401);
  const mockAi = createMockAiProvider(authError);

  try {
    await performAssessment(tradeId, {
      clickhouseClient: mockCh,
      aiProvider: mockAi,
    });
    failed++;
    console.error('  \u274c Expected AssessmentError but no exception thrown (FAILED)');
  } catch (err) {
    if (err instanceof AssessmentError && err.code === AssessmentErrorCode.AI_PROVIDER_ERROR) {
      passed++;
      console.log('  \u2705 Throws AssessmentError with AI_PROVIDER_ERROR');
      assertIncludes(err.message, 'authentication', 'error message mentions auth');
    } else {
      failed++;
      console.error(`  \u274c Expected AssessmentError with AI_PROVIDER_ERROR, got ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)} (FAILED)`);
    }
  }
}

// ── performAssessment: AI provider TIMEOUT throws AI_PROVIDER_ERROR ────

console.log('\n15. performAssessment with AI TIMEOUT throws AssessmentError:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
    notes: [],
  });

  const timeoutError = new AiProviderError('TIMEOUT', 'Request timed out after 30000ms');
  const mockAi = createMockAiProvider(timeoutError);

  try {
    await performAssessment(tradeId, {
      clickhouseClient: mockCh,
      aiProvider: mockAi,
    });
    failed++;
    console.error('  \u274c Expected AssessmentError but no exception thrown (FAILED)');
  } catch (err) {
    if (err instanceof AssessmentError && err.code === AssessmentErrorCode.AI_PROVIDER_ERROR) {
      passed++;
      console.log('  \u2705 Throws AssessmentError with AI_PROVIDER_ERROR');
      assertIncludes(err.message, 'timed out', 'error message mentions timeout');
    } else {
      failed++;
      console.error(`  \u274c Expected AssessmentError with AI_PROVIDER_ERROR, got ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)} (FAILED)`);
    }
  }
}

// ── performAssessment: malformed AI JSON → SCORECARD_PARSE_ERROR ────────

console.log('\n16. performAssessment with malformed AI JSON throws SCORECARD_PARSE_ERROR:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
    notes: [],
  });

  const mockAi = createMockAiProvider('} not valid json at all {');

  try {
    await performAssessment(tradeId, {
      clickhouseClient: mockCh,
      aiProvider: mockAi,
    });
    failed++;
    console.error('  \u274c Expected AssessmentError but no exception thrown (FAILED)');
  } catch (err) {
    if (err instanceof AssessmentError && err.code === AssessmentErrorCode.SCORECARD_PARSE_ERROR) {
      passed++;
      console.log('  \u2705 Throws AssessmentError with SCORECARD_PARSE_ERROR');
      assertIncludes(err.message, 'parse', 'error message mentions parse');
    } else {
      failed++;
      console.error(`  \u274c Expected AssessmentError with SCORECARD_PARSE_ERROR, got ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)} (FAILED)`);
    }
  }
}

// ── performAssessment: empty AI response → SCORECARD_PARSE_ERROR ─────────

console.log('\n17. performAssessment with empty AI response throws SCORECARD_PARSE_ERROR:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
    notes: [],
  });

  const mockAi = createMockAiProvider('');

  try {
    await performAssessment(tradeId, {
      clickhouseClient: mockCh,
      aiProvider: mockAi,
    });
    failed++;
    console.error('  \u274c Expected AssessmentError but no exception thrown (FAILED)');
  } catch (err) {
    if (err instanceof AssessmentError && err.code === AssessmentErrorCode.SCORECARD_PARSE_ERROR) {
      passed++;
      console.log('  \u2705 Throws AssessmentError with SCORECARD_PARSE_ERROR for empty response');
    } else {
      failed++;
      console.error(`  \u274c Expected AssessmentError with SCORECARD_PARSE_ERROR, got ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)} (FAILED)`);
    }
  }
}

// ── performAssessment: nonexistent trade → TRADE_NOT_FOUND ──────────────

console.log('\n18. performAssessment with nonexistent trade throws TRADE_NOT_FOUND:');
{
  cleanup();
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [],
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  try {
    await performAssessment('nonexistent-trade', {
      clickhouseClient: mockCh,
      aiProvider: mockAi,
    });
    failed++;
    console.error('  \u274c Expected AssessmentError but no exception thrown (FAILED)');
  } catch (err) {
    if (err instanceof AssessmentError && err.code === AssessmentErrorCode.TRADE_NOT_FOUND) {
      passed++;
      console.log('  \u2705 Throws AssessmentError with TRADE_NOT_FOUND');
    } else {
      failed++;
      console.error(`  \u274c Expected AssessmentError with TRADE_NOT_FOUND, got ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)} (FAILED)`);
    }
  }
}

// ── performAssessment: no ai_settings → AI_NOT_CONFIGURED ────────────────

console.log('\n19. performAssessment with no ai_settings throws AI_NOT_CONFIGURED:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  // Intentionally NOT seeding ai_settings

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [],
    notes: [],
  });

  // No deps.aiProvider — engine tries to read from DB, finds nothing
  try {
    await performAssessment(tradeId, {
      clickhouseClient: mockCh,
      // no aiProvider — allows engine to try readActiveAiConfig
    });
    failed++;
    console.error('  \u274c Expected AssessmentError but no exception thrown (FAILED)');
  } catch (err) {
    if (err instanceof AssessmentError && err.code === AssessmentErrorCode.AI_NOT_CONFIGURED) {
      passed++;
      console.log('  \u2705 Throws AssessmentError with AI_NOT_CONFIGURED');
    } else {
      failed++;
      console.error(`  \u274c Expected AssessmentError with AI_NOT_CONFIGURED, got ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)} (FAILED)`);
    }
  }
}

// ── Dependency injection: default clients NOT instantiated when deps provided ──

console.log('\n20. Dependency injection: when deps are provided, default clients are NOT instantiated:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  // No ai_settings seeded — if the engine tries to use defaults, it would throw AI_NOT_CONFIGURED

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
    ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  // With both deps provided, no DB ai_settings needed
  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned with just the provided deps');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');

  // Verify mock was called exactly once (no extra calls)
  assertEqual(
    (mockAi.getCompletion as ReturnType<typeof vi.fn>).mock.calls.length,
    1,
    'aiProvider.getCompletion called exactly once',
  );
  assertEqual(
    (mockCh.getMarketEvidence as ReturnType<typeof vi.fn>).mock.calls.length,
    1,
    'clickhouseClient.getMarketEvidence called exactly once',
  );
}

// ── performAssessment: ClickHouse returns error in evidence (not thrown) ─

console.log('\n21. performAssessment with CH evidence.error field produces warning:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: undefined,
    dataDateRange: undefined,
    ohlc: [],
    notes: ['ClickHouse query failed: DB::Exception: Table not found'],
    error: 'ClickHouse query failed: DB::Exception: Table not found',
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned');
  const warningsText = result.warnings.join(' ');
  assertIncludes(warningsText, 'Market evidence error', 'warning mentions market evidence error');
}

// ── buildAssessmentPrompt: with systemPrompt override ───────────────────

console.log('\n22. buildAssessmentPrompt accepts systemPrompt option override:');
{
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId);
  const gathered = await gatherTradeData(tradeId);

  const override = 'Custom assessment prompt for my trading system.';
  const prompt = buildAssessmentPrompt(gathered, { systemPrompt: override });

  assert(prompt.systemMessage.includes('Custom assessment'), 'system message uses override');
  assert(!prompt.systemMessage.includes('trade quality assessor'), 'default persona not used');
}

// ── buildAssessmentPrompt: with assessmentType override ─────────────────

console.log('\n23. buildAssessmentPrompt passes assessmentType to output format section:');
{
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId);
  const gathered = await gatherTradeData(tradeId);

  const prompt = buildAssessmentPrompt(gathered, { assessmentType: 'ai_review' });
  assert(prompt.userMessage.includes('ai_review'), 'prompt includes ai_review assessment type');
}


console.log('\n=== Freshness Gate Tests ===\n');

// ── 24. STALE_MARKET_DATA blocks ai_quality assessment ──────────────────

console.log('\n24. performAssessment with stale market data (ai_quality) throws STALE_MARKET_DATA:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient(
    {
      symbol: 'AAPL',
      secid: 12345,
      dataDateRange: { start: '2024-01-01', end: '2024-01-15' },
      ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
      notes: [],
    },
    {
      status: 'stale',
      latestDate: '2024-01-15',
      threshold: '2024-01-30',
      message: 'Data is stale: latest tradedate 2024-01-15 is older than 1 day(s) (threshold: 2024-01-30)',
    },
  );

  const mockAi = createMockAiProvider(makeValidScorecard());

  try {
    await performAssessment(tradeId, {
      clickhouseClient: mockCh,
      aiProvider: mockAi,
    });
    failed++;
    console.error('  \u274c Expected AssessmentError but no exception thrown (FAILED)');
  } catch (err) {
    if (err instanceof AssessmentError && err.code === AssessmentErrorCode.STALE_MARKET_DATA) {
      passed++;
      console.log('  \u2705 Throws AssessmentError with STALE_MARKET_DATA');
      assertIncludes(err.message, '2024-01-15', 'error message includes latest available date');
      assertEqual(err.tradeId, tradeId, 'error carries tradeId');
    } else {
      failed++;
      console.error(`  \u274c Expected AssessmentError with STALE_MARKET_DATA, got ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)} (FAILED)`);
    }
  }

  // Verify checkFreshness was called exactly once
  assertEqual(
    (mockCh.checkFreshness as ReturnType<typeof vi.fn>).mock.calls.length,
    1,
    'checkFreshness called exactly once',
  );
}

// ── 25. Stale data warns but does not block ai_review ───────────────────

console.log('\n25. performAssessment with stale market data (ai_review) returns with warnings:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient(
    {
      symbol: 'AAPL',
      secid: 12345,
      dataDateRange: { start: '2024-01-01', end: '2024-01-15' },
      ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
      notes: [],
    },
    {
      status: 'stale',
      latestDate: '2024-01-15',
      threshold: '2024-01-30',
      message: 'Data is stale: latest tradedate 2024-01-15 is older than 1 day(s) (threshold: 2024-01-30)',
    },
  );

  const mockAi = createMockAiProvider(makeValidScorecard({ assessmentType: 'ai_review' }));

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  }, { assessmentType: 'ai_review' });

  assertNotNull(result, 'result returned despite stale data for ai_review');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');
  assert(result.warnings.length > 0, 'has warnings');
  const warningsText = result.warnings.join(' ');
  assertIncludes(warningsText, 'data freshness', 'warning mentions data freshness');

  // Verify checkFreshness was called
  assertEqual(
    (mockCh.checkFreshness as ReturnType<typeof vi.fn>).mock.calls.length,
    1,
    'checkFreshness called exactly once',
  );
}

// ── 26. Fresh data passes through normally for ai_quality ────────────────

console.log('\n26. performAssessment with fresh market data (ai_quality) passes through:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = createMockClickHouseClient(
    {
      symbol: 'AAPL',
      secid: 12345,
      dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
      ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
      notes: [],
    },
    {
      status: 'fresh',
      latestDate: '2024-01-31',
      threshold: '2024-01-30',
      message: 'Data is fresh: latest tradedate 2024-01-31 is within 1 day(s)',
    },
  );

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');
  assertEqual(result.scorecard.assessmentType, 'ai_quality', 'assessment type is ai_quality');

  // Verify no freshness warnings in result
  const freshnessWarnings = result.warnings.filter(w => w.includes('freshness') || w.includes('stale'));
  assertEqual(freshnessWarnings.length, 0, 'no freshness warnings for fresh data');

  // Verify checkFreshness was called
  assertEqual(
    (mockCh.checkFreshness as ReturnType<typeof vi.fn>).mock.calls.length,
    1,
    'checkFreshness called exactly once',
  );
}

// ── 27. Freshness check connection error produces warning ───────────────

console.log('\n27. performAssessment with checkFreshness error produces warning:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });
  seedAiSetting();

  const mockCh = {
    getMarketEvidence: vi.fn().mockImplementation(async () => ({
      symbol: 'AAPL',
      secid: 12345,
      dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
      ohlc: [{ date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 }],
      notes: [],
    })),
    checkFreshness: vi.fn().mockRejectedValue(new Error('ClickHouse connection refused')),
    getFeatureTimeSeries: vi.fn().mockResolvedValue([]),
    getAllFeatureColumns: vi.fn().mockResolvedValue([]),
  };

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned despite freshness check error');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard still parsed');

  // Warning contains the connection error info
  const hasFreshnessWarning = result.warnings.some(w => w.includes('check') || w.includes('ClickHouse'));
  assert(hasFreshnessWarning, 'contains warning about freshness check failure');
}



console.log('\n=== Per-Play Lookback & Data Sufficiency Tests ===\n');

// ── 28. Multiple fields with different minLookbackDays ──────────────────

console.log('\n28. performAssessment derives lookback from max of evaluation field minLookbackDays:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-06-15T10:00:00.000Z',
  });

  // Seed setup with evaluation fields having different minLookbackDays
  // lookup ID must match setup definition ID for gatherTradeData join
  const setupDefId = seedSetupDefinition({ name: 'Momentum Breakout' });
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at) ` +
    `VALUES ('${setupDefId}', 'setup', 'Momentum Breakout', 1, 1, '${now}', '${now}')`
  );
  seedPlayEvaluationField(setupDefId, { fieldKey: 'f1', label: 'F1', fieldType: 'boolean', sortOrder: 1, minLookbackDays: 30 });
  seedPlayEvaluationField(setupDefId, { fieldKey: 'f2', label: 'F2', fieldType: 'score_1_5', sortOrder: 2, minLookbackDays: 90 });
  seedPlayEvaluationField(setupDefId, { fieldKey: 'f3', label: 'F3', fieldType: 'score_1_10', sortOrder: 3, minLookbackDays: 60 });
  sqlite.exec(`UPDATE trades SET setup_id = '${setupDefId}' WHERE id = '${tradeId}'`);
  seedAiSetting();

  const refDate = new Date('2024-06-15');
  const expectedStart = new Date(refDate);
  expectedStart.setDate(expectedStart.getDate() - 90);
  const expectedStartStr = expectedStart.toISOString().slice(0, 10);

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: expectedStartStr, end: '2024-06-20' },
    ohlc: Array.from({ length: 100 }, (_, i) => ({
      date: new Date(2024, 2, 17 + i).toISOString().slice(0, 10),
      open: 150, high: 155, low: 148, close: 152, volume: 50000000, vwap: 151,
    })),
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  // Verify the date range used 90-day lookback (the max of 30, 90, 60)
  const queryArg = (mockCh.getMarketEvidence as ReturnType<typeof vi.fn>).mock.calls[0][0];
  assertEqual(queryArg.startDate, expectedStartStr, `lookback window uses max field value = 90 days (startDate: ${expectedStartStr})`);
  assertNotNull(result, 'result returned');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');

  // Verify structured log was emitted for per_play_lookback
  const consoleSpy = vi.spyOn(console, 'log');
  // Re-run to capture the log (or just assert the log via the result)
  // The event was already emitted; check result is correct
  consoleSpy.mockRestore();
}

// ── 29. No evaluation fields (fallback to 45-day default) ────────────────

console.log('\n29. performAssessment uses 365-day default lookback when no evaluation fields:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-06-15T10:00:00.000Z',
    // No setupId — no evaluation fields will be resolved
    setupId: null,
  });
  seedAiSetting();

  const refDate = new Date('2024-06-15');
  const expectedStart = new Date(refDate);
  expectedStart.setDate(expectedStart.getDate() - 365);
  const expectedStartStr = expectedStart.toISOString().slice(0, 10);

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: expectedStartStr, end: '2024-06-20' },
    ohlc: Array.from({ length: 50 }, (_, i) => ({
      date: new Date(2024, 3, 1 + i).toISOString().slice(0, 10),
      open: 150, high: 155, low: 148, close: 152, volume: 50000000, vwap: 151,
    })),
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  const queryArg = (mockCh.getMarketEvidence as ReturnType<typeof vi.fn>).mock.calls[0][0];
  assertEqual(queryArg.startDate, expectedStartStr, `lookback window falls back to 365 days (startDate: ${expectedStartStr})`);
  assertNotNull(result, 'result returned');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');
}

// ── 30. Insufficient OHLC bars produces data sufficiency warning ─────────

console.log('\n30. performAssessment warns when OHLC bars are fewer than maxLookback:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-06-15T10:00:00.000Z',
  });

  // Seed evaluation field with high lookback (200 days), but only return 5 bars
  // lookup ID must match setup definition ID for gatherTradeData join
  const setupDefId = seedSetupDefinition({ name: 'Momentum Breakout' });
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at) ` +
    `VALUES ('${setupDefId}', 'setup', 'Momentum Breakout', 1, 1, '${now}', '${now}')`
  );
  seedPlayEvaluationField(setupDefId, { fieldKey: 'f1', label: 'High Lookback', fieldType: 'boolean', sortOrder: 1, minLookbackDays: 200 });
  sqlite.exec(`UPDATE trades SET setup_id = '${setupDefId}' WHERE id = '${tradeId}'`);
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-01-01', end: '2024-06-20' },
    ohlc: [
      { date: '2024-01-02', open: 150, high: 155, low: 148, close: 152, volume: 50000000, vwap: 151 },
      { date: '2024-01-03', open: 152, high: 156, low: 149, close: 153, volume: 48000000, vwap: 152 },
      { date: '2024-01-04', open: 153, high: 157, low: 150, close: 154, volume: 52000000, vwap: 153 },
      { date: '2024-01-05', open: 154, high: 158, low: 151, close: 155, volume: 50000000, vwap: 154 },
      { date: '2024-01-08', open: 155, high: 159, low: 152, close: 156, volume: 51000000, vwap: 155 },
    ],
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned despite insufficient data');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly (assessment still proceeds)');

  // Check for data sufficiency warning
  const hasSufficiencyWarning = result.warnings.some(w =>
    w.includes('Data sufficiency') && w.includes('5/200'),
  );
  assert(hasSufficiencyWarning, 'warning says only 5/200 bars available');
}

// ── 31. Sufficient OHLC bars produces no data sufficiency warning ────────

console.log('\n31. performAssessment does NOT warn when OHLC bars meet or exceed maxLookback:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-06-15T10:00:00.000Z',
  });

  // Seed evaluation field with low lookback (10 days), return 50 bars
  // lookup ID must match setup definition ID for gatherTradeData join
  const setupDefId = seedSetupDefinition({ name: 'Momentum Breakout' });
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at) ` +
    `VALUES ('${setupDefId}', 'setup', 'Momentum Breakout', 1, 1, '${now}', '${now}')`
  );
  seedPlayEvaluationField(setupDefId, { fieldKey: 'f1', label: 'Low Lookback', fieldType: 'boolean', sortOrder: 1, minLookbackDays: 10 });
  sqlite.exec(`UPDATE trades SET setup_id = '${setupDefId}' WHERE id = '${tradeId}'`);
  seedAiSetting();

  const mockCh = createMockClickHouseClient({
    symbol: 'AAPL',
    secid: 12345,
    dataDateRange: { start: '2024-04-01', end: '2024-06-20' },
    ohlc: Array.from({ length: 50 }, (_, i) => ({
      date: new Date(2024, 3, 1 + i).toISOString().slice(0, 10),
      open: 150 + i * 0.5, high: 155 + i * 0.5, low: 148 + i * 0.5, close: 152 + i * 0.5, volume: 50000000, vwap: 151 + i * 0.5,
    })),
    notes: [],
  });

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    clickhouseClient: mockCh,
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');

  // Check that no data sufficiency warning was added
  const hasSufficiencyWarning = result.warnings.some(w => w.includes('Data sufficiency'));
  assert(!hasSufficiencyWarning, 'no data sufficiency warning when bars >= maxLookback');
}

// ── 32. No deps.clickhouseClient → resolves via resolveOhlcProvider(analysisConfig.dataProvider) ──

console.log('\n32. performAssessment without deps.clickhouseClient resolves provider from analysisConfig.dataProvider:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });

  // Seed setup with dataProvider explicitly set to 'clickhouse' in analysisConfig
  const setupDefId = seedSetupDefinition({
    name: 'Provider Test Setup',
    analysisConfig: JSON.stringify({
      ohlcYears: 1,
      featureMode: 'custom',
      features: [],
      includeRawOhlcv: true,
      dataProvider: 'clickhouse',
    }),
  });
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at) ` +
    `VALUES ('${setupDefId}', 'setup', 'Provider Test Setup', 1, 1, '${now}', '${now}')`
  );
  sqlite.exec(`UPDATE trades SET setup_id = '${setupDefId}' WHERE id = '${tradeId}'`);
  seedAiSetting();

  // No clickhouseClient in deps — engine uses resolveOhlcProvider via mock
  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned without deps.clickhouseClient');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');
}

// ── 33. dataProvider='schwab' resolves via mock ─────────────────────────

console.log('\n33. performAssessment resolves schwab provider from analysisConfig.dataProvider:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });

  const setupDefId = seedSetupDefinition({
    name: 'Schwab Setup',
    analysisConfig: JSON.stringify({
      ohlcYears: 1,
      featureMode: 'custom',
      features: [],
      includeRawOhlcv: true,
      dataProvider: 'schwab',
    }),
  });
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at) ` +
    `VALUES ('${setupDefId}', 'setup', 'Schwab Setup', 1, 1, '${now}', '${now}')`
  );
  sqlite.exec(`UPDATE trades SET setup_id = '${setupDefId}' WHERE id = '${tradeId}'`);
  seedAiSetting();

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned with schwab provider');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');
}

// ── 34. No analysisConfig → defaults to clickhouse ──────────────────────

console.log('\n34. performAssessment defaults to clickhouse when no analysisConfig:');
{
  cleanup();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, {
    openedAt: '2024-01-15T10:00:00.000Z',
  });

  // No setupId — no analysisConfig will be resolved
  // Engine defaults analysisConfig.dataProvider to 'clickhouse'
  seedAiSetting();

  const mockAi = createMockAiProvider(makeValidScorecard());

  const result = await performAssessment(tradeId, {
    aiProvider: mockAi,
  });

  assertNotNull(result, 'result returned with default clickhouse provider');
  assertEqual(result.scorecard.overallScore, 72, 'scorecard parsed correctly');
}


console.log('\n=== Summary ===\n');

const total = passed + failed;
console.log(`${'\u2500'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
expect(failed).toBe(0);
if (failed === 0) {
  console.log('         All tests passed!\n');
}

});
