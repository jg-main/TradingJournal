'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Derived from web-notifications.md in the UI automation skill set.
 * Wraps the Web Notification API in a React hook that:
 *  - Tracks permission state reactively
 *  - Requests permission exclusively from user-gesture callers
 *  - Fires browser notifications with a permalink onclick handler
 *  - Degrades gracefully when the Notification API is unavailable
 */

// ── Types ─────────────────────────────────────────────────────────────────

type PermissionState = 'default' | 'granted' | 'denied';

export interface FireNotificationParams {
  /** Uppercase symbol, e.g. "AAPL" */
  symbol: string;
  /** Human-readable body text */
  message: string;
  /** URL to open when the notification is clicked (default: /watchlist) */
  url?: string;
}

export interface UseNotificationResult {
  /** Current permission state from Notification.permission */
  permission: PermissionState;
  /** True if Notification API is available in this browser */
  isSupported: boolean;
  /**
   * Request notification permission.
   * MUST be called from a user-gesture event handler (click, keypress).
   * Returns the resolved permission state.
   */
  requestPermission: () => Promise<PermissionState>;
  /**
   * Fire a browser notification.
   * Safe to call from setInterval callbacks after permission is granted.
   * Returns the Notification instance, or null if suppressed/unavailable.
   */
  fireNotification: (params: FireNotificationParams) => Notification | null;
  /**
   * True when permission was denied (useful for UI indicators).
   * Derived from the permission state, not a separate variable.
   */
  denied: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────

/**
 * React hook for browser Web Notifications.
 *
 * ## Usage
 * ```tsx
 * const { permission, requestPermission, fireNotification, isSupported, denied } = useNotification();
 *
 * // Request permission from a user gesture (e.g. button onClick):
 * <button onClick={() => requestPermission()}>Enable Alerts</button>
 *
 * // Fire from any context (interval, callback, etc.):
 * fireNotification({ symbol: 'AAPL', message: 'Price above $200.00' });
 * ```
 *
 * ## Gotcha (MEM581)
 * Chrome suppresses Notification() from setInterval callbacks ONLY when
 * permission has not yet been granted. The mitigation is:
 * 1. Request permission via a user-gesture handler
 * 2. After permission is granted, new Notification() from intervals works
 *
 * ## Graceful degradation
 * - `isSupported === false` → API not available; fireNotification is no-op
 * - `denied === true` → show a subtle UI indicator; notifications won't fire
 * - Any Notification() error is caught silently
 */
export function useNotification(): UseNotificationResult {
  // Detect API availability once
  const isSupported =
    typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState<PermissionState>(() => {
    if (!isSupported) return 'denied';
    return (window.Notification as typeof Notification).permission as PermissionState;
  });

  // Stable ref for the permission state so callbacks don't stale-close
  const permissionRef = useRef<PermissionState>(permission);

  // Sync ref with state whenever permission changes
  useEffect(() => {
    permissionRef.current = permission;
  }, [permission]);

  // Keep react state in sync when permission changes externally (e.g. browser
  // settings change). Subscribe to the `permissionchange` event on the
  // Notification API's permission status object.
  useEffect(() => {
    if (!isSupported) return;

    let status: PermissionStatus | null = null;
    const updatePermission = () => {
      const newState = (window.Notification as typeof Notification).permission as PermissionState;
      permissionRef.current = newState;
      setPermission(newState);
    };

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'notifications' })
        .then((s) => {
          status = s;
          s.addEventListener('change', updatePermission);
        })
        .catch(() => {
          // Permission query not supported — fall back to polling `permission`
        });
    }

    return () => {
      if (status) {
        status.removeEventListener('change', updatePermission);
      }
    };
  }, [isSupported]);

  /**
   * Request notification permission.
   * MUST be called from a user-gesture handler (button click, form submit).
   * Returns the resolved PermissionState.
   */
  const requestPermission = useCallback(async (): Promise<PermissionState> => {
    if (!isSupported) return 'denied';

    try {
      const result = await (window.Notification as typeof Notification).requestPermission();
      permissionRef.current = result as PermissionState;
      setPermission(result as PermissionState);
      return result as PermissionState;
    } catch {
      // requestPermission threw — unlikely, but degrade defensively
      return 'denied';
    }
  }, [isSupported]);

  /**
   * Fire a browser notification.
   *
   * Safe to call from any context (setInterval, promise chain) after permission
   * has been granted. Uses the `tag` property for deduplication — only one
   * notification per (symbol, url) combination shows at a time.
   *
   * @returns The Notification instance, or null if suppressed/unavailable.
   */
  const fireNotification = useCallback(
    (params: FireNotificationParams): Notification | null => {
      if (!isSupported) return null;

      const currentPermission = permissionRef.current;
      if (currentPermission !== 'granted') return null;

      try {
        const title = `\u{1F514} ${params.symbol} Alert`;
        const tag = `alert-${params.symbol}-${params.url ?? 'watchlist'}`;

        const notification = new (window.Notification as typeof Notification)(
          title,
          {
            body: params.message,
            tag,
            icon: '/favicon.svg',
          },
        );

        // Permalink: clicking the notification opens /watchlist
        notification.onclick = () => {
          window.focus();
          window.location.href = params.url ?? '/watchlist';
        };

        return notification;
      } catch {
        // Notification() constructor threw — e.g. secure context issue
        return null;
      }
    },
    [isSupported],
  );

  return {
    permission,
    isSupported,
    requestPermission,
    fireNotification,
    denied: permission === 'denied',
  };
}
