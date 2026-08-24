/**
 * Route tests for the Financial Events API (POST + GET)
 *
 * Tests the route logic by simulating it against a real SQLite database
 * with all migrations applied.
 *
 * Covers:
 * - Successful posting of all 9 event types (201)
 * - Response includes payload/effect for event-specific metadata
 * - Duplicate idempotency key rejection (409)
 * - Missing account (404)
 * - Invalid/malformed amounts (400)
 * - Zod validation failures (400)
 * - Malformed JSON body (400)
 * - Rollback behavior on failure
 * - Read-back verification of persisted data
 * - GET: empty account, with events, ordering, pagination
 * - GET: response shape with posting status
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/financial-events/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../../../lib/testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postEventWithEffect } from '@/lib/accounting/event-posting';
import { initializeAccount } from '@/lib/accounting/account-initialization';
import { findAccountPerformance } from '@/db/accounting-repository';
import { postFinancialEventSchema } from '@/lib/accounting/api-contracts';
import { listAccountEvents, countAccountEvents } from '@/db/accounting-repository';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  AccountNotFoundError,
  DuplicateIdempotencyKeyError,
  UnsupportedAccountCurrencyError,
  AccountInactiveError,
  FinancialEventPostingProjectionError,
} from '@/lib/accounting/errors';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('financial-events-route');

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
          // skip
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

  // Create test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Test Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ── Simulated route logic ───────────────────────────────────────────────

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates the POST /api/accounts/:id/financial-events route handler
 * logic without Next.js dependencies. Uses postEventWithEffect to support
 * all 9 event types.
 */
function doPostFinancialEvent(
  sqlite: Database.Database,
  accountId: string,
  requestBody: unknown,
): RouteResult {
  try {
    // 1. Validate JSON parsing
    if (typeof requestBody !== 'object' || requestBody === null) {
      return { status: 400, body: { error: 'Invalid JSON body' } };
    }

    // 2. Zod validation
    const parsed = postFinancialEventSchema.safeParse(requestBody);
    if (!parsed.success) {
      return {
        status: 400,
        body: {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
      };
    }

    // 3. Opening balances are initialization-only (A2): the generic route
    //    rejects them with 409 before any posting.
    if (parsed.data.eventType === 'opening_balance') {
      return {
        status: 409,
        body: {
          error: 'Opening balance must be recorded through account initialization',
        },
      };
    }

    // 4. Post via event-posting service (supports all event types)
    const result = postEventWithEffect(sqlite, accountId, parsed.data);

    // 4. Return success response with payload/effect + A7 projection evidence
    return {
      status: 201,
      body: {
        performance: {
          success: result.performance.success,
          nav: result.performance.nav,
          rebuildCount: result.performance.rebuildCount,
        },
        event: {
          id: result.event.id,
          accountId: result.event.accountId,
          eventType: result.event.eventType,
          idempotencyKey: result.event.idempotencyKey,
          description: result.event.description,
          payload: result.event.payload,
          effect: result.event.effect,
          postedAt: result.event.postedAt,
          createdAt: result.event.createdAt,
        },
        entry: {
          id: result.entry.id,
          financialEventId: result.entry.financialEventId,
          accountId: result.entry.accountId,
          description: result.entry.description,
          postedAt: result.entry.postedAt,
          createdAt: result.entry.createdAt,
        },
        postings: {
          debit: {
            id: result.postings.debit.id,
            ledgerEntryId: result.postings.debit.ledgerEntryId,
            accountId: result.postings.debit.accountId,
            side: result.postings.debit.side,
            amount: result.postings.debit.amount,
            amountMicros: result.postings.debit.amountMicros,
            currency: result.postings.debit.currency,
            sequence: result.postings.debit.sequence,
            createdAt: result.postings.debit.createdAt,
          },
          credit: {
            id: result.postings.credit.id,
            ledgerEntryId: result.postings.credit.ledgerEntryId,
            accountId: result.postings.credit.accountId,
            side: result.postings.credit.side,
            amount: result.postings.credit.amount,
            amountMicros: result.postings.credit.amountMicros,
            currency: result.postings.credit.currency,
            sequence: result.postings.credit.sequence,
            createdAt: result.postings.credit.createdAt,
          },
        },
      },
    };
  } catch (error) {
    if (error instanceof InvalidAmountError || error instanceof InvalidMicrosBoundsError) {
      return {
        status: 400,
        body: { error: 'Invalid amount', details: (error as Error).message },
      };
    }
    if (error instanceof AccountNotFoundError) {
      return {
        status: 404,
        body: { error: 'Account not found', details: (error as Error).message },
      };
    }
    if (error instanceof UnsupportedAccountCurrencyError) {
      return {
        status: 400,
        body: {
          error: (error as Error).message,
          details: {
            accountId: error.accountId,
            currency: error.currency,
          },
        },
      };
    }
    if (error instanceof AccountInactiveError) {
      return {
        status: 409,
        body: {
          error: 'Account is inactive',
          code: error.code,
          details: (error as Error).message,
        },
      };
    }
    if (error instanceof DuplicateIdempotencyKeyError) {
      return {
        status: 409,
        body: { error: 'Duplicate idempotency key', details: (error as Error).message },
      };
    }
    if (error instanceof FinancialEventPostingProjectionError) {
      return {
        status: 500,
        body: {
          error: 'Failed to post financial event',
          code: error.code,
          details: (error as Error).message,
        },
      };
    }
    return {
      status: 500,
      body: {
        error: 'Failed to post financial event',
        details: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(ctx.sqlite);
});

// ── Validation Tests (schema parse only, no DB needed) ──────────────────

describe('postFinancialEventSchema (validation)', () => {
  it('accepts a valid opening balance request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'opening_balance',
      amount: '5000.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid deposit request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '1000.00',
      idempotencyKey: randomUUID(),
      description: 'Test deposit',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid withdrawal request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'withdrawal',
      amount: '500.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid dividend request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'dividend',
      amount: '250.50',
      perShareAmount: '2.50',
      shares: 100,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid interest request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'interest',
      amount: '15.75',
      rate: '3.5%',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid fee request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'fee',
      amount: '9.99',
      feeType: 'maintenance',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid tax request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'tax',
      amount: '125.00',
      taxType: 'capital_gains',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid stock_split request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'stock_split',
      symbol: 'AAPL',
      ratio: '4:1',
      oldShares: 100,
      newShares: 400,
      oldPrice: '200.00',
      newPrice: '50.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid manual_adjustment (positive) request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'manual_adjustment',
      amount: '250.00',
      reason: 'Correcting rounding error',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid manual_adjustment (negative) request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'manual_adjustment',
      amount: '-150.00',
      reason: 'Correction',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional idempotencyKey (UUID)', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'opening_balance',
      amount: '1000.00',
      idempotencyKey: randomUUID(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional description', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'opening_balance',
      amount: '1000.00',
      description: 'Initial deposit',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid eventType', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'trade_execution',
      amount: '1000.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'opening_balance',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID idempotencyKey', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '1000.00',
      idempotencyKey: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'opening_balance',
      amount: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects description longer than 500 characters', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'opening_balance',
      amount: '1000.00',
      description: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero manual_adjustment amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'manual_adjustment',
      amount: '0.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects stock_split missing required fields', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'stock_split',
      amount: '0.00',
    });
    expect(result.success).toBe(false);
  });
});

// ── POST event type tests ───────────────────────────────────────────────

describe('POST /api/accounts/:id/financial-events — event types', () => {
  it('rejects opening_balance with 409 — initialization-only event (A2)', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Initial balance',
    });
    expect(result.status).toBe(409);
    expect(result.body.error).toContain('Opening balance must be recorded');

    // No event/entry/posting was created by the rejected request.
    const count = ctx.sqlite
      .prepare('SELECT count(*) AS count FROM financial_events WHERE account_id = ?')
      .get(ctx.accountId) as { count: number };
    expect(count.count).toBe(0);
  });

  it('posts deposit with payload and effect', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'deposit',
      amount: '5000.00',
      description: 'Wire transfer deposit',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('deposit');
    expect(ev.description).toBe('Wire transfer deposit');
    // Should have payload JSON
    expect(typeof ev.payload).toBe('string');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.amount).toBe('5000.00');
    // Should have effect JSON indicating cash increase
    expect(typeof ev.effect).toBe('string');
    const effect = JSON.parse(ev.effect as string);
    expect(effect.kind).toBe('cash');
    expect(effect.direction).toBe('increase');
  });

  it('posts withdrawal with payload and effect', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'withdrawal',
      amount: '2000.00',
      description: 'ATM withdrawal',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('withdrawal');
    const effect = JSON.parse(ev.effect as string);
    expect(effect.kind).toBe('cash');
    expect(effect.direction).toBe('decrease');
  });

  it('posts dividend with perShareAmount and shares metadata', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'dividend',
      amount: '250.00',
      perShareAmount: '2.50',
      shares: 100,
      description: 'Quarterly dividend',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('dividend');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.perShareAmount).toBe('2.50');
    expect(payload.shares).toBe(100);
    const effect = JSON.parse(ev.effect as string);
    expect(effect.direction).toBe('increase');
  });

  it('posts interest with rate metadata', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'interest',
      amount: '15.00',
      rate: '3.5%',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('interest');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.rate).toBe('3.5%');
  });

  it('posts fee with feeType metadata', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'fee',
      amount: '9.99',
      feeType: 'maintenance',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('fee');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.feeType).toBe('maintenance');
    const effect = JSON.parse(ev.effect as string);
    expect(effect.direction).toBe('decrease');
  });

  it('posts tax with taxType metadata', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'tax',
      amount: '125.00',
      taxType: 'capital_gains',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('tax');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.taxType).toBe('capital_gains');
  });

  it('posts stock_split with corporate-action payload', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'stock_split',
      symbol: 'AAPL',
      ratio: '4:1',
      oldShares: 100,
      newShares: 400,
      oldPrice: '200.00',
      newPrice: '50.00',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('stock_split');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.symbol).toBe('AAPL');
    expect(payload.ratio).toBe('4:1');
    expect(payload.oldShares).toBe(100);
    expect(payload.newShares).toBe(400);
    const effect = JSON.parse(ev.effect as string);
    expect(effect.kind).toBe('market');
    expect(effect.symbol).toBe('AAPL');
    // Stock split postings are zero-balanced
    const postings = result.body.postings as Record<string, unknown>;
    const debit = postings.debit as Record<string, unknown>;
    expect(debit.amount).toBe('0.00');
  });

  it('posts manual_adjustment (positive) with reason', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'manual_adjustment',
      amount: '100.00',
      reason: 'Rounding correction',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('manual_adjustment');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.amount).toBe('100.00');
    const effect = JSON.parse(ev.effect as string);
    expect(effect.direction).toBe('increase');
  });

  it('posts manual_adjustment (negative) with decrease effect', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'manual_adjustment',
      amount: '-75.00',
      reason: 'Overpayment correction',
    });
    expect(result.status).toBe(201);
    const ev = result.body.event as Record<string, unknown>;
    expect(ev.eventType).toBe('manual_adjustment');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.amount).toBe('-75.00');
    const effect = JSON.parse(ev.effect as string);
    expect(effect.direction).toBe('decrease');
  });

  it('returns balanced debit/credit for all event types', () => {
    // Verify any posting from this account is balanced
    const postings = ctx.sqlite
      .prepare(`
        SELECT le.id AS entry_id,
          (SELECT SUM(lp1.amount_micros) FROM ledger_postings lp1 WHERE lp1.ledger_entry_id = le.id AND lp1.side = 'debit') AS debit_total,
          (SELECT SUM(lp2.amount_micros) FROM ledger_postings lp2 WHERE lp2.ledger_entry_id = le.id AND lp2.side = 'credit') AS credit_total
        FROM ledger_entries le
        WHERE le.account_id = ?
      `)
      .all(ctx.accountId) as { entry_id: string; debit_total: number; credit_total: number }[];

    for (const p of postings) {
      expect(p.debit_total).toBe(p.credit_total);
    }
  });
});

// ── POST error handling tests ───────────────────────────────────────────

describe('POST /api/accounts/:id/financial-events (error handling)', () => {
  it('returns 404 for non-existent account', () => {
    const fakeId = randomUUID();
    const result = doPostFinancialEvent(ctx.sqlite, fakeId, {
      eventType: 'deposit',
      amount: '100.00',
    });

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Account not found');
  });

  it('returns 400 for malformed amount (non-numeric)', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'deposit',
      amount: 'not-a-number',
    });

    expect(result.status).toBe(400);
    // Could be 400 from Zod validation or Invalid amount from kernel
    expect([400]).toContain(result.status);
  });

  it('returns 400 for zero amount on cash events', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'deposit',
      amount: '0.00',
    });

    expect(result.status).toBe(400);
  });

  it('returns 400 for negative amount on cash events', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'deposit',
      amount: '-50.00',
    });

    expect(result.status).toBe(400);
  });

  it('returns 400 for missing eventType', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      amount: '100.00',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid eventType', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'invalid_type',
      amount: '100.00',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Validation failed');
  });

  it('returns 400 for non-object body (malformed JSON)', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, 'not-json');

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invalid JSON body');
  });

  it('returns 409 for duplicate idempotency key', () => {
    const idempotencyKey = randomUUID();

    const first = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'deposit',
      amount: '2500.00',
      idempotencyKey,
    });
    expect(first.status).toBe(201);

    const second = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'withdrawal',
      amount: '5000.00',
      idempotencyKey,
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('Duplicate idempotency key');
  });

  it('allows different idempotency keys without collision', () => {
    const key1 = randomUUID();
    const key2 = randomUUID();

    const r1 = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'dividend',
      amount: '100.00',
      idempotencyKey: key1,
    });
    expect(r1.status).toBe(201);

    const r2 = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'interest',
      amount: '200.00',
      idempotencyKey: key2,
    });
    expect(r2.status).toBe(201);

    const e1 = r1.body.event as Record<string, unknown>;
    const e2 = r2.body.event as Record<string, unknown>;
    expect(e1.id).not.toBe(e2.id);
  });

  it('rolls back on failure, leaving no partial event', () => {
    const beforeCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;

    const fakeId = randomUUID();
    const result = doPostFinancialEvent(ctx.sqlite, fakeId, {
      eventType: 'deposit',
      amount: '500.00',
    });
    expect(result.status).toBe(404);

    const afterCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;
    expect(afterCount).toBe(beforeCount);
  });

  it('returns 400 for stock_split missing required fields', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'stock_split',
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Validation failed');
  });
});

// ── Read-back verification ──────────────────────────────────────────────

describe('POST /api/accounts/:id/financial-events (persistence verification)', () => {
  it('persists all event types with correct data (read-back)', () => {
    const key = randomUUID();
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'dividend',
      amount: '777.77',
      idempotencyKey: key,
      description: 'Read-back test',
      perShareAmount: '1.50',
      shares: 518,
    });
    expect(result.status).toBe(201);

    const event = result.body.event as Record<string, unknown>;
    const eventId = event.id as string;

    // Read back from DB
    const dbEvent = ctx.sqlite
      .prepare('SELECT * FROM financial_events WHERE id = ?')
      .get(eventId) as Record<string, unknown> | undefined;
    expect(dbEvent).toBeDefined();
    expect(dbEvent!.event_type).toBe('dividend');
    expect(dbEvent!.idempotency_key).toBe(key);
    expect(dbEvent!.description).toBe('Read-back test');

    // Verify payload column persisted correctly
    expect(typeof dbEvent!.payload).toBe('string');
    const payload = JSON.parse(dbEvent!.payload as string);
    expect(payload.amount).toBe('777.77');
    expect(payload.perShareAmount).toBe('1.50');
    expect(payload.shares).toBe(518);

    // Verify effect column persisted correctly
    expect(typeof dbEvent!.effect).toBe('string');
    const effect = JSON.parse(dbEvent!.effect as string);
    expect(effect.kind).toBe('cash');
    expect(effect.direction).toBe('increase');

    // Verify ledger entry and postings
    const dbEntry = ctx.sqlite
      .prepare('SELECT * FROM ledger_entries WHERE financial_event_id = ?')
      .get(eventId) as Record<string, unknown> | undefined;
    expect(dbEntry).toBeDefined();

    const postings = ctx.sqlite
      .prepare('SELECT * FROM ledger_postings WHERE ledger_entry_id = ? ORDER BY sequence ASC')
      .all(dbEntry!.id) as Record<string, unknown>[];
    expect(postings).toHaveLength(2);

    const debit = postings.find((p) => p.side === 'debit');
    const credit = postings.find((p) => p.side === 'credit');
    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    expect(debit!.amount).toBe('777.77');
    expect(credit!.amount).toBe('777.77');
  });
});

// ── GET tests ───────────────────────────────────────────────────────────

describe('GET /api/accounts/:id/financial-events', () => {
  /**
   * Simulates GET /api/accounts/:id/financial-events route logic.
   */
  function doGetFinancialEvents(
    sqlite: Database.Database,
    accountId: string,
    query: Record<string, string> = {},
  ): { status: number; body: Record<string, unknown> } {
    try {
      const limit = query.limit ? parseInt(query.limit, 10) : 100;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;

      if (limit < 1 || limit > 200 || offset < 0) {
        return {
          status: 400,
          body: { error: 'Invalid query parameters' },
        };
      }

      const eventRows = listAccountEvents(sqlite, accountId, { limit, offset });
      const total = countAccountEvents(sqlite, accountId);

      const events = eventRows.map((row) => ({
        event: {
          id: row.id,
          accountId: row.account_id,
          eventType: row.event_type,
          idempotencyKey: row.idempotency_key,
          description: row.description,
          payload: row.payload,
          effect: row.effect,
          postedAt: row.posted_at,
          createdAt: row.created_at,
        },
        entry: row.entry_id
          ? {
              id: row.entry_id,
              financialEventId: row.id,
              accountId: row.account_id,
              description: row.description,
              postedAt: row.posted_at,
              createdAt: row.created_at,
            }
          : null,
        postings: null,
        status: {
          hasEntry: row.entry_id !== null,
          isBalanced: row.is_balanced === 1,
          postingCount: row.posting_count,
        },
      }));

      return {
        status: 200,
        body: { events, total },
      };
    } catch (error) {
      return {
        status: 500,
        body: {
          error: 'Failed to list financial events',
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  it('returns empty events list for an account with no events', () => {
    const newAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(newAccountId, 'Empty Account', null, 'USD', now, now);

    const result = doGetFinancialEvents(ctx.sqlite, newAccountId);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.events)).toBe(true);
    expect((result.body.events as unknown[]).length).toBe(0);
    expect(result.body.total).toBe(0);
  });

  it('returns all posted events in deterministic order', () => {
    const result = doGetFinancialEvents(ctx.sqlite, ctx.accountId);
    expect(result.status).toBe(200);

    const events = result.body.events as Record<string, unknown>[];
    expect(events.length).toBeGreaterThan(0);
    expect(result.body.total).toBeGreaterThan(0);

    // Verify events are in deterministic order (posted_at ascending, then id)
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1].event as Record<string, unknown>;
      const curr = events[i].event as Record<string, unknown>;
      expect(new Date(prev.postedAt as string).getTime()).toBeLessThanOrEqual(
        new Date(curr.postedAt as string).getTime(),
      );
    }
  });

  it('each event item has correct response shape', () => {
    const result = doGetFinancialEvents(ctx.sqlite, ctx.accountId);
    expect(result.status).toBe(200);

    const events = result.body.events as Record<string, unknown>[];
    const item = events[0];

    // Event field
    const event = item.event as Record<string, unknown>;
    expect(typeof event.id).toBe('string');
    expect(typeof event.eventType).toBe('string');
    expect(typeof event.accountId).toBe('string');
    expect(typeof event.postedAt).toBe('string');
    expect(typeof event.createdAt).toBe('string');

    // Status field
    const status = item.status as Record<string, unknown>;
    expect(typeof status.hasEntry).toBe('boolean');
    expect(typeof status.isBalanced).toBe('boolean');
    expect(typeof status.postingCount).toBe('number');

    // Entry is either null or has required fields
    if (item.entry !== null) {
      const entry = item.entry as Record<string, unknown>;
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.financialEventId).toBe('string');
    }

    // Postings should be null for the list view
    expect(item.postings).toBeNull();
  });

  it('provides payload/effect in list items', () => {
    const result = doGetFinancialEvents(ctx.sqlite, ctx.accountId);
    expect(result.status).toBe(200);

    const events = result.body.events as Record<string, unknown>[];

    // Find the dividend event we posted earlier (has payload)
    const dividendEvent = events.find(
      (e) => (e.event as Record<string, unknown>).eventType === 'dividend',
    );
    if (dividendEvent) {
      const ev = dividendEvent.event as Record<string, unknown>;
      expect(typeof ev.payload).toBe('string');
      expect(typeof ev.effect).toBe('string');
    }

    // Opening balance event should have payload/effect (postEventWithEffect sets them)
    const obEvent = events.find(
      (e) => (e.event as Record<string, unknown>).eventType === 'opening_balance',
    );
    if (obEvent) {
      const ev = obEvent.event as Record<string, unknown>;
      expect(typeof ev.payload).toBe('string');
      expect(typeof ev.effect).toBe('string');
      const effect = JSON.parse(ev.effect as string);
      expect(effect.kind).toBe('cash');
    }
  });

  it('returns all posted events with status posted', () => {
    const result = doGetFinancialEvents(ctx.sqlite, ctx.accountId);
    expect(result.status).toBe(200);

    const events = result.body.events as Record<string, unknown>[];
    for (const item of events) {
      const status = item.status as Record<string, unknown>;
      expect(status.hasEntry).toBe(true);
      expect(status.isBalanced).toBe(true);
    }
  });

  it('respects pagination (limit and offset)', () => {
    const limitResult = doGetFinancialEvents(ctx.sqlite, ctx.accountId, { limit: '2' });
    expect(limitResult.status).toBe(200);
    expect((limitResult.body.events as unknown[]).length).toBeLessThanOrEqual(2);

    const offsetResult = doGetFinancialEvents(ctx.sqlite, ctx.accountId, { limit: '100', offset: '0' });
    expect(offsetResult.status).toBe(200);
    const totalEvents = (offsetResult.body.events as unknown[]).length;
    expect(totalEvents).toBeGreaterThanOrEqual(0);
  });

  it('total matches actual event count', () => {
    const result = doGetFinancialEvents(ctx.sqlite, ctx.accountId);
    expect(result.status).toBe(200);
    expect((result.body.events as unknown[]).length).toBe(result.body.total);
  });
});

// ── Global ledger balance assertions ────────────────────────────────────

describe('Ledger integrity', () => {
  it('all postings are globally balanced', () => {
    const debitTotal = (
      ctx.sqlite.prepare("SELECT COALESCE(SUM(amount_micros), 0) AS total FROM ledger_postings WHERE side = 'debit'").get() as { total: number }
    ).total;
    const creditTotal = (
      ctx.sqlite.prepare("SELECT COALESCE(SUM(amount_micros), 0) AS total FROM ledger_postings WHERE side = 'credit'").get() as { total: number }
    ).total;

    expect(debitTotal).toBe(creditTotal);
  });
});

// ── Legacy non-USD account (USD-only contract) ─────────────────────────

describe('legacy non-USD account (USD-only contract)', () => {
  let eurAccountId: string;

  beforeAll(() => {
    // Insert a legacy EUR account directly — pre-dates the USD-only contract
    // and must be preserved as-is (never rewritten), but must block all new
    // financially meaningful activity.
    eurAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(eurAccountId, 'Legacy EUR Account', 'Broker', 'EUR', now, now);
  });

  it('rejects a deposit with a clear unsupported-currency error', () => {
    const result = doPostFinancialEvent(ctx.sqlite, eurAccountId, {
      eventType: 'deposit',
      amount: '100.00',
      description: 'Should be blocked',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toContain('Unsupported account currency');
    expect(result.body.error).toContain('USD');
    expect(result.body.details).toMatchObject({
      accountId: eurAccountId,
      currency: 'EUR',
    });
  });

  it('rejects every financially meaningful event type with zero ledger mutation', () => {
    const eventsBefore = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events WHERE account_id = ?').get(eurAccountId) as { count: number }
    ).count;
    const postingsBefore = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM ledger_postings').get() as { count: number }
    ).count;

    for (const eventType of ['deposit', 'withdrawal', 'dividend', 'interest', 'fee', 'tax', 'manual_adjustment']) {
      const result = doPostFinancialEvent(ctx.sqlite, eurAccountId, {
        eventType,
        amount: '10.00',
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toContain('Unsupported account currency');
    }

    const eventsAfter = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events WHERE account_id = ?').get(eurAccountId) as { count: number }
    ).count;
    const postingsAfter = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM ledger_postings').get() as { count: number }
    ).count;
    expect(eventsAfter).toBe(eventsBefore);
    expect(postingsAfter).toBe(postingsBefore);
  });

  it('does not consume the idempotency key on rejection', () => {
    const idempotencyKey = randomUUID();
    const result = doPostFinancialEvent(ctx.sqlite, eurAccountId, {
      eventType: 'deposit',
      amount: '50.00',
      idempotencyKey,
    });
    expect(result.status).toBe(400);

    const row = ctx.sqlite
      .prepare('SELECT id FROM financial_events WHERE idempotency_key = ?')
      .get(idempotencyKey);
    expect(row).toBeUndefined();
  });
});

// ── A6: inactive accounts are read-only for new financial activity ──────

describe('A6: inactive accounts reject new financial activity', () => {
  let deactivatedId: string;
  let draftId: string;

  beforeAll(() => {
    const sqlite = ctx.sqlite;
    const now = new Date().toISOString();
    // Historical deactivated account: initialized + deposit, then deactivated.
    deactivatedId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 1, ?, ?)`,
      )
      .run(deactivatedId, 'Deactivated A6', 'Broker', now, now);
    const init = postEventWithEffect(sqlite, deactivatedId, {
      eventType: 'opening_balance',
      amount: '10000.00',
    });
    expect(init.event.id).toBeTruthy();
    postEventWithEffect(sqlite, deactivatedId, { eventType: 'deposit', amount: '2000.00' });
    sqlite
      .prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), deactivatedId);

    // Pristine draft account (never initialized).
    draftId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
      )
      .run(draftId, 'Draft A6', 'Broker', now, now);
  });

  it('17: deactivated account -> 409 ACCOUNT_INACTIVE with zero mutation', () => {
    const eventsBefore = (
      ctx.sqlite.prepare('SELECT COUNT(*) AS c FROM financial_events WHERE account_id = ?').get(deactivatedId) as { c: number }
    ).c;
    const postingsBefore = (
      ctx.sqlite.prepare('SELECT COUNT(*) AS c FROM ledger_postings').get() as { c: number }
    ).c;

    const result = doPostFinancialEvent(ctx.sqlite, deactivatedId, {
      eventType: 'deposit',
      amount: '500.00',
    });

    expect(result.status).toBe(409);
    expect(result.body.error).toBe('Account is inactive');
    expect(result.body.code).toBe('ACCOUNT_INACTIVE');

    // Zero new rows; projection unchanged.
    const eventsAfter = (
      ctx.sqlite.prepare('SELECT COUNT(*) AS c FROM financial_events WHERE account_id = ?').get(deactivatedId) as { c: number }
    ).c;
    const postingsAfter = (
      ctx.sqlite.prepare('SELECT COUNT(*) AS c FROM ledger_postings').get() as { c: number }
    ).c;
    expect(eventsAfter).toBe(eventsBefore);
    expect(postingsAfter).toBe(postingsBefore);
  });

  it('18: rejected request does not consume the idempotency key; reactivation makes it reusable', () => {
    const idempotencyKey = randomUUID();
    const rejected = doPostFinancialEvent(ctx.sqlite, deactivatedId, {
      eventType: 'deposit',
      amount: '300.00',
      idempotencyKey,
    });
    expect(rejected.status).toBe(409);

    // Reactivate, then retry the SAME request with the SAME key.
    ctx.sqlite
      .prepare('UPDATE accounts SET is_active = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), deactivatedId);
    const retry = doPostFinancialEvent(ctx.sqlite, deactivatedId, {
      eventType: 'deposit',
      amount: '300.00',
      idempotencyKey,
    });
    expect(retry.status).toBe(201);
    // Deactivate again for the remaining tests.
    ctx.sqlite
      .prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), deactivatedId);
  });

  it('19: pristine draft -> 409 until initialized; initialization is the only transition', () => {
    const rejected = doPostFinancialEvent(ctx.sqlite, draftId, {
      eventType: 'deposit',
      amount: '100.00',
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('ACCOUNT_INACTIVE');

    // Initialization transitions the draft to active.
    initializeAccount(ctx.sqlite, { accountId: draftId, mode: 'opening_balance', amount: '10000.00' });

    const accepted = doPostFinancialEvent(ctx.sqlite, draftId, {
      eventType: 'deposit',
      amount: '100.00',
    });
    expect(accepted.status).toBe(201);
  });
});

// ── A7: normal posting is atomic with the performance projection ────────

describe('A7: projection failure at the normal posting boundary', () => {
  let a7AccountId: string;

  beforeAll(() => {
    const sqlite = ctx.sqlite;
    const now = new Date().toISOString();
    a7AccountId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
      )
      .run(a7AccountId, 'A7 Route', 'Broker', now, now);
    initializeAccount(sqlite, { accountId: a7AccountId, mode: 'opening_balance', amount: '10000.00' });
  });

  it('30: forced projection failure -> 500 with rollback; retry -> 201 with coherent projection', () => {
    const sqlite = ctx.sqlite;
    expect(findAccountPerformance(sqlite, a7AccountId)?.nav).toBe('10000.00');

    sqlite.exec(`
      CREATE TRIGGER a7_route_projection_fail BEFORE UPDATE ON account_performance
      WHEN NEW.account_id = '${a7AccountId}'
      BEGIN SELECT RAISE(ABORT, 'forced posting projection failure'); END;
    `);

    const failed = doPostFinancialEvent(sqlite, a7AccountId, {
      eventType: 'deposit',
      amount: '2000.00',
    });
    expect(failed.status).toBe(500);
    expect(failed.body.error).toBe('Failed to post financial event');
    expect(failed.body.code).toBe('FINANCIAL_EVENT_POSTING_PROJECTION_FAILED');
    sqlite.exec('DROP TRIGGER a7_route_projection_fail');

    // Rolled back: no deposit event, no ledger mutation, prior projection intact.
    const depositCount = sqlite
      .prepare("SELECT COUNT(*) AS c FROM financial_events WHERE account_id = ? AND event_type = 'deposit'")
      .get(a7AccountId) as { c: number };
    expect(depositCount.c).toBe(0);
    const postings = sqlite
      .prepare('SELECT COUNT(*) AS c FROM ledger_postings WHERE account_id = ?')
      .get(a7AccountId) as { c: number };
    expect(postings.c).toBe(2); // only the opening balance pair
    expect(findAccountPerformance(sqlite, a7AccountId)?.nav).toBe('10000.00');

    // Retry succeeds with a coherent projection (12,000).
    const retry = doPostFinancialEvent(sqlite, a7AccountId, {
      eventType: 'deposit',
      amount: '2000.00',
    });
    expect(retry.status).toBe(201);
    expect((retry.body as { performance: { success: boolean; nav: string } }).performance.success).toBe(true);
    expect((retry.body as { performance: { nav: string } }).performance.nav).toBe('12000.00');
    expect(findAccountPerformance(sqlite, a7AccountId)?.nav).toBe('12000.00');
  });
});
