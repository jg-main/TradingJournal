/**
 * clickhouse-client-config.test.ts
 *
 * Dedicated tests for createDefaultClickHouseClient config resolution from
 * the market_data_settings table.
 *
 * Verifies the precedence chain:
 *   configOverride → market_data_settings.providers.clickhouse → env vars → defaults
 *
 * Uses its own in-memory SQLite DB for isolation from the clickhouse-client.test.ts mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ClickHouseConfig,
  createDefaultClickHouseClient,
} from '../clickhouse-client';

// ── In-memory SQLite for createDefaultClickHouseClient DB queries ────────

const mockSqlite = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE market_data_settings (
      id TEXT PRIMARY KEY NOT NULL,
      active_provider TEXT NOT NULL DEFAULT 'clickhouse',
      providers TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );
  `);
  return { sqlite };
});

vi.mock('@/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const db = drizzle(mockSqlite.sqlite);
  return {
    db,
    getSqliteHandle: () => mockSqlite.sqlite,
    initializeDatabase: () => db,
  };
});

// ── DB Helpers ────────────────────────────────────────────────────────────

let fakeIdCounter = 0;

/**
 * Seed the market_data_settings table with a ClickHouse provider config.
 * Clears any existing rows first.
 */
function seedClickHouseConfig(overrides: Record<string, unknown> = {}): void {
  mockSqlite.sqlite.exec('DELETE FROM market_data_settings;');
  fakeIdCounter++;
  const id = `test-mds-${fakeIdCounter}`;
  const host = (overrides.host as string) ?? 'ch-db.internal';
  const port = overrides.port !== undefined ? Number(overrides.port) : 8123;
  const user = (overrides.user as string) ?? 'analyst';
  const password = (overrides.password as string) ?? 'ch_secret';
  const database = (overrides.database as string) ?? 'prod_market';

  const providers = JSON.stringify({
    clickhouse: { host, port, user, password, database },
  });

  const stmt = mockSqlite.sqlite.prepare(
    'INSERT INTO market_data_settings (id, active_provider, providers) VALUES (?, ?, ?)'
  );
  stmt.run(id, 'clickhouse', providers);
}

/** Clear all market_data_settings rows */
function clearClickHouseConfig(): void {
  mockSqlite.sqlite.exec('DELETE FROM market_data_settings;');
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('createDefaultClickHouseClient config from market_data_settings', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    // Clear relevant env vars
    delete process.env.CLICKHOUSE_HOST;
    delete process.env.CLICKHOUSE_PORT;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
    delete process.env.CLICKHOUSE_DATABASE;
    clearClickHouseConfig();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  // ── Reads from market_data_settings ──────────────────────────────────

  it('reads ClickHouse config from market_data_settings', () => {
    seedClickHouseConfig({
      host: 'mds-host.local',
      port: 8443,
      user: 'mds_user',
      password: 'mds_pass',
      database: 'mds_db',
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.event).toBe('clickhouse_config_resolution');
    expect(logArg.source).toBe('database');
    expect(logArg.host).toBe('mds-host.local');
    expect(logArg.port).toBe(8443);
    expect(logArg.user).toBe('mds_user');
    expect(logArg.database).toBe('mds_db');
    expect(logArg.hasPassword).toBe(true);
    consoleSpy.mockRestore();
  });

  // ── Falls through to defaults when no config exists ──────────────────

  it('uses defaults when no market_data_settings row exists', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('defaults');
    expect(logArg.host).toBe('localhost');
    expect(logArg.port).toBe(8123);
    expect(logArg.user).toBe('default');
    expect(logArg.database).toBe('market');
    consoleSpy.mockRestore();
  });

  // ── Falls through when providers JSON has no clickhouse key ──────────

  it('falls through to env/defaults when providers has no clickhouse key', () => {
    // Seed with empty providers
    const id = 'test-no-ch';
    const stmt = mockSqlite.sqlite.prepare(
      'INSERT INTO market_data_settings (id, active_provider, providers) VALUES (?, ?, ?)'
    );
    stmt.run(id, 'schwab', '{}');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    // No clickhouse key → hasDbRow is false
    expect(logArg.source).toBe('defaults');
    expect(logArg.host).toBe('localhost');
    consoleSpy.mockRestore();
  });

  // ── Falls through when providers JSON is malformed ───────────────────

  it('falls through to env/defaults when providers JSON is malformed', () => {
    const id = 'test-bad-json';
    const stmt = mockSqlite.sqlite.prepare(
      'INSERT INTO market_data_settings (id, active_provider, providers) VALUES (?, ?, ?)'
    );
    stmt.run(id, 'clickhouse', '{broken json');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('defaults');
    consoleSpy.mockRestore();
  });

  // ── Empty string fields fall through ─────────────────────────────────

  it('falls back to env when market_data_settings field is empty string', () => {
    seedClickHouseConfig({ host: '' });
    process.env.CLICKHOUSE_HOST = 'env-resolved-host.local';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    // Empty host falls through to env → env wins
    expect(logArg.host).toBe('env-resolved-host.local');
    consoleSpy.mockRestore();
  });

  // ── DB wins over env vars ────────────────────────────────────────────

  it('market_data_settings takes precedence over env vars', () => {
    seedClickHouseConfig({
      host: 'db-host.local',
      port: 9000,
      user: 'db_user',
      password: 'db_pass',
      database: 'db_db',
    });
    process.env.CLICKHOUSE_HOST = 'env-host.local';
    process.env.CLICKHOUSE_PORT = '9999';
    process.env.CLICKHOUSE_USER = 'env_user';
    process.env.CLICKHOUSE_PASSWORD = 'env_pass';
    process.env.CLICKHOUSE_DATABASE = 'env_db';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('database');
    expect(logArg.host).toBe('db-host.local');
    expect(logArg.port).toBe(9000);
    expect(logArg.user).toBe('db_user');
    expect(logArg.database).toBe('db_db');
    expect(logArg.hasPassword).toBe(true);
    consoleSpy.mockRestore();
  });

  // ── configOverride wins over everything ──────────────────────────────

  it('configOverride takes precedence over market_data_settings', () => {
    seedClickHouseConfig({
      host: 'db-host.local',
      port: 8123,
      user: 'db_user',
      password: 'db_pass',
      database: 'db_db',
    });

    const override: Partial<ClickHouseConfig> = {
      host: 'override-host.local',
      port: 3000,
    };

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient(override);
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('override');
    expect(logArg.host).toBe('override-host.local');
    expect(logArg.port).toBe(3000);
    // Non-overridden fields still come from DB
    expect(logArg.user).toBe('db_user');
    expect(logArg.database).toBe('db_db');
    consoleSpy.mockRestore();
  });

  // ── Env falls through to defaults ────────────────────────────────────

  it('env var sets host when no DB config exists', () => {
    process.env.CLICKHOUSE_HOST = 'env-host.local';
    process.env.CLICKHOUSE_PORT = '9440';
    process.env.CLICKHOUSE_USER = 'env_user';
    process.env.CLICKHOUSE_DATABASE = 'env_db';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('env');
    expect(logArg.host).toBe('env-host.local');
    expect(logArg.port).toBe(9440);
    expect(logArg.user).toBe('env_user');
    expect(logArg.database).toBe('env_db');
    consoleSpy.mockRestore();
  });

  // ── Partial DB config ────────────────────────────────────────────────

  it('reads all fields from market_data_settings when fully configured', () => {
    seedClickHouseConfig({
      host: 'full-host.local',
      port: 3000,
      user: 'full_user',
      password: 'full_pass',
      database: 'full_db',
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('database');
    expect(logArg.host).toBe('full-host.local');
    expect(logArg.port).toBe(3000);
    expect(logArg.user).toBe('full_user');
    expect(logArg.database).toBe('full_db');
    expect(logArg.hasPassword).toBe(true);
    consoleSpy.mockRestore();
  });

  it('ignores null/undefined fields from partial DB config, falling through to defaults', () => {
    // Seed with explicit null host and omitted port → both should fall through to defaults
    const id = 'test-partial';
    const providers = JSON.stringify({
      clickhouse: {
        host: null,
        port: undefined,
        user: 'partial_user',
        password: '',
        database: null,
      },
    });
    const stmt = mockSqlite.sqlite.prepare(
      'INSERT INTO market_data_settings (id, active_provider, providers) VALUES (?, ?, ?)'
    );
    stmt.run(id, 'clickhouse', providers);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    // host, database are null → isSet fails → fall through to defaults
    expect(logArg.host).toBe('localhost');
    expect(logArg.database).toBe('market');
    // user is set → from DB
    expect(logArg.user).toBe('partial_user');
    // password is empty string → isSet fails → empty password
    expect(logArg.hasPassword).toBe(false);
    consoleSpy.mockRestore();
  });

  // ── Password empty string ────────────────────────────────────────────

  it('reports hasPassword=false when password is empty string in DB', () => {
    seedClickHouseConfig({ password: '' });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.hasPassword).toBe(false);
    consoleSpy.mockRestore();
  });

  // ── Port validation ──────────────────────────────────────────────────

  it('throws for invalid port from DB', () => {
    seedClickHouseConfig({ port: -1 });
    expect(() => createDefaultClickHouseClient()).toThrow('Source: database');
  });

  it('throws for invalid port from override', () => {
    expect(() => createDefaultClickHouseClient({ port: 99999 })).toThrow('Source: override');
  });

  it('throws for invalid port from env', () => {
    process.env.CLICKHOUSE_PORT = 'not-a-port';
    expect(() => createDefaultClickHouseClient()).toThrow('Invalid CLICKHOUSE_PORT');
  });

  // ── Return type ──────────────────────────────────────────────────────

  it('returns a client instance with all expected methods', () => {
    const client = createDefaultClickHouseClient();
    expect(client).toHaveProperty('getMarketEvidence');
    expect(client).toHaveProperty('checkFreshness');
    expect(client).toHaveProperty('getFeatureTimeSeries');
    expect(client).toHaveProperty('getAllFeatureColumns');
  });
});
