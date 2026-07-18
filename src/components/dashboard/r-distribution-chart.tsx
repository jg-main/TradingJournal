'use client';

import React from 'react';
import { TrendingUp } from 'lucide-react';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { DashboardChart } from '@/components/dashboard-chart';
import { EmptyState } from '@/components/empty-state';
import type { RDistributionBin } from '@/lib/dashboard';

// ── Types ──────────────────────────────────────────────────────────────

export interface RDistributionChartProps {
  /** R-multiple distribution bins for histogram display */
  rDistribution: RDistributionBin[];
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "R Distribution") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Chart Option Builder ───────────────────────────────────────────────

/**
 * Build the ECharts option for the R-multiple distribution histogram.
 *
 * Colour-coded bars:
 * - Negative R bins: red (#ef4444)
 * - Gray zone (-1 to 0): grey (#a1a1aa)
 * - Positive R bins: green (#22c55e)
 *
 * X-axis: Category axis with bin labels (rotated 30° for readability).
 * Y-axis: Trade count.
 */
function buildChartOption(rDistribution: RDistributionBin[]) {
  if (rDistribution.length === 0) return null;
  if (rDistribution.every((b) => b.count === 0)) return null;

  return {
    tooltip: {
      trigger: 'axis',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const idx = params[0].dataIndex;
        const bin = rDistribution[idx];
        if (!bin) return '';
        return `<strong>${bin.label}</strong><br/>Trades: ${bin.count}`;
      },
    },
    xAxis: {
      type: 'category' as const,
      data: rDistribution.map((b) => b.label),
      axisLabel: { rotate: 30 },
    },
    yAxis: { type: 'value' as const, name: 'Trades' },
    series: [
      {
        name: 'Trades',
        type: 'bar' as const,
        data: rDistribution.map((b) => {
          let color: string;
          if (b.label === '-1 to 0') {
            color = '#a1a1aa';
          } else if (['0 to 1', '1 to 2', '2 to 3', '> 3'].includes(b.label)) {
            color = '#22c55e';
          } else {
            color = '#ef4444';
          }
          return { value: b.count, itemStyle: { color } };
        }),
      },
    ],
    grid: { left: '10%', right: '5%', top: 20, bottom: 35 },
  };
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * R-multiple distribution histogram widget.
 *
 * Renders an ECharts bar chart showing the distribution of R-multiples
 * across closed trades, with colour-coded bars:
 * - Red: negative R (losing trades)
 * - Grey: scratch zone (-1 to 0)
 * - Green: positive R (winning trades)
 *
 * Wraps the chart in a DashboardWidget for consistent loading/error/empty
 * state handling.
 *
 * @example
 * ```tsx
 * <RDistributionChart
 *   rDistribution={data.rDistribution}
 * />
 * ```
 */
export function RDistributionChart({
  rDistribution,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'R Distribution',
  testId,
}: RDistributionChartProps) {
  const hasData = rDistribution.length > 0 && !rDistribution.every((b) => b.count === 0);
  const chartOption = hasData ? buildChartOption(rDistribution) : null;

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
            title="No R distribution data available"
            description="Your R-multiple distribution chart will appear here after you close trades with risk data."
          />
        </div>
      )}
      {hasData && chartOption && (
        <DashboardChart option={chartOption} flexHeight />
      )}
    </DashboardWidget>
  );
}
