import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ChartWidget } from '../chart-widget';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Mock the echarts wrapper to avoid canvas rendering in jsdom
let lastOption: unknown;
vi.mock('@/components/dashboard-chart', () => ({
  DashboardChart: ({ option }: { option: unknown }) => {
    lastOption = option;
    return option ? <div data-testid="chart-option" /> : <div data-testid="no-chart-option" />;
  },
}));

describe('ChartWidget', () => {
  it('renders an unknown widget type message for unregistered types', () => {
    render(
      <PerformanceDashboardProvider>
        <ChartWidget widgetType="not-a-chart" config={{}} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByText(/Unknown widget type/)).toBeDefined();
  });

  it('renders a per-widget loading skeleton without analytics data', async () => {
    // isLoading flips true once the debounced fetch effect fires; a pending
    // fetch keeps the widget in the loading state (no stale data yet).
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => {}));
    render(
      <PerformanceDashboardProvider>
        <ChartWidget widgetType="daily-cumulative-pnl" config={{}} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByText('Daily Cumulative P&L')).toBeDefined();
    // First load shows a skeleton in the chart body, localized to this widget.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId('chart-skeleton-daily-cumulative-pnl')).toBeDefined();
  });

  it('renders chart title from registry', () => {
    render(
      <PerformanceDashboardProvider>
        <ChartWidget widgetType="net-daily-pnl" config={{}} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByText('Net Daily P&L')).toBeDefined();
  });

  it('renders title override', () => {
    render(
      <PerformanceDashboardProvider>
        <ChartWidget widgetType="net-daily-pnl" config={{ titleOverride: 'My Daily P&L' }} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByText('My Daily P&L')).toBeDefined();
  });

  it('keeps the widget header clean in both modes (series toggle moved under Configure)', () => {
    // The scattered Series toggle is removed from the chart header (R005); it
    // moves under the ⋯ menu's Configure action in T2. Neither mode shows it.
    const { unmount } = render(
      <PerformanceDashboardProvider>
        <ChartWidget widgetType="drawdown-curve" config={{}} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.queryByLabelText('Series visibility for Drawdown Curve')).toBeNull();
    // The header keeps the title only.
    expect(screen.getByText('Drawdown Curve')).toBeDefined();
    unmount();

    render(
      <PerformanceDashboardProvider>
        <ChartWidget widgetType="drawdown-curve" config={{}} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.queryByLabelText('Series visibility for Drawdown Curve')).toBeNull();
    expect(screen.getByText('Drawdown Curve')).toBeDefined();
  });

  it('applies Configure-dialog config to the chart option (visibleSeries + legend)', async () => {
    lastOption = undefined;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        kpiMetrics: {},
        charts: {
          drawdownCurve: [
            { date: '2024-01-01', drawdownAmount: 100, drawdownPct: 0.01 },
            { date: '2024-01-02', drawdownAmount: 200, drawdownPct: 0.02 },
          ],
        },
        metadata: {
          accountCount: 1,
          mixedCurrencies: false,
          tradeCount: 2,
          dateRange: { from: null, to: null },
          distinctSymbols: [],
        },
      }),
    } as Response);
    render(
      <PerformanceDashboardProvider>
        <ChartWidget
          widgetType="drawdown-curve"
          config={{ visibleSeries: ['drawdownAmount'], legendVisible: true }}
        />
      </PerformanceDashboardProvider>,
    );
    // Wait until the mocked chart actually receives a built option.
    await waitFor(() => expect(screen.getByTestId('chart-option')).toBeDefined());
    const option = lastOption as {
      series: Array<{ data: unknown[] }>;
      legend?: { show: boolean };
    };
    // Visible-series config hides the Percent series; legend toggle shows.
    expect(option.series[0].data).toHaveLength(2);
    expect(option.series[1].data).toEqual([]);
    expect(option.legend?.show).toBe(true);
  });

  it('keeps both series by default when no visibleSeries config is set', async () => {
    lastOption = undefined;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        kpiMetrics: {},
        charts: {
          drawdownCurve: [
            { date: '2024-01-01', drawdownAmount: 100, drawdownPct: 0.01 },
          ],
        },
        metadata: {
          accountCount: 1,
          mixedCurrencies: false,
          tradeCount: 1,
          dateRange: { from: null, to: null },
          distinctSymbols: [],
        },
      }),
    } as Response);
    render(
      <PerformanceDashboardProvider>
        <ChartWidget widgetType="drawdown-curve" config={{}} />
      </PerformanceDashboardProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('chart-option')).toBeDefined());
    const option = lastOption as { series: Array<{ data: unknown[] }> };
    expect(option.series[0].data).toHaveLength(1);
    expect(option.series[1].data).toHaveLength(1);
    // Dense default: no legend.
    expect((lastOption as { legend?: { show: boolean } }).legend?.show).toBeUndefined();
  });

  it('renders a widget-level error state when the analytics fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    render(
      <PerformanceDashboardProvider>
        <ChartWidget widgetType="daily-cumulative-pnl" config={{}} />
      </PerformanceDashboardProvider>,
    );
    // Debounced fetch fails → chart shows its own error slot, not a crash.
    await waitFor(() => {
      expect(screen.getByTestId('chart-error-daily-cumulative-pnl')).toBeDefined();
    });
    expect(screen.getByText('Failed to load analytics')).toBeDefined();
  });
});
