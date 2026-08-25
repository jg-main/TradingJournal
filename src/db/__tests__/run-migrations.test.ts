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
 *  - Idempotency: re-running after success is a no-op (no duplicate rows).
 *  - Partial failure: when the second of two migrations fails, the first
 *    stays committed and only the failing one is rolled back.
 *
 * Run: npx vitest run src/db/__tests__/run-migrations.test.ts
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
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
