/**
 * Tests for the useWorkstationViews hook (M016/S06-T02).
 *
 * Covers: default system presets and startup resolution, active view
 * switching, create/rename/duplicate/delete CRUD, startup view selection,
 * validated config updates (R035), reset-to-template, localStorage
 * persistence and corrupt-storage recovery, API hydration through the shared
 * /api/dashboard/views route (with dashboard-shaped rows filtered out),
 * localStorage→API migration, API sync on mutation, and write-failure
 * signaling.
 *
 * Run: npx vitest run src/hooks/use-workstation-views.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';

import { useWorkstationViews, WORKSTATION_SYSTEM_VIEW_IDS } from './use-workstation-views';
import {
  WORKSTATION_TEMPLATE_IDS,
  WORKSTATION_TEMPLATES,
  WORKSTATION_LAYOUT_VERSION,
  createViewFromTemplate,
  cloneWorkstationViewConfig,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';
import type { WorkstationView } from './use-workstation-views';

// ── localStorage mock ───────────────────────────────────────────────

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

// ── Fixtures ───────────────────────────────────────────────────────

const NOW = '2026-01-01T00:00:00.000Z';
const KEY = 'workstation:views:v1';

/** A customized risk-positions config that keeps the optional Watchlist hidden. */
function customizedRiskPositionsConfig(): WorkstationViewConfig {
  return {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [
      ['risk', 'risk'],
      ['positions', 'account'],
      ['positions', 'perf'],
      ['positions', 'review'],
      ['.', '.'],
      ['kpis', 'kpis'],
    ],
    hiddenPanels: ['watchlist'],
    version: WORKSTATION_LAYOUT_VERSION,
  };
}

/** A config that references a panel id outside the approved catalogue. */
function configWithUnknownPanel(): WorkstationViewConfig {
  return {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [
      ['risk', 'risk'],
      ['positions', 'account'],
      ['hacker', 'perf'],
      ['kpis', 'kpis'],
    ],
    hiddenPanels: ['review', 'watchlist'],
    version: WORKSTATION_LAYOUT_VERSION,
  };
}

/** A config where the positions panel occupies a split (non-rectangular) region. */
function configWithSplitRegion(): WorkstationViewConfig {
  return {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [
      ['risk', 'risk'],
      ['positions', 'account'],
      ['perf', 'positions'],
      ['kpis', 'kpis'],
    ],
    hiddenPanels: ['review', 'watchlist'],
    version: WORKSTATION_LAYOUT_VERSION,
  };
}

function userView(overrides: Partial<WorkstationView>): WorkstationView {
  return {
    id: 'ws-user-test',
    name: 'User View',
    config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS),
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: false,
    isStartup: false,
    ...overrides,
  };
}

function storedPayload(views: WorkstationView[], activeViewId: string) {
  return JSON.stringify({ version: 1, views, activeViewId });
}

// ── Setup / Teardown ───────────────────────────────────────────────

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function flush() {
  act(() => {});
}

/** URL/method-routed fetch mock for the shared /api/dashboard/views route. */
function mockApiRoutes(options: {
  get?: () => unknown[];
  track?: (method: string, url: string, body?: unknown) => void;
}) {
  globalThis.fetch = vi.fn().mockImplementation((url: unknown, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    const method = init?.method ?? 'GET';
    options.track?.(method, urlStr);
    if (method === 'GET') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.get?.() ?? []),
      });
    }
    if (method === 'DELETE') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    }
    // POST — upsert
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'dummy',
          name: 'dummy',
          layout: [],
          hiddenWidgetIds: [],
          createdAt: NOW,
          updatedAt: NOW,
          isSystem: false,
          isDefault: false,
        }),
    });
  });
}

function mockFetchToFail() {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
}

function restoreFetch() {
  globalThis.fetch = undefined as unknown as typeof globalThis.fetch;
  delete (globalThis as { fetch?: typeof fetch }).fetch;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useWorkstationViews', () => {
  it('initializes with the three system presets and the Risk & Positions startup', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    expect(result.current.views).toHaveLength(3);
    expect(result.current.views.every((v) => v.isSystem)).toBe(true);
    expect(result.current.activeViewId).toBe(WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
    expect(result.current.startupViewId).toBe(WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
    expect(result.current.activeView?.name).toBe('Risk & Positions');
    expect(result.current.activeView?.isStartup).toBe(true);
    expect(result.current.isLoaded).toBe(true);
  });

  it('system presets mirror their templates exactly', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    const perf = result.current.views.find(
      (v) => v.id === WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE,
    )!;
    expect(perf.config.areas).toEqual(
      WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PERFORMANCE].areas,
    );
    expect(perf.config.hiddenPanels).toEqual(['watchlist', 'review']);
    expect(perf.config.templateId).toBe(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
  });

  it('active view resolves from a custom default startup flag', () => {
    const custom = [
      userView({ id: 'ws-a', name: 'A', isStartup: true }),
      userView({ id: 'ws-b', name: 'B' }),
    ];
    const { result } = renderHook(() => useWorkstationViews({ defaultViews: custom }));
    flush();
    expect(result.current.views).toHaveLength(2);
    expect(result.current.activeViewId).toBe('ws-a');
    expect(result.current.startupViewId).toBe('ws-a');
  });

  it('falls back to the Risk & Positions preset when no view is flagged as startup', () => {
    const custom = [
      userView({ id: 'ws-a', name: 'A' }),
      userView({ id: 'ws-b', name: 'B' }),
      userView({ id: WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS, name: 'Risk & Positions', isSystem: true }),
    ];
    const { result } = renderHook(() => useWorkstationViews({ defaultViews: custom }));
    flush();
    expect(result.current.activeViewId).toBe(WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
  });

  it('setActiveView switches to an existing view', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.setActiveView(WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE));
    expect(result.current.activeViewId).toBe(WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE);
  });

  it('setActiveView is a no-op for an unknown id', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.setActiveView('ws-nope'));
    expect(result.current.activeViewId).toBe(WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
  });

  it('createView adds a user view from the active template and switches to it', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('  My View  '));
    expect(result.current.views).toHaveLength(4);
    const v = result.current.views.find((x) => x.name === 'My View')!;
    expect(v.isSystem).toBe(false);
    expect(v.isStartup).toBe(false);
    expect(v.id.startsWith('ws-')).toBe(true);
    expect(result.current.activeViewId).toBe(v.id);
    // Default template is the active view's template (Risk & Positions).
    expect(v.config.templateId).toBe(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(v.config.areas).toEqual(
      WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS].areas,
    );
  });

  it('createView with an explicit templateId uses that template', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() =>
      result.current.createView('Perf Copy', WORKSTATION_TEMPLATE_IDS.PERFORMANCE),
    );
    const v = result.current.views.find((x) => x.name === 'Perf Copy')!;
    expect(v.config.templateId).toBe(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(v.config.hiddenPanels).toEqual(['watchlist', 'review']);
  });

  it('createView with an empty name falls back to Untitled View', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('   '));
    const v = result.current.views[3];
    expect(v.name).toBe('Untitled View');
  });

  it('renameView renames a user view', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('Old'));
    const v = result.current.views.find((x) => x.name === 'Old')!;
    act(() => result.current.renameView(v.id, 'New'));
    expect(result.current.views.find((x) => x.id === v.id)?.name).toBe('New');
  });

  it('renameView is a no-op for system presets', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() =>
      result.current.renameView(WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS, 'Hacked'),
    );
    expect(
      result.current.views.find((v) => v.id === WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS)
        ?.name,
    ).toBe('Risk & Positions');
  });

  it('renameView is a no-op for an empty name', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('Old'));
    const v = result.current.views.find((x) => x.name === 'Old')!;
    act(() => result.current.renameView(v.id, '   '));
    expect(result.current.views.find((x) => x.id === v.id)?.name).toBe('Old');
  });

  it('duplicateView copies the source config into a new user view and switches', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('Base'));
    const source = result.current.views.find((x) => x.name === 'Base')!;
    // Customize the source so the copy carries the custom config.
    act(() =>
      result.current.updateViewConfig(source.id, customizedRiskPositionsConfig()),
    );
    const customized = result.current.views.find((x) => x.id === source.id)!;

    let dup: WorkstationView | null = null;
    act(() => {
      dup = result.current.duplicateView(source.id);
    });
    expect(dup).not.toBeNull();
    expect(result.current.views).toHaveLength(5);
    const copy = result.current.views.find((x) => x.name === 'Base (Copy)')!;
    expect(copy.id).not.toBe(source.id);
    expect(copy.isSystem).toBe(false);
    expect(copy.isStartup).toBe(false);
    expect(copy.config).toEqual(customized.config);
    expect(copy.config).not.toBe(customized.config); // deep copy, not aliased
    expect(result.current.activeViewId).toBe(copy.id);
  });

  it('duplicateView with a custom name and null for an unknown id', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.duplicateView(WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE, 'P2'));
    const copy = result.current.views.find((x) => x.name === 'P2')!;
    expect(copy.config.templateId).toBe(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(copy.isSystem).toBe(false);

    expect(result.current.duplicateView('ws-unknown')).toBeNull();
  });

  it('deleteView removes a user view', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('X'));
    const v = result.current.views.find((x) => x.name === 'X')!;
    act(() => result.current.deleteView(v.id));
    expect(result.current.views).toHaveLength(3);
    expect(result.current.views.find((x) => x.id === v.id)).toBeUndefined();
  });

  it('deleteView is blocked on system presets', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.deleteView(WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE));
    expect(result.current.views).toHaveLength(3);
  });

  it('deleteView cannot remove the last remaining view', () => {
    const single = [userView({ id: 'ws-only', name: 'Only' })];
    const { result } = renderHook(() => useWorkstationViews({ defaultViews: single }));
    flush();
    act(() => result.current.deleteView('ws-only'));
    expect(result.current.views).toHaveLength(1);
    expect(result.current.activeViewId).toBe('ws-only');
  });

  it('deleting the active user view falls back to the Risk & Positions preset', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('A'));
    const a = result.current.views.find((x) => x.name === 'A')!;
    act(() => result.current.setActiveView(a.id));
    act(() => result.current.deleteView(a.id));
    expect(result.current.activeViewId).toBe(WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
  });

  it('setStartupView selects one view and clears the others', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('My Startup'));
    const v = result.current.views.find((x) => x.name === 'My Startup')!;
    act(() => result.current.setStartupView(v.id));
    expect(result.current.startupViewId).toBe(v.id);
    expect(result.current.views.find((x) => x.isStartup)?.id).toBe(v.id);
    expect(
      result.current.views.find((x) => x.id === WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS)
        ?.isStartup,
    ).toBe(false);
  });

  it('setStartupView is a no-op for an unknown id', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.setStartupView('ws-nope'));
    expect(result.current.startupViewId).toBe(WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
  });

  it('updateViewConfig applies a valid config and stamps updatedAt', () => {
    // Deterministic clock: create and update must land on different timestamps
    // so the updatedAt stamp is observable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const { result } = renderHook(() => useWorkstationViews());
      flush();
      act(() => result.current.createView('Cfg'));
      const v = result.current.views.find((x) => x.name === 'Cfg')!;
      expect(v.updatedAt).toBe('2026-01-01T00:00:00.000Z');

      vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
      let applied = false;
      act(() => {
        applied = result.current.updateViewConfig(v.id, customizedRiskPositionsConfig());
      });
      expect(applied).toBe(true);
      const updated = result.current.views.find((x) => x.id === v.id)!;
      expect(updated.config).toEqual(customizedRiskPositionsConfig());
      expect(updated.config.hiddenPanels).toEqual(['watchlist']);
      expect(updated.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('updateViewConfig rejects a config with an unknown panel id', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('Cfg'));
    const v = result.current.views.find((x) => x.name === 'Cfg')!;
    const before = result.current.views.find((x) => x.id === v.id)!;

    let applied = true;
    act(() => {
      applied = result.current.updateViewConfig(v.id, configWithUnknownPanel());
    });
    expect(applied).toBe(false);
    expect(result.current.views.find((x) => x.id === v.id)?.config).toEqual(before.config);
  });

  it('updateViewConfig rejects a split (non-rectangular) region', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('Cfg'));
    const v = result.current.views.find((x) => x.name === 'Cfg')!;

    let applied = true;
    act(() => {
      applied = result.current.updateViewConfig(v.id, configWithSplitRegion());
    });
    expect(applied).toBe(false);
    expect(
      result.current.views.find((x) => x.id === v.id)?.config.hiddenPanels,
    ).toEqual(['watchlist']);
  });

  it('updateViewConfig is blocked on system presets and unknown ids', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    let applied = true;
    act(() => {
      applied = result.current.updateViewConfig(
        WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS,
        customizedRiskPositionsConfig(),
      );
    });
    expect(applied).toBe(false);
    expect(
      result.current.views.find(
        (v) => v.id === WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS,
      )?.config.hiddenPanels,
    ).toEqual(['watchlist']);

    expect(result.current.updateViewConfig('ws-unknown', customizedRiskPositionsConfig())).toBe(
      false,
    );
  });

  it('resetView restores a user view to its template base', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('Cfg'));
    const v = result.current.views.find((x) => x.name === 'Cfg')!;
    act(() =>
      result.current.updateViewConfig(v.id, customizedRiskPositionsConfig()),
    );
    act(() => result.current.resetView(v.id));
    const reset = result.current.views.find((x) => x.id === v.id)!;
    expect(reset.config.hiddenPanels).toEqual(['watchlist']);
    expect(reset.config.areas).toEqual(
      WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS].areas,
    );
    expect(reset.config.templateId).toBe(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
  });

  it('resetView is a no-op on system presets', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.resetView(WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE));
    expect(
      result.current.views.find((v) => v.id === WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE)
        ?.config.hiddenPanels,
    ).toEqual(['watchlist', 'review']);
  });

  it('persists to localStorage on create', () => {
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    act(() => result.current.createView('P'));
    const raw = store.get(KEY);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(1);
    expect(parsed.views).toHaveLength(4);
    expect(parsed.activeViewId).toBe(result.current.activeViewId);
  });

  it('reads saved data on mount', () => {
    const savedView = userView({ id: 'ws-saved', name: 'Saved', isStartup: true });
    store.set(KEY, storedPayload([savedView], 'ws-saved'));
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('Saved');
    expect(result.current.activeViewId).toBe('ws-saved');
  });

  it('recovers from invalid JSON', () => {
    store.set(KEY, 'not json {');
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    expect(result.current.views).toHaveLength(3);
  });

  it('recovers when activeViewId does not reference an existing view', () => {
    store.set(KEY, storedPayload([userView({ id: 'ws-a' })], 'ws-gone'));
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    expect(result.current.views).toHaveLength(3);
  });

  it('recovers when a stored view config fails catalogue validation', () => {
    const bad = userView({ id: 'ws-bad', config: configWithUnknownPanel() });
    store.set(KEY, storedPayload([bad], 'ws-bad'));
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    expect(result.current.views).toHaveLength(3);
  });

  it('recovers when a stored view is missing required fields', () => {
    store.set(
      KEY,
      JSON.stringify({ version: 1, views: [{ id: 'ws-x', name: 'X' }], activeViewId: 'ws-x' }),
    );
    const { result } = renderHook(() => useWorkstationViews());
    flush();
    expect(result.current.views).toHaveLength(3);
  });

  it('marks writeFailed when localStorage writes fail, then clears on success', () => {
    // Fail the first write, succeed afterwards.
    let fail = true;
    lsMock.setItem = vi.fn((k: string, v: string) => {
      if (fail) throw new Error('QuotaExceededError');
      store.set(k, v);
    });
    try {
      const { result } = renderHook(() => useWorkstationViews());
      flush();
      expect(result.current.writeFailed).toBe(true);

      fail = false;
      act(() => result.current.createView('Recovered'));
      expect(result.current.writeFailed).toBe(false);
    } finally {
      lsMock.setItem = vi.fn((k: string, v: string) => {
        store.set(k, v);
      });
    }
  });

  // ── API hydration, migration, and sync ─────────────────────────────

  describe('API hydration, migration, and sync', () => {
    afterEach(() => {
      restoreFetch();
    });

    it('hydrates workstation-shaped rows from the API and filters dashboard rows', async () => {
      const apiView = {
        id: 'ws-api-1',
        name: 'API View',
        layout: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE),
        hiddenWidgetIds: [],
        createdAt: NOW,
        updatedAt: NOW,
        isSystem: false,
        isDefault: true,
      };
      // A dashboard row in the shared table (layout is a grid-item array).
      const dashboardRow = {
        id: 'system-default',
        name: 'Dashboard Default',
        layout: [{ i: 'a', x: 0, y: 0, w: 12, h: 3 }],
        hiddenWidgetIds: [],
        createdAt: NOW,
        updatedAt: NOW,
        isSystem: true,
        isDefault: true,
      };
      mockApiRoutes({ get: () => [apiView, dashboardRow] });

      const { result } = renderHook(() => useWorkstationViews());
      await waitFor(() => {
        expect(result.current.views).toHaveLength(1);
      });
      expect(result.current.views[0].name).toBe('API View');
      expect(result.current.views[0].config.templateId).toBe(
        WORKSTATION_TEMPLATE_IDS.PERFORMANCE,
      );
      expect(result.current.activeViewId).toBe('ws-api-1');
      expect(result.current.startupViewId).toBe('ws-api-1');
    });

    it('API data overrides localStorage data when both exist', async () => {
      store.set(KEY, storedPayload([userView({ id: 'ws-ls', name: 'Stale LS' })], 'ws-ls'));
      const apiView = {
        id: 'ws-fresh',
        name: 'Fresh API',
        layout: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS),
        hiddenWidgetIds: [],
        createdAt: NOW,
        updatedAt: NOW,
        isSystem: false,
        isDefault: true,
      };
      mockApiRoutes({ get: () => [apiView] });

      const { result } = renderHook(() => useWorkstationViews());
      await waitFor(() => {
        expect(result.current.views).toEqual([
          expect.objectContaining({ id: 'ws-fresh', name: 'Fresh API' }),
        ]);
      });
    });

    it('falls back to localStorage data when the API fetch fails', async () => {
      store.set(KEY, storedPayload([userView({ id: 'ws-safe', name: 'Safe LS' })], 'ws-safe'));
      mockFetchToFail();

      const { result } = renderHook(() => useWorkstationViews());
      flush();
      expect(result.current.views).toHaveLength(1);
      expect(result.current.views[0].name).toBe('Safe LS');
      expect(result.current.isLoaded).toBe(true);
    });

    it('migrates localStorage views to the API when the API returns no workstation views', async () => {
      store.set(
        KEY,
        storedPayload([userView({ id: 'ws-mig', name: 'Migrate Me', isStartup: true })], 'ws-mig'),
      );
      const posts: Array<{ id: string; layout: string }> = [];
      mockApiRoutes({
        get: () => [], // API empty → triggers migration
        track: (method) => {
          if (method === 'POST') {
            // Capture the serialized payload from the last POST call.
            const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
            const last = calls[calls.length - 1];
            const body = last?.[1] ? JSON.parse(String((last[1] as RequestInit).body)) : null;
            if (body) posts.push(body);
          }
        },
      });

      const { result } = renderHook(() => useWorkstationViews());
      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });
      // Data comes from the synchronous localStorage path.
      expect(result.current.views[0].name).toBe('Migrate Me');

      // Migration POSTs the localStorage views to the shared route.
      await waitFor(() => {
        expect(posts.some((p) => p.id === 'ws-mig')).toBe(true);
      });
      const mig = posts.find((p) => p.id === 'ws-mig')!;
      // The workstation config travels JSON-encoded in the layout field.
      expect(JSON.parse(mig.layout)).toEqual(
        createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS),
      );
    });

    it('syncs mutations to the API via POST upserts', async () => {
      const posts: Array<{ id: string; name: string; layout: string; isSystem: boolean }> = [];
      mockApiRoutes({
        get: () => [],
        track: (method) => {
          if (method === 'POST') {
            const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
            const last = calls[calls.length - 1];
            const payload = JSON.parse(String((last[1] as RequestInit).body));
            posts.push(payload);
          }
        },
      });

      const { result } = renderHook(() => useWorkstationViews());
      flush();
      act(() => result.current.createView('Synced'));
      await waitFor(() => {
        expect(posts.some((p) => p.name === 'Synced' && p.isSystem === false)).toBe(true);
      });
      const created = posts.find((p) => p.name === 'Synced')!;
      expect(created.id.startsWith('ws-')).toBe(true);
      expect(JSON.parse(created.layout).templateId).toBe(
        WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
      );
    });

    it('deletes removed views from the API', async () => {
      const deletes: string[] = [];
      mockApiRoutes({
        get: () => [],
        track: (method, url) => {
          if (method === 'DELETE') deletes.push(url);
        },
      });

      const { result } = renderHook(() => useWorkstationViews());
      flush();
      act(() => result.current.createView('ToDelete'));
      const v = result.current.views.find((x) => x.name === 'ToDelete')!;
      act(() => result.current.deleteView(v.id));

      await waitFor(() => {
        expect(
          deletes.some((u) => u.includes(encodeURIComponent(v.id))),
        ).toBe(true);
      });
    });

    it('keeps the Risk & Positions preset as startup when API data has no startup flag', async () => {
      const apiViews = [
        {
          id: WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE,
          name: 'Performance',
          layout: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE),
          hiddenWidgetIds: [],
          createdAt: NOW,
          updatedAt: NOW,
          isSystem: true,
          isDefault: false,
        },
        {
          id: WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS,
          name: 'Risk & Positions',
          layout: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS),
          hiddenWidgetIds: [],
          createdAt: NOW,
          updatedAt: NOW,
          isSystem: true,
          isDefault: false,
        },
      ];
      mockApiRoutes({ get: () => apiViews });

      const { result } = renderHook(() => useWorkstationViews());
      await waitFor(() => {
        expect(result.current.views).toHaveLength(2);
      });
      expect(result.current.startupViewId).toBe(WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS);
    });

    it('cloneWorkstationViewConfig keeps duplicated configs independent', () => {
      const src = customizedRiskPositionsConfig();
      const copy = cloneWorkstationViewConfig(src);
      expect(copy).toEqual(src);
      expect(copy).not.toBe(src);
      copy.hiddenPanels.push('review');
      expect(src.hiddenPanels).toEqual(['watchlist']);
    });
  });
});
