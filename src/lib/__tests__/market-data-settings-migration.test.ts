/**
 * market-data-settings-migration.test.ts
 *
 * Tests for the market_data_settings table and data migration from ai_settings.
 *
 * Run: npx vitest run src/lib/__tests__/market-data-settings-migration.test.ts
 */

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import {
  DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
  MAX_MTM_REFRESH_INTERVAL_SECONDS,
  MIN_MTM_REFRESH_INTERVAL_SECONDS,
  resolveMtmRefreshIntervalSeconds,
} from '../market-data-refresh-interval';

// ── In-memory test DB ──────────────────────────────────────────────────

let sqlite: Database.Database;

/**
 * Run the data migration: copy ClickHouse config from ai_settings to
 * market_data_settings.  Idempotent — skips if market_data_settings already
 * has rows.
 */
function runMigration(): void {
  const existing = sqlite.prepare(
    'SELECT count(*) AS count FROM market_data_settings'
  ).get() as { count: number };

  if (existing.count > 0) return;

  const aiRow = sqlite.prepare(`
    SELECT clickhouse_host, clickhouse_port, clickhouse_user, clickhouse_password, clickhouse_database
    FROM ai_settings LIMIT 1
  `).get() as Record<string, unknown> | undefined;

  if (aiRow) {
    const providers = {
      clickhouse: {
        host: aiRow.clickhouse_host || 'localhost',
        port: aiRow.clickhouse_port || 8123,
        user: aiRow.clickhouse_user || 'default',
        password: aiRow.clickhouse_password || '',
        database: aiRow.clickhouse_database || 'market',
      },
    };
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO market_data_settings (id, active_provider, providers, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), 'clickhouse', JSON.stringify(providers), now, now);
  } else {
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO market_data_settings (id, active_provider, providers, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), 'clickhouse', JSON.stringify({
      clickhouse: {
        host: 'localhost',
        port: 8123,
        user: 'default',
        password: '',
        database: 'market',
      },
    }), now, now);
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');

  sqlite.exec(`
    CREATE TABLE market_data_settings (
      id TEXT PRIMARY KEY NOT NULL,
      active_provider TEXT DEFAULT 'clickhouse' NOT NULL,
      providers TEXT DEFAULT '{}' NOT NULL,
      refresh_interval_seconds INTEGER DEFAULT 30 NOT NULL,
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );

    CREATE TABLE ai_settings (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
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
});

afterEach(() => {
  sqlite.close();
});

describe('market_data_settings migration', () => {
  it('accepts only provider-safe whole-second quote refresh intervals', () => {
    expect(resolveMtmRefreshIntervalSeconds(45)).toBe(45);
    expect(resolveMtmRefreshIntervalSeconds(undefined)).toBe(
      DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
    );
    expect(resolveMtmRefreshIntervalSeconds(MIN_MTM_REFRESH_INTERVAL_SECONDS - 1)).toBe(
      DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
    );
    expect(resolveMtmRefreshIntervalSeconds(MAX_MTM_REFRESH_INTERVAL_SECONDS + 1)).toBe(
      DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
    );
    expect(resolveMtmRefreshIntervalSeconds(30.5)).toBe(
      DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
    );
  });

  it('creates market_data_settings table with correct schema', () => {
    const columns = sqlite.prepare('PRAGMA table_info(market_data_settings)').all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    expect(columns.length).toBe(6);

    const idCol = columns.find(c => c.name === 'id');
    expect(idCol).toBeDefined();
    expect(idCol!.type).toBe('TEXT');
    expect(idCol!.notnull).toBe(1);

    const activeProviderCol = columns.find(c => c.name === 'active_provider');
    expect(activeProviderCol).toBeDefined();
    expect(activeProviderCol!.type).toBe('TEXT');
    expect(activeProviderCol!.notnull).toBe(1);
    expect(activeProviderCol!.dflt_value).toMatch(/clickhouse/);

    const providersCol = columns.find(c => c.name === 'providers');
    expect(providersCol).toBeDefined();
    expect(providersCol!.type).toBe('TEXT');
    expect(providersCol!.notnull).toBe(1);
    expect(providersCol!.dflt_value).toMatch(/\{.*\}/);

    const refreshIntervalCol = columns.find(c => c.name === 'refresh_interval_seconds');
    expect(refreshIntervalCol).toBeDefined();
    expect(refreshIntervalCol!.type).toBe('INTEGER');
    expect(refreshIntervalCol!.notnull).toBe(1);
    expect(refreshIntervalCol!.dflt_value).toBe('30');
  });

  it('upgrades databases already migrated through 0032', () => {
    const legacySqlite = new Database(':memory:');
    try {
      legacySqlite.exec(`
        CREATE TABLE market_data_settings (
          id TEXT PRIMARY KEY NOT NULL,
          active_provider TEXT DEFAULT 'clickhouse' NOT NULL,
          providers TEXT DEFAULT '{}' NOT NULL,
          created_at TEXT DEFAULT (current_timestamp),
          updated_at TEXT DEFAULT (current_timestamp)
        );
        CREATE TABLE __drizzle_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          hash TEXT NOT NULL,
          created_at numeric
        );
      `);
      legacySqlite
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('0032_drop_dead_pnl_columns', 1790000000001);

      migrate(drizzle(legacySqlite), {
        migrationsFolder: join(process.cwd(), 'src/db/migrations'),
      });

      const columns = legacySqlite.prepare('PRAGMA table_info(market_data_settings)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      expect(columns.find(column => column.name === 'refresh_interval_seconds')).toMatchObject({
        type: 'INTEGER',
        notnull: 1,
        dflt_value: '30',
      });
    } finally {
      legacySqlite.close();
    }
  });

  it('migrates ClickHouse config from ai_settings to market_data_settings', () => {
    // Seed ai_settings with custom ClickHouse config
    sqlite.prepare(`
      INSERT INTO ai_settings (id, provider, model, clickhouse_host, clickhouse_port, clickhouse_user, clickhouse_password, clickhouse_database)
      VALUES ('ai-1', 'openai', 'gpt-4', 'ch.example.com', 8443, 'analyst', 'secret123', 'analytics')
    `).run();

    runMigration();

    const row = sqlite.prepare('SELECT * FROM market_data_settings LIMIT 1').get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.active_provider).toBe('clickhouse');

    const providers = JSON.parse(row.providers as string);
    expect(providers.clickhouse).toBeDefined();
    expect(providers.clickhouse.host).toBe('ch.example.com');
    expect(providers.clickhouse.port).toBe(8443);
    expect(providers.clickhouse.user).toBe('analyst');
    expect(providers.clickhouse.password).toBe('secret123');
    expect(providers.clickhouse.database).toBe('analytics');
  });

  it('is idempotent — does not duplicate rows on second run', () => {
    sqlite.prepare(`
      INSERT INTO ai_settings (id, provider, model, clickhouse_host, clickhouse_port, clickhouse_user, clickhouse_password, clickhouse_database)
      VALUES ('ai-1', 'openai', 'gpt-4', 'ch.example.com', 8443, 'analyst', 'secret123', 'analytics')
    `).run();

    runMigration();
    runMigration();

    const rows = sqlite.prepare('SELECT count(*) AS count FROM market_data_settings').get() as { count: number };
    expect(rows.count).toBe(1);
  });

  it('uses defaults for missing ai_settings values', () => {
    sqlite.prepare(`
      INSERT INTO ai_settings (id, provider, model, clickhouse_host)
      VALUES ('ai-1', 'openai', 'gpt-4', 'ch.example.com')
    `).run();

    runMigration();

    const row = sqlite.prepare('SELECT * FROM market_data_settings LIMIT 1').get() as Record<string, unknown>;
    expect(row).toBeDefined();

    const providers = JSON.parse(row.providers as string);
    expect(providers.clickhouse.host).toBe('ch.example.com');
    // Undefined columns should use defaults
    expect(providers.clickhouse.port).toBe(8123);
    expect(providers.clickhouse.user).toBe('default');
    expect(providers.clickhouse.password).toBe('');
    expect(providers.clickhouse.database).toBe('market');
  });

  it('creates default row when no ai_settings exists', () => {
    runMigration();

    const row = sqlite.prepare('SELECT * FROM market_data_settings LIMIT 1').get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.active_provider).toBe('clickhouse');

    const providers = JSON.parse(row.providers as string);
    expect(providers.clickhouse).toBeDefined();
    expect(providers.clickhouse.host).toBe('localhost');
    expect(providers.clickhouse.port).toBe(8123);
    expect(providers.clickhouse.database).toBe('market');
  });

  it('handles empty password in ai_settings', () => {
    sqlite.prepare(`
      INSERT INTO ai_settings (id, provider, model, clickhouse_host, clickhouse_password)
      VALUES ('ai-1', 'openai', 'gpt-4', 'ch.example.com', '')
    `).run();

    runMigration();

    const row = sqlite.prepare('SELECT * FROM market_data_settings LIMIT 1').get() as Record<string, unknown>;
    const providers = JSON.parse(row.providers as string);
    expect(providers.clickhouse.password).toBe('');
  });
});
