'use client';

import React, { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { DashboardChart } from '@/components/dashboard-chart';
import { EmptyState } from '@/components/empty-state';
import { withAlpha, type ChartPalette } from '@/lib/chart-palette';
import { useChartPalette } from '@/hooks/use-chart-palette';
import {
  formatCurrency,
  formatPercent,
} from '@/components/dashboard/formatting';
import type { MonthlyPerformanceItem } from '@/lib/dashboard';

// ── Types ──────────────────────────────────────────────────────────────

export interface MonthlyPerformanceChartProps {
  /** Monthly performance data points (time series) */
  monthlyPerformance: MonthlyPerformanceItem[];
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "Monthly Performance") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Chart Option Builder ───────────────────────────────────────────────

/**
 * Build the ECharts option for the monthly performance bar + line chart.
 *
 * Dual Y-axes:
 * - Left: Net P&L in currency ($) as bars (green positive, red negative)
 * - Right: Win Rate as percentage (0–1) as smoothed line
 *
 * X-axis: Category axis with month labels (YYYY-MM), showing only MM part.
 */
function buildChartOption(monthlyPerformance: MonthlyPerformanceItem[], palette: ChartPalette) {
  if (monthlyPerformance.length === 0) return null;

  return {
    tooltip: {
      trigger: 'axis',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const idx = params[0].dataIndex;
        const item = monthlyPerformance[idx];
        if (!item) return '';
        return [
          `<strong>${item.month}</strong>`,
          `P&amp;L: ${formatCurrency(item.netPnl, { sign: true })}`,
          `Win Rate: ${formatPercent(item.winRate)}`,
          `Trades: ${item.tradeCount}`,
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'category' as const,
      data: monthlyPerformance.map((m) => m.month),
      axisLabel: { color: palette.axis, formatter: (v: string) => v.slice(5) },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: [
      {
        type: 'value' as const,
        name: 'P&L ($)',
        nameTextStyle: { color: palette.axis },
        axisLabel: { color: palette.axis },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed',
            color: withAlpha(palette.grid, 0.5),
          },
        },
      },
      {
        type: 'value' as const,
        name: 'Win Rate',
        nameTextStyle: { color: palette.axis },
        min: 0,
        max: 1,
        axisLabel: {
          color: palette.axis,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        },
        splitLine: {
          show: false,
        },
      },
    ],
    series: [
      {
        name: 'Net P&L',
        type: 'bar' as const,
        data: monthlyPerformance.map((m) => ({
          value: m.netPnl,
          itemStyle: {
            color: m.netPnl >= 0 ? palette.positive : palette.negative,
            borderColor: palette.primary,
            borderWidth: 1,
          },
        })),
      },
      {
        name: 'Win Rate',
        type: 'line' as const,
        yAxisIndex: 1,
        data: monthlyPerformance.map((m) => m.winRate ?? 0),
        smooth: true,
        color: palette.primary,
        symbol: 'none',
      },
    ],
    grid: { left: '10%', right: '10%', top: 20, bottom: 25 },
  };
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Monthly Performance bar + line chart widget.
 *
 * Renders a combined ECharts chart with:
 * - P&L bars (green positive, red negative) on the left axis
 * - Win Rate line on the right axis
 *
 * Wraps the chart in a DashboardWidget for consistent loading/error/empty
 * state handling.
 *
 * @example
 * ```tsx
 * <MonthlyPerformanceChart
 *   monthlyPerformance={data.monthlyPerformance}
 * />
 * ```
 */
export function MonthlyPerformanceChart({
  monthlyPerformance,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'Monthly Performance',
  testId,
}: MonthlyPerformanceChartProps) {
  const hasData = monthlyPerformance.length > 0;
  const palette = useChartPalette();
  const chartOption = useMemo(
    () => (hasData ? buildChartOption(monthlyPerformance, palette) : null),
    [hasData, monthlyPerformance, palette],
  );

  return (
    <DashboardWidget
      title={title}
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty && !isLoading}
      testId={testId}
    >
      {!hasData && !isLoading && (
        <div className="px-(--card-spacing) pb-(--card-spacing)">
          <EmptyState
            icon={
              <TrendingUp
                className="size-10 text-zinc-300 dark:text-zinc-600"
                strokeWidth={1}
              />
            }
            title="No monthly data available"
            description="Your monthly performance chart will appear here after you close trades across multiple months."
          />
        </div>
      )}
      {hasData && chartOption && (
        <DashboardChart option={chartOption} flexHeight />
      )}
    </DashboardWidget>
  );
}
