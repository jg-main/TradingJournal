"use client";

import React, { useCallback } from "react";
import { GridLayout, useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export interface DashboardLayoutProps {
  /** The current layout configuration */
  layout: readonly LayoutItem[];
  /** Called when the layout changes (drag/resize) */
  onLayoutChange: (layout: Layout) => void;
  /** Widget elements to render inside the grid */
  children: React.ReactNode;
  /** Column count (default: 12) */
  cols?: number;
  /** Row height in pixels (default: 44) */
  rowHeight?: number;
  /** Horizontal and vertical margin in pixels (default: [8, 8]) */
  margin?: readonly [number, number];
  /**
   * When true, drag-to-reorder and resize are enabled.
   * When false (default), the grid is locked and non-interactive.
   */
  isCustomizing?: boolean;
  /**
   * Called when a widget resize finishes (user releases the resize handle).
   * Provides the updated layout so the parent can trigger final chart resize
   * synchronization, correcting any debounce delay from ResizeObserver.
   */
  onResizeStop?: (layout: Layout) => void;
}

/**
 * Full-width widget dashboard layout powered by react-grid-layout.
 * Wraps children in a GridLayout with drag-to-reorder and resize handles.
 * The drag handle is identified by the `.dashboard-widget-drag-handle` class.
 * Drag and resize are only enabled when `isCustomizing` is true.
 */
export function DashboardLayout({
  layout,
  onLayoutChange,
  onResizeStop,
  cols = 12,
  rowHeight = 44,
  margin = [8, 8] as const,
  children,
  isCustomizing = false,
}: DashboardLayoutProps) {
  const { width, containerRef, mounted } = useContainerWidth();

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      onLayoutChange(newLayout);
    },
    [onLayoutChange],
  );

  const handleResizeStop = useCallback(
    (_layout: Layout) => {
      // Pass only the layout to the consumer — strips the extra EventCallback args
      onResizeStop?.(_layout);
    },
    [onResizeStop],
  );

  return (
    <div ref={containerRef} className="dashboard-grid-container w-full">
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          onResizeStop={handleResizeStop}
          gridConfig={{ cols, rowHeight, margin }}
          dragConfig={{ enabled: isCustomizing, handle: ".dashboard-widget-drag-handle", bounded: true, cancel: ".dashboard-widget-interactive" }}
          resizeConfig={{ enabled: isCustomizing, handles: ["se"] }}
          autoSize
          className="dashboard-grid"
        >
          {children}
        </GridLayout>
      )}
    </div>
  );
}
