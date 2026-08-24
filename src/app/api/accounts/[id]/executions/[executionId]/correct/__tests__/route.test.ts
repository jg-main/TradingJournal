/**
 * Route-level tests for the Execution Correction API (POST)
 *
 * Tests the route handler by composing the same services the route uses
 * (correctExecution, correctionInputSchema, repository methods) against a
 * real SQLite database with all migrations applied.
 *
 * Covers:
 * - Successful buy correction → 200 with lineage and position
 * - Validation failures (missing fields, bad decimals) → 400
 * - Invalid JSON body → 400
 * - Missing account → 404
 * - Missing execution → 404
 * - Cross-account execution access → 404
 * - Already-corrected execution → 409
 * - Duplicate idempotency key → 409
 * - Fee correction
 * - Sell_short correction lifecycle
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/executions/\[executionId\]/correct/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../../../../../lib/testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// We test via the same services the route handler uses, not via a Next.js
// server instance. The route handler calls correctExecution from the
// correction service, which we invoke directly here with the same
// validation and error-mapping expectations the route would apply.
//
// For end-to-end HTTP tests, see the Playwright spec (T05).

import { correctExecution } from '@/lib/accounting/correction';
import { correctionInputSchema } from '@/lib/accounting/correction-contracts';
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { rebuildPositions } from '@/lib/positions/rebuild';
import {
  accountExists,
  findOrCreateInstrument,
  findAccountingExecutionById,
  findAccountPosition,
} from '@/db/accounting-repository';
import {
  AccountNotFoundError,
  ExecutionAlreadyCorrectedError,
  ExecutionNotMutableError,
  DuplicateCorrectionIdempotencyError,
} from '@/lib/accounting/errors';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('correction-route');

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
  symbol: string;
  instrumentId: string;
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
          // Skip statements that fail
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

  const symbol = 'AAPL';
  const instrument = findOrCreateInstrument(sqlite, symbol);

  return { sqlite, accountId, symbol, instrumentId: instrument.id };
}

function destroyTestDatabase(): void {
  try {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
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

// ── Route simulation helpers ────────────────────────────────────────────

function simulateRoutePost(
  sqlite: Database.Database,
  accountId: string,
  executionId: string,
  body: unknown,
) {
  const parsed = correctionInputSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: 'Validation failed',
        details: parsed.error.flatten(),
      },
    };
  }

  const { symbol, action, quantity, price, fees, reason, idempotencyKey, postedAt } = parsed.data;

  // Route-level pre-flight checks
  if (!accountExists(sqlite, accountId)) {
    return {
      status: 404,
      body: { error: 'Account not found', details: `Account "${accountId}" not found` },
    };
  }

  const originalExecution = findAccountingExecutionById(sqlite, executionId);
  if (!originalExecution) {
    return {
      status: 404,
      body: { error: 'Execution not found', details: `Execution "${executionId}" not found` },
    };
  }

  if (originalExecution.account_id !== accountId) {
    return {
      status: 404,
      body: { error: 'Execution not found', details: `Execution "${executionId}" does not belong to account "${accountId}"` },
    };
  }

  // Route-level error mapping
  try {
    const result = correctExecution(sqlite, {
      accountId,
      originalExecutionId: executionId,
      symbol,
      action,
      quantity,
      price,
      fees: fees ?? '0.00',
      reason,
      idempotencyKey,
      postedAt,
    });

    return {
      status: 200,
      body: {
        success: true,
        correction: result.correction,
        originalExecution: result.originalExecution,
        reversalExecution: result.reversalExecution,
        replacementExecution: result.replacementExecution,
        position: result.position,
        rebuildStatus: result.rebuildStatus,
      },
    };
  } catch (error) {
    if (error instanceof ExecutionAlreadyCorrectedError) {
      return { status: 409, body: { error: 'Execution already corrected', code: error.code, details: error.message } };
    }
    if (error instanceof ExecutionNotMutableError) {
      return { status: 422, body: { error: 'Execution not mutable', code: error.code, details: error.message } };
    }
    if (error instanceof DuplicateCorrectionIdempotencyError) {
      return { status: 409, body: { error: 'Duplicate correction idempotency key', code: error.code, details: error.message } };
    }
    if (error instanceof AccountNotFoundError) {
      return { status: 404, body: { error: 'Account not found', details: error.message } };
    }
    return { status: 500, body: { error: 'Failed to correct execution', details: error instanceof Error ? error.message : String(error) } };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('POST /api/accounts/:id/executions/:executionId/correct', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase();
  });

  it('returns 200 with correction lineage for a buy execution', () => {
    const { sqlite, accountId, symbol } = ctx;

    const exec = postExecutionFill(sqlite, { accountId, symbol, action: 'buy', quantity: '100.00', price: '150.00' });
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    const response = simulateRoutePost(sqlite, accountId, exec.execution.id, {
      symbol,
      action: 'buy',
      quantity: '100.00',
      price: '155.00',
      reason: 'Corrected price',
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    const correction = body.correction as { originalExecutionId: string };
    expect(correction.originalExecutionId).toBe(exec.execution.id);
    const reversalExec = body.reversalExecution as { action: string };
    expect(reversalExec.action).toBe('sell');
    const replacementExec = body.replacementExecution as { price: string };
    expect(replacementExec.price).toBe('155.00');
    const position = body.position as { direction: string } | null;
    expect(position).toBeDefined();
    expect(position!.direction).toBe('long');
  });

  it('returns 400 for invalid JSON body', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), 'not-json' as unknown as Record<string, unknown>);

    // The Zod parser will fail
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  it('returns 400 for missing required fields', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), {
      action: 'buy',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid decimal format', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), {
      symbol: 'AAPL',
      action: 'buy',
      quantity: 'not-a-decimal',
      price: '155.00',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  it('returns 404 for nonexistent account', () => {
    const { sqlite, symbol } = ctx;

    const response = simulateRoutePost(sqlite, randomUUID(), randomUUID(), {
      symbol,
      action: 'buy',
      quantity: '100.00',
      price: '155.00',
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Account not found');
  });

  it('returns 404 for nonexistent execution', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '155.00',
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Execution not found');
  });

  it('returns 404 for cross-account execution access', () => {
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

    // Post execution on first account
    const exec = postExecutionFill(sqlite, { accountId, symbol, action: 'buy', quantity: '10.00', price: '500.00' });

    // Attempt correction from second account
    const response = simulateRoutePost(sqlite, secondAccountId, exec.execution.id, {
      symbol,
      action: 'buy',
      quantity: '10.00',
      price: '510.00',
    });

    // The route pre-flight checks account ownership before delegating to service
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Execution not found');
  });

  it('returns 409 for already-corrected execution', () => {
    const { sqlite, accountId, symbol } = ctx;

    // Post and correct once
    const exec = postExecutionFill(sqlite, { accountId, symbol, action: 'buy', quantity: '30.00', price: '300.00' });
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    simulateRoutePost(sqlite, accountId, exec.execution.id, {
      symbol,
      action: 'buy',
      quantity: '30.00',
      price: '310.00',
    });

    // Second correction should fail
    const response = simulateRoutePost(sqlite, accountId, exec.execution.id, {
      symbol,
      action: 'buy',
      quantity: '30.00',
      price: '320.00',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Execution already corrected');
  });

  it('returns 409 for duplicate idempotency key', () => {
    const { sqlite, accountId, symbol } = ctx;

    const exec = postExecutionFill(sqlite, { accountId, symbol, action: 'buy', quantity: '50.00', price: '200.00' });
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    const key = randomUUID();

    // First correction succeeds
    simulateRoutePost(sqlite, accountId, exec.execution.id, {
      symbol,
      action: 'buy',
      quantity: '50.00',
      price: '205.00',
      idempotencyKey: key,
    });

    // Duplicate key on a new original execution should still fail
    const exec2 = postExecutionFill(sqlite, { accountId, symbol, action: 'buy', quantity: '25.00', price: '100.00' });
    rebuildPositions(sqlite, accountId, exec2.execution.instrumentId);

    const response = simulateRoutePost(sqlite, accountId, exec2.execution.id, {
      symbol,
      action: 'buy',
      quantity: '25.00',
      price: '105.00',
      idempotencyKey: key,
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Duplicate correction idempotency key');
  });

  it('returns 200 with fee correction', () => {
    const { sqlite, accountId, symbol } = ctx;

    const exec = postExecutionFill(sqlite, { accountId, symbol, action: 'buy', quantity: '25.00', price: '100.00', fees: '2.50' });
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    const response = simulateRoutePost(sqlite, accountId, exec.execution.id, {
      symbol,
      action: 'buy',
      quantity: '25.00',
      price: '105.00',
      fees: '5.00',
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    const reversalExec = body.reversalExecution as { fees: string };
    expect(reversalExec.fees).toBe('2.50');
    const replacementExec = body.replacementExecution as { fees: string };
    expect(replacementExec.fees).toBe('5.00');
  });

  it('returns 200 for sell_short correction (M002-A8: atomic FIFO replay needs a clean stream)', () => {
    const { sqlite, symbol } = ctx;
    // Fresh account: the correction's transactional FIFO replay replays the
    // whole instrument stream — a shared account with a prior long stream
    // would make the sell_short an unsupported flip and correctly fail closed.
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
    ).run(accountId, 'Fresh Sell Short', now, now);

    const exec = postExecutionFill(sqlite, { accountId, symbol, action: 'sell_short', quantity: '100.00', price: '200.00' });
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    const response = simulateRoutePost(sqlite, accountId, exec.execution.id, {
      symbol,
      action: 'sell_short',
      quantity: '100.00',
      price: '195.00',
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    const reversalExec = body.reversalExecution as { action: string };
    expect(reversalExec.action).toBe('buy_to_cover');
    const replacementExec = body.replacementExecution as { action: string; price: string };
    expect(replacementExec.action).toBe('sell_short');
    expect(replacementExec.price).toBe('195.00');
  });

  it('rebuilds position correctly and passes second rebuild (deterministic replay)', () => {
    const { sqlite, symbol } = ctx;
    // Fresh account: A8's transactional FIFO rebuild replays the full
    // instrument stream, so an isolated account keeps the replay deterministic.
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
    ).run(accountId, 'Fresh Replay', now, now);

    const exec = postExecutionFill(sqlite, { accountId, symbol, action: 'buy', quantity: '15.00', price: '300.00' });
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    const firstResponse = simulateRoutePost(sqlite, accountId, exec.execution.id, {
      symbol,
      action: 'buy',
      quantity: '15.00',
      price: '310.00',
    });

    expect(firstResponse.status).toBe(200);

    const firstBody = firstResponse.body as Record<string, unknown>;
    const firstPosition = firstBody.position as { quantity: string; averageCost: string } | null;
    expect(firstPosition).toBeDefined();

    // Rebuild again externally — simulating what would happen on replay
    rebuildPositions(sqlite, accountId, exec.execution.instrumentId);

    const secondPosRow = findAccountPosition(sqlite, accountId, exec.execution.instrumentId);
    expect(secondPosRow).toBeDefined();
    expect(secondPosRow!.quantity).toBe(firstPosition!.quantity);
    expect(secondPosRow!.average_cost).toBe(firstPosition!.averageCost);
  });
});
