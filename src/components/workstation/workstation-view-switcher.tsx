'use client';

// WorkstationViewSwitcher — view selector + view management for the
// workstation toolbar (M016/S06-T03, extended by S06-T04).
//
// A dropdown listing the three curated system template views (Risk &
// Positions, Performance, Process Review) and the user's own saved views,
// with a checkmark on the active view and a "Startup" badge on the view
// restored at load (R035). It mirrors the dashboard ViewSwitcher pattern
// (Radix dropdown-menu primitive, grouped system/user lists) but consumes
// workstation view envelopes (WorkstationView) and uses the workstation
// density styling for the trigger so it sits naturally in the .ws toolbar
// chrome.
//
// S06-T04 adds the view-management actions required by the slice must-haves
// ("create, duplicate, rename, hide optional panels in, delete, and reset
// their own views; a user view may be selected as the startup view"):
//
// - "Create New View" prompts for a name and delegates to onCreateView (the
//   new view is created from the active view's template and becomes active);
// - a View Actions section operates on the *active* view: Rename (prompt),
//   Duplicate, Set as Startup, Reset to Template, and Delete (confirm).
//   System presets are read-only (R035: the system default can always be
//   restored and cannot be overwritten), so Rename / Reset / Delete are
//   disabled while a preset is active.
//
// The writeFailed flag surfaces the hook's localStorage write-failure signal
// as a warning footer so the user knows changes may not persist across
// reloads.

import React, { useCallback } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorkstationView } from '@/hooks/use-workstation-views';

// ── Types ──────────────────────────────────────────────────────────────

export interface WorkstationViewSwitcherProps {
  /** All available views (system presets + user views), ordered for display. */
  views: WorkstationView[];
  /** ID of the currently active view. */
  activeViewId: string;
  /** Called when the user selects a view from the dropdown. */
  onSelectView: (id: string) => void;
  /** Called when the user creates a new view with the given name. */
  onCreateView: (name: string) => void;
  /** Rename a user view (prompted by this component). No-op for presets. */
  onRenameView: (id: string, name: string) => void;
  /** Duplicate a view as a new editable copy. */
  onDuplicateView: (id: string) => void;
  /** Delete a user view (confirm-prompted by this component). */
  onDeleteView: (id: string) => void;
  /** Reset a user view's layout to its template. */
  onResetView: (id: string) => void;
  /** Mark a view as the startup view restored on load (R035). */
  onSetStartupView: (id: string) => void;
  /** True when the most recent localStorage write failed (warning footer). */
  writeFailed?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Workstation view switcher dropdown.
 *
 * Lists system template views and user views in separate groups with a
 * checkmark on the active view and a Startup badge, plus Create New View and
 * a View Actions section operating on the active view (rename / duplicate /
 * set-as-startup / reset-to-template / delete).
 */
export function WorkstationViewSwitcher({
  views,
  activeViewId,
  onSelectView,
  onCreateView,
  onRenameView,
  onDuplicateView,
  onDeleteView,
  onResetView,
  onSetStartupView,
  writeFailed = false,
}: WorkstationViewSwitcherProps) {
  const [open, setOpen] = React.useState(false);

  const activeView = views.find((v) => v.id === activeViewId);
  const displayName = activeView?.name ?? 'View';
  const activeIsSystem = activeView?.isSystem ?? false;
  const activeIsStartup = activeView?.isStartup ?? false;

  const systemViews = views.filter((v) => v.isSystem);
  const userViews = views.filter((v) => !v.isSystem);

  const handleCreateNewView = useCallback(() => {
    const name = window.prompt('Enter a name for the new view:');
    if (name && name.trim()) {
      onCreateView(name.trim());
    }
  }, [onCreateView]);

  const handleRename = useCallback(() => {
    if (!activeView || activeView.isSystem) return;
    const name = window.prompt(
      `Rename view "${activeView.name}" to:`,
      activeView.name,
    );
    if (name && name.trim()) {
      onRenameView(activeView.id, name.trim());
    }
  }, [activeView, onRenameView]);

  const handleDuplicate = useCallback(() => {
    if (!activeView) return;
    onDuplicateView(activeView.id);
  }, [activeView, onDuplicateView]);

  const handleSetStartup = useCallback(() => {
    if (!activeView || activeIsStartup) return;
    onSetStartupView(activeView.id);
  }, [activeView, activeIsStartup, onSetStartupView]);

  const handleReset = useCallback(() => {
    if (!activeView || activeView.isSystem) return;
    onResetView(activeView.id);
  }, [activeView, onResetView]);

  const handleDelete = useCallback(() => {
    if (!activeView || activeView.isSystem) return;
    const confirmed = window.confirm(
      `Delete view "${activeView.name}"? This cannot be undone.`,
    );
    if (confirmed) {
      onDeleteView(activeView.id);
    }
  }, [activeView, onDeleteView]);

  /** Renders one view row with the active checkmark and startup badge. */
  function renderViewRow(view: WorkstationView) {
    return (
      <DropdownMenuItem
        key={view.id}
        data-testid={`ws-view-item-${view.id}`}
        onSelect={() => onSelectView(view.id)}
        className="cursor-pointer"
      >
        <span className="flex-1">{view.name}</span>
        {view.isStartup && (
          <Star
            className="size-3.5 text-warning"
            aria-hidden="true"
            data-testid="ws-view-startup-badge"
          />
        )}
        {view.id === activeViewId && (
          <Check className="size-3.5 text-primary" aria-hidden="true" />
        )}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ws-view-trigger"
          data-testid="ws-view-switcher-trigger"
          aria-label="Switch workstation view"
        >
          <span data-testid="ws-view-switcher-current-name">{displayName}</span>
          <ChevronDown className="ws-view-trigger-icon" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="min-w-52"
        data-testid="ws-view-switcher-content"
      >
        {/* System template views — curated presets, read-only. */}
        <DropdownMenuLabel>System Views</DropdownMenuLabel>
        <DropdownMenuGroup>{systemViews.map(renderViewRow)}</DropdownMenuGroup>

        {/* User views — only shown once the user has created at least one. */}
        {userViews.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>User Views</DropdownMenuLabel>
            <DropdownMenuGroup>{userViews.map(renderViewRow)}</DropdownMenuGroup>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          data-testid="ws-view-create-new"
          onSelect={handleCreateNewView}
          className="cursor-pointer"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          <span>Create New View</span>
        </DropdownMenuItem>

        {/* View actions — operate on the active view (S06-T04). Presets are
            read-only: rename / reset / delete are disabled for them. */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>View Actions</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem
            data-testid="ws-view-rename"
            onSelect={handleRename}
            disabled={activeIsSystem}
            className="cursor-pointer"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            <span>Rename View…</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            data-testid="ws-view-duplicate"
            onSelect={handleDuplicate}
            className="cursor-pointer"
          >
            <Copy className="size-3.5" aria-hidden="true" />
            <span>Duplicate View</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            data-testid="ws-view-set-startup"
            onSelect={handleSetStartup}
            disabled={activeIsStartup}
            className="cursor-pointer"
          >
            <Star className="size-3.5" aria-hidden="true" />
            <span>{activeIsStartup ? 'Startup View' : 'Set as Startup View'}</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            data-testid="ws-view-reset-template"
            onSelect={handleReset}
            disabled={activeIsSystem}
            className="cursor-pointer"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            <span>Reset to Template</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            data-testid="ws-view-delete"
            onSelect={handleDelete}
            disabled={activeIsSystem}
            className="cursor-pointer"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Delete View…</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {/* Write-failure warning — storage may be full or disabled. */}
        {writeFailed && (
          <>
            <DropdownMenuSeparator />
            <div
              data-testid="ws-view-write-failed"
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-warning"
            >
              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
              <span>Changes may not be saved</span>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
