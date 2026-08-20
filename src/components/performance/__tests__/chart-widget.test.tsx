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
vi.mock('@/components/dashboard-chart', () => ({
  DashboardChart: ({ option }: { option: unknown }) =>
    option ? <div data-testid="chart-option" /> : <div data-testid="no-chart-option" />,
}));

describe('ChartWidget', () => {
  it('renders an unknown widget type message for unregistered types', () => {
    render(
      <PerformanceDashboardProvider>
        <ChartWidget instanceId="i1" widgetType="not-a-chart" config={{}} />
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
        <ChartWidget instanceId="i1" widgetType="daily-cumulative-pnl" config={{}} />
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
        <ChartWidget instanceId="i1" widgetType="net-daily-pnl" config={{}} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByText('Net Daily P&L')).toBeDefined();
  });

  it('renders title override', () => {
    render(
      <PerformanceDashboardProvider>
        <ChartWidget instanceId="i1" widgetType="net-daily-pnl" config={{ titleOverride: 'My Daily P&L' }} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByText('My Daily P&L')).toBeDefined();
  });

  it('shows series toggle only in edit mode', () => {
    const { unmount } = render(
      <PerformanceDashboardProvider>
        <ChartWidget instanceId="i1" widgetType="drawdown-curve" config={{}} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.queryByLabelText('Series visibility for Drawdown Curve')).toBeNull();
    unmount();

    render(
      <PerformanceDashboardProvider>
        <ChartWidget instanceId="i1" widgetType="drawdown-curve" config={{}} editMode />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByLabelText('Series visibility for Drawdown Curve')).toBeDefined();
  });

  it('renders a widget-level error state when the analytics fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    render(
      <PerformanceDashboardProvider>
        <ChartWidget instanceId="i1" widgetType="daily-cumulative-pnl" config={{}} />
      </PerformanceDashboardProvider>,
    );
    // Debounced fetch fails → chart shows its own error slot, not a crash.
    await waitFor(() => {
      expect(screen.getByTestId('chart-error-daily-cumulative-pnl')).toBeDefined();
    });
    expect(screen.getByText('Failed to load analytics')).toBeDefined();
  });
});
