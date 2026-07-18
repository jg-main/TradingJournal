/**
 * Dashboard Widget Registry — immutable source of truth for all dashboard
 * widget definitions.
 *
 * Uses an `as const satisfies Record<string, WidgetDefinition>` pattern so
 * that TypeScript narrows literal types while enforcing the interface.
 *
 * This file is created by milestone M002 as the foundation for the unified
 * dashboard grid refactor.  It replaces the scattered CHART_WIDGET_IDS /
 * DEFAULT_CHART_LAYOUT / CHART_TITLES / PTD_WIDGET_IDS / CURRENT_STATE_WIDGET_IDS
 * / DEFAULT_KPI_LAYOUT / KPI_WIDGET_MAP constants that previously lived in
 * page.tsx and kpi-widgets.tsx.
 *
 * ## Widget Categories
 *
 * | Category      | Widgets                                        |
 * |---------------|------------------------------------------------|
 * | `metrics`     | account-performance, ptd-performance, current-risk |
 * | `charts`      | equity-drawdown, calendar-heatmap, setup-ranking, process-discipline, monthly-performance, r-distribution, period-matrix, attention-insights, directional-performance |
 * | `valuation`   | valuation-positions, open-positions-risk        |
 *
 * ## Default Layout
 *
 * All widgets are positioned on a 12-column react-grid-layout grid ordered
 * logically: metric panels (top) → primary charts → secondary charts →
 * valuation details.
 *
 * @example
 * ```tsx
 * import { WIDGET_REGISTRY, defaultLayoutFor } from './widget-registry';
 *
 * // Get the default layout for every visible widget
 * const layout = Object.values(WIDGET_REGISTRY)
 *   .filter((w) => w.defaultVisibility)
 *   .map((w) => defaultLayoutFor(w.id));
 * ```
 */

import type { LayoutItem } from 'react-grid-layout';

// ── Widget IDs ─────────────────────────────────────────────────────────

/**
 * Immutable map of all registered dashboard widget IDs.
 *
 * Convention: `kebab-case` matching react-grid-layout `i` keys.
 */
export const WIDGET_IDS = {
  // ── Grouped Metric Panels (replace 11 individual KPI cards) ──────
  ACCOUNT_PERFORMANCE: 'account-performance',
  PTD_PERFORMANCE: 'ptd-performance',
  CURRENT_RISK: 'current-risk',

  // ── Chart Widgets ────────────────────────────────────────────────
  EQUITY_DRAWDOWN: 'equity-drawdown',
  CALENDAR_HEATMAP: 'calendar-heatmap',
  SETUP_RANKING: 'setup-ranking',
  PROCESS_DISCIPLINE: 'process-discipline',
  MONTHLY_PERFORMANCE: 'monthly-performance',
  R_DISTRIBUTION: 'r-distribution',
  PERIOD_MATRIX: 'period-matrix',
  ATTENTION_INSIGHTS: 'attention-insights',
  DIRECTIONAL_PERFORMANCE: 'directional-performance',

  // ── Valuation / Account Details ──────────────────────────────────
  VALUATION_POSITIONS: 'valuation-positions',
  OPEN_POSITIONS_RISK: 'open-positions-risk',
} as const;

/** Union type of all registered widget ID string values */
export type WidgetId = (typeof WIDGET_IDS)[keyof typeof WIDGET_IDS];

// ── Widget Categories ──────────────────────────────────────────────────

/** Categories used by the customization UI to group widgets visually. */
export type WidgetCategory = 'metrics' | 'charts' | 'valuation';

// ── Widget Definition ──────────────────────────────────────────────────

/**
 * Metadata for one widget in the registry.
 *
 * The `defaultLayout` omits `i` (the widget ID) because the registry key
 * already carries that information.  Use `defaultLayoutFor(id)` to produce
 * a complete `LayoutItem`.
 */
export interface WidgetDefinition {
  /** Unique widget identifier (kebab-case, matches LayoutItem.i) */
  readonly id: WidgetId;
  /** Human-readable title shown in the widget header and customization UI */
  readonly title: string;
  /** Visual category for grouping in the customization panel */
  readonly category: WidgetCategory;
  /**
   * Default grid position/min-sizes on a 12-column layout.
   * The `i` field is omitted — supply it at consumption time via
   * `defaultLayoutFor(id)`.
   */
  readonly defaultLayout: Omit<LayoutItem, 'i'>;
  /** Whether this widget is visible in the default view */
  readonly defaultVisibility: boolean;
}

// ── Registry ───────────────────────────────────────────────────────────

/**
 * Immutable widget registry — the single source of truth.
 *
 * Every dashboard widget is defined here.  The registry is exported as a
 * const record so consumers can iterate, filter, or look up by ID with full
 * type safety.
 *
 * **Adding a new widget:**
 * 1. Add its ID to `WIDGET_IDS` above.
 * 2. Add its entry to `WIDGET_REGISTRY`.
 * 3. Create the React component.
 * 4. Wire the component in the widget component map (see T06).
 */
export const WIDGET_REGISTRY = {
  // ═══════════════════════════════════════════════════════════════════
  // Grouped Metric Panels
  // ═══════════════════════════════════════════════════════════════════

  [WIDGET_IDS.ACCOUNT_PERFORMANCE]: {
    id: WIDGET_IDS.ACCOUNT_PERFORMANCE,
    title: 'Account Performance',
    category: 'metrics',
    defaultLayout: {
      x: 0, y: 0, w: 4, h: 2,
      minW: 4, minH: 2,
    },
    defaultVisibility: true,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.PTD_PERFORMANCE]: {
    id: WIDGET_IDS.PTD_PERFORMANCE,
    title: 'PTD Performance',
    category: 'metrics',
    defaultLayout: {
      x: 4, y: 0, w: 4, h: 2,
      minW: 4, minH: 2,
    },
    defaultVisibility: true,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.CURRENT_RISK]: {
    id: WIDGET_IDS.CURRENT_RISK,
    title: 'Current Risk',
    category: 'metrics',
    defaultLayout: {
      x: 8, y: 0, w: 4, h: 2,
      minW: 4, minH: 2,
    },
    defaultVisibility: true,
  } satisfies WidgetDefinition,

  // ═══════════════════════════════════════════════════════════════════
  // Chart Widgets
  // ═══════════════════════════════════════════════════════════════════

  [WIDGET_IDS.EQUITY_DRAWDOWN]: {
    id: WIDGET_IDS.EQUITY_DRAWDOWN,
    title: 'Equity & Drawdown',
    category: 'charts',
    defaultLayout: {
      x: 0, y: 2, w: 7, h: 5,
      minW: 6, minH: 3,
    },
    defaultVisibility: true,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.CALENDAR_HEATMAP]: {
    id: WIDGET_IDS.CALENDAR_HEATMAP,
    title: 'Calendar Heatmap',
    category: 'charts',
    defaultLayout: {
      x: 0, y: 12, w: 6, h: 3,
      minW: 6, minH: 3,
    },
    defaultVisibility: false,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.SETUP_RANKING]: {
    id: WIDGET_IDS.SETUP_RANKING,
    title: 'Setup Ranking',
    category: 'charts',
    defaultLayout: {
      x: 4, y: 7, w: 4, h: 3,
      minW: 4, minH: 2,
    },
    defaultVisibility: true,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.PROCESS_DISCIPLINE]: {
    id: WIDGET_IDS.PROCESS_DISCIPLINE,
    title: 'Process Discipline',
    category: 'charts',
    defaultLayout: {
      x: 6, y: 12, w: 6, h: 2,
      minW: 4, minH: 2,
    },
    defaultVisibility: false,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.MONTHLY_PERFORMANCE]: {
    id: WIDGET_IDS.MONTHLY_PERFORMANCE,
    title: 'Monthly Performance',
    category: 'charts',
    defaultLayout: {
      x: 0, y: 14, w: 6, h: 2,
      minW: 4, minH: 2,
    },
    defaultVisibility: false,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.R_DISTRIBUTION]: {
    id: WIDGET_IDS.R_DISTRIBUTION,
    title: 'R Distribution',
    category: 'charts',
    defaultLayout: {
      x: 6, y: 14, w: 6, h: 2,
      minW: 4, minH: 2,
    },
    defaultVisibility: false,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.PERIOD_MATRIX]: {
    id: WIDGET_IDS.PERIOD_MATRIX,
    title: 'Period Comparison',
    category: 'charts',
    defaultLayout: {
      x: 0, y: 7, w: 4, h: 3,
      minW: 4, minH: 3,
    },
    defaultVisibility: true,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.ATTENTION_INSIGHTS]: {
    id: WIDGET_IDS.ATTENTION_INSIGHTS,
    title: 'Attention Insights',
    category: 'charts',
    defaultLayout: {
      x: 8, y: 7, w: 4, h: 3,
      minW: 4, minH: 2,
    },
    defaultVisibility: true,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.DIRECTIONAL_PERFORMANCE]: {
    id: WIDGET_IDS.DIRECTIONAL_PERFORMANCE,
    title: 'Directional Performance',
    category: 'charts',
    defaultLayout: {
      x: 0, y: 14, w: 6, h: 2,
      minW: 6, minH: 2,
    },
    defaultVisibility: false,
  } satisfies WidgetDefinition,

  // ═══════════════════════════════════════════════════════════════════
  // Valuation / Account Details
  // ═══════════════════════════════════════════════════════════════════

  [WIDGET_IDS.OPEN_POSITIONS_RISK]: {
    id: WIDGET_IDS.OPEN_POSITIONS_RISK,
    title: 'Open Positions & Risk',
    category: 'valuation',
    defaultLayout: {
      x: 7, y: 2, w: 5, h: 5,
      minW: 4, minH: 3,
    },
    defaultVisibility: true,
  } satisfies WidgetDefinition,

  [WIDGET_IDS.VALUATION_POSITIONS]: {
    id: WIDGET_IDS.VALUATION_POSITIONS,
    title: 'Valuation Positions',
    category: 'valuation',
    defaultLayout: {
      x: 0, y: 20, w: 6, h: 2,
      minW: 6, minH: 2,
    },
    defaultVisibility: false,
  } satisfies WidgetDefinition,
} as const satisfies Record<WidgetId, WidgetDefinition>;

// ── Helper: Default Layout ─────────────────────────────────────────────

/**
 * Return a complete `LayoutItem` for a widget ID, combining the registry's
 * default layout with the widget ID as the `i` key.
 *
 * Useful when building the initial layout array for `useDashboardLayout`.
 *
 * @param id — A registered widget ID.
 * @returns A `LayoutItem` with `i` populated.
 */
export function defaultLayoutFor(id: WidgetId): LayoutItem {
  const def = WIDGET_REGISTRY[id];
  return { i: id, ...def.defaultLayout };
}

// ── Convenience Arrays ─────────────────────────────────────────────────

/** Widget IDs that belong to the `metrics` category. */
export const METRIC_WIDGET_IDS: readonly WidgetId[] = (
  Object.values(WIDGET_REGISTRY)
    .filter((w) => w.category === 'metrics')
    .map((w) => w.id)
);

/** Widget IDs that belong to the `charts` category. */
export const CHART_WIDGET_IDS: readonly WidgetId[] = (
  Object.values(WIDGET_REGISTRY)
    .filter((w) => w.category === 'charts')
    .map((w) => w.id)
);

/** Widget IDs that belong to the `valuation` category. */
export const VALUATION_WIDGET_IDS: readonly WidgetId[] = (
  Object.values(WIDGET_REGISTRY)
    .filter((w) => w.category === 'valuation')
    .map((w) => w.id)
);

/**
 * Default unified layout for all visible widgets, ordered by grid position
 * (y ascending).  Consumers should spread this array into `useDashboardLayout`
 * as the initial `defaultLayout`.
 */
export const DEFAULT_UNIFIED_LAYOUT: LayoutItem[] = (
  Object.values(WIDGET_REGISTRY)
    .filter((w) => w.defaultVisibility)
    .map((w) => defaultLayoutFor(w.id))
    .sort((a, b) => a.y - b.y || a.x - b.x)
);
