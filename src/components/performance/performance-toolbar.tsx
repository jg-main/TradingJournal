'use client';

import React from 'react';
import { DashboardSwitcher } from './dashboard-switcher';
import { Button } from '@/components/ui/button';
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
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onToggleEditMode}
        >
          Customize
        </Button>
      )}

      {editMode && (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={onToggleEditMode}
        >
          Done
        </Button>
      )}

      {typeof tradeCount === 'number' && (
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {tradeCount} trade{tradeCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
