/**
 * Performance KPI Catalogue
 *
 * Maps the 18 KPI metric IDs from the performance widget registry to:
 * - data accessor: which field in the analytics kpiMetrics response provides the value
 * - format kind: currency / percent / ratio / r / count / duration
 * - supported units: which global unit selections apply to this metric
 *
 * Also provides unit conversion helpers:
 * - toPercent: value relative to period-start equity where meaningful
 * - toR: P&L / initial risk using the R-multiple guard (null when initialRiskAmount <= 0)
 *
 * Fixed-semantic metrics (Win Rate stays %, Trade Count stays count, Profit Factor
 * stays ratio, Holding Duration stays time, Average R stays R) never convert.
 */

import type { SupportedUnit } from './performance-view-types';

export type { SupportedUnit } from './performance-view-types';

// ── Types ───────────────────────────────────────────────────────────────────

export type KpiFormatKind = 'currency' | 'percent' | 'ratio' | 'r' | 'count' | 'duration';

/**
 * How a metric's value maps to the financial semantic colors.
 *
 * - `signed`: sign carries P&L direction (positive → profit, negative → loss).
 * - `inverse`: a positive magnitude is itself a loss state (drawdowns, loss
 *   magnitudes are stored/displayed positive but mean negative).
 * - `threshold`: value relative to 1.0 is the outcome (profit factor,
 *   payoff ratio — >1 healthy, <1 losing).
 * - `neutral`: no P&L direction (win rate, counts, duration, fees) — stays in
 *   the default foreground.
 */
export type KpiValueSemantics = 'signed' | 'inverse' | 'threshold' | 'neutral';

export interface KpiMetricDefinition {
  id: string;
  title: string;
  formatKind: KpiFormatKind;
  /** Resolve the raw value from the analytics kpiMetrics response. */
  accessor: (kpiMetrics: Record<string, unknown>) => number | null;
  /** Which global units this metric can be presented in. */
  supportedUnits: SupportedUnit[];
  /** Value → financial-color semantics (P&L direction of the headline number). */
  valueSemantics: KpiValueSemantics;
}

// ── Value Helpers ───────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

// ── Catalogue ───────────────────────────────────────────────────────────────

/**
 * All 18 registered KPI metrics with their data accessors.
 * IDs match PERFORMANCE_WIDGET_IDS from performance-widget-registry.ts.
 */
export const PERFORMANCE_KPI_CATALOGUE: Record<string, KpiMetricDefinition> = {
  'net-pnl': {
    id: 'net-pnl',
    title: 'Net P&L',
    formatKind: 'currency',
    accessor: (k) => num(k.netPnl),
    supportedUnits: ['currency', 'percent', 'r'],
    valueSemantics: 'signed',
  },
  'gross-pnl': {
    id: 'gross-pnl',
    title: 'Gross P&L',
    formatKind: 'currency',
    accessor: (k) => {
      const g = obj(k.grossPnl);
      return g ? num(g.grossPnl) : null;
    },
    supportedUnits: ['currency', 'percent'],
    valueSemantics: 'signed',
  },
  'total-trades': {
    id: 'total-trades',
    title: 'Total Trades',
    formatKind: 'count',
    accessor: (k) => num(k.closedTrades),
    supportedUnits: ['fixed'],
    valueSemantics: 'neutral',
  },
  'win-rate': {
    id: 'win-rate',
    title: 'Win Rate',
    formatKind: 'percent',
    accessor: (k) => num(k.winRate),
    supportedUnits: ['fixed'],
    valueSemantics: 'neutral',
  },
  'day-win-rate': {
    id: 'day-win-rate',
    title: 'Day Win Rate',
    formatKind: 'percent',
    accessor: (k) => num(k.dayWinRate),
    supportedUnits: ['fixed'],
    valueSemantics: 'neutral',
  },
  'profit-factor': {
    id: 'profit-factor',
    title: 'Profit Factor',
    formatKind: 'ratio',
    accessor: (k) => num(k.profitFactor),
    supportedUnits: ['fixed'],
    valueSemantics: 'threshold',
  },
  'expectancy': {
    id: 'expectancy',
    title: 'Expectancy',
    formatKind: 'currency',
    accessor: (k) => num(k.expectancy),
    supportedUnits: ['currency', 'percent', 'r'],
    valueSemantics: 'signed',
  },
  'average-r': {
    id: 'average-r',
    title: 'Average R',
    formatKind: 'r',
    accessor: (k) => num(k.avgR),
    supportedUnits: ['fixed'],
    valueSemantics: 'signed',
  },
  'median-r': {
    id: 'median-r',
    title: 'Median R',
    formatKind: 'r',
    accessor: (k) => num(k.medianR),
    supportedUnits: ['fixed'],
    valueSemantics: 'signed',
  },
  'average-win': {
    id: 'average-win',
    title: 'Average Win',
    formatKind: 'currency',
    accessor: (k) => num(k.avgWin),
    supportedUnits: ['currency', 'percent', 'r'],
    valueSemantics: 'signed',
  },
  'average-loss': {
    id: 'average-loss',
    title: 'Average Loss',
    formatKind: 'currency',
    accessor: (k) => {
      const v = num(k.avgLoss);
      return v !== null ? Math.abs(v) : null;
    },
    supportedUnits: ['currency', 'percent', 'r'],
    valueSemantics: 'inverse',
  },
  'payoff-ratio': {
    id: 'payoff-ratio',
    title: 'Payoff Ratio',
    formatKind: 'ratio',
    accessor: (k) => num(k.payoffRatio),
    supportedUnits: ['fixed'],
    valueSemantics: 'threshold',
  },
  'largest-win': {
    id: 'largest-win',
    title: 'Largest Win',
    formatKind: 'currency',
    accessor: (k) => num(k.bestTrade),
    supportedUnits: ['currency', 'percent', 'r'],
    valueSemantics: 'signed',
  },
  'largest-loss': {
    id: 'largest-loss',
    title: 'Largest Loss',
    formatKind: 'currency',
    accessor: (k) => {
      const v = num(k.worstTrade);
      return v !== null ? Math.abs(v) : null;
    },
    supportedUnits: ['currency', 'percent', 'r'],
    valueSemantics: 'inverse',
  },
  'average-holding-duration': {
    id: 'average-holding-duration',
    title: 'Avg Holding Duration',
    formatKind: 'duration',
    accessor: (k) => num(k.averageHoldingDays),
    supportedUnits: ['fixed'],
    valueSemantics: 'neutral',
  },
  'max-drawdown': {
    id: 'max-drawdown',
    title: 'Max Drawdown',
    formatKind: 'currency',
    accessor: (k) => {
      const m = obj(k.maxDrawdown);
      return m ? num(m.amount) : null;
    },
    supportedUnits: ['currency', 'percent'],
    valueSemantics: 'inverse',
  },
  'current-drawdown': {
    id: 'current-drawdown',
    title: 'Current Drawdown',
    formatKind: 'currency',
    accessor: (k) => num(k.currentDrawdown),
    supportedUnits: ['currency', 'percent'],
    valueSemantics: 'inverse',
  },
  'total-fees': {
    id: 'total-fees',
    title: 'Total Fees',
    formatKind: 'currency',
    accessor: (k) => num(k.totalFees),
    supportedUnits: ['currency'],
    valueSemantics: 'neutral',
  },
};

// ── Value → financial-color semantics ───────────────────────────────────────

/**
 * Map a metric value to the semantic P&L text class.
 *
 * Follows the design-system P&L color rule (tokens.md: `formatPnlClass`
 * drives `text-positive` / `text-negative`; zero and missing values use
 * `text-muted-foreground`) while accounting for each metric's meaning:
 * signed values color by sign; inverse metrics (drawdowns, loss magnitudes)
 * render their positive magnitude in `--negative`; threshold metrics color by
 * the 1.0 edge; neutral metrics keep the default foreground. Returns an empty
 * string for neutral so the value inherits the card foreground.
 */
export function kpiValueClass(semantics: KpiValueSemantics, value: number | null): string {
  if (value === null) return 'text-muted-foreground';
  switch (semantics) {
    case 'threshold':
      if (value > 1) return 'text-positive';
      if (value < 1) return 'text-negative';
      return 'text-muted-foreground';
    case 'inverse':
      return value > 0 ? 'text-negative' : 'text-muted-foreground';
    case 'signed':
      if (value > 0) return 'text-positive';
      if (value < 0) return 'text-negative';
      return 'text-muted-foreground';
    default:
      return '';
  }
}

export function getKpiMetricDefinition(metricId: string): KpiMetricDefinition | null {
  return PERFORMANCE_KPI_CATALOGUE[metricId] ?? null;
}

// ── Unit Conversion Helpers ─────────────────────────────────────────────────

/**
 * Denomination context shared by every presentation conversion (KPI cards and
 * chart series). The canonical denominators come from the analytics response
 * metadata (`metadata.periodStartEquity`, `metadata.totalInitialRisk`); this
 * is the single source for `%` and `R` conversion. Do not read denominators
 * from kpiMetrics — production does not return them there.
 */
export interface PerformanceUnitContext {
  /** % denominator: period-start equity for the selected analytical scope. */
  periodStartEquity: number | null;
  /** R denominator: aggregate eligible initial risk for the selected scope. */
  totalInitialRisk: number | null;
}

/**
 * Convert a scalar currency P&L value to the selected presentation unit.
 *
 * - `currency` → unchanged (canonical monetary P&L).
 * - `percent` → value / period-start equity (null when equity missing/≤0).
 * - `r` → value / aggregate eligible initial risk (null when risk missing/≤0).
 * - `fixed` → unchanged (native semantics; caller should not route fixed
 *   metrics here).
 *
 * This is the one shared conversion used by both KpiCard and the chart
 * builders, so the `$ / % / R` contract cannot diverge between surfaces.
 * Returns null (unavailable) rather than a fabricated 0 when the target
 * unit's denominator is absent or invalid.
 */
export function convertCurrencyValue(
  value: number,
  unit: SupportedUnit,
  context: PerformanceUnitContext,
): number | null {
  if (unit === 'percent') return currencyToPercent(value, context.periodStartEquity);
  if (unit === 'r') return currencyToR(value, context.totalInitialRisk);
  return value;
}

/**
 * Convert a currency value to a percentage of period-start equity.
 * Returns null when periodStartEquity is missing or non-positive.
 */
export function currencyToPercent(value: number, periodStartEquity: number | null): number | null {
  if (periodStartEquity === null || periodStartEquity <= 0) return null;
  return value / periodStartEquity;
}

/**
 * Convert a currency value to R-multiples: value / initialRisk.
 * R-multiple guard: returns null when initialRisk <= 0 (AGENTS.md invariant 4).
 */
export function currencyToR(value: number, initialRisk: number | null): number | null {
  if (initialRisk === null || initialRisk <= 0) return null;
  return value / initialRisk;
}

/**
 * Apply the global unit to a metric value.
 * Fixed-semantic metrics are never converted.
 * Returns { value, unit } where unit describes the resulting presentation.
 */
export function applyUnit(
  value: number | null,
  definition: KpiMetricDefinition,
  unit: SupportedUnit,
  context: PerformanceUnitContext,
): { value: number | null; unit: SupportedUnit } {
  if (value === null) return { value: null, unit };

  // Fixed-semantic metrics ignore the global unit selector.
  if (definition.supportedUnits.length === 1 && definition.supportedUnits[0] === 'fixed') {
    return { value, unit: 'fixed' };
  }

  // The metric must declare support for the requested unit.
  if (!definition.supportedUnits.includes(unit)) {
    // Graceful fallback: keep the metric's native presentation.
    return { value, unit: 'currency' };
  }

  // Shared scalar conversion: percent-of-equity / R-multiple (guards included).
  const converted = convertCurrencyValue(value, unit, context);
  return { value: converted, unit };
}
