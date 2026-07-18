'use client';

import { useEffect, useRef } from 'react';
import type { ECharts } from 'echarts';

// ── Custom Event Name ───────────────────────────────────────────────────

/**
 * Custom DOM event dispatched by the dashboard's onResizeStop handler
 * to signal chart containers that a final sync resize should fire
 * immediately, bypassing any pending throttle delay.
 */
export const CHART_RESIZE_FINAL_EVENT = 'chart:resize-final';

// ── Types ──────────────────────────────────────────────────────────────

export interface UseChartResizeOptions {
  /**
   * Throttle interval in milliseconds.
   * Prevents excessive resize calls during frequent layout changes
   * (e.g. RGL drag). Default: 100.
   */
  throttleMs?: number;
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * ResizeObserver-based chart auto-resize hook.
 *
 * Observes a container element and calls `echartsInstance.resize()` when
 * the container's dimensions change, throttled to avoid excessive calls
 * during active drag/resize.
 *
 * Also listens for a custom `chart:resize-final` DOM event dispatched by
 * the DashboardLayout's `onResizeStop` callback. When received, it calls
 * `instance.resize()` immediately (bypassing the throttle) to correct
 * any debounce delay after the user releases an RGL resize handle.
 *
 * The ECharts instance is read from the mutable ref at resize time, so
 * the hook works correctly even when the instance is set after the
 * ResizeObserver effect has already started (via `onChartReady`).
 *
 * ResizeObserver errors are caught and logged to `console.warn` so
 * they do not crash the page.
 *
 * @param containerRef - React ref to the container element to observe
 * @param echartsInstanceRef - Mutable ref holding the ECharts instance
 * @param options - Optional configuration
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const chartRef = useRef<ECharts | null>(null);
 * useChartResize(containerRef, chartRef);
 *
 * return (
 *   <div ref={containerRef} className="h-full">
 *     <ReactECharts
 *       onChartReady={(instance) => { chartRef.current = instance; }}
 *     />
 *   </div>
 * );
 * ```
 */
export function useChartResize(
  containerRef: React.RefObject<HTMLElement | null>,
  echartsInstanceRef: React.MutableRefObject<ECharts | null>,
  options: UseChartResizeOptions = {},
): void {
  const { throttleMs = 100 } = options;
  const throttleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // ── Resize handler ──────────────────────────────────────────
    const handleResize = () => {
      const instance = echartsInstanceRef.current;
      if (!instance) return;
      try {
        instance.resize();
      } catch (err) {
        console.warn('[useChartResize] echarts.resize() failed:', err);
      }
    };

    // ── Immediate resize for onResizeStop sync ──────────────────
    const handleFinalResize = () => {
      // Cancel any pending throttled resize — the final one is immediate
      if (throttleTimeoutRef.current !== null) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      handleResize();
    };

    // ── Throttled wrapper ───────────────────────────────────────
    const throttledHandler = () => {
      if (throttleTimeoutRef.current !== null) return;
      throttleTimeoutRef.current = setTimeout(() => {
        throttleTimeoutRef.current = null;
        handleResize();
      }, throttleMs);
    };

    // ── ResizeObserver setup ────────────────────────────────────
    let observer: ResizeObserver;
    try {
      observer = new ResizeObserver(() => {
        throttledHandler();
      });
      observer.observe(el);
    } catch (err) {
      console.warn('[useChartResize] ResizeObserver error:', err);
      return;
    }

    // ── Custom event listener for onResizeStop sync ─────────────
    // The DashboardLayout dispatches `chart:resize-final` when the user
    // releases an RGL resize handle. We listen on document and resize
    // immediately, bypassing the throttle, to correct any debounce delay.
    document.addEventListener(CHART_RESIZE_FINAL_EVENT, handleFinalResize);

    return () => {
      observer.disconnect();
      document.removeEventListener(CHART_RESIZE_FINAL_EVENT, handleFinalResize);
      if (throttleTimeoutRef.current !== null) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
    };
  }, [containerRef, echartsInstanceRef, throttleMs]);
}
