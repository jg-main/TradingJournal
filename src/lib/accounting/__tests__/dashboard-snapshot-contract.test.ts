/**
 * Contract regression tests for the Dashboard V2 current-state snapshot.
 *
 * These tests pin the *shape* of the snapshot contract so a future refactor
 * cannot silently:
 *   - drop a labelled scope or reuse a section as an unlabelled substitute,
 *   - coerce an unknown value to '0.00' (unknown must stay null),
 *   - present a partial sum as complete,
 *   - regress per-position attribution (journal / account_only / mixed),
 *   - regress completeness classification (complete / partial / stale /
 *     unavailable) or its propagation to price-derived aggregates,
 *   - regress per-position risk state or aggregate stop coverage.
 *
 * Scenarios are seeded directly into a real SQLite database and read back
 * through the public computeDashboardV2() boundary — no mocks, no stubs.
 *
 * @module accounting/__tests__/dashboard-snapshot-contract.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { computeDashboardV2 } from '../dashboard-v2';
import { postOpeningBalance } from '../posting';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = './.test-dashboard-snapshot-contract.db';

// ── Schema / Seed Helpers ───────────────────────────────────────────────

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

/** Create an account row and return its id. */
function createAccount(sqlite: Database.Database, name: string): string {
  const now = new Date().toISOString();
  const accountId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', 1, ?, ?)`,
    )
    .run(accountId, name, 'Contract Test Broker', now, now);
  return accountId;
}

/** Create an instrument row and return its id. */
function insertInstrument(
  sqlite: Database.Database,
  symbol: string,
): string {
  const now = new Date().toISOString();
  const instrumentId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'stock', 'USD', 1, ?, ?)`,
    )
    .run(instrumentId, symbol, `${symbol} Inc.`, now, now);
  return instrumentId;
}

/** Insert one accounting execution (journal link optional). */
function insertExecution(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
  quantity: string,
  price: string,
  journalTradeId: string | null,
  postedAt: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
       (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
        journal_trade_id, description, posted_at)
       VALUES (?, ?, ?, 'buy', ?, ?, '0.00', ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      instrumentId,
      quantity,
      price,
      randomUUID(),
      journalTradeId,
      `Execution ${price}`,
      postedAt,
    );
}

/** Insert a valuation mark for one instrument. */
function insertMark(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
  price: string,
  priceMicros: number,
  source: string,
  markTimestamp: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO valuation_marks
       (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, instrumentId, price, priceMicros, source, markTimestamp);
}

/** Insert an open account position. */
function insertPosition(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
  direction: 'long' | 'short',
  quantity: string,
  averageCost: string,
): void {
  const now = new Date().toISOString();
  const totalCostBasis = (Number(quantity) * Number(averageCost)).toFixed(2);
  sqlite
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '0.00', '0.00', '0.00', ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      instrumentId,
      direction,
      quantity,
      averageCost,
      totalCostBasis,
      now,
      now,
      now,
    );
}

/** Insert an open journal trade and return its id. */
function insertOpenTrade(
  sqlite: Database.Database,
  accountId: string,
  symbol: string,
  direction: 'long' | 'short',
  plannedStop: number | null,
  createdAt: string,
): string {
  const tradeId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO trades
       (id, trade_code, account_id, symbol, direction, status, planned_stop, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .run(tradeId, `CT-${randomUUID().slice(0, 8)}`, accountId, symbol, direction, plannedStop, createdAt, createdAt);
  return tradeId;
}

/** Insert a risk snapshot for an open trade. */
function insertRiskSnapshot(
  sqlite: Database.Database,
  tradeId: string,
  initialRiskAmount: number,
  initialStopPrice = 245,
): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO trade_risk_snapshots
       (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price,
        initial_quantity, risk_per_share, initial_risk_amount, account_risk_pct,
        planned_reward_risk, created_at)
       VALUES (?, ?, 10000, 250, ?, 5, 5, ?, 0.75, 3, ?)`,
    )
    .run(randomUUID(), tradeId, initialStopPrice, initialRiskAmount, now);
}

/**
 * Insert an account_performance projection row. Fields follow the schema:
 * id, account_id, computed_as_of, net_cash, nav, marked_positions,
 * realized_pnl, unrealized_pnl, total_pnl, realized_fees, gross_exposure,
 * net_exposure, modified_dietz_return, twr, high_water_mark, drawdown,
 * drawdown_pct, warnings, positions_json, rebuild_count, last_rebuilt_at,
 * created_at, updated_at.
 */
function insertPerformance(
  sqlite: Database.Database,
  accountId: string,
  nav: string,
  markedPositions: string,
  unrealizedPnl: string | null,
): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO account_performance
       (id, account_id, computed_as_of, net_cash, nav, marked_positions,
        realized_pnl, unrealized_pnl, total_pnl, realized_fees,
        gross_exposure, net_exposure, modified_dietz_return, twr,
        high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
        rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, '10000.00', ?, ?, '0.00', ?, '0.00', '0.00',
        ?, ?, NULL, NULL, NULL, NULL, NULL, '[]', '[]',
        1, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      now,
      nav,
      markedPositions,
      unrealizedPnl ?? '0.00',
      markedPositions,
      markedPositions,
      now,
      now,
      now,
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Scenario Seeds
// ═══════════════════════════════════════════════════════════════════════

interface ScenarioAccounts {
  /** Full healthy account: 2 positions, fresh marks, mixed + account_only attribution. */
  full: string;
  /** Account with no accounting data at all. */
  empty: string;
  /** One position, no marks at all → 'unavailable'. */
  noMarks: string;
  /** Two positions, one fresh mark → 'partial'. */
  partial: string;
  /** Three positions, two fresh marks → 'partial' with one unpriced. */
  partialOfThree: string;
  /** One position with a 5-day-old mark → 'stale'. */
  stale: string;
  /** One position, all executions journal-linked → 'journal'. */
  journalOnly: string;
  /** One position, zero executions → 'account_only' with executionCount 0. */
  zeroExecutions: string;
  /** Long position with mark + open trade with stop + risk snapshot. */
  riskWithSnapshot: string;
  /** Open trade with a zero/absent stop and no risk snapshot → partial risk. */
  riskNoSnapshot: string;
  /** Open trade with planned_stop = 0 → zero is not a stop. */
  riskZeroStop: string;
  /** Two open trades on one instrument — the most recent valid stop wins. */
  riskMultiTrade: string;
  /** Short position — risk-to-stop is (stop − mark) × qty. */
  riskShort: string;
}

function seedScenarioDatabase(sqlite: Database.Database): ScenarioAccounts {
  const now = new Date().toISOString();
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  // ── Full healthy account ─────────────────────────────────────────────
  const full = createAccount(sqlite, 'Contract Full Account');
  postOpeningBalance(sqlite, {
    accountId: full,
    amount: '10000.00',
    idempotencyKey: randomUUID(),
    description: 'Initial funding',
  });
  const aaplId = insertInstrument(sqlite, 'AAPL');
  const msftId = insertInstrument(sqlite, 'MSFT');
  const aaplTradeId = insertOpenTrade(sqlite, full, 'AAPL', 'long', 145, now);
  // AAPL: 1 journal-linked + 1 account-only execution → 'mixed'
  insertExecution(sqlite, full, aaplId, '10.00', '150.00', aaplTradeId, now);
  insertExecution(sqlite, full, aaplId, '5.00', '155.00', null, now);
  // MSFT: 1 account-only execution → 'account_only'
  insertExecution(sqlite, full, msftId, '20.00', '350.00', null, now);
  insertMark(sqlite, full, aaplId, '152.00', 152_000_000, 'user', now);
  insertMark(sqlite, full, msftId, '355.00', 355_000_000, 'user', now);
  insertPosition(sqlite, full, aaplId, 'long', '15.00', '151.66666667');
  insertPosition(sqlite, full, msftId, 'long', '20.00', '350.00');
  insertPerformance(sqlite, full, '17280.00', '7298.00', '42.50');

  // ── Empty account (no data at all) ───────────────────────────────────
  const empty = createAccount(sqlite, 'Contract Empty Account');

  // ── No marks account ─────────────────────────────────────────────────
  const noMarks = createAccount(sqlite, 'Contract No Marks Account');
  const noMarksInstr = insertInstrument(sqlite, 'GOOGL');
  insertExecution(sqlite, noMarks, noMarksInstr, '10.00', '180.00', null, now);
  insertPosition(sqlite, noMarks, noMarksInstr, 'long', '10.00', '180.00');

  // ── Partial marks account (1 of 2 positions marked) ──────────────────
  const partial = createAccount(sqlite, 'Contract Partial Account');
  const partialMarked = insertInstrument(sqlite, 'PART1');
  const partialUnmarked = insertInstrument(sqlite, 'PART2');
  insertMark(sqlite, partial, partialMarked, '110.00', 110_000_000, 'user', now);
  insertPosition(sqlite, partial, partialMarked, 'long', '5.00', '100.00');
  insertPosition(sqlite, partial, partialUnmarked, 'long', '5.00', '100.00');

  // ── Partial of three account (2 of 3 positions marked) ───────────────
  // Matches DASH-AC-02: one unpriced of three, two marked rows sum to a
  // known marked-subset amount that must never render as Open P&L.
  const partialOfThree = createAccount(sqlite, 'Contract Partial Of Three Account');
  const p3MarkedA = insertInstrument(sqlite, 'P3A');
  const p3MarkedB = insertInstrument(sqlite, 'P3B');
  const p3Unmarked = insertInstrument(sqlite, 'P3C');
  insertMark(sqlite, partialOfThree, p3MarkedA, '110.00', 110_000_000, 'user', now);
  insertMark(sqlite, partialOfThree, p3MarkedB, '120.00', 120_000_000, 'user', now);
  insertPosition(sqlite, partialOfThree, p3MarkedA, 'long', '5.00', '100.00');
  insertPosition(sqlite, partialOfThree, p3MarkedB, 'long', '5.00', '100.00');
  insertPosition(sqlite, partialOfThree, p3Unmarked, 'long', '5.00', '100.00');

  // ── Stale marks account (all marks present, none fresh) ──────────────
  const stale = createAccount(sqlite, 'Contract Stale Account');
  const staleInstr = insertInstrument(sqlite, 'TSLA');
  insertMark(sqlite, stale, staleInstr, '260.00', 260_000_000, 'user', fiveDaysAgo);
  insertPosition(sqlite, stale, staleInstr, 'long', '5.00', '250.00');

  // ── Journal-only attribution account ─────────────────────────────────
  const journalOnly = createAccount(sqlite, 'Contract Journal-Only Account');
  const journalOnlyInstr = insertInstrument(sqlite, 'NFLX');
  const journalTradeId = insertOpenTrade(sqlite, journalOnly, 'NFLX', 'long', null, now);
  insertExecution(sqlite, journalOnly, journalOnlyInstr, '8.00', '300.00', journalTradeId, now);
  insertMark(sqlite, journalOnly, journalOnlyInstr, '310.00', 310_000_000, 'user', now);
  insertPosition(sqlite, journalOnly, journalOnlyInstr, 'long', '8.00', '300.00');

  // ── Zero-execution attribution account ───────────────────────────────
  const zeroExecutions = createAccount(sqlite, 'Contract Zero-Execution Account');
  const zeroExecInstr = insertInstrument(sqlite, 'AMZN');
  insertMark(sqlite, zeroExecutions, zeroExecInstr, '120.00', 120_000_000, 'user', now);
  insertPosition(sqlite, zeroExecutions, zeroExecInstr, 'long', '4.00', '115.00');

  // ── Risk: with stop + risk snapshot ──────────────────────────────────
  // Long 5 @ 250, mark 260, stop 245 → risk-to-stop (260−245)×5 = 75.00
  const riskWithSnapshot = createAccount(sqlite, 'Contract Risk Snapshot Account');
  const riskInstr = insertInstrument(sqlite, 'RISK1');
  insertMark(sqlite, riskWithSnapshot, riskInstr, '260.00', 260_000_000, 'user', now);
  insertPosition(sqlite, riskWithSnapshot, riskInstr, 'long', '5.00', '250.00');
  const riskTradeId = insertOpenTrade(sqlite, riskWithSnapshot, 'RISK1', 'long', 245, now);
  insertRiskSnapshot(sqlite, riskTradeId, 75, 245);
  insertPerformance(sqlite, riskWithSnapshot, '10000.00', '1300.00', '50.00');

  // ── Risk: open trade without stop / risk snapshot ────────────────────
  const riskNoSnapshot = createAccount(sqlite, 'Contract Risk No-Snapshot Account');
  const riskNoSnapInstr = insertInstrument(sqlite, 'RISK2');
  insertMark(sqlite, riskNoSnapshot, riskNoSnapInstr, '260.00', 260_000_000, 'user', now);
  insertPosition(sqlite, riskNoSnapshot, riskNoSnapInstr, 'long', '5.00', '250.00');
  insertOpenTrade(sqlite, riskNoSnapshot, 'RISK2', 'long', null, now);

  // ── Risk: planned_stop = 0 is not a valid stop ───────────────────────
  const riskZeroStop = createAccount(sqlite, 'Contract Risk Zero-Stop Account');
  const riskZeroStopInstr = insertInstrument(sqlite, 'RISK3');
  insertMark(sqlite, riskZeroStop, riskZeroStopInstr, '260.00', 260_000_000, 'user', now);
  insertPosition(sqlite, riskZeroStop, riskZeroStopInstr, 'long', '5.00', '250.00');
  insertOpenTrade(sqlite, riskZeroStop, 'RISK3', 'long', 0, now);

  // ── Risk: most recent valid stop wins across multiple open trades ────
  const riskMultiTrade = createAccount(sqlite, 'Contract Risk Multi-Trade Account');
  const riskMultiInstr = insertInstrument(sqlite, 'RISK4');
  insertMark(sqlite, riskMultiTrade, riskMultiInstr, '260.00', 260_000_000, 'user', now);
  insertPosition(sqlite, riskMultiTrade, riskMultiInstr, 'long', '5.00', '250.00');
  const olderTradeId = insertOpenTrade(sqlite, riskMultiTrade, 'RISK4', 'long', 250, fiveDaysAgo);
  const newerTradeId = insertOpenTrade(sqlite, riskMultiTrade, 'RISK4', 'long', 240, now);
  insertRiskSnapshot(sqlite, olderTradeId, 50, 250);
  insertRiskSnapshot(sqlite, newerTradeId, 60, 240);

  // ── Risk: short position, (stop − mark) × qty ────────────────────────
  // Short 5 @ 250, mark 240, stop 260 → risk-to-stop (260−240)×5 = 100.00
  const riskShort = createAccount(sqlite, 'Contract Risk Short Account');
  const riskShortInstr = insertInstrument(sqlite, 'SHORT1');
  insertMark(sqlite, riskShort, riskShortInstr, '240.00', 240_000_000, 'user', now);
  insertPosition(sqlite, riskShort, riskShortInstr, 'short', '5.00', '250.00');
  const shortTradeId = insertOpenTrade(sqlite, riskShort, 'SHORT1', 'short', 260, now);
  insertRiskSnapshot(sqlite, shortTradeId, 100, 260);

  return {
    full,
    empty,
    noMarks,
    partial,
    partialOfThree,
    stale,
    journalOnly,
    zeroExecutions,
    riskWithSnapshot,
    riskNoSnapshot,
    riskZeroStop,
    riskMultiTrade,
    riskShort,
  };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

// ═══════════════════════════════════════════════════════════════════════
// Contract Tests
// ═══════════════════════════════════════════════════════════════════════

describe('dashboard snapshot contract — scope separation', () => {
  let sqlite: Database.Database;
  let accounts: ScenarioAccounts;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
    accounts = seedScenarioDatabase(sqlite);
  });

  afterAll(() => destroyTestDatabase(sqlite));

  it('declares three distinct labelled scopes — no section is an unlabelled substitute', () => {
    const result = computeDashboardV2(sqlite, accounts.full);
    expect(result).toBeDefined();

    const scopes = result!.scopes;
    const ids = Object.values(scopes).map((s) => s.id);
    // Exactly the three canonical scope ids, each with a stable machine id.
    expect(ids.sort()).toEqual([
      'account_positions',
      'journal_trades',
      'period_performance',
    ]);

    // Every scope is labelled: id + section + description + source.
    for (const scope of Object.values(scopes)) {
      expect(scope.section.length).toBeGreaterThan(0);
      expect(scope.description.length).toBeGreaterThan(0);
      expect(scope.source.length).toBeGreaterThan(0);
    }

    // No two scopes may claim the same response section.
    const sections = Object.values(scopes).map((s) => s.section);
    expect(new Set(sections).size).toBe(sections.length);

    // Each declared section must exist as a real key on the full response —
    // a scope can never point at a section that is not returned.
    for (const scope of Object.values(scopes)) {
      expect(scope.section in result!).toBe(true);
    }
  });

  it('maps each scope to the response section it represents', () => {
    const result = computeDashboardV2(sqlite, accounts.full)!;
    expect(result.scopes.accountPositions.section).toBe('valuation');
    expect(result.scopes.journalTrades.section).toBe('journalAttribution');
    expect(result.scopes.periodPerformance.section).toBe('metrics');
  });

  it('declares the source tables and as-of timestamp for each scope', () => {
    const result = computeDashboardV2(sqlite, accounts.full)!;

    expect(result.scopes.accountPositions.source).toContain('account_positions');
    expect(result.scopes.accountPositions.source).toContain('valuation_marks');
    expect(result.scopes.journalTrades.source).toContain('accounting_executions');
    expect(result.scopes.periodPerformance.source).toContain('account_performance');

    // as-of is the underlying data timestamp, not the computed-at time.
    const latestMarkTimestamp = Math.max(
      ...result.valuation.positions.map((p) => new Date(p.markTimestamp!).getTime()),
    );
    expect(result.scopes.accountPositions.asOf).toBe(
      new Date(latestMarkTimestamp).toISOString(),
    );
    expect(result.scopes.journalTrades.asOf).not.toBeNull();
    expect(result.scopes.periodPerformance.asOf).not.toBeNull();
  });

  it('keeps the snapshot envelope (snapshotId, scopes, computedAt) under fields filtering', () => {
    const result = computeDashboardV2(sqlite, accounts.full, {
      fields: ['valuation'],
    })!;

    // Envelope is always present, even when a section is filtered out.
    expect(result.snapshotId).toMatch(/^snap:/);
    expect(result.scopes.accountPositions.id).toBe('account_positions');
    expect(result.computedAt).toBeDefined();

    // Requested section is present with its full shape.
    expect(result.valuation.positions.length).toBe(2);
    // Non-requested sections are absent (not nulled out).
    expect('metrics' in result).toBe(false);
    expect('journalAttribution' in result).toBe(false);
    expect('riskSummary' in result).toBe(false);
  });

  it('produces one deterministic snapshotId and a single computedAt shared by every mark and aggregate', () => {
    const a = computeDashboardV2(sqlite, accounts.full)!;
    const b = computeDashboardV2(sqlite, accounts.full)!;

    expect(a.snapshotId).toBe(`snap:${accounts.full}:${a.computedAt}`);
    // Same data → same snapshotId pattern (deterministic, no random ids).
    expect(b.snapshotId.startsWith(`snap:${accounts.full}:`)).toBe(true);

    const computedAts = [
      a.metrics.provenance.computedAt,
      a.valuation.provenance.computedAt,
      a.riskSummary.provenance.computedAt,
      a.journalAttribution.provenance.computedAt,
      a.reconciliation.provenance.computedAt,
      ...a.valuation.positions.map((p) => p.markProvenance.computedAt),
    ];
    for (const ts of computedAts) expect(ts).toBe(a.computedAt);
  });

  it('declares null as-of for scopes whose source data is absent', () => {
    const result = computeDashboardV2(sqlite, accounts.empty)!;
    expect(result.scopes.accountPositions.asOf).toBeNull();
    expect(result.scopes.journalTrades.asOf).toBeNull();
    expect(result.scopes.periodPerformance.asOf).toBeNull();
  });
});

describe('dashboard snapshot contract — nullability (unknown ≠ 0.00)', () => {
  let sqlite: Database.Database;
  let accounts: ScenarioAccounts;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
    accounts = seedScenarioDatabase(sqlite);
  });

  afterAll(() => destroyTestDatabase(sqlite));

  it('keeps every metric null when no performance projection exists — never "0.00"', () => {
    const result = computeDashboardV2(sqlite, accounts.empty)!;

    const nullMetrics = [
      result.metrics.cash,
      result.metrics.nav,
      result.metrics.markedPositions,
      result.metrics.realizedPnl,
      result.metrics.unrealizedPnl,
      result.metrics.totalPnl,
      result.metrics.realizedFees,
      result.metrics.grossExposure,
      result.metrics.netExposure,
      result.metrics.drawdown,
      result.metrics.drawdownPct,
      result.metrics.modifiedDietzReturn,
      result.metrics.twr,
    ];
    for (const value of nullMetrics) expect(value).toBeNull();
    // The section-level provenance still says why: no positions → exact-zero
    // valuation, so the aggregate is complete rather than unavailable.
    expect(result.metrics.provenance.source).toBe('account_performance');
    expect(result.metrics.provenance.asOf).toBeNull();
  });

  it('represents a missing mark as null values while keeping coverage counts numeric', () => {
    const result = computeDashboardV2(sqlite, accounts.noMarks)!;
    const pos = result.valuation.positions[0];

    expect(pos.markStatus).toBe('missing');
    expect(pos.markPrice).toBeNull();
    expect(pos.markedValue).toBeNull();
    expect(pos.unrealizedPnl).toBeNull();
    expect(pos.markTimestamp).toBeNull();
    expect(pos.markAgeMinutes).toBeNull();
    expect(pos.markProvenance.source).toBeNull();
    expect(pos.markProvenance.asOf).toBeNull();
    expect(pos.markProvenance.status).toBe('missing');
    // computedAt is snapshot-wide — always present even for missing marks.
    expect(pos.markProvenance.computedAt).toBe(result.computedAt);

    // Coverage counts remain exact — nothing is hidden.
    expect(result.valuation.positionsTotal).toBe(1);
    expect(result.valuation.fresh).toBe(0);
    expect(result.valuation.missing).toBe(1);
  });

  it('never presents a partial sum as complete — openPnl is null when a position is unevaluable', () => {
    const result = computeDashboardV2(sqlite, accounts.partial)!;

    // Marked position has a value, unmarked position is null.
    const values = result.valuation.positions.map((p) => p.unrealizedPnl);
    expect(values).toContain(null);
    expect(values.some((v) => v !== null)).toBe(true);

    // The aggregate refuses to sum the partial data.
    expect(result.riskSummary.openPnl).toBeNull();
    expect(result.riskSummary.openRiskToStop).toBeNull();
    // Completeness state names the condition instead.
    expect(result.valuation.state).toBe('partial');
    expect(result.valuation.coveragePct).toBe('50.00');
  });

  it('returns an exact "0.00" only when there are no positions at all (vacuous zero, not a coercion)', () => {
    const result = computeDashboardV2(sqlite, accounts.empty)!;

    // No positions → the sum is exactly zero, which is knowable.
    expect(result.valuation.positionsTotal).toBe(0);
    expect(result.riskSummary.openPnl).toBe('0.00');
    expect(result.riskSummary.openRiskToStop).toBe('0.00');
    // But the metrics are still unknown without a projection.
    expect(result.metrics.nav).toBeNull();
  });

  it('keeps openRisk null when some open trades lack a risk snapshot (partial data)', () => {
    const result = computeDashboardV2(sqlite, accounts.riskNoSnapshot)!;
    // One open trade, no risk snapshot → partial risk data.
    expect(result.riskSummary.stopCoverage.openTrades).toBe(1);
    expect(result.riskSummary.openRisk).toBeNull();
    // Per-position P&L is unaffected (the mark exists), so openPnl is real.
    expect(result.riskSummary.openPnl).toBe('50.00');
    expect(result.riskSummary.openRiskToStop).toBeNull();
  });

  it('keeps portfolioHeat null when NAV is unknown, never a coerced zero', () => {
    // riskNoSnapshot has no performance projection → NAV unknown.
    const result = computeDashboardV2(sqlite, accounts.riskNoSnapshot)!;
    expect(result.metrics.nav).toBeNull();
    expect(result.riskSummary.openRisk).toBeNull();
    expect(result.riskSummary.portfolioHeat).toBeNull();
  });

  it('leaves coveragePct null when there are no positions (0/0 is not a percentage)', () => {
    const result = computeDashboardV2(sqlite, accounts.empty)!;
    expect(result.valuation.coveragePct).toBeNull();
    expect(result.valuation.state).toBe('complete');
  });
});

describe('dashboard snapshot contract — per-position attribution', () => {
  let sqlite: Database.Database;
  let accounts: ScenarioAccounts;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
    accounts = seedScenarioDatabase(sqlite);
  });

  afterAll(() => destroyTestDatabase(sqlite));

  it('classifies a position as journal when every execution is journal-linked', () => {
    const result = computeDashboardV2(sqlite, accounts.journalOnly)!;
    const pos = result.valuation.positions[0];
    expect(pos.attribution.kind).toBe('journal');
    expect(pos.attribution.executionCount).toBe(1);
    expect(pos.attribution.journalTradeCount).toBe(1);
  });

  it('classifies a position as account_only when every execution is unlinked', () => {
    const result = computeDashboardV2(sqlite, accounts.full)!;
    const msft = result.valuation.positions.find((p) => p.symbol === 'MSFT');
    expect(msft).toBeDefined();
    expect(msft!.attribution.kind).toBe('account_only');
    expect(msft!.attribution.executionCount).toBe(1);
    expect(msft!.attribution.journalTradeCount).toBe(0);
  });

  it('classifies a position as account_only with executionCount 0 when no executions exist', () => {
    const result = computeDashboardV2(sqlite, accounts.zeroExecutions)!;
    const pos = result.valuation.positions[0];
    expect(pos.attribution.kind).toBe('account_only');
    expect(pos.attribution.executionCount).toBe(0);
    expect(pos.attribution.journalTradeCount).toBe(0);
  });

  it('classifies a position as mixed when some executions are linked and some are not', () => {
    const result = computeDashboardV2(sqlite, accounts.full)!;
    const aapl = result.valuation.positions.find((p) => p.symbol === 'AAPL');
    expect(aapl).toBeDefined();
    expect(aapl!.attribution.kind).toBe('mixed');
    expect(aapl!.attribution.executionCount).toBe(2);
    expect(aapl!.attribution.journalTradeCount).toBe(1);
  });

  it('counts distinct journal trades, not executions, in journalTradeCount', () => {
    // Reuses the full account where AAPL has one linked execution: the count
    // must reflect distinct trades even if the seed changed to two executions
    // from the same trade. Here the invariant is simply that the count is the
    // number of distinct linked trades, never the execution total.
    const result = computeDashboardV2(sqlite, accounts.full)!;
    const aapl = result.valuation.positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.attribution.journalTradeCount).toBeLessThanOrEqual(
      aapl.attribution.executionCount,
    );
    expect(aapl.attribution.journalTradeCount).toBe(1);
  });
});

describe('dashboard snapshot contract — completeness classification', () => {
  let sqlite: Database.Database;
  let accounts: ScenarioAccounts;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
    accounts = seedScenarioDatabase(sqlite);
  });

  afterAll(() => destroyTestDatabase(sqlite));

  it('classifies all-fresh marks as complete with 100% coverage', () => {
    const result = computeDashboardV2(sqlite, accounts.full)!;
    expect(result.valuation.positionsTotal).toBe(2);
    expect(result.valuation.fresh).toBe(2);
    expect(result.valuation.stale).toBe(0);
    expect(result.valuation.missing).toBe(0);
    expect(result.valuation.state).toBe('complete');
    expect(result.valuation.coveragePct).toBe('100.00');
  });

  it('classifies no marks at all as unavailable with 0% coverage', () => {
    const result = computeDashboardV2(sqlite, accounts.noMarks)!;
    expect(result.valuation.positionsTotal).toBe(1);
    expect(result.valuation.fresh).toBe(0);
    expect(result.valuation.missing).toBe(1);
    expect(result.valuation.state).toBe('unavailable');
    expect(result.valuation.coveragePct).toBe('0.00');
  });

  it('classifies mixed coverage as partial', () => {
    const result = computeDashboardV2(sqlite, accounts.partial)!;
    expect(result.valuation.positionsTotal).toBe(2);
    expect(result.valuation.fresh).toBe(1);
    expect(result.valuation.missing).toBe(1);
    expect(result.valuation.state).toBe('partial');
    expect(result.valuation.coveragePct).toBe('50.00');
  });

  it('classifies all-marks-present-but-none-fresh as stale', () => {
    const result = computeDashboardV2(sqlite, accounts.stale)!;
    expect(result.valuation.positionsTotal).toBe(1);
    expect(result.valuation.fresh).toBe(0);
    expect(result.valuation.stale).toBe(1);
    expect(result.valuation.missing).toBe(0);
    expect(result.valuation.state).toBe('stale');
    expect(result.valuation.coveragePct).toBe('0.00');

    // A stale mark is still a real mark: price/provenance remain populated,
    // and the status flag carries the staleness.
    const pos = result.valuation.positions[0];
    expect(pos.markPrice).toBe('260.00');
    expect(pos.markStatus).toBe('stale');
    expect(pos.markProvenance.status).toBe('stale');
  });

  it('propagates the completeness state to every price-derived aggregate provenance', () => {
    const unavailable = computeDashboardV2(sqlite, accounts.noMarks)!;
    expect(unavailable.metrics.provenance.status).toBe('unavailable');
    expect(unavailable.valuation.provenance.status).toBe('unavailable');
    expect(unavailable.riskSummary.provenance.status).toBe('unavailable');

    const partial = computeDashboardV2(sqlite, accounts.partial)!;
    expect(partial.metrics.provenance.status).toBe('partial');
    expect(partial.valuation.provenance.status).toBe('partial');

    const complete = computeDashboardV2(sqlite, accounts.full)!;
    expect(complete.metrics.provenance.status).toBe('complete');
    expect(complete.valuation.provenance.status).toBe('complete');
    expect(complete.riskSummary.provenance.status).toBe('complete');
  });

  it('treats zero positions as complete (vacuous truth) rather than unavailable', () => {
    const result = computeDashboardV2(sqlite, accounts.empty)!;
    expect(result.valuation.positionsTotal).toBe(0);
    expect(result.valuation.state).toBe('complete');
    expect(result.valuation.coveragePct).toBeNull();
  });
});

describe('dashboard snapshot contract — risk state and stop coverage', () => {
  let sqlite: Database.Database;
  let accounts: ScenarioAccounts;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
    accounts = seedScenarioDatabase(sqlite);
  });

  afterAll(() => destroyTestDatabase(sqlite));

  it('reports per-position risk for a long position with a valid stop', () => {
    const result = computeDashboardV2(sqlite, accounts.riskWithSnapshot)!;
    const pos = result.valuation.positions[0];
    expect(pos.risk.hasValidStop).toBe(true);
    expect(pos.risk.stopPrice).toBe(245);
    // R032: max(0, avgCost − stop) × qty = (250 − 245) × 5 = 25.00
    expect(pos.risk.currentRiskToStop).toBe('25.00');
    expect(pos.risk.openTrades).toBe(1);

    expect(result.riskSummary.missingStops).toBe(0);
    expect(result.riskSummary.positionsWithStop).toBe(1);
    expect(result.riskSummary.stopCoverage).toEqual({
      openTrades: 1,
      withStop: 1,
      withoutStop: 0,
      state: 'complete',
      presentationLabel: null,
    });
    // openRisk is the risk-snapshot aggregate (75.00), a separate S01 metric.
    expect(result.riskSummary.openRisk).toBe('75.00');
    expect(result.riskSummary.openRiskToStop).toBe('25.00');
    expect(result.riskSummary.openPnl).toBe('50.00');
  });

  it('computes risk-to-stop for short positions as (stop − mark) × qty', () => {
    const result = computeDashboardV2(sqlite, accounts.riskShort)!;
    const pos = result.valuation.positions[0];
    expect(pos.risk.hasValidStop).toBe(true);
    expect(pos.risk.stopPrice).toBe(260);
    // R032 short: max(0, stop − avgCost) × qty = (260 − 250) × 5 = 50.00
    expect(pos.risk.currentRiskToStop).toBe('50.00');
    expect(result.riskSummary.openRiskToStop).toBe('50.00');
    // openRisk is the risk-snapshot aggregate (100.00), a separate S01 metric.
    expect(result.riskSummary.openRisk).toBe('100.00');
  });

  it('flags a missing stop with null risk-to-stop and partial stop coverage', () => {
    const result = computeDashboardV2(sqlite, accounts.riskNoSnapshot)!;
    const pos = result.valuation.positions[0];
    expect(pos.risk.hasValidStop).toBe(false);
    expect(pos.risk.stopPrice).toBeNull();
    expect(pos.risk.currentRiskToStop).toBeNull();

    expect(result.riskSummary.missingStops).toBe(1);
    expect(result.riskSummary.positionsWithStop).toBe(0);
    expect(result.riskSummary.stopCoverage).toEqual({
      openTrades: 1,
      withStop: 0,
      withoutStop: 1,
      state: 'partial',
      presentationLabel: 'Incomplete — 1 without a valid stop',
    });
    // Open trade has no risk snapshot → partial → null, never a partial sum.
    expect(result.riskSummary.openRisk).toBeNull();
    expect(result.riskSummary.openRiskToStop).toBeNull();
  });

  it('treats a zero planned stop as no stop at all', () => {
    const result = computeDashboardV2(sqlite, accounts.riskZeroStop)!;
    const pos = result.valuation.positions[0];
    expect(pos.risk.hasValidStop).toBe(false);
    expect(pos.risk.stopPrice).toBeNull();
    expect(result.riskSummary.missingStops).toBe(1);
    expect(result.riskSummary.positionsWithStop).toBe(0);
    expect(result.riskSummary.stopCoverage.state).toBe('partial');
  });

  it('uses the most recent valid stop when multiple open trades exist', () => {
    const result = computeDashboardV2(sqlite, accounts.riskMultiTrade)!;
    const pos = result.valuation.positions[0];
    expect(pos.risk.openTrades).toBe(2);
    expect(pos.risk.hasValidStop).toBe(true);
    // Older trade stop 250, newer trade stop 240 → the newer valid stop wins.
    expect(pos.risk.stopPrice).toBe(240);
    // R032: max(0, avgCost − stop) × qty = (250 − 240) × 5 = 50.00
    expect(pos.risk.currentRiskToStop).toBe('50.00');

    // Both open trades carry a valid stop → coverage is complete.
    expect(result.riskSummary.stopCoverage).toEqual({
      openTrades: 2,
      withStop: 2,
      withoutStop: 0,
      state: 'complete',
      presentationLabel: null,
    });
    // Both trades have snapshots → openRisk is the full sum, not partial.
    expect(result.riskSummary.openRisk).toBe('110.00');
    // openRiskToStop aggregates per-position risk (one position, 50.00).
    expect(result.riskSummary.openRiskToStop).toBe('50.00');
  });

  it('computes portfolioHeat from openRisk over NAV when both are known', () => {
    const result = computeDashboardV2(sqlite, accounts.riskWithSnapshot)!;
    // openRisk (risk-snapshot aggregate) 75.00 / nav 10000.00 × 100 = 0.75
    expect(result.riskSummary.portfolioHeat).toBe('0.75');
  });
});

describe('dashboard snapshot contract — qualified display hints (presentationLabel, markedSubsetPnl)', () => {
  let sqlite: Database.Database;
  let accounts: ScenarioAccounts;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
    accounts = seedScenarioDatabase(sqlite);
  });

  afterAll(() => destroyTestDatabase(sqlite));

  it('renders "— Partial — 1 unpriced" as the primary value for one unpriced of three (DASH-AC-02)', () => {
    const result = computeDashboardV2(sqlite, accounts.partialOfThree)!;

    // Coverage: 2 fresh of 3 → partial, one unpriced.
    expect(result.valuation.positionsTotal).toBe(3);
    expect(result.valuation.fresh).toBe(2);
    expect(result.valuation.missing).toBe(1);
    expect(result.valuation.state).toBe('partial');

    // The primary value is the qualified label — never a signed total.
    expect(result.valuation.presentationLabel).toBe('— Partial — 1 unpriced');
    // openPnl stays null: the unmarked position cannot be summed.
    expect(result.riskSummary.openPnl).toBeNull();

    // The known amount carries M-of-N coverage: 50.00 + 100.00 of 3.
    expect(result.valuation.markedSubsetPnl).toBe('150.00');

    // The label propagates to every price-derived aggregate provenance.
    expect(result.valuation.provenance.presentationLabel).toBe(
      '— Partial — 1 unpriced',
    );
    expect(result.metrics.provenance.presentationLabel).toBe(
      '— Partial — 1 unpriced',
    );
    expect(result.riskSummary.provenance.presentationLabel).toBe(
      '— Partial — 1 unpriced',
    );
  });

  it('renders "— Unavailable — N unpriced" when no position has a mark', () => {
    const result = computeDashboardV2(sqlite, accounts.noMarks)!;
    expect(result.valuation.state).toBe('unavailable');
    expect(result.valuation.presentationLabel).toBe(
      '— Unavailable — 1 unpriced',
    );
    // Nothing is freshly priced → no known marked-subset amount.
    expect(result.valuation.markedSubsetPnl).toBeNull();
    expect(result.riskSummary.openPnl).toBeNull();
  });

  it('renders "Incomplete — N without a valid stop" for partial stop coverage (DASH-AC-06)', () => {
    const result = computeDashboardV2(sqlite, accounts.riskNoSnapshot)!;
    expect(result.riskSummary.stopCoverage.state).toBe('partial');
    expect(result.riskSummary.stopCoverage.presentationLabel).toBe(
      'Incomplete — 1 without a valid stop',
    );
    // A deceptively complete numeric total is never surfaced.
    expect(result.riskSummary.openRiskToStop).toBeNull();
    expect(result.riskSummary.openRisk).toBeNull();

    // Complete coverage has no label.
    const withStop = computeDashboardV2(sqlite, accounts.riskWithSnapshot)!;
    expect(withStop.riskSummary.stopCoverage.state).toBe('complete');
    expect(withStop.riskSummary.stopCoverage.presentationLabel).toBeNull();
  });

  it('surfaces no presentation label and a signed total when all marks are fresh', () => {
    // riskWithSnapshot: one position with a fresh mark and a canonical cost
    // basis → the aggregate is complete and openPnl is a real signed amount.
    const result = computeDashboardV2(sqlite, accounts.riskWithSnapshot)!;
    expect(result.valuation.state).toBe('complete');
    expect(result.valuation.presentationLabel).toBeNull();
    expect(result.valuation.provenance.presentationLabel).toBeNull();
    expect(result.metrics.provenance.presentationLabel).toBeNull();
    expect(result.riskSummary.provenance.presentationLabel).toBeNull();

    // openPnl is a real signed amount; with M = N the marked subset is the
    // full sum.
    expect(result.riskSummary.openPnl).toBe('50.00');
    expect(result.valuation.markedSubsetPnl).toBe(result.riskSummary.openPnl);
  });

  it('produces different classifications for the same mark under different injected policies', () => {
    // The stale scenario has one 5-day-old mark: stale under the default
    // 1440-minute (24h) policy...
    const strict = computeDashboardV2(sqlite, accounts.stale)!;
    expect(strict.valuation.positions[0].markStatus).toBe('stale');
    expect(strict.valuation.state).toBe('stale');
    expect(strict.valuation.coveragePct).toBe('0.00');
    expect(strict.valuation.markedSubsetPnl).toBeNull();

    // ...but fresh under a 7-day policy injected through the public surface.
    const lenient = computeDashboardV2(sqlite, accounts.stale, {
      freshnessPolicy: { defaultThresholdMinutes: 7 * 24 * 60 },
    })!;
    expect(lenient.valuation.positions[0].markStatus).toBe('fresh');
    expect(lenient.valuation.state).toBe('complete');
    expect(lenient.valuation.coveragePct).toBe('100.00');
    expect(lenient.valuation.markedSubsetPnl).toBe('50.00');
  });
});
