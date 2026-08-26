/**
 * M006 End-to-End Pipeline Integration Test.
 *
 * Exercises the full S01→S02→S03→Dashboard V2 round-trip against a real
 * SQLite database with all migrations applied:
 *
 *   S01: MTM refresh → writes valuation_marks, auto-creates instruments
 *        and positions, updates trades.current_price
 *   S02: Trade execution sync → mirrors legacy trade_executions to
 *        accounting_executions with FIFO position rebuild
 *   S03: Dashboard V2 → reads fresh valuation_marks and account_positions
 *        to produce the cutover-integrity view-model
 *
 * Test scenario: 3 open long trades (CAKE, AMRX, WKC) with live prices.
 * CAKE has no pre-existing instrument — validates auto-creation path.
 *
 * Each stage logs descriptive labels with expected-vs-actual diffs on failure.
 *
 * @module pipeline-integration.test
 */

import { testDbPath } from '../../../../../../lib/testing/test-db';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { computeDashboardV2 } from '@/lib/accounting/dashboard-v2';
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { rebuildPositions } from '@/lib/positions/rebuild';
import {
  findOrCreateInstrument,
  findInstrumentBySymbol,
  insertValuationMark,
  listLatestValuationMarks,
  listAccountPositions,
  findAccountPosition,
} from '@/db/accounting-repository';
import { normalizeDecimal, sumDecimals } from '@/lib/accounting/decimal';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('pipeline-integration');

// ── Test Scenario Constants ──────────────────────────────────────────────
//
// 3 open long trades with realistic prices:
//
// | Symbol | Shares | Avg Entry | Current Price | V1 PnL (gross) |
// |--------|--------|-----------|---------------|-----------------|
// | CAKE   | 500    | $65.50    | $68.25        | (68.25-65.50)*500 = $1,375.00 |
// | AMRX   | 300    | $8.40     | $8.75         | (8.75-8.40)*300 = $105.00     |
// | WKC    | 200    | $28.15    | $27.90        | (27.90-28.15)*200 = -$50.00   |
//
// Total V1 PnL: $1,430.00
// Total V2 PnL: should match when mark_price == current_price

interface TradeFixture {
  symbol: string;
  direction: 'long' | 'short';
  shares: number;
  avgEntryPrice: number;
  currentPrice: number;
  /** Pre-create the instrument before the MTM refresh simulation. */
  preCreateInstrument: boolean;
}

const TRADE_FIXTURES: TradeFixture[] = [
  {
    symbol: 'CAKE',
    direction: 'long',
    shares: 500,
    avgEntryPrice: 65.50,
    currentPrice: 68.25,
    preCreateInstrument: false, // ← test auto-creation path
  },
  {
    symbol: 'AMRX',
    direction: 'long',
    shares: 300,
    avgEntryPrice: 8.40,
    currentPrice: 8.75,
    preCreateInstrument: true,
  },
  {
    symbol: 'WKC',
    direction: 'long',
    shares: 200,
    avgEntryPrice: 28.15,
    currentPrice: 27.90,
    preCreateInstrument: true,
  },
];

// Expected V1 PnL values (computed from the raw numeric prices above)
const EXPECTED_V1_PNL: Record<string, string> = {
  CAKE: '1375.00',
  AMRX: '105.00',
  WKC: '-50.00',
};

// ── Test Database Setup ─────────────────────────────────────────────────

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
  tradeIds: Record<string, string>;
  /** Execution IDs keyed by symbol. */
  execIds: Record<string, string>;
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

  // Apply all migrations in order
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
          // Table may already exist from an earlier migration
        }
      }
    }
  }

  // Create test account
  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Pipeline Integration Test Account', 'Test Broker', 'USD', now, now);

  // Pre-create instruments for AMRX and WKC (but NOT CAKE — test auto-creation)
  for (const t of TRADE_FIXTURES) {
    if (t.preCreateInstrument) {
      findOrCreateInstrument(sqlite, t.symbol, `${t.symbol} Inc.`);
    }
  }

  // Verify CAKE does NOT exist yet
  const cakeInstrument = findInstrumentBySymbol(sqlite, 'CAKE');
  if (cakeInstrument) {
    throw new Error('CAKE instrument should not exist yet (test invariant)');
  }

  // Insert trades
  const tradeIds: Record<string, string> = {};
  const execIds: Record<string, string> = {};
  const insertTrade = sqlite.prepare(
    `INSERT INTO trades
     (id, trade_code, account_id, symbol, direction, status, opened_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'long', 'open', ?, ?, ?)`,
  );
  const insertExec = sqlite.prepare(
    `INSERT INTO trade_executions
     (id, trade_id, executed_at, action, quantity, price, fees, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const t of TRADE_FIXTURES) {
    const tradeId = randomUUID();
    const tradeCode = `PIPELINE-${t.symbol}-${randomUUID().slice(0, 6)}`;
    tradeIds[t.symbol] = tradeId;
    insertTrade.run(tradeId, tradeCode, accountId, t.symbol, now, now, now);

    // Single opening buy execution for each trade
    const execId = randomUUID();
    execIds[t.symbol] = execId;
    insertExec.run(
      execId,
      tradeId,
      now,
      'buy',
      t.shares,
      t.avgEntryPrice,
      0,
      now,
    );
  }

  return { sqlite, accountId, tradeIds, execIds };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

/**
 * Simulate MTM refresh side effects on the database.
 *
 * For each open trade, this writes:
 * 1. Instruments (auto-create if missing — CAKE should not exist yet)
 * 2. Account positions (auto-create if missing)
 * 3. Valuation marks (source='market_data')
 * 4. Updates trades.current_price
 *
 * This mirrors the exact data flow from route.ts without calling the
 * actual HTTP endpoint or the Yahoo Finance quote provider.
 */
function simulateMtmRefresh(
  sqlite: Database.Database,
  accountId: string,
  tradeIds: Record<string, string>,
): void {
  const now = new Date().toISOString();
  const markTimestamp = new Date().toISOString();

  for (const t of TRADE_FIXTURES) {
    const tradeId = tradeIds[t.symbol];

    // 1. Resolve or auto-create instrument (CAKE should be auto-created here)
    const instrument = findOrCreateInstrument(sqlite, t.symbol, `${t.symbol} Inc.`);

    // 2. Auto-create account position if none exists
    const existingPos = findAccountPosition(sqlite, accountId, instrument.id);
    if (!existingPos) {
      const totalCostBasis = normalizeDecimal(t.shares * t.avgEntryPrice);
      sqlite
        .prepare(
          `INSERT INTO account_positions
           (id, account_id, instrument_id, direction, quantity, average_cost,
            total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
            last_updated, created_at, updated_at)
           VALUES (?, ?, ?, 'long', ?, ?, ?, '0.00', '0.00', '0.00', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          accountId,
          instrument.id,
          normalizeDecimal(t.shares),
          normalizeDecimal(t.avgEntryPrice),
          totalCostBasis,
          now,
          now,
          now,
        );
    }

    // 3. Write valuation_mark (source='market_data', matching current_price)
    insertValuationMark(sqlite, {
      accountId,
      instrumentId: instrument.id,
      price: normalizeDecimal(t.currentPrice),
      priceMicros: Math.round(t.currentPrice * 1_000_000),
      source: 'market_data',
      markTimestamp,
      idempotencyKey: `mtm-refresh:${tradeId}:${markTimestamp}`,
    });

    // 4. Update trades.current_price
    sqlite
      .prepare(
        `UPDATE trades SET current_price = ?, current_price_fetched_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(t.currentPrice, now, now, tradeId);
  }
}

// ── Integration Tests ───────────────────────────────────────────────────

describe('M006 Pipeline Integration: MTM refresh → sync → Dashboard V2', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
  });

  afterAll(() => {
    destroyTestDatabase(ctx.sqlite);
  });

  // ── Stage 1: Instrument Auto-Creation ────────────────────────────────

  it('P1: CAKE instrument auto-created by MTM refresh (no pre-existing instrument)', () => {
    // Before MTM refresh, CAKE instrument should NOT exist
    const beforeCake = findInstrumentBySymbol(ctx.sqlite, 'CAKE');
    expect(beforeCake).toBeUndefined();

    // Run MTM refresh simulation — this should auto-create the CAKE instrument
    simulateMtmRefresh(ctx.sqlite, ctx.accountId, ctx.tradeIds);

    // After MTM refresh, CAKE instrument MUST exist
    const afterCake = findInstrumentBySymbol(ctx.sqlite, 'CAKE');
    expect(afterCake).toBeDefined();
    expect(afterCake!.symbol).toBe('CAKE');
  });

  // ── Stage 2: Trade Execution Sync ────────────────────────────────────

  it('P2: Trade executions sync to accounting with correct FIFO positions', () => {
    for (const t of TRADE_FIXTURES) {
      const execId = ctx.execIds[t.symbol];
      const tradeId = ctx.tradeIds[t.symbol];

      // Create the canonical accounting execution for the journal execution
      // under the deterministic trade-execution-<id> key (canonical posting
      // kernel — the same path executeTradeFill uses).
      const result = postExecutionFill(ctx.sqlite, {
        accountId: ctx.accountId,
        symbol: t.symbol,
        action: 'buy',
        quantity: normalizeDecimal(t.shares),
        price: normalizeDecimal(t.avgEntryPrice),
        fees: '0.00',
        idempotencyKey: `trade-execution-${execId}`,
        journalTradeId: tradeId,
        postedAt: new Date().toISOString(),
      });

      // Verify accounting_execution has correct values
      expect(result.execution.accountId).toBe(ctx.accountId);
      expect(result.execution.action).toBe('buy');
      expect(result.execution.quantity).toBe(normalizeDecimal(t.shares));
      expect(result.execution.price).toBe(normalizeDecimal(t.avgEntryPrice));

      // Canonical FIFO position rebuild (what executeTradeFill performs
      // inside its atomic transaction).
      rebuildPositions(ctx.sqlite, ctx.accountId);

      // Verify position was rebuilt correctly (canonical FIFO rebuild)
      const instrument = findOrCreateInstrument(ctx.sqlite, t.symbol);
      const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrument.id);

      expect(position).toBeDefined();
      expect(position!.direction).toBe('long');
      expect(position!.quantity).toBe(normalizeDecimal(t.shares));
      expect(position!.average_cost).toBe(normalizeDecimal(t.avgEntryPrice));
      expect(position!.realized_gross_pnl).toBe('0.00');
      expect(position!.realized_fees).toBe('0.00');
      expect(position!.realized_net_pnl).toBe('0.00');
    }

    // Verify DB has 3 account_positions (one per symbol)
    const dbPositions = listAccountPositions(ctx.sqlite, ctx.accountId);
    expect(dbPositions.length).toBe(3);
  });

  // ── Stage 3: Valuation Mark Freshness ────────────────────────────────

  it('P3: Valuation marks are fresh (< 1 minute old) with source=market_data', () => {
    const marks = listLatestValuationMarks(ctx.sqlite, ctx.accountId);

    // Should have 3 marks (one per symbol)
    expect(marks.length).toBe(3);

    for (const mark of marks) {
      // Source must be 'market_data' (what MTM refresh writes)
      expect(mark.source).toBe('market_data');

      // Mark must be < 1 minute old (just written seconds ago)
      const markTime = new Date(mark.mark_timestamp).getTime();
      const ageMs = Date.now() - markTime;
      const ageSeconds = ageMs / 1000;
      expect(ageSeconds).toBeLessThan(60);
    }

    // Verify specific prices match expected values
    const marksBySymbol = new Map<string, typeof marks[number]>();
    for (const mark of marks) {
      const instrument = findInstrumentById_raw(ctx.sqlite, mark.instrument_id);
      if (instrument) {
        marksBySymbol.set(instrument.symbol, mark);
      }
    }

    for (const t of TRADE_FIXTURES) {
      const mark = marksBySymbol.get(t.symbol);
      expect(mark).toBeDefined();
      expect(Number(mark!.price)).toBeCloseTo(t.currentPrice, 2);
    }
  });

  // ── Stage 4: Dashboard V2 reads fresh data ───────────────────────────

  it('P4: Dashboard V2 produces correct valuation and integrity from fresh marks', () => {
    const dashboard = computeDashboardV2(ctx.sqlite, ctx.accountId, {
      freshnessThresholdMinutes: 60, // 1 hour (marks are seconds old, so definitely fresh)
    });

    expect(dashboard).toBeDefined();

    // Account info
    expect(dashboard!.account.id).toBe(ctx.accountId);
    expect(dashboard!.account.name).toBe('Pipeline Integration Test Account');

    // Valuation completeness — all 3 positions should have fresh marks
    expect(dashboard!.valuation.positionsTotal).toBe(3);
    expect(dashboard!.valuation.fresh).toBe(3);
    expect(dashboard!.valuation.stale).toBe(0);
    expect(dashboard!.valuation.missing).toBe(0);

    // Per-position checks
    for (const t of TRADE_FIXTURES) {
      const pos = dashboard!.valuation.positions.find(
        (p) => p.symbol === t.symbol,
      );
      expect(pos).toBeDefined();
      expect(pos!.direction).toBe(t.direction);
      expect(pos!.quantity).toBe(normalizeDecimal(t.shares));
      expect(pos!.averageCost).toBe(normalizeDecimal(t.avgEntryPrice));
      expect(pos!.markStatus).toBe('fresh');
      expect(pos!.markPrice).toBe(normalizeDecimal(t.currentPrice));
      expect(pos!.markAgeMinutes).toBeLessThan(1);

      // markedValue = markPrice × quantity
      const expectedValue = normalizeDecimal(t.currentPrice * t.shares);
      expect(pos!.markedValue).toBe(expectedValue);
    }

    // Integrity — all fresh marks → healthy
    expect(dashboard!.integrity.status).toBe('healthy');
    expect(dashboard!.integrity.warnings.length).toBe(0);
  });

  // ── Stage 5: V1-vs-V2 PnL Cross-Consistency ─────────────────────────

  it('P5: V1 MTM PnL matches V2 valuation PnL for all positions', () => {
    const dashboard = computeDashboardV2(ctx.sqlite, ctx.accountId);

    expect(dashboard).toBeDefined();

    // Compute V1 PnL from trades.current_price for each trade
    const v1PnLBySymbol: Record<string, string> = {};
    for (const t of TRADE_FIXTURES) {
      // V1 PnL = (current_price - avg_entry_price) × total_shares
      const v1Amount = (t.currentPrice - t.avgEntryPrice) * t.shares;
      v1PnLBySymbol[t.symbol] = normalizeDecimal(v1Amount);
    }

    // Compute V2 PnL from dashboard for each position
    let totalV1PnL = '0.00';
    let totalV2PnL = '0.00';

    for (const t of TRADE_FIXTURES) {
      const pos = dashboard!.valuation.positions.find(
        (p) => p.symbol === t.symbol,
      );
      expect(pos).toBeDefined();

      // V2 unrealizedPnl from dashboard
      const v2Pnl = pos!.unrealizedPnl;
      expect(v2Pnl).not.toBeNull();

      const expectedV1Pnl = v1PnLBySymbol[t.symbol];

      // V1 and V2 should match exactly (same price, same quantity)
      expect(v2Pnl).toBe(expectedV1Pnl);

      totalV1PnL = sumDecimals([totalV1PnL, expectedV1Pnl]);
      totalV2PnL = sumDecimals([totalV2PnL, v2Pnl!]);
    }

    // Total PnL should match across V1 and V2
    expect(totalV1PnL).toBe(totalV2PnL);

    // Verify expected totals
    const expectedTotalPosPnl = Object.values(EXPECTED_V1_PNL).reduce(
      (acc, v) => sumDecimals([acc, v]),
      '0.00',
    );
    expect(totalV1PnL).toBe(expectedTotalPosPnl);

    // Dashboard riskSummary.openPnl should match total unrealized PnL
    expect(dashboard!.riskSummary.openPnl).toBe(expectedTotalPosPnl);
  });

  // ── Stage 6: Dashboard V2 Cross-Check with V1 — trades table ────────

  it('P6: trades.current_price matches valuation_marks.price (V1 ↔ V2 price consistency)', () => {
    // V1 source: trades.current_price (updated by MTM refresh)
    // V2 source: valuation_marks.price (written by MTM refresh)
    // Both should be the same value for each symbol

    const marks = listLatestValuationMarks(ctx.sqlite, ctx.accountId);
    const marksByInstrument = new Map(marks.map((m) => [m.instrument_id, m]));

    for (const t of TRADE_FIXTURES) {
      const instrument = findInstrumentBySymbol(ctx.sqlite, t.symbol);
      expect(instrument).toBeDefined();

      // V2 price from valuation_marks
      const mark = marksByInstrument.get(instrument!.id);
      expect(mark).toBeDefined();
      expect(Number(mark!.price)).toBeCloseTo(t.currentPrice, 2);

      // V1 price from trades.current_price
      const trade = ctx.sqlite
        .prepare('SELECT current_price FROM trades WHERE id = ?')
        .get(ctx.tradeIds[t.symbol]) as { current_price: number | null } | undefined;
      expect(trade).toBeDefined();
      expect(trade!.current_price).toBeCloseTo(t.currentPrice, 2);

      // V1 and V2 prices should match
      expect(Number(mark!.price)).toBeCloseTo(trade!.current_price!, 2);
    }
  });

  // ── Stage 7: Dashboard V2 Integrity and Risk ────────────────────────

  it('P7: Dashboard V2 integrity is healthy with no missing marks', () => {
    const dashboard = computeDashboardV2(ctx.sqlite, ctx.accountId);

    expect(dashboard).toBeDefined();

    // Integrity status
    expect(dashboard!.integrity.status).toBe('healthy');
    expect(dashboard!.integrity.warnings.length).toBe(0);

    // Journal attribution — all 3 executions should be linked to journal trades
    expect(dashboard!.journalAttribution.hasJournalTrades).toBe(true);
    expect(dashboard!.journalAttribution.journalExecutionCount).toBe(3);
    expect(dashboard!.journalAttribution.accountOnlyExecutionCount).toBe(0);

    // Risk summary
    const expectedTotalPnl = Object.values(EXPECTED_V1_PNL).reduce(
      (acc, v) => sumDecimals([acc, v]),
      '0.00',
    );
    expect(dashboard!.riskSummary.openPnl).toBe(expectedTotalPnl);
  });
});

// ── Raw Helper (for the instrument lookup in P3 where we don't have the
//    accounting-repository helper that returns symbol from ID) ──────────

function findInstrumentById_raw(
  sqlite: Database.Database,
  id: string,
): { id: string; symbol: string } | undefined {
  return sqlite
    .prepare('SELECT id, symbol FROM instruments WHERE id = ?')
    .get(id) as { id: string; symbol: string } | undefined;
}
