/**
 * ai-settings-integration.test.ts
 *
 * Integration test: ai-settings API response feeds into createAiProvider factory.
 *
 * Verifies the critical integration point that S04's assessment engine depends on:
 * reading ai_settings from the DB (via the GET route handler), transforming it
 * into AiProviderConfig shape, and passing it to createAiProvider().
 *
 * Uses in-memory SQLite with the real route handlers and the real ai-provider
 * factory (with openai SDK mocked to prevent real network calls).
 *
 * Run: npx vitest run src/lib/__tests__/ai-settings-integration.test.ts --reporter verbose
 */

import { vi, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

// ── Hoisted: in-memory SQLite DB + table creation ───────────────────

const testCtx = vi.hoisted(() => {
  const Database = require('better-sqlite3');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF');

  sqlite.exec(`
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
  `);

  return { sqlite };
});

// ── Module-level mocks ──────────────────────────────────────────────
// Mock @/db to use the in-memory SQLite database.
vi.mock('@/db', () => {
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const db = drizzle(testCtx.sqlite);
  return {
    db,
    getSqliteHandle: () => testCtx.sqlite,
    initializeDatabase: () => db,
  };
});

// Mock openai SDK to prevent real network calls.
// Uses the same pattern as ai-provider.test.ts — match class names so
// instanceof checks work inside createAiProvider.
const mockCreate = vi.fn();
vi.mock('openai', () => {
  class AuthError extends Error {
    status: number;
    constructor(status: number, _error: any, message: string, _headers?: Headers) {
      super(message);
      this.name = 'AuthenticationError';
      this.status = status;
    }
  }

  class ConnError extends Error {
    constructor(opts?: { message?: string; cause?: Error }) {
      super(opts?.message ?? 'Connection error.');
      this.name = 'APIConnectionError';
    }
  }

  class ConnTimeoutError extends Error {
    constructor(opts?: { message?: string }) {
      super(opts?.message ?? 'Request timed out.');
      this.name = 'APIConnectionTimeoutError';
    }
  }

  class GenAPIError extends Error {
    status: number;
    constructor(status: number, _error: any, message: string, _headers?: Headers) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }

  const MockOpenAI = vi.fn(function () {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  });

  return {
    default: MockOpenAI,
    AuthenticationError: AuthError,
    APIConnectionError: ConnError,
    APIConnectionTimeoutError: ConnTimeoutError,
    APIError: GenAPIError,
  };
});

// ── DB helpers ──────────────────────────────────────────────────────

const sqlite = testCtx.sqlite;

function cleanup() {
  sqlite.exec('DELETE FROM ai_settings;');
}

function seedSettings(overrides: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const provider = (overrides.provider as string) ?? 'openai';
  const model = (overrides.model as string) ?? 'gpt-4o';
  const apiKey = (overrides.apiKey as string) ?? 'sk-test-integration-key';
  const isActive = overrides.isActive !== undefined ? (overrides.isActive ? 1 : 0) : 1;
  const timeoutMs = overrides.timeoutMs !== undefined ? overrides.timeoutMs : 30000;
  const temperature = overrides.temperature !== undefined ? overrides.temperature : 0.7;
  const maxTokens = overrides.maxTokens !== undefined ? overrides.maxTokens : 4096;
  const baseUrl = overrides.baseUrl !== undefined ? `'${overrides.baseUrl}'` : 'NULL';

  sqlite.exec(
    `INSERT INTO ai_settings (id, provider, model, api_key, is_active, timeout_ms, temperature, max_tokens, base_url, created_at, updated_at) ` +
    `VALUES ('${id}', '${provider}', '${model}', '${apiKey}', ${isActive}, ${timeoutMs}, ${temperature}, ${maxTokens}, ${baseUrl}, '${now}', '${now}')`
  );
  return id;
}

function readSettingsRow(id: string): Record<string, unknown> | undefined {
  const row = sqlite.prepare('SELECT * FROM ai_settings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row;
}

// ── Assertion helpers ───────────────────────────────────────────────

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

// ── Simulated route helpers ─────────────────────────────────────────

// Import the real route handlers dynamically so they use the mocked @/db
let routeModule: { GET: () => Promise<Response>; PUT: (req: NextRequest) => Promise<Response> };

async function loadRoute() {
  if (!routeModule) {
    routeModule = await import('@/app/api/ai-settings/route');
  }
  return routeModule;
}

/**
 * Simulate GET /api/ai-settings — returns { config, fetchedViaApi: true }
 * so the test can distinguish integration-sourced config from test fixtures.
 */
async function getConfigFromApi() {
  const { GET } = await loadRoute();
  const response = await GET();
  const data = await response.json();
  return { status: response.status, data };
}

/**
 * Simulate what readActiveAiConfig() does: query DB for active settings
 * and build AiProviderConfig. This mirrors the actual logic in
 * assessment-engine.ts to prove the integration point.
 */
import { createAiProvider, type AiProviderConfig } from '../ai-provider';

function buildActiveConfigFromDb(): AiProviderConfig | null {
  const row = sqlite.prepare('SELECT * FROM ai_settings WHERE is_active = 1').get() as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    provider: row.provider as string,
    model: row.model as string,
    apiKey: (row.api_key as string) ?? undefined,
    baseUrl: (row.base_url as string) ?? undefined,
    timeoutMs: (row.timeout_ms as number) ?? undefined,
    temperature: (row.temperature as number) ?? undefined,
    maxTokens: (row.max_tokens as number) ?? undefined,
  };
}

/**
 * Simulate what a consumer would do: read settings from the API (which strips apiKey),
 * then fetch the apiKey separately from the DB, combine them into AiProviderConfig,
 * and create the provider.
 */
function buildConfigFromApiResponse(apiData: Record<string, unknown>): AiProviderConfig {
  // apiData has no apiKey — the consumer must supply it from the DB
  const row = sqlite.prepare('SELECT id, api_key FROM ai_settings WHERE id = ?').get(apiData.id as string) as Record<string, unknown> | undefined;

  return {
    provider: apiData.provider as string,
    model: apiData.model as string,
    apiKey: row?.api_key as string ?? undefined,
    baseUrl: (apiData.baseUrl as string) ?? (apiData.base_url as string) ?? undefined,
    timeoutMs: (apiData.timeoutMs as number) ?? (apiData.timeout_ms as number) ?? undefined,
    temperature: (apiData.temperature as number) ?? undefined,
    maxTokens: (apiData.maxTokens as number) ?? (apiData.max_tokens as number) ?? undefined,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

test('AI Settings Integration — API response feeds into createAiProvider factory', async () => {

console.log('\n=== Integration: AI Settings → API → createAiProvider ===\n');

// ── 1. GET returns settings without apiKey ──────────────────────────

console.log('\n1. GET returns settings without apiKey field:');
{
  cleanup();
  vi.clearAllMocks();
  const seedId = seedSettings();

  const { status, data } = await getConfigFromApi();
  assertEqual(status, 200, 'GET returns 200');
  assertNotNull(data, 'GET returns data');
  assertEqual(data.id, seedId, 'settings id matches');
  assertEqual(data.provider, 'openai', 'provider is openai');
  assertEqual(data.model, 'gpt-4o', 'model is gpt-4o');
  assertEqual(data.isActive, true, 'isActive is true');

  // apiKey must never be in the API response
  assert(!('apiKey' in data), 'apiKey not in GET response (camelCase)');
  assert(!('api_key' in data), 'api_key not in GET response (snake_case)');
  assert(!JSON.stringify(data).includes('sk-test-integration-key'), 'secret not leaked in GET response');
}

// ── 2. API response (without apiKey) + DB apiKey → createAiProvider ────

console.log('\n2. API response combined with DB apiKey creates a valid provider:');
{
  cleanup();
  vi.clearAllMocks();
  seedSettings();

  const { data } = await getConfigFromApi();

  // Build config from API response + DB apiKey
  const config = buildConfigFromApiResponse(data);
  assertEqual(config.provider, 'openai', 'provider from API response');
  assertEqual(config.model, 'gpt-4o', 'model from API response');
  assertEqual(config.apiKey, 'sk-test-integration-key', 'apiKey from DB (not in API response)');
  assertEqual(config.timeoutMs, 30000, 'timeoutMs from API response');
  assertEqual(config.temperature, 0.7, 'temperature from API response');
  assertEqual(config.maxTokens, 4096, 'maxTokens from API response');

  // Now create the provider — this should succeed without errors
  const provider = createAiProvider(config);
  assertNotNull(provider, 'provider created successfully');
  assertEqual(typeof provider.getCompletion, 'function', 'provider has getCompletion method');

  // Verify the mock was called (openai SDK was instantiated)
  const { default: MockOpenAI } = await import('openai');
  const mockFn = MockOpenAI as unknown as ReturnType<typeof vi.fn>;
  assert(mockFn.mock.calls.length > 0, 'OpenAI client was instantiated');
  const openAICall = mockFn.mock.calls[0][0] || {};
  assertEqual(openAICall.baseURL?.includes('api.openai.com'), true, 'baseURL is OpenAI endpoint');
  assertEqual(openAICall.apiKey, 'sk-test-integration-key', 'apiKey passed to OpenAI client');
  assertEqual(openAICall.timeout, 30000, 'timeout passed to OpenAI client');
  assertEqual(openAICall.maxRetries, 0, 'maxRetries is 0');
}

// ── 3. isActive=false settings still readable via API, not from readActiveAiConfig ──

console.log('\n3. isActive=false settings appear in GET but not in active config:');
{
  cleanup();
  vi.clearAllMocks();
  // Seed an inactive setting
  seedSettings({ isActive: false });

  // GET should still return it
  const { status, data } = await getConfigFromApi();
  assertEqual(status, 200, 'GET returns 200 for inactive settings');
  assertEqual(data.isActive, false, 'isActive is false in response');

  // readActiveAiConfig equivalent should return null (because isActive=false)
  const activeConfig = buildActiveConfigFromDb();
  assertEqual(activeConfig, null, 'buildActiveConfigFromDb returns null when no active settings');
}

// ── 4. Multiple settings rows: GET returns first, active filter works ───

console.log('\n4. Multiple rows: GET returns first row, active filter returns active one:');
{
  cleanup();
  vi.clearAllMocks();

  // Seed inactive first
  seedSettings({ provider: 'ollama', model: 'llama2', apiKey: '', isActive: false });
  // Seed active second
  seedSettings({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-active-key', isActive: true });

  // GET returns the first row (could be inactive)
  const { data } = await getConfigFromApi();
  // Note: the API returns db.select().from(aiSettings).limit(1).get() which is
  // the first row inserted (ollama, inactive). This is the current API behavior.
  // The consumer needs to use readActiveAiConfig() or filter by isActive.
  assert(data.id !== undefined, 'GET returns a row');
  assertEqual(data.provider, 'ollama', 'GET returns first row (ollama, inactive)');

  // The active config should find the active row
  const activeConfig = buildActiveConfigFromDb();
  assertNotNull(activeConfig, 'active config found');
  assertEqual(activeConfig!.provider, 'openai', 'active config returns openai');
  assertEqual(activeConfig!.apiKey, 'sk-active-key', 'active config has correct apiKey');

  // Verify active config can create a provider
  const provider = createAiProvider(activeConfig!);
  assertNotNull(provider, 'provider from active config created successfully');
  assertEqual(typeof provider.getCompletion, 'function', 'provider has getCompletion');
}

// ── 5. Ollama provider integration ─────────────────────────────────────

console.log('\n5. Ollama settings: no apiKey needed, custom baseURL, provider created:');
{
  cleanup();
  vi.clearAllMocks();
  seedSettings({
    provider: 'ollama',
    model: 'llama3.1:8b',
    apiKey: '',
    baseUrl: 'http://localhost:11434/v1',
    timeoutMs: 60000,
    temperature: 0.0,
    maxTokens: 2048,
    isActive: true,
  });

  // Read via API
  const { data } = await getConfigFromApi();
  assertEqual(data.provider, 'ollama', 'provider is ollama');
  assertEqual(data.model, 'llama3.1:8b', 'model is llama3.1:8b');
  assert(!('apiKey' in data), 'apiKey not in GET response for ollama');

  // Build config from API response + DB
  const config = buildConfigFromApiResponse(data);
  assertEqual(config.provider, 'ollama', 'config provider is ollama');
  assertEqual(config.apiKey, '', 'ollama apiKey is empty string');
  assertEqual(config.baseUrl, 'http://localhost:11434/v1', 'config baseUrl matches');
  assertEqual(config.timeoutMs, 60000, 'config timeoutMs matches');
  assertEqual(config.temperature, 0.0, 'config temperature matches');
  assertEqual(config.maxTokens, 2048, 'config maxTokens matches');

  // Ollama should work with empty apiKey (factory defaults to 'ollama')
  const provider = createAiProvider(config);
  assertNotNull(provider, 'ollama provider created successfully');

  // Verify OpenAI client was instantiated with ollama defaults
  const { default: MockOpenAI } = await import('openai');
  const mockFn = MockOpenAI as unknown as ReturnType<typeof vi.fn>;
  const openAICall = mockFn.mock.calls[0][0] || {};
  assertEqual(openAICall.apiKey, 'ollama', 'ollama apiKey defaults to "ollama"');
  assertEqual(openAICall.baseURL, 'http://localhost:11434/v1', 'ollama baseURL passed to client');
  assertEqual(openAICall.timeout, 60000, 'ollama timeout passed to client');
}

// ── 6. Custom provider with explicit baseUrl ────────────────────────────

console.log('\n6. Custom provider with explicit baseUrl and apiKey:');
{
  cleanup();
  vi.clearAllMocks();
  seedSettings({
    provider: 'custom',
    model: 'my-model',
    apiKey: 'sk-custom-key',
    baseUrl: 'https://my-proxy.example.com/v1',
    timeoutMs: 15000,
    isActive: true,
  });

  const { data } = await getConfigFromApi();
  assertEqual(data.provider, 'custom', 'provider is custom');
  assertEqual(data.model, 'my-model', 'model matches');
  assertEqual(data.baseUrl, 'https://my-proxy.example.com/v1', 'baseUrl in API response');

  const config = buildConfigFromApiResponse(data);
  assertEqual(config.provider, 'custom', 'config provider is custom');
  assertEqual(config.apiKey, 'sk-custom-key', 'config apiKey from DB');

  const provider = createAiProvider(config);
  assertNotNull(provider, 'custom provider created');

  const { default: MockOpenAI } = await import('openai');
  const mockFn = MockOpenAI as unknown as ReturnType<typeof vi.fn>;
  const openAICall = mockFn.mock.calls[0][0] || {};
  assertEqual(openAICall.baseURL, 'https://my-proxy.example.com/v1', 'custom baseURL passed');
  assertEqual(openAICall.apiKey, 'sk-custom-key', 'custom apiKey passed');
  assertEqual(openAICall.timeout, 15000, 'custom timeout passed');
}

// ── 7. No settings configured ──────────────────────────────────────────

console.log('\n7. No settings returns 200 with message, no provider can be created:');
{
  cleanup();
  vi.clearAllMocks();

  const { status, data } = await getConfigFromApi();
  assertEqual(status, 200, 'GET returns 200 even with no settings');
  assertEqual(data.message, 'No AI settings configured yet. Use PUT to create.', 'message shown');

  const config = buildActiveConfigFromDb();
  assertEqual(config, null, 'no active config when no settings exist');
}

// ── 8. PUT then GET round-trip ──────────────────────────────────────────

console.log('\n8. PUT creates settings, GET reads them, createAiProvider works:');
{
  cleanup();
  vi.clearAllMocks();

  // PUT to create settings
  const { PUT } = await loadRoute();
  const putResponse = await PUT(
    new NextRequest('http://localhost/api/ai-settings', {
      method: 'PUT',
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4-turbo',
        apiKey: 'sk-roundtrip-key',
        timeoutMs: 45000,
        temperature: 0.5,
        isActive: true,
      }),
    }),
  );
  assertEqual(putResponse.status, 201, 'PUT returns 201');

  const putData = await putResponse.json();
  assertEqual(putData.provider, 'openai', 'PUT response provider matches');
  assertEqual(putData.model, 'gpt-4-turbo', 'PUT response model matches');
  assertEqual(putData.timeoutMs, 45000, 'PUT response timeoutMs matches');
  assertEqual(putData.temperature, 0.5, 'PUT response temperature matches');
  assertEqual(putData.isActive, true, 'PUT response isActive matches');
  assert(!('apiKey' in putData), 'apiKey not in PUT response');
  assert(!('api_key' in putData), 'api_key not in PUT response');

  // Now GET to read it back
  const getResult = await getConfigFromApi();
  assertEqual(getResult.status, 200, 'GET returns 200 after PUT');
  assertEqual(getResult.data.model, 'gpt-4-turbo', 'GET model matches PUT');
  assertEqual(getResult.data.timeoutMs, 45000, 'GET timeoutMs matches PUT');

  // Build config from API response + DB apiKey, create provider
  const config = buildConfigFromApiResponse(getResult.data);
  assertEqual(config.apiKey, 'sk-roundtrip-key', 'apiKey from DB matches PUT');

  const provider = createAiProvider(config);
  assertNotNull(provider, 'provider created after PUT->GET round-trip');
  assertEqual(typeof provider.getCompletion, 'function', 'provider functional');

  // Verify apiKey field never appears in any API response
  const allResponses = JSON.stringify(putData) + JSON.stringify(getResult.data);
  assert(!allResponses.includes('sk-roundtrip-key'), 'apiKey secret not leaked in any API response');
  assert(!allResponses.includes('"apiKey"'), 'apiKey field not present in any API response');
  assert(!allResponses.includes('"api_key"'), 'api_key field not present in any API response');
}

// ── 9. isActive toggle via PUT then readActiveAiConfig ─────────────────

console.log('\n9. PUT toggles isActive, readActiveAiConfig reflects the change:');
{
  cleanup();
  vi.clearAllMocks();

  // Create settings with isActive=false
  seedSettings({ isActive: false });
  let activeConfig = buildActiveConfigFromDb();
  assertEqual(activeConfig, null, 'no active config when isActive=false');

  // PUT to toggle isActive to true
  const { PUT } = await loadRoute();
  const putResponse = await PUT(
    new NextRequest('http://localhost/api/ai-settings', {
      method: 'PUT',
      body: JSON.stringify({ isActive: true }),
    }),
  );
  assertEqual(putResponse.status, 200, 'PUT returns 200 for update');

  const putData = await putResponse.json();
  assertEqual(putData.isActive, true, 'isActive is true after PUT toggle');

  // Now readActiveAiConfig should find it
  activeConfig = buildActiveConfigFromDb();
  assertNotNull(activeConfig, 'active config exists after toggling isActive');
  assertEqual(activeConfig!.provider, 'openai', 'active config provider matches');
  assertEqual(activeConfig!.model, 'gpt-4o', 'active config model matches');

  // Provider should work
  const provider = createAiProvider(activeConfig!);
  assertNotNull(provider, 'provider created after isActive toggle');
}

// ── 10. Mongoose-style: consumer (like S04) reads API then creates provider ──

console.log('\n10. Consumer flow: read GET /api/ai-settings → createAiProvider:');
{
  cleanup();
  vi.clearAllMocks();
  seedSettings({
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-consumer-flow-key',
    timeoutMs: 60000,
    temperature: 0.3,
    maxTokens: 8192,
    isActive: true,
  });

  // Step 1: Consumer reads GET /api/ai-settings to get config (sans apiKey)
  const { data: apiConfig } = await getConfigFromApi();

  // Step 2: Consumer fetches apiKey from DB (or secure store)
  const rawRow = readSettingsRow(apiConfig.id as string);
  assertNotNull(rawRow, 'raw DB row accessible');

  // Step 3: Consumer builds AiProviderConfig
  const config: AiProviderConfig = {
    provider: apiConfig.provider,
    model: apiConfig.model,
    apiKey: rawRow!.api_key as string,
    baseUrl: apiConfig.baseUrl ?? undefined,
    timeoutMs: apiConfig.timeoutMs ?? undefined,
    temperature: apiConfig.temperature ?? undefined,
    maxTokens: apiConfig.maxTokens ?? undefined,
  };

  assertEqual(config.provider, 'openai', 'consumer config provider');
  assertEqual(config.model, 'gpt-4o', 'consumer config model');
  assertEqual(config.apiKey, 'sk-consumer-flow-key', 'consumer config apiKey from DB');
  assertEqual(config.timeoutMs, 60000, 'consumer config timeoutMs');
  assertEqual(config.temperature, 0.3, 'consumer config temperature');

  // Step 4: Consumer creates provider and calls getCompletion
  const provider = createAiProvider(config);
  assertNotNull(provider, 'consumer provider created');

  mockCreate.mockResolvedValueOnce({
    id: 'chatcmpl-consumer-test',
    object: 'chat.completion',
    created: 1234567890,
    model: 'gpt-4o',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'Integration test works!' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  });

  const result = await provider.getCompletion([
    { role: 'user', content: 'Test message' },
  ]);

  assertEqual(result.content, 'Integration test works!', 'provider returns expected content');
  assertNotNull(result.usage, 'usage reported');
  assertEqual(result.usage!.promptTokens, 8, 'prompt tokens reported');
  assertEqual(result.usage!.completionTokens, 4, 'completion tokens reported');
}


console.log('\n=== Summary ===\n');

const total = passed + failed;
console.log(`${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
expect(failed).toBe(0);
if (failed === 0) {
  console.log('         All integration tests passed!\n');
}

});
