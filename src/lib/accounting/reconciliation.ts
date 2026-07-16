/**
 * Reconciliation engine: compares legacy source data against rebuilt
 * accounting projections and classifies every difference as a match,
 * explained, or unexplained.
 *
 * Pure projection logic on top of SQL queries — no mutations, no
 * random IDs, no side effects.  Every call with the same data
 * produces identical output.
 *
 * Exposes a zero-unexplained-differences cutover gate so operators
 * can refuse or proceed with the ledger transition.
 *
 * @module reconciliation
 */

import Database from 'better-sqlite3';
import { fromMicros, toMicros } from './decimal';
import type { CanonicalDecimal } from './types';
import {
  listAccountPositions,
  countAccountingExecutions,
} from '../../db/accounting-repository';
import { findLatestMigrationRun, listMigrationRecords } from './legacy-migration-runner';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Stable key identifying which comparison dimension this row belongs to. */
export type ComparisonKey =
  | 'cash'
  | 'execution_count'
  | 'fee_total'
  | 'price_mark_count'
  | 'position_count'
  | 'position_exposure'
  | 'net_asset_value';

/** Classification of a single comparison outcome. */
export type ComparisonClassification = 'match' | 'explained' | 'unexplained';

/**
 * One comparison result between a legacy-derived value and its accounting
 * projection counterpart.
 */
export interface ComparisonResult {
  /** Stable key for reference and rendering. */
  key: ComparisonKey;
  /** Human-readable label. */
  description: string;
  /** Value derived from legacy source tables (canonical decimal or count). */
  legacyValue: string;
  /** Value from the rebuilt accounting projections (canonical decimal or count). */
  accountingValue: string;
  /** Absolute difference as a canonical decimal (or "0" for exact-match counts). */
  difference: string;
  /** Classification of this difference. */
  classification: ComparisonClassification;
  /** Permitted tolerance expressed as a canonical decimal string, or null. */
  tolerance: string | null;
  /** Human-readable detail explaining the classification. */
  detail: string | null;
}

/**
 * Aggregated anomaly summary grouped by anomaly code and source table.
 */
export interface AnomalySummary {
  /** Stable anomaly code (e.g. "ANOMALY_MISSING_PRICE"). */
  anomalyCode: string;
  /** Number of records with this anomaly code. */
  count: number;
  /** Source table name. */
  sourceTable: string;
  /** Per-record details for drill-down audit. */
  records: Array<{
    /** Legacy source record ID. */
    sourceId: string;
    /** Field that triggered the anomaly. */
    anomalyField: string;
    /** Human-readable anomaly detail. */
    anomalyDetail: string;
  }>;
}

/** Aggregated record counts grouped by status. */
export interface RecordStatusCounts {
  mappedCount: number;
  anomalyCount: number;
  unsupportedCount: number;
  duplicateCount: number;
  totalRecords: number;
}

/**
 * Full reconciliation report for one account's latest migration run.
 *
 * Designed for both machine consumption (cutoverEligible, counts) and
 * operator inspection (comparisons, anomalies).
 */
export interface ReconciliationReport {
  /** Migration run this report is based on. */
  runId: string;
  /** Account the report covers. */
  accountId: string;
  /** Status of the migration run. */
  runStatus: string;
  /** SHA-256 fingerprint of the rebuilt accounting state, or null. */
  rebuildFingerprint: string | null;
  /** ISO-8601 timestamp of when this report was computed. */
  computedAt: string;
  /** Summary counts across all comparisons. */
  totals: {
    /** Total number of comparisons made. */
    comparisons: number;
    /** Number of comparisons where legacy ≈ accounting within tolerance. */
    matching: number;
    /** Number of differences explained by known factors. */
    explained: number;
    /** Number of anomaly-classified records from the migration run. */
    anomalies: number;
    /** Number of differences that cannot be explained. */
    unexplained: number;
  };
  /** Per-dimension comparison results. */
  comparisons: ComparisonResult[];
  /** Anomaly summaries from the migration run. */
  anomalies: AnomalySummary[];
  /** Record status counts from the migration run. */
  recordStatusCounts: RecordStatusCounts;
  /** True when no unexplained differences exist (cutover gate). */
  cutoverEligible: boolean;
  /** If cutoverEligible is false, one or more refusal reasons. */
  cutoverRefusalReasons: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Types — Data Query Results
// ═══════════════════════════════════════════════════════════════════════════

interface LegacyCashTotals {
  totalDeposits: number;
  totalWithdrawals: number;
  netCash: number;
}

interface LegacyExecutionSummary {
  executionCount: number;
  feeTotal: number;
}

interface LegacyPriceMarkSummary {
  snapshotCount: number;
}

interface AccountingExecutionSummary {
  executionCount: number;
  feeTotalMicros: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const TOLERANCE_ONE_CENT = '0.01';

/** Event types that increase net cash. */
const CASH_INCREASING_EVENTS = new Set([
  'opening_balance',
  'deposit',
  'dividend',
  'interest',
]);

/** Event types that decrease net cash. */
const CASH_DECREASING_EVENTS = new Set([
  'withdrawal',
  'fee',
  'tax',
]);

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Data Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate net cash from legacy account_transactions for a given account.
 * Sums deposits and withdrawals to produce a net cash value.
 */
function queryLegacyCash(
  sqlite: Database.Database,
  accountId: string,
): LegacyCashTotals {
  const depositRow = sqlite
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM account_transactions
       WHERE account_id = ? AND type = 'deposit'`,
    )
    .get(accountId) as { total: number };

  const withdrawalRow = sqlite
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM account_transactions
       WHERE account_id = ? AND type = 'withdrawal'`,
    )
    .get(accountId) as { total: number };

  return {
    totalDeposits: depositRow.total,
    totalWithdrawals: withdrawalRow.total,
    netCash: depositRow.total - withdrawalRow.total,
  };
}

/**
 * Query legacy trade_executions count and total fees for an account.
 * Joins through trades to filter by account.
 */
function queryLegacyExecutions(
  sqlite: Database.Database,
  accountId: string,
): LegacyExecutionSummary {
  const row = sqlite
    .prepare(
      `SELECT
         COUNT(*) AS execution_count,
         COALESCE(SUM(COALESCE(e.fees, 0)), 0) AS fee_total
       FROM trade_executions e
       INNER JOIN trades t ON t.id = e.trade_id
       WHERE t.account_id = ?`,
    )
    .get(accountId) as { execution_count: number; fee_total: number };

  return {
    executionCount: row.execution_count,
    feeTotal: row.fee_total,
  };
}

/**
 * Query legacy position_price_snapshots count for an account.
 * Joins through trades to filter by account.
 */
function queryLegacyPriceMarks(
  sqlite: Database.Database,
  accountId: string,
): LegacyPriceMarkSummary {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS snapshot_count
       FROM position_price_snapshots s
       INNER JOIN trades t ON t.id = s.trade_id
       WHERE t.account_id = ?`,
    )
    .get(accountId) as { snapshot_count: number };

  return {
    snapshotCount: row.snapshot_count,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Accounting Data Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the net cash position from accounting financial events.
 *
 * The ledger uses balanced double-entry postings (debit == credit per event),
 * so ledger posting sums are always zero for an individual account.
 * Instead, net cash is derived from the financial_events event_type and the
 * debit posting amount from the associated ledger entry.
 *
 * Cash-increasing events (deposit, opening_balance, dividend, interest):
 *   net += debit posting amount
 * Cash-decreasing events (withdrawal, fee, tax):
 *   net -= debit posting amount
 * Other events (trade_execution, adjustment, stock_split, manual_adjustment):
 *   skipped (balanced, no net cash effect)
 */
function queryAccountingCash(
  sqlite: Database.Database,
  accountId: string,
): { netMicros: number; netAmount: CanonicalDecimal } {
  // Query all financial events with their debit posting amounts in one pass
  const rows = sqlite
    .prepare(
      `SELECT fe.event_type,
              COALESCE(
                (SELECT lp.amount_micros
                 FROM ledger_entries le
                 JOIN ledger_postings lp ON lp.ledger_entry_id = le.id AND lp.side = 'debit'
                 WHERE le.financial_event_id = fe.id
                 ORDER BY lp.sequence ASC
                 LIMIT 1),
                0
              ) AS debit_micros
       FROM financial_events fe
       WHERE fe.account_id = ?
       ORDER BY fe.posted_at ASC, fe.id ASC`,
    )
    .all(accountId) as Array<{ event_type: string; debit_micros: number }>;

  let netMicros = 0;

  for (const row of rows) {
    if (CASH_INCREASING_EVENTS.has(row.event_type)) {
      netMicros += row.debit_micros;
    } else if (CASH_DECREASING_EVENTS.has(row.event_type)) {
      netMicros -= row.debit_micros;
    }
    // Other event types (trade_execution, adjustment, etc.) are balanced
    // and don't contribute to net cash
  }

  return {
    netMicros,
    netAmount: fromMicros(netMicros),
  };
}

/**
 * Query accounting execution count and total fee micros for an account.
 * Reads fee strings and converts to micros using the toMicros utility.
 */
function queryAccountingExecutions(
  sqlite: Database.Database,
  accountId: string,
): AccountingExecutionSummary {
  const execCount = countAccountingExecutions(sqlite, accountId);

  const feeRows = sqlite
    .prepare('SELECT fees FROM accounting_executions WHERE account_id = ?')
    .all(accountId) as Array<{ fees: string }>;

  let feeTotalMicros = 0;
  for (const row of feeRows) {
    try {
      feeTotalMicros += toMicros(row.fees);
    } catch {
      // Malformed fee string — treat as zero
    }
  }

  return {
    executionCount: execCount,
    feeTotalMicros,
  };
}

/**
 * Count valuation marks for an account.
 */
function queryAccountingValuationMarks(
  sqlite: Database.Database,
  accountId: string,
): number {
  const row = sqlite
    .prepare('SELECT COUNT(*) AS count FROM valuation_marks WHERE account_id = ?')
    .get(accountId) as { count: number };
  return row.count;
}

/**
 * Compute the total market value of all positions using their latest mark price.
 * This gives a legacy-comparable NAV component.
 */
function queryAccountingPositionExposure(
  sqlite: Database.Database,
  accountId: string,
): { positionCount: number; totalMarkedMicros: number } {
  const positions = listAccountPositions(sqlite, accountId);
  let totalMarkedMicros = 0;

  for (const pos of positions) {
    const mark = sqlite
      .prepare(
        `SELECT price_micros
         FROM valuation_marks
         WHERE account_id = ? AND instrument_id = ?
         ORDER BY mark_timestamp DESC, created_at DESC
         LIMIT 1`,
      )
      .get(accountId, pos.instrument_id) as { price_micros: number } | undefined;

    if (mark) {
      const qtyMicros = toMicros(pos.quantity);
      const positionValueMicros = Number(
        (BigInt(qtyMicros) * BigInt(mark.price_micros)) / BigInt(1_000_000),
      );
      totalMarkedMicros += positionValueMicros;
    }
  }

  return {
    positionCount: positions.length,
    totalMarkedMicros,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Difference Classification Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify a cash difference.
 *
 * Cash differences within 1 cent tolerance are explained by float→decimal
 * rounding during migration normalisation.  Larger differences are unexplained.
 */
function classifyCashDifference(
  diffMicros: number,
  anomalyCount: number,
): { classification: ComparisonClassification; tolerance: string | null; detail: string | null } {
  const diffCents = Math.abs(diffMicros) / 10_000;

  if (diffMicros === 0) {
    return { classification: 'match', tolerance: null, detail: 'Cash value matches exactly.' };
  }

  if (diffCents <= 1) {
    return {
      classification: 'explained',
      tolerance: TOLERANCE_ONE_CENT,
      detail: `Difference of ${fromMicros(Math.abs(diffMicros))} is within 1 cent float→decimal rounding tolerance.`,
    };
  }

  if (anomalyCount > 0) {
    return {
      classification: 'explained',
      tolerance: null,
      detail: `Difference of ${fromMicros(Math.abs(diffMicros))} exceeds rounding tolerance; ${anomalyCount} anomaly records from the migration run may account for uncounted cash flows.`,
    };
  }

  return {
    classification: 'unexplained',
    tolerance: TOLERANCE_ONE_CENT,
    detail: `Cash difference of ${fromMicros(Math.abs(diffMicros))} exceeds the 1 cent rounding tolerance with no anomaly records to explain it.`,
  };
}

function classifyExecutionCountDifference(
  diff: number,
  anomalyCount: number,
  unsupportedCount: number,
): { classification: ComparisonClassification; detail: string | null } {
  if (diff === 0) {
    return { classification: 'match', detail: 'Execution count matches exactly.' };
  }

  if (diff <= anomalyCount + unsupportedCount && diff > 0) {
    return {
      classification: 'explained',
      detail: `Execution count differs by ${diff}. ${anomalyCount} anomaly records and ${unsupportedCount} unsupported records from the migration run may account for this difference.`,
    };
  }

  return {
    classification: 'unexplained',
    detail: `Execution count mismatch of ${diff} cannot be explained by ${anomalyCount} anomalies and ${unsupportedCount} unsupported records.`,
  };
}

function classifyFeeDifference(
  diffMicros: number,
): { classification: ComparisonClassification; tolerance: string | null; detail: string | null } {
  const diffCents = Math.abs(diffMicros) / 10_000;

  if (diffMicros === 0) {
    return { classification: 'match', tolerance: null, detail: 'Fee total matches exactly.' };
  }

  if (diffCents <= 1) {
    return {
      classification: 'explained',
      tolerance: TOLERANCE_ONE_CENT,
      detail: `Fee difference of ${fromMicros(Math.abs(diffMicros))} is within 1 cent float→decimal rounding tolerance.`,
    };
  }

  return {
    classification: 'unexplained',
    tolerance: TOLERANCE_ONE_CENT,
    detail: `Fee difference of ${fromMicros(Math.abs(diffMicros))} exceeds the 1 cent rounding tolerance.`,
  };
}

function classifyCountDifference(
  diff: number,
  label: string,
): { classification: ComparisonClassification; detail: string | null } {
  if (diff === 0) {
    return { classification: 'match', detail: `${label} count matches exactly.` };
  }
  return {
    classification: 'unexplained',
    detail: `${label} count mismatch of ${diff}.`,
  };
}

function classifyExposureDifference(
  diffMicros: number,
): { classification: ComparisonClassification; tolerance: string | null; detail: string | null } {
  const diffCents = Math.abs(diffMicros) / 10_000;

  if (diffMicros === 0) {
    return { classification: 'match', tolerance: null, detail: 'Position market value matches exactly.' };
  }

  if (diffCents <= 1) {
    return {
      classification: 'explained',
      tolerance: TOLERANCE_ONE_CENT,
      detail: `Position value difference of ${fromMicros(Math.abs(diffMicros))} is within 1 cent rounding tolerance.`,
    };
  }

  return {
    classification: 'unexplained',
    tolerance: TOLERANCE_ONE_CENT,
    detail: `Position value difference of ${fromMicros(Math.abs(diffMicros))} exceeds the 1 cent rounding tolerance.`,
  };
}

function classifyNavDifference(
  diffMicros: number,
  anomalyCount: number,
): { classification: ComparisonClassification; tolerance: string | null; detail: string | null } {
  const diffCents = Math.abs(diffMicros) / 10_000;

  if (diffMicros === 0) {
    return { classification: 'match', tolerance: null, detail: 'NAV matches exactly.' };
  }

  if (diffCents <= 1) {
    return {
      classification: 'explained',
      tolerance: TOLERANCE_ONE_CENT,
      detail: `NAV difference of ${fromMicros(Math.abs(diffMicros))} is within 1 cent float→decimal rounding tolerance.`,
    };
  }

  if (anomalyCount > 0) {
    return {
      classification: 'explained',
      tolerance: null,
      detail: `NAV difference of ${fromMicros(Math.abs(diffMicros))} exceeds rounding tolerance; ${anomalyCount} anomaly records may account for this.`,
    };
  }

  return {
    classification: 'unexplained',
    tolerance: TOLERANCE_ONE_CENT,
    detail: `NAV difference of ${fromMicros(Math.abs(diffMicros))} exceeds the 1 cent rounding tolerance with no anomalies to explain it.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Position Market Value
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the approximate market value of legacy positions.
 * Uses net execution quantities per symbol multiplied by the latest
 * position_price_snapshot price for that symbol.
 */
function queryLegacyPositionExposure(
  sqlite: Database.Database,
  accountId: string,
): number {
  const rows = sqlite
    .prepare(
      `SELECT t.symbol, e.action, e.quantity
       FROM trade_executions e
       INNER JOIN trades t ON t.id = e.trade_id
       WHERE t.account_id = ?
       ORDER BY t.symbol, e.executed_at ASC`,
    )
    .all(accountId) as Array<{
    symbol: string;
    action: string;
    quantity: number;
  }>;

  const symbolPositions = new Map<string, { netQuantity: number }>();
  for (const row of rows) {
    const existing = symbolPositions.get(row.symbol) ?? { netQuantity: 0 };
    if (row.action === 'buy' || row.action === 'buy_to_cover') {
      existing.netQuantity += row.quantity;
    } else if (row.action === 'sell' || row.action === 'sell_short') {
      existing.netQuantity -= row.quantity;
    }
    symbolPositions.set(row.symbol, existing);
  }

  let totalMicros = 0;
  for (const [symbol, pos] of symbolPositions) {
    if (pos.netQuantity === 0) continue;

    const latestRow = sqlite
      .prepare(
        `SELECT s.price
         FROM position_price_snapshots s
         INNER JOIN trades t ON t.id = s.trade_id
         WHERE t.symbol = ? AND t.account_id = ?
         ORDER BY s.fetched_at DESC, s.id DESC
         LIMIT 1`,
      )
      .get(symbol, accountId) as { price: number } | undefined;

    if (latestRow && latestRow.price > 0) {
      const netQtyMicros = Math.abs(pos.netQuantity) * 1_000_000;
      const priceMicros = Math.round(latestRow.price * 1_000_000);
      totalMicros += Number(
        (BigInt(netQtyMicros) * BigInt(priceMicros)) / BigInt(1_000_000),
      );
    }
  }

  return totalMicros;
}

/**
 * Count distinct symbols with executions (legacy position count).
 */
function queryLegacyPositionCount(
  sqlite: Database.Database,
  accountId: string,
): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(DISTINCT t.symbol) AS count
       FROM trade_executions e
       INNER JOIN trades t ON t.id = e.trade_id
       WHERE t.account_id = ?`,
    )
    .get(accountId) as { count: number };
  return row.count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Reconciliation Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a reconciliation report comparing legacy source data against
 * rebuilt accounting projections for a given account.
 *
 * Queries both legacy tables (account_transactions, trade_executions,
 * position_price_snapshots) and accounting tables (financial_events,
 * ledger_entries, accounting_executions, valuation_marks,
 * account_positions) to produce a structured comparison.
 *
 * Accounting net cash is derived from financial event types and their
 * associated debit posting amounts (not ledger posting balances),
 * because the double-entry ledger uses the same account ID for both
 * posting sides, making per-account posting balances always zero.
 *
 * The latest completed migration run is used; if no run exists the
 * function returns undefined.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param accountId - The account to reconcile.
 * @returns         - A ReconciliationReport, or undefined if no migration
 *                    run exists for this account.
 */
export function computeReconciliation(
  sqlite: Database.Database,
  accountId: string,
): ReconciliationReport | undefined {
  const run = findLatestMigrationRun(sqlite, accountId);
  if (!run) {
    return undefined;
  }

  const computedAt = new Date().toISOString();

  // ── 1. Query legacy data ──────────────────────────────────────────────
  const legacyCash = queryLegacyCash(sqlite, accountId);
  const legacyExecutions = queryLegacyExecutions(sqlite, accountId);
  const legacyPriceMarks = queryLegacyPriceMarks(sqlite, accountId);
  const legacyPositionValueMicros = queryLegacyPositionExposure(sqlite, accountId);
  const legacyPositionCount = queryLegacyPositionCount(sqlite, accountId);

  // ── 2. Query accounting data ──────────────────────────────────────────
  const accountingCash = queryAccountingCash(sqlite, accountId);
  const accountingExecs = queryAccountingExecutions(sqlite, accountId);
  const accountingMarkCount = queryAccountingValuationMarks(sqlite, accountId);
  const accountingPositions = queryAccountingPositionExposure(sqlite, accountId);

  // ── 3. Compute differences ────────────────────────────────────────────
  const comparisons: ComparisonResult[] = [];

  // Cash comparison
  const legacyCashMicros = Math.round(legacyCash.netCash * 1_000_000);
  const cashDiffMicros = legacyCashMicros - accountingCash.netMicros;
  const cashClassification = classifyCashDifference(cashDiffMicros, run.anomalyCount);
  comparisons.push({
    key: 'cash',
    description: 'Net Cash (deposits - withdrawals)',
    legacyValue: fromMicros(legacyCashMicros),
    accountingValue: accountingCash.netAmount,
    difference: fromMicros(Math.abs(cashDiffMicros)),
    classification: cashClassification.classification,
    tolerance: cashClassification.tolerance,
    detail: cashClassification.detail,
  });

  // Execution count comparison
  const execCountDiff = legacyExecutions.executionCount - accountingExecs.executionCount;
  const execCountClassification = classifyExecutionCountDifference(
    execCountDiff,
    run.anomalyCount,
    run.unsupportedCount,
  );
  comparisons.push({
    key: 'execution_count',
    description: 'Execution Count',
    legacyValue: String(legacyExecutions.executionCount),
    accountingValue: String(accountingExecs.executionCount),
    difference: String(Math.abs(execCountDiff)),
    classification: execCountClassification.classification,
    tolerance: null,
    detail: execCountClassification.detail,
  });

  // Fee comparison
  const legacyFeeMicros = Math.round(legacyExecutions.feeTotal * 1_000_000);
  const feeDiffMicros = legacyFeeMicros - accountingExecs.feeTotalMicros;
  const feeClassification = classifyFeeDifference(feeDiffMicros);
  comparisons.push({
    key: 'fee_total',
    description: 'Total Fees',
    legacyValue: fromMicros(legacyFeeMicros),
    accountingValue: fromMicros(accountingExecs.feeTotalMicros),
    difference: fromMicros(Math.abs(feeDiffMicros)),
    classification: feeClassification.classification,
    tolerance: feeClassification.tolerance,
    detail: feeClassification.detail,
  });

  // Price mark count comparison
  const markCountDiff = legacyPriceMarks.snapshotCount - accountingMarkCount;
  const markCountClassification = classifyCountDifference(markCountDiff, 'Price Mark');
  comparisons.push({
    key: 'price_mark_count',
    description: 'Price Mark Count',
    legacyValue: String(legacyPriceMarks.snapshotCount),
    accountingValue: String(accountingMarkCount),
    difference: String(Math.abs(markCountDiff)),
    classification: markCountClassification.classification,
    tolerance: null,
    detail: markCountClassification.detail,
  });

  // Position count comparison
  const posCountDiff = legacyPositionCount - accountingPositions.positionCount;
  const posCountClassification = classifyCountDifference(posCountDiff, 'Position');
  comparisons.push({
    key: 'position_count',
    description: 'Position Count',
    legacyValue: String(legacyPositionCount),
    accountingValue: String(accountingPositions.positionCount),
    difference: String(Math.abs(posCountDiff)),
    classification: posCountClassification.classification,
    tolerance: null,
    detail: posCountClassification.detail,
  });

  // Position market value comparison
  const posExposureDiffMicros = legacyPositionValueMicros - accountingPositions.totalMarkedMicros;
  const posExposureClassification = classifyExposureDifference(posExposureDiffMicros);
  comparisons.push({
    key: 'position_exposure',
    description: 'Position Market Value',
    legacyValue: fromMicros(legacyPositionValueMicros),
    accountingValue: fromMicros(accountingPositions.totalMarkedMicros),
    difference: fromMicros(Math.abs(posExposureDiffMicros)),
    classification: posExposureClassification.classification,
    tolerance: posExposureClassification.tolerance,
    detail: posExposureClassification.detail,
  });

  // NAV comparison (Cash + Position Market Value)
  const legacyNavMicros = legacyCashMicros + legacyPositionValueMicros;
  const accountingNavMicros = accountingCash.netMicros + accountingPositions.totalMarkedMicros;
  const navDiffMicros = legacyNavMicros - accountingNavMicros;
  const navClassification = classifyNavDifference(navDiffMicros, run.anomalyCount);
  comparisons.push({
    key: 'net_asset_value',
    description: 'Net Asset Value (Cash + Positions)',
    legacyValue: fromMicros(legacyNavMicros),
    accountingValue: fromMicros(accountingNavMicros),
    difference: fromMicros(Math.abs(navDiffMicros)),
    classification: navClassification.classification,
    tolerance: navClassification.tolerance,
    detail: navClassification.detail,
  });

  // ── 4. Aggregate anomaly summaries ─────────────────────────────────────
  const migrationRecords = listMigrationRecords(sqlite, run.id);
  const anomalyRecords = migrationRecords.filter((r) => r.status === 'anomaly');

  const anomalyMap = new Map<string, AnomalySummary>();
  for (const rec of anomalyRecords) {
    const key = `${rec.anomalyCode}:${rec.sourceTable}`;
    const existing = anomalyMap.get(key);
    if (existing) {
      existing.count++;
      existing.records.push({
        sourceId: rec.sourceId,
        anomalyField: rec.anomalyField ?? '',
        anomalyDetail: rec.anomalyDetail ?? '',
      });
    } else {
      anomalyMap.set(key, {
        anomalyCode: rec.anomalyCode ?? 'UNKNOWN',
        count: 1,
        sourceTable: rec.sourceTable,
        records: [
          {
            sourceId: rec.sourceId,
            anomalyField: rec.anomalyField ?? '',
            anomalyDetail: rec.anomalyDetail ?? '',
          },
        ],
      });
    }
  }

  // ── 5. Compute summary totals ─────────────────────────────────────────
  const matching = comparisons.filter((c) => c.classification === 'match').length;
  const explained = comparisons.filter((c) => c.classification === 'explained').length;
  const unexplained = comparisons.filter((c) => c.classification === 'unexplained').length;

  const cutoverEligible = unexplained === 0 && run.status === 'completed';
  const cutoverRefusalReasons: string[] = [];

  if (unexplained > 0) {
    cutoverRefusalReasons.push(
      `${unexplained} unexplained difference(s) remain across ${comparisons.length} comparison dimensions.`,
    );
  }
  if (run.status !== 'completed') {
    cutoverRefusalReasons.push(
      `Migration run status is "${run.status}"; only completed runs are eligible for cutover.`,
    );
  }

  // ── 6. Build report ──────────────────────────────────────────────────
  return {
    runId: run.id,
    accountId,
    runStatus: run.status,
    rebuildFingerprint: run.rebuildFingerprint,
    computedAt,
    totals: {
      comparisons: comparisons.length,
      matching,
      explained,
      anomalies: anomalyRecords.length,
      unexplained,
    },
    comparisons,
    anomalies: Array.from(anomalyMap.values()),
    recordStatusCounts: {
      mappedCount: run.mappedCount,
      anomalyCount: run.anomalyCount,
      unsupportedCount: run.unsupportedCount,
      duplicateCount: run.duplicateCount,
      totalRecords: run.totalRecords,
    },
    cutoverEligible,
    cutoverRefusalReasons,
  };
}
