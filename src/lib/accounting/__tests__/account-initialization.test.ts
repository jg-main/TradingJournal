/**
 * Account initialization service tests (A2).
 *
 * Proves the product invariant: recording the opening balance completes
 * account initialization as ONE authoritative server-side transaction.
 *
 * - Opening-balance path: active = true, exactly one opening_balance event
 * - Start-with-zero path: active = true, zero financial events
 * - Atomicity: activation failure rolls back the posting; posting failure
 *   leaves the account inactive — no persisted "funded but inactive" state
 * - Duplicate initialization is rejected; deactivated historical accounts
 *   are never accidentally reactivated
 * - Replays with the same idempotency identity never duplicate state
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initializeAccount, assertPristineDraft } from '../account-initialization';
import {
  AccountAlreadyInitializedError,
  DuplicateIdempotencyKeyError,
  UnsupportedAccountCurrencyError,
  AccountInitializationProjectionError,
} from '../errors';
import { findAccountPerformance, listAccountEvents } from '../../../db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-account-initialization.db';

interface TestContext {
  sqlite: Database.Database;
  draftAccountId: string;
  /** Legacy EUR draft (USD-only contract: initialization must reject it). */
  eurDraftAccountId: string;
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
          // dependency ordering between migrations — safe to skip
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

  const draftAccountId = randomUUID();
  const eurDraftAccountId = randomUUID();
  const now = new Date().toISOString();
  const insertAccount = sqlite.prepare(
    `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  );
  insertAccount.run(draftAccountId, 'Draft Account', 'Broker', 'USD', now, now);
  // Legacy EUR draft: pre-dates the USD-only contract; preserved, never
  // rewritten, and blocked from initialization.
  insertAccount.run(eurDraftAccountId, 'Legacy EUR Draft', 'Broker', 'EUR', now, now);

  return { sqlite, draftAccountId, eurDraftAccountId };
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

// ── Fixture helpers ─────────────────────────────────────────────────────

function accountRow(sqlite: Database.Database, accountId: string): {
  is_active: number;
  currency: string | null;
} {
  return sqlite
    .prepare('SELECT is_active, currency FROM accounts WHERE id = ?')
    .get(accountId) as { is_active: number; currency: string | null };
}

function countFinancialEvents(sqlite: Database.Database, accountId: string): number {
  return listAccountEvents(sqlite, accountId).length;
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

/** Create a pristine draft account in the shared test DB. */
function createDraft(sqlite: Database.Database): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, `Draft ${id.slice(0, 8)}`, 'Broker', 'USD', now, now);
  return id;
}

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(ctx.sqlite);
});

// ── Opening-balance initialization succeeds ─────────────────────────────

describe('opening-balance initialization', () => {
  it('activates the account and posts exactly one opening_balance aggregate', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    const result = initializeAccount(sqlite, {
      accountId,
      mode: 'opening_balance',
      amount: '10000.00',
      description: 'Initial capital',
    });

    expect(result.isActive).toBe(true);
    expect(result.openingBalance).not.toBeNull();
    expect(result.openingBalance?.event.eventType).toBe('opening_balance');
    expect(result.openingBalance?.entry).toBeDefined();
    expect(result.openingBalance?.postings.debit.amount).toBe('10000.00');
    expect(result.openingBalance?.postings.credit.amount).toBe('10000.00');
    expect(result.openingBalance?.postings.debit.amountMicros).toBe(10_000_000_000);
    expect(result.openingBalance?.postings.credit.amountMicros).toBe(10_000_000_000);

    // Account is active; exactly one opening_balance event exists.
    expect(accountRow(sqlite, accountId).is_active).toBe(1);
    expect(countFinancialEvents(sqlite, accountId)).toBe(1);

    // Balanced double-entry postings persisted.
    const ledger = countLedgerRows(sqlite, accountId);
    expect(ledger.entries).toBe(1);
    expect(ledger.postings).toBe(2);

    // Canonical projection: rebuilt INSIDE the initialization transaction and
    // exposed on the result — cash = NAV = 10000, P&L = 0 (A2.1).
    expect(result.performance.success).toBe(true);
    expect(result.performance.nav).toBe('10000.00');
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection).toBeDefined();
    expect(projection?.net_cash).toBe('10000.00');
    expect(projection?.nav).toBe('10000.00');
    expect(projection?.realized_pnl).toBe('0.00');
    expect(projection?.total_pnl).toBe('0.00');
  });

  it('rejects a second opening-balance initialization (no opening_balance #2)', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '5000.00' });
    expect(countFinancialEvents(sqlite, accountId)).toBe(1);

    expect(() =>
      initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '9999.00' }),
    ).toThrow(AccountAlreadyInitializedError);

    // The second attempt created nothing.
    expect(countFinancialEvents(sqlite, accountId)).toBe(1);
    expect(accountRow(sqlite, accountId).is_active).toBe(1);
  });

  it('does not consume the idempotency key when posting fails and rolls back', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);
    const idempotencyKey = randomUUID();

    // Force the posting to fail inside the transaction.
    sqlite.exec(`
      CREATE TRIGGER a2_force_posting_fail BEFORE INSERT ON financial_events
      BEGIN SELECT RAISE(ABORT, 'forced posting failure'); END;
    `);

    expect(() =>
      initializeAccount(sqlite, {
        accountId,
        mode: 'opening_balance',
        amount: '5000.00',
        idempotencyKey,
      }),
    ).toThrow(/forced posting failure/);
    sqlite.exec('DROP TRIGGER a2_force_posting_fail');

    // The idempotency key was not consumed (event rolled back)…
    const row = sqlite
      .prepare('SELECT id FROM financial_events WHERE idempotency_key = ?')
      .get(idempotencyKey);
    expect(row).toBeUndefined();

    // …and a retry with the same key succeeds exactly once.
    initializeAccount(sqlite, {
      accountId,
      mode: 'opening_balance',
      amount: '5000.00',
      idempotencyKey,
    });
    expect(countFinancialEvents(sqlite, accountId)).toBe(1);
  });

  it('rejects initialization of a legacy non-USD draft (USD-only contract)', () => {
    const sqlite = ctx.sqlite;
    expect(() =>
      initializeAccount(sqlite, {
        accountId: ctx.eurDraftAccountId,
        mode: 'opening_balance',
        amount: '1000.00',
      }),
    ).toThrow(UnsupportedAccountCurrencyError);

    // No event was created and the account was not activated.
    expect(countFinancialEvents(sqlite, ctx.eurDraftAccountId)).toBe(0);
    expect(accountRow(sqlite, ctx.eurDraftAccountId).is_active).toBe(0);
  });
});

// ── Start-with-zero ─────────────────────────────────────────────────────

describe('start-with-zero initialization', () => {
  it('activates the account with zero financial events', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    const result = initializeAccount(sqlite, { accountId, mode: 'zero' });

    expect(result.isActive).toBe(true);
    expect(result.openingBalance).toBeNull();
    expect(accountRow(sqlite, accountId).is_active).toBe(1);
    expect(countFinancialEvents(sqlite, accountId)).toBe(0);

    // No ledger rows fabricated.
    const ledger = countLedgerRows(sqlite, accountId);
    expect(ledger.entries).toBe(0);
    expect(ledger.postings).toBe(0);

    // Canonical projection rebuilt inside the transaction: zero cash/NAV
    // (A2.1). The result proves the rebuild succeeded.
    expect(result.performance.success).toBe(true);
    expect(result.performance.nav).toBe('0.00');
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection).toBeDefined();
    expect(projection?.net_cash).toBe('0.00');
    expect(projection?.nav).toBe('0.00');
  });

  it('rejects start-with-zero on an already-initialized account', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    initializeAccount(sqlite, { accountId, mode: 'zero' });
    expect(() => initializeAccount(sqlite, { accountId, mode: 'zero' })).toThrow(
      AccountAlreadyInitializedError,
    );
  });
});

// ── Atomicity / rollback ────────────────────────────────────────────────

describe('atomicity (no funded-but-inactive state)', () => {
  it('rolls back the opening-balance posting when activation fails', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    // Force the activation UPDATE to fail inside the transaction.
    sqlite.exec(`
      CREATE TRIGGER a2_force_activation_fail BEFORE UPDATE ON accounts
      WHEN NEW.is_active = 1 BEGIN SELECT RAISE(ABORT, 'forced activation failure'); END;
    `);

    expect(() =>
      initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '10000.00' }),
    ).toThrow(/forced activation failure/);
    sqlite.exec('DROP TRIGGER a2_force_activation_fail');

    // Neither side committed: no event, no entry, no postings, still draft.
    expect(countFinancialEvents(sqlite, accountId)).toBe(0);
    const ledger = countLedgerRows(sqlite, accountId);
    expect(ledger.entries).toBe(0);
    expect(ledger.postings).toBe(0);
    expect(accountRow(sqlite, accountId).is_active).toBe(0);
  });

  it('leaves the account inactive when the financial posting fails', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    sqlite.exec(`
      CREATE TRIGGER a2_force_posting_fail BEFORE INSERT ON financial_events
      BEGIN SELECT RAISE(ABORT, 'forced posting failure'); END;
    `);

    expect(() =>
      initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '10000.00' }),
    ).toThrow(/forced posting failure/);
    sqlite.exec('DROP TRIGGER a2_force_posting_fail');

    expect(accountRow(sqlite, accountId).is_active).toBe(0);
    expect(countFinancialEvents(sqlite, accountId)).toBe(0);
  });

  it('rolls back the activation when the posting is invalid', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    // Invalid amount throws before any mutation — account stays inactive.
    expect(() =>
      initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '0.00' }),
    ).toThrow(/must be positive|Invalid amount|Micros/);

    expect(accountRow(sqlite, accountId).is_active).toBe(0);
    expect(countFinancialEvents(sqlite, accountId)).toBe(0);
  });
});

// ── Eligibility guard ───────────────────────────────────────────────────

describe('pristine-draft eligibility guard', () => {
  it('rejects an already-active account', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);
    initializeAccount(sqlite, { accountId, mode: 'zero' });

    expect(() => assertPristineDraft(sqlite, accountId)).toThrow(
      AccountAlreadyInitializedError,
    );
  });

  it('rejects a deactivated historical account with financial history', () => {
    const sqlite = ctx.sqlite;
    // Deactivated account that previously had an opening balance (legacy
    // two-step lifecycle): it is NOT a new draft.
    const accountId = createDraft(sqlite);
    initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '1000.00' });
    sqlite
      .prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), accountId);

    expect(() =>
      initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '2000.00' }),
    ).toThrow(AccountAlreadyInitializedError);

    // Remains inactive with no new opening balance.
    expect(accountRow(sqlite, accountId).is_active).toBe(0);
    expect(countFinancialEvents(sqlite, accountId)).toBe(1);
  });

  it('rejects an account with existing trade history', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        `A2TEST-${Date.now()}`, accountId, 'AAPL', 'long', 'planned', now, now,
      );

    expect(() => assertPristineDraft(sqlite, accountId)).toThrow(
      AccountAlreadyInitializedError,
    );
  });
});

// ── A2.1: projection rebuild is part of the initialization transaction ──

describe('projection rebuild inside the initialization transaction (A2.1)', () => {
  it('C: projection failure rolls back the opening-balance initialization entirely', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    // Force the account-performance projection write to fail inside the
    // transaction (scoped to this account so other fixtures are unaffected).
    sqlite.exec(`
      CREATE TRIGGER a21_force_projection_fail BEFORE INSERT ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END;
    `);

    expect(() =>
      initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '10000.00' }),
    ).toThrow(AccountInitializationProjectionError);
    sqlite.exec('DROP TRIGGER a21_force_projection_fail');

    // Nothing committed: account inactive, zero events, zero ledger rows, no
    // projection row. No funded-but-unprojected account may remain.
    expect(accountRow(sqlite, accountId).is_active).toBe(0);
    expect(countFinancialEvents(sqlite, accountId)).toBe(0);
    const ledger = countLedgerRows(sqlite, accountId);
    expect(ledger.entries).toBe(0);
    expect(ledger.postings).toBe(0);
    expect(findAccountPerformance(sqlite, accountId)).toBeUndefined();
  });

  it('D: projection failure rolls back a zero-mode initialization', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    sqlite.exec(`
      CREATE TRIGGER a21_force_projection_fail BEFORE INSERT ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END;
    `);

    expect(() => initializeAccount(sqlite, { accountId, mode: 'zero' })).toThrow(
      AccountInitializationProjectionError,
    );
    sqlite.exec('DROP TRIGGER a21_force_projection_fail');

    // Account remains inactive; no projection row and no events.
    expect(accountRow(sqlite, accountId).is_active).toBe(0);
    expect(countFinancialEvents(sqlite, accountId)).toBe(0);
    expect(findAccountPerformance(sqlite, accountId)).toBeUndefined();
  });

  it('E: retry succeeds after a failed rebuild rolls back', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    sqlite.exec(`
      CREATE TRIGGER a21_force_projection_fail BEFORE INSERT ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END;
    `);
    expect(() =>
      initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '10000.00' }),
    ).toThrow(AccountInitializationProjectionError);
    sqlite.exec('DROP TRIGGER a21_force_projection_fail');

    // Retry with the projection healthy: succeeds with exactly one opening
    // balance and a coherent projection.
    const result = initializeAccount(sqlite, {
      accountId,
      mode: 'opening_balance',
      amount: '10000.00',
    });
    expect(result.isActive).toBe(true);
    expect(result.performance.success).toBe(true);
    expect(countFinancialEvents(sqlite, accountId)).toBe(1);
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.net_cash).toBe('10000.00');
    expect(projection?.nav).toBe('10000.00');
  });

  it('F: a failed initialization does not consume the idempotency key', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);
    const idempotencyKey = randomUUID();

    sqlite.exec(`
      CREATE TRIGGER a21_force_projection_fail BEFORE INSERT ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END;
    `);
    expect(() =>
      initializeAccount(sqlite, {
        accountId,
        mode: 'opening_balance',
        amount: '5000.00',
        idempotencyKey,
      }),
    ).toThrow(AccountInitializationProjectionError);
    sqlite.exec('DROP TRIGGER a21_force_projection_fail');

    // The key was not consumed (the event row rolled back)…
    const row = sqlite
      .prepare('SELECT id FROM financial_events WHERE idempotency_key = ?')
      .get(idempotencyKey);
    expect(row).toBeUndefined();

    // …and a retry with the SAME key succeeds exactly once.
    const result = initializeAccount(sqlite, {
      accountId,
      mode: 'opening_balance',
      amount: '5000.00',
      idempotencyKey,
    });
    expect(result.performance.success).toBe(true);
    expect(countFinancialEvents(sqlite, accountId)).toBe(1);
    expect(accountRow(sqlite, accountId).is_active).toBe(1);
  });
});
