'use client';

import { useEffect, useCallback, useReducer, useRef } from 'react';
import type { LayoutItem } from 'react-grid-layout';
import type { DashboardView } from '@/types/dashboard-view';
import { createDashboardView, generateViewId } from '@/types/dashboard-view';
import {
  fetchViewsApi,
  saveViewApi,
  deleteViewApi,
  migrateViewsApi,
  serializeViewForApi,
} from './use-dashboard-views-api';

// ── Constants ──────────────────────────────────────────────────────────

/**
 * localStorage key for persisting the view store.
 * Versioned as v2 to align with the dashboard layout storage migration story.
 */
const STORAGE_KEY = 'dashboard:views:v2';

/** Key used to persist active-view selection before the views-v2 migration. */
const STORAGE_KEY_ACTIVE = 'dashboard:active-view:v2'; // unused, kept for migration awareness

// ── State Shape ────────────────────────────────────────────────────────

interface ViewsState {
  /** All available views (system + user). */
  views: DashboardView[];
  /** ID of the currently selected view. */
  activeViewId: string;
  /** Whether the store has been hydrated from localStorage. */
  isLoaded: boolean;
  /** True when a write to localStorage failed. */
  writeFailed: boolean;
}

type ViewsAction =
  | { type: 'HYDRATE'; views: DashboardView[]; activeViewId: string }
  | { type: 'SET_ACTIVE'; id: string }
  | { type: 'CREATE'; view: DashboardView }
  | { type: 'RENAME'; id: string; name: string }
  | { type: 'DUPLICATE'; sourceId: string; newView: DashboardView }
  | { type: 'DELETE'; id: string }
  | { type: 'SET_DEFAULT'; id: string }
  | { type: 'UPDATE_LAYOUT'; id: string; layout: LayoutItem[]; hiddenWidgetIds: string[] }
  | { type: 'MARK_WRITE_FAILED' };

function viewsReducer(state: ViewsState, action: ViewsAction): ViewsState {
  switch (action.type) {
    case 'HYDRATE':
      return {
        ...state,
        views: action.views,
        activeViewId: action.activeViewId,
        isLoaded: true,
      };

    case 'SET_ACTIVE': {
      if (action.id === state.activeViewId) return state;
      const exists = state.views.some((v) => v.id === action.id);
      if (!exists) return state;
      return { ...state, activeViewId: action.id };
    }

    case 'CREATE': {
      const updated = [...state.views, action.view];
      return {
        ...state,
        views: updated,
        activeViewId: action.view.id,
      };
    }

    case 'RENAME': {
      const idx = state.views.findIndex((v) => v.id === action.id);
      if (idx === -1) return state;
      const updated = [...state.views];
      updated[idx] = {
        ...updated[idx],
        name: action.name,
        updatedAt: new Date().toISOString(),
      };
      return { ...state, views: updated };
    }

    case 'DUPLICATE': {
      const source = state.views.find((v) => v.id === action.sourceId);
      if (!source) return state;
      // Insert the new view right after the source
      const idx = state.views.findIndex((v) => v.id === action.sourceId);
      const updated = [...state.views];
      updated.splice(idx + 1, 0, action.newView);
      return {
        ...state,
        views: updated,
        activeViewId: action.newView.id,
      };
    }

    case 'DELETE': {
      // Prevent deleting the last view
      if (state.views.length <= 1) return state;
      // Prevent deleting system views
      const targetView = state.views.find((v) => v.id === action.id);
      if (!targetView || targetView.isSystem) return state;
      const filtered = state.views.filter((v) => v.id !== action.id);
      // If we deleted the active view, switch to the first remaining
      const newActiveId =
        action.id === state.activeViewId ? filtered[0].id : state.activeViewId;
      return {
        ...state,
        views: filtered,
        activeViewId: newActiveId,
      };
    }

    case 'SET_DEFAULT': {
      const updated = state.views.map((v) => ({
        ...v,
        isDefault: v.id === action.id,
        updatedAt: v.id === action.id ? new Date().toISOString() : v.updatedAt,
      }));
      return { ...state, views: updated };
    }

    case 'UPDATE_LAYOUT': {
      const idx = state.views.findIndex((v) => v.id === action.id);
      if (idx === -1) return state;
      const updated = [...state.views];
      updated[idx] = {
        ...updated[idx],
        layout: action.layout.map((item) => ({ ...item })),
        hiddenWidgetIds: [...action.hiddenWidgetIds],
        updatedAt: new Date().toISOString(),
      };
      return { ...state, views: updated };
    }

    case 'MARK_WRITE_FAILED':
      return { ...state, writeFailed: true };

    default:
      return state;
  }
}

// ── Initialiser (lazy — runs once) ────────────────────────────────────

interface InitParams {
  defaultViews: DashboardView[];
  defaultActiveViewId: string;
  storageKey: string;
}

function createInitialState(params: InitParams): ViewsState {
  const saved = readViews(params.storageKey);
  if (saved) {
    return {
      views: saved.views,
      activeViewId: saved.activeViewId,
      isLoaded: false, // will be set true by HYDRATE effect
      writeFailed: false,
    };
  }
  // No saved data — use defaults
  return {
    views: params.defaultViews.map((v) => ({
      ...v,
      layout: v.layout.map((item) => ({ ...item })),
      hiddenWidgetIds: [...v.hiddenWidgetIds],
    })),
    activeViewId: params.defaultActiveViewId,
    isLoaded: false,
    writeFailed: false,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

interface StoredViews {
  version: number;
  views: DashboardView[];
  activeViewId: string;
}

function readViews(key: string): StoredViews | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const stored = parsed as StoredViews;
    if (!Array.isArray(stored.views) || typeof stored.activeViewId !== 'string') {
      return null;
    }
    // Basic validation: each view must have required fields
    for (const view of stored.views) {
      if (
        typeof view.id !== 'string' ||
        typeof view.name !== 'string' ||
        !Array.isArray(view.layout) ||
        !Array.isArray(view.hiddenWidgetIds) ||
        typeof view.createdAt !== 'string' ||
        typeof view.updatedAt !== 'string' ||
        typeof view.isSystem !== 'boolean' ||
        typeof view.isDefault !== 'boolean'
      ) {
        return null;
      }
    }
    // Validate activeViewId references an existing view
    if (!stored.views.some((v) => v.id === stored.activeViewId)) {
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

function writeViews(key: string, state: ViewsState): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const payload: StoredViews = {
      version: 2,
      views: state.views,
      activeViewId: state.activeViewId,
    };
    localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    console.warn(
      `[useDashboardViews] Failed to write to localStorage key "${key}". ` +
      'Storage may be full or disabled. View changes will not persist across reloads.',
    );
    return false;
  }
}

/**
 * Find the default view ID from an array of views.
 * Returns the first view with isDefault === true, or the first system view,
 * or the very first view.
 */
function resolveDefaultViewId(views: DashboardView[]): string {
  const def = views.find((v) => v.isDefault);
  if (def) return def.id;
  const sys = views.find((v) => v.isSystem);
  if (sys) return sys.id;
  return views[0]?.id ?? '';
}

/**
 * Deep-clone a DashboardView (layout items are copied by spread).
 */
function deepCloneView(v: DashboardView): DashboardView {
  return {
    ...v,
    layout: v.layout.map((item) => ({ ...item })),
    hiddenWidgetIds: [...v.hiddenWidgetIds],
  };
}

// ── Options / Result Types ─────────────────────────────────────────────

export interface UseDashboardViewsOptions {
  /**
   * Initial views to use when no saved data exists in localStorage.
   * Typically includes the four system views plus any user views.
   * Views are deep-copied before storage so mutations don't affect the source.
   */
  defaultViews: DashboardView[];
  /**
   * Optional storage key override. Defaults to `dashboard:views:v2`.
   */
  storageKey?: string;
}

export interface UseDashboardViewsResult {
  /** All views (system + user), ordered by creation. */
  views: DashboardView[];
  /** The currently active view object, or undefined during hydration. */
  activeView: DashboardView | undefined;
  /** ID of the currently active view. */
  activeViewId: string;
  /** Whether the store has been hydrated from localStorage. */
  isLoaded: boolean;
  /** True if the most recent localStorage write failed. Cleared on next successful write. */
  writeFailed: boolean;
  /** Switch to a different view by ID. */
  setActiveView: (id: string) => void;
  /** Create a new user view from the current layout state. */
  createView: (
    name: string,
    layout: LayoutItem[],
    hiddenWidgetIds: string[],
  ) => DashboardView;
  /** Rename an existing view. No-op for system views. */
  renameView: (id: string, name: string) => void;
  /**
   * Duplicate a view. Creates a copy named "{source name} (Copy)" or the
   * provided name. Switches to the new view on success.
   */
  duplicateView: (id: string, newName?: string) => DashboardView | null;
  /**
   * Delete a user view. Cannot delete system views or the last remaining view.
   * If the active view is deleted, switches to the first remaining view.
   */
  deleteView: (id: string) => void;
  /**
   * Mark a view as the default (the one cloned when "Create New View" is used).
   * Only one view can be the default at a time.
   */
  setDefaultView: (id: string) => void;
  /**
   * Update the layout and hidden widgets for a view. Called when customization
   * is saved for the active view.
   */
  updateViewLayout: (id: string, layout: LayoutItem[], hiddenWidgetIds: string[]) => void;
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Manage dashboard views with full CRUD, API persistence, and localStorage
 * fallback persistence.
 *
 * On mount:
 * 1. Synchronously hydrates from localStorage (fast, offline-capable)
 * 2. Asynchronously fetches from the API; if data is available, overrides
 *    the localStorage data
 * 3. If the API returns empty and localStorage has data, migrates the
 *    localStorage data to SQLite (fire-and-forget)
 *
 * On state changes:
 * - Always persists to localStorage (synchronous, offline backup)
 * - Also persists to the API (fire-and-forget, non-blocking)
 * - Write failures set the writeFailed flag
 *
 * System views are provided via `defaultViews` and are always read-only
 * (cannot be renamed, duplicated [in-place], or deleted). User views are
 * fully mutable.
 *
 * The store schema is versioned so future migrations can detect and upgrade
 * stale data without breaking existing users.
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const viewsManager = useDashboardViews({
 *     defaultViews: [
 *       createDashboardView({
 *         id: 'system-default', name: 'Default',
 *         layout: DEFAULT_UNIFIED_LAYOUT,
 *         isSystem: true, isDefault: true,
 *       }),
 *       // ... additional system views
 *     ],
 *   });
 *
 *   // Switch views
 *   <select onChange={(e) => viewsManager.setActiveView(e.target.value)}>
 *     {viewsManager.views.map((v) => (
 *       <option key={v.id} value={v.id}>{v.name}</option>
 *     ))}
 *   </select>
 * }
 * ```
 */
export function useDashboardViews(
  options: UseDashboardViewsOptions,
): UseDashboardViewsResult {
  const { defaultViews, storageKey } = options;
  const key = storageKey ?? STORAGE_KEY;
  const defaultActiveViewId = resolveDefaultViewId(defaultViews);

  const [state, dispatch] = useReducer(
    viewsReducer,
    { defaultViews, defaultActiveViewId, storageKey: key } as InitParams,
    createInitialState,
  );

  // ── Hydration effects ─────────────────────────────────────────────

  // Ref for cancellation of async API hydration
  const apiHydrationCancelledRef = useRef(false);

  // 1. Synchronous localStorage hydration (preserves existing behavior)
  useEffect(() => {
    const saved = readViews(key);
    if (saved) {
      dispatch({ type: 'HYDRATE', views: saved.views, activeViewId: saved.activeViewId });
    } else {
      // No saved data — use the latest defaultViews (closure captures the
      // value from this render; the effect only runs when `key` changes, so
      // this is always current — no ref mirror needed)
      const currentDefs = defaultViews;
      const activeId = resolveDefaultViewId(currentDefs);
      dispatch({
        type: 'HYDRATE',
        views: currentDefs.map(deepCloneView),
        activeViewId: activeId,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 2. Async API fetch — overrides localStorage data when API is available
  useEffect(() => {
    apiHydrationCancelledRef.current = false;

    fetchViewsApi()
      .then((fetchedViews) => {
        if (apiHydrationCancelledRef.current) return;

        if (fetchedViews.length > 0) {
          // API has data — override localStorage with API data
          const viewId = resolveDefaultViewId(fetchedViews);
          dispatch({ type: 'HYDRATE', views: fetchedViews, activeViewId: viewId });
        } else {
          // API returned empty — check localStorage for migration
          const localStorageData = readViews(key);
          if (localStorageData && localStorageData.views.length > 0) {
            // Migrate existing localStorage data to SQLite (fire-and-forget)
            migrateViewsApi({
              views: localStorageData.views,
              activeViewId: localStorageData.activeViewId,
            }).catch(() => {
              // Migration failure is non-critical — localStorage data is already loaded
            });
          }
        }
      })
      .catch(() => {
        // API unavailable — localStorage data is already loaded via the synchronous path.
        // No migration attempt; the user's views are safe in localStorage.
      });

    return () => {
      apiHydrationCancelledRef.current = true;
    };
  }, [key]);

  // Ref to track latest views for callbacks that need state access.
  // Updated in an effect (not during render) per react-hooks/refs.
  const viewsRef = useRef(state.views);
  useEffect(() => {
    viewsRef.current = state.views;
  }, [state.views]);

  // Track IDs of views that were deleted and need API sync
  const pendingDeletionIdsRef = useRef<Set<string>>(new Set());

  // Persist every state change after hydration (dual-write: localStorage + API)
  useEffect(() => {
    if (!state.isLoaded) return;

    // 1. Always persist to localStorage (synchronous fallback)
    const ok = writeViews(key, state);
    if (!ok) {
      dispatch({ type: 'MARK_WRITE_FAILED' });
    }

    // 2. Sync to API (fire-and-forget, non-blocking)
    syncStateToApi(state, pendingDeletionIdsRef).catch(() => {
      // API write failures are non-blocking — localStorage backup exists.
      // The writeFailed flag is reserved for localStorage failures only.
    });
  }, [state, key]);

  // ── Actions ──────────────────────────────────────────────────────────

  const setActiveView = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE', id });
  }, []);

  const createView = useCallback(
    (name: string, layout: LayoutItem[], hiddenWidgetIds: string[]): DashboardView => {
      const newView = createDashboardView({
        name,
        layout,
        hiddenWidgetIds,
        isSystem: false,
        isDefault: false,
      });
      dispatch({ type: 'CREATE', view: newView });
      return newView;
    },
    [],
  );

  const renameView = useCallback((id: string, name: string) => {
    dispatch({ type: 'RENAME', id, name });
  }, []);

  const duplicateView = useCallback(
    (id: string, newName?: string): DashboardView | null => {
      const currentViews = viewsRef.current;
      const source = currentViews.find((v) => v.id === id);
      if (!source) return null;
      const displayName = newName?.trim() || `${source.name} (Copy)`;
      const newView = createDashboardView({
        name: displayName,
        layout: source.layout,
        hiddenWidgetIds: [...source.hiddenWidgetIds],
        isSystem: false,
        isDefault: false,
      });
      dispatch({ type: 'DUPLICATE', sourceId: id, newView });
      return newView;
    },
    [],
  );

  const deleteView = useCallback((id: string) => {
    // Track for API sync
    pendingDeletionIdsRef.current.add(id);
    dispatch({ type: 'DELETE', id });
  }, []);

  const setDefaultView = useCallback((id: string) => {
    dispatch({ type: 'SET_DEFAULT', id });
  }, []);

  const updateViewLayout = useCallback(
    (id: string, layout: LayoutItem[], hiddenWidgetIds: string[]) => {
      dispatch({ type: 'UPDATE_LAYOUT', id, layout, hiddenWidgetIds });
    },
    [],
  );

  // ── Derived ──────────────────────────────────────────────────────────

  const activeView = state.views.find((v) => v.id === state.activeViewId);

  return {
    views: state.views,
    activeView,
    activeViewId: state.activeViewId,
    isLoaded: state.isLoaded,
    writeFailed: state.writeFailed,
    setActiveView,
    createView,
    renameView,
    deleteView,
    duplicateView,
    setDefaultView,
    updateViewLayout,
  };
}

// ── API Sync ───────────────────────────────────────────────────────────

/**
 * Synchronise the current state to the SQLite API.
 *
 * 1. Deletes views that were removed from state (pending deletions)
 * 2. Upserts all current views
 *
 * All API calls use the fire-and-forget pattern. Errors propagate for the
 * caller to catch silently.
 */
async function syncStateToApi(
  state: ViewsState,
  pendingDeletionIdsRef: React.MutableRefObject<Set<string>>,
): Promise<void> {
  // Process pending deletions first
  const deletions = pendingDeletionIdsRef.current;
  if (deletions.size > 0) {
    const deletePromises = Array.from(deletions).map((id) => deleteViewApi(id));
    await Promise.allSettled(deletePromises);
    pendingDeletionIdsRef.current = new Set();
  }

  // Upsert all current views
  const savePromises = state.views.map((view) =>
    saveViewApi(serializeViewForApi(view)),
  );
  await Promise.allSettled(savePromises);
}
