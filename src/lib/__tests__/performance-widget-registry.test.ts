import { describe, expect, it } from 'vitest';
import {
  GLOBAL_UNIT_SENTINEL,
  getWidgetConfigSchema,
  sanitizeKpiConfig,
  PERFORMANCE_WIDGET_REGISTRY,
} from '../performance-widget-registry';

describe('getWidgetConfigSchema', () => {
  it('drives KPI fields from the catalogue: metric select + title override', () => {
    const schema = getWidgetConfigSchema('net-pnl');
    const metricField = schema.metricId;
    expect(metricField.kind).toBe('select');
    if (metricField.kind !== 'select') return;
    expect(metricField.options.length).toBeGreaterThanOrEqual(18);
    expect(metricField.options.map((o) => o.value)).toContain('total-trades');
    expect(schema.titleOverride.kind).toBe('text');
  });

  it('adds a per-widget unit override only when the metric supports convertible units', () => {
    // Net P&L supports currency/percent/r → unit select present.
    const convertible = getWidgetConfigSchema('net-pnl');
    expect(convertible.unit).toBeDefined();
    expect(convertible.unit?.kind).toBe('select');
    if (convertible.unit?.kind !== 'select') return;
    expect(convertible.unit.options.map((o) => o.value)).toEqual([
      GLOBAL_UNIT_SENTINEL,
      'currency',
      'percent',
      'r',
    ]);

    // Win Rate is fixed-% → no unit field at all.
    const fixed = getWidgetConfigSchema('win-rate');
    expect(fixed.unit).toBeUndefined();

    // Total Fees supports currency only → no real choice → no unit field.
    const single = getWidgetConfigSchema('total-fees');
    expect(single.unit).toBeUndefined();
  });

  it('re-derives unit options from the current metric (currentConfig.metricId)', () => {
    // A net-pnl instance configured to show Total Trades (fixed count) has no
    // unit override, even though the base net-pnl type supports units.
    const schema = getWidgetConfigSchema('net-pnl', { metricId: 'total-trades' });
    expect(schema.unit).toBeUndefined();
  });

  it('declares visible-series multi-selects for multi-series chart widgets', () => {
    const drawdown = getWidgetConfigSchema('drawdown-curve');
    expect(drawdown.visibleSeries.kind).toBe('multi-select');
    if (drawdown.visibleSeries.kind !== 'multi-select') return;
    expect(drawdown.visibleSeries.default).toEqual(['drawdownAmount', 'drawdownPct']);
    expect(drawdown.visibleSeries.options.map((o) => o.label)).toEqual(['Amount ($)', 'Percent (%)']);

    const monthly = getWidgetConfigSchema('monthly-pnl');
    expect(monthly.visibleSeries.kind).toBe('multi-select');

    const longVsShort = getWidgetConfigSchema('long-vs-short');
    expect(longVsShort.visibleSeries.kind).toBe('multi-select');
  });

  it('exposes the primary-series select for performance-by-setup', () => {
    const schema = getWidgetConfigSchema('performance-by-setup');
    expect(schema.metric.kind).toBe('select');
    if (schema.metric.kind !== 'select') return;
    expect(schema.metric.default).toBe('netPnl');
    expect(schema.metric.options.map((o) => o.label)).toEqual([
      'Net P&L',
      'Win Rate',
      'Average R',
      'Trade Count',
    ]);
  });

  it('adds shared chart fields (legend + title) to every chart widget', () => {
    const single = getWidgetConfigSchema('daily-cumulative-pnl');
    expect(single.legendVisible.kind).toBe('boolean');
    expect(single.titleOverride.kind).toBe('text');
    // Single-series widgets have no series toggle.
    expect(single.visibleSeries).toBeUndefined();
  });

  it('returns an empty schema for unknown widget types', () => {
    expect(getWidgetConfigSchema('not-a-widget')).toEqual({});
  });

  it('keeps the registry the single source of truth for chart capabilities', () => {
    // Every declared registry configSchema is a typed field schema.
    for (const def of Object.values(PERFORMANCE_WIDGET_REGISTRY)) {
      if (!def.configSchema) continue;
      for (const field of Object.values(def.configSchema)) {
        expect(['select', 'multi-select', 'text', 'boolean']).toContain(field.kind);
      }
    }
  });
});

describe('sanitizeKpiConfig', () => {
  it('drops a unit override the selected metric cannot honor', () => {
    const result = sanitizeKpiConfig({ metricId: 'win-rate', unit: 'percent' }, 'net-pnl');
    expect(result.unit).toBeUndefined();
    expect(result.metricId).toBe('win-rate');
  });

  it('keeps a supported unit override', () => {
    const result = sanitizeKpiConfig({ metricId: 'net-pnl', unit: 'r' }, 'net-pnl');
    expect(result.unit).toBe('r');
  });

  it('leaves non-KPI config untouched', () => {
    const result = sanitizeKpiConfig({ visibleSeries: ['netPnl'], legendVisible: true }, 'daily-cumulative-pnl');
    expect(result).toEqual({ visibleSeries: ['netPnl'], legendVisible: true });
  });
});
