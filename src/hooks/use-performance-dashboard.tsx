'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type {
  PerformanceDashboardFilter,
  DateRange,
  AdvancedFilters,
  PerformanceUnit,
} from '@/lib/performance-view-types';
import { createDefaultFilter } from '@/lib/performance-view-types';
import { useAccount } from '@/lib/account-context';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PerformanceAnalyticsData {
  kpiMetrics: Record<string, unknown>;
  charts: Record<string, unknown>;
  metadata: {
    accountCount: number;
    mixedCurrencies: boolean;
    tradeCount: number;
    dateRange: { from: string | null; to: string | null };
    /** Distinct symbols in the current filter scope (facet for the Filters popover). */
    distinctSymbols: string[];
    /** % denominator: period-start equity for the selected analytical scope. */
    periodStartEquity: number | null;
    /** R denominator: aggregate eligible initial risk for the selected scope. */
    totalInitialRisk: number | null;
  };
}

export interface PerformanceDashboardContextValue {
  filter: PerformanceDashboardFilter;
  setDateRange: (range: DateRange) => void;
  setAdvancedFilters: (filters: AdvancedFilters) => void;
  setUnit: (unit: PerformanceUnit) => void;
  setFilter: (filter: Partial<PerformanceDashboardFilter>) => void;
  analyticsData: PerformanceAnalyticsData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── Context ─────────────────────────────────────────────────────────────────

const PerformanceDashboardContext = createContext<PerformanceDashboardContextValue | null>(null);

// ── Provider Props ──────────────────────────────────────────────────────────

export interface PerformanceDashboardProviderProps {
  children: React.ReactNode;
  initialFilter?: Partial<PerformanceDashboardFilter>;
}

// ── Helper: build query params from filter ──────────────────────────────────

/**
 * Serialize a PerformanceDashboardFilter into the /api/performance/analytics
 * query string. `unit` is deliberately excluded — it is a client-side
 * presentation concern only and must not trigger refetches or cache variance.
 */
export function buildQueryParams(
  filter: PerformanceDashboardFilter,
  globalAccountId?: string,
): URLSearchParams {
  const params = new URLSearchParams();

  // Account scope — M007/D037: the sidebar AccountProvider is the canonical
  // account owner. When a global account is resolved (globalAccountId
  // non-empty) the scope is FORCED to single/<id> regardless of any
  // page-local filter.accountScope state (legacy persisted 'all'/'multiple'
  // values cannot override the global selection). Without a resolved global
  // account the filter's own scope is serialized (tests / server tooling).
  const hasGlobal = globalAccountId != null && globalAccountId !== '';
  const scope = hasGlobal
    ? { mode: 'single' as const, accountIds: [globalAccountId as string] }
    : filter.accountScope;
  params.set('accountScope', scope.mode);
  if (scope.accountIds.length > 0) {
    params.set('accountIds', scope.accountIds.join(','));
  }

  // Date range
  if (filter.dateRange.from) {
    params.set('dateFrom', filter.dateRange.from);
  }
  if (filter.dateRange.to) {
    params.set('dateTo', filter.dateRange.to);
  }

  // Advanced filters
  if (filter.advancedFilters.setupIds.length > 0) {
    params.set('setupIds', filter.advancedFilters.setupIds.join(','));
  }
  if (filter.advancedFilters.directions.length > 0) {
    params.set('directions', filter.advancedFilters.directions.join(','));
  }
  if (filter.advancedFilters.symbols.length > 0) {
    params.set('symbols', filter.advancedFilters.symbols.join(','));
  }
  if (filter.advancedFilters.tradeResults.length > 0) {
    params.set('tradeResults', filter.advancedFilters.tradeResults.join(','));
  }

  return params;
}

// ── Provider ────────────────────────────────────────────────────────────────

export function PerformanceDashboardProvider({ children, initialFilter }: PerformanceDashboardProviderProps) {
  const [filter, setFilterState] = useState<PerformanceDashboardFilter>(() => ({
    ...createDefaultFilter(),
    ...initialFilter,
  }));
  const [analyticsData, setAnalyticsData] = useState<PerformanceAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Canonical account scope (M007/D037): the sidebar AccountProvider is the
  // sole account-selection owner for primary surfaces. Performance never
  // fetches /api/accounts itself and never offers an account selector; every
  // analytics request is forced to accountScope=single&accountIds=<global>.
  const { accountId, loading: accountsLoading, error: accountsError } = useAccount();

  // Normalize the filter's accountScope to the global selection so any
  // consumer reading filter.accountScope sees reality — and legacy persisted
  // 'all'/'single B'/'multiple' state can never override the global account.
  // (Runs only when the global account resolves or changes; the query itself
  // is forced via buildQueryParams(filter, accountId) regardless.)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilterState((prev) => ({
      ...prev,
      accountScope: accountId
        ? { mode: 'single', accountIds: [accountId] }
        : prev.accountScope,
    }));
  }, [accountId]);

  // Serialized query drives the fetch effect — unit changes (client-side
  // presentation only) produce an identical queryKey string, so the memoized
  // string value stays stable and no redundant refetch fires. The global
  // account is part of the key: switching the sidebar account refetches.
  const queryKey = useMemo(() => buildQueryParams(filter, accountId).toString(), [filter, accountId]);

  // Monotonic request sequence: a slow older response must never overwrite a
  // newer one (debounced refetches can overlap in flight). Only the response
  // matching the latest request id is applied.
  const requestSeqRef = useRef(0);

  const fetchAnalytics = useCallback(async () => {
    // Never issue an unscoped/all-account request: wait for the canonical
    // account to resolve. AccountProvider errors surface through the existing
    // error state instead of broadening to All Accounts.
    if (accountsLoading || !accountId) return;
    if (accountsError) {
      setError(accountsError);
      return;
    }
    const requestId = ++requestSeqRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/performance/analytics?${queryKey}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch analytics');
      }

      const data = await response.json();
      // Ignore responses superseded by a newer request.
      if (requestId !== requestSeqRef.current) return;
      setAnalyticsData(data);
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (requestId === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [queryKey, accountId, accountsLoading, accountsError]);

  // Fetch on filter change (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(fetchAnalytics, 300);
    return () => clearTimeout(timeoutId);
  }, [fetchAnalytics]);

  const setDateRange = useCallback((range: DateRange) => {
    setFilterState((prev) => ({ ...prev, dateRange: range }));
  }, []);

  const setAdvancedFilters = useCallback((filters: AdvancedFilters) => {
    setFilterState((prev) => ({ ...prev, advancedFilters: filters }));
  }, []);

  const setUnit = useCallback((unit: PerformanceUnit) => {
    setFilterState((prev) => ({ ...prev, unit }));
  }, []);

  const setFilter = useCallback((partial: Partial<PerformanceDashboardFilter>) => {
    setFilterState((prev) => ({ ...prev, ...partial }));
  }, []);

  const value = useMemo(
    () => ({
      filter,
      setDateRange,
      setAdvancedFilters,
      setUnit,
      setFilter,
      analyticsData,
      isLoading,
      error,
      refetch: fetchAnalytics,
    }),
    [filter, setDateRange, setAdvancedFilters, setUnit, setFilter, analyticsData, isLoading, error, fetchAnalytics],
  );

  return (
    <PerformanceDashboardContext.Provider value={value}>
      {children}
    </PerformanceDashboardContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function usePerformanceDashboard(): PerformanceDashboardContextValue {
  const context = useContext(PerformanceDashboardContext);
  if (!context) {
    throw new Error(
      'usePerformanceDashboard must be used within a PerformanceDashboardProvider',
    );
  }
  return context;
}
