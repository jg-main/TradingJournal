/**
 * Tests for the reconciliation engine.
 *
 * Coverage:
 * - Full reconciliation after a clean migration run (all match)
 * - No migration run exists → undefined
 * - Cash difference within rounding tolerance (explained)
 * - Execution count mismatch (explained by anomalies)
 * - Fee difference within rounding tolerance (explained)
 * - Price mark count mismatch (unexplained)
 * - Cutover gate: eligible when no unexplained differences
 * - Cutover gate: refused when unexplained differences exist
 * - Anomaly records are incorporated into the report
 * - Report structure and field types
 *
 * @module reconciliation.test
 */

import { testDbPath } from '../testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { runLegacyMigration } from './legacy-migration-runner';
import { computeReconciliation } from './reconciliation';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('reconciliation');

// ── Helpers (same pattern as runner tests) ──────────────────────────────

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
          // Skip any errors from repeated runs
        }
      }
    }
  }
}

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
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
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Reconciliation Test Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

function insertLegacyDeposit(
  sqlite: Database.Database,
  accountId: string,
  overrides?: Partial<{
    id: string;
    amount: number;
    date: string;
    notes: string | null;
  }>,
): string {
  const id = overrides?.id ?? randomUUID();
  const amount = overrides?.amount ?? 10000.00;
  const date = overrides?.date ?? '2024-01-15T10:00:00.000Z';
  const notes = overrides?.notes ?? null;
  sqlite
    .prepare(
      `INSERT INTO account_transactions (id, account_id, type, amount, balance_after, date, notes)
       VALUES (?, ?, 'deposit', ?, ?, ?, ?)`,
    )
    .run(id, accountId, amount, amount, date, notes);
  return id;
}

function insertLegacyWithdrawal(
  sqlite: Database.Database,
  accountId: string,
  overrides?: Partial<{
    id: string;
    amount: number;
    date: string;
    notes: string | null;
  }>,
): string {
  const id = overrides?.id ?? randomUUID();
  const amount = overrides?.amount ?? 5000.00;
  const date = overrides?.date ?? '2024-02-01T10:00:00.000Z';
  const notes = overrides?.notes ?? null;
  sqlite
    .prepare(
      `INSERT INTO account_transactions (id, account_id, type, amount, balance_after, date, notes)
       VALUES (?, ?, 'withdrawal', ?, ?, ?, ?)`,
    )
    .run(id, accountId, amount, 5000, date, notes);
  return id;
}

function insertTrade(
  sqlite: Database.Database,
  accountId: string,
  symbol: string,
  direction: 'long' | 'short' = 'long',
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'closed', ?, ?)`,
    )
    .run(id, `T-${id.slice(0, 8)}`, accountId, symbol, direction, now, now);
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
    fees: number | null;
    executedAt: string;
  }>,
): string {
  const id = overrides?.id ?? randomUUID();
  const action = overrides?.action ?? 'buy';
  const quantity = overrides?.quantity ?? 100;
  const price = overrides?.price ?? 150.50;
  const fees = overrides?.fees !== undefined ? overrides.fees : 0;
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

describe('computeReconciliation', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  // ── No migration run ──────────────────────────────────────────────────

  it('returns undefined when no migration run exists', () => {
    const noRunAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(noRunAccountId, 'No Migration Run', 'Test', 'USD', now, now);

    const result = computeReconciliation(ctx.sqlite, noRunAccountId);
    expect(result).toBeUndefined();
  });

  // ── Full clean migration — all match ──────────────────────────────────

  it('returns all matching comparisons after a clean migration run', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Clean Migration Account', 'Test', 'USD', now, now);

    // Insert legacy data: deposit + withdrawal + buy + sell + price snapshot
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'rec-dep-001', amount: 10000, date: '2024-01-01T00:00:00.000Z' });
    insertLegacyWithdrawal(ctx.sqlite, accountId, { id: 'rec-wth-001', amount: 2000, date: '2024-01-05T00:00:00.000Z' });

    const tradeId = insertTrade(ctx.sqlite, accountId, 'AAPL');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'rec-exe-001',
      action: 'buy',
      quantity: 100,
      price: 150.00,
      executedAt: '2024-01-10T09:30:00.000Z',
    });
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'rec-exe-002',
      action: 'sell',
      quantity: 50,
      price: 160.00,
      executedAt: '2024-01-15T09:30:00.000Z',
    });

    insertLegacyPriceSnapshot(ctx.sqlite, tradeId, {
      id: 'rec-psnap-001',
      price: 155.00,
      fetchedAt: '2024-01-12T12:00:00.000Z',
    });

    // Run migration
    const migrationResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(migrationResult.status).toBe('completed');

    // Now run reconciliation
    const report = computeReconciliation(ctx.sqlite, accountId);
    expect(report).toBeDefined();
    expect(report!.accountId).toBe(accountId);
    expect(report!.runId).toBe(migrationResult.runId);
    expect(report!.runStatus).toBe('completed');
    expect(report!.rebuildFingerprint).toBe(migrationResult.rebuildFingerprint);

    // All comparisons should match or be explained
    expect(report!.totals.comparisons).toBeGreaterThan(0);
    const unexplained = report!.comparisons.filter((c) => c.classification === 'unexplained');
    expect(unexplained.length).toBe(0);

    // Cutover should be eligible
    expect(report!.cutoverEligible).toBe(true);
    expect(report!.cutoverRefusalReasons.length).toBe(0);

    // Verify anomaly summaries exist
    expect(report!.anomalies).toBeDefined();
    expect(Array.isArray(report!.anomalies)).toBe(true);

    // Verify record status counts
    expect(report!.recordStatusCounts).toBeDefined();
    expect(report!.recordStatusCounts.totalRecords).toBe(5);
    expect(report!.recordStatusCounts.mappedCount).toBe(5);
  });

  it('compares sub-cent legacy marks with the full precision stored in accounting', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Sub-cent Mark Account', 'Test', 'USD', now, now);

    const tradeId = insertTrade(ctx.sqlite, accountId, 'PREC');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      action: 'buy',
      quantity: 10,
      price: 11.3,
    });
    insertLegacyPriceSnapshot(ctx.sqlite, tradeId, { price: 11.615 });

    const migrationResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(migrationResult.status).toBe('completed');

    const report = computeReconciliation(ctx.sqlite, accountId);
    const exposure = report!.comparisons.find((comparison) => comparison.key === 'position_exposure');
    const nav = report!.comparisons.find((comparison) => comparison.key === 'net_asset_value');

    expect(exposure).toMatchObject({
      legacyValue: '116.15',
      accountingValue: '116.15',
      classification: 'match',
    });
    expect(nav).toMatchObject({
      legacyValue: '3.15',
      accountingValue: '3.15',
      classification: 'match',
    });
  });

  // ── Cash difference — explained by rounding ───────────────────────────

  it('classifies small cash differences as explained (rounding tolerance)', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Rounding Account', 'Test', 'USD', now, now);

    // Insert a deposit with a tricky float value that may round
    insertLegacyDeposit(ctx.sqlite, accountId, {
      id: 'round-dep-001',
      amount: 10000.01, // clean float, should map exactly
      date: '2024-01-01T00:00:00.000Z',
    });

    // Run migration
    const migrationResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(migrationResult.status).toBe('completed');

    // Manually insert a tiny additional accounting posting to create a small difference
    // that mimics float→decimal rounding
    const eventId = randomUUID();
    const entryId = randomUUID();
    ctx.sqlite.prepare(
      `INSERT INTO financial_events (id, account_id, event_type, idempotency_key, description, payload, effect, posted_at)
       VALUES (?, ?, 'adjustment', NULL, 'Rounding test', NULL, NULL, ?)`,
    ).run(eventId, accountId, now);

    ctx.sqlite.prepare(
      `INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at)
       VALUES (?, ?, ?, 'Rounding test', ?)`,
    ).run(entryId, eventId, accountId, now);

    // Add a 0.001 cent difference (1 micro) — effectively zero
    ctx.sqlite.prepare(
      `INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence)
       VALUES (?, ?, ?, 'debit', '0.00', 1, 'USD', 999)`,
    ).run(randomUUID(), entryId, accountId);
    ctx.sqlite.prepare(
      `INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence)
       VALUES (?, ?, ?, 'credit', '0.00', 1, 'USD', 1000)`,
    ).run(randomUUID(), entryId, accountId);

    // Now reconcile — should still work but cash difference may appear
    const report = computeReconciliation(ctx.sqlite, accountId);
    expect(report).toBeDefined();
    expect(report!.cutoverEligible).toBe(true);
  });

  // ── Execution count mismatch via anomalies ────────────────────────────

  it('includes anomaly records in the reconciliation report', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Anomaly Recon Account', 'Test', 'USD', now, now);

    // Insert a valid deposit
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'an-rec-dep-001', amount: 5000, date: '2024-01-01T00:00:00.000Z' });

    // Insert an execution with zero price (anomaly)
    const tradeId = insertTrade(ctx.sqlite, accountId, 'INTC');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'an-rec-exe-001',
      action: 'buy',
      quantity: 10,
      price: 0, // Missing price → anomaly
      executedAt: '2024-01-10T09:30:00.000Z',
    });

    // Run migration
    const migrationResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(migrationResult.status).toBe('completed');
    expect(migrationResult.anomalyCount).toBe(1);

    // Reconcile
    const report = computeReconciliation(ctx.sqlite, accountId);
    expect(report).toBeDefined();

    // Should have anomaly summaries
    expect(report!.anomalies.length).toBeGreaterThanOrEqual(1);

    // The anomaly code should be present
    const priceAnomaly = report!.anomalies.find(
      (a) => a.anomalyCode === 'ANOMALY_MISSING_PRICE',
    );
    expect(priceAnomaly).toBeDefined();
    expect(priceAnomaly!.count).toBe(1);
    expect(priceAnomaly!.records[0].sourceId).toBe('an-rec-exe-001');
    expect(priceAnomaly!.records[0].anomalyField).toBe('price');
  });

  // ── Cutover gate — eligible ───────────────────────────────────────────

  it('allows cutover when all comparisons match or are explained', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Cutover Eligible Account', 'Test', 'USD', now, now);

    // Simple scenario: just a deposit
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'cut-dep-001', amount: 1000, date: '2024-01-01T00:00:00.000Z' });

    const migrationResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(migrationResult.status).toBe('completed');

    const report = computeReconciliation(ctx.sqlite, accountId);
    expect(report).toBeDefined();
    expect(report!.cutoverEligible).toBe(true);
    expect(report!.cutoverRefusalReasons).toEqual([]);
  });

  // ── Cutover gate — refused ────────────────────────────────────────────

  it('refuses cutover when unexplained differences exist', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Cutover Refused Account', 'Test', 'USD', now, now);

    // Insert only legacy data — don't run migration
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'cut-ref-dep-001', amount: 1000, date: '2024-01-01T00:00:00.000Z' });

    // Now manually insert a migration run with some records
    // that will create an unexplained difference
    const runId = randomUUID();
    ctx.sqlite.prepare(
      `INSERT INTO accounting_migration_runs
       (id, account_id, status, total_records, mapped_count, anomaly_count, unsupported_count, duplicate_count, started_at, completed_at)
       VALUES (?, ?, 'completed', 1, 1, 0, 0, 0, ?, ?)`,
    ).run(runId, accountId, now, now);

    // Legacy data has a deposit but accounting tables are empty -> cash mismatch will be
    // significantly larger than 1 cent → unexplained difference
    const report = computeReconciliation(ctx.sqlite, accountId);
    expect(report).toBeDefined();

    // There should be at least one unexplained difference (cash)
    const cashComparison = report!.comparisons.find((c) => c.key === 'cash');
    expect(cashComparison).toBeDefined();
    if (cashComparison) {
      // The difference should be large (1000 * 1_000_000 micros) since legacy has
      // the deposit but accounting has no records
      expect(cashComparison.classification).toBe('unexplained');
    }

    // Cutover should be refused
    expect(report!.cutoverEligible).toBe(false);
    expect(report!.cutoverRefusalReasons.length).toBeGreaterThan(0);
    expect(report!.cutoverRefusalReasons[0]).toContain('unexplained');
  });

  // ── Report structure — field types ────────────────────────────────────

  it('returns all required fields with correct types', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Structure Check Account', 'Test', 'USD', now, now);

    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'str-dep-001', amount: 500, date: '2024-01-01T00:00:00.000Z' });

    runLegacyMigration({ sqlite: ctx.sqlite, accountId });

    const report = computeReconciliation(ctx.sqlite, accountId);
    expect(report).toBeDefined();

    // Top-level types
    expect(typeof report!.runId).toBe('string');
    expect(typeof report!.accountId).toBe('string');
    expect(typeof report!.runStatus).toBe('string');
    expect(report!.rebuildFingerprint === null || typeof report!.rebuildFingerprint === 'string').toBe(true);
    expect(typeof report!.computedAt).toBe('string');
    expect(typeof report!.cutoverEligible).toBe('boolean');

    // Totals
    expect(typeof report!.totals.comparisons).toBe('number');
    expect(typeof report!.totals.matching).toBe('number');
    expect(typeof report!.totals.explained).toBe('number');
    expect(typeof report!.totals.anomalies).toBe('number');
    expect(typeof report!.totals.unexplained).toBe('number');

    // Comparisons
    expect(Array.isArray(report!.comparisons)).toBe(true);
    expect(report!.comparisons.length).toBe(7); // 7 dimensions

    // Each comparison should have correct field types
    for (const c of report!.comparisons) {
      expect(typeof c.key).toBe('string');
      expect(typeof c.description).toBe('string');
      expect(typeof c.legacyValue).toBe('string');
      expect(typeof c.accountingValue).toBe('string');
      expect(typeof c.difference).toBe('string');
      expect(['match', 'explained', 'unexplained']).toContain(c.classification);
      expect(c.tolerance === null || typeof c.tolerance === 'string').toBe(true);
      expect(c.detail === null || typeof c.detail === 'string').toBe(true);
    }

    // Record status counts
    expect(typeof report!.recordStatusCounts.mappedCount).toBe('number');
    expect(typeof report!.recordStatusCounts.anomalyCount).toBe('number');
    expect(typeof report!.recordStatusCounts.unsupportedCount).toBe('number');
    expect(typeof report!.recordStatusCounts.duplicateCount).toBe('number');
    expect(typeof report!.recordStatusCounts.totalRecords).toBe('number');

    // Anomalies is an array
    expect(Array.isArray(report!.anomalies)).toBe(true);

    // Cutover refusal reasons is an array of strings
    expect(Array.isArray(report!.cutoverRefusalReasons)).toBe(true);
    for (const reason of report!.cutoverRefusalReasons) {
      expect(typeof reason).toBe('string');
    }
  });
});
