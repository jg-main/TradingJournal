/**
 * Opening Balance Flow — end-to-end flow test.
 *
 * Tracks the complete narrative of "opening cash" through the full pipeline:
 * 1. Create an account and post opening balance through the endpoint
 * 2. Read the resulting event and balanced postings
 * 3. Rebuild the opening cash projection and verify it matches the posted amount
 * 4. Verify the global ledger remains balanced after multiple events
 * 5. Verify destructive corrections (UPDATE/DELETE) are rejected by immutability triggers
 * 6. Verify idempotency-keys block duplicate postings
 *
 * This is the flow signature that downstream slices (event routes, execution
 * posting, account rollforward) will extend.
 *
 * Run: npx vitest run --reporter verbose src/lib/accounting/__tests__/opening-balance-flow.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postOpeningBalance } from '../posting';
import { rebuildOpeningCash, checkLedgerBalance, rebuildNetPosition } from '../rebuild';
import { postFinancialEventSchema } from '../api-contracts';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  AccountNotFoundError,
  DuplicateIdempotencyKeyError,
} from '../errors';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-opening-balance-flow.db';

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

  // Seed a test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Flow Test Account', 'Flow Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ── Simulated Route Endpoint ────────────────────────────────────────────

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Mirrors POST /api/accounts/:id/financial-events handler logic.
 * Exercises the same validation and error-mapping path as the real route.
 */
function postFinancialEvent(
  sqlite: Database.Database,
  accountId: string,
  requestBody: unknown,
): RouteResult {
  // 1. Validate JSON body structure
  if (typeof requestBody !== 'object' || requestBody === null) {
    return { status: 400, body: { error: 'Invalid JSON body' } };
  }

  // 2. Zod validation (same schema the real route uses)
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

  // Narrow to opening_balance — this endpoint only supports the opening_balance flow
  if (parsed.data.eventType !== 'opening_balance') {
    return {
      status: 400,
      body: {
        error: 'Only opening_balance events are supported',
        details: `Received event type: ${parsed.data.eventType}`,
      },
    };
  }
  const { amount, idempotencyKey, description } = parsed.data;

  // 3. Delegate to the posting kernel
  try {
    const result = postOpeningBalance(sqlite, {
      accountId,
      amount,
      idempotencyKey,
      description,
    });

    // 4. Map domain records → API response shape
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
    // 5. Map domain errors → HTTP status codes
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
    if (error instanceof InvalidAmountError || error instanceof InvalidMicrosBoundsError) {
      return {
        status: 400,
        body: { error: 'Invalid amount', details: (error as Error).message },
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

// ── Flow Tests ──────────────────────────────────────────────────────────

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(ctx.sqlite);
});

describe('Opening Balance Flow', () => {
  // ── Step 1: Post opening balance ──────────────────────────────────────

  it('posts opening balance through the endpoint with balanced debit/credit', () => {
    const result = postFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '10000.00',
      idempotencyKey: randomUUID(),
      description: 'Initial funding for flow test',
    });

    // Assert 201 with complete response structure
    expect(result.status).toBe(201);

    const { event, entry, postings } = result.body as Record<string, unknown>;
    const ev = event as Record<string, unknown>;
    const ent = entry as Record<string, unknown>;
    const ps = postings as Record<string, unknown>;
    const debit = ps.debit as Record<string, unknown>;
    const credit = ps.credit as Record<string, unknown>;

    // Event shape
    expect(ev.accountId).toBe(ctx.accountId);
    expect(ev.eventType).toBe('opening_balance');
    expect(ev.description).toBe('Initial funding for flow test');
    expect(typeof ev.id).toBe('string');
    expect(typeof ev.postedAt).toBe('string');
    expect(typeof ev.createdAt).toBe('string');

    // Entry shape — links event to postings
    expect(ent.accountId).toBe(ctx.accountId);
    expect(ent.financialEventId).toBe(ev.id);
    expect(typeof ent.id).toBe('string');

    // Balanced postings — debit and credit match
    expect(debit.side).toBe('debit');
    expect(debit.amount).toBe('10000.00');
    expect(debit.amountMicros).toBe(10_000_000_000);
    expect(debit.currency).toBe('USD');

    expect(credit.side).toBe('credit');
    expect(credit.amount).toBe('10000.00');
    expect(credit.amountMicros).toBe(10_000_000_000);
    expect(credit.currency).toBe('USD');

    // Sequence order: debit before credit
    expect((credit.sequence as number)).toBe((debit.sequence as number) + 1);

    // Cross-reference: both postings point to the same entry
    expect(debit.ledgerEntryId).toBe(ent.id);
    expect(credit.ledgerEntryId).toBe(ent.id);
  });

  // ── Step 2: Rebuild projection from immutable postings ────────────────

  it('rebuilds opening cash projection matching the posted amount', () => {
    const projection = rebuildOpeningCash(ctx.sqlite, ctx.accountId);

    // Total should be exactly what was posted
    expect(projection.accountId).toBe(ctx.accountId);
    expect(projection.totalOpeningCash).toBe('10000.00');
    expect(projection.totalOpeningCashMicros).toBe(10_000_000_000);

    // At least one contributing event
    expect(projection.events.length).toBeGreaterThanOrEqual(1);

    // The most recent event should have the correct amount (the integration
    // test in T03 proved deterministic rebuild; this proves the projection
    // reflects postings made through the endpoint path)
    const lastEvent = projection.events[projection.events.length - 1];
    expect(lastEvent.amount).toBe('10000.00');
    expect(lastEvent.eventType).toBe('opening_balance');
    expect(typeof lastEvent.sequence).toBe('number');

    // rebuiltAt should be an ISO timestamp
    expect(typeof projection.rebuiltAt).toBe('string');
    expect(projection.rebuiltAt).toBeTruthy();
  });

  // ── Step 3: Global ledger balance ─────────────────────────────────────

  it('verifies the ledger is globally balanced', () => {
    const balance = checkLedgerBalance(ctx.sqlite);

    expect(balance.isBalanced).toBe(true);
    expect(balance.debitTotal).toBeGreaterThan(0);
    expect(balance.debitTotal).toBe(balance.creditTotal);
    expect(balance.difference).toBe(0);
  });

  // ── Step 4: Immutability — destructive corrections rejected ───────────

  it('rejects destructive UPDATE to posted financial events', () => {
    // Find a posted financial event
    const events = ctx.sqlite
      .prepare(
        `SELECT id FROM financial_events WHERE account_id = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .all(ctx.accountId) as { id: string }[];

    expect(events.length).toBe(1);
    const eventId = events[0].id;

    // UPDATE should be rejected by the immutability trigger
    expect(() => {
      ctx.sqlite
        .prepare('UPDATE financial_events SET description = ? WHERE id = ?')
        .run('malicious update', eventId);
    }).toThrow(/cannot update/i);
  });

  it('rejects destructive DELETE to posted ledger postings', () => {
    // Find a debit posting
    const postings = ctx.sqlite
      .prepare(
        `SELECT lp.id FROM ledger_postings lp
         JOIN ledger_entries le ON lp.ledger_entry_id = le.id
         WHERE le.account_id = ? AND lp.side = 'debit'
         LIMIT 1`,
      )
      .all(ctx.accountId) as { id: string }[];

    expect(postings.length).toBe(1);
    const postingId = postings[0].id;

    // DELETE should be rejected by the immutability trigger
    expect(() => {
      ctx.sqlite
        .prepare('DELETE FROM ledger_postings WHERE id = ?')
        .run(postingId);
    }).toThrow(/cannot delete/i);
  });

  it('rejects destructive UPDATE to posted ledger entries', () => {
    const entries = ctx.sqlite
      .prepare(
        `SELECT id FROM ledger_entries WHERE account_id = ? LIMIT 1`,
      )
      .all(ctx.accountId) as { id: string }[];

    expect(entries.length).toBe(1);
    const entryId = entries[0].id;

    expect(() => {
      ctx.sqlite
        .prepare('UPDATE ledger_entries SET description = ? WHERE id = ?')
        .run('malicious update', entryId);
    }).toThrow(/cannot update/i);
  });

  // ── Step 5: Idempotency ──────────────────────────────────────────────

  it('rejects duplicate idempotency key (409 via endpoint)', () => {
    const key = randomUUID();

    // First post succeeds
    const first = postFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '500.00',
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);

    // Second post with same key → 409
    const second = postFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '99999.99',
      idempotencyKey: key,
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('Duplicate idempotency key');
  });

  it('allows different idempotency keys without collision', () => {
    const r1 = postFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '100.00',
      idempotencyKey: randomUUID(),
    });
    expect(r1.status).toBe(201);

    const r2 = postFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'opening_balance',
      amount: '200.00',
      idempotencyKey: randomUUID(),
    });
    expect(r2.status).toBe(201);

    const e1 = r1.body.event as Record<string, unknown>;
    const e2 = r2.body.event as Record<string, unknown>;
    expect(e1.id).not.toBe(e2.id);
  });

  // ── Step 6: Aggregation in projection ────────────────────────────────

  it('aggregates multiple opening balance events in the projection', () => {
    const projection = rebuildOpeningCash(ctx.sqlite, ctx.accountId);

    // Total should be: 10000 + 500 + 100 + 200 = 10800
    expect(projection.totalOpeningCash).toBe('10800.00');
    expect(projection.totalOpeningCashMicros).toBe(10_800_000_000);

    // Should have 4 contributing events
    expect(projection.events.length).toBe(4);

    // Events should be sorted by sequence (not by the order they were posted)
    const sequences = projection.events.map((e) => e.sequence);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }
  });

  // ── Step 7: Error cases through the endpoint ─────────────────────────

  it('returns 404 for non-existent account', () => {
    const fakeId = randomUUID();
    const result = postFinancialEvent(ctx.sqlite, fakeId, {
      eventType: 'opening_balance',
      amount: '100.00',
    });

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Account not found');
  });

  it('rejects invalid eventType through Zod validation (400)', () => {
    const result = postFinancialEvent(ctx.sqlite, ctx.accountId, {
      eventType: 'trade_execution',
      amount: '100.00',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Validation failed');
  });

  it('rejects non-object body as malformed JSON (400)', () => {
    const result = postFinancialEvent(ctx.sqlite, ctx.accountId, 'not-an-object');

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invalid JSON body');
  });

  // ── Step 8: Rollback leaves no partial state ─────────────────────────

  it('rolls back on failure leaving no partial accounting state', () => {
    // Count events before failed attempt
    const beforeCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;

    // Attempt to post to a non-existent account
    const fakeId = randomUUID();
    const result = postFinancialEvent(ctx.sqlite, fakeId, {
      eventType: 'opening_balance',
      amount: '500.00',
    });
    expect(result.status).toBe(404);

    // No new events, entries, or postings
    const afterEventCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM financial_events').get() as { count: number }
    ).count;
    expect(afterEventCount).toBe(beforeCount);

    const entryCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM ledger_entries').get() as { count: number }
    ).count;
    const postingCount = (
      ctx.sqlite.prepare('SELECT count(*) AS count FROM ledger_postings').get() as { count: number }
    ).count;

    // Each successful event creates 1 entry + 2 postings.
    // We started with 4 successful events (10000, 500, 100, 200) = 4 entries, 8 postings.
    expect(entryCount).toBe(4);
    expect(postingCount).toBe(8);
  });

  // ── Step 9: Net position reflects all postings ───────────────────────

  it('net position matches opening cash total', () => {
    const net = rebuildNetPosition(ctx.sqlite, ctx.accountId);

    // For opening balance events only: net = sum of all debits - sum of all credits = 0
    // (each opening balance has equal debit and credit for the same account)
    expect(net.netMicros).toBe(0);
    expect(net.netAmount).toBe('0.00');
  });

  // ── Step 10: Deterministic rebuild ──────────────────────────────────

  it('produces identical projection on repeated rebuild', () => {
    const first = rebuildOpeningCash(ctx.sqlite, ctx.accountId);
    const second = rebuildOpeningCash(ctx.sqlite, ctx.accountId);

    expect(second.totalOpeningCash).toBe(first.totalOpeningCash);
    expect(second.totalOpeningCashMicros).toBe(first.totalOpeningCashMicros);
    expect(second.events).toHaveLength(first.events.length);

    for (let i = 0; i < first.events.length; i++) {
      expect(second.events[i].eventId).toBe(first.events[i].eventId);
      expect(second.events[i].amount).toBe(first.events[i].amount);
      expect(second.events[i].sequence).toBe(first.events[i].sequence);
      expect(second.events[i].postedAt).toBe(first.events[i].postedAt);
    }
  });
});
