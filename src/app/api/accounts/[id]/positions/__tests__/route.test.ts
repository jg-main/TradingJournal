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
} from '@/db/accounting-repository';
import { listPositionsQuerySchema } from '@/lib/accounting/execution-contracts';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-positions-route.db';

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
});
