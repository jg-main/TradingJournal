/**
 * USD-only account currency contract tests (A1).
 *
 * Proves the financial-integrity boundary established by the USD-only
 * contract: the posting kernel, opening-balance path, and execution path
 * reject any financially meaningful activity on a legacy non-USD account
 * BEFORE writing any event/entry/posting/execution row, while USD accounts
 * continue to post normally with `currency = 'USD'` ledger postings.
 *
 * The legacy non-USD accounts are inserted directly as fixtures (the API
 * no longer permits creating them), mirroring real installations that have
 * EUR/GBP rows persisted before the contract existed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  postFinancialEvent,
  postOpeningBalance,
  assertSupportedAccountCurrency,
} from '../posting';
import { postExecutionFill } from '../execution-posting';
import {
  UnsupportedAccountCurrencyError,
  AccountNotFoundError,
} from '../errors';
import { isSupportedAccountCurrency } from '../currency-contract';
import {
  findEventByIdempotencyKey,
  findAccountingExecutionByIdempotencyKey,
  listAccountEvents,
} from '../../../db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-usd-currency-contract.db';

interface TestContext {
  sqlite: Database.Database;
  usdAccountId: string;
  eurAccountId: string;
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
        } catch {
          // dependency ordering between migrations — safe to skip
        }
      }
    }
  }

  const usdAccountId = randomUUID();
  const eurAccountId = randomUUID();
  const now = new Date().toISOString();
  const insertAccount = sqlite.prepare(
    `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  insertAccount.run(usdAccountId, 'USD Account', 'Broker', 'USD', now, now);
  // Legacy EUR fixture: pre-dates the USD-only contract and must be preserved
  // as-is (never rewritten), but must block new financially meaningful activity.
  insertAccount.run(eurAccountId, 'Legacy EUR Account', 'Broker', 'EUR', now, now);

  return { sqlite, usdAccountId, eurAccountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try {
    unlinkSync(TEST_DB_PATH);
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  } catch {
    // nothing to clean up
  }
}

// ── Fixture helpers ──────────────────────────────────────────────────────

function countFinancialEvents(sqlite: Database.Database, accountId: string): number {
  return listAccountEvents(sqlite, accountId).length;
}

function countLedgerRows(sqlite: Database.Database): { entries: number; postings: number } {
  const entries = sqlite
    .prepare('SELECT COUNT(*) AS c FROM ledger_entries')
    .get() as { c: number };
  const postings = sqlite
    .prepare('SELECT COUNT(*) AS c FROM ledger_postings')
    .get() as { c: number };
  return { entries: entries.c, postings: postings.c };
}

function countAccountingExecutions(sqlite: Database.Database, accountId: string): number {
  const row = sqlite
    .prepare('SELECT COUNT(*) AS c FROM accounting_executions WHERE account_id = ?')
    .get(accountId) as { c: number };
  return row.c;
}

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(ctx.sqlite);
});

// ── Contract primitives ─────────────────────────────────────────────────

describe('supported-currency contract primitives', () => {
  it('treats USD as the only supported account currency', () => {
    expect(isSupportedAccountCurrency('USD')).toBe(true);
    for (const other of ['EUR', 'GBP', 'CHF', 'JPY', 'COP', 'BRL']) {
      expect(isSupportedAccountCurrency(other)).toBe(false);
    }
    expect(isSupportedAccountCurrency(null)).toBe(false);
    expect(isSupportedAccountCurrency(undefined)).toBe(false);
  });

  it('accepts a USD account and rejects a legacy EUR account in the shared guard', () => {
    expect(() => assertSupportedAccountCurrency(ctx.sqlite, ctx.usdAccountId)).not.toThrow();
    expect(() => assertSupportedAccountCurrency(ctx.sqlite, ctx.eurAccountId)).toThrow(
      UnsupportedAccountCurrencyError,
    );
  });

  it('throws AccountNotFoundError for a missing account', () => {
    expect(() => assertSupportedAccountCurrency(ctx.sqlite, randomUUID())).toThrow(
      AccountNotFoundError,
    );
  });
});

// ── Posting kernel (financial events) ────────────────────────────────────

describe('posting kernel currency guard', () => {
  it('USD account: posts a deposit with currency USD ledger postings', () => {
    const result = postFinancialEvent(ctx.sqlite, {
      accountId: ctx.usdAccountId,
      eventType: 'deposit',
      amount: '100.00',
      description: 'USD deposit',
    });

    expect(result.postings.debit.currency).toBe('USD');
    expect(result.postings.credit.currency).toBe('USD');
    expect(result.event.eventType).toBe('deposit');
  });

  it('legacy EUR account: rejects a deposit with UnsupportedAccountCurrencyError', () => {
    const before = countLedgerRows(ctx.sqlite);
    const eventsBefore = countFinancialEvents(ctx.sqlite, ctx.eurAccountId);

    expect(() =>
      postFinancialEvent(ctx.sqlite, {
        accountId: ctx.eurAccountId,
        eventType: 'deposit',
        amount: '100.00',
        description: 'Should be rejected',
      }),
    ).toThrow(UnsupportedAccountCurrencyError);

    // Atomicity: no financial event, no ledger entry, no ledger postings.
    const after = countLedgerRows(ctx.sqlite);
    expect(after.entries).toBe(before.entries);
    expect(after.postings).toBe(before.postings);
    expect(countFinancialEvents(ctx.sqlite, ctx.eurAccountId)).toBe(eventsBefore);
  });

  it('legacy EUR account: rejects every financially meaningful event type', () => {
    const eventTypes = [
      'deposit',
      'withdrawal',
      'dividend',
      'interest',
      'fee',
      'tax',
      'manual_adjustment',
    ] as const;
    for (const eventType of eventTypes) {
      expect(() =>
        postFinancialEvent(ctx.sqlite, {
          accountId: ctx.eurAccountId,
          eventType,
          amount: '10.00',
          description: `${eventType} rejected`,
        }),
      ).toThrow(UnsupportedAccountCurrencyError);
    }
    // The EUR account must have zero events after all rejections.
    expect(countFinancialEvents(ctx.sqlite, ctx.eurAccountId)).toBe(0);
  });

  it('legacy EUR account: idempotency key is not consumed on rejection', () => {
    const key = `rejected-key-${randomUUID()}`;
    expect(() =>
      postFinancialEvent(ctx.sqlite, {
        accountId: ctx.eurAccountId,
        eventType: 'deposit',
        amount: '5.00',
        idempotencyKey: key,
      }),
    ).toThrow(UnsupportedAccountCurrencyError);

    // The key must remain unused so a later valid retry is not blocked.
    expect(findEventByIdempotencyKey(ctx.sqlite, key)).toBeUndefined();
  });
});

// ── Opening balance ─────────────────────────────────────────────────────

describe('opening balance currency guard', () => {
  it('USD account: posts opening balance with USD postings', () => {
    const result = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.usdAccountId,
      amount: '10000.00',
      description: 'USD opening balance',
    });
    expect(result.postings.debit.currency).toBe('USD');
    expect(result.postings.credit.currency).toBe('USD');
  });

  it('legacy EUR account: cannot post an opening balance', () => {
    const before = countLedgerRows(ctx.sqlite);
    expect(() =>
      postOpeningBalance(ctx.sqlite, {
        accountId: ctx.eurAccountId,
        amount: '10000.00',
        description: 'Must not create USD postings for an EUR account',
      }),
    ).toThrow(UnsupportedAccountCurrencyError);

    const after = countLedgerRows(ctx.sqlite);
    expect(after.entries).toBe(before.entries);
    expect(after.postings).toBe(before.postings);
  });
});

// ── Execution path ──────────────────────────────────────────────────────

describe('execution posting currency guard', () => {
  it('USD account: posts an execution with USD ledger postings', () => {
    const result = postExecutionFill(ctx.sqlite, {
      accountId: ctx.usdAccountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '10.00',
      price: '150.00',
      fees: '1.00',
    });
    expect(result.eventWithPostings.postings.debit.currency).toBe('USD');
    expect(result.eventWithPostings.postings.credit.currency).toBe('USD');
  });

  it('legacy EUR account: execution posting rejected before any ledger mutation', () => {
    const executionsBefore = countAccountingExecutions(ctx.sqlite, ctx.eurAccountId);
    const ledgerBefore = countLedgerRows(ctx.sqlite);
    const eventsBefore = countFinancialEvents(ctx.sqlite, ctx.eurAccountId);

    expect(() =>
      postExecutionFill(ctx.sqlite, {
        accountId: ctx.eurAccountId,
        symbol: 'MSFT',
        action: 'buy',
        quantity: '5.00',
        price: '200.00',
        fees: '0.00',
      }),
    ).toThrow(UnsupportedAccountCurrencyError);

    // No execution row, no ledger entry, no postings, no financial event.
    expect(countAccountingExecutions(ctx.sqlite, ctx.eurAccountId)).toBe(executionsBefore);
    const ledgerAfter = countLedgerRows(ctx.sqlite);
    expect(ledgerAfter.entries).toBe(ledgerBefore.entries);
    expect(ledgerAfter.postings).toBe(ledgerBefore.postings);
    expect(countFinancialEvents(ctx.sqlite, ctx.eurAccountId)).toBe(eventsBefore);
  });

  it('legacy EUR account: execution idempotency key is not consumed on rejection', () => {
    const key = `exec-rejected-${randomUUID()}`;
    expect(() =>
      postExecutionFill(ctx.sqlite, {
        accountId: ctx.eurAccountId,
        symbol: 'NVDA',
        action: 'buy',
        quantity: '1.00',
        price: '500.00',
        idempotencyKey: key,
      }),
    ).toThrow(UnsupportedAccountCurrencyError);
    expect(findAccountingExecutionByIdempotencyKey(ctx.sqlite, key)).toBeUndefined();
  });
});
