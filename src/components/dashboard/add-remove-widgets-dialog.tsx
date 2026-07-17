'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  WIDGET_REGISTRY,
  type WidgetCategory,
  type WidgetId,
} from './widget-registry';

// ── Types ──────────────────────────────────────────────────────────────

export interface AddRemoveWidgetsDialogProps {
  /**
   * Whether the sheet is open.
   */
  open: boolean;
  /**
   * Called when the sheet open state changes.
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Array of widget IDs currently hidden.
   */
  hiddenWidgetIds: string[];
  /**
   * Called when a widget's visibility is toggled.
   */
  onToggleWidget: (widgetId: WidgetId) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Ordered categories for display. */
const CATEGORIES: WidgetCategory[] = ['metrics', 'charts', 'valuation'];

/** Human-readable category labels. */
const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  metrics: 'Metrics',
  charts: 'Charts',
  valuation: 'Valuation',
};

// ── Toggle Pill ─────────────────────────────────────────────────────────

/**
 * A simple pill-shaped toggle that switches between visible (primary) and
 * hidden (muted) states.  Uses a CSS transition for the sliding dot.
 */
function TogglePill({
  visible,
  onChange,
  id,
}: {
  visible: boolean;
  onChange: () => void;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={visible}
      aria-label={`Toggle widget visibility`}
      data-testid={`toggle-${id}`}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        visible
          ? 'bg-primary'
          : 'bg-input',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block size-3.5 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200',
          visible ? 'translate-x-[calc(100%+2px)]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Add/Remove Widgets Dialog — a Sheet that lists all registered dashboard
 * widgets grouped by category with toggle switches to control visibility.
 *
 * Consumers control open/close via the `open` and `onOpenChange` props.
 * Visibility state comes from `hiddenWidgetIds` and `onToggleWidget` so the
 * parent owns the state (typically from `useCustomizationMode`).
 *
 * @example
 * ```tsx
 * <AddRemoveWidgetsDialog
 *   open={isCustomizing}
 *   onOpenChange={setSheetOpen}
 *   hiddenWidgetIds={hiddenWidgetIds}
 *   onToggleWidget={toggleWidgetVisibility}
 * />
 * ```
 */
export function AddRemoveWidgetsDialog({
  open,
  onOpenChange,
  hiddenWidgetIds,
  onToggleWidget,
}: AddRemoveWidgetsDialogProps) {
  const entries = Object.values(WIDGET_REGISTRY);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Widgets</SheetTitle>
          <SheetDescription>
            Show or hide dashboard widgets. Changes apply when you save.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-0 overflow-y-auto px-4 pb-6">
          {CATEGORIES.map((category) => {
            const categoryWidgets = entries.filter(
              (w) => w.category === category,
            );
            if (categoryWidgets.length === 0) return null;

            return (
              <div key={category}>
                <Separator className="my-3" />
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[category]}
                </h3>

                {categoryWidgets.map((widget) => {
                  const isVisible = !hiddenWidgetIds.includes(widget.id);
                  return (
                    <label
                      key={widget.id}
                      data-testid={`widget-row-${widget.id}`}
                      className={cn(
                        'flex cursor-pointer items-center justify-between rounded-md px-2 py-2.5',
                        'transition-colors hover:bg-muted/50',
                      )}
                    >
                      <span className="text-sm font-medium">
                        {widget.title}
                      </span>
                      <TogglePill
                        id={widget.id}
                        visible={isVisible}
                        onChange={() => onToggleWidget(widget.id)}
                      />
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
