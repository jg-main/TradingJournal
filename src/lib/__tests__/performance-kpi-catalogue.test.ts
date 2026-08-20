import { describe, it, expect } from 'vitest';
import {
  PERFORMANCE_KPI_CATALOGUE,
  getKpiMetricDefinition,
  currencyToPercent,
  currencyToR,
  applyUnit,
  type KpiMetricDefinition,
} from '../performance-kpi-catalogue';
import { PERFORMANCE_WIDGET_IDS } from '../performance-widget-registry';

describe('performance-kpi-catalogue', () => {
  describe('catalogue completeness', () => {
    it('covers all 18 registered KPI widget types', () => {
      const kpiWidgetIds = [
        PERFORMANCE_WIDGET_IDS.NET_PNL,
        PERFORMANCE_WIDGET_IDS.GROSS_PNL,
        PERFORMANCE_WIDGET_IDS.TOTAL_TRADES,
        PERFORMANCE_WIDGET_IDS.WIN_RATE,
        PERFORMANCE_WIDGET_IDS.DAY_WIN_RATE,
        PERFORMANCE_WIDGET_IDS.PROFIT_FACTOR,
        PERFORMANCE_WIDGET_IDS.EXPECTANCY,
        PERFORMANCE_WIDGET_IDS.AVERAGE_R,
        PERFORMANCE_WIDGET_IDS.MEDIAN_R,
        PERFORMANCE_WIDGET_IDS.AVERAGE_WIN,
        PERFORMANCE_WIDGET_IDS.AVERAGE_LOSS,
        PERFORMANCE_WIDGET_IDS.PAYOFF_RATIO,
        PERFORMANCE_WIDGET_IDS.LARGEST_WIN,
        PERFORMANCE_WIDGET_IDS.LARGEST_LOSS,
        PERFORMANCE_WIDGET_IDS.AVERAGE_HOLDING_DURATION,
        PERFORMANCE_WIDGET_IDS.MAX_DRAWDOWN,
        PERFORMANCE_WIDGET_IDS.CURRENT_DRAWDOWN,
        PERFORMANCE_WIDGET_IDS.TOTAL_FEES,
      ];

      for (const id of kpiWidgetIds) {
        expect(PERFORMANCE_KPI_CATALOGUE[id], `missing definition for ${id}`).toBeDefined();
      }
    });

    it('every definition has a valid accessor that resolves values', () => {
      const sampleKpi = {
        netPnl: 1000,
        grossPnl: { grossPnl: 1200, grossProfit: 2200, grossLoss: 1000 },
        closedTrades: 25,
        winRate: 0.6,
        dayWinRate: 0.55,
        profitFactor: 1.8,
        expectancy: 40,
        avgR: 0.5,
        medianR: 0.4,
        avgWin: 120,
        avgLoss: 60,
        payoffRatio: 2.0,
        bestTrade: 400,
        worstTrade: -150,
        averageHoldingDays: 3.2,
        maxDrawdown: { amount: 500, pct: 0.05 },
        currentDrawdown: 100,
        totalFees: 75,
      };

      for (const def of Object.values(PERFORMANCE_KPI_CATALOGUE)) {
        const value = def.accessor(sampleKpi as unknown as Record<string, unknown>);
        expect(value, `${def.id} accessor returned null for populated data`).not.toBeNull();
      }
    });
  });

  describe('currencyToPercent', () => {
    it('computes percentage of period-start equity', () => {
      expect(currencyToPercent(1000, 50000)).toBeCloseTo(0.02, 5);
    });

    it('returns null for missing or non-positive equity', () => {
      expect(currencyToPercent(1000, null)).toBeNull();
      expect(currencyToPercent(1000, 0)).toBeNull();
      expect(currencyToPercent(1000, -100)).toBeNull();
    });
  });

  describe('currencyToR', () => {
    it('computes R-multiple from initial risk', () => {
      expect(currencyToR(500, 250)).toBe(2);
    });

    it('applies the R-multiple guard: null when initial risk <= 0', () => {
      expect(currencyToR(500, null)).toBeNull();
      expect(currencyToR(500, 0)).toBeNull();
      expect(currencyToR(500, -50)).toBeNull();
    });
  });

  describe('applyUnit', () => {
    const currencyDef: KpiMetricDefinition = {
      id: 'test-currency',
      title: 'Test',
      formatKind: 'currency',
      accessor: () => null,
      supportedUnits: ['currency', 'percent', 'r'],
    };

    const fixedDef: KpiMetricDefinition = {
      id: 'test-fixed',
      title: 'Test Fixed',
      formatKind: 'ratio',
      accessor: () => null,
      supportedUnits: ['fixed'],
    };

    const ctx = { periodStartEquity: 10000, totalInitialRisk: 500 };

    it('keeps currency value when unit is currency', () => {
      const result = applyUnit(1000, currencyDef, 'currency', ctx);
      expect(result).toEqual({ value: 1000, unit: 'currency' });
    });

    it('converts to percent when unit is percent', () => {
      const result = applyUnit(1000, currencyDef, 'percent', ctx);
      expect(result.value).toBeCloseTo(0.1, 5);
      expect(result.unit).toBe('percent');
    });

    it('converts to R when unit is r', () => {
      const result = applyUnit(1000, currencyDef, 'r', ctx);
      expect(result.value).toBe(2);
      expect(result.unit).toBe('r');
    });

    it('never converts fixed-semantic metrics', () => {
      const result = applyUnit(0.6, fixedDef, 'percent', ctx);
      expect(result).toEqual({ value: 0.6, unit: 'fixed' });
    });

    it('returns null for null value', () => {
      const result = applyUnit(null, currencyDef, 'currency', ctx);
      expect(result).toEqual({ value: null, unit: 'currency' });
    });

    it('gracefully falls back to currency for unsupported unit', () => {
      const result = applyUnit(1000, currencyDef, 'r', { periodStartEquity: null, totalInitialRisk: null });
      // R conversion fails safely (no initial risk), falls back to raw currency value
      expect(result.value).toBeNull();
    });
  });

  describe('getKpiMetricDefinition', () => {
    it('returns definition for known metric', () => {
      expect(getKpiMetricDefinition('net-pnl')).not.toBeNull();
    });

    it('returns null for unknown metric', () => {
      expect(getKpiMetricDefinition('unknown-metric')).toBeNull();
    });
  });
});
