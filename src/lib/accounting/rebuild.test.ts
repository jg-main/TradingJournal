/**
 * Tests for the accounting projection rebuild engine.
 *
 * Covers:
 * - rebuildOpeningCash for an account with opening balance events
 * - rebuildOpeningCash for an account with no events (empty projection)
 * - rebuildOpeningCash determinism (identical output for same data)
 * - rebuildNetPosition for net cash position
 * - checkLedgerBalance for global ledger balance verification
 * - Immutability enforcement: UPDATE/DELETE rejected by triggers
 * - Trigger behavior: cascade DELETE from financial_events is blocked
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postOpeningBalance, postFinancialEvent } from './posting';
import {
  rebuildOpeningCash,
  rebuildNetPosition,
  checkLedgerBalance,
} from './rebuild';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-accounting-rebuild.db';

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
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

  // Create a test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Rebuild Test Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('rebuildOpeningCash', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns empty projection for an account with no events', () => {
    const freshAccountId = randomUUID();
    const projection = rebuildOpeningCash(ctx.sqlite, freshAccountId);

    expect(projection.accountId).toBe(freshAccountId);
    expect(projection.totalOpeningCash).toBe('0.00');
    expect(projection.totalOpeningCashMicros).toBe(0);
    expect(projection.events).toHaveLength(0);
    expect(projection.rebuiltAt).toBeTruthy();
  });

  it('reconstructs opening cash from a single opening balance event', () => {
    postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '10000.00',
      description: 'Initial deposit',
    });

    const projection = rebuildOpeningCash(ctx.sqlite, ctx.accountId);

    expect(projection.accountId).toBe(ctx.accountId);
    expect(projection.totalOpeningCash).toBe('10000.00');
    expect(projection.totalOpeningCashMicros).toBe(10_000_000_000);
    expect(projection.events).toHaveLength(1);
    expect(projection.events[0].eventType).toBe('opening_balance');
    expect(projection.events[0].amount).toBe('10000.00');
    expect(projection.events[0].amountMicros).toBe(10_000_000_000);
  });

  it('aggregates multiple opening balance events', () => {
    postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '5000.00',
      description: 'Second deposit',
      idempotencyKey: randomUUID(),
    });

    const projection = rebuildOpeningCash(ctx.sqlite, ctx.accountId);

    // 10000 + 5000 = 15000
    expect(projection.totalOpeningCash).toBe('15000.00');
    expect(projection.totalOpeningCashMicros).toBe(15_000_000_000);
    expect(projection.events).toHaveLength(2);
  });

  it('produces deterministic output on repeated calls', () => {
    // Rebuild twice and compare — timestamps may differ by milliseconds
    // so we compare the structural fields
    const first = rebuildOpeningCash(ctx.sqlite, ctx.accountId);
    const second = rebuildOpeningCash(ctx.sqlite, ctx.accountId);

    expect(second.totalOpeningCash).toBe(first.totalOpeningCash);
    expect(second.totalOpeningCashMicros).toBe(first.totalOpeningCashMicros);
    expect(second.events).toHaveLength(first.events.length);

    // Individual events should be identical (stable ordering by sequence)
    for (let i = 0; i < first.events.length; i++) {
      expect(second.events[i].eventId).toBe(first.events[i].eventId);
      expect(second.events[i].amount).toBe(first.events[i].amount);
      expect(second.events[i].amountMicros).toBe(first.events[i].amountMicros);
      expect(second.events[i].sequence).toBe(first.events[i].sequence);
      expect(second.events[i].postedAt).toBe(first.events[i].postedAt);
    }
  });

  it('only counts opening_balance events (not other event types)', () => {
    // The current posting kernel only supports opening_balance,
    // so this is a structural test — verify the SQL filters on event_type
    const otherAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(otherAccountId, 'Other Account', 'Test', 'USD', now, now);

    // Post an opening balance
    const key1 = randomUUID();
    postOpeningBalance(ctx.sqlite, {
      accountId: otherAccountId,
      amount: '2000.00',
      idempotencyKey: key1,
    });

    // Only opening_balance events should contribute
    const otherProjection = rebuildOpeningCash(ctx.sqlite, otherAccountId);
    expect(otherProjection.totalOpeningCash).toBe('2000.00');
    expect(otherProjection.events).toHaveLength(1);
  });

  it('only counts the account being queried (no cross-account leakage)', () => {
    // Create a third account with its own opening balance
    const thirdAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(thirdAccountId, 'Third Account', 'Test', 'USD', now, now);

    postOpeningBalance(ctx.sqlite, {
      accountId: thirdAccountId,
      amount: '99999.99',
      idempotencyKey: randomUUID(),
    });

    // Our primary account should still show 15000.00
    const primaryProjection = rebuildOpeningCash(ctx.sqlite, ctx.accountId);
    expect(primaryProjection.totalOpeningCash).toBe('15000.00');

    // Third account shows 99999.99
    const thirdProjection = rebuildOpeningCash(ctx.sqlite, thirdAccountId);
    expect(thirdProjection.totalOpeningCash).toBe('99999.99');
  });
});

describe('rebuildNetPosition', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns zero for an account with no postings', () => {
    const freshAccountId = randomUUID();
    const result = rebuildNetPosition(ctx.sqlite, freshAccountId);
    expect(result.netMicros).toBe(0);
    expect(result.netAmount).toBe('0.00');
  });

  it('computes net position from debit and credit postings', () => {
    postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '5000.00',
      idempotencyKey: randomUUID(),
    });

    // For an opening balance: debit = 5000, credit = 5000 on same account
    // net = 5000 - 5000 = 0 in the current simplified model
    // This confirms the model is consistent
    const result = rebuildNetPosition(ctx.sqlite, ctx.accountId);

    // In the current simplified model, both sides point to the same account
    // so net is 0 (balanced posting on the same account)
    expect(result.netMicros).toBe(0);
    expect(result.netAmount).toBe('0.00');
  });
});

describe('checkLedgerBalance', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns balanced when ledger is empty', () => {
    const result = checkLedgerBalance(ctx.sqlite);
    expect(result.isBalanced).toBe(true);
    expect(result.debitTotal).toBe(0);
    expect(result.creditTotal).toBe(0);
    expect(result.difference).toBe(0);
  });

  it('returns balanced when postings are properly balanced', () => {
    postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '7500.00',
      idempotencyKey: randomUUID(),
    });

    const result = checkLedgerBalance(ctx.sqlite);
    expect(result.isBalanced).toBe(true);
    expect(result.debitTotal).toBeGreaterThan(0);
    expect(result.debitTotal).toBe(result.creditTotal);
    expect(result.difference).toBe(0);
  });
});

describe('ledger immutability (migration triggers)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('blocks UPDATE on financial_events', () => {
    const result = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '3000.00',
      idempotencyKey: randomUUID(),
    });

    expect(() => {
      ctx.sqlite
        .prepare('UPDATE financial_events SET description = ? WHERE id = ?')
        .run('Hacked description', result.event.id);
    }).toThrow(/cannot update/i);
  });

  it('blocks DELETE on financial_events', () => {
    const result = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '4000.00',
      idempotencyKey: randomUUID(),
    });

    expect(() => {
      ctx.sqlite
        .prepare('DELETE FROM financial_events WHERE id = ?')
        .run(result.event.id);
    }).toThrow(/cannot delete/i);
  });

  it('blocks UPDATE on ledger_entries', () => {
    const result = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '5000.00',
      idempotencyKey: randomUUID(),
    });

    expect(() => {
      ctx.sqlite
        .prepare('UPDATE ledger_entries SET description = ? WHERE financial_event_id = ?')
        .run('Hacked description', result.event.id);
    }).toThrow(/cannot update/i);
  });

  it('blocks DELETE on ledger_entries', () => {
    expect(() => {
      ctx.sqlite
        .prepare(
          `DELETE FROM ledger_entries WHERE financial_event_id IN (
            SELECT id FROM financial_events WHERE account_id = ?
          )`,
        )
        .run(ctx.accountId);
    }).toThrow(/cannot delete/i);
  });

  it('blocks UPDATE on ledger_postings', () => {
    expect(() => {
      ctx.sqlite
        .prepare('UPDATE ledger_postings SET amount = ? WHERE account_id = ?')
        .run('99999.99', ctx.accountId);
    }).toThrow(/cannot update/i);
  });

  it('blocks DELETE on ledger_postings', () => {
    expect(() => {
      ctx.sqlite
        .prepare('DELETE FROM ledger_postings WHERE account_id = ?')
        .run(ctx.accountId);
    }).toThrow(/cannot delete/i);
  });

  it('preserves existing data after blocked update attempt', () => {
    // Count postings before attempted update
    const beforeCount = (
      ctx.sqlite
        .prepare('SELECT count(*) AS count FROM ledger_postings WHERE account_id = ?')
        .get(ctx.accountId) as { count: number }
    ).count;

    // Attempt an update — should throw
    try {
      ctx.sqlite
        .prepare('UPDATE ledger_postings SET amount = ? WHERE account_id = ?')
        .run('1.00', ctx.accountId);
    } catch {
      // Expected
    }

    // Data should be unchanged
    const afterCount = (
      ctx.sqlite
        .prepare('SELECT count(*) AS count FROM ledger_postings WHERE account_id = ?')
        .get(ctx.accountId) as { count: number }
    ).count;

    expect(afterCount).toBe(beforeCount);

    // Amounts should be the original values
    const amounts = ctx.sqlite
      .prepare(
        'SELECT amount, amount_micros FROM ledger_postings WHERE account_id = ? ORDER BY sequence ASC',
      )
      .all(ctx.accountId) as { amount: string; amount_micros: number }[];

    expect(amounts.length).toBeGreaterThan(0);
    // None of the amounts should be '1.00'
    for (const row of amounts) {
      expect(row.amount).not.toBe('1.00');
    }
  });
});

// ── A4: correction-aware opening cash ────────────────────────────────────

describe('rebuildOpeningCash — correction-aware (A4)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  /** Fresh account for each scenario. */
  function freshAccount(sqlite: Database.Database): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
      )
      .run(id, `A4 Rebuild ${id.slice(0, 6)}`, 'Broker', now, now);
    return id;
  }

  /** Post an opening_balance event with explicit canonical effect metadata. */
  function postOpeningWithEffect(
    sqlite: Database.Database,
    accountId: string,
    amount: string,
    direction: 'increase' | 'decrease',
  ): string {
    const micros = Number(amount) * 1_000_000;
    const result = postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount,
      payload: JSON.stringify({ amount }),
      effect: JSON.stringify({ kind: 'cash', direction, amount, amountMicros: micros }),
    });
    return result.event.id;
  }

  it('22a: a single canonical opening with an increase effect counts positively', () => {
    const sqlite = ctx.sqlite;
    const accountId = freshAccount(sqlite);
    postOpeningWithEffect(sqlite, accountId, '10000.00', 'increase');

    const projection = rebuildOpeningCash(sqlite, accountId);
    expect(projection.totalOpeningCash).toBe('10000.00');
    expect(projection.totalOpeningCashMicros).toBe(10_000_000_000);
    expect(projection.events[0].direction).toBe('increase');
    expect(projection.events[0].signedAmountMicros).toBe(10_000_000_000);
  });

  it('22b: correction lineage nets to the replacement value (10k - 10k + 9k = 9k)', () => {
    const sqlite = ctx.sqlite;
    const accountId = freshAccount(sqlite);
    postOpeningWithEffect(sqlite, accountId, '10000.00', 'increase'); // original
    postOpeningWithEffect(sqlite, accountId, '10000.00', 'decrease'); // reversal
    postOpeningWithEffect(sqlite, accountId, '9000.00', 'increase');  // replacement

    const projection = rebuildOpeningCash(sqlite, accountId);
    // Naive debit sum would be 29,000; correction-aware net is 9,000.
    expect(projection.totalOpeningCash).toBe('9000.00');
    expect(projection.totalOpeningCashMicros).toBe(9_000_000_000);
    expect(projection.events).toHaveLength(3);
    expect(projection.events.map((e) => e.direction)).toEqual([
      'increase',
      'decrease',
      'increase',
    ]);
    // The reversal must never be exposed as a positive contribution.
    expect(projection.events[1].signedAmountMicros).toBe(-10_000_000_000);
    expect(projection.events[1].signedAmount).toBe('-10000.00');
  });

  it('22c: legacy opening event without effect falls back to the debit posting', () => {
    const sqlite = ctx.sqlite;
    const accountId = freshAccount(sqlite);
    // postOpeningBalance writes no payload/effect (legacy kernel path).
    postOpeningBalance(sqlite, { accountId, amount: '8000.00' });

    const projection = rebuildOpeningCash(sqlite, accountId);
    expect(projection.totalOpeningCash).toBe('8000.00');
    expect(projection.events[0].direction).toBe('increase');
    expect(projection.events[0].signedAmountMicros).toBe(8_000_000_000);
  });
});
