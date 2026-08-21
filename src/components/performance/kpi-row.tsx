'use client';

import React, { useState } from 'react';
import { KpiCard } from './kpi-card';
import { ConfigureDialog } from './configure-dialog';
import { usePerformanceInstanceContext } from './performance-instance-context';
import { PERFORMANCE_WIDGET_REGISTRY } from '@/lib/performance-widget-registry';
import { PERFORMANCE_KPI_CATALOGUE } from '@/lib/performance-kpi-catalogue';
import type { WidgetConfig } from '@/lib/performance-view-types';

export interface KpiRowProps {
  editMode?: boolean;
}

/**
 * Configurable KPI row. Each card is a WidgetInstance:
 * select metric, duplicate, remove, reorder — all via the instance store.
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

  const handleMoveUp = (index: number) => {
    if (index > 0) reorderInstance(index, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (index < instances.length - 1) reorderInstance(index, index + 1);
  };

  // The KPI card reads config.metricId or defaults to widgetType as the metric.
  return (
    <div>
      {/* Responsive KPI columns: 2 → 3 (≥768px) → 5 (≥1280px). At 1440px the
          curated five default cards sit on one row with no wrap. Below xl,
          the five cards wrap across rows of 3 then 2. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {instances.map((instance, index) => (
          <div key={instance.instanceId} className="relative">
            <KpiCard
              instanceId={instance.instanceId}
              widgetType={instance.config.metricId || instance.widgetType}
              config={instance.config}
              editMode={editMode}
              onConfigure={handleConfigure}
              onDuplicate={duplicateInstance}
              onRemove={removeInstance}
              onReset={handleReset}
            />
            {editMode && (
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                <button
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  className="text-[10px] px-1 py-0.5 rounded border border-border bg-background hover:bg-muted disabled:opacity-30"
                  aria-label={`Move ${instance.config.metricId || instance.widgetType} up`}
                >
                  ↑
                </button>
                <button
                  onClick={() => handleMoveDown(index)}
                  disabled={index === instances.length - 1}
                  className="text-[10px] px-1 py-0.5 rounded border border-border bg-background hover:bg-muted disabled:opacity-30"
                  aria-label={`Move ${instance.config.metricId || instance.widgetType} down`}
                >
                  ↓
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

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
