/**
 * API client for dashboard views persistence.
 *
 * Wraps fetch calls to /api/dashboard/views.
 * Layout and hiddenWidgetIds are serialized to JSON strings for POST requests
 * (the API stores them as TEXT columns). GET responses return parsed arrays.
 */

import type { DashboardView } from '@/types/dashboard-view';

const BASE_URL = '/api/dashboard/views';

export interface SaveViewPayload {
  id: string;
  name: string;
  /** JSON-serialized LayoutItem[] */
  layout: string;
  /** JSON-serialized string[] */
  hiddenWidgetIds: string;
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
  isDefault: boolean;
}

/**
 * Serialize a DashboardView to the API save payload format.
 * Layout and hiddenWidgetIds are converted to JSON strings.
 */
export function serializeViewForApi(view: DashboardView): SaveViewPayload {
  return {
    id: view.id,
    name: view.name,
    layout: JSON.stringify(view.layout),
    hiddenWidgetIds: JSON.stringify(view.hiddenWidgetIds),
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    isSystem: view.isSystem,
    isDefault: view.isDefault,
  };
}

/**
 * Fetch all dashboard views from the API.
 * Returns parsed DashboardView[] with layout/hiddenWidgetIds as arrays.
 * Throws on HTTP error or network failure.
 */
export async function fetchViewsApi(): Promise<DashboardView[]> {
  const res = await fetch(BASE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch dashboard views: ${res.status}`);
  }
  return res.json() as Promise<DashboardView[]>;
}

/**
 * Create or upsert a single dashboard view via the API.
 * Accepts a serialized payload (layout/hiddenWidgetIds as JSON strings).
 * Throws on HTTP error or network failure.
 */
export async function saveViewApi(payload: SaveViewPayload): Promise<DashboardView> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to save dashboard view: ${res.status}`);
  }
  return res.json() as Promise<DashboardView>;
}

/**
 * Delete a dashboard view by ID via the API.
 * Throws on HTTP error or network failure.
 */
export async function deleteViewApi(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to delete dashboard view: ${res.status}`);
  }
}
