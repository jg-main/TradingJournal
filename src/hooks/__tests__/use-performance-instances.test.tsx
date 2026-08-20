import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePerformanceInstances } from '../use-performance-instances';

const STORAGE_KEY = 'performance:kpi-instances:v1';

afterEach(() => cleanup());

/**
 * Hook-level contract tests for the widget instance store (S02 T03).
 * The kpi-row component tests cover the UI surface; these pin the
 * instance-management contract: add/remove/duplicate/updateConfig/
 * updateLayout/reorder/reset/replace and localStorage persistence.
 */
describe('usePerformanceInstances', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('initializes with the curated default KPI instances', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    expect(result.current.instances).toHaveLength(6);
    expect(result.current.instances.map((i) => i.widgetType)).toEqual([
      'net-pnl',
      'gross-pnl',
      'total-trades',
      'win-rate',
      'profit-factor',
      'average-r',
    ]);
    // Default instances carry their instance id as the layout key.
    for (const inst of result.current.instances) {
      expect(inst.layout.i).toBe(inst.instanceId);
    }
  });

  it('adds an instance with a unique id and its config', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    act(() => result.current.addInstance('median-r', { metricId: 'median-r' }));
    expect(result.current.instances).toHaveLength(7);
    const added = result.current.instances[6];
    expect(added.widgetType).toBe('median-r');
    expect(added.config.metricId).toBe('median-r');
    expect(added.instanceId).not.toBe(result.current.instances[0].instanceId);
  });

  it('duplicates an instance as an independent copy with separate config', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    const sourceId = result.current.instances[0].instanceId;
    act(() => result.current.updateInstanceConfig(sourceId, { titleOverride: 'A' }));
    act(() => result.current.duplicateInstance(sourceId));
    expect(result.current.instances).toHaveLength(7);
    const copy = result.current.instances[6];
    expect(copy.instanceId).not.toBe(sourceId);
    expect(copy.widgetType).toBe('net-pnl');
    expect(copy.config.titleOverride).toBe('A');
    // Mutating the original's config must not leak into the copy.
    act(() => result.current.updateInstanceConfig(sourceId, { titleOverride: 'B' }));
    expect(result.current.instances[0].config.titleOverride).toBe('B');
    expect(result.current.instances[6].config.titleOverride).toBe('A');
  });

  it('removes only the targeted instance', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    const id = result.current.instances[1].instanceId;
    act(() => result.current.removeInstance(id));
    expect(result.current.instances).toHaveLength(5);
    expect(result.current.instances.some((i) => i.instanceId === id)).toBe(false);
  });

  it('updates config for only the target instance', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    const id = result.current.instances[1].instanceId;
    act(() => result.current.updateInstanceConfig(id, { metricId: 'median-r' }));
    expect(result.current.instances[1].config.metricId).toBe('median-r');
    expect(result.current.instances[0].config).toEqual({});
  });

  it('updateInstanceLayout rebinds the layout key to the instance id', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    const id = result.current.instances[0].instanceId;
    act(() =>
      result.current.updateInstanceLayout(id, { x: 4, y: 2, w: 2, h: 1, i: 'stale' }),
    );
    expect(result.current.instances[0].layout).toMatchObject({ x: 4, y: 2, w: 2, h: 1 });
    expect(result.current.instances[0].layout.i).toBe(id);
  });

  it('reorders within bounds and ignores out-of-bounds moves', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    act(() => result.current.reorderInstance(0, 2));
    expect(result.current.instances.map((i) => i.widgetType)).toEqual([
      'gross-pnl',
      'total-trades',
      'net-pnl',
      'win-rate',
      'profit-factor',
      'average-r',
    ]);
    const snapshot = result.current.instances;
    act(() => result.current.reorderInstance(-1, 0));
    expect(result.current.instances).toBe(snapshot);
    act(() => result.current.reorderInstance(0, 99));
    expect(result.current.instances).toBe(snapshot);
  });

  it('resets to the curated defaults after mutation', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    act(() => result.current.removeInstance(result.current.instances[0].instanceId));
    act(() => result.current.addInstance('median-r', { metricId: 'median-r' }));
    act(() => result.current.resetToDefault());
    expect(result.current.instances).toHaveLength(6);
    expect(result.current.instances[0].widgetType).toBe('net-pnl');
  });

  it('replaceInstances swaps the set and falls back to defaults on empty input', () => {
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    act(() => result.current.replaceInstances([]));
    expect(result.current.instances).toHaveLength(6);
    const id = result.current.instances[0].instanceId;
    act(() => result.current.replaceInstances([result.current.instances[0]]));
    expect(result.current.instances).toHaveLength(1);
    expect(result.current.instances[0].instanceId).toBe(id);
  });

  it('persists changes to localStorage and restores them on remount', () => {
    const first = renderHook(() => usePerformanceInstances('kpi'));
    act(() => first.result.current.addInstance('max-drawdown', { metricId: 'max-drawdown' }));
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as Array<{
      widgetType: string;
      config: Record<string, unknown>;
    }>;
    expect(saved).toHaveLength(7);
    expect(saved[6].widgetType).toBe('max-drawdown');
    first.unmount();

    // Simulated reload: a fresh hook reads the persisted instances back.
    const second = renderHook(() => usePerformanceInstances('kpi'));
    expect(second.result.current.instances).toHaveLength(7);
    expect(second.result.current.instances[6].widgetType).toBe('max-drawdown');
    expect(second.result.current.instances[6].config.metricId).toBe('max-drawdown');
  });

  it('falls back to defaults on corrupt localStorage data', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-valid-json');
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    expect(result.current.instances).toHaveLength(6);
    expect(result.current.instances[0].widgetType).toBe('net-pnl');
  });

  it('falls back to defaults when localStorage holds an empty array', () => {
    window.localStorage.setItem(STORAGE_KEY, '[]');
    const { result } = renderHook(() => usePerformanceInstances('kpi'));
    expect(result.current.instances).toHaveLength(6);
  });
});
