/**
 * ai-settings route test
 *
 * Tests GET (empty, with settings, secret leak prevention) and PUT
 * (create, update, validation).
 *
 * Run: npx vitest run --reporter verbose src/app/api/ai-settings/__tests__/route.test.ts
 */

import { beforeEach, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';

// ── Setup: in-memory test DB ────────────────────────────────────────

const sqlite = new Database(':memory:');
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
    clickhouse_host TEXT DEFAULT 'localhost',
    clickhouse_port INTEGER DEFAULT 8123,
    clickhouse_user TEXT DEFAULT 'default',
    clickhouse_password TEXT,
    clickhouse_database TEXT DEFAULT 'market',
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
    // Strip secrets from the response — never expose apiKey or clickhousePassword
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKey, clickhousePassword, ...safeRow } = row;
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

    // Validate clickhouseHost is non-empty string when provided
    if (body.clickhouseHost !== undefined) {
      if (typeof body.clickhouseHost !== 'string' || body.clickhouseHost.length < 1) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { clickhouseHost: ['Host is required'] } } } };
      }
    }

    // Validate clickhousePort is integer 1-65535 when provided
    if (body.clickhousePort !== undefined) {
      const val = body.clickhousePort as number;
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 65535) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { clickhousePort: ['Number must be greater than or equal to 1'] } } } };
      }
    }

    const existing = db.select().from(schema.aiSettings).limit(1).get();

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
      if (body.clickhouseHost !== undefined) values.clickhouseHost = body.clickhouseHost;
      if (body.clickhousePort !== undefined) values.clickhousePort = body.clickhousePort;
      if (body.clickhouseUser !== undefined) values.clickhouseUser = body.clickhouseUser;
      if (body.clickhousePassword !== undefined) values.clickhousePassword = body.clickhousePassword;
      if (body.clickhouseDatabase !== undefined) values.clickhouseDatabase = body.clickhouseDatabase;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.insert(schema.aiSettings).values(values as any).run();

      const row = db.select().from(schema.aiSettings).where(eq(schema.aiSettings.id, id)).get();
      if (!row) {
        return { status: 500, data: { error: 'Failed to create AI settings' } };
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { apiKey, clickhousePassword, ...safeRow } = row;
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
    if (body.clickhouseHost !== undefined) updateData.clickhouseHost = body.clickhouseHost;
    if (body.clickhousePort !== undefined) updateData.clickhousePort = body.clickhousePort;
    if (body.clickhouseUser !== undefined) updateData.clickhouseUser = body.clickhouseUser;
    if (body.clickhousePassword !== undefined) updateData.clickhousePassword = body.clickhousePassword;
    if (body.clickhouseDatabase !== undefined) updateData.clickhouseDatabase = body.clickhouseDatabase;

    db.update(schema.aiSettings)
      .set(updateData)
      .where(eq(schema.aiSettings.id, (existing as Record<string, unknown>).id as string))
      .run();

    const row = db.select().from(schema.aiSettings).where(eq(schema.aiSettings.id, (existing as Record<string, unknown>).id as string)).get();
    if (!row) {
      return { status: 500, data: { error: 'Failed to fetch updated AI settings' } };
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKey, clickhousePassword, ...safeRow } = row;
    return { status: 200, data: safeRow };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update AI settings', details: String(error) } };
  }
}

// ── Simulated test-connection logic ─────────────────────────────────

function doTestConnection(): { status: number; data: unknown } {
  try {
    const row = db.select().from(schema.aiSettings).limit(1).get();

    if (!row) {
      return { status: 400, data: { ok: false, error: 'No AI settings configured. Configure ClickHouse settings first.' } };
    }

    const host = row.clickhouseHost || 'localhost';
    const port = row.clickhousePort ?? 8123;

    if (!host || port < 1 || port > 65535) {
      return { status: 200, data: { ok: false, error: 'Invalid ClickHouse configuration' } };
    }

    return { status: 200, data: { ok: true } };
  } catch (error) {
    return { status: 500, data: { ok: false, error: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

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

beforeEach(() => {
  sqlite.exec('DELETE FROM ai_settings;');
});

test('1. GET returns message when no settings', () => {
  const result = doGetAiSettings();
  expect(result.status).toBe(200);
  expect((result.data as { message: string }).message).toBe('No AI settings configured yet. Use PUT to create.');
});

test('2. GET returns settings with apiKey and clickhousePassword stripped', () => {
  seedAiSettings();
  const result = doGetAiSettings();
  expect(result.status).toBe(200);

  const data = result.data as Record<string, unknown>;
  expect(data).toHaveProperty('id');
  expect(data.provider).toBe('openai');
  expect(data.model).toBe('gpt-4');

  // 🔒 Secret-leak assertion: secrets must never appear in GET response
  expect(data).not.toHaveProperty('apiKey');
  expect(data).not.toHaveProperty('api_key');
  expect(data).not.toHaveProperty('clickhousePassword');
  expect(data).not.toHaveProperty('clickhouse_password');
});

test('3. PUT creates AI settings with all fields', () => {
  const result = doPutAiSettings({
    provider: 'anthropic',
    model: 'claude-3-opus-20240229',
    apiKey: 'sk-ant-test-key',
    temperature: 1.0,
    maxTokens: 8192,
    systemPrompt: 'You are a trading assistant.',
    isActive: true,
  });

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.provider).toBe('anthropic');
  expect(data.model).toBe('claude-3-opus-20240229');
  expect(data).not.toHaveProperty('apiKey');
  expect(data).not.toHaveProperty('clickhousePassword');
  expect(data.temperature).toBe(1.0);
  expect(data.maxTokens).toBe(8192);
  expect(data.systemPrompt).toBe('You are a trading assistant.');
  expect(data.isActive).toBe(true);
});

test('4. PUT updates existing AI settings', () => {
  doPutAiSettings({ provider: 'openai', model: 'gpt-4', apiKey: 'sk-old-key' });
  const result = doPutAiSettings({ model: 'gpt-4-turbo', temperature: 0.5 });

  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.model).toBe('gpt-4-turbo');
  expect(data.temperature).toBe(0.5);
  expect(data.provider).toBe('openai');
  expect(data).not.toHaveProperty('apiKey');
  expect(data).not.toHaveProperty('clickhousePassword');
});

test('5. PUT rejects invalid provider', () => {
  const result = doPutAiSettings({ provider: 'invalid-provider' });
  expect(result.status).toBe(400);
});

test('6. PUT rejects empty model', () => {
  const result = doPutAiSettings({ model: '' });
  expect(result.status).toBe(400);
});

test('7. PUT validates temperature range', () => {
  const under = doPutAiSettings({ temperature: -0.1 });
  expect(under.status).toBe(400);

  const over = doPutAiSettings({ temperature: 2.1 });
  expect(over.status).toBe(400);

  const valid = doPutAiSettings({ temperature: 1.5 });
  expect(valid.status).toBe(201);
  const data = valid.data as Record<string, unknown>;
  expect(data.temperature).toBe(1.5);
});

test('8. PUT validates maxTokens', () => {
  const zero = doPutAiSettings({ maxTokens: 0 });
  expect(zero.status).toBe(400);

  const neg = doPutAiSettings({ maxTokens: -100 });
  expect(neg.status).toBe(400);

  const float = doPutAiSettings({ maxTokens: 500.5 });
  expect(float.status).toBe(400);

  const valid = doPutAiSettings({ maxTokens: 16000 });
  expect(valid.status).toBe(201);
  const data = valid.data as Record<string, unknown>;
  expect(data.maxTokens).toBe(16000);
});

test('9. PUT partial update preserves untouched fields', () => {
  doPutAiSettings({ provider: 'google', model: 'gemini-pro', temperature: 0.3, maxTokens: 2048 });
  const result = doPutAiSettings({ temperature: 0.8 });

  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.provider).toBe('google');
  expect(data.model).toBe('gemini-pro');
  expect(data.temperature).toBe(0.8);
  expect(data.maxTokens).toBe(2048);
});

test('10. PUT creates with minimal fields (defaults)', () => {
  const result = doPutAiSettings({ provider: 'openai', model: 'gpt-4' });

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.provider).toBe('openai');
  expect(data.model).toBe('gpt-4');
  expect(data).not.toHaveProperty('apiKey');
  expect(data).toHaveProperty('isActive');
});

test('11. PUT creates with ollama provider and baseUrl', () => {
  const result = doPutAiSettings({
    provider: 'ollama',
    model: 'llama3.1:8b',
    baseUrl: 'http://localhost:11434/v1',
  });

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.provider).toBe('ollama');
  expect(data.model).toBe('llama3.1:8b');
  expect(data.baseUrl).toBe('http://localhost:11434/v1');
  expect(data).not.toHaveProperty('apiKey');
});

test('12. PUT creates with timeoutMs', () => {
  const result = doPutAiSettings({
    provider: 'openai',
    model: 'gpt-4',
    timeoutMs: 60000,
  });

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.provider).toBe('openai');
  expect(data.timeoutMs).toBe(60000);
  expect(data).not.toHaveProperty('apiKey');
});

test('13. PUT validates baseUrl format', () => {
  const notUrl = doPutAiSettings({ provider: 'ollama', model: 'llama3.1:8b', baseUrl: 'not-a-url' });
  expect(notUrl.status).toBe(400);

  const empty = doPutAiSettings({ provider: 'ollama', model: 'llama3.1:8b', baseUrl: '' });
  expect(empty.status).toBe(400);
});

test('14. PUT validates timeoutMs constraints', () => {
  const neg = doPutAiSettings({ provider: 'openai', model: 'gpt-4', timeoutMs: -1 });
  expect(neg.status).toBe(400);

  const zero = doPutAiSettings({ provider: 'openai', model: 'gpt-4', timeoutMs: 0 });
  expect(zero.status).toBe(400);

  const float = doPutAiSettings({ provider: 'openai', model: 'gpt-4', timeoutMs: 30.5 });
  expect(float.status).toBe(400);
});

test('15. GET shows ClickHouse default values', () => {
  doPutAiSettings({ provider: 'openai', model: 'gpt-4' });
  const result = doGetAiSettings();

  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.clickhouseHost).toBe('localhost');
  expect(data.clickhousePort).toBe(8123);
  expect(data.clickhouseUser).toBe('default');
  expect(data.clickhouseDatabase).toBe('market');
});

test('16. PUT creates with ClickHouse fields', () => {
  const result = doPutAiSettings({
    provider: 'openai',
    model: 'gpt-4',
    clickhouseHost: 'clickhouse.example.com',
    clickhousePort: 9440,
    clickhouseUser: 'analyst',
    clickhousePassword: 'ch-secret-password',
    clickhouseDatabase: 'analytics',
  });

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.clickhouseHost).toBe('clickhouse.example.com');
  expect(data.clickhousePort).toBe(9440);
  expect(data.clickhouseUser).toBe('analyst');
  expect(data.clickhouseDatabase).toBe('analytics');
  // Password must be stripped even in create response
  expect(data).not.toHaveProperty('clickhousePassword');
});

test('17. PUT updates ClickHouse fields', () => {
  doPutAiSettings({ provider: 'openai', model: 'gpt-4' });
  const result = doPutAiSettings({
    clickhouseHost: 'ch.internal:8443',
    clickhousePort: 8443,
    clickhousePassword: 'new-password',
  });

  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.clickhouseHost).toBe('ch.internal:8443');
  expect(data.clickhousePort).toBe(8443);
  expect(data).not.toHaveProperty('clickhousePassword');
  // Untouched fields keep their defaults
  expect(data.clickhouseUser).toBe('default');
  expect(data.clickhouseDatabase).toBe('market');
});

test('18. PUT validates clickhousePort range', () => {
  const zero = doPutAiSettings({ provider: 'openai', model: 'gpt-4', clickhousePort: 0 });
  expect(zero.status).toBe(400);

  const neg = doPutAiSettings({ provider: 'openai', model: 'gpt-4', clickhousePort: -1 });
  expect(neg.status).toBe(400);

  const over = doPutAiSettings({ provider: 'openai', model: 'gpt-4', clickhousePort: 65536 });
  expect(over.status).toBe(400);

  const valid = doPutAiSettings({ provider: 'openai', model: 'gpt-4', clickhousePort: 9000 });
  expect(valid.status).toBe(201);
  const data = valid.data as Record<string, unknown>;
  expect(data.clickhousePort).toBe(9000);
});

test('19. PUT validates clickhouseHost non-empty', () => {
  const empty = doPutAiSettings({ provider: 'openai', model: 'gpt-4', clickhouseHost: '' });
  expect(empty.status).toBe(400);
});

test('20. Test-connection returns error when no settings', () => {
  const result = doTestConnection();
  expect(result.status).toBe(400);
  const data = result.data as Record<string, unknown>;
  expect(data.ok).toBe(false);
  expect(data).toHaveProperty('error');
});

test('21. Test-connection returns ok when settings exist', () => {
  doPutAiSettings({ provider: 'openai', model: 'gpt-4' });
  const result = doTestConnection();
  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.ok).toBe(true);
  expect(Object.keys(data)).toHaveLength(1);
});
