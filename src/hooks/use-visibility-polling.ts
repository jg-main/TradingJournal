import { useEffect, useRef } from 'react';

/**
 * Visibility-aware polling hook.
 *
 * Calls `callback` on a fixed interval when the tab is visible. Pauses
 * polling when the tab is hidden and resumes with an immediate callback
 * invocation when the tab regains focus.
 *
 * The hook has zero knowledge of domain logic — it takes a generic
 * async-or-sync callback and manages the lifecycle of setInterval plus
 * the visibilitychange DOM listener.
 *
 * @param callback - Async or sync function invoked on each poll tick
 * @param intervalMs - Poll interval in milliseconds (default: 15 000)
 * @param enabled   - Whether polling is active (default: true). Set to
 *                    `false` for closed trades, empty watchlists, etc.
 */
export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  intervalMs: number = 15000,
  enabled: boolean = true,
): void {
  const callbackRef = useRef(callback);
  // Keep the callback ref current so the interval closure never captures
  // a stale reference.
  useEffect(() => {
    callbackRef.current = callback;
  });

  const intervalIdRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!enabled) return;

    const start = () => {
      stop();
      intervalIdRef.current = setInterval(() => {
        // Guard: if the tab is hidden when the interval fires (race on
        // visibility change), skip the callback.
        if (document.visibilityState === 'visible') {
          callbackRef.current();
        }
      }, intervalMs);
    };

    const stop = () => {
      if (intervalIdRef.current !== undefined) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = undefined;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Resume: immediate refresh then restart the interval.
        callbackRef.current();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // Intentionally re-run only when enabled or intervalMs changes.
    // The callback ref pattern avoids including callback in the dep array.
     
  }, [enabled, intervalMs]);
}
