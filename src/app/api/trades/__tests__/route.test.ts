/**
 * trades route test
 *
 * Tests GET (list with pagination, status filter, date-range filter, account filter,
 * direction filter, totals aggregation) and POST (create, validation, account resolution).
 *
 * Enriched rows now use computeTradeMetrics() for realizedPnl, unrealizedPnl, returnPct,
 * riskPct, nested metrics, and server-computed totals.
 *
 * Run: npx tsx src/app/api/trades/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc, and, sql, inArray, gte, lte, ne } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import Decimal from 'decimal.js';

import * as schema from '@/db/schema';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput } from '@/lib/trade-metrics';
import { computePlannedRiskAmount } from '@/lib/planned-risk';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertApprox(actual: number | null, expected: number, tolerance: number, msg: string) {
  if (actual === null) { failed++; console.error(`  ❌ ${msg} — got null, expected ~${expected} (FAILED)`); return; }
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) { passed++; console.log(`  ✅ ${msg} (${actual.toFixed(4)} ≈ ${expected})`); }
  else { failed++; console.error(`  ❌ ${msg} — got ${actual}, expected ~${expected} (diff ${diff.toFixed(4)}) (FAILED)`); }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — value is null/undefined (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('trades');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS watchlist_items;
  DROP TABLE IF EXISTS weekly_reviews;
  DROP TABLE IF EXISTS setup_definitions;
  DROP TABLE IF EXISTS accounts;
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    starting_balance REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT,
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    backup_enabled INTEGER DEFAULT 0,
    backup_retention_count INTEGER DEFAULT 3,
    backup_last_run_at TEXT,
    backup_last_run_status TEXT,
    backup_cron_time TEXT DEFAULT '02:00',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS account_rollforward (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    date TEXT NOT NULL,
    beginning_equity REAL,
    deposits_withdrawals REAL DEFAULT 0,
    realized_gross_pnl REAL DEFAULT 0,
    fees REAL DEFAULT 0,
    ending_equity REAL,
    cumulative_pnl REAL,
    high_water_mark REAL,
    drawdown_amount REAL DEFAULT 0,
    drawdown_pct REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
  CREATE TABLE IF NOT EXISTS account_performance (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL UNIQUE,
    computed_as_of TEXT NOT NULL,
    net_cash TEXT NOT NULL,
    nav TEXT NOT NULL,
    marked_positions TEXT NOT NULL,
    realized_pnl TEXT NOT NULL,
    unrealized_pnl TEXT NOT NULL,
    total_pnl TEXT NOT NULL,
    realized_fees TEXT NOT NULL,
    gross_exposure TEXT NOT NULL,
    net_exposure TEXT NOT NULL,
    modified_dietz_return TEXT,
    twr TEXT,
    high_water_mark TEXT,
    drawdown TEXT,
    drawdown_pct TEXT,
    warnings TEXT NOT NULL DEFAULT '[]',
    positions_json TEXT NOT NULL DEFAULT '[]',
    rebuild_count INTEGER NOT NULL DEFAULT 0,
    last_rebuilt_at TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL UNIQUE,
    account_equity_at_open REAL,
    initial_entry_price REAL,
    initial_stop_price REAL,
    initial_quantity REAL,
    risk_per_share REAL,
    initial_risk_amount REAL,
    account_risk_pct REAL,
    planned_reward_risk REAL,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL,
    executed_at TEXT,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL,
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    planned_quantity REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    opened_at TEXT,
    closed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    current_price REAL,
    current_price_fetched_at TEXT,
    gross_realized_pnl REAL,
    net_realized_pnl REAL,
    realized_fees REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetTrades(params: {
  page?: number;
  limit?: number;
  status?: string;
  from?: string;
  to?: string;
  accountId?: string;
  direction?: string;
} = {}): { status: number; data: unknown } {
  try {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const offset = (page - 1) * limit;

    const statusFilter = params.status as 'open' | 'planned' | 'closed' | 'deleted' | undefined;

    // Build filters
    const filters: SQL<unknown>[] = [];

    if (statusFilter) {
      filters.push(eq(schema.trades.status, statusFilter));
    } else {
      // D057/R027: mirror of route.ts — the unfiltered listing excludes
      // soft-deleted (scratched) trades by default; callers opt in with
      // ?status=deleted (Deleted tab, S03).
      filters.push(ne(schema.trades.status, 'deleted'));
    }
    // Status-aware date filtering (matching route.ts logic)
    // open → date filters ignored (all open positions visible regardless of date)
    // closed → filter by closedAt
    // planned → filter by createdAt
    // default (no status or other) → filter by openedAt (backward compatible)
    const dateColumn = statusFilter === 'closed'
      ? schema.trades.closedAt
      : statusFilter === 'planned'
        ? schema.trades.createdAt
        : schema.trades.openedAt;

    if (statusFilter === 'open') {
      if (params.from || params.to) {
        console.warn('[doGetTrades] Date range filters ignored for status=open');
      }
    } else {
      if (params.from) {
        filters.push(sql`${dateColumn} >= ${params.from}`);
      }
      if (params.to) {
        filters.push(sql`${dateColumn} <= ${params.to}`);
      }
    }
    if (params.accountId) {
      filters.push(eq(schema.trades.accountId, params.accountId));
    }
    if (params.direction) {
      if (!['long', 'short'].includes(params.direction)) {
        return { status: 400, data: { error: 'Validation failed', details: 'direction must be "long" or "short"' } };
      }
      filters.push(eq(schema.trades.direction, params.direction as 'long' | 'short'));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    // Total count
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.trades)
      .where(whereClause)
      .get();
    const total = countResult?.count ?? 0;

    // Paginated data
    const dbRows = db
      .select()
      .from(schema.trades)
      .where(whereClause)
      .orderBy(desc(schema.trades.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Batch-fetch related data
    const tradeIds = dbRows.map((r) => r.id);
    const execRows = tradeIds.length > 0
      ? db.select().from(schema.tradeExecutions).where(inArray(schema.tradeExecutions.tradeId, tradeIds)).all()
      : [];
    const riskRows = tradeIds.length > 0
      ? db.select().from(schema.tradeRiskSnapshots).where(inArray(schema.tradeRiskSnapshots.tradeId, tradeIds)).all()
      : [];

    const execMap = new Map<string, (typeof schema.tradeExecutions.$inferSelect)[]>();
    for (const ex of execRows) {
      const list = execMap.get(ex.tradeId) ?? [];
      list.push(ex);
      execMap.set(ex.tradeId, list);
    }
    const riskMap = new Map<string, typeof schema.tradeRiskSnapshots.$inferSelect>();
    for (const risk of riskRows) {
      riskMap.set(risk.tradeId, risk);
    }

    // Batch-fetch latest account_rollforward per unique account
    const uniqueAccountIds = [...new Set(dbRows.map((r) => r.accountId))];
    const latestRollforwardMap = new Map<string, typeof schema.accountRollforward.$inferSelect>();
    for (const accId of uniqueAccountIds) {
      if (!accId) continue;
      const rf = db
        .select()
        .from(schema.accountRollforward)
        .where(eq(schema.accountRollforward.accountId, accId))
        .orderBy(desc(schema.accountRollforward.date))
        .limit(1)
        .get();
      if (rf) {
        latestRollforwardMap.set(accId, rf);
      }
    }

    // Batch-fetch account_performance.nav per unique account (primary equity source)
    const accountPerfMap = new Map<string, string>();
    for (const accId of uniqueAccountIds) {
      if (!accId) continue;
      const perf = sqlite
        .prepare(`SELECT nav FROM account_performance WHERE account_id = ?`)
        .get(accId) as { nav: string } | undefined;
      if (perf && perf.nav) {
        accountPerfMap.set(accId, perf.nav);
      }
    }

    // Batch-fetch sector lookupValues for sector name resolution
    const uniqueSectorIds: string[] = [...new Set(dbRows.map((r) => r.sectorId).filter((id): id is string => id !== null))];
    const sectorRowsTest: Array<{ id: string; value: string }> = uniqueSectorIds.length > 0
      ? (sqlite
          .prepare(`SELECT id, value FROM lookup_values WHERE id IN (${uniqueSectorIds.map(() => '?').join(',')})`)
          .all(...uniqueSectorIds) as Array<{ id: string; value: string }>)
      : [];
    const sectorMap = new Map(sectorRowsTest.map((s) => [s.id, s.value]));

    // Batch-fetch market condition lookupValues for name resolution (mirror of route.ts)
    const uniqueMarketConditionIds: string[] = [...new Set(dbRows.map((r) => r.marketConditionId).filter((id): id is string => id !== null))];
    const marketConditionRowsTest: Array<{ id: string; value: string }> = uniqueMarketConditionIds.length > 0
      ? (sqlite
          .prepare(`SELECT id, value FROM lookup_values WHERE id IN (${uniqueMarketConditionIds.map(() => '?').join(',')})`)
          .all(...uniqueMarketConditionIds) as Array<{ id: string; value: string }>)
      : [];
    const marketConditionMap = new Map(marketConditionRowsTest.map((s) => [s.id, s.value]));

    // Batch-fetch accounts for name and currency resolution
    const accRows = db
      .select()
      .from(schema.accounts)
      .where(inArray(schema.accounts.id, uniqueAccountIds))
      .all() as Record<string, unknown>[];
    const accMap = new Map(accRows.map((a) => [a.id, a]));

    // Compute enriched rows with computeTradeMetrics()
    const enhancedRows = dbRows.map((row) => {
      const executions = execMap.get(row.id) ?? [];
      const riskSnapshot = riskMap.get(row.id) ?? null;

      // Account equity cascade: account_performance.nav → rollforward.endingEquity → account.startingBalance → null
      const latestRollforward = latestRollforwardMap.get(row.accountId);
      const navRaw = accountPerfMap.get(row.accountId);
      const navValue = navRaw ? parseFloat(navRaw) : null;
      const acc = accMap.get(row.accountId) as Record<string, unknown> | undefined;
      const currentAccountEquity =
        navValue ??
        latestRollforward?.endingEquity ??
        (acc?.startingBalance as number | undefined) ??
        null;

      const metricsInput: TradeMetricsInput = {
        executions: executions.map((e) => ({
          id: e.id,
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees,
          executedAt: e.executedAt ?? '',
        })),
        direction: row.direction as 'long' | 'short',
        riskSnapshot: riskSnapshot
          ? {
              initialRiskAmount: riskSnapshot.initialRiskAmount,
              accountEquityAtOpen: riskSnapshot.accountEquityAtOpen,
              initialStopPrice: riskSnapshot.initialStopPrice,
              initialEntryPrice: riskSnapshot.initialEntryPrice,
            }
          : null,
        stopAdjustments: [],
        currentMark:
          row.currentPrice != null
            ? { price: row.currentPrice, markedAt: row.currentPriceFetchedAt ?? new Date().toISOString() }
            : null,
        currentAccountEquity,
      };

      const metrics = computeTradeMetrics(metricsInput);

      // Compute planned risk-to-account for planned trades (matching route.ts logic)
      let plannedRiskToAccount: number | null = null;
      if (
        row.status === 'planned' &&
        row.plannedEntry != null &&
        row.plannedStop != null &&
        row.plannedQuantity != null &&
        row.plannedQuantity > 0 &&
        currentAccountEquity != null &&
        currentAccountEquity > 0
      ) {
        const plannedRiskAmount = new Decimal(Math.abs(row.plannedEntry - row.plannedStop)).mul(new Decimal(row.plannedQuantity));
        plannedRiskToAccount = plannedRiskAmount.div(new Decimal(currentAccountEquity)).toNumber();
      }

      const accountInfo = accMap.get(row.accountId) as Record<string, unknown> | undefined;

      return {
        ...row,
        accountName: accountInfo?.name ?? null,
        accountCurrency: accountInfo?.currency ?? null,
        sectorName: row.sectorId ? (sectorMap.get(row.sectorId) ?? null) : null,
        marketConditionName: row.marketConditionId ? (marketConditionMap.get(row.marketConditionId) ?? null) : null,
        realizedPnl: metrics.realizedPnl.netRealizedPnl,
        unrealizedPnl: metrics.unrealizedPnl.netUnrealizedPnl,
        returnPct: metrics.returnMetrics.returnPct,
        riskPct: metrics.risk.riskToAccount,
        plannedRiskToAccount,
        metrics,
      };
    });

    // Server-computed totals: aggregate across the full filtered dataset, NOT just the current page.
    // Mirror of route.ts — batch-fetch executions/risk snapshots/accounts/rollforward for ALL
    // matching trades and compute metrics independently of the paginated rows, so totals stay
    // consistent regardless of which page is requested.
    const allMatchingIdsR = db
      .select({
        id: schema.trades.id,
        accountId: schema.trades.accountId,
        symbol: schema.trades.symbol,
        direction: schema.trades.direction,
        currentPrice: schema.trades.currentPrice,
        currentPriceFetchedAt: schema.trades.currentPriceFetchedAt,
      })
      .from(schema.trades)
      .where(whereClause)
      .all();

    // M013/S01 mirror: unrealized aggregates are null-able + unpricedOpenPositions count.
    const totals: Record<string, number | null> = {
      grossRealizedPnl: 0,
      netRealizedPnl: 0,
      totalFees: 0,
      grossUnrealizedPnl: 0,
      netUnrealizedPnl: 0,
      totalOpenRisk: 0,
      portfolioHeatAmount: 0,
      portfolioHeatPct: 0,
      unpricedOpenPositions: 0,
    };

    // M013/S01 mirror: open positions (openQuantity > 0) without a market mark.
    let unpricedOpenPositions = 0;

    if (allMatchingIdsR.length > 0) {
      const allTradeIds = allMatchingIdsR.map((r) => r.id);
      const allUniqueAccountIds = [...new Set(allMatchingIdsR.map((r) => r.accountId))];

      // Batch-fetch related data for ALL matching trades
      const allExecRows = allTradeIds.length > 0
        ? db.select().from(schema.tradeExecutions).where(inArray(schema.tradeExecutions.tradeId, allTradeIds)).all()
        : [];
      const allRiskRows = allTradeIds.length > 0
        ? db.select().from(schema.tradeRiskSnapshots).where(inArray(schema.tradeRiskSnapshots.tradeId, allTradeIds)).all()
        : [];

      const allExecMap = new Map<string, (typeof schema.tradeExecutions.$inferSelect)[]>();
      for (const ex of allExecRows) {
        const list = allExecMap.get(ex.tradeId) ?? [];
        list.push(ex);
        allExecMap.set(ex.tradeId, list);
      }
      const allRiskMap = new Map<string, typeof schema.tradeRiskSnapshots.$inferSelect>();
      for (const risk of allRiskRows) {
        allRiskMap.set(risk.tradeId, risk);
      }

      const allAccountRows = db
        .select()
        .from(schema.accounts)
        .where(inArray(schema.accounts.id, allUniqueAccountIds.filter(Boolean)))
        .all();
      const allAccountMap = new Map(allAccountRows.map((a) => [a.id, a]));

      // Batch-fetch latest rollforward per account for totals computation (mirrors route.ts)
      const allLatestRollforwardMap = new Map<string, typeof schema.accountRollforward.$inferSelect>();
      for (const accId of allUniqueAccountIds) {
        if (!accId) continue;
        const rf = db
          .select()
          .from(schema.accountRollforward)
          .where(eq(schema.accountRollforward.accountId, accId))
          .orderBy(desc(schema.accountRollforward.date))
          .limit(1)
          .get();
        if (rf) {
          allLatestRollforwardMap.set(accId, rf);
        }
      }

      // Batch-fetch account_performance.nav for ALL full-dataset accounts (S02 T02):
      // keyed by the FULL dataset, NOT the paginated page, so totals.portfolioHeatPct
      // is identical across pagination pages for multi-account datasets.
      const allAccountPerfMap = new Map<string, string>();
      const allAccIds = allUniqueAccountIds.filter(Boolean);
      if (allAccIds.length > 0) {
        const perfRows = sqlite
          .prepare(`SELECT account_id, nav FROM account_performance WHERE account_id IN (${allAccIds.map(() => '?').join(',')})`)
          .all(...allAccIds) as Array<{ account_id: string; nav: string }>;
        for (const perf of perfRows) {
          if (perf.nav) {
            allAccountPerfMap.set(perf.account_id, perf.nav);
          }
        }
      }

      // Track unique account equities for the portfolioHeat denominator
      // (one equity per account to avoid double-counting). Mirror of route.ts:
      // monetary aggregates are accumulated in Decimal.js (P2 hardening).
      const totalEquityByAccount = new Map<string, Decimal>();

      // Decimal.js accumulators (mirror of route.ts totals pipeline)
      const decTotals = {
        grossRealizedPnl: new Decimal(0),
        netRealizedPnl: new Decimal(0),
        totalFees: new Decimal(0),
        grossUnrealizedPnl: new Decimal(0),
        netUnrealizedPnl: new Decimal(0),
        totalOpenRisk: new Decimal(0),
      };

      for (const row of allMatchingIdsR) {
        const executions = allExecMap.get(row.id) ?? [];
        const riskSnapshot = allRiskMap.get(row.id) ?? null;
        const account = allAccountMap.get(row.accountId);
        const latestRollforward = allLatestRollforwardMap.get(row.accountId);
        // Full-dataset nav map (S02 T02): keyed by ALL matching accounts, so the
        // equity denominator — and therefore portfolioHeatPct — is page-independent.
        const navRaw = allAccountPerfMap.get(row.accountId);
        const navValue = navRaw ? parseFloat(navRaw) : null;
        const currentAccountEquity =
          navValue ??
          latestRollforward?.endingEquity ??
          account?.startingBalance ??
          null;

        const metricsInput: TradeMetricsInput = {
          executions: executions.map((e) => ({
            id: e.id,
            action: e.action,
            quantity: e.quantity,
            price: e.price,
            fees: e.fees,
            executedAt: e.executedAt ?? '',
          })),
          direction: row.direction as 'long' | 'short',
          riskSnapshot: riskSnapshot
            ? {
                initialRiskAmount: riskSnapshot.initialRiskAmount,
                accountEquityAtOpen: riskSnapshot.accountEquityAtOpen,
                initialStopPrice: riskSnapshot.initialStopPrice,
                initialEntryPrice: riskSnapshot.initialEntryPrice,
              }
            : null,
          stopAdjustments: [],
          currentMark:
            row.currentPrice != null
              ? { price: row.currentPrice, markedAt: row.currentPriceFetchedAt ?? new Date().toISOString() }
              : null,
          currentAccountEquity,
        };

        const metrics = computeTradeMetrics(metricsInput);

        // M013/S01 mirror: count open positions without a market mark.
        if (metrics.size.openQuantity > 0 && row.currentPrice == null) {
          unpricedOpenPositions += 1;
        }

        // Track unique per-account equity for the portfolioHeat denominator
        if (currentAccountEquity != null && !totalEquityByAccount.has(row.accountId)) {
          totalEquityByAccount.set(row.accountId, new Decimal(currentAccountEquity));
        }

        const gRP = new Decimal(metrics.realizedPnl.grossRealizedPnl ?? 0);
        const nRP = new Decimal(metrics.realizedPnl.netRealizedPnl ?? 0);
        const tF = new Decimal(metrics.fees.totalFees ?? 0);
        const gUP = new Decimal(metrics.unrealizedPnl.grossUnrealizedPnl ?? 0);
        const nUP = new Decimal(metrics.unrealizedPnl.netUnrealizedPnl ?? 0);
        const oR = new Decimal(metrics.risk.openRisk ?? 0);

        decTotals.grossRealizedPnl = decTotals.grossRealizedPnl.plus(gRP);
        decTotals.netRealizedPnl = decTotals.netRealizedPnl.plus(nRP);
        decTotals.totalFees = decTotals.totalFees.plus(tF);
        decTotals.grossUnrealizedPnl = decTotals.grossUnrealizedPnl.plus(gUP);
        decTotals.netUnrealizedPnl = decTotals.netUnrealizedPnl.plus(nUP);
        decTotals.totalOpenRisk = decTotals.totalOpenRisk.plus(oR);

      }

      // Top-level portfolioHeat — single authoritative value for the open tab footer.
      // portfolioHeatAmount = sum of open risk across all currencies (== totalOpenRisk).
      // portfolioHeatPct = decimal fraction of total account equity (0.0125 = 1.25%),
      // following the M010 decimal-fraction contract (displayed via ×100 formatting).
      // The denominator sums one equity per account (unique, not per trade) to avoid
      // double-counting when multiple open positions share an account.
      const totalEquityAcrossAccounts = [...totalEquityByAccount.values()].reduce((s, v) => s.plus(v), new Decimal(0));
      totals.portfolioHeatAmount = decTotals.totalOpenRisk.toNumber();
      totals.portfolioHeatPct =
        totalEquityAcrossAccounts.gt(0) && decTotals.totalOpenRisk.gt(0)
          ? decTotals.totalOpenRisk.div(totalEquityAcrossAccounts).toNumber()
          : 0;
      totals.grossRealizedPnl = decTotals.grossRealizedPnl.toNumber();
      totals.netRealizedPnl = decTotals.netRealizedPnl.toNumber();
      totals.totalFees = decTotals.totalFees.toNumber();
      // M013/S01 mirror: any unpriced open position makes the aggregate
      // unrealized P&L unknown — report null (never a partial sum or 0).
      const unrealizedUnknown = unpricedOpenPositions > 0;
      totals.grossUnrealizedPnl = unrealizedUnknown ? null : decTotals.grossUnrealizedPnl.toNumber();
      totals.netUnrealizedPnl = unrealizedUnknown ? null : decTotals.netUnrealizedPnl.toNumber();
      totals.totalOpenRisk = decTotals.totalOpenRisk.toNumber();
      totals.unpricedOpenPositions = unpricedOpenPositions;
    }

    // ── plannedTotals: aggregate risk/capital across all planned trades ──
    // Mirror of route.ts: planned status + accountId + direction filters; the
    // from/to date filters (against createdAt) only apply when status=planned so
    // the footer count matches the Planned tab, while open/closed tabs keep the
    // full pipeline view.
    const plannedFiltersT: SQL<unknown>[] = [eq(schema.trades.status, 'planned')];
    if (params.accountId) {
      plannedFiltersT.push(eq(schema.trades.accountId, params.accountId));
    }
    if (params.direction) {
      plannedFiltersT.push(eq(schema.trades.direction, params.direction as 'long' | 'short'));
    }
    if (statusFilter === 'planned') {
      if (params.from) {
        plannedFiltersT.push(gte(schema.trades.createdAt, params.from));
      }
      if (params.to) {
        plannedFiltersT.push(lte(schema.trades.createdAt, params.to));
      }
    }
    const plannedRows = db
      .select()
      .from(schema.trades)
      .where(plannedFiltersT.length > 0 ? and(...plannedFiltersT) : undefined)
      .all();

    const plannedTotals = {
      totalPlannedRisk: plannedRows.reduce((sum, r) => {
        if (r.plannedEntry != null && r.plannedStop != null && r.plannedQuantity != null && r.plannedQuantity > 0) {
          return sum.plus(new Decimal(Math.abs(r.plannedEntry - r.plannedStop)).mul(new Decimal(r.plannedQuantity)));
        }
        return sum;
      }, new Decimal(0)).toNumber(),
      totalPlannedCapital: plannedRows.reduce((sum, r) => {
        if (r.plannedEntry != null && r.plannedQuantity != null && r.plannedQuantity > 0) {
          return sum.plus(new Decimal(r.plannedEntry).mul(new Decimal(r.plannedQuantity)));
        }
        return sum;
      }, new Decimal(0)).toNumber(),
      count: plannedRows.length,
    };

    return { status: 200, data: { data: enhancedRows, total, page, limit, totals, plannedTotals } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch trades', details: String(error) } };
  }
}

function doPostTrade(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const symbol = body.symbol;
    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { symbol: ['Symbol is required'] } } } };
    }
    if ((symbol as string).length > 20) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { symbol: ['String must contain at most 20 character(s)'] } } } };
    }

    const direction = body.direction;
    if (direction !== 'long' && direction !== 'short') {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { direction: ['Invalid enum value. Expected long | short'] } } } };
    }

    // R025: reject wrong-side planned stops (mirror of POST /api/trades route).
    // Uses the same canonical direction-aware validity check as the route:
    // when both plannedEntry and plannedStop are supplied, computePlannedRiskAmount
    // returns null for a stop on the wrong side of the entry (long stop >= entry,
    // short stop <= entry). Partial/null combinations skip the check.
    const plannedEntryRaw = body.plannedEntry as number | null | undefined;
    const plannedStopRaw = body.plannedStop as number | null | undefined;
    if (plannedEntryRaw != null && plannedStopRaw != null) {
      const risk = computePlannedRiskAmount(direction, plannedEntryRaw, plannedStopRaw, 1);
      if (risk == null) {
        const stopMsg = direction === 'long'
          ? 'Planned stop must be below the planned entry for a long trade.'
          : 'Planned stop must be above the planned entry for a short trade.';
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { plannedStop: [stopMsg] }, formErrors: [] } } };
      }
    }

    // Resolve account: settings.defaultAccountId first, then first active account
    const setting = db.select().from(schema.settings).get() as Record<string, unknown> | undefined;
    let accountId: string | undefined;

    if (setting?.defaultAccountId) {
      accountId = setting.defaultAccountId as string;
    } else {
      const firstActive = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.isActive, true))
        .get() as Record<string, unknown> | undefined;
      accountId = firstActive?.id as string | undefined;
    }

    if (!accountId) {
      return { status: 400, data: { error: 'No active account found. Create an account first or set a default account in settings.' } };
    }

    // Generate tradeCode: T-XXXX
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.trades)
      .get();

    const nextNumber = (countResult?.count ?? 0) + 1;
    const tradeCode = `T-${String(nextNumber).padStart(4, '0')}`;

    // Resolve setup string to UUID if provided
    let resolvedSetupId: string | null = null;
    const setup = body.setup;
    if (setup !== undefined && setup !== null && setup !== '') {
      const lowerValue = (setup as string).toLowerCase();
      const lookup = db
        .select()
        .from(schema.lookupValues)
        .where(and(eq(schema.lookupValues.type, 'setup'), eq(schema.lookupValues.value, lowerValue)))
        .get() as Record<string, unknown> | undefined;
      if (!lookup) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { setup: ['Unknown setup value'] } } } };
      }
      resolvedSetupId = lookup.id as string;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.trades)
      .values({
        id,
        tradeCode,
        accountId,
        symbol: (symbol as string).trim(),
        direction,
        setupId: resolvedSetupId,
        sectorId: (body.sectorId as string) ?? null,
        marketConditionId: (body.marketConditionId as string) ?? null,
        status: 'planned',
        thesis: (body.thesis as string) ?? null,
        plannedEntry: (body.plannedEntry as number) ?? null,
        plannedStop: (body.plannedStop as number) ?? null,
        plannedTarget1: (body.plannedTarget1 as number) ?? null,
        plannedQuantity: (body.plannedQuantity as number) ?? null,
        invalidationCondition: (body.invalidationCondition as string) ?? null,
        preTradePlan: (body.preTradePlan as string) ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(schema.trades).where(eq(schema.trades.id, id)).get();
    return { status: 201, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create trade', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM account_rollforward');
  sqlite.exec('DELETE FROM trade_risk_snapshots');
  sqlite.exec('DELETE FROM trade_executions');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM account_performance;');
  sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedSettings(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.settings)
    .values({
      id,
      currency: 'USD',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.settings).where(eq(schema.settings.id, id)).get() as Record<string, unknown>;
}

function seedLookupValue(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.lookupValues)
    .values({
      id,
      type: 'setup',
      value: 'breakout',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get() as Record<string, unknown>;
}

function seedTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `T-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      accountId: 'test-account-id',
      symbol: 'AAPL',
      direction: 'long',
      status: 'planned',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedExecution(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.tradeExecutions)
    .values({
      id,
      tradeId: '__missing__',
      action: 'buy',
      quantity: 100,
      price: 100,
      fees: 0,
      executedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return id;
}

function seedRollforward(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accountRollforward)
    .values({
      id,
      accountId: 'test-account-id',
      date: new Date().toISOString().slice(0, 10),
      beginningEquity: 10000,
      endingEquity: 12500,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.accountRollforward).where(eq(schema.accountRollforward.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trades API Tests ---\n');

// ── 1. GET: Empty list ─────────────────────────────────────────────

console.log('\n1. GET returns empty list with pagination metadata:');
{
  cleanup();
  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const data = result.data as { data: unknown[]; total: number; page: number; limit: number; totals: unknown };
  assert(Array.isArray(data.data), 'response.data is an array');
  assertEqual(data.data.length, 0, 'data array is empty');
  assertEqual(data.total, 0, 'total is 0');
  assertEqual(data.page, 1, 'page is 1');
  assertEqual(data.limit, 50, 'limit is 50');
  assertNotNull(data.totals, 'totals object is present');
}

// ── 2. GET: Pagination ─────────────────────────────────────────────

console.log('\n2. GET returns paginated results:');
{
  cleanup();
  // Ensure test-account-id exists in accounts table
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL' });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT' });
  seedTrade({ accountId: 'test-account-id', symbol: 'GOOGL' });

  const page1 = doGetTrades({ page: 1, limit: 2 });
  assert(page1.status === 200, 'page 1 returns 200');
  const d1 = page1.data as { data: unknown[]; total: number; page: number; limit: number; totals: unknown };
  assertEqual(d1.data.length, 2, 'page 1 has 2 items');
  assertEqual(d1.total, 3, 'total is 3');
  assertEqual(d1.page, 1, 'page is 1');
  assertEqual(d1.limit, 2, 'limit is 2');

  const page2 = doGetTrades({ page: 2, limit: 2 });
  assert(page2.status === 200, 'page 2 returns 200');
  const d2 = page2.data as { data: unknown[]; total: number; page: number; limit: number; totals: unknown };
  assertEqual(d2.data.length, 1, 'page 2 has 1 item');
  assertEqual(d2.total, 3, 'total is 3');
  assertEqual(d2.page, 2, 'page is 2');
}

// ── 3. GET: Status filter ──────────────────────────────────────────

console.log('\n3. GET filters by status:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'planned' });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'open' });

  const planned = doGetTrades({ status: 'planned' });
  assert(planned.status === 200, 'status filter returns 200');
  const dp = planned.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(dp.data.length, 1, 'returns 1 planned trade');
  assertEqual(dp.data[0].symbol, 'AAPL', 'planned trade symbol matches');
  assertEqual(dp.data[0].status, 'planned', 'status is planned');
  assertNotNull(dp.totals, 'totals present in filtered response');

  const open = doGetTrades({ status: 'open' });
  assert(open.status === 200, 'open filter returns 200');
  const dop = open.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(dop.data.length, 1, 'returns 1 open trade');
  assertEqual(dop.data[0].symbol, 'MSFT', 'open trade symbol matches');
  assertEqual(dop.data[0].status, 'open', 'status is open');
}

// ── 4. POST: Create with valid data ─────────────────────────────────

console.log('\n4. POST creates a trade with valid data:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', thesis: 'Test trade' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertNotNull(data.tradeCode, 'has tradeCode');
  assert((data.tradeCode as string).startsWith('T-'), 'tradeCode starts with T-');
  assertEqual(data.symbol, 'AAPL', 'symbol matches');
  assertEqual(data.direction, 'long', 'direction matches');
  assertEqual(data.status, 'planned', 'status is planned');
  assertEqual(data.thesis, 'Test trade', 'thesis matches');
  assertNotNull(data.createdAt, 'has createdAt');
  assertNotNull(data.updatedAt, 'has updatedAt');
}

// ── 5. POST: Validates empty symbol ─────────────────────────────────

console.log('\n5. POST returns 400 for empty symbol:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const result = doPostTrade({ symbol: '', direction: 'long' });
  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Validates direction enum ───────────────────────────────

console.log('\n6. POST returns 400 for invalid direction:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const result = doPostTrade({ symbol: 'AAPL', direction: 'invalid' });
  assert(result.status === 400, 'returns 400');
}

// ── 7. POST: Resolves setup string to UUID ──────────────────────────

console.log('\n7. POST resolves setup string to lookup UUID:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });
  const lookup = seedLookupValue({ type: 'setup', value: 'breakout' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', setup: 'breakout' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.setupId, lookup.id, 'setupId matches lookup id');
}

// ── 8. POST: Picks defaultAccountId from settings ───────────────────

console.log('\n8. POST picks defaultAccountId from settings:');
{
  cleanup();
  const account1 = seedAccount({ name: 'Default Account' });
  seedAccount({ name: 'Other Account' });
  seedSettings({ defaultAccountId: account1.id });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.accountId, account1.id, 'accountId matches default account');
}

// ── 9. POST: Picks first active account without settings ────────────

console.log('\n9. POST picks first active account when no default settings:');
{
  cleanup();
  const account1 = seedAccount({ name: 'First Account' });
  seedAccount({ name: 'Second Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.accountId, account1.id, 'accountId matches first active account');
}

// ── 10. POST: With plannedQuantity 100 returns plannedQuantity in response ─

console.log('\n10. POST with plannedQuantity 100 returns plannedQuantity in response:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', plannedQuantity: 100 });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.plannedQuantity, 100, 'plannedQuantity = 100 in POST response');
}

// ── 11. POST: Without plannedQuantity returns null ────────────────────

console.log('\n11. POST without plannedQuantity returns null:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.plannedQuantity, null, 'plannedQuantity is null when not provided');
}

// ── 12. POST: Returns 400 with no active accounts ───────────────────

console.log('\n12. POST returns 400 when no active accounts exist:');
{
  cleanup();
  const result = doPostTrade({ symbol: 'AAPL', direction: 'long' });
  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string };
  assert(data.error.includes('No active account'), 'error mentions no active account');
}

// ── 12a. POST: Rejects wrong-side long planned stop (stop >= entry) ──

console.log('\n12a. POST rejects long planned stop >= planned entry:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const before = db.select({ count: sql<number>`COUNT(*)` }).from(schema.trades).get()?.count ?? 0;

  const result = doPostTrade({ symbol: 'AAPL', direction: 'long', plannedEntry: 100, plannedStop: 105 });
  assert(result.status === 400, 'long wrong-side stop returns 400');
  const data = result.data as { error: string; details: { fieldErrors: Record<string, string[] | undefined> } };
  assertEqual(data.error, 'Validation failed', 'error is Validation failed');
  assertEqual(data.details.fieldErrors.plannedStop?.length, 1, 'field error targets plannedStop with one message');
  assert((data.details.fieldErrors.plannedStop?.[0] ?? '').includes('below'), 'long error message says stop must be below entry');

  const after = db.select({ count: sql<number>`COUNT(*)` }).from(schema.trades).get()?.count ?? 0;
  assertEqual(after, before, 'no trade row inserted on rejection');
}

// ── 12b. POST: Rejects wrong-side short planned stop (stop <= entry) ──

console.log('\n12b. POST rejects short planned stop <= planned entry:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const before = db.select({ count: sql<number>`COUNT(*)` }).from(schema.trades).get()?.count ?? 0;

  const result = doPostTrade({ symbol: 'AAPL', direction: 'short', plannedEntry: 100, plannedStop: 95 });
  assert(result.status === 400, 'short wrong-side stop returns 400');
  const data = result.data as { error: string; details: { fieldErrors: Record<string, string[] | undefined> } };
  assertEqual(data.error, 'Validation failed', 'error is Validation failed');
  assertEqual(data.details.fieldErrors.plannedStop?.length, 1, 'field error targets plannedStop with one message');
  assert((data.details.fieldErrors.plannedStop?.[0] ?? '').includes('above'), 'short error message says stop must be above entry');

  const after = db.select({ count: sql<number>`COUNT(*)` }).from(schema.trades).get()?.count ?? 0;
  assertEqual(after, before, 'no trade row inserted on rejection');
}

// ── 12c. POST: Rejects boundary equality (stop == entry) ─────────────

console.log('\n12c. POST rejects planned stop == planned entry (boundary):');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const longResult = doPostTrade({ symbol: 'AAPL', direction: 'long', plannedEntry: 100, plannedStop: 100 });
  assert(longResult.status === 400, 'long stop == entry returns 400');

  const shortResult = doPostTrade({ symbol: 'AAPL', direction: 'short', plannedEntry: 100, plannedStop: 100 });
  assert(shortResult.status === 400, 'short stop == entry returns 400');
}

// ── 12d. POST: Accepts valid stop configurations ─────────────────────

console.log('\n12d. POST accepts valid long and short stop configurations:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const longResult = doPostTrade({ symbol: 'AAPL', direction: 'long', plannedEntry: 100, plannedStop: 95 });
  assert(longResult.status === 201, 'long entry > stop returns 201');
  const longData = longResult.data as Record<string, unknown>;
  assertEqual(longData.plannedStop, 95, 'long plannedStop persisted as 95');
  assertEqual(longData.plannedEntry, 100, 'long plannedEntry persisted as 100');

  const shortResult = doPostTrade({ symbol: 'MSFT', direction: 'short', plannedEntry: 100, plannedStop: 105 });
  assert(shortResult.status === 201, 'short stop > entry returns 201');
  const shortData = shortResult.data as Record<string, unknown>;
  assertEqual(shortData.plannedStop, 105, 'short plannedStop persisted as 105');
  assertEqual(shortData.plannedEntry, 100, 'short plannedEntry persisted as 100');
}

// ── 12e. POST: Partial/null planned fields are not rejected ──────────

console.log('\n12e. POST does not reject partial/null planned field combinations:');
{
  cleanup();
  seedAccount({ name: 'Trading Account' });

  const onlyEntry = doPostTrade({ symbol: 'AAPL', direction: 'long', plannedEntry: 100 });
  assert(onlyEntry.status === 201, 'only plannedEntry returns 201');

  const onlyStop = doPostTrade({ symbol: 'MSFT', direction: 'long', plannedStop: 95 });
  assert(onlyStop.status === 201, 'only plannedStop returns 201');

  const neither = doPostTrade({ symbol: 'GOOGL', direction: 'short' });
  assert(neither.status === 201, 'neither plannedEntry nor plannedStop returns 201');
}

// ── 13. GET: Date-range filter ─────────────────────────────────────

console.log('\n13. GET filters by date range:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'open', openedAt: '2024-01-15T10:00:00.000Z', createdAt: new Date().toISOString() });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'open', openedAt: '2024-06-15T10:00:00.000Z', createdAt: new Date().toISOString() });
  seedTrade({ accountId: 'test-account-id', symbol: 'GOOGL', status: 'open', openedAt: '2024-12-15T10:00:00.000Z', createdAt: new Date().toISOString() });

  const q1 = doGetTrades({ from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.000Z' });
  assert(q1.status === 200, 'Q1 filter returns 200');
  const d1 = q1.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d1.data.length, 1, 'Q1 has 1 trade');
  assertEqual(d1.data[0].symbol, 'AAPL', 'Q1 trade is AAPL');
  assertNotNull(d1.totals, 'totals present in date-filtered response');

  const q2 = doGetTrades({ from: '2024-04-01T00:00:00.000Z', to: '2024-09-30T23:59:59.000Z' });
  assert(q2.status === 200, 'Q2-Q3 filter returns 200');
  const d2 = q2.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d2.data.length, 1, 'Q2-Q3 has 1 trade');
  assertEqual(d2.data[0].symbol, 'MSFT', 'Q2-Q3 trade is MSFT');

  const all = doGetTrades({ from: '2024-01-01T00:00:00.000Z' });
  assert(all.status === 200, 'from-only filter returns 200');
  const da = all.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(da.data.length, 3, 'from-only returns all 3 trades');
}

// ── 14. GET: Account filter ────────────────────────────────────────

console.log('\n14. GET filters by accountId:');
{
  cleanup();
  seedAccount({ id: 'acc-1', name: 'Account 1' });
  seedAccount({ id: 'acc-2', name: 'Account 2' });
  seedTrade({ accountId: 'acc-1', symbol: 'AAPL', status: 'open' });
  seedTrade({ accountId: 'acc-2', symbol: 'TSLA', status: 'open' });

  const acc1 = doGetTrades({ accountId: 'acc-1' });
  assert(acc1.status === 200, 'account filter returns 200');
  const d1 = acc1.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(d1.data.length, 1, 'acc-1 has 1 trade');
  assertEqual(d1.data[0].symbol, 'AAPL', 'acc-1 trade is AAPL');

  const acc2 = doGetTrades({ accountId: 'acc-2' });
  const d2 = acc2.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(d2.data.length, 1, 'acc-2 has 1 trade');
  assertEqual(d2.data[0].symbol, 'TSLA', 'acc-2 trade is TSLA');

  const missing = doGetTrades({ accountId: 'acc-nonexistent' });
  const dm = missing.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(dm.data.length, 0, 'nonexistent account has 0 trades');
}

// ── 15. GET: Direction filter ──────────────────────────────────────

console.log('\n15. GET filters by direction:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open' });
  seedTrade({ accountId: 'test-account-id', symbol: 'TSLA', direction: 'short', status: 'open' });

  const longs = doGetTrades({ direction: 'long' });
  assert(longs.status === 200, 'direction=long returns 200');
  const dl = longs.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(dl.data.length, 1, '1 long trade');
  assertEqual(dl.data[0].symbol, 'AAPL', 'long trade is AAPL');

  const shorts = doGetTrades({ direction: 'short' });
  const ds = shorts.data as { data: Record<string, unknown>[]; total: number };
  assertEqual(ds.data.length, 1, '1 short trade');
  assertEqual(ds.data[0].symbol, 'TSLA', 'short trade is TSLA');
}

// ── 16. GET: Invalid direction returns 400 ─────────────────────────

console.log('\n16. GET returns 400 for invalid direction:');
{
  cleanup();
  const result = doGetTrades({ direction: 'invalid' });
  assert(result.status === 400, 'returns 400');
}

// ── 17. GET: Totals aggregation ────────────────────────────────────

console.log('\n17. GET returns server-computed totals:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });

  // Closed long: realize 992 (P&L 1000 - fees 8)
  const trade1 = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'closed' });
  const t1Id = trade1.id as string;
  seedExecution({ tradeId: t1Id, action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution({ tradeId: t1Id, action: 'sell', quantity: 100, price: 110, fees: 3 });

  // Closed short: realizes 994 (P&L 1000 - fees 6)
  const trade2 = seedTrade({ accountId: 'test-account-id', symbol: 'TSLA', direction: 'short', status: 'closed' });
  const t2Id = trade2.id as string;
  seedExecution({ tradeId: t2Id, action: 'sell_short', quantity: 50, price: 200, fees: 4 });
  seedExecution({ tradeId: t2Id, action: 'buy_to_cover', quantity: 50, price: 180, fees: 2 });

  // Open trade contributes 0 to realized totals
  const trade3 = seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', direction: 'long', status: 'open' });

  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[]; totals: { grossRealizedPnl: number; netRealizedPnl: number; totalFees: number } };

  assertNotNull(d.totals, 'totals object is present');
  // grossRealizedPnl = 1000 (long) + 1000 (short) = 2000
  assertEqual(d.totals.grossRealizedPnl, 2000, 'totals.grossRealizedPnl = 2000');
  // netRealizedPnl = 992 + 994 = 1986
  assertEqual(d.totals.netRealizedPnl, 1986, 'totals.netRealizedPnl = 1986');
  // totalFees = 8 (long) + 6 (short) = 14
  assertEqual(d.totals.totalFees, 14, 'totals.totalFees = 14');
}

// ── 18. GET: Enriched rows have metrics object ─────────────────────

console.log('\n18. GET enriched rows have metrics and flat fields:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'closed' });
  const tId = trade.id as string;
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution({ tradeId: tId, action: 'sell', quantity: 100, price: 110, fees: 3 });

  const result = doGetTrades();
  const d = result.data as { data: Record<string, unknown>[]; totals: unknown };
  const row = d.data[0] as Record<string, unknown>;

  assertNotNull(row.metrics, 'metrics object is present');
  assertNotNull(row.realizedPnl, 'realizedPnl flat field is present');
  assertEqual(row.unrealizedPnl, null, 'unrealizedPnl is null for closed trade');
  assertNotNull(row.returnPct, 'returnPct flat field is present');

  const m = row.metrics as Record<string, unknown>;
  assertNotNull(m.size, 'metrics.size');
  assertNotNull(m.averagePrices, 'metrics.averagePrices');
  assertNotNull(m.fees, 'metrics.fees');
  assertNotNull(m.realizedPnl, 'metrics.realizedPnl');
  assertNotNull(m.returnMetrics, 'metrics.returnMetrics');
}

// ── 19. GET: Open trades ignore date filters ─────────────────────

console.log('\n19. GET status-aware: open trades ignore date filters:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'open', openedAt: '2024-01-15T10:00:00.000Z', createdAt: '2024-01-16T10:00:00.000Z' });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'open', openedAt: '2024-06-15T10:00:00.000Z', createdAt: '2024-06-16T10:00:00.000Z' });

  // Status=open with date range that matches NEITHER trade — open trades should ALL be returned
  const result = doGetTrades({ status: 'open', from: '2099-01-01T00:00:00.000Z' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d.data.length, 2, 'both open trades returned despite restrictive date filter');
  assertEqual(d.data[0].symbol, 'MSFT', 'first trade is MSFT (newer created_at)');
  assertEqual(d.data[1].symbol, 'AAPL', 'second trade is AAPL');
  assertNotNull(d.totals, 'totals present');
}

// ── 20. GET: Closed trades filtered by closedAt ────────────────────

console.log('\n20. GET status-aware: closed trades filtered by closedAt:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'closed', openedAt: '2024-01-15T10:00:00.000Z', closedAt: '2024-02-01T10:00:00.000Z', createdAt: new Date().toISOString() });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'closed', openedAt: '2024-03-15T10:00:00.000Z', closedAt: '2024-06-01T10:00:00.000Z', createdAt: new Date().toISOString() });

  // Filter by closedAt range
  const q1 = doGetTrades({ status: 'closed', from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.000Z' });
  assert(q1.status === 200, 'returns 200');
  const d1 = q1.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d1.data.length, 1, '1 closed trade in Q1');
  assertEqual(d1.data[0].symbol, 'AAPL', 'Q1 closed trade is AAPL (closedAt=Feb)');
  assertNotNull(d1.totals, 'totals present');

  const q2 = doGetTrades({ status: 'closed', from: '2024-04-01T00:00:00.000Z', to: '2024-12-31T23:59:59.000Z' });
  assert(q2.status === 200, 'returns 200');
  const d2 = q2.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d2.data.length, 1, '1 closed trade in Q2-Q4');
  assertEqual(d2.data[0].symbol, 'MSFT', 'Q2-Q4 closed trade is MSFT (closedAt=Jun)');
}

// ── 21. GET: Planned trades filtered by createdAt ──────────────────

console.log('\n21. GET status-aware: planned trades filtered by createdAt:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', status: 'planned', createdAt: '2024-01-15T10:00:00.000Z', openedAt: null });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', status: 'planned', createdAt: '2024-06-15T10:00:00.000Z', openedAt: null });
  // Also create an open trade to verify it does NOT appear when filtering by planned
  seedTrade({ accountId: 'test-account-id', symbol: 'GOOGL', status: 'open', createdAt: '2024-03-15T10:00:00.000Z', openedAt: '2024-03-15T10:00:00.000Z' });

  const q1 = doGetTrades({ status: 'planned', from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.000Z' });
  assert(q1.status === 200, 'returns 200');
  const d1 = q1.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d1.data.length, 1, '1 planned trade in Q1');
  assertEqual(d1.data[0].symbol, 'AAPL', 'Q1 planned trade is AAPL (createdAt=Jan)');
  assertNotNull(d1.totals, 'totals present');

  const q2 = doGetTrades({ status: 'planned', from: '2024-04-01T00:00:00.000Z', to: '2024-12-31T23:59:59.000Z' });
  assert(q2.status === 200, 'returns 200');
  const d2 = q2.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d2.data.length, 1, '1 planned trade in Q2-Q4');
  assertEqual(d2.data[0].symbol, 'MSFT', 'Q2-Q4 planned trade is MSFT (createdAt=Jun)');

  // Without status filter, date filters use openedAt (backward compatible)
  // Only GOOGL has a non-null openedAt, so it should be the only one returned
  const q3 = doGetTrades({ from: '2024-01-01T00:00:00.000Z' });
  assert(q3.status === 200, 'returns 200');
  const d3 = q3.data as { data: Record<string, unknown>[]; total: number; totals: unknown };
  assertEqual(d3.data.length, 1, '1 trade returned with default openedAt filter (no status)');
  assertEqual(d3.data[0].symbol, 'GOOGL', 'default filter matches GOOGL (openedAt=March)');
}

// ── 22. GET: Equity uses rollforward.endingEquity ──────────────────

console.log('\n22. GET uses rollforward.endingEquity as primary equity source:');
{
  cleanup();
  // Account with startingBalance 10000 but rollforward endingEquity 12500
  const acc = seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  seedRollforward({
    accountId: 'test-account-id',
    date: new Date().toISOString().slice(0, 10),
    endingEquity: 12500,
  });

  // Open trade with a risk snapshot so riskToAccount is computed
  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    currentPrice: 110,
  });
  const tId = trade.id as string;
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 100, fees: 0 });

  // Risk snapshot: risk at $100 for 100 shares = 1000 initial risk
  const rsId = randomUUID();
  db.insert(schema.tradeRiskSnapshots)
    .values({
      id: rsId,
      tradeId: tId,
      initialRiskAmount: 1000,
      accountEquityAtOpen: 10000,
    })
    .run();

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[] };
  assertEqual(d.data.length, 1, '1 trade returned');

  const row = d.data[0] as Record<string, unknown>;
  const m = row.metrics as Record<string, unknown>;
  const risk = m.risk as Record<string, unknown>;

  // With rollforward.endingEquity=12500, riskToAccount = 1000/12500 = 0.08
  assertNotNull(risk.riskToAccount, 'riskToAccount is not null (rollforward equity was used)');
  assertApprox(risk.riskToAccount as number, 0.08, 0.01, `riskToAccount ≈ 0.08 (1000/12500) got ${risk.riskToAccount}`);
  assertNotNull(risk.openRisk, 'openRisk is computed');
}

// ── 23. GET: Falls back to startingBalance when no rollforward exists ──

console.log('\n23. GET equity falls back to account.startingBalance when no rollforward exists:');
{
  cleanup();
  // Account with startingBalance 50000 but NO rollforward row
  seedAccount({ id: 'test-account-id', startingBalance: 50000 });

  const trade = seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'open',
    currentPrice: 110,
  });
  const tId = trade.id as string;
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 100, fees: 0 });

  const rsId = randomUUID();
  db.insert(schema.tradeRiskSnapshots)
    .values({
      id: rsId,
      tradeId: tId,
      initialRiskAmount: 1000,
      accountEquityAtOpen: 50000,
    })
    .run();

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[] };
  assertEqual(d.data.length, 1, '1 trade returned');

  const row = d.data[0] as Record<string, unknown>;
  const m = row.metrics as Record<string, unknown>;
  const risk = m.risk as Record<string, unknown>;

  // No NAV, no rollforward → account.startingBalance=50000 → riskToAccount = 1000/50000 = 0.02
  assertApprox(risk.riskToAccount as number, 0.02, 0.01, 'riskToAccount ≈ 0.02 (1000/50000) using startingBalance fallback');
}

// ── 24. GET: totals aggregate across multi-currency accounts ──────────

console.log('\n24. GET returns totals aggregated across multi-currency accounts:');
{
  cleanup();
  // Account 1: USD
  const usdAcc = seedAccount({ id: 'usd-acc-id', name: 'USD Account', currency: 'USD' });
  // Account 2: EUR
  const eurAcc = seedAccount({ id: 'eur-acc-id', name: 'EUR Account', currency: 'EUR' });
  // Account 3: USD (another one, to verify USD aggregation)
  const usdAcc2 = seedAccount({ id: 'usd-acc-2', name: 'USD Account 2', currency: 'USD' });

  // USD trade 1: closed long, gross 1000, net 992, fees 8
  const trade1 = seedTrade({ accountId: 'usd-acc-id', symbol: 'AAPL', direction: 'long', status: 'closed' });
  const t1Id = trade1.id as string;
  seedExecution({ tradeId: t1Id, action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution({ tradeId: t1Id, action: 'sell', quantity: 100, price: 110, fees: 3 });

  // USD trade 2: closed short, gross 500, net 494, fees 6
  const trade2 = seedTrade({ accountId: 'usd-acc-2', symbol: 'MSFT', direction: 'short', status: 'closed' });
  const t2Id = trade2.id as string;
  seedExecution({ tradeId: t2Id, action: 'sell_short', quantity: 25, price: 200, fees: 4 });
  seedExecution({ tradeId: t2Id, action: 'buy_to_cover', quantity: 25, price: 180, fees: 2 });

  // EUR trade: closed short, gross 1000, net 994, fees 6
  const trade3 = seedTrade({ accountId: 'eur-acc-id', symbol: 'TSLA', direction: 'short', status: 'closed' });
  const t3Id = trade3.id as string;
  seedExecution({ tradeId: t3Id, action: 'sell_short', quantity: 50, price: 200, fees: 4 });
  seedExecution({ tradeId: t3Id, action: 'buy_to_cover', quantity: 50, price: 180, fees: 2 });

  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const d = result.data as { totals: { grossRealizedPnl: number; netRealizedPnl: number; totalFees: number } };

  // Top-level totals aggregate across accounts regardless of currency:
  // gross 1500 (USD) + 1000 (EUR) = 2500; net 1486 + 994 = 2480; fees 14 + 6 = 20.
  assertEqual(d.totals.grossRealizedPnl, 2500, 'totals.grossRealizedPnl = 2500 (1500 USD + 1000 EUR)');
  assertEqual(d.totals.netRealizedPnl, 2480, 'totals.netRealizedPnl = 2480 (1486 USD + 994 EUR)');
  assertEqual(d.totals.totalFees, 20, 'totals.totalFees = 20 (14 USD + 6 EUR)');
}


// ── 26. GET: plannedRiskToAccount computed for planned trades ─────────

console.log('\n26. GET plannedRiskToAccount computed for planned trades:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  seedRollforward({
    accountId: 'test-account-id',
    date: new Date().toISOString().slice(0, 10),
    endingEquity: 12500,
  });

  // Planned trade with plannedEntry=105, plannedStop=95, plannedQuantity=100
  // plannedRiskAmount = |105 - 95| * 100 = 1000
  // plannedRiskToAccount = 1000 / 12500 = 0.08
  seedTrade({
    accountId: 'test-account-id',
    symbol: 'MSFT',
    direction: 'long',
    status: 'planned',
    plannedEntry: 105,
    plannedStop: 95,
    plannedQuantity: 100,
  });

  // Planned trade with missing plannedStop → plannedRiskToAccount should be null
  seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'planned',
    plannedEntry: 100,
    plannedStop: null,
    plannedQuantity: 50,
  });

  const result = doGetTrades({ status: 'planned' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[] };
  assertEqual(d.data.length, 2, '2 planned trades returned');

  // MSFT: full risk plan
  const msftRow = d.data.find((r: Record<string, unknown>) => r.symbol === 'MSFT') as Record<string, unknown>;
  assertNotNull(msftRow, 'MSFT row found');
  assertNotNull(msftRow.plannedRiskToAccount, 'plannedRiskToAccount is computed for MSFT');
  assertApprox(msftRow.plannedRiskToAccount as number, 0.08, 0.01, 'plannedRiskToAccount ≈ 0.08 (1000/12500) for MSFT');

  // AAPL: missing plannedStop → plannedRiskToAccount should be null
  const aaplRow = d.data.find((r: Record<string, unknown>) => r.symbol === 'AAPL') as Record<string, unknown>;
  assertNotNull(aaplRow, 'AAPL row found');
  assertEqual(aaplRow.plannedRiskToAccount, null, 'plannedRiskToAccount is null when plannedStop is missing');
}

// ── 27. GET: portfolioHeat in totals ────────────────────────────────

console.log('\n27. GET returns portfolioHeat in totals:');
{
  cleanup();
  // Account 1 (USD) with rollforward: equity 25000
  const usdAcc = seedAccount({ id: 'usd-heat-acc', name: 'USD Heat', currency: 'USD' });
  seedRollforward({ accountId: 'usd-heat-acc', endingEquity: 25000 });
  // Account 2 (EUR) with rollforward: equity 40000
  const eurAcc = seedAccount({ id: 'eur-heat-acc', name: 'EUR Heat', currency: 'EUR' });
  seedRollforward({ accountId: 'eur-heat-acc', endingEquity: 40000 });

  // USD open trade with open risk ~1000 (100 shares * $10 risk)
  const trade1 = seedTrade({ accountId: 'usd-heat-acc', symbol: 'AAPL', direction: 'long', status: 'open', currentPrice: 110 });
  seedExecution({ tradeId: trade1.id as string, action: 'buy', quantity: 100, price: 100, fees: 0 });
  db.insert(schema.tradeRiskSnapshots).values({ id: randomUUID(), tradeId: trade1.id as string, initialRiskAmount: 1000, accountEquityAtOpen: 25000 }).run();

  // EUR open trade with open risk ~500 (50 shares * $10 risk)
  const trade2 = seedTrade({ accountId: 'eur-heat-acc', symbol: 'TSLA', direction: 'long', status: 'open', currentPrice: 210 });
  seedExecution({ tradeId: trade2.id as string, action: 'buy', quantity: 50, price: 200, fees: 0 });
  db.insert(schema.tradeRiskSnapshots).values({ id: randomUUID(), tradeId: trade2.id as string, initialRiskAmount: 500, accountEquityAtOpen: 40000 }).run();

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { totals: Record<string, unknown> };

  assertNotNull(d.totals, 'totals object is present');
  // Top-level portfolioHeatAmount = sum of open risk across all currencies
  assertEqual(d.totals.portfolioHeatAmount, 1500, 'portfolioHeatAmount in top-level totals = 1500 (1000 USD + 500 EUR)');
  // Top-level portfolioHeatPct = decimal fraction of total equity (M010 contract):
  // 1500 / (25000 + 40000) = 0.02308 → 2.31%
  assertApprox(d.totals.portfolioHeatPct as number, 1500 / 65000, 0.0001, 'portfolioHeatPct in top-level totals = 1500/65000 ≈ 0.02308 (decimal fraction)');
  assert((d.totals.portfolioHeatPct as number) < 1.0, 'portfolioHeatPct is a decimal fraction < 1.0 (NOT a ×100 percentage)');
}

// ── 28. GET: portfolioHeat is 0 for closed and planned tabs ────────

console.log('\n28. GET returns portfolioHeat=0 for closed and planned tabs:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });

  // Closed trade — no open risk
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'closed' });
  seedExecution({ tradeId: trade.id as string, action: 'buy', quantity: 100, price: 100, fees: 0 });
  seedExecution({ tradeId: trade.id as string, action: 'sell', quantity: 100, price: 105, fees: 0 });

  const closedResult = doGetTrades({ status: 'closed' });
  assert(closedResult.status === 200, 'closed returns 200');
  const cd = closedResult.data as { totals: Record<string, unknown> };
  // Top-level portfolioHeat fields are always present; zero when there is no open risk
  assertEqual(cd.totals.portfolioHeatAmount, 0, 'closed totals.portfolioHeatAmount = 0 (no open risk)');
  assertEqual(cd.totals.portfolioHeatPct, 0, 'closed totals.portfolioHeatPct = 0 (no open risk)');

  // Planned trade — no open risk
  const plannedResult = doGetTrades({ status: 'planned' });
  assert(plannedResult.status === 200, 'planned returns 200');
  const pd = plannedResult.data as { totals: Record<string, unknown> };
  assertEqual(pd.totals.portfolioHeatAmount, 0, 'planned totals.portfolioHeatAmount = 0 (no open risk)');
  assertEqual(pd.totals.portfolioHeatPct, 0, 'planned totals.portfolioHeatPct = 0 (no open risk)');
}

// ── 29. GET: plannedTotals in response ──────────────────────────────

console.log('\n29. GET returns plannedTotals with aggregate risk/capital:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });

  // Planned trade 1: plannedEntry=105, plannedStop=95, plannedQuantity=100
  // plannedRisk = |105-95| * 100 = 1000, plannedCapital = 105 * 100 = 10500
  seedTrade({
    accountId: 'test-account-id',
    symbol: 'MSFT',
    direction: 'long',
    status: 'planned',
    plannedEntry: 105,
    plannedStop: 95,
    plannedQuantity: 100,
  });

  // Planned trade 2: plannedEntry=50, plannedStop=45, plannedQuantity=200
  // plannedRisk = |50-45| * 200 = 1000, plannedCapital = 50 * 200 = 10000
  seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'planned',
    plannedEntry: 50,
    plannedStop: 45,
    plannedQuantity: 200,
  });

  // Planned trade 3: missing plannedStop → partial (contributes capital but not risk)
  // plannedCapital = 2000 * 30 = 60000
  seedTrade({
    accountId: 'test-account-id',
    symbol: 'GOOGL',
    direction: 'long',
    status: 'planned',
    plannedEntry: 2000,
    plannedStop: null,
    plannedQuantity: 30,
  });

  // Open trade — should NOT be counted in plannedTotals
  seedTrade({ accountId: 'test-account-id', symbol: 'NVDA', direction: 'long', status: 'open' });

  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const d = result.data as { plannedTotals: { totalPlannedRisk: number; totalPlannedCapital: number; count: number } };

  assertNotNull(d.plannedTotals, 'plannedTotals object is present');
  // totalPlannedRisk = 1000 (MSFT) + 1000 (AAPL) + 0 (GOOGL, missing stop) = 2000
  assertEqual(d.plannedTotals.totalPlannedRisk, 2000, 'plannedTotals.totalPlannedRisk = 2000');
  // totalPlannedCapital = 10500 (MSFT) + 10000 (AAPL) + 60000 (GOOGL) = 80500
  assertEqual(d.plannedTotals.totalPlannedCapital, 80500, 'plannedTotals.totalPlannedCapital = 80500');
  // count = 3 planned trades (NVDA is open, not counted)
  assertEqual(d.plannedTotals.count, 3, 'plannedTotals.count = 3');
}

// ── 30. GET: plannedTotals present when status=planned filter ───────

console.log('\n30. GET plannedTotals present with status=planned filter:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });

  seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'planned',
    plannedEntry: 100,
    plannedStop: 90,
    plannedQuantity: 50,
  });

  seedTrade({
    accountId: 'test-account-id',
    symbol: 'TSLA',
    direction: 'long',
    status: 'open',
  });

  const result = doGetTrades({ status: 'planned' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { plannedTotals: { totalPlannedRisk: number; totalPlannedCapital: number; count: number } };

  assertNotNull(d.plannedTotals, 'plannedTotals present in planned-filtered response');
  // totalPlannedRisk = |100-90| * 50 = 500
  assertEqual(d.plannedTotals.totalPlannedRisk, 500, 'plannedTotals.totalPlannedRisk = 500');
  // totalPlannedCapital = 100 * 50 = 5000
  assertEqual(d.plannedTotals.totalPlannedCapital, 5000, 'plannedTotals.totalPlannedCapital = 5000');
  // count = 1 (only AAPL planned, TSLA is open)
  assertEqual(d.plannedTotals.count, 1, 'plannedTotals.count = 1');
}

// ── 31. GET: plannedTotals empty when no planned trades exist ───────

console.log('\n31. GET plannedTotals returns zeros when no planned trades:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open' });
  seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', direction: 'long', status: 'closed' });

  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const d = result.data as { plannedTotals: { totalPlannedRisk: number; totalPlannedCapital: number; count: number } };

  assertNotNull(d.plannedTotals, 'plannedTotals present even with no planned trades');
  assertEqual(d.plannedTotals.totalPlannedRisk, 0, 'plannedTotals.totalPlannedRisk = 0 when no planned trades');
  assertEqual(d.plannedTotals.totalPlannedCapital, 0, 'plannedTotals.totalPlannedCapital = 0 when no planned trades');
  assertEqual(d.plannedTotals.count, 0, 'plannedTotals.count = 0 when no planned trades');
}

// ── 31b. GET: plannedTotals respects date filters when status=planned ─

console.log('\n31b. GET plannedTotals respects date filters when status=planned:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });

  // Planned trade A: createdAt Jan 2024, risk = |100-90|*50 = 500, capital = 5000
  seedTrade({
    accountId: 'test-account-id',
    symbol: 'AAPL',
    direction: 'long',
    status: 'planned',
    plannedEntry: 100,
    plannedStop: 90,
    plannedQuantity: 50,
    createdAt: '2024-01-15T10:00:00.000Z',
    openedAt: null,
  });

  // Planned trade B: createdAt Jun 2024, risk = |50-45|*100 = 500, capital = 5000
  seedTrade({
    accountId: 'test-account-id',
    symbol: 'MSFT',
    direction: 'long',
    status: 'planned',
    plannedEntry: 50,
    plannedStop: 45,
    plannedQuantity: 100,
    createdAt: '2024-06-15T10:00:00.000Z',
    openedAt: null,
  });

  // Open trade — never counted in plannedTotals
  seedTrade({ accountId: 'test-account-id', symbol: 'TSLA', direction: 'long', status: 'open', openedAt: '2024-06-20T10:00:00.000Z', createdAt: '2024-06-20T10:00:00.000Z' });

  // Planned tab + Q2-Q4 date range → only B is in-window
  const q1 = doGetTrades({ status: 'planned', from: '2024-04-01T00:00:00.000Z', to: '2024-12-31T23:59:59.999Z' });
  assert(q1.status === 200, 'returns 200');
  const d1 = q1.data as {
    data: Record<string, unknown>[];
    total: number;
    plannedTotals: { totalPlannedRisk: number; totalPlannedCapital: number; count: number };
  };
  assertEqual(d1.data.length, 1, '1 planned trade in Q2-Q4 window');
  assertEqual(d1.total, 1, 'tab total = 1 in Q2-Q4 window');
  assertEqual(d1.plannedTotals.count, 1, 'plannedTotals.count = 1 (matches tab count)');
  assertEqual(d1.plannedTotals.totalPlannedRisk, 500, 'plannedTotals.totalPlannedRisk = 500 (only B in window)');
  assertEqual(d1.plannedTotals.totalPlannedCapital, 5000, 'plannedTotals.totalPlannedCapital = 5000 (only B in window)');
  assertEqual(d1.plannedTotals.count, d1.total, 'plannedTotals.count === tab total when status=planned with date filter');

  // Planned tab + Q1 date range → only A is in-window
  const q2 = doGetTrades({ status: 'planned', from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.999Z' });
  assert(q2.status === 200, 'returns 200');
  const d2 = q2.data as { data: Record<string, unknown>[]; total: number; plannedTotals: { count: number } };
  assertEqual(d2.data.length, 1, '1 planned trade in Q1 window');
  assertEqual(d2.plannedTotals.count, 1, 'plannedTotals.count = 1 in Q1 window');
  assertEqual(d2.plannedTotals.count, d2.total, 'plannedTotals.count === tab total in Q1 window');

  // Regression: status NOT planned (no status) + date filter → plannedTotals
  // must keep the full pipeline view (count ALL planned trades regardless of date).
  const q3 = doGetTrades({ from: '2024-04-01T00:00:00.000Z' });
  assert(q3.status === 200, 'returns 200');
  const d3 = q3.data as { plannedTotals: { count: number } };
  assertEqual(d3.plannedTotals.count, 2, 'plannedTotals.count = 2 when status is NOT planned (date filter not applied)');

  // Regression: status=open + date filter → plannedTotals still full pipeline view
  const q4 = doGetTrades({ status: 'open', from: '2099-01-01T00:00:00.000Z' });
  assert(q4.status === 200, 'returns 200');
  const d4 = q4.data as { plannedTotals: { count: number } };
  assertEqual(d4.plannedTotals.count, 2, 'plannedTotals.count = 2 when status=open (date filter not applied)');
}

// ── 32. GET: Returns resolved accountName, sectorName, marketConditionName, accountCurrency ──

console.log('\n32. GET returns resolved accountName, sectorName, marketConditionName, accountCurrency:');
{
  cleanup();
  const sectorId = randomUUID();
  const marketConditionId = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.lookupValues)
    .values({
      id: sectorId,
      type: 'sector',
      value: 'Technology',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.lookupValues)
    .values({
      id: marketConditionId,
      type: 'market_condition',
      value: 'Trend Following',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const acc = seedAccount({ name: 'Interactive Brokers', currency: 'EUR' });
  const accId = acc.id as string;

  seedTrade({
    accountId: accId,
    symbol: 'AAPL',
    direction: 'long',
    status: 'planned',
    sectorId,
    marketConditionId,
  });
  seedTrade({
    accountId: accId,
    symbol: 'NVDA',
    direction: 'long',
    status: 'planned',
    sectorId: null,
    marketConditionId: null,
  });

  const result = doGetTrades({ status: 'planned' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[] };
  assertEqual(d.data.length, 2, '2 planned trades returned');

  const aapl = d.data.find((r: Record<string, unknown>) => r.symbol === 'AAPL') as Record<string, unknown>;
  assertNotNull(aapl, 'AAPL row found');
  assertEqual(aapl.accountName, 'Interactive Brokers', 'accountName is "Interactive Brokers"');
  assertEqual(aapl.accountCurrency, 'EUR', 'accountCurrency is "EUR"');
  assertEqual(aapl.sectorName, 'Technology', 'sectorName is "Technology"');
  assertEqual(aapl.marketConditionName, 'Trend Following', 'marketConditionName is "Trend Following"');

  const nvda = d.data.find((r: Record<string, unknown>) => r.symbol === 'NVDA') as Record<string, unknown>;
  assertNotNull(nvda, 'NVDA row found');
  assertEqual(nvda.accountName, 'Interactive Brokers', 'NVDA accountName is "Interactive Brokers"');
  assertEqual(nvda.accountCurrency, 'EUR', 'NVDA accountCurrency is "EUR"');
  assertEqual(nvda.sectorName, null, 'NVDA sectorName is null when sectorId is null');
  assertEqual(nvda.marketConditionName, null, 'NVDA marketConditionName is null when marketConditionId is null');
}

// ── 33. GET: Account_performance.nav is authoritative equity source ──

console.log('\n33. GET uses account_performance.nav as primary equity source:');
{
  cleanup();
  // Account with startingBalance 10000, rollforward 20000, but NAV 25000
  const acc = seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  seedRollforward({ accountId: 'test-account-id', endingEquity: 20000 });

  // Insert account_performance row with NAV higher than both
  const perfId = randomUUID();
  const now = new Date().toISOString();
  const stmt = sqlite.prepare(`
    INSERT INTO account_performance (id, account_id, computed_as_of, net_cash, nav, marked_positions, realized_pnl, unrealized_pnl, total_pnl, realized_fees, gross_exposure, net_exposure, warnings, positions_json, rebuild_count, last_rebuilt_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(perfId, 'test-account-id', now, '0', '25000', '0', '0', '0', '0', '0', '0', '0', '[]', '[]', 0, now);

  // Open trade with a risk snapshot
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open', currentPrice: 110 });
  const tId = trade.id as string;
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 100, fees: 0 });
  const rsId = randomUUID();
  db.insert(schema.tradeRiskSnapshots).values({ id: rsId, tradeId: tId, initialRiskAmount: 1000, accountEquityAtOpen: 10000 }).run();

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[] };
  assertEqual(d.data.length, 1, '1 trade returned');

  const row = d.data[0] as Record<string, unknown>;
  const m = row.metrics as Record<string, unknown>;
  const risk = m.risk as Record<string, unknown>;

  // With NAV=25000, riskToAccount = 1000/25000 = 0.04
  assertNotNull(risk.riskToAccount, 'riskToAccount is not null (NAV was used)');
  assertApprox(risk.riskToAccount as number, 0.04, 0.01, 'riskToAccount ≈ 0.04 (1000/25000) using account_performance.nav');
}

// ── 34. GET: Falls back to rollforward when no account_performance row exists ──

console.log('\n34. GET falls back to rollforward when no account_performance row exists:');
{
  cleanup();
  const acc = seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  seedRollforward({ accountId: 'test-account-id', endingEquity: 20000 });
  // No account_performance row — cascade falls through to rollforward.endingEquity

  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open', currentPrice: 110 });
  const tId = trade.id as string;
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 100, fees: 0 });
  const rsId = randomUUID();
  db.insert(schema.tradeRiskSnapshots).values({ id: rsId, tradeId: tId, initialRiskAmount: 1000, accountEquityAtOpen: 10000 }).run();

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[] };

  const row = d.data[0] as Record<string, unknown>;
  const m = row.metrics as Record<string, unknown>;
  const risk = m.risk as Record<string, unknown>;

  // No account_performance → falls back to rollforward.endingEquity=20000 → riskToAccount = 1000/20000 = 0.05
  assertApprox(risk.riskToAccount as number, 0.05, 0.01, 'riskToAccount ≈ 0.05 (1000/20000) using rollforward fallback');
}

// ── 35. GET: Falls back to startingBalance when no performance or rollforward ──

console.log('\n35. GET falls back to account.startingBalance when no performance/rollforward:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 50000 });
  // No account_performance row, no rollforward row

  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open', currentPrice: 110 });
  const tId = trade.id as string;
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 100, fees: 0 });
  const rsId = randomUUID();
  db.insert(schema.tradeRiskSnapshots).values({ id: rsId, tradeId: tId, initialRiskAmount: 1000, accountEquityAtOpen: 50000 }).run();

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[] };

  const row = d.data[0] as Record<string, unknown>;
  const m = row.metrics as Record<string, unknown>;
  const risk = m.risk as Record<string, unknown>;

  // No NAV, no rollforward → account.startingBalance=50000 → riskToAccount = 1000/50000 = 0.02
  assertApprox(risk.riskToAccount as number, 0.02, 0.01, 'riskToAccount ≈ 0.02 (1000/50000) using startingBalance fallback');
}

// ── 36. S02 T01: Scale-in totals use stored initialStopPrice ────────

console.log('\n36. S02 T01: Scale-in open risk — totals.portfolioHeatAmount equals sum of row-level openRisk (stored initialStopPrice):');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 25000 });
  seedRollforward({ accountId: 'test-account-id', endingEquity: 25000 });

  // Scale-in trade: 100 @ 100, then add 100 @ 97 → total entry 200 shares, avg cost 98.5.
  // Risk snapshot recorded at first execution: initialStopPrice = 95, initialRiskAmount = 500
  // (100 shares × $5/share at snapshot time — the amount does NOT rescale with the add).
  const trade = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open', currentPrice: 110 });
  const tId = trade.id as string;
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-05T14:30:00.000Z' });
  seedExecution({ tradeId: tId, action: 'buy', quantity: 100, price: 97, fees: 0, executedAt: '2026-01-06T14:30:00.000Z' });
  db.insert(schema.tradeRiskSnapshots).values({
    id: randomUUID(),
    tradeId: tId,
    initialEntryPrice: 100,
    initialStopPrice: 95,
    initialRiskAmount: 500,
    accountEquityAtOpen: 25000,
  }).run();

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[]; totals: Record<string, number> };

  // Row-level open risk: openAvgCost = (100×100 + 97×100)/200 = 98.5, activeStop = stored 95.
  // openRisk = (98.5 − 95) × 200 = 700.
  // Without the stored stop the fallback would derive activeStop = 98.5 − 500/200 = 96 → 500.
  const row = d.data[0] as Record<string, unknown>;
  const rowRisk = ((row.metrics as { risk: { openRisk: number | null } }).risk).openRisk;
  assertApprox(rowRisk as number, 700, 0.01, 'row-level openRisk uses stored initialStopPrice: (98.5-95)*200 = 700');

  const rowOpenRiskSum = d.data.reduce(
    (s, r) => s + (((r.metrics as { risk: { openRisk: number | null } }).risk).openRisk ?? 0),
    0,
  );
  assertApprox(rowOpenRiskSum, 700, 0.01, 'sum of row-level openRisk = 700');

  // Totals aggregation recomputes metrics for the FULL dataset independently of the page —
  // it must use the same stored initialStopPrice so totals agree with the rows.
  assertEqual(d.totals.totalOpenRisk, rowOpenRiskSum, 'totals.totalOpenRisk == sum of row-level openRisk');
  assertEqual(d.totals.portfolioHeatAmount, rowOpenRiskSum, 'totals.portfolioHeatAmount == sum of row-level openRisk (stored stop, not initialRiskAmount fallback)');
  assertApprox(d.totals.portfolioHeatAmount as number, 700, 0.01, 'portfolioHeatAmount = 700 (stored-stop value, not 500 fallback)');
}

// ── 37. S02 T02: NAV pagination independence ────────────────────────

console.log('\n37. S02 T02: totals.portfolioHeatPct identical on page=1 and page=2 for multi-account datasets (full-dataset nav fetch):');
{
  cleanup();
  // Three accounts, each with account_performance.nav DIFFERENT from their
  // rollforward fallback (so a page missing the account would use a different
  // equity and shift the portfolioHeatPct denominator). Note: seedAccount with a
  // custom id returns undefined (helper re-selects by its own UUID), so subsequent
  // calls use the literal ids.
  seedAccount({ id: 'navp-acc-a', name: 'Nav A', startingBalance: 80000 });
  seedRollforward({ accountId: 'navp-acc-a', endingEquity: 70000 });
  seedAccount({ id: 'navp-acc-b', name: 'Nav B', startingBalance: 30000 });
  seedRollforward({ accountId: 'navp-acc-b', endingEquity: 40000 });
  seedAccount({ id: 'navp-acc-c', name: 'Nav C', startingBalance: 15000 });
  seedRollforward({ accountId: 'navp-acc-c', endingEquity: 20000 });

  const insertPerf = (accountId: string, nav: string) => {
    const perfId = randomUUID();
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO account_performance (id, account_id, computed_as_of, net_cash, nav, marked_positions, realized_pnl, unrealized_pnl, total_pnl, realized_fees, gross_exposure, net_exposure, warnings, positions_json, rebuild_count, last_rebuilt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(perfId, accountId, now, '0', nav, '0', '0', '0', '0', '0', '0', '0', '[]', '[]', 0, now);
  };
  insertPerf('navp-acc-a', '100000');
  insertPerf('navp-acc-b', '50000');
  insertPerf('navp-acc-c', '25000');

  // Three open trades across the three accounts. Distinct createdAt/openedAt so
  // page 1 (limit=2, newest first) shows acc-c and acc-b, page 2 shows only acc-a.
  // → the full dataset spans accounts that do NOT all appear on page 1.
  const tradeA = seedTrade({ accountId: 'navp-acc-a', symbol: 'AAPL', direction: 'long', status: 'open', currentPrice: 110, createdAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-01T10:00:00.000Z', openedAt: '2026-02-01T10:00:00.000Z' });
  seedExecution({ tradeId: tradeA.id as string, action: 'buy', quantity: 100, price: 100, fees: 0 });
  db.insert(schema.tradeRiskSnapshots).values({ id: randomUUID(), tradeId: tradeA.id as string, initialRiskAmount: 1000, accountEquityAtOpen: 100000 }).run();

  const tradeB = seedTrade({ accountId: 'navp-acc-b', symbol: 'MSFT', direction: 'long', status: 'open', currentPrice: 210, createdAt: '2026-02-02T10:00:00.000Z', updatedAt: '2026-02-02T10:00:00.000Z', openedAt: '2026-02-02T10:00:00.000Z' });
  seedExecution({ tradeId: tradeB.id as string, action: 'buy', quantity: 100, price: 200, fees: 0 });
  db.insert(schema.tradeRiskSnapshots).values({ id: randomUUID(), tradeId: tradeB.id as string, initialRiskAmount: 1000, accountEquityAtOpen: 50000 }).run();

  const tradeC = seedTrade({ accountId: 'navp-acc-c', symbol: 'TSLA', direction: 'long', status: 'open', currentPrice: 310, createdAt: '2026-02-03T10:00:00.000Z', updatedAt: '2026-02-03T10:00:00.000Z', openedAt: '2026-02-03T10:00:00.000Z' });
  seedExecution({ tradeId: tradeC.id as string, action: 'buy', quantity: 50, price: 300, fees: 0 });
  db.insert(schema.tradeRiskSnapshots).values({ id: randomUUID(), tradeId: tradeC.id as string, initialRiskAmount: 500, accountEquityAtOpen: 25000 }).run();

  const page1 = doGetTrades({ status: 'open', page: 1, limit: 2 });
  assert(page1.status === 200, 'page=1 returns 200');
  const p1 = page1.data as { data: Record<string, unknown>[]; totals: Record<string, number> };
  assertEqual(p1.data.length, 2, 'page 1 has 2 rows (acc-c TSLA, acc-b MSFT)');
  assertEqual(p1.data.map((r) => r.symbol).sort().join(','), 'MSFT,TSLA', 'page 1 rows are TSLA + MSFT (newest first)');

  const page2 = doGetTrades({ status: 'open', page: 2, limit: 2 });
  assert(page2.status === 200, 'page=2 returns 200');
  const p2 = page2.data as { data: Record<string, unknown>[]; totals: Record<string, number> };
  assertEqual(p2.data.length, 1, 'page 2 has 1 row (acc-a AAPL)');
  assertEqual(p2.data[0].symbol, 'AAPL', 'page 2 row is AAPL (acc-a only — not on page 1)');

  // Full-dataset totals: open risk = 1000 (A) + 1000 (B) + 500 (C) = 2500.
  // Equity denominator must use NAV for ALL accounts (100000 + 50000 + 25000 = 175000)
  // regardless of which accounts appear on the requested page.
  // pct = 2500 / 175000 ≈ 0.0142857.
  assertEqual(p1.totals.totalOpenRisk, 2500, 'page1 totals.totalOpenRisk = 2500 (full dataset)');
  assertEqual(p2.totals.totalOpenRisk, 2500, 'page2 totals.totalOpenRisk = 2500 (full dataset)');
  assertEqual(p1.totals.portfolioHeatAmount, 2500, 'page1 totals.portfolioHeatAmount = 2500');
  assertEqual(p2.totals.portfolioHeatAmount, 2500, 'page2 totals.portfolioHeatAmount = 2500');

  // THE regression assertion: portfolioHeatPct identical on both pages.
  // Pre-fix (nav map keyed by paginated accounts): page1 denominator = 25000+50000+70000
  // = 145000 → 0.01724; page2 denominator = 100000+40000+20000 = 160000 → 0.01563.
  assertApprox(p1.totals.portfolioHeatPct as number, p2.totals.portfolioHeatPct as number, 1e-9, 'portfolioHeatPct identical across pages (nav fetched for full dataset)');
  assertApprox(p1.totals.portfolioHeatPct as number, 2500 / 175000, 0.0001, 'portfolioHeatPct = 2500/175000 ≈ 0.01429 (all three NAVs in denominator)');
  assertApprox(p2.totals.portfolioHeatPct as number, 2500 / 175000, 0.0001, 'page2 portfolioHeatPct = 2500/175000 ≈ 0.01429 (all three NAVs in denominator)');
}

// ── 38. M013/S01 T01: mixed priced/unpriced open positions → null aggregate ──

console.log('\n38. M013/S01: one priced + one unpriced open position → totals unrealized null + unpricedOpenPositions=1:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });

  // Closed long: realized 992 (P&L 1000 - fees 8). Realized totals must stay numeric.
  const closed = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'closed' });
  seedExecution({ tradeId: closed.id as string, action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution({ tradeId: closed.id as string, action: 'sell', quantity: 100, price: 110, fees: 3 });

  // Open long WITH a market mark: gross unrealized = (110-100)*100 = 1000, net = 998.
  const priced = seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', direction: 'long', status: 'open', currentPrice: 110 });
  seedExecution({ tradeId: priced.id as string, action: 'buy', quantity: 100, price: 100, fees: 2 });

  // Open long WITHOUT a market mark: unrealized is null (cannot be priced).
  const unpriced = seedTrade({ accountId: 'test-account-id', symbol: 'TSLA', direction: 'long', status: 'open' });
  seedExecution({ tradeId: unpriced.id as string, action: 'buy', quantity: 100, price: 100, fees: 2 });

  const result = doGetTrades();
  assert(result.status === 200, 'returns 200');
  const d = result.data as { data: Record<string, unknown>[]; totals: Record<string, number | null> };

  // The P0 fix: aggregate unrealized P&L must be null — NEVER a partial sum (1000) or 0.
  assertEqual(d.totals.grossUnrealizedPnl, null, 'totals.grossUnrealizedPnl = null (one unpriced open position)');
  assertEqual(d.totals.netUnrealizedPnl, null, 'totals.netUnrealizedPnl = null (one unpriced open position)');
  assertEqual(d.totals.unpricedOpenPositions, 1, 'totals.unpricedOpenPositions = 1 (TSLA lacks a mark)');

  // Realized aggregates remain numeric — only unrealized completeness is affected.
  assertEqual(d.totals.grossRealizedPnl, 1000, 'totals.grossRealizedPnl = 1000 (closed trade unaffected)');
  assertEqual(d.totals.netRealizedPnl, 992, 'totals.netRealizedPnl = 992 (closed trade unaffected)');
}

// ── 39. M013/S01 T01: all open positions unpriced ──

console.log('\n39. M013/S01: all open positions unpriced → null aggregate + unpricedOpenPositions=2:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });

  const t1 = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open' });
  seedExecution({ tradeId: t1.id as string, action: 'buy', quantity: 100, price: 100, fees: 2 });
  const t2 = seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', direction: 'short', status: 'open' });
  seedExecution({ tradeId: t2.id as string, action: 'sell_short', quantity: 50, price: 200, fees: 2 });

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { totals: Record<string, number | null> };

  assertEqual(d.totals.unpricedOpenPositions, 2, 'totals.unpricedOpenPositions = 2');
  assertEqual(d.totals.grossUnrealizedPnl, null, 'totals.grossUnrealizedPnl = null');
  assertEqual(d.totals.netUnrealizedPnl, null, 'totals.netUnrealizedPnl = null');
}

// ── 40. M013/S01 T01: all open positions priced → numeric aggregate preserved ──

console.log('\n40. M013/S01: all open positions priced → numeric aggregate preserved:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });

  // Gross (110-100)*100 = 1000, net 1000 - 2 fees = 998.
  const t1 = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'open', currentPrice: 110 });
  seedExecution({ tradeId: t1.id as string, action: 'buy', quantity: 100, price: 100, fees: 2 });
  // Gross (205-200)*50 = 250, net 250 - 2 fees = 248.
  const t2 = seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', direction: 'long', status: 'open', currentPrice: 205 });
  seedExecution({ tradeId: t2.id as string, action: 'buy', quantity: 50, price: 200, fees: 2 });

  const result = doGetTrades({ status: 'open' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { totals: Record<string, number | null> };

  assertEqual(d.totals.unpricedOpenPositions, 0, 'totals.unpricedOpenPositions = 0');
  assertEqual(d.totals.grossUnrealizedPnl, 1250, 'totals.grossUnrealizedPnl = 1250 (1000 + 250)');
  assertEqual(d.totals.netUnrealizedPnl, 1246, 'totals.netUnrealizedPnl = 1246 (998 + 248)');
}


// ── 42. M013/S01 T01: closed tab totals unaffected by open unpriced positions ──

console.log('\n42. M013/S01: closed tab (status=closed) totals unaffected by unpriced open positions:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });

  // Closed long: realized 992 (P&L 1000 - fees 8).
  const closed = seedTrade({ accountId: 'test-account-id', symbol: 'AAPL', direction: 'long', status: 'closed' });
  seedExecution({ tradeId: closed.id as string, action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution({ tradeId: closed.id as string, action: 'sell', quantity: 100, price: 110, fees: 3 });

  // An open unpriced trade exists in the DB but is excluded by the status=closed filter.
  const openT = seedTrade({ accountId: 'test-account-id', symbol: 'MSFT', direction: 'long', status: 'open' });
  seedExecution({ tradeId: openT.id as string, action: 'buy', quantity: 100, price: 100, fees: 2 });

  const result = doGetTrades({ status: 'closed' });
  assert(result.status === 200, 'returns 200');
  const d = result.data as { totals: Record<string, number | null> };

  // Closed tab: no open positions in the filtered dataset → numeric unrealized (0) preserved.
  assertEqual(d.totals.unpricedOpenPositions, 0, 'totals.unpricedOpenPositions = 0 on closed tab');
  assertEqual(d.totals.grossUnrealizedPnl, 0, 'totals.grossUnrealizedPnl = 0 (numeric, unchanged)');
  assertEqual(d.totals.netUnrealizedPnl, 0, 'totals.netUnrealizedPnl = 0 (numeric, unchanged)');
  assertEqual(d.totals.netRealizedPnl, 992, 'totals.netRealizedPnl = 992 (realized totals unchanged)');
}

// ── 43. GET: Default listing excludes soft-deleted (scratched) trades ──

console.log('\n43. GET default listing excludes deleted trades (status=deleted opts in):');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const planned = seedTrade({ accountId: 'test-account-id', status: 'planned' });
  const deleted = seedTrade({ accountId: 'test-account-id', status: 'deleted' });
  const open = seedTrade({ accountId: 'test-account-id', status: 'open' });

  // Default (no status param): deleted trade must not leak into the listing
  const r1 = doGetTrades({});
  assert(r1.status === 200, 'returns 200 for unfiltered listing');
  const d1 = r1.data as { total: number; data: Array<{ id: string; status: string }> };
  assertEqual(d1.total, 2, 'default total excludes the deleted trade (2 of 3 rows)');
  assert(!d1.data.some((t) => t.id === (deleted.id as string)), 'deleted trade absent from unfiltered rows');
  assert(d1.data.some((t) => t.id === (planned.id as string)), 'planned trade present in unfiltered rows');
  assert(d1.data.some((t) => t.id === (open.id as string)), 'open trade present in unfiltered rows');

  // Explicit ?status=deleted: deleted trades are returned (opt-in, Deleted tab)
  const r2 = doGetTrades({ status: 'deleted' });
  assert(r2.status === 200, 'returns 200 for status=deleted');
  const d2 = r2.data as { total: number; data: Array<{ id: string; status: string }> };
  assertEqual(d2.total, 1, 'status=deleted total includes the scratched trade');
  assertEqual(d2.data[0]?.id, deleted.id, 'scratched trade returned via status=deleted');
  assertEqual(d2.data[0]?.status, 'deleted', 'scratched row carries status deleted');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
