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
import {
  convertCurrencyValue,
  type PerformanceUnitContext,
  type SupportedUnit,
} from './performance-kpi-catalogue';

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

/**
 * Per-widget chart rendering options surfaced by the Configure dialog and the
 * global unit selector. Visible series are passed positionally (legacy
 * contract); legend visibility and the global `$ / % / R` presentation unit
 * travel via this options object.
 */
export interface ChartRenderConfig {
  /** Render the ECharts legend (dense workstation default: hidden). */
  legendVisible?: boolean;
  /** Global performance unit applied to convertible series (default currency). */
  unit?: SupportedUnit;
  /** % denominator for the selected analytical scope (metadata.periodStartEquity). */
  periodStartEquity?: number | null;
  /** R denominator for the selected analytical scope (metadata.totalInitialRisk). */
  totalInitialRisk?: number | null;
}

/** Canonical denominators extracted from the render config for conversion. */
function unitContext(options: ChartRenderConfig = {}): PerformanceUnitContext {
  return {
    periodStartEquity: options.periodStartEquity ?? null,
    totalInitialRisk: options.totalInitialRisk ?? null,
  };
}

/**
 * Convert a currency series value under the selected global unit using the
 * shared presentation conversion layer (same semantics as KpiCard). Returns
 * null (unavailable) when the target unit's denominator is absent — never a
 * fabricated 0.
 */
function convertPnl(value: number, options: ChartRenderConfig = {}): number | null {
  return convertCurrencyValue(value, options.unit ?? 'currency', unitContext(options));
}

/** Legend configuration — absent (undefined) when the dense default applies. */
function legend(options: ChartRenderConfig = {}): EChartsOption['legend'] {
  return options.legendVisible
    ? { show: true, top: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 10 } }
    : undefined;
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
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const show = visibleSeries.includes('cumulativePnl');
  // Cumulative P&L is a convertible currency series: under global % / R the
  // values become percent-of-equity / R-multiples of the same line shape.
  const seriesData = show ? data.map((d) => convertPnl(d.cumulativePnl, options)) : [];
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.date) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Cumulative P&L',
        type: 'line',
        data: seriesData,
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
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const show = visibleSeries.includes('netPnl');
  // Daily P&L is convertible: under % / R each bar becomes percent-of-equity
  // / R-multiple using the same selected-scope denominators (sign preserved
  // for profit/loss coloring; null = unavailable).
  const bars = show
    ? data.map((d) => {
        const v = convertPnl(d.netPnl, options);
        return { value: v, itemStyle: { color: (v ?? 0) >= 0 ? palette.positive : palette.negative } };
      })
    : [];
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.date) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: bars,
      },
    ],
  };
}

/** Trade Duration Performance — bar chart by duration bucket. */
export function tradeDurationOption(
  data: DurationBucketData[],
  palette: ChartPalette,
  visibleSeries: string[] = ['netPnl'],
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.some((d) => d.count > 0) === false) return null;
  const show = visibleSeries.includes('netPnl');
  // Net P&L series is convertible; count/winRate stay fixed-semantic.
  const bars = show
    ? data.map((d) => {
        const v = convertPnl(d.netPnl, options);
        return { value: v, itemStyle: { color: (v ?? 0) >= 0 ? palette.positive : palette.negative } };
      })
    : [];
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.bucket) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: bars,
      },
    ],
  };
}

/** Drawdown Curve — area chart. */
export function drawdownCurveOption(
  data: DrawdownPoint[],
  palette: ChartPalette,
  visibleSeries: string[] = ['drawdownAmount', 'drawdownPct'],
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const showAmount = visibleSeries.includes('drawdownAmount');
  const showPct = visibleSeries.includes('drawdownPct');
  // drawdownAmount is a currency magnitude (convertible under % per the
  // registry declaration); drawdownPct is already a native percentage of peak
  // equity and stays fixed-semantic.
  const amountSeries = showAmount ? data.map((d) => convertPnl(d.drawdownAmount, options)) : [];
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.date) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Drawdown $',
        type: 'line',
        data: amountSeries,
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
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const show = visibleSeries.includes('count');
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
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
  config: { metric?: string; visibleSeries?: string[] } & ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const metric = config.metric ?? 'netPnl';
  const show = config.visibleSeries?.includes(metric) ?? true;

  // Only the Net P&L metric is convertible under the global unit. Win Rate,
  // Average R, and Trade Count keep their fixed semantics — selecting global
  // R must never transform Win Rate into an R-like number.
  const values = data.map((d) => {
    if (metric === 'winRate') return d.winRate ?? null;
    if (metric === 'avgR') return d.avgR ?? null;
    if (metric === 'count') return d.count;
    return convertPnl(d.netPnl, config);
  });

  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(config),
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
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const show = visibleSeries.includes('netPnl');
  // Net P&L series is convertible under the global unit.
  const bars = show
    ? data.map((d) => {
        const v = convertPnl(d.netPnl, options);
        return { value: v, itemStyle: { color: (v ?? 0) >= 0 ? palette.positive : palette.negative } };
      })
    : [];
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.day) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: bars,
      },
    ],
  };
}

/** Performance by Time of Day — bar chart. */
export function performanceByTimeOfDayOption(
  data: TimeOfDayData[],
  palette: ChartPalette,
  visibleSeries: string[] = ['netPnl'],
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.every((d) => d.netPnl === 0)) return null;
  const show = visibleSeries.includes('netPnl');
  // Net P&L series is convertible under the global unit.
  const bars = show ? data.map((d) => convertPnl(d.netPnl, options)) : [];
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
    xAxis: { ...(axisLabel() as object), data: data.map((d) => d.hour) } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: bars,
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
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const long = data.find((d) => d.direction === 'long');
  const short = data.find((d) => d.direction === 'short');

  // Net P&L per direction is convertible under the global unit.
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
    xAxis: { ...(axisLabel() as object), data: ['Net P&L'] } as EChartsOption['xAxis'],
    yAxis: valueAxis(),
    series: [
      {
        name: 'Long',
        type: 'bar',
        data: visibleSeries.includes('long') && long ? [convertPnl(long.netPnl, options)] : [],
        itemStyle: { color: palette.positive },
      },
      {
        name: 'Short',
        type: 'bar',
        data: visibleSeries.includes('short') && short ? [convertPnl(short.netPnl, options)] : [],
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
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const showNet = visibleSeries.includes('netPnl');
  const showWin = visibleSeries.includes('winRate');
  // Net P&L bars are convertible under the global unit; Win Rate line stays
  // fixed-semantic on its own percent axis (never becomes an R-like number).
  const netBars = showNet
    ? data.map((d) => {
        const v = convertPnl(d.netPnl, options);
        return { value: v, itemStyle: { color: (v ?? 0) >= 0 ? palette.positive : palette.negative } };
      })
    : [];
  return {
    tooltip: tooltip(),
    grid: baseGrid(),
    legend: legend(options),
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
        data: netBars,
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
