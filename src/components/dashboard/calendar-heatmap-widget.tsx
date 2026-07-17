'use client';

import React, { useState, useMemo } from 'react';
import { Calendar } from 'lucide-react';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { DashboardChart } from '@/components/dashboard-chart';
import { EmptyState } from '@/components/empty-state';
import { toEChartsCalendarData, type CalendarHeatmapYearData } from '@/lib/calendar-heatmap';
import { formatCurrency } from '@/components/dashboard/formatting';

// ── Types ──────────────────────────────────────────────────────────────

export interface CalendarHeatmapWidgetProps {
  /** Calendar heatmap data grouped by year (from API) */
  heatmapData: CalendarHeatmapYearData[];
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "Calendar Heatmap") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Palette ────────────────────────────────────────────────────────────

/**
 * Green-red symmetrical colour palette for daily P&L.
 * Index 0 = most negative (deep red), centre = neutral, last = most positive (deep green).
 * ECharts visualMap will interpolate through these stops.
 */
const PNL_COLORS = [
  '#7f1d1d', // -max: dark red
  '#dc2626', // strong red
  '#fca5a5', // light red
  '#fef2f2', // near-zero negative
  '#f0fdf4', // near-zero positive
  '#86efac', // light green
  '#22c55e', // strong green
  '#166534', // +max: dark green
];

// ── Chart Option Builder ───────────────────────────────────────────────

/**
 * Build the ECharts option for a single-year calendar heatmap.
 *
 * Uses ECharts' calendar coordinate system with:
 * - A visualMap for green/red P&L intensity colouring
 * - Day-of-week and month labels
 * - Custom tooltip showing date and P&L
 *
 * @param yearData One year's worth of calendar heatmap data
 * @returns ECharts option object, or null if no data
 */
function buildChartOption(yearData: CalendarHeatmapYearData): Record<string, unknown> | null {
  if (!yearData || yearData.days.length === 0) return null;

  const echartsData = toEChartsCalendarData(yearData);
  const yearStr = String(yearData.year);

  // Compute symmetrical range for visualMap
  let maxAbs = 1;
  for (const [, pnl] of echartsData) {
    const abs = Math.abs(pnl);
    if (abs > maxAbs) maxAbs = abs;
  }

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: { value: [string, number] }) => {
        if (!params || !params.value) return '';
        const [dateStr, pnl] = params.value;
        const dayLabel = dateStr.slice(5); // MM-DD
        return `<strong>${dayLabel}</strong><br/>P&amp;L: ${formatCurrency(pnl, { sign: true })}`;
      },
    },
    visualMap: {
      min: -maxAbs,
      max: maxAbs,
      inRange: {
        color: PNL_COLORS,
      },
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 100,
      formatter: (value: number) => formatCurrency(value, { sign: true }),
      textStyle: {
        fontSize: 10,
      },
    },
    calendar: [
      {
        range: yearStr,
        cellSize: ['auto', 15],
        orient: 'horizontal',
        splitLine: {
          show: true,
          lineStyle: {
            color: '#e4e4e7',
            width: 1,
          },
        },
        itemStyle: {
          borderWidth: 0,
        },
        dayLabel: {
          show: true,
          firstDay: 0,
          nameMap: 'en',
          margin: 5,
        },
        monthLabel: {
          show: true,
          margin: 8,
          position: 'start',
        },
        yearLabel: {
          show: true,
          position: 'top',
          margin: 10,
          fontWeight: 'bold',
          fontSize: 14,
        },
      },
    ],
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: echartsData,
      },
    ],
    grid: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
  };
}

/**
 * Pick the latest year index from the heatmap data.
 *
 * Iterates the data to find the most recent year with the most recent
 * activity. Falls back to index 0 if data is non-empty.
 */
function getDefaultYearIndex(data: CalendarHeatmapYearData[]): number {
  if (data.length === 0) return -1;
  if (data.length === 1) return 0;

  // Find the year with the most recent data
  let latestIdx = 0;
  let latestDate = '';
  for (let i = 0; i < data.length; i++) {
    const days = data[i].days;
    if (days.length === 0) continue;
    const lastDay = days[days.length - 1].date;
    if (lastDay > latestDate) {
      latestDate = lastDay;
      latestIdx = i;
    }
  }
  return latestIdx;
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Calendar heatmap widget showing daily P&L as coloured cells on a
 * yearly calendar grid.
 *
 * Green cells = profit days, red cells = loss days, colour intensity
 * scaled by P&L magnitude. Supports year-to-year navigation when data
 * spans multiple years.
 *
 * Wraps the chart in a DashboardWidget for consistent loading/error/empty
 * state handling.
 *
 * @example
 * ```tsx
 * <CalendarHeatmapWidget
 *   heatmapData={data.calendarHeatmap}
 *   isLoading={loading}
 * />
 * ```
 */
export function CalendarHeatmapWidget({
  heatmapData,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'Calendar Heatmap',
  testId,
}: CalendarHeatmapWidgetProps) {
  const defaultIdx = useMemo(() => getDefaultYearIndex(heatmapData), [heatmapData]);
  const [selectedYearIdx, setSelectedYearIdx] = useState(defaultIdx);

  // Reset selected year index when data changes (e.g. filter applied)
  React.useEffect(() => {
    setSelectedYearIdx(getDefaultYearIndex(heatmapData));
  }, [heatmapData]);

  const hasData = heatmapData.length > 0 && heatmapData.some((yd) => yd.days.length > 0);
  const yearData = hasData && selectedYearIdx >= 0 && selectedYearIdx < heatmapData.length
    ? heatmapData[selectedYearIdx]
    : null;
  const chartOption = yearData ? buildChartOption(yearData) : null;

  // P&L summary stats for the selected year
  const stats = useMemo(() => {
    if (!hasData || !yearData) return null;
    const days = yearData.days;
    if (days.length === 0) return null;

    let profitDays = 0;
    let lossDays = 0;
    let totalPnl = 0;
    let bestDay = -Infinity;
    let worstDay = Infinity;

    for (const day of days) {
      totalPnl += day.pnl;
      if (day.pnl > 0) {
        profitDays++;
        if (day.pnl > bestDay) bestDay = day.pnl;
      } else if (day.pnl < 0) {
        lossDays++;
        if (day.pnl < worstDay) worstDay = day.pnl;
      }
    }

    return { profitDays, lossDays, totalPnl, bestDay, worstDay };
  }, [hasData, yearData]);

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
            icon={<Calendar className="size-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
            title="No calendar data available"
            description="Your daily P&L calendar heatmap will appear here after you close trades."
          />
        </div>
      )}
      {hasData && (
        <>
          {/* Year selector for multi-year data */}
          {heatmapData.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1 px-(--card-spacing)">
              {heatmapData.map((yd, idx) => (
                <button
                  key={yd.year}
                  onClick={() => setSelectedYearIdx(idx)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    idx === selectedYearIdx
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/30 dark:text-blue-300'
                      : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  {yd.year}
                </button>
              ))}
            </div>
          )}

          {/* Quick stats row */}
          {stats && (
            <div className="mb-3 grid grid-cols-4 gap-2 px-(--card-spacing) text-center text-xs">
              <div>
                <span className="block font-semibold tabular-nums text-green-600 dark:text-green-400">
                  {stats.profitDays}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">Winners</span>
              </div>
              <div>
                <span className="block font-semibold tabular-nums text-red-600 dark:text-red-400">
                  {stats.lossDays}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">Losers</span>
              </div>
              <div>
                <span className={`block font-semibold tabular-nums ${stats.totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {formatCurrency(stats.totalPnl, { sign: true })}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">Net P&amp;L</span>
              </div>
              <div>
                <span className="block font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                  {((stats.profitDays + stats.lossDays) > 0
                    ? (stats.profitDays / (stats.profitDays + stats.lossDays) * 100).toFixed(0)
                    : 0)}%
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">Win Rate</span>
              </div>
            </div>
          )}

          {/* Calendar heatmap chart */}
          {chartOption && (
            <DashboardChart option={chartOption} height={300} />
          )}
        </>
      )}
    </DashboardWidget>
  );
}
