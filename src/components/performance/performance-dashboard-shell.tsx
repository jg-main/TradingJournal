'use client';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePerformanceDashboards } from '@/hooks/use-performance-dashboards';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider, usePerformanceInstanceContext } from './performance-instance-context';
import { PerformanceToolbar } from './performance-toolbar';
import { PerformanceFilterBar } from './performance-filter-bar';
import { KpiRow } from './kpi-row';
import { ChartGrid } from './chart-grid';
import type { WidgetInstance } from '@/lib/performance-view-types';

const emptySubscribe = () => () => {};

// ── Instance ↔ Dashboard sync logic (inside the instance provider) ─────────

function DashboardSync() {
  const [editMode, setEditMode] = useState(false);
  // localStorage-backed state differs between server and client → gate on mount
  // via useSyncExternalStore (no setState-in-effect; matches repo pattern).
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const {
    dashboards,
    activeDashboard,
    hydrated,
    writeFailed,
    createDashboard,
    renameDashboard,
    duplicateDashboard,
    deleteDashboard,
    resetDashboard,
    switchDashboard,
    saveDashboardState,
  } = usePerformanceDashboards();
  const { kpi, chart } = usePerformanceInstanceContext();
  const { analyticsData } = usePerformanceDashboard();
  const tradeCount = analyticsData?.metadata?.tradeCount as number | undefined;

  // Remember the dashboard id the current instance state belongs to.
  const lastSavedDashboardId = useRef<string | null>(null);

  // Split combined instances by widget category.
  const splitInstances = useCallback(
    (instances: WidgetInstance[]) => {
      const kpiTypes = new Set(['net-pnl', 'gross-pnl', 'total-trades', 'win-rate', 'day-win-rate', 'profit-factor', 'expectancy', 'average-r', 'median-r', 'average-win', 'average-loss', 'payoff-ratio', 'largest-win', 'largest-loss', 'average-holding-duration', 'max-drawdown', 'current-drawdown', 'total-fees']);
      const kpiInstances = instances.filter((i) => kpiTypes.has(i.widgetType));
      const chartInstances = instances.filter((i) => !kpiTypes.has(i.widgetType));
      return { kpiInstances, chartInstances };
    },
    [],
  );

  const captureCurrentState = useCallback(() => {
    if (!activeDashboard) return;
    const combined: WidgetInstance[] = [...kpi.instances, ...chart.instances];
    saveDashboardState(combined);
    lastSavedDashboardId.current = activeDashboard.id;
  }, [activeDashboard, kpi.instances, chart.instances, saveDashboardState]);

  const restoreDashboard = useCallback(
    (instances: WidgetInstance[]) => {
      const { kpiInstances, chartInstances } = splitInstances(instances);
      if (kpiInstances.length > 0) kpi.replaceInstances(kpiInstances);
      if (chartInstances.length > 0) chart.replaceInstances(chartInstances);
    },
    [kpi, chart, splitInstances],
  );

  // On hydrate: if the active dashboard has stored instances, restore them.
  useEffect(() => {
    if (!hydrated || !activeDashboard) return;
    const stored = activeDashboard.config.instances ?? [];
    if (stored.length > 0) {
      restoreDashboard(stored);
    }
    lastSavedDashboardId.current = activeDashboard.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Save current state before switching dashboards.
  const handleSwitch = useCallback((id: string) => {
    if (id === activeDashboard?.id) return;
    if (activeDashboard && lastSavedDashboardId.current === activeDashboard.id) {
      captureCurrentState();
    }
    switchDashboard(id);
    const target = dashboards.find((d) => d.id === id);
    if (target && target.config.instances.length > 0) {
      setTimeout(() => restoreDashboard(target.config.instances), 0);
    }
    // The on-screen instance state now belongs to the newly active dashboard,
    // so later edits are captured on the next switch-away.
    lastSavedDashboardId.current = id;
  }, [activeDashboard, captureCurrentState, switchDashboard, dashboards, restoreDashboard]);

  // Create a dashboard from the current state: attribute the on-screen
  // instance state to the new dashboard so edits made after creation are
  // captured when switching away.
  const handleCreate = useCallback(
    (name: string) => {
      const newId = createDashboard(name);
      lastSavedDashboardId.current = newId;
    },
    [createDashboard],
  );

  // The exposed save action.
  const handleSave = useCallback(() => {
    captureCurrentState();
  }, [captureCurrentState]);

  if (!mounted) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-sm text-muted-foreground">
        Loading dashboard…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PerformanceToolbar
        editMode={editMode}
        onToggleEditMode={() => setEditMode((v) => !v)}
        onSave={handleSave}
        onSwitch={handleSwitch}
        dashboards={dashboards}
        activeDashboard={activeDashboard}
        writeFailed={writeFailed}
        onCreate={handleCreate}
        onRename={renameDashboard}
        onDuplicate={duplicateDashboard}
        onDelete={deleteDashboard}
        onReset={resetDashboard}
        tradeCount={tradeCount}
      />      <PerformanceFilterBar />
      <div
        data-testid="performance-content"
        className="flex-1 overflow-auto px-4 py-2 space-y-6"
      >
        <section aria-label="Performance KPI row">
          <KpiRow editMode={editMode} />
        </section>
        <section aria-label="Performance charts">
          <ChartGrid editMode={editMode} />
        </section>
      </div>
    </div>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────

export function PerformanceDashboardShell() {
  return (
    <PerformanceInstanceProvider>
      <DashboardSync />
    </PerformanceInstanceProvider>
  );
}
