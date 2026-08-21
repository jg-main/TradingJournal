/**
 * Tests for the financial event correction service.
 *
 * Exercises correctFinancialEvent against a real SQLite database with all
 * migrations applied, through the same services the API route uses.
 *
 * Covers:
 * - Deposit correction: reversal cancels the increase, replacement posts the
 *   corrected increase; lineage links all three events
 * - Withdrawal correction: reversal cancels the decrease
 * - Manual adjustment correction with signed amounts
 * - Net cash after correction equals the replacement's effect
 * - Reason persisted on the lineage row
 * - Already-corrected event → EventAlreadyCorrectedError
 * - Reversal/replacement constituents → EventNotCorrectableError
 * - Non-eligible event types (opening_balance, stock_split) → EventNotCorrectableError
 * - Duplicate correction idempotency key → DuplicateCorrectionIdempotencyError
 * - Cross-account event access → FinancialEventNotFoundError
 * - Invalid replacement amount sign for a cash type → InvalidAmountError
 * - Original event and lineage rows remain immutable
 *
 * Run: npx vitest run src/lib/accounting/financial-event-correction.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { postEventWithEffect } from '@/lib/accounting/event-posting';
import { correctFinancialEvent } from '@/lib/accounting/financial-event-correction';
import { computeAccountCashImpact } from '@/lib/accounting/activity';
import {
  findFinancialEventCorrectionByOriginalEvent,
  findFinancialEventCorrectionByRelatedEvent,
  listFinancialEventCorrectionsByAccount,
  listAccountEvents,
  findEventById,
} from '@/db/accounting-repository';
import {
  EventAlreadyCorrectedError,
  EventNotCorrectableError,
  DuplicateCorrectionIdempotencyError,
  FinancialEventNotFoundError,
  InvalidAmountError,
} from '@/lib/accounting/errors';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-financial-event-correction.db';

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
  secondAccountId: string;
}

function applyAllMigrations(sqlite: Database.Database): void {
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  if (!existsSync(migrationsDir)) return;
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
          // Skip statements that fail
        }
      }
    }
  }
}

function insertAccount(sqlite: Database.Database, name: string): string {
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
    )
    .run(accountId, name, now, now);
  return accountId;
}

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  applyAllMigrations(sqlite);

  const accountId = insertAccount(sqlite, 'Test Account');
  const secondAccountId = insertAccount(sqlite, 'Second Account');

  return { sqlite, accountId, secondAccountId };
}

function destroyTestDatabase(): void {
  try {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    for (const ext of ['-wal', '-shm']) {
      const path = TEST_DB_PATH + ext;
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function postDeposit(
  sqlite: Database.Database,
  accountId: string,
  amount: string,
  description = 'Initial deposit',
): string {
  const result = postEventWithEffect(sqlite, accountId, {
    eventType: 'deposit',
    amount,
    description,
  });
  return result.event.id;
}

function parseEffect(effectJson: string | null): {
  kind: string;
  direction: 'increase' | 'decrease';
  amount: string;
} {
  const parsed = JSON.parse(effectJson ?? '{}') as {
    kind: string;
    direction: 'increase' | 'decrease';
    amount: string;
  };
  return parsed;
}

function parsePayload(payloadJson: string | null): Record<string, unknown> {
  return JSON.parse(payloadJson ?? '{}') as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('correctFinancialEvent', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase();
  });

  it('corrects a deposit: reversal cancels increase, replacement posts corrected increase', () => {
    const { sqlite, accountId } = ctx;

    // Net cash changes by +1500.00: the original deposit (+1000) is
    // preserved immutably, the reversal cancels it (-1000), and the
    // replacement posts the corrected amount (+1500).
    const beforeCash = computeAccountCashImpact(sqlite, accountId);
    const originalId = postDeposit(sqlite, accountId, '1000.00');
    const original = findEventById(sqlite, originalId)!;
    expect(original.event_type).toBe('deposit');

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalId,
      amount: '1500.00',
      reason: 'Wrong deposit amount — corrected to 1500',
    });

    const afterCash = computeAccountCashImpact(sqlite, accountId);
    expect(afterCash.netCashImpactMicros - beforeCash.netCashImpactMicros).toBe(1_500_000_000);

    // Lineage row links all three events with the reason
    expect(result.correction.originalEventId).toBe(originalId);
    expect(result.correction.reason).toBe('Wrong deposit amount — corrected to 1500');
    expect(result.correction.reversalEventId).not.toBe(originalId);
    expect(result.correction.replacementEventId).not.toBe(originalId);
    expect(result.correction.replacementEventId).not.toBe(result.correction.reversalEventId);

    // Reversal: same type, opposite direction, same amount
    expect(result.reversalEvent.eventType).toBe('deposit');
    const reversalEffect = parseEffect(result.reversalEvent.effect);
    expect(reversalEffect.kind).toBe('cash');
    expect(reversalEffect.direction).toBe('decrease');
    expect(reversalEffect.amount).toBe('1000.00');

    // Replacement: same type, increase, corrected amount
    expect(result.replacementEvent.eventType).toBe('deposit');
    const replacementEffect = parseEffect(result.replacementEvent.effect);
    expect(replacementEffect.direction).toBe('increase');
    expect(replacementEffect.amount).toBe('1500.00');

    // Payload markers for lineage resolution
    const reversalPayload = parsePayload(result.reversalEvent.payload);
    expect(reversalPayload.correctionType).toBe('reversal');
    expect(reversalPayload.originalEventId).toBe(originalId);
    const replacementPayload = parsePayload(result.replacementEvent.payload);
    expect(replacementPayload.correctionType).toBe('replacement');
    expect(replacementPayload.originalEventId).toBe(originalId);

    // Persisted lineage row
    const persisted = findFinancialEventCorrectionByOriginalEvent(sqlite, originalId);
    expect(persisted).toBeDefined();
    expect(persisted!.reversal_event_id).toBe(result.correction.reversalEventId);
    expect(persisted!.replacement_event_id).toBe(result.correction.replacementEventId);
    expect(persisted!.reason).toBe('Wrong deposit amount — corrected to 1500');
  });

  it('corrects a withdrawal: reversal cancels the decrease', () => {
    const { sqlite, accountId } = ctx;

    postDeposit(sqlite, accountId, '5000.00', 'Funding for withdrawal test');
    const withdrawal = postEventWithEffect(sqlite, accountId, {
      eventType: 'withdrawal',
      amount: '200.00',
      description: 'Initial withdrawal',
    });

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: withdrawal.event.id,
      amount: '250.00',
      reason: 'Withdrawal amount was entered wrong',
    });

    // Reversal of a withdrawal is an increase
    const reversalEffect = parseEffect(result.reversalEvent.effect);
    expect(result.reversalEvent.eventType).toBe('withdrawal');
    expect(reversalEffect.direction).toBe('increase');
    expect(reversalEffect.amount).toBe('200.00');

    const replacementEffect = parseEffect(result.replacementEvent.effect);
    expect(result.replacementEvent.eventType).toBe('withdrawal');
    expect(replacementEffect.direction).toBe('decrease');
    expect(replacementEffect.amount).toBe('250.00');
  });

  it('corrects a manual_adjustment with signed amounts', () => {
    const { sqlite, accountId } = ctx;

    const adjustment = postEventWithEffect(sqlite, accountId, {
      eventType: 'manual_adjustment',
      amount: '-100.00',
      description: 'Negative adjustment',
    });

    // Correct to a positive adjustment
    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: adjustment.event.id,
      amount: '50.00',
      reason: 'Sign was wrong — should be a credit',
    });

    // Reversal of a decrease is an increase of the same magnitude
    const reversalEffect = parseEffect(result.reversalEvent.effect);
    expect(reversalEffect.direction).toBe('increase');
    expect(reversalEffect.amount).toBe('100.00');

    const replacementEffect = parseEffect(result.replacementEvent.effect);
    expect(replacementEffect.direction).toBe('increase');
    expect(replacementEffect.amount).toBe('50.00');
  });

  it('posts reversal and replacement events with balanced ledger postings', () => {
    const { sqlite, accountId } = ctx;

    const originalId = postDeposit(sqlite, accountId, '700.00');

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalId,
      amount: '800.00',
      reason: 'Balanced posting check',
    });

    // Both constituents have ledger entries with two postings each
    const rows = listAccountEvents(sqlite, accountId);
    const reversalRow = rows.find((r) => r.id === result.correction.reversalEventId);
    const replacementRow = rows.find((r) => r.id === result.correction.replacementEventId);
    expect(reversalRow).toBeDefined();
    expect(reversalRow!.entry_id).not.toBeNull();
    expect(reversalRow!.posting_count).toBe(2);
    expect(reversalRow!.is_balanced).toBe(1);
    expect(replacementRow).toBeDefined();
    expect(replacementRow!.entry_id).not.toBeNull();
    expect(replacementRow!.posting_count).toBe(2);
    expect(replacementRow!.is_balanced).toBe(1);
  });

  it('throws EventAlreadyCorrectedError when the event was already corrected', () => {
    const { sqlite, accountId } = ctx;

    const originalId = postDeposit(sqlite, accountId, '900.00');

    correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalId,
      amount: '950.00',
      reason: 'First correction',
    });

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: originalId,
        amount: '960.00',
        reason: 'Second correction',
      }),
    ).toThrow(EventAlreadyCorrectedError);
  });

  it('throws EventNotCorrectableError when correcting a reversal constituent', () => {
    const { sqlite, accountId } = ctx;

    const originalId = postDeposit(sqlite, accountId, '1100.00');

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalId,
      amount: '1200.00',
      reason: 'To create a reversal',
    });

    const reversalId = result.correction.reversalEventId;

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: reversalId,
        amount: '1300.00',
        reason: 'Should not be allowed',
      }),
    ).toThrow(EventNotCorrectableError);

    // Related-event lookup confirms the reversal is a constituent
    const related = findFinancialEventCorrectionByRelatedEvent(sqlite, reversalId);
    expect(related).toBeDefined();
    expect(related!.reversal_event_id).toBe(reversalId);
  });

  it('throws EventNotCorrectableError for non-eligible event types', () => {
    const { sqlite, accountId } = ctx;

    // opening_balance is not eligible
    const opening = postEventWithEffect(sqlite, accountId, {
      eventType: 'opening_balance',
      amount: '3000.00',
      description: 'Opening balance',
    });

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: opening.event.id,
        amount: '4000.00',
        reason: 'Trying to correct opening balance',
      }),
    ).toThrow(EventNotCorrectableError);

    // stock_split is not eligible
    const split = postEventWithEffect(sqlite, accountId, {
      eventType: 'stock_split',
      symbol: 'AAPL',
      ratio: '4:1',
      oldShares: 400,
      newShares: 100,
      description: 'Stock split',
    });

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: split.event.id,
        amount: '100.00',
        reason: 'Trying to correct stock split',
      }),
    ).toThrow(EventNotCorrectableError);
  });

  it('throws DuplicateCorrectionIdempotencyError for a reused idempotency key', () => {
    const { sqlite, accountId } = ctx;

    const firstId = postDeposit(sqlite, accountId, '2100.00');
    const key = randomUUID();

    correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: firstId,
      amount: '2200.00',
      reason: 'First correction with key',
      idempotencyKey: key,
    });

    const secondId = postDeposit(sqlite, accountId, '2300.00');

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: secondId,
        amount: '2400.00',
        reason: 'Should be rejected — same key',
        idempotencyKey: key,
      }),
    ).toThrow(DuplicateCorrectionIdempotencyError);
  });

  it('throws FinancialEventNotFoundError for cross-account events', () => {
    const { sqlite, accountId, secondAccountId } = ctx;

    const depositId = postDeposit(sqlite, accountId, '2500.00');

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId: secondAccountId,
        originalEventId: depositId,
        amount: '2600.00',
        reason: 'Cross-account access',
      }),
    ).toThrow(FinancialEventNotFoundError);
  });

  it('throws FinancialEventNotFoundError for a missing event', () => {
    const { sqlite, accountId } = ctx;

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: randomUUID(),
        amount: '2700.00',
        reason: 'Missing event',
      }),
    ).toThrow(FinancialEventNotFoundError);
  });

  it('throws InvalidAmountError for a negative amount on a cash event', () => {
    const { sqlite, accountId } = ctx;

    const depositId = postDeposit(sqlite, accountId, '2800.00');

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: depositId,
        amount: '-100.00',
        reason: 'Negative replacement amount',
      }),
    ).toThrow(InvalidAmountError);
  });

  it('allows signed amounts for manual_adjustment corrections', () => {
    const { sqlite, accountId } = ctx;

    const adjustment = postEventWithEffect(sqlite, accountId, {
      eventType: 'manual_adjustment',
      amount: '100.00',
      description: 'Positive adjustment',
    });

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: adjustment.event.id,
      amount: '-75.00',
      reason: 'Should have been a debit',
    });

    const reversalEffect = parseEffect(result.reversalEvent.effect);
    expect(reversalEffect.direction).toBe('decrease');
    const replacementEffect = parseEffect(result.replacementEvent.effect);
    expect(replacementEffect.direction).toBe('decrease');
    expect(replacementEffect.amount).toBe('75.00');
  });

  it('keeps the original event unmodified and lineage immutable', () => {
    const { sqlite, accountId } = ctx;

    const originalId = postDeposit(sqlite, accountId, '3100.00');
    const originalBefore = findEventById(sqlite, originalId)!;
    const originalPayloadBefore = originalBefore.payload;
    const originalEffectBefore = originalBefore.effect;

    correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalId,
      amount: '3200.00',
      reason: 'Immutability check',
    });

    // Original event unchanged (no in-place mutation)
    const originalAfter = findEventById(sqlite, originalId)!;
    expect(originalAfter.payload).toBe(originalPayloadBefore);
    expect(originalAfter.effect).toBe(originalEffectBefore);
    expect(originalAfter.description).toBe('Initial deposit');

    // Lineage rows cannot be updated or deleted (DB triggers)
    const lineage = listFinancialEventCorrectionsByAccount(sqlite, accountId);
    const row = lineage.find((l) => l.original_event_id === originalId)!;
    expect(row).toBeDefined();
    expect(() =>
      sqlite
        .prepare('UPDATE financial_event_correction_lineage SET reason = ? WHERE id = ?')
        .run('mutated', row.id),
    ).toThrow(/Cannot update/);
    expect(() =>
      sqlite.prepare('DELETE FROM financial_event_correction_lineage WHERE id = ?').run(row.id),
    ).toThrow(/Cannot delete/);
  });

  it('uses the replacement event description when provided', () => {
    const { sqlite, accountId } = ctx;

    const originalId = postDeposit(sqlite, accountId, '3300.00');

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalId,
      amount: '3400.00',
      description: 'Corrected deposit amount',
      reason: 'User provided a description',
    });

    expect(result.replacementEvent.description).toBe('Corrected deposit amount');
    const replacementPayload = parsePayload(result.replacementEvent.payload);
    expect(replacementPayload.description).toBe('Corrected deposit amount');
    expect(replacementPayload.reason).toBe('User provided a description');
  });
});
