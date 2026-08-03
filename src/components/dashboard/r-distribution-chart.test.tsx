/**
 * Tests for the RDistributionChart component.
 *
 * Covers: title rendering, loading/error/empty state passthrough,
 * chart option construction with colour-coded bars, empty data handling,
 * all-zero bins edge case.
 *
 * Run: npx vitest run src/components/dashboard/r-distribution-chart.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { RDistributionChart } from './r-distribution-chart';
import { CustomizingProvider } from '@/lib/customizing-context';
import { chartPalette, withAlpha } from '@/lib/chart-palette';
import type { RDistributionBin } from '@/lib/dashboard';

// Light palette — jsdom has no 'dark' class on documentElement, so the
// useChartPalette hook resolves the light theme.
const LIGHT = chartPalette.light;

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock echarts-for-react since it renders to canvas (not testable in jsdom)
vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: Record<string, unknown> }) => (
    <div data-testid="echarts-mock" data-option={JSON.stringify(option)} />
  ),
}));

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_R_DISTRIBUTION: RDistributionBin[] = [
  { label: '<= -3', count: 1 },
  { label: '-3 to -2', count: 2 },
  { label: '-2 to -1', count: 3 },
  { label: '-1 to 0', count: 5 },
  { label: '0 to 1', count: 8 },
  { label: '1 to 2', count: 6 },
  { label: '2 to 3', count: 3 },
  { label: '> 3', count: 2 },
];

const ALL_ZERO_R_DISTRIBUTION: RDistributionBin[] = [
  { label: '<= -3', count: 0 },
  { label: '-3 to -2', count: 0 },
  { label: '-2 to -1', count: 0 },
  { label: '-1 to 0', count: 0 },
  { label: '0 to 1', count: 0 },
  { label: '1 to 2', count: 0 },
  { label: '2 to 3', count: 0 },
  { label: '> 3', count: 0 },
];

const EMPTY_R_DISTRIBUTION: RDistributionBin[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('RDistributionChart', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
      />,
    );
    expect(screen.getByText('R Distribution')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
        title="R-Multiple Distribution"
      />,
    );
    expect(screen.getByText('R-Multiple Distribution')).toBeTruthy();
  });

  // ── Chart rendering ─────────────────────────────────────────────

  it('renders the ECharts chart when R distribution data is provided', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();
  });

  it('builds chart option with category xAxis and bin labels', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.xAxis.type).toBe('category');
    expect(option.xAxis.data).toEqual([
      '<= -3', '-3 to -2', '-2 to -1', '-1 to 0',
      '0 to 1', '1 to 2', '2 to 3', '> 3',
    ]);
    expect(option.xAxis.axisLabel.rotate).toBe(30);
  });

  it('has value axis named Trades', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.yAxis.name).toBe('Trades');
    expect(option.yAxis.type).toBe('value');
  });

  it('renders a single bar series', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.series).toHaveLength(1);
    expect(option.series[0].type).toBe('bar');
    expect(option.series[0].name).toBe('Trades');
  });

  it('colour-codes bars: green for positive, red for negative, grey for -1 to 0', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    const data = option.series[0].data;
    // Negative bins: red
    expect(data[0].itemStyle.color).toBe(LIGHT.negative); // <= -3
    expect(data[1].itemStyle.color).toBe(LIGHT.negative); // -3 to -2
    expect(data[2].itemStyle.color).toBe(LIGHT.negative); // -2 to -1
    // Gray zone (scratch): missing token
    expect(data[3].itemStyle.color).toBe(LIGHT.missing); // -1 to 0
    // Positive bins: green
    expect(data[4].itemStyle.color).toBe(LIGHT.positive); // 0 to 1
    expect(data[5].itemStyle.color).toBe(LIGHT.positive); // 1 to 2
    expect(data[6].itemStyle.color).toBe(LIGHT.positive); // 2 to 3
    expect(data[7].itemStyle.color).toBe(LIGHT.positive); // > 3
  });

  it('uses chartPalette grid/axis tokens for axes', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.xAxis.axisLabel.color).toBe(LIGHT.axis);
    expect(option.xAxis.axisLine.lineStyle.color).toBe(LIGHT.grid);
    expect(option.yAxis.axisLabel.color).toBe(LIGHT.axis);
    expect(option.yAxis.splitLine.lineStyle.color).toBe(withAlpha(LIGHT.grid, 0.5));
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
        isLoading
      />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
        error="Failed to load R distribution"
      />,
    );
    expect(screen.getByText('Failed to load R distribution')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows empty state when isEmpty is true', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows EmptyState when rDistribution is empty', () => {
    render(
      <RDistributionChart
        rDistribution={EMPTY_R_DISTRIBUTION}
      />,
    );
    expect(screen.getByText('No R distribution data available')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows EmptyState when all bins are zero', () => {
    render(
      <RDistributionChart
        rDistribution={ALL_ZERO_R_DISTRIBUTION}
      />,
    );
    expect(screen.getByText('No R distribution data available')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows empty state description when no data', () => {
    render(
      <RDistributionChart
        rDistribution={EMPTY_R_DISTRIBUTION}
      />,
    );
    expect(
      screen.getByText(
        'Your R-multiple distribution chart will appear here after you close trades with risk data.',
      ),
    ).toBeTruthy();
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <CustomizingProvider value={true}>
        <RDistributionChart
          rDistribution={SAMPLE_R_DISTRIBUTION}
        />
      </CustomizingProvider>,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
        testId="widget-r-distribution"
      />,
    );
    const el = container.querySelector('[data-testid="widget-r-distribution"]');
    expect(el).toBeTruthy();
  });

  // ── Grid layout ─────────────────────────────────────────────────

  it('uses standard grid layout', () => {
    render(
      <RDistributionChart
        rDistribution={SAMPLE_R_DISTRIBUTION}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.grid.left).toBe('10%');
    expect(option.grid.right).toBe('5%');
  });
});
