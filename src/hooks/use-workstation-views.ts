'use client';

/**
 * useWorkstationViews — state management for curated saved workstation views
 * (M016/S06).
 *
 * Follows the established dashboard-views pattern (useReducer + localStorage
 * + API sync) but owns workstation panel view configuration
 * (`WorkstationViewConfig` from src/lib/workstation-view-types.ts) instead of
 * react-grid-layout items.
 *
 * ## Persistence contract (slice Integration Closure)
 *
 * Workstation views persist through the existing `/api/dashboard/views` route
 * with the workstation layout configuration JSON-serialized into the shared
 * `layout` field. The GET response is filtered to workstation-shaped rows via
 * `isWorkstationViewConfigShape`, so dashboard-shaped rows in the shared table
 * are ignored and never misinterpreted; every workstation row then runs
 * migration-on-read (`migrateWorkstationViewConfig`), so v1 (pre-dense)
 * persisted configs — from localStorage or the API — are upgraded to the v2
 * dense schema on load. localStorage uses a dedicated, versioned key
 * (`workstation:views:v1`).
 *
 * ## Ownership rules
 *
 * - The three system template views (`ws-system-*`) are curated presets and
 *   are fully read-only in this hook: rename, delete, updateViewConfig, and
 *   reset are no-ops for them. Customization of a preset is expected to flow
 *   through "duplicate into a new view" (T04 decides the exact UX).
 * - The Risk & Positions system view is the immutable startup default
 *   (R035): `isStartup: true` until the user explicitly selects another view.
 * - `updateViewConfig` validates every incoming config with
 *   `validateWorkstationViewConfig` (R035: layouts are validated against the
 *   approved panel catalogue) and refuses invalid configs.
 * - System views are never persisted with a mutated config, and every
 *   persisted view config is re-validated on read (API and localStorage).
 */

import { useEffect, useCallback, useReducer, useRef, type MutableRefObject } from 'react';
import type { DashboardView } from '@/types/dashboard-view';
import { generateViewId } from '@/types/dashboard-view';
import {
  fetchViewsApi,
  saveViewApi,
  deleteViewApi,
  type SaveViewPayload,
} from './use-dashboard-views-api';
import {
  WORKSTATION_TEMPLATE_IDS,
  WORKSTATION_TEMPLATES,
  createViewFromTemplate,
  resetViewToTemplate,
  cloneWorkstationViewConfig,
  validateWorkstationViewConfig,
  isWorkstationViewConfigShape,
  migrateWorkstationViewConfig,
  type WorkstationTemplateId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── Constants ──────────────────────────────────────────────────────────

/** localStorage key for persisting the workstation view store. */
const STORAGE_KEY = 'workstation:views:v1';

/** Version of the localStorage store schema. */
const STORAGE_VERSION = 1;

/**
 * Canonical ids for the three system template views. Namespaced with `ws-`
 * so they can never collide with dashboard view ids (`system-*`, uuids) in
 * the shared `/api/dashboard/views` table.
 */
export const WORKSTATION_SYSTEM_VIEW_IDS = {
  RISK_POSITIONS: 'ws-system-risk-positions',
  PERFORMANCE: 'ws-system-performance',
  PROCESS_REVIEW: 'ws-system-process-review',
} as const;

/** Prefix for user-created workstation view ids (namespaces the shared API table). */
const USER_VIEW_ID_PREFIX = 'ws-';

// ── Types ──────────────────────────────────────────────────────────────

/**
 * A saved workstation view: the persisted envelope for one curated template
 * or user-created view. `config` holds the rendered layout configuration
 * (template reference + areas grid + hidden panels); the rest is metadata
 * mirroring the DashboardView envelope so the shared API route round-trips.
 */
export interface WorkstationView {
  /** Unique identifier (`ws-system-*` for system presets, `ws-<uuid>` for users). */
  id: string;
  /** Human-readable view name shown in the switcher. */
  name: string;
  /** The workstation layout configuration (template ref + areas + hidden). */
  config: WorkstationViewConfig;
  /** ISO-8601 timestamp of when this view was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the last update to this view. */
  updatedAt: string;
  /** System template views are curated presets: read-only in this hook. */
  isSystem: boolean;
  /** True when this view is the startup view restored on load (R035). */
  isStartup: boolean;
}

interface ViewsState {
  /** All available views (system presets + user views). */
  views: WorkstationView[];
  /** ID of the currently selected view. */
  activeViewId: string;
  /** Whether the store has been hydrated from localStorage. */
  isLoaded: boolean;
  /** True when a write to localStorage failed. Cleared on next success. */
  writeFailed: boolean;
}

type ViewsAction =
  | { type: 'HYDRATE'; views: WorkstationView[]; activeViewId: string }
  | { type: 'SET_ACTIVE'; id: string }
  | { type: 'CREATE'; view: WorkstationView }
  | { type: 'RENAME'; id: string; name: string }
  | { type: 'DUPLICATE'; sourceId: string; newView: WorkstationView }
  | { type: 'DELETE'; id: string }
  | { type: 'SET_STARTUP'; id: string }
  | { type: 'UPDATE_CONFIG'; id: string; config: WorkstationViewConfig }
  | { type: 'RESET'; id: string }
  | { type: 'MARK_WRITE_FAILED' }
  | { type: 'CLEAR_WRITE_FAILED' };

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
      if (!state.views.some((v) => v.id === action.id)) return state;
      return { ...state, activeViewId: action.id };
    }

    case 'CREATE': {
      return {
        ...state,
        views: [...state.views, action.view],
        activeViewId: action.view.id,
      };
    }

    case 'RENAME': {
      const idx = state.views.findIndex((v) => v.id === action.id);
      if (idx === -1) return state;
      const target = state.views[idx];
      if (target.isSystem) return state; // system presets are read-only
      const updated = [...state.views];
      updated[idx] = {
        ...target,
        name: action.name,
        updatedAt: new Date().toISOString(),
      };
      return { ...state, views: updated };
    }

    case 'DUPLICATE': {
      const idx = state.views.findIndex((v) => v.id === action.sourceId);
      if (idx === -1) return state;
      const updated = [...state.views];
      updated.splice(idx + 1, 0, action.newView);
      return {
        ...state,
        views: updated,
        activeViewId: action.newView.id,
      };
    }

    case 'DELETE': {
      // Prevent deleting the last remaining view.
      if (state.views.length <= 1) return state;
      const target = state.views.find((v) => v.id === action.id);
      if (!target || target.isSystem) return state; // presets are read-only
      const filtered = state.views.filter((v) => v.id !== action.id);
      // If we deleted the active view, switch to a stable fallback.
      const newActiveId =
        action.id === state.activeViewId
          ? pickFallbackActiveViewId(filtered)
          : state.activeViewId;
      return {
        ...state,
        views: filtered,
        activeViewId: newActiveId,
      };
    }

    case 'SET_STARTUP': {
      if (!state.views.some((v) => v.id === action.id)) return state;
      const now = new Date().toISOString();
      const updated = state.views.map((v) => ({
        ...v,
        isStartup: v.id === action.id,
        updatedAt: v.id === action.id ? now : v.updatedAt,
      }));
      return { ...state, views: updated };
    }

    case 'UPDATE_CONFIG': {
      const idx = state.views.findIndex((v) => v.id === action.id);
      if (idx === -1) return state;
      if (state.views[idx].isSystem) return state; // presets are read-only
      // Validity is enforced by the action creator (validate before dispatch);
      // the reducer clones defensively so callers can never alias state.
      const updated = [...state.views];
      updated[idx] = {
        ...updated[idx],
        config: cloneWorkstationViewConfig(action.config),
        updatedAt: new Date().toISOString(),
      };
      return { ...state, views: updated };
    }

    case 'RESET': {
      const idx = state.views.findIndex((v) => v.id === action.id);
      if (idx === -1) return state;
      if (state.views[idx].isSystem) return state; // presets are read-only
      const updated = [...state.views];
      updated[idx] = {
        ...updated[idx],
        config: resetViewToTemplate(state.views[idx].config),
        updatedAt: new Date().toISOString(),
      };
      return { ...state, views: updated };
    }

    case 'MARK_WRITE_FAILED':
      // Bail out when already flagged so a persistently failing storage write
      // cannot re-trigger the persistence effect (infinite dispatch loop).
      return state.writeFailed ? state : { ...state, writeFailed: true };

    case 'CLEAR_WRITE_FAILED':
      return state.writeFailed ? { ...state, writeFailed: false } : state;

    default:
      return state;
  }
}

/**
 * The view the shell falls back to when the active view is deleted: the
 * immutable Risk & Positions system preset when present, otherwise the first
 * remaining view.
 */
function pickFallbackActiveViewId(views: WorkstationView[]): string {
  const sys = views.find((v) => v.id === WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
  return (sys ?? views[0])?.id ?? '';
}

// ── System presets ─────────────────────────────────────────────────────

/**
 * The three curated system template views (R035). The Risk & Positions
 * preset is the immutable startup default (`isStartup: true`); the other two
 * presets mirror their templates exactly.
 */
export function createSystemWorkstationViews(): WorkstationView[] {
  const now = new Date().toISOString();
  const systemViews: WorkstationView[] = [
    {
      id: WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS,
      name: WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS].name,
      config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS),
      createdAt: now,
      updatedAt: now,
      isSystem: true,
      isStartup: true,
    },
    {
      id: WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE,
      name: WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PERFORMANCE].name,
      config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE),
      createdAt: now,
      updatedAt: now,
      isSystem: true,
      isStartup: false,
    },
    {
      id: WORKSTATION_SYSTEM_VIEW_IDS.PROCESS_REVIEW,
      name: WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW].name,
      config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW),
      createdAt: now,
      updatedAt: now,
      isSystem: true,
      isStartup: false,
    },
  ];
  return systemViews;
}

// ── Initialiser (lazy — runs once) ────────────────────────────────────

interface InitParams {
  defaultViews: WorkstationView[];
  storageKey: string;
}

function createInitialState(params: InitParams): ViewsState {
  // SSR-safe hydration: the first render always uses the default views so
  // the server HTML and the client's first paint agree (localStorage is not
  // available during server rendering, so reading it here would cause a
  // hydration mismatch whenever the saved active view differs from the
  // startup default). Saved localStorage data is applied by the HYDRATE
  // effect on mount, which re-reads the same key — observable behavior
  // after mount is unchanged.
  const views = params.defaultViews.map(cloneViewEnvelope);
  return {
    views,
    activeViewId: resolveStartupViewId(views),
    isLoaded: false, // set true by the HYDRATE effect
    writeFailed: false,
  };
}

// ── Storage helpers ────────────────────────────────────────────────────

interface StoredViews {
  version: number;
  views: WorkstationView[];
  activeViewId: string;
}

/**
 * Normalize one stored view envelope for loading: validate the envelope
 * metadata shape, then run the layout migration on the config so v1
 * (pre-dense) persisted views are upgraded to v2 on read — unmodified
 * copies of the former system templates become the dense templates, and
 * user-modified v1 views are translated onto the v2 catalogue. Migration
 * is total (it always yields a valid v2 config), so a corrupt config can
 * never reach the renderer; only envelopes missing required metadata are
 * dropped as foreign rows. Returns null for malformed envelopes.
 */
function normalizeStoredView(value: unknown): WorkstationView | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const view = value as Record<string, unknown>;
  if (
    typeof view.id !== 'string' ||
    typeof view.name !== 'string' ||
    typeof view.createdAt !== 'string' ||
    typeof view.updatedAt !== 'string' ||
    typeof view.isSystem !== 'boolean' ||
    typeof view.isStartup !== 'boolean'
  ) {
    return null;
  }
  return {
    id: view.id,
    name: view.name,
    config: migrateWorkstationViewConfig(view.config),
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    isSystem: view.isSystem,
    isStartup: view.isStartup,
  };
}

/**
 * Read and validate the persisted store from localStorage. Returns null when
 * the key is absent, the JSON is corrupt, every stored view envelope is
 * malformed, or activeViewId does not reference an existing view — the
 * caller then falls back to the defaults. Each view's config runs through
 * migration-on-read (`migrateWorkstationViewConfig`), so v1 (pre-dense)
 * persisted views are upgraded to v2 and malformed configs fall back to
 * the dense default instead of being dropped (R035: persisted layouts are
 * re-validated).
 */
function readViews(key: string): StoredViews | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const stored = parsed as Record<string, unknown>;
    if (!Array.isArray(stored.views) || typeof stored.activeViewId !== 'string') {
      return null;
    }
    if (stored.views.length === 0) {
      return null;
    }
    const views: WorkstationView[] = [];
    for (const rawView of stored.views) {
      const view = normalizeStoredView(rawView);
      if (view !== null) views.push(view);
    }
    if (views.length === 0) return null;
    if (!views.some((v) => v.id === stored.activeViewId)) {
      return null;
    }
    return {
      version: typeof stored.version === 'number' ? stored.version : STORAGE_VERSION,
      views,
      activeViewId: stored.activeViewId,
    };
  } catch {
    return null;
  }
}

function writeViews(key: string, views: WorkstationView[], activeViewId: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const payload: StoredViews = { version: STORAGE_VERSION, views, activeViewId };
    localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    console.warn(
      `[useWorkstationViews] Failed to write to localStorage key "${key}". ` +
        'Storage may be full or disabled. View changes will not persist across reloads.',
    );
    return false;
  }
}

/**
 * The startup view restored on load: the explicitly flagged view, else the
 * immutable Risk & Positions preset, else the first remaining view.
 */
function resolveStartupViewId(views: WorkstationView[]): string {
  const flagged = views.find((v) => v.isStartup);
  if (flagged) return flagged.id;
  const sys = views.find((v) => v.id === WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
  if (sys) return sys.id;
  return views[0]?.id ?? '';
}

/** Deep-clone a view envelope (config grid rows and hidden set are copied). */
function cloneViewEnvelope(v: WorkstationView): WorkstationView {
  return { ...v, config: cloneWorkstationViewConfig(v.config) };
}

// ── Shared-route envelope mapping ──────────────────────────────────────

/**
 * Map a row from the shared `/api/dashboard/views` route to a workstation
 * view. Returns null when the row is not a workstation-shaped view (e.g. a
 * dashboard view whose layout is an array of grid items), so callers filter
 * foreign rows out of the shared table. Workstation rows run their config
 * through migration-on-read, so v1 (pre-dense) API rows upgrade to v2 and
 * corrupt configs fall back to the dense default.
 */
function toWorkstationView(row: DashboardView): WorkstationView | null {
  // Distinguish workstation rows (layout = a view-config object) from
  // dashboard rows in the shared table (layout = an array of grid items).
  if (!isWorkstationViewConfigShape(row.layout)) return null;
  return {
    id: row.id,
    name: row.name,
    config: migrateWorkstationViewConfig(row.layout),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isSystem: row.isSystem,
    isStartup: row.isDefault,
  };
}

/**
 * Serialize a workstation view to the shared route payload: the layout
 * configuration JSON-encoded into the `layout` field (the route stores it as
 * TEXT and re-parses it on GET). `hiddenWidgetIds` is unused for workstation
 * views and stays an empty array.
 */
function toApiPayload(view: WorkstationView): SaveViewPayload {
  return {
    id: view.id,
    name: view.name,
    layout: JSON.stringify(view.config),
    hiddenWidgetIds: '[]',
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    isSystem: view.isSystem,
    isDefault: view.isStartup,
  };
}

// ── Options / Result Types ─────────────────────────────────────────────

export interface UseWorkstationViewsOptions {
  /**
   * Initial views to use when no saved data exists in localStorage.
   * Defaults to the three system template views.
   */
  defaultViews?: WorkstationView[];
  /** Optional storage key override. Defaults to `workstation:views:v1`. */
  storageKey?: string;
}

export interface UseWorkstationViewsResult {
  /** All views (system presets + user views), ordered by creation. */
  views: WorkstationView[];
  /** The currently active view object, or undefined during hydration. */
  activeView: WorkstationView | undefined;
  /** ID of the currently active view. */
  activeViewId: string;
  /** ID of the view restored on load (the `isStartup` view). */
  startupViewId: string;
  /** Whether the store has been hydrated from localStorage. */
  isLoaded: boolean;
  /** True if the most recent localStorage write failed. Cleared on the next success. */
  writeFailed: boolean;
  /** Switch to a different view by ID. No-op for unknown IDs. */
  setActiveView: (id: string) => void;
  /**
   * Create a new user view from a system template. `templateId` defaults to
   * the active view's template. Switches to the new view on success.
   */
  createView: (name: string, templateId?: WorkstationTemplateId) => WorkstationView;
  /** Rename a user view. No-op for system presets or an empty name. */
  renameView: (id: string, name: string) => void;
  /**
   * Duplicate a view as a new user view named "{source name} (Copy)" (or the
   * provided name). Switches to the new view on success. Returns null when
   * the source id is unknown.
   */
  duplicateView: (id: string, newName?: string) => WorkstationView | null;
  /**
   * Delete a user view. Cannot delete system presets or the last remaining
   * view. If the active view is deleted, switches to the Risk & Positions
   * preset (or the first remaining view).
   */
  deleteView: (id: string) => void;
  /**
   * Mark a view as the startup view (restored on load). Only one view is the
   * startup view at a time; any view — system preset or user view — may be
   * selected (R035: the Risk & Positions preset is the startup view until the
   * user explicitly selects another).
   */
  setStartupView: (id: string) => void;
  /**
   * Replace a user view's layout configuration. The config is validated
   * against the approved panel catalogue before it is applied (R035); an
   * invalid config, an unknown id, or a system preset returns false without
   * changing state.
   */
  updateViewConfig: (id: string, config: WorkstationViewConfig) => boolean;
  /** Reset a user view's configuration to its template's base grid. */
  resetView: (id: string) => void;
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Manage workstation views with full CRUD, API persistence through the shared
 * `/api/dashboard/views` route, and localStorage fallback persistence.
 *
 * On mount:
 * 1. Hydrates from localStorage in an effect (SSR-safe: the first render
 *    always uses the defaults so server HTML and the client's first paint
 *    agree, then saved views are applied immediately after mount)
 * 2. Asynchronously fetches from the API; workstation-shaped rows override
 *    the localStorage data
 * 3. If the API returns no workstation views and localStorage has data,
 *    migrates the localStorage views to the shared API table (fire-and-forget)
 *
 * On state changes:
 * - Always persists to localStorage (synchronous, offline backup)
 * - Also persists to the API (fire-and-forget, non-blocking)
 * - localStorage write failures set the writeFailed flag (cleared on the
 *   next successful write)
 *
 * System template views are curated presets and are read-only (cannot be
 * renamed, deleted, customized, or reset). User views are fully mutable.
 * Every persisted config is validated against the approved panel catalogue on
 * read and on write.
 */
export function useWorkstationViews(
  options: UseWorkstationViewsOptions = {},
): UseWorkstationViewsResult {
  const { defaultViews = createSystemWorkstationViews(), storageKey } = options;
  const key = storageKey ?? STORAGE_KEY;

  const [state, dispatch] = useReducer(
    viewsReducer,
    { defaultViews, storageKey: key } as InitParams,
    createInitialState,
  );

  // ── Hydration effects ─────────────────────────────────────────────

  // Ref for cancellation of async API hydration
  const apiHydrationCancelledRef = useRef(false);

  // 1. localStorage hydration — applies saved views immediately after
  // mount (SSR-safe: the first render already matched the server defaults).
  useEffect(() => {
    const saved = readViews(key);
    if (saved) {
      dispatch({
        type: 'HYDRATE',
        views: saved.views.map(cloneViewEnvelope),
        activeViewId: saved.activeViewId,
      });
    } else {
      // No saved data — use the latest defaultViews (closure captures the
      // value from this render; the effect only runs when `key` changes).
      const currentDefs = defaultViews;
      dispatch({
        type: 'HYDRATE',
        views: currentDefs.map(cloneViewEnvelope),
        activeViewId: resolveStartupViewId(currentDefs),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 2. Async API hydration — overrides localStorage data when available
  useEffect(() => {
    apiHydrationCancelledRef.current = false;

    fetchViewsApi()
      .then((rows) => {
        if (apiHydrationCancelledRef.current) return;

        // Filter the shared table to workstation-shaped rows (R035).
        const fetched: WorkstationView[] = [];
        for (const row of rows) {
          const view = toWorkstationView(row);
          if (view !== null) fetched.push(view);
        }

        if (fetched.length > 0) {
          // API has workstation views — override localStorage with them.
          dispatch({
            type: 'HYDRATE',
            views: fetched.map(cloneViewEnvelope),
            activeViewId: resolveStartupViewId(fetched),
          });
        } else {
          // API returned no workstation views — migrate localStorage data.
          const localStorageData = readViews(key);
          if (localStorageData && localStorageData.views.length > 0) {
            migrateToApi(localStorageData.views).catch(() => {
              // Migration failure is non-critical — localStorage data is
              // already loaded and remains the source of truth.
            });
          }
        }
      })
      .catch((error: unknown) => {
        // API unavailable — localStorage data was already applied by the
        // hydration effect, so the user's views remain intact.
        console.warn(
          '[useWorkstationViews] API hydration failed; using localStorage views. ' +
            (error instanceof Error ? error.message : String(error)),
        );
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
    const ok = writeViews(key, state.views, state.activeViewId);
    dispatch(ok ? { type: 'CLEAR_WRITE_FAILED' } : { type: 'MARK_WRITE_FAILED' });

    // 2. Sync to API (fire-and-forget, non-blocking)
    syncStateToApi(state.views, pendingDeletionIdsRef).catch((error: unknown) => {
      // API write failures are non-blocking — the localStorage backup exists.
      // The writeFailed flag is reserved for localStorage failures only.
      console.warn(
        '[useWorkstationViews] API sync failed; localStorage backup remains. ' +
          (error instanceof Error ? error.message : String(error)),
      );
    });
  }, [state, key]);

  // ── Actions ──────────────────────────────────────────────────────────

  const setActiveView = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE', id });
  }, []);

  const createView = useCallback(
    (name: string, templateId?: WorkstationTemplateId): WorkstationView => {
      const displayName = name.trim() || 'Untitled View';
      const active = viewsRef.current.find((v) => v.id === state.activeViewId);
      const template =
        templateId ?? active?.config.templateId ?? WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS;
      const now = new Date().toISOString();
      const newView: WorkstationView = {
        id: `${USER_VIEW_ID_PREFIX}${generateViewId()}`,
        name: displayName,
        config: createViewFromTemplate(template),
        createdAt: now,
        updatedAt: now,
        isSystem: false,
        isStartup: false,
      };
      dispatch({ type: 'CREATE', view: newView });
      return newView;
    },
    [state.activeViewId],
  );

  const renameView = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return; // the API route requires a non-empty name
    dispatch({ type: 'RENAME', id, name: trimmed });
  }, []);

  const duplicateView = useCallback((id: string, newName?: string): WorkstationView | null => {
    const source = viewsRef.current.find((v) => v.id === id);
    if (!source) return null;
    const displayName = newName?.trim() || `${source.name} (Copy)`;
    const now = new Date().toISOString();
    const newView: WorkstationView = {
      id: `${USER_VIEW_ID_PREFIX}${generateViewId()}`,
      name: displayName,
      config: cloneWorkstationViewConfig(source.config),
      createdAt: now,
      updatedAt: now,
      isSystem: false,
      isStartup: false,
    };
    dispatch({ type: 'DUPLICATE', sourceId: id, newView });
    return newView;
  }, []);

  const deleteView = useCallback((id: string) => {
    // Track for API sync
    pendingDeletionIdsRef.current.add(id);
    dispatch({ type: 'DELETE', id });
  }, []);

  const setStartupView = useCallback((id: string) => {
    dispatch({ type: 'SET_STARTUP', id });
  }, []);

  const updateViewConfig = useCallback(
    (id: string, config: WorkstationViewConfig): boolean => {
      // R035: layouts are validated against the approved panel catalogue
      // before they can enter persisted state.
      const issues = validateWorkstationViewConfig(config);
      if (issues.length > 0) {
        console.warn(
          `[useWorkstationViews] updateViewConfig rejected invalid layout for "${id}": ` +
            issues.join('; '),
        );
        return false;
      }
      const target = viewsRef.current.find((v) => v.id === id);
      if (!target || target.isSystem) return false;
      dispatch({ type: 'UPDATE_CONFIG', id, config: cloneWorkstationViewConfig(config) });
      return true;
    },
    [],
  );

  const resetView = useCallback((id: string) => {
    dispatch({ type: 'RESET', id });
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────

  const activeView = state.views.find((v) => v.id === state.activeViewId);
  // Derive through the same resolution used for hydration so the startup view
  // stays consistent with the active view even when persisted/API data carries
  // no isStartup flag (falls back to the Risk & Positions preset).
  const startupViewId = resolveStartupViewId(state.views);

  return {
    views: state.views,
    activeView,
    activeViewId: state.activeViewId,
    startupViewId,
    isLoaded: state.isLoaded,
    writeFailed: state.writeFailed,
    setActiveView,
    createView,
    renameView,
    deleteView,
    duplicateView,
    setStartupView,
    updateViewConfig,
    resetView,
  };
}

// ── API Sync ───────────────────────────────────────────────────────────

/**
 * Synchronise the current view list to the shared API table.
 *
 * 1. Deletes views that were removed from state (pending deletions)
 * 2. Upserts all current views via the shared `/api/dashboard/views` POST
 *
 * All API calls use the fire-and-forget pattern. Errors propagate for the
 * caller to catch silently.
 */
async function syncStateToApi(
  views: WorkstationView[],
  pendingDeletionIdsRef: MutableRefObject<Set<string>>,
): Promise<void> {
  // Process pending deletions first
  const deletions = pendingDeletionIdsRef.current;
  if (deletions.size > 0) {
    const deletePromises = Array.from(deletions).map((id) => deleteViewApi(id));
    await Promise.allSettled(deletePromises);
    pendingDeletionIdsRef.current = new Set();
  }

  // Upsert all current views
  const savePromises = views.map((view) => saveViewApi(toApiPayload(view)));
  await Promise.allSettled(savePromises);
}

/**
 * Migrate localStorage workstation views to the shared API table (used when
 * the API returns no workstation views on first load). One upsert per view;
 * the shared route stores the workstation config JSON in the `layout` field.
 */
async function migrateToApi(views: WorkstationView[]): Promise<void> {
  const savePromises = views.map((view) => saveViewApi(toApiPayload(view)));
  await Promise.allSettled(savePromises);
}
