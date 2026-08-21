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
import type { CallbackDataParams } from 'echarts/types/dist/shared';
import type { ChartPalette } from './chart-palette';
import {
  convertCurrencyValue,
  type PerformanceUnitContext,
  type SupportedUnit,
} from './performance-kpi-catalogue';

// ── Unit-aware number formatting (shared presentation contract) ─────────────

/**
 * Axis/presentation unit: the four performance units plus `count` for
 * trade-count series (R-Distribution, Trade Duration Trades row, Setup Trades
 * metric). `count` renders as integers and never converts.
 */
export type ChartAxisUnit = SupportedUnit | 'count';

/**
 * Compact axis label for a value in the given presentation unit.
 *
 * - currency: $0 / $500 / $1k / $2.5k / -$1.5k
 * - percent: internal ratio → 2.5% / -4%
 * - r: 0R / 0.5R / 1.25R / -1R
 * - count/fixed: integer
 */
export function formatAxisValue(value: number, unit: ChartAxisUnit): string {
  if (!Number.isFinite(value)) return '';
  if (unit === 'percent') return formatPercentValue(value);
  if (unit === 'r') return formatRValue(value);
  if (unit === 'count' || unit === 'fixed') return String(Math.round(value));
  return formatCompactCurrency(value);
}

/** Compact currency axis label: $0 / $500 / $1k / $2.5k / -$1.5k. */
function formatCompactCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const k = abs / 1000;
    const kLabel = k >= 100 ? String(Math.round(k)) : String(Number(k.toFixed(1)));
    return `${sign}$${kLabel}k`;
  }
  return `${sign}$${abs}`;
}

/** Percent label from an internal ratio (0.025 → 2.5%, -0.04 → -4%). */
function formatPercentValue(value: number): string {
  const pct = value * 100;
  const rounded = Math.round(pct * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label}%`;
}

/** R label (0 → 0R, 0.5 → 0.5R, 1.25 → 1.25R, -1 → -1R). */
function formatRValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
  return `${label}R`;
}

/**
 * Precise tooltip label for a value in the given unit (full precision, no
 * compact scaling): $7,266 / -$1,356 / 7.3% / 5.42R / 8.
 */
export function formatTooltipValue(value: number, unit: ChartAxisUnit): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'percent') {
    const pct = value * 100;
    const rounded = Math.round(pct * 10) / 10;
    return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`;
  }
  if (unit === 'r') return `${Math.round(value * 100) / 100}R`;
  if (unit === 'count' || unit === 'fixed') return String(Math.round(value));
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

/** Compact date label: '2026-08-21' → 'Aug 21'. Parses parts directly so
 *  no timezone shift can move the day. */
export function formatDateLabel(date: string): string {
  if (!date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const month = new Date(Number(m[1]), Number(m[2]) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${m[3]}`;
}

/**
 * Compact holding-duration bucket label for the axis: '0-1 days' → '0-1d',
 * '11+ days' → '11+d'. The canonical bucket definition is untouched; only
 * the axis presentation is compacted. Tooltips keep the full canonical label.
 */
export function formatDurationBucketLabel(bucket: string): string {
  return bucket.replace(/ days$/, 'd').replace(/(\d\+)$/, '+$1');
}

/**
 * Human-readable continuous duration label from a minute count (scatter X
 * axis ticks + tooltips). Tick placement follows the data range — this only
 * formats whatever value ECharts lands on.
 *
 *   minutes < 60  → '4m', '54m'
 *   < 24h         → '1h 44m', '3h 19m', '6h'
 *   < 7d          → '1d', '3d'
 *   ≥ 7d          → '1w', '2w'
 */
export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  const totalMinutes = Math.round(minutes);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (hours < 24) {
    return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  return `${weeks}w`;
}

/**
 * Compact R-bucket label for the axis: '<= -3' → '≤-3R', '-3 to -2' →
 * '-3R to -2R', '> 3' → '>3R'. The canonical bucket definition is untouched.
 */
export function formatRBinLabel(label: string): string {
  const compact = label.replace(/^<= /, '≤').replace(/^< /, '<').replace(/^> /, '>');
  // Range form first ('-3 to -2' → '-3R to -2R'), then a trailing single bound.
  return compact
    .replace(/(-?\d+(?:\.\d+)?) to (-?\d+(?:\.\d+)?)/g, '$1R to $2R')
    .replace(/(-?\d+(?:\.\d+)?)$/, '$1R');
}

/**
 * Semantic bar color for an R bucket: negative buckets → negative color,
 * positive buckets → positive color, zero/scratch → neutral info.
 */
export function rBinColor(label: string, palette: ChartPalette): string {
  const trimmed = label.replace(/\s/g, '');
  if (/^[<>]/.test(trimmed)) {
    // Open-ended: '<= -3' negative, '> 3' positive.
    return trimmed.includes('-') ? palette.negative : palette.positive;
  }
  const first = trimmed.match(/-?\d+(?:\.\d+)?/);
  const lower = first ? Number(first[0]) : 0;
  if (lower < 0) return palette.negative;
  if (lower === 0) return palette.info;
  return palette.positive;
}

// ── Axis / grid / zero-line helpers ─────────────────────────────────────────

function baseGrid(palette: ChartPalette, right = 8): EChartsOption['grid'] {
  return { left: 8, right, top: 24, bottom: 8, containLabel: true };
}

/**
 * Category (x) axis with muted labels and no vertical grid lines.
 * @param interval ECharts label interval ('auto', 0, N) — 0 forces every label.
 */
function categoryAxis(
  data: string[],
  palette: ChartPalette,
  formatter?: (v: string) => string,
  name?: string,
  interval: number | 'auto' = 'auto',
): EChartsOption['xAxis'] {
  return {
    type: 'category',
    name,
    nameTextStyle: { color: palette.axis, fontSize: 10 },
    axisLabel: {
      color: palette.axis,
      fontSize: 10,
      formatter,
      interval,
      hideOverlap: true,
    },
    axisLine: { lineStyle: { color: palette.grid } },
    axisTick: { show: false },
    splitLine: { show: false },
    data,
  };
}

/**
 * Value (y) axis with a muted unit-aware descriptor and unit-formatted ticks.
 * Split lines are subtle horizontal grid only (no vertical grid), so the data
 * series stays visually dominant.
 */
function valueAxis(
  name: string,
  unit: ChartAxisUnit,
  palette: ChartPalette,
  extra: EChartsOption['yAxis'] = {},
): EChartsOption['yAxis'] {
  return {
    type: 'value',
    name,
    nameTextStyle: { color: palette.axis, fontSize: 10 },
    axisLabel: {
      color: palette.axis,
      fontSize: 10,
      formatter: (v: number) => formatAxisValue(v, unit),
    },
    splitLine: { lineStyle: { color: palette.grid, opacity: 0.45 } },
    ...(extra as object),
  };
}

/** A clear but restrained zero baseline, distinct from ordinary grid lines. */
function zeroMarkLine(palette: ChartPalette): NonNullable<EChartsOption['series']>[number]['markLine'] {
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color: palette.reference, width: 1, type: 'solid', opacity: 0.8 },
    label: { show: false },
    data: [{ yAxis: 0 }],
  };
}

// ── Shared tooltip builder ──────────────────────────────────────────────────

export interface TooltipRow {
  /** Series display name (e.g. 'Cumulative P&L'). */
  label: string;
  /** Raw (already-converted) numeric value. */
  value: number | null;
  /** Marker color (semantic positive/negative/primary). */
  color: string;
  /** Optional per-row formatter; defaults to the shared unit formatter. */
  formatter?: (value: number) => string;
  /**
   * Literal display text rendered verbatim (setup name, close date) — bypasses
   * numeric value formatting entirely. When present, `value` is ignored.
   */
  text?: string;
}

export interface TooltipConfig {
  unit: ChartAxisUnit;
  /**
   * Heading semantic — the formatter must explicitly know whether the X-axis
   * value represents a temporal category or a domain value so arbitrary
   * strings are never accidentally passed through date formatting.
   *
   * - 'date':     format with the shared date formatter (Aug 21).
   * - 'category': pass the raw domain value through (R bucket, setup name,
   *               symbol, day, hour — never date-formatted).
   * Default: 'category'.
   */
  headingType?: 'date' | 'category';
  /** Optional heading transform applied after headingType semantics (e.g. R-bucket compaction). */
  heading?: (category: string, dataIndex: number) => string;
  /** Build the rows from the axis-trigger params (defaults to one row per series). */
  rows?: (params: CallbackDataParams[], dataIndex: number) => TooltipRow[];
  /** ECharts tooltip trigger. Item trigger suits scatter points; axis suits bars/lines. */
  trigger?: 'axis' | 'item';
}

/**
 * Shared ECharts tooltip with unit-aware values and semantic color markers.
 * Theme-aware surface via CSS variables (ECharts renders the tooltip as HTML,
 * so design tokens resolve). The heading is explicitly typed: temporal charts
 * pass 'date' (formatted via the shared date formatter), category charts pass
 * their domain value untouched.
 */
export function tooltip(config: TooltipConfig): EChartsOption['tooltip'] {
  const { unit, headingType = 'category', heading, rows, trigger = 'axis' } = config;
  return {
    trigger,
    confine: true,
    backgroundColor: 'var(--color-popover)',
    borderColor: 'var(--color-border)',
    borderWidth: 1,
    padding: [6, 10],
    textStyle: { color: 'var(--color-popover-foreground)', fontSize: 11 },
    formatter: (params: unknown) => {
      const list = (Array.isArray(params) ? params : [params]) as Array<
        CallbackDataParams & { axisValueLabel?: unknown; axisValue?: unknown }
      >;
      const dataIndex = list[0]?.dataIndex ?? 0;
      const category = String(list[0]?.axisValueLabel ?? list[0]?.name ?? '');
      const lines: string[] = [];
      // Explicit heading policy: only 'date' goes through the date formatter;
      // every other category value is preserved verbatim (R bucket, setup name,
      // symbol, day, hour). A `heading` transform is applied on top (e.g.
      // R-bucket compaction) and may return an empty string to suppress the
      // heading entirely.
      const base = headingType === 'date' ? formatDateLabel(category) : category;
      const headingText = heading ? heading(base, dataIndex) : base;
      if (headingText) lines.push(`<b>${headingText}</b>`);
      const rowList: TooltipRow[] = rows
        ? rows(list as CallbackDataParams[], dataIndex)
        : list.map((p) => ({
            label: p.seriesName ?? '',
            value: typeof p.value === 'number' ? p.value : null,
            color: typeof p.color === 'string' ? p.color : 'var(--color-primary)',
          }));
      for (const row of rowList) {
        let valueLabel: string | null = null;
        if (row.text !== undefined) {
          valueLabel = row.text;
        } else if (row.value !== null && Number.isFinite(row.value)) {
          valueLabel = row.formatter
            ? row.formatter(row.value)
            : formatTooltipValue(row.value, unit);
        }
        if (valueLabel === null) continue;
        lines.push(
          `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${row.color};margin-right:6px"></span>${row.label}&nbsp;&nbsp;${valueLabel}`,
        );
      }
      return lines.join('<br/>');
    },
  };
}

/** Legend configuration — absent (undefined) when the dense default applies. */
function legend(options: ChartRenderConfig = {}): EChartsOption['legend'] {
  return options.legendVisible
    ? { show: true, top: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 10 } }
    : undefined;
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

/**
 * One observation per eligible closed trade for the Trade Duration scatter.
 * Mirrors the analytics-route dataset (TradeDurationPoint) with numeric
 * continuous duration; presentation formatting lives in this layer.
 */
export interface TradeDurationPointData {
  tradeId: string;
  symbol: string;
  /** Continuous holding duration in minutes (X). */
  holdingDurationMinutes: number;
  /** Canonical individual net realized P&L. */
  netPnl: number;
  /** Canonical individual R-multiple; null when initial risk is missing/invalid. */
  rMultiple: number | null;
  setupId: string | null;
  setupName: string | null;
  closedAt: string;
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
  const unit = options.unit ?? 'currency';
  const show = visibleSeries.includes('cumulativePnl');
  // Cumulative P&L is a convertible currency series: under global % / R the
  // values become percent-of-equity / R-multiples of the same line shape.
  const seriesData = show ? data.map((d) => convertPnl(d.cumulativePnl, options)) : [];
  return {
    tooltip: tooltip({
      unit,
      headingType: 'date',
      rows: (params, idx) => [{
        label: 'Cumulative P&L',
        value: seriesData[idx] ?? null,
        color: palette.primary,
      }],
    }),
    grid: baseGrid(palette),
    legend: legend(options),
    xAxis: {
      ...(categoryAxis(data.map((d) => d.date), palette, (v) => formatDateLabel(v), 'Date') as object),
      data: data.map((d) => d.date),
    } as EChartsOption['xAxis'],
    yAxis: valueAxis('Cumulative P&L', unit, palette),
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
        markLine: zeroMarkLine(palette),
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
  const unit = options.unit ?? 'currency';
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
    tooltip: tooltip({
      unit,
      headingType: 'date',
      rows: (params, idx) => {
        const v = bars[idx]?.value as number | null | undefined ?? null;
        // Explicit sign in P&L tooltips: +$719 / -$270.
        const fmt = (value: number) => {
          const base = formatTooltipValue(value, unit);
          return value > 0 && unit === 'currency' ? `+${base}` : base;
        };
        return [{
          label: 'Net P&L',
          value: v,
          color: (v ?? 0) >= 0 ? palette.positive : palette.negative,
          formatter: fmt,
        }];
      },
    }),
    grid: baseGrid(palette),
    legend: legend(options),
    xAxis: {
      ...(categoryAxis(data.map((d) => d.date), palette, (v) => formatDateLabel(v), 'Date') as object),
      data: data.map((d) => d.date),
    } as EChartsOption['xAxis'],
    yAxis: valueAxis('Net P&L', unit, palette),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: bars,
        markLine: zeroMarkLine(palette),
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
  const unit = options.unit ?? 'currency';
  const show = visibleSeries.includes('netPnl');
  // Net P&L series is convertible; count/winRate stay fixed-semantic.
  const bars = show
    ? data.map((d) => {
        const v = convertPnl(d.netPnl, options);
        return { value: v, itemStyle: { color: (v ?? 0) >= 0 ? palette.positive : palette.negative } };
      })
    : [];
  return {
    tooltip: tooltip({
      unit,
      headingType: 'category',
      rows: (params, idx) => {
        const bucket = data[idx];
        const v = bars[idx]?.value as number | null | undefined ?? null;
        const rows: TooltipRow[] = [{
          label: 'Net P&L',
          value: v,
          color: (v ?? 0) >= 0 ? palette.positive : palette.negative,
        }];
        if (bucket) {
          // Information density from existing canonical data: bucket count + win rate.
          rows.push({ label: 'Trades', value: bucket.count, color: palette.info, formatter: (n) => String(Math.round(n)) });
          if (bucket.winRate !== null && bucket.winRate !== undefined) {
            rows.push({
              label: 'Win rate',
              value: bucket.winRate,
              color: palette.primary,
              formatter: (n) => `${Math.round(n * 1000) / 10}%`,
            });
          }
        }
        return rows;
      },
    }),
    grid: baseGrid(palette),
    legend: legend(options),
    xAxis: {
      ...(categoryAxis(data.map((d) => d.bucket), palette, (v) => formatDurationBucketLabel(v), 'Holding duration', 0) as object),
      data: data.map((d) => d.bucket),
    } as EChartsOption['xAxis'],
    yAxis: valueAxis('Net P&L', unit, palette),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: bars,
        markLine: zeroMarkLine(palette),
      },
    ],
  };
}

/**
 * Trade Duration Performance — per-trade scatter plot (default visualization).
 *
 * Answers: is individual trade outcome related to how long the trade was held?
 * One point = one closed trade. X = continuous holding duration (minutes),
 * Y = the selected individual outcome under the global unit.
 *
 * Individual-trade unit semantics (explicit distinction from the aggregate
 * conversion contract):
 * - currency: canonical individual net realized P&L (netPnl).
 * - percent:  individual net P&L / selected-period period-start equity (the
 *   same approved % denominator used by aggregate Performance presentation —
 *   never return-on-trade-capital or a price move).
 * - r:        the trade's canonical individual R-multiple (returnMetrics.rMultiple)
 *   — never aggregate P&L / selected-scope totalInitialRisk. Trades with
 *   missing/invalid initial risk have rMultiple = null and are omitted from
 *   the R series (missing risk must never read as a zero-result trade).
 */
export function tradeDurationScatterOption(
  data: TradeDurationPointData[],
  palette: ChartPalette,
  visibleSeries: string[] = ['netPnl'],
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const unit = options.unit ?? 'currency';
  void visibleSeries; // scatter always plots every eligible point

  // Y = the selected individual outcome. R mode uses each trade's canonical
  // individual R; null-R points are omitted (never fabricated as 0R).
  const points: Array<{ value: [number, number]; itemStyle: { color: string } }> = [];
  for (const d of data) {
    let y: number | null;
    if (unit === 'r') {
      y = d.rMultiple;
    } else if (unit === 'percent') {
      const equity = options.periodStartEquity;
      y = equity !== null && equity !== undefined && equity > 0 ? d.netPnl / equity : null;
    } else {
      y = d.netPnl;
    }
    if (y === null || !Number.isFinite(y)) continue;
    points.push({
      value: [d.holdingDurationMinutes, y],
      itemStyle: { color: scatterPointColor(y, palette) },
    });
  }
  if (points.length === 0) return null;

  return {
    tooltip: tooltip({
      unit: 'currency',
      trigger: 'item',
      headingType: 'category',
      // Heading = the trade symbol (never a date, never a duration bucket).
      heading: (category, idx) => data[idx]?.symbol ?? category,
      rows: (params, idx) => {
        const point = data[idx];
        if (!point) return [];
        const rows: TooltipRow[] = [];
        // Holding duration is always shown (shared humanized formatter).
        rows.push({
          label: 'Holding time',
          value: point.holdingDurationMinutes,
          color: palette.info,
          formatter: (v) => formatDurationMinutes(v),
        });
        // The selected-unit result (what the point's Y represents).
        const yRow = pointResultRow(point, unit, palette, options);
        if (yRow) rows.push(yRow);
        // Canonical dollar P&L stays visible as trade-level context under any
        // global unit (explicit sign: +$420 / -$270).
        rows.push({
          label: 'Net P&L',
          value: point.netPnl,
          color: point.netPnl > 0 ? palette.positive : point.netPnl < 0 ? palette.negative : palette.info,
          formatter: (v) => `${v > 0 ? '+' : ''}${formatTooltipValue(v, 'currency')}`,
        });
        // Canonical individual R shown where available.
        if (point.rMultiple !== null && point.rMultiple !== undefined && Number.isFinite(point.rMultiple)) {
          rows.push({
            label: 'R',
            value: point.rMultiple,
            color: point.rMultiple > 0 ? palette.positive : point.rMultiple < 0 ? palette.negative : palette.info,
            formatter: (v) => `${v > 0 ? '+' : ''}${formatTooltipValue(v, 'r')}`,
          });
        }
        // Setup display name where available (full name, never a UUID).
        if (point.setupName) {
          rows.push({ label: 'Setup', value: null, color: palette.primary, text: point.setupName });
        }
        // Human-readable close date (not the raw ISO timestamp).
        rows.push({
          label: 'Closed',
          value: null,
          color: palette.axis,
          text: formatDateLabel(point.closedAt),
        });
        return rows;
      },
    }),
    grid: baseGrid(palette),
    legend: legend(options),
    xAxis: {
      type: 'value',
      name: 'Holding duration',
      nameTextStyle: { color: palette.axis, fontSize: 10 },
      minInterval: 1,
      axisLabel: {
        color: palette.axis,
        fontSize: 10,
        // Humanize tick labels; tick placement follows the dataset range.
        formatter: (v: number) => formatDurationMinutes(v),
      },
      axisLine: { lineStyle: { color: palette.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: valueAxis('Trade result', unit, palette),
    series: [
      {
        name: 'Trade result',
        type: 'scatter',
        data: points,
        symbolSize: 7,
        // Restrained: no per-point labels, no regression/trend line, no
        // third-metric bubble sizing. Hover emphasis is ECharts' default.
        label: { show: false },
        emphasis: { focus: 'series', scale: 1.6 },
        markLine: zeroMarkLine(palette),
      },
    ],
  };
}

/**
 * Semantic outcome color for an individual observation: positive P&L/R →
 * positive, negative → negative, zero/scratch → neutral (info).
 */
function scatterPointColor(y: number, palette: ChartPalette): string {
  if (y > 0) return palette.positive;
  if (y < 0) return palette.negative;
  return palette.info;
}

/**
 * Tooltip row for the point's Y value under the selected unit. R mode uses
 * the canonical individual R; percent mode adds the approved period-equity
 * semantic as a labeled row; currency mode is covered by the always-visible
 * Net P&L row and returns null (no duplicate).
 */
function pointResultRow(
  point: TradeDurationPointData,
  unit: ChartAxisUnit,
  palette: ChartPalette,
  options: ChartRenderConfig,
): TooltipRow | null {
  if (unit === 'currency') return null;
  if (unit === 'percent') {
    const equity = options.periodStartEquity;
    if (equity === null || equity === undefined || equity <= 0) return null;
    const pct = point.netPnl / equity;
    return {
      label: 'Trade result',
      value: pct,
      color: pct > 0 ? palette.positive : pct < 0 ? palette.negative : palette.info,
      formatter: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 10000) / 100}%`,
    };
  }
  if (unit === 'r') {
    if (point.rMultiple === null || !Number.isFinite(point.rMultiple)) return null;
    return {
      label: 'Trade result',
      value: point.rMultiple,
      color: point.rMultiple > 0 ? palette.positive : point.rMultiple < 0 ? palette.negative : palette.info,
      formatter: (v) => `${v > 0 ? '+' : ''}${formatTooltipValue(v, 'r')}`,
    };
  }
  return null;
}

/** Drawdown Curve — dual-axis area chart (amount | %). */
export function drawdownCurveOption(
  data: DrawdownPoint[],
  palette: ChartPalette,
  visibleSeries: string[] = ['drawdownAmount', 'drawdownPct'],
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.length === 0) return null;
  const unit = options.unit ?? 'currency';
  const showAmount = visibleSeries.includes('drawdownAmount');
  const showPct = visibleSeries.includes('drawdownPct');
  // drawdownAmount is a currency magnitude (convertible under % per the
  // registry declaration; global R falls back to currency — Task 2A);
  // drawdownPct is already a native percentage of peak equity and stays
  // fixed-semantic. The two units get distinct Y axes so they are never
  // plotted on one anonymous scale.
  const amountSeries = showAmount ? data.map((d) => convertPnl(d.drawdownAmount, options)) : [];
  return {
    tooltip: tooltip({
      unit,
      headingType: 'date',
      rows: (params, idx) => {
        const rows: TooltipRow[] = [];
        if (showAmount) {
          const v = amountSeries[idx] ?? null;
          rows.push({
            label: 'Drawdown',
            value: v,
            color: palette.warning,
            // Downside semantics: drawdown magnitude presented as negative.
            formatter: (value) => `-${formatTooltipValue(value, unit)}`,
          });
        }
        if (showPct) {
          rows.push({
            label: 'Drawdown %',
            value: data[idx]?.drawdownPct ?? null,
            color: palette.negative,
            formatter: (value) => `-${Math.round(value * 1000) / 10}%`,
          });
        }
        return rows;
      },
    }),
    grid: baseGrid(palette, 52),
    legend: legend(options),
    xAxis: {
      ...(categoryAxis(data.map((d) => d.date), palette, (v) => formatDateLabel(v), 'Date') as object),
      data: data.map((d) => d.date),
    } as EChartsOption['xAxis'],
    yAxis: [
      valueAxis('Drawdown', unit, palette),
      {
        type: 'value',
        name: 'Drawdown %',
        nameTextStyle: { color: palette.axis, fontSize: 10 },
        axisLabel: {
          color: palette.axis,
          fontSize: 10,
          formatter: (v: number) => `${Math.round(v * 1000) / 10}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Drawdown',
        type: 'line',
        yAxisIndex: 0,
        data: amountSeries,
        showSymbol: false,
        lineStyle: { color: palette.warning, width: 2 },
        itemStyle: { color: palette.warning },
        areaStyle: showAmount ? { color: palette.warning, opacity: 0.1 } : undefined,
      },
      {
        name: 'Drawdown %',
        type: 'line',
        yAxisIndex: 1,
        data: showPct ? data.map((d) => d.drawdownPct) : [],
        showSymbol: false,
        lineStyle: { color: palette.negative, width: 2 },
        itemStyle: { color: palette.negative },
        areaStyle: showPct ? { color: palette.negative, opacity: 0.08 } : undefined,
      },
    ],
  };
}

/** R-Multiple Distribution — bar chart of bucket counts with semantic colors. */
export function rDistributionOption(
  data: RDistributionItem[],
  palette: ChartPalette,
  visibleSeries: string[] = ['count'],
  options: ChartRenderConfig = {},
): EChartsOption | null {
  if (!data || data.every((d) => d.count === 0)) return null;
  const show = visibleSeries.includes('count');
  const colors = data.map((d) => rBinColor(d.label, palette));
  const values = show ? data.map((d) => d.count) : [];
  return {
    tooltip: tooltip({
      unit: 'count',
      headingType: 'category',
      // The R bucket remains an R bucket in the heading (never date-formatted);
      // formatRBinLabel is idempotent whether the axis value is raw or compacted.
      heading: (category, idx) => formatRBinLabel(data[idx]?.label ?? category),
      rows: (params, idx) => [{
        label: 'Trades',
        value: values[idx] ?? null,
        color: colors[idx] ?? palette.info,
        formatter: (n) => String(Math.round(n)),
      }],
    }),
    grid: baseGrid(palette),
    legend: legend(options),
    xAxis: {
      ...(categoryAxis(data.map((d) => d.label), palette, (v) => formatRBinLabel(v), 'R multiple', 0) as object),
      data: data.map((d) => d.label),
    } as EChartsOption['xAxis'],
    yAxis: {
      ...valueAxis('Trades', 'count', palette),
      minInterval: 1,
    },
    series: [
      {
        name: 'Trades',
        type: 'bar',
        data: show ? data.map((d, i) => ({ value: d.count, itemStyle: { color: colors[i] } })) : [],
      },
    ],
  };
}

/**
 * Axis semantic + value formatting for the selected Setup metric.
 * Net P&L converts under the global unit; Win Rate / Average R / Trades stay
 * fixed-semantic and get their own axis units.
 */
function setupMetricAxis(
  metric: string,
  unit: SupportedUnit,
): { name: string; yUnit: ChartAxisUnit; formatter: (v: number) => string } {
  if (metric === 'winRate') {
    return {
      name: 'Win Rate',
      yUnit: 'percent',
      formatter: (v) => `${Math.round(v * 1000) / 10}%`,
    };
  }
  if (metric === 'avgR') {
    return { name: 'Average R', yUnit: 'r', formatter: (v) => formatAxisValue(v, 'r') };
  }
  if (metric === 'count') {
    return { name: 'Trades', yUnit: 'count', formatter: (v) => String(Math.round(v)) };
  }
  // netPnl (and unknown metrics): currency/percent/R per the global unit.
  return {
    name: metric === 'netPnl' ? 'Net P&L' : metric,
    yUnit: unit,
    formatter: (v) => formatAxisValue(v, unit),
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
  const unit = config.unit ?? 'currency';
  const axis = setupMetricAxis(metric, unit);

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
    tooltip: tooltip({
      unit: axis.yUnit,
      headingType: 'category',
      // Heading = full setup display name from the data row (the axis label may
      // be truncated for long names; never a UUID, never date-formatted).
      heading: (category, idx) => data[idx]?.setup ?? category,
      rows: (params, idx) => [{
        label: axis.name,
        value: values[idx] ?? null,
        color: palette.primary,
        formatter: axis.yUnit === 'percent'
          ? (v) => `${Math.round(v * 1000) / 10}%`
          : undefined,
      }],
    }),
    grid: baseGrid(palette),
    legend: legend(config),
    xAxis: {
      ...(categoryAxis(
        data.map((d) => d.setup),
        palette,
        (v) => (v.length > 12 ? `${v.slice(0, 12)}…` : v),
        'Setup',
        0,
      ) as object),
      data: data.map((d) => d.setup),
    } as EChartsOption['xAxis'],
    yAxis: {
      ...valueAxis(axis.name, axis.yUnit, palette),
      axisLabel: {
        color: palette.axis,
        fontSize: 10,
        formatter: axis.formatter,
      },
      ...(axis.yUnit === 'count' ? { minInterval: 1 } : {}),
    },
    series: [
      {
        name: axis.name,
        type: 'bar',
        data: show ? values : [],
        itemStyle: {
          color: (value: unknown) => {
            const v = typeof value === 'number' ? value : (value as { value: number }).value;
            return (v ?? 0) >= 0 ? palette.positive : palette.negative;
          },
        },
        markLine: metric === 'netPnl' ? zeroMarkLine(palette) : undefined,
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
  const unit = options.unit ?? 'currency';
  const show = visibleSeries.includes('netPnl');
  // Net P&L series is convertible under the global unit.
  const bars = show
    ? data.map((d) => {
        const v = convertPnl(d.netPnl, options);
        return { value: v, itemStyle: { color: (v ?? 0) >= 0 ? palette.positive : palette.negative } };
      })
    : [];
  return {
    tooltip: tooltip({
      unit,
      headingType: 'category',
      rows: (params, idx) => [{
        label: 'Net P&L',
        value: bars[idx]?.value as number | null | undefined ?? null,
        color: (bars[idx]?.value as number | null ?? 0) >= 0 ? palette.positive : palette.negative,
      }],
    }),
    grid: baseGrid(palette),
    legend: legend(options),
    xAxis: categoryAxis(data.map((d) => d.day), palette, undefined, 'Day'),
    yAxis: valueAxis('Net P&L', unit, palette),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: bars,
        markLine: zeroMarkLine(palette),
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
  const unit = options.unit ?? 'currency';
  const show = visibleSeries.includes('netPnl');
  // Net P&L series is convertible under the global unit.
  const bars = show ? data.map((d) => convertPnl(d.netPnl, options)) : [];
  return {
    tooltip: tooltip({
      unit,
      headingType: 'category',
      rows: (params, idx) => [{
        label: 'Net P&L',
        value: bars[idx] ?? null,
        color: (bars[idx] ?? 0) >= 0 ? palette.positive : palette.negative,
      }],
    }),
    grid: baseGrid(palette),
    legend: legend(options),
    xAxis: categoryAxis(data.map((d) => d.hour), palette, undefined, 'Hour'),
    yAxis: valueAxis('Net P&L', unit, palette),
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: bars,
        markLine: zeroMarkLine(palette),
        itemStyle: {
          color: (value: unknown) => {
            const v = typeof value === 'number' ? value : (value as { value: number }).value;
            return (v ?? 0) >= 0 ? palette.positive : palette.negative;
          },
        },
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
  const unit = options.unit ?? 'currency';
  const long = data.find((d) => d.direction === 'long');
  const short = data.find((d) => d.direction === 'short');

  // Net P&L per direction is convertible under the global unit.
  return {
    tooltip: tooltip({
      unit,
      headingType: 'category',
      rows: () => {
        const rows: TooltipRow[] = [];
        if (visibleSeries.includes('long') && long) rows.push({ label: 'Long', value: convertPnl(long.netPnl, options), color: palette.positive });
        if (visibleSeries.includes('short') && short) rows.push({ label: 'Short', value: convertPnl(short.netPnl, options), color: palette.negative });
        return rows;
      },
    }),
    grid: baseGrid(palette),
    legend: legend(options),
    xAxis: categoryAxis(['Net P&L'], palette, undefined, undefined, 0),
    yAxis: valueAxis('Net P&L', unit, palette),
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
  const unit = options.unit ?? 'currency';
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
    tooltip: tooltip({
      unit,
      headingType: 'category',
      rows: (params, idx) => {
        const rows: TooltipRow[] = [];
        if (showNet) rows.push({ label: 'Net P&L', value: netBars[idx]?.value as number | null | undefined ?? null, color: (netBars[idx]?.value as number | null ?? 0) >= 0 ? palette.positive : palette.negative });
        if (showWin) rows.push({ label: 'Win Rate', value: data[idx]?.winRate ?? null, color: palette.primary, formatter: (v) => `${Math.round(v * 1000) / 10}%` });
        return rows;
      },
    }),
    grid: baseGrid(palette, 52),
    legend: legend(options),
    xAxis: categoryAxis(data.map((d) => d.month), palette, undefined, 'Month', 0),
    yAxis: [
      valueAxis('Net P&L', unit, palette),
      {
        type: 'value',
        name: 'Win Rate',
        nameTextStyle: { color: palette.axis, fontSize: 10 },
        axisLabel: {
          color: palette.axis,
          fontSize: 10,
          formatter: (v: number) => `${Math.round(v * 100)}%`,
        },
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
        markLine: zeroMarkLine(palette),
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
