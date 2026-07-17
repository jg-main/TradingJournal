/**
 * Tests for the EquityDrawdownChart component.
 *
 * Covers: title rendering, loading/error/empty state passthrough,
 * chart option construction with dual Y-axes, trade marker placement,
 * empty state fallback, and empty data handling.
 *
 * Run: npx vitest run src/components/dashboard/equity-drawdown-chart.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { EquityDrawdownChart } from './equity-drawdown-chart';
import type { EquityDataPoint, DrawdownDataPoint, TradeMarkerPoint } from '@/lib/equity';

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock echarts-for-react since it renders to canvas (not testable in jsdom)
vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: Record<string, unknown> }) => (
    <div data-testid="echarts-mock" data-option={JSON.stringify(option)} />
  ),
}));

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_EQUITY: EquityDataPoint[] = [
  { date: '2025-01-01', equity: 25000, cumulativePnl: 0, highWaterMark: 25000 },
  { date: '2025-01-02', equity: 25200, cumulativePnl: 200, highWaterMark: 25200 },
  { date: '2025-01-03', equity: 24900, cumulativePnl: -100, highWaterMark: 25200 },
  { date: '2025-01-04', equity: 25300, cumulativePnl: 300, highWaterMark: 25300 },
  { date: '2025-01-05', equity: 25500, cumulativePnl: 500, highWaterMark: 25500 },
];

const SAMPLE_DRAWDOWN: DrawdownDataPoint[] = [
  { date: '2025-01-01', drawdownAmount: 0, drawdownPct: 0 },
  { date: '2025-01-02', drawdownAmount: 0, drawdownPct: 0 },
  { date: '2025-01-03', drawdownAmount: -300, drawdownPct: -0.012 },
  { date: '2025-01-04', drawdownAmount: 0, drawdownPct: 0 },
  { date: '2025-01-05', drawdownAmount: 0, drawdownPct: 0 },
];

const SAMPLE_MARKERS: TradeMarkerPoint[] = [
  {
    date: '2025-01-02',
    equity: 25200,
    tradeId: 'trade-1',
    symbol: 'AAPL',
    direction: 'long',
    markerType: 'entry',
    price: 150.00,
    pnl: 200,
  },
  {
    date: '2025-01-04',
    equity: 25300,
    tradeId: 'trade-1',
    symbol: 'AAPL',
    direction: 'long',
    markerType: 'exit',
    price: 152.00,
    pnl: 200,
  },
];

const EMPTY_EQUITY: EquityDataPoint[] = [];
const EMPTY_DRAWDOWN: DrawdownDataPoint[] = [];
const EMPTY_MARKERS: TradeMarkerPoint[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('EquityDrawdownChart', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    expect(screen.getByText('Equity & Drawdown')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
        title="Equity Curve"
      />,
    );
    expect(screen.getByText('Equity Curve')).toBeTruthy();
  });

  // ── Chart rendering ─────────────────────────────────────────────

  it('renders the ECharts chart when equity and drawdown data are provided', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();
  });

  it('builds chart option with dual Y-axes', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // Should have two yAxis entries
    expect(option.yAxis).toHaveLength(2);
    // Left axis (index 0): equity axis
    expect(option.yAxis[0].axisLabel.formatter).toBe('${value}');
    // Right axis (index 1): drawdown axis
    expect(option.yAxis[1].axisLabel.formatter).toBe('{value}%');
    expect(option.yAxis[1].min).toBe(0);
    expect(option.yAxis[1].inverse).toBe(false);
  });

  it('builds chart option with correct series', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.series).toHaveLength(4);
    const seriesNames = option.series.map((s: Record<string, unknown>) => s.name);
    expect(seriesNames).toContain('Equity');
    expect(seriesNames).toContain('Drawdown');
    expect(seriesNames).toContain('Entry');
    expect(seriesNames).toContain('Exit');
  });

  it('equity line is on yAxisIndex 0', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    const equitySeries = option.series.find((s: Record<string, unknown>) => s.name === 'Equity');
    expect(equitySeries.yAxisIndex).toBe(0);
  });

  it('drawdown line is on yAxisIndex 1', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    const drawdownSeries = option.series.find((s: Record<string, unknown>) => s.name === 'Drawdown');
    expect(drawdownSeries.yAxisIndex).toBe(1);
  });

  it('drawdown data uses absolute percentage values', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    const drawdownSeries = option.series.find((s: Record<string, unknown>) => s.name === 'Drawdown');
    const data = drawdownSeries.data as [number, number][];
    // drawdownPct of -0.012 → 1.2%
    const thirdPoint = data[2];
    expect(thirdPoint[1]).toBe(1.2);
    // Zero drawdown should be 0
    expect(data[0][1]).toBe(0);
  });

  it('uses time xAxis', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.xAxis.type).toBe('time');
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
        isLoading
      />,
    );
    // Should have skeleton elements
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    // Chart should not render while loading
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
        error="Failed to load equity data"
      />,
    );
    expect(screen.getByText('Failed to load equity data')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows empty state when isEmpty is true', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows EmptyState when equityCurve and drawdown are both empty', () => {
    render(
      <EquityDrawdownChart
        equityCurve={EMPTY_EQUITY}
        drawdown={EMPTY_DRAWDOWN}
        tradeMarkers={EMPTY_MARKERS}
      />,
    );
    expect(screen.getByText('No equity data available')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows empty state description when no data', () => {
    render(
      <EquityDrawdownChart
        equityCurve={EMPTY_EQUITY}
        drawdown={EMPTY_DRAWDOWN}
        tradeMarkers={EMPTY_MARKERS}
      />,
    );
    expect(
      screen.getByText(
        'Your combined equity and drawdown chart will appear here after you start trading.',
      ),
    ).toBeTruthy();
  });

  // ── Partial data handling ──────────────────────────────────────

  it('renders chart with only equity data (no drawdown or markers)', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={EMPTY_DRAWDOWN}
        tradeMarkers={EMPTY_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();

    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');
    const seriesNames = option.series.map((s: Record<string, unknown>) => s.name);
    expect(seriesNames).toEqual(['Equity']);
  });

  it('renders chart with only drawdown data (no equity or markers)', () => {
    render(
      <EquityDrawdownChart
        equityCurve={EMPTY_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={EMPTY_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();

    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');
    const seriesNames = option.series.map((s: Record<string, unknown>) => s.name);
    expect(seriesNames).toEqual(['Drawdown']);
  });

  it('renders no markers when tradeMarkers array is empty but equity is provided', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={EMPTY_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    const seriesNames = option.series.map((s: Record<string, unknown>) => s.name);
    expect(seriesNames).not.toContain('Entry');
    expect(seriesNames).not.toContain('Exit');
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
        testId="widget-equity-drawdown"
      />,
    );
    const el = container.querySelector('[data-testid="widget-equity-drawdown"]');
    expect(el).toBeTruthy();
  });

  // ── Error is null (no error shown) ──────────────────────────────

  it('renders chart when error is null', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
        error={null}
      />,
    );
    expect(screen.getByTestId('echarts-mock')).toBeTruthy();
  });

  // ── Drawdown axis scaling ───────────────────────────────────────

  it('drawdown axis max has headroom based on data', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // Max drawdown is 1.2% but minimum is 5% → 5 * 1.15 = 5.75
    // The axis clamps to a minimum of 5% so small drawdowns still have visible range
    expect(option.yAxis[1].max).toBeCloseTo(5.75, 1);
  });

  it('drawdown axis uses a minimum of 5 when no drawdown data', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={EMPTY_DRAWDOWN}
        tradeMarkers={EMPTY_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // When no drawdown, max defaults to 5 * 1.15 = 5.75
    expect(option.yAxis[1].max).toBeCloseTo(5.75, 1);
  });

  // ── Grid layout ─────────────────────────────────────────────────

  it('uses standard grid layout with side padding for dual axes', () => {
    render(
      <EquityDrawdownChart
        equityCurve={SAMPLE_EQUITY}
        drawdown={SAMPLE_DRAWDOWN}
        tradeMarkers={SAMPLE_MARKERS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.grid.left).toBe('10%');
    expect(option.grid.right).toBe('10%');
  });
});
