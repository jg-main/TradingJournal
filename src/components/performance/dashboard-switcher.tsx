'use client';

import React, { useState } from 'react';
import type { PerformanceDashboardEnvelope } from '@/lib/performance-view-types';

export interface DashboardSwitcherProps {
  editMode?: boolean;
  dashboards: PerformanceDashboardEnvelope[];
  activeDashboard: PerformanceDashboardEnvelope | null;
  writeFailed: boolean;
  onSave: () => void;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
}

/**
 * Performance dashboard selector + management.
 * Consumes the single dashboards store via props (one owner — the shell).
 */
export function DashboardSwitcher({
  editMode,
  dashboards,
  activeDashboard,
  writeFailed,
  onSave,
  onSwitch,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onReset,
}: DashboardSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = () => {
    const name = createName.trim() || 'New Dashboard';
    onCreate(name);
    setCreateName('');
    setShowCreate(false);
    setOpen(false);
  };

  const handleDuplicate = () => {
    if (activeDashboard) {
      onDuplicate(activeDashboard.id);
      setOpen(false);
    }
  };

  const handleDelete = () => {
    if (activeDashboard && !activeDashboard.isSystem) {
      if (window.confirm(`Delete dashboard "${activeDashboard.name}"?`)) {
        onDelete(activeDashboard.id);
        setOpen(false);
      }
    }
  };

  const handleReset = () => {
    if (activeDashboard) {
      onReset(activeDashboard.id);
      setOpen(false);
    }
  };

  const handleRename = () => {
    if (!activeDashboard || activeDashboard.isSystem) return;
    const name = window.prompt('Rename dashboard', activeDashboard.name);
    if (name && name.trim()) {
      onRename(activeDashboard.id, name.trim());
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm rounded-md border border-border px-3 py-1.5 hover:bg-muted flex items-center gap-2"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="font-medium">{activeDashboard?.name ?? 'Dashboards'}</span>
        <span aria-hidden>▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-64 bg-card border border-border rounded-lg shadow-lg p-2" role="listbox">
          <div className="text-xs text-muted-foreground px-2 py-1">Dashboards</div>
          {dashboards.map((d) => (
            <div
              key={d.id}
              role="option"
              aria-selected={d.id === activeDashboard?.id}
              className={`flex items-center justify-between px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-muted ${
                d.id === activeDashboard?.id ? 'bg-muted/60' : ''
              }`}
              onClick={() => {
                onSwitch(d.id);
                setOpen(false);
              }}
            >
              <span className="truncate">{d.name}</span>
              {d.isSystem && <span className="text-[10px] text-muted-foreground ml-2 shrink-0">System</span>}
            </div>
          ))}

          <div className="border-t border-border mt-2 pt-2 space-y-1">
            {showCreate ? (
              <div className="flex gap-1 px-1">
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Dashboard name"
                  className="flex-1 text-sm rounded border border-border bg-background px-2 py-1"
                  autoFocus
                />
                <button
                  onClick={handleCreate}
                  className="text-xs rounded border border-border px-2 py-1 hover:bg-muted"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
              >
                + New Dashboard
              </button>
            )}

            {activeDashboard && !activeDashboard.isSystem && (
              <>
                <button
                  onClick={handleRename}
                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
                >
                  Rename…
                </button>
                <button
                  onClick={handleDelete}
                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted text-destructive"
                >
                  Delete…
                </button>
              </>
            )}
            <button
              onClick={handleDuplicate}
              className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
            >
              Duplicate
            </button>
            <button
              onClick={handleReset}
              className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
            >
              Reset to Default
            </button>
          </div>
        </div>
      )}

      {/* Explicit Save — captures current widget state into the active dashboard */}
      {editMode && (
        <button
          onClick={onSave}
          className="ml-2 text-sm rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90"
        >
          Save
        </button>
      )}

      {writeFailed && (
        <div className="ml-2 text-xs text-warning" role="alert">
          Changes may not persist — server write failed.
        </div>
      )}
    </div>
  );
}
