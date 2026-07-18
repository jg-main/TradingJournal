'use client';

import React from 'react';
import { GripVertical, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomizing } from '@/lib/customizing-context';

// ── Types ──────────────────────────────────────────────────────────────

export interface DashboardWidgetProps {
  /** Widget title shown in the card header next to the drag handle */
  title: string;
  /** Whether the widget is loading data (shows skeleton state) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Message shown in empty state (default: 'No data available') */
  emptyMessage?: string;
  /** Content rendered when not loading/error/empty */
  children: React.ReactNode;
  /** Additional classes for the card wrapper */
  className?: string;
  /** Data attribute for test targeting */
  testId?: string;
  /**
   * When true, the drag handle is rendered so react-grid-layout can target it.
   * When false (default), the drag handle is hidden and reordering is disabled.
   */
  isCustomizing?: boolean;
}

// ── Drag Handle ────────────────────────────────────────────────────────

function DragHandle() {
  return (
    <div
      className="dashboard-widget-drag-handle flex cursor-grab items-center px-1 text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
      aria-label="Drag to reorder"
      role="button"
      tabIndex={0}
    >
      <GripVertical className="size-4" />
    </div>
  );
}

// ── Loading Skeleton ───────────────────────────────────────────────────

function WidgetSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-1" aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Reusable dashboard widget wrapper with loading, error, empty, and content states.
 *
 * - `isLoading`: Shows skeleton placeholders while data loads.
 * - `error`: Displays an error banner with the error message.
 * - `isEmpty`: Displays an empty state message.
 * - Default (children): Renders the widget content.
 *
 * The drag handle (`.dashboard-widget-drag-handle`) is only rendered when
 * `isCustomizing` is true, so react-grid-layout can target it during
 * customization mode.  When not customizing, the drag handle is hidden and
 * reordering is disabled.
 *
 * @example
 * ```tsx
 * <DashboardWidget title="Net P&L" isLoading={loading}>
 *   <span className="text-2xl font-bold">$2,500</span>
 * </DashboardWidget>
 * ```
 */
export function DashboardWidget({
  title,
  isLoading = false,
  error = null,
  isEmpty = false,
  emptyMessage = 'No data available',
  children,
  className,
  testId,
  isCustomizing: isCustomizingProp,
}: DashboardWidgetProps) {
  /**
   * Fall back to the CustomizingContext value when the prop is not explicitly passed.
   * Widget components that render DashboardWidget directly do not need to forward
   * isCustomizing — the context (set by page.tsx around the grid) handles it.
   */
  const contextCustomizing = useCustomizing();
  const isCustomizing = isCustomizingProp ?? contextCustomizing;
  return (
    <Card
      className={cn('h-full overflow-hidden', className)}
      data-testid={testId}
      size="sm"
    >
      <CardHeader className="flex flex-row items-center gap-0 border-b pb-0">
        {isCustomizing && <DragHandle />}
        <CardTitle className="flex-1 truncate text-sm font-medium">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pt-2">
        {error ? (
          <WidgetError message={error} />
        ) : isLoading ? (
          <WidgetSkeleton />
        ) : isEmpty ? (
          <WidgetEmpty message={emptyMessage} />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function WidgetError({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 text-destructive"
      role="alert"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function WidgetEmpty({ message }: { message: string }) {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}
