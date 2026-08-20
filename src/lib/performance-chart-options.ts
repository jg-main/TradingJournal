/**
 * Performance Chart Option Builders
 *
 * Pure ECharts option builders for the 10 Performance dashboard charts.
 * Each builder accepts the chart data slice from the analytics API response,
 * optional visibleSeries, and a palette; returns an EChartsOption or null
 * when there is no data to render.
 *
 * Pattern: mirrors the option builders in src/components/dashboard/*-chart.tsx
 * but as pure functions for testability.
 */

import type { EChartsOption } from 'echarts-for-react';
import type { ChartPalette } from './chart-palette';

// ── Shared helpers ──────────────────────────────────────────────────────────

function baseGrid(): EChartsOption['grid'] {
  return { left: 8, right: 8, top: 24, bottom: 8, containLabel: true };
}

function axisLabel(): EChartsOption['xAxis'] {
  return {
    type: 'category',
    axisLabel: { color: undefined, fontSize: 10 },
    axisLine: { lineStyle: { color: undefined } },
  };
}

function valueAxis(name?: string): EChartsOption['yAxis'] {
  return {
    type: 'value',
    name,
    axisLabel: { fontSize: 10 },
    splitLine: { lineStyle: { type: 'dashed' } },
  };
}

function tooltip(): EChartsOption['tooltip'] {
  return { trigger: 'axis' };
}

// ── Chart data input types ──────────────────────────────────────────────────

export interface DailyPnlPoint {
  date: string;
  netPnl: number;
}

export interface CumulativePnlPoint {
  date: string;
  cumulativePnl: number;
}

export interface DurationBucketData {
  bucket: string;
  netPnl: number;
  count: number;
  winRate: number | null;
}

export interface DrawdownPoint {
  date: string;
  drawdownAmount: number;
  drawdownPct: number;
}

export interface RDistributionItem {
  label: string;
  count: number;
}

export interface SetupPerfItem {
  setup: string;
  netPnl: number;
  winRate: number | null;
  avgR: number | null;
  count: number;
}

export interface DayOfWeekData {
  day: string;
  netPnl: number;
  count: number;
  winRate: number | null;
}

export interface TimeOfDayData {
  hour: string;
  netPnl: number;
  count: number;
}

export interface LongVsShortItem {
  direction: 'long' | 'short';
  netPnl: number;
  count: number;
  winRate: number | null;
}

export interface MonthlyPerfItem {
  month: string;
  netPnl: number;
  winRate: number | null;
}

// ── Builders ────────────────────────────────────────────────────────────────

/** Daily Cumulative P&L — line chart. */
export function dailyCumulativePnlOption(
  data: CumulativePnlPoint[],
  palette: ChartPalette,
  visibleSeries: string[] = ['cumulativePnl'],
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const show = visibleSeries.includes('cumulativePnl');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.date) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Cumulative P&L',
        type: 'line',
        data: show ? data.map((d) => d.cumulativePnl) : [],
        showSymbol: false,
        smooth: true,
        lineStyle: { color: palette.primary, width: 2 },
        itemStyle: { color: palette.primary },
        areaStyle: show ? { color: palette.primary, opacity: 0.08 } : undefined,
      },
    ],
  };
}

/** Net Daily P&L — bar chart with profit/loss coloring. */
export function netDailyPnlOption(
  data: DailyPnlPoint[],
  palette: ChartPalette,
  visibleSeries: string[] = ['netPnl'],
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const show = visibleSeries.includes('netPnl');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.date) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: show
          ? data.map((d) => ({
              value: d.netPnl,
              itemStyle: { color: d.netPnl >= 0 ? palette.positive : palette.negative },
            }))
          : [],
      },
    ],
  };
}

/** Trade Duration Performance — bar chart by duration bucket. */
export function tradeDurationOption(
  data: DurationBucketData[],
  palette: ChartPalette,
  visibleSeries: string[] = ['netPnl'],
): EChartsOption | null {
  if (!data || data.some((d) => d.count > 0) === false) return null;
  const show = visibleSeries.includes('netPnl');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.bucket) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: show
          ? data.map((d) => ({
              value: d.netPnl,
              itemStyle: { color: d.netPnl >= 0 ? palette.positive : palette.negative },
            }))
          : [],
      },
    ],
  };
}

/** Drawdown Curve — area chart. */
export function drawdownCurveOption(
  data: DrawdownPoint[],
  palette: ChartPalette,
  visibleSeries: string[] = ['drawdownAmount'],
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const showAmount = visibleSeries.includes('drawdownAmount');
  const showPct = visibleSeries.includes('drawdownPct');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.date) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Drawdown $',
        type: 'line',
        data: showAmount ? data.map((d) => d.drawdownAmount) : [],
        showSymbol: false,
        lineStyle: { color: palette.warning, width: 2 },
        itemStyle: { color: palette.warning },
        areaStyle: showAmount ? { color: palette.warning, opacity: 0.1 } : undefined,
      },
      {
        name: 'Drawdown %',
        type: 'line',
        data: showPct ? data.map((d) => d.drawdownPct) : [],
        showSymbol: false,
        lineStyle: { color: palette.negative, width: 2 },
        itemStyle: { color: palette.negative },
        areaStyle: showPct ? { color: palette.negative, opacity: 0.08 } : undefined,
      },
    ],
  };
}

/** R-Multiple Distribution — bar chart of bucket counts. */
export function rDistributionOption(
  data: RDistributionItem[],
  palette: ChartPalette,
  visibleSeries: string[] = ['count'],
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const show = visibleSeries.includes('count');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.label) } as EChartsOption['xAxis'],
    yAxis: valueAxis('Trades'),
    series: [
      {
        name: 'Count',
        type: 'bar',
        data: show ? data.map((d) => d.count) : [],
        itemStyle: { color: palette.info },
      },
    ],
  };
}

/** Performance by Setup — bar chart with selectable metric. */
export function performanceBySetupOption(
  data: SetupPerfItem[],
  palette: ChartPalette,
  config: { metric?: string; visibleSeries?: string[] } = {},
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const metric = config.metric ?? 'netPnl';
  const show = config.visibleSeries?.includes(metric) ?? true;

  const values = data.map((d) => {
    if (metric === 'winRate') return d.winRate ?? null;
    if (metric === 'avgR') return d.avgR ?? null;
    if (metric === 'count') return d.count;
    return d.netPnl;
  });

  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.setup) } as EChartsOption['xAxis'],
    yAxis: valueAxis(metric === 'winRate' ? 'Win Rate' : undefined),
    series: [
      {
        name: metric,
        type: 'bar',
        data: show ? values : [],
        itemStyle: { color: palette.primary },
      },
    ],
  };
}

/** Performance by Day of Week — bar chart. */
export function performanceByDayOfWeekOption(
  data: DayOfWeekData[],
  palette: ChartPalette,
  visibleSeries: string[] = ['netPnl'],
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const show = visibleSeries.includes('netPnl');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.day) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: show
          ? data.map((d) => ({
              value: d.netPnl,
              itemStyle: { color: d.netPnl >= 0 ? palette.positive : palette.negative },
            }))
          : [],
      },
    ],
  };
}

/** Performance by Time of Day — bar chart. */
export function performanceByTimeOfDayOption(
  data: TimeOfDayData[],
  palette: ChartPalette,
  visibleSeries: string[] = ['netPnl'],
): EChartsOption | null {
  if (!data || data.every((d) => d.netPnl === 0)) return null;
  const show = visibleSeries.includes('netPnl');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.hour) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: show ? data.map((d) => d.netPnl) : [],
        itemStyle: { color: palette.info },
      },
    ],
  };
}

/** Long vs Short — grouped bar chart. */
export function longVsShortOption(
  data: LongVsShortItem[],
  palette: ChartPalette,
  visibleSeries: string[] = ['long', 'short'],
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const long = data.find((d) => d.direction === 'long');
  const short = data.find((d) => d.direction === 'short');

  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: ['Net P&L'] } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Long',
        type: 'bar',
        data: visibleSeries.includes('long') && long ? [long.netPnl] : [],
        itemStyle: { color: palette.positive },
      },
      {
        name: 'Short',
        type: 'bar',
        data: visibleSeries.includes('short') && short ? [short.netPnl] : [],
        itemStyle: { color: palette.negative },
      },
    ],
  };
}

/** Monthly P&L — bar + win-rate line dual axis. */
export function monthlyPnlOption(
  data: MonthlyPerfItem[],
  palette: ChartPalette,
  visibleSeries: string[] = ['netPnl', 'winRate'],
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const showNet = visibleSeries.includes('netPnl');
  const showWin = visibleSeries.includes('winRate');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.month) } as EChartsOption['xAxis'],
    yAxis: [
      valueAxis(),
      {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` },
        splitLine: { show: false },
        max: 1,
        min: 0,
      },
    ],
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: showNet
          ? data.map((d) => ({
              value: d.netPnl,
              itemStyle: { color: d.netPnl >= 0 ? palette.positive : palette.negative },
            }))
          : [],
      },
      {
        name: 'Win Rate',
        type: 'line',
        yAxisIndex: 1,
        data: showWin ? data.map((d) => d.winRate ?? null) : [],
        showSymbol: false,
        smooth: true,
        lineStyle: { color: palette.primary, width: 2 },
        itemStyle: { color: palette.primary },
      },
    ],
  };
}
