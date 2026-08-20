'use client';

import React, { useCallback, useState } from 'react';
import GridLayout, { useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { usePerformanceInstanceContext } from './performance-instance-context';
import { ChartWidget } from './chart-widget';
import { PERFORMANCE_WIDGET_REGISTRY } from '@/lib/performance-widget-registry';
import type { WidgetConfig } from '@/lib/performance-view-types';

export interface ChartGridProps {
  editMode?: boolean;
}

/**
 * RGL v2 arrangement of chart widget instances.
 * In edit mode, drag/resize handles are enabled and add/remove controls appear.
 * In normal mode the grid is read-only (no editing chrome).
 */
export function ChartGrid({ editMode }: ChartGridProps) {
  const { width, containerRef, mounted } = useContainerWidth();
  const {
    instances,
    addInstance,
    removeInstance,
    duplicateInstance,
    updateInstanceConfig,
    updateInstanceLayout,
    resetToDefault,
  } = usePerformanceInstanceContext().chart;

  const [showAddDialog, setShowAddDialog] = useState(false);

  const layout: Layout = instances.map((inst) => ({
    i: inst.instanceId,
    x: inst.layout.x,
    y: inst.layout.y,
    w: inst.layout.w,
    h: inst.layout.h,
    minW: inst.layout.minW ?? 4,
    minH: inst.layout.minH ?? 4,
  }));

  // Commit RGL changes back to the instance store (single source of truth).
  const handleCommit = useCallback(
    (next: Layout) => {
      for (const item of next) {
        updateInstanceLayout(item.i, item as LayoutItem);
      }
    },
    [updateInstanceLayout],
  );

  return (
    <div ref={containerRef}>
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: 12, rowHeight: 40, margin: [10, 10] }}
          dragConfig={{ enabled: editMode, handle: '.drag-handle' }}
          resizeConfig={{ enabled: editMode, handles: ['se'] }}
          autoSize
          onLayoutChange={handleCommit}
          onDragStop={handleCommit}
          onResizeStop={handleCommit}
        >
          {instances.map((instance) => (
            <div key={instance.instanceId} className="relative">
              {editMode && (
                <div className="drag-handle absolute top-0 left-1/2 -translate-x-1/2 z-10 cursor-move text-xs text-muted-foreground px-2 py-0.5 rounded bg-background/80 border border-border">
                  ⠿
                </div>
              )}
              <ChartWidget
                instanceId={instance.instanceId}
                widgetType={instance.widgetType}
                config={instance.config}
                editMode={editMode}
                onConfigChange={(id, cfg) => updateInstanceConfig(id, cfg as WidgetConfig)}
              />
              {editMode && (
                <div className="absolute top-1 right-1 z-10 flex gap-1">
                  <button
                    onClick={() => duplicateInstance(instance.instanceId)}
                    className="text-[10px] px-1 py-0.5 rounded border border-border bg-background hover:bg-muted"
                    aria-label={`Duplicate ${instance.widgetType}`}
                  >
                    +
                  </button>
                  <button
                    onClick={() => removeInstance(instance.instanceId)}
                    className="text-[10px] px-1 py-0.5 rounded border border-border bg-background hover:bg-destructive/10 text-destructive"
                    aria-label={`Remove ${instance.widgetType}`}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </GridLayout>
      )}

      {editMode && (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => setShowAddDialog(true)}
            className="text-sm rounded-md border border-border px-3 py-1 hover:bg-muted"
          >
            + Add Chart
          </button>
          <button
            onClick={resetToDefault}
            className="text-sm rounded-md border border-border px-3 py-1 hover:bg-muted"
          >
            Reset
          </button>
        </div>
      )}

      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay" onClick={() => setShowAddDialog(false)}>
          <div className="bg-card border border-border rounded-lg p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium mb-3">Add Chart Widget</h3>
            <div className="space-y-1 max-h-64 overflow-auto">
              {Object.values(PERFORMANCE_WIDGET_REGISTRY)
                .filter((w) => w.category === 'chart')
                .map((w) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      addInstance(w.id, {});
                      setShowAddDialog(false);
                    }}
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
                  >
                    {w.title}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
