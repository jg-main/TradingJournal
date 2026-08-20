'use client';

import { createContext, useContext, type ReactNode } from 'react';
import {
  usePerformanceInstances,
  type PerformanceInstanceStore,
} from '@/hooks/use-performance-instances';

/**
 * Single owner of all Performance widget instance state (KPI + chart).
 * KpiRow and ChartGrid consume this context so dashboard save/switch/restore
 * operates on one canonical store (AGENTS.md: shared state has one owner).
 */

export interface PerformanceInstanceContextValue {
  kpi: PerformanceInstanceStore;
  chart: PerformanceInstanceStore;
}

const PerformanceInstanceContext = createContext<PerformanceInstanceContextValue | null>(null);

export function PerformanceInstanceProvider({ children }: { children: ReactNode }) {
  const kpi = usePerformanceInstances('kpi');
  const chart = usePerformanceInstances('chart');

  return (
    <PerformanceInstanceContext.Provider value={{ kpi, chart }}>
      {children}
    </PerformanceInstanceContext.Provider>
  );
}

export function usePerformanceInstanceContext(): PerformanceInstanceContextValue {
  const ctx = useContext(PerformanceInstanceContext);
  if (!ctx) {
    throw new Error(
      'usePerformanceInstanceContext must be used inside <PerformanceInstanceProvider>.',
    );
  }
  return ctx;
}
