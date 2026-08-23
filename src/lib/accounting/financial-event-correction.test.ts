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
import { postFinancialEvent } from '@/lib/accounting/posting';
import { correctFinancialEvent } from '@/lib/accounting/financial-event-correction';
import { initializeAccount } from '@/lib/accounting/account-initialization';
import { rebuildAccountPerformance } from '@/lib/performance/performance-rebuild';
import { findAccountPerformance } from '@/db/accounting-repository';
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
  FinancialEventCorrectionProjectionError,
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

    // opening_balance is now correctable (A4) — see the opening-balance
    // correction describe block below. stock_split remains ineligible.
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

// ── A4: opening-balance correction (immutable reversal + replacement) ──

/** Create a pristine draft account and initialize it (canonical A2 flow). */
function createInitializedAccount(sqlite: Database.Database, amount: string): string {
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
    )
    .run(accountId, `A4 Account ${accountId.slice(0, 6)}`, 'Broker', now, now);
  initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount });
  return accountId;
}

describe('correctFinancialEvent — opening balance (A4)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase();
  });

  it('corrects an opening balance via reversal + replacement and keeps the account active', () => {
    const { sqlite } = ctx;
    const accountId = createInitializedAccount(sqlite, '10000.00');

    const originalEvent = findEventById(sqlite, listAccountEvents(sqlite, accountId)[0].id);
    expect(originalEvent).toBeDefined();
    expect(originalEvent!.event_type).toBe('opening_balance');

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalEvent!.id,
      amount: '9000.00',
      reason: 'Broker opening statement correction',
    });

    // 1. Original unchanged; reversal + replacement + lineage exist.
    const originalAfter = findEventById(sqlite, originalEvent!.id);
    expect(originalAfter).toBeDefined();
    expect(originalAfter!.effect).toBe(originalEvent!.effect);
    const reversal = findEventById(sqlite, result.reversalEvent.id);
    const replacement = findEventById(sqlite, result.replacementEvent.id);
    expect(reversal).toBeDefined();
    expect(replacement).toBeDefined();

    // 2. Effect directions: original increase, reversal decrease, replacement increase.
    expect(parseEffect(originalAfter!.effect).direction).toBe('increase');
    expect(parseEffect(originalAfter!.effect).amount).toBe('10000.00');
    expect(parseEffect(reversal!.effect).direction).toBe('decrease');
    expect(parseEffect(reversal!.effect).amount).toBe('10000.00');
    expect(parseEffect(replacement!.effect).direction).toBe('increase');
    expect(parseEffect(replacement!.effect).amount).toBe('9000.00');

    // 3. Correction lineage recorded.
    const lineage = findFinancialEventCorrectionByOriginalEvent(sqlite, originalEvent!.id);
    expect(lineage).toBeDefined();
    expect(lineage!.reversal_event_id).toBe(result.reversalEvent.id);
    expect(lineage!.replacement_event_id).toBe(result.replacementEvent.id);
    expect(lineage!.reason).toBe('Broker opening statement correction');

    // 4. Effective opening projection = 9,000 (correction-aware, not 29,000).
    const activity = computeAccountCashImpact(sqlite, accountId);
    expect(activity.netCashImpact).toBe('9000.00');

    // 5. Account remains active (historical correction, not initialization).
    const accountRow = sqlite
      .prepare('SELECT is_active FROM accounts WHERE id = ?')
      .get(accountId) as { is_active: number };
    expect(accountRow.is_active).toBe(1);

    // 6. Canonical performance: cash = NAV = 9,000, P&L = 0 (capital change
    //    is not investment profit/loss).
    rebuildAccountPerformance(sqlite, accountId);
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.net_cash).toBe('9000.00');
    expect(projection?.nav).toBe('9000.00');
    expect(projection?.realized_pnl).toBe('0.00');
    expect(projection?.total_pnl).toBe('0.00');
  });

  it('later deposits/withdrawals roll forward correctly after an opening correction', () => {
    const { sqlite } = ctx;
    const accountId = createInitializedAccount(sqlite, '10000.00');

    postEventWithEffect(sqlite, accountId, { eventType: 'deposit', amount: '2000.00' });
    postEventWithEffect(sqlite, accountId, { eventType: 'withdrawal', amount: '500.00' });

    const originalEvent = findEventById(sqlite, listAccountEvents(sqlite, accountId)[0].id);
    correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalEvent!.id,
      amount: '9000.00',
      reason: 'Broker opening statement correction',
    });

    // No double counting: opening (9000) + deposit (2000) - withdrawal (500).
    const activity = computeAccountCashImpact(sqlite, accountId);
    expect(activity.netCashImpact).toBe('10500.00');

    rebuildAccountPerformance(sqlite, accountId);
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.net_cash).toBe('10500.00');
    expect(projection?.nav).toBe('10500.00');
    expect(projection?.realized_pnl).toBe('0.00');
  });

  it('rejects zero and negative replacement opening balances', () => {
    const { sqlite } = ctx;
    const accountId = createInitializedAccount(sqlite, '10000.00');
    const originalEvent = findEventById(sqlite, listAccountEvents(sqlite, accountId)[0].id);

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: originalEvent!.id,
        amount: '0.00',
        reason: 'Zero baseline',
      }),
    ).toThrow(InvalidAmountError);

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: originalEvent!.id,
        amount: '-1000.00',
        reason: 'Negative baseline',
      }),
    ).toThrow(InvalidAmountError);
  });

  it('rejects a second correction of the same original opening balance', () => {
    const { sqlite } = ctx;
    const accountId = createInitializedAccount(sqlite, '10000.00');
    const originalEvent = findEventById(sqlite, listAccountEvents(sqlite, accountId)[0].id);

    correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalEvent!.id,
      amount: '9000.00',
      reason: 'First correction',
    });

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: originalEvent!.id,
        amount: '8000.00',
        reason: 'Second correction',
      }),
    ).toThrow(EventAlreadyCorrectedError);
  });

  it('rejects correcting the reversal or replacement constituents', () => {
    const { sqlite } = ctx;
    const accountId = createInitializedAccount(sqlite, '10000.00');
    const originalEvent = findEventById(sqlite, listAccountEvents(sqlite, accountId)[0].id);

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: originalEvent!.id,
      amount: '9000.00',
      reason: 'Broker opening statement correction',
    });

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: result.reversalEvent.id,
        amount: '8000.00',
        reason: 'Trying to correct the reversal',
      }),
    ).toThrow(EventNotCorrectableError);

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: result.replacementEvent.id,
        amount: '8000.00',
        reason: 'Trying to correct the replacement',
      }),
    ).toThrow(EventNotCorrectableError);
  });

  it('rejects cross-account correction of an opening balance', () => {
    const { sqlite } = ctx;
    const accountId = createInitializedAccount(sqlite, '10000.00');
    const originalEvent = findEventById(sqlite, listAccountEvents(sqlite, accountId)[0].id);

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId: ctx.secondAccountId,
        originalEventId: originalEvent!.id,
        amount: '9000.00',
        reason: 'Cross-account',
      }),
    ).toThrow(FinancialEventNotFoundError);
  });

  it('blocks correction of a legacy opening balance without effect metadata', () => {
    const { sqlite } = ctx;
    // Legacy row: opening_balance event with NO effect JSON (pre-canonical).
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 1, ?, ?)`,
      )
      .run(accountId, 'Legacy Opening', 'Broker', now, now);

    const legacy = postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount: '8000.00',
    });
    // postFinancialEvent writes no payload/effect by default; assert the
    // legacy fixture truly lacks effect metadata.
    expect(legacy.event.effect).toBeNull();

    // Correction must NOT guess an economic effect — blocked with a clear
    // domain error; the projection stays readable via the debit fallback.
    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: legacy.event.id,
        amount: '9000.00',
        reason: 'Legacy correction attempt',
      }),
    ).toThrow(/no recorded cash effect to reverse/);
  });
});

// ── A5: correction is atomic with the performance projection ────────────

describe('correctFinancialEvent — atomic projection (A5)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase();
  });

  /** Create a pristine draft, initialize (opening balance), and post a deposit. */
  function seedOpeningAndDeposit(
    sqlite: Database.Database,
    opening: string,
    deposit: string,
  ): { accountId: string; depositEventId: string } {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
      )
      .run(accountId, `A5 Account ${accountId.slice(0, 6)}`, 'Broker', now, now);
    initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: opening });
    const depositResult = postEventWithEffect(sqlite, accountId, {
      eventType: 'deposit',
      amount: deposit,
    });
    return { accountId, depositEventId: depositResult.event.id };
  }

  function countRows(sqlite: Database.Database): {
    events: number;
    entries: number;
    postings: number;
    lineage: number;
  } {
    const events = sqlite
      .prepare('SELECT COUNT(*) AS c FROM financial_events')
      .get() as { c: number };
    const entries = sqlite
      .prepare('SELECT COUNT(*) AS c FROM ledger_entries')
      .get() as { c: number };
    const postings = sqlite
      .prepare('SELECT COUNT(*) AS c FROM ledger_postings')
      .get() as { c: number };
    const lineage = sqlite
      .prepare('SELECT COUNT(*) AS c FROM financial_event_correction_lineage')
      .get() as { c: number };
    return { events: events.c, entries: entries.c, postings: postings.c, lineage: lineage.c };
  }

  it('26: successful correction returns a coherent projection (10k + 2.5k -> 2k = 12k)', () => {
    const { sqlite } = ctx;
    const { accountId, depositEventId } = seedOpeningAndDeposit(sqlite, '10000.00', '2500.00');

    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: depositEventId,
      amount: '2000.00',
      reason: 'Broker statement correction',
    });

    expect(result.performance.success).toBe(true);
    expect(result.performance.nav).toBe('12000.00');

    // Persisted: original unchanged, reversal + replacement + lineage exist.
    const original = findEventById(sqlite, depositEventId)!;
    expect(original.event_type).toBe('deposit');
    expect(JSON.parse(original.effect ?? '{}').amount).toBe('2500.00');
    expect(findEventById(sqlite, result.reversalEvent.id)).toBeDefined();
    expect(findEventById(sqlite, result.replacementEvent.id)).toBeDefined();
    expect(findFinancialEventCorrectionByOriginalEvent(sqlite, depositEventId)).toBeDefined();

    // Canonical projection reflects the corrected stream immediately.
    rebuildAccountPerformance(sqlite, accountId);
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.net_cash).toBe('12000.00');
    expect(projection?.nav).toBe('12000.00');
  });

  it('27: forced projection failure rolls back the entire correction and preserves the prior projection', () => {
    const { sqlite } = ctx;
    const { accountId, depositEventId } = seedOpeningAndDeposit(sqlite, '10000.00', '2500.00');

    // Establish a valid prior projection: NAV = 12,500 (opening 10k + deposit 2.5k).
    rebuildAccountPerformance(sqlite, accountId);
    const before = findAccountPerformance(sqlite, accountId);
    expect(before?.nav).toBe('12500.00');

    const rowsBefore = countRows(sqlite);
    sqlite.exec(`
      CREATE TRIGGER a5_t27_force_projection_fail BEFORE UPDATE ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced correction projection failure'); END;
    `);

    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: depositEventId,
        amount: '2000.00',
        reason: 'This correction should roll back',
      }),
    ).toThrow(FinancialEventCorrectionProjectionError);
    sqlite.exec('DROP TRIGGER a5_t27_force_projection_fail');

    // ZERO new correction artifacts.
    const rowsAfter = countRows(sqlite);
    expect(rowsAfter.events).toBe(rowsBefore.events);
    expect(rowsAfter.entries).toBe(rowsBefore.entries);
    expect(rowsAfter.postings).toBe(rowsBefore.postings);
    expect(rowsAfter.lineage).toBe(rowsBefore.lineage);

    // Original unchanged and still correctable; prior projection preserved.
    const original = findEventById(sqlite, depositEventId)!;
    expect(JSON.parse(original.effect ?? '{}').amount).toBe('2500.00');
    expect(findFinancialEventCorrectionByOriginalEvent(sqlite, depositEventId)).toBeUndefined();
    const after = findAccountPerformance(sqlite, accountId);
    expect(after?.nav).toBe('12500.00');

    // Retry with a healthy projection succeeds exactly once.
    const retry = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: depositEventId,
      amount: '2000.00',
      reason: 'Retry after projection failure',
    });
    expect(retry.performance.success).toBe(true);
    expect(retry.performance.nav).toBe('12000.00');
    expect(findFinancialEventCorrectionByOriginalEvent(sqlite, depositEventId)).toBeDefined();
  });

  it('28: opening-balance correction failure keeps 10k effective; retry yields 9k', () => {
    const { sqlite } = ctx;
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
      )
      .run(accountId, `A5 Opening ${accountId.slice(0, 6)}`, 'Broker', now, now);
    initializeAccount(sqlite, { accountId, mode: 'opening_balance', amount: '10000.00' });
    const openingEventId = listAccountEvents(sqlite, accountId)[0].id;

    sqlite.exec(`
      CREATE TRIGGER a5_t28_force_projection_fail BEFORE UPDATE ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced correction projection failure'); END;
    `);
    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: openingEventId,
        amount: '9000.00',
        reason: 'Should roll back',
      }),
    ).toThrow(FinancialEventCorrectionProjectionError);
    sqlite.exec('DROP TRIGGER a5_t28_force_projection_fail');

    // Rejected: effective opening remains 10,000, account active, original correctable.
    const activity = computeAccountCashImpact(sqlite, accountId);
    expect(activity.netCashImpact).toBe('10000.00');
    const accountRow = sqlite
      .prepare('SELECT is_active FROM accounts WHERE id = ?')
      .get(accountId) as { is_active: number };
    expect(accountRow.is_active).toBe(1);
    expect(findFinancialEventCorrectionByOriginalEvent(sqlite, openingEventId)).toBeUndefined();

    // Retry succeeds: effective opening 9,000, NAV 9,000.
    const retry = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: openingEventId,
      amount: '9000.00',
      reason: 'Retry after projection failure',
    });
    expect(retry.performance.success).toBe(true);
    expect(retry.performance.nav).toBe('9000.00');
    rebuildAccountPerformance(sqlite, accountId);
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.net_cash).toBe('9000.00');
    expect(projection?.nav).toBe('9000.00');
  });

  it('29: a failed correction does not consume the idempotency key; retry with the SAME key succeeds', () => {
    const { sqlite } = ctx;
    const { accountId, depositEventId } = seedOpeningAndDeposit(sqlite, '10000.00', '2500.00');
    const idempotencyKey = randomUUID();

    sqlite.exec(`
      CREATE TRIGGER a5_t29_force_projection_fail BEFORE UPDATE ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced correction projection failure'); END;
    `);
    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: depositEventId,
        amount: '2000.00',
        reason: 'Idempotent retry scenario',
        idempotencyKey,
      }),
    ).toThrow(FinancialEventCorrectionProjectionError);
    sqlite.exec('DROP TRIGGER a5_t29_force_projection_fail');

    // No lineage row consumed the key.
    const row = sqlite
      .prepare('SELECT id FROM financial_event_correction_lineage WHERE idempotency_key = ?')
      .get(idempotencyKey);
    expect(row).toBeUndefined();

    // Retry with the SAME key succeeds exactly once.
    const retry = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: depositEventId,
      amount: '2000.00',
      reason: 'Idempotent retry scenario',
      idempotencyKey,
    });
    expect(retry.performance.success).toBe(true);

    // Repeating the same correction is rejected (already corrected).
    expect(() =>
      correctFinancialEvent(sqlite, {
        accountId,
        originalEventId: depositEventId,
        amount: '1500.00',
        reason: 'Third attempt',
      }),
    ).toThrow(EventAlreadyCorrectedError);
  });
});
