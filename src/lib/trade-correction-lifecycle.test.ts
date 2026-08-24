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
import { testDbPath, disposeSqliteFile, applyAllMigrations } from '@/lib/testing/test-db';
import {
  resolveEffectiveExecutions,
  recomputeTradeLifecycle,
} from '@/lib/trade-correction-lifecycle';
import {
  findOrCreateInstrument,
  insertAccountingExecution,
  insertCorrectionLineage,
} from '@/db/accounting-repository';

const TEST_DB_PATH = testDbPath('trade-correction-lifecycle');

let sqlite: Database.Database;
let instrumentId: string;

beforeAll(() => {
  sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyAllMigrations(sqlite);

  // Seed the FK targets referenced by accounting_executions and
  // correction_lineage (accounts + instruments).
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, max_risk_per_trade_pct, default_commission, starting_balance, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', 1, NULL, NULL, NULL, ?, ?)`,
    )
    .run('acct-1', 'Lifecycle Test Account', null, now, now);
  instrumentId = findOrCreateInstrument(sqlite, 'AAPL').id;
});

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

// ── recomputeTradeLifecycle ─────────────────────────────────────────────

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
