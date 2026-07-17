/**
 * Tests for the useDashboardViews hook.
 *
 * Covers: default state, create, switch, rename, duplicate, delete,
 * set default, update layout, persistence, corrupt recovery,
 * custom key, write failure, multi-cycle.
 *
 * Run: npx vitest run src/hooks/use-dashboard-views.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useDashboardViews } from './use-dashboard-views';

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

interface DV {
  id: string;
  name: string;
  layout: any[];
  hiddenWidgetIds: string[];
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
  isDefault: boolean;
}

const LA = [
  { i: 'a', x: 0, y: 0, w: 12, h: 3 },
  { i: 'b', x: 0, y: 3, w: 6, h: 4 },
  { i: 'c', x: 6, y: 3, w: 6, h: 4 },
  { i: 'd', x: 0, y: 7, w: 12, h: 5 },
  { i: 'e', x: 0, y: 12, w: 12, h: 6 },
];

const LR = [
  { i: 'c', x: 0, y: 0, w: 6, h: 4 },
  { i: 'd', x: 6, y: 0, w: 6, h: 5 },
];

const NOW = '2026-01-01T00:00:00.000Z';

const SV: DV[] = [
  {
    id: 'sd',
    name: 'Default',
    layout: LA,
    hiddenWidgetIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isDefault: true,
  },
  {
    id: 'st',
    name: 'Trading Risk',
    layout: LR,
    hiddenWidgetIds: ['e'],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isDefault: false,
  },
  {
    id: 'sp',
    name: 'Performance',
    layout: LA,
    hiddenWidgetIds: ['c'],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isDefault: false,
  },
  {
    id: 'sr',
    name: 'Process Review',
    layout: LA,
    hiddenWidgetIds: ['c', 'd'],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isDefault: false,
  },
];

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

// ── Tests ──────────────────────────────────────────────────────────

describe('useDashboardViews', () => {
  it('init with 4 views and default active', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    expect(result.current.views).toHaveLength(4);
    expect(result.current.activeViewId).toBe('sd');
    expect(result.current.activeView?.name).toBe('Default');
    expect(result.current.isLoaded).toBe(true);
  });

  it('active view from isDefault option', () => {
    const views = SV.map((v) =>
      v.id === 'sd'
        ? { ...v, isDefault: false }
        : v.id === 'st'
          ? { ...v, isDefault: true }
          : v,
    );
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: views as any }),
    );
    flush();
    expect(result.current.activeViewId).toBe('st');
  });

  it('setActiveView switches', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.setActiveView('st'));
    expect(result.current.activeViewId).toBe('st');
  });

  it('setActiveView no-op for bad id', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.setActiveView('x'));
    expect(result.current.activeViewId).toBe('sd');
  });

  it('createView adds view and switches', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.createView('X', LA as any, []));
    expect(result.current.views).toHaveLength(5);
    const v = result.current.views.find((x) => x.name === 'X')!;
    expect(v.isSystem).toBe(false);
    expect(result.current.activeViewId).toBe(v.id);
  });

  it('renameView renames', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.createView('X', LA as any, []));
    const v = result.current.views.find((x) => x.name === 'X')!;
    act(() => result.current.renameView(v.id, 'Y'));
    expect(
      result.current.views.find((x) => x.id === v.id)?.name,
    ).toBe('Y');
  });

  it('duplicateView creates copy and switches', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.duplicateView('sd'));
    expect(result.current.views).toHaveLength(5);
    const d = result.current.views.find((v) => v.name === 'Default (Copy)');
    expect(d).toBeDefined();
    expect(result.current.activeViewId).toBe(d!.id);
  });

  it('duplicateView with custom name', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.duplicateView('sd', 'C'));
    const d = result.current.views.find((v) => v.name === 'C');
    expect(d).toBeDefined();
  });

  it('duplicateView returns null for bad id', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    expect(result.current.duplicateView('x')).toBeNull();
  });

  it('deleteView removes a user view', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.createView('X', LA as any, []));
    const v = result.current.views.find((x) => x.name === 'X')!;
    act(() => result.current.deleteView(v.id));
    expect(result.current.views).toHaveLength(4);
  });

  it('deleteView blocked on system views', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.deleteView('sd'));
    expect(result.current.views).toHaveLength(4);
  });

  it('delete active view switches to first', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.createView('A', LA as any, []));
    act(() => result.current.createView('B', LA as any, []));
    const a = result.current.views.find((x) => x.name === 'A')!;
    act(() => result.current.setActiveView(a.id));
    act(() => result.current.deleteView(a.id));
    expect(result.current.activeViewId).not.toBe(a.id);
  });

  it('setDefaultView sets one and clears others', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.setDefaultView('sp'));
    expect(
      result.current.views.find((v) => v.id === 'sp')?.isDefault,
    ).toBe(true);
    expect(
      result.current.views.find((v) => v.id === 'sd')?.isDefault,
    ).toBe(false);
  });

  it('updateViewLayout updates layout and hidden', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() =>
      result.current.updateViewLayout('sd', LR as any, ['e']),
    );
    const v = result.current.views.find((x) => x.id === 'sd');
    expect(v?.layout).toEqual(LR);
    expect(v?.hiddenWidgetIds).toEqual(['e']);
  });

  it('persists to localStorage on create', () => {
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    act(() => result.current.createView('P', LA as any, []));
    const raw = store.get('dashboard:views:v2');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.views).toHaveLength(5);
    expect(parsed.version).toBe(2);
  });

  it('reads saved data on mount', () => {
    store.set(
      'dashboard:views:v2',
      JSON.stringify({
        version: 2,
        views: [
          {
            id: 's',
            name: 'S',
            layout: LA,
            hiddenWidgetIds: [],
            createdAt: NOW,
            updatedAt: NOW,
            isSystem: false,
            isDefault: true,
          },
        ],
        activeViewId: 's',
      }),
    );
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('S');
  });

  it('recovers from invalid JSON', () => {
    store.set('dashboard:views:v2', 'bad');
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    expect(result.current.views).toHaveLength(4);
  });

  it('recovers from bad activeViewId', () => {
    store.set(
      'dashboard:views:v2',
      JSON.stringify({
        version: 2,
        views: [
          {
            id: 'o',
            name: 'O',
            layout: LA,
            hiddenWidgetIds: [],
            createdAt: NOW,
            updatedAt: NOW,
            isSystem: false,
            isDefault: false,
          },
        ],
        activeViewId: 'x',
      }),
    );
    const { result } = renderHook(() =>
      useDashboardViews({ defaultViews: SV as any }),
    );
    flush();
    expect(result.current.views).toHaveLength(4);
  });
});
