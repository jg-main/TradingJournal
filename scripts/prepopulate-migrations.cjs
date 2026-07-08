#!/usr/bin/env node
// Initialize the database fully (run all migrations) before next build so that
// when parallel route handlers query tables during page-data collection, the
// tables actually exist and migrate() is a no-op.
const Database = require('better-sqlite3');
const { mkdirSync } = require('node:fs');
const { join, dirname } = require('node:path');

const dbPath = process.env.DB_FILE_NAME || '/tmp/build-journal.db';
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Apply all migration files directly, sequentially (same order Drizzle does)
const migrationsDir = join(__dirname, '..', 'src', 'db', 'migrations');
const meta = require(join(migrationsDir, 'meta', '_journal.json'));

// Create drizzle tracking table
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
  if (existing) {
    console.log('Migration ' + tag + ' already applied, skipping');
    continue;
  }

  // Read the SQL file
  const fs = require('node:fs');
  const sql = fs.readFileSync(join(migrationsDir, tag + '.sql'), 'utf8');

  // Execute in a transaction
  sqlite.exec('BEGIN');
  try {
    sqlite.exec(sql);
    insert.run(tag);
    sqlite.exec('COMMIT');
    console.log('Applied migration: ' + tag);
  } catch (e) {
    sqlite.exec('ROLLBACK');
    console.error('Failed migration: ' + tag + ' - ' + e.message);
    throw e;
  }
}

// Also apply data migrations from db/index.ts
sqlite.exec(`UPDATE trades SET status = 'planned' WHERE status = 'idea'`);
sqlite.exec(`UPDATE trades SET status = 'open' WHERE status = 'partially_closed'`);
sqlite.exec(`UPDATE trades SET status = 'deleted' WHERE status = 'scratched'`);

console.log('Database fully initialized with ' + meta.entries.length + ' migrations');
sqlite.close();
