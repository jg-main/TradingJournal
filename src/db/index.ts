import 'server-only';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as schema from './schema';

const DB_FILE = process.env.DB_FILE_NAME || './.trading-journal/journal.db';

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteHandle: Database.Database | null = null;

export function initializeDatabase() {
  if (dbInstance) return dbInstance;

  mkdirSync(dirname(DB_FILE), { recursive: true });

  const sqlite = new Database(DB_FILE);
  sqliteHandle = sqlite;
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqlite, { schema });

  // Auto-apply pending migrations on startup so schema stays in sync
  // Uses exec() (not drizzle's migrate()) to support multi-statement SQL files
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  const metaPath = join(migrationsDir, 'meta', '_journal.json');
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { entries: { tag: string }[] };
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'hash TEXT NOT NULL, ' +
      'created_at TEXT)'
    );
    const insert = sqlite.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, datetime('now'))"
    );
    for (const entry of meta.entries) {
      const tag = entry.tag;
      const existing = sqlite.prepare(
        'SELECT id FROM __drizzle_migrations WHERE hash = ?'
      ).get(tag);
      if (existing) continue;
      const sql = readFileSync(join(migrationsDir, tag + '.sql'), 'utf8');
      sqlite.exec('BEGIN');
      try {
        sqlite.exec(sql);
        insert.run(tag);
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    }
  } catch (e) {
    console.error('[db] Migration error:', e instanceof Error ? e.message : e);
  }

  // Data migration: convert old status values to the new 4-status model
  // (idea -> planned, partially_closed -> open, scratched -> deleted)
  sqlite.exec(`UPDATE trades SET status = 'planned' WHERE status = 'idea'`);
  sqlite.exec(`UPDATE trades SET status = 'open' WHERE status = 'partially_closed'`);
  sqlite.exec(`UPDATE trades SET status = 'deleted' WHERE status = 'scratched'`);

  // Seed reference data if empty (idempotent — skips if lookup_values already has rows)
  const existingLookups = sqlite.prepare('SELECT count(*) AS count FROM lookup_values').get() as { count: number } | undefined;
  if (existingLookups && existingLookups.count === 0) {
    const now = new Date().toISOString();
    const mistakeTypes = [
      { value: 'fomo_entry', description: 'FOMO — entry without proper analysis' },
      { value: 'fv_setup_selection', description: 'Setup selection failure' },
      { value: 'fv_risk_assessment', description: 'Risk assessment failure' },
      { value: 'fv_entry_timing', description: 'Entry timing failure' },
      { value: 'fv_position_sizing', description: 'Position sizing failure' },
      { value: 'fv_stop_placement', description: 'Stop placement failure' },
      { value: 'fv_patience', description: 'Patience failure' },
      { value: 'fv_management', description: 'Trade management failure' },
      { value: 'fv_exit_discipline', description: 'Exit discipline failure' },
      { value: 'fv_psychology', description: 'Psychology failure' },
    ];
    for (const mt of mistakeTypes) {
      dbInstance.insert(schema.lookupValues).values({
        id: randomUUID(),
        type: 'mistake_type',
        value: mt.value,
        description: mt.description,
        sortOrder: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    console.log(`  Seeded ${mistakeTypes.length} mistake types on startup.`);
  }

  // Data migration: copy ClickHouse config from ai_settings to market_data_settings
  // (idempotent — skips if market_data_settings already has rows)
  const existingMds = sqlite.prepare('SELECT count(*) AS count FROM market_data_settings').get() as { count: number } | undefined;
  if (existingMds && existingMds.count === 0) {
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
      console.log('  Migrated ClickHouse config from ai_settings to market_data_settings.');
    } else {
      // No ai_settings row exists — create default market_data_settings row
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
      console.log('  Created default market_data_settings row.');
    }
  }

  return dbInstance;
}

export const db = initializeDatabase();

/**
 * Return the raw better-sqlite3 Database handle for transactional
 * wipe-and-replace operations not available through Drizzle ORM.
 *
 * Throws if called before initializeDatabase() has run.
 */
export function getSqliteHandle(): Database.Database {
  if (!sqliteHandle) {
    throw new Error(
      'getSqliteHandle() called before initializeDatabase(). ' +
        'Ensure the database is initialized first.',
    );
  }
  return sqliteHandle;
}
