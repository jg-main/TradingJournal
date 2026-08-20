import { describe, it, expect } from 'vitest';
import {
  dashboardEnvelopeFromView,
} from '../use-performance-dashboards';
import type { DashboardView } from '@/types/dashboard-view';
import type { LayoutItem } from 'react-grid-layout';
import {
  isPerformanceDashboardConfigShape,
  cloneDashboardConfig,
  resetDashboardToTemplate,
  createSystemDefaultDashboard,
  PERFORMANCE_SYSTEM_DASHBOARD_IDS,
  type PerformanceDashboardConfig,
} from '@/lib/performance-view-types';

describe('use-performance-dashboards (pure helpers)', () => {
  describe('dashboardEnvelopeFromView', () => {
    it('extracts a pd- envelope from a shared view row', () => {
      const config: PerformanceDashboardConfig = {
        version: 1,
        name: 'My Dashboard',
        instances: [
          {
            instanceId: 'inst-1',
            widgetType: 'net-pnl',
            config: { metricId: 'net-pnl' },
            layout: { i: 'inst-1', x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      };
      const view: DashboardView = {
        id: 'pd-user-abc',
        name: 'My Dashboard',
        layout: config as unknown as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: false,
        isDefault: false,
      };
      const envelope = dashboardEnvelopeFromView(view);
      expect(envelope).not.toBeNull();
      expect(envelope!.id).toBe('pd-user-abc');
      expect(envelope!.config.instances).toHaveLength(1);
    });

    it('returns null for non-pd ids', () => {
      const view: DashboardView = {
        id: 'ws-system-risk',
        name: 'Workstation',
        layout: [] as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: true,
        isDefault: false,
      };
      expect(dashboardEnvelopeFromView(view)).toBeNull();
    });

    it('returns null for invalid config shape', () => {
      const view: DashboardView = {
        id: 'pd-user-xyz',
        name: 'Bad',
        layout: JSON.parse('{"version":1}') as unknown as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: false,
        isDefault: false,
      };
      expect(dashboardEnvelopeFromView(view)).toBeNull();
    });

    it('returns null for invalid widget type in config', () => {
      const config = {
        version: 1,
        name: 'Bad Widget',
        instances: [
          { instanceId: 'i1', widgetType: 'not-a-real-widget', config: {}, layout: { i: 'i1', x: 0, y: 0, w: 3, h: 2 } },
        ],
      };
      const view: DashboardView = {
        id: 'pd-user-zzz',
        name: 'Bad Widget',
        layout: config as unknown as LayoutItem[],
        hiddenWidgetIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isSystem: false,
        isDefault: false,
      };
      expect(dashboardEnvelopeFromView(view)).toBeNull();
    });
  });

  describe('config helpers', () => {
    it('cloneDashboardConfig produces independent copy', () => {
      const config: PerformanceDashboardConfig = {
        version: 1,
        name: 'Source',
        instances: [
          {
            instanceId: 'i1',
            widgetType: 'net-pnl',
            config: { titleOverride: 'A' },
            layout: { i: 'i1', x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      };
      const clone = cloneDashboardConfig(config);
      clone.instances[0].config.titleOverride = 'B';
      clone.instances[0].layout.x = 5;
      expect(config.instances[0].config.titleOverride).toBe('A');
      expect(config.instances[0].layout.x).toBe(0);
    });

    it('resetDashboardToTemplate returns default template', () => {
      const config = resetDashboardToTemplate();
      expect(config.name).toBe('Performance Default');
      expect(isPerformanceDashboardConfigShape(config)).toBe(true);
    });

    it('createSystemDefaultDashboard is immutable system envelope', () => {
      const envelope = createSystemDefaultDashboard();
      expect(envelope.isSystem).toBe(true);
      expect(envelope.id).toBe(PERFORMANCE_SYSTEM_DASHBOARD_IDS.DEFAULT);
    });
  });
});
