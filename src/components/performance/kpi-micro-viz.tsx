'use client';

import React, { useMemo } from 'react';

// ── Sparkline ───────────────────────────────────────────────────────────────

export interface SparklineProps {
  /** Time series values (e.g., cumulative P&L points). */
  values: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  /** Render a soft area fill under the line (same semantic color, low opacity). */
  areaFill?: boolean;
  positiveColor?: string;
  negativeColor?: string;
}

/**
 * Inline SVG sparkline for KPI cards.
 * Uses currentColor-compatible stroke via CSS var lookup at runtime by
 * passing semantic colors as props (resolved from chart palette). The line is
 * sized to contribute to the card (default 140×40) and colored by the
 * cumulative trend (last ≥ first → positive, else negative).
 */
export function Sparkline({
  values,
  width = 140,
  height = 40,
  strokeWidth = 2.5,
  areaFill = true,
  positiveColor = 'var(--color-positive)',
  negativeColor = 'var(--color-negative)',
}: SparklineProps) {
  const { line, area } = useMemo(
    () => buildSparklinePaths(values, width, height),
    [values, width, height],
  );

  if (!line) return null;

  const last = values[values.length - 1];
  const first = values[0];
  const color = last >= (first ?? 0) ? positiveColor : negativeColor;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block shrink-0"
      aria-hidden
      data-testid="kpi-sparkline"
    >
      {areaFill && area && (
        <path d={area} fill={color} fillOpacity={0.12} stroke="none" />
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function buildSparklinePaths(
  values: number[],
  width: number,
  height: number,
): { line: string | null; area: string | null } {
  if (!values || values.length < 2) return { line: null, area: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  return { line, area };
}

// ── Donut (win-rate gauge) ──────────────────────────────────────────────────

export interface DonutProps {
  /** Fraction 0..1 (e.g., win rate). */
  fraction: number;
  size?: number;
  strokeWidth?: number;
}

/**
 * Donut showing a fraction (e.g., win rate). Sized to contribute to the card
 * (default 56×56). Renders an arc; color shifts by performance (>=0.5 positive
 * else negative).
 */
export function Donut({ fraction, size = 56, strokeWidth = 7 }: DonutProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  const dash = clamped * circumference;

  const color = clamped >= 0.5 ? 'var(--color-positive)' : 'var(--color-negative)';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block -rotate-90 shrink-0"
      aria-hidden
      data-testid="kpi-donut"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Profit-vs-loss split bar (profit factor / payoff ratio) ─────────────────

export interface PnlSplitBarProps {
  /** Positive magnitude (e.g., gross profit or average win). */
  positive: number;
  /** Negative magnitude (e.g., gross loss or average loss). */
  negative: number;
  positiveLabel?: string;
  negativeLabel?: string;
  positiveValue?: string;
  negativeValue?: string;
  /** Render the caption area (labels + values) below the bar. */
  showCaptions?: boolean;
  /** 'stacked' — label above value in two columns (default, space-safe);
   *  'inline' — label and value on one row per side. */
  captionLayout?: 'stacked' | 'inline';
}

/**
 * Horizontal split bar showing the proportional relationship between a
 * positive magnitude (profit) and a negative magnitude (loss) using the
 * semantic financial colors. Widths are proportional to the two magnitudes;
 * a center divider marks the boundary. Used by Profit Factor (gross profit vs
 * gross loss) and Payoff Ratio (average win vs average loss).
 *
 * Caption area (when enabled) renders two fully readable columns — positive
 * side left-aligned, negative side right-aligned, values in tabular numerals
 * with semantic colors — without truncation or decorative bullets. The
 * default 'stacked' layout (label above value) stays within a 5-across card
 * at 1280-1440px; 'inline' puts label and value on one row per side.
 *
 * Guard: renders nothing when both magnitudes are non-positive.
 */
export function PnlSplitBar({
  positive,
  negative,
  positiveLabel,
  negativeLabel,
  positiveValue,
  negativeValue,
  showCaptions = false,
  captionLayout = 'stacked',
}: PnlSplitBarProps) {
  const total = positive + negative;
  if (total <= 0 || positive <= 0 || negative <= 0) return null;

  const posPct = (positive / total) * 100;
  const negPct = 100 - posPct;

  return (
    <div className="w-full" data-testid="kpi-pnl-split-bar">
      <div
        className="flex h-2 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Profit ${posPct.toFixed(0)}% vs loss ${negPct.toFixed(0)}%`}
      >
        <div className="h-full bg-positive" style={{ width: `${posPct}%` }} />
        <div className="h-full bg-negative" style={{ width: `${negPct}%` }} />
      </div>
      {showCaptions && (positiveLabel || negativeLabel) && (
        <div
          data-testid="kpi-pnl-split-captions"
          className={
            captionLayout === 'inline'
              ? 'mt-1 flex items-baseline justify-between gap-3 text-xs leading-none tabular-nums'
              : 'mt-1 grid grid-cols-2 gap-3 text-xs leading-none tabular-nums'
          }
        >
          <span
            className={
              captionLayout === 'inline'
                ? 'flex min-w-0 items-baseline gap-1.5 whitespace-nowrap'
                : 'flex min-w-0 flex-col items-start gap-0.5'
            }
          >
            <span className="max-w-full text-muted-foreground">{positiveLabel}</span>
            {positiveValue !== undefined && (
              <span className="max-w-full whitespace-nowrap text-positive">{positiveValue}</span>
            )}
          </span>
          <span
            className={
              captionLayout === 'inline'
                ? 'flex min-w-0 items-baseline justify-end gap-1.5 whitespace-nowrap'
                : 'flex min-w-0 flex-col items-end gap-0.5'
            }
          >
            {negativeValue !== undefined && (
              <span className="max-w-full whitespace-nowrap text-negative">{negativeValue}</span>
            )}
            <span className="max-w-full text-muted-foreground">{negativeLabel}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ── Combined micro-viz selector ─────────────────────────────────────────────

export interface MicroVizProps {
  kind: 'sparkline' | 'donut' | 'pnl-split';
  values?: number[];
  fraction?: number;
  positive?: number;
  negative?: number;
  positiveLabel?: string;
  negativeLabel?: string;
  positiveValue?: string;
  negativeValue?: string;
  showCaptions?: boolean;
  captionLayout?: 'stacked' | 'inline';
}

/**
 * Renders the appropriate micro-visualization for a KPI card, or nothing
 * when data is absent. Guarded: only renders when data is meaningful.
 *
 * Containment contract: KpiCard hosts the visualization inside a fixed
 * reserved slot (overflow-hidden) so the micro-viz can never change card
 * height. `shrink-0` on the SVGs prevents flex from squeezing or distorting
 * them inside the slot.
 */
export function MicroViz({
  kind,
  values,
  fraction,
  positive,
  negative,
  positiveLabel,
  negativeLabel,
  positiveValue,
  negativeValue,
  showCaptions,
  captionLayout,
}: MicroVizProps) {
  if (kind === 'sparkline') {
    if (!values || values.length < 2) return null;
    return <Sparkline values={values} />;
  }
  if (kind === 'donut') {
    if (typeof fraction !== 'number' || Number.isNaN(fraction)) return null;
    return <Donut fraction={fraction} />;
  }
  if (kind === 'pnl-split') {
    if (typeof positive !== 'number' || typeof negative !== 'number') return null;
    return (
      <PnlSplitBar
        positive={positive}
        negative={negative}
        positiveLabel={positiveLabel}
        negativeLabel={negativeLabel}
        positiveValue={positiveValue}
        negativeValue={negativeValue}
        showCaptions={showCaptions}
        captionLayout={captionLayout}
      />
    );
  }
  return null;
}
