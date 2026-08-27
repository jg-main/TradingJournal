// @vitest-environment node
/**
 * run-migrations.test.ts
 *
 * Regression tests for the fail-closed migration runner
 * (src/db/run-migrations.ts).
 *
 * Proves:
 *  - Happy path: every migration in the real journal applies on a fresh DB
 *    and is recorded in `__drizzle_migrations`.
 *  - Fail-closed: a broken migration throws (never swallowed), the error
 *    message names the failing tag, and nothing is recorded for it.
 *  - Idempotency: re-running after success is a no-op (no duplicate rows),
 *    including ALTER TABLE ADD COLUMN migrations (no duplicate-column error).
 *  - Partial failure: when the second of two migrations fails, the first
 *    stays committed and only the failing one is rolled back.
 *  - Concurrency: multiple worker threads running the same pending migrations
 *    against the same fresh SQLite file each complete successfully, the SQL
 *    is applied exactly once, and every tag is recorded exactly once.
 *
 * Run: npx vitest run src/db/__tests__/run-migrations.test.ts
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../run-migrations';

// ── Hoisted: keep any accidental '@/db' import out of the repo database ──
// vi.hoisted runs before static imports are evaluated, so this env var is in
// place if a future edit makes the test import src/db/index.ts (whose
// module-level `export const db = initializeDatabase()` would otherwise open
// ./ .trading-journal/journal.db inside the repository).
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'run-migrations-db-'));
  process.env.DB_FILE_NAME = join(dir, 'journal.db');
});

// The vitest config aliases 'server-only' to an empty stub; keep the explicit
// mock so the test file is self-contained if that alias ever changes.
vi.mock('server-only', () => ({}));

const cleanupDirs: string[] = [];

/** Create a temp migrations dir with the given files (paths relative to dir). */
function makeMigrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'run-migrations-fixture-'));
  cleanupDirs.push(dir);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

/** Build a drizzle-kit style journal for the given tags, in order. */
function journalFor(tags: string[]): string {
  return JSON.stringify(
    {
      version: '9',
      dialect: 'sqlite',
      entries: tags.map((tag, idx) => ({
        idx,
        version: '6',
        when: 1700000000000 + idx,
        tag,
        breakpoints: true,
      })),
    },
    null,
    2,
  );
}

function migrationCountIn(sqlite: Database.Database): number {
  const row = sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as {
    count: number;
  };
  return row.count;
}

function hasTag(sqlite: Database.Database, tag: string): boolean {
  return !!sqlite.prepare('SELECT id FROM __drizzle_migrations WHERE hash = ?').get(tag);
}

function closeDb(sqlite: Database.Database): void {
  try {
    sqlite.close();
  } catch {
    // already closed
  }
}

function captureThrow(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

interface ConcurrentWorkerResult {
  ok: boolean;
  error?: string;
}

/** Column names of a table, e.g. `PRAGMA table_info(...)`. */
function columnNames(sqlite: Database.Database, table: string): string[] {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

/**
 * Build a standalone worker script that opens a real SQLite connection to a
 * shared DB file, waits on a file-based start barrier, and runs the actual
 * `runMigrations` from the repository source. The script lives in a temp dir;
 * it resolves `better-sqlite3` through the repository's node_modules via
 * `createRequire`, so no symlink scaffolding is needed. It is executed by a
 * `node:worker_threads` Worker with the `tsx` loader, giving real parallel
 * processes sharing one database file.
 */
function buildConcurrentWorkerScript(runnerPath: string): string {
  return `
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readdirSync, writeFileSync } from 'node:fs';
import { runMigrations } from ${JSON.stringify(runnerPath)};

const requireFromRepo = createRequire(join(workerData.repoRoot, '__virtual_entry__.js'));
const Database = requireFromRepo('better-sqlite3');

const db = new Database(workerData.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// File-based start barrier: every worker opens its connection, then waits
// until all workers are ready before running migrations concurrently.
writeFileSync(join(workerData.readyDir, 'ready-' + workerData.id), '');
const deadline = Date.now() + 30000;
while (readdirSync(workerData.readyDir).filter((f) => f.startsWith('ready-')).length < workerData.workerCount) {
  if (Date.now() > deadline) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
}

try {
  runMigrations(db, workerData.migrationsDir);
  parentPort!.postMessage({ ok: true });
} catch (e) {
  parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
} finally {
  try {
    db.close();
  } catch {
    // already closed
  }
}
`;
}

/** Spawn `workerCount` workers running the same migrations concurrently. */
function runConcurrentWorkers(
  workerScriptPath: string,
  workerData: {
    dbPath: string;
    migrationsDir: string;
    readyDir: string;
    workerCount: number;
    repoRoot: string;
  },
): Promise<ConcurrentWorkerResult[]> {
  const results: ConcurrentWorkerResult[] = [];
  return new Promise((resolve) => {
    let exited = 0;
    for (let id = 0; id < workerData.workerCount; id += 1) {
      const worker = new Worker(workerScriptPath, {
        execArgv: ['--import', 'tsx'],
        workerData: { ...workerData, id },
      });
      worker.on('message', (m: unknown) => results.push(m as ConcurrentWorkerResult));
      worker.on('error', (e: Error) => {
        results.push({ ok: false, error: `worker error: ${e.message}` });
      });
      worker.on('exit', () => {
        exited += 1;
        if (exited === workerData.workerCount) resolve(results);
      });
    }
  });
}

afterAll(() => {
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

describe('runMigrations', () => {
  it('applies every real journal migration on a fresh database (happy path)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-migrations-real-'));
    cleanupDirs.push(dir);
    const sqlite = new Database(join(dir, 'journal.db'));
    try {
      const realDir = join(process.cwd(), 'src/db/migrations');
      const meta = JSON.parse(
        readFileSync(join(realDir, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: unknown[] };

      expect(() => runMigrations(sqlite, realDir)).not.toThrow();
      expect(migrationCountIn(sqlite)).toBe(meta.entries.length);
    } finally {
      closeDb(sqlite);
    }
  });

  it('fails closed: a broken migration throws with its tag and records nothing', () => {
    const dir = makeMigrationsDir({
      'meta/_journal.json': journalFor(['0001_broken']),
      '0001_broken.sql': 'CREATE TABL broken_syntax;',
    });
    const sqlite = new Database(join(dir, 'journal.db'));
    try {
      const err = captureThrow(() => runMigrations(sqlite, dir));

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('0001_broken');
      // The failed migration must not be recorded (transaction rolled back).
      expect(migrationCountIn(sqlite)).toBe(0);
    } finally {
      closeDb(sqlite);
    }
  });

  it('is idempotent: re-running after success records no duplicate entries', () => {
    const dir = makeMigrationsDir({
      'meta/_journal.json': journalFor(['0001_ok']),
      '0001_ok.sql': 'CREATE TABLE test_ok (id INTEGER PRIMARY KEY);',
    });
    const sqlite = new Database(join(dir, 'journal.db'));
    try {
      runMigrations(sqlite, dir);
      expect(migrationCountIn(sqlite)).toBe(1);

      expect(() => runMigrations(sqlite, dir)).not.toThrow();
      expect(migrationCountIn(sqlite)).toBe(1);
    } finally {
      closeDb(sqlite);
    }
  });

  it('applies a single migration, records its tag, and materializes its schema change', () => {
    const dir = makeMigrationsDir({
      'meta/_journal.json': journalFor(['0001_single']),
      '0001_single.sql': 'CREATE TABLE test_single (id INTEGER PRIMARY KEY, label text);',
    });
    const sqlite = new Database(join(dir, 'journal.db'));
    try {
      runMigrations(sqlite, dir);
      expect(migrationCountIn(sqlite)).toBe(1);
      expect(hasTag(sqlite, '0001_single')).toBe(true);
      expect(columnNames(sqlite, 'test_single')).toEqual(expect.arrayContaining(['id', 'label']));
    } finally {
      closeDb(sqlite);
    }
  });

  it('is idempotent for ALTER TABLE ADD COLUMN migrations (no duplicate-column error)', () => {
    const dir = makeMigrationsDir({
      'meta/_journal.json': journalFor(['0001_add_col']),
      '0001_add_col.sql':
        'CREATE TABLE test_cols (id INTEGER PRIMARY KEY);\n' +
        'ALTER TABLE test_cols ADD COLUMN extra integer;',
    });
    const sqlite = new Database(join(dir, 'journal.db'));
    try {
      runMigrations(sqlite, dir);
      expect(migrationCountIn(sqlite)).toBe(1);

      expect(() => runMigrations(sqlite, dir)).not.toThrow();
      expect(migrationCountIn(sqlite)).toBe(1);
      // Column exists exactly once — the second run must not re-apply the ALTER.
      expect(columnNames(sqlite, 'test_cols').filter((name) => name === 'extra')).toHaveLength(1);
    } finally {
      closeDb(sqlite);
    }
  });

  it(
    'applies each migration exactly once under concurrent runners ' +
      '(no duplicate-column error, no SQLITE_BUSY leak, tags recorded once)',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'run-migrations-concurrent-'));
      cleanupDirs.push(dir);
      const readyDir = join(dir, 'ready');
      mkdirSync(readyDir, { recursive: true });
      const dbPath = join(dir, 'journal.db');
      const migrationsDir = join(process.cwd(), 'src/db/migrations');
      const workerScriptPath = join(dir, 'migration-worker.ts');
      writeFileSync(
        workerScriptPath,
        buildConcurrentWorkerScript(join(process.cwd(), 'src/db/run-migrations.ts')),
      );

      const workerCount = 6;
      const results = await runConcurrentWorkers(workerScriptPath, {
        dbPath,
        migrationsDir,
        readyDir,
        workerCount,
        repoRoot: process.cwd(),
      });

      // Every concurrent caller must complete successfully. A failure here
      // means a duplicate-column/table error or a SQLITE_BUSY leak.
      expect(results).toHaveLength(workerCount);
      const failures = results.filter((r) => !r.ok);
      expect(failures, JSON.stringify(failures)).toEqual([]);

      const meta = JSON.parse(
        readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };

      const sqlite = new Database(dbPath, { readonly: true });
      try {
        const perTag = sqlite
          .prepare('SELECT hash, count(*) AS c FROM __drizzle_migrations GROUP BY hash')
          .all() as { hash: string; c: number }[];
        // Every journal tag recorded exactly once.
        expect(perTag).toHaveLength(meta.entries.length);
        for (const row of perTag) {
          expect(row.c).toBe(1);
        }
        // The migration that originally failed in CI is applied exactly once.
        expect(columnNames(sqlite, 'checklist_definitions')).toContain('is_required');
      } finally {
        sqlite.close();
      }
    },
    120_000,
  );

  it('rolls back only the failing migration and preserves earlier committed ones', () => {
    const dir = makeMigrationsDir({
      'meta/_journal.json': journalFor(['0001_valid', '0002_broken']),
      '0001_valid.sql': 'CREATE TABLE test_ok (id INTEGER PRIMARY KEY);',
      '0002_broken.sql': 'CREATE TABL broken_syntax;',
    });
    const sqlite = new Database(join(dir, 'journal.db'));
    try {
      const err = captureThrow(() => runMigrations(sqlite, dir));

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('0002_broken');
      // First migration committed and is preserved.
      expect(hasTag(sqlite, '0001_valid')).toBe(true);
      // Failing migration rolled back and is not recorded.
      expect(hasTag(sqlite, '0002_broken')).toBe(false);
      expect(migrationCountIn(sqlite)).toBe(1);
    } finally {
      closeDb(sqlite);
    }
  });
});
