/**
 * Dashboard V2 view-model: ledger-derived aggregation boundary.
 *
 * Consumes the S04 performance projection and S05 reconciliation report,
 * queries valuation mark completeness and journal attribution, and
 * assembles a unified cutover-integrity state for the root dashboard.
 *
 * Pure aggregation logic on top of SQL queries — no mutations, no
 * random IDs, no side effects.  Every call with the same data
 * produces identical output.  Missing or stale marks are represented
 * as null rather than zero.
 *
 * @module accounting/dashboard-v2
 */

import Database from 'better-sqlite3';
import { fromMicros, toMicros, normalizeDecimal, sumDecimals } from './decimal';
import type { CanonicalDecimal } from './types';
import {
  accountExists,
  findAccountPerformance,
  listLatestValuationMarks,
  listAccountPositions,
  findInstrumentById,
} from '../../db/accounting-repository';
import { computeReconciliation } from './reconciliation';
import type { ReconciliationReport } from './reconciliation';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** High-level integrity status of the accounting cutover. */
export type IntegrityStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

/** Summarised position valuation for the dashboard (no lot detail). */
export interface DashboardPositionSummary {
  instrumentId: string;
  symbol: string;
  direction: string | null;
  quantity: string;
  averageCost: string;
  markStatus: string;
  markPrice: string | null;
  markedValue: string | null;
  unrealizedPnl: string | null;
  markTimestamp: string | null;
  markAgeMinutes: number | null;
}

/** Journal attribution counts. */
export interface JournalAttribution {
  /** True when at least one accounting execution has a linked journal trade. */
  hasJournalTrades: boolean;
  /** Number of accounting executions linked to journal trades. */
  journalExecutionCount: number;
  /** Number of accounting executions without a journal trade link. */
  accountOnlyExecutionCount: number;
}

/** Valuation completeness summary. */
export interface ValuationCompleteness {
  /** Total number of positions with open quantity. */
  positionsTotal: number;
  /** Count of positions with a fresh mark. */
  fresh: number;
  /** Count of positions with a stale mark. */
  stale: number;
  /** Count of positions with no mark at all. */
  missing: number;
}

/** Reconciliation summary for the dashboard. */
export interface DashboardReconciliationSummary {
  /** Whether the account is eligible for cutover. */
  eligible: boolean;
  /** Reasons for cutover refusal, if ineligible. */
  refusalReasons: string[];
  /** Per-dimension comparisons, or null if no reconciliation report exists. */
  comparisons: Array<{
    key: string;
    description: string;
    legacyValue: string;
    accountingValue: string;
    difference: string;
    classification: string;
    tolerance: string | null;
    detail: string | null;
  }> | null;
  /** Aggregate counts, or null if no reconciliation report exists. */
  totals: {
    comparisons: number;
    matching: number;
    explained: number;
    anomalies: number;
    unexplained: number;
  } | null;
}

/** Risk summary derived from open positions and journal trades. */
export interface RiskSummary {
  /** Sum of unrealizedPnl across all open positions (canonical decimal). */
  openPnl: string;
  /** Sum of initialRiskAmount from open journal trades (canonical decimal). */
  openRisk: string;
  /** openRisk / NAV * 100 as a percentage (canonical decimal), or null when NAV is zero. */
  portfolioHeat: string | null;
  /** Number of open trades without a planned_stop. */
  missingStops: number;
  /** Number of open trades with a planned_stop set. */
  positionsWithStop: number;
}

export type DashboardV2Field = keyof Omit<DashboardV2Response, 'computedAt'>;

/**
 * All valid dashboard V2 field names, in their canonical order.
 * Used for fields-parameter validation and response filtering.
 */
export const ALL_DASHBOARD_V2_FIELDS: readonly DashboardV2Field[] = [
  'account',
  'metrics',
  'valuation',
  'journalAttribution',
  'reconciliation',
  'riskSummary',
  'integrity',
] as const;

/** Dashboard V2 aggregation for one account. */
export interface DashboardV2Response {
  account: {
    id: string;
    name: string;
    currency: string;
  };
  metrics: {
    cash: string;
    nav: string;
    markedPositions: string;
    realizedPnl: string;
    unrealizedPnl: string;
    totalPnl: string;
    realizedFees: string;
    grossExposure: string;
    netExposure: string;
    drawdown: string | null;
    drawdownPct: string | null;
    modifiedDietzReturn: string | null;
    twr: string | null;
  };
  valuation: ValuationCompleteness & {
    /** Per-position valuation detail. */
    positions: DashboardPositionSummary[];
  };
  journalAttribution: JournalAttribution;
  reconciliation: DashboardReconciliationSummary;
  riskSummary: RiskSummary;
  integrity: {
    /** Overall cutover integrity status. */
    status: IntegrityStatus;
    /** Actionable warnings from performance and valuation. */
    warnings: string[];
  };
  /** ISO-8601 timestamp of when this aggregation was computed. */
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Default freshness threshold in minutes (24 hours). */
const DEFAULT_FRESHNESS_THRESHOLD_MINUTES = 1440;

// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine mark freshness status.
 *
 * - 'missing': no mark exists for this instrument
 * - 'fresh': mark exists and its age is <= freshnessThresholdMinutes
 * - 'stale': mark exists but its age exceeds freshnessThresholdMinutes
 */
function classifyMarkStatus(
  markTimestamp: string | null,
  markAgeMinutes: number | null,
  computedAt: Date,
  freshnessThresholdMinutes: number,
): 'fresh' | 'stale' | 'missing' {
  if (!markTimestamp) return 'missing';

  // If markAgeMinutes was pre-computed, use it
  if (markAgeMinutes !== null) {
    return markAgeMinutes <= freshnessThresholdMinutes ? 'fresh' : 'stale';
  }

  // Fall back to computing age from timestamps
  try {
    const markTime = new Date(markTimestamp).getTime();
    const now = computedAt.getTime();
    const ageMs = now - markTime;
    if (ageMs < 0) return 'fresh'; // Future timestamps are treated as fresh
    const ageMinutes = ageMs / 60_000;
    return ageMinutes <= freshnessThresholdMinutes ? 'fresh' : 'stale';
  } catch {
    return 'missing';
  }
}

/**
 * Compute the integrity status based on performance warnings and valuation
 * completeness. Reconciliation eligibility is no longer checked here —
 * legacy cutover is complete.
 */
function deriveIntegrityStatus(
  performanceWarnings: string[],
  valuationCompleteness: ValuationCompleteness,
): { status: IntegrityStatus; warnings: string[] } {
  const warnings: string[] = [];
  warnings.push(...performanceWarnings);

  // Check for missing valuation marks
  if (valuationCompleteness.missing > 0) {
    warnings.push(
      `${valuationCompleteness.missing} position(s) have no valuation mark.`,
    );
  }

  // Check for stale marks
  if (valuationCompleteness.stale > 0) {
    warnings.push(
      `${valuationCompleteness.stale} position(s) have stale valuation marks.`,
    );
  }

  let status: IntegrityStatus;
  if (warnings.length === 0) {
    status = 'healthy';
  } else if (valuationCompleteness.missing > 0) {
    status = 'critical';
  } else if (valuationCompleteness.stale > 0 || performanceWarnings.length > 0) {
    status = 'warning';
  } else {
    status = 'warning';
  }

  return { status, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Symbol Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve instrument symbols for dashboard positions.
 * Uses an in-memory cache to avoid redundant lookups.
 */
function resolvePositionSymbols(
  sqlite: Database.Database,
  positions: Array<{ instrument_id: string }>,
): Map<string, string> {
  const cache = new Map<string, string>();
  for (const pos of positions) {
    if (cache.has(pos.instrument_id)) continue;
    const instr = findInstrumentById(sqlite, pos.instrument_id);
    cache.set(pos.instrument_id, instr?.symbol ?? 'UNKNOWN');
  }
  return cache;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Aggregation Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the Dashboard V2 aggregation for a single account.
 *
 * Queries the S04 performance projection, S05 reconciliation report, latest
 * valuation marks, open positions, and journal attribution data to assemble
 * a complete cutover-integrity view-model.
 *
 * @param sqlite                        - Raw better-sqlite3 Database handle.
 * @param accountId                     - The account to aggregate.
 * @param options.freshnessThresholdMinutes - Max age in minutes for a fresh
 *                                          mark (default 1440 = 24h).
 * @param options.fields                   - Optional subset of fields to return.
 *                                          When specified, only those sections
 *                                          plus computedAt are returned.
 *                                          When omitted, the full response
 *                                          is returned (backward compatible).
 * @returns                               - DashboardV2Response, or undefined
 *                                         if the account does not exist.
 */
export function computeDashboardV2(
  sqlite: Database.Database,
  accountId: string,
  options?: {
    freshnessThresholdMinutes?: number;
    fields?: DashboardV2Field[];
  },
): DashboardV2Response | undefined {
  const computedAt = new Date().toISOString();

  // 1. Verify account exists
  if (!accountExists(sqlite, accountId)) {
    return undefined;
  }

  const freshnessThreshold = options?.freshnessThresholdMinutes ?? DEFAULT_FRESHNESS_THRESHOLD_MINUTES;

  // ── Account info ──────────────────────────────────────────────────────
  const accountRow = sqlite
    .prepare('SELECT id, name, currency FROM accounts WHERE id = ?')
    .get(accountId) as { id: string; name: string; currency: string } | undefined;

  if (!accountRow) {
    return undefined; // Should not happen after accountExists check
  }

  // ── S04: Performance projection ──────────────────────────────────────
  const performance = findAccountPerformance(sqlite, accountId);
  let perfWarnings: string[] = [];
  let rawPositions: Array<Record<string, unknown>> = [];
  if (performance) {
    try {
      perfWarnings = JSON.parse(performance.warnings);
    } catch {
      perfWarnings = [];
    }
    try {
      rawPositions = JSON.parse(performance.positions_json);
    } catch {
      rawPositions = [];
    }
  }

  // ── S05: Reconciliation report ───────────────────────────────────────
  let reconciliationReport: ReconciliationReport | undefined;
  try {
    reconciliationReport = computeReconciliation(sqlite, accountId);
  } catch {
    // Reconciliation may fail if no migration run exists — that's expected
    reconciliationReport = undefined;
  }

  // ── Valuation completeness ───────────────────────────────────────────
  const openPositions = listAccountPositions(sqlite, accountId);
  const latestMarks = listLatestValuationMarks(sqlite, accountId);
  const positionsWithQuantity = openPositions.filter(
    (p) => p.quantity !== '0.00',
  );

  // Build a map of latest mark by instrument
  const markByInstrument = new Map<string, (typeof latestMarks)[number]>();
  for (const mark of latestMarks) {
    markByInstrument.set(mark.instrument_id, mark);
  }

  // Compute the current time for mark age calculations
  const now = new Date();
  const computedDate = now;

  // Count mark statuses
  let freshCount = 0;
  let staleCount = 0;
  let missingCount = 0;

  const dashboardPositions: DashboardPositionSummary[] = [];
  const symbolCache = resolvePositionSymbols(sqlite, openPositions);

  for (const pos of positionsWithQuantity) {
    const mark = markByInstrument.get(pos.instrument_id);

    let markStatus: 'fresh' | 'stale' | 'missing';
    let markPrice: string | null = null;
    let markedValue: string | null = null;
    let unrealizedPnl: string | null = null;
    let markTimestamp: string | null = null;
    let markAgeMinutes: number | null = null;

    if (!mark) {
      markStatus = 'missing';
      missingCount++;
    } else {
      // Compute mark age
      try {
        const markTime = new Date(mark.mark_timestamp).getTime();
        const ageMs = computedDate.getTime() - markTime;
        markAgeMinutes = Math.round(ageMs / 60_000);
      } catch {
        markAgeMinutes = null;
      }

      markStatus = classifyMarkStatus(mark.mark_timestamp, markAgeMinutes, computedDate, freshnessThreshold);

      if (markStatus === 'fresh') freshCount++;
      else staleCount++;

      markPrice = mark.price;

      // Compute marked value = quantity × price
      const priceMicros = mark.price_micros;
      try {
        const qtyMicros = toMicros(pos.quantity);
        const valueMicros = Number(
          (BigInt(qtyMicros) * BigInt(priceMicros)) / BigInt(1_000_000),
        );
        markedValue = fromMicros(valueMicros);
      } catch {
        markedValue = null;
      }

      // Compute unrealized P&L = (markPrice - averageCost) × quantity
      try {
        const avgCostMicros = toMicros(pos.average_cost);
        const qtyMicros = toMicros(pos.quantity);
        const priceDiffMicros = priceMicros - avgCostMicros;
        const upnlMicros = Number(
          (BigInt(priceDiffMicros) * BigInt(qtyMicros)) / BigInt(1_000_000),
        );
        unrealizedPnl = fromMicros(upnlMicros);
      } catch {
        unrealizedPnl = null;
      }

      markTimestamp = mark.mark_timestamp;
    }

    dashboardPositions.push({
      instrumentId: pos.instrument_id,
      symbol: symbolCache.get(pos.instrument_id) ?? 'UNKNOWN',
      direction: pos.direction,
      quantity: pos.quantity,
      averageCost: pos.average_cost,
      markStatus,
      markPrice,
      markedValue,
      unrealizedPnl,
      markTimestamp,
      markAgeMinutes,
    });
  }

  const valuationCompleteness: ValuationCompleteness = {
    positionsTotal: positionsWithQuantity.length,
    fresh: freshCount,
    stale: staleCount,
    missing: missingCount,
  };

  // ── Journal attribution ─────────────────────────────────────────────
  const journalCounts = sqlite
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN journal_trade_id IS NOT NULL THEN 1 ELSE 0 END) AS with_journal,
         SUM(CASE WHEN journal_trade_id IS NULL THEN 1 ELSE 0 END) AS without_journal
       FROM accounting_executions
       WHERE account_id = ?`,
    )
    .get(accountId) as {
    total: number;
    with_journal: number;
    without_journal: number;
  };

  const journalAttribution: JournalAttribution = {
    hasJournalTrades: (journalCounts?.with_journal ?? 0) > 0,
    journalExecutionCount: journalCounts?.with_journal ?? 0,
    accountOnlyExecutionCount: journalCounts?.without_journal ?? 0,
  };

  // ── Reconciliation summary ──────────────────────────────────────────
  const reconciliationSummary: DashboardReconciliationSummary = reconciliationReport
    ? {
        eligible: reconciliationReport.cutoverEligible,
        refusalReasons: reconciliationReport.cutoverRefusalReasons,
        comparisons: reconciliationReport.comparisons.map((c) => ({
          key: c.key,
          description: c.description,
          legacyValue: c.legacyValue,
          accountingValue: c.accountingValue,
          difference: c.difference,
          classification: c.classification,
          tolerance: c.tolerance,
          detail: c.detail,
        })),
        totals: {
          comparisons: reconciliationReport.totals.comparisons,
          matching: reconciliationReport.totals.matching,
          explained: reconciliationReport.totals.explained,
          anomalies: reconciliationReport.totals.anomalies,
          unexplained: reconciliationReport.totals.unexplained,
        },
      }
    : {
        eligible: false,
        refusalReasons: [
          'No reconciliation report available. Run a migration first to compare legacy and accounting data.',
        ],
        comparisons: null,
        totals: null,
      };

  // ── Risk Summary ──────────────────────────────────────────────────
  const openPnlValues = dashboardPositions
    .map((p) => p.unrealizedPnl)
    .filter((v): v is string => v !== null);
  const openPnl = sumDecimals(openPnlValues);

  const riskRow = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN t.planned_stop IS NULL THEN 1 ELSE 0 END), 0) AS missing_stops,
         COALESCE(SUM(CASE WHEN t.planned_stop IS NOT NULL THEN 1 ELSE 0 END), 0) AS with_stop,
         COALESCE(SUM(trs.initial_risk_amount), 0) AS total_risk
       FROM trades t
       LEFT JOIN trade_risk_snapshots trs ON trs.trade_id = t.id
       WHERE t.account_id = ? AND t.status = 'open'`,
    )
    .get(accountId) as
    | { missing_stops: number; with_stop: number; total_risk: number }
    | undefined;

  const missingStops = riskRow?.missing_stops ?? 0;
  const positionsWithStop = riskRow?.with_stop ?? 0;
  const openRisk = riskRow ? normalizeDecimal(riskRow.total_risk) : '0.00';

  // Portfolio heat = openRisk / NAV * 100
  const nav = performance?.nav;
  let portfolioHeat: string | null = null;
  if (nav && nav !== '0.00') {
    const navMicros = toMicros(nav);
    const riskMicros = toMicros(openRisk);
    if (riskMicros > 0) {
      portfolioHeat = normalizeDecimal((riskMicros / navMicros) * 100);
    } else {
      portfolioHeat = '0.00';
    }
  } else if (openRisk === '0.00') {
    portfolioHeat = '0.00';
  }

  const riskSummary: RiskSummary = {
    openPnl,
    openRisk,
    portfolioHeat,
    missingStops,
    positionsWithStop,
  };

  // ── Integrity status ────────────────────────────────────────────────
  const integrity = deriveIntegrityStatus(
    perfWarnings,
    valuationCompleteness,
  );

  // ── Assemble response ───────────────────────────────────────────────
  const fullResponse: DashboardV2Response = {
    account: {
      id: accountRow.id,
      name: accountRow.name,
      currency: accountRow.currency ?? 'USD',
    },
    metrics: {
      cash: performance?.net_cash ?? '0.00',
      nav: performance?.nav ?? '0.00',
      markedPositions: performance?.marked_positions ?? '0.00',
      realizedPnl: performance?.realized_pnl ?? '0.00',
      unrealizedPnl: performance?.unrealized_pnl ?? '0.00',
      totalPnl: performance?.total_pnl ?? '0.00',
      realizedFees: performance?.realized_fees ?? '0.00',
      grossExposure: performance?.gross_exposure ?? '0.00',
      netExposure: performance?.net_exposure ?? '0.00',
      drawdown: performance?.drawdown ?? null,
      drawdownPct: performance?.drawdown_pct ?? null,
      modifiedDietzReturn: performance?.modified_dietz_return ?? null,
      twr: performance?.twr ?? null,
    },
    valuation: {
      ...valuationCompleteness,
      positions: dashboardPositions,
    },
    journalAttribution,
    reconciliation: reconciliationSummary,
    riskSummary,
    integrity,
    computedAt,
  };

  // ── Filter by fields if specified ──────────────────────────────────
  if (options?.fields && options.fields.length < ALL_DASHBOARD_V2_FIELDS.length) {
    const response = fullResponse as unknown as Record<string, unknown>;
    const filtered: Record<string, unknown> = { computedAt };
    for (const field of options.fields) {
      filtered[field] = response[field];
    }
    return filtered as unknown as DashboardV2Response;
  }

  return fullResponse;
}
