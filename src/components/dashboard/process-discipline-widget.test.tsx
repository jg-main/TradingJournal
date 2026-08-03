/**
 * Tests for the ProcessDisciplineWidget component.
 *
 * Covers: title rendering, chart rendering with grade distribution bins,
 * grade colour mapping (all 5 tiers via the theme-aware chartPalette),
 * xAxis/yAxis configuration, tooltip, bar label formatter,
 * loading/error/empty state passthrough, drag handle, testId support,
 * error is null handling, edge cases, and dark-theme reactivity.
 *
 * Run: npx vitest run src/components/dashboard/process-discipline-widget.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ProcessDisciplineWidget, getGradeColor, buildChartOption } from './process-discipline-widget';
import { chartPalette, withAlpha } from '@/lib/chart-palette';
import { CustomizingProvider } from '@/lib/customizing-context';
import type { ProcessScoreBin } from '@/lib/dashboard';

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock echarts-for-react since it renders to canvas (not testable in jsdom)
vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: Record<string, unknown> }) => (
    <div data-testid="echarts-mock" data-option={JSON.stringify(option)} />
  ),
}));

// Tests run in jsdom with no `dark` class, so the useChartPalette hook
// resolves the light theme by default.
const LIGHT = chartPalette.light;
const DARK = chartPalette.dark;

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_BINS: ProcessScoreBin[] = [
  { label: 'A (54-60)', count: 8, minScore: 54 },
  { label: 'B (42-53)', count: 15, minScore: 42 },
  { label: 'C (30-41)', count: 12, minScore: 30 },
  { label: 'D (18-29)', count: 5, minScore: 18 },
  { label: 'F (0-17)', count: 3, minScore: 0 },
];

const ZERO_BINS: ProcessScoreBin[] = [
  { label: 'A (54-60)', count: 0, minScore: 54 },
  { label: 'B (42-53)', count: 0, minScore: 42 },
  { label: 'C (30-41)', count: 0, minScore: 30 },
  { label: 'D (18-29)', count: 0, minScore: 18 },
  { label: 'F (0-17)', count: 0, minScore: 0 },
];

const SINGLE_BIN: ProcessScoreBin[] = [
  { label: 'C (30-41)', count: 7, minScore: 30 },
];

const EMPTY_BINS: ProcessScoreBin[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('ProcessDisciplineWidget', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    expect(screen.getByText('Process Discipline')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
        title="Grade Distribution"
      />,
    );
    expect(screen.getByText('Grade Distribution')).toBeTruthy();
  });

  // ── Chart rendering ─────────────────────────────────────────────

  it('renders the ECharts chart when data is provided', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();
  });

  it('passes bar data values to the chart option', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // series[0].data should contain the counts
    expect(option.series[0].data).toEqual([8, 15, 12, 5, 3]);
  });

  it('passes xAxis labels matching grade tier names', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.xAxis.data).toEqual([
      'A (54-60)',
      'B (42-53)',
      'C (30-41)',
      'D (18-29)',
      'F (0-17)',
    ]);
  });

  it('uses category xAxis type', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.xAxis.type).toBe('category');
  });

  it('uses value yAxis type with min 0', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.yAxis.type).toBe('value');
    expect(option.yAxis.min).toBe(0);
  });

  it('yAxis max provides headroom above the max count', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // Max count is 15, 15 * 1.25 = 18.75 → ceil = 19
    expect(option.yAxis.max).toBe(19);
  });

  it('yAxis max uses at least 2 when all counts are zero', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={ZERO_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // Max count is 0, Math.max(0, 1) = 1, ceil(1*1.25) = ceil(1.25) = 2
    expect(option.yAxis.max).toBe(2);
  });

  it('series uses bar type with 60% bar width', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.series[0].type).toBe('bar');
    expect(option.series[0].barWidth).toBe('60%');
  });

  it('bars have rounded top corners (borderRadius [4,4,0,0])', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.series[0].itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
  });

  it('shows count labels on top of bars', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.series[0].label.show).toBe(true);
    expect(option.series[0].label.position).toBe('top');
  });

  it('label formatter returns empty string for zero count', () => {
    const option = buildChartOption(ZERO_BINS, LIGHT);
    expect(option).not.toBeNull();
    const formatter = (option!.series as Array<{ label: { formatter: (p: { value: number }) => string } }>)[0].label.formatter;
    expect(formatter({ value: 0 })).toBe('');
  });

  it('label formatter returns count string for positive values', () => {
    const option = buildChartOption(SAMPLE_BINS, LIGHT);
    expect(option).not.toBeNull();
    const formatter = (option!.series as Array<{ label: { formatter: (p: { value: number }) => string } }>)[0].label.formatter;
    expect(formatter({ value: 8 })).toBe('8');
    expect(formatter({ value: 15 })).toBe('15');
  });

  it('tooltip uses axis trigger', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.tooltip.trigger).toBe('axis');
  });

  it('uses standard grid layout', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.grid.left).toBe(50);
    expect(option.grid.right).toBe(20);
    expect(option.grid.top).toBe(30);
    expect(option.grid.bottom).toBe(30);
  });

  // ── Grade Color Mapping (theme-aware palette) ───────────────────

  it('getGradeColor maps A grade label to series[0] (steel blue)', () => {
    const { barColor } = getGradeColor('A (54-60)', LIGHT);
    expect(barColor).toBe(LIGHT.series[0]);
  });

  it('getGradeColor maps B grade label to series[1] (graphite)', () => {
    const { barColor } = getGradeColor('B (42-53)', LIGHT);
    expect(barColor).toBe(LIGHT.series[1]);
  });

  it('getGradeColor maps C grade label to series[2] (steel cyan)', () => {
    const { barColor } = getGradeColor('C (30-41)', LIGHT);
    expect(barColor).toBe(LIGHT.series[2]);
  });

  it('getGradeColor maps D grade label to series[3] (indigo)', () => {
    const { barColor } = getGradeColor('D (18-29)', LIGHT);
    expect(barColor).toBe(LIGHT.series[3]);
  });

  it('getGradeColor maps E grade label to series[4] (gold, defensive)', () => {
    const { barColor } = getGradeColor('E (18-29)', LIGHT);
    expect(barColor).toBe(LIGHT.series[4]);
  });

  it('getGradeColor maps F grade label to negative (red)', () => {
    const { barColor } = getGradeColor('F (0-17)', LIGHT);
    expect(barColor).toBe(LIGHT.negative);
  });

  it('getGradeColor returns missing fallback for unknown labels', () => {
    const { barColor } = getGradeColor('Unknown Bin', LIGHT);
    expect(barColor).toBe(LIGHT.missing);
  });

  it('getGradeColor resolves dark-theme palette colors', () => {
    expect(getGradeColor('A (54-60)', DARK).barColor).toBe(DARK.series[0]);
    expect(getGradeColor('F (0-17)', DARK).barColor).toBe(DARK.negative);
    expect(getGradeColor('Unknown Bin', DARK).barColor).toBe(DARK.missing);
  });

  it('buildChartOption itemStyle color callback returns correct color per dataIndex', () => {
    const option = buildChartOption(SAMPLE_BINS, LIGHT);
    expect(option).not.toBeNull();
    const colorFn = (option!.series as Array<{ itemStyle: { color: (p: { dataIndex: number }) => string } }>)[0].itemStyle.color;
    expect(colorFn({ dataIndex: 0 })).toBe(LIGHT.series[0]);
    expect(colorFn({ dataIndex: 1 })).toBe(LIGHT.series[1]);
    expect(colorFn({ dataIndex: 2 })).toBe(LIGHT.series[2]);
    expect(colorFn({ dataIndex: 3 })).toBe(LIGHT.series[3]);
    expect(colorFn({ dataIndex: 4 })).toBe(LIGHT.negative);
  });

  // ── Chart palette tokens (grid/axis) ────────────────────────────

  it('uses chartPalette grid/axis tokens for axes and labels', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // Split lines use the translucent grid token
    expect(option.yAxis.splitLine.lineStyle.color).toBe(withAlpha(LIGHT.grid, 0.5));
    // xAxis labels and bar count labels use the axis token
    expect(option.xAxis.axisLabel.color).toBe(LIGHT.axis);
    expect(option.series[0].label.color).toBe(LIGHT.axis);
  });

  it('rebuilds option colours from the dark palette when the theme class is dark', () => {
    document.documentElement.classList.add('dark');
    try {
      // buildChartOption with the DARK palette keeps function-valued callbacks intact
      const option = buildChartOption(SAMPLE_BINS, DARK);
      expect(option).not.toBeNull();
      const colorFn = (option!.series as Array<{ itemStyle: { color: (p: { dataIndex: number }) => string } }>)[0].itemStyle.color;
      expect(colorFn({ dataIndex: 0 })).toBe(DARK.series[0]);
      expect(colorFn({ dataIndex: 4 })).toBe(DARK.negative);

      // Rendering with the dark class present resolves the dark palette end-to-end
      render(
        <ProcessDisciplineWidget
          processScoreDistribution={SAMPLE_BINS}
        />,
      );
      const chart = screen.getByTestId('echarts-mock');
      const renderedOption = JSON.parse(chart.getAttribute('data-option') ?? '{}');

      expect(renderedOption.yAxis.splitLine.lineStyle.color).toBe(withAlpha(DARK.grid, 0.5));
      expect(renderedOption.xAxis.axisLabel.color).toBe(DARK.axis);
      expect(renderedOption.series[0].label.color).toBe(DARK.axis);
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
        isLoading
      />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    // Chart should not render while loading
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
        error="Failed to load process data"
      />,
    );
    expect(screen.getByText('Failed to load process data')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows empty state when isEmpty is true', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows EmptyState when processScoreDistribution is empty array', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={EMPTY_BINS}
      />,
    );
    expect(screen.getByText('No process data available')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows empty state description when no data', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={EMPTY_BINS}
      />,
    );
    expect(
      screen.getByText(
        'Your grade distribution chart will appear here after you grade your trades.',
      ),
    ).toBeTruthy();
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <CustomizingProvider value={true}>
        <ProcessDisciplineWidget
          processScoreDistribution={SAMPLE_BINS}
        />
      </CustomizingProvider>,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
        testId="widget-process-discipline"
      />,
    );
    const el = container.querySelector('[data-testid="widget-process-discipline"]');
    expect(el).toBeTruthy();
  });

  // ── Error is null (no error shown) ──────────────────────────────

  it('renders chart when error is null', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
        error={null}
      />,
    );
    expect(screen.getByTestId('echarts-mock')).toBeTruthy();
  });

  // ── Edge Cases ──────────────────────────────────────────────────

  it('renders chart with all-zero bins', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={ZERO_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();
  });

  it('renders chart with a single bin', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SINGLE_BIN}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();

    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');
    expect(option.series[0].data).toEqual([7]);
    expect(option.xAxis.data).toEqual(['C (30-41)']);
  });

  // ── xAxis label configuration ───────────────────────────────────

  it('xAxis labels use bold font weight', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.xAxis.axisLabel.fontWeight).toBe('bold');
    expect(option.xAxis.axisLabel.fontSize).toBe(12);
  });

  // ── yAxis configuration ─────────────────────────────────────────

  it('yAxis uses dashed split lines', () => {
    render(
      <ProcessDisciplineWidget
        processScoreDistribution={SAMPLE_BINS}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.yAxis.splitLine.lineStyle.type).toBe('dashed');
  });

  it('empty bins return null option', () => {
    expect(buildChartOption(EMPTY_BINS, LIGHT)).toBeNull();
  });
});
