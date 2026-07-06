/**
 * export-csv.ts
 *
 * Pure (no side effects) CSV generation library for trade export.
 * Produces UTF-8 BOM-prefixed CSV strings from pre-loaded trade data.
 * Decoupled from Drizzle — uses its own ExportTradeRow type so this
 * module can be tested independently without a database.
 *
 * Pattern: src/lib/trade-calc.ts, src/lib/grading.ts, src/lib/dashboard.ts
 */

// ── Types ───────────────────────────────────────────────────────────────

/**
 * A fully-resolved trade row ready for CSV serialisation.
 *
 * All related data (executions, grades, mistakes, risk, lookups) must be
 * pre-loaded and collapsed into this shape before calling exportTradesToCsv.
 * Null = no data available for that field.
 */
export interface ExportTradeRow {
  // Trade identity
  tradeCode: string;
  symbol: string;
  direction: string;
  status: string;

  // Lookup names (resolved FK values)
  setup: string | null;
  sector: string | null;
  marketCondition: string | null;

  // Planned values
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedQuantity: number | null;

  // Trade narrative
  thesis: string | null;
  invalidationCondition: string | null;
  preTradePlan: string | null;
  exitNotes: string | null;
  lesson: string | null;

  // Timing
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;

  // Computed P&L (via trade-calc.ts calculatePnL)
  realizedPnL: number | null;
  rMultiple: number | null;
  avgEntryPrice: number | null;
  totalEntryQty: number | null;
  totalExitQty: number | null;
  openQuantity: number | null;
  totalFees: number | null;

  // Grade scores
  setupQualityScore: number | null;
  riskQualityScore: number | null;
  entryQualityScore: number | null;
  managementQualityScore: number | null;
  exitQualityScore: number | null;
  reviewQualityScore: number | null;
  totalScore: number | null;
  gradeLabel: string | null;
  followedPlan: boolean | null;
  ruleViolation: boolean | null;
  gradeNotes: string | null;

  // Risk assessment
  initialRiskAmount: number | null;
  accountRiskPct: number | null;

  // Child record counts
  executionCount: number | null;
  mistakeCount: number | null;
  stopAdjustmentCount: number | null;
}

export interface CsvColumn<T> {
  key: keyof T;
  label: string;
  format?: (value: T[keyof T]) => string;
}

// ── Escape helpers ──────────────────────────────────────────────────────

/**
 * Escape a single CSV field value.
 *
 * - Null/undefined → empty string
 * - Wraps in double quotes if the value contains comma, double-quote, or newline
 * - Escapes internal double-quotes by doubling them
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

// ── Default formatters ──────────────────────────────────────────────────

function formatNumber(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // Round to 2 decimal places for financial values
    return value.toFixed(2);
  }
  return String(value);
}

function formatBoolean(value: unknown): string {
  if (value === null || value === undefined) return '';
  return value ? 'Yes' : 'No';
}

// ── Column definitions ──────────────────────────────────────────────────

export type ExportTradeRowKey = keyof ExportTradeRow;

/**
 * Ordered column definitions for the CSV export.
 *
 * Each entry defines:
 * - key:        Property name on ExportTradeRow
 * - label:      Human-readable column header
 * - format:     Optional formatting function (defaults to escapeCsvField)
 *
 * ~30 columns covering trade identity, lookups, planning, narrative,
 * timing, computed P&L, grade scores, risk assessment, and child counts.
 */
export const CSV_COLUMNS: CsvColumn<ExportTradeRow>[] = [
  // Identity
  { key: 'tradeCode', label: 'Trade Code' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'direction', label: 'Direction' },
  { key: 'status', label: 'Status' },

  // Lookup names
  { key: 'setup', label: 'Setup' },
  { key: 'sector', label: 'Sector' },
  { key: 'marketCondition', label: 'Market Condition' },

  // Planned values
  { key: 'plannedEntry', label: 'Planned Entry', format: formatNumber },
  { key: 'plannedStop', label: 'Planned Stop', format: formatNumber },
  { key: 'plannedTarget1', label: 'Planned Target 1', format: formatNumber },
  { key: 'plannedQuantity', label: 'Planned Quantity', format: formatNumber },

  // Narrative
  { key: 'thesis', label: 'Thesis' },
  { key: 'invalidationCondition', label: 'Invalidation Condition' },
  { key: 'preTradePlan', label: 'Pre-Trade Plan' },
  { key: 'exitNotes', label: 'Exit Notes' },
  { key: 'lesson', label: 'Lesson' },

  // Timing
  { key: 'openedAt', label: 'Opened At' },
  { key: 'closedAt', label: 'Closed At' },
  { key: 'createdAt', label: 'Created At' },
  { key: 'updatedAt', label: 'Updated At' },

  // Computed P&L
  { key: 'realizedPnL', label: 'Realized P&L', format: formatNumber },
  { key: 'rMultiple', label: 'R Multiple', format: formatNumber },
  { key: 'avgEntryPrice', label: 'Avg Entry Price', format: formatNumber },
  { key: 'totalEntryQty', label: 'Total Entry Qty', format: formatNumber },
  { key: 'totalExitQty', label: 'Total Exit Qty', format: formatNumber },
  { key: 'openQuantity', label: 'Open Quantity', format: formatNumber },
  { key: 'totalFees', label: 'Total Fees', format: formatNumber },

  // Grade scores
  { key: 'setupQualityScore', label: 'Setup Quality Score', format: formatNumber },
  { key: 'riskQualityScore', label: 'Risk Quality Score', format: formatNumber },
  { key: 'entryQualityScore', label: 'Entry Quality Score', format: formatNumber },
  { key: 'managementQualityScore', label: 'Management Quality Score', format: formatNumber },
  { key: 'exitQualityScore', label: 'Exit Quality Score', format: formatNumber },
  { key: 'reviewQualityScore', label: 'Review Quality Score', format: formatNumber },
  { key: 'totalScore', label: 'Total Score', format: formatNumber },
  { key: 'gradeLabel', label: 'Grade' },
  { key: 'followedPlan', label: 'Followed Plan', format: formatBoolean },
  { key: 'ruleViolation', label: 'Rule Violation', format: formatBoolean },
  { key: 'gradeNotes', label: 'Grade Notes' },

  // Risk assessment
  { key: 'initialRiskAmount', label: 'Initial Risk Amount', format: formatNumber },
  { key: 'accountRiskPct', label: 'Account Risk %', format: formatNumber },

  // Child record counts
  { key: 'executionCount', label: 'Execution Count', format: formatNumber },
  { key: 'mistakeCount', label: 'Mistake Count', format: formatNumber },
  { key: 'stopAdjustmentCount', label: 'Stop Adjustment Count', format: formatNumber },
];

// ── CSV generation ──────────────────────────────────────────────────────

/**
 * Generate a UTF-8 BOM-prefixed CSV string from an array of trade rows.
 *
 * The first row is the column header (label row), followed by one data row
 * per trade entry. Each field is escaped via escapeCsvField.
 *
 * @param trades - Array of fully-resolved ExportTradeRow objects
 * @returns A CSV string with UTF-8 BOM (\uFEFF) prefix
 */
export function exportTradesToCsv(trades: ExportTradeRow[]): string {
  // Build header row
  const headerRow = CSV_COLUMNS.map((col) => col.label).join(',');

  // Build data rows
  const dataRows = trades.map((trade) => {
    return CSV_COLUMNS.map((col) => {
      const value = trade[col.key];
      if (col.format) {
        return escapeCsvField(col.format(value));
      }
      return escapeCsvField(value);
    }).join(',');
  });

  // Combine: BOM + header + data rows
  const lines = [headerRow, ...dataRows];

  return '\uFEFF' + lines.join('\n') + '\n';
}
