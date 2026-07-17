'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Layout, LayoutItem } from 'react-grid-layout';

// ── Constants ──────────────────────────────────────────────────────────

/**
 * localStorage key for persisting dashboard widget layouts.
 * Versioned with v1 to allow future schema evolution (migration logic
 * can key on the suffix).
 */
const STORAGE_KEY = 'dashboard:layout:v1';

// ── Types ──────────────────────────────────────────────────────────────

export interface UseDashboardLayoutOptions {
  /**
   * Default layout used when no saved layout exists in localStorage.
   * Each item must have at minimum: i, x, y, w, h.
   */
  defaultLayout?: Layout;
  /**
   * Optional serialization key override. Defaults to `dashboard:layout:v1`.
   */
  storageKey?: string;
}

export interface UseDashboardLayoutResult {
  /** Current layout (mutable copy of the saved/initial layout) */
  layout: LayoutItem[];
  /** Replace the entire layout (persists to localStorage) */
  setLayout: (layout: LayoutItem[]) => void;
  /** Update a single item in the layout by its id */
  updateItem: (id: string, patch: Partial<LayoutItem>) => void;
  /** Whether the layout has been hydrated from localStorage */
  isLoaded: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

function readLayout(key: string): Layout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Basic validation: each item must have an id, x, y, w, h
    for (const item of parsed) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as LayoutItem).i !== 'string' ||
        typeof (item as LayoutItem).x !== 'number' ||
        typeof (item as LayoutItem).y !== 'number' ||
        typeof (item as LayoutItem).w !== 'number' ||
        typeof (item as LayoutItem).h !== 'number'
      ) {
        return null;
      }
    }
    return parsed as Layout;
  } catch {
    return null;
  }
}

function writeLayout(key: string, layout: LayoutItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // localStorage may be full or disabled — silently ignore
  }
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Persist and restore dashboard widget layouts to/from localStorage.
 *
 * Uses a versioned key (`dashboard:layout:v1`) so future schema changes
 * can be detected and migrated.
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const { layout, setLayout, isLoaded } = useDashboardLayout({
 *     defaultLayout: [
 *       { i: 'net-pnl', x: 0, y: 0, w: 3, h: 2 },
 *       { i: 'total-trades', x: 3, y: 0, w: 3, h: 2 },
 *     ],
 *   });
 *
 *   if (!isLoaded) return null; // or a full-page spinner
 *
 *   return (
 *     <DashboardLayout layout={layout} onLayoutChange={setLayout}>
 *       ...
 *     </DashboardLayout>
 *   );
 * }
 * ```
 */
export function useDashboardLayout(
  options: UseDashboardLayoutOptions = {},
): UseDashboardLayoutResult {
  const { defaultLayout, storageKey } = options;
  const key = storageKey ?? STORAGE_KEY;

  const [layout, setLayoutState] = useState<LayoutItem[]>(() => {
    // Initialise synchronously from localStorage if available
    const saved = readLayout(key);
    if (saved) return [...saved];
    return defaultLayout ? [...defaultLayout] : [];
  });

  const [isLoaded, setIsLoaded] = useState(false);

  // On mount, re-read localStorage (handles SSR hydration)
  useEffect(() => {
    const saved = readLayout(key);
    if (saved) {
      setLayoutState([...saved]);
    } else if (defaultLayout) {
      setLayoutState([...defaultLayout]);
    }
    setIsLoaded(true);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist every layout change
  useEffect(() => {
    if (!isLoaded) return;
    writeLayout(key, layout);
  }, [layout, isLoaded, key]);

  const setLayout = useCallback((newLayout: LayoutItem[]) => {
    setLayoutState(newLayout);
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<LayoutItem>) => {
      setLayoutState((prev) => {
        const idx = prev.findIndex((item) => item.i === id);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...patch };
        return updated;
      });
    },
    [],
  );

  return { layout, setLayout, updateItem, isLoaded };
}
