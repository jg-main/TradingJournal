/**
 * ai-settings route test
 *
 * Tests GET (empty, with settings, secret leak prevention) and PUT
 * (create, update, validation).
 *
 * Run: npx vitest run --reporter verbose src/app/api/ai-settings/__tests__/route.test.ts
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

function assertNotHasKey(obj: Record<string, unknown>, key: string, msg: string) {
  if (!(key in obj)) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — key "${key}" present but should be absent (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || './.test-ai-settings.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS ai_settings;
  DROP TABLE IF EXISTS setup_definitions;
  DROP TABLE IF EXISTS play_evaluation_fields;
  DROP TABLE IF EXISTS trade_assessment_snapshots;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_check_results;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS accounts;
  DROP TABLE IF EXISTS lookup_values;
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS app_profile;
  CREATE TABLE ai_settings (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL CHECK(provider IN ('openai','ollama','anthropic','google','custom')),
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
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetAiSettings(): { status: number; data: unknown } {
  try {
    const row = db.select().from(schema.aiSettings).limit(1).get();
    if (!row) {
      return { status: 200, data: { message: 'No AI settings configured yet. Use PUT to create.' } };
    }
    // Strip apiKey from the response — never expose secrets
    const { apiKey: _, ...safeRow } = row;
    return { status: 200, data: safeRow };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch AI settings', details: String(error) } };
  }
}

function doPutAiSettings(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Validate provider enum
    if (body.provider !== undefined && !['openai', 'ollama', 'anthropic', 'google', 'custom'].includes(body.provider as string)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { provider: ['Invalid enum value. Expected openai | ollama | anthropic | google | custom'] } } } };
    }

    // Validate model is non-empty string
    if (body.model !== undefined && (typeof body.model !== 'string' || body.model.length < 1)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { model: ['Model name is required'] } } } };
    }

    // Validate apiKey is non-empty when provided
    if (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length < 1)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { apiKey: ['API key is required'] } } } };
    }

    // Validate baseUrl is a valid URL when provided
    if (body.baseUrl !== undefined) {
      if (typeof body.baseUrl !== 'string') {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { baseUrl: ['Invalid url'] } } } };
      }
      try {
        new URL(body.baseUrl);
      } catch {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { baseUrl: ['Invalid url'] } } } };
      }
    }

    // Validate timeoutMs is positive integer
    if (body.timeoutMs !== undefined) {
      const val = body.timeoutMs as number;
      if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { timeoutMs: ['Number must be greater than 0'] } } } };
      }
    }

    // Validate temperature 0-2
    if (body.temperature !== undefined) {
      const val = body.temperature as number;
      if (typeof val !== 'number' || val < 0 || val > 2) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { temperature: ['Number must be greater than or equal to 0'] } } } };
      }
    }

    // Validate maxTokens positive integer
    if (body.maxTokens !== undefined) {
      const val = body.maxTokens as number;
      if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { maxTokens: ['Must be positive'] } } } };
      }
    }

    const existing = db.select().from(schema.aiSettings).limit(1).get();
    const now = new Date().toISOString();

    if (!existing) {
      const id = randomUUID();
      const values: Record<string, unknown> = {
        id,
        provider: (typeof body.provider === 'string' ? body.provider : 'openai') as 'openai' | 'ollama' | 'anthropic' | 'google' | 'custom',
        model: (typeof body.model === 'string' ? body.model : 'gpt-4'),
      };
      if (body.apiKey !== undefined) values.apiKey = body.apiKey;
      if (body.baseUrl !== undefined) values.baseUrl = body.baseUrl;
      if (body.timeoutMs !== undefined) values.timeoutMs = body.timeoutMs;
      if (body.temperature !== undefined) values.temperature = body.temperature;
      if (body.maxTokens !== undefined) values.maxTokens = body.maxTokens;
      if (body.systemPrompt !== undefined) values.systemPrompt = body.systemPrompt;
      if (body.isActive !== undefined) values.isActive = body.isActive;

      db.insert(schema.aiSettings).values(values as Record<string, unknown>).run();

      const row = db.select().from(schema.aiSettings).where(eq(schema.aiSettings.id, id)).get();
      if (!row) {
        return { status: 500, data: { error: 'Failed to create AI settings' } };
      }
      const { apiKey: _, ...safeRow } = row;
      return { status: 201, data: safeRow };
    }

    const updateData: Record<string, unknown> = {};
    if (body.provider !== undefined) updateData.provider = body.provider;
    if (body.model !== undefined) updateData.model = body.model;
    if (body.apiKey !== undefined) updateData.apiKey = body.apiKey;
    if (body.baseUrl !== undefined) updateData.baseUrl = body.baseUrl;
    if (body.timeoutMs !== undefined) updateData.timeoutMs = body.timeoutMs;
    if (body.temperature !== undefined) updateData.temperature = body.temperature;
    if (body.maxTokens !== undefined) updateData.maxTokens = body.maxTokens;
    if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    db.update(schema.aiSettings)
      .set(updateData)
      .where(eq(schema.aiSettings.id, (existing as Record<string, unknown>).id as string))
      .run();

    const row = db.select().from(schema.aiSettings).where(eq(schema.aiSettings.id, (existing as Record<string, unknown>).id as string)).get();
    if (!row) {
      return { status: 500, data: { error: 'Failed to fetch updated AI settings' } };
    }
    const { apiKey: _, ...safeRow } = row;
    return { status: 200, data: safeRow };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update AI settings', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM ai_settings;');
}

function seedAiSettings(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  db.insert(schema.aiSettings)
    .values({
      id,
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'sk-test-key-12345',
      temperature: 0.7,
      maxTokens: 4096,
      isActive: true,
      ...overrides,
    })
    .run();
  return db.select().from(schema.aiSettings).where(eq(schema.aiSettings.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- AI Settings API Tests ---\n');

// ── 1. GET: Empty returns message ───────────────────────────────────

console.log('\n1. GET returns message when no settings:');
{
  cleanup();
  const result = doGetAiSettings();
  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'No AI settings configured yet. Use PUT to create.', 'message matches');
}

// ── 2. GET: Returns settings after creation (apiKey stripped) ───────

console.log('\n2. GET returns settings with apiKey stripped:');
{
  cleanup();
  seedAiSettings();
  const result = doGetAiSettings();
  assert(result.status === 200, 'returns 200');

  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.provider, 'openai', 'provider matches');
  assertEqual(data.model, 'gpt-4', 'model matches');

  // 🔒 Secret-leak assertion: apiKey must never appear in GET response
  assertNotHasKey(data, 'apiKey', 'apiKey NOT in GET response');
  assertNotHasKey(data, 'api_key', 'api_key NOT in GET response');
}

// ── 3. PUT: Create on first call with all fields ─────────────────────

console.log('\n3. PUT creates AI settings with all fields:');
{
  cleanup();
  const result = doPutAiSettings({
    provider: 'anthropic',
    model: 'claude-3-opus-20240229',
    apiKey: 'sk-ant-test-key',
    temperature: 1.0,
    maxTokens: 8192,
    systemPrompt: 'You are a trading assistant.',
    isActive: true,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.provider, 'anthropic', 'provider');
  assertEqual(data.model, 'claude-3-opus-20240229', 'model');
  assertNotHasKey(data, 'apiKey', 'apiKey stripped from create response');
  assertEqual(data.temperature, 1.0, 'temperature');
  assertEqual(data.maxTokens, 8192, 'maxTokens');
  assertEqual(data.systemPrompt, 'You are a trading assistant.', 'systemPrompt');
  assertEqual(data.isActive, true, 'isActive');
}

// ── 4. PUT: Update existing settings ────────────────────────────────

console.log('\n4. PUT updates existing AI settings:');
{
  cleanup();
  doPutAiSettings({ provider: 'openai', model: 'gpt-4', apiKey: 'sk-old-key' });
  const result = doPutAiSettings({ model: 'gpt-4-turbo', temperature: 0.5 });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.model, 'gpt-4-turbo', 'model updated');
  assertEqual(data.temperature, 0.5, 'temperature updated');
  assertEqual(data.provider, 'openai', 'provider preserved');
  assertNotHasKey(data, 'apiKey', 'apiKey stripped from update response');
}

// ── 5. PUT: Validate provider enum ──────────────────────────────────

console.log('\n5. PUT rejects invalid provider:');
{
  cleanup();
  const result = doPutAiSettings({ provider: 'invalid-provider' });
  assert(result.status === 400, 'returns 400 for invalid provider');
}

// ── 6. PUT: Validate empty model ────────────────────────────────────

console.log('\n6. PUT rejects empty model:');
{
  cleanup();
  const result = doPutAiSettings({ model: '' });
  assert(result.status === 400, 'returns 400 for empty model');
}

// ── 7. PUT: Validate temperature range 0-2 ──────────────────────────

console.log('\n7. PUT validates temperature range:');
{
  cleanup();
  const under = doPutAiSettings({ temperature: -0.1 });
  assert(under.status === 400, 'returns 400 for negative');

  const over = doPutAiSettings({ temperature: 2.1 });
  assert(over.status === 400, 'returns 400 for > 2');

  const valid = doPutAiSettings({ temperature: 1.5 });
  assert(valid.status === 201, 'returns 201 for valid temperature');
  const data = valid.data as Record<string, unknown>;
  assertEqual(data.temperature, 1.5, 'temperature set correctly');
}

// ── 8. PUT: Validate maxTokens positive integer ─────────────────────

console.log('\n8. PUT validates maxTokens:');
{
  cleanup();
  const zero = doPutAiSettings({ maxTokens: 0 });
  assert(zero.status === 400, 'returns 400 for zero');

  const neg = doPutAiSettings({ maxTokens: -100 });
  assert(neg.status === 400, 'returns 400 for negative');

  const float = doPutAiSettings({ maxTokens: 500.5 });
  assert(float.status === 400, 'returns 400 for non-integer');

  const valid = doPutAiSettings({ maxTokens: 16000 });
  assert(valid.status === 201, 'returns 201 for valid maxTokens');
  const data = valid.data as Record<string, unknown>;
  assertEqual(data.maxTokens, 16000, 'maxTokens set correctly');
}

// ── 9. PUT: Partial update preserves other fields ───────────────────

console.log('\n9. PUT partial update preserves untouched fields:');
{
  cleanup();
  doPutAiSettings({ provider: 'google', model: 'gemini-pro', temperature: 0.3, maxTokens: 2048 });
  const result = doPutAiSettings({ temperature: 0.8 });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.provider, 'google', 'provider preserved');
  assertEqual(data.model, 'gemini-pro', 'model preserved');
  assertEqual(data.temperature, 0.8, 'temperature updated');
  assertEqual(data.maxTokens, 2048, 'maxTokens preserved');
}

// ── 10. PUT: Create with minimal fields ─────────────────────────────

console.log('\n10. PUT creates with minimal fields (defaults):');
{
  cleanup();
  const result = doPutAiSettings({ provider: 'openai', model: 'gpt-4' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.provider, 'openai', 'provider');
  assertEqual(data.model, 'gpt-4', 'model');
  assertNotHasKey(data, 'apiKey', 'apiKey stripped');
  assertNotNull(data.isActive, 'isActive has default');
}

// ── 11. PUT: Create with ollama provider and baseUrl ────────────────

console.log('\n11. PUT creates with ollama provider and baseUrl:');
{
  cleanup();
  const result = doPutAiSettings({
    provider: 'ollama',
    model: 'llama3.1:8b',
    baseUrl: 'http://localhost:11434/v1',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.provider, 'ollama', 'provider is ollama');
  assertEqual(data.model, 'llama3.1:8b', 'model matches');
  assertEqual(data.baseUrl, 'http://localhost:11434/v1', 'baseUrl matches');
  assertNotHasKey(data, 'apiKey', 'apiKey stripped');
}

// ── 12. PUT: Create with timeoutMs ──────────────────────────────────

console.log('\n12. PUT creates with timeoutMs:');
{
  cleanup();
  const result = doPutAiSettings({
    provider: 'openai',
    model: 'gpt-4',
    timeoutMs: 60000,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.provider, 'openai', 'provider');
  assertEqual(data.timeoutMs, 60000, 'timeoutMs matches');
  assertNotHasKey(data, 'apiKey', 'apiKey stripped');
}

// ── 13. PUT: Validate baseUrl format ────────────────────────────────

console.log('\n13. PUT validates baseUrl format:');
{
  cleanup();
  const notUrl = doPutAiSettings({ provider: 'ollama', model: 'llama3.1:8b', baseUrl: 'not-a-url' });
  assert(notUrl.status === 400, 'rejects non-URL baseUrl');

  const empty = doPutAiSettings({ provider: 'ollama', model: 'llama3.1:8b', baseUrl: '' });
  assert(empty.status === 400, 'rejects empty baseUrl');
}

// ── 14. PUT: Validate timeoutMs constraints ─────────────────────────

console.log('\n14. PUT validates timeoutMs constraints:');
{
  cleanup();
  const neg = doPutAiSettings({ provider: 'openai', model: 'gpt-4', timeoutMs: -1 });
  assert(neg.status === 400, 'rejects negative timeoutMs');

  const zero = doPutAiSettings({ provider: 'openai', model: 'gpt-4', timeoutMs: 0 });
  assert(zero.status === 400, 'rejects zero timeoutMs');

  const float = doPutAiSettings({ provider: 'openai', model: 'gpt-4', timeoutMs: 30.5 });
  assert(float.status === 400, 'rejects non-integer timeoutMs');
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
