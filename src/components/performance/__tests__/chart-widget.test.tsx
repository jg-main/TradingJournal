import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ChartWidget } from '../chart-widget';

// Canonical account scope (Fix 4): resolved global account so the provider
// issues the scoped analytics fetch.
vi.mock('@/lib/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'acc-A', name: 'Account A', broker: null, currency: 'USD', isActive: true }],
    loading: false,
    error: null,
    accountId: 'acc-A',
    setAccountId: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));
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
    // Drawdown is a single downside series (CT5): the legacy visibleSeries
    // config no longer controls a second series; the legend toggle still shows.
    expect(option.series).toHaveLength(1);
    expect(option.series[0].data).toHaveLength(2);
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
    // Single downside series by default.
    expect(option.series).toHaveLength(1);
    expect(option.series[0].data).toHaveLength(1);
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
  // ── Corrective Task 2A: registry supportedUnits enforcement ──────────────

  it('drawdown-curve amount stays currency under global R (registry enforces supportedUnits)', async () => {
    lastOption = undefined;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        kpiMetrics: {},
        charts: {
          drawdownCurve: [
            { date: '2024-01-01', drawdownAmount: 500, drawdownPct: 0.02 },
            { date: '2024-01-02', drawdownAmount: 800, drawdownPct: 0.03 },
          ],
        },
        metadata: {
          accountCount: 1,
          mixedCurrencies: false,
          tradeCount: 2,
          dateRange: { from: null, to: null },
          distinctSymbols: [],
          periodStartEquity: 10000,
          totalInitialRisk: 200,
        },
      }),
    } as Response);
    render(
      <PerformanceDashboardProvider initialFilter={{ unit: 'r' } as never}>
        <ChartWidget widgetType="drawdown-curve" config={{}} />
      </PerformanceDashboardProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('chart-option')).toBeDefined());
    const option = lastOption as { series: Array<{ data: number[] }> };
    // drawdown-curve supportedUnits = [currency, percent] → global R resolves
    // to currency fallback (CT5): the single downside series stays negated
    // currency amounts — never 500/200 = 2.5R.
    expect(option.series).toHaveLength(1);
    expect(option.series[0].data).toEqual([-500, -800]);
  });

  it('daily-cumulative-pnl fully converts under global R (supportedUnits includes r)', async () => {
    lastOption = undefined;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        kpiMetrics: {},
        charts: {
          cumulativeDailyPnl: [
            { date: '2024-01-01', cumulativePnl: 1000 },
            { date: '2024-01-02', cumulativePnl: 2000 },
          ],
        },
        metadata: {
          accountCount: 1,
          mixedCurrencies: false,
          tradeCount: 2,
          dateRange: { from: null, to: null },
          distinctSymbols: [],
          periodStartEquity: 10000,
          totalInitialRisk: 200,
        },
      }),
    } as Response);
    render(
      <PerformanceDashboardProvider initialFilter={{ unit: 'r' } as never}>
        <ChartWidget widgetType="daily-cumulative-pnl" config={{}} />
      </PerformanceDashboardProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('chart-option')).toBeDefined());
    const option = lastOption as { series: Array<{ data: number[] }> };
    // supportedUnits = [currency, percent, r] → global R applies: 1000/200 = 5.
    expect(option.series[0].data).toEqual([5, 10]);
  });
});
