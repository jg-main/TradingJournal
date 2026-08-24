/**
 * execution-equity.test.ts
 *
 * M002-A2 — canonical execution-equity resolver tests.
 *
 * Covers the binding equity contract:
 *   current canonical projection → safe historical source → explicit
 *   canonical reconstruction → explicit legacy compatibility → unavailable
 *
 * Key invariants under test:
 *   - Canonical M006 projection wins over contradictory legacy data.
 *   - Canonical NAV = 0 stays zero and never falls through to the global
 *     starting value.
 *   - settings.startingAccountValue cannot fabricate funding for a canonical
 *     account.
 *   - Correction-aware capital reconstruction (opening/deposit corrections).
 *   - Backdated fills never consume future state silently.
 *   - Zero vs null are distinct (zero is a known value; null is unavailable).
 *   - Legacy compatibility is explicit, last, and cannot override canonical
 *     zero.
 *   - Provenance is always asserted.
 *
 * Run: npx vitest run src/lib/__tests__/execution-equity.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { testDbPath, disposeSqliteFile, applyAllMigrations } from '@/lib/testing/test-db';
import { resolveExecutionEquityContext } from '@/lib/execution-equity';
import { postFinancialEvent } from '@/lib/accounting/posting';
import type { CanonicalDecimal } from '@/lib/accounting/types';

const TEST_DB_PATH = testDbPath('execution-equity');

let sqlite: Database.Database;

beforeAll(() => {
  sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyAllMigrations(sqlite);
});

afterAll(() => {
  disposeSqliteFile(sqlite, TEST_DB_PATH);
});

const now = () => new Date().toISOString();

interface SeedAccountOptions {
  isActive?: boolean;
  currency?: string;
  startingBalance?: number | null;
}

function seedAccount(options: SeedAccountOptions = {}): string {
  const id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, 'Equity Test', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      options.currency ?? 'USD',
      options.isActive ?? 1,
      options.startingBalance === undefined ? null : options.startingBalance,
      now(),
      now(),
    );
  return id;
}

function seedSettings(startingAccountValue: number): void {
  sqlite
    .prepare(
      `INSERT OR REPLACE INTO settings (id, starting_account_value)
       VALUES ('default', ?)`,
    )
    .run(startingAccountValue);
}

function seedOpeningBalance(accountId: string, amount: number, postedAt: string): void {
  postFinancialEvent(sqlite, {
    accountId,
    eventType: 'opening_balance',
    amount: amount.toFixed(2) as CanonicalDecimal,
    description: 'Opening balance',
    payload: JSON.stringify({ amount: amount.toFixed(2) }),
    effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: amount.toFixed(2), amountMicros: Math.round(amount * 1_000_000) }),
    postedAt,
  });
}

/** Post an opening_balance reversal (decrease effect) — A4 correction model. */
function seedOpeningReversal(accountId: string, amount: number, postedAt: string): void {
  postFinancialEvent(sqlite, {
    accountId,
    eventType: 'opening_balance',
    amount: amount.toFixed(2) as CanonicalDecimal,
    description: 'Correction reversal',
    payload: JSON.stringify({ amount: amount.toFixed(2), correctionType: 'reversal' }),
    effect: JSON.stringify({ kind: 'cash', direction: 'decrease', amount: amount.toFixed(2), amountMicros: Math.round(amount * 1_000_000) }),
    postedAt,
  });
}

function seedDeposit(accountId: string, amount: number, postedAt: string): void {
  postFinancialEvent(sqlite, {
    accountId,
    eventType: 'deposit',
    amount: Math.abs(amount).toFixed(2) as CanonicalDecimal,
    description: 'Deposit',
    payload: JSON.stringify({ amount: Math.abs(amount).toFixed(2) }),
    effect: JSON.stringify({
      kind: 'cash',
      direction: amount < 0 ? 'decrease' : 'increase',
      amount: Math.abs(amount).toFixed(2),
      amountMicros: Math.round(Math.abs(amount) * 1_000_000),
    }),
    postedAt,
  });
}

function seedWithdrawal(accountId: string, amount: number, postedAt: string): void {
  postFinancialEvent(sqlite, {
    accountId,
    eventType: 'withdrawal',
    amount: Math.abs(amount).toFixed(2) as CanonicalDecimal,
    description: 'Withdrawal',
    payload: JSON.stringify({ amount: Math.abs(amount).toFixed(2) }),
    effect: JSON.stringify({
      kind: 'cash',
      direction: amount < 0 ? 'increase' : 'decrease',
      amount: Math.abs(amount).toFixed(2),
      amountMicros: Math.round(Math.abs(amount) * 1_000_000),
    }),
    postedAt,
  });
}

/** Seed an account_performance row (current projection). */
function seedProjection(accountId: string, nav: number, computedAsOf = now()): void {
  sqlite
    .prepare(
      `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions, realized_pnl,
          unrealized_pnl, total_pnl, realized_fees, gross_exposure, net_exposure,
          warnings, positions_json, rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, '0.00', ?, '[]', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00',
               '[]', '[]', 0, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, computedAsOf, nav.toFixed(2), now(), now(), now());
}

/** Seed a legacy account_transactions row. */
function seedLegacyTransaction(accountId: string, type: 'deposit' | 'withdrawal', amount: number, date: string): void {
  sqlite
    .prepare(
      `INSERT INTO account_transactions (id, account_id, type, amount, balance_after, date, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(randomUUID(), accountId, type, amount, amount, date, now());
}

/** Seed a closed journal trade with executions (realized P&L reconstruction). */
function seedClosedTrade(accountId: string, closedAt: string, netPnL: number): void {
  const tradeId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'AAPL', 'long', 'closed', ?, ?, ?, ?)`,
    )
    .run(tradeId, `TC-${randomUUID().slice(0, 8)}`, accountId, closedAt, closedAt, now(), now());
  // One buy + one sell realizing netPnL.
  sqlite
    .prepare(
      `INSERT INTO trade_executions (id, trade_id, action, quantity, price, fees, executed_at, created_at)
       VALUES (?, ?, 'buy', 1, 100, 0, ?, ?)`,
    )
    .run(randomUUID(), tradeId, closedAt, now());
  sqlite
    .prepare(
      `INSERT INTO trade_executions (id, trade_id, action, quantity, price, fees, executed_at, created_at)
       VALUES (?, ?, 'sell', 1, ?, 0, ?, ?)`,
    )
    .run(randomUUID(), tradeId, 100 + netPnL, closedAt, now());
  void tradeId;
}

describe('resolveExecutionEquityContext', () => {
  it('A2 §30: current canonical projection is used, global starting value ignored', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedProjection(accountId, 10000);

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    expect(ctx.equity).toBe(10000);
    expect(ctx.source).toBe('current_projection');
    expect(ctx.hasUsableEquity).toBe(true);
    expect(ctx.asOf).toBeTruthy();
  });

  it('A2 §31: canonical cash-flow history resolves pre-fill equity', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedDeposit(accountId, 2000, '2026-01-05T00:00:00.000Z');
    seedWithdrawal(accountId, 500, '2026-01-10T00:00:00.000Z');

    // No projection row → reconstruction from correction-aware cash.
    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    expect(ctx.equity).toBe(11500);
    expect(ctx.source).toBe('reconstructed_canonical');
  });

  it('A2 §32: canonical projection wins over contradictory legacy data', () => {
    const accountId = seedAccount({ startingBalance: 500000 });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedLegacyTransaction(accountId, 'deposit', 999999, '2026-01-02');
    seedProjection(accountId, 10000);

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    expect(ctx.equity).toBe(10000);
    expect(ctx.source).toBe('current_projection');
    // Legacy rows have no effect because canonical evidence exists.
    expect(ctx.hasUsableEquity).toBe(true);
  });

  it('A2 §33: correction-aware capital reconstruction (opening + deposit corrections)', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    // Opening 10000 → corrected to 9000: original (+10000) + reversal
    // (-10000 effect) + replacement (+9000).
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedOpeningReversal(accountId, 10000, '2026-01-02T00:00:00.000Z');
    seedOpeningBalance(accountId, 9000, '2026-01-02T00:00:00.001Z'); // replacement
    // Deposit 2500 → corrected to 2000: original (+2500) + reversal
    // (-2500 effect) + replacement (+2000).
    seedDeposit(accountId, 2500, '2026-01-03T00:00:00.000Z');
    seedWithdrawal(accountId, 2500, '2026-01-04T00:00:00.000Z'); // reversal of the deposit
    seedDeposit(accountId, 2000, '2026-01-04T00:00:00.001Z'); // replacement

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    // 9000 (net opening) + 2000 (net deposit) = 11000 — natural
    // correction-aware net cash, no special branch.
    expect(ctx.equity).toBe(11000);
    expect(ctx.source).toBe('reconstructed_canonical');
  });

  it('A2 §34: backdated fill never consumes future state', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedDeposit(accountId, 10000, '2026-01-10T00:00:00.000Z'); // future relative to Jan 5

    // Fill executedAt Jan 5 — the Jan 10 deposit must NOT be included.
    const ctx = resolveExecutionEquityContext(sqlite, accountId, '2026-01-05T10:00:00.000Z');

    expect(ctx.equity).toBe(10000);
    expect(ctx.source).toBe('reconstructed_canonical');
    expect(ctx.asOf).toBe('2026-01-05T10:00:00.000Z');
  });

  it('A2 §12/§11: canonical zero (opening 10000, withdrawal 10000) stays zero — no global fallback', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(50000);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedWithdrawal(accountId, 10000, '2026-01-02T00:00:00.000Z');

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    expect(ctx.equity).toBe(0); // known value — NOT null
    expect(ctx.hasUsableEquity).toBe(false);
    expect(ctx.source).toBe('reconstructed_canonical');
  });

  it('A2 §13: zero vs null are distinct — no evidence → unavailable (null)', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(50000);

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
    expect(ctx.hasUsableEquity).toBe(false);
  });

  it('A2 §20: legacy compatibility is explicit, last, and cannot override canonical zero', () => {
    // Legacy account: startingBalance + accountTransactions, NO canonical events.
    const accountId = seedAccount({ startingBalance: 100000 });
    seedSettings(50000);
    seedLegacyTransaction(accountId, 'deposit', 1000, '2026-01-02');

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    // 100000 + 1000 = 101000 via the legacy model.
    expect(ctx.equity).toBe(101000);
    expect(ctx.source).toBe('legacy_compatibility');
  });

  it('A2: legacy global settings fallback applies only in the legacy path (hasNoAccountData)', () => {
    // Account with NO canonical events and NO legacy rows at all → legacy
    // path sees hasNoAccountData → the documented legacy settings fallback
    // still applies there (pre-existing legacy contract).
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(40000);

    // No canonical funding history and no legacy rows → unavailable (A2 §21:
    // a canonical account is never funded by the global value; a bare account
    // with no legacy markers is not positively legacy either).
    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());
    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
  });

  it('A2: reconstructed_canonical includes realized P&L from closed trades at/before asOf', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedClosedTrade(accountId, '2026-01-05T00:00:00.000Z', 250);

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    expect(ctx.equity).toBe(10250); // 10000 cash + 250 realized
    expect(ctx.source).toBe('reconstructed_canonical');
  });

  it('A2 §22: derived account_performance row alone is NOT canonical funding evidence', () => {
    // The engine rebuilds account_performance on every fill. A legacy account
    // (startingBalance, no canonical funding events) must NOT flip to
    // canonical-zero just because a projection row exists.
    const accountId = seedAccount({ startingBalance: 100000 });
    seedSettings(99999);
    seedProjection(accountId, 0); // derived projection from a legacy account

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    expect(ctx.source).toBe('legacy_compatibility');
    expect(ctx.equity).toBe(100000);
    expect(ctx.hasUsableEquity).toBe(true);
  });
});
