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
  PERFORMANCE_DASHBOARD_CONFIG_VERSION,
  type PerformanceDashboardConfig,
} from '../performance-view-types';
import { getValidWidgetTypes } from '../performance-widget-registry';

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
    it('createDefaultDashboardConfig returns a valid empty-config template', () => {
      const config = createDefaultDashboardConfig();
      expect(config.version).toBe(PERFORMANCE_DASHBOARD_CONFIG_VERSION);
      expect(config.instances).toEqual([]);
      expect(validatePerformanceDashboardConfig(config, getValidWidgetTypes())).toBeNull();
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
      };

      const clone = cloneDashboardConfig(config);
      // Independent instance config
      clone.instances[0].config.titleOverride = 'Changed';
      clone.instances[0].layout.x = 99;
      clone.instances[0].instanceId = 'inst-clone';

      expect(config.instances[0].config.titleOverride).toBe('Original');
      expect(config.instances[0].layout.x).toBe(0);
      expect(config.instances[0].instanceId).toBe('inst-1');
    });

    it('resetDashboardToTemplate returns a fresh default template', () => {
      const config = resetDashboardToTemplate();
      expect(config.name).toBe('Performance Default');
      expect(config.instances).toEqual([]);
    });

    it('createSystemDefaultDashboard returns an immutable system envelope', () => {
      const envelope = createSystemDefaultDashboard();
      expect(envelope.id).toBe('pd-system-default');
      expect(envelope.isSystem).toBe(true);
      expect(envelope.config).toBeDefined();
    });
  });
});
