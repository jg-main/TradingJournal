/**
 * use-visibility-polling.test.ts
 *
 * Unit tests for the useVisibilityPolling hook.
 *
 * Covers: interval lifecycle, enabled gating, visibility pause/resume,
 * callback freshness, cleanup on unmount, and the race-condition guard
 * that prevents double-firing on hidden→visible transitions.
 *
 * Pattern: renderHook + vi.useFakeTimers() + document stubs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisibilityPolling } from './use-visibility-polling';

/* ── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Set document.visibilityState and dispatch a visibilitychange event.
 * Uses Object.defineProperty because jsdom's document.visibilityState is
 * configurable in recent versions, but dispatching the event is the
 * authoritative way to exercise the hook's listener.
 */
function setVisibility(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    value: visible ? 'visible' : 'hidden',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/* ── Setup / Teardown ─────────────────────────────────────────────────── */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  setVisibility(true); // start visible
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility(true); // reset for next test
});

/* ── Tests ────────────────────────────────────────────────────────────── */

describe('useVisibilityPolling', () => {
  it('calls the callback on the configured interval when enabled', () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityPolling(callback, 1000, true));

    // Not called immediately — first call is after intervalMs.
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('uses the default 15s interval when no intervalMs is provided', () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityPolling(callback));

    act(() => {
      vi.advanceTimersByTime(14999);
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not call the callback when enabled is false', () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityPolling(callback, 1000, false));

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('stops polling when enabled changes from true to false mid-lifecycle', () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useVisibilityPolling(callback, 1000, enabled),
      { initialProps: { enabled: true } },
    );

    // Let one tick happen
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);

    // Disable — no more ticks
    rerender({ enabled: false });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('pauses polling when the tab becomes hidden', () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityPolling(callback, 1000, true));

    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);

    // Hide the tab
    act(() => {
      setVisibility(false);
    });

    // No calls while hidden
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('resumes polling with an immediate callback when tab becomes visible', () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityPolling(callback, 10000, true));

    // Let one interval pass
    act(() => { vi.advanceTimersByTime(10000); });
    expect(callback).toHaveBeenCalledTimes(1);

    // Hide the tab
    act(() => { setVisibility(false); });

    // Advance time without visible calls
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).toHaveBeenCalledTimes(1);

    // Show tab — should immediately call callback AND restart the interval
    act(() => { setVisibility(true); });
    expect(callback).toHaveBeenCalledTimes(2); // immediate refresh

    // After the new interval window, should fire again
    act(() => { vi.advanceTimersByTime(10000); });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('cleans up interval and removes listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const callback = vi.fn();
    const { unmount } = renderHook(() => useVisibilityPolling(callback, 1000, true));

    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();

    // After unmount, no more calls
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).toHaveBeenCalledTimes(1);

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    removeEventListenerSpy.mockRestore();
  });

  it('uses the latest callback reference (avoids stale closures)', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const { rerender } = renderHook(
      ({ cb }) => useVisibilityPolling(cb, 1000, true),
      { initialProps: { cb: callback1 } },
    );

    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback1).toHaveBeenCalledTimes(1);

    // Swap callback
    rerender({ cb: callback2 });

    act(() => { vi.advanceTimersByTime(1000); });
    // callback1 should still have 1 call, callback2 should have 1
    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
  });

  it('restarts with the new interval when intervalMs changes', () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ interval }) => useVisibilityPolling(callback, interval, true),
      { initialProps: { interval: 1000 } },
    );

    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);

    // Change interval to 5000
    rerender({ interval: 5000 });

    // Old interval would fire at t=2000 (which is now past), but the hook
    // should have cleared the old interval and started a new one.
    act(() => { vi.advanceTimersByTime(5000); }); // rerender at t=1000, new 5000ms interval fires at t=6000
    expect(callback).toHaveBeenCalledTimes(2); // initial 1000ms tick + new 5000ms tick
  });

  it('does not fire the callback on an interval tick when tab is hidden (race guard)', () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityPolling(callback, 1000, true));

    act(() => { vi.advanceTimersByTime(500); });

    // Hide the tab AFTER the interval was set but BEFORE it fires
    act(() => { setVisibility(false); });

    // The interval timer fires (setInterval callback runs) but
    // document.visibilityState === 'hidden', so the guard skips the callback
    act(() => { vi.advanceTimersByTime(500); }); // interval fires here at t=1000

    expect(callback).not.toHaveBeenCalled();
  });

  it('adds a visibilitychange event listener on mount', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const callback = vi.fn();

    renderHook(() => useVisibilityPolling(callback, 1000, true));

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    addEventListenerSpy.mockRestore();
  });

  it('does not add listeners or start interval when disabled', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const callback = vi.fn();

    renderHook(() => useVisibilityPolling(callback, 1000, false));

    expect(addEventListenerSpy).not.toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );

    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).not.toHaveBeenCalled();

    addEventListenerSpy.mockRestore();
  });

  it('supports async callbacks without error', async () => {
    const asyncCallback = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useVisibilityPolling(asyncCallback, 1000, true));

    act(() => { vi.advanceTimersByTime(1000); });

    // The callback was called (it returns a promise but hook doesn't await it)
    expect(asyncCallback).toHaveBeenCalledTimes(1);
  });
});
