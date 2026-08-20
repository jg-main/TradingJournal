import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { ChartWidget } from '../chart-widget';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';

afterEach(() => cleanup());

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

  it('renders loading state without analytics data', () => {
    render(
      <PerformanceDashboardProvider>
        <ChartWidget instanceId="i1" widgetType="daily-cumulative-pnl" config={{}} />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByText('Daily Cumulative P&L')).toBeDefined();
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
});
