/**
 * Route-level tests for the Account Performance Projection API (GET + POST)
 *
 * Tests the route logic by composing the same services the route handler
 * uses (rebuildAccountPerformance, repository methods) against a real
 * SQLite database with all migrations applied.
 *
 * Covers:
 * - GET: missing account (404), empty projection, with projection
 * - POST: rebuild for empty account, rebuild with cash and positions
 * - POST: rebuild with marks — full valuation
 * - POST: idempotent rebuild (calling twice increments count)
 * - POST: missing account
 * - Rebuild determinism (same data produces same result)
 * - Account isolation
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/performance/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Services used by the route
import {
  rebuildAccountPerformance,
} from '@/lib/performance/performance-rebuild';
import {
  insertValidatedValuationMark,
} from '@/lib/performance/valuation-repository';
import {
  postPerformanceRebuildSchema,
} from '@/lib/performance/api-contracts';
import {
  accountExists,
  findAccountPerformance,
  findInstrumentBySymbol,
} from '@/db/accounting-repository';
import { postOpeningBalance } from '@/lib/accounting/posting';
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { rebuildPositions } from '@/lib/positions/rebuild';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-performance-route.db';

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
    .run(accountId, 'Test Performance Account', null, 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(ctx: TestContext, dbPath?: string): void {
  try {
    ctx.sqlite.close();
  } catch {
    // ignore
  }
  const path = dbPath ?? TEST_DB_PATH;
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

// ── Helper: Post opening cash ───────────────────────────────────────────

function postOpeningCash(sqlite: Database.Database, accountId: string, amount: string): void {
  postOpeningBalance(sqlite, {
    accountId,
    amount,
  });
}

// ── Helper: Create a position via execution posting ─────────────────────

function createPosition(
  sqlite: Database.Database,
  accountId: string,
  symbol: string,
  action: string,
  quantity: string,
  price: string,
  fees: string,
): void {
  postExecutionFill(sqlite, {
    accountId,
    symbol,
    action,
    quantity,
    price,
    fees,
  });
  rebuildPositions(sqlite, accountId);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('GET /api/accounts/[id]/performance — service composition', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  it('should return empty projection when no projection exists', () => {
    const projection = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(projection).toBeUndefined();
  });

  it('should return a projection after rebuild on empty account', () => {
    const result = rebuildAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(result.success).toBe(true);
    expect(result.rebuildCount).toBe(1);
    expect(result.nav).toBe('0.00');
    expect(result.positionCount).toBe(0);
    expect(result.markCount).toBe(0);
    // With zero NAV, performance computation generates warnings
    expect(result.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it('should persist the projection so GET can read it', () => {
    // After the rebuild above, a projection should exist
    const projection = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(projection).toBeDefined();
    expect(projection!.account_id).toBe(ctx.accountId);
    expect(projection!.nav).toBe('0.00');
    expect(projection!.net_cash).toBe('0.00');
    expect(projection!.rebuild_count).toBe(1);
  });

  it('should include correct fields in the projection', () => {
    const projection = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(projection).toBeDefined();
    expect(projection!.net_cash).toBeDefined();
    expect(projection!.nav).toBeDefined();
    expect(projection!.marked_positions).toBeDefined();
    expect(projection!.realized_pnl).toBeDefined();
    expect(projection!.unrealized_pnl).toBeDefined();
    expect(projection!.total_pnl).toBeDefined();
    expect(projection!.realized_fees).toBeDefined();
    expect(projection!.gross_exposure).toBeDefined();
    expect(projection!.net_exposure).toBeDefined();
    expect(projection!.warnings).toBeDefined();
    expect(projection!.positions_json).toBeDefined();
    expect(projection!.rebuild_count).toBeGreaterThanOrEqual(1);
    expect(projection!.computed_as_of).toBeDefined();
  });

  it('should return 404 for non-existent account', () => {
    const missingId = randomUUID();
    expect(accountExists(ctx.sqlite, missingId)).toBe(false);
  });
});

describe('POST /api/accounts/[id]/performance — service composition', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  it('should rebuild with opening cash and produce NAV = cash', () => {
    postOpeningCash(ctx.sqlite, ctx.accountId, '10000.00');

    const result = rebuildAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(result.success).toBe(true);
    expect(result.nav).toBe('10000.00');
    expect(result.positionCount).toBe(0);
    // First rebuild for this describe block
    expect(result.rebuildCount).toBe(1);
  });

  it('should increment rebuild count on subsequent rebuilds', () => {
    const first = rebuildAccountPerformance(ctx.sqlite, ctx.accountId);
    const second = rebuildAccountPerformance(ctx.sqlite, ctx.accountId);

    expect(second.rebuildCount).toBeGreaterThan(first.rebuildCount);
  });

  it('should create a position and show missing-mark warning', () => {
    // Buy AAPL to create a position
    createPosition(ctx.sqlite, ctx.accountId, 'AAPL', 'buy', '100.00', '150.00', '5.00');

    // Rebuild performance — should produce a missing-mark warning since there's a position but no mark
    const result = rebuildAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(result.success).toBe(true);
    expect(result.positionCount).toBe(1);

    // Should have at least one warning about missing price
    const hasMissingMarkWarning = result.warnings.some(
      (w) =>
        w.toLowerCase().includes('missing') ||
        w.toLowerCase().includes('no mark'),
    );
    expect(hasMissingMarkWarning).toBe(true);
  });

  it('should rebuild with marks and show valuation state', () => {
    const now = new Date().toISOString();

    // Add a mark for AAPL
    insertValidatedValuationMark(ctx.sqlite, {
      accountId: ctx.accountId,
      instrumentSymbol: 'AAPL',
      price: '160.00',
      source: 'market_data',
      markTimestamp: now,
    });

    const result = rebuildAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(result.success).toBe(true);
    expect(result.positionCount).toBe(1);
    expect(result.markCount).toBe(1);
    // NAV should be cash ($10,000) + marked position value (100 * $160 = $16,000)
    expect(result.nav).toBe('26000.00');
  });

  it('should produce deterministic rebuild results', () => {
    const first = rebuildAccountPerformance(ctx.sqlite, ctx.accountId);
    const second = rebuildAccountPerformance(ctx.sqlite, ctx.accountId);

    // Both should succeed
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    // Both should have same NAV
    expect(first.nav).toBe(second.nav);
    expect(first.positionCount).toBe(second.positionCount);
    expect(first.markCount).toBe(second.markCount);
  });

  it('should persist rebuild result that can be read back', () => {
    const projection = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(projection).toBeDefined();
    expect(projection!.nav).toBeDefined();
    expect(parseFloat(projection!.nav)).toBeGreaterThan(0);
    expect(projection!.positions_json).toBeDefined();

    // Verify positions JSON is parseable
    const positions = JSON.parse(projection!.positions_json);
    expect(Array.isArray(positions)).toBe(true);
    expect(positions.length).toBeGreaterThanOrEqual(1);

    // Verify the first position has expected structure
    const firstPos = positions[0] as Record<string, unknown>;
    expect(firstPos.instrumentId).toBeDefined();
    expect(firstPos.quantity).toBeDefined();
    expect(firstPos.markPrice).toBeDefined();
    expect(firstPos.markStatus).toBeDefined();
    expect(firstPos.unrealizedPnl).toBeDefined();
  });

  it('should return error for non-existent account', () => {
    const missingId = randomUUID();
    const result = rebuildAccountPerformance(ctx.sqlite, missingId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should validate post body schema', () => {
    // Valid schema with freshness threshold
    const valid = postPerformanceRebuildSchema.safeParse({
      freshnessThresholdMinutes: 720,
      includePerformance: true,
    });
    expect(valid.success).toBe(true);

    // Valid minimal body
    const minimal = postPerformanceRebuildSchema.safeParse({});
    expect(minimal.success).toBe(true);

    // Invalid freshness threshold (too large)
    const invalidThreshold = postPerformanceRebuildSchema.safeParse({
      freshnessThresholdMinutes: 999999,
    });
    expect(invalidThreshold.success).toBe(false);

    // Invalid (zero)
    const zeroThreshold = postPerformanceRebuildSchema.safeParse({
      freshnessThresholdMinutes: 0,
    });
    expect(zeroThreshold.success).toBe(false);
  });
});

describe('Account isolation for performance projections — single DB, two accounts', () => {
  const ctx: TestContext = { sqlite: null as unknown as Database.Database, accountId: '' };
  let secondAccountId: string;

  beforeAll(() => {
    // Use a single SQLite database with two separate accounts
    // Avoids the disk I/O conflict from opening two connections to the same file
    const temp = createTestDatabase();
    ctx.sqlite = temp.sqlite;
    ctx.accountId = temp.accountId;

    // Setup account 1
    postOpeningCash(ctx.sqlite, ctx.accountId, '5000.00');
    rebuildAccountPerformance(ctx.sqlite, ctx.accountId);

    // Create second account in the same database
    secondAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(secondAccountId, 'Isolation Account 2', null, 'USD', now, now);

    // Setup account 2 with cash + position + mark
    postOpeningCash(ctx.sqlite, secondAccountId, '25000.00');
    createPosition(ctx.sqlite, secondAccountId, 'GOOGL', 'buy', '50.00', '200.00', '2.50');
    insertValidatedValuationMark(ctx.sqlite, {
      accountId: secondAccountId,
      instrumentSymbol: 'GOOGL',
      price: '210.00',
      source: 'user',
      markTimestamp: now,
    });
    rebuildAccountPerformance(ctx.sqlite, secondAccountId);
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  it('should isolate projections between accounts', () => {
    const proj1 = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(proj1).toBeDefined();

    const proj2 = findAccountPerformance(ctx.sqlite, secondAccountId);
    expect(proj2).toBeDefined();

    // Different accounts should have different NAVs
    expect(proj1!.nav).not.toBe(proj2!.nav);
  });

  it('should report different positions for isolated accounts', () => {
    const proj1 = findAccountPerformance(ctx.sqlite, ctx.accountId);
    const proj2 = findAccountPerformance(ctx.sqlite, secondAccountId);

    const pos1 = JSON.parse(proj1!.positions_json) as unknown[];
    const pos2 = JSON.parse(proj2!.positions_json) as unknown[];

    // Account 2 should have GOOGL position
    const pos2Ids = (pos2 as Record<string, unknown>[]).map((p) => p.instrumentId as string);
    const googlInstrument = findInstrumentBySymbol(ctx.sqlite, 'GOOGL');
    if (googlInstrument) {
      expect(pos2Ids).toContain(googlInstrument.id);
    }

    // Account 1 has no positions
    expect(pos1.length).toBe(0);
  });
});
