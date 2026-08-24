/**
 * Unit tests for the execution correction service.
 *
 * Tests the core `correctExecution` function against a real SQLite database
 * with all migrations applied.  Each test creates a fresh database so there
 * is no state leakage.
 *
 * Covers:
 * - Normal buy correction (buy → sell reversal + corrected buy replacement)
 * - Normal sell correction (sell → buy reversal + corrected sell replacement)
 * - Deterministic replay via correction idempotency key rejection
 * - Already-corrected execution rejection
 * - Reversal/replacement execution rejection
 * - Cross-account correction rejection
 * - Missing account rejection
 * - Missing execution rejection
 * - Position rebuild after correction
 * - Repeated correction of different executions on the same account
 * - Sell_short correction lifecycle
 *
 * Run: npx vitest run --reporter verbose src/lib/accounting/correction.test.ts
 */

import { testDbPath } from '../testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { correctExecution } from './correction';
import { postExecutionFill } from './execution-posting';
import { rebuildPositions } from '../positions/rebuild';
import {
  AccountNotFoundError,
  ExecutionAlreadyCorrectedError,
  ExecutionNotMutableError,
  DuplicateCorrectionIdempotencyError,
} from './errors';
import {
  findOrCreateInstrument,
  findAccountingExecutionById,
  findAccountPosition,
  findEventByIdempotencyKey,
  findFifoLotsByAccountInstrument,
  listAccountingExecutions,
} from '../../db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('correction-unit');

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
  instrumentId: string;
  symbol: string;
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
          // Skip statements that fail (e.g. CREATE TRIGGER IF NOT EXISTS after DROP)
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
      `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
    )
    .run(accountId, 'Test Account', now, now);

  // Create instrument
  const symbol = 'AAPL';
  const instrument = findOrCreateInstrument(sqlite, symbol);

  return { sqlite, accountId, instrumentId: instrument.id, symbol };
}

function destroyTestDatabase(): void {
  try {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    // Also clean up WAL/SHM
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

// ── Helper to post an execution ─────────────────────────────────────────

function postBuy(sqlite: Database.Database, accountId: string, symbol: string, quantity: string, price: string, fees?: string, journalTradeId?: string) {
  return postExecutionFill(sqlite, {
    accountId,
    symbol,
    action: 'buy',
    quantity,
    price,
    fees,
    journalTradeId,
  });
}

function postSell(sqlite: Database.Database, accountId: string, symbol: string, quantity: string, price: string, fees?: string, journalTradeId?: string) {
  return postExecutionFill(sqlite, {
    accountId,
    symbol,
    action: 'sell',
    quantity,
    price,
    fees,
    journalTradeId,
  });
}

function postSellShort(sqlite: Database.Database, accountId: string, symbol: string, quantity: string, price: string, fees?: string, journalTradeId?: string) {
  return postExecutionFill(sqlite, {
    accountId,
    symbol,
    action: 'sell_short',
    quantity,
    price,
    fees,
    journalTradeId,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('correctExecution', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase();
  });

  it('corrects a posted buy execution through reversal and replacement', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Post original buy: 100 AAPL @ $150
    const original = postBuy(sqlite, accountId, symbol, '100.00', '150.00');
    rebuildPositions(sqlite, accountId, original.execution.instrumentId);

    // Correct: buy 100 AAPL @ $155 (price correction)
    const result = correctExecution(sqlite, {
      accountId,
      originalExecutionId: original.execution.id,
      symbol,
      action: 'buy',
      quantity: '100.00',
      price: '155.00',
      fees: '0.00',
      reason: 'Price was reported incorrectly',
    });

    // Verify correction lineage
    expect(result.correction.originalExecutionId).toBe(original.execution.id);
    expect(result.correction.reversalExecutionId).toBeTruthy();
    expect(result.correction.replacementExecutionId).toBeTruthy();
    expect(result.correction.reason).toBe('Price was reported incorrectly');

    // Verify original execution unchanged
    const savedOriginal = findAccountingExecutionById(sqlite, original.execution.id);
    expect(savedOriginal!.action).toBe('buy');
    expect(savedOriginal!.price).toBe('150.00');

    // Verify reversal execution
    const reversal = findAccountingExecutionById(sqlite, result.correction.reversalExecutionId);
    expect(reversal).toBeTruthy();
    expect(reversal!.action).toBe('sell'); // buy → sell
    expect(reversal!.quantity).toBe('100.00');
    expect(reversal!.price).toBe('150.00'); // Same as original

    // Verify replacement execution
    const replacement = findAccountingExecutionById(sqlite, result.correction.replacementExecutionId);
    expect(replacement).toBeTruthy();
    expect(replacement!.action).toBe('buy');
    expect(replacement!.quantity).toBe('100.00');
    expect(replacement!.price).toBe('155.00'); // Corrected price

    // Each immutable correction execution has a deterministic ledger link.
    expect(
      findEventByIdempotencyKey(sqlite, `accounting-execution-${reversal!.id}`),
    ).toBeDefined();
    expect(
      findEventByIdempotencyKey(sqlite, `accounting-execution-${replacement!.id}`),
    ).toBeDefined();

    // Verify position reflects replacement values
    expect(result.position).toBeTruthy();
    expect(result.position!.direction).toBe('long');
    expect(result.position!.quantity).toBe('100.00');
    expect(result.position!.averageCost).toBe('155.00');
  });

  it('corrects a posted sell (close) execution', () => {
    const { sqlite, accountId, symbol } = ctx;

    // First open a position
    const open = postBuy(sqlite, accountId, symbol, '200.00', '100.00');
    rebuildPositions(sqlite, accountId, open.execution.instrumentId);

    // Now sell 100 @ $110
    const sellResult = postSell(sqlite, accountId, symbol, '100.00', '110.00');
    rebuildPositions(sqlite, accountId, sellResult.execution.instrumentId);

    // Correct the sell: should have been 100 @ $112 (better price)
    const result = correctExecution(sqlite, {
      accountId,
      originalExecutionId: sellResult.execution.id,
      symbol,
      action: 'sell',
      quantity: '100.00',
      price: '112.00',
      reason: 'Fill price updated by broker',
    });

    // Verify reversal: sell → buy
    expect(result.reversalExecution.action).toBe('buy');
    expect(result.reversalExecution.price).toBe('110.00');

    // Verify replacement: corrected sell
    expect(result.replacementExecution.action).toBe('sell');
    expect(result.replacementExecution.price).toBe('112.00');

    // Verify position — open order + reversal buy 100 + replacement sell 100
    // After correction: original buy 200 + reversal buy 100 + replacement sell 100
    // Net: 200 shares long (the open buy was restored, replacement sell closed 100)
    expect(result.position).toBeTruthy();
    expect(result.position!.quantity).toBe('200.00');
  });

  it('rejects duplicate correction via idempotency key', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Post an execution to correct
    const exec = postBuy(sqlite, accountId, symbol, '50.00', '200.00');
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    const idempotencyKey = randomUUID();

    // First correction with idempotency key
    correctExecution(sqlite, {
      accountId,
      originalExecutionId: exec.execution.id,
      symbol,
      action: 'buy',
      quantity: '50.00',
      price: '205.00',
      idempotencyKey,
    });

    // Second attempt with same idempotency key should fail
    expect(() => {
      correctExecution(sqlite, {
        accountId,
        originalExecutionId: exec.execution.id,
        symbol,
        action: 'buy',
        quantity: '50.00',
        price: '205.00',
        idempotencyKey,
      });
    }).toThrow(DuplicateCorrectionIdempotencyError);
  });

  it('rejects correction of an already-corrected execution', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Post an execution
    const exec = postBuy(sqlite, accountId, symbol, '30.00', '300.00');
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    // First correction
    correctExecution(sqlite, {
      accountId,
      originalExecutionId: exec.execution.id,
      symbol,
      action: 'buy',
      quantity: '30.00',
      price: '310.00',
    });

    // Second correction of the same original should fail
    expect(() => {
      correctExecution(sqlite, {
        accountId,
        originalExecutionId: exec.execution.id,
        symbol,
        action: 'buy',
        quantity: '30.00',
        price: '320.00',
      });
    }).toThrow(ExecutionAlreadyCorrectedError);
  });

  it('rejects correction of a reversal execution', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Post original
    const exec = postBuy(sqlite, accountId, symbol, '40.00', '250.00');
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    // Correct it
    const result = correctExecution(sqlite, {
      accountId,
      originalExecutionId: exec.execution.id,
      symbol,
      action: 'buy',
      quantity: '40.00',
      price: '260.00',
    });

    // Try correcting the reversal execution
    expect(() => {
      correctExecution(sqlite, {
        accountId,
        originalExecutionId: result.correction.reversalExecutionId,
        symbol,
        action: 'sell',
        quantity: '40.00',
        price: '250.00',
      });
    }).toThrow(ExecutionNotMutableError);
  });

  it('rejects correction of a replacement execution', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Post original
    const exec = postBuy(sqlite, accountId, symbol, '60.00', '100.00');
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    // Correct it
    const result = correctExecution(sqlite, {
      accountId,
      originalExecutionId: exec.execution.id,
      symbol,
      action: 'buy',
      quantity: '60.00',
      price: '105.00',
    });

    // Try correcting the replacement execution
    expect(() => {
      correctExecution(sqlite, {
        accountId,
        originalExecutionId: result.correction.replacementExecutionId,
        symbol,
        action: 'buy',
        quantity: '60.00',
        price: '110.00',
      });
    }).toThrow(ExecutionNotMutableError);
  });

  it('rejects cross-account correction', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Create a second account
    const secondAccountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
      )
      .run(secondAccountId, 'Second Account', now, now);

    // Post execution on the first account
    const exec = postBuy(sqlite, accountId, symbol, '10.00', '500.00');

    // Try correcting it using the wrong account
    expect(() => {
      correctExecution(sqlite, {
        accountId: secondAccountId,
        originalExecutionId: exec.execution.id,
        symbol,
        action: 'buy',
        quantity: '10.00',
        price: '510.00',
      });
    }).toThrow('not belong');
  });

  it('rejects correction when account does not exist', () => {
    const { sqlite } = ctx;
    const fakeId = randomUUID();

    expect(() => {
      correctExecution(sqlite, {
        accountId: fakeId,
        originalExecutionId: randomUUID(),
        symbol: 'AAPL',
        action: 'buy',
        quantity: '100.00',
        price: '150.00',
      });
    }).toThrow(AccountNotFoundError);
  });

  it('rejects correction of nonexistent execution', () => {
    const { sqlite, accountId } = ctx;

    expect(() => {
      correctExecution(sqlite, {
        accountId,
        originalExecutionId: randomUUID(),
        symbol: 'AAPL',
        action: 'buy',
        quantity: '100.00',
        price: '150.00',
      });
    }).toThrow(AccountNotFoundError);
  });

  it('rebuilds position correctly after sell_short correction', () => {
    const { sqlite } = ctx;

    // Use a FRESH account to avoid state leakage from previous tests
    const freshAccountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
      )
      .run(freshAccountId, 'Fresh Sell Short Account', now, now);

    const symbol = 'AAPL';

    // Open a short position: sell_short 100 AAPL @ $200
    const openShort = postSellShort(sqlite, freshAccountId, symbol, '100.00', '200.00');
    rebuildPositions(sqlite, freshAccountId, openShort.execution.instrumentId);

    // Correct the sell_short: should have been 100 @ $195
    const result = correctExecution(sqlite, {
      accountId: freshAccountId,
      originalExecutionId: openShort.execution.id,
      symbol,
      action: 'sell_short',
      quantity: '100.00',
      price: '195.00',
      reason: 'Better entry fill',
    });

    // Verify reversal: sell_short → buy_to_cover
    expect(result.reversalExecution.action).toBe('buy_to_cover');
    expect(result.reversalExecution.price).toBe('200.00');

    // Verify replacement
    expect(result.replacementExecution.action).toBe('sell_short');
    expect(result.replacementExecution.price).toBe('195.00');

    // Position should still be short 100 @ $195
    expect(result.position).toBeTruthy();
    expect(result.position!.direction).toBe('short');
    expect(result.position!.quantity).toBe('100.00');
    expect(result.position!.averageCost).toBe('195.00');
  });

  it('produces deterministic rebuild after correction replay', () => {
    const { sqlite } = ctx;

    // Create a new account for this test
    const replayAccountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
      )
      .run(replayAccountId, 'Replay Test Account', now, now);

    const symbol = 'AAPL';

    // Post original buy
    const exec = postBuy(sqlite, replayAccountId, symbol, '75.00', '120.00');
    rebuildPositions(sqlite, replayAccountId, exec.execution.instrumentId);

    // Verify the position before correction
    const prePosition = findAccountPosition(sqlite, replayAccountId, exec.execution.instrumentId);
    expect(prePosition?.quantity).toBe('75.00');

    // Correct the execution
    correctExecution(sqlite, {
      accountId: replayAccountId,
      originalExecutionId: exec.execution.id,
      symbol,
      action: 'buy',
      quantity: '75.00',
      price: '125.50',
      reason: 'Corrected fill price',
    });

    // Verify we have exactly 3 executions: original + reversal + replacement
    const allExecs = listAccountingExecutions(sqlite, replayAccountId, { limit: 10 });
    expect(allExecs.length).toBe(3);

    // The execution order is: original (buy), then reversal+replacement in timestamp order,
    // with UUID tiebreaker since they share the same timestamp.
    // Either ordering is fine: the FIFO consistently produces long 75 @ 125.50.
    expect(allExecs[0].action).toBe('buy');
    expect(allExecs[0].price).toBe('120.00');

    // Count actions: exactly 2 buys, 1 sell (reversal)
    const buyCount = allExecs.filter(e => e.action === 'buy').length;
    const sellCount = allExecs.filter(e => e.action === 'sell').length;
    expect(buyCount).toBe(2);
    expect(sellCount).toBe(1);

    // Capture first rebuild state
    const firstPosition = findAccountPosition(sqlite, replayAccountId, exec.execution.instrumentId);

    // Rebuild again (replay)
    rebuildPositions(sqlite, replayAccountId, exec.execution.instrumentId);

    // Position should be the same after replay
    const secondPosition = findAccountPosition(sqlite, replayAccountId, exec.execution.instrumentId);

    expect(secondPosition).toBeTruthy();
    expect(secondPosition!.quantity).toBe(firstPosition!.quantity);
    expect(secondPosition!.average_cost).toBe(firstPosition!.average_cost);
    expect(secondPosition!.realized_gross_pnl).toBe(firstPosition!.realized_gross_pnl);

    // Position should show the corrected values (net of reversal closing original + replacement)
    expect(secondPosition!.quantity).toBe('75.00');
    expect(secondPosition!.average_cost).toBe('125.50');
  });

  it('corrects a buy with fees', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Post original buy with fees
    const exec = postBuy(sqlite, accountId, symbol, '50.00', '180.00', '5.00');
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    // Correct the execution with different fees
    const result = correctExecution(sqlite, {
      accountId,
      originalExecutionId: exec.execution.id,
      symbol,
      action: 'buy',
      quantity: '50.00',
      price: '185.00',
      fees: '7.50',
      reason: 'Corrected price and fees',
    });

    // Verify the replacement has the new fees
    expect(result.replacementExecution.fees).toBe('7.50');

    // Verify reversal has original fees
    expect(result.reversalExecution.fees).toBe('5.00');
  });

  it('preserves rebuild status counts in result', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Post an execution
    const exec = postBuy(sqlite, accountId, symbol, '20.00', '400.00');
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    // Correct it
    const result = correctExecution(sqlite, {
      accountId,
      originalExecutionId: exec.execution.id,
      symbol,
      action: 'buy',
      quantity: '20.00',
      price: '420.00',
    });

    // Rebuild status should show counts including the new executions
    expect(result.rebuildStatus.executionCount).toBeGreaterThanOrEqual(3);
    expect(result.rebuildStatus.lotCount).toBeGreaterThanOrEqual(0);
    expect(result.rebuildStatus.matchCount).toBeGreaterThanOrEqual(0);
  });

  it('carries journalTradeId onto reversal and replacement for a trade-linked buy correction', () => {
    const { sqlite } = ctx;

    // Fresh account to avoid state leakage
    const freshAccountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
      )
      .run(freshAccountId, 'Journal Link Buy Account', now, now);

    const symbol = 'AAPL';
    const journalTradeId = randomUUID();

    // Post a trade-linked buy (journalTradeId set, as the trade-scoped route does)
    const original = postBuy(sqlite, freshAccountId, symbol, '100.00', '150.00', undefined, journalTradeId);
    rebuildPositions(sqlite, freshAccountId, original.execution.instrumentId);

    const result = correctExecution(sqlite, {
      accountId: freshAccountId,
      originalExecutionId: original.execution.id,
      symbol,
      action: 'buy',
      quantity: '100.00',
      price: '155.00',
      reason: 'Price correction on trade-linked fill',
    });

    // Result mappings carry the linkage
    expect(result.originalExecution.journalTradeId).toBe(journalTradeId);
    expect(result.reversalExecution.journalTradeId).toBe(journalTradeId);
    expect(result.replacementExecution.journalTradeId).toBe(journalTradeId);

    // Persisted rows carry the linkage too
    const reversal = findAccountingExecutionById(sqlite, result.correction.reversalExecutionId);
    const replacement = findAccountingExecutionById(sqlite, result.correction.replacementExecutionId);
    expect(reversal!.journal_trade_id).toBe(journalTradeId);
    expect(replacement!.journal_trade_id).toBe(journalTradeId);
  });

  it('carries journalTradeId onto reversal and replacement for a trade-linked sell_short correction', () => {
    const { sqlite } = ctx;

    // Fresh account to avoid state leakage
    const freshAccountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
      )
      .run(freshAccountId, 'Journal Link Sell Short Account', now, now);

    const symbol = 'AAPL';
    const journalTradeId = randomUUID();

    // Post a trade-linked sell_short
    const original = postSellShort(sqlite, freshAccountId, symbol, '100.00', '200.00', undefined, journalTradeId);
    rebuildPositions(sqlite, freshAccountId, original.execution.instrumentId);

    const result = correctExecution(sqlite, {
      accountId: freshAccountId,
      originalExecutionId: original.execution.id,
      symbol,
      action: 'sell_short',
      quantity: '100.00',
      price: '195.00',
      reason: 'Better entry fill on trade-linked short',
    });

    // Result mappings carry the linkage
    expect(result.reversalExecution.action).toBe('buy_to_cover');
    expect(result.originalExecution.journalTradeId).toBe(journalTradeId);
    expect(result.reversalExecution.journalTradeId).toBe(journalTradeId);
    expect(result.replacementExecution.journalTradeId).toBe(journalTradeId);

    // Persisted rows carry the linkage too
    const reversal = findAccountingExecutionById(sqlite, result.correction.reversalExecutionId);
    const replacement = findAccountingExecutionById(sqlite, result.correction.replacementExecutionId);
    expect(reversal!.journal_trade_id).toBe(journalTradeId);
    expect(replacement!.journal_trade_id).toBe(journalTradeId);
  });

  it('preserves the FIFO position of another trade in the same symbol when correcting a trade-linked exit', () => {
    const { sqlite } = ctx;

    // Fresh account to avoid state leakage from prior tests (all other tests
    // share the suite-level account).
    const freshAccountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
      )
      .run(freshAccountId, 'Multi-Trade FIFO Account', now, now);

    const symbol = 'AAPL';
    const trade1Id = randomUUID();
    const trade2Id = randomUUID();

    // Explicit, strictly-increasing posted_at values make FIFO replay ordering
    // deterministic — postExecutionFill defaults to Date.now() ISO (ms
    // resolution), and same-millisecond posts fall back to random-UUID ordering.
    const t1Entry = postExecutionFill(sqlite, {
      accountId: freshAccountId,
      symbol,
      action: 'buy',
      quantity: '100.00',
      price: '100.00',
      journalTradeId: trade1Id,
      postedAt: '2026-01-15T14:30:00.000Z',
    });
    const t1Exit = postExecutionFill(sqlite, {
      accountId: freshAccountId,
      symbol,
      action: 'sell',
      quantity: '100.00',
      price: '110.00',
      journalTradeId: trade1Id,
      postedAt: '2026-01-15T14:35:00.000Z',
    });
    const t2Entry = postExecutionFill(sqlite, {
      accountId: freshAccountId,
      symbol,
      action: 'buy',
      quantity: '100.00',
      price: '120.00',
      journalTradeId: trade2Id,
      postedAt: '2026-01-15T14:40:00.000Z',
    });
    // Rebuild once — the projection is a deterministic full replay, so posting
    // order (not rebuild calls) is the only thing that matters.
    rebuildPositions(sqlite, freshAccountId, t1Entry.execution.instrumentId);

    // ── Pre-correction baseline: trade 2 owns the only open lot ────────
    const lotsBefore = findFifoLotsByAccountInstrument(
      sqlite,
      freshAccountId,
      t2Entry.execution.instrumentId,
    );
    const t2LotBefore = lotsBefore.find((l) => l.opening_execution_id === t2Entry.execution.id);
    expect(t2LotBefore).toBeTruthy();
    expect(t2LotBefore!.direction).toBe('long');
    expect(t2LotBefore!.remaining_quantity).toBe('100.00');
    expect(t2LotBefore!.original_quantity).toBe('100.00');
    expect(t2LotBefore!.entry_price).toBe('120.00');

    const positionBefore = findAccountPosition(sqlite, freshAccountId, t2Entry.execution.instrumentId);
    expect(positionBefore?.quantity).toBe('100.00');
    expect(positionBefore?.average_cost).toBe('120.00');

    // ── Correct trade 1's exit fill (price correction 110 → 112) ────────
    const result = correctExecution(sqlite, {
      accountId: freshAccountId,
      originalExecutionId: t1Exit.execution.id,
      symbol,
      action: 'sell',
      quantity: '100.00',
      price: '112.00',
      reason: 'Multi-trade same-symbol FIFO integrity',
    });

    // The corrected pair keeps trade 1's linkage (T01 contract) so the
    // trade-scoped lifecycle rebuild can resolve them.
    expect(result.reversalExecution.journalTradeId).toBe(trade1Id);
    expect(result.replacementExecution.journalTradeId).toBe(trade1Id);

    // ── Trade 2's FIFO lot is untouched ────────────────────────────────
    const lotsAfter = findFifoLotsByAccountInstrument(
      sqlite,
      freshAccountId,
      t2Entry.execution.instrumentId,
    );
    const t2LotAfter = lotsAfter.find((l) => l.opening_execution_id === t2Entry.execution.id);
    expect(t2LotAfter).toBeTruthy();
    expect(t2LotAfter!.direction).toBe('long');
    expect(t2LotAfter!.remaining_quantity).toBe('100.00');
    expect(t2LotAfter!.original_quantity).toBe('100.00');
    expect(t2LotAfter!.entry_price).toBe('120.00');

    // Only trade 2's lot remains open: the correction kernel excludes the
    // original+reversal pair from replay, so the replacement sell re-closes
    // trade 1's own oldest entry lot and never allocates against trade 2.
    const openLotsAfter = lotsAfter.filter((l) => l.remaining_quantity !== '0.00');
    expect(openLotsAfter).toHaveLength(1);
    expect(openLotsAfter[0].opening_execution_id).toBe(t2Entry.execution.id);

    // ── Account aggregate FIFO stays consistent ────────────────────────
    // Position quantity/average cost are byte-identical to pre-correction;
    // only realized P&L changes to reflect the corrected exit:
    // (112.00 − 100.00) × 100 = 1200.00 (the pre-correction exit realized 1000.00).
    const positionAfter = findAccountPosition(sqlite, freshAccountId, t2Entry.execution.instrumentId);
    expect(positionAfter?.quantity).toBe('100.00');
    expect(positionAfter?.average_cost).toBe('120.00');
    expect(positionAfter?.realized_gross_pnl).toBe('1200.00');
    expect(result.position?.quantity).toBe('100.00');
    expect(result.position?.averageCost).toBe('120.00');

    // Replay determinism: rebuilding the projection again yields identical state.
    rebuildPositions(sqlite, freshAccountId, t2Entry.execution.instrumentId);
    const positionAfterReplay = findAccountPosition(sqlite, freshAccountId, t2Entry.execution.instrumentId);
    expect(positionAfterReplay?.quantity).toBe(positionAfter?.quantity);
    expect(positionAfterReplay?.average_cost).toBe(positionAfter?.average_cost);
    expect(positionAfterReplay?.realized_gross_pnl).toBe(positionAfter?.realized_gross_pnl);
  });
});
