import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Apply all pending schema migrations from a drizzle-kit journal.
 *
 * Pure function of (sqlite handle, migrations directory path) with no
 * module-level side effects — tests can call it with a temp directory
 * containing a broken migration.
 *
 * Behavior:
 * - Creates the `__drizzle_migrations` tracking table if it does not exist.
 * - Reads `meta/_journal.json` from `migrationsDir`.
 * - For each journal entry, opens a serialized `BEGIN IMMEDIATE` write
 *   transaction and skips the entry if its tag is already recorded.
 * - Otherwise reads `<tag>.sql` and executes it inside that transaction,
 *   recording the tag as the applied hash, then commits.
 * - On ANY error the current migration's transaction is ROLLBACKed and the
 *   error is re-thrown (fail-closed) with a message naming the failing tag.
 *   Errors are never swallowed: a missing journal, missing SQL file, or SQL
 *   failure all abort startup rather than leaving a partially migrated
 *   schema in place.
 *
 * Concurrency: the "is this tag recorded" existence check happens INSIDE the
 * write transaction, so concurrent processes starting against the same
 * database cannot both observe the same tag as missing and both apply its SQL.
 * Only one process can hold the SQLite write lock at a time; a competing
 * process blocks on `BEGIN IMMEDIATE` (bounded by the busy timeout configured
 * on the connection — better-sqlite3 defaults to 5000ms) and then re-checks
 * the tag after the holder commits, so it skips instead of re-applying.
 *
 * The tracking table uses the journal tag as the hash column value. This
 * matches the historical behavior of src/db/index.ts and makes hand-written
 * migrations (see src/db/migrations/meta/_journal.json) idempotent: entries
 * without a journal line are skipped by the dev-server auto-apply and must
 * be registered in the journal.
 */
export function runMigrations(sqlite: Database.Database, migrationsDir: string): void {
  const metaPath = join(migrationsDir, 'meta', '_journal.json');
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
  const findExisting = sqlite.prepare('SELECT id FROM __drizzle_migrations WHERE hash = ?');

  for (const entry of meta.entries) {
    const tag = entry.tag;

    // Serialize each check-and-apply decision under the SQLite write lock.
    // The existence check must happen inside the write transaction, otherwise
    // two concurrent runners can both see the tag as missing and both apply
    // the same SQL (the duplicate-column failure seen during multi-worker
    // Next.js builds). A competing runner blocks on BEGIN IMMEDIATE (bounded
    // by the connection's busy timeout), then re-checks after the holder
    // commits, so it skips rather than re-applying.
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (findExisting.get(tag)) {
        sqlite.exec('COMMIT');
        continue;
      }

      const sql = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8');
      sqlite.exec(sql);
      insert.run(tag);
      sqlite.exec('COMMIT');
    } catch (e) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // The transaction may already be in an aborted state; preserve the
        // original migration error below rather than masking it.
      }
      const err = e instanceof Error ? e : new Error(String(e));
      err.message = `Migration failed for tag "${tag}" (${tag}.sql): ${err.message}`;
      throw err;
    }
  }
}
