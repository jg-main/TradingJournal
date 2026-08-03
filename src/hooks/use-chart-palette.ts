'use client';

import { useSyncExternalStore } from 'react';
import {
  deriveChartPalette,
  type ChartPalette,
  type ThemeName,
} from '@/lib/chart-palette';

// ── Theme detection ────────────────────────────────────────────────────

/**
 * Fallback theme used during SSR / before hydration.
 *
 * The chart palette for the server-rendered markup defaults to light; once
 * the client hydrates, the MutationObserver subscription reports the real
 * theme (the `dark` class, when present) and charts re-render in place.
 */
const SSR_THEME: ThemeName = 'light';

/**
 * Read the active theme from the `documentElement` 'dark' class.
 *
 * The theme toggle (src/components/theme-toggle.tsx) toggles the `dark`
 * class on `document.documentElement`; the same class drives the Tailwind
 * `dark` variant in globals.css. Reading the class directly keeps the chart
 * palette in lockstep with the rendered UI.
 */
function getSnapshot(): ThemeName {
  if (typeof document === 'undefined') return SSR_THEME;
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Server snapshot for useSyncExternalStore hydration safety. */
function getServerSnapshot(): ThemeName {
  return SSR_THEME;
}

/**
 * Subscribe to `class` mutations on `<html>`.
 *
 * When the theme toggle swaps the `dark` class, the MutationObserver fires
 * `onStoreChange` and React re-reads the snapshot, re-rendering every chart
 * that consumes the palette. The observer is scoped to the class attribute
 * only, so unrelated DOM mutations do not trigger chart rebuilds.
 */
function subscribe(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

// ── Hooks ──────────────────────────────────────────────────────────────

/**
 * Active theme name ('light' | 'dark') derived from the `documentElement`
 * 'dark' class, kept in sync via useSyncExternalStore + MutationObserver.
 *
 * Falls back to 'light' during SSR. Returns a stable primitive, so React
 * only re-renders when the class actually flips.
 */
export function useChartTheme(): ThemeName {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Resolved ECharts chart palette for the active theme.
 *
 * Theme-reactive: when the theme toggle changes the `dark` class on
 * `documentElement`, every chart widget that consumes this hook rebuilds its
 * ECharts option with the new theme's colors, so charts update in place
 * without a reload.
 *
 * @example
 * ```tsx
 * const palette = useChartPalette();
 * const option = useMemo(() => buildChartOption(data, palette), [data, palette]);
 * ```
 */
export function useChartPalette(): ChartPalette {
  return deriveChartPalette(useChartTheme());
}
