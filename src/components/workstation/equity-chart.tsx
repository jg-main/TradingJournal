'use client';

// EquityChart — workstation-specific ECharts dual-Y-axis equity/drawdown chart
// with trade markers. Replaces the S01 placeholder sparkline.
//
// Layout: flex-based, fills the ws-panel-body height. Uses useChartResize to
// stay in sync with container dimensions on panel resize.
//
// Props receive equityCurve, drawdown, and tradeMarkers from the workstation
// context (DashboardResponse). S06 swaps the fixture source for live API data
// without touching this component.

import { useCallback, useRef } from 'react';
import type { ECharts } from 'echarts';
import ReactECharts from 'echarts-for-react';
import { useChartResize } from '@/hooks/use-chart-resize';
import type { EquityDataPoint, DrawdownDataPoint, TradeMarkerPoint } from '@/lib/equity';

export interface EquityChartProps {
  /** Equity curve data points (time series) */
  equityCurve: EquityDataPoint[];
  /** Drawdown data points (time series) */
  drawdown: DrawdownDataPoint[];
  /** Trade marker points for entry/exit annotations on the equity curve */
  tradeMarkers: TradeMarkerPoint[];
}

// ── ECharts Tooltip Param ───────────────────────────────────────────────

interface EChartsTooltipParam {
  seriesName?: string;
  data: number[];
  value: number[];
  dataIndex: number;
}

// ── Chart Option Builder ────────────────────────────────────────────────

/**
 * Build the ECharts option for the combined equity + drawdown chart.
 *
 * Dual Y-axes:
 * - Left: equity in currency ($)
 * - Right: drawdown as positive percentage (inverted, 0 at bottom)
 *
 * Series:
 * - Equity line with gradient area fill from blue to transparent
 * - Drawdown area line on right axis with red gradient fill
 * - Entry markers as green triangles (pointing up)
 * - Exit markers as red triangles (pointing down)
 *
 * Tooltips:
 * - Trade markers show trade ID, direction, symbol, price, P&L
 * - Equity line points show formatted currency value
 * - Drawdown line points show percentage
 */
function buildChartOption(
  equityCurve: EquityDataPoint[],
  drawdown: DrawdownDataPoint[],
  tradeMarkers: TradeMarkerPoint[],
) {
  const hasEquity = equityCurve.length > 0;
  const hasDrawdown = drawdown.length > 0;
  const hasMarkers = tradeMarkers.length > 0;

  if (!hasEquity && !hasDrawdown) return null;

  // ── Compute drawdown max for axis scaling ──────────────────────────
  const drawdownMax = hasDrawdown
    ? Math.max(...drawdown.map((dp) => Math.abs(dp.drawdownPct) * 100), 5)
    : 5;

  // ── Series ─────────────────────────────────────────────────────────
  const series: Record<string, unknown>[] = [];

  // Equity line with gradient area fill
  if (hasEquity) {
    series.push({
      name: 'Equity',
      type: 'line',
      yAxisIndex: 0,
      smooth: true,
      showSymbol: false,
      symbol: 'none',
      lineStyle: { width: 2 },
      color: '#2563eb',
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(37, 99, 235, 0.25)' },
            { offset: 1, color: 'rgba(37, 99, 235, 0.01)' },
          ],
        },
      },
      data: equityCurve.map(
        (dp) => [Date.parse(dp.date), dp.equity] as [number, number],
      ),
    });
  }

  // Drawdown area line on right axis (positive percentage, inverted at the
  // data level so 0 is the chart bottom and larger values are deeper drawdowns)
  if (hasDrawdown) {
    series.push({
      name: 'Drawdown',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      showSymbol: false,
      symbol: 'none',
      lineStyle: { width: 2, color: '#ef4444' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(239, 68, 68, 0.25)' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.02)' },
          ],
        },
      },
      data: drawdown.map(
        (dp) =>
          [Date.parse(dp.date), Math.abs(dp.drawdownPct) * 100] as [
            number,
            number,
          ],
      ),
    });
  }

  // Trade entry markers — green triangle pointing up
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
        color: '#22c55e',
        data: entryMarkers.map(
          (m) => [Date.parse(m.date), m.equity] as [number, number],
        ),
      });
    }

    // Trade exit markers — red triangle pointing down
    const exitMarkers = tradeMarkers.filter((m) => m.markerType === 'exit');
    if (exitMarkers.length > 0) {
      series.push({
        name: 'Exit',
        type: 'scatter',
        yAxisIndex: 0,
        symbol: 'triangle',
        symbolRotate: 180,
        symbolSize: 12,
        color: '#ef4444',
        data: exitMarkers.map(
          (m) => [Date.parse(m.date), m.equity] as [number, number],
        ),
      });
    }
  }

  // ── Tooltip ────────────────────────────────────────────────────────
  const tooltip = {
    trigger: 'axis',
    formatter: (params: EChartsTooltipParam[]) => {
      if (!Array.isArray(params) || params.length === 0) return '';

      // Trade marker hover: show trade detail including symbol
      const markerParam = params.find(
        (p) => p.seriesName === 'Entry' || p.seriesName === 'Exit',
      );
      if (markerParam && hasMarkers) {
        const marker = tradeMarkers.find(
          (m) =>
            Date.parse(m.date) === markerParam.data[0] &&
            m.equity === markerParam.data[1],
        );
        if (marker) {
          const dirLabel = marker.direction === 'long' ? 'Long' : 'Short';
          const typeLabel = marker.markerType === 'entry' ? 'Entry' : 'Exit';
          const lines: string[] = [
            `<strong>${typeLabel} #${marker.tradeId}</strong>`,
            `Symbol: ${marker.symbol || '—'}`,
            `Direction: ${dirLabel}`,
            `Price: $${marker.price.toFixed(2)}`,
            `P&amp;L: $${marker.pnl.toFixed(2)}`,
            `Equity: $${marker.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
          ];
          return lines.join('<br/>');
        }
      }

      // Equity line tooltip
      const equityParam = params.find((p) => p.seriesName === 'Equity');
      if (equityParam && equityParam.value) {
        const equityVal = equityParam.value[1];
        if (equityVal !== undefined) {
          return `$${equityVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
      }

      // Drawdown tooltip
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

  // ── Grid ───────────────────────────────────────────────────────────
  // Workstation panel body is narrower than the full-viewport dashboard, so
  // the grid margins are slightly larger percentage values to avoid axis
  // label clipping on small panel widths.
  const grid = {
    left: '12%',
    right: '12%',
    top: 20,
    bottom: 25,
  };

  return {
    tooltip,
    grid,
    xAxis: {
      type: 'time',
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: {
          formatter: '${value}',
        },
      },
      {
        type: 'value',
        min: 0,
        max: drawdownMax * 1.15,
        inverse: false,
        axisLabel: {
          formatter: '{value}%',
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed',
            color: 'rgba(0,0,0,0.06)',
          },
        },
      },
    ],
    series,
  };
}

// ── Component ───────────────────────────────────────────────────────────

/**
 * Workstation equity/drawdown ECharts chart with trade markers.
 *
 * Replaces the S01 placeholder sparkline inside the equity panel body.
 * Renders a flex-based ECharts chart that fills available vertical space.
 * Uses ResizeObserver (via useChartResize) to stay in sync with the
 * panel width as the user resizes or switches scenarios.
 *
 * Empty state: when equityCurve is empty, renders the `ws-equity-chart-empty`
 * testid element so Playwright and human readers see a clear diagnostic
 * instead of a blank panel body.
 *
 * @example
 * ```tsx
 * <EquityChart
 *   equityCurve={dashboard.equityCurve}
 *   drawdown={dashboard.drawdown}
 *   tradeMarkers={dashboard.tradeMarkers ?? []}
 * />
 * ```
 */
export function EquityChart({
  equityCurve,
  drawdown,
  tradeMarkers,
}: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const echartsInstanceRef = useRef<ECharts | null>(null);

  useChartResize(containerRef, echartsInstanceRef);

  const handleChartReady = useCallback((instance: ECharts) => {
    echartsInstanceRef.current = instance;
  }, []);

  const isEmpty = equityCurve.length === 0;
  const chartOption = !isEmpty
    ? buildChartOption(equityCurve, drawdown, tradeMarkers)
    : null;

  if (isEmpty) {
    return (
      <div
        className="ws-empty"
        data-testid="ws-equity-chart-empty"
      >
        No equity history
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="ws-chart-container"
      data-testid="ws-equity-chart"
    >
      {chartOption && (
        <ReactECharts
          option={chartOption}
          notMerge
          lazyUpdate
          onChartReady={handleChartReady}
          opts={{ renderer: 'canvas' }}
          autoResize
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </div>
  );
}
