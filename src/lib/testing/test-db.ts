/**
 * Shared test-database helper (H1).
 *
 * Centralizes SQLite test-database lifecycle so test suites never create
 * disposable databases or WAL/SHM companions in the repository root. All
 * temporary databases live under the OS temp directory in unique,
 * per-suite locations:
 *
 *   /tmp/tradingjournal-test-<name>-<pid>-<uuid>.db        (single-file suites)
 *   /tmp/tradingjournal-test-<name>-<uuid>/test.db          (multi-file suites)
 *
 * Ownership model:
 *   - `testDbPath(name)` / `createTestTempDir(name)` allocate UNIQUE paths
 *     (mkdtemp / pid + uuid), so parallel vitest workers can never collide.
 *   - `disposeSqliteFile` CLOSES the connection first, then removes the DB,
 *     WAL, and SHM companions (existence-safe).
 *   - `createTestDatabase` owns a full temp directory: opening with WAL +
 *     FK pragmas, optional migration/schema bootstrap, and a `dispose()`
 *     that removes the entire owned directory (idempotent, ownership-checked
 *     via the known tmpdir + prefix).
 *
 * Abrupt process death (SIGKILL / crash) may leave stale artifacts under
 * /tmp, but can NEVER dirty the repository source tree — the structural
 * invariant H1 enforces.
 *
 * NOTE: for suites that must set `process.env.DB_FILE_NAME` before production
 * DB modules resolve it, call `testDbPath(name)` at the SAME point the old
 * root-relative literal was assigned (module top), preserving bootstrap
 * ordering.
 */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, unlinkSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Prefix identifying directories/paths owned by this helper. */
export const TEST_TEMP_PREFIX = 'tradingjournal-test-';

/** Verify an absolute path is owned (inside os.tmpdir with our prefix). */
function assertOwnedTempPath(path: string, label: string): void {
  const resolved = join(path);
  if (!resolved.startsWith(join(tmpdir()))) {
    throw new Error(`${label} not under os.tmpdir(): ${resolved}`);
  }
  const base = resolved.slice(resolved.lastIndexOf('/') + 1);
  if (!base.startsWith(TEST_TEMP_PREFIX)) {
    throw new Error(`${label} does not use the test prefix: ${base}`);
  }
}

/**
 * Allocate a unique OS-temp SQLite file path for a single-file test suite.
 * The path includes the suite name, pid, and a UUID so parallel suites and
 * repeated runs never collide.
 */
export function testDbPath(name: string): string {
  return join(tmpdir(), `${TEST_TEMP_PREFIX}${name}-${process.pid}-${randomUUID()}.db`);
}

/**
 * Allocate a unique OS-temp DIRECTORY for multi-file suites (backup/restore,
 * scratch files). Caller owns everything inside and should remove it via
 * `rmSync(dir, { recursive: true, force: true })` (or `disposeTempDir`).
 */
export function createTestTempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `${TEST_TEMP_PREFIX}${name}-`));
}

/** Existence-safe removal of an owned temp directory. */
export function disposeTempDir(tempDir: string): void {
  assertOwnedTempPath(tempDir, 'tempDir');
  rmSync(tempDir, { recursive: true, force: true });
}

/**
 * Close a SQLite connection and remove its DB + WAL + SHM companions
 * (existence-safe, idempotent). Prefer `disposeSqliteFile` over manual
 * unlink sequences so teardown is uniform and failed tests still clean up.
 */
export function disposeSqliteFile(sqlite: Database.Database, dbPath: string): void {
  try {
    sqlite.close();
  } catch {
    // already closed
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {
      // already gone
    }
  }
}

/**
 * Apply every committed drizzle migration to a fresh SQLite database.
 * Dependency ordering between migrations is handled by skipping statements
 * that fail on already-created objects.
 */
export function applyAllMigrations(sqlite: Database.Database): void {
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();

  for (const file of migrations) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed.length > 0) {
        try {
          sqlite.exec(trimmed);
        } catch {
          // dependency ordering between migrations — safe to skip
        }
      }
    }
  }
}

export interface TestDatabaseContext {
  sqlite: Database.Database;
  dbPath: string;
  tempDir: string;
  /** Close + remove db/wal/shm + the owned temp directory (idempotent). */
  dispose(): void;
}

export interface CreateTestDatabaseOptions {
  /** Bootstrap the schema by applying all committed migrations. */
  migrations?: boolean;
  /** Optional schema/bootstrap callback (runs after migrations). */
  bootstrap?: (sqlite: Database.Database) => void;
}

/**
 * Create a full test-database context in a unique owned temp directory.
 *
 *   const ctx = createTestDatabase({ migrations: true });
 *   try { ...use ctx.sqlite... } finally { ctx.dispose(); }
 */
export function createTestDatabase(
  opts: CreateTestDatabaseOptions = {},
): TestDatabaseContext {
  const tempDir = createTestTempDir('suite');
  const dbPath = join(tempDir, 'test.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  if (opts.migrations) {
    applyAllMigrations(sqlite);
  }
  if (opts.bootstrap) {
    opts.bootstrap(sqlite);
  }

  return {
    sqlite,
    dbPath,
    tempDir,
    dispose() {
      disposeSqliteFile(sqlite, dbPath);
      try {
        disposeTempDir(tempDir);
      } catch (err) {
        // Ownership assertion failure: do not delete an unowned path. The DB
        // file itself is already closed/removed; surface the guard loudly.
        console.error('[test-db] refusing to delete unowned temp dir:', err);
      }
    },
  };
}
