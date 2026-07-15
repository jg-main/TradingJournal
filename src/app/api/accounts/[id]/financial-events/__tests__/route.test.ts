/**
 * Route tests for POST /api/accounts/:id/financial-events
 *
 * Tests the route logic by simulating it against a real SQLite database
 * with all migrations applied.
 *
 * Covers:
 * - Successful opening balance posting (201) with balanced debit/credit
 * - Duplicate idempotency key rejection (409)
 * - Missing account (404)
 * - Invalid amount: malformed, zero, negative (400)
 * - Zod validation: missing eventType, invalid eventType, missing amount (400)
 * - Malformed JSON body (400)
 * - Rollback behavior on failure
 * - Read-back verification of persisted data
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/financial-events/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postOpeningBalance } from '@/lib/accounting/posting';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  AccountNotFoundError,
  DuplicateIdempotencyKeyError,
} from '@/lib/accounting/errors';
import { postFinancialEventSchema } from '@/lib/accounting/api-contracts';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-financial-events-route.db';

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
}

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Apply all migrations in order to build the full schema
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
          // Skip statements that fail due to ordering
        }
      }
    }
  }

  // Create a test account
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
 * logic without Next.js dependencies.
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

    const { amount, idempotencyKey, description } = parsed.data;

    // 3. Post opening balance through the kernel
    const result = postOpeningBalance(sqlite, {
      accountId,
      amount,
      idempotencyKey,
      description,
    });

    // 4. Return success response
    return {
      status: 201,
      body: {
        event: {
          id: result.event.id,
          accountId: result.event.accountId,
          eventType: result.event.eventType,
          idempotencyKey: result.event.idempotencyKey,
          description: result.event.description,
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
    if (error instanceof DuplicateIdempotencyKeyError) {
      return {
        status: 409,
        body: { error: 'Duplicate idempotency key', details: (error as Error).message },
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

describe('postFinancialEventSchema (validation)', () => {
  it('accepts a valid opening balance request', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'opening_balance',
      amount: '5000.00',
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
      eventType: 'opening_balance',
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
});

describe('POST /api/accounts/:id/financial-events (route integration)', () => {
  it('returns 201 with balanced debit/credit posting', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '5000.00',
      description: 'Initial deposit',
    });

    expect(result.status).toBe(201);
    expect(result.body.event).toBeDefined();

    const event = result.body.event as Record<string, unknown>;
    expect(event.accountId).toBe(ctx.accountId);
    expect(event.eventType).toBe('opening_balance');
    expect(event.description).toBe('Initial deposit');
    expect(typeof event.id).toBe('string');
    expect(typeof event.postedAt).toBe('string');

    const postings = result.body.postings as Record<string, unknown>;
    const debit = postings.debit as Record<string, unknown>;
    const credit = postings.credit as Record<string, unknown>;

    expect(debit.side).toBe('debit');
    expect(debit.amount).toBe('5000.00');
    expect(debit.amountMicros).toBe(5_000_000_000);
    expect(debit.currency).toBe('USD');

    expect(credit.side).toBe('credit');
    expect(credit.amount).toBe('5000.00');
    expect(credit.amountMicros).toBe(5_000_000_000);
    expect(credit.currency).toBe('USD');

    expect((credit.sequence as number) - (debit.sequence as number)).toBe(1);
  });

  it('returns 404 for non-existent account', () => {
    const fakeId = randomUUID();
    const result = doPostFinancialEvent(ctx.sqlite, fakeId, {
      eventType: 'opening_balance',
      amount: '100.00',
    });

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Account not found');
  });

  it('returns 400 for malformed amount', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: 'not-a-number',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invalid amount');
  });

  it('returns 400 for zero amount', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '0.00',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invalid amount');
  });

  it('returns 400 for negative amount', () => {
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '-50.00',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invalid amount');
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
      eventType: 'trade_execution',
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
      eventType: 'opening_balance',
      amount: '2500.00',
      idempotencyKey,
    });
    expect(first.status).toBe(201);

    const second = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
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
      eventType: 'opening_balance',
      amount: '1000.00',
      idempotencyKey: key1,
    });
    expect(r1.status).toBe(201);

    const r2 = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '2000.00',
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
      eventType: 'opening_balance',
      amount: '500.00',
    });
    expect(result.status).toBe(404);

    const afterCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;
    expect(afterCount).toBe(beforeCount);

    const entryCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM ledger_entries').get() as { count: number }
    ).count;
    const postingCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM ledger_postings').get() as { count: number }
    ).count;
    expect(entryCount).toBe(beforeCount);
    expect(postingCount).toBe(beforeCount * 2);
  });

  it('persists data correctly (read-back verification)', () => {
    const key = randomUUID();
    const result = doPostFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '7777.77',
      idempotencyKey: key,
      description: 'Read-back verification',
    });
    expect(result.status).toBe(201);

    const event = result.body.event as Record<string, unknown>;
    const eventId = event.id as string;

    const dbEvent = ctx.sqlite
      .prepare('SELECT * FROM financial_events WHERE id = ?')
      .get(eventId) as Record<string, unknown> | undefined;
    expect(dbEvent).toBeDefined();
    expect(dbEvent!.event_type).toBe('opening_balance');
    expect(dbEvent!.idempotency_key).toBe(key);
    expect(dbEvent!.description).toBe('Read-back verification');

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
    expect(debit!.amount).toBe('7777.77');
    expect(debit!.amount_micros).toBe(7_777_770_000);
    expect(credit!.amount).toBe('7777.77');
    expect(credit!.amount_micros).toBe(7_777_770_000);
  });
});
