'use client';

import React, { useCallback, useState } from 'react';
import GridLayout, { useContainerWidth, type Layout, type LayoutItem, type ResizeHandleAxis } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { GripVertical } from 'lucide-react';
import { usePerformanceInstanceContext } from './performance-instance-context';
import { ChartWidget } from './chart-widget';
import { ConfigureDialog } from './configure-dialog';
import { WidgetActionsMenu } from './widget-actions-menu';
import { PERFORMANCE_WIDGET_REGISTRY } from '@/lib/performance-widget-registry';

export interface ChartGridProps {
  editMode?: boolean;
}

/**
 * Edit-mode wrapper chrome: dashed accent frame + subtle tint so Customize
 * mode is unmistakable. Applied per-widget only while editMode is on; normal
 * mode renders a bare wrapper with no editing chrome.
 */
const EDIT_FRAME_CLASS =
  'chart-edit-frame relative flex h-full flex-col rounded-lg border border-dashed border-primary/50 bg-primary/[0.04]';

/**
 * Visible SE resize grip (RGL v2 resizeConfig.handleComponent).
 * RGL v2 passes the handle axis plus a ref that must be attached to the
 * returned element for drag-to-resize to work. The grip is intentionally a
 * plain span styled with Tailwind utilities (no react-resizable-handle class)
 * so it stays visible in edit mode and never relies on the vendor hover rule.
 * It is only supplied to react-grid-layout while editMode is on.
 */
function ResizeGrip(axis: ResizeHandleAxis, ref: React.Ref<HTMLElement>) {
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label="Resize widget"
      title={`Drag to resize (${axis} corner)`}
      className="absolute bottom-1 right-1 z-20 grid h-4 w-4 cursor-se-resize place-items-center text-muted-foreground"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M9 1v8H1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
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
    resetInstance,
    resetToDefault,
  } = usePerformanceInstanceContext().chart;

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  const configuringInstance = configuringId
    ? instances.find((i) => i.instanceId === configuringId)
    : undefined;
  const configuringTitle = (() => {
    if (!configuringInstance) return '';
    const inst = configuringInstance;
    const definition = PERFORMANCE_WIDGET_REGISTRY[inst.widgetType];
    return (
      (typeof inst.config.titleOverride === 'string' && inst.config.titleOverride.trim()
        ? inst.config.titleOverride.trim()
        : null) ??
      definition?.title ??
      inst.widgetType
    );
  })();

  // Per-item constraints come from the registry definition (authoritative for
  // widget readability — R004) with the instance layout as fallback. This
  // prevents resizing a chart below its readable minimum (minSize) or back to
  // full-width stacking (maxSize.w) even when persisted layouts lack bounds.
  const layout: Layout = instances.map((inst) => {
    const def = PERFORMANCE_WIDGET_REGISTRY[inst.widgetType];
    return {
      i: inst.instanceId,
      x: inst.layout.x,
      y: inst.layout.y,
      w: inst.layout.w,
      h: inst.layout.h,
      minW: def?.minSize.w ?? inst.layout.minW ?? 4,
      minH: def?.minSize.h ?? inst.layout.minH ?? 4,
      maxW: def?.maxSize.w ?? inst.layout.maxW,
      maxH: def?.maxSize.h ?? inst.layout.maxH,
    };
  });

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
          dragConfig={{ enabled: Boolean(editMode), handle: '.drag-handle' }}
          resizeConfig={{
            enabled: Boolean(editMode),
            handles: editMode ? ['se'] : [],
            handleComponent: editMode ? ResizeGrip : undefined,
          }}
          autoSize
          onLayoutChange={handleCommit}
          onDragStop={handleCommit}
          onResizeStop={handleCommit}
        >
          {instances.map((instance) => {
            const definition = PERFORMANCE_WIDGET_REGISTRY[instance.widgetType];
            const widgetTitle = definition?.title ?? instance.widgetType;
            return (
              <div key={instance.instanceId} className={editMode ? EDIT_FRAME_CLASS : 'relative h-full'}>
                {editMode && (
                  <div
                    className="drag-handle flex shrink-0 cursor-move select-none items-center gap-1.5 rounded-t-[calc(0.5rem-1px)] border-b border-dashed border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                    role="button"
                    tabIndex={0}
                    aria-label={`Drag ${widgetTitle} to move`}
                    title="Drag to move"
                  >
                    <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Drag to move</span>
                    <span className="ml-auto">
                      <WidgetActionsMenu
                        widgetTitle={widgetTitle}
                        // Configure opens the typed widget settings dialog
                        // (shared ConfigureDialog driven by the registry
                        // configSchema).
                        onConfigure={() => setConfiguringId(instance.instanceId)}
                        onDuplicate={() => duplicateInstance(instance.instanceId)}
                        onRemove={() => removeInstance(instance.instanceId)}
                        onReset={() => resetInstance(instance.instanceId)}
                      />
                    </span>
                  </div>
                )}
                <div className={editMode ? 'min-h-0 flex-1' : 'h-full'}>
                  <ChartWidget
                    widgetType={instance.widgetType}
                    config={instance.config}
                  />
                </div>
              </div>
            );
          })}
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

      {/* Configure dialog — shared typed settings surface for chart widgets:
          visible series, primary series (performance-by-setup), legend
          visibility, and title override, all driven by the registry
          configSchema. Changes persist via updateInstanceConfig. */}
      <ConfigureDialog
        open={configuringId !== null}
        onOpenChange={(open) => {
          if (!open) setConfiguringId(null);
        }}
        widgetTitle={configuringTitle}
        widgetType={configuringInstance?.widgetType ?? ''}
        config={configuringInstance?.config ?? {}}
        onSave={(next) => {
          if (!configuringId) return;
          updateInstanceConfig(configuringId, next);
          setConfiguringId(null);
        }}
      />
    </div>
  );
}
