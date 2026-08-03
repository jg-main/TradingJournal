'use client';

import React, { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { DashboardChart } from '@/components/dashboard-chart';
import { EmptyState } from '@/components/empty-state';
import { withAlpha, type ChartPalette } from '@/lib/chart-palette';
import { useChartPalette } from '@/hooks/use-chart-palette';
import type { EquityDataPoint, DrawdownDataPoint, TradeMarkerPoint } from '@/lib/equity';

// ── Types ──────────────────────────────────────────────────────────────

/** Minimal ECharts tooltip parameter shape used in dashboard charts. */
interface EChartsTooltipParam {
  seriesName?: string;
  data: number[];
  value: number[];
  dataIndex: number;
}

export interface EquityDrawdownChartProps {
  /** Equity curve data points (time series) */
  equityCurve: EquityDataPoint[];
  /** Drawdown data points (time series) */
  drawdown: DrawdownDataPoint[];
  /** Trade marker points for entry/exit annotations */
  tradeMarkers: TradeMarkerPoint[];
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "Equity & Drawdown") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Chart Option Builder ───────────────────────────────────────────────

/**
 * Build the ECharts option for the combined equity + drawdown chart.
 *
 * Dual Y-axes:
 * - Left: equity in currency ($)
 * - Right: drawdown as positive percentage (inverted, 0 at bottom)
 *
 * Series:
 * - Equity line with gradient area fill
 * - Entry/exit trade markers as scatter triangles
 * - Drawdown area line on right axis
 */
function buildChartOption(
  equityCurve: EquityDataPoint[],
  drawdown: DrawdownDataPoint[],
  tradeMarkers: TradeMarkerPoint[],
  palette: ChartPalette,
) {
  const hasEquity = equityCurve.length > 0;
  const hasDrawdown = drawdown.length > 0;
  const hasMarkers = tradeMarkers.length > 0;

  if (!hasEquity && !hasDrawdown) return null;

  // ── Compute drawdown max for axis scaling ───────────────────────
  const drawdownMax = hasDrawdown
    ? Math.max(...drawdown.map((dp) => Math.abs(dp.drawdownPct) * 100), 5)
    : 5;

  // ── Series ──────────────────────────────────────────────────────
  const series: Record<string, unknown>[] = [];

  // Equity line
  if (hasEquity) {
    series.push({
      name: 'Equity',
      type: 'line',
      yAxisIndex: 0,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      color: palette.primary,
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: withAlpha(palette.primary, 0.25) },
            { offset: 1, color: withAlpha(palette.primary, 0.01) },
          ],
        },
      },
      data: equityCurve.map(
        (dp) => [Date.parse(dp.date), dp.equity] as [number, number],
      ),
    });
  }

  // Drawdown area line (positive % on right axis)
  if (hasDrawdown) {
    series.push({
      name: 'Drawdown',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: palette.negative },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: withAlpha(palette.negative, 0.25) },
            { offset: 1, color: withAlpha(palette.negative, 0.02) },
          ],
        },
      },
      data: drawdown.map(
        (dp) => [Date.parse(dp.date), Math.abs(dp.drawdownPct) * 100] as [number, number],
      ),
    });
  }

  // Trade markers
  if (hasMarkers) {
    const entryMarkers = tradeMarkers.filter((m) => m.markerType === 'entry');
    if (entryMarkers.length > 0) {
      series.push({
        name: 'Entry',
        type: 'scatter',
        yAxisIndex: 0,
        symbol: 'triangle',
        symbolRotate: 0,
        symbolSize: 12,
        color: palette.positive,
        data: entryMarkers.map(
          (m) => [Date.parse(m.date), m.equity] as [number, number],
        ),
      });
    }

    const exitMarkers = tradeMarkers.filter((m) => m.markerType === 'exit');
    if (exitMarkers.length > 0) {
      series.push({
        name: 'Exit',
        type: 'scatter',
        yAxisIndex: 0,
        symbol: 'triangle',
        symbolRotate: 180,
        symbolSize: 12,
        color: palette.negative,
        data: exitMarkers.map(
          (m) => [Date.parse(m.date), m.equity] as [number, number],
        ),
      });
    }
  }

  // ── Tooltip ─────────────────────────────────────────────────────
  const tooltip = {
    trigger: 'axis',
    formatter: (params: EChartsTooltipParam[]) => {
      if (!Array.isArray(params) || params.length === 0) return '';

      // Check for trade marker hover
      const markerParam = params.find(
        (p) => p.seriesName === 'Entry' || p.seriesName === 'Exit',
      );
      if (markerParam && hasMarkers) {
        const marker = tradeMarkers.find(
          (m) => Date.parse(m.date) === markerParam.data[0] &&
                 m.equity === markerParam.data[1],
        );
        if (marker) {
          const dirLabel = marker.direction === 'long' ? 'Long' : 'Short';
          const typeLabel = marker.markerType === 'entry' ? 'Entry' : 'Exit';
          return [
            `<strong>${typeLabel} #${marker.tradeId}</strong>`,
            `Direction: ${dirLabel}`,
            `Price: $${marker.price.toFixed(2)}`,
            `P&amp;L: $${marker.pnl.toFixed(2)}`,
            `Equity: $${marker.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
          ].join('<br/>');
        }
      }

      // Equity line value
      const equityParam = params.find((p) => p.seriesName === 'Equity');
      if (equityParam && equityParam.value) {
        const equityVal = equityParam.value[1];
        if (equityVal !== undefined) {
          return `$${equityVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
      }

      // Drawdown value
      const drawdownParam = params.find((p) => p.seriesName === 'Drawdown');
      if (drawdownParam && drawdownParam.value) {
        const ddVal = drawdownParam.value[1];
        if (ddVal !== undefined) {
          return `Drawdown: ${ddVal.toFixed(1)}%`;
        }
      }

      return '';
    },
  };

  return {
    tooltip,
    xAxis: {
      type: 'time',
      axisLabel: { color: palette.axis },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: {
          color: palette.axis,
          formatter: '${value}',
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed',
            color: withAlpha(palette.grid, 0.5),
          },
        },
      },
      {
        type: 'value',
        min: 0,
        max: drawdownMax * 1.15, // 15% headroom
        inverse: false,
        axisLabel: {
          color: palette.axis,
          formatter: '{value}%',
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed',
            color: withAlpha(palette.grid, 0.5),
          },
        },
      },
    ],
    series,
    grid: {
      left: '10%',
      right: '10%',
      top: 20,
      bottom: 25,
    },
  };
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Combined equity curve and drawdown chart widget.
 *
 * Renders a single ECharts chart with dual Y-axes:
 * - Equity (currency) on the left axis
 * - Drawdown (percentage, inverted) on the right axis
 * - Interactive trade markers on the equity line
 *
 * Wraps the chart in a DashboardWidget for consistent loading/error/empty state handling.
 *
 * @example
 * ```tsx
 * <EquityDrawdownChart
 *   equityCurve={equityCurve}
 *   drawdown={drawdown}
 *   tradeMarkers={tradeMarkers}
 * />
 * ```
 */
export function EquityDrawdownChart({
  equityCurve,
  drawdown,
  tradeMarkers,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'Equity & Drawdown',
  testId,
}: EquityDrawdownChartProps) {
  const hasData = equityCurve.length > 0 || drawdown.length > 0;
  const palette = useChartPalette();
  const chartOption = useMemo(
    () =>
      hasData
        ? buildChartOption(equityCurve, drawdown, tradeMarkers, palette)
        : null,
    [hasData, equityCurve, drawdown, tradeMarkers, palette],
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
            icon={<TrendingUp className="size-10 text-muted-foreground" strokeWidth={1} />}
            title="No equity data available"
            description="Your combined equity and drawdown chart will appear here after you start trading."
          />
        </div>
      )}
      {hasData && chartOption && (
        <DashboardChart option={chartOption} flexHeight />
      )}
    </DashboardWidget>
  );
}
