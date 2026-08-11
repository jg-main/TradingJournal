/**
 * Dashboard V2 view-model: ledger-derived aggregation boundary.
 *
 * Produces one timestamped, typed current-state snapshot for the active
 * account. The response is self-describing for data-quality diagnosis:
 * every section declares its scope and provenance, every position carries
 * mark provenance and attribution, and every price-derived aggregate
 * declares a completeness state with coverage counts. Unknown values are
 * represented as explicit null — never coerced to '0.00' — and partial
 * sums are never presented as complete.
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
  DEFAULT_FRESHNESS_POLICY_CONFIG,
  createFreshnessPolicy,
} from './freshness-policy';
import type {
  FreshnessPolicyConfig,
  MarkStatus,
  SnapshotCompletenessState,
} from './freshness-policy';
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

// Freshness classification vocabulary now lives in the central freshness
// policy library. Re-exported here so existing importers of this module keep
// working — the canonical home is ./freshness-policy.
export type {
  MarkStatus,
  SnapshotCompletenessState,
} from './freshness-policy';

/** Per-position data-source attribution: which source owns this position. */
export type PositionAttributionKind = 'journal' | 'account_only' | 'mixed';

/**
 * Provenance of one valuation mark. Lets callers diagnose data-quality
 * issues from the API response alone (source, as-of, computed-at, status).
 */
export interface MarkProvenance {
  /** Source of the mark ('user', 'market_data', ...), or null when missing. */
  source: string | null;
  /** As-of timestamp of the underlying mark (ISO-8601), or null when missing. */
  asOf: string | null;
  /** Snapshot-wide computed-at timestamp shared by every field. */
  computedAt: string;
  /** Freshness classification of the mark. */
  status: MarkStatus;
}

/**
 * Provenance of one aggregate section. The status uses the shared
 * completeness vocabulary so a caller can gate on it uniformly.
 */
export interface AggregateProvenance {
  /** Source system/table the section's values were derived from. */
  source: string;
  /** As-of timestamp of the underlying data, or null when unavailable. */
  asOf: string | null;
  /** Snapshot-wide computed-at timestamp shared by every field. */
  computedAt: string;
  /** Data-quality status of the price-derived portion of this section. */
  status: SnapshotCompletenessState;
}

/** Per-position attribution: which source produced this position's fills. */
export interface PositionAttribution {
  /** 'journal' = all fills linked to journal trades; 'account_only' = none; 'mixed' = some. */
  kind: PositionAttributionKind;
  /** Number of accounting executions contributing to this position. */
  executionCount: number;
  /** Number of distinct journal trades linked to this position's executions. */
  journalTradeCount: number;
}

/** Per-position risk state derived from open journal trades. */
export interface PositionRiskState {
  /** True when at least one open trade has a valid planned stop (> 0). */
  hasValidStop: boolean;
  /** Planned stop of the most recent open trade, or null when none is valid. */
  stopPrice: number | null;
  /**
   * Dollar risk from the current mark to the stop ((mark - stop) × qty for
   * longs, (stop - mark) × qty for shorts), or null when no mark, no valid
   * stop, or no open trade exists.
   */
  currentRiskToStop: string | null;
  /** Number of open journal trades for this instrument. */
  openTrades: number;
}

/** Scope metadata declaring what one response section represents. */
export interface SnapshotScope {
  /** Stable machine-readable scope id. */
  id: 'account_positions' | 'journal_trades' | 'period_performance';
  /** Response section this scope maps to. */
  section: string;
  /** Human-readable description of the scope. */
  description: string;
  /** Source tables the section is derived from. */
  source: string;
  /** As-of timestamp of the underlying data, or null when unavailable. */
  asOf: string | null;
}

/** Scope declaration block — no section is used as an unlabelled substitute. */
export interface SnapshotScopes {
  accountPositions: SnapshotScope;
  journalTrades: SnapshotScope;
  periodPerformance: SnapshotScope;
}

/** Summarised position valuation for the dashboard (no lot detail). */
export interface DashboardPositionSummary {
  instrumentId: string;
  symbol: string;
  direction: string | null;
  quantity: string;
  averageCost: string;
  markStatus: MarkStatus;
  markPrice: string | null;
  markedValue: string | null;
  unrealizedPnl: string | null;
  markTimestamp: string | null;
  markAgeMinutes: number | null;
  /** Which source (journal / account / mixed) produced this position. */
  attribution: PositionAttribution;
  /** Provenance of the position's latest mark. */
  markProvenance: MarkProvenance;
  /** Risk state from open journal trades on this instrument. */
  risk: PositionRiskState;
}

/** Journal attribution counts. */
export interface JournalAttribution {
  /** True when at least one accounting execution has a linked journal trade. */
  hasJournalTrades: boolean;
  /** Number of accounting executions linked to journal trades. */
  journalExecutionCount: number;
  /** Number of accounting executions without a journal trade link. */
  accountOnlyExecutionCount: number;
  /** Provenance of the attribution section. */
  provenance: AggregateProvenance;
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
  /** Completeness state of every price-derived aggregate in this snapshot. */
  state: SnapshotCompletenessState;
  /** Freshness coverage as a percentage (canonical decimal), or null when no positions. */
  coveragePct: string | null;
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
  /** Provenance of the reconciliation section. */
  provenance: AggregateProvenance;
}

/** Aggregate risk state for open positions and journal trades. */
export interface RiskSummary {
  /**
   * Sum of unrealizedPnl across all open positions. Null when any position
   * lacks a fresh mark — a partial sum is never presented as complete.
   */
  openPnl: string | null;
  /**
   * Sum of initialRiskAmount from open journal trades that have a risk
   * snapshot. Null when some open trades have no snapshot (partial data).
   */
  openRisk: string | null;
  /** openRisk / NAV * 100 as a percentage (canonical decimal), or null when NAV is zero. */
  portfolioHeat: string | null;
  /** Number of open trades without a valid planned stop. */
  missingStops: number;
  /** Number of open trades with a valid planned stop. */
  positionsWithStop: number;
  /**
   * Sum of per-position risk-to-stop. Null when any open position cannot be
   * evaluated (missing mark or missing valid stop).
   */
  openRiskToStop: string | null;
  /** Stop coverage completeness across open journal trades. */
  stopCoverage: {
    /** Number of open trades. */
    openTrades: number;
    /** Number of open trades with a valid planned stop. */
    withStop: number;
    /** Number of open trades without a valid planned stop. */
    withoutStop: number;
    /** 'complete' when every open trade has a stop (or none exist), else 'partial'. */
    state: SnapshotCompletenessState;
  };
  /** Provenance of the risk section. */
  provenance: AggregateProvenance;
}

export type DashboardV2Field = keyof Omit<
  DashboardV2Response,
  'computedAt' | 'snapshotId' | 'scopes'
>;

/**
 * All valid dashboard V2 field names, in their canonical order.
 * Used for fields-parameter validation and response filtering.
 * The snapshot envelope (snapshotId, scopes, computedAt) is always present.
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

/** Dashboard V2 current-state snapshot for one account. */
export interface DashboardV2Response {
  /**
   * Deterministic snapshot id derived from account + computed-at:
   * `snap:<accountId>:<computedAt>`. Identifies this exact snapshot.
   */
  snapshotId: string;
  account: {
    id: string;
    name: string;
    currency: string;
  };
  /** Scope metadata declaring what each section represents. */
  scopes: SnapshotScopes;
  metrics: {
    /** Null when no performance projection exists for the account. */
    cash: string | null;
    nav: string | null;
    markedPositions: string | null;
    realizedPnl: string | null;
    unrealizedPnl: string | null;
    totalPnl: string | null;
    realizedFees: string | null;
    grossExposure: string | null;
    netExposure: string | null;
    drawdown: string | null;
    drawdownPct: string | null;
    modifiedDietzReturn: string | null;
    twr: string | null;
    /** Provenance of the price-derived portion of this section. */
    provenance: AggregateProvenance;
  };
  valuation: ValuationCompleteness & {
    /** Per-position valuation detail. */
    positions: DashboardPositionSummary[];
    /** Provenance of the valuation section. */
    provenance: AggregateProvenance;
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
  /** ISO-8601 timestamp when this snapshot was computed — shared by all fields. */
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

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

/**
 * Dollar risk from a mark price to a planned stop for a position:
 * (mark - stop) × qty for longs, (stop - mark) × qty for shorts.
 * Returns null when either price is unavailable.
 */
function computeRiskToStop(
  direction: string | null,
  quantity: string,
  markPrice: string | null,
  stopPrice: number | null,
): string | null {
  if (markPrice === null || stopPrice === null) return null;
  try {
    const priceMicros = toMicros(markPrice);
    const stopMicros = toMicros(normalizeDecimal(stopPrice));
    const qtyMicros = toMicros(quantity);
    const diffMicros =
      direction === 'short' ? stopMicros - priceMicros : priceMicros - stopMicros;
    const riskMicros = Number(
      (BigInt(diffMicros) * BigInt(qtyMicros)) / BigInt(1_000_000),
    );
    return fromMicros(riskMicros);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Aggregation Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the Dashboard V2 current-state snapshot for a single account.
 *
 * Queries the S04 performance projection, S05 reconciliation report, latest
 * valuation marks, open positions, journal attribution, and open trades to
 * assemble one timestamped snapshot with explicit scopes, per-position
 * attribution, mark provenance, completeness state, risk state with stop
 * coverage, and explicit nullability.
 *
 * @param sqlite                        - Raw better-sqlite3 Database handle.
 * @param accountId                     - The account to aggregate.
 * @param options.freshnessThresholdMinutes - Max age in minutes for a fresh
 *                                          mark (default 1440 = 24h).
 * @param options.freshnessPolicy          - Centrally configured freshness
 *                                          policy (default threshold + per-
 *                                          scope overrides). Takes precedence
 *                                          over freshnessThresholdMinutes.
 * @param options.fields                   - Optional subset of sections to
 *                                          return. When specified, only those
 *                                          sections plus the snapshot envelope
 *                                          (snapshotId, scopes, computedAt)
 *                                          are returned. When omitted, the
 *                                          full response is returned
 *                                          (backward compatible).
 * @returns                               - DashboardV2Response, or undefined
 *                                         if the account does not exist.
 */
export function computeDashboardV2(
  sqlite: Database.Database,
  accountId: string,
  options?: {
    freshnessThresholdMinutes?: number;
    freshnessPolicy?: FreshnessPolicyConfig;
    fields?: DashboardV2Field[];
  },
): DashboardV2Response | undefined {
  const computedAt = new Date().toISOString();
  const snapshotId = `snap:${accountId}:${computedAt}`;

  // 1. Verify account exists
  if (!accountExists(sqlite, accountId)) {
    return undefined;
  }

  // Freshness policy comes from the central config — never a hard-coded
  // threshold in this module. An explicit freshnessPolicy config wins;
  // otherwise the legacy freshnessThresholdMinutes number is wrapped as a
  // default threshold; otherwise the canonical default config applies.
  const policyConfig: FreshnessPolicyConfig =
    options?.freshnessPolicy ??
    (options?.freshnessThresholdMinutes !== undefined
      ? { defaultThresholdMinutes: options.freshnessThresholdMinutes }
      : DEFAULT_FRESHNESS_POLICY_CONFIG);

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

  // ── Journal attribution by instrument (for per-position attribution) ──
  const attributionByInstrument = new Map<
    string,
    { total: number; with_journal: number; distinct_journal: number }
  >();
  const attributionRows = sqlite
    .prepare(
      `SELECT
         instrument_id,
         COUNT(*) AS total,
         SUM(CASE WHEN journal_trade_id IS NOT NULL THEN 1 ELSE 0 END) AS with_journal,
         COUNT(DISTINCT CASE WHEN journal_trade_id IS NOT NULL THEN journal_trade_id END) AS distinct_journal
       FROM accounting_executions
       WHERE account_id = ?
       GROUP BY instrument_id`,
    )
    .all(accountId) as Array<{
    instrument_id: string;
    total: number;
    with_journal: number;
    distinct_journal: number;
  }>;
  for (const row of attributionRows) {
    attributionByInstrument.set(row.instrument_id, {
      total: row.total,
      with_journal: row.with_journal,
      distinct_journal: row.distinct_journal,
    });
  }

  // ── Open journal trades by symbol (for per-position risk state) ──────
  const openTradeRows = sqlite
    .prepare(
      `SELECT id, symbol, direction, planned_stop, created_at
       FROM trades
       WHERE account_id = ? AND status = 'open'
       ORDER BY created_at ASC, id ASC`,
    )
    .all(accountId) as Array<{
    id: string;
    symbol: string;
    direction: string;
    planned_stop: number | null;
    created_at: string;
  }>;
  const openTradesBySymbol = new Map<string, typeof openTradeRows>();
  for (const trade of openTradeRows) {
    const key = trade.symbol.toUpperCase();
    const list = openTradesBySymbol.get(key) ?? [];
    list.push(trade);
    openTradesBySymbol.set(key, list);
  }

  // Compute the current time for mark age calculations
  const now = new Date();
  const computedDate = now;

  // Central freshness policy, bound to this snapshot's clock so age
  // derivation and classification are deterministic per snapshot. The
  // threshold comes from the centrally configured policy — never a
  // hard-coded value in this module.
  const freshnessPolicy = createFreshnessPolicy(policyConfig, undefined, () => computedDate);

  // Count mark statuses
  let freshCount = 0;
  let staleCount = 0;
  let missingCount = 0;
  let latestMarkTimestamp: string | null = null;

  const dashboardPositions: DashboardPositionSummary[] = [];
  const symbolCache = resolvePositionSymbols(sqlite, openPositions);

  for (const pos of positionsWithQuantity) {
    const mark = markByInstrument.get(pos.instrument_id);

    let markStatus: MarkStatus;
    let markPrice: string | null = null;
    let markedValue: string | null = null;
    let unrealizedPnl: string | null = null;
    let markTimestamp: string | null = null;
    let markAgeMinutes: number | null = null;

    if (!mark) {
      markStatus = 'missing';
      missingCount++;
    } else {
      // Compute mark age via the central policy's clock.
      markAgeMinutes = freshnessPolicy.computeMarkAgeMinutes(mark.mark_timestamp);

      markStatus = freshnessPolicy.classifyMarkStatus(mark.mark_timestamp, markAgeMinutes);

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

    // Track the latest mark timestamp across positions (for scope as-of)
    if (markTimestamp && (!latestMarkTimestamp || markTimestamp > latestMarkTimestamp)) {
      latestMarkTimestamp = markTimestamp;
    }

    // ── Per-position attribution ──────────────────────────────────────
    const attr = attributionByInstrument.get(pos.instrument_id);
    const attrTotal = attr?.total ?? 0;
    const attrWithJournal = attr?.with_journal ?? 0;
    const attributionKind: PositionAttributionKind =
      attrWithJournal > 0 && attrTotal - attrWithJournal > 0
        ? 'mixed'
        : attrWithJournal > 0
          ? 'journal'
          : 'account_only';

    // ── Per-position risk state ───────────────────────────────────────
    const symbol = symbolCache.get(pos.instrument_id) ?? 'UNKNOWN';
    const symbolTrades = openTradesBySymbol.get(symbol.toUpperCase()) ?? [];
    // Trades are ordered by created_at ASC — the last valid stop is the
    // most recent open trade that actually carries a stop.
    const validStops = symbolTrades.filter(
      (t) => t.planned_stop !== null && t.planned_stop > 0,
    );
    const hasValidStop = validStops.length > 0;
    const stopPrice = hasValidStop
      ? (validStops[validStops.length - 1].planned_stop as number)
      : null;
    const currentRiskToStop = computeRiskToStop(
      pos.direction,
      pos.quantity,
      markPrice,
      stopPrice,
    );

    dashboardPositions.push({
      instrumentId: pos.instrument_id,
      symbol,
      direction: pos.direction,
      quantity: pos.quantity,
      averageCost: pos.average_cost,
      markStatus,
      markPrice,
      markedValue,
      unrealizedPnl,
      markTimestamp,
      markAgeMinutes,
      attribution: {
        kind: attributionKind,
        executionCount: attrTotal,
        journalTradeCount: attr?.distinct_journal ?? 0,
      },
      markProvenance: {
        source: mark?.source ?? null,
        asOf: mark?.mark_timestamp ?? null,
        computedAt,
        status: markStatus,
      },
      risk: {
        hasValidStop,
        stopPrice,
        currentRiskToStop,
        openTrades: symbolTrades.length,
      },
    });
  }

  const valuationState = freshnessPolicy.classifyCompleteness(
    positionsWithQuantity.length,
    freshCount,
    staleCount,
    missingCount,
  );

  const valuationCompleteness: ValuationCompleteness = {
    positionsTotal: positionsWithQuantity.length,
    fresh: freshCount,
    stale: staleCount,
    missing: missingCount,
    state: valuationState,
    coveragePct: freshnessPolicy.computeCoveragePct(
      positionsWithQuantity.length,
      freshCount,
    ),
  };

  // ── Journal attribution ─────────────────────────────────────────────
  const journalCounts = sqlite
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN journal_trade_id IS NOT NULL THEN 1 ELSE 0 END) AS with_journal,
         SUM(CASE WHEN journal_trade_id IS NULL THEN 1 ELSE 0 END) AS without_journal,
         MAX(posted_at) AS max_posted_at
       FROM accounting_executions
       WHERE account_id = ?`,
    )
    .get(accountId) as {
    total: number;
    with_journal: number;
    without_journal: number;
    max_posted_at: string | null;
  };

  const journalAttribution: JournalAttribution = {
    hasJournalTrades: (journalCounts?.with_journal ?? 0) > 0,
    journalExecutionCount: journalCounts?.with_journal ?? 0,
    accountOnlyExecutionCount: journalCounts?.without_journal ?? 0,
    provenance: {
      source: 'accounting_executions',
      asOf: journalCounts?.max_posted_at ?? null,
      computedAt,
      status: 'complete',
    },
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
        provenance: {
          source: 'reconciliation_report',
          asOf: reconciliationReport.computedAt,
          computedAt,
          status: 'complete',
        },
      }
    : {
        eligible: false,
        refusalReasons: [
          'No reconciliation report available. Run a migration first to compare legacy and accounting data.',
        ],
        comparisons: null,
        totals: null,
        provenance: {
          source: 'reconciliation_report',
          asOf: null,
          computedAt,
          status: 'unavailable',
        },
      };

  // ── Risk Summary ──────────────────────────────────────────────────
  // openPnl: a partial sum is never presented as complete — when any
  // position lacks a mark, openPnl is null (the coverage counts and
  // completeness state explain why).
  const openPnlValues = dashboardPositions.map((p) => p.unrealizedPnl);
  const openPnl =
    dashboardPositions.length === 0
      ? '0.00'
      : openPnlValues.every((v) => v !== null)
        ? sumDecimals(openPnlValues as string[])
        : null;

  const riskRow = sqlite
    .prepare(
      `SELECT
         COUNT(*) AS open_trades,
         COALESCE(SUM(CASE WHEN t.planned_stop IS NULL OR t.planned_stop <= 0 THEN 1 ELSE 0 END), 0) AS missing_stops,
         COALESCE(SUM(CASE WHEN t.planned_stop IS NOT NULL AND t.planned_stop > 0 THEN 1 ELSE 0 END), 0) AS with_stop,
         COALESCE(SUM(trs.initial_risk_amount), 0) AS total_risk,
         COUNT(trs.id) AS with_snapshot
       FROM trades t
       LEFT JOIN trade_risk_snapshots trs ON trs.trade_id = t.id
       WHERE t.account_id = ? AND t.status = 'open'`,
    )
    .get(accountId) as
    | {
        open_trades: number;
        missing_stops: number;
        with_stop: number;
        total_risk: number;
        with_snapshot: number;
      }
    | undefined;

  const openTrades = riskRow?.open_trades ?? 0;
  const missingStops = riskRow?.missing_stops ?? 0;
  const positionsWithStop = riskRow?.with_stop ?? 0;

  // openRisk is null when some open trades have no risk snapshot (partial).
  const riskSnapshotsCovered =
    openTrades === 0 || (riskRow?.with_snapshot ?? 0) === openTrades;
  const openRisk: string | null = riskSnapshotsCovered
    ? normalizeDecimal(riskRow?.total_risk ?? 0)
    : null;

  // Portfolio heat = openRisk / NAV * 100
  const nav = performance?.nav;
  let portfolioHeat: string | null = null;
  if (openRisk !== null) {
    if (nav && nav !== '0.00' && openRisk !== '0.00') {
      const navMicros = toMicros(nav);
      const riskMicros = toMicros(openRisk);
      portfolioHeat = normalizeDecimal((riskMicros / navMicros) * 100);
    } else if (openRisk === '0.00') {
      portfolioHeat = '0.00';
    }
  }

  // Aggregate risk-to-stop: null unless every open position can be evaluated.
  const riskToStopValues = dashboardPositions.map((p) => p.risk.currentRiskToStop);
  const openRiskToStop =
    dashboardPositions.length === 0
      ? '0.00'
      : riskToStopValues.every((v) => v !== null)
        ? sumDecimals(riskToStopValues as string[])
        : null;

  const riskSummary: RiskSummary = {
    openPnl,
    openRisk,
    portfolioHeat,
    missingStops,
    positionsWithStop,
    openRiskToStop,
    stopCoverage: {
      openTrades,
      withStop: positionsWithStop,
      withoutStop: missingStops,
      state:
        openTrades === 0 || missingStops === 0 ? 'complete' : 'partial',
    },
    provenance: {
      source: 'account_positions + trades + trade_risk_snapshots',
      asOf: latestMarkTimestamp,
      computedAt,
      status: valuationState,
    },
  };

  // ── Integrity status ────────────────────────────────────────────────
  const integrity = deriveIntegrityStatus(
    perfWarnings,
    valuationCompleteness,
  );

  // ── Assemble response ───────────────────────────────────────────────
  const fullResponse: DashboardV2Response = {
    snapshotId,
    account: {
      id: accountRow.id,
      name: accountRow.name,
      currency: accountRow.currency ?? 'USD',
    },
    scopes: {
      accountPositions: {
        id: 'account_positions',
        section: 'valuation',
        description:
          'Open positions with their latest valuation marks, attribution, and per-position risk.',
        source: 'account_positions + valuation_marks',
        asOf: latestMarkTimestamp,
      },
      journalTrades: {
        id: 'journal_trades',
        section: 'journalAttribution',
        description:
          'Journal trade linkage for accounting executions, attribution, and open-trade risk.',
        source: 'accounting_executions + trades',
        asOf: journalCounts?.max_posted_at ?? null,
      },
      periodPerformance: {
        id: 'period_performance',
        section: 'metrics',
        description:
          'Period-to-date performance projection: cash, NAV, realized and unrealized P&L.',
        source: 'account_performance',
        asOf: performance?.computed_as_of ?? null,
      },
    },
    metrics: {
      cash: performance?.net_cash ?? null,
      nav: performance?.nav ?? null,
      markedPositions: performance?.marked_positions ?? null,
      realizedPnl: performance?.realized_pnl ?? null,
      unrealizedPnl: performance?.unrealized_pnl ?? null,
      totalPnl: performance?.total_pnl ?? null,
      realizedFees: performance?.realized_fees ?? null,
      grossExposure: performance?.gross_exposure ?? null,
      netExposure: performance?.net_exposure ?? null,
      drawdown: performance?.drawdown ?? null,
      drawdownPct: performance?.drawdown_pct ?? null,
      modifiedDietzReturn: performance?.modified_dietz_return ?? null,
      twr: performance?.twr ?? null,
      provenance: {
        source: 'account_performance',
        asOf: performance?.computed_as_of ?? null,
        computedAt,
        status: valuationState,
      },
    },
    valuation: {
      ...valuationCompleteness,
      positions: dashboardPositions,
      provenance: {
        source: 'account_positions + valuation_marks',
        asOf: latestMarkTimestamp,
        computedAt,
        status: valuationState,
      },
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
    const filtered: Record<string, unknown> = {
      snapshotId,
      scopes: fullResponse.scopes,
      computedAt,
    };
    for (const field of options.fields) {
      filtered[field] = response[field];
    }
    return filtered as unknown as DashboardV2Response;
  }

  return fullResponse;
}
