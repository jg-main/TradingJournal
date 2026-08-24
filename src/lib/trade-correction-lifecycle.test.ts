/**
 * trade-correction-lifecycle.test.ts
 *
 * Focused tests for the S06/T02 lifecycle rebuild library:
 *   resolveEffectiveExecutions  — lineage-aware effective execution set
 *   recomputeTradeLifecycle     — deterministic status/openedAt/closedAt
 *
 * Uses a fully-migrated temp database (applyAllMigrations) and seeds
 * accounting_executions through the real insertAccountingExecution
 * repository helper, so the lineage resolution is exercised against the
 * real schema (including the correction_lineage FK graph).
 *
 * Run: npx vitest run src/lib/trade-correction-lifecycle.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/db/schema';
import { testDbPath, disposeSqliteFile, applyAllMigrations } from '@/lib/testing/test-db';
import {
  resolveEffectiveExecutions,
  recomputeTradeLifecycle,
  resolveFirstEntry,
  repairRiskSnapshot,
} from '@/lib/trade-correction-lifecycle';
import {
  findOrCreateInstrument,
  insertAccountingExecution,
  insertCorrectionLineage,
} from '@/db/accounting-repository';

const TEST_DB_PATH = testDbPath('trade-correction-lifecycle');

let sqlite: Database.Database;
let dbHandle: ReturnType<typeof drizzle<typeof schema>>;
let instrumentId: string;

beforeAll(() => {
  sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyAllMigrations(sqlite);

  // Drizzle wrapper over the SAME connection, so repair writes inside
  // dbHandle.transaction() are visible to raw reads and vice versa.
  dbHandle = drizzle(sqlite, { schema });

  // Seed the FK targets referenced by accounting_executions,
  // correction_lineage, and trade_risk_snapshots (accounts + instruments).
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, max_risk_per_trade_pct, default_commission, starting_balance, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', 1, NULL, NULL, NULL, ?, ?)`,
    )
    .run('acct-1', 'Lifecycle Test Account', null, now, now);
  instrumentId = findOrCreateInstrument(sqlite, 'AAPL').id;
});

// ── Seed helpers ────────────────────────────────────────────────────────

function seedTradeRow(tradeId: string, plannedStop: number | null = 145) {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, planned_stop, created_at, updated_at)
       VALUES (?, ?, 'acct-1', 'AAPL', 'long', 'open', ?, ?, ?)`,
    )
    .run(tradeId, `TC-${tradeId}`, plannedStop, now, now);
}

/** Seed a trade_risk_snapshots row (what the execution engine creates on first fill). */
function seedRiskSnapshot(
  tradeId: string,
  values: Partial<{
    initialEntryPrice: number;
    initialQuantity: number;
    initialStopPrice: number | null;
    riskPerShare: number | null;
    initialRiskAmount: number | null;
    accountEquityAtOpen: number | null;
    accountRiskPct: number | null;
  }> = {},
) {
  const now = new Date().toISOString();
  const v = {
    initialEntryPrice: 150,
    initialQuantity: 100,
    initialStopPrice: 145,
    riskPerShare: 5,
    initialRiskAmount: 500,
    accountEquityAtOpen: 100000,
    accountRiskPct: 0.5,
    ...values,
  };
  sqlite
    .prepare(
      `INSERT INTO trade_risk_snapshots
         (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price,
          initial_quantity, risk_per_share, initial_risk_amount, account_risk_pct, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `rs-${tradeId}`,
      tradeId,
      v.accountEquityAtOpen,
      v.initialEntryPrice,
      v.initialStopPrice,
      v.initialQuantity,
      v.riskPerShare,
      v.initialRiskAmount,
      v.accountRiskPct,
      now,
    );
}

function readSnapshot(tradeId: string): Record<string, unknown> | undefined {
  return sqlite
    .prepare('SELECT * FROM trade_risk_snapshots WHERE trade_id = ?')
    .get(tradeId) as Record<string, unknown> | undefined;
}

afterAll(() => {
  disposeSqliteFile(sqlite, TEST_DB_PATH);
});

// ── Seed helpers ────────────────────────────────────────────────────────

function seedExecution(overrides: Record<string, unknown> = {}) {
  return insertAccountingExecution(sqlite, {
    accountId: 'acct-1',
    instrumentId,
    action: 'buy',
    quantity: '100.00',
    price: '150.00',
    fees: '1.00',
    journalTradeId: 'trade-1',
    description: null,
    postedAt: '2025-06-01T10:00:00.000Z',
    ...overrides,
  });
}

function seedLineage(originalId: string, reversalId: string, replacementId: string) {
  insertCorrectionLineage(sqlite, {
    accountId: 'acct-1',
    originalExecutionId: originalId,
    reversalExecutionId: reversalId,
    replacementExecutionId: replacementId,
    correctedAt: '2025-06-01T11:00:00.000Z',
  });
}

// ── resolveEffectiveExecutions ──────────────────────────────────────────

describe('resolveEffectiveExecutions', () => {
  it('returns an empty array for a trade with no executions', () => {
    const effective = resolveEffectiveExecutions(sqlite, 'trade-with-no-execs');
    expect(effective).toEqual([]);
  });

  it('keeps every original execution when no correction lineage exists', () => {
    const e1 = seedExecution({ journalTradeId: 'trade-plain', postedAt: '2025-06-01T10:00:00.000Z' });
    const e2 = seedExecution({
      journalTradeId: 'trade-plain',
      action: 'sell',
      quantity: '100.00',
      postedAt: '2025-06-01T15:00:00.000Z',
    });

    const effective = resolveEffectiveExecutions(sqlite, 'trade-plain');
    expect(effective.map((e) => e.id).sort()).toEqual([e1.id, e2.id].sort());
    expect(effective.find((e) => e.id === e1.id)).toMatchObject({
      action: 'buy',
      quantity: 100,
      price: 150,
      fees: 1,
    });
  });

  it('excludes the original and reversal of a corrected execution, keeping the replacement', () => {
    const original = seedExecution({ journalTradeId: 'trade-c1' });
    const reversal = seedExecution({ journalTradeId: 'trade-c1', action: 'sell' });
    const replacement = seedExecution({
      journalTradeId: 'trade-c1',
      action: 'buy',
      quantity: '150.00',
      price: '152.00',
      postedAt: '2025-06-01T10:00:00.001Z',
    });
    seedLineage(original.id, reversal.id, replacement.id);

    const effective = resolveEffectiveExecutions(sqlite, 'trade-c1');
    expect(effective.map((e) => e.id)).toEqual([replacement.id]);
    expect(effective[0]).toMatchObject({
      action: 'buy',
      quantity: 150,
      price: 152,
    });
  });

  it('resolves multiple corrections on the same trade (only replacements survive)', () => {
    // Entry corrected once, exit corrected once → two surviving replacements.
    const entryOriginal = seedExecution({ journalTradeId: 'trade-c2', postedAt: '2025-06-01T10:00:00.000Z' });
    const entryReversal = seedExecution({ journalTradeId: 'trade-c2', action: 'sell', postedAt: '2025-06-01T10:00:00.001Z' });
    const entryReplacement = seedExecution({
      journalTradeId: 'trade-c2',
      quantity: '120.00',
      postedAt: '2025-06-01T10:00:00.002Z',
    });
    seedLineage(entryOriginal.id, entryReversal.id, entryReplacement.id);

    const exitOriginal = seedExecution({
      journalTradeId: 'trade-c2',
      action: 'sell',
      quantity: '100.00',
      postedAt: '2025-06-01T15:00:00.000Z',
    });
    const exitReversal = seedExecution({
      journalTradeId: 'trade-c2',
      action: 'buy',
      quantity: '100.00',
      postedAt: '2025-06-01T15:00:00.001Z',
    });
    const exitReplacement = seedExecution({
      journalTradeId: 'trade-c2',
      action: 'sell',
      quantity: '120.00',
      postedAt: '2025-06-01T15:00:00.002Z',
    });
    seedLineage(exitOriginal.id, exitReversal.id, exitReplacement.id);

    const effective = resolveEffectiveExecutions(sqlite, 'trade-c2');
    expect(effective.map((e) => e.id).sort()).toEqual(
      [entryReplacement.id, exitReplacement.id].sort(),
    );
    // Deterministic chronological order for lifecycle derivation.
    expect(effective[0].id).toBe(entryReplacement.id);
    expect(effective[1].id).toBe(exitReplacement.id);
  });
});

// ── resolveFirstEntry ──────────────────────────────────────────────────

describe('resolveFirstEntry', () => {
  it('returns the earliest entry-action execution for a long trade', () => {
    const first = resolveFirstEntry(
      [
        { id: 'e2', action: 'add', quantity: 50, price: 148, fees: 0, executedAt: '2025-06-01T11:00:00.000Z' },
        { id: 'e1', action: 'buy', quantity: 100, price: 150, fees: 0, executedAt: '2025-06-01T10:00:00.000Z' },
      ],
      'long',
    );
    expect(first?.id).toBe('e1');
  });

  it('treats sell_short as the entry action for a short trade', () => {
    const first = resolveFirstEntry(
      [
        { id: 'e1', action: 'sell_short', quantity: 100, price: 200, fees: 0, executedAt: '2025-06-01T10:00:00.000Z' },
        { id: 'e2', action: 'buy_to_cover', quantity: 50, price: 195, fees: 0, executedAt: '2025-06-01T15:00:00.000Z' },
      ],
      'short',
    );
    expect(first?.id).toBe('e1');
  });

  it('returns null when there are no entry actions', () => {
    expect(resolveFirstEntry([], 'long')).toBeNull();
  });
});

// ── repairRiskSnapshot ─────────────────────────────────────────────────

describe('repairRiskSnapshot', () => {
  it('repairs the snapshot when the corrected execution was the first entry', () => {
    seedTradeRow('trade-repair');
    const original = seedExecution({ journalTradeId: 'trade-repair' });
    const reversal = seedExecution({ journalTradeId: 'trade-repair', action: 'sell' });
    const replacement = seedExecution({
      journalTradeId: 'trade-repair',
      price: '152.00',
      postedAt: '2025-06-01T10:00:00.001Z',
    });
    seedLineage(original.id, reversal.id, replacement.id);
    seedRiskSnapshot('trade-repair');

    const result = dbHandle.transaction((tx) =>
      repairRiskSnapshot({
        tx,
        sqlite,
        tradeId: 'trade-repair',
        accountId: 'acct-1',
        direction: 'long',
        preCorrectionFirstEntryId: original.id,
        correctedOriginalId: original.id,
        replacementExecution: { price: '152.00', quantity: '100.00', action: 'buy' },
        plannedStop: 145,
        asOf: replacement.posted_at,
      }),
    );

    expect(result.repaired).toBe(true);
    expect(result.reason).toBe('repaired');
    expect(result.oldValues).toMatchObject({ initialEntryPrice: 150, riskPerShare: 5, initialRiskAmount: 500 });
    expect(result.newValues).toMatchObject({
      initialEntryPrice: 152,
      initialQuantity: 100,
      initialStopPrice: 145,
      riskPerShare: 7,
      initialRiskAmount: 700,
    });
    // Persisted row updated.
    const row = readSnapshot('trade-repair');
    expect(row?.initial_entry_price).toBe(152);
    expect(row?.risk_per_share).toBe(7);
    expect(row?.initial_risk_amount).toBe(700);
  });

  it('skips when the corrected execution was NOT the first entry (later add)', () => {
    seedTradeRow('trade-repair-skip');
    const entry = seedExecution({ journalTradeId: 'trade-repair-skip' });
    const add = seedExecution({
      journalTradeId: 'trade-repair-skip',
      quantity: '50.00',
      price: '148.00',
      postedAt: '2025-06-01T11:00:00.000Z',
    });
    seedRiskSnapshot('trade-repair-skip');

    const result = dbHandle.transaction((tx) =>
      repairRiskSnapshot({
        tx,
        sqlite,
        tradeId: 'trade-repair-skip',
        accountId: 'acct-1',
        direction: 'long',
        preCorrectionFirstEntryId: entry.id, // first entry is the original buy
        correctedOriginalId: add.id, // but the corrected execution is the later add
        replacementExecution: { price: '149.00', quantity: '80.00', action: 'add' },
        plannedStop: null,
        asOf: '2025-06-01T10:00:00.000Z',
      }),
    );

    expect(result.repaired).toBe(false);
    expect(result.reason).toBe('first-entry-unchanged');
    expect(result.newValues).toBeNull();
    const row = readSnapshot('trade-repair-skip');
    expect(row?.initial_entry_price).toBe(150);
    expect(row?.initial_risk_amount).toBe(500);
  });

  it('skips when no risk snapshot exists and creates none', () => {
    seedTradeRow('trade-repair-no-snap');
    const original = seedExecution({ journalTradeId: 'trade-repair-no-snap' });

    const result = dbHandle.transaction((tx) =>
      repairRiskSnapshot({
        tx,
        sqlite,
        tradeId: 'trade-repair-no-snap',
        accountId: 'acct-1',
        direction: 'long',
        preCorrectionFirstEntryId: original.id,
        correctedOriginalId: original.id,
        replacementExecution: { price: '152.00', quantity: '100.00', action: 'buy' },
        plannedStop: null,
        asOf: '2025-06-01T10:00:00.000Z',
      }),
    );

    expect(result.repaired).toBe(false);
    expect(result.reason).toBe('no-snapshot');
    expect(result.oldValues).toBeNull();
    expect(readSnapshot('trade-repair-no-snap')).toBeUndefined();
  });

  it('skips when the replacement is not an entry action', () => {
    seedTradeRow('trade-repair-exit');
    const original = seedExecution({ journalTradeId: 'trade-repair-exit' });
    seedRiskSnapshot('trade-repair-exit');

    const result = dbHandle.transaction((tx) =>
      repairRiskSnapshot({
        tx,
        sqlite,
        tradeId: 'trade-repair-exit',
        accountId: 'acct-1',
        direction: 'long',
        preCorrectionFirstEntryId: original.id,
        correctedOriginalId: original.id,
        replacementExecution: { price: '152.00', quantity: '100.00', action: 'sell' },
        plannedStop: null,
        asOf: '2025-06-01T10:00:00.000Z',
      }),
    );

    expect(result.repaired).toBe(false);
    expect(result.reason).toBe('no-entry');
    const row = readSnapshot('trade-repair-exit');
    expect(row?.initial_entry_price).toBe(150);
  });

  it('preserves the stored initial stop over the planned stop', () => {
    seedTradeRow('trade-repair-stop');
    const original = seedExecution({ journalTradeId: 'trade-repair-stop' });
    // Stored open-time stop 140 differs from the planned stop 145.
    seedRiskSnapshot('trade-repair-stop', { initialStopPrice: 140, riskPerShare: 10, initialRiskAmount: 1000 });

    const result = dbHandle.transaction((tx) =>
      repairRiskSnapshot({
        tx,
        sqlite,
        tradeId: 'trade-repair-stop',
        accountId: 'acct-1',
        direction: 'long',
        preCorrectionFirstEntryId: original.id,
        correctedOriginalId: original.id,
        replacementExecution: { price: '152.00', quantity: '100.00', action: 'buy' },
        plannedStop: 145,
        asOf: '2025-06-01T10:00:00.000Z',
      }),
    );

    expect(result.repaired).toBe(true);
    expect(result.newValues).toMatchObject({
      initialStopPrice: 140, // stored open-time stop wins over plannedStop
      riskPerShare: 12, // |152 - 140|
      initialRiskAmount: 1200,
    });
  });

  it('uses the replacement values even when the corrected first entry is displaced in time', () => {
    seedTradeRow('trade-repair-future');
    // First entry corrected long after the fact: the replacement's postedAt
    // lands AFTER a second entry, so the replacement is no longer the earliest
    // entry in the effective set — the repair must still use the replacement's
    // corrected values, not the second entry's.
    const original = seedExecution({ journalTradeId: 'trade-repair-future', postedAt: '2025-06-01T10:00:00.000Z' });
    const secondEntry = seedExecution({
      journalTradeId: 'trade-repair-future',
      quantity: '50.00',
      price: '148.00',
      postedAt: '2025-06-01T11:00:00.000Z',
    });
    const reversal = seedExecution({ journalTradeId: 'trade-repair-future', action: 'sell', postedAt: '2025-06-01T10:00:00.001Z' });
    const replacement = seedExecution({
      journalTradeId: 'trade-repair-future',
      price: '152.00',
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    seedLineage(original.id, reversal.id, replacement.id);
    seedRiskSnapshot('trade-repair-future');

    const result = dbHandle.transaction((tx) =>
      repairRiskSnapshot({
        tx,
        sqlite,
        tradeId: 'trade-repair-future',
        accountId: 'acct-1',
        direction: 'long',
        preCorrectionFirstEntryId: original.id,
        correctedOriginalId: original.id,
        replacementExecution: { price: '152.00', quantity: '100.00', action: 'buy' },
        plannedStop: 145,
        asOf: '2025-06-01T10:00:00.000Z',
      }),
    );

    expect(result.repaired).toBe(true);
    expect(result.newValues?.initialEntryPrice).toBe(152);
    expect(result.newValues?.initialQuantity).toBe(100);
    // Sanity: the effective set's earliest entry is the second entry now.
    const effective = resolveEffectiveExecutions(sqlite, 'trade-repair-future');
    expect(resolveFirstEntry(effective, 'long')?.id).toBe(secondEntry.id);
  });

  it('A3 §23: repair rolls back atomically when the surrounding correction transaction fails', () => {
    // A client PUT is retired, but legitimate server repair must stay
    // transactional: force a failure AFTER repair begins, inside the same
    // correction transaction — the snapshot must keep its prior coherent
    // value (no non-transactional snapshot write survives the rollback).
    seedTradeRow('trade-repair-rollback');
    const original = seedExecution({ journalTradeId: 'trade-repair-rollback' });
    const reversal = seedExecution({ journalTradeId: 'trade-repair-rollback', action: 'sell' });
    const replacement = seedExecution({
      journalTradeId: 'trade-repair-rollback',
      price: '152.00',
      postedAt: '2025-06-01T10:00:00.001Z',
    });
    seedLineage(original.id, reversal.id, replacement.id);
    seedRiskSnapshot('trade-repair-rollback'); // entry 150, risk 500
    const before = readSnapshot('trade-repair-rollback') as Record<string, unknown>;

    expect(() =>
      dbHandle.transaction((tx) => {
        repairRiskSnapshot({
          tx,
          sqlite,
          tradeId: 'trade-repair-rollback',
          accountId: 'acct-1',
          direction: 'long',
          preCorrectionFirstEntryId: original.id,
          correctedOriginalId: original.id,
          replacementExecution: { price: '152.00', quantity: '100.00', action: 'buy' },
          plannedStop: 145,
          asOf: replacement.posted_at,
        });
        // Simulated failure after the repair began, before commit.
        throw new Error('correction pipeline failed after repair');
      }),
    ).toThrow('correction pipeline failed after repair');

    const after = readSnapshot('trade-repair-rollback');
    expect(after?.initial_entry_price).toBe(before.initial_entry_price);
    expect(after?.initial_risk_amount).toBe(before.initial_risk_amount);
    expect(after?.risk_per_share).toBe(before.risk_per_share);
  });
});

describe('recomputeTradeLifecycle', () => {
  it('derives closed with openedAt/closedAt for a full long exit', () => {
    const lifecycle = recomputeTradeLifecycle(
      [
        { id: 'e1', action: 'buy', quantity: 100, price: 150, fees: 1, executedAt: '2025-06-01T10:00:00.000Z' },
        { id: 'e2', action: 'sell', quantity: 100, price: 160, fees: 1, executedAt: '2025-06-01T15:00:00.000Z' },
      ],
      'long',
    );
    expect(lifecycle).toEqual({
      status: 'closed',
      openedAt: '2025-06-01T10:00:00.000Z',
      closedAt: '2025-06-01T15:00:00.000Z',
    });
  });

  it('derives open with null closedAt for a partial long exit', () => {
    const lifecycle = recomputeTradeLifecycle(
      [
        { id: 'e1', action: 'buy', quantity: 100, price: 150, fees: 0, executedAt: '2025-06-01T10:00:00.000Z' },
        { id: 'e2', action: 'sell', quantity: 50, price: 160, fees: 0, executedAt: '2025-06-01T15:00:00.000Z' },
      ],
      'long',
    );
    expect(lifecycle.status).toBe('open');
    expect(lifecycle.closedAt).toBeNull();
    expect(lifecycle.openedAt).toBe('2025-06-01T10:00:00.000Z');
  });

  it('derives open for a partially covered short', () => {
    const lifecycle = recomputeTradeLifecycle(
      [
        { id: 'e1', action: 'sell_short', quantity: 100, price: 200, fees: 0, executedAt: '2025-06-01T10:00:00.000Z' },
        { id: 'e2', action: 'buy_to_cover', quantity: 50, price: 195, fees: 0, executedAt: '2025-06-01T15:00:00.000Z' },
      ],
      'short',
    );
    expect(lifecycle.status).toBe('open');
    expect(lifecycle.closedAt).toBeNull();
  });

  it('derives planned when there are no entries', () => {
    const lifecycle = recomputeTradeLifecycle([], 'long');
    expect(lifecycle).toEqual({ status: 'planned', openedAt: null, closedAt: null });
  });

  it('handles add/reduce management actions as entries/exits', () => {
    const lifecycle = recomputeTradeLifecycle(
      [
        { id: 'e1', action: 'buy', quantity: 100, price: 150, fees: 0, executedAt: '2025-06-01T10:00:00.000Z' },
        { id: 'e2', action: 'add', quantity: 50, price: 148, fees: 0, executedAt: '2025-06-01T11:00:00.000Z' },
        { id: 'e3', action: 'reduce', quantity: 30, price: 155, fees: 0, executedAt: '2025-06-01T12:00:00.000Z' },
      ],
      'long',
    );
    expect(lifecycle.status).toBe('open');
    expect(lifecycle.openedAt).toBe('2025-06-01T10:00:00.000Z');
    expect(lifecycle.closedAt).toBeNull();
  });
});
