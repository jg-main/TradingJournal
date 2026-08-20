import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import {
  dashboardEnvelopeFromView,
  usePerformanceDashboards,
} from '../use-performance-dashboards';
import type { DashboardView } from '@/types/dashboard-view';
import type { LayoutItem } from 'react-grid-layout';
import {
  isPerformanceDashboardConfigShape,
  cloneDashboardConfig,
  resetDashboardToTemplate,
  createDefaultDashboardConfig,
  createSystemDefaultDashboard,
  PERFORMANCE_SYSTEM_DASHBOARD_IDS,
  type PerformanceDashboardConfig,
  type WidgetInstance,
} from '@/lib/performance-view-types';

// ── localStorage mock ───────────────────────────────────────────────────

const store = new Map<string, string>();

const lsMock: Storage = {
  getItem: vi.fn((k: string) => store.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    store.set(k, v);
  }),
  removeItem: vi.fn((k: string) => store.delete(k)),
  clear: vi.fn(() => store.clear()),
  get length() {
    return store.size;
  },
  key: vi.fn((i: number) => Array.from(store.keys())[i] ?? null),
};

Object.defineProperty(globalThis, 'localStorage', { value: lsMock });

// ── Fetch mock ──────────────────────────────────────────────────────────

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(body: unknown, status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetchMock {
  fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchDefaultViews(): typeof fetchMock {
  return stubFetch(async (url) => {
    if (typeof url === 'string' && url.includes('/api/dashboard/views')) {
      return okResponse([]);
    }
    return errorResponse({ error: 'not found' }, 404);
  });
}

// ── Fixtures ────────────────────────────────────────────────────────────

function dashboardView(id: string, name: string, config: unknown, isSystem = false): DashboardView {
  return {
    id,
    name,
    layout: config as unknown as LayoutItem[],
    hiddenWidgetIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isSystem,
    isDefault: false,
  };
}

function userDashboardConfig(overrides?: Partial<PerformanceDashboardConfig>): PerformanceDashboardConfig {
  const base = createDefaultDashboardConfig();
  return {
    ...base,
    name: 'My Dashboard',
    instances: base.instances.slice(0, 1).map((inst) => ({
      ...inst,
      instanceId: 'inst-1',
      layout: { ...inst.layout, i: 'inst-1' },
    })),
    ...overrides,
  };
}

function instanceWithTitle(title: string): WidgetInstance {
  return {
    instanceId: 'inst-custom',
    widgetType: 'net-pnl',
    config: { titleOverride: title },
    layout: { i: 'inst-custom', x: 0, y: 0, w: 3, h: 2 },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════════════

describe('use-performance-dashboards (pure helpers)', () => {
  describe('dashboardEnvelopeFromView', () => {
    it('extracts a pd- envelope from a shared view row', () => {
      const config = userDashboardConfig();
      const envelope = dashboardEnvelopeFromView(dashboardView('pd-user-abc', 'My Dashboard', config));
      expect(envelope).not.toBeNull();
      expect(envelope!.id).toBe('pd-user-abc');
      expect(envelope!.config.instances).toHaveLength(1);
      expect(envelope!.isSystem).toBe(false);
    });

    it('returns null for non-pd ids', () => {
      const view: DashboardView = {
        id: 'ws-system-risk',
        name: 'Workstation',
        layout: [] as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: true,
        isDefault: false,
      };
      expect(dashboardEnvelopeFromView(view)).toBeNull();
    });

    it('returns null for a JSON-string layout that is not a config', () => {
      const view: DashboardView = {
        id: 'pd-user-xyz',
        name: 'Bad',
        layout: JSON.stringify({ version: 1 }) as unknown as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: false,
        isDefault: false,
      };
      expect(dashboardEnvelopeFromView(view)).toBeNull();
    });

    it('returns null for invalid config shape', () => {
      const view: DashboardView = {
        id: 'pd-user-xyz',
        name: 'Bad',
        layout: JSON.parse('{"version":1}') as unknown as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: false,
        isDefault: false,
      };
      expect(dashboardEnvelopeFromView(view)).toBeNull();
    });

    it('returns null for invalid widget type in config', () => {
      const config = {
        version: 1,
        name: 'Bad Widget',
        instances: [
          { instanceId: 'i1', widgetType: 'not-a-real-widget', config: {}, layout: { i: 'i1', x: 0, y: 0, w: 3, h: 2 } },
        ],
      };
      const view: DashboardView = {
        id: 'pd-user-zzz',
        name: 'Bad Widget',
        layout: config as unknown as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: false,
        isDefault: false,
      };
      expect(dashboardEnvelopeFromView(view)).toBeNull();
    });

    it('runs migration-on-read for string-serialized configs', () => {
      const config = userDashboardConfig();
      const view: DashboardView = {
        id: 'pd-user-mig',
        name: 'Migrated',
        layout: JSON.stringify(config) as unknown as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: false,
        isDefault: false,
      };
      const envelope = dashboardEnvelopeFromView(view);
      expect(envelope).not.toBeNull();
      expect(envelope!.config.version).toBe(1);
      expect(envelope!.config.instances).toHaveLength(1);
    });
  });

  describe('config helpers', () => {
    it('cloneDashboardConfig produces independent copy', () => {
      const config: PerformanceDashboardConfig = {
        version: 1,
        name: 'Source',
        instances: [
          {
            instanceId: 'i1',
            widgetType: 'net-pnl',
            config: { titleOverride: 'A' },
            layout: { i: 'i1', x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      };
      const clone = cloneDashboardConfig(config);
      clone.instances[0].config.titleOverride = 'B';
      clone.instances[0].layout.x = 5;
      expect(config.instances[0].config.titleOverride).toBe('A');
      expect(config.instances[0].layout.x).toBe(0);
    });

    it('resetDashboardToTemplate returns default template', () => {
      const config = resetDashboardToTemplate();
      expect(config.name).toBe('Performance Default');
      expect(isPerformanceDashboardConfigShape(config)).toBe(true);
    });

    it('createSystemDefaultDashboard is immutable system envelope', () => {
      const envelope = createSystemDefaultDashboard();
      expect(envelope.isSystem).toBe(true);
      expect(envelope.id).toBe(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Hook behavior
// ═══════════════════════════════════════════════════════════════════════

describe('usePerformanceDashboards (hook)', () => {
  beforeEach(() => {
    store.clear();
    vi.unstubAllGlobals();
    stubFetchDefaultViews();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('hydrates with the immutable system default as the only dashboard', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.dashboards).toHaveLength(1);
    expect(result.current.dashboards[0].id).toBe(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
    expect(result.current.dashboards[0].isSystem).toBe(true);
    expect(result.current.activeDashboardId).toBe(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
  });

  it('merges the system default with API rows and drops foreign (ws-) rows', async () => {
    const userConfig = userDashboardConfig();
    const wsRow = dashboardView('ws-system-risk', 'Workstation', { templateId: 'risk', areas: [] });
    stubFetch(async (url) => {
      if (typeof url === 'string' && url.includes('/api/dashboard/views')) {
        return okResponse([wsRow, dashboardView('pd-user-1', 'My Dashboard', userConfig)]);
      }
      return errorResponse({ error: 'not found' }, 404);
    });

    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    const ids = result.current.dashboards.map((d) => d.id);
    expect(ids).toContain(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
    expect(ids).toContain('pd-user-1');
    expect(ids).not.toContain('ws-system-risk');
    expect(result.current.dashboards).toHaveLength(2);
  });

  it('drops invalid pd- rows on API hydration', async () => {
    stubFetch(async (url) => {
      if (typeof url === 'string' && url.includes('/api/dashboard/views')) {
        return okResponse([
          dashboardView('pd-user-bad', 'Bad', {
            version: 1,
            name: 'Bad',
            instances: [
              { instanceId: 'i1', widgetType: 'not-a-real-widget', config: {}, layout: { i: 'i1', x: 0, y: 0, w: 3, h: 2 } },
            ],
          }),
        ]);
      }
      return errorResponse({ error: 'not found' }, 404);
    });

    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.dashboards).toHaveLength(1);
    expect(result.current.dashboards[0].id).toBe(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
  });

  it('preserves the active dashboard across API hydration', async () => {
    const userConfig = userDashboardConfig();
    stubFetch(async (url) => {
      if (typeof url === 'string' && url.includes('/api/dashboard/views')) {
        return okResponse([dashboardView('pd-user-1', 'My Dashboard', userConfig)]);
      }
      return errorResponse({ error: 'not found' }, 404);
    });

    // Seed the active dashboard in localStorage so the fast-path activates it.
    store.set(
      'performance:dashboards:v1',
      JSON.stringify({
        dashboards: [createSystemDefaultDashboard(), { id: 'pd-user-1', name: 'My Dashboard', isSystem: false, config: userConfig }],
        activeId: 'pd-user-1',
      }),
    );

    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.activeDashboardId).toBe('pd-user-1');
  });

  it('createDashboard snapshots the active dashboard and switches to the new one', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let newId = '';
    act(() => {
      newId = result.current.createDashboard('Week 3');
    });
    expect(result.current.dashboards).toHaveLength(2);
    expect(result.current.activeDashboardId).toBe(newId);
    expect(result.current.activeDashboard?.name).toBe('Week 3');
    expect(result.current.activeDashboard?.isSystem).toBe(false);
    // The new dashboard is a deep snapshot of the default (curated instances).
    expect(result.current.activeDashboard?.config.instances.length).toBeGreaterThan(0);

    // Write-through to API (POST with pd- id)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/dashboard/views',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const postCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalls.length).toBeGreaterThan(0);
    const body = JSON.parse((postCalls[0][1] as RequestInit).body as string);
    expect(body.id).toMatch(/^pd-user-/);
    expect(body.name).toBe('Week 3');
    expect(body.isSystem).toBe(false);
  });

  it('renameDashboard renames user dashboards only', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let newId = '';
    act(() => {
      newId = result.current.createDashboard('Original');
    });

    act(() => {
      result.current.renameDashboard(newId, 'Renamed');
    });
    expect(result.current.dashboards.find((d) => d.id === newId)?.name).toBe('Renamed');

    // System default is immutable
    act(() => {
      result.current.renameDashboard(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT, 'Hacked Name');
    });
    expect(
      result.current.dashboards.find((d) => d.id === PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT)?.name,
    ).toBe('Performance Default');
  });

  it('duplicateDashboard creates a deep-independent copy and switches to it', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let newId = '';
    act(() => {
      newId = result.current.createDashboard('Alpha');
    });
    act(() => {
      result.current.saveDashboardState([instanceWithTitle('Custom Title')]);
    });

    let copyId: string | null = null;
    act(() => {
      copyId = result.current.duplicateDashboard(newId);
    });
    expect(copyId).not.toBeNull();
    expect(result.current.activeDashboardId).toBe(copyId);
    const copy = result.current.dashboards.find((d) => d.id === copyId);
    expect(copy?.name).toBe('Alpha (Copy)');
    expect(copy?.isSystem).toBe(false);

    // Deep independence: mutating the copy must not affect the source.
    act(() => {
      result.current.saveDashboardState([
        { ...instanceWithTitle('Copy Title'), instanceId: 'inst-copy' },
      ]);
    });
    const source = result.current.dashboards.find((d) => d.id === newId);
    expect(source?.config.instances[0].config.titleOverride).toBe('Custom Title');
    expect(copy?.config.instances[0].config.titleOverride).toBe('Custom Title');
  });

  it('deleteDashboard removes user dashboards and falls back to the system default; system is protected', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let newId = '';
    act(() => {
      newId = result.current.createDashboard('To Delete');
    });
    expect(result.current.dashboards).toHaveLength(2);

    // Deleting the active user dashboard falls back to the system default.
    act(() => {
      result.current.deleteDashboard(newId);
    });
    expect(result.current.dashboards).toHaveLength(1);
    expect(result.current.activeDashboardId).toBe(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);

    // System default cannot be deleted.
    act(() => {
      result.current.deleteDashboard(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
    });
    expect(result.current.dashboards).toHaveLength(1);

    // DELETE was issued for the user dashboard.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/dashboard/views?id=${encodeURIComponent(newId)}`),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('switchDashboard switches the active dashboard', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let newId = '';
    act(() => {
      newId = result.current.createDashboard('Second');
    });
    act(() => {
      result.current.switchDashboard(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
    });
    expect(result.current.activeDashboardId).toBe(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);

    act(() => {
      result.current.switchDashboard(newId);
    });
    expect(result.current.activeDashboardId).toBe(newId);
  });

  it('saveDashboardState persists widget instances for user dashboards only', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let newId = '';
    act(() => {
      newId = result.current.createDashboard('Editable');
    });
    act(() => {
      result.current.saveDashboardState([instanceWithTitle('My Title')]);
    });

    const updated = result.current.dashboards.find((d) => d.id === newId);
    expect(updated?.config.instances).toHaveLength(1);
    expect(updated?.config.instances[0].config.titleOverride).toBe('My Title');

    // Saving while the system default is active is a no-op for the default.
    act(() => {
      result.current.switchDashboard(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
    });
    act(() => {
      result.current.saveDashboardState([instanceWithTitle('Should Not Stick')]);
    });
    const sys = result.current.dashboards.find((d) => d.id === PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
    expect(sys?.config.instances.every((i) => i.config.titleOverride !== 'Should Not Stick')).toBe(true);
  });

  it('resetDashboard restores the template config for user dashboards', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let newId = '';
    act(() => {
      newId = result.current.createDashboard('Dirty');
    });
    act(() => {
      result.current.saveDashboardState([instanceWithTitle('Dirty Title')]);
    });
    expect(result.current.dashboards.find((d) => d.id === newId)?.config.instances[0].config.titleOverride).toBe(
      'Dirty Title',
    );

    act(() => {
      result.current.resetDashboard(newId);
    });
    const reset = result.current.dashboards.find((d) => d.id === newId);
    expect(reset?.config.instances.every((i) => i.config.titleOverride !== 'Dirty Title')).toBe(true);
    expect(reset?.config.name).toBe('Performance Default');
  });

  it('surfaces API write failures via writeFailed and clears on the next success', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    // Fail the next POST, then recover.
    let failNext = true;
    stubFetch(async (url, init) => {
      if (typeof url === 'string' && url.includes('/api/dashboard/views')) {
        if (init?.method === 'POST' && failNext) {
          failNext = false;
          return errorResponse({ error: 'boom' }, 500);
        }
        return okResponse({});
      }
      return errorResponse({ error: 'not found' }, 404);
    });

    act(() => {
      result.current.createDashboard('Fail Once');
    });
    await waitFor(() => expect(result.current.writeFailed).toBe(true));

    // A later successful write clears the flag (no stale warning).
    act(() => {
      result.current.renameDashboard(result.current.activeDashboardId, 'Recovered');
    });
    await waitFor(() => expect(result.current.writeFailed).toBe(false));
  });

  it('hydrates from localStorage when the API is unavailable', async () => {
    stubFetch(async () => {
      throw new Error('network down');
    });

    store.set(
      'performance:dashboards:v1',
      JSON.stringify({
        dashboards: [createSystemDefaultDashboard()],
        activeId: PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT,
      }),
    );

    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.dashboards[0].id).toBe(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
  });

  it('persists store state to localStorage after hydration', async () => {
    const { result } = renderHook(() => usePerformanceDashboards());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.createDashboard('Persisted');
    });
    await waitFor(() => {
      const raw = store.get('performance:dashboards:v1');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.dashboards.some((d: { name: string }) => d.name === 'Persisted')).toBe(true);
    });
  });
});
