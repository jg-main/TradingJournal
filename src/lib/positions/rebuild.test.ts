/**
 * Tests for the FIFO position rebuild engine.
 *
 * Covers:
 * - Rebuild from empty (no executions → flat)
 * - Simple buy → rebuild: long position with one open lot
 * - Buy → partial sell → rebuild: reduced position, partial matches
 * - Buy → full sell → rebuild: flat position, complete matches
 * - Multiple instruments per account
 * - Rebuild determinism (identical input → identical output)
 * - Account isolation
 */

import { testDbPath } from '../testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rebuildPositions } from './rebuild';
import {
  findOrCreateInstrument,
  insertAccountingExecution,
  findAccountPosition,
  findFifoLotsByAccountInstrument,
} from '../../db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('rebuild');

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
  secondAccountId: string;
  instrumentId: string;
  secondInstrumentId: string;
}

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

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
        } catch (e) {
          console.warn(`  [test-db] Skipping statement in ${file}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }

  // Create test accounts
  const accountId = randomUUID();
  const secondAccountId = randomUUID();
  const now = new Date().toISOString();
  const insertAccount = sqlite.prepare(
    `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  insertAccount.run(accountId, 'Rebuild Test Account', 'Test Broker', 'USD', now, now);
  insertAccount.run(secondAccountId, 'Second Rebuild Account', 'Test Broker', 'USD', now, now);

  // Create instruments
  const aapl = findOrCreateInstrument(sqlite, 'AAPL');
  const msft = findOrCreateInstrument(sqlite, 'MSFT');

  return {
    sqlite,
    accountId,
    secondAccountId,
    instrumentId: aapl.id,
    secondInstrumentId: msft.id,
  };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try {
    unlinkSync(TEST_DB_PATH);
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  } catch {
    // Nothing to clean up
  }
}

// ── Helper: Insert an execution directly ────────────────────────────────

function insertExec(
  ctx: TestContext,
  overrides: {
    action: string;
    quantity: string;
    price: string;
    fees?: string;
    postedAt?: string;
    instrumentId?: string;
    accountId?: string;
  },
): { id: string } {
  const now = new Date().toISOString();
  const row = insertAccountingExecution(ctx.sqlite, {
    accountId: overrides.accountId ?? ctx.accountId,
    instrumentId: overrides.instrumentId ?? ctx.instrumentId,
    action: overrides.action,
    quantity: overrides.quantity,
    price: overrides.price,
    fees: overrides.fees ?? '0.00',
    postedAt: overrides.postedAt ?? now,
  });
  return { id: row.id };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('rebuildPositions', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns flat positions when no executions exist', () => {
    const result = rebuildPositions(ctx.sqlite, ctx.accountId);

    expect(result.executionCount).toBe(0);
    expect(result.lotCount).toBe(0);
    expect(result.matchCount).toBe(0);
    expect(result.positions.size).toBe(0);
    expect(result.openLots).toHaveLength(0);
    expect(result.allMatches).toHaveLength(0);
  });

  it('rebuilds a long position after a single buy', () => {
    const exec = insertExec(ctx, {
      action: 'buy',
      quantity: '100.00',
      price: '150.75',
      postedAt: '2026-07-15T10:00:00.000Z',
    });

    const result = rebuildPositions(ctx.sqlite, ctx.accountId, ctx.instrumentId);

    expect(result.executionCount).toBe(1);
    expect(result.lotCount).toBe(1); // One lot opened

    // Position should be long, 100 shares
    const key = `${ctx.accountId}:${ctx.instrumentId}`;
    const pos = result.positions.get(key);
    expect(pos).toBeDefined();
    expect(pos!.direction).toBe('long');
    expect(pos!.quantity).toBe('100.00');
    expect(pos!.averageCost).toBe('150.75');
    expect(pos!.totalCostBasis).toBe('15075.00');
    expect(pos!.realizedGrossPnl).toBe('0.00');
    expect(pos!.realizedFees).toBe('0.00');
    expect(pos!.realizedNetPnl).toBe('0.00');

    // One open lot
    expect(pos!.openLots).toHaveLength(1);
    expect(pos!.openLots[0].remainingQuantity).toBe('100.00');
    expect(pos!.openLots[0].originalQuantity).toBe('100.00');
    expect(pos!.openLots[0].entryPrice).toBe('150.75');

    // Verify database projection
    const dbPos = findAccountPosition(ctx.sqlite, ctx.accountId, ctx.instrumentId);
    expect(dbPos).toBeDefined();
    expect(dbPos!.direction).toBe('long');
    expect(dbPos!.quantity).toBe('100.00');

    // Verify lots in DB
    const dbLots = findFifoLotsByAccountInstrument(ctx.sqlite, ctx.accountId, ctx.instrumentId);
    expect(dbLots).toHaveLength(1);
    expect(dbLots[0].original_quantity).toBe('100.00');
    expect(dbLots[0].entry_price).toBe('150.75');

    // No matches
    expect(result.allMatches).toHaveLength(0);
  });

  it('rebuilds correctly after buy then partial sell', () => {
    // The buy was already inserted above. Now insert a partial sell.
    insertExec(ctx, {
      action: 'sell',
      quantity: '30.00',
      price: '160.00',
      postedAt: '2026-07-15T11:00:00.000Z',
    });

    const result = rebuildPositions(ctx.sqlite, ctx.accountId, ctx.instrumentId);

    expect(result.executionCount).toBe(2);
    expect(result.lotCount).toBe(1); // Only 1 lot was opened (not count of remaining)

    // Position should be long, 70 shares remaining
    const key = `${ctx.accountId}:${ctx.instrumentId}`;
    const pos = result.positions.get(key);
    expect(pos).toBeDefined();
    expect(pos!.direction).toBe('long');
    expect(pos!.quantity).toBe('70.00');
    // Average cost stays same for partial close
    expect(pos!.averageCost).toBe('150.75');

    // Realized P&L = (160 - 150.75) * 30 = 9.25 * 30 = 277.50
    expect(pos!.realizedGrossPnl).toBe('277.50');

    // One open lot with remaining quantity
    expect(pos!.openLots).toHaveLength(1);
    expect(pos!.openLots[0].remainingQuantity).toBe('70.00');
    expect(pos!.openLots[0].originalQuantity).toBe('100.00');

    // One match
    expect(result.allMatches).toHaveLength(1);
    expect(result.allMatches[0].matchQuantity).toBe('30.00');
    expect(result.allMatches[0].realizedGrossPnl).toBe('277.50');

    // Verify DB projection matches
    const dbPos = findAccountPosition(ctx.sqlite, ctx.accountId, ctx.instrumentId);
    expect(dbPos).toBeDefined();
    expect(dbPos!.quantity).toBe('70.00');
    expect(dbPos!.realized_gross_pnl).toBe('277.50');
  });

  it('rebuilds correctly after full close (flat position)', () => {
    // Sell the remaining 70 shares
    insertExec(ctx, {
      action: 'sell',
      quantity: '70.00',
      price: '165.00',
      postedAt: '2026-07-15T12:00:00.000Z',
    });

    const result = rebuildPositions(ctx.sqlite, ctx.accountId, ctx.instrumentId);

    expect(result.executionCount).toBe(3);
    expect(result.lotCount).toBe(1); // Only 1 lot was ever opened

    // Position should be flat
    const key = `${ctx.accountId}:${ctx.instrumentId}`;
    const pos = result.positions.get(key);
    expect(pos).toBeDefined();
    expect(pos!.direction).toBeNull();
    expect(pos!.quantity).toBe('0.00');
    expect(pos!.averageCost).toBe('0.00');
    expect(pos!.totalCostBasis).toBe('0.00');
    expect(pos!.openLots).toHaveLength(0);

    // Total realized P&L = sell1 (277.50) + sell2 ((165 - 150.75) * 70 = 14.25 * 70 = 997.50)
    // Total = 277.50 + 997.50 = 1275.00
    expect(pos!.realizedGrossPnl).toBe('1275.00');

    // Two matches now
    expect(result.allMatches).toHaveLength(2);

    // Verify DB position is flat
    const dbPos = findAccountPosition(ctx.sqlite, ctx.accountId, ctx.instrumentId);
    expect(dbPos).toBeDefined();
    expect(dbPos!.direction).toBeNull();
    expect(dbPos!.quantity).toBe('0.00');
    expect(dbPos!.realized_gross_pnl).toBe('1275.00');
  });

  it('handles multiple instruments per account independently', () => {
    // Insert a MSFT buy (using second instrument)
    insertExec(ctx, {
      action: 'buy',
      quantity: '50.00',
      price: '400.00',
      postedAt: '2026-07-15T13:00:00.000Z',
      instrumentId: ctx.secondInstrumentId,
    });

    const result = rebuildPositions(ctx.sqlite, ctx.accountId);

    // Should have both AAPL and MSFT positions
    expect(result.positions.size).toBe(2);

    // AAPL should be flat
    const aaplKey = `${ctx.accountId}:${ctx.instrumentId}`;
    const aaplPos = result.positions.get(aaplKey);
    expect(aaplPos).toBeDefined();
    expect(aaplPos!.direction).toBeNull();
    expect(aaplPos!.quantity).toBe('0.00');

    // MSFT should be long
    const msftKey = `${ctx.accountId}:${ctx.secondInstrumentId}`;
    const msftPos = result.positions.get(msftKey);
    expect(msftPos).toBeDefined();
    expect(msftPos!.direction).toBe('long');
    expect(msftPos!.quantity).toBe('50.00');
    expect(msftPos!.averageCost).toBe('400.00');
  });

  it('produces deterministic output for identical input', () => {
    // Run rebuild twice with same data — should produce same result
    const result1 = rebuildPositions(ctx.sqlite, ctx.accountId);
    const result2 = rebuildPositions(ctx.sqlite, ctx.accountId);

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    expect(result1.executionCount).toBe(result2.executionCount);
    expect(result1.lotCount).toBe(result2.lotCount);
    expect(result1.matchCount).toBe(result2.matchCount);

    // Same P&L
    for (const [key, pos] of result1.positions) {
      const pos2 = result2.positions.get(key);
      expect(pos2).toBeDefined();
      expect(pos!.quantity).toBe(pos2!.quantity);
      expect(pos!.direction).toBe(pos2!.direction);
      expect(pos!.realizedGrossPnl).toBe(pos2!.realizedGrossPnl);
    }
  });

  it('maintains account isolation', () => {
    // Insert executions for second account
    insertExec(ctx, {
      action: 'buy',
      quantity: '25.00',
      price: '200.00',
      postedAt: '2026-07-15T14:00:00.000Z',
      accountId: ctx.secondAccountId,
    });

    // Rebuild only second account
    const result = rebuildPositions(ctx.sqlite, ctx.secondAccountId);

    expect(result.positions.size).toBeGreaterThanOrEqual(1);

    // The second account's position should exist
    // We need the instrument ID for AAPL that's associated with secondAccount's executions
    // Since we used ctx.instrumentId (AAPL's instrument) for the second account,
    // it should be in the result
    const key2 = `${ctx.secondAccountId}:${ctx.instrumentId}`;
    const pos2 = result.positions.get(key2);
    expect(pos2).toBeDefined();
    expect(pos2!.quantity).toBe('25.00');
    expect(pos2!.direction).toBe('long');

    // First account's position should NOT be in second account's result
    const key1 = `${ctx.accountId}:${ctx.instrumentId}`;
    expect(result.positions.has(key1)).toBe(false);
  });

  it('rebuilds correctly a sell_short then buy_to_cover sequence (short FIFO)', () => {
    // Create a new instrument for short test
    const tsla = findOrCreateInstrument(ctx.sqlite, 'TSLA');
    const tslaId = tsla.id;

    // Sell short 200 shares
    insertExec(ctx, {
      action: 'sell_short',
      quantity: '200.00',
      price: '75.50',
      postedAt: '2026-07-15T15:00:00.000Z',
      instrumentId: tslaId,
    });

    // Partial cover: buy_to_cover 50 shares
    insertExec(ctx, {
      action: 'buy_to_cover',
      quantity: '50.00',
      price: '70.00',
      postedAt: '2026-07-15T16:00:00.000Z',
      instrumentId: tslaId,
    });

    // Full cover: buy_to_cover 150 shares
    insertExec(ctx, {
      action: 'buy_to_cover',
      quantity: '150.00',
      price: '78.00',
      postedAt: '2026-07-15T17:00:00.000Z',
      instrumentId: tslaId,
    });

    const result = rebuildPositions(ctx.sqlite, ctx.accountId, tslaId);

    expect(result.executionCount).toBe(3);
    expect(result.lotCount).toBe(1); // One lot ever opened

    // Position should be flat (all covered)
    const key = `${ctx.accountId}:${tslaId}`;
    const pos = result.positions.get(key);
    expect(pos).toBeDefined();
    expect(pos!.direction).toBeNull();
    expect(pos!.quantity).toBe('0.00');

    // Short P&L: 
    // Match 1: (75.50 - 70.00) * 50 = 5.50 * 50 = 275.00 (profit)
    // Match 2: (75.50 - 78.00) * 150 = -2.50 * 150 = -375.00 (loss)
    // Total = 275.00 - 375.00 = -100.00
    expect(pos!.realizedGrossPnl).toBe('-100.00');

    // Two matches
    expect(result.allMatches).toHaveLength(2);
  });
});
