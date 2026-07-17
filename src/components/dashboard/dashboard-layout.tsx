"use client";

import React, { useCallback } from "react";
import { GridLayout, useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";

export interface DashboardLayoutProps {
  /** The current layout configuration */
  layout: readonly LayoutItem[];
  /** Called when the layout changes (drag/resize) */
  onLayoutChange: (layout: Layout) => void;
  /** Widget elements to render inside the grid */
  children: React.ReactNode;
  /** Column count (default: 12) */
  cols?: number;
  /** Row height in pixels (default: 120) */
  rowHeight?: number;
  /** Horizontal and vertical margin in pixels (default: [16, 16]) */
  margin?: readonly [number, number];
  /**
   * When true, drag-to-reorder and resize are enabled.
   * When false (default), the grid is locked and non-interactive.
   */
  isCustomizing?: boolean;
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
  cols = 12,
  rowHeight = 60,
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

  return (
    <div ref={containerRef} className="dashboard-grid-container w-full">
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          gridConfig={{ cols, rowHeight, margin }}
          dragConfig={{ enabled: isCustomizing, handle: ".dashboard-widget-drag-handle" }}
          resizeConfig={{ enabled: isCustomizing }}
          autoSize
          className="dashboard-grid"
        >
          {children}
        </GridLayout>
      )}
    </div>
  );
}
