/**
 * Account Close API Route tests (A3 — canonical closure summary).
 *
 * Verifies the canonical close-route behavior against a real migrations-based
 * SQLite database:
 *
 * - Financial/account state comes EXCLUSIVELY from the canonical model
 *   (financial_events + effects, freshly rebuilt account_performance).
 * - Legacy inputs (accounts.startingBalance, accountTransactions,
 *   computeAccountBalance, computeDatesActive) have ZERO influence.
 * - Deposits/withdrawals are correction-aware through cash-effect directions.
 * - Opening balance is derived from the canonical opening_balance event.
 * - finalBalance = canonical NAV; realizedPnl = canonical projection.
 * - netReturn = realizedPnl / (openingBalance + deposits) * 100 (simple
 *   realized return on contributed capital; null when denominator <= 0).
 * - datesActive.from = earliest of account createdAt and canonical event
 *   timestamps; to = the single captured closedAt.
 * - A fresh projection rebuild is REQUIRED: rebuild failure → 500, account
 *   stays active, default reference unchanged, retry succeeds.
 * - Open-trade guard (409) and default-account clearing are preserved.
 *
 * The test DB lives in the OS temp directory (no root-level artifacts) and
 * is cleaned up (db + wal + shm) after the run.
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/close/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeAccount } from '@/lib/accounting/account-initialization';
import { postEventWithEffect } from '@/lib/accounting/event-posting';
import { correctFinancialEvent } from '@/lib/accounting/financial-event-correction';
import {
  computeAccountClosureFinancials,
  deriveAccountClosureCapital,
} from '@/lib/accounting/account-closure';
import { canDeactivateAccount } from '@/lib/account-lifecycle';
import { AccountClosureProjectionError } from '@/lib/accounting/errors';

// ── Test Database Setup (OS temp dir — no root artifacts) ──────────────

const TEST_DB_PATH = join(tmpdir(), `tj-close-route-${process.pid}.db`);

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

// ── Fixture helpers (canonical workflow only) ───────────────────────────

/** Create an inactive draft account row. */
function createDraft(sqlite: Database.Database, name: string, createdAt?: string): string {
  const id = randomUUID();
  const now = createdAt ?? new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, name, 'Broker', 'USD', now, now);
  return id;
}

/** Initialize via the canonical A2 service (opening balance + activation). */
function init(sqlite: Database.Database, accountId: string, amount: string, postedAt?: string): void {
  initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount, postedAt });
}

/** Post a generic cash event via the canonical event-posting service. */
function postEvent(
  sqlite: Database.Database,
  accountId: string,
  eventType: 'deposit' | 'withdrawal',
  amount: string,
): string {
  const result = postEventWithEffect(sqlite, accountId, { eventType, amount });
  return result.event.id;
}

/** Correct a financial event via the canonical correction service. */
function correctEvent(
  sqlite: Database.Database,
  accountId: string,
  originalEventId: string,
  amount: string,
): void {
  correctFinancialEvent(sqlite, {
    accountId,
    originalEventId,
    amount,
    reason: 'A3 test correction',
  });
}

function countLegacyTransactions(sqlite: Database.Database, accountId: string): number {
  const row = sqlite
    .prepare('SELECT COUNT(*) AS c FROM account_transactions WHERE account_id = ?')
    .get(accountId) as { c: number };
  return row.c;
}

function isActive(sqlite: Database.Database, accountId: string): number {
  const row = sqlite
    .prepare('SELECT is_active FROM accounts WHERE id = ?')
    .get(accountId) as { is_active: number };
  return row.is_active;
}

// ── Simulated close route (mirrors the real route, uses the real service) ─

interface RouteResult {
  status: number;
  data: Record<string, unknown>;
}

function doCloseAccount(sqlite: Database.Database, id: string): RouteResult {
  try {
    const account = sqlite
      .prepare(
        'SELECT id, name, is_active AS isActive, created_at AS createdAt FROM accounts WHERE id = ?',
      )
      .get(id) as { id: string; name: string; isActive: number; createdAt: string } | undefined;
    if (!account) return { status: 404, data: { error: 'Account not found' } };
    if (!account.isActive) return { status: 400, data: { error: 'Account is already inactive' } };

    const accountTrades = sqlite
      .prepare('SELECT status FROM trades WHERE account_id = ?')
      .all(id) as Array<{ status: string }>;
    if (!canDeactivateAccount(accountTrades)) {
      return {
        status: 409,
        data: {
          error:
            'Cannot close account with open trades. ' +
            'Close or cancel all open positions before closing the account.',
        },
      };
    }

    const closedAt = new Date().toISOString();
    const financials = computeAccountClosureFinancials(sqlite, id, closedAt, account.createdAt ?? closedAt);

    sqlite
      .prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(closedAt, id);
    sqlite
      .prepare('UPDATE settings SET default_account_id = NULL, updated_at = ? WHERE default_account_id = ?')
      .run(closedAt, id);

    return {
      status: 200,
      data: {
        accountId: id,
        accountName: account.name,
        startingBalance: financials.startingBalance,
        openingBalance: financials.openingBalance,
        depositsTotal: financials.depositsTotal,
        withdrawalsTotal: financials.withdrawalsTotal,
        realizedPnl: financials.realizedPnl,
        finalBalance: financials.finalBalance,
        netReturn: financials.netReturn,
        kpis: { tradeCount: 0, netPnl: 0, winRate: null, avgR: null, avgGrade: null },
        datesActive: financials.datesActive,
        closedAt: financials.closedAt,
        accounting: financials.accounting,
      },
    };
  } catch (error) {
    if (error instanceof AccountClosureProjectionError) {
      return {
        status: 500,
        data: { error: 'Failed to close account', details: (error as Error).message },
      };
    }
    return { status: 500, data: { error: 'Failed to close account', details: String(error) } };
  }
}

// ── Pure helper unit tests ──────────────────────────────────────────────

describe('deriveAccountClosureCapital (pure, correction-aware)', () => {
  it('nets a corrected deposit through effect directions (2500 → 2000)', () => {
    const activity = [
      { eventType: 'opening_balance', postedAt: '2026-01-01T00:00:00.000Z', effect: { kind: 'cash', direction: 'increase', amountMicros: 10_000_000_000 } },
      { eventType: 'deposit', postedAt: '2026-01-02T00:00:00.000Z', effect: { kind: 'cash', direction: 'increase', amountMicros: 2_500_000_000 } },
      // reversal of the original deposit
      { eventType: 'deposit', postedAt: '2026-01-03T00:00:00.000Z', effect: { kind: 'cash', direction: 'decrease', amountMicros: 2_500_000_000 } },
      // replacement deposit
      { eventType: 'deposit', postedAt: '2026-01-03T00:00:00.000Z', effect: { kind: 'cash', direction: 'increase', amountMicros: 2_000_000_000 } },
      // withdrawal not part of deposits
      { eventType: 'withdrawal', postedAt: '2026-01-04T00:00:00.000Z', effect: { kind: 'cash', direction: 'decrease', amountMicros: 1_000_000_000 } },
      // dividends/fees/trades must NOT be classified as deposits
      { eventType: 'dividend', postedAt: '2026-01-05T00:00:00.000Z', effect: { kind: 'cash', direction: 'increase', amountMicros: 999_999_999 } },
      { eventType: 'trade_execution', postedAt: '2026-01-06T00:00:00.000Z', effect: { kind: 'cash', direction: 'increase', amountMicros: 888_888_888 } },
    ] as unknown as Parameters<typeof deriveAccountClosureCapital>[0];

    const capital = deriveAccountClosureCapital(activity);
    expect(capital.openingBalance).toBe('10000.00');
    expect(capital.depositsTotal).toBe('2000.00');
    expect(capital.withdrawalsTotal).toBe('1000.00');
    expect(capital.firstActivityAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('nets a corrected withdrawal through effect directions (1000 → 750)', () => {
    const activity = [
      { eventType: 'withdrawal', postedAt: '2026-01-02T00:00:00.000Z', effect: { kind: 'cash', direction: 'decrease', amountMicros: 1_000_000_000 } },
      // reversal (increase) reduces the magnitude
      { eventType: 'withdrawal', postedAt: '2026-01-03T00:00:00.000Z', effect: { kind: 'cash', direction: 'increase', amountMicros: 1_000_000_000 } },
      // replacement withdrawal
      { eventType: 'withdrawal', postedAt: '2026-01-03T00:00:00.000Z', effect: { kind: 'cash', direction: 'decrease', amountMicros: 750_000_000 } },
    ] as unknown as Parameters<typeof deriveAccountClosureCapital>[0];

    const capital = deriveAccountClosureCapital(activity);
    expect(capital.withdrawalsTotal).toBe('750.00');
  });
});

// ── Deterministic close scenarios (real service + simulated route) ──────

describe('POST /api/accounts/:id/close — canonical closure summary', () => {
  it('19: canonical-only account closes with fully canonical values', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite, 'Canonical Only');

    // Canonical workflow only: initialize + deposit + withdrawal.
    init(sqlite, accountId, '10000.00');
    postEvent(sqlite, accountId, 'deposit', '2500.00');
    postEvent(sqlite, accountId, 'withdrawal', '1000.00');

    // Legacy accountTransactions must remain empty throughout.
    expect(countLegacyTransactions(sqlite, accountId)).toBe(0);

    const result = doCloseAccount(sqlite, accountId);
    expect(result.status).toBe(200);
    const d = result.data;
    expect(d.startingBalance).toBe(10_000);
    expect(d.depositsTotal).toBe(2_500);
    expect(d.withdrawalsTotal).toBe(1_000);
    expect(d.finalBalance).toBe(11_500);
    expect(d.realizedPnl).toBe(0);
    expect(d.netReturn).toBe(0);
    expect((d.accounting as { ledgerDerived: boolean }).ledgerDerived).toBe(true);
    expect(isActive(sqlite, accountId)).toBe(0);
    expect(countLegacyTransactions(sqlite, accountId)).toBe(0);
  });

  it('20: corrected deposit does not inflate the closure totals', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite, 'Corrected Deposit');

    init(sqlite, accountId, '10000.00');
    const depositEventId = postEvent(sqlite, accountId, 'deposit', '2500.00');
    correctEvent(sqlite, accountId, depositEventId, '2000.00');
    postEvent(sqlite, accountId, 'withdrawal', '1000.00');

    const result = doCloseAccount(sqlite, accountId);
    expect(result.status).toBe(200);
    const d = result.data;
    expect(d.startingBalance).toBe(10_000);
    expect(d.depositsTotal).toBe(2_000);
    expect(d.withdrawalsTotal).toBe(1_000);
    expect(d.finalBalance).toBe(11_000);
  });

  it('21: corrected withdrawal nets to the replacement magnitude', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite, 'Corrected Withdrawal');

    init(sqlite, accountId, '10000.00');
    const withdrawalEventId = postEvent(sqlite, accountId, 'withdrawal', '1000.00');
    correctEvent(sqlite, accountId, withdrawalEventId, '750.00');

    const result = doCloseAccount(sqlite, accountId);
    expect(result.status).toBe(200);
    const d = result.data;
    expect(d.startingBalance).toBe(10_000);
    expect(d.depositsTotal).toBe(0);
    expect(d.withdrawalsTotal).toBe(750);
    expect(d.finalBalance).toBe(9_250);
  });

  it('22: contradictory legacy accountTransactions have zero influence', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite, 'Contradictory Legacy');

    init(sqlite, accountId, '10000.00');
    postEvent(sqlite, accountId, 'deposit', '2000.00');
    postEvent(sqlite, accountId, 'withdrawal', '500.00');

    // Deliberately contradictory legacy row: deposit 999,999.
    sqlite
      .prepare(
        `INSERT INTO account_transactions (id, account_id, type, amount, balance_after, date, created_at)
         VALUES (?, ?, 'deposit', 999999, 999999, ?, ?)`,
      )
      .run(randomUUID(), accountId, new Date().toISOString(), new Date().toISOString());

    const result = doCloseAccount(sqlite, accountId);
    expect(result.status).toBe(200);
    const d = result.data;
    expect(d.startingBalance).toBe(10_000);
    expect(d.depositsTotal).toBe(2_000);
    expect(d.withdrawalsTotal).toBe(500);
    expect(d.finalBalance).toBe(11_500);
  });

  it('23: backdated opening balance drives datesActive.from', () => {
    const sqlite = ctx.sqlite;
    const createdAt = '2026-08-23T12:00:00.000Z';
    const accountId = createDraft(sqlite, 'Backdated', createdAt);

    // Opening balance effective Jan 15 (backdated).
    init(sqlite, accountId, '10000.00', '2026-01-15T00:00:00.000Z');

    const result = doCloseAccount(sqlite, accountId);
    expect(result.status).toBe(200);
    const datesActive = result.data.datesActive as { from: string; to: string };
    expect(datesActive.from).toBe('2026-01-15T00:00:00.000Z');
    expect(datesActive.to).toBe(result.data.closedAt);
  });

  it('24: projection rebuild failure → 500, account stays active, default unchanged, retry succeeds', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite, 'Projection Failure');
    init(sqlite, accountId, '10000.00');

    // Make this the settings default so we can prove it survives a failed close.
    sqlite
      .prepare("INSERT INTO settings (id, updated_at) VALUES ('default', ?) ON CONFLICT(id) DO NOTHING")
      .run(new Date().toISOString());
    sqlite
      .prepare('UPDATE settings SET default_account_id = ?, updated_at = ?')
      .run(accountId, new Date().toISOString());

    // Force the projection write to fail on the UPDATE path (the projection
    // row already exists after initialization).
    sqlite.exec(`
      CREATE TRIGGER a3_close_force_projection_fail BEFORE UPDATE ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced close projection failure'); END;
    `);

    const failed = doCloseAccount(sqlite, accountId);
    expect(failed.status).toBe(500);
    expect((failed.data.details as string)).toContain('projection could not be rebuilt');
    sqlite.exec('DROP TRIGGER a3_close_force_projection_fail');

    // No lifecycle mutation happened.
    expect(isActive(sqlite, accountId)).toBe(1);
    const settingsRow = sqlite
      .prepare('SELECT default_account_id FROM settings LIMIT 1')
      .get() as { default_account_id: string | null };
    expect(settingsRow.default_account_id).toBe(accountId);

    // Retry with a healthy projection succeeds.
    const retry = doCloseAccount(sqlite, accountId);
    expect(retry.status).toBe(200);
    expect((retry.data as { finalBalance: number }).finalBalance).toBe(10_000);
    expect(isActive(sqlite, accountId)).toBe(0);
  });

  it('25: open-trade guard → 409, account remains active', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite, 'Open Trade Guard');
    init(sqlite, accountId, '10000.00');

    sqlite
      .prepare(
        `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        `A3OPEN-${Date.now()}`, accountId, 'AAPL', 'long', 'open',
        new Date().toISOString(), new Date().toISOString(),
      );

    const result = doCloseAccount(sqlite, accountId);
    expect(result.status).toBe(409);
    expect((result.data.error as string)).toContain('Cannot close account with open trades');
    expect(isActive(sqlite, accountId)).toBe(1);
  });

  it('closed default account clears settings.defaultAccountId on success', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite, 'Default Clear');
    init(sqlite, accountId, '10000.00');
    sqlite
      .prepare("INSERT INTO settings (id, updated_at) VALUES ('default', ?) ON CONFLICT(id) DO NOTHING")
      .run(new Date().toISOString());
    sqlite
      .prepare('UPDATE settings SET default_account_id = ?, updated_at = ?')
      .run(accountId, new Date().toISOString());

    const result = doCloseAccount(sqlite, accountId);
    expect(result.status).toBe(200);
    const settingsRow = sqlite
      .prepare('SELECT default_account_id FROM settings LIMIT 1')
      .get() as { default_account_id: string | null };
    expect(settingsRow.default_account_id).toBeNull();
  });
  it('27: corrected opening balance flows into the canonical closure (10k -> 9k + deposit 2k)', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite, 'A4 Closure Regression');

    init(sqlite, accountId, '10000.00');
    // Correct the opening balance 10000 -> 9000 (A4).
    const events = sqlite
      .prepare("SELECT id FROM financial_events WHERE account_id = ? AND event_type = 'opening_balance' ORDER BY posted_at LIMIT 1")
      .all(accountId) as Array<{ id: string }>;
    correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: events[0].id,
      amount: '9000.00',
      reason: 'Broker opening statement correction',
    });
    postEvent(sqlite, accountId, 'deposit', '2000.00');

    const result = doCloseAccount(sqlite, accountId);
    expect(result.status).toBe(200);
    const d = result.data;
    expect(d.openingBalance).toBe(9_000);
    expect(d.startingBalance).toBe(9_000);
    expect(d.depositsTotal).toBe(2_000);
    expect(d.finalBalance).toBe(11_000);
    expect(d.realizedPnl).toBe(0);
    expect(d.netReturn).toBe(0);
    expect(isActive(sqlite, accountId)).toBe(0);
  });
});
