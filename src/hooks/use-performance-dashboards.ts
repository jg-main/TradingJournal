'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { DashboardView } from '@/types/dashboard-view';
import {
  fetchViewsApi,
  saveViewApi,
  deleteViewApi,
  type SaveViewPayload,
} from './use-dashboard-views-api';
import {
  isPerformanceDashboardConfigShape,
  validatePerformanceDashboardConfig,
  migratePerformanceDashboardConfig,
  cloneDashboardConfig,
  resetDashboardToTemplate,
  createSystemDefaultDashboard,
  PERFORMANCE_SYSTEM_DASHBOARD_IDS,
  type PerformanceDashboardEnvelope,
  type WidgetInstance,
} from '@/lib/performance-view-types';
import { getValidWidgetTypes } from '@/lib/performance-widget-registry';

// ── State ───────────────────────────────────────────────────────────────────

export interface PerformanceDashboardsState {
  dashboards: PerformanceDashboardEnvelope[];
  activeDashboardId: string;
  loading: boolean;
  writeFailed: boolean;
  hydrated: boolean;
}

type Action =
  | { type: 'hydrate'; dashboards: PerformanceDashboardEnvelope[]; activeId: string }
  | { type: 'setLoading'; loading: boolean }
  | { type: 'setWriteFailed'; failed: boolean }
  | { type: 'create'; dashboard: PerformanceDashboardEnvelope }
  | { type: 'rename'; id: string; name: string }
  | { type: 'duplicate'; dashboard: PerformanceDashboardEnvelope }
  | { type: 'delete'; id: string }
  | { type: 'switch'; id: string }
  | { type: 'saveState'; id: string; instances: WidgetInstance[] }
  | { type: 'reset'; id: string };

function reducer(state: PerformanceDashboardsState, action: Action): PerformanceDashboardsState {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        dashboards: action.dashboards,
        activeDashboardId: action.activeId,
        hydrated: true,
        loading: false,
      };
    case 'setLoading':
      return { ...state, loading: action.loading };
    case 'setWriteFailed':
      return { ...state, writeFailed: action.failed };
    case 'create':
      return {
        ...state,
        dashboards: [...state.dashboards, action.dashboard],
        activeDashboardId: action.dashboard.id,
      };
    case 'rename':
      return {
        ...state,
        dashboards: state.dashboards.map((d) =>
          d.id === action.id && !d.isSystem ? { ...d, name: action.name } : d,
        ),
      };
    case 'duplicate':
      return {
        ...state,
        dashboards: [...state.dashboards, action.dashboard],
        activeDashboardId: action.dashboard.id,
      };
    case 'delete':
      return {
        ...state,
        dashboards: state.dashboards.filter((d) => d.id !== action.id),
        activeDashboardId:
          state.activeDashboardId === action.id ? state.dashboards[0]?.id ?? action.id : state.activeDashboardId,
      };
    case 'switch':
      return { ...state, activeDashboardId: action.id };
    case 'saveState':
      return {
        ...state,
        dashboards: state.dashboards.map((d) =>
          d.id === action.id && !d.isSystem ? { ...d, config: { ...d.config, instances: action.instances } } : d,
        ),
      };
    case 'reset':
      return {
        ...state,
        dashboards: state.dashboards.map((d) =>
          d.id === action.id ? { ...d, config: resetDashboardToTemplate() } : d,
        ),
      };
    default:
      return state;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = 'performance:dashboards:v1';
const VALID_WIDGET_TYPES = getValidWidgetTypes();

function generateDashboardId(): string {
  return `pd-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ensure the immutable system default is always present in the dashboard list.
 * The default is a local template (never persisted server-side), so API
 * hydration must merge it back in when it is absent.
 */
function ensureSystemDefault(dashboards: PerformanceDashboardEnvelope[]): PerformanceDashboardEnvelope[] {
  if (dashboards.some((d) => d.id === PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT)) {
    return dashboards;
  }
  return [createSystemDefaultDashboard(), ...dashboards];
}

/**
 * Extract a PerformanceDashboardEnvelope from a shared DashboardView row.
 * Returns null when the row is not a performance-dashboard-shaped config.
 */
export function dashboardEnvelopeFromView(view: DashboardView): PerformanceDashboardEnvelope | null {
  if (!view.id.startsWith('pd-')) return null;
  // The shared views API parses the layout JSON column; for pd- rows the
  // parsed value is the PerformanceDashboardConfig object itself.
  let config: unknown = view.layout;
  if (typeof view.layout === 'string') {
    try {
      config = JSON.parse(view.layout);
    } catch {
      return null;
    }
  }
  if (!isPerformanceDashboardConfigShape(config)) return null;
  const migrated = migratePerformanceDashboardConfig(config);
  const error = validatePerformanceDashboardConfig(migrated, VALID_WIDGET_TYPES);
  if (error) return null;
  return {
    id: view.id,
    name: view.name,
    isSystem: !!view.isSystem,
    config: migrated,
  };
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface UsePerformanceDashboardsResult {
  dashboards: PerformanceDashboardEnvelope[];
  activeDashboardId: string;
  activeDashboard: PerformanceDashboardEnvelope | null;
  loading: boolean;
  writeFailed: boolean;
  hydrated: boolean;
  createDashboard: (name?: string) => string;
  renameDashboard: (id: string, name: string) => void;
  duplicateDashboard: (id: string) => string | null;
  deleteDashboard: (id: string) => void;
  switchDashboard: (id: string) => void;
  saveDashboardState: (instances: WidgetInstance[]) => void;
  resetDashboard: (id: string) => void;
}

export function usePerformanceDashboards(): UsePerformanceDashboardsResult {
  const [state, dispatch] = useReducer(reducer, {
    dashboards: [createSystemDefaultDashboard()],
    activeDashboardId: PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT,
    loading: true,
    writeFailed: false,
    hydrated: false,
  });
  const stateRef = useRef(state);
  // Ref updated in an effect (not during render) per react-hooks/refs.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Hydrate from localStorage first (fast), then sync from API.
  useEffect(() => {
    let cancelled = false;

    // localStorage fast-path
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            dashboards: PerformanceDashboardEnvelope[];
            activeId: string;
          };
          if (Array.isArray(parsed.dashboards) && parsed.dashboards.length > 0) {
            const valid = parsed.dashboards
              .filter((d) => isPerformanceDashboardConfigShape(d.config))
              .map((d) => ({ ...d, config: migratePerformanceDashboardConfig(d.config) }));
            const merged = ensureSystemDefault(valid);
            if (merged.length > 0) {
              dispatch({ type: 'hydrate', dashboards: merged, activeId: parsed.activeId ?? merged[0].id });
            }
          }
        }
      } catch {
        // Corrupt storage → fall through to API hydrate
      }
    }

    // API sync
    fetchViewsApi()
      .then((views: DashboardView[]) => {
        if (cancelled) return;
        const envelopes = views.map(dashboardEnvelopeFromView).filter((e): e is PerformanceDashboardEnvelope => e !== null);
        // The immutable system default always exists — merge it with API rows.
        const merged = ensureSystemDefault(envelopes);
        const activeId = stateRef.current.activeDashboardId;
        const activeExists = merged.some((e) => e.id === activeId);
        dispatch({
          type: 'hydrate',
          dashboards: merged,
          activeId: activeExists ? activeId : PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT,
        });
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: 'hydrate', dashboards: stateRef.current.dashboards, activeId: stateRef.current.activeDashboardId });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to localStorage on change (server sync is per-action).
  useEffect(() => {
    if (!state.hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({ dashboards: state.dashboards, activeId: state.activeDashboardId }),
      );
    } catch {
      // non-fatal
    }
  }, [state.dashboards, state.activeDashboardId, state.hydrated]);

  const persistToApi = useCallback((envelope: PerformanceDashboardEnvelope) => {
    const payload: SaveViewPayload = {
      id: envelope.id,
      name: envelope.name,
      layout: JSON.stringify(envelope.config),
      hiddenWidgetIds: '[]',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSystem: envelope.isSystem,
      isDefault: envelope.id === PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT,
    };
    saveViewApi(payload).catch(() => dispatch({ type: 'setWriteFailed', failed: true }));
  }, []);

  const createDashboard = useCallback(
    (name = 'New Dashboard') => {
      const source = stateRef.current.dashboards.find((d) => d.id === stateRef.current.activeDashboardId) ?? stateRef.current.dashboards[0];
      const envelope: PerformanceDashboardEnvelope = {
        id: generateDashboardId(),
        name,
        isSystem: false,
        config: { ...cloneDashboardConfig(source.config), name },
      };
      dispatch({ type: 'create', dashboard: envelope });
      persistToApi(envelope);
      return envelope.id;
    },
    [persistToApi],
  );

  const renameDashboard = useCallback(
    (id: string, name: string) => {
      dispatch({ type: 'rename', id, name });
      const target = stateRef.current.dashboards.find((d) => d.id === id);
      if (target && !target.isSystem) persistToApi({ ...target, name });
    },
    [persistToApi],
  );

  const duplicateDashboard = useCallback(
    (id: string): string | null => {
      const source = stateRef.current.dashboards.find((d) => d.id === id);
      if (!source) return null;
      const envelope: PerformanceDashboardEnvelope = {
        id: generateDashboardId(),
        name: `${source.name} (Copy)`,
        isSystem: false,
        config: { ...cloneDashboardConfig(source.config), name: `${source.name} (Copy)` },
      };
      dispatch({ type: 'duplicate', dashboard: envelope });
      persistToApi(envelope);
      return envelope.id;
    },
    [persistToApi],
  );

  const deleteDashboard = useCallback(
    (id: string) => {
      const target = stateRef.current.dashboards.find((d) => d.id === id);
      if (!target || target.isSystem) return; // system dashboards cannot be deleted
      dispatch({ type: 'delete', id });
      deleteViewApi(id).catch(() => dispatch({ type: 'setWriteFailed', failed: true }));
    },
    [],
  );

  const switchDashboard = useCallback((id: string) => {
    dispatch({ type: 'switch', id });
  }, []);

  const saveDashboardState = useCallback(
    (instances: WidgetInstance[]) => {
      const id = stateRef.current.activeDashboardId;
      dispatch({ type: 'saveState', id, instances });
      const target = stateRef.current.dashboards.find((d) => d.id === id);
      if (target && !target.isSystem) {
        persistToApi({ ...target, config: { ...target.config, instances } });
      }
    },
    [persistToApi],
  );

  const resetDashboard = useCallback(
    (id: string) => {
      dispatch({ type: 'reset', id });
      const target = stateRef.current.dashboards.find((d) => d.id === id);
      if (target && !target.isSystem) {
        persistToApi({ ...target, config: resetDashboardToTemplate() });
      }
    },
    [persistToApi],
  );

  const activeDashboard = state.dashboards.find((d) => d.id === state.activeDashboardId) ?? state.dashboards[0] ?? null;

  return {
    dashboards: state.dashboards,
    activeDashboardId: activeDashboard?.id ?? state.activeDashboardId,
    activeDashboard,
    loading: state.loading,
    writeFailed: state.writeFailed,
    hydrated: state.hydrated,
    createDashboard,
    renameDashboard,
    duplicateDashboard,
    deleteDashboard,
    switchDashboard,
    saveDashboardState,
    resetDashboard,
  };
}
