'use client';

import React, { useState } from 'react';
import { KpiCard } from './kpi-card';
import { usePerformanceInstanceContext } from './performance-instance-context';
import { PERFORMANCE_WIDGET_REGISTRY } from '@/lib/performance-widget-registry';
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
    resetToDefault,
  } = usePerformanceInstanceContext().kpi;

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  const handleConfigure = (instanceId: string, _config: WidgetConfig) => {
    setConfiguringId(instanceId);
  };

  const handleMetricSelect = (instanceId: string, metricId: string) => {
    updateInstanceConfig(instanceId, { metricId });
    setConfiguringId(null);
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
      {/* Responsive KPI columns: 2 → 4 (≥768px) → 6 (≥1280px). At 1024px six
          columns would squeeze each card to ~152px; four columns keep the
          label, value, and micro-viz scannable. 1280/1440 show all six
          default cards on one row. */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
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

      {/* Configure metric dialog */}
      {configuringId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay" onClick={() => setConfiguringId(null)}>
          <div className="bg-card border border-border rounded-lg p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium mb-3">Select Metric</h3>
            <div className="space-y-1 max-h-64 overflow-auto">
              {Object.values(PERFORMANCE_WIDGET_REGISTRY)
                .filter((w) => w.category === 'kpi')
                .map((w) => (
                  <button
                    key={w.id}
                    onClick={() => handleMetricSelect(configuringId, w.id)}
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
