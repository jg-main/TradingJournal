/**
 * Dashboard View types — defines the shape of persisted user view configurations.
 *
 * Each view stores the widget layout and hidden-widget state so switching
 * views instantly restores a different arrangement. System views are created
 * lazily on first load and are read-only in the Manage Views dialog.
 */

import type { LayoutItem } from 'react-grid-layout';

// ── System View Identifiers ────────────────────────────────────────────

/**
 * Canonical system view IDs. These are always present and cannot be renamed,
 * duplicated, or deleted by the user.
 */
export const SYSTEM_VIEW_IDS = [
  'system-default',
  'system-trading-risk',
  'system-performance',
  'system-process-review',
] as const;

export type SystemViewId = (typeof SYSTEM_VIEW_IDS)[number];

/** Human-readable names matching each system view ID. */
export const SYSTEM_VIEW_NAMES: Record<SystemViewId, string> = {
  'system-default': 'Default',
  'system-trading-risk': 'Trading Risk',
  'system-performance': 'Performance',
  'system-process-review': 'Process Review',
};

// ── Dashboard View Type ────────────────────────────────────────────────

/**
 * A dashboard view represents a saved layout + widget visibility configuration.
 *
 * System views have `isSystem: true` and a matching `SystemViewId` as their
 * `id`. User views have `isSystem: false` and a `crypto.randomUUID()` id.
 */
export interface DashboardView {
  /** Unique identifier. System views use a `system-*` prefix. */
  id: string;
  /** Human-readable view name shown in the dropdown. */
  name: string;
  /** The widget grid layout to restore when this view is active. */
  layout: LayoutItem[];
  /** Widget IDs that should be hidden in this view. */
  hiddenWidgetIds: string[];
  /** ISO-8601 timestamp of when this view was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the last update to this view. */
  updatedAt: string;
  /** Whether this is a read-only system preset. */
  isSystem: boolean;
  /** Whether this view is the default (new user views clone this). */
  isDefault: boolean;
}

// ── Factory Helpers ────────────────────────────────────────────────────

/**
 * Generate a unique identifier for user views.
 * Falls back to a timestamp-based ID when `crypto.randomUUID` is unavailable
 * (e.g. insecure contexts or older runtimes).
 */
export function generateViewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random suffix (sufficient for local-first persistence)
  return `view-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new `DashboardView` with the given parameters.
 *
 * @param overrides - Partial fields to merge into the view. `id`, `createdAt`,
 *   `updatedAt`, `isSystem`, and `isDefault` default to sensible values when
 *   omitted.
 */
export function createDashboardView(
  overrides: Partial<DashboardView> & { name: string; layout: LayoutItem[] },
): DashboardView {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? generateViewId(),
    name: overrides.name,
    layout: overrides.layout.map((item) => ({ ...item })),
    hiddenWidgetIds: overrides.hiddenWidgetIds ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    isSystem: overrides.isSystem ?? false,
    isDefault: overrides.isDefault ?? false,
  };
}
