'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

export interface DashboardFilterState {
  dateFrom: string;
  dateTo: string;
  accountId: string | null;
}

export interface DashboardFilterActions {
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  setAccountId: (v: string | null) => void;
  /** Replace multiple filters at once */
  setFilters: (partial: Partial<DashboardFilterState>) => void;
  /** Quick date range presets */
  setDatePreset: (preset: DatePreset) => void;
  /** Build URL search params from current filters (for URL sync) */
  toSearchParams: () => URLSearchParams;
}

export type DatePreset = '1W' | '1M' | '3M' | '6M' | 'YTD' | 'All';

export interface DashboardFilterContextValue {
  filters: DashboardFilterState;
  actions: DashboardFilterActions;
}

// ── Context ────────────────────────────────────────────────────────────

const FilterContext = createContext<DashboardFilterContextValue | null>(null);

// ── Provider Props ─────────────────────────────────────────────────────

export interface FilterProviderProps {
  children: React.ReactNode;
  /** Initial filter values (e.g. from URL search params) */
  initialFilters?: Partial<DashboardFilterState>;
}

// ── Helper: compute date strings for presets ───────────────────────────

function presetDateRange(preset: DatePreset): { dateFrom: string; dateTo: string } {
  if (preset === 'All') return { dateFrom: '', dateTo: '' };
  if (preset === 'YTD') {
    const year = new Date().getFullYear();
    return { dateFrom: `${year}-01-01`, dateTo: '' };
  }
  const days: Record<Exclude<DatePreset, 'YTD' | 'All'>, number> = {
    '1W': 7,
    '1M': 30,
    '3M': 90,
    '6M': 180,
  };
  const from = new Date();
  from.setDate(from.getDate() - days[preset as keyof typeof days]);
  return { dateFrom: from.toISOString().split('T')[0], dateTo: '' };
}

// ── Provider ───────────────────────────────────────────────────────────

export function FilterProvider({ children, initialFilters }: FilterProviderProps) {
  const [dateFrom, setDateFrom] = useState(initialFilters?.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(initialFilters?.dateTo ?? '');
  const [accountId, setAccountId] = useState<string | null>(
    initialFilters?.accountId ?? null,
  );

  const setFilters = useCallback((partial: Partial<DashboardFilterState>) => {
    if ('dateFrom' in partial) setDateFrom(partial.dateFrom!);
    if ('dateTo' in partial) setDateTo(partial.dateTo!);
    if ('accountId' in partial) setAccountId(partial.accountId!);
  }, []);

  const setDatePreset = useCallback((preset: DatePreset) => {
    const range = presetDateRange(preset);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
  }, []);

  const toSearchParams = useCallback(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (accountId) params.set('accountId', accountId);
    return params;
  }, [dateFrom, dateTo, accountId]);

  const value = useMemo<DashboardFilterContextValue>(
    () => ({
      filters: { dateFrom, dateTo, accountId },
      actions: { setDateFrom, setDateTo, setAccountId, setFilters, setDatePreset, toSearchParams },
    }),
    [dateFrom, dateTo, accountId, setFilters, setDatePreset, toSearchParams],
  );

  return (
    <FilterContext.Provider value={value}>
      {children}
    </FilterContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useDashboardFilters(): DashboardFilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) {
    throw new Error('useDashboardFilters must be used within a FilterProvider');
  }
  return ctx;
}
