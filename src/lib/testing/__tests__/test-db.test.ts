/**
 * H1 — shared test-database helper tests.
 *
 * Proves the canonical temporary-DB strategy:
 *   - createTestDatabase allocates a UNIQUE owned temp directory with a
 *     working SQLite connection (WAL + FK pragmas);
 *   - dispose() closes the connection, removes db/wal/shm, and deletes the
 *     entire owned temp directory (idempotent);
 *   - parallel instances get distinct paths (no collision);
 *   - ownership is enforced (unowned paths are never deleted).
 *
 * Run: npx vitest run --reporter verbose src/lib/testing/__tests__/test-db.test.ts
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createTestDatabase,
  createTestTempDir,
  disposeTempDir,
  testDbPath,
  applyAllMigrations,
} from '../test-db';

describe('testDbPath (single-file suites)', () => {
  it('allocates unique OS-temp paths', () => {
    const a = testDbPath('suite-a');
    const b = testDbPath('suite-a');
    expect(a).not.toBe(b);
    expect(a.startsWith(tmpdir())).toBe(true);
    expect(b.startsWith(tmpdir())).toBe(true);
  });
});

describe('createTestTempDir / disposeTempDir', () => {
  it('creates and removes an owned temp directory (with nested files)', () => {
    const dir = createTestTempDir('scratch');
    expect(existsSync(dir)).toBe(true);
    // Simulate multi-file suite output.
    writeFileSync(join(dir, 'backup.zip'), 'data');
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'nested', 'extra.bin'), 'x');
    disposeTempDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses to delete an unowned path', () => {
    expect(() => disposeTempDir('/tmp')).toThrow(/not under os\.tmpdir|does not use the test prefix/);
    expect(() => disposeTempDir(tmpdir())).toThrow(/does not use the test prefix/);
  });
});

describe('createTestDatabase context', () => {
  it('creates a DB in an owned unique temp dir with migrations applied', () => {
    const ctx = createTestDatabase({ migrations: true });
    expect(existsSync(ctx.dbPath)).toBe(true);
    // A migrated table exists and is usable.
    ctx.sqlite.prepare('SELECT 1 FROM accounts LIMIT 0').run();
    const walPossible = ctx.sqlite.pragma('journal_mode', { simple: true }) as unknown;
    expect(String(walPossible)).toContain('wal');
    ctx.dispose();
  });

  it('dispose removes the database, WAL/SHM companions, and the directory (idempotent)', () => {
    const ctx = createTestDatabase({ migrations: true });
    // Force WAL/SHM companion generation by writing inside a transaction.
    const txn = ctx.sqlite.transaction(() => {
      ctx.sqlite.prepare("INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at) VALUES ('a', 'A', 'USD', 1, 'now', 'now')").run();
    });
    txn();
    expect(existsSync(ctx.dbPath)).toBe(true);

    ctx.dispose();
    expect(existsSync(ctx.dbPath)).toBe(false);
    expect(existsSync(ctx.dbPath + '-wal')).toBe(false);
    expect(existsSync(ctx.dbPath + '-shm')).toBe(false);
    expect(existsSync(ctx.tempDir)).toBe(false);

    // Idempotent: a second dispose is safe.
    expect(() => ctx.dispose()).not.toThrow();
  });

  it('parallel instances get distinct paths (no collision)', () => {
    const a = createTestDatabase();
    const b = createTestDatabase();
    try {
      expect(a.dbPath).not.toBe(b.dbPath);
      expect(a.tempDir).not.toBe(b.tempDir);
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  it('bootstrap runs after migrations when provided', () => {
    let ran = false;
    const ctx = createTestDatabase({
      migrations: true,
      bootstrap: (sqlite: Database.Database) => {
        ran = true;
        sqlite
          .prepare("INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at) VALUES ('x', 'X', 'USD', 1, 'now', 'now')")
          .run();
      },
    });
    try {
      expect(ran).toBe(true);
      const row = ctx.sqlite.prepare("SELECT name FROM accounts WHERE id = 'x'").get() as { name: string };
      expect(row.name).toBe('X');
    } finally {
      ctx.dispose();
    }
  });
});

describe('applyAllMigrations', () => {
  it('applies every committed migration to a fresh database', () => {
    const ctx = createTestDatabase({ migrations: true });
    try {
      // Spot-check a few tables across migration generations.
      for (const table of ['accounts', 'settings', 'financial_events', 'ledger_postings', 'account_performance', 'financial_event_correction_lineage']) {
        const row = ctx.sqlite
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table);
        expect(row, `table ${table} exists`).toBeTruthy();
      }
    } finally {
      ctx.dispose();
    }
  });
});
