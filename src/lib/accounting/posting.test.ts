/**
 * Tests for the balanced immutable posting kernel.
 *
 * Covers:
 * - Pure validation logic (validatePostingAmount)
 * - Successful opening balance posting with balanced debit/credit
 * - Duplicate idempotency key rejection
 * - Missing account error
 * - Invalid amount error (malformed, non-positive)
 * - Sequence ordering
 * - Transaction integrity (no partial events on failure)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postOpeningBalance, validatePostingAmount } from './posting';
import {
  DuplicateIdempotencyKeyError,
  AccountNotFoundError,
  InvalidAmountError,
  InvalidMicrosBoundsError,
} from './errors';
import {
  findEventWithPostings,
  findPostingsByEntryId,
} from '../../db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

// Use a file-based temp DB so better-sqlite3 transactions with WAL work
const TEST_DB_PATH = './.test-accounting-posting.db';

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
}

function createTestDatabase(): TestContext {
  // Remove any lingering test DB from a prior run
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Apply all migrations in order to build the full schema
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();

  for (const file of migrations) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // Split on Drizzle statement breakpoints
    const statements = sql.split('--> statement-breakpoint');
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed.length > 0) {
        try {
          sqlite.exec(trimmed);
        } catch (e) {
          // Some migrations may reference tables not yet created in
          // earlier migrations — that's expected and handled by ordering.
          // If it fails, it's a dependency ordering issue.
          console.warn(`  [test-db] Skipping statement in ${file}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }

  // Create a test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Test Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try {
    unlinkSync(TEST_DB_PATH);
    // Also clean up WAL/SHM files
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  } catch {
    // Nothing to clean up
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('validatePostingAmount (pure)', () => {
  it('accepts a valid canonical decimal', () => {
    const result = validatePostingAmount('10000.00');
    expect(result.amount).toBe('10000.00');
    expect(result.amountMicros).toBe(10_000_000_000);
  });

  it('accepts a small amount', () => {
    const result = validatePostingAmount('0.01');
    expect(result.amount).toBe('0.01');
    expect(result.amountMicros).toBe(10_000);
  });

  it('accepts a large amount within safe integer bounds', () => {
    const result = validatePostingAmount('9000000.00');
    expect(result.amount).toBe('9000000.00');
    expect(result.amountMicros).toBe(9_000_000_000_000);
  });

  it('rejects an amount that exceeds safe integer micros bounds', () => {
    // 9,999,999,999.99 → 9,999,999,999,990,000 micros exceeds Number.MAX_SAFE_INTEGER
    expect(() => validatePostingAmount('9999999999.99')).toThrow(InvalidMicrosBoundsError);
  });

  it('rejects a malformed decimal', () => {
    expect(() => validatePostingAmount('not-a-number')).toThrow(InvalidAmountError);
  });

  it('rejects an amount with wrong decimal places', () => {
    expect(() => validatePostingAmount('100.0')).toThrow(InvalidAmountError);
    expect(() => validatePostingAmount('100.000')).toThrow(InvalidAmountError);
  });

  it('rejects zero amount', () => {
    expect(() => validatePostingAmount('0.00')).toThrow(InvalidAmountError);
  });

  it('rejects negative amount', () => {
    expect(() => validatePostingAmount('-50.00')).toThrow(InvalidAmountError);
  });

  it('rejects empty string', () => {
    expect(() => validatePostingAmount('')).toThrow(InvalidAmountError);
  });
});

describe('postOpeningBalance', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('posts an opening balance atomically with balanced debit/credit', () => {
    const result = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '5000.00',
      description: 'Initial deposit',
    });

    // Verify event
    expect(result.event).toBeDefined();
    expect(result.event.accountId).toBe(ctx.accountId);
    expect(result.event.eventType).toBe('opening_balance');
    expect(result.event.description).toBe('Initial deposit');
    expect(result.event.id).toMatch(/^[0-9a-f-]+$/);

    // Verify entry
    expect(result.entry).toBeDefined();
    expect(result.entry.financialEventId).toBe(result.event.id);
    expect(result.entry.accountId).toBe(ctx.accountId);

    // Verify postings
    expect(result.postings.debit).toBeDefined();
    expect(result.postings.credit).toBeDefined();

    // Debit side
    expect(result.postings.debit.side).toBe('debit');
    expect(result.postings.debit.amount).toBe('5000.00');
    expect(result.postings.debit.amountMicros).toBe(5_000_000_000);
    expect(result.postings.debit.currency).toBe('USD');
    expect(result.postings.debit.sequence).toBeGreaterThanOrEqual(1);

    // Credit side — same amount (balanced)
    expect(result.postings.credit.side).toBe('credit');
    expect(result.postings.credit.amount).toBe('5000.00');
    expect(result.postings.credit.amountMicros).toBe(5_000_000_000);
    expect(result.postings.credit.currency).toBe('USD');
    expect(result.postings.credit.sequence).toBe(result.postings.debit.sequence + 1);
  });

  it('rejects a duplicate idempotency key', () => {
    const idempotencyKey = randomUUID();

    // First posting succeeds
    postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '1000.00',
      idempotencyKey,
      description: 'First attempt',
    });

    // Second posting with same key fails
    expect(() =>
      postOpeningBalance(ctx.sqlite, {
        accountId: ctx.accountId,
        amount: '2000.00',
        idempotencyKey,
        description: 'Duplicate attempt',
      }),
    ).toThrow(DuplicateIdempotencyKeyError);
  });

  it('rejects a non-existent account', () => {
    const fakeId = randomUUID();
    expect(() =>
      postOpeningBalance(ctx.sqlite, {
        accountId: fakeId,
        amount: '100.00',
      }),
    ).toThrow(AccountNotFoundError);
  });

  it('rejects a malformed amount string', () => {
    expect(() =>
      postOpeningBalance(ctx.sqlite, {
        accountId: ctx.accountId,
        amount: 'bad-amount',
      }),
    ).toThrow(InvalidAmountError);
  });

  it('rejects a zero amount', () => {
    expect(() =>
      postOpeningBalance(ctx.sqlite, {
        accountId: ctx.accountId,
        amount: '0.00',
      }),
    ).toThrow(InvalidAmountError);
  });

  it('uses the idempotency key when provided and returns unique events', () => {
    const key1 = randomUUID();
    const key2 = randomUUID();

    const result1 = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '2500.00',
      idempotencyKey: key1,
    });

    const result2 = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '3500.00',
      idempotencyKey: key2,
    });

    // Both should succeed and have different event IDs
    expect(result1.event.id).not.toBe(result2.event.id);
    expect(result1.postings.debit.amount).toBe('2500.00');
    expect(result2.postings.debit.amount).toBe('3500.00');
  });

  it('assigns sequential posting numbers', () => {
    // Post two events and verify sequence continues sequentially
    const keyA = randomUUID();
    const keyB = randomUUID();

    const r1 = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '100.00',
      idempotencyKey: keyA,
    });
    const r2 = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '200.00',
      idempotencyKey: keyB,
    });

    // Second event's postings should have higher sequences
    expect(r2.postings.debit.sequence).toBeGreaterThan(r1.postings.credit.sequence);
    // Each event should have consecutive sequences
    expect(r1.postings.credit.sequence).toBe(r1.postings.debit.sequence + 1);
    expect(r2.postings.credit.sequence).toBe(r2.postings.debit.sequence + 1);
  });

  it('persists all data to the database (read-back verification)', () => {
    const key = randomUUID();
    const postedAt = '2026-07-15T12:00:00.000Z';
    const result = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '7777.77',
      idempotencyKey: key,
      description: 'Read-back verification',
      postedAt,
    });

    // Read back the event
    const hydrated = findEventWithPostings(ctx.sqlite, result.event.id);
    expect(hydrated).toBeDefined();
    expect(hydrated!.event.event_type).toBe('opening_balance');
    expect(hydrated!.event.idempotency_key).toBe(key);
    expect(hydrated!.event.description).toBe('Read-back verification');

    // Read back postings
    const postings = findPostingsByEntryId(ctx.sqlite, hydrated!.entry.id);
    expect(postings).toHaveLength(2);

    const debit = postings.find((p: { side: string }) => p.side === 'debit');
    const credit = postings.find((p: { side: string }) => p.side === 'credit');
    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    expect(debit!.amount).toBe('7777.77');
    expect(debit!.amount_micros).toBe(7_777_770_000);
    expect(credit!.amount).toBe('7777.77');
    expect(credit!.amount_micros).toBe(7_777_770_000);

    // Verify the unique constraint on idempotency key in DB
    const dbRows = ctx.sqlite
      .prepare('SELECT count(*) AS count FROM financial_events WHERE idempotency_key = ?')
      .get(key) as { count: number };
    expect(dbRows.count).toBe(1);
  });

  it('rolls back on failure, leaving no partial event', () => {
    // Count events before the failed attempt
    const beforeCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;

    // Attempt a posting with a non-existent account — this should fail
    const fakeId = randomUUID();
    expect(() =>
      postOpeningBalance(ctx.sqlite, {
        accountId: fakeId,
        amount: '500.00',
      }),
    ).toThrow(AccountNotFoundError);

    // Event count should be unchanged (no partial events)
    const afterCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;
    expect(afterCount).toBe(beforeCount);

    // Ledger entries and postings should also be unchanged
    const entryCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM ledger_entries').get() as { count: number }
    ).count;
    const postingCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM ledger_postings').get() as { count: number }
    ).count;
    // These should be consistent with the event count
    expect(entryCount).toBe(beforeCount);
    // Each event has 1 entry with 2 postings
    expect(postingCount).toBe(beforeCount * 2);
  });
});
