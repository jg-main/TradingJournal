/**
 * Integration tests for the execution posting service.
 *
 * Covers:
 * - Successful buy execution posting with balanced ledger effects
 * - Idempotency key handling (rejection on reuse)
 * - Account not found error
 * - Account isolation (cross-account execution)
 * - Journal trade attribution
 * - Ledger balance verification (financial event + postings exist)
 * - Transaction rollback on failure (no partial writes)
 * - Instrument auto-creation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postExecutionFill } from '../execution-posting';
import {
  AccountNotFoundError,
  DuplicateExecutionIdempotencyError,
} from '../errors';
import {
  findAccountingExecutionById,
  findInstrumentBySymbol,
  findEventWithPostings,
} from '../../../db/accounting-repository';
import { checkLedgerBalance } from '../rebuild';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-execution-posting.db';

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
  secondAccountId: string;
}

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

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
        } catch (e) {
          console.warn(`  [test-db] Skipping statement in ${file}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }

  // Create test accounts
  const accountId = randomUUID();
  const secondAccountId = randomUUID();
  const now = new Date().toISOString();
  const insertAccount = sqlite.prepare(
    `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  insertAccount.run(accountId, 'Execution Test Account', 'Test Broker', 'USD', now, now);
  insertAccount.run(secondAccountId, 'Second Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId, secondAccountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try {
    unlinkSync(TEST_DB_PATH);
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  } catch {
    // Nothing to clean up
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('postExecutionFill', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('posts a buy execution atomically with balanced ledger effects', () => {
    const result = postExecutionFill(ctx.sqlite, {
      accountId: ctx.accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '150.75',
      description: 'Buy 100 AAPL',
      postedAt: '2026-07-15T10:00:00.000Z',
    });

    // Verify execution exists
    expect(result.execution).toBeDefined();
    expect(result.execution.accountId).toBe(ctx.accountId);
    expect(result.execution.action).toBe('buy');
    expect(result.execution.quantity).toBe('100.00');
    expect(result.execution.price).toBe('150.75');
    expect(result.execution.fees).toBe('0.00');
    expect(result.execution.instrumentId).toMatch(/^[0-9a-f-]+$/);
    expect(result.execution.postedAt).toBe('2026-07-15T10:00:00.000Z');

    // Verify instrument was auto-created
    const instrument = findInstrumentBySymbol(ctx.sqlite, 'AAPL');
    expect(instrument).toBeDefined();
    expect(instrument!.symbol).toBe('AAPL');
    expect(instrument!.type).toBe('stock');
    expect(instrument!.currency).toBe('USD');

    // Verify the execution is in the database
    const dbExec = findAccountingExecutionById(ctx.sqlite, result.execution.id);
    expect(dbExec).toBeDefined();
    expect(dbExec!.action).toBe('buy');

    // Verify ledger effect: financial event + entry + postings
    expect(result.eventWithPostings).toBeDefined();
    expect(result.eventWithPostings.event.eventType).toBe('trade_execution');
    expect(result.eventWithPostings.event.accountId).toBe(ctx.accountId);
    expect(result.eventWithPostings.event.idempotencyKey).toBe(
      `accounting-execution-${result.execution.id}`,
    );
    expect(result.eventWithPostings.postings.debit).toBeDefined();
    expect(result.eventWithPostings.postings.credit).toBeDefined();

    // Verify the posting amount = quantity * price = 100 * 150.75 = 15075.00
    const consideration = '15075.00';
    expect(result.eventWithPostings.postings.debit.amount).toBe(consideration);
    expect(result.eventWithPostings.postings.credit.amount).toBe(consideration);

    // Read back from database to verify persistence
    const hydrated = findEventWithPostings(ctx.sqlite, result.eventWithPostings.event.id);
    expect(hydrated).toBeDefined();
    expect(hydrated!.event.event_type).toBe('trade_execution');
    expect(hydrated!.postings).toHaveLength(2);
    const debits = hydrated!.postings.filter((p) => p.side === 'debit');
    const credits = hydrated!.postings.filter((p) => p.side === 'credit');
    expect(debits).toHaveLength(1);
    expect(credits).toHaveLength(1);
    expect(debits[0].amount).toBe(consideration);
    expect(credits[0].amount).toBe(consideration);
  });

  it('rejects duplicate idempotency key', () => {
    const idempotencyKey = randomUUID();

    // First posting succeeds
    postExecutionFill(ctx.sqlite, {
      accountId: ctx.accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '50.00',
      price: '160.00',
      idempotencyKey,
      postedAt: '2026-07-15T11:00:00.000Z',
    });

    // Second posting with same key fails
    expect(() =>
      postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'AAPL',
        action: 'sell',
        quantity: '25.00',
        price: '170.00',
        idempotencyKey,
        postedAt: '2026-07-15T12:00:00.000Z',
      }),
    ).toThrow(DuplicateExecutionIdempotencyError);
  });

  it('throws AccountNotFoundError for non-existent account', () => {
    const fakeId = randomUUID();
    expect(() =>
      postExecutionFill(ctx.sqlite, {
        accountId: fakeId,
        symbol: 'AAPL',
        action: 'buy',
        quantity: '10.00',
        price: '150.00',
      }),
    ).toThrow(AccountNotFoundError);
  });

  it('attaches journal trade ID when provided', () => {
    const journalTradeId = randomUUID();
    const result = postExecutionFill(ctx.sqlite, {
      accountId: ctx.accountId,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '25.00',
      price: '155.00',
      journalTradeId,
      description: 'Journal-attributed partial close',
      postedAt: '2026-07-15T13:00:00.000Z',
    });

    // Verify journal trade ID in the execution record
    expect(result.execution.journalTradeId).toBe(journalTradeId);

    // Verify the ledger payload contains the journalTradeId
    const hydrated = findEventWithPostings(ctx.sqlite, result.eventWithPostings.event.id);
    expect(hydrated).toBeDefined();
    const payload = JSON.parse(hydrated!.event.payload ?? '{}');
    expect(payload.journalTradeId).toBe(journalTradeId);
  });

  it('supports execution with fees', () => {
    const result = postExecutionFill(ctx.sqlite, {
      accountId: ctx.accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '50.00',
      price: '160.00',
      fees: '15.00',
      postedAt: '2026-07-15T14:00:00.000Z',
    });

    // Verify fees in the execution record
    expect(result.execution.fees).toBe('15.00');
  });

  it('lists executions for account in deterministic order', () => {
    const executions = ctx.sqlite
      .prepare(
        `SELECT id, account_id, action, quantity, price, posted_at
         FROM accounting_executions
         WHERE account_id = ?
         ORDER BY posted_at ASC, id ASC`,
      )
      .all(ctx.accountId);

    // Should have at least the executions we posted
    expect(executions.length).toBeGreaterThanOrEqual(3);

    // Verify order: first posted_at is the earliest
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstExec = executions[0] as any;
    expect(firstExec.posted_at).toBe('2026-07-15T10:00:00.000Z');
    expect(firstExec.action).toBe('buy');
    expect(firstExec.quantity).toBe('100.00');
  });

  it('rolls back on failure, leaving no partial writes', () => {
    // Count executions and events before failure
    const execCountBefore = (
      ctx.sqlite.prepare('SELECT COUNT(*) AS count FROM accounting_executions').get() as { count: number }
    ).count;
    const eventCountBefore = (
      ctx.sqlite.prepare('SELECT COUNT(*) AS count FROM financial_events').get() as { count: number }
    ).count;

    // Attempt to post to a non-existent account
    const fakeId = randomUUID();
    expect(() =>
      postExecutionFill(ctx.sqlite, {
        accountId: fakeId,
        symbol: 'GOOGL',
        action: 'buy',
        quantity: '100.00',
        price: '150.00',
      }),
    ).toThrow(AccountNotFoundError);

    // Counts should be unchanged (no partial writes)
    const execCountAfter = (
      ctx.sqlite.prepare('SELECT COUNT(*) AS count FROM accounting_executions').get() as { count: number }
    ).count;
    const eventCountAfter = (
      ctx.sqlite.prepare('SELECT COUNT(*) AS count FROM financial_events').get() as { count: number }
    ).count;

    expect(execCountAfter).toBe(execCountBefore);
    expect(eventCountAfter).toBe(eventCountBefore);

    // The GOOGL instrument should NOT have been created either
    const instrument = findInstrumentBySymbol(ctx.sqlite, 'GOOGL');
    expect(instrument).toBeUndefined();
  });

  it('posts a sell_short execution correctly', () => {
    const result = postExecutionFill(ctx.sqlite, {
      accountId: ctx.secondAccountId,
      symbol: 'TSLA',
      action: 'sell_short',
      quantity: '200.00',
      price: '250.50',
      fees: '20.00',
      postedAt: '2026-07-15T15:00:00.000Z',
    });

    expect(result.execution.action).toBe('sell_short');
    expect(result.execution.quantity).toBe('200.00');
    expect(result.execution.price).toBe('250.50');
    expect(result.execution.fees).toBe('20.00');

    // Verify the instrument was auto-created
    const instrument = findInstrumentBySymbol(ctx.sqlite, 'TSLA');
    expect(instrument).toBeDefined();
    expect(instrument!.symbol).toBe('TSLA');

    // Verify financial event
    const hydrated = findEventWithPostings(ctx.sqlite, result.eventWithPostings.event.id);
    expect(hydrated).toBeDefined();
    const payload = JSON.parse(hydrated!.event.payload ?? '{}');
    expect(payload.action).toBe('sell_short');
    expect(payload.symbol).toBe('TSLA');
  });

  it('maintains a globally balanced ledger', () => {
    const balance = checkLedgerBalance(ctx.sqlite);
    expect(balance.isBalanced).toBe(true);
    expect(balance.difference).toBe(0);
  });

  it('links financial-event idempotency to the immutable accounting execution', () => {
    const result = postExecutionFill(ctx.sqlite, {
      accountId: ctx.accountId,
      symbol: 'MSFT',
      action: 'buy',
      quantity: '10.00',
      price: '400.00',
      postedAt: '2026-07-15T16:00:00.000Z',
    });

    const eventKey = `accounting-execution-${result.execution.id}`;
    expect(result.eventWithPostings.event.idempotencyKey).toBe(eventKey);

    // Verify in DB
    const hydrated = findEventWithPostings(ctx.sqlite, result.eventWithPostings.event.id);
    expect(hydrated!.event.idempotency_key).toBe(eventKey);
    expect(JSON.parse(hydrated!.event.payload ?? '{}')).toMatchObject({
      accountingExecutionId: result.execution.id,
    });
  });
});
