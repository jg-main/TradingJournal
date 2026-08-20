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

// ── Types ───────────────────────────────────────────────────────────────────

export type KpiFormatKind = 'currency' | 'percent' | 'ratio' | 'r' | 'count' | 'duration';

export interface KpiMetricDefinition {
  id: string;
  title: string;
  formatKind: KpiFormatKind;
  /** Resolve the raw value from the analytics kpiMetrics response. */
  accessor: (kpiMetrics: Record<string, unknown>) => number | null;
  /** Which global units this metric can be presented in. */
  supportedUnits: SupportedUnit[];
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
  },
  'total-trades': {
    id: 'total-trades',
    title: 'Total Trades',
    formatKind: 'count',
    accessor: (k) => num(k.closedTrades),
    supportedUnits: ['fixed'],
  },
  'win-rate': {
    id: 'win-rate',
    title: 'Win Rate',
    formatKind: 'percent',
    accessor: (k) => num(k.winRate),
    supportedUnits: ['fixed'],
  },
  'day-win-rate': {
    id: 'day-win-rate',
    title: 'Day Win Rate',
    formatKind: 'percent',
    accessor: (k) => num(k.dayWinRate),
    supportedUnits: ['fixed'],
  },
  'profit-factor': {
    id: 'profit-factor',
    title: 'Profit Factor',
    formatKind: 'ratio',
    accessor: (k) => num(k.profitFactor),
    supportedUnits: ['fixed'],
  },
  'expectancy': {
    id: 'expectancy',
    title: 'Expectancy',
    formatKind: 'currency',
    accessor: (k) => num(k.expectancy),
    supportedUnits: ['currency', 'percent', 'r'],
  },
  'average-r': {
    id: 'average-r',
    title: 'Average R',
    formatKind: 'r',
    accessor: (k) => num(k.avgR),
    supportedUnits: ['fixed'],
  },
  'median-r': {
    id: 'median-r',
    title: 'Median R',
    formatKind: 'r',
    accessor: (k) => num(k.medianR),
    supportedUnits: ['fixed'],
  },
  'average-win': {
    id: 'average-win',
    title: 'Average Win',
    formatKind: 'currency',
    accessor: (k) => num(k.avgWin),
    supportedUnits: ['currency', 'percent', 'r'],
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
  },
  'payoff-ratio': {
    id: 'payoff-ratio',
    title: 'Payoff Ratio',
    formatKind: 'ratio',
    accessor: (k) => num(k.payoffRatio),
    supportedUnits: ['fixed'],
  },
  'largest-win': {
    id: 'largest-win',
    title: 'Largest Win',
    formatKind: 'currency',
    accessor: (k) => num(k.bestTrade),
    supportedUnits: ['currency', 'percent', 'r'],
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
  },
  'average-holding-duration': {
    id: 'average-holding-duration',
    title: 'Avg Holding Duration',
    formatKind: 'duration',
    accessor: (k) => num(k.averageHoldingDays),
    supportedUnits: ['fixed'],
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
  },
  'current-drawdown': {
    id: 'current-drawdown',
    title: 'Current Drawdown',
    formatKind: 'currency',
    accessor: (k) => num(k.currentDrawdown),
    supportedUnits: ['currency', 'percent'],
  },
  'total-fees': {
    id: 'total-fees',
    title: 'Total Fees',
    formatKind: 'currency',
    accessor: (k) => num(k.totalFees),
    supportedUnits: ['currency'],
  },
};

export function getKpiMetricDefinition(metricId: string): KpiMetricDefinition | null {
  return PERFORMANCE_KPI_CATALOGUE[metricId] ?? null;
}

// ── Unit Conversion Helpers ─────────────────────────────────────────────────

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
  context: { periodStartEquity: number | null; totalInitialRisk: number | null },
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

  if (unit === 'percent') {
    const pct = currencyToPercent(value, context.periodStartEquity);
    return { value: pct, unit: 'percent' };
  }
  if (unit === 'r') {
    const r = currencyToR(value, context.totalInitialRisk);
    return { value: r, unit: 'r' };
  }
  return { value, unit: 'currency' };
}
