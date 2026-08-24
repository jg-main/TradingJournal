/**
 * Route-level tests for the Account Valuation Mark API (POST + GET)
 *
 * Tests the route logic by composing the same services the route handler
 * uses (insertValidatedValuationMark, repository methods) against a real
 * SQLite database with all migrations applied.
 *
 * Covers:
 * - Successful mark submission (by symbol and instrumentId)
 * - Mark listing (empty, with marks, pagination)
 * - Duplicate idempotency key (200 idempotent success)
 * - Missing account (404-equivalent)
 * - Zod validation failures (400-equivalent)
 * - Invalid price handling
 * - Instrument resolution
 * - Account isolation
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/valuations/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../../../lib/testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Services used by the route
import {
  insertValidatedValuationMark,
  ValuationMarkError,
} from '@/lib/performance/valuation-repository';
import {
  postValuationMarkSchema,
  listValuationMarksQuerySchema,
} from '@/lib/performance/api-contracts';
import {
  findInstrumentById,
  findInstrumentBySymbol,
  findOrCreateInstrument,
  listAccountValuationMarks,
  countAccountValuationMarks,
} from '@/db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('valuations-route');

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
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
          // skip failures (views, triggers that depend on later tables)
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

  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Test Valuation Account', null, 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(ctx: TestContext): void {
  try {
    ctx.sqlite.close();
  } catch {
    // ignore
  }
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/accounts/[id]/valuations — service composition', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  describe('Success cases', () => {
    it('should insert a valuation mark by symbol', () => {
      const timestamp = new Date().toISOString();

      const result = insertValidatedValuationMark(ctx.sqlite, {
        accountId: ctx.accountId,
        instrumentSymbol: 'AAPL',
        price: '150.50',
        source: 'user',
        markTimestamp: timestamp,
      });

      expect(result.inserted).toBe(true);
      expect(result.mark.instrumentId).toBeDefined();
      expect(result.mark.price).toBe('150.50');
      expect(result.mark.source).toBe('user');
      expect(result.mark.markTimestamp).toBe(timestamp);

      // Verify the instrument was created
      const instrument = findInstrumentBySymbol(ctx.sqlite, 'AAPL');
      expect(instrument).toBeDefined();
      expect(instrument!.symbol).toBe('AAPL');
    });

    it('should insert a valuation mark by instrumentId (existing instrument)', () => {
      const instrument = findOrCreateInstrument(ctx.sqlite, 'MSFT');
      const timestamp = new Date().toISOString();

      const result = insertValidatedValuationMark(ctx.sqlite, {
        accountId: ctx.accountId,
        instrumentId: instrument.id,
        price: '250.00',
        source: 'market_data',
        markTimestamp: timestamp,
      });

      expect(result.inserted).toBe(true);
      expect(result.mark.instrumentId).toBe(instrument.id);
      expect(result.mark.price).toBe('250.00');
      expect(result.mark.source).toBe('market_data');
    });

    it('should accept numeric price values', () => {
      const timestamp = new Date().toISOString();

      const result = insertValidatedValuationMark(ctx.sqlite, {
        accountId: ctx.accountId,
        instrumentSymbol: 'GOOGL',
        price: 180.75,
        source: 'user',
        markTimestamp: timestamp,
      });

      expect(result.inserted).toBe(true);
      expect(result.mark.price).toBe('180.75');
    });

    it('should handle idempotency key — returns inserted: false on duplicate', () => {
      const idempotencyKey = randomUUID();
      const timestamp = new Date().toISOString();

      // First call inserts
      const first = insertValidatedValuationMark(ctx.sqlite, {
        accountId: ctx.accountId,
        instrumentSymbol: 'TSLA',
        price: '300.00',
        source: 'user',
        markTimestamp: timestamp,
        idempotencyKey,
      });
      expect(first.inserted).toBe(true);

      // Second call with same key returns existing without inserting
      const second = insertValidatedValuationMark(ctx.sqlite, {
        accountId: ctx.accountId,
        instrumentSymbol: 'TSLA',
        price: '300.00',
        source: 'user',
        markTimestamp: timestamp,
        idempotencyKey,
      });
      expect(second.inserted).toBe(false);
      // Should have the same price
      expect(second.mark.price).toBe('300.00');
    });

    it('should accept all valid mark sources', () => {
      const now = new Date().toISOString();
      for (const source of ['user', 'market_data', 'import', 'system'] as const) {
        const result = insertValidatedValuationMark(ctx.sqlite, {
          accountId: ctx.accountId,
          instrumentSymbol: `SRC${source.toUpperCase()}`,
          price: '100.00',
          source,
          markTimestamp: now,
        });
        expect(result.inserted).toBe(true);
        expect(result.mark.source).toBe(source);
      }
    });

    it('should support multiple marks for the same instrument at different timestamps', () => {
      const t1 = new Date('2026-01-01T10:00:00Z').toISOString();
      const t2 = new Date('2026-01-01T12:00:00Z').toISOString();

      const r1 = insertValidatedValuationMark(ctx.sqlite, {
        accountId: ctx.accountId,
        instrumentSymbol: 'NVDA',
        price: '200.00',
        source: 'user',
        markTimestamp: t1,
      });
      expect(r1.inserted).toBe(true);

      const r2 = insertValidatedValuationMark(ctx.sqlite, {
        accountId: ctx.accountId,
        instrumentSymbol: 'NVDA',
        price: '210.00',
        source: 'market_data',
        markTimestamp: t2,
      });
      expect(r2.inserted).toBe(true);

      // Both marks should be persisted
      const marks = listAccountValuationMarks(ctx.sqlite, ctx.accountId, {
        instrumentId: r1.mark.instrumentId,
      });
      expect(marks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Validation and error cases', () => {
    it('should throw for missing account', () => {
      const missingId = randomUUID();
      expect(() => {
        insertValidatedValuationMark(ctx.sqlite, {
          accountId: missingId,
          instrumentSymbol: 'AAPL',
          price: '100.00',
          source: 'user',
          markTimestamp: new Date().toISOString(),
        });
      }).toThrow(ValuationMarkError);
    });

    it('should throw for invalid price format', () => {
      expect(() => {
        insertValidatedValuationMark(ctx.sqlite, {
          accountId: ctx.accountId,
          instrumentSymbol: 'AAPL',
          price: 'invalid',
          source: 'user',
          markTimestamp: new Date().toISOString(),
        });
      }).toThrow(ValuationMarkError);
    });

    it('should throw for invalid mark source', () => {
      expect(() => {
        insertValidatedValuationMark(ctx.sqlite, {
          accountId: ctx.accountId,
          instrumentSymbol: 'AAPL',
          price: '100.00',
          source: 'invalid_source',
          markTimestamp: new Date().toISOString(),
        });
      }).toThrow(ValuationMarkError);
    });

    it('should throw for invalid mark timestamp', () => {
      expect(() => {
        insertValidatedValuationMark(ctx.sqlite, {
          accountId: ctx.accountId,
          instrumentSymbol: 'AAPL',
          price: '100.00',
          source: 'user',
          markTimestamp: 'not-a-date',
        });
      }).toThrow(ValuationMarkError);
    });

    it('should reject empty symbol via Zod schema', () => {
      const result = postValuationMarkSchema.safeParse({
        symbol: '',
        price: '100.00',
        source: 'user',
        markTimestamp: new Date().toISOString(),
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid decimal price via Zod schema', () => {
      const result = postValuationMarkSchema.safeParse({
        symbol: 'AAPL',
        price: 'not-a-number',
        source: 'user',
        markTimestamp: new Date().toISOString(),
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing both instrumentId and symbol via Zod schema', () => {
      const result = postValuationMarkSchema.safeParse({
        price: '100.00',
        source: 'user',
        markTimestamp: new Date().toISOString(),
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid source via Zod schema', () => {
      const result = postValuationMarkSchema.safeParse({
        symbol: 'AAPL',
        price: '100.00',
        source: 'invalid_source',
        markTimestamp: new Date().toISOString(),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Account isolation', () => {
    it('should isolate marks by account', () => {
      const secondAccountId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(secondAccountId, 'Second Account', null, 'USD', now, now);

      // Insert mark in second account
      const result = insertValidatedValuationMark(ctx.sqlite, {
        accountId: secondAccountId,
        instrumentSymbol: 'AMD',
        price: '100.00',
        source: 'user',
        markTimestamp: now,
      });
      expect(result.inserted).toBe(true);

      // First account should NOT have AMD marks
      const firstMarks = listAccountValuationMarks(ctx.sqlite, ctx.accountId, {
        instrumentId: result.mark.instrumentId,
      });
      expect(firstMarks).toHaveLength(0);

      // Second account should have it
      const secondMarks = listAccountValuationMarks(ctx.sqlite, secondAccountId, {
        instrumentId: result.mark.instrumentId,
      });
      expect(secondMarks).toHaveLength(1);
    });
  });
});

describe('GET /api/accounts/[id]/valuations — service composition', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();

    // Insert some marks for listing tests
    const now = new Date().toISOString();
    insertValidatedValuationMark(ctx.sqlite, {
      accountId: ctx.accountId,
      instrumentSymbol: 'AAPL',
      price: '150.50',
      source: 'user',
      markTimestamp: now,
    });
    insertValidatedValuationMark(ctx.sqlite, {
      accountId: ctx.accountId,
      instrumentSymbol: 'MSFT',
      price: '250.00',
      source: 'market_data',
      markTimestamp: now,
    });
    insertValidatedValuationMark(ctx.sqlite, {
      accountId: ctx.accountId,
      instrumentSymbol: 'GOOGL',
      price: '180.75',
      source: 'user',
      markTimestamp: now,
    });
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  it('should list all marks for an account', () => {
    const marks = listAccountValuationMarks(ctx.sqlite, ctx.accountId);
    expect(marks.length).toBeGreaterThanOrEqual(3);
  });

  it('should return paginated results', () => {
    const page1 = listAccountValuationMarks(ctx.sqlite, ctx.accountId, { limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = listAccountValuationMarks(ctx.sqlite, ctx.accountId, { limit: 2, offset: 2 });
    expect(page2.length).toBeGreaterThanOrEqual(1);
  });

  it('should count marks', () => {
    const total = countAccountValuationMarks(ctx.sqlite, ctx.accountId);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it('should filter marks by instrumentId', () => {
    const instrument = findOrCreateInstrument(ctx.sqlite, 'AAPL');
    const filtered = listAccountValuationMarks(ctx.sqlite, ctx.accountId, {
      instrumentId: instrument.id,
    });

    expect(filtered.length).toBeGreaterThanOrEqual(1);
    for (const mark of filtered) {
      expect(mark.instrument_id).toBe(instrument.id);
    }
  });

  it('should return empty list for accounts with no marks', () => {
    const emptyId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(emptyId, 'Empty Marks Account', null, 'USD', now, now);

    const marks = listAccountValuationMarks(ctx.sqlite, emptyId);
    expect(marks).toEqual([]);

    const count = countAccountValuationMarks(ctx.sqlite, emptyId);
    expect(count).toBe(0);
  });

  it('should resolve instrument symbols for marks', () => {
    const marks = listAccountValuationMarks(ctx.sqlite, ctx.accountId);
    for (const mark of marks) {
      const instrument = findInstrumentById(ctx.sqlite, mark.instrument_id);
      expect(instrument).toBeDefined();
      expect(instrument!.symbol).toBeDefined();
    }
  });

  it('should validate list query parameters via Zod schema', () => {
    // Valid params
    const valid = listValuationMarksQuerySchema.safeParse({ limit: 10, offset: 0 });
    expect(valid.success).toBe(true);

    // Invalid limit
    const invalidLimit = listValuationMarksQuerySchema.safeParse({ limit: 0 });
    expect(invalidLimit.success).toBe(false);

    // Large limit is capped by schema
    const largeLimit = listValuationMarksQuerySchema.safeParse({ limit: 200 });
    expect(largeLimit.success).toBe(false);
  });
});

describe('Instrument resolution via Zod schema', () => {
  it('should reject lowercase symbol via Zod validation', () => {
    const result = postValuationMarkSchema.safeParse({
      symbol: 'aapl',
      price: '100.00',
      source: 'user',
      markTimestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid uppercase symbol', () => {
    const result = postValuationMarkSchema.safeParse({
      symbol: 'SPY',
      price: '450.00',
      source: 'market_data',
      markTimestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('should reject overlong symbol (>20 chars)', () => {
    const result = postValuationMarkSchema.safeParse({
      symbol: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      price: '100.00',
      source: 'user',
      markTimestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
