/**
 * Performance Dashboard View Types
 *
 * Type contracts for the /performance analytical dashboard.
 * Mirrors the pattern from workstation-view-types.ts but for
 * retrospective performance analytics with global filtering.
 *
 * Key differences from workstation views:
 * - Uses instance model (instanceId + widgetType) for widget duplication
 * - Each widget declares supportedUnits for $/%/R conversion
 * - Global filter context (account scope, date range, advanced filters, unit)
 * - Close-date attribution for realized metrics
 */

import type { LayoutItem } from 'react-grid-layout';

// ── Filter Types ────────────────────────────────────────────────────────────

export type AccountScopeMode = 'all' | 'single' | 'multiple';

export interface AccountScope {
  mode: AccountScopeMode;
  accountIds: string[]; // Empty when mode is 'all', single element when mode is 'single'
}

export type DatePreset = 'Whole period' | 'YTD' | '1Y' | '6M' | '3M' | '1M' | 'Custom';

export interface DateRange {
  preset: DatePreset;
  from: string; // ISO date string (YYYY-MM-DD) or empty for 'Whole period'
  to: string; // ISO date string (YYYY-MM-DD) or empty for open-ended
}

export interface AdvancedFilters {
  setupIds: string[];
  directions: Array<'long' | 'short'>;
  symbols: string[];
  tradeResults: Array<'win' | 'loss' | 'scratch'>;
  // Note: tags filter scoped out — trades table has no tags field
}

export type PerformanceUnit = 'currency' | 'percent' | 'r';

export interface PerformanceDashboardFilter {
  accountScope: AccountScope;
  dateRange: DateRange;
  advancedFilters: AdvancedFilters;
  unit: PerformanceUnit;
}

// ── Widget Definition Types ─────────────────────────────────────────────────

export type PerformanceWidgetCategory = 'kpi' | 'chart' | 'analytical';

export type SupportedUnit = 'currency' | 'percent' | 'r' | 'fixed';

export interface WidgetConfigSchema {
  // Extensible configuration schema
  // Specific widgets define their own config shapes
  [key: string]: unknown;
}

export interface PerformanceWidgetDefinition {
  id: string;
  title: string;
  description: string;
  category: PerformanceWidgetCategory;
  supportedUnits: SupportedUnit[]; // Which units this widget supports
  configSchema?: WidgetConfigSchema; // Configuration options for this widget
  defaultLayout: Omit<LayoutItem, 'i'>; // Position and size (without instance ID)
  minSize: { w: number; h: number };
  maxSize: { w: number; h: number };
  canDuplicate: boolean; // Always true for Performance widgets
  defaultVisible: boolean;
}

// ── Widget Instance Types ───────────────────────────────────────────────────

export interface WidgetConfig {
  // KPI widget config
  metricId?: string; // Which metric to display (for KPI widgets)
  
  // Chart widget config
  visibleSeries?: string[]; // Which series to show (for chart widgets)
  selectedMetric?: string; // Which metric to chart (for configurable charts)
  
  // Generic config
  titleOverride?: string; // Custom title override
  [key: string]: unknown;
}

export interface WidgetInstance {
  instanceId: string; // Unique per instance (uuid)
  widgetType: string; // References the registry (e.g., 'net-pnl', 'daily-cumulative-pnl')
  config: WidgetConfig; // Per-instance configuration
  layout: LayoutItem; // Position and size in RGL (includes instanceId as 'i')
}

// ── Dashboard Config Types ──────────────────────────────────────────────────

export const PERFORMANCE_DASHBOARD_CONFIG_VERSION = 1;

export interface PerformanceDashboardConfig {
  version: number;
  name: string;
  instances: WidgetInstance[];
  filterSnapshot?: Partial<PerformanceDashboardFilter>; // Optional: save filter state with dashboard
}

// ── Validation & Discrimination ─────────────────────────────────────────────

/**
 * Discriminator: checks if a config object is a PerformanceDashboardConfig
 * (vs a WorkstationViewConfig or other view types in the shared dashboard_views table).
 */
export function isPerformanceDashboardConfigShape(obj: unknown): obj is PerformanceDashboardConfig {
  if (!obj || typeof obj !== 'object') return false;
  
  const config = obj as Record<string, unknown>;
  
  // Must have version, name, and instances array
  if (typeof config.version !== 'number') return false;
  if (typeof config.name !== 'string') return false;
  if (!Array.isArray(config.instances)) return false;
  
  // Each instance must have instanceId, widgetType, config, layout
  for (const instance of config.instances) {
    if (!instance || typeof instance !== 'object') return false;
    const inst = instance as Record<string, unknown>;
    if (typeof inst.instanceId !== 'string') return false;
    if (typeof inst.widgetType !== 'string') return false;
    if (!inst.config || typeof inst.config !== 'object') return false;
    if (!inst.layout || typeof inst.layout !== 'object') return false;
  }
  
  return true;
}

/**
 * Validates a PerformanceDashboardConfig against the widget catalogue.
 * Returns null if valid, or an error message if invalid.
 */
export function validatePerformanceDashboardConfig(
  config: unknown,
  validWidgetTypes: Set<string>,
): string | null {
  if (!isPerformanceDashboardConfigShape(config)) {
    return 'Invalid PerformanceDashboardConfig shape';
  }
  
  // Check version
  if (config.version !== PERFORMANCE_DASHBOARD_CONFIG_VERSION) {
    return `Unsupported config version: ${config.version}`;
  }
  
  // Check all widget types are in the catalogue
  for (const instance of config.instances) {
    if (!validWidgetTypes.has(instance.widgetType)) {
      return `Unknown widget type: ${instance.widgetType}`;
    }
  }
  
  return null;
}

/**
 * Migrates a PerformanceDashboardConfig from an older version to the current version.
 * Currently v1 is the only version, so this is a no-op.
 */
export function migratePerformanceDashboardConfig(
  config: PerformanceDashboardConfig,
): PerformanceDashboardConfig {
  // Future versions would add migration logic here
  return config;
}

// ── Default Filter ──────────────────────────────────────────────────────────

export function createDefaultFilter(): PerformanceDashboardFilter {
  return {
    accountScope: { mode: 'all', accountIds: [] },
    dateRange: { preset: 'YTD', from: '', to: '' },
    advancedFilters: {
      setupIds: [],
      directions: [],
      symbols: [],
      tradeResults: [],
    },
    unit: 'currency',
  };
}

// ── Dashboard Templates & Envelopes ─────────────────────────────────────────

/**
 * Canonical system dashboard IDs (pd- namespace).
 */
export const PERFORMANCE_SYSTEM_DASHBOARD_IDS = {
  DEFAULT: 'pd-system-default',
} as const;

export type PerformanceSystemDashboardId = (typeof PERFORMANCE_SYSTEM_DASHBOARD_IDS)[keyof typeof PERFORMANCE_SYSTEM_DASHBOARD_IDS];

/**
 * A saved Performance dashboard envelope as persisted through
 * /api/dashboard/views (layout field holds the JSON-serialized
 * PerformanceDashboardConfig).
 */
export interface PerformanceDashboardEnvelope {
  id: string;
  name: string;
  isSystem: boolean;
  config: PerformanceDashboardConfig;
}

/**
 * Create the curated default Performance dashboard config:
 * Net P&L, Win Rate, Profit Factor, Average R, Total Trades, Expectancy KPIs
 * plus the six must-have chart widgets, positioned by the registry defaults.
 */
export function createDefaultDashboardConfig(): PerformanceDashboardConfig {
  return {
    version: PERFORMANCE_DASHBOARD_CONFIG_VERSION,
    name: 'Performance Default',
    instances: [],
  };
}

/**
 * Deep clone a dashboard config so instances/configs/layouts are independent
 * of the source (required for duplication independence).
 */
export function cloneDashboardConfig(config: PerformanceDashboardConfig): PerformanceDashboardConfig {
  return {
    version: config.version,
    name: config.name,
    instances: config.instances.map((inst) => ({
      ...inst,
      instanceId: inst.instanceId,
      config: { ...inst.config },
      layout: { ...inst.layout },
    })),
    filterSnapshot: config.filterSnapshot ? JSON.parse(JSON.stringify(config.filterSnapshot)) : undefined,
  };
}

/**
 * Reset a config to the curated default template.
 */
export function resetDashboardToTemplate(): PerformanceDashboardConfig {
  return createDefaultDashboardConfig();
}

/**
 * Create the immutable system default envelope.
 */
export function createSystemDefaultDashboard(): PerformanceDashboardEnvelope {
  return {
    id: PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT,
    name: 'Performance Default',
    isSystem: true,
    config: createDefaultDashboardConfig(),
  };
}
