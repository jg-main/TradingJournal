'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WidgetInstance, WidgetConfig } from '@/lib/performance-view-types';
import { getDefaultWidgetInstances } from '@/lib/performance-widget-registry';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PerformanceInstanceStore {
  instances: WidgetInstance[];
  addInstance: (widgetType: string, config?: WidgetConfig) => void;
  removeInstance: (instanceId: string) => void;
  duplicateInstance: (instanceId: string) => void;
  updateInstanceConfig: (instanceId: string, config: WidgetConfig) => void;
  updateInstanceLayout: (instanceId: string, layout: WidgetInstance['layout']) => void;
  reorderInstance: (fromIndex: number, toIndex: number) => void;
  resetToDefault: () => void;
  replaceInstances: (instances: WidgetInstance[]) => void;
}

/**
 * Single owner of widget instance state for one category (kpi | chart).
 * Persists to localStorage (server-backed persistence arrives in S04).
 */
export function usePerformanceInstances(category: 'kpi' | 'chart'): PerformanceInstanceStore {
  const storageKey = `performance:${category}-instances:v1`;
  const [instances, setInstances] = useState<WidgetInstance[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as WidgetInstance[];
      }
    } catch {
      // Corrupt data → fall through to defaults
    }
    return toInstances(getDefaultWidgetInstances(category));
  });

  // Persist on change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(instances));
    } catch {
      // Storage failure — non-fatal for session
    }
  }, [instances, storageKey]);

  const addInstance = useCallback((widgetType: string, config: WidgetConfig = {}) => {
    setInstances((prev) => [
      ...prev,
      {
        instanceId: generateInstanceId(widgetType),
        widgetType,
        config,
        layout: { i: '', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
      },
    ]);
  }, []);

  const removeInstance = useCallback((instanceId: string) => {
    setInstances((prev) => prev.filter((i) => i.instanceId !== instanceId));
  }, []);

  const duplicateInstance = useCallback((instanceId: string) => {
    setInstances((prev) => {
      const source = prev.find((i) => i.instanceId === instanceId);
      if (!source) return prev;
      const copy: WidgetInstance = {
        ...source,
        instanceId: generateInstanceId(source.widgetType),
        config: { ...source.config }, // Deep-enough copy for flat configs
        layout: { ...source.layout, i: '' },
      };
      return [...prev, copy];
    });
  }, []);

  const updateInstanceConfig = useCallback((instanceId: string, config: WidgetConfig) => {
    setInstances((prev) =>
      prev.map((i) => (i.instanceId === instanceId ? { ...i, config: { ...config } } : i)),
    );
  }, []);

  const updateInstanceLayout = useCallback((instanceId: string, layout: WidgetInstance['layout']) => {
    setInstances((prev) =>
      prev.map((i) => (i.instanceId === instanceId ? { ...i, layout: { ...layout, i: i.instanceId } } : i)),
    );
  }, []);

  const reorderInstance = useCallback((fromIndex: number, toIndex: number) => {
    setInstances((prev) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setInstances(toInstances(getDefaultWidgetInstances(category)));
  }, [category]);

  const replaceInstances = useCallback((next: WidgetInstance[]) => {
    setInstances(next.length > 0 ? next : toInstances(getDefaultWidgetInstances(category)));
  }, [category]);

  return {
    instances,
    addInstance,
    removeInstance,
    duplicateInstance,
    updateInstanceConfig,
    updateInstanceLayout,
    reorderInstance,
    resetToDefault,
    replaceInstances,
  };
}

// ── Helper ──────────────────────────────────────────────────────────────────

function toInstances(defaults: Array<{
  instanceId: string;
  widgetType: string;
  category: 'kpi' | 'chart' | 'analytical';
  config: Record<string, unknown>;
  layout: { x: number; y: number; w: number; h: number };
}>): WidgetInstance[] {
  return defaults.map((d) => ({
    instanceId: d.instanceId,
    widgetType: d.widgetType,
    config: d.config as WidgetConfig,
    layout: { ...d.layout, i: d.instanceId, minW: 2, minH: 2 },
  }));
}

// ── Helper: generate unique instance ID ─────────────────────────────────────

function generateInstanceId(widgetType: string): string {
  return `${widgetType}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
