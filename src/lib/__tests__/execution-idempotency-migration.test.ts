/**
 * execution-idempotency-migration.test.ts
 *
 * Tests for migration 0037 (idempotency_key on trade_executions) and the
 * journal-side idempotency contract it establishes for the canonical
 * execution engine (S03).
 *
 * Guards the MEM039 gotcha: a hand-written migration that is NOT registered
 * in src/db/migrations/meta/_journal.json is silently skipped by the dev
 * server's auto-apply (src/db/index.ts), causing runtime 500s. This suite
 * asserts both the journal registration AND the resulting schema so a
 * missing journal entry cannot slip through.
 *
 * Run: npx vitest run src/lib/__tests__/execution-idempotency-migration.test.ts
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import { testDbPath, disposeSqliteFile } from '@/lib/testing/test-db';

let sqlite: Database.Database;
let dbPath: string;

beforeAll(() => {
  dbPath = testDbPath('execution-idempotency-migration');
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // Journal-driven apply — mirrors src/db/index.ts auto-apply (MEM039).
  migrate(drizzle(sqlite, { schema }), {
    migrationsFolder: join(process.cwd(), 'src/db/migrations'),
  });
});

afterAll(() => {
  disposeSqliteFile(sqlite, dbPath);
});

describe('migration 0037 — trade_executions.idempotency_key', () => {
  it('is registered in the drizzle journal at idx 37 with version 8', () => {
    const meta = JSON.parse(
      readFileSync(
        join(process.cwd(), 'src/db/migrations/meta/_journal.json'),
        'utf8'
      )
    ) as { version: string; entries: { idx: number; version: string; tag: string }[] };

    expect(meta.version).toBe('9');
    const entry = meta.entries.find((e) => e.idx === 37);
    expect(entry).toBeDefined();
    expect(entry?.tag).toBe('0037_execution_idempotency');
    expect(entry?.version).toBe('8');
  });

  it('adds a nullable idempotency_key TEXT column to trade_executions', () => {
    const cols = sqlite.prepare('PRAGMA table_info(trade_executions)').all() as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const col = cols.find((c) => c.name === 'idempotency_key');
    expect(col).toBeDefined();
    expect(col?.type).toBe('TEXT');
    expect(col?.notnull).toBe(0); // nullable — legacy rows and opt-out clients keep NULL
  });

  it('creates the uq_trade_executions_idempotency_key unique index', () => {
    const idx = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'uq_trade_executions_idempotency_key'"
      )
      .get();
    expect(idx).toBeDefined();
  });

  it('enforces uniqueness on non-NULL idempotency keys', () => {
    const accountId = 'acc-ip-test';
    const tradeId = 'trade-ip-test';
    sqlite
      .prepare('INSERT INTO accounts (id, name, starting_balance) VALUES (?, ?, ?)')
      .run(accountId, 'Idempotency Test', 100000);
    sqlite
      .prepare(
        `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status)
         VALUES (?, ?, ?, 'AAPL', 'long', 'planned')`
      )
      .run(tradeId, 'TC-IP-1', accountId);
    const insert = sqlite.prepare(
      `INSERT INTO trade_executions (id, trade_id, action, quantity, price, idempotency_key)
       VALUES (?, ?, 'buy', 100, 150.25, ?)`
    );
    insert.run('exec-ip-1', tradeId, 'key-abc');
    // Duplicate non-NULL key must be rejected (replay protection).
    expect(() => insert.run('exec-ip-2', tradeId, 'key-abc')).toThrow(/UNIQUE/i);
  });

  it('allows multiple NULL idempotency keys (legacy rows)', () => {
    const tradeId = 'trade-ip-test';
    const insert = sqlite.prepare(
      `INSERT INTO trade_executions (id, trade_id, action, quantity, price, idempotency_key)
       VALUES (?, ?, 'sell', 100, 155.0, NULL)`
    );
    expect(() => insert.run('exec-ip-3', tradeId)).not.toThrow();
    expect(() => insert.run('exec-ip-4', tradeId)).not.toThrow();
  });

  it('exposes idempotencyKey on the drizzle tradeExecutions model', () => {
    // Type-level parity: a full $inferSelect row must carry idempotencyKey.
    type ExecutionRow = typeof schema.tradeExecutions.$inferSelect;
    const row: ExecutionRow = {
      id: 'exec-ip-schema',
      tradeId: 'trade-ip-test',
      executedAt: null,
      action: 'buy',
      quantity: 100,
      price: 150.25,
      fees: 0,
      reasonId: null,
      notes: null,
      idempotencyKey: null,
      createdAt: null,
    };
    expect(row.idempotencyKey).toBeNull();

    // Column-name mapping parity.
    const model = schema.tradeExecutions;
    expect(model.idempotencyKey.name).toBe('idempotency_key');
  });
});
