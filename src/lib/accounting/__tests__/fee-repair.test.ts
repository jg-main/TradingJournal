/**
 * fee-repair.test.ts
 *
 * M002-A6 — historical execution-fee repair tests.
 *
 * Covers:
 *   1. uncorrected entry fee missing → one fee event posted
 *   2. zero-fee execution → no event
 *   3. already-repaired execution → no duplicate
 *   4. corrected original/reversal/replacement → replacement only
 *   5. partial-close account → FIFO projection repaired
 *   6. projection failure → fee repair rolled back
 *   7. second run → same cash/P&L/NAV
 *
 * Run: npx vitest run src/lib/accounting/__tests__/fee-repair.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { testDbPath, disposeSqliteFile, applyAllMigrations } from '@/lib/testing/test-db';
import { repairExecutionFeesForAccount } from '../fee-repair';
import { executionFeeFinancialEventIdempotencyKey } from '../execution-posting';
import { postExecutionFill } from '../execution-posting';
import { postFinancialEvent } from '../posting';
import { correctExecution } from '../correction';
import { rebuildAccountPerformance } from '../../performance/performance-rebuild';

const TEST_DB_PATH = testDbPath('fee-repair');

let sqlite: Database.Database;

beforeAll(() => {
  sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyAllMigrations(sqlite);
  // Drop ledger immutability triggers so the fixture can simulate pre-A6
  // state (delete the fee event it just posted). The repair service only
  // INSERTs; the test flow is unaffected.
  sqlite.exec(`
    DROP TRIGGER IF EXISTS trg_financial_events_prevent_update;
    DROP TRIGGER IF EXISTS trg_financial_events_prevent_delete;
    DROP TRIGGER IF EXISTS trg_ledger_entries_prevent_update;
    DROP TRIGGER IF EXISTS trg_ledger_entries_prevent_delete;
    DROP TRIGGER IF EXISTS trg_ledger_postings_prevent_update;
    DROP TRIGGER IF EXISTS trg_ledger_postings_prevent_delete;
  `);
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
       VALUES (?, 'Fee Repair', 'USD', 1, NULL, ?, ?)`,
    )
    .run(id, now(), now());
  return id;
}

function feeEventCount(executionId: string): number {
  const row = sqlite
    .prepare('SELECT count(*) AS n FROM financial_events WHERE idempotency_key = ?')
    .get(executionFeeFinancialEventIdempotencyKey(executionId)) as { n: number };
  return row.n;
}

function netCash(accountId: string): number {
  const row = sqlite
    .prepare('SELECT net_cash FROM account_performance WHERE account_id = ?')
    .get(accountId) as { net_cash: string } | undefined;
  return row ? Number(row.net_cash) : Number.NaN;
}

function nav(accountId: string): number {
  const row = sqlite
    .prepare('SELECT nav FROM account_performance WHERE account_id = ?')
    .get(accountId) as { nav: string } | undefined;
  return row ? Number(row.nav) : Number.NaN;
}

/** Post a fee-bearing execution WITHOUT its fee cash event (pre-A6 state). */
function seedPreA6Execution(accountId: string, fees: string): string {
  const result = postExecutionFill(sqlite, {
    accountId,
    symbol: 'AAPL',
    action: 'buy',
    quantity: '100.00',
    price: '50.00',
    fees,
    postedAt: now(),
  });
  // Simulate pre-A6: remove the fee event + its ledger rows.
  const feeKey = executionFeeFinancialEventIdempotencyKey(result.execution.id);
  const eventRow = sqlite
    .prepare('SELECT id FROM financial_events WHERE idempotency_key = ?')
    .get(feeKey) as { id: string } | undefined;
  if (eventRow) {
    sqlite.prepare('DELETE FROM ledger_postings WHERE ledger_entry_id IN (SELECT id FROM ledger_entries WHERE financial_event_id = ?)').run(eventRow.id);
    sqlite.prepare('DELETE FROM ledger_entries WHERE financial_event_id = ?').run(eventRow.id);
    sqlite.prepare('DELETE FROM financial_events WHERE id = ?').run(eventRow.id);
  }
  return result.execution.id;
}

describe('repairExecutionFeesForAccount', () => {
  it('1: uncorrected entry fee missing → exactly one fee event posted', () => {
    const accountId = seedAccount();
    const execId = seedPreA6Execution(accountId, '10.00');
    expect(feeEventCount(execId)).toBe(0);
    // No projection yet — repair also rebuilds performance.
    const result = repairExecutionFeesForAccount(sqlite, accountId);
    expect(result.repaired).toBe(1);
    expect(result.scanned).toBe(1);
    expect(feeEventCount(execId)).toBe(1);
    // Cash reflects the fee: 0 opening + 0 gross? No opening seeded — cash = -5000 - 10.
    expect(netCash(accountId)).toBe(-5010);
  });

  it('2: zero-fee execution → no fee event', () => {
    const accountId = seedAccount();
    const execId = seedPreA6Execution(accountId, '0.00');
    const result = repairExecutionFeesForAccount(sqlite, accountId);
    expect(result.repaired).toBe(0);
    expect(result.scanned).toBe(0);
    expect(feeEventCount(execId)).toBe(0);
  });

  it('3+7: already-repaired → no duplicate; second run → identical cash/P&L/NAV', () => {
    const accountId = seedAccount();
    const execId = seedPreA6Execution(accountId, '10.00');
    const first = repairExecutionFeesForAccount(sqlite, accountId);
    expect(first.repaired).toBe(1);
    const cash1 = netCash(accountId);
    const nav1 = nav(accountId);
    const second = repairExecutionFeesForAccount(sqlite, accountId);
    expect(second.repaired).toBe(0);
    expect(feeEventCount(execId)).toBe(1);
    expect(netCash(accountId)).toBe(cash1);
    expect(nav(accountId)).toBe(nav1);
  });

  it('4: corrected original/reversal/replacement → replacement fee only', () => {
    const accountId = seedAccount();
    // Original posted WITH its fee event (post-A6) → then corrected.
    const original = postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '50.00',
      fees: '10.00',
      postedAt: now(),
    });
    correctExecution(sqlite, {
      accountId,
      originalExecutionId: original.execution.id,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '49.00',
      fees: '7.00',
      reason: 'fee repair test correction',
    });

    // Now delete the replacement's fee event to simulate a gap, then repair.
    const replacementFeeKey = executionFeeFinancialEventIdempotencyKey(
      (sqlite.prepare(
        "SELECT id FROM accounting_executions WHERE account_id = ? AND description LIKE 'Correction replacement%' ORDER BY created_at DESC LIMIT 1",
      ).get(accountId) as { id: string }).id,
    );
    const replEvent = sqlite.prepare('SELECT id FROM financial_events WHERE idempotency_key = ?').get(replacementFeeKey) as { id: string } | undefined;
    if (replEvent) {
      sqlite.prepare('DELETE FROM ledger_postings WHERE ledger_entry_id IN (SELECT id FROM ledger_entries WHERE financial_event_id = ?)').run(replEvent.id);
      sqlite.prepare('DELETE FROM ledger_entries WHERE financial_event_id = ?').run(replEvent.id);
      sqlite.prepare('DELETE FROM financial_events WHERE id = ?').run(replEvent.id);
    }

    const result = repairExecutionFeesForAccount(sqlite, accountId);
    // Only the replacement (effective) execution gets a fee event — the
    // original and reversal are excluded by lineage.
    expect(result.repaired).toBe(1);
    const allFeeEvents = sqlite
      .prepare(`SELECT count(*) AS n FROM financial_events WHERE event_type = 'fee' AND account_id = ?`)
      .get(accountId) as { n: number };
    // original fee (10) + replacement fee (7) — reversal never charged.
    expect(allFeeEvents.n).toBe(2);
  });

  it('5: partial-close account → projection repaired coherently', () => {
    const accountId = seedAccount();
    const entryId = seedPreA6Execution(accountId, '10.00');
    // Close 40 @ 55 fee 4 (fee event present — it's new).
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '40.00',
      price: '55.00',
      fees: '4.00',
      postedAt: now(),
    });
    // Clear the entry's fee event to simulate the gap.
    const key = executionFeeFinancialEventIdempotencyKey(entryId);
    const ev = sqlite.prepare('SELECT id FROM financial_events WHERE idempotency_key = ?').get(key) as { id: string } | undefined;
    if (ev) sqlite.prepare('DELETE FROM financial_events WHERE id = ?').run(ev.id);

    const result = repairExecutionFeesForAccount(sqlite, accountId);
    expect(result.repaired).toBe(1);
    expect(feeEventCount(entryId)).toBe(1);
    // Position realized fees: entry 4 (40/100 of 10) + exit 4 = 8.
    const pos = sqlite
      .prepare('SELECT realized_fees, realized_net_pnl FROM account_positions WHERE account_id = ?')
      .get(accountId) as { realized_fees: string; realized_net_pnl: string };
    expect(pos.realized_fees).toBe('8.00');
    // Remaining open fee = 6 on the open 60 shares.
    const open = sqlite
      .prepare("SELECT SUM(allocated_fees) AS f FROM fifo_lots WHERE account_id = ? AND remaining_quantity != '0.00'")
      .get(accountId) as { f: number | null };
    expect(Number(open.f ?? 0)).toBe(6);
  });

  it('6: projection failure → fee repair rolled back', () => {
    const accountId = seedAccount();
    seedPreA6Execution(accountId, '10.00');
    const before = sqlite.prepare("SELECT count(*) AS n FROM financial_events WHERE account_id = ?").get(accountId) as { n: number };

    // Force a deterministic projection failure: the repair transaction posts
    // the missing fee event, then rebuilds the account performance
    // projection — dropping the projection table makes that rebuild throw,
    // and the whole transaction must roll back the newly posted fee event
    // (never an unprojected repair reported as success).
    sqlite.exec('DROP TABLE account_performance;');
    expect(() => repairExecutionFeesForAccount(sqlite, accountId)).toThrow();
    const after = sqlite.prepare("SELECT count(*) AS n FROM financial_events WHERE account_id = ?").get(accountId) as { n: number };
    expect(after.n).toBe(before.n);
  });
});
