/**
 * End-to-end integration tests for the accounting ledger.
 *
 * Tests the full atomic posting pipeline end-to-end:
 * 1. Post opening balance through the real posting kernel
 * 2. Rebuild the projection from immutable ledger postings
 * 3. Verify deterministic rebuild (identical output from the same data)
 * 4. Verify immutability triggers reject UPDATE/DELETE
 * 5. Verify rollback on failure leaves no partial state
 * 6. Verify global ledger balance across multiple events
 *
 * Uses the real SQLite database (no mocks, no stubs).
 */

import { testDbPath } from '../../testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postOpeningBalance } from '../posting';
import { rebuildOpeningCash, checkLedgerBalance } from '../rebuild';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('accounting-integration');

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
  accountId2: string;
}

function applyAllMigrations(sqlite: Database.Database): void {
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();

  for (const file of migrations) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const statements = sql.split('--> statement-breakpoint');
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed.length > 0) {
        try {
          sqlite.exec(trimmed);
        } catch {
          // skip
        }
      }
    }
  }
}

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  applyAllMigrations(sqlite);

  // Create two test accounts
  const now = new Date().toISOString();
  const accountId = randomUUID();
  const accountId2 = randomUUID();

  const insertAccount = sqlite.prepare(
    `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );

  insertAccount.run(accountId, 'Primary Account', 'Broker A', 'USD', now, now);
  insertAccount.run(accountId2, 'Secondary Account', 'Broker B', 'USD', now, now);

  return { sqlite, accountId, accountId2 };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ── Integration Tests ───────────────────────────────────────────────────

describe('ledger integration — atomic posting + rebuild + immutability', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('1: posts opening balance and rebuilds the projection correctly', () => {
    const result = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '25000.00',
      idempotencyKey: randomUUID(),
      description: 'Initial funding',
    });

    // Verify the posting result
    expect(result.event.eventType).toBe('opening_balance');
    expect(result.postings.debit.amount).toBe('25000.00');
    expect(result.postings.credit.amount).toBe('25000.00');

    // Rebuild the projection
    const projection = rebuildOpeningCash(ctx.sqlite, ctx.accountId);

    expect(projection.totalOpeningCash).toBe('25000.00');
    expect(projection.totalOpeningCashMicros).toBe(25_000_000_000);
    expect(projection.events).toHaveLength(1);
    expect(projection.events[0].eventId).toBe(result.event.id);
  });

  it('2: handles multiple accounts independently', () => {
    // Post to Account 2
    postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId2,
      amount: '50000.00',
      idempotencyKey: randomUUID(),
      description: 'Secondary funding',
    });

    // Account 1 should still show 25000
    const proj1 = rebuildOpeningCash(ctx.sqlite, ctx.accountId);
    expect(proj1.totalOpeningCash).toBe('25000.00');

    // Account 2 should show 50000
    const proj2 = rebuildOpeningCash(ctx.sqlite, ctx.accountId2);
    expect(proj2.totalOpeningCash).toBe('50000.00');
  });

  it('3: idempotency key prevents duplicate posting', () => {
    const key = randomUUID();

    // First post succeeds
    postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '1000.00',
      idempotencyKey: key,
    });

    // Second post with same key throws
    expect(() => {
      postOpeningBalance(ctx.sqlite, {
        accountId: ctx.accountId,
        amount: '2000.00',
        idempotencyKey: key,
      });
    }).toThrow();

    // Projection should reflect only the first amount
    const projection = rebuildOpeningCash(ctx.sqlite, ctx.accountId);
    // 25000 + 1000 = 26000 (the second 2000 should NOT have been posted)
    expect(projection.totalOpeningCash).toBe('26000.00');
  });

  it('4: immutability triggers block all mutations', () => {
    // Get a financial_event ID
    const events = ctx.sqlite
      .prepare(
        `SELECT id FROM financial_events WHERE account_id = ? ORDER BY posted_at ASC`,
      )
      .all(ctx.accountId) as { id: string }[];

    expect(events.length).toBeGreaterThan(0);
    const eventId = events[0].id;

    // Try UPDATE on financial_events
    expect(() => {
      ctx.sqlite
        .prepare('UPDATE financial_events SET description = ? WHERE id = ?')
        .run('should fail', eventId);
    }).toThrow(/cannot update/i);

    // Try DELETE on financial_events
    expect(() => {
      ctx.sqlite
        .prepare('DELETE FROM financial_events WHERE id = ?')
        .run(eventId);
    }).toThrow(/cannot delete/i);
  });

  it('5: ledger remains globally balanced after multiple events', () => {
    const balance = checkLedgerBalance(ctx.sqlite);

    // Every posting is a balanced pair, so global sum should be equal
    expect(balance.isBalanced).toBe(true);
    expect(balance.debitTotal).toBeGreaterThan(0);
    expect(balance.debitTotal).toBe(balance.creditTotal);
    expect(balance.difference).toBe(0);
  });

  it('6: deterministic rebuild — same data produces identical projection', () => {
    const first = rebuildOpeningCash(ctx.sqlite, ctx.accountId);
    const second = rebuildOpeningCash(ctx.sqlite, ctx.accountId);

    // Structural fields must match
    expect(second.totalOpeningCash).toBe(first.totalOpeningCash);
    expect(second.totalOpeningCashMicros).toBe(first.totalOpeningCashMicros);
    expect(second.events).toHaveLength(first.events.length);

    // Every event must be identical (same IDs, amounts, sequences)
    for (let i = 0; i < first.events.length; i++) {
      expect(second.events[i].eventId).toBe(first.events[i].eventId);
      expect(second.events[i].amount).toBe(first.events[i].amount);
      expect(second.events[i].amountMicros).toBe(first.events[i].amountMicros);
      expect(second.events[i].sequence).toBe(first.events[i].sequence);
      expect(second.events[i].postedAt).toBe(first.events[i].postedAt);
    }
  });

  it('7: rollback on failure leaves no partial state', () => {
    // Count state before
    const beforeEventCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;

    // Attempt a posting that fails (invalid amount)
    expect(() => {
      postOpeningBalance(ctx.sqlite, {
        accountId: ctx.accountId,
        amount: 'not-a-number',
      });
    }).toThrow();

    // State should be unchanged
    const afterEventCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;

    expect(afterEventCount).toBe(beforeEventCount);
  });

  it('8: third account is completely isolated', () => {
    // Create a third account
    const thirdAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(thirdAccountId, 'Isolated Account', 'Test', 'USD', now, now);

    // Post 100k to it
    postOpeningBalance(ctx.sqlite, {
      accountId: thirdAccountId,
      amount: '100000.00',
      idempotencyKey: randomUUID(),
    });

    // Primary account should be unchanged
    const primaryProj = rebuildOpeningCash(ctx.sqlite, ctx.accountId);
    expect(primaryProj.totalOpeningCash).toBe('26000.00');

    // New account shows its own balance
    const thirdProj = rebuildOpeningCash(ctx.sqlite, thirdAccountId);
    expect(thirdProj.totalOpeningCash).toBe('100000.00');

    // Global balance still holds
    const balance = checkLedgerBalance(ctx.sqlite);
    expect(balance.isBalanced).toBe(true);
  });
});
