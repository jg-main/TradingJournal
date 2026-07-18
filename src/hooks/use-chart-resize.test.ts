/**
 * use-chart-resize.test.ts
 *
 * Unit tests for the useChartResize hook.
 *
 * Covers: ResizeObserver setup and teardown, throttle behavior, custom
 * throttleMs, immediate resize on chart:resize-final event, cancellation
 * of pending throttle on final resize, cleanup on unmount, null ref
 * safety, missing echarts instance, and error handling for both
 * ResizeObserver construction and echarts.resize() failures.
 *
 * Run: npx vitest run src/hooks/use-chart-resize.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';

import { useChartResize, CHART_RESIZE_FINAL_EVENT } from './use-chart-resize';
import type { ECharts } from 'echarts';

// ── ResizeObserver Mock ────────────────────────────────────────────────

let resizeObserverCallback: ((entries: ResizeObserverEntry[]) => void) | null =
  null;
/**
 * Reference to the last-created mock instance so tests can assert
 * on instance methods (observe, disconnect). Class fields are
 * per-instance, not on the prototype.
 */
let resizeObserverInstance: ResizeObserverMock | null = null;

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: (entries: ResizeObserverEntry[]) => void) {
    resizeObserverCallback = callback;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    resizeObserverInstance = this;
  }
}

const OriginalResizeObserver = globalThis.ResizeObserver;

/**
 * Simulate a container resize by invoking the ResizeObserver callback
 * that the hook registered. Must be called inside `act()`.
 */
function simulateResize(): void {
  resizeObserverCallback?.([{} as ResizeObserverEntry]);
}

/**
 * Dispatch the custom chart:resize-final event that triggers an immediate
 * (non-throttled) resize. Must be called inside `act()`.
 */
function dispatchFinalResizeEvent(): void {
  document.dispatchEvent(new Event(CHART_RESIZE_FINAL_EVENT));
}

// ── Helpers ────────────────────────────────────────────────────────────

function createMockEChartsInstance(): ECharts {
  return { resize: vi.fn() } as unknown as ECharts;
}

function mountContainer(): HTMLDivElement {
  const el = document.createElement('div');
  return el;
}

// ── Setup / Teardown ───────────────────────────────────────────────────

beforeEach(() => {
  resizeObserverCallback = null;
  resizeObserverInstance = null;
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
  vi.useRealTimers();
  resizeObserverCallback = null;
  resizeObserverInstance = null;
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('useChartResize', () => {
  // ── ResizeObserver setup ────────────────────────────────────────

  it('creates a ResizeObserver and observes the container element', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsRef = { current: createMockEChartsInstance() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    expect(resizeObserverInstance).not.toBeNull();
    expect(resizeObserverInstance!.observe).toHaveBeenCalledWith(
      containerRef.current,
    );
  });

  it('does nothing when containerRef.current is null', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsRef = { current: createMockEChartsInstance() };

    renderHook(() => useChartResize(containerRef, echartsRef));

    // No ResizeObserver should have been created because the effect returns early
    expect(resizeObserverInstance).toBeNull();
  });

  // ── Throttled resize ────────────────────────────────────────────

  it('calls echartsInstance.resize() after the throttle window on resize', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = createMockEChartsInstance();
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    // Simulate a container resize
    simulateResize();

    // resize should not fire immediately
    expect(echartsInstance.resize).not.toHaveBeenCalled();

    // Advance past the default 100ms throttle
    vi.advanceTimersByTime(100);

    expect(echartsInstance.resize).toHaveBeenCalledTimes(1);
  });

  it('throttles multiple resize calls within the throttle window', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = createMockEChartsInstance();
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    // Multiple rapid resize observations
    simulateResize();
    simulateResize();
    simulateResize();
    simulateResize();

    vi.advanceTimersByTime(100);

    // Only one resize call despite 4 observations
    expect(echartsInstance.resize).toHaveBeenCalledTimes(1);
  });

  it('fires resize again after a new throttle window passes', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = createMockEChartsInstance();
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    // First burst
    simulateResize();
    vi.advanceTimersByTime(100);
    expect(echartsInstance.resize).toHaveBeenCalledTimes(1);

    // Second burst — new throttle window
    simulateResize();
    vi.advanceTimersByTime(100);
    expect(echartsInstance.resize).toHaveBeenCalledTimes(2);
  });

  // ── Custom throttleMs ───────────────────────────────────────────

  it('respects a custom throttleMs option', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = createMockEChartsInstance();
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() =>
      useChartResize(containerRef, echartsRef, { throttleMs: 500 }),
    );

    simulateResize();

    // Should NOT fire at 100ms (the default)
    vi.advanceTimersByTime(100);
    expect(echartsInstance.resize).not.toHaveBeenCalled();

    // Should fire at 500ms
    vi.advanceTimersByTime(400);
    expect(echartsInstance.resize).toHaveBeenCalledTimes(1);
  });

  // ── Final resize event ──────────────────────────────────────────

  it('calls resize immediately when chart:resize-final is dispatched', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = createMockEChartsInstance();
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    dispatchFinalResizeEvent();

    // Should fire immediately without waiting for throttle
    expect(echartsInstance.resize).toHaveBeenCalledTimes(1);
  });

  it('cancels pending throttle when chart:resize-final fires', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = createMockEChartsInstance();
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    // Start a throttled resize
    simulateResize();

    // Before throttle fires, dispatch final resize
    dispatchFinalResizeEvent();

    // Immediate resize from final event
    expect(echartsInstance.resize).toHaveBeenCalledTimes(1);

    // Advance past throttle window — no second call (pending was cancelled)
    vi.advanceTimersByTime(100);
    expect(echartsInstance.resize).toHaveBeenCalledTimes(1);
  });

  it('cleans up the chart:resize-final event listener on unmount', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsRef = { current: createMockEChartsInstance() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() =>
      useChartResize(containerRef, echartsRef),
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith(
      CHART_RESIZE_FINAL_EVENT,
      expect.any(Function),
    );
    removeSpy.mockRestore();
  });

  // ── Cleanup ─────────────────────────────────────────────────────

  it('disconnects the ResizeObserver on unmount', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = createMockEChartsInstance();
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    const { unmount } = renderHook(() =>
      useChartResize(containerRef, echartsRef),
    );

    expect(resizeObserverInstance).not.toBeNull();
    const disconnectSpy = resizeObserverInstance!.disconnect;

    unmount();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('clears any pending throttle timeout on unmount', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = createMockEChartsInstance();
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    const { unmount } = renderHook(() =>
      useChartResize(containerRef, echartsRef),
    );

    // Start a throttled resize
    simulateResize();

    // Unmount before throttle fires
    unmount();

    // Advance past throttle window — should not fire because cleanup cleared
    vi.advanceTimersByTime(100);
    expect(echartsInstance.resize).not.toHaveBeenCalled();
  });

  // ── Instance tolerance ──────────────────────────────────────────

  it('does not crash when echartsInstanceRef.current is null on resize', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsRef = { current: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    // Should not throw — the hook guards against null instance
    expect(() => {
      simulateResize();
      vi.advanceTimersByTime(100);
    }).not.toThrow();
  });

  it('uses the latest echarts instance when ref is updated after mount', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const echartsRef = { current: null as ECharts | null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    // Simulate onChartReady setting the instance after mount
    const instance = createMockEChartsInstance();
    echartsRef.current = instance;

    // Trigger a resize
    simulateResize();
    vi.advanceTimersByTime(100);

    expect(instance.resize).toHaveBeenCalledTimes(1);
  });

  // ── Error handling ──────────────────────────────────────────────

  it('logs a warning when ResizeObserver constructor throws', () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    // Make ResizeObserver throw on construction
    globalThis.ResizeObserver = class BrokenRO {
      constructor() {
        throw new Error('ResizeObserver not supported');
      }
    } as unknown as typeof ResizeObserver;

    const containerRef = React.createRef<HTMLDivElement>();
    const echartsRef = { current: createMockEChartsInstance() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[useChartResize] ResizeObserver error:',
      expect.any(Error),
    );

    consoleWarnSpy.mockRestore();
  });

  it('logs a warning when echarts.resize() throws', () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const containerRef = React.createRef<HTMLDivElement>();
    const echartsInstance = {
      resize: vi.fn().mockImplementation(() => {
        throw new Error('Resize failed');
      }),
    } as unknown as ECharts;
    const echartsRef = { current: echartsInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (containerRef as any).current = mountContainer();

    renderHook(() => useChartResize(containerRef, echartsRef));

    simulateResize();
    vi.advanceTimersByTime(100);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[useChartResize] echarts.resize() failed:',
      expect.any(Error),
    );

    consoleWarnSpy.mockRestore();
  });
});
