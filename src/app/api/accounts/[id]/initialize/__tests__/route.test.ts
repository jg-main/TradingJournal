/**
 * Route tests for the Account Initialization API (A2)
 *
 * Tests the route logic by composing the same services the route handler
 * uses (initializeAccount, rebuildAccountPerformance) against a real SQLite
 * database with all migrations applied.
 *
 * Covers:
 * - Opening-balance initialization succeeds: 201, account active, exactly
 *   one opening_balance event, cash = NAV = amount, P&L = 0
 * - Start with zero: 201, account active, zero financial events
 * - Atomic rollback: activation failure → nothing persisted, account draft
 * - Duplicate initialization → 409 Account already initialized
 * - Deactivated historical account → 409, remains inactive
 * - Legacy non-USD draft → 400 Unsupported account currency
 * - Idempotency replay → no duplicates, state unchanged
 * - Invalid body / amount → 400
 * - Missing account → 404
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/initialize/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initializeAccountRequestSchema } from '@/lib/accounting/api-contracts';
import { initializeAccount } from '@/lib/accounting/account-initialization';
import { findAccountPerformance, listAccountEvents } from '@/db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-account-initialize-route.db';

interface TestContext {
  sqlite: Database.Database;
  draftAccountId: string;
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
          // dependency ordering between migrations — safe to skip
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

  const draftAccountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(draftAccountId, 'Draft Account', 'Test Broker', 'USD', now, now);

  return { sqlite, draftAccountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ── Simulated route logic ───────────────────────────────────────────────

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates the POST /api/accounts/:id/initialize route handler logic
 * without Next.js dependencies.
 */
function doInitialize(
  sqlite: Database.Database,
  accountId: string,
  requestBody: unknown,
): RouteResult {
  try {
    if (typeof requestBody !== 'object' || requestBody === null) {
      return { status: 400, body: { error: 'Invalid JSON body' } };
    }

    const parsed = initializeAccountRequestSchema.safeParse(requestBody);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: 'Validation failed', details: parsed.error.flatten() },
      };
    }

    const requestData = parsed.data;
    const result = initializeAccount(sqlite, {
      accountId,
      mode: requestData.mode,
      amount: requestData.mode === 'opening_balance' ? requestData.amount : undefined,
      idempotencyKey: requestData.mode === 'opening_balance' ? requestData.idempotencyKey : undefined,
      description: requestData.mode === 'opening_balance' ? requestData.description : undefined,
      postedAt: requestData.mode === 'opening_balance' ? requestData.postedAt : undefined,
    });

    // Mirrors the route: the service rebuilds the projection INSIDE the
    // initialization transaction and enforces its success — no post-commit
    // rebuild here (exactly one required rebuild per initialization).
    const account = sqlite
      .prepare('SELECT id, is_active AS isActive, currency FROM accounts WHERE id = ?')
      .get(accountId) as Record<string, unknown>;

    return {
      status: 201,
      body: {
        account,
        performance: {
          success: result.performance.success,
          nav: result.performance.nav,
          rebuildCount: result.performance.rebuildCount,
        },
        event: result.openingBalance
          ? { id: result.openingBalance.event.id, eventType: result.openingBalance.event.eventType }
          : null,
        entry: result.openingBalance ? { id: result.openingBalance.entry.id } : null,
        postings: result.openingBalance
          ? {
              debit: { amount: result.openingBalance.postings.debit.amount },
              credit: { amount: result.openingBalance.postings.credit.amount },
            }
          : null,
      },
    };
  } catch (error) {
    const err = error as Error & { accountId?: string; currency?: string };
    if (err.message.includes('Invalid amount') || err.message.includes('Micros')) {
      return { status: 400, body: { error: 'Invalid amount', details: err.message } };
    }
    if (err.message.includes('not found')) {
      return { status: 404, body: { error: 'Account not found', details: err.message } };
    }
    if (err.message.includes('Unsupported account currency')) {
      return {
        status: 400,
        body: {
          error: err.message,
          details: { accountId: err.accountId, currency: err.currency },
        },
      };
    }
    if (err.message.includes('already initialized')) {
      return { status: 409, body: { error: 'Account already initialized', details: err.message } };
    }
    if (err.message.includes('idempotency key')) {
      return { status: 409, body: { error: 'Duplicate idempotency key', details: err.message } };
    }
    if (err.message.includes('projection could not be persisted')) {
      return { status: 500, body: { error: 'Failed to initialize account', details: err.message } };
    }
    return { status: 500, body: { error: 'Failed to initialize account', details: err.message } };
  }
}

// ── Fixture helpers ─────────────────────────────────────────────────────

function createDraft(sqlite: Database.Database, currency = 'USD'): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, `Draft ${id.slice(0, 8)}`, 'Broker', currency, now, now);
  return id;
}

function isActive(sqlite: Database.Database, accountId: string): number {
  const row = sqlite
    .prepare('SELECT is_active FROM accounts WHERE id = ?')
    .get(accountId) as { is_active: number };
  return row.is_active;
}

function eventCount(sqlite: Database.Database, accountId: string): number {
  return listAccountEvents(sqlite, accountId).length;
}

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(ctx.sqlite);
});

// ── Opening-balance initialization ──────────────────────────────────────

describe('POST /api/accounts/:id/initialize — opening balance', () => {
  it('initializes a draft: active, one opening_balance, cash = NAV = 10000, P&L = 0', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    const result = doInitialize(sqlite, accountId, {
      mode: 'opening_balance',
      amount: '10000.00',
      description: 'Initial capital',
    });

    expect(result.status).toBe(201);
    const body = result.body;
    expect((body.account as { isActive: number }).isActive).toBe(1);
    expect((body.event as { eventType: string }).eventType).toBe('opening_balance');
    expect((body.postings as { debit: { amount: string } }).debit.amount).toBe('10000.00');
    expect((body.postings as { credit: { amount: string } }).credit.amount).toBe('10000.00');

    // Persisted state.
    expect(isActive(sqlite, accountId)).toBe(1);
    expect(eventCount(sqlite, accountId)).toBe(1);

    // Canonical projection after rebuild.
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.net_cash).toBe('10000.00');
    expect(projection?.nav).toBe('10000.00');
    expect(projection?.realized_pnl).toBe('0.00');
    expect(projection?.total_pnl).toBe('0.00');
  });

  it('rejects a second initialization with 409 and keeps the event count at 1', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    expect(doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '5000.00' }).status).toBe(201);
    const second = doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '9999.00' });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('Account already initialized');
    expect(eventCount(sqlite, accountId)).toBe(1);
    expect(isActive(sqlite, accountId)).toBe(1);
  });

  it('is replay-safe: a retry with the same idempotency key never duplicates state', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);
    const idempotencyKey = randomUUID();

    expect(
      doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '3000.00', idempotencyKey }).status,
    ).toBe(201);

    // The account is initialized; a replay cannot run again (409) and cannot
    // create a duplicate event.
    const replay = doInitialize(sqlite, accountId, {
      mode: 'opening_balance',
      amount: '3000.00',
      idempotencyKey,
    });
    expect(replay.status).toBe(409);
    expect(eventCount(sqlite, accountId)).toBe(1);
  });

  it('rejects a legacy non-USD draft with 400 (USD-only contract)', () => {
    const sqlite = ctx.sqlite;
    const eurId = createDraft(sqlite, 'EUR');

    const result = doInitialize(sqlite, eurId, { mode: 'opening_balance', amount: '1000.00' });

    expect(result.status).toBe(400);
    expect((result.body.error as string)).toContain('Unsupported account currency');
    expect(eventCount(sqlite, eurId)).toBe(0);
    expect(isActive(sqlite, eurId)).toBe(0);
  });

  it('returns 400 for an invalid amount', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    const result = doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '0.00' });
    expect(result.status).toBe(400);
    expect(isActive(sqlite, accountId)).toBe(0);
    expect(eventCount(sqlite, accountId)).toBe(0);
  });

  it('returns 400 for a malformed body', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    expect(doInitialize(sqlite, accountId, { mode: 'opening_balance' }).status).toBe(400);
    expect(doInitialize(sqlite, accountId, { mode: 'bogus' }).status).toBe(400);
    expect(doInitialize(sqlite, accountId, null).status).toBe(400);
    expect(isActive(sqlite, accountId)).toBe(0);
  });

  it('returns 404 for a missing account', () => {
    const result = doInitialize(ctx.sqlite, randomUUID(), { mode: 'opening_balance', amount: '100.00' });
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Account not found');
  });
});

// ── Start with zero ─────────────────────────────────────────────────────

describe('POST /api/accounts/:id/initialize — start with zero', () => {
  it('activates a draft with zero financial events', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    const result = doInitialize(sqlite, accountId, { mode: 'zero' });

    expect(result.status).toBe(201);
    expect((result.body.account as { isActive: number }).isActive).toBe(1);
    expect(result.body.event).toBeNull();
    expect(result.body.entry).toBeNull();
    expect(result.body.postings).toBeNull();
    expect(isActive(sqlite, accountId)).toBe(1);
    expect(eventCount(sqlite, accountId)).toBe(0);

    // The route rebuilds the projection after committing; a zero-start
    // account has zero cash and no positions.
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection).toBeDefined();
    expect(projection?.net_cash).toBe('0.00');
    expect(projection?.nav).toBe('0.00');
  });

  it('rejects a second start-with-zero with 409', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    expect(doInitialize(sqlite, accountId, { mode: 'zero' }).status).toBe(201);
    expect(doInitialize(sqlite, accountId, { mode: 'zero' }).status).toBe(409);
  });
});

// ── Deactivated historical accounts ─────────────────────────────────────

describe('deactivated historical accounts are not reactivated', () => {
  it('rejects initialization with 409 and keeps the account inactive', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    // Historical account: previously initialized (opening balance), then
    // deactivated through the lifecycle.
    expect(doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '1000.00' }).status).toBe(201);
    sqlite
      .prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), accountId);

    const attempt = doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '2000.00' });
    expect(attempt.status).toBe(409);
    expect(attempt.body.error).toBe('Account already initialized');

    expect(isActive(sqlite, accountId)).toBe(0);
    expect(eventCount(sqlite, accountId)).toBe(1);
  });
});

// ── Atomicity at the route boundary ─────────────────────────────────────

describe('atomic rollback at the route boundary', () => {
  it('activation failure persists nothing: event count 0, account draft', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    sqlite.exec(`
      CREATE TRIGGER a2_route_force_activation_fail BEFORE UPDATE ON accounts
      WHEN NEW.is_active = 1 BEGIN SELECT RAISE(ABORT, 'forced activation failure'); END;
    `);

    const result = doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '10000.00' });
    expect(result.status).toBe(500);
    sqlite.exec('DROP TRIGGER a2_route_force_activation_fail');

    const entries = sqlite
      .prepare('SELECT COUNT(*) AS c FROM ledger_entries WHERE account_id = ?')
      .get(accountId) as { c: number };
    const postings = sqlite
      .prepare('SELECT COUNT(*) AS c FROM ledger_postings WHERE account_id = ?')
      .get(accountId) as { c: number };
    expect(eventCount(sqlite, accountId)).toBe(0);
    expect(entries.c).toBe(0);
    expect(postings.c).toBe(0);
    expect(isActive(sqlite, accountId)).toBe(0);
  });
});

// ── A2.1: projection failure at the route boundary ──────────────────────

describe('projection failure at the route boundary (A2.1)', () => {
  it('forced projection failure → 500, nothing persisted, account draft', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    sqlite.exec(`
      CREATE TRIGGER a21_route_force_projection_fail BEFORE INSERT ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END;
    `);

    const result = doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '10000.00' });
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Failed to initialize account');
    expect((result.body.details as string)).toContain('projection could not be persisted');
    sqlite.exec('DROP TRIGGER a21_route_force_projection_fail');

    // Rolled back: account inactive, zero events, zero ledger mutation, no
    // projection row.
    expect(isActive(sqlite, accountId)).toBe(0);
    expect(eventCount(sqlite, accountId)).toBe(0);
    const entries = sqlite
      .prepare('SELECT COUNT(*) AS c FROM ledger_entries WHERE account_id = ?')
      .get(accountId) as { c: number };
    const postings = sqlite
      .prepare('SELECT COUNT(*) AS c FROM ledger_postings WHERE account_id = ?')
      .get(accountId) as { c: number };
    expect(entries.c).toBe(0);
    expect(postings.c).toBe(0);
    expect(findAccountPerformance(sqlite, accountId)).toBeUndefined();
  });

  it('forced projection failure on zero mode → 500, account remains inactive', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    sqlite.exec(`
      CREATE TRIGGER a21_route_force_projection_fail BEFORE INSERT ON account_performance
      WHEN NEW.account_id = '${accountId}'
      BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END;
    `);

    const result = doInitialize(sqlite, accountId, { mode: 'zero' });
    expect(result.status).toBe(500);
    sqlite.exec('DROP TRIGGER a21_route_force_projection_fail');

    expect(isActive(sqlite, accountId)).toBe(0);
    expect(eventCount(sqlite, accountId)).toBe(0);
    expect(findAccountPerformance(sqlite, accountId)).toBeUndefined();
  });

  it('successful opening-balance initialization returns a coherent projection summary', () => {
    const sqlite = ctx.sqlite;
    const accountId = createDraft(sqlite);

    const result = doInitialize(sqlite, accountId, { mode: 'opening_balance', amount: '10000.00' });

    expect(result.status).toBe(201);
    expect((result.body.performance as { success: boolean; nav: string }).success).toBe(true);
    expect((result.body.performance as { nav: string }).nav).toBe('10000.00');
    const projection = findAccountPerformance(sqlite, accountId);
    expect(projection?.net_cash).toBe('10000.00');
    expect(projection?.nav).toBe('10000.00');
    expect(projection?.total_pnl).toBe('0.00');
  });
});
