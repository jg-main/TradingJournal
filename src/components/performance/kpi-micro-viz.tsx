'use client';

import React, { useMemo } from 'react';

// ── Sparkline ───────────────────────────────────────────────────────────────

export interface SparklineProps {
  /** Time series values (e.g., cumulative P&L points). */
  values: number[];
  width?: number;
  height?: number;
  positiveColor?: string;
  negativeColor?: string;
}

/**
 * Tiny inline SVG sparkline for KPI cards.
 * Uses currentColor-compatible stroke via CSS var lookup at runtime by
 * passing semantic colors as props (resolved from chart palette).
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  positiveColor = 'var(--color-positive)',
  negativeColor = 'var(--color-negative)',
}: SparklineProps) {
  const path = useMemo(() => buildSparklinePath(values, width, height), [values, width, height]);

  if (!path) return null;

  const last = values[values.length - 1];
  const first = values[0];
  const color = last >= (first ?? 0) ? positiveColor : negativeColor;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      aria-hidden
      data-testid="kpi-sparkline"
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function buildSparklinePath(values: number[], width: number, height: number): string | null {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

// ── Donut (win-rate gauge) ──────────────────────────────────────────────────

export interface DonutProps {
  /** Fraction 0..1 (e.g., win rate). */
  fraction: number;
  size?: number;
  strokeWidth?: number;
}

/**
 * Small donut showing a fraction (e.g., win rate).
 * Renders an arc; color shifts by performance (>=0.5 positive else negative).
 */
export function Donut({ fraction, size = 40, strokeWidth = 5 }: DonutProps) {
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
      className="block -rotate-90"
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

// ── Combined micro-viz selector ─────────────────────────────────────────────

export interface MicroVizProps {
  kind: 'sparkline' | 'donut';
  values?: number[];
  fraction?: number;
}

/**
 * Renders the appropriate micro-visualization for a KPI card, or nothing
 * when data is absent. Guarded: only renders when data is meaningful.
 */
export function MicroViz({ kind, values, fraction }: MicroVizProps) {
  if (kind === 'sparkline') {
    if (!values || values.length < 2) return null;
    return <Sparkline values={values} />;
  }
  if (kind === 'donut') {
    if (typeof fraction !== 'number' || Number.isNaN(fraction)) return null;
    return <Donut fraction={fraction} />;
  }
  return null;
}
