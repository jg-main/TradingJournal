/**
 * cash-direction-repair.test.ts
 *
 * M002-A5 — historical cash-direction repair for pre-A5 short add/reduce
 * executions whose financial-event cash side was inverted.
 *
 *   short add    recorded -900, correct +900  → compensation +1,800
 *   short reduce recorded +800, correct -800 → compensation -1,600
 *
 * Invariants:
 *   - immutable originals never rewritten (repair APPENDS a typed
 *     compensating financial event)
 *   - deterministic idempotency key — a second repair run adds nothing
 *   - long add/reduce (already correct) and concrete actions are skipped
 *   - compensating event + account-performance rebuild are atomic per account
 *
 * Run: npx vitest run src/lib/accounting/__tests__/cash-direction-repair.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { testDbPath, disposeSqliteFile, applyAllMigrations } from '@/lib/testing/test-db';
import {
  repairExecutionCashDirectionForAccount,
  cashDirectionRepairKey,
} from '../cash-direction-repair';
import { computeAccountActivity, computeRebuildCashFlow } from '../activity';

const TEST_DB_PATH = testDbPath('cash-direction-repair');

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

function seedAccount(): string {
  const id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, 'Repair Test', 'USD', 1, NULL, ?, ?)`,
    )
    .run(id, now(), now());
  return id;
}

function seedTrade(accountId: string, direction: 'long' | 'short'): string {
  const id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
       VALUES (?, ?, ?, 'AAPL', ?, 'open', ?, ?)`,
    )
    .run(id, `TC-${randomUUID().slice(0, 8)}`, accountId, direction, now(), now());
  return id;
}

function seedInstrument(): string {
  const row = sqlite
    .prepare('SELECT id FROM instruments WHERE symbol = ?')
    .get('AAPL') as { id: string } | undefined;
  if (row) return row.id;
  const id = randomUUID();
  sqlite
    .prepare('INSERT INTO instruments (id, symbol, name) VALUES (?, ?, ?)')
    .run(id, 'AAPL', 'Apple');
  return id;
}

/** Seed a PRE-A5 accounting execution row (raw generic action). */
function seedPreA5AccountingExecution(
  accountId: string,
  tradeId: string,
  action: string,
  quantity: string,
  price: string,
  postedAt: string,
): string {
  const id = randomUUID();
  const instrumentId = seedInstrument();
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
         (id, account_id, instrument_id, action, quantity, price, fees,
          idempotency_key, journal_trade_id, description, posted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '0.00', NULL, ?, ?, ?, ?)`,
    )
    .run(id, accountId, instrumentId, action, quantity, price, tradeId, null, postedAt, now());
  return id;
}

/** Seed the pre-A5 WRONG financial event (payload action + wrong cash effect). */
function seedWrongFinancialEvent(
  accountId: string,
  accountingExecutionId: string,
  action: string,
  quantity: string,
  price: string,
  postedAt: string,
): void {
  const q = Number(quantity);
  const p = Number(price);
  const considerationMicros = Math.round(q * p * 1_000_000);
  // Legacy rule: add → decrease, reduce → increase (the A5 defect).
  const direction = action === 'reduce' ? 'increase' : 'decrease';
  sqlite
    .prepare(
      `INSERT INTO financial_events
         (id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at)
       VALUES (?, ?, 'trade_execution', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      null,
      `Execution: ${action} ${quantity} AAPL @ ${price}`,
      JSON.stringify({ accountingExecutionId, action, symbol: 'AAPL', quantity, price, fees: '0.00', journalTradeId: null }),
      JSON.stringify({ kind: 'cash', direction, amount: String(q * p), amountMicros: considerationMicros }),
      postedAt,
      now(),
    );
}

/** Replay canonical net cash (the same replay the projection uses). */
function canonicalNetCash(accountId: string): number {
  const activity = computeAccountActivity(sqlite, accountId);
  const cash = computeRebuildCashFlow(activity.events);
  return cash.netCashImpactMicros / 1_000_000;
}

function compensationCount(accountingExecutionId: string): number {
  const row = sqlite
    .prepare('SELECT count(*) AS n FROM financial_events WHERE idempotency_key = ?')
    .get(cashDirectionRepairKey(accountingExecutionId)) as { n: number };
  return row.n;
}

describe('repairExecutionCashDirectionForAccount', () => {
  it('short add: recorded decrease (-900) repaired with +1,800 compensation (idempotent)', () => {
    const accountId = seedAccount();
    const tradeId = seedTrade(accountId, 'short');
    // Pre-A5 state: short add 20@45 → recorded -900, correct +900.
    const execId = seedPreA5AccountingExecution(accountId, tradeId, 'add', '20.00', '45.00', '2026-01-05T10:00:00.000Z');
    seedWrongFinancialEvent(accountId, execId, 'add', '20.00', '45.00', '2026-01-05T10:00:00.000Z');

    expect(canonicalNetCash(accountId)).toBe(-900); // broken pre-A5 replay

    const first = repairExecutionCashDirectionForAccount(sqlite, accountId);
    expect(first.repaired).toBe(1);
    expect(first.scanned).toBe(1);
    expect(first.compensations).toHaveLength(1);

    // Original accounting row unchanged (immutable history preserved).
    const row = sqlite.prepare('SELECT action FROM accounting_executions WHERE id = ?').get(execId) as { action: string };
    expect(row.action).toBe('add');
    // Compensation is a manual_adjustment with the deterministic key.
    expect(compensationCount(execId)).toBe(1);

    // Net cash now correct: -900 + 1800 = +900.
    expect(canonicalNetCash(accountId)).toBe(900);

    // Idempotent: second run adds nothing.
    const second = repairExecutionCashDirectionForAccount(sqlite, accountId);
    expect(second.repaired).toBe(0);
    expect(compensationCount(execId)).toBe(1);
    expect(canonicalNetCash(accountId)).toBe(900);
  });

  it('short reduce: recorded increase (+800) repaired with -1,600 compensation (idempotent)', () => {
    const accountId = seedAccount();
    const tradeId = seedTrade(accountId, 'short');
    // Pre-A5 state: short reduce 20@40 → recorded +800, correct -800.
    const execId = seedPreA5AccountingExecution(accountId, tradeId, 'reduce', '20.00', '40.00', '2026-01-05T10:00:00.000Z');
    seedWrongFinancialEvent(accountId, execId, 'reduce', '20.00', '40.00', '2026-01-05T10:00:00.000Z');

    expect(canonicalNetCash(accountId)).toBe(800); // broken pre-A5 replay

    const first = repairExecutionCashDirectionForAccount(sqlite, accountId);
    expect(first.repaired).toBe(1);
    expect(compensationCount(execId)).toBe(1);
    // +800 - 1600 = -800.
    expect(canonicalNetCash(accountId)).toBe(-800);

    const second = repairExecutionCashDirectionForAccount(sqlite, accountId);
    expect(second.repaired).toBe(0);
    expect(compensationCount(execId)).toBe(1);
    expect(canonicalNetCash(accountId)).toBe(-800);
  });

  it('long add/reduce are already correct — no compensation posted', () => {
    const accountId = seedAccount();
    const tradeId = seedTrade(accountId, 'long');
    // Long add → buy (decrease, correct) and long reduce → sell (increase, correct).
    const addId = seedPreA5AccountingExecution(accountId, tradeId, 'add', '20.00', '45.00', '2026-01-05T10:00:00.000Z');
    const reduceId = seedPreA5AccountingExecution(accountId, tradeId, 'reduce', '20.00', '55.00', '2026-01-05T11:00:00.000Z');
    seedWrongFinancialEvent(accountId, addId, 'add', '20.00', '45.00', '2026-01-05T10:00:00.000Z');
    seedWrongFinancialEvent(accountId, reduceId, 'reduce', '20.00', '55.00', '2026-01-05T11:00:00.000Z');

    const result = repairExecutionCashDirectionForAccount(sqlite, accountId);
    expect(result.repaired).toBe(0);
    expect(result.scanned).toBe(2);
    expect(compensationCount(addId)).toBe(0);
    expect(compensationCount(reduceId)).toBe(0);
  });

  it('concrete actions (sell_short/buy_to_cover) are unambiguous — never touched', () => {
    const accountId = seedAccount();
    const tradeId = seedTrade(accountId, 'short');
    const execId = seedPreA5AccountingExecution(accountId, tradeId, 'sell_short', '100.00', '50.00', '2026-01-05T10:00:00.000Z');

    const result = repairExecutionCashDirectionForAccount(sqlite, accountId);
    expect(result.repaired).toBe(0);
    expect(result.scanned).toBe(0);
    expect(compensationCount(execId)).toBe(0);
  });

  it('unlinked generic rows (no journal trade) are never guessed', () => {
    const accountId = seedAccount();
    // No trades row — direct insert of an unlinked add execution.
    const instrumentId = seedInstrument();
    const execId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO accounting_executions
           (id, account_id, instrument_id, action, quantity, price, fees,
            idempotency_key, journal_trade_id, description, posted_at, created_at)
         VALUES (?, ?, ?, 'add', '20.00', '45.00', '0.00', NULL, NULL, NULL, ?, ?)`,
      )
      .run(execId, accountId, instrumentId, now(), now());

    const result = repairExecutionCashDirectionForAccount(sqlite, accountId);
    expect(result.repaired).toBe(0);
    expect(result.scanned).toBe(0);
    expect(compensationCount(execId)).toBe(0);
  });
});
