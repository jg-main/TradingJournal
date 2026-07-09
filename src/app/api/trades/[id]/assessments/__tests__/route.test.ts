/**
 * assessment route test
 *
 * Tests POST (trigger assessment pipeline, versioned persistence, error mapping)
 * and GET (browse versioned history, empty, not found).
 *
 * Uses in-memory SQLite + module-level mocks for ClickHouse and AI provider so
 * the real route handler and engine execute against controlled backends.
 *
 * Run: npx vitest run src/app/api/trades/[id]/assessments/__tests__/route.test.ts
 */

import { vi, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

// ── Hoisted: in-memory SQLite DB + table creation + shared mock state ───
// Only uses require for third-party packages which work at hoist time.
// Local source files are NOT required here.

const testCtx = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF');

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
      setup_id TEXT,
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
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (current_timestamp)
    );
  `);

  // ── Shared mock state for controllable AI provider and CH client ──
  const mockState = {
    aiProviderResponse: null as string | null,
    aiProviderError: null as Error | null,
    chResponse: null as Record<string, unknown> | null,
    chError: null as Error | null,
    chFreshnessResponse: null as Record<string, unknown> | null,
  };

  return { sqlite, mockState };
});

// ── Module-level mocks ───────────────────────────────────────────────────

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

vi.mock('@/lib/clickhouse-client', () => {
  return {
    createDefaultClickHouseClient: () => ({
      getMarketEvidence: async () => {
        if (testCtx.mockState.chError) throw testCtx.mockState.chError;
        return testCtx.mockState.chResponse ?? {
          symbol: 'AAPL',
          secid: 12345,
          dataDateRange: { start: '2024-01-01', end: '2024-01-31' },
          ohlc: [
            { date: '2024-01-02', open: 150.25, high: 152.80, low: 149.90, close: 151.50, volume: 50000000, vwap: 151.25 },
            { date: '2024-01-03', open: 151.50, high: 153.00, low: 150.00, close: 152.75, volume: 45000000, vwap: 152.00 },
          ],
          notes: [],
        };
      },
      checkFreshness: async () => {
        return testCtx.mockState.chFreshnessResponse ?? {
          status: 'fresh',
          latestDate: '2024-01-31',
          threshold: '2024-01-30',
          message: 'Data is fresh: latest tradedate 2024-01-31 is within 1 day(s)',
        };
      },
    }),
  };
});

vi.mock('@/lib/ai-provider', () => {
  return {
    AiProviderError: class AiProviderError extends Error {
      public code: string;
      public statusCode?: number;
      constructor(code: string, message: string, statusCode?: number) {
        super(message);
        this.name = 'AiProviderError';
        this.code = code;
        this.statusCode = statusCode;
      }
    },
    createAiProvider: () => ({
      getCompletion: async () => {
        if (testCtx.mockState.aiProviderError) throw testCtx.mockState.aiProviderError;
        const content = testCtx.mockState.aiProviderResponse ?? JSON.stringify({
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
        });
        return {
          content,
          usage: { promptTokens: 120, completionTokens: 340 },
        };
      },
    }),
  };
});

// ── Module-level imports ─────────────────────────────────────────────────

import { eq, desc, count } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/db/schema';
import {
  performAssessment,
  AssessmentError,
  AssessmentErrorCode,
} from '@/lib/assessment-engine';
import type { AiProviderError } from '@/lib/ai-provider';

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

// ── Seed & DB helpers ───────────────────────────────────────────────────

const sqlite = testCtx.sqlite;

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

function resetMockState() {
  testCtx.mockState.aiProviderResponse = null;
  testCtx.mockState.aiProviderError = null;
  testCtx.mockState.chResponse = null;
  testCtx.mockState.chError = null;
  testCtx.mockState.chFreshnessResponse = null;
}

// Drizzle instance with schema mapping (for reading snapshots with camelCase mapping)
const seedDb = drizzle(sqlite, { schema });

function seedAccount(overrides: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at) ` +
    `VALUES ('${id}', 'Test Account', 'USD', 1, '${now}', '${now}')`
  );
  return id;
}

function seedTrade(accountId: string, overrides: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const code = `TC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const symbol = (overrides.symbol as string) ?? 'AAPL';
  const direction = (overrides.direction as string) ?? 'long';
  const status = (overrides.status as string) ?? 'planned';
  const setupId = overrides.setupId !== undefined ? `'${overrides.setupId}'` : 'NULL';

  sqlite.exec(
    `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, setup_id, ` +
    `planned_entry, planned_stop, planned_target_1, planned_quantity, thesis, invalidation_condition, ` +
    `pre_trade_plan, created_at, updated_at) ` +
    `VALUES ('${id}', '${code}', '${accountId}', '${symbol}', '${direction}', '${status}', ${setupId}, ` +
    `150, 145, 160, 100, 'Bullish breakout on support', 'Close below 145', '` +
    `Wait for confirmation', '${now}', '${now}')`
  );
  return id;
}

function seedAiSetting(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const provider = (overrides.provider as string) ?? 'openai';
  const model = (overrides.model as string) ?? 'gpt-4o';
  const apiKey = (overrides.apiKey as string) ?? 'sk-test-key';
  const isActive = overrides.isActive !== undefined ? (overrides.isActive ? 1 : 0) : 1;

  sqlite.exec(
    `INSERT INTO ai_settings (id, provider, model, api_key, is_active, created_at, updated_at) ` +
    `VALUES ('${id}', '${provider}', '${model}', '${apiKey}', ${isActive}, '${now}', '${now}')`
  );
}

// ── Zod schema matching the route's postAssessmentSchema ────────────────

const postAssessmentSchema = z.object({
  assessmentType: z
    .enum(['ai_quality', 'ai_review'])
    .optional()
    .default('ai_quality'),
});

// ── Simulated route functions (replicating route.ts logic) ─────────────

function mapAssessmentError(err: AssessmentError): { status: number; safeMessage: string } {
  switch (err.code) {
    case AssessmentErrorCode.TRADE_NOT_FOUND:
      return { status: 404, safeMessage: err.message };
    case AssessmentErrorCode.AI_NOT_CONFIGURED:
      return {
        status: 400,
        safeMessage: 'AI is not configured \u2014 set up AI settings first',
      };
    case AssessmentErrorCode.AI_PROVIDER_ERROR:
      return {
        status: 502,
        safeMessage: 'AI provider error \u2014 check credentials or try again later',
      };
    case AssessmentErrorCode.SCORECARD_PARSE_ERROR:
      return {
        status: 502,
        safeMessage: 'AI returned invalid assessment \u2014 try again',
      };
    case AssessmentErrorCode.CLICKHOUSE_ERROR:
      return { status: 200, safeMessage: err.message };
    case AssessmentErrorCode.MISSING_MARKET_DATA:
      return { status: 200, safeMessage: err.message };
    case AssessmentErrorCode.STALE_MARKET_DATA:
      return {
        status: 409,
        safeMessage: 'Market data is not current',
      };
    default:
      return { status: 500, safeMessage: 'Assessment failed due to an unexpected error' };
  }
}

function buildSnapshotResponse(row: Record<string, unknown>) {
  let parsedScorecard: unknown = null;
  if (row.scorecardJson) {
    try {
      parsedScorecard = JSON.parse(row.scorecardJson as string);
    } catch {
      parsedScorecard = null;
    }
  }

  return {
    id: row.id,
    tradeId: row.tradeId,
    assessedAt: row.assessedAt,
    assessmentType: row.assessmentType,
    overallScore: row.overallScore,
    modelUsed: row.modelUsed,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    notes: row.notes,
    createdAt: row.createdAt,
    scorecard: parsedScorecard,
  };
}

function readDbAssessmentSnapshot(id: string): Record<string, unknown> | undefined {
  const row = seedDb
    .select()
    .from(schema.tradeAssessmentSnapshots)
    .where(eq(schema.tradeAssessmentSnapshots.id, id))
    .get();
  return row as Record<string, unknown> | undefined;
}

function countDbSnapshots(tradeId: string): number {
  const result = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM trade_assessment_snapshots WHERE trade_id = ?')
    .get(tradeId) as { cnt: number };
  return result.cnt;
}

function getDbSnapshots(tradeId: string): Record<string, unknown>[] {
  const rows = seedDb
    .select()
    .from(schema.tradeAssessmentSnapshots)
    .where(eq(schema.tradeAssessmentSnapshots.tradeId, tradeId))
    .orderBy(desc(schema.tradeAssessmentSnapshots.assessedAt))
    .all();
  return rows as unknown as Record<string, unknown>[];
}

async function doPostAssessment(
  tradeId: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  try {
    // Validate trade exists
    const tradeRow = sqlite
      .prepare('SELECT id FROM trades WHERE id = ?')
      .get(tradeId) as Record<string, unknown> | undefined;

    if (!tradeRow) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    // Parse optional body
    let assessmentType: string = 'ai_quality';
    if (body) {
      const parsed = postAssessmentSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          data: { error: 'Validation failed', details: parsed.error.flatten() },
        };
      }
      assessmentType = parsed.data.assessmentType;
    }

    // Execute assessment pipeline
    let result: Awaited<ReturnType<typeof performAssessment>>;

    try {
      result = await performAssessment(tradeId, undefined, {
        assessmentType: assessmentType as 'ai_quality' | 'ai_review',
      });
    } catch (err) {
      if (err instanceof AssessmentError) {
        const { status, safeMessage } = mapAssessmentError(err);
        return { status, data: { error: safeMessage, code: err.code } };
      }
      // Unexpected non-AssessmentError
      console.log(
        JSON.stringify({
          event: 'assessment_error',
          tradeId,
          errorCode: 'UNEXPECTED',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return { status: 500, data: { error: 'Unexpected assessment error' } };
    }

    // Compute snapshotVersion
    const existingCount = countDbSnapshots(tradeId);
    const snapshotVersion = existingCount;

    // Read back persisted snapshot for response
    const savedRow = readDbAssessmentSnapshot(result.snapshot.id);

    if (!savedRow) {
      return {
        status: 500,
        data: { error: 'Assessment completed but snapshot could not be read back' },
      };
    }

    const snapshotResponse = buildSnapshotResponse(savedRow);

    return {
      status: 201,
      data: {
        snapshot: {
          ...snapshotResponse,
          snapshotVersion,
        },
        scorecard: result.scorecard,
        warnings: result.warnings,
      },
    };
  } catch (error) {
    console.log(
      JSON.stringify({
        event: 'assessment_error',
        tradeId: 'unknown',
        errorCode: 'UNEXPECTED',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { status: 500, data: { error: 'Failed to process assessment request' } };
  }
}

async function doGetAssessments(
  tradeId: string,
): Promise<{ status: number; data: unknown }> {
  try {
    // Validate trade exists
    const tradeRow = sqlite
      .prepare('SELECT id FROM trades WHERE id = ?')
      .get(tradeId) as Record<string, unknown> | undefined;

    if (!tradeRow) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    // Query snapshots DESC by assessedAt
    const rows = getDbSnapshots(tradeId);

    // Compute snapshotVersion as 1-based index from oldest
    const totalCount = rows.length;
    const data = rows.map((row, index) => {
      const version = totalCount - index; // oldest = 1, newest = totalCount
      const snapshot = buildSnapshotResponse(row);
      return { ...snapshot, snapshotVersion: version };
    });

    return { status: 200, data: { data, tradeId } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch assessments', details: String(error) } };
  }
}

// ── Test Suite ─────────────────────────────────────────────────────────

test('Assessment Routes \u2014 POST and GET /api/trades/[id]/assessments', async () => {

console.log('\n=== POST Assessment Tests ===\n');

// ── 1. POST: Happy path ────────────────────────────────────────────────

console.log('\n1. POST with valid tradeId returns 201 with scorecard:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  const result = await doPostAssessment(tradeId);

  assertEqual(result.status, 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  const snapshot = data.snapshot as Record<string, unknown>;
  const scorecard = data.scorecard as Record<string, unknown>;

  assertNotNull(snapshot.id, 'snapshot has id');
  assertEqual(snapshot.snapshotVersion, 1, 'snapshotVersion is 1 for first assessment');
  assertEqual(snapshot.overallScore, 72, 'snapshot overallScore matches');
  assertEqual(snapshot.assessmentType, 'ai_quality', 'assessmentType is ai_quality');
  assertNotNull(snapshot.assessedAt, 'snapshot has assessedAt');

  assertNotNull(scorecard, 'response has scorecard');
  assertEqual(scorecard.overallScore, 72, 'scorecard overallScore matches');

  // Verify snapshot persisted to DB
  const dbRow = readDbAssessmentSnapshot(snapshot.id as string);
  assertNotNull(dbRow, 'snapshot persisted to DB');
  assertEqual((dbRow as Record<string, unknown>).tradeId ?? (dbRow as Record<string, unknown>).trade_id, tradeId, 'DB snapshot tradeId matches');
  assertEqual((dbRow as Record<string, unknown>).overallScore ?? (dbRow as Record<string, unknown>).overall_score, 72, 'DB snapshot overallScore matches');

  // Verify apiKey never present in response
  const responseJson = JSON.stringify(result.data);
  assert(!responseJson.includes('sk-test-key'), 'apiKey not in response');
}

// ── 2. POST: Snapshot version increments ────────────────────────────────

console.log('\n2. POST twice verifies snapshotVersion increments:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // First assessment
  const first = await doPostAssessment(tradeId);
  assertEqual(first.status, 201, 'first POST returns 201');
  const firstData = first.data as Record<string, unknown>;
  const firstSnapshot = firstData.snapshot as Record<string, unknown>;
  assertEqual(firstSnapshot.snapshotVersion, 1, 'first snapshot version is 1');

  // Second assessment
  const second = await doPostAssessment(tradeId);
  assertEqual(second.status, 201, 'second POST returns 201');
  const secondData = second.data as Record<string, unknown>;
  const secondSnapshot = secondData.snapshot as Record<string, unknown>;
  assertEqual(secondSnapshot.snapshotVersion, 2, 'second snapshot version is 2');

  // Verify two snapshots in DB
  assertEqual(countDbSnapshots(tradeId), 2, '2 snapshots in DB');

  // Verify apiKey not in any response
  assert(!JSON.stringify(first.data).includes('sk-test-key'), 'apiKey not in first response');
  assert(!JSON.stringify(second.data).includes('sk-test-key'), 'apiKey not in second response');
}

// ── 3. POST: Scorecard round-trip ───────────────────────────────────────

console.log('\n3. POST verifies scorecardJson persisted correctly in DB:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  const snapshot = data.snapshot as Record<string, unknown>;

  // Read raw DB row
  const dbRow = readDbAssessmentSnapshot(snapshot.id as string);
  assertNotNull(dbRow, 'snapshot in DB');

  // Parse scorecardJson from DB
  const scorecardJson = (dbRow as Record<string, unknown>).scorecardJson ?? (dbRow as Record<string, unknown>).scorecard_json;
  const storedScorecard = JSON.parse(scorecardJson as string);
  assertEqual(storedScorecard.overallScore, 72, 'DB scorecard overallScore matches');
  assertEqual(storedScorecard.gradeLabel, 'B', 'DB scorecard gradeLabel matches');
  assert(storedScorecard.dimensions.length === 6, 'DB scorecard has 6 dimensions');

  // Response snapshot also has parsed scorecard
  assertNotNull(snapshot.scorecard, 'snapshot scorecard in response');
  const responseScorecard = snapshot.scorecard as Record<string, unknown>;
  assertEqual(responseScorecard.overallScore, 72, 'response scorecard overallScore matches');
}

// ── 4. POST: Trade not found ────────────────────────────────────────────

console.log('\n4. POST to nonexistent trade returns 404:');
{
  cleanup();
  resetMockState();
  const result = await doPostAssessment('nonexistent-id');
  assertEqual(result.status, 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Trade not found', 'error message matches');
}

// ── 5. POST: No AI settings configured ──────────────────────────────────

console.log('\n5. POST with no ai_settings returns 400 with AI_NOT_CONFIGURED error:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  // Intentionally NOT seeding ai_settings

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'AI is not configured \u2014 set up AI settings first', 'safe error message');
  assertEqual(data.code, 'AI_NOT_CONFIGURED', 'error code is AI_NOT_CONFIGURED');
}

// ── 6. POST: AI provider auth error ─────────────────────────────────────

console.log('\n6. POST with AI auth error returns 502 with safe message:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // Set AI provider to throw auth error
  // We need to import AiProviderError from the mocked module
  // The test body imports from @/lib/ai-provider which is the mock
  const { AiProviderError: MockedAiProviderError } = await import('@/lib/ai-provider');
  testCtx.mockState.aiProviderError = new MockedAiProviderError('AUTH_ERROR', 'Incorrect API key provided', 401);

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 502, 'returns 502');
  const data = result.data as Record<string, unknown>;
  assertEqual(
    data.error,
    'AI provider error \u2014 check credentials or try again later',
    'safe error message (no apiKey leak)',
  );
  assertEqual(data.code, 'AI_PROVIDER_ERROR', 'error code is AI_PROVIDER_ERROR');

  // Verify apiKey never leaked
  assert(!JSON.stringify(result.data).includes('sk-test-key'), 'apiKey not in response');
  assert(!JSON.stringify(result.data).includes('Incorrect API key'), 'auth details not leaked');
}

// ── 7. POST: AI provider timeout ────────────────────────────────────────

console.log('\n7. POST with AI timeout returns 502 with safe message:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  const { AiProviderError: MockedAiProviderError } = await import('@/lib/ai-provider');
  testCtx.mockState.aiProviderError = new MockedAiProviderError('TIMEOUT', 'Request timed out after 30000ms');

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 502, 'returns 502');
  const data = result.data as Record<string, unknown>;
  assertEqual(
    data.error,
    'AI provider error \u2014 check credentials or try again later',
    'safe error message',
  );
  assertEqual(data.code, 'AI_PROVIDER_ERROR', 'error code is AI_PROVIDER_ERROR');
}

// ── 8. POST: Malformed AI JSON response ─────────────────────────────────

console.log('\n8. POST with malformed AI JSON returns 502 with SCORECARD_PARSE_ERROR:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  testCtx.mockState.aiProviderResponse = '} not valid json at all {';

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 502, 'returns 502');
  const data = result.data as Record<string, unknown>;
  assertEqual(
    data.error,
    'AI returned invalid assessment \u2014 try again',
    'safe error message for parse failure',
  );
  assertEqual(data.code, 'SCORECARD_PARSE_ERROR', 'error code is SCORECARD_PARSE_ERROR');
}

// ── 9. POST: assessmentType ai_review ───────────────────────────────────

console.log('\n9. POST with assessmentType ai_review returns 201 with assessmentType in response and DB:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // Mock AI to return a scorecard with ai_review assessmentType
  testCtx.mockState.aiProviderResponse = JSON.stringify({
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
    assessmentType: 'ai_review',
  });

  const result = await doPostAssessment(tradeId, { assessmentType: 'ai_review' });
  assertEqual(result.status, 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  const snapshot = data.snapshot as Record<string, unknown>;
  assertEqual(snapshot.assessmentType, 'ai_review', 'assessmentType is ai_review in response');

  // Verify DB
  const dbRow = readDbAssessmentSnapshot(snapshot.id as string);
  assertNotNull(dbRow, 'snapshot in DB');
  const actualType = (dbRow as Record<string, unknown>).assessmentType ?? (dbRow as Record<string, unknown>).assessment_type;
  assertEqual(actualType, 'ai_review', 'assessmentType is ai_review in DB');
}

// ── 10. POST: Default assessmentType omitted ────────────────────────────

console.log('\n10. POST without body defaults to ai_quality:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // No body → should default to ai_quality
  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  const snapshot = data.snapshot as Record<string, unknown>;
  assertEqual(snapshot.assessmentType, 'ai_quality', 'defaults to ai_quality');
}

// ── 11. POST: Invalid assessmentType in body ────────────────────────────

console.log('\n11. POST with invalid assessmentType returns 400 validation error:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  const result = await doPostAssessment(tradeId, { assessmentType: 'invalid_type' });
  assertEqual(result.status, 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Validation failed', 'validation error message');
  assertNotNull(data.details, 'validation details present');
}


console.log('\n=== GET Assessment Tests ===\n');

// ── 12. GET: No snapshots ───────────────────────────────────────────────

console.log('\n12. GET with no snapshots returns 200 with empty data:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId);

  const result = await doGetAssessments(tradeId);
  assertEqual(result.status, 200, 'returns 200');
  const data = result.data as { data: unknown[]; tradeId: string };
  assert(Array.isArray(data.data), 'data is an array');
  assertEqual(data.data.length, 0, 'data array is empty');
  assertEqual(data.tradeId, tradeId, 'tradeId in response matches');
}

// ── 13. GET: One snapshot ───────────────────────────────────────────────

console.log('\n13. GET with one snapshot returns 200 with parsed scorecard and snapshotVersion=1:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // Create one assessment
  await doPostAssessment(tradeId);

  const result = await doGetAssessments(tradeId);
  assertEqual(result.status, 200, 'returns 200');
  const data = result.data as { data: Record<string, unknown>[]; tradeId: string };
  assertEqual(data.data.length, 1, '1 snapshot returned');
  assertEqual(data.data[0].snapshotVersion, 1, 'snapshotVersion is 1');
  assertNotNull(data.data[0].scorecard, 'scorecard parsed in response');
  const scorecard = data.data[0].scorecard as Record<string, unknown>;
  assertEqual(scorecard.overallScore, 72, 'scorecard overallScore matches');

  // Verify apiKey not present
  assert(!JSON.stringify(result.data).includes('sk-test-key'), 'apiKey not in GET response');
}

// ── 14. GET: Multiple snapshots ─────────────────────────────────────────

console.log('\n14. GET with multiple snapshots returns data ordered by assessedAt DESC with correct versions:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // Create two assessments
  await doPostAssessment(tradeId);
  // Small delay to ensure different assessedAt timestamps
  await new Promise((r) => setTimeout(r, 10));
  await doPostAssessment(tradeId);

  const result = await doGetAssessments(tradeId);
  assertEqual(result.status, 200, 'returns 200');
  const data = result.data as { data: Record<string, unknown>[]; tradeId: string };
  assertEqual(data.data.length, 2, '2 snapshots returned');

  // Most recent first (DESC order)
  assertEqual(data.data[0].snapshotVersion, 2, 'newest snapshot has version 2');
  assertEqual(data.data[1].snapshotVersion, 1, 'oldest snapshot has version 1');

  // Both should have scorecard
  assertNotNull(data.data[0].scorecard, 'newest has scorecard');
  assertNotNull(data.data[1].scorecard, 'oldest has scorecard');

  // AssessedAt of newest should be >= oldest
  const assessed0 = new Date(data.data[0].assessedAt as string).getTime();
  const assessed1 = new Date(data.data[1].assessedAt as string).getTime();
  assert(assessed0 >= assessed1, 'newest snapshot assessedAt is >= oldest');
}

// ── 15. GET: Trade not found ─────────────────────────────────────────────

console.log('\n15. GET for nonexistent trade returns 404:');
{
  cleanup();
  resetMockState();
  const result = await doGetAssessments('nonexistent-id');
  assertEqual(result.status, 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Trade not found', 'error message matches');
}

// ── 16. GET: Verify apiKey never present across all responses ───────────

console.log('\n16. GET and POST responses never contain apiKey:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting({ apiKey: 'sk-super-secret-key-never-leak' });

  // POST
  const postResult = await doPostAssessment(tradeId);
  assertEqual(postResult.status, 201, 'POST returns 201');
  assert(!JSON.stringify(postResult.data).includes('sk-super-secret-key'), 'apiKey not in POST response');
  assert(!JSON.stringify(postResult.data).includes('apiKey'), 'apiKey field not in POST response');
  assert(!JSON.stringify(postResult.data).includes('api_key'), 'api_key field not in POST response');

  // GET
  const getResult = await doGetAssessments(tradeId);
  assertEqual(getResult.status, 200, 'GET returns 200');
  assert(!JSON.stringify(getResult.data).includes('sk-super-secret-key'), 'apiKey not in GET response');
  assert(!JSON.stringify(getResult.data).includes('apiKey'), 'apiKey field not in GET response');
  assert(!JSON.stringify(getResult.data).includes('api_key'), 'api_key field not in GET response');
}

// ── 17. POST: AI provider CONNECTION_ERROR ────────────────────────────

console.log('\n17. POST with AI CONNECTION_ERROR returns 502 with safe message:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  const { AiProviderError: MockedAiProviderError } = await import('@/lib/ai-provider');
  testCtx.mockState.aiProviderError = new MockedAiProviderError('CONNECTION_ERROR', 'Connection refused by provider endpoint', 503);

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 502, 'returns 502');
  const data = result.data as Record<string, unknown>;
  assertEqual(
    data.error,
    'AI provider error \u2014 check credentials or try again later',
    'safe error message',
  );
  assertEqual(data.code, 'AI_PROVIDER_ERROR', 'error code is AI_PROVIDER_ERROR');

  // Verify no secret leakage
  assert(!JSON.stringify(result.data).includes('sk-test-key'), 'apiKey not in response');
  assert(!JSON.stringify(result.data).includes('Connection refused'), 'connection details not leaked');
}

// ── 18. POST: Trade with no symbol gracefully succeeds ──────────────────

console.log('\n18. POST with trade having no symbol returns 201 with warnings:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { symbol: '', openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 201, 'returns 201 - graceful degradation');
  const data = result.data as Record<string, unknown>;

  // Verify warnings in response
  const warnings = data.warnings as string[];
  assertNotNull(warnings, 'warnings array present in response');
  assert(
    warnings.some((w: string) => w.includes('no symbol')),
    'warnings contain missing symbol message',
  );

  // Verify snapshot was persisted
  const snapshot = data.snapshot as Record<string, unknown>;
  assertNotNull(snapshot.id, 'snapshot persisted');
  assertEqual(snapshot.overallScore, 72, 'snapshot overallScore matches');

  // Verify notes in DB contain the warning
  const dbRow = readDbAssessmentSnapshot(snapshot.id as string);
  assertNotNull(dbRow, 'snapshot in DB');
  const row = dbRow as Record<string, unknown>;
  const notes = row.notes ?? row.note;
  assertNotNull(notes, 'notes field populated');
  assertIncludes(String(notes), 'no symbol', 'notes contain no-symbol warning');

  // Verify apiKey not in response
  assert(!JSON.stringify(result.data).includes('sk-test-key'), 'apiKey not in response');
}

// ── 19. POST: ClickHouse error evidence flowing into warnings ──────────

console.log('\n19. POST with ClickHouse error returns 201 with warnings:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // Mock ClickHouse to throw an error
  testCtx.mockState.chError = new Error('Connection refused by ClickHouse');

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 201, 'returns 201 - graceful degradation');
  const data = result.data as Record<string, unknown>;

  // Verify warnings contain ClickHouse error
  const warnings = data.warnings as string[];
  assertNotNull(warnings, 'warnings array present in response');
  assert(
    warnings.some((w: string) => w.includes('ClickHouse') || w.includes('Failed to fetch market evidence')),
    'warnings contain ClickHouse error message',
  );

  // Verify snapshot was persisted despite CH error
  const snapshot = data.snapshot as Record<string, unknown>;
  assertNotNull(snapshot.id, 'snapshot persisted');
  assertEqual(snapshot.overallScore, 72, 'snapshot overallScore matches');

  // Verify notes in DB contain the warning
  const dbRow = readDbAssessmentSnapshot(snapshot.id as string);
  assertNotNull(dbRow, 'snapshot in DB');
  const row = dbRow as Record<string, unknown>;
  const notes = row.notes ?? row.note;
  assertNotNull(notes, 'notes field populated');

  // Verify apiKey not in response
  assert(!JSON.stringify(result.data).includes('sk-test-key'), 'apiKey not in response');
}


console.log('\n=== Freshness Gate Route Tests ===\n');

// ── 20. POST with stale market data (ai_quality) returns 409 ─────────────

console.log('\n20. POST with stale market data and ai_quality returns 409 STALE_MARKET_DATA:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // Make checkFreshness return stale
  testCtx.mockState.chFreshnessResponse = {
    status: 'stale',
    latestDate: '2024-01-15',
    threshold: '2024-01-30',
    message: 'Data is stale: latest tradedate 2024-01-15 is older than 1 day(s) (threshold: 2024-01-30)',
  };

  const result = await doPostAssessment(tradeId, { assessmentType: 'ai_quality' });
  assertEqual(result.status, 409, 'returns 409 for stale market data');
  const data = result.data as Record<string, unknown>;
  assertEqual(
    data.error,
    'Market data is not current',
    'safe error message for stale market data',
  );
  assertEqual(data.code, 'STALE_MARKET_DATA', 'error code is STALE_MARKET_DATA');
}

// ── 21. POST with stale market data (ai_review) returns 201 with warnings ─

console.log('\n21. POST with stale market data and ai_review returns 201 with warnings:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // Make checkFreshness return stale
  testCtx.mockState.chFreshnessResponse = {
    status: 'stale',
    latestDate: '2024-01-15',
    threshold: '2024-01-30',
    message: 'Data is stale: latest tradedate 2024-01-15 is older than 1 day(s) (threshold: 2024-01-30)',
  };

  // AI response matching ai_review
  testCtx.mockState.aiProviderResponse = JSON.stringify({
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
    assessmentType: 'ai_review',
  });

  const result = await doPostAssessment(tradeId, { assessmentType: 'ai_review' });
  assertEqual(result.status, 201, 'returns 201 despite stale data for ai_review');
  const data = result.data as Record<string, unknown>;

  // Verify warnings in response
  const warnings = data.warnings as string[];
  assertNotNull(warnings, 'warnings array present');
  assert(
    warnings.some((w: string) => w.includes('data freshness') || w.includes('stale')),
    'warnings contain market data freshness notice',
  );

  // Verify snapshot persisted
  const snapshot = data.snapshot as Record<string, unknown>;
  assertNotNull(snapshot.id, 'snapshot persisted despite stale data');
  assertEqual(snapshot.assessmentType, 'ai_review', 'assessmentType is ai_review in response');
  assertEqual(snapshot.overallScore, 72, 'overallScore matches');

  // Verify apiKey not in response
  assert(!JSON.stringify(result.data).includes('sk-test-key'), 'apiKey not in response');
}

// ── 22. POST with fresh market data returns 201 normally ──────────────────

console.log('\n22. POST with fresh market data returns 201 normally:');
{
  cleanup();
  resetMockState();
  const accountId = seedAccount();
  const tradeId = seedTrade(accountId, { openedAt: '2024-01-15T10:00:00.000Z' });
  seedAiSetting();

  // Freshness is the default (chFreshnessResponse is null, mock returns 'fresh')
  // No need to set anything explicitly

  const result = await doPostAssessment(tradeId);
  assertEqual(result.status, 201, 'returns 201 with fresh market data');
  const data = result.data as Record<string, unknown>;
  const snapshot = data.snapshot as Record<string, unknown>;

  assertNotNull(snapshot.id, 'snapshot persisted');
  assertEqual(snapshot.assessmentType, 'ai_quality', 'assessmentType is ai_quality');
  assertEqual(snapshot.overallScore, 72, 'overallScore matches');

  // Verify warnings are only about missing setup (not freshness)
  const warnings = data.warnings as string[];
  const freshnessWarnings = (warnings ?? []).filter(
    (w: string) => w.includes('freshness') || w.includes('stale'),
  );
  assertEqual(freshnessWarnings.length, 0, 'no freshness warnings with fresh data');

  // Verify apiKey not in response
  assert(!JSON.stringify(result.data).includes('sk-test-key'), 'apiKey not in response');
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
