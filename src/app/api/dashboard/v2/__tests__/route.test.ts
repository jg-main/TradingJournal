/**
 * Route tests for the Dashboard V2 API (GET)
 *
 * Tests the route logic by simulating it against a real SQLite database
 * with all migrations applied.
 *
 * Covers:
 * - Successful dashboard V2 for a healthy account (200)
 * - Account not found (400)
 * - Invalid query parameters (400)
 * - No account resolved (400)
 * - Dashboard response structure and field types
 * - Missing marks represented as null
 * - Journal attribution separation
 * - Reconciliation eligibility (unknown when no migration run)
 * - Integrity status
 *
 * Run: npx vitest run src/app/api/dashboard/v2/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { postOpeningBalance } from '@/lib/accounting/posting';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = './.test-dashboard-v2-route.db';

// ── Test Database Setup ─────────────────────────────────────────────────

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

function createTestDatabase(): Database.Database {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  applyAllMigrations(sqlite);

  return sqlite;
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

import { accountExists } from '@/db/accounting-repository';
import {
  ALL_DASHBOARD_V2_FIELDS,
  computeDashboardV2,
} from '@/lib/accounting/dashboard-v2';
import type { DashboardV2Field } from '@/lib/accounting/dashboard-v2';

function doGetDashboardV2(
  sqlite: Database.Database,
  overrides?: {
    accountId?: string;
    freshnessThresholdMinutes?: number;
    fields?: DashboardV2Field[];
  },
): RouteResult {
  try {
    const accountId = overrides?.accountId;

    if (!accountId) {
      // Simulate account resolution
      const setting = sqlite
        .prepare('SELECT default_account_id FROM settings LIMIT 1')
        .get() as { default_account_id: string | null } | undefined;

      const resolvedId = setting?.default_account_id ?? null;

      if (!resolvedId) {
        return {
          status: 400,
          body: {
            error: 'No account found',
            details:
              'No account specified and no default account or active account found. Create an account first.',
          },
        };
      }
    }

    if (accountId && !accountExists(sqlite, accountId)) {
      return {
        status: 400,
        body: {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
      };
    }

    if (!accountId) {
      return {
        status: 400,
        body: {
          error: 'No account found',
          details: '',
        },
      };
    }

    const dashboard = computeDashboardV2(sqlite, accountId, {
      freshnessThresholdMinutes: overrides?.freshnessThresholdMinutes,
      fields: overrides?.fields,
    });

    if (!dashboard) {
      return {
        status: 404,
        body: {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
      };
    }

    return { status: 200, body: dashboard as unknown as Record<string, unknown> };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: 'Failed to compute dashboard V2',
        details: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// ── Helpers for test data setup ────────────────────────────────────────

function seedHealthyAccount(
  sqlite: Database.Database,
  accountId: string,
  symbolSuffix?: string,
): void {
  const now = new Date().toISOString();

  // Post opening balance
  postOpeningBalance(sqlite, {
    accountId,
    amount: '10000.00',
    idempotencyKey: randomUUID(),
    description: 'Initial funding',
  });

  // Create instruments with unique symbols per test
  const suffix = symbolSuffix ?? randomUUID().slice(0, 6);
  const aaplId = randomUUID();
  const msftId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
    )
    .run(aaplId, 'AAPL' + suffix, 'Apple Inc.', 'stock', now, now);
  sqlite
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
    )
    .run(msftId, 'MSFT' + suffix, 'Microsoft Corp.', 'stock', now, now);

  // Insert accounting executions
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
       (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
        journal_trade_id, description, posted_at)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, aaplId, '10.00', '150.00', '5.00', null, randomUUID(), 'Buy 10 AAPL via journal', now);

  sqlite
    .prepare(
      `INSERT INTO accounting_executions
       (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
        journal_trade_id, description, posted_at)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, msftId, '20.00', '350.00', '10.00', null, null, 'Buy 20 MSFT direct', now);

  // Insert fresh valuation marks
  const markTimestamp = new Date(Date.now() - 60_000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO valuation_marks
       (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
       VALUES (?, ?, ?, '152.00', 152000000, 'user', ?)`,
    )
    .run(randomUUID(), accountId, aaplId, markTimestamp);
  sqlite
    .prepare(
      `INSERT INTO valuation_marks
       (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
       VALUES (?, ?, ?, '355.00', 355000000, 'user', ?)`,
    )
    .run(randomUUID(), accountId, msftId, markTimestamp);

  // Insert account positions
  sqlite
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, 'long', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, aaplId, '10.00', '150.00', '1500.00', '0.00', '5.00', '0.00', now, now, now);

  sqlite
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, 'long', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, msftId, '20.00', '350.00', '7000.00', '0.00', '10.00', '0.00', now, now, now);

  // Insert account performance projection
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
      randomUUID(),
      accountId,
      now,
      '9985.00',
      '17045.00',
      '7060.00',
      '0.00',
      '60.00',
      '60.00',
      '15.00',
      '7060.00',
      '7060.00',
      null,
      null,
      null,
      null,
      null,
      '[]',
      JSON.stringify([]),
      1,
      now,
      now,
      now,
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

let sqlite: Database.Database;

beforeAll(() => {
  sqlite = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(sqlite);
});

describe('GET /api/dashboard/v2', () => {
  // ── Account not found ─────────────────────────────────────────────────

  it('returns 400 for a non-existent account', () => {
    const fakeId = '00000000-0000-0000-0000-000000009999';
    const result = doGetDashboardV2(sqlite, { accountId: fakeId });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Account not found');
  });

  // ── No account resolved ───────────────────────────────────────────────

  it('returns 400 when no account can be resolved', () => {
    const result = doGetDashboardV2(sqlite);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('No account found');
  });

  // ── Successful dashboard for a healthy account ────────────────────────

  it('returns 200 with a complete dashboard for a healthy account', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Healthy Dashboard Route', 'Test Broker', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, { accountId });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // Account info
    const account = body.account as Record<string, unknown>;
    expect(account.id).toBe(accountId);
    expect(account.name).toBe('Healthy Dashboard Route');
    expect(account.currency).toBe('USD');

    // Metrics
    const metrics = body.metrics as Record<string, unknown>;
    expect(metrics.cash).toBe('9985.00');
    expect(metrics.nav).toBe('17045.00');
    expect(metrics.markedPositions).toBe('7060.00');
    expect(metrics.realizedPnl).toBe('0.00');
    expect(metrics.unrealizedPnl).toBe('60.00');
    expect(metrics.totalPnl).toBe('60.00');
    expect(metrics.realizedFees).toBe('15.00');
    expect(metrics.grossExposure).toBe('7060.00');
    expect(metrics.netExposure).toBe('7060.00');
    expect(metrics.drawdown).toBeNull();
    expect(metrics.drawdownPct).toBeNull();
    expect(metrics.modifiedDietzReturn).toBeNull();
    expect(metrics.twr).toBeNull();

    // Valuation
    const valuation = body.valuation as Record<string, unknown>;
    expect(valuation.positionsTotal).toBe(2);
    expect(valuation.fresh).toBe(2);
    expect(valuation.missing).toBe(0);
    expect(Array.isArray(valuation.positions)).toBe(true);
    expect((valuation.positions as Array<unknown>).length).toBe(2);

    // Journal attribution
    const journalAttribution = body.journalAttribution as Record<string, unknown>;
    expect(journalAttribution.hasJournalTrades).toBe(true);
    expect(journalAttribution.journalExecutionCount).toBe(1);
    expect(journalAttribution.accountOnlyExecutionCount).toBe(1);

    // Reconciliation (no migration run yet)
    const reconciliation = body.reconciliation as Record<string, unknown>;
    expect(reconciliation.eligible).toBe(false);
    expect(Array.isArray(reconciliation.refusalReasons)).toBe(true);
    expect(reconciliation.refusalReasons).toHaveLength(1);
    expect(reconciliation.comparisons).toBeNull();
    expect(reconciliation.totals).toBeNull();

    // Integrity — reconciliation eligibility was removed from integrity (legacy cutover complete)
    // A healthy account with all fresh marks has no warnings, so status is 'healthy'
    const integrity = body.integrity as { status: string; warnings: unknown[] };
    expect(integrity.status).toBe('healthy');
    expect(Array.isArray(integrity.warnings)).toBe(true);
    expect(integrity.warnings.length).toBe(0);

    // Risk summary: the account has two marked positions but no valid stops,
    // so current risk-to-stop and heat must remain unavailable rather than
    // presenting an incorrect zero-risk state.
    const riskSummary = body.riskSummary as Record<string, unknown>;
    expect(riskSummary.openPnl).toBe('120.00');
    expect(riskSummary.openRisk).toBe('0.00');
    expect(riskSummary.openRiskToStop).toBeNull();
    expect(riskSummary.portfolioHeat).toBeNull();
    expect(riskSummary.missingStops).toBe(2);
    expect(riskSummary.positionsWithStop).toBe(0);
    expect(riskSummary.stopCoverage).toMatchObject({
      openTrades: 0,
      positionsTotal: 2,
      withStop: 0,
      withoutStop: 2,
      state: 'partial',
    });

    // Timestamp
    expect(typeof body.computedAt).toBe('string');
  });

  // ── Response structure ────────────────────────────────────────────────

  it('returns a dashboard with all required top-level fields', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Struct Test Route', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, { accountId });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // Required top-level keys
    expect(body).toHaveProperty('snapshotId');
    expect(body).toHaveProperty('account');
    expect(body).toHaveProperty('scopes');
    expect(body).toHaveProperty('metrics');
    expect(body).toHaveProperty('valuation');
    expect(body).toHaveProperty('journalAttribution');
    expect(body).toHaveProperty('journalLinked');
    expect(body).toHaveProperty('reconciliation');
    expect(body).toHaveProperty('riskSummary');
    expect(body).toHaveProperty('integrity');
    expect(body).toHaveProperty('computedAt');

    // Journal-linked section structure: aggregate + provenance + comparisons
    const journalLinked = body.journalLinked as Record<string, unknown>;
    expect(typeof journalLinked.tradeCount).toBe('number');
    expect(typeof journalLinked.positionCount).toBe('number');
    expect(typeof journalLinked.remainingQty).toBe('string');
    expect(Array.isArray(journalLinked.comparisons)).toBe(true);
    const jlProvenance = journalLinked.provenance as Record<string, unknown>;
    expect(['complete', 'partial', 'unavailable']).toContain(jlProvenance.status);
    expect(jlProvenance.computedAt).toBe(body.computedAt);
    expect(jlProvenance.presentationLabel).toBeNull();

    // Snapshot envelope: deterministic snapshotId + scope declarations
    expect(typeof body.snapshotId).toBe('string');
    expect(body.snapshotId).toMatch(/^snap:/);
    const scopes = body.scopes as Record<string, Record<string, unknown>>;
    expect(scopes.accountPositions.section).toBe('valuation');
    expect(scopes.journalTrades.section).toBe('journalAttribution');
    expect(scopes.periodPerformance.section).toBe('metrics');

    // Account structure
    const account = body.account as Record<string, string>;
    expect(typeof account.id).toBe('string');
    expect(typeof account.name).toBe('string');
    expect(typeof account.currency).toBe('string');

    // Metrics structure — all values are strings or null
    const metrics = body.metrics as Record<string, unknown>;
    const metricKeys = [
      'cash', 'nav', 'markedPositions', 'realizedPnl', 'unrealizedPnl',
      'totalPnl', 'realizedFees', 'grossExposure', 'netExposure',
    ];
    for (const key of metricKeys) {
      expect(typeof metrics[key]).toBe('string');
    }

    // Nullable metrics
    expect(
      metrics.drawdown === null || typeof metrics.drawdown === 'string',
    ).toBe(true);
    expect(
      metrics.drawdownPct === null || typeof metrics.drawdownPct === 'string',
    ).toBe(true);

    // Valuation structure
    const valuation = body.valuation as Record<string, unknown>;
    expect(typeof valuation.positionsTotal).toBe('number');
    expect(typeof valuation.fresh).toBe('number');
    expect(typeof valuation.stale).toBe('number');
    expect(typeof valuation.missing).toBe('number');
    expect(['complete', 'partial', 'stale', 'unavailable']).toContain(valuation.state);
    expect(Array.isArray(valuation.positions)).toBe(true);
    // Per-position mark provenance must be present on every position
    for (const pos of valuation.positions as Array<Record<string, unknown>>) {
      expect(pos).toHaveProperty('markProvenance');
      const mp = pos.markProvenance as Record<string, unknown>;
      expect(typeof mp.source === 'string' || mp.source === null).toBe(true);
      expect(mp.computedAt).toBe(body.computedAt);
      expect(['fresh', 'stale', 'missing']).toContain(mp.status);
    }

    // Risk summary structure
    const rs = body.riskSummary as Record<string, unknown>;
    expect(typeof rs.openPnl).toBe('string');
    expect(typeof rs.openRisk).toBe('string');
    expect(rs.portfolioHeat === null || typeof rs.portfolioHeat === 'string').toBe(true);
    expect(typeof rs.missingStops).toBe('number');
    expect(typeof rs.positionsWithStop).toBe('number');
    expect(rs.openRiskToStop === null || typeof rs.openRiskToStop === 'string').toBe(true);
    expect(rs).toHaveProperty('stopCoverage');
    const stopCoverage = rs.stopCoverage as Record<string, unknown>;
    expect(['complete', 'partial']).toContain(stopCoverage.state);

    // Integrity structure
    const integrity = body.integrity as Record<string, unknown>;
    expect(['healthy', 'warning', 'critical', 'unknown']).toContain(integrity.status);
    expect(Array.isArray(integrity.warnings)).toBe(true);
  });

  // ── Missing marks as null ─────────────────────────────────────────────

  it('represents missing valuation marks as null', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Missing Marks Route', 'Test', 'USD', now, now);

    // Post opening balance
    postOpeningBalance(sqlite, {
      accountId,
      amount: '5000.00',
      idempotencyKey: randomUUID(),
    });

    // Create instrument
    const googlId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
      )
      .run(googlId, 'GOOGL', 'Alphabet Inc.', 'stock', now, now);

    // Insert position (no valuation marks)
    sqlite
      .prepare(
        `INSERT INTO account_positions
         (id, account_id, instrument_id, direction, quantity, average_cost,
          total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
          last_updated, created_at, updated_at)
         VALUES (?, ?, ?, 'long', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), accountId, googlId, '5.00', '180.00', '900.00', '0.00', '0.00', '0.00', now, now, now);

    // Insert performance projection
    sqlite
      .prepare(
        `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions,
          realized_pnl, unrealized_pnl, total_pnl, realized_fees,
          gross_exposure, net_exposure, modified_dietz_return, twr,
          high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
          rebuild_count, last_rebuilt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '0.00', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
    .run(
      randomUUID(),
      accountId,
      now,
      '5000.00',
      '5000.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      null,
      null,
      null,
      null,
      JSON.stringify(['No open positions with marks.']),
      JSON.stringify([]),
      1,
      now,
      now,
      now,
      now,
    );

    const result = doGetDashboardV2(sqlite, { accountId });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;
    const valuation = body.valuation as Record<string, unknown>;

    expect(valuation.positionsTotal).toBe(1);
    expect(valuation.fresh).toBe(0);
    expect(valuation.stale).toBe(0);
    expect(valuation.missing).toBe(1);

    const positions = valuation.positions as Array<Record<string, unknown>>;
    expect(positions[0].markStatus).toBe('missing');
    expect(positions[0].markPrice).toBeNull();
    expect(positions[0].markedValue).toBeNull();
    expect(positions[0].unrealizedPnl).toBeNull();
  });

  // ── Fields parameter ──────────────────────────────────────────────────

  it('returns only requested fields when fields parameter is specified', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Fields Test', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, {
      accountId,
      fields: ['riskSummary', 'valuation'],
    });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // Should have only riskSummary, valuation, and computedAt
    expect(body).toHaveProperty('riskSummary');
    expect(body).toHaveProperty('valuation');
    expect(body).toHaveProperty('computedAt');

    // Should NOT have these fields
    expect(body).not.toHaveProperty('account');
    expect(body).not.toHaveProperty('metrics');
    expect(body).not.toHaveProperty('journalAttribution');
    expect(body).not.toHaveProperty('reconciliation');
    expect(body).not.toHaveProperty('integrity');

    // Validate returned fields still have correct structure
    const valuation = body.valuation as Record<string, unknown>;
    expect(valuation.positionsTotal).toBe(2);

    const riskSummary = body.riskSummary as Record<string, unknown>;
    expect(riskSummary.openPnl).toBe('120.00');
    expect(typeof body.computedAt).toBe('string');
  });

  it('returns only a single requested field when fields has one element', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Single Field Test', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, {
      accountId,
      fields: ['account'],
    });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // Should have only account, the snapshot envelope, and computedAt
    expect(body).toHaveProperty('snapshotId');
    expect(body).toHaveProperty('scopes');
    expect(body).toHaveProperty('account');
    expect(body).toHaveProperty('computedAt');
    expect(Object.keys(body).length).toBe(4);

    // Should NOT have other fields
    expect(body).not.toHaveProperty('metrics');
    expect(body).not.toHaveProperty('valuation');
    expect(body).not.toHaveProperty('riskSummary');
    expect(body).not.toHaveProperty('integrity');

    const account = body.account as Record<string, string>;
    expect(account.name).toBe('Single Field Test');
  });

  it('returns full response when fields parameter is omitted (backward compatible)', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Omitted Fields Test', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    // Omit fields entirely
    const result = doGetDashboardV2(sqlite, { accountId });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // All 11 top-level keys should be present (8 sections + snapshotId, scopes, computedAt)
    expect(body).toHaveProperty('snapshotId');
    expect(body).toHaveProperty('account');
    expect(body).toHaveProperty('scopes');
    expect(body).toHaveProperty('metrics');
    expect(body).toHaveProperty('valuation');
    expect(body).toHaveProperty('journalAttribution');
    expect(body).toHaveProperty('journalLinked');
    expect(body).toHaveProperty('reconciliation');
    expect(body).toHaveProperty('riskSummary');
    expect(body).toHaveProperty('integrity');
    expect(body).toHaveProperty('computedAt');
    expect(Object.keys(body).length).toBe(11);
  });

  // ── Field combinations (MTM polling and must-have coverage) ─────────

  it('returns riskSummary, valuation, and metrics for a three-field combination (must-have)', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Three Field Combo', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, {
      accountId,
      fields: ['riskSummary', 'valuation', 'metrics'],
    });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // Should have only requested fields plus computedAt
    expect(body).toHaveProperty('riskSummary');
    expect(body).toHaveProperty('valuation');
    expect(body).toHaveProperty('metrics');
    expect(body).toHaveProperty('computedAt');

    // Should NOT have the non-requested fields
    expect(body).not.toHaveProperty('account');
    expect(body).not.toHaveProperty('journalAttribution');
    expect(body).not.toHaveProperty('reconciliation');
    expect(body).not.toHaveProperty('integrity');

    // Validate structure of returned fields
    const metrics = body.metrics as Record<string, unknown>;
    expect(metrics.cash).toBe('9985.00');
    expect(metrics.nav).toBe('17045.00');

    const valuation = body.valuation as Record<string, unknown>;
    expect(valuation.positionsTotal).toBe(2);

    const riskSummary = body.riskSummary as Record<string, unknown>;
    expect(riskSummary.openPnl).toBe('120.00');
    expect(typeof body.computedAt).toBe('string');
  });

  it('returns full response when all fields are explicitly listed', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'All Fields Explicit', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, {
      accountId,
      fields: [...ALL_DASHBOARD_V2_FIELDS],
    });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // All 11 top-level keys should be present (8 sections + snapshotId, scopes, computedAt)
    expect(body).toHaveProperty('snapshotId');
    expect(body).toHaveProperty('account');
    expect(body).toHaveProperty('scopes');
    expect(body).toHaveProperty('metrics');
    expect(body).toHaveProperty('valuation');
    expect(body).toHaveProperty('journalAttribution');
    expect(body).toHaveProperty('journalLinked');
    expect(body).toHaveProperty('reconciliation');
    expect(body).toHaveProperty('riskSummary');
    expect(body).toHaveProperty('integrity');
    expect(body).toHaveProperty('computedAt');
    expect(Object.keys(body).length).toBe(11);

    // Validate structural equivalence with full response
    const account = body.account as Record<string, unknown>;
    expect(account.name).toBe('All Fields Explicit');
  });

  it('returns a non-adjacent field combination (metrics, account, journalAttribution)', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Non-Adjacent Fields', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, {
      accountId,
      fields: ['metrics', 'account', 'journalAttribution'],
    });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // Should have only requested fields plus computedAt
    expect(body).toHaveProperty('metrics');
    expect(body).toHaveProperty('account');
    expect(body).toHaveProperty('journalAttribution');
    expect(body).toHaveProperty('computedAt');

    // Should NOT have the non-requested fields
    expect(body).not.toHaveProperty('valuation');
    expect(body).not.toHaveProperty('riskSummary');
    expect(body).not.toHaveProperty('integrity');
    expect(body).not.toHaveProperty('reconciliation');

    // Validate returned fields have correct structure
    const metrics = body.metrics as Record<string, unknown>;
    expect(metrics.cash).toBe('9985.00');

    const account = body.account as Record<string, unknown>;
    expect(account.name).toBe('Non-Adjacent Fields');

    const journalAttribution = body.journalAttribution as Record<string, unknown>;
    expect(journalAttribution.hasJournalTrades).toBe(true);
  });

  it('returns only computedAt when fields is an empty array (edge case)', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Empty Fields Arr', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, {
      accountId,
      fields: [],
    });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;

    // Only snapshot envelope + computedAt should be present
    expect(Object.keys(body).length).toBe(3);
    expect(body).toHaveProperty('snapshotId');
    expect(body).toHaveProperty('scopes');
    expect(body).toHaveProperty('computedAt');
    expect(typeof body.computedAt).toBe('string');

    // Should NOT have any data fields
    expect(body).not.toHaveProperty('account');
    expect(body).not.toHaveProperty('metrics');
    expect(body).not.toHaveProperty('valuation');
    expect(body).not.toHaveProperty('journalAttribution');
    expect(body).not.toHaveProperty('reconciliation');
    expect(body).not.toHaveProperty('riskSummary');
    expect(body).not.toHaveProperty('integrity');
  });

  // ── Integrity status for healthy account with no warnings ────────────

  it('reports healthy integrity when no warnings exist', () => {
    const accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(accountId, 'Healthy Integrity Route', 'Test', 'USD', now, now);

    seedHealthyAccount(sqlite, accountId);

    const result = doGetDashboardV2(sqlite, { accountId });
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;
    const integrity = body.integrity as Record<string, unknown>;

    // Integrity status should be 'healthy' because no reconciliation warnings exist
    // (reconciliation eligibility was removed from integrity — legacy cutover complete)
    expect(integrity.status).toBe('healthy');
    expect(Array.isArray(integrity.warnings)).toBe(true);
  });
});
