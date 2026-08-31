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
import { getDefaultWidgetInstances } from './performance-widget-registry';

// ── Filter Types ────────────────────────────────────────────────────────────

export type AccountScopeMode = 'all' | 'single' | 'multiple';

export interface AccountScope {
  mode: AccountScopeMode;
  accountIds: string[]; // Empty when mode is 'all', single element when mode is 'single'
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
  // NOTE (M004/T9C): there is intentionally NO dateRange field. The global
  // operational period (OperationalDateRangeProvider / app:date-range) is the
  // sole owner of Performance's date range. Legacy `filterSnapshot.dateRange`
  // values in persisted dashboards are inert compatibility metadata.
  advancedFilters: AdvancedFilters;
  unit: PerformanceUnit;
}

// ── Widget Definition Types ─────────────────────────────────────────────────

export type PerformanceWidgetCategory = 'kpi' | 'chart' | 'analytical';

export type SupportedUnit = 'currency' | 'percent' | 'r' | 'fixed';

/**
 * One declared field in a widget's configuration schema. The Configure dialog
 * renders exactly the fields a widget declares — no unrestricted visualization
 * builder. Each kind maps to a typed control: select / multi-select / text /
 * boolean.
 */
export type WidgetConfigFieldSchema =
  | {
      kind: 'select';
      key: string;
      label: string;
      default?: string;
      options: Array<{ value: string; label: string }>;
    }
  | {
      kind: 'multi-select';
      key: string;
      label: string;
      default?: string[];
      options: Array<{ value: string; label: string }>;
    }
  | {
      kind: 'text';
      key: string;
      label: string;
      default?: string;
      placeholder?: string;
    }
  | {
      kind: 'boolean';
      key: string;
      label: string;
      default?: boolean;
    };

/**
 * Typed configuration schema keyed by config field. Declared per widget in the
 * registry (chart widgets) or derived from the KPI catalogue + supportedUnits
 * (KPI widgets) via getWidgetConfigSchema().
 */
export type WidgetConfigSchema = Record<string, WidgetConfigFieldSchema>;

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
  unit?: PerformanceUnit; // Per-widget unit override; defaults to the global filter unit

  // Chart widget config
  visibleSeries?: string[]; // Which series to show (for chart widgets)
  selectedMetric?: string; // Legacy alias for `metric`; kept for persisted-config compat
  metric?: string; // Primary series/metric for configurable charts (e.g. performance-by-setup)
  legendVisible?: boolean; // Whether the chart legend renders (dense default: hidden)

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
 * The immutable system default dashboard template id (pd- namespace).
 *
 * Canonical template id: the system default envelope, every Reset, and the
 * hook's ensureSystemDefault merge all reference this id. The system default
 * dashboard is a local template — it is never persisted server-side, so it
 * must always be merged back in after API hydration.
 */
export const PD_SYSTEM_DEFAULT_TEMPLATE = 'pd-system-default' as const;

/**
 * Canonical system dashboard IDs (pd- namespace).
 * `DEFAULT` aliases PD_SYSTEM_DEFAULT_TEMPLATE — the system default serves as
 * both the saved envelope id and the reset template id.
 */
export const PERFORMANCE_SYSTEM_DASHBOARD_IDS = {
  DEFAULT: PD_SYSTEM_DEFAULT_TEMPLATE,
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
 * Create the curated default Performance dashboard config: the
 * default-visible KPI widgets (Net P&L, Gross P&L, Total Trades, Win Rate,
 * Profit Factor, Average R) plus the six must-have chart widgets, positioned
 * by the registry defaults via getDefaultWidgetInstances().
 *
 * The system default envelope and every Reset reference this template. Each
 * instance's RGL layout gets `i` bound to its instanceId so the persisted
 * LayoutItems are self-describing.
 */
export function createDefaultDashboardConfig(): PerformanceDashboardConfig {
  const defaults = getDefaultWidgetInstances();
  return {
    version: PERFORMANCE_DASHBOARD_CONFIG_VERSION,
    name: 'Performance Default',
    instances: defaults.map((inst) => ({
      instanceId: inst.instanceId,
      widgetType: inst.widgetType,
      config: { ...inst.config },
      layout: { ...inst.layout, i: inst.instanceId },
    })),
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
