'use client';

import React, { useCallback, useState, useRef, useEffect } from 'react';
import {
  Edit2,
  Copy,
  Trash2,
  Star,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardView } from '@/types/dashboard-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

// ── Types ──────────────────────────────────────────────────────────────

export interface ManageViewsDialogProps {
  /**
   * Whether the dialog is open.
   */
  open: boolean;
  /**
   * Called when the dialog open state changes.
   */
  onOpenChange: (open: boolean) => void;
  /**
   * All available views (system + user), ordered for display.
   */
  views: DashboardView[];
  /**
   * ID of the currently active view.
   */
  activeViewId: string;
  /**
   * Rename a user view. System views are read-only.
   */
  onRename: (id: string, name: string) => void;
  /**
   * Duplicate a view. Returns the new view or null on failure.
   * When triggered on a system view, creates a user copy.
   */
  onDuplicate: (id: string, newName?: string) => DashboardView | null;
  /**
   * Delete a user view. Cannot delete system views.
   */
  onDelete: (id: string) => void;
  /**
   * Mark a view as the default.
   */
  onSetDefault: (id: string) => void;
  /**
   * Called when the user clicks "Edit" on a system view to create a user copy.
   * Receives the system view ID to duplicate.
   * Implementations should call onDuplicate(id) and then open the copy.
   */
  onEditSystemView?: (id: string) => void;
  /**
   * Switch to a view. Called when the user clicks a view row to preview/switch.
   */
  onSwitchView: (id: string) => void;
}

// ── Sub-components ─────────────────────────────────────────────────────

/**
 * Confirmation prompt that appears inline for destructive actions.
 */
function ConfirmPrompt({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="confirm-prompt"
      className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
    >
      <AlertTriangle className="size-3 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        data-testid="confirm-prompt-yes"
        onClick={onConfirm}
        className="flex items-center gap-0.5 rounded px-1 py-0.5 font-medium text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/50"
      >
        <Check className="size-3" />
        <span>Delete</span>
      </button>
      <button
        data-testid="confirm-prompt-no"
        onClick={onCancel}
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <X className="size-3" />
        <span>Cancel</span>
      </button>
    </div>
  );
}

/**
 * Inline rename input shown when the user clicks the rename action.
 */
function InlineRenameInput({
  initialName,
  onSave,
  onCancel,
}: {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus and select the text when the input appears
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && value.trim()) {
      onSave(value.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-1" data-testid="inline-rename">
      <Input
        ref={inputRef}
        data-testid="inline-rename-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-7 text-xs"
      />
      <Button
        data-testid="inline-rename-save"
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          if (value.trim()) onSave(value.trim());
        }}
        disabled={!value.trim()}
        title="Save"
      >
        <Check className="size-3" />
      </Button>
      <Button
        data-testid="inline-rename-cancel"
        variant="ghost"
        size="icon-xs"
        onClick={onCancel}
        title="Cancel"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

/**
 * Manage Views dialog for the dashboard toolbar.
 *
 * Displays all views grouped by system/user, with rename/duplicate/delete/
 * set-default actions for user views. System views are read-only with an
 * "Edit" button that creates a user copy.
 *
 * @example
 * ```tsx
 * const [manageOpen, setManageOpen] = useState(false);
 *
 * <ManageViewsDialog
 *   open={manageOpen}
 *   onOpenChange={setManageOpen}
 *   views={views}
 *   activeViewId={activeViewId}
 *   onRename={renameView}
 *   onDuplicate={duplicateView}
 *   onDelete={deleteView}
 *   onSetDefault={setDefaultView}
 *   onSwitchView={setActiveView}
 * />
 * ```
 */
export function ManageViewsDialog({
  open,
  onOpenChange,
  views,
  activeViewId,
  onRename,
  onDuplicate,
  onDelete,
  onSetDefault,
  onEditSystemView,
  onSwitchView,
}: ManageViewsDialogProps) {
  // ── Inline rename state ─────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // ── Delete confirmation state ───────────────────────────────────────
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Reset local state when dialog closes
  useEffect(() => {
    if (!open) {
      setRenamingId(null);
      setConfirmingDeleteId(null);
    }
  }, [open]);

  // Split views into system and user
  const systemViews = views.filter((v) => v.isSystem);
  const userViews = views.filter((v) => !v.isSystem);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleRename = useCallback(
    (id: string, name: string) => {
      onRename(id, name);
      setRenamingId(null);
    },
    [onRename],
  );

  const handleDuplicate = useCallback(
    (id: string) => {
      onDuplicate(id);
    },
    [onDuplicate],
  );

  const handleDeleteConfirm = useCallback(
    (id: string) => {
      onDelete(id);
      setConfirmingDeleteId(null);
    },
    [onDelete],
  );

  const handleEditSystemView = useCallback(
    (id: string) => {
      if (onEditSystemView) {
        onEditSystemView(id);
      } else {
        // Default: duplicate the system view as a user copy
        onDuplicate(id);
      }
    },
    [onEditSystemView, onDuplicate],
  );

  const handleSetDefault = useCallback(
    (id: string) => {
      onSetDefault(id);
    },
    [onSetDefault],
  );

  // ── Render: View Row ────────────────────────────────────────────────

  const isViewDefault = (view: DashboardView) => view.isDefault;
  const isViewActive = (view: DashboardView) => view.id === activeViewId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="manage-views-dialog"
      >
        <DialogHeader>
          <DialogTitle>Manage Views</DialogTitle>
          <DialogDescription>
            Rename, duplicate, or delete your custom views. System views are
            read-only — select "Edit" to create a copy.
          </DialogDescription>
        </DialogHeader>

        <div data-testid="manage-views-body" className="max-h-80 space-y-4 overflow-y-auto">
          {/* System Views */}
          {systemViews.length > 0 && (
            <div data-testid="system-views-section">
              <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                System Views
              </h4>
              <div className="space-y-1">
                {systemViews.map((view) => (
                  <div
                    key={view.id}
                    data-testid={`manage-view-${view.id}`}
                    className={cn(
                      'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                      'bg-zinc-50 dark:bg-zinc-900',
                      isViewActive(view) &&
                        'ring-1 ring-primary/20',
                    )}
                  >
                    {/* View name */}
                    <span
                      className={cn(
                        'flex-1 truncate',
                        isViewActive(view) && 'font-medium',
                      )}
                    >
                      {view.name}
                    </span>

                    {/* Default badge */}
                    {isViewDefault(view) && (
                      <span
                        data-testid={`manage-view-${view.id}-default-badge`}
                        className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                      >
                        <Star className="size-2.5" />
                        Default
                      </span>
                    )}

                    {/* Active indicator */}
                    {isViewActive(view) && (
                      <span
                        data-testid={`manage-view-${view.id}-active-badge`}
                        className="text-[10px] text-zinc-400 dark:text-zinc-500"
                      >
                        Active
                      </span>
                    )}

                    {/* System badge */}
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                      System
                    </span>

                    {/* Edit button — creates a user copy of this system view */}
                    <Button
                      data-testid={`manage-view-${view.id}-edit`}
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleEditSystemView(view.id)}
                      title="Create a user copy of this system view"
                    >
                      <Copy className="size-3" />
                      <span className="sr-only">Edit</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* User Views */}
          <div data-testid="user-views-section">
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              User Views
              {userViews.length > 0 && (
                <span className="ml-1.5 text-zinc-300 dark:text-zinc-600">
                  ({userViews.length})
                </span>
              )}
            </h4>
            {userViews.length === 0 ? (
              <p
                data-testid="no-user-views"
                className="py-3 text-center text-xs text-zinc-400 dark:text-zinc-500"
              >
                No user views yet. Create one from the View dropdown.
              </p>
            ) : (
              <div className="space-y-1">
                {userViews.map((view) => (
                  <div
                    key={view.id}
                    data-testid={`manage-view-${view.id}`}
                    className={cn(
                      'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
                      isViewActive(view) &&
                        'bg-primary/[0.03] ring-1 ring-primary/20',
                    )}
                  >
                    {/* View name or inline rename */}
                    {renamingId === view.id ? (
                      <div className="flex-1">
                        <InlineRenameInput
                          initialName={view.name}
                          onSave={(name) => handleRename(view.id, name)}
                          onCancel={() => setRenamingId(null)}
                        />
                      </div>
                    ) : (
                      <>
                        <button
                          data-testid={`manage-view-${view.id}-name`}
                          onClick={() => onSwitchView(view.id)}
                          className={cn(
                            'flex-1 truncate text-left',
                            isViewActive(view) && 'font-medium',
                          )}
                          title={`Switch to "${view.name}"`}
                        >
                          {view.name}
                        </button>
                      </>
                    )}

                    {/* Default badge */}
                    {isViewDefault(view) && (
                      <span
                        data-testid={`manage-view-${view.id}-default-badge`}
                        className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                      >
                        <Star className="size-2.5" />
                        Default
                      </span>
                    )}

                    {/* Active indicator */}
                    {isViewActive(view) && (
                      <span
                        data-testid={`manage-view-${view.id}-active-badge`}
                        className="text-[10px] text-zinc-400 dark:text-zinc-500"
                      >
                        Active
                      </span>
                    )}

                    {/* Action buttons — hidden when renaming */}
                    {renamingId !== view.id && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        {/* Rename */}
                        <Button
                          data-testid={`manage-view-${view.id}-rename`}
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setRenamingId(view.id)}
                          title="Rename"
                        >
                          <Edit2 className="size-3" />
                          <span className="sr-only">Rename</span>
                        </Button>

                        {/* Duplicate */}
                        <Button
                          data-testid={`manage-view-${view.id}-duplicate`}
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleDuplicate(view.id)}
                          title="Duplicate"
                        >
                          <Copy className="size-3" />
                          <span className="sr-only">Duplicate</span>
                        </Button>

                        {/* Set as Default */}
                        {!isViewDefault(view) && (
                          <Button
                            data-testid={`manage-view-${view.id}-set-default`}
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleSetDefault(view.id)}
                            title="Set as default"
                          >
                            <Star className="size-3" />
                            <span className="sr-only">Set as default</span>
                          </Button>
                        )}

                        {/* Delete */}
                        <Button
                          data-testid={`manage-view-${view.id}-delete`}
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setConfirmingDeleteId(view.id)}
                          className="text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                          title="Delete"
                        >
                          <Trash2 className="size-3" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    )}

                    {/* Delete confirmation inline */}
                    {confirmingDeleteId === view.id && (
                      <div className="w-full">
                        <ConfirmPrompt
                          message={`Delete "${view.name}"?`}
                          onConfirm={() => handleDeleteConfirm(view.id)}
                          onCancel={() => setConfirmingDeleteId(null)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter showCloseButton>
          <span className="sr-only">Close dialog</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
