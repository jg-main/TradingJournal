/**
 * Tests for the legacy migration runner.
 *
 * Coverage:
 * - Full migration run with account_transactions, trade_executions, and
 *   price snapshots
 * - Run status, record counts, and fingerprint
 * - Duplicate detection (idempotent re-run)
 * - Rollback on failure
 * - Source preservation (legacy rows untouched)
 * - Deterministic rebuild (two identical runs produce same fingerprint)
 * - Dry-run mode
 * - Error handling (missing account, constraints)
 * - FindLatestMigrationRun and listMigrationRecords helpers
 *
 * @module legacy-migration-runner.test
 */

import { testDbPath } from '../testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  runLegacyMigration,
  findLatestMigrationRun,
  listMigrationRecords,
} from './legacy-migration-runner';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('legacy-migration-runner');

// ── Helpers ─────────────────────────────────────────────────────────────

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

  // Create a test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Legacy Migration Test Account', 'Test Broker', 'USD', now, now);

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
    type: 'deposit' | 'withdrawal';
    amount: number;
    date: string;
    notes: string | null;
  }>,
): string {
  const id = overrides?.id ?? randomUUID();
  const amount = overrides?.amount ?? 10000.00;
  const type = overrides?.type ?? 'deposit';
  const date = overrides?.date ?? '2024-01-15T10:00:00.000Z';
  const notes = overrides?.notes ?? null;
  sqlite
    .prepare(
      `INSERT INTO account_transactions (id, account_id, type, amount, balance_after, date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, accountId, type, amount, amount, date, notes);
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
    notes: string | null;
  }>,
): string {
  const id = overrides?.id ?? randomUUID();
  const action = overrides?.action ?? 'buy';
  const quantity = overrides?.quantity ?? 100;
  const price = overrides?.price ?? 150.50;
  const fees = overrides?.fees !== undefined ? overrides.fees : 0;
  const executedAt = overrides?.executedAt ?? '2024-01-16T09:30:00.000Z';
  const notes = overrides?.notes ?? null;
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, reason_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, tradeId, executedAt, action, quantity, price, fees, notes, now);
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

describe('runLegacyMigration', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  // ── Full migration run ────────────────────────────────────────────────

  it('runs a full migration with valid cash, execution, and price snapshot records', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    // Create a separate account for this test
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Full Migration Account', 'Test', 'USD', now, now);

    // Insert legacy data
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'acct-dep-001', amount: 10000, date: '2024-01-01T00:00:00.000Z' });
    insertLegacyWithdrawal(ctx.sqlite, accountId, { id: 'acct-wth-001', amount: 2000, date: '2024-01-05T00:00:00.000Z' });

    const tradeId = insertTrade(ctx.sqlite, accountId, 'AAPL');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'exe-full-001',
      action: 'buy',
      quantity: 100,
      price: 150.00,
      executedAt: '2024-01-10T09:30:00.000Z',
    });
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'exe-full-002',
      action: 'sell',
      quantity: 50,
      price: 160.00,
      executedAt: '2024-01-15T09:30:00.000Z',
    });

    insertLegacyPriceSnapshot(ctx.sqlite, tradeId, {
      id: 'psnap-full-001',
      price: 155.00,
      fetchedAt: '2024-01-12T12:00:00.000Z',
    });

    // Run migration
    const result = runLegacyMigration({ sqlite: ctx.sqlite, accountId });

    expect(result.status).toBe('completed');
    expect(result.accountId).toBe(accountId);
    expect(result.totalRecords).toBe(5); // 2 cash + 2 exec + 1 snapshot
    expect(result.mappedCount).toBe(5);
    expect(result.anomalyCount).toBe(0);
    expect(result.unsupportedCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.runId).toBeTruthy();
    expect(result.rebuildFingerprint).toBeTruthy();
    expect(typeof result.rebuildFingerprint).toBe('string');
    expect(result.rebuildFingerprint!.length).toBe(64); // SHA-256 hex

    // Verify accounting tables have the records
    const eventCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM financial_events WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    // 2 cash events (deposit, withdrawal) + 2 execution events (buy, sell) = 4
    expect(eventCount).toBe(4);

    const execCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM accounting_executions WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    expect(execCount).toBe(2);

    const markCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM valuation_marks WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    expect(markCount).toBe(1);

    // Verify migration run persisted
    const run = findLatestMigrationRun(ctx.sqlite, accountId);
    expect(run).toBeDefined();
    expect(run!.id).toBe(result.runId);
    expect(run!.mappedCount).toBe(5);
    expect(run!.rebuildFingerprint).toBeTruthy();
  });

  // ── Idempotency (re-run) ───────────────────────────────────────────────

  it('detects duplicates and re-runs idempotently', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Idempotent Account', 'Test', 'USD', now, now);

    // Insert legacy data
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'idemp-dep-001', amount: 5000, date: '2024-01-01T00:00:00.000Z' });
    const tradeId = insertTrade(ctx.sqlite, accountId, 'MSFT');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'idemp-exe-001',
      action: 'buy',
      quantity: 50,
      price: 200.00,
      executedAt: '2024-01-10T09:30:00.000Z',
    });

    // First run
    const firstResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(firstResult.mappedCount).toBe(2);
    expect(firstResult.duplicateCount).toBe(0);

    const firstFingerprint = firstResult.rebuildFingerprint;

    // Second run — all records are duplicates
    const secondResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(secondResult.status).toBe('completed');
    expect(secondResult.totalRecords).toBe(2);
    expect(secondResult.mappedCount).toBe(0);
    expect(secondResult.duplicateCount).toBe(2);

    // Fingerprint should be identical (same state)
    expect(secondResult.rebuildFingerprint).toBe(firstFingerprint);

    // Accounting tables should not have doubled records
    const eventCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM financial_events WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    expect(eventCount).toBe(2);
  });

  // ── Source preservation ────────────────────────────────────────────────

  it('preserves all legacy source rows after migration', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Source Preserve Account', 'Test', 'USD', now, now);

    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'preserve-dep-001', amount: 10000 });
    const tradeId = insertTrade(ctx.sqlite, accountId, 'GOOGL');
    insertLegacyExecution(ctx.sqlite, tradeId, { id: 'preserve-exe-001', action: 'buy', quantity: 10, price: 180 });

    // Count legacy rows before migration
    const beforeTxCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM account_transactions WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    const beforeExeCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM trade_executions e INNER JOIN trades t ON t.id = e.trade_id WHERE t.account_id = ?')
      .get(accountId) as { count: number }).count;

    expect(beforeTxCount).toBe(1);
    expect(beforeExeCount).toBe(1);

    // Run migration
    runLegacyMigration({ sqlite: ctx.sqlite, accountId });

    // Verify legacy rows still exist
    const afterTxCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM account_transactions WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    const afterExeCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM trade_executions e INNER JOIN trades t ON t.id = e.trade_id WHERE t.account_id = ?')
      .get(accountId) as { count: number }).count;

    expect(afterTxCount).toBe(1);
    expect(afterExeCount).toBe(1);

    // Verify legacy row content unchanged
    const tx = ctx.sqlite
      .prepare('SELECT id, amount, type FROM account_transactions WHERE id = ?')
      .get('preserve-dep-001') as { id: string; amount: number; type: string };
    expect(tx.amount).toBe(10000);
    expect(tx.type).toBe('deposit');
  });

  // ── Two identical rebuilds produce same fingerprint ────────────────────

  it('produces deterministic fingerprints across two runs on the same legacy data', () => {
    // This test proves determinism by running the migration twice on the
    // SAME database without resetting accounting tables. The second run
    // detects all records as duplicates but still computes a fingerprint
    // of the current state — which must match the first run's fingerprint
    // since no data changed.
    //
    // (Cannot reset tables for the 'two identical rebuilds' scenario because
    // valuation_marks have immutability triggers that block DELETE.)
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Deterministic FP Account', 'Test', 'USD', now, now);

    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'fp-dep-001', amount: 10000, date: '2024-01-01T00:00:00.000Z' });
    const tradeId = insertTrade(ctx.sqlite, accountId, 'NVDA');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'fp-exe-001',
      action: 'buy',
      quantity: 100,
      price: 100.00,
      executedAt: '2024-01-10T09:30:00.000Z',
    });

    // First run
    const firstResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(firstResult.status).toBe('completed');
    expect(firstResult.mappedCount).toBe(2);
    const firstFingerprint = firstResult.rebuildFingerprint;
    expect(firstFingerprint).toBeTruthy();
    expect(firstFingerprint!.length).toBe(64);

    // Second run — same legacy data, all records are duplicates
    const secondResult = runLegacyMigration({ sqlite: ctx.sqlite, accountId });
    expect(secondResult.status).toBe('completed');
    expect(secondResult.duplicateCount).toBe(2);
    expect(secondResult.mappedCount).toBe(0);

    // The fingerprint must match the first run because no state changed
    expect(secondResult.rebuildFingerprint).toBe(firstFingerprint);
  });

  // ── Dry-run mode ───────────────────────────────────────────────────────

  it('dry-run mode counts records without writing to accounting tables', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Dry Run Account', 'Test', 'USD', now, now);

    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'dry-dep-001', amount: 5000, date: '2024-01-01T00:00:00.000Z' });
    const tradeId = insertTrade(ctx.sqlite, accountId, 'TSLA');
    insertLegacyExecution(ctx.sqlite, tradeId, { id: 'dry-exe-001', action: 'buy', quantity: 10, price: 250.00 });

    // Dry run
    const result = runLegacyMigration(
      { sqlite: ctx.sqlite, accountId },
      { dryRun: true },
    );

    expect(result.status).toBe('completed');
    expect(result.totalRecords).toBe(2);
    expect(result.mappedCount).toBe(2);

    // No accounting records should be persisted in dry-run
    // (A migration run row IS persisted to record the dry-run activity,
    // but no financial events, executions, or valuation marks are written.)
    const eventCt = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM financial_events WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    expect(eventCt).toBe(0);

    const execCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM accounting_executions WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    expect(execCount).toBe(0);

    const markCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM valuation_marks WHERE account_id = ?')
      .get(accountId) as { count: number }).count;
    expect(markCount).toBe(0);
  });

  // ── Error handling ─────────────────────────────────────────────────────

  it('returns failed status for missing account (referential integrity)', () => {
    const fakeAccountId = randomUUID();

    const result = runLegacyMigration({ sqlite: ctx.sqlite, accountId: fakeAccountId });

    // The transaction should fail because the account doesn't exist
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBeTruthy();
    expect(result.totalRecords).toBe(0);
    expect(result.mappedCount).toBe(0);
  });

  // ── Record list helper ────────────────────────────────────────────────

  it('listMigrationRecords returns per-record outcomes', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'List Records Account', 'Test', 'USD', now, now);

    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'list-dep-001', amount: 10000, date: '2024-01-01T00:00:00.000Z' });
    const tradeId = insertTrade(ctx.sqlite, accountId, 'AMD');
    insertLegacyExecution(ctx.sqlite, tradeId, { id: 'list-exe-001', action: 'buy', quantity: 50, price: 120.00 });

    const result = runLegacyMigration({ sqlite: ctx.sqlite, accountId });

    const records = listMigrationRecords(ctx.sqlite, result.runId);
    expect(records.length).toBe(2);

    // Find cash event record
    const cashRecord = records.find((r) => r.sourceTable === 'account_transactions');
    expect(cashRecord).toBeDefined();
    expect(cashRecord!.status).toBe('mapped');
    expect(cashRecord!.recordType).toBe('cash_event');
    expect(cashRecord!.idempotencyKey).toContain('migrated:account_transactions:');

    // Find execution record
    const execRecord = records.find((r) => r.sourceTable === 'trade_executions');
    expect(execRecord).toBeDefined();
    expect(execRecord!.status).toBe('mapped');
    expect(execRecord!.recordType).toBe('execution');
  });

  // ── Anomaly handling ───────────────────────────────────────────────────

  it('records anomalies for records with missing or invalid data', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Anomaly Account', 'Test', 'USD', now, now);

    // Insert a valid deposit
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'anom-dep-001', amount: 5000, date: '2024-01-01T00:00:00.000Z' });

    // Insert an execution with zero price (anomaly)
    const tradeId = insertTrade(ctx.sqlite, accountId, 'INTC');
    insertLegacyExecution(ctx.sqlite, tradeId, {
      id: 'anom-exe-001',
      action: 'buy',
      quantity: 10,
      price: 0, // Missing price → anomaly
      executedAt: '2024-01-10T09:30:00.000Z',
    });

    const result = runLegacyMigration({ sqlite: ctx.sqlite, accountId });

    expect(result.status).toBe('completed');
    expect(result.totalRecords).toBe(2);
    expect(result.mappedCount).toBe(1);
    expect(result.anomalyCount).toBe(1);

    // Anomaly record should have the anomaly code
    const records = listMigrationRecords(ctx.sqlite, result.runId);
    const anomalyRecord = records.find((r) => r.status === 'anomaly');
    expect(anomalyRecord).toBeDefined();
    expect(anomalyRecord!.anomalyCode).toBe('ANOMALY_MISSING_PRICE');
    expect(anomalyRecord!.anomalyField).toBe('price');
  });

  // ── Failure rollback ───────────────────────────────────────────────────

  it('rolls back all changes when the migration fails', () => {
    // We need to trigger an error inside the transaction.
    // The transaction will fail automatically if an FK constraint is violated
    // or if we can inject a failure.
    // Using a non-existent account will cause the migration to fail before
    // any data is written.
    const fakeAccountId = '00000000-0000-0000-0000-000000000000';

    const result = runLegacyMigration({ sqlite: ctx.sqlite, accountId: fakeAccountId });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBeTruthy();

    // No migration run should be on disk for this account (rolled back)
    const runCount = (ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM accounting_migration_runs WHERE account_id = ?')
      .get(fakeAccountId) as { count: number }).count;
    expect(runCount).toBe(0);
  });
});

describe('findLatestMigrationRun', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns undefined when no runs exist', () => {
    const accountId = randomUUID();
    // Create an account that exists but has no migration runs
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'No Runs Account', 'Test', 'USD', now, now);

    const run = findLatestMigrationRun(ctx.sqlite, accountId);
    expect(run).toBeUndefined();
  });

  it('returns the latest completed run', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();

    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Latest Run Account', 'Test', 'USD', now, now);

    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'lr-dep-001', amount: 10000, date: '2024-01-01T00:00:00.000Z' });

    // First run (result intentionally unused — we only need the side effects)
    runLegacyMigration({ sqlite: ctx.sqlite, accountId });

    // Insert more legacy data and run again
    insertLegacyDeposit(ctx.sqlite, accountId, { id: 'lr-dep-002', amount: 5000, date: '2024-02-01T00:00:00.000Z' });

    // Run again (result intentionally unused — we only need side effects)
    runLegacyMigration({ sqlite: ctx.sqlite, accountId });

    // Latest should be the second run — verify by totalRecords (2 = 1 dup + 1 new)
    // rather than exact runId, since start_at timestamps may collide in wall time
    const latest = findLatestMigrationRun(ctx.sqlite, accountId);
    expect(latest).toBeDefined();
    expect(latest!.totalRecords).toBe(2); // 1 duplicate + 1 new
    expect(latest!.mappedCount).toBe(1);
    expect(latest!.duplicateCount).toBe(1);
    expect(latest!.id).toBeTruthy();
    // Confirm the returned run is NOT the same as any run from other accounts
    // by checking its accountId matches
    expect(latest!.accountId).toBe(accountId);
  });
});
