'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import { DashboardChart } from '@/components/dashboard-chart';
import { useChartPalette } from '@/hooks/use-chart-palette';
import {
  dailyCumulativePnlOption,
  netDailyPnlOption,
  tradeDurationScatterOption,
  drawdownCurveOption,
  rDistributionOption,
  performanceBySetupOption,
  performanceByDayOfWeekOption,
  performanceByTimeOfDayOption,
  longVsShortOption,
  monthlyPnlOption,
  type CumulativePnlPoint,
  type DailyPnlPoint,
  type TradeDurationPointData,
  type DrawdownPoint,
  type RDistributionItem,
  type SetupPerfItem,
  type DayOfWeekData,
  type TimeOfDayData,
  type LongVsShortItem,
  type MonthlyPerfItem,
  type ChartRenderConfig,
} from '@/lib/performance-chart-options';
import { PERFORMANCE_WIDGET_REGISTRY } from '@/lib/performance-widget-registry';
import { resolveSupportedUnit } from '@/lib/performance-kpi-catalogue';
import { Skeleton } from '@/components/ui/skeleton';
import type { EChartsOption } from 'echarts-for-react';
import type { ChartPalette } from '@/lib/chart-palette';

// ── Widget → data slice + builder mapping ──────────────────────────────────

export interface ChartWidgetProps {
  widgetType: string;
  config: Record<string, unknown>;
}

interface ChartDataExtractors {
  extract: (charts: Record<string, unknown>) => unknown;
  build: (
    data: unknown,
    palette: ChartPalette,
    config: Record<string, unknown>,
    renderOptions: ChartRenderConfig,
  ) => EChartsOption | null;
  series: string[];
}

const CHART_EXTRACTORS: Record<string, ChartDataExtractors> = {
  'daily-cumulative-pnl': {
    extract: (c) => c.cumulativeDailyPnl as CumulativePnlPoint[],
    build: (data, palette, config, ro) =>
      dailyCumulativePnlOption(
        data as CumulativePnlPoint[],
        palette,
        (config.visibleSeries as string[] | undefined) ?? ['cumulativePnl'],
        ro,
      ),
    series: ['cumulativePnl'],
  },
  'net-daily-pnl': {
    extract: (c) => c.dailyNetPnl as DailyPnlPoint[],
    build: (data, palette, config, ro) =>
      netDailyPnlOption(
        data as DailyPnlPoint[],
        palette,
        (config.visibleSeries as string[] | undefined) ?? ['netPnl'],
        ro,
      ),
    series: ['netPnl'],
  },
  'trade-duration-performance': {
    // Default visualization: per-trade scatter (one observation per closed
    // trade). The aggregated bucket dataset (tradeDurationPerformance) is
    // retained in the analytics response for other consumers.
    extract: (c) => c.tradeDurationPoints as TradeDurationPointData[],
    build: (data, palette, config, ro) =>
      tradeDurationScatterOption(
        data as TradeDurationPointData[],
        palette,
        (config.visibleSeries as string[] | undefined) ?? ['netPnl'],
        ro,
      ),
    series: ['netPnl'],
  },
  'drawdown-curve': {
    extract: (c) => c.drawdownCurve as DrawdownPoint[],
    build: (data, palette, config, ro) =>
      drawdownCurveOption(
        data as DrawdownPoint[],
        palette,
        ['drawdownAmount'],
        ro,
      ),
    series: ['drawdownAmount'],
  },
  'r-distribution': {
    extract: (c) => c.rDistribution as RDistributionItem[],
    build: (data, palette, config, ro) =>
      rDistributionOption(
        data as RDistributionItem[],
        palette,
        (config.visibleSeries as string[] | undefined) ?? ['count'],
        ro,
      ),
    series: ['count'],
  },
  'performance-by-setup': {
    extract: (c) => {
      const raw = c.setupPerformance as Array<{
        setupName: string;
        setupId: string | null;
        count: number;
        winRate: number | null;
        avgR: number | null;
        netPnl: number;
      }>;
      // Normalize setupName → setup for the chart builder
      return (raw ?? []).map((r) => ({
        setup: r.setupName,
        count: r.count,
        winRate: r.winRate,
        avgR: r.avgR,
        netPnl: r.netPnl ?? 0,
      }));
    },
    build: (data, palette, config, ro) =>
      performanceBySetupOption(data as SetupPerfItem[], palette, {
        metric: (config.metric as string | undefined) ?? undefined,
        visibleSeries: (config.visibleSeries as string[] | undefined) ?? undefined,
        ...ro,
      }),
    series: ['netPnl', 'winRate', 'avgR', 'count'],
  },
  'performance-by-day-of-week': {
    extract: (c) => c.performanceByDayOfWeek as DayOfWeekData[],
    build: (data, palette, config, ro) =>
      performanceByDayOfWeekOption(
        data as DayOfWeekData[],
        palette,
        (config.visibleSeries as string[] | undefined) ?? ['netPnl'],
        ro,
      ),
    series: ['netPnl'],
  },
  'performance-by-time-of-day': {
    extract: (c) => c.performanceByTimeOfDay as TimeOfDayData[],
    build: (data, palette, config, ro) =>
      performanceByTimeOfDayOption(
        data as TimeOfDayData[],
        palette,
        (config.visibleSeries as string[] | undefined) ?? ['netPnl'],
        ro,
      ),
    series: ['netPnl'],
  },
  'long-vs-short': {
    extract: (c) => {
      const raw = c.directionalPerformance as {
        long: { netPnl: number; winRate: number | null; tradeCount: number };
        short: { netPnl: number; winRate: number | null; tradeCount: number };
      } | null;
      if (!raw) return [];
      return [
        { direction: 'long' as const, netPnl: raw.long?.netPnl ?? 0, count: raw.long?.tradeCount ?? 0, winRate: raw.long?.winRate ?? null },
        { direction: 'short' as const, netPnl: raw.short?.netPnl ?? 0, count: raw.short?.tradeCount ?? 0, winRate: raw.short?.winRate ?? null },
      ];
    },
    build: (data, palette, config, ro) =>
      longVsShortOption(
        data as LongVsShortItem[],
        palette,
        (config.visibleSeries as string[] | undefined) ?? ['long', 'short'],
        ro,
      ),
    series: ['long', 'short'],
  },
  'monthly-pnl': {
    extract: (c) => c.monthlyPerformance as MonthlyPerfItem[],
    build: (data, palette, config, ro) =>
      monthlyPnlOption(
        data as MonthlyPerfItem[],
        palette,
        (config.visibleSeries as string[] | undefined) ?? ['netPnl', 'winRate'],
        ro,
      ),
    series: ['netPnl', 'winRate'],
  },
};

// ── Component ───────────────────────────────────────────────────────────────

export function ChartWidget({ widgetType, config }: ChartWidgetProps) {
  const { analyticsData, filter, isLoading, error } = usePerformanceDashboard();
  const palette = useChartPalette();
  const containerRef = useRef<HTMLDivElement>(null);

  // Store the live ECharts instance on the container (test/inspection surface
  // only — no visual effect) so browser verification can dispatch tooltips and
  // read axis/tooltip config from the real rendered chart.
  const handleChartReady = useCallback((instance: unknown) => {
    if (containerRef.current) {
      (containerRef.current as HTMLElement & { __echartsInstance?: unknown }).__echartsInstance = instance;
    }
  }, []);

  const extractor = CHART_EXTRACTORS[widgetType];
  const definition = PERFORMANCE_WIDGET_REGISTRY[widgetType];

  const option = useMemo(() => {
    if (!extractor || !analyticsData) return null;
    const charts = analyticsData.charts as Record<string, unknown>;
    const data = extractor.extract(charts);
    // The registry is authoritative: resolve the effective presentation unit
    // from the widget's declared supportedUnits + the global selector, so a
    // chart never receives a unit it does not declare (e.g. Drawdown Curve
    // amount stays currency under global R; R-Distribution stays fixed).
    const effectiveUnit = resolveSupportedUnit(
      definition?.supportedUnits ?? ['currency'],
      filter.unit,
    );
    // Global presentation unit + canonical denominators flow to the builder
    // through the shared render config, so convertible series use the same
    // $ / % / R contract as the KPI cards (no per-widget conversion formulas).
    const renderOptions: ChartRenderConfig = {
      legendVisible: Boolean(config.legendVisible),
      unit: effectiveUnit,
      periodStartEquity: analyticsData.metadata.periodStartEquity ?? null,
      totalInitialRisk: analyticsData.metadata.totalInitialRisk ?? null,
    };
    return extractor.build(data, palette, config, renderOptions);
  }, [extractor, analyticsData, palette, config, filter.unit, definition]);

  if (!extractor || !definition) {
    return (
      <div className="border border-border rounded-lg p-4 bg-card h-full flex items-center justify-center text-sm text-muted-foreground">
        Unknown widget type: {widgetType}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="border border-border rounded-lg bg-card p-3 h-full flex flex-col"
      data-widget-type={widgetType}
      data-chart-series={option ? String(seriesValuesForTest(option)) : ''}
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium truncate">{typeof config.titleOverride === 'string' ? config.titleOverride : definition.title}</h4>
      </div>

      <div className="flex-1 min-h-0">
        {error && !analyticsData ? (
          <div
            className="h-full flex items-center justify-center text-sm text-destructive"
            title={error}
            data-testid={`chart-error-${widgetType}`}
          >
            Failed to load analytics
          </div>
        ) : isLoading && !analyticsData ? (
          <div className="h-full w-full" data-testid={`chart-skeleton-${widgetType}`} aria-hidden="true">
            <Skeleton className="h-full w-full rounded-md" />
          </div>
        ) : !option ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <DashboardChart option={option} flexHeight onChartReady={handleChartReady} />
        )}
      </div>
    </div>
  );
}

/**
 * Test contract: serialize the first series' numeric values for browser
 * verification of the global unit conversion. Rounded to 6 decimals so the
 * value is stable against float noise while remaining exact for the $/%/R
 * assertions. Scatter points ([x, y] pairs or { value: [x, y] }) serialize
 * their Y (the outcome) so the contract stays meaningful for the Trade
 * Duration scatter. Renders into a data attribute (invisible, no visual change).
 */
function seriesValuesForTest(option: EChartsOption): number[] {
  const series = Array.isArray(option.series) ? option.series : [];
  const first = series[0] as { data?: unknown } | undefined;
  if (!first?.data || !Array.isArray(first.data)) return [];
  return first.data.map((d) => {
    const raw = typeof d === 'object' && d !== null ? (d as { value: number | [number, number] }).value : (d as number);
    const v = Array.isArray(raw) ? raw[1] : raw;
    return typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : NaN;
  });
}
