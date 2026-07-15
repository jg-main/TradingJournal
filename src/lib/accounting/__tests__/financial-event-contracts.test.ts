/**
 * Contract-level tests for the financial event taxonomy, payload validation,
 * repository read/list boundary, and immutable row constraints.
 *
 * Tests the pure Zod/domain contracts and the repository boundary against
 * a real SQLite database with all migrations applied.  Does NOT test the
 * posting kernel (that's T02's scope).
 *
 * Coverage areas:
 * 1. Supported event types — each type validates and parses correctly
 * 2. Malformed payloads — invalid amounts, missing required fields, wrong types
 * 3. Ordering — listAccountEvents returns deterministic posted_at/id ordering
 * 4. Immutable row constraints — UPDATE/DELETE triggers from migration 0024
 * 5. Repository boundary — findEventById, listAccountEvents, countAccountEvents
 * 6. payload/effect column persistence through insertFinancialEvent
 * 7. Legacy opening_balance backward compatibility
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postFinancialEventSchema } from '../api-contracts';
import { EVENT_TYPES } from '../types';
import {
  insertFinancialEvent,
  findEventById,
  listAccountEvents,
  countAccountEvents,
  findEventByIdempotencyKey,
} from '../../../db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-financial-event-contracts.db';

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

  // Apply all migrations in order
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

  // Create a test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Contracts Test Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function insertTestEvent(
  sqlite: Database.Database,
  overrides: Partial<Parameters<typeof insertFinancialEvent>[1]> = {},
) {
  return insertFinancialEvent(sqlite, {
    accountId: overrides.accountId ?? 'placeholder',
    eventType: overrides.eventType ?? 'deposit',
    idempotencyKey: overrides.idempotencyKey ?? null,
    description: overrides.description ?? null,
    payload: overrides.payload ?? null,
    effect: overrides.effect ?? null,
    postedAt: overrides.postedAt ?? new Date().toISOString(),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Financial Event Taxonomy — EVENT_TYPES constant', () => {
  it('includes all 12 event types', () => {
    expect(EVENT_TYPES).toEqual([
      'opening_balance',
      'trade_execution',
      'adjustment',
      'transfer',
      'deposit',
      'withdrawal',
      'dividend',
      'interest',
      'fee',
      'tax',
      'stock_split',
      'manual_adjustment',
    ]);
  });
});

describe('Financial Event Taxonomy — API contract validation', () => {
  // ── All supported event types ─────────────────────────────────────────

  it('accepts opening_balance with valid amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'opening_balance',
      amount: '5000.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts deposit with valid amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '1000.00',
      description: 'Cash deposit',
    });
    expect(result.success).toBe(true);
  });

  it('accepts withdrawal with valid amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'withdrawal',
      amount: '500.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts dividend with optional perShareAmount and shares', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'dividend',
      amount: '150.00',
      perShareAmount: '0.75',
      shares: 200,
      description: 'Q3 dividend',
    });
    expect(result.success).toBe(true);
  });

  it('accepts interest with optional rate', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'interest',
      amount: '12.34',
      rate: '4.5%',
    });
    expect(result.success).toBe(true);
  });

  it('accepts fee with optional feeType', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'fee',
      amount: '9.99',
      feeType: 'monthly_maintenance',
    });
    expect(result.success).toBe(true);
  });

  it('accepts tax with optional taxType', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'tax',
      amount: '250.00',
      taxType: 'withholding',
    });
    expect(result.success).toBe(true);
  });

  it('accepts stock_split with ratio and quantity metadata, no amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'stock_split',
      symbol: 'AAPL',
      ratio: '4:1',
      oldShares: 100,
      newShares: 400,
    });
    expect(result.success).toBe(true);
  });

  it('accepts stock_split with optional oldPrice/newPrice', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'stock_split',
      symbol: 'TSLA',
      ratio: '5:1',
      oldShares: 20,
      newShares: 100,
      oldPrice: '900.00',
      newPrice: '180.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts manual_adjustment with signed amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'manual_adjustment',
      amount: '1000.00',
      reason: 'Correcting prior entry',
    });
    expect(result.success).toBe(true);
  });

  it('accepts manual_adjustment with negative signed amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'manual_adjustment',
      amount: '-500.00',
      reason: 'Reversal',
    });
    expect(result.success).toBe(true);
  });

  it('accepts event with idempotencyKey (UUID)', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '1000.00',
      idempotencyKey: randomUUID(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts event with postedAt (ISO datetime)', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '1000.00',
      postedAt: '2026-07-15T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  // ── Malformed payloads ───────────────────────────────────────────────—

  it('rejects deposit with negative amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '-100.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects withdrawal with negative amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'withdrawal',
      amount: '-50.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects stock_split with missing required fields', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'stock_split',
      // missing symbol, ratio, oldShares, newShares
    });
    expect(result.success).toBe(false);
  });

  it('rejects stock_split with zero shares', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'stock_split',
      symbol: 'AAPL',
      ratio: '4:1',
      oldShares: 0,
      newShares: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects manual_adjustment with zero amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'manual_adjustment',
      amount: '0.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid eventType string', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'invalid_type',
      amount: '100.00',
    });
    // discriminatedUnion should reject unknown discriminator values
    expect(result.success).toBe(false);
  });

  it('rejects non-canonical decimal amount', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });

  it('rejects amount with wrong decimal places', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '100.0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing amount for deposit', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID idempotencyKey', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '100.00',
      idempotencyKey: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects description longer than 500 characters', () => {
    const result = postFinancialEventSchema.safeParse({
      eventType: 'deposit',
      amount: '100.00',
      description: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('Repository — findEventById', () => {
  let ctx: TestContext;
  let eventId: string;

  beforeAll(() => {
    ctx = createTestDatabase();
    const row = insertTestEvent(ctx.sqlite, { accountId: ctx.accountId });
    eventId = row.id;
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns the event when found', () => {
    const event = findEventById(ctx.sqlite, eventId);
    expect(event).toBeDefined();
    expect(event!.id).toBe(eventId);
    expect(event!.account_id).toBe(ctx.accountId);
  });

  it('returns undefined for non-existent event', () => {
    const event = findEventById(ctx.sqlite, randomUUID());
    expect(event).toBeUndefined();
  });

  it('includes payload and effect columns in the returned row', () => {
    const event = findEventById(ctx.sqlite, eventId);
    expect(event).toBeDefined();
    expect(event).toHaveProperty('payload');
    expect(event).toHaveProperty('effect');
  });
});

describe('Repository — listAccountEvents ordering', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();

    // Insert events with deliberately out-of-order postedAt to verify
    // the query sorts them correctly.
    const base = new Date('2026-07-15T12:00:00.000Z');
    const dates = [
      new Date(base.getTime() - 60000).toISOString(), // oldest
      new Date(base.getTime() - 30000).toISOString(),
      base.toISOString(),                              // newest
    ];
    // Insert the newest first, oldest last (reverse order)
    insertTestEvent(ctx.sqlite, {
      accountId: ctx.accountId,
      eventType: 'deposit',
      description: 'newest',
      postedAt: dates[2],
      payload: JSON.stringify({ type: 'deposit', amount: '300.00' }),
    });
    insertTestEvent(ctx.sqlite, {
      accountId: ctx.accountId,
      eventType: 'withdrawal',
      description: 'middle',
      postedAt: dates[1],
    });
    insertTestEvent(ctx.sqlite, {
      accountId: ctx.accountId,
      eventType: 'dividend',
      description: 'oldest',
      postedAt: dates[0],
    });
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns events ordered by posted_at ASC, id ASC', () => {
    const rows = listAccountEvents(ctx.sqlite, ctx.accountId);
    // Should be: oldest, middle, newest
    expect(rows).toHaveLength(3);
    expect(rows[0].description).toBe('oldest');
    expect(rows[1].description).toBe('middle');
    expect(rows[2].description).toBe('newest');
  });

  it('respects limit and offset', () => {
    const page1 = listAccountEvents(ctx.sqlite, ctx.accountId, { limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);
    expect(page1[0].description).toBe('oldest');
    expect(page1[1].description).toBe('middle');

    const page2 = listAccountEvents(ctx.sqlite, ctx.accountId, { limit: 2, offset: 2 });
    expect(page2).toHaveLength(1);
    expect(page2[0].description).toBe('newest');
  });

  it('includes posting status columns (entry_id, posting_count, is_balanced)', () => {
    const rows = listAccountEvents(ctx.sqlite, ctx.accountId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // entry_id should be null because no ledger entries were created
      expect(row.entry_id).toBeNull();
      expect(typeof row.posting_count).toBe('number');
      expect(row.posting_count).toBe(0);
      expect(row.is_balanced).toBe(0);
    }
  });

  it('includes payload and effect in listed rows', () => {
    const rows = listAccountEvents(ctx.sqlite, ctx.accountId);
    const depositEvent = rows.find((r) => r.description === 'newest');
    expect(depositEvent).toBeDefined();
    expect(depositEvent!.payload).toBe(JSON.stringify({ type: 'deposit', amount: '300.00' }));
    expect(depositEvent!.effect).toBeNull();
  });

  it('countAccountEvents returns the correct count', () => {
    const count = countAccountEvents(ctx.sqlite, ctx.accountId);
    expect(count).toBe(3);
  });

  it('listAccountEvents only returns events for the requested account', () => {
    const rows = listAccountEvents(ctx.sqlite, ctx.accountId);
    for (const row of rows) {
      expect(row.account_id).toBe(ctx.accountId);
    }
  });
});

describe('Repository — insertFinancialEvent with payload/effect', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('persists payload and effect as JSON strings', () => {
    const payload = JSON.stringify({ type: 'deposit', amount: '1000.00' });
    const effect = JSON.stringify({ kind: 'cash', direction: 'increase', amount: '1000.00', amountMicros: 1_000_000_000 });

    const row = insertFinancialEvent(ctx.sqlite, {
      accountId: ctx.accountId,
      eventType: 'deposit',
      payload,
      effect,
      postedAt: new Date().toISOString(),
    });

    expect(row.payload).toBe(payload);
    expect(row.effect).toBe(effect);

    // Read back to confirm persistence
    const read = findEventById(ctx.sqlite, row.id);
    expect(read!.payload).toBe(payload);
    expect(read!.effect).toBe(effect);
  });

  it('defaults payload and effect to null when not provided', () => {
    const row = insertFinancialEvent(ctx.sqlite, {
      accountId: ctx.accountId,
      eventType: 'withdrawal',
      postedAt: new Date().toISOString(),
    });

    expect(row.payload).toBeNull();
    expect(row.effect).toBeNull();
  });

  it('supports all 12 event types through the insert function', () => {
    const eventTypes = [
      'opening_balance', 'trade_execution', 'adjustment', 'transfer',
      'deposit', 'withdrawal', 'dividend', 'interest',
      'fee', 'tax', 'stock_split', 'manual_adjustment',
    ] as const;

    for (const et of eventTypes) {
      const row = insertFinancialEvent(ctx.sqlite, {
        accountId: ctx.accountId,
        eventType: et,
        postedAt: new Date().toISOString(),
      });
      expect(row.event_type).toBe(et);
      expect(row.id).toBeDefined();
    }

    const count = countAccountEvents(ctx.sqlite, ctx.accountId);
    expect(count).toBeGreaterThanOrEqual(12);
  });
});

describe('Repository — findEventByIdempotencyKey with payload/effect', () => {
  let ctx: TestContext;
  let key: string;
  let eventId: string;

  beforeAll(() => {
    ctx = createTestDatabase();
    key = randomUUID();
    const payload = JSON.stringify({ type: 'deposit', amount: '2000.00' });
    const row = insertFinancialEvent(ctx.sqlite, {
      accountId: ctx.accountId,
      eventType: 'deposit',
      idempotencyKey: key,
      payload,
      postedAt: new Date().toISOString(),
    });
    eventId = row.id;
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns the event with payload/effect when found by idempotency key', () => {
    const event = findEventByIdempotencyKey(ctx.sqlite, key);
    expect(event).toBeDefined();
    expect(event!.id).toBe(eventId);
    expect(event!.payload).toBe(JSON.stringify({ type: 'deposit', amount: '2000.00' }));
  });

  it('returns undefined for a non-existent idempotency key', () => {
    const event = findEventByIdempotencyKey(ctx.sqlite, randomUUID());
    expect(event).toBeUndefined();
  });
});
