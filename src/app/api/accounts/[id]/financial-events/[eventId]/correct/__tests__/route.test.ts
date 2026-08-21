/**
 * Route-level tests for the Financial Event Correction API (POST)
 *
 * Tests the route handler by composing the same services the route uses
 * (correctFinancialEvent, financialEventCorrectionInputSchema, repository
 * methods) against a real SQLite database with all migrations applied.
 *
 * Covers:
 * - Successful deposit correction → 200 with lineage and three events
 * - Validation failures (missing reason, bad decimals, zero amount) → 400
 * - Invalid JSON body → 400
 * - Missing account → 404
 * - Missing event → 404
 * - Cross-account event access → 404
 * - Already-corrected event → 409 with EVENT_ALREADY_CORRECTED code
 * - Duplicate idempotency key → 409 with DUPLICATE_CORRECTION_IDEMPOTENCY code
 * - Non-eligible event type → 422 with EVENT_NOT_CORRECTABLE code
 * - Negative amount for a cash type → 400
 *
 * Run: npx vitest run src/app/api/accounts/\[id\]/financial-events/\[eventId\]/correct/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { postEventWithEffect } from '@/lib/accounting/event-posting';
import { correctFinancialEvent } from '@/lib/accounting/financial-event-correction';
import { financialEventCorrectionInputSchema } from '@/lib/accounting/api-contracts';
import { accountExists, findEventById } from '@/db/accounting-repository';
import {
  AccountNotFoundError,
  FinancialEventNotFoundError,
  EventAlreadyCorrectedError,
  EventNotCorrectableError,
  DuplicateCorrectionIdempotencyError,
  InvalidAmountError,
  InvalidMicrosBoundsError,
} from '@/lib/accounting/errors';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-financial-event-correction-route.db';

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
  secondAccountId: string;
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

function insertAccount(sqlite: Database.Database, name: string): string {
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, ?, 'USD', 1, 0.0, ?, ?)`,
    )
    .run(accountId, name, now, now);
  return accountId;
}

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  applyAllMigrations(sqlite);

  const accountId = insertAccount(sqlite, 'Test Account');
  const secondAccountId = insertAccount(sqlite, 'Second Account');

  return { sqlite, accountId, secondAccountId };
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

function postDeposit(
  sqlite: Database.Database,
  accountId: string,
  amount: string,
  description = 'Initial deposit',
): string {
  const result = postEventWithEffect(sqlite, accountId, {
    eventType: 'deposit',
    amount,
    description,
  });
  return result.event.id;
}

function simulateRoutePost(
  sqlite: Database.Database,
  accountId: string,
  eventId: string,
  body: unknown,
) {
  // 1. Invalid JSON body
  if (typeof body === 'string') {
    return {
      status: 400,
      body: { error: 'Invalid JSON body' },
    };
  }

  // 2. Zod validation
  const parsed = financialEventCorrectionInputSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: 'Validation failed',
        details: parsed.error.flatten(),
      },
    };
  }

  const { amount, description, reason, idempotencyKey, postedAt } = parsed.data;

  // 3. Route-level pre-flight checks
  if (!accountExists(sqlite, accountId)) {
    return {
      status: 404,
      body: { error: 'Account not found', details: `Account "${accountId}" not found` },
    };
  }

  const originalEvent = findEventById(sqlite, eventId);
  if (!originalEvent) {
    return {
      status: 404,
      body: { error: 'Financial event not found', details: `Financial event "${eventId}" not found` },
    };
  }

  if (originalEvent.account_id !== accountId) {
    return {
      status: 404,
      body: { error: 'Financial event not found', details: `Financial event "${eventId}" does not belong to account "${accountId}"` },
    };
  }

  // 4. Route-level error mapping
  try {
    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: eventId,
      amount,
      description,
      reason,
      idempotencyKey,
      postedAt,
    });

    return {
      status: 200,
      body: {
        success: true,
        correction: result.correction,
        originalEvent: result.originalEvent,
        reversalEvent: result.reversalEvent,
        replacementEvent: result.replacementEvent,
      },
    };
  } catch (error) {
    if (error instanceof EventAlreadyCorrectedError) {
      return { status: 409, body: { error: 'Financial event already corrected', code: error.code, details: error.message } };
    }
    if (error instanceof DuplicateCorrectionIdempotencyError) {
      return { status: 409, body: { error: 'Duplicate correction idempotency key', code: error.code, details: error.message } };
    }
    if (error instanceof EventNotCorrectableError) {
      return { status: 422, body: { error: 'Financial event not correctable', code: error.code, details: error.message } };
    }
    if (error instanceof InvalidAmountError || error instanceof InvalidMicrosBoundsError) {
      return { status: 400, body: { error: 'Invalid amount', details: error.message } };
    }
    if (error instanceof FinancialEventNotFoundError || error instanceof AccountNotFoundError) {
      return { status: 404, body: { error: 'Account or financial event not found', details: error.message } };
    }
    return { status: 500, body: { error: 'Failed to correct financial event', details: error instanceof Error ? error.message : String(error) } };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('POST /api/accounts/:id/financial-events/:eventId/correct', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase();
  });

  it('returns 200 with correction lineage for a deposit correction', () => {
    const { sqlite, accountId } = ctx;

    const eventId = postDeposit(sqlite, accountId, '1000.00');

    const response = simulateRoutePost(sqlite, accountId, eventId, {
      amount: '1500.00',
      reason: 'Deposit amount corrected',
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    const correction = body.correction as {
      originalEventId: string;
      reversalEventId: string;
      replacementEventId: string;
      reason: string;
    };
    expect(correction.originalEventId).toBe(eventId);
    expect(correction.reason).toBe('Deposit amount corrected');
    expect(correction.reversalEventId).not.toBe(eventId);
    expect(correction.replacementEventId).not.toBe(eventId);
    const replacement = body.replacementEvent as { eventType: string; effect: string };
    expect(replacement.eventType).toBe('deposit');
    const effect = JSON.parse(replacement.effect) as { direction: string; amount: string };
    expect(effect.direction).toBe('increase');
    expect(effect.amount).toBe('1500.00');
  });

  it('returns 400 for invalid JSON body', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), 'not-json');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid JSON body');
  });

  it('returns 400 when the correction reason is missing', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), {
      amount: '1500.00',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  it('returns 400 for a zero correction amount', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), {
      amount: '0.00',
      reason: 'Zero amount should be rejected',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  it('returns 400 for a malformed decimal amount', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), {
      amount: 'not-a-decimal',
      reason: 'Malformed amount',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  it('returns 404 for a nonexistent account', () => {
    const { sqlite } = ctx;

    const response = simulateRoutePost(sqlite, randomUUID(), randomUUID(), {
      amount: '1000.00',
      reason: 'Missing account',
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Account not found');
  });

  it('returns 404 for a nonexistent event', () => {
    const { sqlite, accountId } = ctx;

    const response = simulateRoutePost(sqlite, accountId, randomUUID(), {
      amount: '1000.00',
      reason: 'Missing event',
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Financial event not found');
  });

  it('returns 404 for cross-account event access', () => {
    const { sqlite, accountId, secondAccountId } = ctx;

    const eventId = postDeposit(sqlite, accountId, '500.00');

    const response = simulateRoutePost(sqlite, secondAccountId, eventId, {
      amount: '600.00',
      reason: 'Cross-account access',
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Financial event not found');
  });

  it('returns 409 with EVENT_ALREADY_CORRECTED for an already-corrected event', () => {
    const { sqlite, accountId } = ctx;

    const eventId = postDeposit(sqlite, accountId, '2000.00');

    simulateRoutePost(sqlite, accountId, eventId, {
      amount: '2100.00',
      reason: 'First correction',
    });

    const response = simulateRoutePost(sqlite, accountId, eventId, {
      amount: '2200.00',
      reason: 'Second correction',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Financial event already corrected');
    expect(response.body.code).toBe('EVENT_ALREADY_CORRECTED');
  });

  it('returns 409 with DUPLICATE_CORRECTION_IDEMPOTENCY for a reused idempotency key', () => {
    const { sqlite, accountId } = ctx;

    const firstId = postDeposit(sqlite, accountId, '3000.00');
    const key = randomUUID();

    simulateRoutePost(sqlite, accountId, firstId, {
      amount: '3100.00',
      reason: 'First correction with key',
      idempotencyKey: key,
    });

    const secondId = postDeposit(sqlite, accountId, '3200.00');

    const response = simulateRoutePost(sqlite, accountId, secondId, {
      amount: '3300.00',
      reason: 'Rejected — same key',
      idempotencyKey: key,
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Duplicate correction idempotency key');
    expect(response.body.code).toBe('DUPLICATE_CORRECTION_IDEMPOTENCY_KEY');
  });

  it('returns 422 with EVENT_NOT_CORRECTABLE for a non-eligible event type', () => {
    const { sqlite, accountId } = ctx;

    const opening = postEventWithEffect(sqlite, accountId, {
      eventType: 'opening_balance',
      amount: '4000.00',
      description: 'Opening balance',
    });

    const response = simulateRoutePost(sqlite, accountId, opening.event.id, {
      amount: '5000.00',
      reason: 'Cannot correct opening balance',
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('Financial event not correctable');
    expect(response.body.code).toBe('EVENT_NOT_CORRECTABLE');
  });

  it('returns 400 for a negative amount on a cash event type', () => {
    const { sqlite, accountId } = ctx;

    const eventId = postDeposit(sqlite, accountId, '6000.00');

    const response = simulateRoutePost(sqlite, accountId, eventId, {
      amount: '-100.00',
      reason: 'Negative amount on deposit',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid amount');
  });

  it('returns 200 for a manual_adjustment correction with a signed amount', () => {
    const { sqlite, accountId } = ctx;

    const adjustment = postEventWithEffect(sqlite, accountId, {
      eventType: 'manual_adjustment',
      amount: '-100.00',
      description: 'Negative adjustment',
    });

    const response = simulateRoutePost(sqlite, accountId, adjustment.event.id, {
      amount: '75.00',
      reason: 'Sign corrected to credit',
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    const replacement = body.replacementEvent as { eventType: string; effect: string };
    expect(replacement.eventType).toBe('manual_adjustment');
    const effect = JSON.parse(replacement.effect) as { direction: string; amount: string };
    expect(effect.direction).toBe('increase');
    expect(effect.amount).toBe('75.00');
  });
});
