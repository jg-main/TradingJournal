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
import Decimal from 'decimal.js';
import { fromMicros, toMicros, normalizeDecimal, sumDecimals, addDecimal, subtractDecimal, equalsDecimal } from './decimal';
import type { CanonicalDecimal } from './types';
import { computeTradeMetrics } from '../trade-metrics';
import type { TradeMetricsInput, TradeMetricsResult } from '../trade-metrics';
import { computeUnrealizedPnlFromMarkMicros } from '../performance/valuation';
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
  /** Effective maximum age used to classify this mark, in minutes. */
  freshnessThresholdMinutes?: number;
  /** Policy rule that supplied the effective freshness threshold. */
  freshnessResolvedFrom?: string;
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
  /**
   * Qualified display hint the UI should render in place of a bare signed
   * total for this aggregate, or null when the aggregate is safe to present
   * as-is. For price-derived aggregates this is the Open P&L completeness
   * label ('— Partial — N unpriced' / '— Unavailable — N unpriced'); it is
   * always null for aggregates with no signed-total presentation (journal
   * attribution, reconciliation).
   */
  presentationLabel: string | null;
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
  /** True when an active stop can be resolved for an open trade (> 0). */
  hasValidStop: boolean;
  /** Active stop of the most recent relevant open trade, or null when none is valid. */
  stopPrice: number | null;
  /**
   * Remaining open risk from cost basis to the active stop (R032):
   * max(0, average cost - stop) x qty for longs, or max(0, stop - average
   * cost) x qty for shorts. Null when no valid stop or open trade exists.
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
  /**
   * Journal-linked per-trade metrics via computeTradeMetrics (the Trades
   * list/detail kernel), or null when the position is account-only or its
   * linked journal trade is missing/closed (unreconciled).
   */
  journalLinkedMetrics: JournalLinkedMetrics | null;
}

/**
 * Journal-linked per-trade metrics for one position, computed via
 * computeTradeMetrics — the same kernel the Trades list/detail API uses —
 * from the linked journal trade's own executions, risk snapshot, stop
 * adjustments, and current mark. Null when the position has no resolvable
 * open linked journal trade (account-only positions always carry null).
 *
 * Values mirror the Trades list API's `metrics` field shape (numbers), so
 * a consumer can compare the dashboard's journal-linked block against GET
 * /api/trades at the same mark snapshot.
 */
export interface JournalLinkedMetrics {
  /** Remaining open quantity (metrics.size.openQuantity). */
  remainingQty: number | null;
  /** Average cost of remaining open FIFO lots (metrics.averagePrices.openAvgCost). */
  openAvgCost: number | null;
  /** Gross realized P&L before fees (metrics.realizedPnl.grossRealizedPnl). */
  grossRealizedPnl: number | null;
  /** Net realized P&L after allocated fees (metrics.realizedPnl.netRealizedPnl). */
  netRealizedPnl: number | null;
  /** Net unrealized P&L, gross minus open entry fees (metrics.unrealizedPnl.netUnrealizedPnl). */
  netUnrealizedPnl: number | null;
  /** Fees remaining on open entry lots (metrics.fees.openFees). */
  openFees: number | null;
}

/** Stable keys for the journal-linked reconciliation dimensions. */
export type JournalLinkedDimensionKey =
  | 'remainingQty'
  | 'openAvgCost'
  | 'grossRealizedPnl'
  | 'netRealizedPnl'
  | 'netUnrealizedPnl'
  | 'openFees';

/**
 * One reconciled journal-linked dimension. Declares the dashboard's
 * accounting-projected value, the Trades-side (journal kernel) value, their
 * difference, and whether the two surfaces agree at this snapshot.
 */
export interface JournalLinkedDimensionComparison {
  /** Stable dimension key. */
  key: JournalLinkedDimensionKey;
  /** Human-readable description of what is compared. */
  description: string;
  /** Dashboard (accounting projection) aggregate value, or null when not comparable. */
  dashboardValue: string | null;
  /** Trades-side (journal kernel) aggregate value, or null when not comparable. */
  tradesValue: string | null;
  /** dashboardValue - tradesValue, or null when either side is null. */
  difference: string | null;
  /**
   * 'match' when both sides are non-null and equal, 'mismatch' when both
   * sides are non-null and differ, 'unavailable' when either side is null.
   */
  status: 'match' | 'mismatch' | 'unavailable';
}

/**
 * Data-quality status of the journal-linked reconciliation section.
 *
 * - 'complete': every journal-linked position was reconciled against an open
 *   linked journal trade and every dimension comparison reports 'match'.
 * - 'partial': some journal-linked position could not be reconciled (missing
 *   or non-open linked trade) or at least one dimension comparison is not
 *   'match'. The per-dimension comparisons carry the detail.
 * - 'unavailable': no open journal trades to reconcile.
 */
export type JournalReconciliationStatus = 'complete' | 'partial' | 'unavailable';

/**
 * Journal-linked aggregate section. Sums journal-linked metrics across
 * positions (account-only positions contribute zero), declares how many open
 * journal trades were reconciled, and exposes per-dimension dashboard-vs-
 * Trades comparisons. The data-quality alert strip can gate on
 * `provenance.status` to surface reconciliation failures.
 */
export interface JournalLinkedAggregate {
  /** Number of open journal trades reconciled into this section. */
  tradeCount: number;
  /** Number of positions contributing journal-linked values (non-null journalLinkedMetrics). */
  positionCount: number;
  /** Sum of remaining open quantity across reconciled positions. */
  remainingQty: string;
  /** Quantity-weighted average cost across reconciled positions, or null when no open quantity. */
  openAvgCost: string | null;
  /** Sum of gross realized P&L across reconciled positions. */
  grossRealizedPnl: string;
  /** Sum of net realized P&L across reconciled positions. */
  netRealizedPnl: string;
  /** Sum of net unrealized P&L, or null when any reconciled position is unpriced. */
  netUnrealizedPnl: string | null;
  /** Sum of open entry fees across reconciled positions. */
  openFees: string;
  /** Per-dimension dashboard-vs-Trades reconciliation comparisons. */
  comparisons: JournalLinkedDimensionComparison[];
  /** Provenance of the journal-linked section. */
  provenance: {
    /** Source tables the section is derived from. */
    source: string;
    /** As-of timestamp of the underlying journal data, or null when unavailable. */
    asOf: string | null;
    /** Snapshot-wide computed-at timestamp shared by every field. */
    computedAt: string;
    /** Reconciliation status — the alert-strip gate for S04. */
    status: JournalReconciliationStatus;
    /** Always null — this section has no signed-total presentation. */
    presentationLabel: null;
  };
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
  /** Current open risk-to-stop / NAV * 100, or null when either is unknown. */
  portfolioHeat: string | null;
  /** Number of open account positions without a valid active stop. */
  missingStops: number;
  /** Number of open account positions with a valid active stop. */
  positionsWithStop: number;
  /**
   * Sum of per-position risk-to-stop. Null when any open position cannot be
   * evaluated (missing mark or missing valid stop).
   */
  openRiskToStop: string | null;
  /** Stop coverage completeness across the account-position universe. */
  stopCoverage: {
    /** Number of open journal trades (context only; not the denominator). */
    openTrades: number;
    /** Number of open account positions in the coverage denominator. */
    positionsTotal?: number;
    /** Number of account positions with a valid active stop. */
    withStop: number;
    /** Number of account positions without a valid active stop. */
    withoutStop: number;
    /** 'complete' when every account position has a stop (or none exist), else 'partial'. */
    state: SnapshotCompletenessState;
    /**
     * Qualified display hint: 'Incomplete — N without a valid stop' when
     * coverage is 'partial', else null. The UI renders this instead of a
     * deceptively complete Open risk / Portfolio heat numeric total.
     */
    presentationLabel: string | null;
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
  'journalLinked',
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
    /**
     * Qualified display hint for the primary Open P&L value: null when the
     * aggregate is complete (all marks fresh) or stale (every position is
     * priced and staleness is conveyed by state + provenance), else
     * '— Partial — N unpriced' / '— Unavailable — N unpriced'. The UI
     * renders this instead of a signed total so a partial sum can never
     * look like a complete total.
     */
    presentationLabel: string | null;
    /**
     * Known P&L over the freshly marked subset (M of N coverage), or null
     * when no position has a fresh mark. Subordinate display only — it is
     * never presented as Open P&L.
     */
    markedSubsetPnl: string | null;
    /** Provenance of the valuation section. */
    provenance: AggregateProvenance;
  };
  journalAttribution: JournalAttribution;
  journalLinked: JournalLinkedAggregate;
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
function resolvePositionInstruments(
  sqlite: Database.Database,
  positions: Array<{ instrument_id: string }>,
): Map<string, { symbol: string; assetClass: string | null }> {
  const cache = new Map<string, { symbol: string; assetClass: string | null }>();
  for (const pos of positions) {
    if (cache.has(pos.instrument_id)) continue;
    const instr = findInstrumentById(sqlite, pos.instrument_id);
    cache.set(pos.instrument_id, {
      symbol: instr?.symbol ?? 'UNKNOWN',
      assetClass: instr?.type ?? null,
    });
  }
  return cache;
}

/**
 * Current risk to stop for a position (R032 §6): for remaining quantity,
 * the loss between the OPEN COST BASIS and the effective active stop —
 * long max(0, averageCost − stop) × quantity, short max(0, stop −
 * averageCost) × quantity. A stop beyond breakeven yields zero risk
 * (clamped, never negative). Returns null when the average cost or stop
 * is unavailable. This mirrors the Trades kernel's openRisk so the
 * dashboard value reconciles exactly with GET /api/trades (same
 * definition, same inputs at the same snapshot).
 */
function computeRiskToStop(
  direction: string | null,
  quantity: string,
  averageCost: string | null,
  stopPrice: number | null,
): string | null {
  if (averageCost === null || stopPrice === null) return null;
  try {
    // averageCost may carry non-canonical fraction digits (legacy rows)
    // — normalize to canonical cents before toMicros.
    const costMicros = toMicros(normalizeDecimal(averageCost));
    const stopMicros = toMicros(normalizeDecimal(stopPrice));
    const qtyMicros = toMicros(quantity);
    const diffMicros =
      direction === 'short' ? stopMicros - costMicros : costMicros - stopMicros;
    // Clamp to zero — a stop beyond breakeven has no risk (R032).
    const clampedMicros = Math.max(0, diffMicros);
    const riskMicros = Number(
      (BigInt(clampedMicros) * BigInt(qtyMicros)) / BigInt(1_000_000),
    );
    return fromMicros(riskMicros);
  } catch {
    return null;
  }
}

/**
 * Build the Open P&L completeness presentation label for a price-derived
 * aggregate. Returns null when the aggregate is safe to present as a signed
 * total ('complete' — every position has a fresh mark — or 'stale', where
 * every position is priced and the staleness is conveyed by the aggregate
 * state and provenance). For 'partial' and 'unavailable' the returned label
 * is the primary value the UI must render instead of any numeric total — a
 * partial sum can never look complete.
 */
function buildValuationPresentationLabel(
  state: SnapshotCompletenessState,
  unpricedCount: number,
): string | null {
  switch (state) {
    case 'partial':
      return `— Partial — ${unpricedCount} unpriced`;
    case 'unavailable':
      return `— Unavailable — ${unpricedCount} unpriced`;
    case 'complete':
    case 'stale':
      return null;
  }
}

/**
 * Build the stop-coverage presentation hint for Open risk / Portfolio heat.
 * Non-null only when coverage is partial: 'Incomplete — N without a valid
 * stop'. The UI renders this instead of a deceptively complete numeric
 * total.
 */
function buildStopCoveragePresentationLabel(withoutStop: number): string | null {
  return withoutStop > 0
    ? `Incomplete — ${withoutStop} without a valid stop`
    : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Journal-Linked Reconciliation Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reconciliation dimensions in canonical order. Every dimension is compared
 * dashboard-vs-Trades with identical net semantics where the accounting data
 * allows (remaining quantity, FIFO average cost, gross realized P&L, net
 * realized P&L, net unrealized P&L, open entry fees).
 */
const JOURNAL_LINKED_DIMENSIONS: ReadonlyArray<{
  key: JournalLinkedDimensionKey;
  description: string;
}> = [
  { key: 'remainingQty', description: 'Remaining open quantity' },
  { key: 'openAvgCost', description: 'Average cost of remaining open quantity' },
  { key: 'grossRealizedPnl', description: 'Gross realized P&L (before fees)' },
  {
    key: 'netRealizedPnl',
    description: 'Net realized P&L (after allocated fees)',
  },
  {
    key: 'netUnrealizedPnl',
    description: 'Net unrealized P&L (market movement minus open entry fees)',
  },
  { key: 'openFees', description: 'Fees remaining on open entry lots' },
];

/** Source tables the journal-linked section is derived from. */
const JOURNAL_LINKED_SOURCE =
  'accounting_executions + trades + trade_executions + trade_risk_snapshots + trade_stop_adjustments + fifo_lots';

/**
 * Merge per-trade journal metrics (each from computeTradeMetrics — the same
 * kernel the Trades list/detail API uses) into one position-level block.
 * Multiple open trades on the same instrument contribute their sums;
 * openAvgCost is quantity-weighted across open quantities.
 */
function mergeJournalTradeMetrics(
  metricsList: TradeMetricsResult[],
): JournalLinkedMetrics {
  const remainingQty = metricsList
    .reduce((s, m) => s.plus(new Decimal(m.size.openQuantity)), new Decimal(0))
    .toNumber();

  let openAvgCost: number | null = null;
  if (remainingQty > 0) {
    const weighted = metricsList.reduce((s, m) => {
      if (m.averagePrices.openAvgCost === null || m.size.openQuantity <= 0) return s;
      return s.plus(
        new Decimal(m.averagePrices.openAvgCost).mul(new Decimal(m.size.openQuantity)),
      );
    }, new Decimal(0));
    openAvgCost = weighted.div(new Decimal(remainingQty)).toNumber();
  }

  const grossRealizedPnl = metricsList
    .reduce((s, m) => s.plus(new Decimal(m.realizedPnl.grossRealizedPnl)), new Decimal(0))
    .toNumber();
  const netRealizedPnl = metricsList
    .reduce((s, m) => s.plus(new Decimal(m.realizedPnl.netRealizedPnl)), new Decimal(0))
    .toNumber();

  const unrealizedValues = metricsList.map((m) => m.unrealizedPnl.netUnrealizedPnl);
  const netUnrealizedPnl = unrealizedValues.every((v) => v !== null)
    ? unrealizedValues
        .reduce((s, v) => s.plus(new Decimal(v as number)), new Decimal(0))
        .toNumber()
    : null;

  const openFees = metricsList
    .reduce((s, m) => s.plus(new Decimal(m.fees.openFees)), new Decimal(0))
    .toNumber();

  return { remainingQty, openAvgCost, grossRealizedPnl, netRealizedPnl, netUnrealizedPnl, openFees };
}

/**
 * Quantity-weighted average of canonical decimal values (e.g. average cost
 * weighted by remaining quantity). Returns null when total weight is zero.
 * Uses BigInt micros arithmetic so no intermediate product overflows.
 */
function computeWeightedAverageDecimal(
  values: Array<{ value: string; weight: string }>,
): string | null {
  let totalWeightMicros = BigInt(0);
  let weightedMicros = BigInt(0);
  for (const v of values) {
    // Inputs may be non-canonical (e.g. account_positions.average_cost can
    // carry many fraction digits) — normalize to canonical cents first.
    const weight = BigInt(toMicros(normalizeDecimal(v.weight)));
    totalWeightMicros += weight;
    weightedMicros += BigInt(toMicros(normalizeDecimal(v.value))) * weight;
  }
  if (totalWeightMicros === BigInt(0)) return null;
  const avgMicros = Number(weightedMicros / totalWeightMicros);
  return fromMicros(avgMicros);
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
    .prepare('SELECT id, name, currency, starting_balance FROM accounts WHERE id = ?')
    .get(accountId) as { id: string; name: string; currency: string; starting_balance: number | null } | undefined;

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

  // ── Journal-linked trades by instrument (for per-position journal metrics) ──
  // The journal-linked metrics must be computed via computeTradeMetrics — the
  // same kernel the Trades list/detail API uses — from each linked trade's own
  // executions, risk snapshot, stop adjustments, and current mark. Only OPEN
  // linked trades are reconciled (journalLinked.tradeCount = open journal
  // trades reconciled); a journal-linked position whose linked trade is
  // missing or no longer open is reported as unreconciled
  // (provenance.status = 'partial').
  const linkedTradeRows = sqlite
    .prepare(
      `SELECT DISTINCT instrument_id, journal_trade_id
       FROM accounting_executions
       WHERE account_id = ? AND journal_trade_id IS NOT NULL`,
    )
    .all(accountId) as Array<{ instrument_id: string; journal_trade_id: string }>;
  const linkedTradeIdsByInstrument = new Map<string, string[]>();
  const allLinkedTradeIds = new Set<string>();
  for (const row of linkedTradeRows) {
    const list = linkedTradeIdsByInstrument.get(row.instrument_id) ?? [];
    list.push(row.journal_trade_id);
    linkedTradeIdsByInstrument.set(row.instrument_id, list);
    allLinkedTradeIds.add(row.journal_trade_id);
  }

  // Open linked journal trades (only these are reconciled). The as-of for the
  // section is the most recent updated_at among them.
  const openJournalTrades = new Map<
    string,
    {
      id: string;
      symbol: string;
      direction: string;
      current_price: number | null;
      current_price_fetched_at: string | null;
      updated_at: string | null;
    }
  >();
  let journalLinkedAsOf: string | null = null;
  if (allLinkedTradeIds.size > 0) {
    const placeholders = [...allLinkedTradeIds].map(() => '?').join(',');
    const linkedTradesFound = sqlite
      .prepare(
        `SELECT id, symbol, direction, status, current_price,
                current_price_fetched_at, updated_at
         FROM trades WHERE id IN (${placeholders})`,
      )
      .all(...allLinkedTradeIds) as Array<{
      id: string;
      symbol: string;
      direction: string;
      status: string;
      current_price: number | null;
      current_price_fetched_at: string | null;
      updated_at: string | null;
    }>;
    for (const trade of linkedTradesFound) {
      if (trade.status !== 'open') continue;
      openJournalTrades.set(trade.id, trade);
      if (
        trade.updated_at &&
        (!journalLinkedAsOf || trade.updated_at > journalLinkedAsOf)
      ) {
        journalLinkedAsOf = trade.updated_at;
      }
    }
  }

  // Batch-fetch executions / risk snapshots / stop adjustments for the open
  // linked trades — identical inputs to what GET /api/trades and
  // GET /api/trades/[id] feed into computeTradeMetrics.
  const journalExecByTrade = new Map<
    string,
    Array<{
      id: string;
      action: string;
      quantity: number;
      price: number;
      fees: number | null;
      executed_at: string | null;
    }>
  >();
  const journalRiskByTrade = new Map<
    string,
    {
      initial_risk_amount: number | null;
      account_equity_at_open: number | null;
      initial_stop_price: number | null;
      initial_entry_price: number | null;
    }
  >();
  const journalStopByTrade = new Map<
    string,
    Array<{
      id: string;
      new_stop: number | null;
      adjusted_at: string | null;
      created_at: string | null;
    }>
  >();
  const openLinkedTradeIds = [...openJournalTrades.keys()];
  if (openLinkedTradeIds.length > 0) {
    const placeholders = openLinkedTradeIds.map(() => '?').join(',');
    const execRows = sqlite
      .prepare(
        `SELECT id, trade_id, action, quantity, price, fees, executed_at
         FROM trade_executions WHERE trade_id IN (${placeholders})`,
      )
      .all(...openLinkedTradeIds) as Array<{
      id: string;
      trade_id: string;
      action: string;
      quantity: number;
      price: number;
      fees: number | null;
      executed_at: string | null;
    }>;
    for (const e of execRows) {
      const list = journalExecByTrade.get(e.trade_id) ?? [];
      list.push(e);
      journalExecByTrade.set(e.trade_id, list);
    }
    const riskRows = sqlite
      .prepare(
        `SELECT trade_id, initial_risk_amount, account_equity_at_open,
                initial_stop_price, initial_entry_price
         FROM trade_risk_snapshots WHERE trade_id IN (${placeholders})`,
      )
      .all(...openLinkedTradeIds) as Array<{
      trade_id: string;
      initial_risk_amount: number | null;
      account_equity_at_open: number | null;
      initial_stop_price: number | null;
      initial_entry_price: number | null;
    }>;
    for (const r of riskRows) {
      journalRiskByTrade.set(r.trade_id, r);
    }
    const stopRows = sqlite
      .prepare(
        `SELECT id, trade_id, new_stop, adjusted_at, created_at
         FROM trade_stop_adjustments WHERE trade_id IN (${placeholders})`,
      )
      .all(...openLinkedTradeIds) as Array<{
      id: string;
      trade_id: string;
      new_stop: number | null;
      adjusted_at: string | null;
      created_at: string | null;
    }>;
    for (const s of stopRows) {
      const list = journalStopByTrade.get(s.trade_id) ?? [];
      list.push(s);
      journalStopByTrade.set(s.trade_id, list);
    }
  }

  // FIFO open entry fees per instrument (accounting-side open fees), from the
  // rebuildable lot projection. Used for the net-unrealized and openFees
  // dashboard-side comparison values so both surfaces compare like-for-like
  // (net of open entry fees).
  const fifoOpenFeesByInstrument = new Map<string, string>();
  const fifoOpenFeeRows = sqlite
    .prepare(
      `SELECT instrument_id, allocated_fees
       FROM fifo_lots WHERE account_id = ?`,
    )
    .all(accountId) as Array<{ instrument_id: string; allocated_fees: string }>;
  for (const row of fifoOpenFeeRows) {
    const prev =
      fifoOpenFeesByInstrument.get(row.instrument_id) ?? ('0.00' as CanonicalDecimal);
    fifoOpenFeesByInstrument.set(
      row.instrument_id,
      addDecimal(prev, row.allocated_fees),
    );
  }

  // Current account equity for the journal kernel (faithful to the Trades API
  // cascade: account_performance.nav → rollforward.endingEquity →
  // account.startingBalance → settings.startingAccountValue). Only the
  // risk / position-weight fields consume it — the six extracted journal
  // metrics do not depend on equity.
  const journalEquitySettings = sqlite
    .prepare(`SELECT starting_account_value FROM settings WHERE id = 'default'`)
    .get() as { starting_account_value: number | null } | undefined;
  const journalEquityRollforward = sqlite
    .prepare(
      `SELECT ending_equity FROM account_rollforward
       WHERE account_id = ? ORDER BY date DESC, created_at DESC LIMIT 1`,
    )
    .get(accountId) as { ending_equity: number | null } | undefined;
  const journalCurrentAccountEquity =
    (performance?.nav ? parseFloat(performance.nav) : null) ??
    journalEquityRollforward?.ending_equity ??
    accountRow.starting_balance ??
    journalEquitySettings?.starting_account_value ??
    null;

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

  // ── Canonical active-stop inputs for ALL open trades ───────────────
  // Account positions can outlive journal linkage (legacy data,
  // deleted/recreated trades), so the risk section needs the full Trade
  // Metrics input for every open trade, not merely journal-linked ones.
  // Keep these maps independent from the journal-linked reconciliation maps
  // above: a linked trade must not receive duplicate adjustment rows.
  const openTradeExecByTrade = new Map<
    string,
    Array<{
      id: string;
      action: string;
      quantity: number;
      price: number;
      fees: number | null;
      executed_at: string | null;
    }>
  >();
  const openTradeRiskByTrade = new Map<
    string,
    {
      initial_risk_amount: number | null;
      account_equity_at_open: number | null;
      initial_stop_price: number | null;
      initial_entry_price: number | null;
    }
  >();
  const openTradeStopByTrade = new Map<
    string,
    Array<{
      id: string;
      new_stop: number | null;
      adjusted_at: string | null;
      created_at: string | null;
    }>
  >();
  const allOpenTradeIds = openTradeRows.map((t) => t.id);
  if (allOpenTradeIds.length > 0) {
    const placeholders = allOpenTradeIds.map(() => '?').join(',');
    const executionRows = sqlite
      .prepare(
        `SELECT id, trade_id, action, quantity, price, fees, executed_at
         FROM trade_executions WHERE trade_id IN (${placeholders})`,
      )
      .all(...allOpenTradeIds) as Array<{
      id: string;
      trade_id: string;
      action: string;
      quantity: number;
      price: number;
      fees: number | null;
      executed_at: string | null;
    }>;
    for (const execution of executionRows) {
      const list = openTradeExecByTrade.get(execution.trade_id) ?? [];
      list.push(execution);
      openTradeExecByTrade.set(execution.trade_id, list);
    }
    const adjRows = sqlite
      .prepare(
        `SELECT id, trade_id, new_stop, adjusted_at, created_at
         FROM trade_stop_adjustments WHERE trade_id IN (${placeholders})`,
      )
      .all(...allOpenTradeIds) as Array<{
      id: string;
      trade_id: string;
      new_stop: number | null;
      adjusted_at: string | null;
      created_at: string | null;
    }>;
    for (const a of adjRows) {
      const list = openTradeStopByTrade.get(a.trade_id) ?? [];
      list.push(a);
      openTradeStopByTrade.set(a.trade_id, list);
    }
    const snapRows = sqlite
      .prepare(
        `SELECT trade_id, initial_risk_amount, account_equity_at_open,
                initial_stop_price, initial_entry_price
         FROM trade_risk_snapshots WHERE trade_id IN (${placeholders})`,
      )
      .all(...allOpenTradeIds) as Array<{
      trade_id: string;
      initial_risk_amount: number | null;
      account_equity_at_open: number | null;
      initial_stop_price: number | null;
      initial_entry_price: number | null;
    }>;
    for (const r of snapRows) {
      openTradeRiskByTrade.set(r.trade_id, r);
    }
  }

  // Compute the current time for mark age calculations
  const now = new Date();
  const computedDate = now;

  // Central freshness policy, bound to this snapshot's clock so age
  // derivation and classification are deterministic per snapshot. The
  // threshold comes from the centrally configured policy — never a
  // hard-coded value in this module.
  // Aggregate completeness has no threshold of its own. Per-position policy
  // resolution below supplies the relevant account/provider/asset-class
  // threshold before each status is counted.
  const aggregateFreshnessPolicy = createFreshnessPolicy(
    policyConfig,
    undefined,
    () => computedDate,
  );

  // Count mark statuses
  let freshCount = 0;
  let staleCount = 0;
  let missingCount = 0;
  let latestMarkTimestamp: string | null = null;

  const dashboardPositions: DashboardPositionSummary[] = [];
  const instrumentCache = resolvePositionInstruments(sqlite, openPositions);

  for (const pos of positionsWithQuantity) {
    const mark = markByInstrument.get(pos.instrument_id);
    const instrument = instrumentCache.get(pos.instrument_id) ?? {
      symbol: 'UNKNOWN',
      assetClass: null,
    };
    const freshnessPolicy = createFreshnessPolicy(
      policyConfig,
      {
        account: accountId,
        provider: mark?.source ?? undefined,
        assetClass: instrument.assetClass ?? undefined,
      },
      () => computedDate,
    );

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

      // Use the canonical valuation kernel with the source quote's micro
      // precision so the Dashboard and Trades agree before display rounding.
      // A short profit is average cost − mark, times absolute quantity.
      try {
        unrealizedPnl = computeUnrealizedPnlFromMarkMicros(
          normalizeDecimal(pos.average_cost),
          mark.price_micros,
          normalizeDecimal(pos.quantity),
          pos.direction === 'long' || pos.direction === 'short'
            ? pos.direction
            : null,
        );
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
    const symbol = instrument.symbol;
    const symbolTrades = openTradesBySymbol.get(symbol.toUpperCase()) ?? [];
    // Resolve the effective active stop through the canonical trade-metrics
    // kernel. This includes the legacy initial-risk fallback when an older
    // snapshot lacks initial_stop_price, rather than re-implementing that
    // derivation in the dashboard. Trades are ordered oldest to newest, so
    // the first usable stop found in reverse order belongs to the latest
    // relevant trade. planned_stop is only a compatibility fallback for an
    // open trade with no execution-backed active stop yet.
    let stopPrice: number | null = null;
    for (let i = symbolTrades.length - 1; i >= 0; i--) {
      const trade = symbolTrades[i];
      if (trade.direction !== 'long' && trade.direction !== 'short') continue;
      const riskSnapshot = openTradeRiskByTrade.get(trade.id);
      const activeStop = computeTradeMetrics({
        executions: (openTradeExecByTrade.get(trade.id) ?? []).map((execution) => ({
          id: execution.id,
          action: execution.action,
          quantity: execution.quantity,
          price: execution.price,
          fees: execution.fees,
          executedAt: execution.executed_at ?? '',
        })),
        direction: trade.direction,
        riskSnapshot: riskSnapshot
          ? {
              initialRiskAmount: riskSnapshot.initial_risk_amount,
              accountEquityAtOpen: riskSnapshot.account_equity_at_open,
              initialStopPrice: riskSnapshot.initial_stop_price,
              initialEntryPrice: riskSnapshot.initial_entry_price,
            }
          : null,
        stopAdjustments: (openTradeStopByTrade.get(trade.id) ?? [])
          .filter((adjustment) => adjustment.new_stop != null)
          .map((adjustment) => ({
            id: adjustment.id,
            stopPrice: adjustment.new_stop as number,
            adjustedAt: adjustment.adjusted_at ?? '',
            createdAt: adjustment.created_at ?? '',
          })),
        currentMark: null,
        currentAccountEquity: null,
      }).risk.activeStop;
      const compatiblePlannedStop =
        trade.planned_stop !== null && trade.planned_stop > 0
          ? trade.planned_stop
          : null;
      stopPrice = activeStop ?? compatiblePlannedStop;
      if (stopPrice !== null && stopPrice > 0) break;
      stopPrice = null;
    }
    const hasValidStop = stopPrice !== null;
    const currentRiskToStop = computeRiskToStop(
      pos.direction,
      pos.quantity,
      pos.average_cost,
      stopPrice,
    );

    // ── Per-position journal-linked metrics (Trades-kernel values) ────
    // Computed via computeTradeMetrics from each open linked journal trade's
    // own executions / risk snapshot / stop adjustments / current mark — the
    // exact inputs the Trades list/detail API uses — so the block reconciles
    // exactly with GET /api/trades at the same mark snapshot. Account-only
    // positions and journal-linked positions without a resolvable open trade
    // carry null and contribute zero to the journalLinked aggregate.
    const linkedTradeIds = linkedTradeIdsByInstrument.get(pos.instrument_id) ?? [];
    const openLinkedIds = linkedTradeIds.filter((id) => openJournalTrades.has(id));
    let journalLinkedMetrics: JournalLinkedMetrics | null = null;
    if (attributionKind !== 'account_only' && openLinkedIds.length > 0) {
      const metricsList = openLinkedIds.map((tradeId) => {
        // openLinkedIds is derived from openJournalTrades keys, so the trade
        // is always present here.
        const trade = openJournalTrades.get(tradeId) as NonNullable<
          ReturnType<typeof openJournalTrades.get>
        >;
        const executions = (journalExecByTrade.get(tradeId) ?? []).map((e) => ({
          id: e.id,
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees,
          executedAt: e.executed_at ?? '',
        }));
        const riskSnapshotRow = journalRiskByTrade.get(tradeId);
        const input: TradeMetricsInput = {
          executions,
          direction: trade.direction as 'long' | 'short',
          riskSnapshot: riskSnapshotRow
            ? {
                initialRiskAmount: riskSnapshotRow.initial_risk_amount,
                accountEquityAtOpen: riskSnapshotRow.account_equity_at_open,
                initialStopPrice: riskSnapshotRow.initial_stop_price,
                initialEntryPrice: riskSnapshotRow.initial_entry_price,
              }
            : null,
          stopAdjustments: (journalStopByTrade.get(tradeId) ?? [])
            .filter((s) => s.new_stop != null)
            .map((s) => ({
              stopPrice: s.new_stop as number,
              adjustedAt: s.adjusted_at ?? '',
              createdAt: s.created_at ?? '',
              id: s.id,
            })),
          currentMark:
            trade.current_price != null
              ? {
                  price: trade.current_price,
                  markedAt:
                    trade.current_price_fetched_at ?? new Date().toISOString(),
                }
              : null,
          currentAccountEquity: journalCurrentAccountEquity,
        };
        return computeTradeMetrics(input);
      });
      journalLinkedMetrics = mergeJournalTradeMetrics(metricsList);
    }

    dashboardPositions.push({
      instrumentId: pos.instrument_id,
      symbol,
      direction: pos.direction,
      quantity: normalizeDecimal(pos.quantity),
      averageCost: normalizeDecimal(pos.average_cost),
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
        freshnessThresholdMinutes: freshnessPolicy.thresholdMinutes,
        freshnessResolvedFrom: freshnessPolicy.resolvedFrom,
      },
      risk: {
        hasValidStop,
        stopPrice,
        currentRiskToStop,
        openTrades: symbolTrades.length,
      },
      journalLinkedMetrics,
    });
  }

  const valuationState = aggregateFreshnessPolicy.classifyCompleteness(
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
    coveragePct: aggregateFreshnessPolicy.computeCoveragePct(
      positionsWithQuantity.length,
      freshCount,
    ),
  };

  // ── Qualified display hints ────────────────────────────────────────
  // Unpriced = positions without a fresh mark, matching the coverage model
  // (coveragePct counts only fresh marks). A partial or unavailable
  // aggregate must never be presented as a complete signed total — the
  // presentationLabel is the primary value the UI renders instead.
  const unpricedCount =
    valuationCompleteness.positionsTotal - valuationCompleteness.fresh;
  const valuationPresentationLabel = buildValuationPresentationLabel(
    valuationState,
    unpricedCount,
  );

  // Marked subset P&L: the known amount over positions with a fresh mark
  // (M of N coverage), or null when no position is freshly priced. It is a
  // subordinate display amount — never presented as Open P&L.
  const markedSubsetValues = dashboardPositions
    .filter((p) => p.markStatus === 'fresh' && p.unrealizedPnl !== null)
    .map((p) => p.unrealizedPnl as string);
  const markedSubsetPnl =
    markedSubsetValues.length === 0
      ? null
      : sumDecimals(markedSubsetValues);

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
      presentationLabel: null,
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
          presentationLabel: null,
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
          presentationLabel: null,
        },
      };

  // ── Risk Summary ──────────────────────────────────────────────────
  // openPnl: a partial sum is never presented as complete — when any
  // position's unrealized P&L cannot be computed (no mark), openPnl is null
  // (the coverage counts and completeness state explain why). A stale mark
  // still yields a computable value, so the 'stale' aggregate carries a
  // full sum that is qualified by the aggregate state and provenance, not
  // by nulling openPnl.
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

  // openRisk is null when some open trades have no risk snapshot (partial).
  const riskSnapshotsCovered =
    openTrades === 0 || (riskRow?.with_snapshot ?? 0) === openTrades;
  const openRisk: string | null = riskSnapshotsCovered
    ? normalizeDecimal(riskRow?.total_risk ?? 0)
    : null;

  // Aggregate risk-to-stop: null unless every open position can be evaluated.
  const riskToStopValues = dashboardPositions.map((p) => p.risk.currentRiskToStop);
  const openRiskToStop =
    dashboardPositions.length === 0
      ? '0.00'
      : riskToStopValues.every((v) => v !== null)
        ? sumDecimals(riskToStopValues as string[])
        : null;

  // Stop coverage must use the same account-position universe as Open risk.
  // A broker/account-only position has real exposure even when no journal
  // trade exists, so 0 journal trades is never permission to claim 0/0 full
  // coverage.
  const positionsTotal = dashboardPositions.length;
  const positionsWithStop = dashboardPositions.filter(
    (position) => position.risk.hasValidStop && position.risk.currentRiskToStop !== null,
  ).length;
  const missingStops = positionsTotal - positionsWithStop;

  // Portfolio heat is live remaining risk, not the historical initial-risk
  // snapshot. It is therefore only known when every account position has a
  // current risk-to-stop and NAV is known.
  const nav = performance?.nav;
  let portfolioHeat: string | null = null;
  if (openRiskToStop !== null) {
    if (nav && nav !== '0.00' && openRiskToStop !== '0.00') {
      const navMicros = toMicros(nav);
      const riskMicros = toMicros(openRiskToStop);
      portfolioHeat = normalizeDecimal((riskMicros / navMicros) * 100);
    } else if (openRiskToStop === '0.00') {
      portfolioHeat = '0.00';
    }
  }

  const riskSummary: RiskSummary = {
    openPnl,
    openRisk,
    portfolioHeat,
    missingStops,
    positionsWithStop,
    openRiskToStop,
    stopCoverage: {
      openTrades,
      positionsTotal,
      withStop: positionsWithStop,
      withoutStop: missingStops,
      state:
        positionsTotal === 0 || missingStops === 0 ? 'complete' : 'partial',
      presentationLabel: buildStopCoveragePresentationLabel(missingStops),
    },
    provenance: {
      source: 'account_positions + trades + trade_risk_snapshots',
      asOf: latestMarkTimestamp,
      computedAt,
      status: valuationState,
      presentationLabel: valuationPresentationLabel,
    },
  };

  // ── Journal-linked aggregate and reconciliation ─────────────────────
  // Account-only positions contribute zero to every journal-linked aggregate
  // (account-only exposure is never blended into journal performance); only
  // positions with non-null journalLinkedMetrics (open linked journal trades
  // resolved) contribute values. A journal-linked position that could not be
  // reconciled flips provenance.status to 'partial', and any dimension
  // comparison that is not 'match' does the same — the comparisons carry the
  // per-dimension detail for the S04 data-quality alert strip.
  const rawPosByInstrument = new Map(
    openPositions.map((p) => [p.instrument_id, p]),
  );
  const reconciledPositions = dashboardPositions.filter(
    (p) => p.journalLinkedMetrics !== null,
  );
  const unreconciledJournalPositions = dashboardPositions.filter(
    (p) => p.attribution.kind !== 'account_only' && p.journalLinkedMetrics === null,
  ).length;

  let journalLinked: JournalLinkedAggregate;
  if (reconciledPositions.length === 0) {
    journalLinked = {
      tradeCount: 0,
      positionCount: 0,
      remainingQty: '0.00',
      openAvgCost: null,
      grossRealizedPnl: '0.00',
      netRealizedPnl: '0.00',
      netUnrealizedPnl: '0.00',
      openFees: '0.00',
      comparisons: JOURNAL_LINKED_DIMENSIONS.map((d) => ({
        key: d.key,
        description: d.description,
        dashboardValue: null,
        tradesValue: null,
        difference: null,
        status: 'unavailable' as const,
      })),
      provenance: {
        source: JOURNAL_LINKED_SOURCE,
        asOf: journalLinkedAsOf,
        computedAt,
        status:
          unreconciledJournalPositions > 0 ? 'partial' : 'unavailable',
        presentationLabel: null,
      },
    };
  } else {
    // ── Trades-side (journal kernel) aggregate ────────────────────────
    // These are the journalLinkedMetrics values — the same kernel/inputs the
    // Trades list/detail API uses — so they reconcile exactly with it at the
    // same mark snapshot (per-trade equality is proven by contract test).
    const tRemainingQty = sumDecimals(
      reconciledPositions.map((p) =>
        normalizeDecimal(p.journalLinkedMetrics!.remainingQty ?? 0),
      ),
    );
    const tOpenAvgCost = computeWeightedAverageDecimal(
      reconciledPositions.map((p) => ({
        value: normalizeDecimal(p.journalLinkedMetrics!.openAvgCost ?? 0),
        weight: normalizeDecimal(p.journalLinkedMetrics!.remainingQty ?? 0),
      })),
    );
    const tGrossRealizedPnl = sumDecimals(
      reconciledPositions.map((p) =>
        normalizeDecimal(p.journalLinkedMetrics!.grossRealizedPnl ?? 0),
      ),
    );
    const tNetRealizedPnl = sumDecimals(
      reconciledPositions.map((p) =>
        normalizeDecimal(p.journalLinkedMetrics!.netRealizedPnl ?? 0),
      ),
    );
    // Partial-sum-as-null: when any reconciled position is unpriced its net
    // unrealized is unknown, so the aggregate is null, never a partial sum.
    const tNetUnrealizedPnl = reconciledPositions.every(
      (p) => p.journalLinkedMetrics!.netUnrealizedPnl !== null,
    )
      ? sumDecimals(
          reconciledPositions.map((p) =>
            normalizeDecimal(p.journalLinkedMetrics!.netUnrealizedPnl as number),
          ),
        )
      : null;
    const tOpenFees = sumDecimals(
      reconciledPositions.map((p) =>
        normalizeDecimal(p.journalLinkedMetrics!.openFees ?? 0),
      ),
    );
    const tradeCount = reconciledPositions.reduce(
      (s, p) =>
        s +
        (linkedTradeIdsByInstrument.get(p.instrumentId) ?? []).filter((id) =>
          openJournalTrades.has(id),
        ).length,
      0,
    );

    // ── Dashboard-side (accounting projection) aggregate ─────────────
    // Like-for-like net values: remaining quantity, FIFO average cost and
    // gross/net realized P&L come from account_positions; net unrealized is
    // the displayed gross minus open entry fees (fifo_lots); open fees sum
    // fifo_lots.allocated_fees.
    const dRemainingQty = sumDecimals(
      reconciledPositions.map((p) => normalizeDecimal(p.quantity)),
    );
    const dOpenAvgCost = computeWeightedAverageDecimal(
      reconciledPositions.map((p) => ({
        value: normalizeDecimal(p.averageCost),
        weight: normalizeDecimal(p.quantity),
      })),
    );
    const dGrossRealizedPnl = sumDecimals(
      reconciledPositions.map(
        (p) =>
          normalizeDecimal(
            rawPosByInstrument.get(p.instrumentId)?.realized_gross_pnl ?? '0.00',
          ),
      ),
    );
    const dNetRealizedPnl = sumDecimals(
      reconciledPositions.map(
        (p) =>
          normalizeDecimal(
            rawPosByInstrument.get(p.instrumentId)?.realized_net_pnl ?? '0.00',
          ),
      ),
    );
    const dOpenFees = sumDecimals(
      reconciledPositions.map(
        (p) => fifoOpenFeesByInstrument.get(p.instrumentId) ?? '0.00',
      ),
    );
    const dNetUnrealizedPnl = reconciledPositions.every(
      (p) => p.unrealizedPnl !== null,
    )
      ? sumDecimals(
          reconciledPositions.map((p) =>
            subtractDecimal(
              p.unrealizedPnl as string,
              fifoOpenFeesByInstrument.get(p.instrumentId) ?? '0.00',
            ),
          ),
        )
      : null;

    // ── Per-dimension comparisons ─────────────────────────────────────
    const dimensionValues: Array<{
      key: JournalLinkedDimensionKey;
      dashboardValue: string | null;
      tradesValue: string | null;
    }> = [
      { key: 'remainingQty', dashboardValue: dRemainingQty, tradesValue: tRemainingQty },
      { key: 'openAvgCost', dashboardValue: dOpenAvgCost, tradesValue: tOpenAvgCost },
      {
        key: 'grossRealizedPnl',
        dashboardValue: dGrossRealizedPnl,
        tradesValue: tGrossRealizedPnl,
      },
      {
        key: 'netRealizedPnl',
        dashboardValue: dNetRealizedPnl,
        tradesValue: tNetRealizedPnl,
      },
      {
        key: 'netUnrealizedPnl',
        dashboardValue: dNetUnrealizedPnl,
        tradesValue: tNetUnrealizedPnl,
      },
      { key: 'openFees', dashboardValue: dOpenFees, tradesValue: tOpenFees },
    ];
    const comparisons: JournalLinkedDimensionComparison[] =
      JOURNAL_LINKED_DIMENSIONS.map((d) => {
        const pair = dimensionValues.find((v) => v.key === d.key);
        const dashboardValue = pair?.dashboardValue ?? null;
        const tradesValue = pair?.tradesValue ?? null;
        const bothKnown = dashboardValue !== null && tradesValue !== null;
        return {
          key: d.key,
          description: d.description,
          dashboardValue,
          tradesValue,
          difference: bothKnown
            ? subtractDecimal(dashboardValue as string, tradesValue as string)
            : null,
          status: !bothKnown
            ? 'unavailable'
            : equalsDecimal(dashboardValue as string, tradesValue as string)
              ? 'match'
              : 'mismatch',
        };
      });

    const anyComparisonNotMatch = comparisons.some((c) => c.status !== 'match');
    journalLinked = {
      tradeCount,
      positionCount: reconciledPositions.length,
      remainingQty: tRemainingQty,
      openAvgCost: tOpenAvgCost,
      grossRealizedPnl: tGrossRealizedPnl,
      netRealizedPnl: tNetRealizedPnl,
      netUnrealizedPnl: tNetUnrealizedPnl,
      openFees: tOpenFees,
      comparisons,
      provenance: {
        source: JOURNAL_LINKED_SOURCE,
        asOf: journalLinkedAsOf,
        computedAt,
        status:
          unreconciledJournalPositions > 0 || anyComparisonNotMatch
            ? 'partial'
            : 'complete',
        presentationLabel: null,
      },
    };
  }

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
        presentationLabel: valuationPresentationLabel,
      },
    },
    valuation: {
      ...valuationCompleteness,
      positions: dashboardPositions,
      presentationLabel: valuationPresentationLabel,
      markedSubsetPnl,
      provenance: {
        source: 'account_positions + valuation_marks',
        asOf: latestMarkTimestamp,
        computedAt,
        status: valuationState,
        presentationLabel: valuationPresentationLabel,
      },
    },
    journalAttribution,
    journalLinked,
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
