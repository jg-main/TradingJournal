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
 *   - A2.1: reconstructed_canonical NEVER adds journal realized P&L —
 *     canonical execution cash flows already embed the economic proceeds, so
 *     historical trade activity without a trusted rollforward/projection
 *     resolves to unavailable instead of double-counting.
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
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { correctExecution } from '@/lib/accounting/correction';
import { computeAccountActivity, computeRebuildCashFlow } from '@/lib/accounting/activity';
import { rebuildPositionsWithinTransaction } from '@/lib/positions/rebuild';
import { rebuildAccountPerformance } from '@/lib/performance/performance-rebuild';
import { insertValidatedValuationMark } from '@/lib/performance/valuation-repository';
import type { CanonicalDecimal } from '@/lib/accounting/types';

/** Canonical net cash at/before asOf (test-side mirror of the resolver's cash truth). */
function canonicalNetCashAt(sqlite: Database.Database, accountId: string, asOf: string): number {
  const activity = computeAccountActivity(sqlite, accountId);
  const bounded = activity.events.filter((event) => event.postedAt <= asOf);
  const cash = computeRebuildCashFlow(bounded);
  return cash.netCashImpactMicros / 1_000_000;
}

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

/** Seed a projection with an explicit positions_json (strict-completeness tests). */
function seedProjectionWithPositions(
  accountId: string,
  nav: string,
  positionsJson: string,
  computedAsOf = now(),
): void {
  sqlite
    .prepare(
      `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions, realized_pnl,
          unrealized_pnl, total_pnl, realized_fees, gross_exposure, net_exposure,
          warnings, positions_json, rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, '0.00', ?, '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00',
               '[]', ?, 0, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, computedAsOf, nav, positionsJson, now(), now(), now());
}

/** Seed canonical trade-execution activity (A2 economic criterion for fail-closed). */
function seedTradeExecutionActivity(accountId: string, postedAt = '2026-01-02T00:00:00.000Z'): void {
  sqlite
    .prepare(
      `INSERT INTO financial_events
         (id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at)
       VALUES (?, ?, 'trade_execution', NULL, 'Execution', '{}', '{}', ?, ?)`,
    )
    .run(randomUUID(), accountId, postedAt, now());
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

  it('A2.1 §18: journal-only closed trade does NOT alter canonical equity', () => {
    // Canonical funding + a journal-only historical closed trade (trades +
    // trade_executions rows) with NO canonical accounting/financial-event
    // effects. Journal trades are attribution/workflow records, never an
    // independent canonical equity source — equity stays at canonical cash
    // 10000, NOT 10250.
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedClosedTrade(accountId, '2026-01-05T00:00:00.000Z', 250);

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());

    expect(ctx.equity).toBe(10000); // journal P&L never added to cash
    expect(ctx.source).toBe('reconstructed_canonical');
  });

  it('A2.1 §14: canonical profitable long round-trip resolves unavailable, never double-counts', () => {
    // Canonical economic posting (postExecutionFill → accounting_executions +
    // financial_events + ledger). Opening 10000, buy 1@100 (cash 9900),
    // sell 1@350 (cash 10250). Realized +250 is already embedded in cash.
    // Historical resolution with prior trade activity and no trusted
    // rollforward/projection → unavailable. MUST never return 10250 + 250 =
    // 10500.
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '1.00',
      price: '100.00',
      postedAt: '2026-01-05T10:00:00.000Z',
    });
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '1.00',
      price: '350.00',
      postedAt: '2026-01-05T11:00:00.000Z',
    });

    const ctx = resolveExecutionEquityContext(sqlite, accountId, '2026-01-05T12:00:00.000Z');

    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
    expect(ctx.hasUsableEquity).toBe(false);
    // Sanity: canonical cash already embeds the full round-trip proceeds.
    expect(canonicalNetCashAt(sqlite, accountId, '2026-01-05T12:00:00.000Z')).toBe(10250);
  });

  it('A2.1 §15: canonical losing long round-trip resolves unavailable, never double-counts', () => {
    // Opening 10000, buy 1@350 (cash 9650), sell 1@100 (cash 9750).
    // Realized -250 already embedded in cash. Never 9750 - 250 = 9500.
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '1.00',
      price: '350.00',
      postedAt: '2026-01-05T10:00:00.000Z',
    });
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '1.00',
      price: '100.00',
      postedAt: '2026-01-05T11:00:00.000Z',
    });

    const ctx = resolveExecutionEquityContext(sqlite, accountId, '2026-01-05T12:00:00.000Z');

    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
    expect(canonicalNetCashAt(sqlite, accountId, '2026-01-05T12:00:00.000Z')).toBe(9750);
  });

  it('A2.1 §16: canonical profitable short round-trip resolves unavailable, never double-counts', () => {
    // Opening 10000, sell_short 1@350 (cash 10350), buy_to_cover 1@100
    // (cash 10250). Realized +250 already embedded in cash. Never
    // 10250 + 250 = 10500.
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'sell_short',
      quantity: '1.00',
      price: '350.00',
      postedAt: '2026-01-05T10:00:00.000Z',
    });
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy_to_cover',
      quantity: '1.00',
      price: '100.00',
      postedAt: '2026-01-05T11:00:00.000Z',
    });

    const ctx = resolveExecutionEquityContext(sqlite, accountId, '2026-01-05T12:00:00.000Z');

    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
    expect(canonicalNetCashAt(sqlite, accountId, '2026-01-05T12:00:00.000Z')).toBe(10250);
  });

  it('A2.1 §19: corrected execution resolves from effective economics — unavailable, not stale journal P&L', () => {
    // Opening 10000 + canonical entry/exit, then correct the exit via the
    // correction kernel (reversal + replacement financial events). The
    // resolver must NOT derive equity from the original journal P&L: with
    // prior trade activity and no trusted historical valuation it returns
    // unavailable (never a stale/corrected double-count).
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    const entry = postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '1.00',
      price: '100.00',
      postedAt: '2026-01-05T10:00:00.000Z',
    });
    const exit = postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '1.00',
      price: '350.00',
      postedAt: '2026-01-05T11:00:00.000Z',
    });
    correctExecution(sqlite, {
      accountId,
      originalExecutionId: exit.execution.id,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '1.00',
      price: '300.00',
      reason: 'A2.1 test correction',
    });
    void entry;

    const ctx = resolveExecutionEquityContext(sqlite, accountId, '2026-01-05T12:00:00.000Z');

    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
    // Effective cash truth after correction: 10000 - 100 + 300 = 10200.
    expect(canonicalNetCashAt(sqlite, accountId, '2026-01-05T12:00:00.000Z')).toBe(10200);
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

describe('M007: incomplete current NAV is never usable execution equity', () => {
  /**
   * Real canonical path: account + opening balance + execution fills + FIFO
   * position rebuild + performance projection rebuild — the same sequence the
   * execution engine performs after every fill.
   */
  function seedFundedAccount(amount: number): string {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, amount, '2026-01-01T00:00:00.000Z');
    return accountId;
  }

  function rebuildFullProjection(accountId: string): void {
    rebuildPositionsWithinTransaction(sqlite, accountId);
    const result = rebuildAccountPerformance(sqlite, accountId);
    expect(result.success).toBe(true);
  }

  function readProjection(accountId: string): {
    computed_as_of: string;
    net_cash: string;
    nav: string;
    marked_positions: string;
    warnings: string;
    positions_json: string;
  } {
    return sqlite
      .prepare(
        `SELECT computed_as_of, net_cash, nav, marked_positions, warnings, positions_json
         FROM account_performance WHERE account_id = ?`,
      )
      .get(accountId) as {
      computed_as_of: string;
      net_cash: string;
      nav: string;
      marked_positions: string;
      warnings: string;
      positions_json: string;
    };
  }

  it('A: cash-only funded account with no open positions keeps current_projection', () => {
    const accountId = seedFundedAccount(50000);
    rebuildFullProjection(accountId);

    const proj = readProjection(accountId);
    expect(proj.nav).toBe('50000.00');

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());
    expect(ctx.equity).toBe(50000);
    expect(ctx.source).toBe('current_projection');
    expect(ctx.hasUsableEquity).toBe(true);
  });

  it('B: unmarked long cash-only NAV is never accepted as execution equity', () => {
    const accountId = seedFundedAccount(50000);
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '100.00',
      fees: '5.00',
      postedAt: '2026-01-02T00:00:00.000Z',
    });
    rebuildFullProjection(accountId);

    const proj = readProjection(accountId);
    expect(proj.nav).toBe('39995.00'); // cash-only: unmarked long contributes 0
    expect(proj.marked_positions).toBe('0.00');
    const positions = JSON.parse(proj.positions_json) as Array<Record<string, unknown>>;
    expect(positions[0].markStatus).toBe('missing');
    expect(positions[0].markedValue).toBeNull();

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());
    expect(ctx.source).not.toBe('current_projection');
    expect(ctx.equity).toBeNull();
    // Prior canonical trade activity + no trusted complete valuation →
    // unavailable (never the cash-only 39995).
    expect(ctx.source).toBe('unavailable');
    expect(ctx.hasUsableEquity).toBe(false);
  });

  it('C (safety-critical): unmarked short cash-inflated NAV never becomes usable equity', () => {
    const accountId = seedFundedAccount(50000);
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'MSFT',
      action: 'sell_short',
      quantity: '100.00',
      price: '200.00',
      fees: '5.00',
      postedAt: '2026-01-02T00:00:00.000Z',
    });
    rebuildFullProjection(accountId);

    const proj = readProjection(accountId);
    expect(proj.nav).toBe('69995.00'); // cash-inflated: short liability unmarked
    expect(proj.marked_positions).toBe('0.00');
    const positions = JSON.parse(proj.positions_json) as Array<Record<string, unknown>>;
    expect(positions[0].quantity).toBe('-100.00');
    expect(positions[0].markStatus).toBe('missing');
    expect(positions[0].markedValue).toBeNull();

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());
    expect(ctx.equity).not.toBe(69995);
    expect(ctx.source).not.toBe('current_projection');
    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
    expect(ctx.hasUsableEquity).toBe(false);
  });

  it('D: fully marked long projection is accepted as current_projection', () => {
    const accountId = seedFundedAccount(50000);
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '100.00',
      fees: '5.00',
      postedAt: '2026-01-02T00:00:00.000Z',
    });
    insertValidatedValuationMark(sqlite, {
      accountId,
      instrumentSymbol: 'AAPL',
      price: '110.00',
      source: 'market_data',
      markTimestamp: now(),
    });
    rebuildFullProjection(accountId);

    const proj = readProjection(accountId);
    expect(proj.nav).toBe('50995.00'); // 39995 cash + 11000 marked value

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());
    expect(ctx.equity).toBe(50995);
    expect(ctx.source).toBe('current_projection');
    expect(ctx.hasUsableEquity).toBe(true);
  });

  it('E: fully marked short projection is accepted as current_projection', () => {
    const accountId = seedFundedAccount(50000);
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'MSFT',
      action: 'sell_short',
      quantity: '100.00',
      price: '200.00',
      fees: '5.00',
      postedAt: '2026-01-02T00:00:00.000Z',
    });
    insertValidatedValuationMark(sqlite, {
      accountId,
      instrumentSymbol: 'MSFT',
      price: '190.00',
      source: 'market_data',
      markTimestamp: now(),
    });
    rebuildFullProjection(accountId);

    const proj = readProjection(accountId);
    // 69995 cash + signed short marked value (100 × 190, negative) = 50995.
    expect(proj.nav).toBe('50995.00');

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());
    expect(ctx.equity).toBe(50995);
    expect(ctx.source).toBe('current_projection');
    expect(ctx.hasUsableEquity).toBe(true);
  });

  it('F: mixed marked + unmarked portfolio fails closed', () => {
    const accountId = seedFundedAccount(50000);
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '100.00',
      fees: '5.00',
      postedAt: '2026-01-02T00:00:00.000Z',
    });
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'MSFT',
      action: 'sell_short',
      quantity: '100.00',
      price: '200.00',
      fees: '5.00',
      postedAt: '2026-01-02T00:00:00.001Z',
    });
    // Only AAPL is marked — MSFT remains unmarked → projection incomplete.
    insertValidatedValuationMark(sqlite, {
      accountId,
      instrumentSymbol: 'AAPL',
      price: '110.00',
      source: 'market_data',
      markTimestamp: now(),
    });
    rebuildFullProjection(accountId);

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());
    expect(ctx.source).not.toBe('current_projection');
    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
    expect(ctx.hasUsableEquity).toBe(false);
  });

  it('G: flat/closed position with no mark does not invalidate a complete projection', () => {
    const accountId = seedFundedAccount(50000);
    // Round trip → flat: buy 100 @ 100 (fee 5), sell 100 @ 110 (fee 5).
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '100.00',
      fees: '5.00',
      postedAt: '2026-01-02T00:00:00.000Z',
    });
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '100.00',
      price: '110.00',
      fees: '5.00',
      postedAt: '2026-01-02T00:00:00.001Z',
    });
    rebuildFullProjection(accountId);

    const proj = readProjection(accountId);
    const positions = JSON.parse(proj.positions_json) as Array<Record<string, unknown>>;
    expect(positions.length).toBeGreaterThan(0);
    expect(Number(positions[0].quantity)).toBe(0); // retained flat row, no mark
    expect(positions[0].markStatus).toBe('missing');

    const ctx = resolveExecutionEquityContext(sqlite, accountId, now());
    expect(ctx.source).toBe('current_projection');
    expect(ctx.equity).toBe(50990); // 50000 - 10000 - 5 + 11000 - 5
    expect(ctx.hasUsableEquity).toBe(true);
  });
});

describe('M007: malformed projection completeness data fails closed', () => {
  /**
   * Canonical account with opening balance + prior trade-execution activity,
   * so a rejected current_projection resolves through the canonical
   * precedence to unavailable (no trusted complete valuation).
   */
  function seedMalformedFixture(positionsJson: string): { accountId: string; asOf: string } {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(99999);
    seedOpeningBalance(accountId, 50000, '2026-01-01T00:00:00.000Z');
    seedTradeExecutionActivity(accountId, '2026-01-02T00:00:00.000Z');
    // Projection is temporally eligible at asOf, so completeness decides.
    seedProjectionWithPositions(accountId, '39995.00', positionsJson, '2026-01-04T00:00:00.000Z');
    return { accountId, asOf: '2026-01-05T00:00:00.000Z' };
  }

  function expectUnavailable(accountId: string, asOf: string): void {
    const ctx = resolveExecutionEquityContext(sqlite, accountId, asOf);
    expect(ctx.source).not.toBe('current_projection');
    expect(ctx.equity).toBeNull();
    expect(ctx.source).toBe('unavailable');
    expect(ctx.hasUsableEquity).toBe(false);
  }

  it('M1: absent markStatus on an open position fails closed', () => {
    // markedValue is a valid canonical string but markStatus is absent.
    const { accountId, asOf } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '100.00', markedValue: '10000.00' }]),
    );
    expectUnavailable(accountId, asOf);
  });

  it('M2: unknown markStatus on an open position fails closed', () => {
    const { accountId, asOf } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '100.00', markStatus: 'banana', markedValue: '10000.00' }]),
    );
    expectUnavailable(accountId, asOf);
  });

  it('M3: boolean/array/object markedValue fails closed (no Number coercion)', () => {
    const { accountId: a1, asOf: t1 } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '100.00', markStatus: 'fresh', markedValue: true }]),
    );
    expectUnavailable(a1, t1);

    const { accountId: a2, asOf: t2 } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '100.00', markStatus: 'fresh', markedValue: ['10000.00'] }]),
    );
    expectUnavailable(a2, t2);

    const { accountId: a3, asOf: t3 } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '100.00', markStatus: 'fresh', markedValue: { amount: '10000.00' } }]),
    );
    expectUnavailable(a3, t3);
  });

  it('M4: numeric JavaScript quantity fails closed (persisted quantity is a string)', () => {
    const { accountId, asOf } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: 100, markStatus: 'fresh', markedValue: '10000.00' }]),
    );
    expectUnavailable(accountId, asOf);
  });

  it('M5: structurally invalid numeric strings for quantity fail closed', () => {
    const { accountId: a1, asOf: t1 } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '', markStatus: 'fresh', markedValue: '10000.00' }]),
    );
    expectUnavailable(a1, t1);

    const { accountId: a2, asOf: t2 } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '   ', markStatus: 'fresh', markedValue: '10000.00' }]),
    );
    expectUnavailable(a2, t2);
  });

  it('M6: valid fresh marked open position keeps current_projection', () => {
    const { accountId, asOf } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '100.00', markStatus: 'fresh', markedValue: '11000.00' }]),
    );
    const ctx = resolveExecutionEquityContext(sqlite, accountId, asOf);
    expect(ctx.source).toBe('current_projection');
    expect(ctx.equity).toBe(39995);
    expect(ctx.hasUsableEquity).toBe(true);
  });

  it('M7: valid stale marked open position keeps current_projection (stale policy unchanged)', () => {
    const { accountId, asOf } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'short', quantity: '-100.00', markStatus: 'stale', markedValue: '-19000.00' }]),
    );
    const ctx = resolveExecutionEquityContext(sqlite, accountId, asOf);
    expect(ctx.source).toBe('current_projection');
    expect(ctx.equity).toBe(39995);
    expect(ctx.hasUsableEquity).toBe(true);
  });

  it('M8: valid flat missing-mark position does not invalidate the projection', () => {
    const { accountId, asOf } = seedMalformedFixture(
      JSON.stringify([{ instrumentId: 'x', direction: 'long', quantity: '0.00', markStatus: 'missing', markedValue: null }]),
    );
    const ctx = resolveExecutionEquityContext(sqlite, accountId, asOf);
    expect(ctx.source).toBe('current_projection');
    expect(ctx.equity).toBe(39995);
    expect(ctx.hasUsableEquity).toBe(true);
  });
});
