/**
 * Cross-surface reconciliation contract regression tests (slice S03 / T02).
 *
 * Proves the journal-linked dashboard values reconcile EXACTLY to the Trades
 * list/detail API at the same mark snapshot. All three surfaces — the
 * dashboard snapshot (computeDashboardV2), GET /api/trades (list), and
 * GET /api/trades/[id] (detail) — are exercised against the SAME real SQLite
 * database through their real public boundaries:
 *
 *   - The dashboard reads the shared DB via its raw better-sqlite3 handle
 *     (computeDashboardV2(sqlite, accountId)).
 *   - The list/detail API surface is the REAL route handler (imported from
 *     `@/app/api/trades/route` and `@/app/api/trades/[id]/route`), driven by
 *     the same `@/db` drizzle singleton, invoked with real NextRequest
 *     objects.
 *
 * Coverage (maps to the slice must-haves):
 *   1. Multi-entry, partial-exit, FIFO-lot-matched, fee-bearing scenario —
 *      per-position journalLinkedMetrics equals the list API `metrics` and
 *      the detail API `metrics` dimension-for-dimension (remainingQty,
 *      openAvgCost, grossRealizedPnl, netRealizedPnl, netUnrealizedPnl,
 *      openFees), with concrete FIFO numbers and honest per-dimension
 *      match/mismatch statuses for the known fee-convention divergence.
 *   2. Fee-free multi-entry partial exit — all six dimension comparisons
 *      'match', provenance 'complete', exact numbers on all three surfaces.
 *   3. Account-only exposure — contributes zero to every journalLinked
 *      aggregate, carries no journalLinkedMetrics, never appears on the
 *      Trades surface (no trade row to reconcile), provenance 'unavailable'.
 *   4. Mixed account (journal + account-only) — aggregates cover only the
 *      journal-linked position; account-only realized P&L is never blended.
 *   5. Missing trade mark — net unrealized stays null on all three surfaces,
 *      the comparison reports 'unavailable' and the aggregate keeps
 *      partial-sum-as-null (never a partial-looking number).
 *   6. Dangling journal link — provenance 'partial' (a journal-linked
 *      position exists but cannot be reconciled), while the Trades surface
 *      honestly has no row for the missing trade.
 *
 * Tests seed data directly into the shared DB and read it back through the
 * real boundaries — no mocks, no stubs.
 *
 * @module accounting/__tests__/dashboard-journal-reconciliation.test
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

// ── Test Database Routing ──────────────────────────────────────────────
// Point @/db at a dedicated throwaway test DB BEFORE it initializes its
// module-level singleton (vi.hoisted runs before all static imports are
// evaluated). The trades route handlers and computeDashboardV2 then share
// one real SQLite file through the real `@/db` module.

const testDbPath = vi.hoisted(() => {
  const p = (process.env.TMPDIR || process.env.TMP || '/tmp') + '/tradingjournal-test-dashboard-journal-reconciliation-' + process.pid + '-' + Date.now() + '.db';
  process.env.DB_FILE_NAME = p;
  return p;
});

// server-only throws outside a Next.js server context — stub it so the real
// @/db module (and everything importing it) loads under vitest.
vi.mock('server-only', () => ({}));

// ═══════════════════════════════════════════════════════════════════════════
// Real module imports (the surfaces under test)
// ═══════════════════════════════════════════════════════════════════════════

import { getSqliteHandle } from '@/db';
import { computeDashboardV2 } from '@/lib/accounting/dashboard-v2';
import type {
  JournalLinkedDimensionComparison,
} from '@/lib/accounting/dashboard-v2';
import { GET as tradesListGET } from '@/app/api/trades/route';
import { GET as tradeDetailGET } from '@/app/api/trades/[id]/route';
import type { TradeListMetrics, TradeMetricsResult } from '@/lib/trade-metrics';

// ── Shared types ────────────────────────────────────────────────────────

/** The six journal-linked dimensions compared across surfaces. */
interface JournalLinkedSix {
  remainingQty: number | null;
  openAvgCost: number | null;
  grossRealizedPnl: number | null;
  netRealizedPnl: number | null;
  netUnrealizedPnl: number | null;
  openFees: number | null;
}

type ExecutionSeed = {
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  fees: number;
};

interface SeedScenarioOptions {
  symbol: string;
  executions: ExecutionSeed[];
  /** The trade's current mark (trades.current_price) — null = no mark. */
  currentPrice: number | null;
  /** Accounting projection of the position (account_positions). */
  position: {
    quantity: string;
    averageCost: string;
    realizedGross: string;
    realizedFees: string;
    realizedNet: string;
    markPrice: string | null;
  };
  /**
   * Open FIFO lots (fifo_lots) paired with the entry executions in order.
   * The accounting convention keeps FULL entry fees on open lots, so a
   * partially consumed lot still carries its full entry fee here.
   */
  fifoLots?: Array<{
    remainingQuantity: string;
    originalQuantity: string;
    entryPrice: string;
    allocatedFees: string;
  }>;
  withRiskSnapshot?: boolean;
}

interface SeededScenario {
  accountId: string;
  instrumentId: string;
  tradeId: string;
  /** Accounting execution ids of the entry executions (fifo lot anchors). */
  entryExecutionIds: string[];
  exitExecutionIds: string[];
}

// ── Seed helpers ────────────────────────────────────────────────────────

const now = () => new Date().toISOString();
const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

/**
 * Seed one account + instrument with a journal trade, its trade executions,
 * mirrored journal-linked accounting executions, the accounting position
 * projection, a valuation mark, and optional FIFO open lots. Returns the ids
 * needed for cross-surface assertions.
 */
function seedScenario(sqlite: ReturnType<typeof getSqliteHandle>, options: SeedScenarioOptions): SeededScenario {
  const accountId = randomUUID();
  const instrumentId = randomUUID();
  const { symbol } = options;
  const ts = now();

  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', 1, 100000, ?, ?)`,
    )
    .run(accountId, `${symbol} Account`, 'Unit Test Broker', ts, ts);

  sqlite
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'stock', 'USD', 1, ?, ?)`,
    )
    .run(instrumentId, symbol, `${symbol} Inc.`, ts, ts);

  const tradeId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO trades
       (id, trade_code, account_id, symbol, direction, status, current_price,
        current_price_fetched_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'long', 'open', ?, ?, ?, ?)`,
    )
    .run(
      tradeId,
      `T-${randomUUID().slice(0, 8)}`,
      accountId,
      symbol,
      options.currentPrice,
      options.currentPrice != null ? ts : null,
      ts,
      ts,
    );

  const executionIds: string[] = [];
  for (let i = 0; i < options.executions.length; i++) {
    const ex = options.executions[i];
    const execId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO trade_executions
         (id, trade_id, action, quantity, price, fees, executed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(execId, tradeId, ex.action, ex.quantity, ex.price, ex.fees, minutesAgo(60 - i), ts);
    executionIds.push(execId);
  }

  if (options.withRiskSnapshot) {
    const firstEntry = options.executions.find((e) => e.action === 'buy');
    sqlite
      .prepare(
        `INSERT INTO trade_risk_snapshots
         (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price,
          initial_quantity, risk_per_share, initial_risk_amount, created_at)
         VALUES (?, ?, 100000, ?, 90, ?, ?, 1000, ?)`,
      )
      .run(
        randomUUID(),
        tradeId,
        firstEntry?.price ?? 0,
        firstEntry?.quantity ?? 0,
        0,
        ts,
      );
  }

  // Mirror the trade executions into accounting_executions (journal-linked).
  const accountingExecutionIds: string[] = [];
  for (let i = 0; i < options.executions.length; i++) {
    const ex = options.executions[i];
    const id = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO accounting_executions
         (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
          journal_trade_id, description, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        accountId,
        instrumentId,
        ex.action,
        ex.quantity.toFixed(2),
        ex.price.toFixed(2),
        ex.fees.toFixed(2),
        randomUUID(),
        tradeId,
        `${ex.action} ${ex.quantity} ${symbol} via journal`,
        minutesAgo(60 - i),
      );
    accountingExecutionIds.push(id);
  }

  const entryExecutionIds = accountingExecutionIds.filter(
    (_, i) => options.executions[i].action === 'buy',
  );
  const exitExecutionIds = accountingExecutionIds.filter(
    (_, i) => options.executions[i].action === 'sell',
  );

  // Accounting position projection.
  sqlite
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      instrumentId,
      'long',
      options.position.quantity,
      options.position.averageCost,
      '0.00',
      options.position.realizedGross,
      options.position.realizedFees,
      options.position.realizedNet,
      ts,
      ts,
      ts,
    );

  // Valuation mark (fresh, 1 minute old).
  if (options.position.markPrice !== null) {
    sqlite
      .prepare(
        `INSERT INTO valuation_marks
         (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
         VALUES (?, ?, ?, ?, ?, 'user', ?)`,
      )
      .run(
        randomUUID(),
        accountId,
        instrumentId,
        options.position.markPrice,
        Math.round(parseFloat(options.position.markPrice) * 1_000_000),
        minutesAgo(1),
      );
  }

  // Optional FIFO open lots (accounting open-fee convention: full entry fee
  // stays on the open lot row regardless of partial consumption).
  if (options.fifoLots) {
    for (let i = 0; i < options.fifoLots.length; i++) {
      const lot = options.fifoLots[i];
      sqlite
        .prepare(
          `INSERT INTO fifo_lots
           (id, account_id, instrument_id, direction, remaining_quantity,
            original_quantity, entry_price, cost_basis_total, allocated_fees,
            opening_execution_id, opened_at, created_at)
           VALUES (?, ?, ?, 'long', ?, ?, ?, '0.00', ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          accountId,
          instrumentId,
          lot.remainingQuantity,
          lot.originalQuantity,
          lot.entryPrice,
          lot.allocatedFees,
          entryExecutionIds[i],
          minutesAgo(60),
          ts,
        );
    }
  }

  return { accountId, instrumentId, tradeId, entryExecutionIds, exitExecutionIds };
}

// ── Cross-surface access helpers ────────────────────────────────────────

/** Extract the six journal-linked dimensions from a Trades API metrics block. */
function extractSix(metrics: TradeListMetrics | TradeMetricsResult): JournalLinkedSix {
  return {
    remainingQty: metrics.size.openQuantity,
    openAvgCost: metrics.averagePrices.openAvgCost,
    grossRealizedPnl: metrics.realizedPnl.grossRealizedPnl,
    netRealizedPnl: metrics.realizedPnl.netRealizedPnl,
    netUnrealizedPnl: metrics.unrealizedPnl.netUnrealizedPnl,
    openFees: metrics.fees.openFees,
  };
}

async function fetchListRow(
  accountId: string,
  tradeId: string,
): Promise<{ id: string; symbol: string; metrics: TradeListMetrics }> {
  const res = await tradesListGET(
    new NextRequest(
      `http://localhost/api/trades?status=open&accountId=${encodeURIComponent(accountId)}`,
    ),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: Array<{ id: string; symbol: string; metrics: TradeListMetrics }>;
    total: number;
  };
  const row = body.data.find((r) => r.id === tradeId);
  expect(row).toBeDefined();
  return row!;
}

async function fetchDetail(tradeId: string): Promise<{ id: string; metrics: TradeMetricsResult }> {
  const res = await tradeDetailGET(
    new NextRequest(`http://localhost/api/trades/${tradeId}`),
    { params: Promise.resolve({ id: tradeId }) },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; metrics: TradeMetricsResult };
}

function comparisonsByKey(comparisons: JournalLinkedDimensionComparison[]): Map<string, JournalLinkedDimensionComparison> {
  return new Map(comparisons.map((c) => [c.key, c]));
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('journal-linked cross-surface reconciliation', () => {
  beforeAll(() => {
    // Fail fast if the @/db singleton did not initialize against the test file.
    expect(existsSync(testDbPath)).toBe(true);
  });

  afterAll(() => {
    try {
      getSqliteHandle().close();
    } catch {
      // already closed
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        unlinkSync(testDbPath + suffix);
      } catch {
        // already gone
      }
    }
  });

  it('reconciles a multi-entry, partial-exit, FIFO-lot-matched, fee-bearing position exactly across dashboard, list, and detail', async () => {
    // Scenario: buy 6 @ 100 (fee 1.00), buy 6 @ 130 (fee 1.00), partial exit
    // 3 @ 140 (fee 0.50), mark 140. FIFO matches the exit against the oldest
    // lot (6 @ 100). Remaining: 3 @ 100 + 6 @ 130 → 9 @ 120.00.
    //
    // Journal kernel expectations:
    //   gross realized = (140 − 100) × 3 = 120.00
    //   realized fees = entry fee on matched qty (1.00 × 3/6 = 0.50) + exit fee 0.50 = 1.00
    //   net realized = 120.00 − 1.00 = 119.00
    //   open avg cost = (3×100 + 6×130) / 9 = 120.00
    //   open fees = 0.50 (remaining lot-1 fee) + 1.00 (lot-2 fee) = 1.50
    //   net unrealized = (140 − 120) × 9 − 1.50 = 178.50
    const seeded = seedScenario(getSqliteHandle(), {
      symbol: 'XSR1',
      executions: [
        { action: 'buy', quantity: 6, price: 100, fees: 1 },
        { action: 'buy', quantity: 6, price: 130, fees: 1 },
        { action: 'sell', quantity: 3, price: 140, fees: 0.5 },
      ],
      currentPrice: 140,
      withRiskSnapshot: true,
      position: {
        quantity: '9.00',
        averageCost: '120.00',
        // Accounting convention: entry fees stay on open lots; realized
        // carries only the exit fee → net realized 120.00 − 0.50 = 119.50.
        realizedGross: '120.00',
        realizedFees: '0.50',
        realizedNet: '119.50',
        markPrice: '140.00',
      },
      // Accounting keeps the FULL entry fee on each open lot row (1.00 + 1.00).
      fifoLots: [
        { remainingQuantity: '3.00', originalQuantity: '6.00', entryPrice: '100.00', allocatedFees: '1.00' },
        { remainingQuantity: '6.00', originalQuantity: '6.00', entryPrice: '130.00', allocatedFees: '1.00' },
      ],
    });

    // ── Dashboard surface ─────────────────────────────────────────────
    const dashboard = computeDashboardV2(getSqliteHandle(), seeded.accountId);
    expect(dashboard).toBeDefined();
    const pos = dashboard!.valuation.positions[0];
    expect(pos.symbol).toBe('XSR1');
    expect(pos.attribution.kind).toBe('journal');
    expect(pos.journalLinkedMetrics).not.toBeNull();

    // ── Trades list surface (real route handler) ──────────────────────
    const listRow = await fetchListRow(seeded.accountId, seeded.tradeId);
    const listSix = extractSix(listRow.metrics);

    // ── Trades detail surface (real route handler) ────────────────────
    const detailRow = await fetchDetail(seeded.tradeId);
    const detailSix = extractSix(detailRow.metrics);

    // ── Contract: all three surfaces agree dimension-for-dimension ─────
    expect(pos.journalLinkedMetrics).toEqual(listSix);
    expect(pos.journalLinkedMetrics).toEqual(detailSix);
    expect(listSix).toEqual(detailSix);

    // ── Concrete FIFO numbers for this scenario ───────────────────────
    expect(pos.journalLinkedMetrics!.remainingQty).toBe(9);
    expect(pos.journalLinkedMetrics!.openAvgCost).toBe(120);
    expect(pos.journalLinkedMetrics!.grossRealizedPnl).toBe(120);
    expect(pos.journalLinkedMetrics!.netRealizedPnl).toBe(119);
    expect(pos.journalLinkedMetrics!.netUnrealizedPnl).toBe(178.5);
    expect(pos.journalLinkedMetrics!.openFees).toBe(1.5);

    // ── Aggregate section ─────────────────────────────────────────────
    const jl = dashboard!.journalLinked;
    expect(jl.tradeCount).toBe(1);
    expect(jl.positionCount).toBe(1);
    expect(jl.remainingQty).toBe('9.00');
    expect(jl.openAvgCost).toBe('120.00');
    expect(jl.grossRealizedPnl).toBe('120.00');
    expect(jl.netRealizedPnl).toBe('119.00');
    expect(jl.netUnrealizedPnl).toBe('178.50');
    expect(jl.openFees).toBe('1.50');
    expect(jl.provenance.source).toContain('fifo_lots');

    // ── Per-dimension comparisons: convention-aligned dimensions match; ─
    // ── fee-convention dimensions diverge honestly with exact diffs.    ─
    const byKey = comparisonsByKey(jl.comparisons);
    expect(byKey.get('remainingQty')!.status).toBe('match');
    expect(byKey.get('remainingQty')!.difference).toBe('0.00');
    expect(byKey.get('openAvgCost')!.status).toBe('match');
    expect(byKey.get('openAvgCost')!.difference).toBe('0.00');
    expect(byKey.get('grossRealizedPnl')!.status).toBe('match');
    expect(byKey.get('grossRealizedPnl')!.difference).toBe('0.00');

    // Accounting net realized keeps only the exit fee on realized (119.50);
    // the journal kernel also charges the matched entry fee (119.00).
    expect(byKey.get('netRealizedPnl')!.status).toBe('mismatch');
    expect(byKey.get('netRealizedPnl')!.dashboardValue).toBe('119.50');
    expect(byKey.get('netRealizedPnl')!.tradesValue).toBe('119.00');
    expect(byKey.get('netRealizedPnl')!.difference).toBe('0.50');

    // Dashboard net unrealized = (140 − 120) × 9 − full open fees 2.00 = 178.00;
    // journal net unrealized = 180.00 − 1.50 = 178.50.
    expect(byKey.get('netUnrealizedPnl')!.status).toBe('mismatch');
    expect(byKey.get('netUnrealizedPnl')!.dashboardValue).toBe('178.00');
    expect(byKey.get('netUnrealizedPnl')!.tradesValue).toBe('178.50');
    expect(byKey.get('netUnrealizedPnl')!.difference).toBe('-0.50');

    expect(byKey.get('openFees')!.status).toBe('mismatch');
    expect(byKey.get('openFees')!.dashboardValue).toBe('2.00');
    expect(byKey.get('openFees')!.tradesValue).toBe('1.50');
    expect(byKey.get('openFees')!.difference).toBe('0.50');

    // Divergence surfaces in provenance so S04 can alert.
    expect(jl.provenance.status).toBe('partial');
  });

  it('reconciles a fee-free multi-entry partial exit exactly with provenance complete on all three surfaces', async () => {
    // Scenario: buy 6 @ 100, buy 6 @ 130, partial exit 2 @ 140, mark 140.
    // FIFO matches the exit against the oldest lot (6 @ 100).
    //   remaining 4 @ 100 + 6 @ 130 = 10 @ 118.00
    //   gross/net realized = (140 − 100) × 2 = 80.00
    //   net unrealized = (140 − 118) × 10 = 220.00
    const seeded = seedScenario(getSqliteHandle(), {
      symbol: 'XSR2',
      executions: [
        { action: 'buy', quantity: 6, price: 100, fees: 0 },
        { action: 'buy', quantity: 6, price: 130, fees: 0 },
        { action: 'sell', quantity: 2, price: 140, fees: 0 },
      ],
      currentPrice: 140,
      position: {
        quantity: '10.00',
        averageCost: '118.00',
        realizedGross: '80.00',
        realizedFees: '0.00',
        realizedNet: '80.00',
        markPrice: '140.00',
      },
    });

    const dashboard = computeDashboardV2(getSqliteHandle(), seeded.accountId);
    expect(dashboard).toBeDefined();
    const pos = dashboard!.valuation.positions[0];
    expect(pos.journalLinkedMetrics).not.toBeNull();

    const listRow = await fetchListRow(seeded.accountId, seeded.tradeId);
    const detailRow = await fetchDetail(seeded.tradeId);

    // Three-surface exact equality.
    expect(pos.journalLinkedMetrics).toEqual(extractSix(listRow.metrics));
    expect(pos.journalLinkedMetrics).toEqual(extractSix(detailRow.metrics));

    // Concrete values.
    expect(pos.journalLinkedMetrics!.remainingQty).toBe(10);
    expect(pos.journalLinkedMetrics!.openAvgCost).toBe(118);
    expect(pos.journalLinkedMetrics!.netRealizedPnl).toBe(80);
    expect(pos.journalLinkedMetrics!.netUnrealizedPnl).toBe(220);

    // Fee-free: every dimension comparison matches and provenance is complete.
    const jl = dashboard!.journalLinked;
    expect(jl.tradeCount).toBe(1);
    expect(jl.positionCount).toBe(1);
    expect(jl.remainingQty).toBe('10.00');
    expect(jl.openAvgCost).toBe('118.00');
    expect(jl.netRealizedPnl).toBe('80.00');
    expect(jl.netUnrealizedPnl).toBe('220.00');
    expect(jl.openFees).toBe('0.00');
    for (const c of jl.comparisons) {
      expect(c.status).toBe('match');
      expect(c.difference).toBe('0.00');
      expect(c.dashboardValue).toBe(c.tradesValue);
    }
    expect(jl.provenance.status).toBe('complete');
  });

  it('keeps account-only exposure out of every journalLinked aggregate and off the Trades surface', async () => {
    // Account-only position: account_positions + valuation mark, NO journal
    // trades, NO accounting executions. Realized P&L 500.00 must never blend
    // into journal performance.
    const accountId = randomUUID();
    const instrumentId = randomUUID();
    const ts = now();

    const sqlite = getSqliteHandle();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 1, 100000, ?, ?)`,
      )
      .run(accountId, 'Account-Only Acct', 'Unit Test Broker', ts, ts);
    sqlite
      .prepare(
        `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'stock', 'USD', 1, ?, ?)`,
      )
      .run(instrumentId, 'XSR3', 'XSR3 Inc.', ts, ts);
    sqlite
      .prepare(
        `INSERT INTO account_positions
         (id, account_id, instrument_id, direction, quantity, average_cost,
          total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
          last_updated, created_at, updated_at)
         VALUES (?, ?, ?, 'long', '20.00', '50.00', '1000.00', '500.00', '0.00', '500.00', ?, ?, ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, ts, ts, ts);
    sqlite
      .prepare(
        `INSERT INTO valuation_marks
         (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
         VALUES (?, ?, ?, '55.00', 55000000, 'user', ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, minutesAgo(1));

    // Dashboard surface: account-only position is visibly attributed and
    // contributes zero to every journalLinked aggregate.
    const dashboard = computeDashboardV2(sqlite, accountId);
    expect(dashboard).toBeDefined();
    const pos = dashboard!.valuation.positions[0];
    expect(pos.attribution.kind).toBe('account_only');
    expect(pos.journalLinkedMetrics).toBeNull();

    const jl = dashboard!.journalLinked;
    expect(jl.tradeCount).toBe(0);
    expect(jl.positionCount).toBe(0);
    expect(jl.remainingQty).toBe('0.00');
    expect(jl.grossRealizedPnl).toBe('0.00');
    expect(jl.netRealizedPnl).toBe('0.00');
    expect(jl.openFees).toBe('0.00');
    expect(jl.provenance.status).toBe('unavailable');
    for (const c of jl.comparisons) {
      expect(c.dashboardValue).toBeNull();
      expect(c.tradesValue).toBeNull();
      expect(c.difference).toBeNull();
      expect(c.status).toBe('unavailable');
    }

    // Trades surface: there is no journal trade row for account-only
    // exposure — nothing to reconcile, and the dashboard says so honestly.
    const res = await tradesListGET(
      new NextRequest(`http://localhost/api/trades?status=open&accountId=${encodeURIComponent(accountId)}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });

  it('never blends account-only realized P&L into journal aggregates in a mixed account', async () => {
    // One account, two instruments: journal-linked (J1) + account-only (J2
    // with realized 500.00). The journalLinked aggregate must cover only J1.
    const seeded = seedScenario(getSqliteHandle(), {
      symbol: 'XSR4',
      executions: [{ action: 'buy', quantity: 10, price: 100, fees: 0 }],
      currentPrice: 110,
      position: {
        quantity: '10.00',
        averageCost: '100.00',
        realizedGross: '0.00',
        realizedFees: '0.00',
        realizedNet: '0.00',
        markPrice: '110.00',
      },
    });

    // Add an account-only position to the SAME account.
    const accountOnlyInstrumentId = randomUUID();
    const sqlite = getSqliteHandle();
    const ts = now();
    sqlite
      .prepare(
        `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'stock', 'USD', 1, ?, ?)`,
      )
      .run(accountOnlyInstrumentId, 'XSR5', 'XSR5 Inc.', ts, ts);
    sqlite
      .prepare(
        `INSERT INTO account_positions
         (id, account_id, instrument_id, direction, quantity, average_cost,
          total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
          last_updated, created_at, updated_at)
         VALUES (?, ?, ?, 'long', '50.00', '200.00', '10000.00', '500.00', '0.00', '500.00', ?, ?, ?)`,
      )
      .run(randomUUID(), seeded.accountId, accountOnlyInstrumentId, ts, ts, ts);
    sqlite
      .prepare(
        `INSERT INTO valuation_marks
         (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
         VALUES (?, ?, ?, '210.00', 210000000, 'user', ?)`,
      )
      .run(randomUUID(), seeded.accountId, accountOnlyInstrumentId, minutesAgo(1));

    // Dashboard: both positions present, attribution separates them.
    const dashboard = computeDashboardV2(sqlite, seeded.accountId);
    expect(dashboard).toBeDefined();
    expect(dashboard!.valuation.positions).toHaveLength(2);
    const bySymbol = new Map(dashboard!.valuation.positions.map((p) => [p.symbol, p]));
    expect(bySymbol.get('XSR4')!.journalLinkedMetrics).not.toBeNull();
    expect(bySymbol.get('XSR5')!.attribution.kind).toBe('account_only');
    expect(bySymbol.get('XSR5')!.journalLinkedMetrics).toBeNull();

    // Aggregate covers only the journal-linked position: qty 10, not 60, and
    // the account-only realized 500.00 is never blended in.
    const jl = dashboard!.journalLinked;
    expect(jl.tradeCount).toBe(1);
    expect(jl.positionCount).toBe(1);
    expect(jl.remainingQty).toBe('10.00');
    expect(jl.grossRealizedPnl).toBe('0.00');
    expect(jl.netRealizedPnl).toBe('0.00');
    expect(jl.provenance.status).toBe('complete');

    // Trades surface for this account: exactly the one journal trade row —
    // the account-only instrument has no trade row to reconcile.
    const res = await tradesListGET(
      new NextRequest(`http://localhost/api/trades?status=open&accountId=${encodeURIComponent(seeded.accountId)}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; symbol: string; metrics: TradeListMetrics }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].symbol).toBe('XSR4');
    // And the single trade's metrics agree with the dashboard block.
    expect(bySymbol.get('XSR4')!.journalLinkedMetrics).toEqual(extractSix(body.data[0].metrics));
  });

  it('keeps net unrealized null-consistent across all three surfaces when the open trade has no mark', async () => {
    // Trade has no current_price mark (currentPrice null) → the journal
    // kernel cannot price it → net unrealized is null everywhere, never 0.
    const seeded = seedScenario(getSqliteHandle(), {
      symbol: 'XSR6',
      executions: [{ action: 'buy', quantity: 10, price: 100, fees: 0 }],
      currentPrice: null,
      position: {
        quantity: '10.00',
        averageCost: '100.00',
        realizedGross: '0.00',
        realizedFees: '0.00',
        realizedNet: '0.00',
        markPrice: '110.00',
      },
    });

    const dashboard = computeDashboardV2(getSqliteHandle(), seeded.accountId);
    expect(dashboard).toBeDefined();
    const pos = dashboard!.valuation.positions[0];

    // Dashboard surface: kernel-derived net unrealized is null.
    expect(pos.journalLinkedMetrics!.netUnrealizedPnl).toBeNull();

    // Trades list + detail surfaces: same null contract.
    const listRow = await fetchListRow(seeded.accountId, seeded.tradeId);
    const detailRow = await fetchDetail(seeded.tradeId);
    expect(listRow.metrics.unrealizedPnl.netUnrealizedPnl).toBeNull();
    expect(detailRow.metrics.unrealizedPnl.netUnrealizedPnl).toBeNull();
    expect(pos.journalLinkedMetrics).toEqual(extractSix(listRow.metrics));
    expect(pos.journalLinkedMetrics).toEqual(extractSix(detailRow.metrics));

    // Aggregate: partial-sum-as-null — never a partial-looking number.
    const jl = dashboard!.journalLinked;
    expect(jl.netUnrealizedPnl).toBeNull();
    const comparison = comparisonsByKey(jl.comparisons).get('netUnrealizedPnl')!;
    expect(comparison.status).toBe('unavailable');
    expect(comparison.dashboardValue).toBe('100.00'); // valuation mark exists
    expect(comparison.tradesValue).toBeNull(); // no trade mark → kernel unknown
    expect(comparison.difference).toBeNull();
    expect(jl.provenance.status).toBe('partial');
  });

  it('reports partial provenance for a dangling journal link and confirms the Trades surface has no row for it', async () => {
    // A journal-linked position whose linked trade row does not exist cannot
    // be reconciled: the dashboard must say 'partial' (not 'unavailable'),
    // and the Trades API honestly has no row for the missing trade.
    const accountId = randomUUID();
    const instrumentId = randomUUID();
    const missingTradeId = randomUUID();
    const ts = now();
    const sqlite = getSqliteHandle();

    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', 1, 100000, ?, ?)`,
      )
      .run(accountId, 'Dangling Acct', 'Unit Test Broker', ts, ts);
    sqlite
      .prepare(
        `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'stock', 'USD', 1, ?, ?)`,
      )
      .run(instrumentId, 'XSR7', 'XSR7 Inc.', ts, ts);
    sqlite
      .prepare(
        `INSERT INTO accounting_executions
         (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
          journal_trade_id, description, posted_at)
         VALUES (?, ?, ?, 'buy', '10.00', '100.00', '0.00', ?, ?, 'Dangling journal link', ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, randomUUID(), missingTradeId, ts);
    sqlite
      .prepare(
        `INSERT INTO account_positions
         (id, account_id, instrument_id, direction, quantity, average_cost,
          total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
          last_updated, created_at, updated_at)
         VALUES (?, ?, ?, 'long', '10.00', '100.00', '1000.00', '0.00', '0.00', '0.00', ?, ?, ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, ts, ts, ts);
    sqlite
      .prepare(
        `INSERT INTO valuation_marks
         (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
         VALUES (?, ?, ?, '110.00', 110000000, 'user', ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, minutesAgo(1));

    const dashboard = computeDashboardV2(sqlite, accountId);
    expect(dashboard).toBeDefined();
    const pos = dashboard!.valuation.positions[0];
    // The execution is journal-linked (has a journal_trade_id) but the trade
    // row is missing → unreconciled.
    expect(pos.attribution.kind).toBe('journal');
    expect(pos.journalLinkedMetrics).toBeNull();

    const jl = dashboard!.journalLinked;
    expect(jl.tradeCount).toBe(0);
    expect(jl.positionCount).toBe(0);
    // 'partial', not 'unavailable': a journal-linked position exists but
    // could not be reconciled.
    expect(jl.provenance.status).toBe('partial');

    // Trades surface: the missing trade does not exist, so there is no row
    // to reconcile against — the dashboard's 'partial' is the honest signal.
    const res = await tradesListGET(
      new NextRequest(`http://localhost/api/trades?status=open&accountId=${encodeURIComponent(accountId)}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });
});
