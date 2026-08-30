'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
 *
 * The overlay is the shared Popover primitive (outside-click/Escape dismissal
 * and trigger focus restoration are owned by the primitive). Dashboard
 * choices and management actions render through the shared Button primitive;
 * the create-name field is the shared Input.
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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="lg"
            aria-label="Switch performance dashboard"
            className="gap-2"
          >
            <span className="font-medium">{activeDashboard?.name ?? 'Dashboards'}</span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-64 p-2">
          <div className="px-2 py-1 text-xs text-muted-foreground">Dashboards</div>
          <div className="space-y-0.5">
            {dashboards.map((d) => (
              <Button
                key={d.id}
                type="button"
                variant={d.id === activeDashboard?.id ? 'secondary' : 'ghost'}
                size="sm"
                className="w-full justify-start gap-2 px-2"
                onClick={() => {
                  onSwitch(d.id);
                  setOpen(false);
                }}
              >
                <span className="truncate">{d.name}</span>
                {d.isSystem && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    System
                  </span>
                )}
              </Button>
            ))}
          </div>

          <div className="mt-2 space-y-0.5 border-t border-border pt-2">
            {showCreate ? (
              <div className="flex gap-1 px-1">
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Dashboard name"
                  className="h-(--density-control-h-sm) flex-1"
                  autoFocus
                />
                <Button type="button" size="sm" onClick={handleCreate}>
                  OK
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start px-2"
                onClick={() => setShowCreate(true)}
              >
                + New Dashboard
              </Button>
            )}

            {activeDashboard && !activeDashboard.isSystem && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-2"
                  onClick={handleRename}
                >
                  Rename…
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-2 text-destructive"
                  onClick={handleDelete}
                >
                  Delete…
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start px-2"
              onClick={handleDuplicate}
            >
              Duplicate
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start px-2"
              onClick={handleReset}
            >
              Reset to Default
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Explicit Save — captures current widget state into the active dashboard */}
      {editMode && (
        <Button type="button" onClick={onSave} className="ml-2">
          Save
        </Button>
      )}

      {writeFailed && (
        <div className="ml-2 text-xs text-warning" role="alert">
          Changes may not persist — server write failed.
        </div>
      )}
    </div>
  );
}
