import 'server-only';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
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
  migrate(dbInstance, { migrationsFolder: join(process.cwd(), 'src/db/migrations') });

  // Data migration: convert old status values to the new 4-status model
  // (idea -> planned, partially_closed -> open, scratched -> deleted)
  sqlite.exec(`UPDATE trades SET status = 'planned' WHERE status = 'idea'`);
  sqlite.exec(`UPDATE trades SET status = 'open' WHERE status = 'partially_closed'`);
  sqlite.exec(`UPDATE trades SET status = 'deleted' WHERE status = 'scratched'`);

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
