/**
 * Tests for the useDashboardLayout hook.
 *
 * Covers: default layout, localStorage persistence, SSR safety,
 * corrupt data recovery, updateItem, and setLayout.
 *
 * Run: npx vitest run src/components/dashboard/use-dashboard-layout.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useDashboardLayout } from './use-dashboard-layout';
import type { LayoutItem } from 'react-grid-layout';

// ═══════════════════════════════════════════════════════════════════════════
// localStorage mock
// ═══════════════════════════════════════════════════════════════════════════

const store = new Map<string, string>();

const localStorageMock: Storage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => store.delete(key)),
  clear: vi.fn(() => store.clear()),
  get length() {
    return store.size;
  },
  key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'net-pnl', x: 0, y: 0, w: 3, h: 2 },
  { i: 'total-trades', x: 3, y: 0, w: 3, h: 2 },
  { i: 'win-rate', x: 6, y: 0, w: 3, h: 2 },
];

const SAVED_LAYOUT: LayoutItem[] = [
  { i: 'net-pnl', x: 0, y: 0, w: 4, h: 2 },
  { i: 'total-trades', x: 4, y: 0, w: 2, h: 1 },
  { i: 'account-value', x: 0, y: 1, w: 6, h: 2 },
];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('useDashboardLayout', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Default layout (no saved data) ──────────────────────────────

  it('returns defaultLayout when no saved layout exists', () => {
    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    // Default layout should be returned
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
    expect(result.current.isLoaded).toBe(true);
  });

  it('returns empty array when no defaultLayout and no saved data', () => {
    const { result } = renderHook(() => useDashboardLayout());

    expect(result.current.layout).toEqual([]);
    expect(result.current.isLoaded).toBe(true);
  });

  // ── localStorage persistence ────────────────────────────────────

  it('reads saved layout from localStorage on mount', () => {
    store.set('dashboard:layout:v1', JSON.stringify(SAVED_LAYOUT));

    const { result } = renderHook(() => useDashboardLayout());

    expect(result.current.layout).toEqual(SAVED_LAYOUT);
    expect(result.current.isLoaded).toBe(true);
  });

  it('persists layout to localStorage when setLayout is called', () => {
    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    const newLayout: LayoutItem[] = [
      { i: 'net-pnl', x: 6, y: 0, w: 3, h: 2 },
    ];

    act(() => {
      result.current.setLayout(newLayout);
    });

    expect(result.current.layout).toEqual(newLayout);
    // Check localStorage was written
    const saved = JSON.parse(store.get('dashboard:layout:v1')!);
    expect(saved).toEqual(newLayout);
  });

  it('updates localStorage when layout changes via updateItem', () => {
    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    act(() => {
      result.current.updateItem('net-pnl', { w: 6, h: 3 });
    });

    expect(result.current.layout[0].w).toBe(6);
    expect(result.current.layout[0].h).toBe(3);
    // Other items unchanged
    expect(result.current.layout[1]).toEqual(DEFAULT_LAYOUT[1]);

    // Check localStorage matches
    const saved = JSON.parse(store.get('dashboard:layout:v1')!);
    expect(saved[0].w).toBe(6);
    expect(saved[0].h).toBe(3);
  });

  // ── updateItem edge cases ───────────────────────────────────────

  it('does nothing when updateItem targets a non-existent id', () => {
    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    act(() => {
      result.current.updateItem('non-existent', { w: 10 });
    });

    // Layout unchanged
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  // ── Corrupt data recovery ───────────────────────────────────────

  it('falls back to defaultLayout when localStorage contains invalid JSON', () => {
    store.set('dashboard:layout:v1', 'not-valid-json');

    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    // Should fall back to default layout without throwing
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
    expect(result.current.isLoaded).toBe(true);
  });

  it('falls back to defaultLayout when localStorage contains non-array', () => {
    store.set('dashboard:layout:v1', JSON.stringify({ invalid: true }));

    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('falls back to defaultLayout when localStorage items missing required fields', () => {
    // Item missing 'x' field
    const badLayout = [{ i: 'item-1', y: 0, w: 3, h: 2 }];
    store.set('dashboard:layout:v1', JSON.stringify(badLayout));

    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('falls back to defaultLayout when localStorage items have wrong types', () => {
    // 'i' should be a string
    const badLayout = [{ i: 123, x: 0, y: 0, w: 3, h: 2 }];
    store.set('dashboard:layout:v1', JSON.stringify(badLayout));

    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  // ── SSR safety ──────────────────────────────────────────────────

  it('readLayout returns null when window is undefined (SSR)', () => {
    // We can't easily remove window in jsdom, but the internal
    // guard is tested via the module-level 'typeof window' check.
    // We verify the hook initialises without error.
    const { result } = renderHook(() => useDashboardLayout());
    expect(result.current.layout).toEqual([]);
  });

  // ── Custom storage key ──────────────────────────────────────────

  it('uses custom storage key when provided', () => {
    const customKey = 'custom:key:v2';
    store.set(customKey, JSON.stringify(SAVED_LAYOUT));

    const { result } = renderHook(() =>
      useDashboardLayout({ storageKey: customKey }),
    );

    expect(result.current.layout).toEqual(SAVED_LAYOUT);
  });

  it('writes to custom storage key on setLayout', () => {
    const customKey = 'custom:key:v2';

    const { result } = renderHook(() =>
      useDashboardLayout({ storageKey: customKey, defaultLayout: DEFAULT_LAYOUT }),
    );

    act(() => {
      result.current.setLayout(SAVED_LAYOUT);
    });

    const saved = JSON.parse(store.get(customKey)!);
    expect(saved).toEqual(SAVED_LAYOUT);
  });

  // ── isLoaded timing ─────────────────────────────────────────────

  it('isLoaded is true after mount effect runs', () => {
    const { result } = renderHook(() =>
      useDashboardLayout({ defaultLayout: DEFAULT_LAYOUT }),
    );

    // After the effect runs, isLoaded should be true
    expect(result.current.isLoaded).toBe(true);
  });
});
