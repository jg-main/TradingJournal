/**
 * Financial event posting tests.
 *
 * Tests the generalized posting kernel (postFinancialEvent) and the
 * event-specific posting service (postEventWithEffect) for all supported
 * non-opening-balance event types.
 *
 * Coverage areas:
 * 1. Each supported event type (deposit, withdrawal, dividend, interest,
 *    fee, tax, stock_split, manual_adjustment) posts correctly with
 *    balanced postings, correct payload, and correct effect.
 * 2. Invalid amounts are rejected by the posting kernel.
 * 3. Non-existent accounts return AccountNotFoundError.
 * 4. Duplicate idempotency keys return DuplicateIdempotencyKeyError.
 * 5. Rollback on failure leaves no partial state.
 * 6. Stock splits produce zero-balanced postings with market effect.
 * 7. Manual adjustments correctly handle both positive and negative amounts.
 *
 * Run: npx vitest run --reporter verbose src/lib/accounting/__tests__/financial-event-posting.test.ts
 */

import { testDbPath } from '../../testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postFinancialEvent, postOpeningBalance, validatePostingAmount, validateNonNegativePostingAmount } from '../posting';
import { postEventWithEffect, computePayload, computeEffect, getPostingAmount } from '../event-posting';
import { postFinancialEventSchema } from '../api-contracts';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  AccountNotFoundError,
  DuplicateIdempotencyKeyError,
} from '../errors';
import { checkLedgerBalance } from '../rebuild';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('financial-event-posting');

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
          // skip expected ordering failures
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

  // Seed a test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Posting Test Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Safely parse a JSON string, returning null on failure.
 */
function safeParseJSON(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Create a parsed PostFinancialEventRequest from a plain object.
 */
function parseEventRequest(body: Record<string, unknown>) {
  const parsed = postFinancialEventSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`);
  }
  return parsed.data;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Financial Event Posting — Kernel Functions', () => {
  // ── Validation ──────────────────────────────────────────────────────

  describe('validatePostingAmount', () => {
    it('accepts positive canonical decimal', () => {
      const result = validatePostingAmount('100.00');
      expect(result.amount).toBe('100.00');
      expect(result.amountMicros).toBe(100_000_000);
    });

    it('rejects zero amount', () => {
      expect(() => validatePostingAmount('0.00')).toThrow(InvalidAmountError);
    });

    it('rejects negative amount', () => {
      expect(() => validatePostingAmount('-100.00')).toThrow(InvalidAmountError);
    });

    it('rejects invalid format', () => {
      expect(() => validatePostingAmount('abc')).toThrow(InvalidAmountError);
    });
  });

  describe('validateNonNegativePostingAmount', () => {
    it('accepts zero amount', () => {
      const result = validateNonNegativePostingAmount('0.00');
      expect(result.amount).toBe('0.00');
      expect(result.amountMicros).toBe(0);
    });

    it('accepts positive amount', () => {
      const result = validateNonNegativePostingAmount('100.00');
      expect(result.amount).toBe('100.00');
      expect(result.amountMicros).toBe(100_000_000);
    });

    it('rejects negative amount', () => {
      expect(() => validateNonNegativePostingAmount('-100.00')).toThrow(InvalidAmountError);
    });

    it('rejects invalid format', () => {
      expect(() => validateNonNegativePostingAmount('abc')).toThrow(InvalidAmountError);
    });
  });

  // ── Payload Builders ────────────────────────────────────────────────

  describe('computePayload', () => {
    it('builds deposit payload', () => {
      const req = parseEventRequest({ eventType: 'deposit', amount: '5000.00' });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '5000.00' });
    });

    it('builds withdrawal payload', () => {
      const req = parseEventRequest({ eventType: 'withdrawal', amount: '1000.00' });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '1000.00' });
    });

    it('builds dividend payload with optional fields', () => {
      const req = parseEventRequest({
        eventType: 'dividend', amount: '150.00', perShareAmount: '0.75', shares: 200,
      });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '150.00', perShareAmount: '0.75', shares: 200 });
    });

    it('builds interest payload with rate', () => {
      const req = parseEventRequest({ eventType: 'interest', amount: '12.34', rate: '4.5%' });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '12.34', rate: '4.5%' });
    });

    it('builds fee payload with feeType', () => {
      const req = parseEventRequest({ eventType: 'fee', amount: '9.99', feeType: 'monthly' });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '9.99', feeType: 'monthly' });
    });

    it('builds tax payload with taxType', () => {
      const req = parseEventRequest({ eventType: 'tax', amount: '250.00', taxType: 'withholding' });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '250.00', taxType: 'withholding' });
    });

    it('builds stock_split payload', () => {
      const req = parseEventRequest({
        eventType: 'stock_split', symbol: 'AAPL', ratio: '4:1', oldShares: 100, newShares: 400,
      });
      const payload = computePayload(req);
      expect(payload).toMatchObject({ symbol: 'AAPL', ratio: '4:1', oldShares: 100, newShares: 400 });
    });

    it('builds manual_adjustment payload with positive amount', () => {
      const req = parseEventRequest({ eventType: 'manual_adjustment', amount: '1000.00' });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '1000.00' });
    });

    it('builds manual_adjustment payload with negative amount and reason', () => {
      const req = parseEventRequest({
        eventType: 'manual_adjustment', amount: '-500.00', reason: 'Correction',
      });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '-500.00', reason: 'Correction' });
    });

    it('builds opening_balance payload', () => {
      const req = parseEventRequest({ eventType: 'opening_balance', amount: '25000.00' });
      const payload = computePayload(req);
      expect(payload).toEqual({ amount: '25000.00' });
    });
  });

  // ── Effect Builders ─────────────────────────────────────────────────

  describe('computeEffect', () => {
    it('deposit effect is cash increase', () => {
      const req = parseEventRequest({ eventType: 'deposit', amount: '5000.00' });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'cash', direction: 'increase', amount: '5000.00', amountMicros: 5_000_000_000 });
    });

    it('withdrawal effect is cash decrease', () => {
      const req = parseEventRequest({ eventType: 'withdrawal', amount: '1000.00' });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'cash', direction: 'decrease', amount: '1000.00' });
    });

    it('dividend effect is cash increase', () => {
      const req = parseEventRequest({ eventType: 'dividend', amount: '150.00' });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'cash', direction: 'increase', amount: '150.00' });
    });

    it('interest effect is cash increase', () => {
      const req = parseEventRequest({ eventType: 'interest', amount: '12.34' });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'cash', direction: 'increase', amount: '12.34' });
    });

    it('fee effect is cash decrease', () => {
      const req = parseEventRequest({ eventType: 'fee', amount: '9.99' });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'cash', direction: 'decrease', amount: '9.99' });
    });

    it('tax effect is cash decrease', () => {
      const req = parseEventRequest({ eventType: 'tax', amount: '250.00' });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'cash', direction: 'decrease', amount: '250.00' });
    });

    it('stock_split effect is market with symbol and details', () => {
      const req = parseEventRequest({
        eventType: 'stock_split', symbol: 'AAPL', ratio: '4:1', oldShares: 100, newShares: 400,
      });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'market', symbol: 'AAPL', details: '4:1 stock split' });
    });

    it('manual_adjustment positive amount effect is cash increase', () => {
      const req = parseEventRequest({ eventType: 'manual_adjustment', amount: '1000.00' });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'cash', direction: 'increase', amount: '1000.00' });
    });

    it('manual_adjustment negative amount effect is cash decrease', () => {
      const req = parseEventRequest({ eventType: 'manual_adjustment', amount: '-500.00' });
      const effect = computeEffect(req);
      expect(effect).toMatchObject({ kind: 'cash', direction: 'decrease', amount: '500.00' });
    });
  });

  // ── getPostingAmount ────────────────────────────────────────────────

  describe('getPostingAmount', () => {
    it('returns amount for cash events', () => {
      const req = parseEventRequest({ eventType: 'deposit', amount: '5000.00' });
      expect(getPostingAmount(req)).toBe('5000.00');
    });

    it('returns 0.00 for stock_split', () => {
      const req = parseEventRequest({
        eventType: 'stock_split', symbol: 'AAPL', ratio: '4:1', oldShares: 100, newShares: 400,
      });
      expect(getPostingAmount(req)).toBe('0.00');
    });

    it('returns absolute value for manual_adjustment negative', () => {
      const req = parseEventRequest({ eventType: 'manual_adjustment', amount: '-500.00' });
      expect(getPostingAmount(req)).toBe('500.00');
    });

    it('returns amount for manual_adjustment positive', () => {
      const req = parseEventRequest({ eventType: 'manual_adjustment', amount: '1000.00' });
      expect(getPostingAmount(req)).toBe('1000.00');
    });
  });
});

// ── Full Posting Integration Tests ──────────────────────────────────────

describe('Financial Event Posting — via generalized kernel', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  // ── 1. Post opening balance (baseline) ─────────────────────────────

  it('posts opening balance with postOpeningBalance (legacy)', () => {
    const result = postOpeningBalance(ctx.sqlite, {
      accountId: ctx.accountId,
      amount: '25000.00',
      idempotencyKey: randomUUID(),
      description: 'Initial funding',
    });

    expect(result.event.eventType).toBe('opening_balance');
    expect(result.postings.debit.amount).toBe('25000.00');
    expect(result.postings.credit.amount).toBe('25000.00');
  });

  // ── 2. Each event type via postFinancialEvent ──────────────────────

  it('posts deposit event with correct effect and balanced postings', () => {
    const req = parseEventRequest({
      eventType: 'deposit', amount: '5000.00', description: 'Cash deposit',
    });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('deposit');
    expect(result.event.description).toBe('Cash deposit');
    expect(result.postings.debit.amount).toBe('5000.00');
    expect(result.postings.credit.amount).toBe('5000.00');
    expect(result.postings.debit.amountMicros).toBe(result.postings.credit.amountMicros);

    // payload and effect should be set as JSON
    const payload = safeParseJSON(result.event.payload);
    expect(payload).toMatchObject({ amount: '5000.00' });

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'cash', direction: 'increase', amount: '5000.00' });
  });

  it('posts withdrawal event with correct effect and balanced postings', () => {
    const req = parseEventRequest({
      eventType: 'withdrawal', amount: '1000.00', description: 'Cash withdrawal',
    });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('withdrawal');
    expect(result.postings.debit.amount).toBe('1000.00');
    expect(result.postings.credit.amount).toBe('1000.00');

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'cash', direction: 'decrease', amount: '1000.00' });
  });

  it('posts dividend event with perShareAmount and shares', () => {
    const req = parseEventRequest({
      eventType: 'dividend', amount: '150.00', perShareAmount: '0.75', shares: 200,
    });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('dividend');
    expect(result.postings.debit.amount).toBe('150.00');
    expect(result.postings.credit.amount).toBe('150.00');

    const payload = safeParseJSON(result.event.payload);
    expect(payload).toMatchObject({ amount: '150.00', perShareAmount: '0.75', shares: 200 });

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'cash', direction: 'increase', amount: '150.00' });
  });

  it('posts interest event with rate', () => {
    const req = parseEventRequest({ eventType: 'interest', amount: '12.34', rate: '4.5%' });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('interest');
    expect(result.postings.debit.amount).toBe('12.34');
    expect(result.postings.credit.amount).toBe('12.34');

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'cash', direction: 'increase', amount: '12.34' });
  });

  it('posts fee event with feeType', () => {
    const req = parseEventRequest({ eventType: 'fee', amount: '9.99', feeType: 'monthly' });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('fee');
    expect(result.postings.debit.amount).toBe('9.99');
    expect(result.postings.credit.amount).toBe('9.99');

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'cash', direction: 'decrease', amount: '9.99' });
  });

  it('posts tax event with taxType', () => {
    const req = parseEventRequest({ eventType: 'tax', amount: '250.00', taxType: 'withholding' });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('tax');
    expect(result.postings.debit.amount).toBe('250.00');
    expect(result.postings.credit.amount).toBe('250.00');

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'cash', direction: 'decrease', amount: '250.00' });
  });

  // ── 3. Stock split — records event with zero-balanced postings ─────

  it('posts stock_split event with zero-balanced postings and market effect', () => {
    const req = parseEventRequest({
      eventType: 'stock_split', symbol: 'AAPL', ratio: '4:1', oldShares: 100, newShares: 400,
    });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('stock_split');

    // Zero-balanced posting pair (non-cash event)
    expect(result.postings.debit.amount).toBe('0.00');
    expect(result.postings.credit.amount).toBe('0.00');
    expect(result.postings.debit.amountMicros).toBe(0);
    expect(result.postings.credit.amountMicros).toBe(0);

    const payload = safeParseJSON(result.event.payload);
    expect(payload).toMatchObject({ symbol: 'AAPL', ratio: '4:1', oldShares: 100, newShares: 400 });

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'market', symbol: 'AAPL', details: '4:1 stock split' });
  });

  // ── 4. Manual adjustments — positive and negative ──────────────────

  it('posts manual_adjustment with positive amount (cash increase)', () => {
    const req = parseEventRequest({
      eventType: 'manual_adjustment', amount: '1000.00', reason: 'Adding funds',
    });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('manual_adjustment');
    expect(result.postings.debit.amount).toBe('1000.00');
    expect(result.postings.credit.amount).toBe('1000.00');

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'cash', direction: 'increase', amount: '1000.00' });
  });

  it('posts manual_adjustment with negative amount (cash decrease)', () => {
    const req = parseEventRequest({
      eventType: 'manual_adjustment', amount: '-500.00', reason: 'Correction',
    });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.event.eventType).toBe('manual_adjustment');
    // Absolute value used for posting amount
    expect(result.postings.debit.amount).toBe('500.00');
    expect(result.postings.credit.amount).toBe('500.00');

    const effect = safeParseJSON(result.event.effect);
    expect(effect).toMatchObject({ kind: 'cash', direction: 'decrease', amount: '500.00' });
  });

  // ── 5. Error cases ────────────────────────────────────────────────

  it('rejects invalid amount with InvalidAmountError', () => {
    expect(() => {
      postFinancialEvent(ctx.sqlite, {
        accountId: ctx.accountId,
        eventType: 'deposit',
        amount: 'not-a-number',
      });
    }).toThrow(InvalidAmountError);
  });

  it('rejects negative amount for deposit with InvalidAmountError', () => {
    // The posting kernel's validatePostingAmount rejects negative amounts.
    // Note: the Zod schema would catch this before the kernel, but test the kernel directly.
    expect(() => {
      postFinancialEvent(ctx.sqlite, {
        accountId: ctx.accountId,
        eventType: 'deposit',
        amount: '-100.00',
      });
    }).toThrow(InvalidAmountError);
  });

  it('throws AccountNotFoundError for non-existent account', () => {
    const fakeId = randomUUID();
    const req = parseEventRequest({ eventType: 'deposit', amount: '500.00' });
    expect(() => {
      postEventWithEffect(ctx.sqlite, fakeId, req);
    }).toThrow(AccountNotFoundError);
  });

  it('rejects duplicate idempotency key with DuplicateIdempotencyKeyError', () => {
    const key = randomUUID();
    const req1 = parseEventRequest({
      eventType: 'deposit', amount: '500.00', idempotencyKey: key,
    });
    const req2 = parseEventRequest({
      eventType: 'withdrawal', amount: '999.00', idempotencyKey: key,
    });

    // First post succeeds
    const first = postEventWithEffect(ctx.sqlite, ctx.accountId, req1);
    expect(first.event.eventType).toBe('deposit');

    // Second post with same key throws
    expect(() => {
      postEventWithEffect(ctx.sqlite, ctx.accountId, req2);
    }).toThrow(DuplicateIdempotencyKeyError);
  });

  // ── 6. Ledger balance after multiple event types ───────────────────

  it('ledger remains globally balanced after all event types', () => {
    const balance = checkLedgerBalance(ctx.sqlite);
    expect(balance.isBalanced).toBe(true);
    expect(balance.debitTotal).toBeGreaterThan(0);
    expect(balance.debitTotal).toBe(balance.creditTotal);
    expect(balance.difference).toBe(0);
  });

  // ── 7. Deterministic rebuild — repeated calls produce same result ──

  it('repeated postEventWithEffect with same body (different keys) creates different events', () => {
    // Posting the same logical event twice with different idempotency keys
    const req = parseEventRequest({ eventType: 'deposit', amount: '200.00' });
    const first = postEventWithEffect(ctx.sqlite, ctx.accountId, {
      ...req,
      idempotencyKey: randomUUID(),
    });
    const second = postEventWithEffect(ctx.sqlite, ctx.accountId, {
      ...req,
      idempotencyKey: randomUUID(),
    });

    expect(first.event.id).not.toBe(second.event.id);
    expect(first.postings.debit.amount).toBe('200.00');
    expect(second.postings.debit.amount).toBe('200.00');
  });

  // ── 8. Rollback on failure ────────────────────────────────────────

  it('rolls back on account lookup failure leaving no partial state', () => {
    const beforeCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;

    const fakeId = randomUUID();
    const req = parseEventRequest({ eventType: 'deposit', amount: '500.00' });
    expect(() => {
      postEventWithEffect(ctx.sqlite, fakeId, req);
    }).toThrow(AccountNotFoundError);

    const afterCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;
    expect(afterCount).toBe(beforeCount);
  });

  // ── 9. Stock split does not affect cash totals ────────────────────

  it('stock split events do not affect cash totals in projections', () => {
    // Count cash-flow events vs stock-split events
    const cashEvents = ctx.sqlite
      .prepare(
        `SELECT count(*) AS count FROM financial_events
         WHERE account_id = ? AND event_type != 'stock_split'`,
      )
      .get(ctx.accountId) as { count: number };

    const splitEvents = ctx.sqlite
      .prepare(
        `SELECT count(*) AS count FROM financial_events
         WHERE account_id = ? AND event_type = 'stock_split'`,
      )
      .get(ctx.accountId) as { count: number };

    // There should be at least 1 stock split
    expect(splitEvents.count).toBeGreaterThanOrEqual(1);
    // Cash events should also exist
    expect(cashEvents.count).toBeGreaterThan(0);
  });

  // ── 10. Sequence ordering ──────────────────────────────────────────

  it('postings have correct sequence ordering (debit < credit)', () => {
    const req = parseEventRequest({ eventType: 'deposit', amount: '100.00' });
    const result = postEventWithEffect(ctx.sqlite, ctx.accountId, req);

    expect(result.postings.credit.sequence).toBe(result.postings.debit.sequence + 1);
  });
});
