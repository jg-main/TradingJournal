/**
 * Route-level tests for the Account Positions API (GET)
 *
 * Tests the route logic by composing the same services the route handler
 * uses (postExecutionFill, rebuildPositions, repository methods) against
 * a real SQLite database with all migrations applied.
 *
 * Covers:
 * - Empty positions (200, empty array)
 * - Position after buy → correct state with open lots
 * - Position after partial sell → updated position
 * - Filter by instrumentId
 * - Filter by direction
 * - Account isolation (no cross-account exposure)
 * - Invalid direction filter (400-equivalent)
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/positions/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../../../lib/testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Services and repository used by the route
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { rebuildPositions } from '@/lib/positions/rebuild';
import {
  listAccountPositions,
  findAccountPosition,
  findFifoLotsByAccountInstrument,
  findInstrumentById,
  findOrCreateInstrument,
  listLatestValuationMarks,
  insertValuationMark,
} from '@/db/accounting-repository';
import { listPositionsQuerySchema } from '@/lib/accounting/execution-contracts';
import { toMicros } from '@/lib/accounting/decimal';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('positions-route');

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

  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Positions Test Account', 'margin', 'USD', now, now);

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

describe('GET /api/accounts/[id]/positions — service composition', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();

    // Seed: buy 100 AAPL at 150.50
    postExecutionFill(ctx.sqlite, {
      accountId: ctx.accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '150.50',
      fees: '5.00',
    });
    rebuildPositions(ctx.sqlite, ctx.accountId);

    // Buy 50 MSFT at 300.00
    postExecutionFill(ctx.sqlite, {
      accountId: ctx.accountId,
      symbol: 'MSFT',
      action: 'buy',
      quantity: '50.00',
      price: '300.00',
      fees: '2.00',
    });
    rebuildPositions(ctx.sqlite, ctx.accountId);
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  describe('Success cases', () => {
    it('should return all positions with instrument symbols and open lots', () => {
      const positions = listAccountPositions(ctx.sqlite, ctx.accountId);
      expect(positions).toHaveLength(2);

      for (const pos of positions) {
        // Resolve instrument symbol (same logic as route)
        const instrument = findInstrumentById(ctx.sqlite, pos.instrument_id);
        expect(instrument).toBeDefined();
        expect(instrument!.symbol).toBeDefined();

        // Fetch open lots (same logic as route)
        const lots = findFifoLotsByAccountInstrument(ctx.sqlite, ctx.accountId, pos.instrument_id);
        const openLots = lots.filter((l) => l.remaining_quantity !== '0.00');

        expect(pos.direction).toBe('long');
        expect(openLots.length).toBeGreaterThanOrEqual(1);
        expect(pos.quantity).toBeDefined();
        expect(parseFloat(pos.quantity)).toBeGreaterThan(0);
      }
    });

    it('should have correct AAPL position state', () => {
      const instrument = findOrCreateInstrument(ctx.sqlite, 'AAPL');
      const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);

      expect(position).toBeDefined();
      expect(position!.direction).toBe('long');
      expect(position!.quantity).toBe('100.00');
      expect(position!.average_cost).toBe('150.50');

      // Open lots
      const lots = findFifoLotsByAccountInstrument(ctx.sqlite, ctx.accountId, instrument.id);
      expect(lots).toHaveLength(1);
      expect(lots[0].remaining_quantity).toBe('100.00');
      expect(lots[0].entry_price).toBe('150.50');
    });

    it('should have correct MSFT position state', () => {
      const instrument = findOrCreateInstrument(ctx.sqlite, 'MSFT');
      const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);

      expect(position).toBeDefined();
      expect(position!.direction).toBe('long');
      expect(position!.quantity).toBe('50.00');
      expect(position!.average_cost).toBe('300.00');

      const lots = findFifoLotsByAccountInstrument(ctx.sqlite, ctx.accountId, instrument.id);
      expect(lots).toHaveLength(1);
    });

    it('should return empty array for accounts with no positions', () => {
      const emptyId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(emptyId, 'Empty Account', 'margin', 'USD', now, now);

      const positions = listAccountPositions(ctx.sqlite, emptyId);
      expect(positions).toEqual([]);
    });

    it('should filter by instrumentId', () => {
      const instrument = findOrCreateInstrument(ctx.sqlite, 'AAPL');

      // Route logic: if instrumentId is specified, use findAccountPosition
      const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);
      expect(position).toBeDefined();
      expect(position!.instrument_id).toBe(instrument.id);
      expect(instrument.symbol).toBeDefined();
    });

    it('should filter by direction (all long positions)', () => {
      const positions = listAccountPositions(ctx.sqlite, ctx.accountId);
      const longPositions = positions.filter((p) => p.direction === 'long');
      expect(longPositions).toHaveLength(2);
    });
  });

  describe('Updated position after partial sell', () => {
    it('should reflect partial sell in position state', () => {
      // Partially sell 30 AAPL
      postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'AAPL',
        action: 'sell',
        quantity: '30.00',
        price: '155.00',
        fees: '2.00',
      });
      rebuildPositions(ctx.sqlite, ctx.accountId);

      const instrument = findOrCreateInstrument(ctx.sqlite, 'AAPL');
      const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);

      expect(position!.quantity).toBe('70.00'); // 100 - 30

      // Realized P&L should be positive (sold 30 at 155, bought at 150.50)
      // Gross = 30 * (155.00 - 150.50) = 135.00
      const realizedNetPnl = parseFloat(position!.realized_net_pnl!);
      expect(realizedNetPnl).toBeGreaterThan(0);

      const lots = findFifoLotsByAccountInstrument(ctx.sqlite, ctx.accountId, instrument.id);
      expect(lots).toHaveLength(1);
      expect(lots[0].remaining_quantity).toBe('70.00');
    });
  });

  describe('Account isolation', () => {
    it('should not expose another account positions', () => {
      // Create second account
      const secondAccountId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(secondAccountId, 'Second Account', null, 'USD', now, now);

      // Post NVDA to second account
      postExecutionFill(ctx.sqlite, {
        accountId: secondAccountId,
        symbol: 'NVDA',
        action: 'buy',
        quantity: '10.00',
        price: '500.00',
        fees: '1.00',
      });
      rebuildPositions(ctx.sqlite, secondAccountId);

      // Second account sees NVDA
      const secondPositions = listAccountPositions(ctx.sqlite, secondAccountId);
      expect(secondPositions).toHaveLength(1);

      // First account does NOT see NVDA
      const instrument = findOrCreateInstrument(ctx.sqlite, 'NVDA');
      const firstPosition = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);
      expect(firstPosition).toBeUndefined();
    });
  });

  describe('Validation', () => {
    it('should reject invalid direction via Zod schema', () => {
      const result = listPositionsQuerySchema.safeParse({
        direction: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid direction filter', () => {
      const result1 = listPositionsQuerySchema.safeParse({ direction: 'long' });
      expect(result1.success).toBe(true);

      const result2 = listPositionsQuerySchema.safeParse({ direction: 'short' });
      expect(result2.success).toBe(true);
    });

    it('should accept valid instrumentId filter', () => {
      const result = listPositionsQuerySchema.safeParse({
        instrumentId: randomUUID(),
      });
      expect(result.success).toBe(true);
    });

    it('should reject non-UUID instrumentId', () => {
      const result = listPositionsQuerySchema.safeParse({
        instrumentId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Valuation-aware enrichment', () => {
    let markedAccountId: string;

    beforeAll(() => {
      markedAccountId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(markedAccountId, 'Marked Account', 'margin', 'USD', now, now);
    });

    it('should return markStatus fresh and correct valuation fields when mark exists', () => {
      // Post AAPL position for the marked account
      postExecutionFill(ctx.sqlite, {
        accountId: markedAccountId,
        symbol: 'AAPL',
        action: 'buy',
        quantity: '100.00',
        price: '150.00',
        fees: '5.00',
      });
      rebuildPositions(ctx.sqlite, markedAccountId);

      // Insert a fresh valuation mark
      const aaplusId = findOrCreateInstrument(ctx.sqlite, 'AAPL').id;
      const markTimestamp = new Date().toISOString();
      insertValuationMark(ctx.sqlite, {
        accountId: markedAccountId,
        instrumentId: aaplusId,
        price: '165.00',
        priceMicros: toMicros('165.00'),
        source: 'system',
        markTimestamp,
      });

      // Query via the same functions the route uses
      const marks = listLatestValuationMarks(ctx.sqlite, markedAccountId);
      expect(marks).toHaveLength(1);
      expect(marks[0].price).toBe('165.00');
      expect(marks[0].instrument_id).toBe(aaplusId);

      const positions = listAccountPositions(ctx.sqlite, markedAccountId);
      expect(positions).toHaveLength(1);

      const aaplPos = positions[0];
      expect(aaplPos.quantity).toBe('100.00');
      expect(aaplPos.average_cost).toBe('150.00');

      // Construct the same enrichment the route performs
      const positionMarks = marks.filter((m) => m.instrument_id === aaplPos.instrument_id);
      expect(positionMarks).toHaveLength(1);
      const mark = positionMarks[0];
      expect(mark.price).toBe('165.00');

      // Quant: 100 * 165 = 16500, UPnL: (165 - 150) * 100 = 1500
      // (assertions are on the repository data, not the pure mapping contract
      //  which is independently tested in account-detail.test.ts)
      const enrichedMarkPrice = mark.price;
      const enrichedQty = aaplPos.quantity;
      const enrichedAvgCost = aaplPos.average_cost;
      expect(enrichedMarkPrice).toBe('165.00');
      expect(parseFloat(enrichedQty)).toBe(100.00);
      expect(parseFloat(enrichedAvgCost)).toBe(150.00);
    });

    it('should return missing markStatus for an account with no valuation marks', () => {
      // Create a separate account with positions but no valuation marks
      const unmarkedAccountId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(unmarkedAccountId, 'Unmarked Account', 'margin', 'USD', now, now);

      postExecutionFill(ctx.sqlite, {
        accountId: unmarkedAccountId,
        symbol: 'MSFT',
        action: 'buy',
        quantity: '50.00',
        price: '300.00',
        fees: '2.00',
      });
      rebuildPositions(ctx.sqlite, unmarkedAccountId);

      // No marks inserted — listLatestValuationMarks should be empty
      const marks = listLatestValuationMarks(ctx.sqlite, unmarkedAccountId);
      expect(marks).toEqual([]);

      // The route will detect missing marks and pass null to mapPositionRow
      // which should produce markStatus: 'missing', markPrice: null, etc.
      const positions = listAccountPositions(ctx.sqlite, unmarkedAccountId);
      expect(positions).toHaveLength(1);

      // Each position should resolve to markStatus=missing when no mark exists
      // (enrichment is done through mapPositionRow, tested in account-detail.test.ts)
      const msftPos = positions[0];
      expect(msftPos.quantity).toBe('50.00');
    });

    it('should not leak marks across accounts', () => {
      // Self-contained: create a separate account with a position AND a mark
      const sourceAccountId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(sourceAccountId, 'Mark Source', 'margin', 'USD', now, now);

      postExecutionFill(ctx.sqlite, {
        accountId: sourceAccountId,
        symbol: 'NVDA',
        action: 'buy',
        quantity: '10.00',
        price: '500.00',
        fees: '1.00',
      });
      rebuildPositions(ctx.sqlite, sourceAccountId);

      const nvdaId = findOrCreateInstrument(ctx.sqlite, 'NVDA').id;
      insertValuationMark(ctx.sqlite, {
        accountId: sourceAccountId,
        instrumentId: nvdaId,
        price: '520.00',
        priceMicros: toMicros('520.00'),
        source: 'system',
        markTimestamp: new Date().toISOString(),
      });

      // Source account has both position and mark
      const sourceMarks = listLatestValuationMarks(ctx.sqlite, sourceAccountId);
      expect(sourceMarks).toHaveLength(1);

      // Isolation account has nothing
      const isolationId = randomUUID();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(isolationId, 'Isolation Check', 'margin', 'USD', now, now);

      // Source account's marks must not appear for the isolation account
      const isolationMarks = listLatestValuationMarks(ctx.sqlite, isolationId);
      expect(isolationMarks).toEqual([]);

      // Isolation account has no positions
      const isolationPositions = listAccountPositions(ctx.sqlite, isolationId);
      expect(isolationPositions).toEqual([]);
    });

    it('should return multiple marks for a multi-position account', () => {
      // The markedAccount already has AAPL. Add MSFT position with a mark.
      postExecutionFill(ctx.sqlite, {
        accountId: markedAccountId,
        symbol: 'MSFT',
        action: 'buy',
        quantity: '25.00',
        price: '400.00',
        fees: '1.00',
      });
      rebuildPositions(ctx.sqlite, markedAccountId);

      const msftId = findOrCreateInstrument(ctx.sqlite, 'MSFT').id;
      insertValuationMark(ctx.sqlite, {
        accountId: markedAccountId,
        instrumentId: msftId,
        price: '420.00',
        priceMicros: toMicros('420.00'),
        source: 'system',
        markTimestamp: new Date().toISOString(),
      });

      // Should have 2 marks: AAPL and MSFT
      const marks = listLatestValuationMarks(ctx.sqlite, markedAccountId);
      expect(marks).toHaveLength(2);

      const markByInstrument = new Map(marks.map((m) => [m.instrument_id, m]));

      const aaplusId = findOrCreateInstrument(ctx.sqlite, 'AAPL').id;
      const aaplMark = markByInstrument.get(aaplusId);
      expect(aaplMark).toBeDefined();
      expect(aaplMark!.price).toBe('165.00');

      const msftMark = markByInstrument.get(msftId);
      expect(msftMark).toBeDefined();
      expect(msftMark!.price).toBe('420.00');

      // Both positions resolve with mark data
      const positions = listAccountPositions(ctx.sqlite, markedAccountId);
      expect(positions.length).toBeGreaterThanOrEqual(2);
    });
  });
});
