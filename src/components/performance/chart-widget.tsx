'use client';

import React, { useMemo, useState } from 'react';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import { DashboardChart } from '@/components/dashboard-chart';
import { useChartPalette } from '@/hooks/use-chart-palette';
import {
  dailyCumulativePnlOption,
  netDailyPnlOption,
  tradeDurationOption,
  drawdownCurveOption,
  rDistributionOption,
  performanceBySetupOption,
  performanceByDayOfWeekOption,
  performanceByTimeOfDayOption,
  longVsShortOption,
  monthlyPnlOption,
  type CumulativePnlPoint,
  type DailyPnlPoint,
  type DurationBucketData,
  type DrawdownPoint,
  type RDistributionItem,
  type SetupPerfItem,
  type DayOfWeekData,
  type TimeOfDayData,
  type LongVsShortItem,
  type MonthlyPerfItem,
} from '@/lib/performance-chart-options';
import { PERFORMANCE_WIDGET_REGISTRY } from '@/lib/performance-widget-registry';
import type { EChartsOption } from 'echarts-for-react';
import type { ChartPalette } from '@/lib/chart-palette';

// ── Widget → data slice + builder mapping ──────────────────────────────────

export interface ChartWidgetProps {
  instanceId: string;
  widgetType: string;
  config: Record<string, unknown>;
  onConfigChange?: (instanceId: string, config: Record<string, unknown>) => void;
  editMode?: boolean;
}

interface ChartDataExtractors {
  extract: (charts: Record<string, unknown>) => unknown;
  build: (data: unknown, palette: ChartPalette, config: Record<string, unknown>) => EChartsOption | null;
  series: string[];
}

const CHART_EXTRACTORS: Record<string, ChartDataExtractors> = {
  'daily-cumulative-pnl': {
    extract: (c) => c.cumulativeDailyPnl as CumulativePnlPoint[],
    build: (data, palette, _config) => dailyCumulativePnlOption(data as CumulativePnlPoint[], palette, ['cumulativePnl']),
    series: ['cumulativePnl'],
  },
  'net-daily-pnl': {
    extract: (c) => c.dailyNetPnl as DailyPnlPoint[],
    build: (data, palette, _config) => netDailyPnlOption(data as DailyPnlPoint[], palette, ['netPnl']),
    series: ['netPnl'],
  },
  'trade-duration-performance': {
    extract: (c) => c.tradeDurationPerformance as DurationBucketData[],
    build: (data, palette, _config) => tradeDurationOption(data as DurationBucketData[], palette, ['netPnl']),
    series: ['netPnl'],
  },
  'drawdown-curve': {
    extract: (c) => c.drawdownCurve as DrawdownPoint[],
    build: (data, palette, _config) => drawdownCurveOption(data as DrawdownPoint[], palette, ['drawdownAmount', 'drawdownPct']),
    series: ['drawdownAmount', 'drawdownPct'],
  },
  'r-distribution': {
    extract: (c) => c.rDistribution as RDistributionItem[],
    build: (data, palette, _config) => rDistributionOption(data as RDistributionItem[], palette, ['count']),
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
    build: (data, palette, config) => performanceBySetupOption(data as SetupPerfItem[], palette, {
      metric: (config.metric as string) ?? 'netPnl',
      visibleSeries: (config.visibleSeries as string[]) ?? ['netPnl'],
    }),
    series: ['netPnl', 'winRate', 'avgR', 'count'],
  },
  'performance-by-day-of-week': {
    extract: (c) => c.performanceByDayOfWeek as DayOfWeekData[],
    build: (data, palette, _config) => performanceByDayOfWeekOption(data as DayOfWeekData[], palette, ['netPnl']),
    series: ['netPnl'],
  },
  'performance-by-time-of-day': {
    extract: (c) => c.performanceByTimeOfDay as TimeOfDayData[],
    build: (data, palette, _config) => performanceByTimeOfDayOption(data as TimeOfDayData[], palette, ['netPnl']),
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
    build: (data, palette, _config) => longVsShortOption(data as LongVsShortItem[], palette, ['long', 'short']),
    series: ['long', 'short'],
  },
  'monthly-pnl': {
    extract: (c) => c.monthlyPerformance as MonthlyPerfItem[],
    build: (data, palette, _config) => monthlyPnlOption(data as MonthlyPerfItem[], palette, ['netPnl', 'winRate']),
    series: ['netPnl', 'winRate'],
  },
};

// ── Component ───────────────────────────────────────────────────────────────

export function ChartWidget({ instanceId, widgetType, config, onConfigChange, editMode }: ChartWidgetProps) {
  const { analyticsData, isLoading } = usePerformanceDashboard();
  const palette = useChartPalette();
  const [showSeriesMenu, setShowSeriesMenu] = useState(false);

  const extractor = CHART_EXTRACTORS[widgetType];
  const definition = PERFORMANCE_WIDGET_REGISTRY[widgetType];

  const option = useMemo(() => {
    if (!extractor || !analyticsData) return null;
    const charts = analyticsData.charts as Record<string, unknown>;
    const data = extractor.extract(charts);
    return extractor.build(data, palette, config);
  }, [extractor, analyticsData, palette, config]);

  if (!extractor || !definition) {
    return (
      <div className="border border-border rounded-lg p-4 bg-card h-full flex items-center justify-center text-sm text-muted-foreground">
        Unknown widget type: {widgetType}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card p-3 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium truncate">{typeof config.titleOverride === 'string' ? config.titleOverride : definition.title}</h4>
        {editMode && (
          <button
            onClick={() => setShowSeriesMenu((v) => !v)}
            className="text-xs px-1.5 py-0.5 rounded border border-border hover:bg-muted"
            aria-label={`Series visibility for ${definition.title}`}
          >
            {showSeriesMenu ? 'Hide series' : 'Series'}
          </button>
        )}
      </div>

      {showSeriesMenu && editMode && (
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          {extractor.series.map((s) => {
            const visible = (config.visibleSeries as string[] | undefined) ?? extractor.series;
            const isVisible = visible.includes(s);
            return (
              <label key={s} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={() => {
                    const current = (config.visibleSeries as string[] | undefined) ?? extractor.series;
                    const next = isVisible ? current.filter((x) => x !== s) : [...current, s];
                    onConfigChange?.(instanceId, { ...config, visibleSeries: next });
                  }}
                />
                {s}
              </label>
            );
          })}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {isLoading && !analyticsData ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : !option ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <DashboardChart option={option} flexHeight />
        )}
      </div>
    </div>
  );
}
