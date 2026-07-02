import 'server-only';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as schema from './schema';

const DB_FILE = process.env.DB_FILE_NAME || './.trading-journal/journal.db';

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function initializeDatabase() {
  if (dbInstance) return dbInstance;

  mkdirSync(dirname(DB_FILE), { recursive: true });

  const sqlite = new Database(DB_FILE);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqlite, { schema });

  // Auto-apply pending migrations on startup so schema stays in sync
  migrate(dbInstance, { migrationsFolder: join(process.cwd(), 'src/db/migrations') });

  return dbInstance;
}

export const db = initializeDatabase();
