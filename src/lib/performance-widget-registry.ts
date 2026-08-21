/**
 * Performance Widget Registry
 *
 * Immutable source of truth for all Performance dashboard widget definitions.
 * Uses an instance model (instanceId + widgetType) to support widget duplication.
 *
 * Each widget declares supportedUnits for $/%/R conversion.
 * Fixed-semantic metrics (Win Rate stays %, Trade Count stays count) use 'fixed'.
 *
 * Pattern: mirrors widget-registry.ts but with instance model and supportedUnits.
 */

import type { PerformanceWidgetDefinition, PerformanceUnit, SupportedUnit, WidgetConfig, WidgetConfigSchema } from './performance-view-types';
import { PERFORMANCE_KPI_CATALOGUE } from './performance-kpi-catalogue';

// ── Widget IDs ──────────────────────────────────────────────────────────────

/**
 * Immutable map of all registered Performance widget type IDs.
 * These are widget TYPES, not instances. Instance IDs are generated at runtime.
 */
export const PERFORMANCE_WIDGET_IDS = {
  // ── KPI Metrics ────────────────────────────────────────────────────────
  NET_PNL: 'net-pnl',
  GROSS_PNL: 'gross-pnl',
  TOTAL_TRADES: 'total-trades',
  WIN_RATE: 'win-rate',
  DAY_WIN_RATE: 'day-win-rate',
  PROFIT_FACTOR: 'profit-factor',
  EXPECTANCY: 'expectancy',
  AVERAGE_R: 'average-r',
  MEDIAN_R: 'median-r',
  AVERAGE_WIN: 'average-win',
  AVERAGE_LOSS: 'average-loss',
  PAYOFF_RATIO: 'payoff-ratio',
  LARGEST_WIN: 'largest-win',
  LARGEST_LOSS: 'largest-loss',
  AVERAGE_HOLDING_DURATION: 'average-holding-duration',
  MAX_DRAWDOWN: 'max-drawdown',
  CURRENT_DRAWDOWN: 'current-drawdown',
  TOTAL_FEES: 'total-fees',

  // ── Chart Widgets (Must-Have) ──────────────────────────────────────────
  DAILY_CUMULATIVE_PNL: 'daily-cumulative-pnl',
  NET_DAILY_PNL: 'net-daily-pnl',
  TRADE_DURATION_PERFORMANCE: 'trade-duration-performance',
  DRAWDOWN_CURVE: 'drawdown-curve',
  R_DISTRIBUTION: 'r-distribution',
  PERFORMANCE_BY_SETUP: 'performance-by-setup',

  // ── Chart Widgets (High-Priority) ──────────────────────────────────────
  PERFORMANCE_BY_DAY_OF_WEEK: 'performance-by-day-of-week',
  PERFORMANCE_BY_TIME_OF_DAY: 'performance-by-time-of-day',
  LONG_VS_SHORT: 'long-vs-short',
  MONTHLY_PNL: 'monthly-pnl',
} as const;

export type PerformanceWidgetId = (typeof PERFORMANCE_WIDGET_IDS)[keyof typeof PERFORMANCE_WIDGET_IDS];

// ── Widget Registry ─────────────────────────────────────────────────────────

/**
 * Complete catalogue of Performance dashboard widgets.
 * Each definition includes supportedUnits for $/%/R conversion.
 */
export const PERFORMANCE_WIDGET_REGISTRY: Record<string, PerformanceWidgetDefinition> = {
  // ── KPI Metrics ────────────────────────────────────────────────────────
  [PERFORMANCE_WIDGET_IDS.NET_PNL]: {
    id: PERFORMANCE_WIDGET_IDS.NET_PNL,
    title: 'Net P&L',
    description: 'Total net profit/loss after fees',
    category: 'kpi',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 3, h: 2, x: 0, y: 0 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 3 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.GROSS_PNL]: {
    id: PERFORMANCE_WIDGET_IDS.GROSS_PNL,
    title: 'Gross P&L',
    description: 'Total gross profit/loss before fees',
    category: 'kpi',
    supportedUnits: ['currency', 'percent'],
    defaultLayout: { w: 3, h: 2, x: 3, y: 0 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.TOTAL_TRADES]: {
    id: PERFORMANCE_WIDGET_IDS.TOTAL_TRADES,
    title: 'Total Trades',
    description: 'Number of closed trades',
    category: 'kpi',
    supportedUnits: ['fixed'], // Count is always a count
    defaultLayout: { w: 3, h: 2, x: 6, y: 0 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.WIN_RATE]: {
    id: PERFORMANCE_WIDGET_IDS.WIN_RATE,
    title: 'Win Rate',
    description: 'Percentage of winning trades',
    category: 'kpi',
    supportedUnits: ['fixed'], // Win rate is always %
    defaultLayout: { w: 3, h: 2, x: 9, y: 0 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.DAY_WIN_RATE]: {
    id: PERFORMANCE_WIDGET_IDS.DAY_WIN_RATE,
    title: 'Day Win Rate',
    description: 'Win rate computed per-day then averaged',
    category: 'kpi',
    supportedUnits: ['fixed'],
    defaultLayout: { w: 3, h: 2, x: 0, y: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.PROFIT_FACTOR]: {
    id: PERFORMANCE_WIDGET_IDS.PROFIT_FACTOR,
    title: 'Profit Factor',
    description: 'Gross profits / absolute gross losses',
    category: 'kpi',
    supportedUnits: ['fixed'], // Ratio is always a ratio
    defaultLayout: { w: 3, h: 2, x: 3, y: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.EXPECTANCY]: {
    id: PERFORMANCE_WIDGET_IDS.EXPECTANCY,
    title: 'Expectancy',
    description: 'Average P&L per trade',
    category: 'kpi',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 3, h: 2, x: 6, y: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.AVERAGE_R]: {
    id: PERFORMANCE_WIDGET_IDS.AVERAGE_R,
    title: 'Average R',
    description: 'Average R-multiple per trade',
    category: 'kpi',
    supportedUnits: ['fixed'], // R-multiple is always R
    defaultLayout: { w: 3, h: 2, x: 9, y: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.MEDIAN_R]: {
    id: PERFORMANCE_WIDGET_IDS.MEDIAN_R,
    title: 'Median R',
    description: 'Median R-multiple per trade',
    category: 'kpi',
    supportedUnits: ['fixed'],
    defaultLayout: { w: 3, h: 2, x: 0, y: 4 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.AVERAGE_WIN]: {
    id: PERFORMANCE_WIDGET_IDS.AVERAGE_WIN,
    title: 'Average Win',
    description: 'Average P&L of winning trades',
    category: 'kpi',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 3, h: 2, x: 3, y: 4 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.AVERAGE_LOSS]: {
    id: PERFORMANCE_WIDGET_IDS.AVERAGE_LOSS,
    title: 'Average Loss',
    description: 'Average P&L of losing trades',
    category: 'kpi',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 3, h: 2, x: 6, y: 4 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.PAYOFF_RATIO]: {
    id: PERFORMANCE_WIDGET_IDS.PAYOFF_RATIO,
    title: 'Payoff Ratio',
    description: 'Average win / average loss',
    category: 'kpi',
    supportedUnits: ['fixed'],
    defaultLayout: { w: 3, h: 2, x: 9, y: 4 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.LARGEST_WIN]: {
    id: PERFORMANCE_WIDGET_IDS.LARGEST_WIN,
    title: 'Largest Win',
    description: 'Best trade P&L',
    category: 'kpi',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 3, h: 2, x: 0, y: 6 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.LARGEST_LOSS]: {
    id: PERFORMANCE_WIDGET_IDS.LARGEST_LOSS,
    title: 'Largest Loss',
    description: 'Worst trade P&L',
    category: 'kpi',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 3, h: 2, x: 3, y: 6 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.AVERAGE_HOLDING_DURATION]: {
    id: PERFORMANCE_WIDGET_IDS.AVERAGE_HOLDING_DURATION,
    title: 'Avg Holding Duration',
    description: 'Average trade holding time',
    category: 'kpi',
    supportedUnits: ['fixed'], // Duration is always time
    defaultLayout: { w: 3, h: 2, x: 6, y: 6 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.MAX_DRAWDOWN]: {
    id: PERFORMANCE_WIDGET_IDS.MAX_DRAWDOWN,
    title: 'Max Drawdown',
    description: 'Largest peak-to-trough decline',
    category: 'kpi',
    supportedUnits: ['currency', 'percent'],
    defaultLayout: { w: 3, h: 2, x: 9, y: 6 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.CURRENT_DRAWDOWN]: {
    id: PERFORMANCE_WIDGET_IDS.CURRENT_DRAWDOWN,
    title: 'Current Drawdown',
    description: 'Current decline from peak',
    category: 'kpi',
    supportedUnits: ['currency', 'percent'],
    defaultLayout: { w: 3, h: 2, x: 0, y: 8 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.TOTAL_FEES]: {
    id: PERFORMANCE_WIDGET_IDS.TOTAL_FEES,
    title: 'Total Fees',
    description: 'Total commissions and fees',
    category: 'kpi',
    supportedUnits: ['currency'],
    defaultLayout: { w: 3, h: 2, x: 3, y: 8 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
    canDuplicate: true,
    defaultVisible: false,
  },

  // ── Chart Widgets (Must-Have) ──────────────────────────────────────────
  [PERFORMANCE_WIDGET_IDS.DAILY_CUMULATIVE_PNL]: {
    id: PERFORMANCE_WIDGET_IDS.DAILY_CUMULATIVE_PNL,
    title: 'Daily Cumulative P&L',
    description: 'Cumulative net P&L over time',
    category: 'chart',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 4, h: 5, x: 0, y: 10 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 10 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.NET_DAILY_PNL]: {
    id: PERFORMANCE_WIDGET_IDS.NET_DAILY_PNL,
    title: 'Net Daily P&L',
    description: 'Net P&L per day (bar chart)',
    category: 'chart',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 4, h: 5, x: 4, y: 10 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.TRADE_DURATION_PERFORMANCE]: {
    id: PERFORMANCE_WIDGET_IDS.TRADE_DURATION_PERFORMANCE,
    title: 'Trade Duration Performance',
    description: 'Individual trade outcome vs holding duration (scatter)',
    category: 'chart',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 4, h: 5, x: 8, y: 10 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.DRAWDOWN_CURVE]: {
    id: PERFORMANCE_WIDGET_IDS.DRAWDOWN_CURVE,
    title: 'Drawdown Curve',
    description: 'Equity drawdown over time',
    category: 'chart',
    supportedUnits: ['currency', 'percent'],
    configSchema: {
      visibleSeries: {
        kind: 'multi-select',
        key: 'visibleSeries',
        label: 'Visible series',
        default: ['drawdownAmount', 'drawdownPct'],
        options: [
          { value: 'drawdownAmount', label: 'Amount ($)' },
          { value: 'drawdownPct', label: 'Percent (%)' },
        ],
      },
    },
    defaultLayout: { w: 4, h: 5, x: 0, y: 15 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.R_DISTRIBUTION]: {
    id: PERFORMANCE_WIDGET_IDS.R_DISTRIBUTION,
    title: 'R-Multiple Distribution',
    description: 'Distribution of R-multiples',
    category: 'chart',
    supportedUnits: ['fixed'], // R-multiples are always R
    defaultLayout: { w: 4, h: 5, x: 4, y: 15 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: true,
  },
  [PERFORMANCE_WIDGET_IDS.PERFORMANCE_BY_SETUP]: {
    id: PERFORMANCE_WIDGET_IDS.PERFORMANCE_BY_SETUP,
    title: 'Performance by Setup',
    description: 'Metrics grouped by trade setup',
    category: 'chart',
    supportedUnits: ['currency', 'percent', 'r'],
    configSchema: {
      metric: {
        kind: 'select',
        key: 'metric',
        label: 'Primary series',
        default: 'netPnl',
        options: [
          { value: 'netPnl', label: 'Net P&L' },
          { value: 'winRate', label: 'Win Rate' },
          { value: 'avgR', label: 'Average R' },
          { value: 'count', label: 'Trade Count' },
        ],
      },
    },
    defaultLayout: { w: 4, h: 5, x: 8, y: 15 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: true,
  },

  // ── Chart Widgets (High-Priority) ──────────────────────────────────────
  [PERFORMANCE_WIDGET_IDS.PERFORMANCE_BY_DAY_OF_WEEK]: {
    id: PERFORMANCE_WIDGET_IDS.PERFORMANCE_BY_DAY_OF_WEEK,
    title: 'Performance by Day of Week',
    description: 'P&L grouped by weekday',
    category: 'chart',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 6, h: 5, x: 0, y: 31 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.PERFORMANCE_BY_TIME_OF_DAY]: {
    id: PERFORMANCE_WIDGET_IDS.PERFORMANCE_BY_TIME_OF_DAY,
    title: 'Performance by Time of Day',
    description: 'P&L grouped by hour',
    category: 'chart',
    supportedUnits: ['currency', 'percent', 'r'],
    defaultLayout: { w: 6, h: 5, x: 6, y: 31 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.LONG_VS_SHORT]: {
    id: PERFORMANCE_WIDGET_IDS.LONG_VS_SHORT,
    title: 'Long vs Short',
    description: 'Performance comparison by direction',
    category: 'chart',
    supportedUnits: ['currency', 'percent', 'r'],
    configSchema: {
      visibleSeries: {
        kind: 'multi-select',
        key: 'visibleSeries',
        label: 'Direction series',
        default: ['long', 'short'],
        options: [
          { value: 'long', label: 'Long' },
          { value: 'short', label: 'Short' },
        ],
      },
    },
    defaultLayout: { w: 6, h: 5, x: 0, y: 36 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: false,
  },
  [PERFORMANCE_WIDGET_IDS.MONTHLY_PNL]: {
    id: PERFORMANCE_WIDGET_IDS.MONTHLY_PNL,
    title: 'Monthly P&L',
    description: 'Net P&L by month',
    category: 'chart',
    supportedUnits: ['currency', 'percent', 'r'],
    configSchema: {
      visibleSeries: {
        kind: 'multi-select',
        key: 'visibleSeries',
        label: 'Visible series',
        default: ['netPnl', 'winRate'],
        options: [
          { value: 'netPnl', label: 'Net P&L' },
          { value: 'winRate', label: 'Win Rate' },
        ],
      },
    },
    defaultLayout: { w: 6, h: 5, x: 6, y: 36 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    canDuplicate: true,
    defaultVisible: false,
  },
} as const;

// ── Helper Functions ────────────────────────────────────────────────────────

/**
 * Get all widget types in a category.
 */
export function getWidgetsByCategory(category: PerformanceWidgetDefinition['category']): PerformanceWidgetDefinition[] {
  return Object.values(PERFORMANCE_WIDGET_REGISTRY).filter((w) => w.category === category);
}

/**
 * Get the set of all valid widget type IDs.
 */
export function getValidWidgetTypes(): Set<string> {
  return new Set(Object.keys(PERFORMANCE_WIDGET_REGISTRY));
}

/**
 * Check if a widget type supports a given unit.
 */
export function widgetSupportsUnit(widgetType: string, unit: string): boolean {
  const widget = PERFORMANCE_WIDGET_REGISTRY[widgetType];
  if (!widget) return false;
  return widget.supportedUnits.includes(unit as 'currency' | 'percent' | 'r' | 'fixed');
}

/**
 * Get default widget instances for the curated default dashboard.
 */
export function getDefaultWidgetInstances(category?: PerformanceWidgetDefinition['category']): Array<{
  instanceId: string;
  widgetType: string;
  category: PerformanceWidgetDefinition['category'];
  config: Record<string, unknown>;
  layout: { x: number; y: number; w: number; h: number };
}> {
  const defaultWidgets = Object.values(PERFORMANCE_WIDGET_REGISTRY).filter((w) => w.defaultVisible && (!category || w.category === category));
  
  return defaultWidgets.map((widget, index) => ({
    instanceId: `default-${widget.id}-${index}`,
    widgetType: widget.id,
    category: widget.category,
    config: {},
    layout: {
      x: widget.defaultLayout.x,
      y: widget.defaultLayout.y,
      w: widget.defaultLayout.w,
      h: widget.defaultLayout.h,
    },
  }));
}

// ── Config Schema Resolution (drives the typed Configure dialog) ─────────────

/**
 * Sentinel value for the KPI unit select's "follow the global unit" option.
 * Radix Select forbids empty-string item values, so the sentinel is a non-empty
 * token that buildConfigFromDraft treats as "no per-widget override".
 */
export const GLOBAL_UNIT_SENTINEL = '__global__' as const;

const UNIT_LABELS: Record<string, string> = {
  currency: 'Currency ($)',
  percent: 'Percent of equity',
  r: 'R-multiples',
};

/**
 * Resolve the effective typed configuration schema for a widget type.
 *
 * KPI widgets derive their fields from the KPI catalogue (metric select, title
 * override) plus a per-widget unit override only when the effective metric
 * supports more than one convertible unit. Chart widgets merge their
 * registry-declared configSchema with the shared chart fields (legend
 * visibility, title override). The registry stays the single source of truth
 * for widget capabilities — the Configure dialog renders exactly the fields
 * this returns, nothing more.
 */
export function getWidgetConfigSchema(
  widgetType: string,
  currentConfig?: WidgetConfig,
): WidgetConfigSchema {
  const definition = PERFORMANCE_WIDGET_REGISTRY[widgetType];
  if (!definition) return {};

  if (definition.category === 'kpi') {
    const metricId = (currentConfig?.metricId as string | undefined) ?? widgetType;
    const metric = PERFORMANCE_KPI_CATALOGUE[metricId];
    const convertibleUnits = (metric?.supportedUnits ?? []).filter(
      (u): u is 'currency' | 'percent' | 'r' => u !== 'fixed',
    );

    const schema: WidgetConfigSchema = {
      metricId: {
        kind: 'select',
        key: 'metricId',
        label: 'Metric',
        default: widgetType,
        options: Object.values(PERFORMANCE_KPI_CATALOGUE).map((m) => ({
          value: m.id,
          label: m.title,
        })),
      },
      titleOverride: {
        kind: 'text',
        key: 'titleOverride',
        label: 'Title',
        default: '',
        placeholder: 'Default title',
      },
    };

    // Unit-relevant option: a per-widget unit override is only meaningful when
    // the effective metric can be presented in more than one unit.
    if (convertibleUnits.length > 1) {
      schema.unit = {
        kind: 'select',
        key: 'unit',
        label: 'Unit',
        default: GLOBAL_UNIT_SENTINEL,
        options: [
          { value: GLOBAL_UNIT_SENTINEL, label: 'Follow global unit' },
          ...convertibleUnits.map((u) => ({ value: u, label: UNIT_LABELS[u] ?? u })),
        ],
      };
    }

    return schema;
  }

  // Chart widgets: registry-declared configSchema fields + shared chart fields.
  return {
    ...(definition.configSchema ?? {}),
    legendVisible: {
      kind: 'boolean',
      key: 'legendVisible',
      label: 'Show legend',
      default: false,
    },
    titleOverride: {
      kind: 'text',
      key: 'titleOverride',
      label: 'Title',
      default: '',
      placeholder: 'Default title',
    },
  };
}

/**
 * Drop config fields the effective KPI metric cannot honor. When a KPI card's
 * selected metric changes, its unit override may no longer be supported (Win
 * Rate is fixed-% while Net P&L supports $/%/R) — remove it so the per-widget
 * unit never silently mismatches the metric's semantics.
 */
export function sanitizeKpiConfig(config: WidgetConfig, widgetType: string): WidgetConfig {
  const metricId = (config.metricId as string | undefined) ?? widgetType;
  const metric = PERFORMANCE_KPI_CATALOGUE[metricId];
  if (!metric) return config;
  const unit = config.unit as PerformanceUnit | undefined;
  if (unit && !metric.supportedUnits.includes(unit as SupportedUnit)) {
    const next: WidgetConfig = { ...config };
    delete next.unit;
    return next;
  }
  return config;
}
