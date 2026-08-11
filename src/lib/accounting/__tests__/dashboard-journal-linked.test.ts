/**
 * Unit tests for the journal-linked metrics and reconciliation section in
 * computeDashboardV2 (slice S03 / T01 scope).
 *
 * Coverage:
 * - Journal-linked positions carry a journalLinkedMetrics block computed via
 *   computeTradeMetrics — the same kernel the Trades list/detail API uses —
 *   and the block matches a direct kernel invocation exactly (kernel wiring).
 * - Account-only positions contribute zero to every journalLinked aggregate
 *   (attribution separation at the aggregation boundary).
 * - provenance.status vocabulary: complete / partial / unavailable.
 * - Per-dimension reconciliation comparisons (dashboard value vs Trades value
 *   vs difference) with honest match/mismatch/unavailable statuses — the
 *   fee-bearing case reports the engines' known fee-convention differences.
 * - Partial-sum-as-null: an unpriced journal trade makes the aggregate
 *   netUnrealizedPnl null, never a partial sum.
 * - Multiple open linked trades on one instrument merge into one block.
 *
 * Scenarios are seeded directly into a real SQLite database and read back
 * through the public computeDashboardV2() boundary — no mocks, no stubs.
 *
 * The full cross-surface contract regression (multi-entry, partial-exit,
 * FIFO-lot-matched, fee-bearing scenario asserted against GET /api/trades and
 * GET /api/trades/[id]) lives in dashboard-journal-reconciliation.test.ts.
 *
 * @module accounting/__tests__/dashboard-journal-linked.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { computeDashboardV2 } from '../dashboard-v2';
import { computeTradeMetrics } from '../../trade-metrics';
import type { TradeMetricsInput } from '../../trade-metrics';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = './.test-dashboard-journal-linked.db';

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

interface SeededPosition {
  instrumentId: string;
  symbol: string;
  direction: 'long' | 'short';
  quantity: string;
  averageCost: string;
  realizedGross: string;
  realizedFees: string;
  realizedNet: string;
  markPrice: string | null;
  /** Open FIFO lot fee allocation (fifo_lots.allocated_fees), or null for none. */
  openFees: string | null;
}

interface SeedOptions {
  /** Journal trade with executions. Omit for an account-only / no-trade position. */
  trade?: {
    executions: Array<{ action: string; quantity: number; price: number; fees: number }>;
    currentPrice: number | null;
    withRiskSnapshot?: boolean;
  };
  /** Second journal trade on the same instrument (multi-trade merge case). */
  secondTrade?: {
    executions: Array<{ action: string; quantity: number; price: number; fees: number }>;
    currentPrice: number | null;
  };
  /** Dangling journal link — journal_trade_id pointing at a non-existent trade. */
  danglingLink?: boolean;
  /** Journal link points at an existing but CLOSED trade. */
  closedLink?: boolean;
  position: SeededPosition;
}

const now = () => new Date().toISOString();
const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

/**
 * Seed one account + instrument with a journal trade, its mirrored accounting
 * executions, the accounting position, a valuation mark, and optional FIFO
 * open fees. Returns the ids and the execution list so a test can drive
 * computeTradeMetrics directly for kernel-equality assertions.
 */
function seedJournalScenario(
  sqlite: Database.Database,
  options: SeedOptions,
): {
  accountId: string;
  instrumentId: string;
  tradeId: string | null;
  secondTradeId: string | null;
  kernelInput: TradeMetricsInput | null;
} {
  const accountId = randomUUID();
  const instrumentId = randomUUID();
  const symbol = options.position.symbol;
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

  let tradeId: string | null = null;
  let secondTradeId: string | null = null;
  let kernelInput: TradeMetricsInput | null = null;

  const seedTrade = (
    executions: Array<{ action: string; quantity: number; price: number; fees: number }>,
    currentPrice: number | null,
    withRiskSnapshot: boolean,
  ): { tradeId: string; executionIds: string[] } => {
    const id = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO trades
         (id, trade_code, account_id, symbol, direction, status, current_price,
          current_price_fetched_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'long', 'open', ?, ?, ?, ?)`,
      )
      .run(id, `T-${randomUUID().slice(0, 8)}`, accountId, symbol, currentPrice, ts, ts, ts);

    const executionIds: string[] = [];
    for (const ex of executions) {
      const execId = randomUUID();
      sqlite
        .prepare(
          `INSERT INTO trade_executions
           (id, trade_id, action, quantity, price, fees, executed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(execId, id, ex.action, ex.quantity, ex.price, ex.fees, ts, ts);
      executionIds.push(execId);
    }

    if (withRiskSnapshot) {
      sqlite
        .prepare(
          `INSERT INTO trade_risk_snapshots
           (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price,
            initial_quantity, risk_per_share, initial_risk_amount, created_at)
           VALUES (?, ?, 100000, ?, 90, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), id, executions[0]?.price ?? 0, executions[0]?.quantity ?? 0, 1000, ts);
    }

    // Mirror the trade executions into accounting_executions (journal-linked)
    for (const ex of executions) {
      sqlite
        .prepare(
          `INSERT INTO accounting_executions
           (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
            journal_trade_id, description, posted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          accountId,
          instrumentId,
          ex.action,
          ex.quantity.toFixed(2),
          ex.price.toFixed(2),
          ex.fees.toFixed(2),
          randomUUID(),
          id,
          `${ex.action} ${ex.quantity} ${symbol} via journal`,
          ts,
        );
    }

    return { tradeId: id, executionIds };
  };

  if (options.trade) {
    const seeded = seedTrade(
      options.trade.executions,
      options.trade.currentPrice,
      options.trade.withRiskSnapshot ?? false,
    );
    tradeId = seeded.tradeId;
    kernelInput = {
      executions: options.trade.executions.map((e, i) => ({
        id: seeded.executionIds[i],
        action: e.action,
        quantity: e.quantity,
        price: e.price,
        fees: e.fees,
        executedAt: ts,
      })),
      direction: 'long',
      riskSnapshot: options.trade.withRiskSnapshot
        ? {
            initialRiskAmount: 1000,
            accountEquityAtOpen: 100000,
            initialStopPrice: 90,
            initialEntryPrice: options.trade.executions[0]?.price ?? null,
          }
        : null,
      stopAdjustments: [],
      currentMark:
        options.trade.currentPrice != null
          ? { price: options.trade.currentPrice, markedAt: ts }
          : null,
      currentAccountEquity: 100000,
    };
  }

  if (options.secondTrade) {
    const seeded = seedTrade(options.secondTrade.executions, options.secondTrade.currentPrice, false);
    secondTradeId = seeded.tradeId;
  }

  if (options.danglingLink) {
    sqlite
      .prepare(
        `INSERT INTO accounting_executions
         (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
          journal_trade_id, description, posted_at)
         VALUES (?, ?, ?, 'buy', '5.00', '100.00', '0.00', ?, ?, 'Dangling journal link', ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, randomUUID(), randomUUID(), ts);
  }

  if (options.closedLink) {
    const closedTradeId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO trades
         (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'long', 'closed', ?, ?)`,
      )
      .run(closedTradeId, `T-${randomUUID().slice(0, 8)}`, accountId, symbol, ts, ts);
    sqlite
      .prepare(
        `INSERT INTO accounting_executions
         (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key,
          journal_trade_id, description, posted_at)
         VALUES (?, ?, ?, 'buy', '5.00', '100.00', '0.00', ?, ?, 'Closed-trade link', ?)`,
      )
      .run(randomUUID(), accountId, instrumentId, randomUUID(), closedTradeId, ts);
  }

  // Accounting position projection
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
      options.position.direction,
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

  // Valuation mark (fresh, 1 minute old)
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

  // Optional FIFO open fee allocation (fifo_lots.allocated_fees)
  if (options.position.openFees !== null && tradeId !== null) {
    const openingExecId = sqlite
      .prepare(
        `SELECT id FROM accounting_executions
         WHERE account_id = ? AND instrument_id = ? AND journal_trade_id = ?
         ORDER BY posted_at ASC LIMIT 1`,
      )
      .get(accountId, instrumentId, tradeId) as { id: string } | undefined;
    if (openingExecId) {
      sqlite
        .prepare(
          `INSERT INTO fifo_lots
           (id, account_id, instrument_id, direction, remaining_quantity,
            original_quantity, entry_price, cost_basis_total, allocated_fees,
            opening_execution_id, opened_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          accountId,
          instrumentId,
          options.position.direction,
          options.position.quantity,
          options.position.quantity,
          options.position.averageCost,
          '0.00',
          options.position.openFees,
          openingExecId.id,
          ts,
          ts,
        );
    }
  }

  return { accountId, instrumentId, tradeId, secondTradeId, kernelInput };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('computeDashboardV2 journalLinked', () => {
  let sqlite: Database.Database;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
      try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
      try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
    }
    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
  });

  afterAll(() => {
    sqlite.close();
    try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  });

  it('computes journalLinkedMetrics via computeTradeMetrics and reconciles exactly in a fee-free partial-exit case', () => {
    // Trade: buy 10 @ 100, partial exit 4 @ 130, mark 130 → remaining 6 @ 100.
    const seeded = seedJournalScenario(sqlite, {
      trade: {
        executions: [
          { action: 'buy', quantity: 10, price: 100, fees: 0 },
          { action: 'sell', quantity: 4, price: 130, fees: 0 },
        ],
        currentPrice: 130,
      },
      position: {
        instrumentId: '',
        symbol: 'JLA1',
        direction: 'long',
        quantity: '6.00',
        averageCost: '100.00',
        realizedGross: '120.00',
        realizedFees: '0.00',
        realizedNet: '120.00',
        markPrice: '130.00',
        openFees: null,
      },
    });

    const result = computeDashboardV2(sqlite, seeded.accountId);
    expect(result).toBeDefined();

    const pos = result!.valuation.positions[0];
    // Attribution: executions are all journal-linked.
    expect(pos.attribution.kind).toBe('journal');

    // Kernel equality: the dashboard block must equal a direct kernel call.
    const kernel = computeTradeMetrics(seeded.kernelInput!);
    expect(pos.journalLinkedMetrics).toEqual({
      remainingQty: kernel.size.openQuantity,
      openAvgCost: kernel.averagePrices.openAvgCost,
      grossRealizedPnl: kernel.realizedPnl.grossRealizedPnl,
      netRealizedPnl: kernel.realizedPnl.netRealizedPnl,
      netUnrealizedPnl: kernel.unrealizedPnl.netUnrealizedPnl,
      openFees: kernel.fees.openFees,
    });

    // Concrete values for this scenario.
    expect(pos.journalLinkedMetrics!.remainingQty).toBe(6);
    expect(pos.journalLinkedMetrics!.openAvgCost).toBe(100);
    expect(pos.journalLinkedMetrics!.netRealizedPnl).toBe(120);
    expect(pos.journalLinkedMetrics!.netUnrealizedPnl).toBe(180);

    // Aggregate section.
    const jl = result!.journalLinked;
    expect(jl.tradeCount).toBe(1);
    expect(jl.positionCount).toBe(1);
    expect(jl.remainingQty).toBe('6.00');
    expect(jl.openAvgCost).toBe('100.00');
    expect(jl.grossRealizedPnl).toBe('120.00');
    expect(jl.netRealizedPnl).toBe('120.00');
    expect(jl.netUnrealizedPnl).toBe('180.00');
    expect(jl.openFees).toBe('0.00');
    expect(jl.provenance.status).toBe('complete');
    expect(jl.provenance.source).toContain('trade_executions');

    // Every dimension comparison matches — the two surfaces agree.
    for (const c of jl.comparisons) {
      expect(c.status).toBe('match');
      expect(c.difference).toBe('0.00');
      expect(c.dashboardValue).toBe(c.tradesValue);
    }
  });

  it('keeps journalLinkedMetrics kernel-exact in a fee-bearing case and honestly reports fee-convention differences', () => {
    // Trade: buy 10 @ 100 (fee 2.00), partial exit 5 @ 120 (fee 1.00), mark 120.
    // Journal kernel: net realized = 100 − 1.00 entry − 1.00 exit = 98.00;
    // openFees = 1.00; net unrealized = (120−100)×5 − 1.00 = 99.00.
    const seeded = seedJournalScenario(sqlite, {
      trade: {
        executions: [
          { action: 'buy', quantity: 10, price: 100, fees: 2 },
          { action: 'sell', quantity: 5, price: 120, fees: 1 },
        ],
        currentPrice: 120,
      },
      position: {
        instrumentId: '',
        symbol: 'JLB1',
        direction: 'long',
        quantity: '5.00',
        averageCost: '100.00',
        // Accounting engine convention: entry fees stay on open lots, so the
        // accounting net realized = gross − exit fees = 100 − 1 = 99.00.
        realizedGross: '100.00',
        realizedFees: '1.00',
        realizedNet: '99.00',
        markPrice: '120.00',
        // Accounting keeps the FULL entry fee on the remaining lot.
        openFees: '2.00',
      },
    });

    const result = computeDashboardV2(sqlite, seeded.accountId);
    expect(result).toBeDefined();

    const pos = result!.valuation.positions[0];
    const kernel = computeTradeMetrics(seeded.kernelInput!);
    // The journal-linked block is kernel-exact regardless of fees.
    expect(pos.journalLinkedMetrics).toEqual({
      remainingQty: kernel.size.openQuantity,
      openAvgCost: kernel.averagePrices.openAvgCost,
      grossRealizedPnl: kernel.realizedPnl.grossRealizedPnl,
      netRealizedPnl: kernel.realizedPnl.netRealizedPnl,
      netUnrealizedPnl: kernel.unrealizedPnl.netUnrealizedPnl,
      openFees: kernel.fees.openFees,
    });
    expect(pos.journalLinkedMetrics!.netRealizedPnl).toBe(98);
    expect(pos.journalLinkedMetrics!.openFees).toBe(1);
    expect(pos.journalLinkedMetrics!.netUnrealizedPnl).toBe(99);

    const jl = result!.journalLinked;
    // Convention-aligned dimensions match.
    const byKey = new Map(jl.comparisons.map((c) => [c.key, c]));
    expect(byKey.get('remainingQty')!.status).toBe('match');
    expect(byKey.get('openAvgCost')!.status).toBe('match');
    expect(byKey.get('grossRealizedPnl')!.status).toBe('match');
    // Fee-convention dimensions differ honestly (entry fees on matched qty).
    expect(byKey.get('netRealizedPnl')!.status).toBe('mismatch');
    expect(byKey.get('netRealizedPnl')!.difference).toBe('1.00'); // 99.00 − 98.00
    expect(byKey.get('netUnrealizedPnl')!.status).toBe('mismatch');
    expect(byKey.get('openFees')!.status).toBe('mismatch');
    expect(byKey.get('openFees')!.difference).toBe('1.00'); // 2.00 − 1.00
    // Divergence surfaces in provenance so S04 can alert.
    expect(jl.provenance.status).toBe('partial');
  });

  it('contributes zero for account-only positions (attribution separation)', () => {
    // Account-only position (no journal links at all) + a journal-linked one.
    const acctOnly = seedJournalScenario(sqlite, {
      position: {
        instrumentId: '',
        symbol: 'JLC1',
        direction: 'long',
        quantity: '20.00',
        averageCost: '50.00',
        realizedGross: '10.00',
        realizedFees: '0.00',
        realizedNet: '10.00',
        markPrice: '55.00',
        openFees: null,
      },
    });
    // The account-only scenario seeds no trade → no accounting executions.
    // Directly assert the empty aggregate, then add a journal-linked position
    // to the SAME account so account-only values must be excluded.
    const result = computeDashboardV2(sqlite, acctOnly.accountId);
    expect(result).toBeDefined();
    expect(result!.valuation.positions[0].attribution.kind).toBe('account_only');
    expect(result!.valuation.positions[0].journalLinkedMetrics).toBeNull();
    expect(result!.journalLinked.tradeCount).toBe(0);
    expect(result!.journalLinked.positionCount).toBe(0);
    expect(result!.journalLinked.remainingQty).toBe('0.00');
    expect(result!.journalLinked.grossRealizedPnl).toBe('0.00');
    expect(result!.journalLinked.netRealizedPnl).toBe('0.00');
    expect(result!.journalLinked.openFees).toBe('0.00');
    expect(result!.journalLinked.provenance.status).toBe('unavailable');
    // Account-only values never leak into comparisons.
    for (const c of result!.journalLinked.comparisons) {
      expect(c.dashboardValue).toBeNull();
      expect(c.tradesValue).toBeNull();
      expect(c.status).toBe('unavailable');
    }
  });

  it('mixes a journal-linked position with an account-only position without blending', () => {
    // One account with TWO instruments: one journal-linked, one account-only.
    const journalSeed = seedJournalScenario(sqlite, {
      trade: {
        executions: [{ action: 'buy', quantity: 10, price: 100, fees: 0 }],
        currentPrice: 110,
      },
      position: {
        instrumentId: '',
        symbol: 'JLD1',
        direction: 'long',
        quantity: '10.00',
        averageCost: '100.00',
        realizedGross: '0.00',
        realizedFees: '0.00',
        realizedNet: '0.00',
        markPrice: '110.00',
        openFees: null,
      },
    });

    // Add an account-only position to the same account.
    const accountOnlyInstrumentId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'stock', 'USD', 1, ?, ?)`,
      )
      .run(accountOnlyInstrumentId, 'JLD2', 'JLD2 Inc.', now(), now());
    sqlite
      .prepare(
        `INSERT INTO account_positions
         (id, account_id, instrument_id, direction, quantity, average_cost,
          total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
          last_updated, created_at, updated_at)
         VALUES (?, ?, ?, 'long', '50.00', '200.00', '10000.00', '500.00', '0.00', '500.00', ?, ?, ?)`,
      )
      .run(randomUUID(), journalSeed.accountId, accountOnlyInstrumentId, now(), now(), now());
    sqlite
      .prepare(
        `INSERT INTO valuation_marks
         (id, account_id, instrument_id, price, price_micros, source, mark_timestamp)
         VALUES (?, ?, ?, '210.00', 210000000, 'user', ?)`,
      )
      .run(randomUUID(), journalSeed.accountId, accountOnlyInstrumentId, minutesAgo(1));

    const result = computeDashboardV2(sqlite, journalSeed.accountId);
    expect(result).toBeDefined();
    expect(result!.valuation.positions).toHaveLength(2);

    const bySymbol = new Map(result!.valuation.positions.map((p) => [p.symbol, p]));
    expect(bySymbol.get('JLD1')!.journalLinkedMetrics).not.toBeNull();
    expect(bySymbol.get('JLD2')!.attribution.kind).toBe('account_only');
    expect(bySymbol.get('JLD2')!.journalLinkedMetrics).toBeNull();

    // Aggregate covers only the journal-linked position: qty 10, not 60.
    const jl = result!.journalLinked;
    expect(jl.tradeCount).toBe(1);
    expect(jl.positionCount).toBe(1);
    expect(jl.remainingQty).toBe('10.00');
    expect(jl.netRealizedPnl).toBe('0.00');
    // Account-only realized P&L (500) is never blended into the aggregate.
    expect(jl.grossRealizedPnl).toBe('0.00');
    expect(jl.provenance.status).toBe('complete');
  });

  it('reports partial when a journal link dangles to a missing trade', () => {
    const seeded = seedJournalScenario(sqlite, {
      danglingLink: true,
      position: {
        instrumentId: '',
        symbol: 'JLE1',
        direction: 'long',
        quantity: '10.00',
        averageCost: '100.00',
        realizedGross: '0.00',
        realizedFees: '0.00',
        realizedNet: '0.00',
        markPrice: '110.00',
        openFees: null,
      },
    });

    const result = computeDashboardV2(sqlite, seeded.accountId);
    expect(result).toBeDefined();
    expect(result!.valuation.positions[0].journalLinkedMetrics).toBeNull();
    expect(result!.journalLinked.tradeCount).toBe(0);
    expect(result!.journalLinked.positionCount).toBe(0);
    // A journal-linked position exists but cannot be reconciled.
    expect(result!.journalLinked.provenance.status).toBe('partial');
  });

  it('reports partial when the linked trade is no longer open', () => {
    const seeded = seedJournalScenario(sqlite, {
      closedLink: true,
      position: {
        instrumentId: '',
        symbol: 'JLF1',
        direction: 'long',
        quantity: '10.00',
        averageCost: '100.00',
        realizedGross: '0.00',
        realizedFees: '0.00',
        realizedNet: '0.00',
        markPrice: '110.00',
        openFees: null,
      },
    });

    const result = computeDashboardV2(sqlite, seeded.accountId);
    expect(result).toBeDefined();
    expect(result!.valuation.positions[0].journalLinkedMetrics).toBeNull();
    expect(result!.journalLinked.provenance.status).toBe('partial');
  });

  it('keeps the aggregate net unrealized null when an open journal trade has no mark', () => {
    const seeded = seedJournalScenario(sqlite, {
      trade: {
        executions: [{ action: 'buy', quantity: 10, price: 100, fees: 0 }],
        currentPrice: null,
      },
      position: {
        instrumentId: '',
        symbol: 'JLG1',
        direction: 'long',
        quantity: '10.00',
        averageCost: '100.00',
        realizedGross: '0.00',
        realizedFees: '0.00',
        realizedNet: '0.00',
        markPrice: '110.00',
        openFees: null,
      },
    });

    const result = computeDashboardV2(sqlite, seeded.accountId);
    expect(result).toBeDefined();
    const pos = result!.valuation.positions[0];
    // Trade has no current_price → kernel net unrealized unknown.
    expect(pos.journalLinkedMetrics!.netUnrealizedPnl).toBeNull();

    const jl = result!.journalLinked;
    // Partial-sum-as-null: never a partial aggregate.
    expect(jl.netUnrealizedPnl).toBeNull();
    const comparison = jl.comparisons.find((c) => c.key === 'netUnrealizedPnl')!;
    expect(comparison.status).toBe('unavailable');
    expect(comparison.difference).toBeNull();
    expect(jl.provenance.status).toBe('partial');
  });

  it('merges multiple open linked trades on one instrument into one block', () => {
    const seeded = seedJournalScenario(sqlite, {
      trade: {
        executions: [{ action: 'buy', quantity: 10, price: 100, fees: 0 }],
        currentPrice: 110,
      },
      secondTrade: {
        executions: [{ action: 'buy', quantity: 5, price: 120, fees: 0 }],
        currentPrice: 110,
      },
      position: {
        instrumentId: '',
        symbol: 'JLH1',
        direction: 'long',
        quantity: '15.00',
        averageCost: '106.67',
        realizedGross: '0.00',
        realizedFees: '0.00',
        realizedNet: '0.00',
        markPrice: '110.00',
        openFees: null,
      },
    });

    const result = computeDashboardV2(sqlite, seeded.accountId);
    expect(result).toBeDefined();
    const pos = result!.valuation.positions[0];

    // Direct kernel calls for both trades, merged independently.
    const t1 = computeTradeMetrics({
      executions: [{ action: 'buy', quantity: 10, price: 100, fees: 0, executedAt: now() }],
      direction: 'long',
      riskSnapshot: null,
      stopAdjustments: [],
      currentMark: { price: 110, markedAt: now() },
      currentAccountEquity: 100000,
    });
    const t2 = computeTradeMetrics({
      executions: [{ action: 'buy', quantity: 5, price: 120, fees: 0, executedAt: now() }],
      direction: 'long',
      riskSnapshot: null,
      stopAdjustments: [],
      currentMark: { price: 110, markedAt: now() },
      currentAccountEquity: 100000,
    });

    expect(pos.journalLinkedMetrics!.remainingQty).toBe(15);
    // Quantity-weighted average: (100×10 + 120×5) / 15 = 106.67
    expect(pos.journalLinkedMetrics!.openAvgCost).toBeCloseTo((100 * 10 + 120 * 5) / 15, 9);
    expect(pos.journalLinkedMetrics!.grossRealizedPnl).toBe(t1.realizedPnl.grossRealizedPnl + t2.realizedPnl.grossRealizedPnl);
    expect(pos.journalLinkedMetrics!.netRealizedPnl).toBe(t1.realizedPnl.netRealizedPnl + t2.realizedPnl.netRealizedPnl);

    const jl = result!.journalLinked;
    expect(jl.tradeCount).toBe(2);
    expect(jl.positionCount).toBe(1);
    expect(jl.remainingQty).toBe('15.00');
    expect(jl.openAvgCost).toBe('106.67');
  });
});
