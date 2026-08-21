import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ChartGrid } from '../chart-grid';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider } from '../performance-instance-context';

// ECharts renders to canvas, which jsdom does not implement. The chart body is
// not under test here — the editing chrome around each widget is.
vi.mock('@/components/dashboard-chart', () => ({
  DashboardChart: () => <div data-testid="chart-option" />,
}));

// Isolate the instance store per test (localStorage-backed) and keep the
// analytics fetch pending so widget bodies stay in their loading state.
beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => {}));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderChartGrid(editMode?: boolean) {
  return render(
    <PerformanceDashboardProvider>
      <PerformanceInstanceProvider>
        <ChartGrid editMode={editMode} />
      </PerformanceInstanceProvider>
    </PerformanceDashboardProvider>,
  );
}

const DEFAULT_CHART_COUNT = 6;

describe('ChartGrid', () => {
  it('renders the six default chart widgets in normal mode', () => {
    renderChartGrid();
    expect(screen.getByText('Daily Cumulative P&L')).toBeDefined();
    expect(screen.getByText('Net Daily P&L')).toBeDefined();
    expect(screen.getByText('Trade Duration Performance')).toBeDefined();
    expect(screen.getByText('Drawdown Curve')).toBeDefined();
    expect(screen.getByText('R-Multiple Distribution')).toBeDefined();
    expect(screen.getByText('Performance by Setup')).toBeDefined();
  });

  it('keeps normal mode free of editing chrome', () => {
    const { container } = renderChartGrid();
    // No drag handles, resize grips, or per-widget action buttons.
    expect(screen.queryByLabelText(/Drag .* to move/)).toBeNull();
    expect(screen.queryByLabelText('Resize widget')).toBeNull();
    expect(screen.queryByLabelText(/Duplicate/)).toBeNull();
    expect(screen.queryByLabelText(/Remove/)).toBeNull();
    // No edit frame (dashed accent border + tint), no drag-handle class.
    expect(container.querySelector('.chart-edit-frame')).toBeNull();
    expect(container.querySelector('.drag-handle')).toBeNull();
    // No grid-level Customize controls.
    expect(screen.queryByText('+ Add Chart')).toBeNull();
    expect(screen.queryByText('Reset')).toBeNull();
  });

  it('shows one drag handle, resize grip, and action buttons per widget in edit mode', () => {
    renderChartGrid(true);
    expect(screen.getAllByLabelText(/Drag .* to move/)).toHaveLength(DEFAULT_CHART_COUNT);
    expect(screen.getAllByLabelText('Resize widget')).toHaveLength(DEFAULT_CHART_COUNT);
    expect(screen.getAllByLabelText(/Duplicate/)).toHaveLength(DEFAULT_CHART_COUNT);
    expect(screen.getAllByLabelText(/Remove/)).toHaveLength(DEFAULT_CHART_COUNT);
    // The drag affordance carries an explicit visible label.
    expect(screen.getAllByText('Drag to move')).toHaveLength(DEFAULT_CHART_COUNT);
  });

  it('wraps every widget in the edit frame only in edit mode', () => {
    const { container } = renderChartGrid(true);
    expect(container.querySelectorAll('.chart-edit-frame').length).toBe(DEFAULT_CHART_COUNT);
  });

  it('places the drag handle above the widget body as a normal-flow sibling', () => {
    // The handle must not be an absolutely-positioned overlay that clips the
    // widget header: it is the first flex row of the wrapper, and the widget
    // body (including its title) follows it in DOM order.
    const { container } = renderChartGrid(true);
    const strips = container.querySelectorAll('.drag-handle');
    expect(strips.length).toBe(DEFAULT_CHART_COUNT);
    const firstStrip = strips[0];
    const body = firstStrip.nextElementSibling;
    expect(body).not.toBeNull();
    expect(body!.querySelector('h4')).not.toBeNull();
  });

  it('removes a chart widget via the edit-mode remove button', () => {
    renderChartGrid(true);
    fireEvent.click(screen.getAllByLabelText(/Remove/)[0]);
    expect(screen.getAllByLabelText(/Remove/)).toHaveLength(DEFAULT_CHART_COUNT - 1);
    expect(screen.getAllByLabelText(/Drag .* to move/)).toHaveLength(DEFAULT_CHART_COUNT - 1);
  });

  it('duplicates a chart widget via the edit-mode duplicate button', () => {
    renderChartGrid(true);
    fireEvent.click(screen.getAllByLabelText(/Duplicate/)[0]);
    expect(screen.getAllByLabelText(/Duplicate/)).toHaveLength(DEFAULT_CHART_COUNT + 1);
  });

  it('shows grid-level Customize controls only in edit mode', () => {
    const { unmount } = renderChartGrid();
    expect(screen.queryByText('+ Add Chart')).toBeNull();
    expect(screen.queryByText('Reset')).toBeNull();
    unmount();

    renderChartGrid(true);
    expect(screen.getByText('+ Add Chart')).toBeDefined();
    expect(screen.getByText('Reset')).toBeDefined();
  });
});
