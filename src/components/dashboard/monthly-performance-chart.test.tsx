/**
 * Tests for the MonthlyPerformanceChart component.
 *
 * Covers: title rendering, loading/error/empty state passthrough,
 * chart option construction with dual Y-axes (bar + line), colour-coded
 * P&L bars, empty data handling.
 *
 * Run: npx vitest run src/components/dashboard/monthly-performance-chart.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MonthlyPerformanceChart } from './monthly-performance-chart';
import { CustomizingProvider } from '@/lib/customizing-context';
import type { MonthlyPerformanceItem } from '@/lib/dashboard';

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock echarts-for-react since it renders to canvas (not testable in jsdom)
vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: Record<string, unknown> }) => (
    <div data-testid="echarts-mock" data-option={JSON.stringify(option)} />
  ),
}));

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_MONTHLY: MonthlyPerformanceItem[] = [
  { month: '2025-01', netPnl: 500, winRate: 0.6, tradeCount: 10 },
  { month: '2025-02', netPnl: -200, winRate: 0.45, tradeCount: 12 },
  { month: '2025-03', netPnl: 800, winRate: 0.65, tradeCount: 8 },
  { month: '2025-04', netPnl: 300, winRate: 0.55, tradeCount: 15 },
];

const EMPTY_MONTHLY: MonthlyPerformanceItem[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('MonthlyPerformanceChart', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
      />,
    );
    expect(screen.getByText('Monthly Performance')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
        title="Monthly P&L"
      />,
    );
    expect(screen.getByText('Monthly P&L')).toBeTruthy();
  });

  // ── Chart rendering ─────────────────────────────────────────────

  it('renders the ECharts chart when monthly performance data is provided', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();
  });

  it('builds chart option with dual Y-axes', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.yAxis).toHaveLength(2);
    // Left axis (index 0): P&L axis
    expect(option.yAxis[0].name).toBe('P&L ($)');
    // Right axis (index 1): Win Rate axis
    expect(option.yAxis[1].name).toBe('Win Rate');
    expect(option.yAxis[1].min).toBe(0);
    expect(option.yAxis[1].max).toBe(1);
  });

  it('builds chart option with bar and line series', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.series).toHaveLength(2);
    const seriesNames = option.series.map((s: Record<string, unknown>) => s.name);
    expect(seriesNames).toContain('Net P&L');
    expect(seriesNames).toContain('Win Rate');

    const netPnlSeries = option.series.find((s: Record<string, unknown>) => s.name === 'Net P&L');
    expect(netPnlSeries.type).toBe('bar');

    const winRateSeries = option.series.find((s: Record<string, unknown>) => s.name === 'Win Rate');
    expect(winRateSeries.type).toBe('line');
    expect(winRateSeries.yAxisIndex).toBe(1);
  });

  it('colour-codes P&L bars: green for positive, red for negative', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    const data = option.series[0].data;
    expect(data[0].itemStyle.color).toBe('#22c55e'); // $500 positive → green
    expect(data[1].itemStyle.color).toBe('#ef4444'); // -$200 negative → red
    expect(data[2].itemStyle.color).toBe('#22c55e'); // $800 positive → green
    expect(data[3].itemStyle.color).toBe('#22c55e'); // $300 positive → green
  });

  it('uses category xAxis with month abbreviations', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.xAxis.type).toBe('category');
    expect(option.xAxis.data).toEqual(['2025-01', '2025-02', '2025-03', '2025-04']);
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
        isLoading
      />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
        error="Failed to load monthly data"
      />,
    );
    expect(screen.getByText('Failed to load monthly data')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows empty state when isEmpty is true', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows EmptyState when monthlyPerformance is empty', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={EMPTY_MONTHLY}
      />,
    );
    expect(screen.getByText('No monthly data available')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows empty state description when no data', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={EMPTY_MONTHLY}
      />,
    );
    expect(
      screen.getByText(
        'Your monthly performance chart will appear here after you close trades across multiple months.',
      ),
    ).toBeTruthy();
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <CustomizingProvider value={true}>
        <MonthlyPerformanceChart
          monthlyPerformance={SAMPLE_MONTHLY}
        />
      </CustomizingProvider>,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
        testId="widget-monthly-performance"
      />,
    );
    const el = container.querySelector('[data-testid="widget-monthly-performance"]');
    expect(el).toBeTruthy();
  });

  // ── Grid layout ─────────────────────────────────────────────────

  it('uses standard grid layout with side padding for dual axes', () => {
    render(
      <MonthlyPerformanceChart
        monthlyPerformance={SAMPLE_MONTHLY}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.grid.left).toBe('10%');
    expect(option.grid.right).toBe('10%');
  });
});
