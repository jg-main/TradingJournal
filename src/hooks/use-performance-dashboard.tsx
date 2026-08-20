'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type {
  PerformanceDashboardFilter,
  AccountScope,
  DateRange,
  AdvancedFilters,
  PerformanceUnit,
} from '@/lib/performance-view-types';
import { createDefaultFilter } from '@/lib/performance-view-types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PerformanceAnalyticsData {
  kpiMetrics: Record<string, unknown>;
  charts: Record<string, unknown>;
  metadata: {
    accountCount: number;
    mixedCurrencies: boolean;
    tradeCount: number;
    dateRange: { from: string | null; to: string | null };
  };
}

export interface PerformanceDashboardContextValue {
  filter: PerformanceDashboardFilter;
  setAccountScope: (scope: AccountScope) => void;
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

function buildQueryParams(filter: PerformanceDashboardFilter): URLSearchParams {
  const params = new URLSearchParams();

  // Account scope
  params.set('accountScope', filter.accountScope.mode);
  if (filter.accountScope.accountIds.length > 0) {
    params.set('accountIds', filter.accountScope.accountIds.join(','));
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

  // Serialized query drives the fetch effect — unit changes (client-side
  // presentation only) must not trigger a redundant refetch.
  const queryKey = useMemo(() => buildQueryParams(filter).toString(), [filter]);

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/performance/analytics?${queryKey}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch analytics');
      }

      const data = await response.json();
      setAnalyticsData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [queryKey]);

  // Fetch on filter change (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(fetchAnalytics, 300);
    return () => clearTimeout(timeoutId);
  }, [fetchAnalytics]);

  const setAccountScope = useCallback((scope: AccountScope) => {
    setFilterState((prev) => ({ ...prev, accountScope: scope }));
  }, []);

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
      setAccountScope,
      setDateRange,
      setAdvancedFilters,
      setUnit,
      setFilter,
      analyticsData,
      isLoading,
      error,
      refetch: fetchAnalytics,
    }),
    [filter, setAccountScope, setDateRange, setAdvancedFilters, setUnit, setFilter, analyticsData, isLoading, error, fetchAnalytics],
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
