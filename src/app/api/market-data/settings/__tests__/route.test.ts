/**
 * market-data settings route test
 *
 * Tests the GET and PUT handlers for /api/market-data/settings.
 * Follows the same simulated-route pattern as ai-settings/__tests__/route.test.ts
 * — in-memory SQLite DB with local functions mirroring the route logic.
 *
 * Run: npx vitest run src/app/api/market-data/settings/__tests__/route.test.ts
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

// Create tables (only market_data_settings is needed)
sqlite.exec(`
  DROP TABLE IF EXISTS market_data_settings;
  CREATE TABLE market_data_settings (
    id TEXT PRIMARY KEY NOT NULL,
    active_provider TEXT NOT NULL DEFAULT 'clickhouse',
    providers TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route helpers ─────────────────────────────────────────

const SENSITIVE_FIELDS = new Set(['password']);

function stripProviderSecrets(
  providers: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [providerName, config] of Object.entries(providers)) {
    if (config && typeof config === 'object') {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
        if (!SENSITIVE_FIELDS.has(key)) {
          clean[key] = value;
        }
      }
      safe[providerName] = clean;
    } else {
      safe[providerName] = config;
    }
  }
  return safe;
}

function parseProviders(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function doGetMarketDataSettings(): { status: number; data: unknown } {
  try {
    const row = db.select().from(schema.marketDataSettings).limit(1).get();
    if (!row) {
      return {
        status: 200,
        data: { message: 'No market data settings configured yet. Use PUT to create.' },
      };
    }

    const providers = parseProviders(row.providers);
    const safeProviders = stripProviderSecrets(providers);

    return {
      status: 200,
      data: {
        id: row.id,
        activeProvider: row.activeProvider,
        providers: safeProviders,
      },
    };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch market data settings', details: String(error) } };
  }
}

function doPutMarketDataSettings(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // ── Validate providers is an object when provided ──
    if (body.providers !== undefined) {
      if (typeof body.providers !== 'object' || body.providers === null || Array.isArray(body.providers)) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { providers: ['Expected object, received array'] } } } };
      }
    }

    // ── Validate activeProvider is a non-empty string when provided ──
    if (body.activeProvider !== undefined) {
      if (typeof body.activeProvider !== 'string' || body.activeProvider.length < 1) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { activeProvider: ['activeProvider must be a non-empty string'] } } } };
      }
    }

    const existing = db.select().from(schema.marketDataSettings).limit(1).get();

    if (!existing) {
      // ── Create new row ──
      const id = randomUUID();
      const providers = body.providers ? JSON.stringify(body.providers) : '{}';
      const activeProvider = (typeof body.activeProvider === 'string' ? body.activeProvider : 'clickhouse');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.insert(schema.marketDataSettings).values({
        id,
        activeProvider,
        providers,
      } as any).run();

      const row = db.select().from(schema.marketDataSettings).where(eq(schema.marketDataSettings.id, id)).get();
      if (!row) {
        return { status: 500, data: { error: 'Failed to create market data settings' } };
      }

      const rowProviders = parseProviders(row.providers);
      return { status: 201, data: { id: row.id, activeProvider: row.activeProvider, providers: stripProviderSecrets(rowProviders) } };
    }

    // ── Update existing row ──
    const updateData: Record<string, unknown> = {};

    if (body.activeProvider !== undefined) {
      updateData.activeProvider = body.activeProvider;
    }

    if (body.providers !== undefined) {
      const existingProviders = parseProviders(existing.providers);
      const mergedProviders = {
        ...existingProviders,
        ...body.providers,
      } as Record<string, unknown>;
      updateData.providers = JSON.stringify(mergedProviders);
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = new Date().toISOString();

      db.update(schema.marketDataSettings)
        .set(updateData)
        .where(eq(schema.marketDataSettings.id, (existing as Record<string, unknown>).id as string))
        .run();
    }

    const row = db.select().from(schema.marketDataSettings).where(eq(schema.marketDataSettings.id, (existing as Record<string, unknown>).id as string)).get();
    if (!row) {
      return { status: 500, data: { error: 'Failed to fetch updated market data settings' } };
    }

    const rowProviders = parseProviders(row.providers);
    return { status: 200, data: { id: row.id, activeProvider: row.activeProvider, providers: stripProviderSecrets(rowProviders) } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update market data settings', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function seedDefaultSettings() {
  const id = randomUUID();
  db.insert(schema.marketDataSettings)
    .values({
      id,
      activeProvider: 'clickhouse',
      providers: JSON.stringify({
        clickhouse: {
          host: 'localhost',
          port: 8123,
          user: 'default',
          password: 'secret-clickhouse-pw',
          database: 'market',
        },
      }),
    })
    .run();
  return db.select().from(schema.marketDataSettings).where(eq(schema.marketDataSettings.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  sqlite.exec('DELETE FROM market_data_settings;');
});

// ── GET Tests ───────────────────────────────────────────────────────

test('1. GET returns message when no settings', () => {
  const result = doGetMarketDataSettings();
  expect(result.status).toBe(200);
  expect((result.data as { message: string }).message).toBe(
    'No market data settings configured yet. Use PUT to create.',
  );
});

test('2. GET returns settings with activeProvider and parsed providers', () => {
  seedDefaultSettings();
  const result = doGetMarketDataSettings();
  expect(result.status).toBe(200);

  const data = result.data as Record<string, unknown>;
  expect(data).toHaveProperty('id');
  expect(data.activeProvider).toBe('clickhouse');

  const providers = data.providers as Record<string, unknown>;
  expect(providers).toHaveProperty('clickhouse');

  const chConfig = providers.clickhouse as Record<string, unknown>;
  expect(chConfig.host).toBe('localhost');
  expect(chConfig.port).toBe(8123);
  expect(chConfig.user).toBe('default');
  expect(chConfig.database).toBe('market');

  // 🔒 Secret-leak assertion: passwords must never appear in GET response
  expect(chConfig).not.toHaveProperty('password');
});

test('3. GET returns empty providers when row has empty JSON', () => {
  const id = randomUUID();
  db.insert(schema.marketDataSettings)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values({ id, activeProvider: 'clickhouse', providers: '{}' } as any)
    .run();

  const result = doGetMarketDataSettings();
  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.providers).toEqual({});
});

// ── PUT Create Tests ────────────────────────────────────────────────

test('4. PUT creates market data settings with ClickHouse config', () => {
  const result = doPutMarketDataSettings({
    activeProvider: 'clickhouse',
    providers: {
      clickhouse: {
        host: 'clickhouse.example.com',
        port: 9440,
        user: 'analyst',
        password: 'ch-secret-password',
        database: 'analytics',
      },
    },
  });

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.activeProvider).toBe('clickhouse');

  const providers = data.providers as Record<string, unknown>;
  expect(providers).toHaveProperty('clickhouse');

  const chConfig = providers.clickhouse as Record<string, unknown>;
  expect(chConfig.host).toBe('clickhouse.example.com');
  expect(chConfig.port).toBe(9440);
  expect(chConfig.user).toBe('analyst');
  expect(chConfig.database).toBe('analytics');
  expect(chConfig).not.toHaveProperty('password');
});

test('5. PUT creates with minimal fields (defaults)', () => {
  const result = doPutMarketDataSettings({});

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.activeProvider).toBe('clickhouse');
  expect(data.providers).toEqual({});
});

test('6. PUT creates with only activeProvider', () => {
  const result = doPutMarketDataSettings({ activeProvider: 'schwab' });

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.activeProvider).toBe('schwab');
});

// ── PUT Update Tests ────────────────────────────────────────────────

test('7. PUT updates existing activeProvider', () => {
  doPutMarketDataSettings({ activeProvider: 'clickhouse' });
  const result = doPutMarketDataSettings({ activeProvider: 'schwab' });

  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.activeProvider).toBe('schwab');
});

test('8. PUT updates providers (merge)', () => {
  doPutMarketDataSettings({
    providers: {
      clickhouse: {
        host: 'old-host',
        port: 8123,
        user: 'default',
        database: 'market',
      },
    },
  });

  const result = doPutMarketDataSettings({
    providers: {
      clickhouse: {
        host: 'new-host',
        port: 9440,
        user: 'updated-user',
        database: 'market',
        password: 'new-password',
      },
    },
  });

  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  const providers = data.providers as Record<string, unknown>;
  const chConfig = providers.clickhouse as Record<string, unknown>;

  // Updated fields
  expect(chConfig.host).toBe('new-host');
  expect(chConfig.port).toBe(9440);
  expect(chConfig.user).toBe('updated-user');
  // Password must be stripped
  expect(chConfig).not.toHaveProperty('password');
  // Untouched fields preserved
  expect(chConfig.database).toBe('market');
});

test('9. PUT partial update preserves untouched fields', () => {
  doPutMarketDataSettings({
    activeProvider: 'clickhouse',
    providers: {
      clickhouse: {
        host: 'original-host',
        port: 8123,
        user: 'default',
        database: 'market',
      },
    },
  });

  // Update only activeProvider
  const result = doPutMarketDataSettings({ activeProvider: 'schwab' });

  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.activeProvider).toBe('schwab');
  // Providers should be unchanged
  const providers = data.providers as Record<string, unknown>;
  expect((providers.clickhouse as Record<string, unknown>).host).toBe('original-host');
});

test('10. PUT multiple updates preserve round-trip integrity', () => {
  // Create
  const createResult = doPutMarketDataSettings({
    activeProvider: 'clickhouse',
    providers: {
      clickhouse: {
        host: 'host-a',
        port: 8123,
        user: 'user-a',
        database: 'market',
      },
    },
  });
  expect(createResult.status).toBe(201);

  // Update providers (without password)
  const update1 = doPutMarketDataSettings({
    providers: {
      clickhouse: { host: 'host-b', port: 9000, user: 'user-b', database: 'prod' },
    },
  });
  expect(update1.status).toBe(200);
  expect(
    ((update1.data as Record<string, unknown>).providers as Record<string, unknown>).clickhouse,
  ).toEqual({ host: 'host-b', port: 9000, user: 'user-b', database: 'prod' });

  // Update activeProvider only
  const update2 = doPutMarketDataSettings({ activeProvider: 'schwab' });
  expect(update2.status).toBe(200);
  const data2 = update2.data as Record<string, unknown>;
  expect(data2.activeProvider).toBe('schwab');
  expect(
    ((data2.providers as Record<string, unknown>).clickhouse as Record<string, unknown>).host,
  ).toBe('host-b');
});

test('11. PUT with providers containing password is stripped on read', () => {
  const createResult = doPutMarketDataSettings({
    providers: {
      clickhouse: {
        host: 'secure-host',
        port: 8443,
        user: 'admin',
        password: 'super-secret',
        database: 'secure-db',
      },
    },
  });

  expect(createResult.status).toBe(201);
  const data = createResult.data as Record<string, unknown>;
  const chConfig = (data.providers as Record<string, unknown>).clickhouse as Record<string, unknown>;
  expect(chConfig.host).toBe('secure-host');
  expect(chConfig.port).toBe(8443);
  expect(chConfig).not.toHaveProperty('password');
});

// ── Validation Tests ────────────────────────────────────────────────

test('12. PUT rejects empty activeProvider', () => {
  const result = doPutMarketDataSettings({ activeProvider: '' });
  expect(result.status).toBe(400);
});

test('13. PUT rejects non-object providers', () => {
  const result = doPutMarketDataSettings({ providers: 'not-an-object' });
  expect(result.status).toBe(400);
});

test('14. PUT rejects array providers', () => {
  const result = doPutMarketDataSettings({ providers: [] });
  expect(result.status).toBe(400);
});

test('15. PUT with empty body creates defaults', () => {
  const result = doPutMarketDataSettings({});
  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  expect(data.activeProvider).toBe('clickhouse');
  expect(data.providers).toEqual({});
});

test('16. GET returns updated settings after PUT', () => {
  doPutMarketDataSettings({
    providers: {
      clickhouse: {
        host: 'ch.example.com',
        port: 8123,
        user: 'readonly',
        database: 'live',
        password: 'should-be-stripped',
      },
    },
  });

  const result = doGetMarketDataSettings();
  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  const chConfig = (data.providers as Record<string, unknown>).clickhouse as Record<string, unknown>;
  expect(chConfig.host).toBe('ch.example.com');
  expect(chConfig).not.toHaveProperty('password');
});

// ── Multiple Providers Tests ────────────────────────────────────────

test('17. PUT handles multiple providers in providers record', () => {
  const result = doPutMarketDataSettings({
    providers: {
      clickhouse: {
        host: 'ch.local',
        port: 8123,
        user: 'default',
        database: 'market',
      },
      schwab: {
        apiKey: 'schwab-test-key',
        accountId: '12345',
      },
    },
  });

  expect(result.status).toBe(201);
  const data = result.data as Record<string, unknown>;
  const providers = data.providers as Record<string, unknown>;

  expect(providers).toHaveProperty('clickhouse');
  expect(providers).toHaveProperty('schwab');

  const schwabConfig = providers.schwab as Record<string, unknown>;
  expect(schwabConfig.apiKey).toBe('schwab-test-key');
  expect(schwabConfig.accountId).toBe('12345');
});

test('18. PUT merge preserves existing provider when updating another', () => {
  // Seed with two providers
  doPutMarketDataSettings({
    providers: {
      clickhouse: { host: 'ch.local', port: 8123, user: 'default', database: 'market' },
      schwab: { apiKey: 'original-key', accountId: '999' },
    },
  });

  // Update only the clickhouse provider
  const result = doPutMarketDataSettings({
    providers: {
      clickhouse: { host: 'new-ch', port: 9440, user: 'admin', database: 'prod' },
    },
  });

  expect(result.status).toBe(200);
  const providers = (result.data as Record<string, unknown>).providers as Record<string, unknown>;

  // ClickHouse should be updated
  expect((providers.clickhouse as Record<string, unknown>).host).toBe('new-ch');

  // Schwab should be preserved
  expect(providers).toHaveProperty('schwab');
  expect((providers.schwab as Record<string, unknown>).apiKey).toBe('original-key');
});

// ── Error Handling Tests ────────────────────────────────────────────

test('19. GET with malformed providers JSON handles gracefully', () => {
  const id = randomUUID();
  // Insert a row with malformed JSON directly
  sqlite.prepare(
    'INSERT INTO market_data_settings (id, active_provider, providers) VALUES (?, ?, ?)',
  ).run(id, 'clickhouse', '{broken json');

  const result = doGetMarketDataSettings();
  expect(result.status).toBe(200);
  const data = result.data as Record<string, unknown>;
  expect(data.providers).toEqual({});
});

test('20. Multiple PUT create calls are idempotent — second call updates', () => {
  const result1 = doPutMarketDataSettings({ activeProvider: 'clickhouse' });
  expect(result1.status).toBe(201);

  const result2 = doPutMarketDataSettings({ activeProvider: 'schwab' });
  expect(result2.status).toBe(200);
  expect((result2.data as Record<string, unknown>).activeProvider).toBe('schwab');

  // Third call should still be update (200)
  const result3 = doPutMarketDataSettings({ activeProvider: 'polygon' });
  expect(result3.status).toBe(200);
  expect((result3.data as Record<string, unknown>).activeProvider).toBe('polygon');
});
