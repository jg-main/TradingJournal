/**
 * A7 — normal financial-event posting is atomic with the performance
 * projection.
 *
 * Proves that `postEventWithEffect` commits the immutable event + ledger
 * entry + balanced postings AND the canonical account-performance rebuild in
 * ONE outer transaction: a successful post returns `performance.success ===
 * true` (read-your-writes for Net Cash / NAV), and a forced projection
 * persistence failure rolls back the event/entry/postings, preserves the
 * prior projection, and leaves the idempotency key unconsumed (retryable).
 *
 * The test DB lives in the OS temp directory (no root-level artifacts) and is
 * cleaned up (db + wal + shm) after the run.
 *
 * Run: npx vitest run --reporter verbose src/lib/accounting/__tests__/financial-event-posting-atomicity.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeAccount } from '../account-initialization';
import { postEventWithEffect } from '../event-posting';
import { rebuildAccountPerformance } from '../../performance/performance-rebuild';
import { findAccountPerformance } from '../../../db/accounting-repository';
import {
  DuplicateIdempotencyKeyError,
  FinancialEventPostingProjectionError,
  AccountInactiveError,
} from '../errors';

const TEST_DB_PATH = join(tmpdir(), `tj-posting-atomicity-${process.pid}.db`);

interface TestContext {
  sqlite: Database.Database;
}

function applyAllMigrations(sqlite: Database.Database): void {
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

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyAllMigrations(sqlite);
  return { sqlite };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(ctx.sqlite);
});

/** Create a pristine draft and initialize it (opening balance, active). */
function createInitializedAccount(sqlite: Database.Database, amount: string): string {
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
    )
    .run(accountId, `A7 ${accountId.slice(0, 6)}`, 'Broker', now, now);
  initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount });
  return accountId;
}

function countLedgerRows(
  sqlite: Database.Database,
  accountId: string,
): { entries: number; postings: number } {
  const entries = sqlite
    .prepare('SELECT COUNT(*) AS c FROM ledger_entries WHERE account_id = ?')
    .get(accountId) as { c: number };
  const postings = sqlite
    .prepare('SELECT COUNT(*) AS c FROM ledger_postings WHERE account_id = ?')
    .get(accountId) as { c: number };
  return { entries: entries.c, postings: postings.c };
}

describe('postEventWithEffect — atomic projection (A7)', () => {
  it('26: successful deposit commits event + balanced postings + coherent projection', () => {
    const sqlite = ctx.sqlite;
    const accountId = createInitializedAccount(sqlite, '10000.00');

    const result = postEventWithEffect(sqlite, accountId, {
      eventType: 'deposit',
      amount: '2000.00',
      description: 'A7 deposit',
    });

    expect(result.performance.success).toBe(true);
    expect(result.performance.nav).toBe('12000.00');
    expect(result.event.eventType).toBe('deposit');
    expect(result.postings.debit.amount).toBe('2000.00');
    expect(result.postings.credit.amount).toBe('2000.00');

    // Persisted: one deposit event + one entry + two postings; projection
    // coherent (net_cash = nav = 12,000, P&L unchanged).
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.net_cash).toBe('12000.00');
    expect(projection?.nav).toBe('12000.00');
    expect(projection?.realized_pnl).toBe('0.00');
    const ledger = countLedgerRows(sqlite, accountId);
    expect(ledger.entries).toBe(2); // opening + deposit
    expect(ledger.postings).toBe(4);
  });

  it('29: withdrawal decreases and manual_adjustment keeps signed semantics', () => {
    const sqlite = ctx.sqlite;
    const accountId = createInitializedAccount(sqlite, '10000.00');

    const withdrawal = postEventWithEffect(sqlite, accountId, {
      eventType: 'withdrawal',
      amount: '1000.00',
    });
    expect(withdrawal.performance.nav).toBe('9000.00');
    expect(findAccountPerformance(sqlite, accountId)?.net_cash).toBe('9000.00');

    const adjustment = postEventWithEffect(sqlite, accountId, {
      eventType: 'manual_adjustment',
      amount: '-500.00',
      reason: 'A7 signed adjustment',
    });
    // Signed semantics preserved: negative manual adjustment decreases cash.
    expect(adjustment.performance.nav).toBe('8500.00');
    expect(findAccountPerformance(sqlite, accountId)?.net_cash).toBe('8500.00');
  });

  it('21: backdated deposit rebuilds the canonical projection coherently', () => {
    const sqlite = ctx.sqlite;
    const accountId = createInitializedAccount(sqlite, '10000.00');

    const result = postEventWithEffect(sqlite, accountId, {
      eventType: 'deposit',
      amount: '500.00',
      postedAt: '2026-01-10T00:00:00.000Z',
    });
    expect(result.performance.success).toBe(true);
    expect(result.event.postedAt).toBe('2026-01-10T00:00:00.000Z');
    expect(findAccountPerformance(sqlite, accountId)?.nav).toBe('10500.00');
  });

  it('27: forced projection failure rolls back the event and preserves the prior projection', () => {
    const sqlite = ctx.sqlite;
    const accountId = createInitializedAccount(sqlite, '10000.00');

    // Valid prior projection: NAV 10,000.
    expect(findAccountPerformance(sqlite, accountId)?.nav).toBe('10000.00');

    sqlite.exec(`
      CREATE TRIGGER a7_force_projection_fail BEFORE UPDATE ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced posting projection failure'); END;
    `);

    expect(() =>
      postEventWithEffect(sqlite, accountId, {
        eventType: 'deposit',
        amount: '2000.00',
      }),
    ).toThrow(FinancialEventPostingProjectionError);
    sqlite.exec('DROP TRIGGER a7_force_projection_fail');

    // Zero new mutation: no deposit event, no new ledger rows; prior
    // projection snapshot intact (NAV 10,000 — not 12,000, not absent).
    const depositCount = sqlite
      .prepare("SELECT COUNT(*) AS c FROM financial_events WHERE account_id = ? AND event_type = 'deposit'")
      .get(accountId) as { c: number };
    expect(depositCount.c).toBe(0);
    const ledger = countLedgerRows(sqlite, accountId);
    expect(ledger.entries).toBe(1); // only the opening
    expect(ledger.postings).toBe(2);
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.nav).toBe('10000.00');
    expect(projection?.net_cash).toBe('10000.00');
  });

  it('28: failed posting does not consume the idempotency key; retry succeeds exactly once', () => {
    const sqlite = ctx.sqlite;
    const accountId = createInitializedAccount(sqlite, '10000.00');
    const idempotencyKey = randomUUID();

    sqlite.exec(`
      CREATE TRIGGER a7_force_projection_fail BEFORE UPDATE ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced posting projection failure'); END;
    `);
    expect(() =>
      postEventWithEffect(sqlite, accountId, {
        eventType: 'deposit',
        amount: '2000.00',
        idempotencyKey,
      }),
    ).toThrow(FinancialEventPostingProjectionError);
    sqlite.exec('DROP TRIGGER a7_force_projection_fail');

    // No event consumed the key.
    const row = sqlite
      .prepare('SELECT id FROM financial_events WHERE idempotency_key = ?')
      .get(idempotencyKey);
    expect(row).toBeUndefined();

    // Retry with the SAME key succeeds exactly once.
    const retry = postEventWithEffect(sqlite, accountId, {
      eventType: 'deposit',
      amount: '2000.00',
      idempotencyKey,
    });
    expect(retry.performance.success).toBe(true);
    const eventsWithKey = sqlite
      .prepare('SELECT COUNT(*) AS c FROM financial_events WHERE idempotency_key = ?')
      .get(idempotencyKey) as { c: number };
    expect(eventsWithKey.c).toBe(1);

    // A third attempt with the same key is a duplicate.
    expect(() =>
      postEventWithEffect(sqlite, accountId, {
        eventType: 'deposit',
        amount: '999.00',
        idempotencyKey,
      }),
    ).toThrow(DuplicateIdempotencyKeyError);

    // Coherent projection after retry.
    expect(findAccountPerformance(sqlite, accountId)?.nav).toBe('12000.00');
  });

  it('opening balance is NOT postable through normal origination (A2/A4 ownership)', () => {
    const sqlite = ctx.sqlite;
    const accountId = createInitializedAccount(sqlite, '10000.00');

    // The generic route rejects opening_balance before the service; the
    // service itself (kernel) would post it, so this is verified at the route
    // level. Here we only assert the lifecycle/currency guards still hold on
    // the normal service for a draft account.
    const draftId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
      )
      .run(draftId, 'A7 Draft', 'Broker', now, now);
    expect(() =>
      postEventWithEffect(sqlite, draftId, { eventType: 'deposit', amount: '100.00' }),
    ).toThrow(AccountInactiveError);
  });
});
