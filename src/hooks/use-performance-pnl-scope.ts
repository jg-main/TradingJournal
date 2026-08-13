'use client';

/**
 * Persist the Performance panel's P&L scope as a small, versioned browser
 * preference. This is deliberately separate from saved dashboard layouts:
 * it is a reading preference that applies equally to immutable system views
 * and user-created views.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PERFORMANCE_PNL_SCOPE,
  PERFORMANCE_PNL_SCOPES,
  type PerformancePnlScope,
} from '@/lib/performance-pnl-scope';

export const PERFORMANCE_PNL_SCOPE_STORAGE_KEY = 'workstation:performance-pnl-scope:v1';

function isPerformancePnlScope(value: unknown): value is PerformancePnlScope {
  return typeof value === 'string' && PERFORMANCE_PNL_SCOPES.includes(value as PerformancePnlScope);
}

function readScope(): PerformancePnlScope {
  if (typeof window === 'undefined') return DEFAULT_PERFORMANCE_PNL_SCOPE;
  try {
    const stored = localStorage.getItem(PERFORMANCE_PNL_SCOPE_STORAGE_KEY);
    return isPerformancePnlScope(stored) ? stored : DEFAULT_PERFORMANCE_PNL_SCOPE;
  } catch {
    return DEFAULT_PERFORMANCE_PNL_SCOPE;
  }
}

export function usePerformancePnlScope() {
  // Use the default through the server and first client render; hydrate after
  // mount so a saved browser preference can never cause a hydration mismatch.
  const [scope, setScopeState] = useState<PerformancePnlScope>(
    DEFAULT_PERFORMANCE_PNL_SCOPE,
  );
  const changedBeforeHydration = useRef(false);

  useEffect(() => {
    if (!changedBeforeHydration.current) {
      setScopeState(readScope());
    }
  }, []);

  const setScope = useCallback((nextScope: PerformancePnlScope) => {
    if (!isPerformancePnlScope(nextScope)) return;
    changedBeforeHydration.current = true;
    setScopeState(nextScope);

    try {
      localStorage.setItem(PERFORMANCE_PNL_SCOPE_STORAGE_KEY, nextScope);
    } catch {
      // Keep the selected scope for this dashboard session when browser
      // storage is unavailable; a blocked preference must not break P&L.
      console.warn('[workstation] Could not persist Performance P&L scope.');
    }
  }, []);

  return { scope, setScope } as const;
}
