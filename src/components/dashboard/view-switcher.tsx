'use client';

import React, { useCallback } from 'react';
import { Check, ChevronDown, Plus, Settings2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardView } from '@/types/dashboard-view';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

// ── Types ──────────────────────────────────────────────────────────────

export interface ViewSwitcherProps {
  /**
   * All available views (system + user), ordered for display.
   */
  views: DashboardView[];
  /**
   * ID of the currently active view.
   */
  activeViewId: string;
  /**
   * Called when the user selects a view from the dropdown.
   */
  onSelectView: (id: string) => void;
  /**
   * Called when the user wants to create a new view with the given name.
   * The component prompts for the name before calling this callback.
   */
  onCreateView: (name: string) => void;
  /**
   * Called when the user clicks "Manage Views…" to open the management dialog.
   */
  onManageViews: () => void;
  /**
   * Whether the most recent localStorage write failed. When true, a warning
   * indicator appears in the dropdown footer.
   */
  writeFailed?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * ViewSwitcher dropdown component for the dashboard toolbar.
 *
 * Displays the current view name as a trigger button. The dropdown lists all
 * views grouped by system/user with a checkmark on the active view, plus
 * "Create New View" and "Manage Views…" action items at the bottom.
 *
 * @example
 * ```tsx
 * <ViewSwitcher
 *   views={views}
 *   activeViewId={activeViewId}
 *   onSelectView={setActiveView}
 *   onCreateView={(name) => createView(name, currentLayout, hiddenIds)}
 *   onManageViews={() => setManageDialogOpen(true)}
 *   writeFailed={writeFailed}
 * />
 * ```
 */
export function ViewSwitcher({
  views,
  activeViewId,
  onSelectView,
  onCreateView,
  onManageViews,
  writeFailed = false,
}: ViewSwitcherProps) {
  const [open, setOpen] = React.useState(false);

  const activeView = views.find((v) => v.id === activeViewId);
  const displayName = activeView?.name ?? 'View';

  const systemViews = views.filter((v) => v.isSystem);
  const userViews = views.filter((v) => !v.isSystem);

  const handleCreateNewView = useCallback(() => {
    const name = window.prompt('Enter a name for the new view:');
    if (name && name.trim()) {
      onCreateView(name.trim());
    }
  }, [onCreateView]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="view-switcher-trigger"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100',
            'dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          )}
        >
          <span data-testid="view-switcher-current-name">{displayName}</span>
          <ChevronDown className="size-3.5 text-zinc-400 dark:text-zinc-500" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="min-w-48"
        data-testid="view-switcher-content"
      >
        {/* System Views */}
        <DropdownMenuLabel>System Views</DropdownMenuLabel>
        <DropdownMenuGroup>
          {systemViews.map((view) => (
            <DropdownMenuItem
              key={view.id}
              data-testid={`view-item-${view.id}`}
              onSelect={() => onSelectView(view.id)}
              className={cn(
                'cursor-pointer',
                view.id === activeViewId && 'font-medium',
              )}
            >
              <span className="flex-1">{view.name}</span>
              {view.id === activeViewId && (
                <Check className="size-3.5 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        {userViews.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>User Views</DropdownMenuLabel>
            <DropdownMenuGroup>
              {userViews.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  data-testid={`view-item-${view.id}`}
                  onSelect={() => onSelectView(view.id)}
                  className={cn(
                    'cursor-pointer',
                    view.id === activeViewId && 'font-medium',
                  )}
                >
                  <span className="flex-1">{view.name}</span>
                  {view.id === activeViewId && (
                    <Check className="size-3.5 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}

        <DropdownMenuSeparator />

        {/* Create New View */}
        <DropdownMenuItem
          data-testid="view-create-new"
          onSelect={handleCreateNewView}
          className="cursor-pointer"
        >
          <Plus className="size-3.5" />
          <span>Create New View</span>
        </DropdownMenuItem>

        {/* Manage Views… */}
        <DropdownMenuItem
          data-testid="view-manage-views"
          onSelect={onManageViews}
          className="cursor-pointer"
        >
          <Settings2 className="size-3.5" />
          <span>Manage Views…</span>
        </DropdownMenuItem>

        {/* Write Failure Warning */}
        {writeFailed && (
          <>
            <DropdownMenuSeparator />
            <div
              data-testid="view-write-failed"
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle className="size-3 shrink-0" />
              <span>Changes may not be saved</span>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
