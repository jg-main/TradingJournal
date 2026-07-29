/**
 * Tests for the Dashboard V2 aggregation library.
 *
 * Coverage:
 * - Unknown account returns undefined
 * - Healthy account with complete performance + reconciliation + marks
 * - Missing valuation marks (no marks posted)
 * - Non-eligible reconciliation (unexplained differences)
 * - Journal attribution separation (with and without journal_trade_id)
 * - Mark freshness/stale classification
 * - Account without any accounting data (empty state)
 *
 * @module accounting/dashboard-v2.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { computeDashboardV2 } from './dashboard-v2';
import { postOpeningBalance } from './posting';
import type { CanonicalDecimal } from './types';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = './.test-dashboard-v2.db';

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
          // Skip errors from repeated runs
        }
      }
    }
  }
}

interface TestContext {
  sqlite: Database.Database;
  healthyAccountId: string;
  noMarksAccountId: string;
  unknownAccountId: string;
}

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  applyAllMigrations(sqlite);

  const now = new Date().toISOString();
  const healthyAccountId = randomUUID();
  const noMarksAccountId = randomUUID();
  const unknownAccountId = '00000000-0000-0000-0000-000000009999';

  const insertAccount = sqlite.prepare(
    `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );

  insertAccount.run(healthyAccountId, 'Healthy Account', 'Test Broker', 'USD', now, now);
  insertAccount.run(noMarksAccountId, 'No Marks Account', 'Test Broker', 'USD', now, now);

  return { sqlite, healthyAccountId, noMarksAccountId, unknownAccountId };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

/**
 * Seed a complete healthy accounting state for an account:
 * - Opening balance via posting kernel
 * - An instrument
 * - Accounting executions (one with journal link, one without)
 * - Valuation marks (fresh)
 * - Account positions
 * - Account performance projection
 */
function seedHealthyAccount(
  sqlite: Database.Database,
  accountId: string,
): void {
  const now = new Date().toISOString();

  // 1. Post opening balance
  postOpeningBalance(sqlite, {
    accountId,
    amount: '10000.00',
    idempotencyKey: randomUUID(),
    description: 'Initial funding',
  });

  // 2. Create an instrument
  const instrumentId = randomUUID();
  const aaplId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
    )
    .run(instrumentId, 'AAPL', 'Apple Inc.', 'stock', now, now);
  sqlite
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
    )
    .run(aaplId, 'MSFT', 'Microsoft Corp.', 'stock', now, now);

  // 3. Insert accounting executions (one with journal link, one without)
  const exec1Id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
       (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
        journal_trade_id, description, posted_at)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      exec1Id,
      accountId,
      instrumentId,
      '10.00',
      '150.00',
      '5.00',
      null,
      randomUUID(),
      'Buy 10 AAPL via journal',
      now,
    );

  const exec2Id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
       (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
        journal_trade_id, description, posted_at)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      exec2Id,
      accountId,
      instrumentId,
      '5.00',
      '155.00',
      '3.00',
      null,
      null,
      'Buy 5 AAPL direct (no journal)',
      now,
    );

  const exec3Id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
       (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
        journal_trade_id, description, posted_at)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      exec3Id,
      accountId,
      aaplId,
      '20.00',
      '350.00',
      '10.00',
      null,
      null,
      'Buy 20 MSFT direct (no journal)',
      now,
    );

  // 4. Insert valuation marks (fresh)
  const markTimestamp = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
  sqlite
    .prepare(
      `INSERT INTO valuation_marks
       (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
       VALUES (?, ?, ?, '152.00', 152000000, 'user', ?)`,
    )
    .run(randomUUID(), accountId, instrumentId, markTimestamp);

  sqlite
    .prepare(
      `INSERT INTO valuation_marks
       (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
       VALUES (?, ?, ?, '355.00', 355000000, 'user', ?)`,
    )
    .run(randomUUID(), accountId, aaplId, markTimestamp);

  // 5. Insert account positions
  const position1Id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, 'long', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      position1Id,
      accountId,
      instrumentId,
      '15.00',
      '151.66666667',
      '2275.00',
      '0.00',
      '0.00',
      '0.00',
      now,
      now,
      now,
    );

  const position2Id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, 'long', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      position2Id,
      accountId,
      aaplId,
      '20.00',
      '350.00',
      '7000.00',
      '0.00',
      '0.00',
      '0.00',
      now,
      now,
      now,
    );

  // 6. Insert account performance projection
  const perfId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO account_performance
       (id, account_id, computed_as_of, net_cash, nav, marked_positions,
        realized_pnl, unrealized_pnl, total_pnl, realized_fees,
        gross_exposure, net_exposure, modified_dietz_return, twr,
        high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
        rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      perfId,
      accountId,
      now,
      '9982.00',
      '17280.00',
      '7298.00',
      '0.00',
      '42.50',
      '42.50',
      '8.00',
      '7298.00',
      '7298.00',
      null,
      null,
      null,
      null,
      null,
      '[]',
      JSON.stringify([
        {
          instrumentId,
          direction: 'long',
          quantity: '15.00',
          averageCost: '151.66666667',
          totalCostBasis: '2275.00',
          realizedPnl: '0.00',
          realizedFees: '0.00',
          realizedNetPnl: '0.00',
          markPrice: '152.00',
          markStatus: 'fresh',
          markedValue: '2280.00',
          unrealizedPnl: '5.00',
          markTimestamp,
          markSource: 'user',
          markAgeMinutes: 1,
        },
        {
          instrumentId: aaplId,
          direction: 'long',
          quantity: '20.00',
          averageCost: '350.00',
          totalCostBasis: '7000.00',
          realizedPnl: '0.00',
          realizedFees: '0.00',
          realizedNetPnl: '0.00',
          markPrice: '355.00',
          markStatus: 'fresh',
          markedValue: '7100.00',
          unrealizedPnl: '100.00',
          markTimestamp,
          markSource: 'user',
          markAgeMinutes: 1,
        },
      ]),
      1,
      now,
      now,
      now,
    );
}

/**
 * Seed an account with no valuation marks (missing marks).
 */
function seedNoMarksAccount(
  sqlite: Database.Database,
  accountId: string,
): void {
  const now = new Date().toISOString();

  // 1. Post opening balance
  postOpeningBalance(sqlite, {
    accountId,
    amount: '5000.00',
    idempotencyKey: randomUUID(),
    description: 'Initial funding',
  });

  // 2. Create an instrument
  const instrumentId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
    )
    .run(instrumentId, 'GOOGL', 'Alphabet Inc.', 'stock', now, now);

  // 3. Insert accounting execution (no journal link)
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
       (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
        journal_trade_id, description, posted_at)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      instrumentId,
      '10.00',
      '180.00',
      '2.00',
      null,
      null,
      'Buy 10 GOOGL direct',
      now,
    );

  // 4. Insert account position (no valuation marks)
  sqlite
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, 'long', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      instrumentId,
      '10.00',
      '180.00',
      '1800.00',
      '0.00',
      '0.00',
      '0.00',
      now,
      now,
      now,
    );

  // 5. Insert account performance projection (no marks → unrealizedPnl null)
  const perfId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO account_performance
       (id, account_id, computed_as_of, net_cash, nav, marked_positions,
        realized_pnl, unrealized_pnl, total_pnl, realized_fees,
        gross_exposure, net_exposure, modified_dietz_return, twr,
        high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
        rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      perfId,
      accountId,
      now,
      '4998.00',
      '4998.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '2.00',
      '0.00',
      '0.00',
      null,
      null,
      null,
      null,
      null,
      JSON.stringify(['No open positions with valid valuation marks.']),
      JSON.stringify([
        {
          instrumentId,
          direction: 'long',
          quantity: '10.00',
          averageCost: '180.00',
          totalCostBasis: '1800.00',
          realizedPnl: '0.00',
          realizedFees: '0.00',
          realizedNetPnl: '0.00',
          markPrice: null,
          markStatus: 'missing',
          markedValue: null,
          unrealizedPnl: null,
          markTimestamp: null,
          markSource: null,
          markAgeMinutes: null,
        },
      ]),
      1,
      now,
      now,
      now,
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('computeDashboardV2', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
    seedHealthyAccount(ctx.sqlite, ctx.healthyAccountId);
    seedNoMarksAccount(ctx.sqlite, ctx.noMarksAccountId);
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  it('returns undefined for unknown account', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.unknownAccountId);
    expect(result).toBeUndefined();
  });

  it('returns a complete response for a healthy account', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.healthyAccountId);
    expect(result).toBeDefined();

    // Account info
    expect(result!.account.id).toBe(ctx.healthyAccountId);
    expect(result!.account.name).toBe('Healthy Account');
    expect(result!.account.currency).toBe('USD');

    // Metrics
    expect(result!.metrics.cash).toBe('9982.00');
    expect(result!.metrics.nav).toBe('17280.00');
    expect(result!.metrics.markedPositions).toBe('7298.00');
    expect(result!.metrics.realizedPnl).toBe('0.00');
    expect(result!.metrics.unrealizedPnl).toBe('42.50');
    expect(result!.metrics.totalPnl).toBe('42.50');
    expect(result!.metrics.realizedFees).toBe('8.00');
    expect(result!.metrics.grossExposure).toBe('7298.00');
    expect(result!.metrics.netExposure).toBe('7298.00');
    expect(result!.metrics.drawdown).toBeNull();
    expect(result!.metrics.drawdownPct).toBeNull();
    expect(result!.metrics.modifiedDietzReturn).toBeNull();
    expect(result!.metrics.twr).toBeNull();

    // Timestamp
    expect(result!.computedAt).toBeDefined();
    expect(typeof result!.computedAt).toBe('string');
  });

  it('reports valuation completeness with fresh/stale/missing counts', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.healthyAccountId);
    expect(result).toBeDefined();

    // Both positions have fresh marks (1 minute old marks)
    expect(result!.valuation.positionsTotal).toBe(2);
    expect(result!.valuation.fresh).toBe(2);
    expect(result!.valuation.stale).toBe(0);
    expect(result!.valuation.missing).toBe(0);
  });

  it('reports missing valuation marks as null rather than zero', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.noMarksAccountId);
    expect(result).toBeDefined();

    // One position with no marks
    expect(result!.valuation.positionsTotal).toBe(1);
    expect(result!.valuation.fresh).toBe(0);
    expect(result!.valuation.stale).toBe(0);
    expect(result!.valuation.missing).toBe(1);

    // Position should have null mark values
    const pos = result!.valuation.positions[0];
    expect(pos.markStatus).toBe('missing');
    expect(pos.markPrice).toBeNull();
    expect(pos.markedValue).toBeNull();
    expect(pos.unrealizedPnl).toBeNull();
    expect(pos.markTimestamp).toBeNull();
    expect(pos.markAgeMinutes).toBeNull();
  });

  it('separates journal attribution correctly', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.healthyAccountId);
    expect(result).toBeDefined();

    // 3 total executions: 1 with journal link, 2 without
    expect(result!.journalAttribution.hasJournalTrades).toBe(true);
    expect(result!.journalAttribution.journalExecutionCount).toBe(1);
    expect(result!.journalAttribution.accountOnlyExecutionCount).toBe(2);
  });

  it('reports no journal trades when all executions are direct', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.noMarksAccountId);
    expect(result).toBeDefined();

    // 1 execution, no journal link
    expect(result!.journalAttribution.hasJournalTrades).toBe(false);
    expect(result!.journalAttribution.journalExecutionCount).toBe(0);
    expect(result!.journalAttribution.accountOnlyExecutionCount).toBe(1);
  });

  it('reports reconciliation eligibility (unknown when no migration run)', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.healthyAccountId);
    expect(result).toBeDefined();

    // No migration run exists, so reconciliation is not eligible
    expect(result!.reconciliation.eligible).toBe(false);
    expect(result!.reconciliation.refusalReasons.length).toBeGreaterThan(0);
    expect(result!.reconciliation.comparisons).toBeNull();
    expect(result!.reconciliation.totals).toBeNull();
  });

  it('reports integrity status as healthy when no reconciliation warnings exist', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.healthyAccountId);
    expect(result).toBeDefined();

    // Reconciliation eligibility was removed from integrity — legacy cutover complete
    // A healthy account with all fresh marks has no warnings, so status is 'healthy'
    expect(result!.integrity.status).toBe('healthy');
    expect(result!.integrity.warnings.length).toBe(0);
  });

  it('reports integrity status as critical for missing marks', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.noMarksAccountId);
    expect(result).toBeDefined();

    expect(result!.integrity.status).toBe('critical');
    expect(
      result!.integrity.warnings.some((w) => w.includes('no valuation mark')),
    ).toBe(true);
  });

  it('includes per-position detail for each open position', () => {
    const result = computeDashboardV2(ctx.sqlite, ctx.healthyAccountId);
    expect(result).toBeDefined();
    expect(result!.valuation.positions.length).toBe(2);

    const aaplPos = result!.valuation.positions.find((p) => p.symbol === 'AAPL');
    expect(aaplPos).toBeDefined();
    expect(aaplPos!.direction).toBe('long');
    expect(aaplPos!.quantity).toBe('15.00');
    expect(aaplPos!.markStatus).toBe('fresh');
    expect(aaplPos!.markPrice).toBe('152.00');
    expect(aaplPos!.markAgeMinutes).toBeLessThanOrEqual(2);

    const msftPos = result!.valuation.positions.find((p) => p.symbol === 'MSFT');
    expect(msftPos).toBeDefined();
    expect(msftPos!.direction).toBe('long');
    expect(msftPos!.quantity).toBe('20.00');
    expect(msftPos!.markStatus).toBe('fresh');
    expect(msftPos!.markPrice).toBe('355.00');
  });

  it('handles an account with no accounting data gracefully', () => {
    // Create a fresh account with no data at all
    const emptyAccountId = randomUUID();
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(emptyAccountId, 'Empty Account', 'Test', 'USD', now, now);

    const result = computeDashboardV2(ctx.sqlite, emptyAccountId);
    expect(result).toBeDefined();
    expect(result!.account.id).toBe(emptyAccountId);

    // Metrics should be zero — no performance projection exists
    expect(result!.metrics.cash).toBe('0.00');
    expect(result!.metrics.nav).toBe('0.00');
    expect(result!.metrics.markedPositions).toBe('0.00');

    // No positions
    expect(result!.valuation.positionsTotal).toBe(0);
    expect(result!.valuation.fresh).toBe(0);
    expect(result!.valuation.stale).toBe(0);
    expect(result!.valuation.missing).toBe(0);
    expect(result!.valuation.positions.length).toBe(0);

    // No journal trades
    expect(result!.journalAttribution.hasJournalTrades).toBe(false);
    expect(result!.journalAttribution.journalExecutionCount).toBe(0);
    expect(result!.journalAttribution.accountOnlyExecutionCount).toBe(0);

    // Reconciliation not eligible
    expect(result!.reconciliation.eligible).toBe(false);
  });

  it('classifies stale marks correctly', () => {
    const staleAccountId = randomUUID();
    const now = new Date().toISOString();

    // Create account
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(staleAccountId, 'Stale Marks Account', 'Test', 'USD', now, now);

    // Post opening balance
    postOpeningBalance(ctx.sqlite, {
      accountId: staleAccountId,
      amount: '2000.00',
      idempotencyKey: randomUUID(),
    });

    // Create instrument
    const instrId = randomUUID();
    ctx.sqlite
      .prepare(
        `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
      )
      .run(instrId, 'TSLA', 'Tesla Inc.', 'stock', now, now);

    // Insert position
    ctx.sqlite
      .prepare(
        `INSERT INTO account_positions
         (id, account_id, instrument_id, direction, quantity, average_cost,
          total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
          last_updated, created_at, updated_at)
         VALUES (?, ?, ?, 'long', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        staleAccountId,
        instrId,
        '5.00',
        '250.00',
        '1250.00',
        '0.00',
        '0.00',
        '0.00',
        now,
        now,
        now,
      );

    // Insert a very old mark (5 days ago → stale)
    const oldTimestamp = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO valuation_marks
         (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
         VALUES (?, ?, ?, '260.00', 260000000, 'user', ?)`,
      )
      .run(randomUUID(), staleAccountId, instrId, oldTimestamp);

    // Insert performance projection for the stale account
    ctx.sqlite
      .prepare(
        `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions,
          realized_pnl, unrealized_pnl, total_pnl, realized_fees,
          gross_exposure, net_exposure, modified_dietz_return, twr,
          high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
          rebuild_count, last_rebuilt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        staleAccountId,
        now,
        '2000.00',
        '3300.00',
        '1300.00',
        '0.00',
        '50.00',
        '50.00',
        '0.00',
        '1300.00',
        '1300.00',
        null,
        null,
        null,
        null,
        null,
        '[]',
        JSON.stringify([
          {
            instrumentId: instrId,
            direction: 'long',
            quantity: '5.00',
            averageCost: '250.00',
            totalCostBasis: '1250.00',
            realizedPnl: '0.00',
            realizedFees: '0.00',
            realizedNetPnl: '0.00',
            markPrice: '260.00',
            markStatus: 'stale',
            markedValue: '1300.00',
            unrealizedPnl: '50.00',
            markTimestamp: oldTimestamp,
            markSource: 'user',
            markAgeMinutes: 7200,
          },
        ]),
        1,
        now,
        now,
        now,
      );

    // Use a very short freshness threshold to ensure stale classification
    const result = computeDashboardV2(ctx.sqlite, staleAccountId, {
      freshnessThresholdMinutes: 60, // 1 hour
    });

    expect(result).toBeDefined();
    expect(result!.valuation.positionsTotal).toBe(1);
    expect(result!.valuation.fresh).toBe(0);
    expect(result!.valuation.stale).toBe(1);
    expect(result!.valuation.missing).toBe(0);

    const pos = result!.valuation.positions[0];
    expect(pos.markStatus).toBe('stale');
    expect(pos.markPrice).toBe('260.00');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // MTM Refresh Integration Tests
  // ══════════════════════════════════════════════════════════════════════════

  it('reads fresh market_data valuation_marks written by MTM refresh', () => {
    // Simulates the full path: MTM refresh writes valuation_marks with
    // source="market_data" → V2 dashboard reads them via listLatestValuationMarks
    // → reports fresh marks with matching prices
    const accountId = randomUUID();
    const now = new Date().toISOString();
    const instrumentId = randomUUID();
    const tradeId = randomUUID();

    // Expected values matching what MTM refresh would write
    const markPrice = '152.50';
    const markPriceMicros = 152_500_000;
    const avgCost = '150.00';
    const quantity = '10.00';
    const totalCostBasis = '1500.00';
    // Expected unrealizedPnl = (markPrice - averageCost) × quantity
    //   = (152500000 - 150000000) × 10000000 / 1000000 micros
    //   = 2500000 × 10000000 / 1000000 = 25000000 micros = "25.00"
    const expectedUnrealizedPnl = '25.00';

    // ── 1. Create account ────────────────────────────────────────────────
    ctx.sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'MTM Refresh Test Account', 'Test', 'USD', now, now);

    // ── 2. Post opening balance ──────────────────────────────────────────
    postOpeningBalance(ctx.sqlite, {
      accountId,
      amount: '10000.00',
      idempotencyKey: randomUUID(),
      description: 'Initial funding',
    });

    // ── 3. Create instrument (matches the trade symbol) ───────────────────
    ctx.sqlite
      .prepare(
        `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
      )
      .run(instrumentId, 'META', 'Meta Platforms Inc.', 'stock', now, now);

    // ── 4. Create accounting execution (simulates the buy) ───────────────
    ctx.sqlite
      .prepare(
        `INSERT INTO accounting_executions
         (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
          journal_trade_id, description, posted_at)
         VALUES (?, ?, ?, 'buy', ?, ?, 0.00, ?, NULL, ?, ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, quantity, avgCost, randomUUID(), 'Buy 10 META', now);

    // ── 5. Create account position (10 META, avg cost $150) ──────────────
    const positionId = randomUUID();
    ctx.sqlite
      .prepare(
        `INSERT INTO account_positions
         (id, account_id, instrument_id, direction, quantity, average_cost,
          total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
          last_updated, created_at, updated_at)
         VALUES (?, ?, ?, 'long', ?, ?, ?, '0.00', '0.00', '0.00', ?, ?, ?)`,
      )
      .run(positionId, accountId, instrumentId, quantity, avgCost, totalCostBasis, now, now, now);

    // ── 6. Insert trade with current_price matching the mark (simulates MTM refresh) ─
    ctx.sqlite
      .prepare(
        `INSERT INTO trades
         (id, trade_code, account_id, symbol, direction, status, current_price,
          current_price_fetched_at, created_at, updated_at)
         VALUES (?, ?, ?, 'META', 'long', 'open', ?, ?, ?, ?)`,
      )
      .run(tradeId, `INT-TEST-${randomUUID().slice(0, 8)}`, accountId, 152.50, now, now, now);

    // ── 7. Insert a very fresh valuation mark (seconds old, source='market_data') ─
    // This simulates what the MTM refresh endpoint does after updating trades.current_price
    const markTimestamp = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `INSERT INTO valuation_marks
         (id, account_id, instrument_id, price, price_micros, source, mark_timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, 'market_data', ?, ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, markPrice, markPriceMicros, markTimestamp, now);

    // ── 8. Insert account performance projection ─────────────────────────
    const nav = (Number(totalCostBasis) + 10000 - Number(totalCostBasis)).toFixed(2); // $10,000 NAV (funded $10k, bought $1.5k)
    ctx.sqlite
      .prepare(
        `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions,
          realized_pnl, unrealized_pnl, total_pnl, realized_fees,
          gross_exposure, net_exposure, modified_dietz_return, twr,
          high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
          rebuild_count, last_rebuilt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        accountId,
        now,
        '8500.00',
        '10025.00',
        '1525.00',
        '0.00',
        expectedUnrealizedPnl,
        expectedUnrealizedPnl,
        '0.00',
        '1525.00',
        '1525.00',
        null,
        null,
        null,
        null,
        null,
        '[]',
        JSON.stringify([
          {
            instrumentId,
            direction: 'long',
            quantity,
            averageCost: avgCost,
            totalCostBasis,
            realizedPnl: '0.00',
            realizedFees: '0.00',
            realizedNetPnl: '0.00',
            markPrice,
            markStatus: 'fresh',
            markedValue: '1525.00',
            unrealizedPnl: expectedUnrealizedPnl,
            markTimestamp,
            markSource: 'market_data',
            markAgeMinutes: 0,
          },
        ]),
        1,
        now,
        now,
        now,
      );

    // ── 9. Call computeDashboardV2 (the V2 dashboard aggregation) ─────────
    const dashboard = computeDashboardV2(ctx.sqlite, accountId);
    expect(dashboard).toBeDefined();

    // ── 10. Verify mark age — must be < 1 minute (just written by MTM refresh) ─
    const metaPos = dashboard!.valuation.positions.find((p) => p.symbol === 'META');
    expect(metaPos).toBeDefined();
    expect(metaPos!.markStatus).toBe('fresh');
    expect(metaPos!.markAgeMinutes).toBeLessThan(1);

    // ── 11. Verify markPrice matches what MTM refresh wrote ──────────────
    expect(metaPos!.markPrice).toBe(markPrice);

    // ── 12. Verify unrealizedPnl = (markPrice - avgCost) × quantity ──────
    expect(metaPos!.unrealizedPnl).toBe(expectedUnrealizedPnl);
    expect(metaPos!.averageCost).toBe(avgCost);
    expect(metaPos!.quantity).toBe(quantity);

    // ── 13. Verify valuation completeness ───────────────────────────────
    expect(dashboard!.valuation.fresh).toBe(1);
    expect(dashboard!.valuation.stale).toBe(0);
    expect(dashboard!.valuation.missing).toBe(0);
    expect(dashboard!.valuation.positionsTotal).toBe(1);

    // ── 14. Verify integrity — fresh marks with no warnings → healthy ───
    expect(dashboard!.integrity.status).toBe('healthy');
    expect(dashboard!.integrity.warnings.length).toBe(0);

    // ── 15. Cross-check: markPrice matches trades.current_price ─────────
    // MTM refresh updates both trades.current_price and valuation_marks.price
    // to the same value. Verify they match.
    const trade = ctx.sqlite
      .prepare('SELECT current_price FROM trades WHERE id = ?')
      .get(tradeId) as { current_price: number | null };
    expect(trade.current_price).toBe(152.50);
    expect(Number(metaPos!.markPrice)).toBe(trade.current_price);

    // ── 16. Verify riskSummary.openPnl matches computed unrealized P&L ───
    // (riskSummary.openPnl is the sum of unrealizedPnl across all positions)
    expect(dashboard!.riskSummary.openPnl).toBe(expectedUnrealizedPnl);

    // ── 17. Verify the valuation_mark has source='market_data' (written by MTM refresh) ─
    const valuationMark = ctx.sqlite
      .prepare('SELECT source FROM valuation_marks WHERE account_id = ?')
      .get(accountId) as { source: string };
    expect(valuationMark.source).toBe('market_data');
  });
});
