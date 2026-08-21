'use client';

import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface WidgetActionsMenuProps {
  /** Display title of the widget; used to label the trigger accessibly. */
  widgetTitle: string;
  onConfigure?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  onReset?: () => void;
  /** Accessibility reorder path: undefined renders the item disabled at the
   *  rail boundary (first card has no Move left; last has no Move right). */
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}

/**
 * Consistent ⋯ actions menu shared by every Performance widget (R005).
 *
 * Replaces the scattered edit-mode controls (⚙/+/×/Series) with one menu
 * offering Configure, Duplicate, Remove, and Reset — where Reset restores the
 * widget's registry-default config/layout. Only rendered in Customize mode by
 * the owning widget chrome (KPI card header / chart drag-handle bar); normal
 * mode stays clean.
 *
 * The trigger stops mousedown/click/keydown propagation so opening it never
 * starts a grid drag or bubbles to a parent row/bar handler, while Radix still
 * opens the menu via pointerdown (same pattern as the trades ActionsCell).
 * Items are conditionally rendered so a widget only offers meaningful actions.
 */
export function WidgetActionsMenu({
  widgetTitle,
  onConfigure,
  onDuplicate,
  onRemove,
  onReset,
  onMoveLeft,
  onMoveRight,
}: WidgetActionsMenuProps) {
  if (!onConfigure && !onDuplicate && !onRemove && !onReset && !onMoveLeft && !onMoveRight) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${widgetTitle}`}
          title={`Widget actions for ${widgetTitle}`}
          className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Accessibility reorder path (keyboard-operable via the menu);
            disabled at the rail boundaries (first/last position). */}
        <DropdownMenuItem onSelect={onMoveLeft} disabled={!onMoveLeft}>
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMoveRight} disabled={!onMoveRight}>
          Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {onConfigure && (
          <DropdownMenuItem onSelect={onConfigure}>Configure</DropdownMenuItem>
        )}
        {onDuplicate && (
          <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
        )}
        {onRemove && (
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            Remove
          </DropdownMenuItem>
        )}
        {onReset && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReset}>Reset</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
