/**
 * Performance rebuild engine.
 *
 * Orchestrates the deterministic projection rebuild from posted ledger data,
 * account positions, FIFO results, and persisted valuation marks.
 *
 * Reads immutable data sources, computes valuations and performance metrics
 * through the T01 pure functions, and persists the merged result as a
 * single-row per-account projection.
 *
 * Every call with the same database state produces the same output.
 *
 * @module performance/performance-rebuild
 */

import Database from 'better-sqlite3';

import {
  listAccountPositions,
  listLatestValuationMarks,
  upsertAccountPerformance,
  findAccountPerformance,
  accountExists,
} from '../../db/accounting-repository';
import { rebuildOpeningCash, rebuildAccountActivity } from '../accounting/rebuild';
import { computeAccountActivity, computeRebuildCashFlow } from '../accounting/activity';
import { fromMicros } from '../accounting/decimal';
import { normalizeDecimal } from '../accounting/decimal';
import type { CanonicalDecimal } from '../accounting/types';
import { deriveValuationPosition, computeAccountValuation } from './valuation';
import { computePerformance } from './performance';
import type { CashFlow, ValuationPosition } from './types';

// ── Rebuild Result ──────────────────────────────────────────────────────

export interface PerformanceRebuildResult {
  /** Account ID that was rebuilt. */
  accountId: string;
  /** Whether the rebuild succeeded. */
  success: boolean;
  /** Rebuild attempt count for this account. */
  rebuildCount: number;
  /** ISO-8601 timestamp of when the rebuild was computed. */
  computedAt: string;
  /** Number of positions included in the valuation. */
  positionCount: number;
  /** Number of distinct instruments with marks. */
  markCount: number;
  /** Overall NAV. */
  nav: CanonicalDecimal | null;
  /** Warnings generated during rebuild. */
  warnings: string[];
  /** Error message if success is false. */
  error?: string;
}

// ── Rebuild Options ─────────────────────────────────────────────────────

export interface PerformanceRebuildOptions {
  /** Override the freshness threshold in minutes for stale marks (default: 1440). */
  freshnessThresholdMinutes?: number;
  /** If true, includes performance metrics in the projection (default: true). */
  includePerformance?: boolean;
}

// ── Internal Helpers ────────────────────────────────────────────────────

/**
 * Read the net cash balance for an account from posted ledger postings.
 *
 * Opening funding is read from debit postings for compatibility with migrated
 * and restored journals. All later cash effects, including economic trade
 * executions, are replayed from their canonical metadata.
 */
function readAccountCash(sqlite: Database.Database, accountId: string): CanonicalDecimal {
  const openingCash = rebuildOpeningCash(sqlite, accountId);
  const laterEvents = computeAccountActivity(sqlite, accountId).events
    .filter((event) => event.eventType !== 'opening_balance');
  const laterCash = computeRebuildCashFlow(laterEvents);
  return fromMicros(openingCash.totalOpeningCashMicros + laterCash.netCashImpactMicros);
}

/**
 * Read all cash flow events (deposits/withdrawals) for an account.
 */
function readCashFlows(
  sqlite: Database.Database,
  accountId: string,
): CashFlow[] {
  const activities = rebuildAccountActivity(sqlite, accountId);
  const cashFlows: CashFlow[] = [];

  for (const act of activities) {
    if (act.eventType === 'deposit') {
      // Parse payload for the amount
      let amount: CanonicalDecimal = '0.00' as CanonicalDecimal;
      if (act.payload) {
        try {
          const parsed = JSON.parse(act.payload) as { amount?: string };
          if (parsed.amount) {
            amount = normalizeDecimal(parsed.amount);
          }
        } catch {
          // ignore parse errors
        }
      }
      cashFlows.push({
        date: act.postedAt,
        amount,
        type: 'deposit',
      });
    } else if (act.eventType === 'withdrawal') {
      let amount: CanonicalDecimal = '0.00' as CanonicalDecimal;
      if (act.payload) {
        try {
          const parsed = JSON.parse(act.payload) as { amount?: string };
          if (parsed.amount) {
            amount = normalizeDecimal(parsed.amount);
          }
        } catch {
          // ignore parse errors
        }
      }
      cashFlows.push({
        date: act.postedAt,
        amount,
        type: 'withdrawal',
      });
    }
  }

  return cashFlows;
}

/**
 * Read the latest marks and positions for an account, compute PositionValuations.
 */
function buildValuationPositions(
  sqlite: Database.Database,
  accountId: string,
  nowTimestamp: string,
  freshnessThresholdMinutes: number,
): { positions: ValuationPosition[]; warnings: string[] } {
  const positions = listAccountPositions(sqlite, accountId);
  const marks = listLatestValuationMarks(sqlite, accountId);
  const warnings: string[] = [];

  // Build a map of mark by instrument_id
  const markByInstrument = new Map<string, { price: string; timestamp: string; source: string }>();
  for (const m of marks) {
    markByInstrument.set(m.instrument_id, {
      price: m.price,
      timestamp: m.mark_timestamp,
      source: m.source,
    });
  }

  const valuationPositions: ValuationPosition[] = [];

  for (const pos of positions) {
    // Realized P&L is retained on closed position projection rows, but closed
    // rows have no market value and must not request/display valuation marks.
    if (pos.quantity === '0.00') continue;

    const mark = markByInstrument.get(pos.instrument_id);

    const markInput = mark
      ? {
          price: mark.price as CanonicalDecimal,
          timestamp: mark.timestamp,
          source: mark.source as 'user' | 'market_data' | 'import' | 'system',
        }
      : null;

    const vp = deriveValuationPosition(
      {
        instrumentId: pos.instrument_id,
        direction: pos.direction as 'long' | 'short' | null,
        quantity: pos.quantity as CanonicalDecimal,
        averageCost: pos.average_cost as CanonicalDecimal,
        totalCostBasis: pos.total_cost_basis as CanonicalDecimal,
        realizedPnl: pos.realized_gross_pnl as CanonicalDecimal,
        realizedFees: pos.realized_fees as CanonicalDecimal,
        realizedNetPnl: pos.realized_net_pnl as CanonicalDecimal,
      },
      markInput,
      nowTimestamp,
      freshnessThresholdMinutes,
    );

    valuationPositions.push(vp);
  }

  return { positions: valuationPositions, warnings };
}

// ── Main Rebuild ────────────────────────────────────────────────────────

/**
 * Rebuild the performance projection for an account.
 *
 * Reads the current state of:
 * - Ledger cash (from posted ledger_postings)
 * - Account positions (from account_positions table)
 * - Latest valuation marks (from valuation_marks table)
 * - Cash flows (deposits/withdrawals from financial_events)
 *
 * Computes the full AccountValuation and PerformanceResult via T01
 * pure functions, and persists the projection via upsertAccountPerformance.
 *
 * Returns a concise rebuild result with metadata.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param accountId - The account to rebuild.
 * @param options   - Rebuild options.
 * @returns Rebuild result with status and metadata.
 */
export function rebuildAccountPerformance(
  sqlite: Database.Database,
  accountId: string,
  options?: PerformanceRebuildOptions,
): PerformanceRebuildResult {
  const nowTimestamp = new Date().toISOString();
  const warnings: string[] = [];

  // 1. Verify account exists
  if (!accountExists(sqlite, accountId)) {
    return {
      accountId,
      success: false,
      rebuildCount: 0,
      computedAt: nowTimestamp,
      positionCount: 0,
      markCount: 0,
      nav: null,
      warnings: [`Account ${accountId} not found`],
      error: `Account ${accountId} not found`,
    };
  }

  try {
    // 2. Read ledger cash
    const netCash = readAccountCash(sqlite, accountId);

    // 3. Read and derive valuation positions
    const freshnessThreshold = options?.freshnessThresholdMinutes ?? 1440;
    const { positions: valuationPositions, warnings: posWarnings } = buildValuationPositions(
      sqlite,
      accountId,
      nowTimestamp,
      freshnessThreshold,
    );
    warnings.push(...posWarnings);

    // 4. Compute account valuation using T01 pure function
    const valuation = computeAccountValuation(
      {
        accountId,
        netCash,
        positions: valuationPositions,
      },
      nowTimestamp,
    );
    warnings.push(...valuation.warnings.filter((w) => !warnings.includes(w)));

    // 5. Compute performance metrics using T01 pure function
    let modifiedDietzReturn: CanonicalDecimal | null = null;
    let twr: CanonicalDecimal | null = null;
    let highWaterMark: CanonicalDecimal | null = null;
    let drawdown: CanonicalDecimal | null = null;
    let drawdownPct: CanonicalDecimal | null = null;

    const includePerformance = options?.includePerformance ?? true;
    if (includePerformance && valuation.nav) {
      // Read cash flows for the period
      const cashFlows = readCashFlows(sqlite, accountId);

      // Try to read existing projection for historical HWM data
      const existingProj = findAccountPerformance(sqlite, accountId);
      const historicalNavs: Array<{ nav: CanonicalDecimal; date: string }> = [];

      // Build historical NAV array from existing projection and current
      if (existingProj) {
        historicalNavs.push({
          nav: existingProj.nav as CanonicalDecimal,
          date: existingProj.computed_as_of,
        });
      }

      // Compute performance (use startNav = cash only as base when no projection exists)
      const startNav = existingProj
        ? (existingProj.nav as CanonicalDecimal)
        : netCash;

      // Determine date range
      const startDate = existingProj?.computed_as_of ?? nowTimestamp;

      const perfResult = computePerformance({
        startNav,
        endNav: valuation.nav,
        cashFlows,
        startDate,
        endDate: nowTimestamp,
      });

      modifiedDietzReturn = perfResult.modifiedDietzReturn;
      twr = perfResult.twr;
      highWaterMark = perfResult.highWaterMark;
      drawdown = perfResult.drawdown;
      drawdownPct = perfResult.drawdownPct;

      warnings.push(...perfResult.warnings.filter((w) => !warnings.includes(w)));
    }

    // 6. Serialize positions to JSON for persistence
    const positionsJson = JSON.stringify(valuation.positions);

    // 7. Determine rebuild count
    const existingProj = findAccountPerformance(sqlite, accountId);
    const rebuildCount = (existingProj?.rebuild_count ?? 0) + 1;

    // 8. Persist the projection
    upsertAccountPerformance(sqlite, {
      accountId,
      computedAsOf: nowTimestamp,
      netCash: valuation.netCash,
      nav: valuation.nav,
      markedPositions: valuation.markedPositions,
      realizedPnl: valuation.realizedPnl,
      unrealizedPnl: valuation.unrealizedPnl,
      totalPnl: valuation.totalPnl,
      realizedFees: valuation.realizedFees,
      grossExposure: valuation.grossExposure,
      netExposure: valuation.netExposure,
      modifiedDietzReturn,
      twr,
      highWaterMark,
      drawdown,
      drawdownPct,
      warnings: JSON.stringify(warnings),
      positionsJson,
      rebuildCount,
      lastRebuiltAt: nowTimestamp,
    });

    return {
      accountId,
      success: true,
      rebuildCount,
      computedAt: nowTimestamp,
      positionCount: valuation.positions.length,
      markCount: valuationPositions.filter((p) => p.markStatus !== 'missing').length,
      nav: valuation.nav,
      warnings,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      accountId,
      success: false,
      rebuildCount: 0,
      computedAt: nowTimestamp,
      positionCount: 0,
      markCount: 0,
      nav: null,
      warnings: [errorMessage],
      error: errorMessage,
    };
  }
}
