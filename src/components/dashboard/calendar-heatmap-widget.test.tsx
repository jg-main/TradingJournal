/**
 * Tests for the CalendarHeatmapWidget component.
 *
 * Covers: title rendering, loading/error/empty state passthrough,
 * chart option construction with calendar coordinate system,
 * year selector for multi-year data, stats row, empty data handling.
 *
 * Run: npx vitest run src/components/dashboard/calendar-heatmap-widget.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { CalendarHeatmapWidget } from './calendar-heatmap-widget';
import { CustomizingProvider } from '@/lib/customizing-context';
import type { CalendarHeatmapYearData } from '@/lib/calendar-heatmap';

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock echarts-for-react since it renders to canvas (not testable in jsdom)
vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: Record<string, unknown> }) => (
    <div data-testid="echarts-mock" data-option={JSON.stringify(option)} />
  ),
}));

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_2025_DAYS = [
  { date: '2025-01-03', pnl: 250 },
  { date: '2025-01-07', pnl: -120 },
  { date: '2025-02-15', pnl: 800 },
  { date: '2025-03-10', pnl: -450 },
  { date: '2025-06-01', pnl: 1500 },
  { date: '2025-08-20', pnl: -300 },
  { date: '2025-11-11', pnl: 600 },
  { date: '2025-12-25', pnl: -50 },
];

const SAMPLE_2026_DAYS = [
  { date: '2026-01-15', pnl: 1200 },
  { date: '2026-02-20', pnl: -800 },
  { date: '2026-03-05', pnl: 350 },
  { date: '2026-04-10', pnl: -200 },
  { date: '2026-05-18', pnl: 2200 },
];

const SINGLE_YEAR_DATA: CalendarHeatmapYearData[] = [
  {
    year: 2026,
    days: SAMPLE_2026_DAYS,
  },
];

const MULTI_YEAR_DATA: CalendarHeatmapYearData[] = [
  {
    year: 2025,
    days: SAMPLE_2025_DAYS,
  },
  {
    year: 2026,
    days: SAMPLE_2026_DAYS,
  },
];

const EMPTY_YEAR_DATA: CalendarHeatmapYearData[] = [
  {
    year: 2026,
    days: [],
  },
];

const ALL_EMPTY: CalendarHeatmapYearData[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('CalendarHeatmapWidget', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );
    expect(screen.getByText('Calendar Heatmap')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
        title="Daily P&L Heatmap"
      />,
    );
    expect(screen.getByText('Daily P&L Heatmap')).toBeTruthy();
  });

  // ── Chart rendering ─────────────────────────────────────────────

  it('renders the ECharts chart when heatmap data is provided', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();
  });

  it('builds chart option with heatmap series using calendar coordinate system', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.series).toHaveLength(1);
    expect(option.series[0].type).toBe('heatmap');
    expect(option.series[0].coordinateSystem).toBe('calendar');
  });

  it('builds chart option with calendar component array', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(Array.isArray(option.calendar)).toBe(true);
    expect(option.calendar).toHaveLength(1);
    expect(option.calendar[0].range).toBe('2026');
  });

  it('builds chart option with visualMap for P&L colouring', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.visualMap).toBeTruthy();
    expect(option.visualMap.inRange).toBeTruthy();
    expect(Array.isArray(option.visualMap.inRange.color)).toBe(true);
    expect(option.visualMap.inRange.color).toHaveLength(8);
  });

  it('builds chart option with symmetrical visualMap range centred on zero', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // maxAbs from the data: largest absolute P&L is $2,200
    expect(option.visualMap.min).toBe(-2200);
    expect(option.visualMap.max).toBe(2200);
  });

  it('includes tooltip with trigger item for calendar heatmap', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    expect(option.tooltip.trigger).toBe('item');
  });

  it('includes ECharts data formatted as [dateString, pnl] tuples', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');
    const data = option.series[0].data as [string, number][];

    expect(data).toHaveLength(SAMPLE_2026_DAYS.length);
    expect(data[0]).toEqual(['2026-01-15', 1200]);
    expect(data[4]).toEqual(['2026-05-18', 2200]);
  });

  // ── Stats row ───────────────────────────────────────────────────

  it('renders the stats row with profit days, loss days, net P&L, and win rate', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );

    expect(screen.getByText('Winners')).toBeTruthy();
    expect(screen.getByText('Losers')).toBeTruthy();
    expect(screen.getByText('Net P&L')).toBeTruthy();
    expect(screen.getByText('Win Rate')).toBeTruthy();
  });

  it('displays correct profit/loss day counts in stats row', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );

    // 3 profit days, 2 loss days
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('displays net P&L in the stats row', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );

    // Expected: 1200 - 800 + 350 - 200 + 2200 = 2750
    // The net P&L is the third tabular-nums element (after profit count and loss count)
    const pnlValues = document.querySelectorAll('.tabular-nums');
    // Index 2 = Net P&L value
    expect(pnlValues.length).toBeGreaterThanOrEqual(3);
    expect(pnlValues[2]?.textContent).toContain('2,750');
  });

  // ── Year selector ───────────────────────────────────────────────

  it('shows year selector buttons when data spans multiple years', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={MULTI_YEAR_DATA}
      />,
    );

    expect(screen.getByText('2025')).toBeTruthy();
    expect(screen.getByText('2026')).toBeTruthy();
  });

  it('defaults to the most recent year with data', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={MULTI_YEAR_DATA}
      />,
    );

    // 2026 has the most recent data, so 2026 button should be active
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');
    expect(option.calendar[0].range).toBe('2026');
  });

  it('switches year data when a different year button is clicked', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={MULTI_YEAR_DATA}
      />,
    );

    // Click 2025 button
    const btn2025 = screen.getByText('2025');
    fireEvent.click(btn2025);

    // Chart should now show 2025 data
    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');
    expect(option.calendar[0].range).toBe('2025');
  });

  it('does not show year selector for single-year data', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
      />,
    );

    expect(screen.queryByText('2025')).toBeNull();
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
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
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
        error="Failed to load heatmap data"
      />,
    );
    expect(screen.getByText('Failed to load heatmap data')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows empty state when isEmpty is true', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows EmptyState when heatmapData has no entries', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={ALL_EMPTY}
      />,
    );
    expect(screen.getByText('No calendar data available')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows EmptyState when heatmapData has a year with zero days', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={EMPTY_YEAR_DATA}
      />,
    );
    expect(screen.getByText('No calendar data available')).toBeTruthy();
    expect(screen.queryByTestId('echarts-mock')).toBeNull();
  });

  it('shows empty state description when no data', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={ALL_EMPTY}
      />,
    );
    expect(
      screen.getByText(
        'Your daily P&L calendar heatmap will appear here after you close trades.',
      ),
    ).toBeTruthy();
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <CustomizingProvider value={true}>
        <CalendarHeatmapWidget
          heatmapData={SINGLE_YEAR_DATA}
        />
      </CustomizingProvider>,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
        testId="widget-calendar-heatmap"
      />,
    );
    const el = container.querySelector('[data-testid="widget-calendar-heatmap"]');
    expect(el).toBeTruthy();
  });

  // ── Error is null ───────────────────────────────────────────────

  it('renders chart when error is null', () => {
    render(
      <CalendarHeatmapWidget
        heatmapData={SINGLE_YEAR_DATA}
        error={null}
      />,
    );
    expect(screen.getByTestId('echarts-mock')).toBeTruthy();
  });

  // ── Min/max visualMap range uses symmetrical scaling ────────────

  it('visualMap range is symmetrical even when extremes are uneven', () => {
    const skewedData: CalendarHeatmapYearData[] = [
      {
        year: 2026,
        days: [
          { date: '2026-01-01', pnl: 100 },
          { date: '2026-01-02', pnl: -3000 },
          { date: '2026-01-03', pnl: 50 },
        ],
      },
    ];

    render(
      <CalendarHeatmapWidget
        heatmapData={skewedData}
      />,
    );

    const chart = screen.getByTestId('echarts-mock');
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}');

    // maxAbs should be 3000
    expect(option.visualMap.min).toBe(-3000);
    expect(option.visualMap.max).toBe(3000);
  });
});
