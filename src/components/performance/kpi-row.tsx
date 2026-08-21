'use client';

import React, { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { KpiCard, type KpiDragHandleProps } from './kpi-card';
import { ConfigureDialog } from './configure-dialog';
import { usePerformanceInstanceContext } from './performance-instance-context';
import { PERFORMANCE_WIDGET_REGISTRY } from '@/lib/performance-widget-registry';
import { PERFORMANCE_KPI_CATALOGUE } from '@/lib/performance-kpi-catalogue';
import type { WidgetInstance, WidgetConfig } from '@/lib/performance-view-types';
import { cn } from '@/lib/utils';

export interface KpiRowProps {
  editMode?: boolean;
}

/**
 * Configurable KPI row. Each card is a WidgetInstance:
 * select metric, duplicate, remove, reorder — all via the instance store.
 *
 * Reorder (Corrective Task 6): in Customize mode KPI cards are directly
 * draggable via an explicit grip handle (dnd-kit sortable, horizontal
 * strategy — the same library the repo's dynamic-table uses). Dragging
 * identifies items by WidgetInstance ID and writes back through the existing
 * `reorderInstance` store call, so persistence, saved-dashboard isolation,
 * and duplicate-instance independence come from the existing instance model.
 * The grip is the ONLY drag activator: ⋯ / Configure / Duplicate / Remove /
 * Reset remain plain clicks (pointer sensor activates only after 8px of
 * movement, and the handle stops the ⋯ menu from being a drag source).
 *
 * Accessibility: Move left / Move right actions remain available in the ⋯
 * actions menu as a fully keyboard-operable non-pointer reorder path, with
 * correct disabled states at the first/last positions.
 */
export function KpiRow({ editMode }: KpiRowProps) {
  const {
    instances,
    addInstance,
    removeInstance,
    duplicateInstance,
    updateInstanceConfig,
    reorderInstance,
    resetInstance,
    resetToDefault,
  } = usePerformanceInstanceContext().kpi;

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  // Direct drag only in Customize mode: the sensor is disabled in normal mode
  // so cards can never be accidentally dragged.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 }, enabled: Boolean(editMode) }),
  );

  const configuringInstance = configuringId
    ? instances.find((i) => i.instanceId === configuringId)
    : undefined;

  // The dialog title follows the card's effective metric (metricId → catalogue).
  const configuringTitle = (() => {
    if (!configuringInstance) return '';
    const inst = configuringInstance;
    const metricId = (inst.config.metricId as string | undefined) ?? inst.widgetType;
    return (
      PERFORMANCE_KPI_CATALOGUE[metricId]?.title ??
      PERFORMANCE_WIDGET_REGISTRY[inst.widgetType]?.title ??
      metricId
    );
  })();

  const handleConfigure = (instanceId: string) => {
    setConfiguringId(instanceId);
  };

  const handleConfigureSave = (next: WidgetConfig) => {
    if (!configuringId) return;
    updateInstanceConfig(configuringId, next);
    setConfiguringId(null);
  };

  // Per-widget Reset: restore the widget's registry default config/layout.
  const handleReset = (instanceId: string) => {
    resetInstance(instanceId);
  };

  const handleMoveUp = (instanceId: string) => {
    const index = instances.findIndex((i) => i.instanceId === instanceId);
    if (index > 0) reorderInstance(index, index - 1);
  };

  const handleMoveDown = (instanceId: string) => {
    const index = instances.findIndex((i) => i.instanceId === instanceId);
    if (index >= 0 && index < instances.length - 1) reorderInstance(index, index + 1);
  };

  // Direct drag: derive the from/to indices from the CURRENT instance array
  // by WidgetInstance ID (never by widget type — duplicates are independent).
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = instances.findIndex((i) => i.instanceId === active.id);
    const toIndex = instances.findIndex((i) => i.instanceId === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    reorderInstance(fromIndex, toIndex);
  };

  // The KPI card reads config.metricId or defaults to widgetType as the metric.
  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        {/* Responsive KPI columns: 2 → 3 (≥768px) → 5 (≥1280px). At 1440px the
            curated five default cards sit on one row with no wrap. Below xl,
            the five cards wrap across rows of 3 then 2. */}
        <SortableContext items={instances.map((i) => i.instanceId)} strategy={horizontalListSortingStrategy}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            {instances.map((instance, index) => (
              <SortableKpi
                key={instance.instanceId}
                instance={instance}
                index={index}
                total={instances.length}
                editMode={editMode}
                onConfigure={handleConfigure}
                onDuplicate={duplicateInstance}
                onRemove={removeInstance}
                onReset={handleReset}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editMode && (
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => setShowAddDialog(true)}
            className="text-sm rounded-md border border-border px-3 py-1 hover:bg-muted"
          >
            + Add KPI
          </button>
          <button
            onClick={resetToDefault}
            className="text-sm rounded-md border border-border px-3 py-1 hover:bg-muted"
          >
            Reset
          </button>
        </div>
      )}

      {/* Add KPI dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay" onClick={() => setShowAddDialog(false)}>
          <div className="bg-card border border-border rounded-lg p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium mb-3">Add KPI Card</h3>
            <div className="space-y-1 max-h-64 overflow-auto">
              {Object.values(PERFORMANCE_WIDGET_REGISTRY)
                .filter((w) => w.category === 'kpi')
                .map((w) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      addInstance(w.id, { metricId: w.id });
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

      {/* Configure dialog — shared typed settings surface for KPI cards.
          KPI instances are metric cards: the dialog exposes metric selection
          from the KPI catalogue, title override, and a per-widget unit
          override where the metric supports convertible units. */}
      <ConfigureDialog
        open={configuringId !== null}
        onOpenChange={(open) => {
          if (!open) setConfiguringId(null);
        }}
        widgetTitle={configuringTitle}
        widgetType={configuringInstance?.widgetType ?? ''}
        config={configuringInstance?.config ?? {}}
        onSave={handleConfigureSave}
      />
    </div>
  );
}

// ── Sortable KPI wrapper ────────────────────────────────────────────────────

interface SortableKpiProps {
  instance: WidgetInstance;
  index: number;
  total: number;
  editMode?: boolean;
  onConfigure: (instanceId: string) => void;
  onDuplicate: (instanceId: string) => void;
  onRemove: (instanceId: string) => void;
  onReset: (instanceId: string) => void;
  onMoveUp: (instanceId: string) => void;
  onMoveDown: (instanceId: string) => void;
}

/**
 * One KPI card as a dnd-kit sortable item, identified by its WidgetInstance ID.
 * The card body keeps its approved geometry; only a small grip handle in the
 * header becomes the drag activator (edit mode). While dragging the moving
 * card stays identifiable (elevated + subtle ring), and the horizontal
 * strategy previews the target position without layout collapse.
 */
function SortableKpi({
  instance,
  index,
  total,
  editMode,
  onConfigure,
  onDuplicate,
  onRemove,
  onReset,
  onMoveUp,
  onMoveDown,
}: SortableKpiProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: instance.instanceId,
    disabled: !editMode,
  });

  const dragHandleProps: KpiDragHandleProps = {
    'aria-label': `Drag ${instance.config.metricId || instance.widgetType}`,
    ...attributes,
    ...listeners,
  };

  return (
    <div
      ref={setNodeRef}
      data-kpi-sortable={instance.instanceId}
      className={cn('relative', isDragging && 'z-30')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <KpiCard
        instanceId={instance.instanceId}
        widgetType={instance.config.metricId || instance.widgetType}
        config={instance.config}
        editMode={editMode}
        isDragging={isDragging}
        dragHandleProps={editMode ? dragHandleProps : undefined}
        onConfigure={onConfigure}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        onReset={onReset}
        onMoveLeft={index > 0 ? () => onMoveUp(instance.instanceId) : undefined}
        onMoveRight={index < total - 1 ? () => onMoveDown(instance.instanceId) : undefined}
      />
    </div>
  );
}
