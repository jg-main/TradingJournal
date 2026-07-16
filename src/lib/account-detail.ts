/**
 * Pure account-detail mapping contracts.
 *
 * Database-free mapping and formatting functions for overview snapshot
 * composition, reconciliation banner state, price-status classification,
 * ledger category mapping, correction grouping, and positions row mapping.
 *
 * All inputs are plain objects (no database imports). Empty and
 * missing-price semantics are preserved with null rather than zero.
 *
 * @module account-detail
 */

// ───────────────────────────────────────────────────────────────────────────
// 1. Overview Snapshot Composition
// ───────────────────────────────────────────────────────────────────────────

/**
 * Input for composing an overview snapshot.
 *
 * Derived from accounting projection data (findAccountPerformance).
 * Fields not consumed by Overview (twr, highWaterMark, drawdown,
 * drawdownPct, modifiedDietzReturn, warnings, rebuildCount,
 * lastRebuiltAt) are excluded — they stay confined to Reconciliation.
 */
export interface OverviewSnapshotInput {
  /** Net cash from financial events (canonical decimal string). May be null. */
  netCash: string | null;
  /** Net Asset Value (canonical decimal string). May be null. */
  nav: string | null;
  /** Market value of marked positions (canonical decimal string). May be null. */
  markedPositions: string | null;
  /** Realized P&L (canonical decimal string). May be null. */
  realizedPnl: string | null;
  /** Unrealized P&L (canonical decimal string). May be null. */
  unrealizedPnl: string | null;
  /** Total P&L = realized + unrealized (canonical decimal string). May be null. */
  totalPnl: string | null;
  /** Realized fees (canonical decimal string). May be null. */
  realizedFees: string | null;
  /** Gross exposure (canonical decimal string). May be null. */
  grossExposure: string | null;
  /** Net exposure (canonical decimal string). May be null. */
  netExposure: string | null;
}

/**
 * Composed overview snapshot for the Overview tab.
 *
 * Each numeric field is a canonical decimal string or null when the
 * underlying projection data is unavailable.
 */
export interface OverviewSnapshot {
  netCash: string | null;
  nav: string | null;
  markedPositions: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  totalPnl: string | null;
  realizedFees: string | null;
  grossExposure: string | null;
  netExposure: string | null;
}

/**
 * Compose an overview snapshot from accounting projection data.
 *
 * Pure function: same input always produces the same snapshot.
 * Preserves null semantics — null in = null out.
 * Does NOT include twr, drawdown, drawdownPct, modifiedDietzReturn,
 * warnings, rebuildCount, or lastRebuiltAt (those are confined to
 * the Reconciliation tab).
 *
 * @param input - Projection data from findAccountPerformance.
 * @returns Overview snapshot for the Overview tab.
 */
export function composeOverviewSnapshot(input: OverviewSnapshotInput): OverviewSnapshot {
  return {
    netCash: input.netCash ?? null,
    nav: input.nav ?? null,
    markedPositions: input.markedPositions ?? null,
    realizedPnl: input.realizedPnl ?? null,
    unrealizedPnl: input.unrealizedPnl ?? null,
    totalPnl: input.totalPnl ?? null,
    realizedFees: input.realizedFees ?? null,
    grossExposure: input.grossExposure ?? null,
    netExposure: input.netExposure ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Reconciliation Banner State
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reconciliation status classification.
 */
export type ReconciliationBannerStatus = 'eligible' | 'stale' | 'blocked';

/**
 * Input for deriving the reconciliation banner state.
 *
 * Separates the reconciliation engine's raw output from the banner
 * classification, letting the banner function stay database-free.
 */
export interface BannerStateInput {
  /** Whether the account is eligible for accounting cutover. */
  cutoverEligible: boolean;
  /** Human-readable refusal reasons when cutoverEligible is false. */
  cutoverRefusalReasons: string[];
  /** Total reconciliation comparisons performed. */
  comparisons: number;
  /** Number of matching comparisons. */
  matching: number;
  /** Number of explained differences. */
  explained: number;
  /** Number of unexplained differences. */
  unexplained: number;
  /** Timestamp of the reconciliation run, or null. */
  computedAt: string | null;
}

/**
 * Banner state for the Reconciliation tab.
 *
 * Provides a machine-readable status and human-readable summary for
 * the reconciliation banner UI component.
 */
export interface ReconciliationBanner {
  /** Machine-readable status classification. */
  status: ReconciliationBannerStatus;
  /** Whether the account is eligible for cutover. */
  cutoverEligible: boolean;
  /** Human-readable refusal reasons (empty when eligible). */
  refusalReasons: string[];
  /** Concise summary line for the banner UI. */
  summary: string;
  /** Total comparisons, or 0 if no run data. */
  comparisonCount: number;
  /** Matching + explained count. */
  resolvedCount: number;
  /** Unexplained differences. */
  unresolvedCount: number;
}

/**
 * Derive reconciliation banner state from reconciliation engine output.
 *
 * Classification rules:
 * - 'eligible': cutoverEligible is true (all differences explained or matching)
 * - 'stale': no computedAt timestamp (no run yet)
 * - 'blocked': cutoverEligible is false with refusal reasons
 *
 * @param input - Reconciliation data from computeReconciliation.
 * @returns Structured banner state for the Reconciliation tab.
 */
export function deriveBannerState(input: BannerStateInput): ReconciliationBanner {
  const { cutoverEligible, cutoverRefusalReasons, comparisons, matching, explained, unexplained, computedAt } = input;

  let status: ReconciliationBannerStatus;
  if (cutoverEligible) {
    status = 'eligible';
  } else if (!computedAt) {
    status = 'stale';
  } else {
    status = 'blocked';
  }

  const resolvedCount = matching + explained;
  const summary = buildBannerSummary(status, comparisons, resolvedCount, unexplained);

  return {
    status,
    cutoverEligible,
    refusalReasons: cutoverRefusalReasons,
    summary,
    comparisonCount: comparisons,
    resolvedCount,
    unresolvedCount: unexplained,
  };
}

function buildBannerSummary(
  status: ReconciliationBannerStatus,
  comparisons: number,
  resolved: number,
  unresolved: number,
): string {
  switch (status) {
    case 'eligible':
      return `Reconciliation complete — ${comparisons} comparisons, ${resolved} resolved. Ready for cutover.`;
    case 'stale':
      return 'No reconciliation run yet. Run a migration to compare legacy and accounting data.';
    case 'blocked':
      return `Reconciliation blocked — ${unresolved} unexplained difference(s) out of ${comparisons} comparisons.`;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Price-Status Classification
// ───────────────────────────────────────────────────────────────────────────

/**
 * Classification of a position's valuation-mark status.
 */
export type PriceStatus = 'fresh' | 'stale' | 'missing' | 'pending';

/**
 * Input for price-status classification of one position.
 */
export interface PriceStatusInput {
  /** ISO-8601 timestamp of the latest valuation mark, or null. */
  markTimestamp: string | null;
  /** Age of the mark in minutes, or null. */
  markAgeMinutes: number | null;
  /** Whether a mark price is available. */
  hasPrice: boolean;
}

/**
 * Classify a position's price/mark status.
 *
 * Classification rules:
 * - 'fresh': valid mark exists and age <= freshnessThresholdMinutes
 * - 'stale': valid mark exists but age > freshnessThresholdMinutes
 * - 'missing': no mark exists
 * - 'pending': mark exists but age data is indeterminate (e.g. future timestamps)
 *
 * @param input                    - Price-status input for one position.
 * @param freshnessThresholdMinutes - Max age in minutes for a fresh mark (default 1440 = 24h).
 * @returns The price-status classification.
 */
export function classifyPriceStatus(
  input: PriceStatusInput,
  freshnessThresholdMinutes: number = 1440,
): PriceStatus {
  if (!input.hasPrice || !input.markTimestamp) {
    return 'missing';
  }

  if (input.markAgeMinutes === null) {
    return 'pending';
  }

  if (input.markAgeMinutes < 0) {
    return 'pending';
  }

  return input.markAgeMinutes <= freshnessThresholdMinutes ? 'fresh' : 'stale';
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Ledger Category Mapping
// ───────────────────────────────────────────────────────────────────────────

/**
 * Display categories for ledger events.
 */
export type LedgerCategory =
  | 'Cash'
  | 'Trade'
  | 'Fee/Tax'
  | 'Corporate Action'
  | 'Adjustment'
  | 'Transfer'
  | 'Opening Balance';

/**
 * Mapping from event type to display category.
 *
 * Exhaustive over all 12 EVENT_TYPES from the accounting types module.
 */
const EVENT_TYPE_CATEGORY: Record<string, LedgerCategory> = {
  opening_balance: 'Opening Balance',
  deposit: 'Cash',
  withdrawal: 'Cash',
  dividend: 'Cash',
  interest: 'Cash',
  fee: 'Fee/Tax',
  tax: 'Fee/Tax',
  trade_execution: 'Trade',
  adjustment: 'Adjustment',
  transfer: 'Transfer',
  stock_split: 'Corporate Action',
  manual_adjustment: 'Adjustment',
};

/**
 * Map an event type string to its display category.
 *
 * @param eventType - The raw event_type from the database.
 * @returns The display category. Unknown event types map to 'Adjustment'.
 */
export function categorizeLedgerEvent(eventType: string): LedgerCategory {
  return EVENT_TYPE_CATEGORY[eventType] ?? 'Adjustment';
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Correction Grouping with Constituent IDs
// ───────────────────────────────────────────────────────────────────────────

/**
 * A grouped correction display row for the ledger.
 *
 * Collapses the original/reversal/replacement triple into a single
 * display row, retaining all three constituent IDs for expandable
 * audit detail.
 */
export interface CorrectionGroup {
  /** Unique correction lineage ID. */
  correctionId: string;
  /** Original execution ID (the economic event being corrected). */
  originalExecutionId: string;
  /** Reversal execution ID (the mirror that cancels the original). */
  reversalExecutionId: string;
  /** Replacement execution ID (the corrected economic event). */
  replacementExecutionId: string;
  /** Instrument symbol for the correction. */
  symbol: string;
  /** Original action (e.g. 'buy'). */
  originalAction: string;
  /** Replacement action (e.g. 'sell'). */
  replacementAction: string;
  /** Original quantity as canonical decimal string. */
  originalQuantity: string;
  /** Replacement quantity as canonical decimal string. */
  replacementQuantity: string;
  /** Human-readable correction reason, or null. */
  reason: string | null;
  /** ISO-8601 timestamp of the correction. */
  correctedAt: string;
}

/**
 * Input for grouping a correction triple.
 *
 * This is the canonical shape from the correction service response.
 */
export interface CorrectionGroupInput {
  /** Correction lineage ID. */
  id: string;
  /** Original execution ID. */
  originalExecutionId: string;
  /** Reversal execution ID. */
  reversalExecutionId: string;
  /** Replacement execution ID. */
  replacementExecutionId: string;
  /** Human-readable correction reason. */
  reason: string | null;
  /** ISO-8601 correction timestamp. */
  correctedAt: string;
}

/**
 * Input for the original execution in a correction group.
 */
export interface CorrectionExecutionInput {
  /** Instrument symbol. */
  symbol: string;
  /** Execution action (e.g. 'buy', 'sell'). */
  action: string;
  /** Execution quantity as canonical decimal string. */
  quantity: string;
}

/**
 * Group a correction triple into a single display row.
 *
 * Pure function: same inputs always produce the same output.
 * Retains all three constituent execution IDs so the UI can
 * render expandable audit detail for each correction.
 *
 * @param correctionLineage  - The correction lineage record.
 * @param original           - The original execution data.
 * @param replacement        - The replacement execution data.
 * @returns A grouped correction display row.
 */
export function groupCorrection(
  correctionLineage: CorrectionGroupInput,
  original: CorrectionExecutionInput,
  replacement: CorrectionExecutionInput,
): CorrectionGroup {
  return {
    correctionId: correctionLineage.id,
    originalExecutionId: correctionLineage.originalExecutionId,
    reversalExecutionId: correctionLineage.reversalExecutionId,
    replacementExecutionId: correctionLineage.replacementExecutionId,
    symbol: replacement.symbol,
    originalAction: original.action,
    replacementAction: replacement.action,
    originalQuantity: original.quantity,
    replacementQuantity: replacement.quantity,
    reason: correctionLineage.reason,
    correctedAt: correctionLineage.correctedAt,
  };
}

/**
 * Group multiple correction triples into an ordered list.
 *
 * Convenience wrapper for mapping an array of correction responses
 * through groupCorrection. Corrections are returned in input order.
 *
 * @param corrections - Array of { lineage, original, replacement } tuples.
 * @returns Ordered list of correction display groups.
 */
export function groupCorrections(
  corrections: Array<{
    lineage: CorrectionGroupInput;
    original: CorrectionExecutionInput;
    replacement: CorrectionExecutionInput;
  }>,
): CorrectionGroup[] {
  return corrections.map((c) => groupCorrection(c.lineage, c.original, c.replacement));
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Positions Row Mapping
// ───────────────────────────────────────────────────────────────────────────

/**
 * A position display row for the Positions tab.
 *
 * Derived from position state data with optional valuation-mark
 * enrichment. Each field is a string except where noted.
 */
export interface PositionRow {
  /** Instrument symbol (e.g. 'AAPL'). */
  symbol: string;
  /** Position direction: 'long', 'short', or null for flat. */
  direction: string | null;
  /** Open quantity as canonical decimal string. */
  quantity: string;
  /** Average cost per share/unit as canonical decimal string. */
  averageCost: string;
  /** Total cost basis as canonical decimal string. */
  totalCostBasis: string;
  /** Valuation mark status classification. */
  markStatus: PriceStatus;
  /** Mark price, or null if missing. */
  markPrice: string | null;
  /** Marked value (quantity × markPrice), or null. */
  markedValue: string | null;
  /** Unrealized P&L, or null. */
  unrealizedPnl: string | null;
  /** Realized gross P&L as canonical decimal string. */
  realizedGrossPnl: string;
  /** Realized net P&L (gross minus fees). */
  realizedNetPnl: string;
}

/**
 * Input for mapping a position to a display row.
 *
 * Combines the position state row with optional mark data
 * for price-status classification and mark-value computation.
 */
export interface PositionRowInput {
  /** Instrument symbol. */
  symbol: string;
  /** Position direction. */
  direction: string | null;
  /** Open quantity. */
  quantity: string;
  /** Average cost. */
  averageCost: string;
  /** Total cost basis. */
  totalCostBasis: string;
  /** Realized gross P&L. */
  realizedGrossPnl: string;
  /** Realized net P&L. */
  realizedNetPnl: string;
  /** Mark timestamp, or null. */
  markTimestamp: string | null;
  /** Mark price, or null. */
  markPrice: string | null;
  /** Mark age in minutes, or null. */
  markAgeMinutes: number | null;
}

/**
 * Map a position state to a display row for the Positions tab.
 *
 * Pure function: same input always produces the same output row.
 * Preserves null semantics for missing mark data.
 *
 * @param input - Position state data with optional mark enrichment.
 * @returns A position display row.
 */
export function mapPositionRow(input: PositionRowInput): PositionRow {
  const markStatus = classifyPriceStatus({
    markTimestamp: input.markTimestamp,
    markAgeMinutes: input.markAgeMinutes,
    hasPrice: input.markPrice !== null,
  });

  // Compute marked value = quantity × markPrice when both available
  let markedValue: string | null = null;
  if (input.markPrice !== null) {
    try {
      const qtyMicros = toMicros(input.quantity);
      const priceMicros = toMicros(input.markPrice);
      const valueMicros = Number(
        (BigInt(qtyMicros) * BigInt(priceMicros)) / BigInt(1_000_000),
      );
      markedValue = fromMicros(valueMicros);
    } catch {
      markedValue = null;
    }
  }

  // Compute unrealized P&L = (markPrice - averageCost) × quantity
  let unrealizedPnl: string | null = null;
  if (input.markPrice !== null) {
    try {
      const avgCostMicros = toMicros(input.averageCost);
      const qtyMicros = toMicros(input.quantity);
      const priceMicros = toMicros(input.markPrice);
      const diffMicros = priceMicros - avgCostMicros;
      const upnlMicros = Number(
        (BigInt(diffMicros) * BigInt(qtyMicros)) / BigInt(1_000_000),
      );
      unrealizedPnl = fromMicros(upnlMicros);
    } catch {
      unrealizedPnl = null;
    }
  }

  return {
    symbol: input.symbol,
    direction: input.direction,
    quantity: input.quantity,
    averageCost: input.averageCost,
    totalCostBasis: input.totalCostBasis,
    markStatus,
    markPrice: input.markPrice,
    markedValue,
    unrealizedPnl,
    realizedGrossPnl: input.realizedGrossPnl,
    realizedNetPnl: input.realizedNetPnl,
  };
}

/**
 * Map multiple position states to display rows.
 *
 * @param inputs - Array of position row inputs.
 * @returns Array of position display rows.
 */
export function mapPositionRows(inputs: PositionRowInput[]): PositionRow[] {
  return inputs.map(mapPositionRow);
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers (micros conversions, pure arithmetic)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Parse a canonical decimal string to integer micros (1e-6 precision).
 *
 * e.g. "1000.00" → 1_000_000_000
 *
 * This is a local pure-function implementation. The canonical source
 * of this conversion is src/lib/accounting/decimal.ts but we keep
 * a local copy to avoid importing database-adjacent modules.
 */
function toMicros(value: string): number {
  const cleaned = value.replace(/^-/, '');
  const parts = cleaned.split('.');
  const whole = parts[0]?.replace(/^0+/, '') || '0';
  const fraction = parts[1] ?? '00';
  // Pad or truncate fraction to exactly 2 digits
  const paddedFraction = fraction.padEnd(2, '0').slice(0, 2);
  const isNegative = value.startsWith('-');
  const micros = Number(whole) * 1_000_000 + Number(paddedFraction) * 10_000;
  return isNegative ? -micros : micros;
}

/**
 * Format integer micros back to canonical decimal string.
 *
 * e.g. 1_000_000_000 → "1000.00"
 */
function fromMicros(micros: number): string {
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / 1_000_000);
  const fraction = abs % 1_000_000;
  const fractionStr = String(Math.round(fraction / 10_000)).padStart(2, '0');
  const result = `${whole}.${fractionStr}`;
  return micros < 0 ? `-${result}` : result;
}
