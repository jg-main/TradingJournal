import { describe, it, expect } from 'vitest';
import {
  isPerformanceDashboardConfigShape,
  validatePerformanceDashboardConfig,
  migratePerformanceDashboardConfig,
  createDefaultFilter,
  createDefaultDashboardConfig,
  cloneDashboardConfig,
  resetDashboardToTemplate,
  createSystemDefaultDashboard,
  PD_SYSTEM_DEFAULT_TEMPLATE,
  PERFORMANCE_SYSTEM_DASHBOARD_IDS,
  PERFORMANCE_DASHBOARD_CONFIG_VERSION,
  type PerformanceDashboardConfig,
} from '../performance-view-types';
import { getValidWidgetTypes, getDefaultWidgetInstances, PERFORMANCE_WIDGET_REGISTRY } from '../performance-widget-registry';

describe('performance-view-types', () => {
  describe('isPerformanceDashboardConfigShape', () => {
    it('returns true for valid config', () => {
      const config: PerformanceDashboardConfig = {
        version: 1,
        name: 'Test Dashboard',
        instances: [
          {
            instanceId: 'inst-1',
            widgetType: 'net-pnl',
            config: {},
            layout: { i: 'inst-1', x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      };
      expect(isPerformanceDashboardConfigShape(config)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isPerformanceDashboardConfigShape(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isPerformanceDashboardConfigShape('string')).toBe(false);
      expect(isPerformanceDashboardConfigShape(123)).toBe(false);
    });

    it('returns false when missing version', () => {
      const config = { name: 'Test', instances: [] };
      expect(isPerformanceDashboardConfigShape(config)).toBe(false);
    });

    it('returns false when missing name', () => {
      const config = { version: 1, instances: [] };
      expect(isPerformanceDashboardConfigShape(config)).toBe(false);
    });

    it('returns false when missing instances', () => {
      const config = { version: 1, name: 'Test' };
      expect(isPerformanceDashboardConfigShape(config)).toBe(false);
    });

    it('returns false when instances is not an array', () => {
      const config = { version: 1, name: 'Test', instances: 'not-array' };
      expect(isPerformanceDashboardConfigShape(config)).toBe(false);
    });

    it('returns false when instance missing instanceId', () => {
      const config = {
        version: 1,
        name: 'Test',
        instances: [
          { widgetType: 'net-pnl', config: {}, layout: { i: 'inst-1', x: 0, y: 0, w: 3, h: 2 } },
        ],
      };
      expect(isPerformanceDashboardConfigShape(config)).toBe(false);
    });

    it('returns false when instance missing widgetType', () => {
      const config = {
        version: 1,
        name: 'Test',
        instances: [
          { instanceId: 'inst-1', config: {}, layout: { i: 'inst-1', x: 0, y: 0, w: 3, h: 2 } },
        ],
      };
      expect(isPerformanceDashboardConfigShape(config)).toBe(false);
    });

    it('returns false when instance missing config', () => {
      const config = {
        version: 1,
        name: 'Test',
        instances: [
          { instanceId: 'inst-1', widgetType: 'net-pnl', layout: { i: 'inst-1', x: 0, y: 0, w: 3, h: 2 } },
        ],
      };
      expect(isPerformanceDashboardConfigShape(config)).toBe(false);
    });

    it('returns false when instance missing layout', () => {
      const config = {
        version: 1,
        name: 'Test',
        instances: [{ instanceId: 'inst-1', widgetType: 'net-pnl', config: {} }],
      };
      expect(isPerformanceDashboardConfigShape(config)).toBe(false);
    });

    it('accepts config with optional filterSnapshot', () => {
      const config: PerformanceDashboardConfig = {
        version: 1,
        name: 'Test Dashboard',
        instances: [],
        filterSnapshot: {
          accountScope: { mode: 'all', accountIds: [] },
          dateRange: { preset: 'YTD', from: '', to: '' },
          advancedFilters: { setupIds: [], directions: [], symbols: [], tradeResults: [] },
          unit: 'currency',
        },
      };
      expect(isPerformanceDashboardConfigShape(config)).toBe(true);
    });
  });

  describe('validatePerformanceDashboardConfig', () => {
    const validWidgetTypes = getValidWidgetTypes();

    it('returns null for valid config', () => {
      const config: PerformanceDashboardConfig = {
        version: PERFORMANCE_DASHBOARD_CONFIG_VERSION,
        name: 'Test Dashboard',
        instances: [
          {
            instanceId: 'inst-1',
            widgetType: 'net-pnl',
            config: {},
            layout: { i: 'inst-1', x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      };
      expect(validatePerformanceDashboardConfig(config, validWidgetTypes)).toBeNull();
    });

    it('returns error for invalid shape', () => {
      const config = { version: 1, name: 'Test' };
      expect(validatePerformanceDashboardConfig(config, validWidgetTypes)).toBe(
        'Invalid PerformanceDashboardConfig shape',
      );
    });

    it('returns error for unsupported version', () => {
      const config: PerformanceDashboardConfig = {
        version: 999,
        name: 'Test Dashboard',
        instances: [],
      };
      expect(validatePerformanceDashboardConfig(config, validWidgetTypes)).toBe(
        'Unsupported config version: 999',
      );
    });

    it('returns error for unknown widget type', () => {
      const config: PerformanceDashboardConfig = {
        version: PERFORMANCE_DASHBOARD_CONFIG_VERSION,
        name: 'Test Dashboard',
        instances: [
          {
            instanceId: 'inst-1',
            widgetType: 'unknown-widget',
            config: {},
            layout: { i: 'inst-1', x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      };
      expect(validatePerformanceDashboardConfig(config, validWidgetTypes)).toBe(
        'Unknown widget type: unknown-widget',
      );
    });

    it('accepts empty instances array', () => {
      const config: PerformanceDashboardConfig = {
        version: PERFORMANCE_DASHBOARD_CONFIG_VERSION,
        name: 'Empty Dashboard',
        instances: [],
      };
      expect(validatePerformanceDashboardConfig(config, validWidgetTypes)).toBeNull();
    });
  });

  describe('migratePerformanceDashboardConfig', () => {
    it('returns config unchanged for current version', () => {
      const config: PerformanceDashboardConfig = {
        version: PERFORMANCE_DASHBOARD_CONFIG_VERSION,
        name: 'Test Dashboard',
        instances: [],
      };
      expect(migratePerformanceDashboardConfig(config)).toEqual(config);
    });
  });

  describe('createDefaultFilter', () => {
    it('creates filter with all defaults', () => {
      const filter = createDefaultFilter();
      expect(filter.accountScope.mode).toBe('all');
      expect(filter.accountScope.accountIds).toEqual([]);
      expect(filter.dateRange.preset).toBe('YTD');
      expect(filter.advancedFilters.setupIds).toEqual([]);
      expect(filter.advancedFilters.directions).toEqual([]);
      expect(filter.advancedFilters.symbols).toEqual([]);
      expect(filter.advancedFilters.tradeResults).toEqual([]);
      expect(filter.unit).toBe('currency');
    });
  });

  describe('dashboard templates', () => {
    it('createDefaultDashboardConfig returns the curated default template', () => {
      const config = createDefaultDashboardConfig();
      const defaults = getDefaultWidgetInstances();
      expect(config.version).toBe(PERFORMANCE_DASHBOARD_CONFIG_VERSION);
      expect(config.name).toBe('Performance Default');
      // Curated instances: 1:1 with getDefaultWidgetInstances() — KPI + charts.
      expect(config.instances.length).toBeGreaterThan(0);
      expect(config.instances.length).toBe(defaults.length);
      config.instances.forEach((inst, i) => {
        expect(inst.instanceId).toBe(defaults[i].instanceId);
        expect(inst.widgetType).toBe(defaults[i].widgetType);
        // RGL layout is self-describing: i bound to the instanceId.
        expect(inst.layout.i).toBe(inst.instanceId);
        expect(inst.layout.x).toBe(defaults[i].layout.x);
        expect(inst.layout.y).toBe(defaults[i].layout.y);
        expect(inst.layout.w).toBe(defaults[i].layout.w);
        expect(inst.layout.h).toBe(defaults[i].layout.h);
      });
      // Curated mix must include both KPI and chart widgets.
      const categories = config.instances.map(
        (inst) => PERFORMANCE_WIDGET_REGISTRY[inst.widgetType]?.category,
      );
      expect(categories).toContain('kpi');
      expect(categories).toContain('chart');
      // Unique instance ids.
      const ids = config.instances.map((inst) => inst.instanceId);
      expect(new Set(ids).size).toBe(ids.length);
      // Valid against the widget catalogue (what the shared route validates).
      expect(validatePerformanceDashboardConfig(config, getValidWidgetTypes())).toBeNull();
    });

    it('default KPI instances are exactly the curated five (R003)', () => {
      // Curated rail: Net P&L, Win Rate, Profit Factor, Average R, Payoff Ratio.
      // Gross P&L and Total Trades are registered but no longer default-visible.
      const kpiDefaults = getDefaultWidgetInstances('kpi');
      expect(kpiDefaults.map((i) => i.widgetType)).toEqual([
        'net-pnl',
        'win-rate',
        'profit-factor',
        'average-r',
        'payoff-ratio',
      ]);
    });

    it('cloneDashboardConfig produces a deep-independent copy', () => {
      const config: PerformanceDashboardConfig = {
        version: PERFORMANCE_DASHBOARD_CONFIG_VERSION,
        name: 'Source',
        instances: [
          {
            instanceId: 'inst-1',
            widgetType: 'net-pnl',
            config: { metricId: 'net-pnl', titleOverride: 'Original' },
            layout: { i: 'inst-1', x: 0, y: 0, w: 3, h: 2 },
          },
        ],
        filterSnapshot: {
          accountScope: { mode: 'single', accountIds: ['acc-1'] },
          dateRange: { preset: '1M', from: '2026-01-01', to: '2026-01-31' },
          advancedFilters: { setupIds: ['s1'], directions: ['long'], symbols: [], tradeResults: [] },
          unit: 'r',
        },
      };

      const clone = cloneDashboardConfig(config);
      // Independent instance config / layout / id.
      clone.instances[0].config.titleOverride = 'Changed';
      clone.instances[0].layout.x = 99;
      clone.instances[0].instanceId = 'inst-clone';
      // Independent filterSnapshot (deep copy).
      clone.filterSnapshot!.accountScope!.accountIds.push('acc-2');
      clone.filterSnapshot!.dateRange!.preset = '3M';

      expect(config.instances[0].config.titleOverride).toBe('Original');
      expect(config.instances[0].layout.x).toBe(0);
      expect(config.instances[0].instanceId).toBe('inst-1');
      expect(config.filterSnapshot!.accountScope!.accountIds).toEqual(['acc-1']);
      expect(config.filterSnapshot!.dateRange!.preset).toBe('1M');
    });

    it('cloneDashboardConfig clones the curated default without aliasing', () => {
      const config = createDefaultDashboardConfig();
      const clone = cloneDashboardConfig(config);
      clone.instances[0].config.titleOverride = 'Clone Only';
      clone.instances[0].layout.x = 42;
      expect(config.instances[0].config.titleOverride).toBeUndefined();
      expect(config.instances[0].layout.x).not.toBe(42);
    });

    it('resetDashboardToTemplate returns a fresh curated default template', () => {
      const a = resetDashboardToTemplate();
      const b = resetDashboardToTemplate();
      expect(a.name).toBe('Performance Default');
      expect(a.instances.length).toBeGreaterThan(0);
      expect(a.instances).toEqual(b.instances);
      // Independence: mutating one reset result never affects the other.
      a.instances[0].layout.x = 99;
      expect(b.instances[0].layout.x).not.toBe(99);
    });

    it('PD_SYSTEM_DEFAULT_TEMPLATE is the canonical system default id', () => {
      expect(PD_SYSTEM_DEFAULT_TEMPLATE).toBe('pd-system-default');
      expect(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT).toBe(PD_SYSTEM_DEFAULT_TEMPLATE);
    });

    it('createSystemDefaultDashboard returns an immutable system envelope', () => {
      const envelope = createSystemDefaultDashboard();
      expect(envelope.id).toBe(PD_SYSTEM_DEFAULT_TEMPLATE);
      expect(envelope.isSystem).toBe(true);
      expect(envelope.name).toBe('Performance Default');
      // The system default carries the curated instance set.
      expect(envelope.config.instances.length).toBe(getDefaultWidgetInstances().length);
    });
  });
});
