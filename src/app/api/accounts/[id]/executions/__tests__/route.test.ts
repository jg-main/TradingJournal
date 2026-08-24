/**
 * Route-level tests for the Account Execution API (POST + GET)
 *
 * Tests the route logic by composing the same services the route handler
 * uses (postExecutionFill, rebuildPositions, allocateFifo, repository
 * methods) against a real SQLite database with all migrations applied.
 *
 * Covers:
 * - Successful buy execution → position state
 * - Successful sell execution (partial close) → updated position
 * - Successful sell_short + buy_to_cover → short position lifecycle
 * - Duplicate idempotency key rejection (409-equivalent)
 * - Missing account (404-equivalent)
 * - Zod validation failures (400-equivalent)
 * - Over-close rejection via pre-flight FIFO check (422-equivalent)
 * - Unsupported flip rejection (422-equivalent)
 * - GET: empty, with executions, pagination, instrument filter
 * - Account isolation
 * - Malformed decimals
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/executions/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../../../lib/testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// Services used by the route
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { rebuildPositions } from '@/lib/positions/rebuild';
import { allocateFifo } from '@/lib/positions/fifo';
import { postFinancialEvent } from '@/lib/accounting/posting';
import { postExecutionSchema } from '@/lib/accounting/execution-contracts';
import {
  accountExists,
  findOrCreateInstrument,
  findAccountingExecutionByIdempotencyKey,
  listAccountingExecutions,
  countAccountingExecutions,
  findAccountPosition,
  findFifoLotsByAccountInstrument,
  findInstrumentById,
} from '@/db/accounting-repository';
import {
  AccountNotFoundError,
  DuplicateExecutionIdempotencyError,
  InvalidAmountError,
  UnsupportedAccountCurrencyError,
  AccountInactiveError,
} from '@/lib/accounting/errors';
import type { PositionState, FifoLot, FifoExecutionInput, ExecutionAction } from '@/lib/positions/types';
import type { CanonicalDecimal } from '@/lib/accounting/types';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('executions-route');

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
    .run(accountId, 'Test Account', null, 'USD', now, now);

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

// ── Pre-flight FIFO check (same logic as the route) ─────────────────────

function runPreflightFifoCheck(
  sqlite: Database.Database,
  accountId: string,
  symbol: string,
  action: string,
  quantity: string,
  price: string,
  fees: string,
  postedAt?: string,
): { accepted: true } | { accepted: false; code: string; message: string } {
  const instrument = findOrCreateInstrument(sqlite, symbol);
  const currentPositionRow = findAccountPosition(sqlite, accountId, instrument.id);
  const currentLotRows = findFifoLotsByAccountInstrument(sqlite, accountId, instrument.id);

  function lotRowToFifoLot(row: Record<string, unknown>): FifoLot {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      instrumentId: row.instrument_id as string,
      direction: row.direction as FifoLot['direction'],
      remainingQuantity: row.remaining_quantity as CanonicalDecimal,
      originalQuantity: row.original_quantity as CanonicalDecimal,
      entryPrice: row.entry_price as CanonicalDecimal,
      costBasisTotal: row.cost_basis_total as CanonicalDecimal,
      allocatedFees: row.allocated_fees as CanonicalDecimal,
      openingExecutionId: row.opening_execution_id as string,
      openedAt: row.opened_at as string,
    };
  }

  const currentPosition: PositionState | null = currentPositionRow
    ? {
        accountId: currentPositionRow.account_id,
        instrumentId: currentPositionRow.instrument_id,
        direction: currentPositionRow.direction as PositionState['direction'],
        quantity: currentPositionRow.quantity as CanonicalDecimal,
        averageCost: currentPositionRow.average_cost as CanonicalDecimal,
        totalCostBasis: currentPositionRow.total_cost_basis as CanonicalDecimal,
        realizedGrossPnl: currentPositionRow.realized_gross_pnl as CanonicalDecimal,
        realizedFees: currentPositionRow.realized_fees as CanonicalDecimal,
        realizedNetPnl: currentPositionRow.realized_net_pnl as CanonicalDecimal,
        openLots: (currentLotRows as unknown as Record<string, unknown>[]).map(lotRowToFifoLot),
        lastUpdated: currentPositionRow.last_updated,
      }
    : null;

  const currentLots: FifoLot[] = (currentLotRows as unknown as Record<string, unknown>[]).map(lotRowToFifoLot);

  const input: FifoExecutionInput = {
    executionId: 'preflight',
    accountId,
    instrumentId: instrument.id,
    action: action as ExecutionAction,
    quantity: quantity as CanonicalDecimal,
    price: price as CanonicalDecimal,
    fees: fees as CanonicalDecimal,
    postedAt: postedAt ?? new Date().toISOString(),
  };

  const result = allocateFifo(input, currentPosition, currentLots, () => randomUUID());

  if (result.status === 'success') {
    return { accepted: true };
  }
  return { accepted: false, code: result.code, message: result.message };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/accounts/[id]/executions — service composition', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  describe('Success cases', () => {
    it('should create a buy execution with correct position state', () => {
      const fillResult = postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'AAPL',
        action: 'buy',
        quantity: '100.00',
        price: '150.50',
        fees: '5.00',
      });

      // Verify execution record
      expect(fillResult.execution).toBeDefined();
      expect(fillResult.execution.action).toBe('buy');
      expect(fillResult.execution.quantity).toBe('100.00');
      expect(fillResult.execution.price).toBe('150.50');
      expect(fillResult.execution.fees).toBe('5.00');
      expect(fillResult.execution.accountId).toBe(ctx.accountId);

      // Verify ledger effects (financial event + postings created)
      expect(fillResult.eventWithPostings).toBeDefined();
      expect(fillResult.eventWithPostings.event.eventType).toBe('trade_execution');

      // Rebuild positions
      const rebuildResult = rebuildPositions(ctx.sqlite, ctx.accountId);
      expect(rebuildResult.executionCount).toBe(1);

      // Verify position state
      const instrument = findOrCreateInstrument(ctx.sqlite, 'AAPL');
      const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);
      expect(position).toBeDefined();
      expect(position!.direction).toBe('long');
      expect(position!.quantity).toBe('100.00');
      expect(position!.average_cost).toBe('150.50');

      // Verify open lots
      const lots = findFifoLotsByAccountInstrument(ctx.sqlite, ctx.accountId, instrument.id);
      expect(lots).toHaveLength(1);
      expect(lots[0].direction).toBe('long');
      expect(lots[0].remaining_quantity).toBe('100.00');
      expect(lots[0].entry_price).toBe('150.50');
    });

    it('should create a sell execution and update position (partial close)', () => {
      // Sell 30 AAPL from the existing 100
      const fillResult = postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'AAPL',
        action: 'sell',
        quantity: '30.00',
        price: '155.00',
        fees: '1.50',
      });

      expect(fillResult.execution.action).toBe('sell');
      expect(fillResult.execution.quantity).toBe('30.00');

      // Rebuild
      const rebuildResult = rebuildPositions(ctx.sqlite, ctx.accountId);
      expect(rebuildResult.executionCount).toBe(2);

      // Verify position updated
      const instrument = findOrCreateInstrument(ctx.sqlite, 'AAPL');
      const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);
      expect(position!.quantity).toBe('70.00');
      expect(position!.direction).toBe('long');

      // Realized P&L should be positive (bought at 150.50, sold at 155)
      expect(parseFloat(position!.realized_net_pnl!)).toBeGreaterThan(0);

      // Verify lots reflect sell
      const lots = findFifoLotsByAccountInstrument(ctx.sqlite, ctx.accountId, instrument.id);
      expect(lots).toHaveLength(1);
      expect(lots[0].remaining_quantity).toBe('70.00');
    });

    it('should handle sell_short and buy_to_cover lifecycle', () => {
      // Short 20 GOOGL
      postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'GOOGL',
        action: 'sell_short',
        quantity: '20.00',
        price: '140.00',
        fees: '3.00',
      });
      rebuildPositions(ctx.sqlite, ctx.accountId);

      const instrument = findOrCreateInstrument(ctx.sqlite, 'GOOGL');
      let position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);
      expect(position!.direction).toBe('short');
      expect(position!.quantity).toBe('20.00');

      const lots = findFifoLotsByAccountInstrument(ctx.sqlite, ctx.accountId, instrument.id);
      expect(lots).toHaveLength(1);
      expect(lots[0].direction).toBe('short');

      // Cover 10 GOOGL
      const coverResult = postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'GOOGL',
        action: 'buy_to_cover',
        quantity: '10.00',
        price: '138.00',
        fees: '1.50',
      });
      expect(coverResult.execution.action).toBe('buy_to_cover');

      rebuildPositions(ctx.sqlite, ctx.accountId);

      position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);
      expect(position!.quantity).toBe('10.00');
      expect(position!.direction).toBe('short');
      expect(parseFloat(position!.realized_net_pnl!)).toBeGreaterThan(0);
    });

    it('should accept optional journalTradeId and description', () => {
      const journalTradeId = randomUUID();

      const fillResult = postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'AMD',
        action: 'buy',
        quantity: '25.00',
        price: '120.00',
        fees: '1.00',
        journalTradeId,
        description: 'Test execution with journal attribution',
      });

      expect(fillResult.execution.journalTradeId).toBe(journalTradeId);
      expect(fillResult.execution.description).toBe('Test execution with journal attribution');
    });
  });

  describe('Validation and error cases', () => {
    it('should map duplicate idempotency key to 409', () => {
      const idempotencyKey = randomUUID();

      // First call succeeds
      postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'MSFT',
        action: 'buy',
        quantity: '10.00',
        price: '300.00',
        fees: '1.00',
        idempotencyKey,
      });

      // Second call with same key should throw
      expect(() => {
        postExecutionFill(ctx.sqlite, {
          accountId: ctx.accountId,
          symbol: 'MSFT',
          action: 'buy',
          quantity: '10.00',
          price: '300.00',
          fees: '1.00',
          idempotencyKey,
        });
      }).toThrow(DuplicateExecutionIdempotencyError);
    });

    it('should detect duplicate idempotency key via pre-flight check', () => {
      const existingKey = randomUUID();

      // Create execution with key
      postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: 'IBM',
        action: 'buy',
        quantity: '5.00',
        price: '180.00',
        fees: '0.50',
        idempotencyKey: existingKey,
      });

      // Pre-flight check should find the duplicate
      const existing = findAccountingExecutionByIdempotencyKey(ctx.sqlite, existingKey);
      expect(existing).toBeDefined();
      expect(existing!.idempotency_key).toBe(existingKey);
    });

    it('should map missing account to 404', () => {
      const missingId = randomUUID();
      expect(accountExists(ctx.sqlite, missingId)).toBe(false);
    });

    it('should reject malformed decimal via Zod validation (400 equivalent)', () => {
      // This validates the contract schema would reject it
      const result = postExecutionSchema.safeParse({
        symbol: 'AAPL',
        action: 'buy',
        quantity: 'not-a-number',
        price: '150.00',
        fees: '0.00',
      });
      expect(result.success).toBe(false);
      const fieldErrors = result.error?.flatten().fieldErrors;
      expect(fieldErrors?.quantity).toBeDefined();
    });

    it('should reject invalid action via Zod validation (400 equivalent)', () => {
      const result = postExecutionSchema.safeParse({
        symbol: 'AAPL',
        action: 'invalid_action',
        quantity: '10.00',
        price: '150.00',
        fees: '0.00',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty symbol via Zod validation', () => {
      const result = postExecutionSchema.safeParse({
        symbol: '',
        action: 'buy',
        quantity: '10.00',
        price: '150.00',
        fees: '0.00',
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive quantity via Zod validation', () => {
      const result = postExecutionSchema.safeParse({
        symbol: 'AAPL',
        action: 'buy',
        quantity: '0.00',
        price: '150.00',
        fees: '0.00',
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive price via Zod validation', () => {
      const result = postExecutionSchema.safeParse({
        symbol: 'AAPL',
        action: 'buy',
        quantity: '10.00',
        price: '0.00',
        fees: '0.00',
      });
      expect(result.success).toBe(false);
    });

    it('should reject over-close via pre-flight FIFO check (422 equivalent)', () => {
      // We have a long position of 70 AAPL (from 100 - 30 sell)
      // Try to sell 100 — overclose
      const preflight = runPreflightFifoCheck(
        ctx.sqlite,
        ctx.accountId,
        'AAPL',
        'sell',
        '100.00',
        '155.00',
        '1.00',
      );

      expect(preflight.accepted).toBe(false);
      if (preflight.accepted) return; // narrow for TS
      expect(preflight.code).toBe('REVERSAL');
    });

    it('should reject unsupported flip via pre-flight FIFO check (422 equivalent)', () => {
      // We have a long position in AAPL
      // Try to sell_short — mixed side / flip
      const preflight = runPreflightFifoCheck(
        ctx.sqlite,
        ctx.accountId,
        'AAPL',
        'sell_short',
        '10.00',
        '160.00',
        '1.00',
      );

      expect(preflight.accepted).toBe(false);
    });

    it('should reject sell without any position (422 equivalent)', () => {
      // Create a fresh account for this
      const freshId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(freshId, 'Fresh Account', null, 'USD', now, now);

      const preflight = runPreflightFifoCheck(
        ctx.sqlite,
        freshId,
        'XYZ',
        'sell',
        '10.00',
        '100.00',
        '0.00',
      );

      expect(preflight.accepted).toBe(false);
      if (preflight.accepted) return; // narrow for TS
      expect(preflight.code).toBe('NO_POSITION_TO_CLOSE');
    });
  });

  describe('GET /api/accounts/[id]/executions — service composition', () => {
    it('should list executions with data (post-buy state)', () => {
      const executions = listAccountingExecutions(ctx.sqlite, ctx.accountId);
      expect(executions.length).toBeGreaterThanOrEqual(5); // AAPL buy, sell, MSFT, GOOGL short, cover, AMD
    });

    it('should return paginated results', () => {
      const page1 = listAccountingExecutions(ctx.sqlite, ctx.accountId, { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = listAccountingExecutions(ctx.sqlite, ctx.accountId, { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      // Different IDs at different offsets
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should count executions', () => {
      const total = countAccountingExecutions(ctx.sqlite, ctx.accountId);
      expect(total).toBeGreaterThanOrEqual(5);
    });

    it('should resolve instrument symbols for executions', () => {
      const executions = listAccountingExecutions(ctx.sqlite, ctx.accountId);
      for (const exec of executions) {
        const instrument = findInstrumentById(ctx.sqlite, exec.instrument_id);
        expect(instrument).toBeDefined();
        expect(instrument!.symbol).toBeDefined();
      }
    });

    it('should filter executions by instrumentId', () => {
      const instrument = findOrCreateInstrument(ctx.sqlite, 'AAPL');
      const filtered = listAccountingExecutions(ctx.sqlite, ctx.accountId, {
        instrumentId: instrument.id,
      });

      expect(filtered.length).toBeGreaterThanOrEqual(1);
      for (const exec of filtered) {
        expect(exec.instrument_id).toBe(instrument.id);
      }
    });

    it('should return empty list for accounts with no executions', () => {
      const emptyId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(emptyId, 'Empty Account', null, 'USD', now, now);

      const executions = listAccountingExecutions(ctx.sqlite, emptyId);
      expect(executions).toEqual([]);

      const count = countAccountingExecutions(ctx.sqlite, emptyId);
      expect(count).toBe(0);
    });

    it('should enforce account isolation', () => {
      // Create second account
      const secondAccountId = randomUUID();
      const now = new Date().toISOString();
      ctx.sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(secondAccountId, 'Second Account', null, 'USD', now, now);

      // Buy NVDA in second account
      postExecutionFill(ctx.sqlite, {
        accountId: secondAccountId,
        symbol: 'NVDA',
        action: 'buy',
        quantity: '10.00',
        price: '500.00',
        fees: '1.00',
      });
      rebuildPositions(ctx.sqlite, secondAccountId);

      // Second account should have NVDA executions
      const secondExecs = listAccountingExecutions(ctx.sqlite, secondAccountId);
      expect(secondExecs).toHaveLength(1);

      // First account should NOT have NVDA executions
      const instrument = findOrCreateInstrument(ctx.sqlite, 'NVDA');
      const firstExecs = listAccountingExecutions(ctx.sqlite, ctx.accountId, {
        instrumentId: instrument.id,
      });
      expect(firstExecs).toHaveLength(0);
    });
  });
});

// ── Legacy non-USD account (USD-only contract) ─────────────────────────

describe('legacy non-USD account — execution posting guard', () => {
  let ctx2: TestContext;
  let eurAccountId: string;

  beforeAll(() => {
    ctx2 = createTestDatabase();
    eurAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx2.sqlite
      .prepare(
        `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(eurAccountId, 'Legacy EUR Account', null, 'EUR', now, now);
  });

  afterAll(() => {
    destroyTestDatabase(ctx2);
  });

  it('rejects an execution for a legacy EUR account before any ledger mutation', () => {
    const executionsBefore = (
      ctx2.sqlite.prepare('SELECT count(*) AS count FROM accounting_executions WHERE account_id = ?').get(eurAccountId) as { count: number }
    ).count;
    const eventsBefore = (
      ctx2.sqlite.prepare('SELECT count(*) AS count FROM financial_events WHERE account_id = ?').get(eurAccountId) as { count: number }
    ).count;
    const postingsBefore = (
      ctx2.sqlite.prepare('SELECT count(*) AS count FROM ledger_postings').get() as { count: number }
    ).count;

    expect(() =>
      postExecutionFill(ctx2.sqlite, {
        accountId: eurAccountId,
        symbol: 'MSFT',
        action: 'buy',
        quantity: '5.00',
        price: '200.00',
        fees: '0.00',
      }),
    ).toThrow(UnsupportedAccountCurrencyError);

    // No execution row, no financial event, no ledger postings.
    const executionsAfter = (
      ctx2.sqlite.prepare('SELECT count(*) AS count FROM accounting_executions WHERE account_id = ?').get(eurAccountId) as { count: number }
    ).count;
    const eventsAfter = (
      ctx2.sqlite.prepare('SELECT count(*) AS count FROM financial_events WHERE account_id = ?').get(eurAccountId) as { count: number }
    ).count;
    const postingsAfter = (
      ctx2.sqlite.prepare('SELECT count(*) AS count FROM ledger_postings').get() as { count: number }
    ).count;
    expect(executionsAfter).toBe(executionsBefore);
    expect(eventsAfter).toBe(eventsBefore);
    expect(postingsAfter).toBe(postingsBefore);
  });

  it('does not consume the execution idempotency key on rejection', () => {
    const key = `eur-exec-${randomUUID()}`;
    expect(() =>
      postExecutionFill(ctx2.sqlite, {
        accountId: eurAccountId,
        symbol: 'NVDA',
        action: 'buy',
        quantity: '1.00',
        price: '500.00',
        idempotencyKey: key,
      }),
    ).toThrow(UnsupportedAccountCurrencyError);
    expect(findAccountingExecutionByIdempotencyKey(ctx2.sqlite, key)).toBeUndefined();
  });
  // ── A6: inactive accounts are read-only for new executions ────────────
  describe('A6 lifecycle guard (inactive accounts)', () => {
    let inactiveId: string;

    beforeAll(() => {
      const sqlite = ctx2.sqlite;
      const now = new Date().toISOString();
      inactiveId = randomUUID();
      sqlite
        .prepare(
          `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 'USD', 0, ?, ?)`,
        )
        .run(inactiveId, 'Deactivated A6 Exec', null, now, now);
    });

    it('20: inactive account -> AccountInactiveError with zero mutation (no instrument row)', () => {
      const sqlite = ctx2.sqlite;
      const instrumentsBefore = (
        sqlite.prepare('SELECT COUNT(*) AS c FROM instruments').get() as { c: number }
      ).c;
      const executionsBefore = (
        sqlite.prepare('SELECT COUNT(*) AS c FROM accounting_executions').get() as { c: number }
      ).c;
      const eventsBefore = (
        sqlite.prepare('SELECT COUNT(*) AS c FROM financial_events').get() as { c: number }
      ).c;

      expect(() =>
        postExecutionFill(sqlite, {
          accountId: inactiveId,
          symbol: 'AAPL',
          action: 'buy',
          quantity: '10.00',
          price: '100.00',
          fees: '0.00',
        }),
      ).toThrow(AccountInactiveError);

      const instrumentsAfter = (
        sqlite.prepare('SELECT COUNT(*) AS c FROM instruments').get() as { c: number }
      ).c;
      const executionsAfter = (
        sqlite.prepare('SELECT COUNT(*) AS c FROM accounting_executions').get() as { c: number }
      ).c;
      const eventsAfter = (
        sqlite.prepare('SELECT COUNT(*) AS c FROM financial_events').get() as { c: number }
      ).c;
      expect(instrumentsAfter).toBe(instrumentsBefore);
      expect(executionsAfter).toBe(executionsBefore);
      expect(eventsAfter).toBe(eventsBefore);
    });

    it('21: rejected request does not consume the execution idempotency key; reactivation retry succeeds', () => {
      const sqlite = ctx2.sqlite;
      const idempotencyKey = randomUUID();

      expect(() =>
        postExecutionFill(sqlite, {
          accountId: inactiveId,
          symbol: 'MSFT',
          action: 'buy',
          quantity: '5.00',
          price: '200.00',
          fees: '0.00',
          idempotencyKey,
        }),
      ).toThrow(AccountInactiveError);

      // The key was not consumed.
      expect(findAccountingExecutionByIdempotencyKey(sqlite, idempotencyKey)).toBeUndefined();

      // Reactivate, retry the SAME request with the SAME key.
      sqlite
        .prepare('UPDATE accounts SET is_active = 1, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), inactiveId);
      const fill = postExecutionFill(sqlite, {
        accountId: inactiveId,
        symbol: 'MSFT',
        action: 'buy',
        quantity: '5.00',
        price: '200.00',
        fees: '0.00',
        idempotencyKey,
      });
      expect(fill.execution).toBeDefined();
      expect(findAccountingExecutionByIdempotencyKey(sqlite, idempotencyKey)).toBeDefined();
      // Deactivate again for hygiene.
      sqlite
        .prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), inactiveId);
    });
  });
});