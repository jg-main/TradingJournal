'use client';

import React from 'react';
import { DashboardSwitcher } from './dashboard-switcher';
import type { PerformanceDashboardEnvelope } from '@/lib/performance-view-types';

export interface PerformanceToolbarProps {
  editMode: boolean;
  onToggleEditMode: () => void;
  onSave: () => void;
  onSwitch: (id: string) => void;
  dashboards: PerformanceDashboardEnvelope[];
  activeDashboard: PerformanceDashboardEnvelope | null;
  writeFailed: boolean;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
  tradeCount?: number;
}

/**
 * Performance dashboard toolbar: dashboard switcher + mode toggle.
 * Normal mode has zero editing chrome; 'Customize' enters editing state.
 */
export function PerformanceToolbar({
  editMode,
  onToggleEditMode,
  onSave,
  onSwitch,
  dashboards,
  activeDashboard,
  writeFailed,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onReset,
  tradeCount,
}: PerformanceToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
      <DashboardSwitcher
        editMode={editMode}
        dashboards={dashboards}
        activeDashboard={activeDashboard}
        writeFailed={writeFailed}
        onSave={onSave}
        onSwitch={onSwitch}
        onCreate={onCreate}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onReset={onReset}
      />

      {!editMode && (
        <button
          onClick={onToggleEditMode}
          className="inline-flex items-center justify-center text-sm rounded-md border border-border px-3 h-(--density-control-h-lg) hover:bg-muted"
        >
          Customize
        </button>
      )}

      {editMode && (
        <button
          onClick={onToggleEditMode}
          className="inline-flex items-center justify-center text-sm rounded-md bg-primary text-primary-foreground px-3 h-(--density-control-h-lg) hover:bg-primary/90"
        >
          Done
        </button>
      )}

      {typeof tradeCount === 'number' && (
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {tradeCount} trade{tradeCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
