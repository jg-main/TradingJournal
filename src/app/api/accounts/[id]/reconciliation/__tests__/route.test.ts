/**
 * Route tests for the Reconciliation API (GET)
 *
 * Tests the route logic by simulating it against a real SQLite database
 * with all migrations applied.
 *
 * Covers:
 * - Successful reconciliation after a clean migration run (200)
 * - Account not found (404)
 * - No migration run exists for this account (400)
 * - Report structure with all fields and correct types
 * - Cutover eligibility when no unexplained differences
 * - Cutover refusal when unexplained differences exist
 *
 * Run: npx vitest run src/app/api/accounts/\[id\]/reconciliation/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runLegacyMigration } from '@/lib/accounting/legacy-migration-runner';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = './.test-reconciliation-route.db';

// ── Test Database Setup ─────────────────────────────────────────────────

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
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

  // Create test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Recon Route Test Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ── Route Simulation ────────────────────────────────────────────────────

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates the GET /api/accounts/:id/reconciliation route handler logic
 * without Next.js dependencies.  Calls computeReconciliation directly.
 */
import { accountExists } from '@/db/accounting-repository';
import { computeReconciliation } from '@/lib/accounting/reconciliation';

function doGetReconciliation(
  sqlite: Database.Database,
  accountId: string,
): RouteResult {
  try {
    // 1. Verify account exists
    if (!accountExists(sqlite, accountId)) {
      return {
        status: 404,
        body: {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
      };
    }

    // 2. Compute reconciliation
    const report = computeReconciliation(sqlite, accountId);

    if (!report) {
      return {
        status: 400,
        body: {
          error: 'No migration run found',
          details: `No completed migration runs exist for account "${accountId}". Run a migration first via POST /api/accounts/${accountId}/migration.`,
        },
      };
    }

    // 3. Return the report
    return { status: 200, body: report as unknown as Record<string, unknown> };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: 'Failed to compute reconciliation report',
        details: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// ── Helpers for test data setup ────────────────────────────────────────

function insertLegacyDeposit(
  sqlite: Database.Database,
  accountId: string,
  overrides?: Partial<{
    id: string;
    amount: number;
    date: string;
  }>,
): string {
  const id = overrides?.id ?? randomUUID();
  const amount = overrides?.amount ?? 10000.00;
  const date = overrides?.date ?? '2024-01-15T10:00:00.000Z';
  sqlite
    .prepare(
      `INSERT INTO account_transactions (id, account_id, type, amount, balance_after, date, notes)
       VALUES (?, ?, 'deposit', ?, ?, ?, NULL)`,
    )
    .run(id, accountId, amount, amount, date);
  return id;
}

function insertTrade(
  sqlite: Database.Database,
  accountId: string,
  symbol: string,
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'long', 'closed', ?, ?)`,
    )
    .run(id, `T-${id.slice(0, 8)}`, accountId, symbol, now, now);
  return id;
}

function insertLegacyExecution(
  sqlite: Database.Database,
  tradeId: string,
  overrides?: Partial<{
    id: string;
    action: string;
    quantity: number;
    price: number;
    fees: number;
    executedAt: string;
  }>,
): string {
  const id = overrides?.id ?? randomUUID();
  const action = overrides?.action ?? 'buy';
  const quantity = overrides?.quantity ?? 100;
  const price = overrides?.price ?? 150.00;
  const fees = overrides?.fees ?? 0;
  const executedAt = overrides?.executedAt ?? '2024-01-16T09:30:00.000Z';
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, reason_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .run(id, tradeId, executedAt, action, quantity, price, fees, now);
  return id;
}

function insertLegacyPriceSnapshot(
  sqlite: Database.Database,
  tradeId: string,
  overrides?: Partial<{
    id: string;
    price: number;
    source: string;
    fetchedAt: string;
  }>,
): string {
  const id = overrides?.id ?? randomUUID();
  const price = overrides?.price ?? 155.00;
  const source = overrides?.source ?? 'yahoo';
  const fetchedAt = overrides?.fetchedAt ?? '2024-01-16T12:00:00.000Z';
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO position_price_snapshots (id, trade_id, price, source, market_state, short_name, quote_type, fetched_at, created_at)
       VALUES (?, ?, ?, ?, 'REGULAR', 'Test Inc.', 'EQUITY', ?, ?)`,
    )
    .run(id, tradeId, price, source, fetchedAt, now);
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(ctx.sqlite);
});

describe('GET /api/accounts/:id/reconciliation', () => {
  // ── Account not found ─────────────────────────────────────────────────

  it('returns 404 for a non-existent account', () => {
    const fakeId = 'nonexistent-account-id';
    const result = doGetReconciliation(ctx.sqlite, fakeId);
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Account not found');
    expect(result.body.details).toContain(fakeId);
  });

  // ── No migration run ──────────────────────────────────────────────────

  it('returns 400 when no migration run exists for an account', () => {
    const noRunAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(noRunAccountId, 'No Migration Run', 'Test', 'USD', now, now);

    const result = doGetReconciliation(ctx.sqlite, noRunAccountId);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('No migration run found');
  });

  // ── Successful reconciliation — all match ─────────────────────────────

  it('returns 200 with full reconciliation report after a migration', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    // Create a separate account for this test
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Full Recon Test', 'Test', 'USD', now, now);

    // Set up legacy data
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'rt-dep-001', amount: 10000, date: '2024-01-01T00:00:00.000Z' });

    const tradeId = insertTrade(ctx.sqlite, accountId, 'AAPL');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'rt-exe-001',
      action: 'buy',
      quantity: 100,
      price: 150.00,
      executedAt: '2024-01-10T09:30:00.000Z',
    });
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'rt-exe-002',
      action: 'sell',
      quantity: 50,
      price: 160.00,
      executedAt: '2024-01-15T09:30:00.000Z',
    });

    insertLegacyPriceSnapshot(ctx.sqlite, tradeId, {
      id: 'rt-psnap-001',
      price: 155.00,
      fetchedAt: '2024-01-12T12:00:00.000Z',
    });

    // Run migration
    const migrationResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(migrationResult.status).toBe('completed');

    // GET reconciliation
    const result = doGetReconciliation(ctx.sqlite, accountId);
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;
    expect(body.runId).toBe(migrationResult.runId);
    expect(body.accountId).toBe(accountId);
    expect(body.runStatus).toBe('completed');

    // Verify totals structure
    const totals = body.totals as Record<string, number>;
    expect(totals.comparisons).toBe(7);
    expect(totals.unexplained).toBe(0);

    // Verify comparisons array
    const comparisons = body.comparisons as Array<Record<string, unknown>>;
    expect(comparisons.length).toBe(7);

    // Verify all keys present
    const keys = comparisons.map((c) => c.key);
    expect(keys).toContain('cash');
    expect(keys).toContain('execution_count');
    expect(keys).toContain('fee_total');
    expect(keys).toContain('price_mark_count');
    expect(keys).toContain('position_count');
    expect(keys).toContain('position_exposure');
    expect(keys).toContain('net_asset_value');

    // Cutover should be eligible
    expect(body.cutoverEligible).toBe(true);
    expect(body.cutoverRefusalReasons).toEqual([]);

    // Verify record status counts (1 deposit + 2 executions + 1 snapshot)
    const recordCounts = body.recordStatusCounts as Record<string, number>;
    expect(recordCounts.totalRecords).toBe(4);
    expect(recordCounts.mappedCount).toBe(4);

    // Verify anomaly summaries
    expect(Array.isArray(body.anomalies)).toBe(true);
    expect(body.anomalies).toHaveLength(0);
  });

  // ── Successful reconciliation — with anomalies ────────────────────────

  it('includes anomaly summaries from migration run', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Anomaly Recon Route', 'Test', 'USD', now, now);

    // Valid deposit
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'an-rt-dep-001', amount: 5000, date: '2024-01-01T00:00:00.000Z' });

    // Execution with missing price (anomaly)
    const tradeId = insertTrade(ctx.sqlite, accountId, 'INTC');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'an-rt-exe-001',
      action: 'buy',
      quantity: 10,
      price: 0, // Missing price → anomaly
      executedAt: '2024-01-10T09:30:00.000Z',
    });

    // Run migration
    const migrationResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(migrationResult.status).toBe('completed');
    expect(migrationResult.anomalyCount).toBe(1);

    // GET reconciliation
    const result = doGetReconciliation(ctx.sqlite, accountId);
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;
    const anomalies = body.anomalies as Array<Record<string, unknown>>;

    // Should have at least one anomaly code
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    const priceAnomaly = anomalies.find(
      (a) => a.anomalyCode === 'ANOMALY_MISSING_PRICE',
    );
    expect(priceAnomaly).toBeDefined();
    expect(priceAnomaly!.count).toBe(1);
  });

  // ── Report structure ──────────────────────────────────────────────────

  it('returns a report with all required fields', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Struct Test Route', 'Test', 'USD', now, now);

    // Minimal setup: just a deposit
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'str-rt-dep-001', amount: 1000, date: '2024-01-01T00:00:00.000Z' });

    runLegacyMigration({ sqlite: ctx.sqlite, accountId });

    const result = doGetReconciliation(ctx.sqlite, accountId);
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // Top-level fields
    expect(typeof body.runId).toBe('string');
    expect(typeof body.accountId).toBe('string');
    expect(typeof body.runStatus).toBe('string');
    expect(typeof body.computedAt).toBe('string');
    expect(typeof body.cutoverEligible).toBe('boolean');
    expect(Array.isArray(body.cutoverRefusalReasons)).toBe(true);

    // rebuildFingerprint can be string or null
    expect(
      body.rebuildFingerprint === null || typeof body.rebuildFingerprint === 'string',
    ).toBe(true);

    // Totals
    const totals = body.totals as Record<string, unknown>;
    expect(typeof totals.comparisons).toBe('number');
    expect(typeof totals.matching).toBe('number');
    expect(typeof totals.explained).toBe('number');
    expect(typeof totals.anomalies).toBe('number');
    expect(typeof totals.unexplained).toBe('number');

    // Comparisons
    const comparisons = body.comparisons as Array<Record<string, unknown>>;
    expect(comparisons.length).toBe(7);
    for (const c of comparisons) {
      expect(typeof c.key).toBe('string');
      expect(typeof c.description).toBe('string');
      expect(typeof c.legacyValue).toBe('string');
      expect(typeof c.accountingValue).toBe('string');
      expect(typeof c.difference).toBe('string');
      expect(['match', 'explained', 'unexplained']).toContain(c.classification);
    }

    // Record status counts
    const recordCounts = body.recordStatusCounts as Record<string, unknown>;
    expect(typeof recordCounts.totalRecords).toBe('number');
    expect(typeof recordCounts.mappedCount).toBe('number');
    expect(typeof recordCounts.anomalyCount).toBe('number');
    expect(typeof recordCounts.unsupportedCount).toBe('number');
    expect(typeof recordCounts.duplicateCount).toBe('number');
  });

  // ── Cutover refused with unexplained differences ──────────────────────

  it('refuses cutover when unexplained differences exist', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Cutover Refused Route', 'Test', 'USD', now, now);

    // Insert legacy data
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'cut-rt-dep-001', amount: 1000, date: '2024-01-01T00:00:00.000Z' });

    // Manually insert a migration run with no matching accounting data
    // to create unexplained differences
    const runId = randomUUID();
    ctx.sqlite.prepare(
      `INSERT INTO accounting_migration_runs
       (id, account_id, status, total_records, mapped_count, anomaly_count, unsupported_count, duplicate_count, started_at, completed_at)
       VALUES (?, ?, 'completed', 1, 1, 0, 0, 0, ?, ?)`,
    ).run(runId, accountId, now, now);

    const result = doGetReconciliation(ctx.sqlite, accountId);
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;
    expect(body.cutoverEligible).toBe(false);
    expect(Array.isArray(body.cutoverRefusalReasons)).toBe(true);
    expect((body.cutoverRefusalReasons as string[]).length).toBeGreaterThan(0);

    // At least one refusal reason should mention "unexplained"
    const reasons = body.cutoverRefusalReasons as string[];
    const hasUnexplainedReason = reasons.some((r) => r.includes('unexplained'));
    expect(hasUnexplainedReason).toBe(true);
  });
});
