import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ChartGrid } from '../chart-grid';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider } from '../performance-instance-context';
import { getDefaultWidgetInstances } from '@/lib/performance-widget-registry';

// jsdom gaps for Radix Select (repo pattern — see performance-filter-bar.test.tsx).
Element.prototype.scrollIntoView = () => {};

/** Open a radix Select by combobox name and click the given option label. */
async function chooseSelectOption(comboboxName: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  const option = await screen.findByRole('option', { name: optionName });
  fireEvent.click(option);
  await act(async () => {
    await Promise.resolve();
  });
}

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
    // No drag handles, resize grips, or per-widget ⋯ actions triggers.
    expect(screen.queryByLabelText(/Drag .* to move/)).toBeNull();
    expect(screen.queryByLabelText('Resize widget')).toBeNull();
    expect(screen.queryByLabelText(/Actions for/)).toBeNull();
    // No edit frame (dashed accent border + tint), no drag-handle class.
    expect(container.querySelector('.chart-edit-frame')).toBeNull();
    expect(container.querySelector('.drag-handle')).toBeNull();
    // No grid-level Customize controls.
    expect(screen.queryByText('+ Add Chart')).toBeNull();
    expect(screen.queryByText('Reset')).toBeNull();
  });

  it('shows one drag handle, resize grip, and ⋯ actions menu per widget in edit mode', () => {
    renderChartGrid(true);
    expect(screen.getAllByLabelText(/Drag .* to move/)).toHaveLength(DEFAULT_CHART_COUNT);
    expect(screen.getAllByLabelText('Resize widget')).toHaveLength(DEFAULT_CHART_COUNT);
    expect(screen.getAllByLabelText(/Actions for/)).toHaveLength(DEFAULT_CHART_COUNT);
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

  it('removes a chart widget via the ⋯ actions menu', async () => {
    const user = userEvent.setup();
    renderChartGrid(true);
    await user.click(screen.getAllByLabelText(/Actions for/)[0]);
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    expect(screen.getAllByLabelText(/Actions for/)).toHaveLength(DEFAULT_CHART_COUNT - 1);
    expect(screen.getAllByLabelText(/Drag .* to move/)).toHaveLength(DEFAULT_CHART_COUNT - 1);
  });

  it('duplicates a chart widget via the ⋯ actions menu', async () => {
    const user = userEvent.setup();
    renderChartGrid(true);
    await user.click(screen.getAllByLabelText(/Actions for/)[0]);
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(screen.getAllByLabelText(/Actions for/)).toHaveLength(DEFAULT_CHART_COUNT + 1);
  });

  it('opens the ⋯ actions menu with Configure, Duplicate, Remove, and Reset', async () => {
    const user = userEvent.setup();
    renderChartGrid(true);
    await user.click(screen.getAllByLabelText(/Actions for/)[0]);
    expect(screen.getByRole('menuitem', { name: 'Configure' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Reset' })).toBeDefined();
  });

  it('resets a single chart widget to its registry default config via the ⋯ menu', async () => {
    const user = userEvent.setup();
    // Seed the default chart instances with the first one customized.
    const seeded = getDefaultWidgetInstances('chart').map((d, index) => ({
      instanceId: d.instanceId,
      widgetType: d.widgetType,
      config: index === 0 ? { titleOverride: 'Customized' } : {},
      layout: { i: d.instanceId, x: d.layout.x, y: d.layout.y, w: d.layout.w, h: d.layout.h, minW: 2, minH: 2 },
    }));
    window.localStorage.setItem('performance:chart-instances:v1', JSON.stringify(seeded));
    renderChartGrid(true);
    // The customized title renders once.
    expect(screen.getAllByText('Customized')).toHaveLength(1);
    // Reset the first widget (its ⋯ trigger label uses the registry title).
    await user.click(screen.getAllByLabelText(/Actions for/)[0]);
    await user.click(await screen.findByRole('menuitem', { name: 'Reset' }));
    // Config cleared → the customized title is gone and the default returns.
    expect(screen.queryByText('Customized')).toBeNull();
    expect(screen.getByText('Daily Cumulative P&L')).toBeDefined();
  });

  it('opens the typed Configure dialog for a multi-series chart and saves series visibility', async () => {
    const user = userEvent.setup();
    renderChartGrid(true);
    // Drawdown Curve declares visibleSeries (Amount $ / Percent %) in its
    // registry configSchema → the dialog renders typed checkboxes.
    await user.click(screen.getByLabelText('Actions for Drawdown Curve'));
    await user.click(await screen.findByRole('menuitem', { name: 'Configure' }));
    expect((screen.getByRole('checkbox', { name: 'Amount ($)' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Percent (%)' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Percent (%)' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Reopen Configure → the persisted choice is reflected (via the store).
    await user.click(screen.getByLabelText('Actions for Drawdown Curve'));
    await user.click(await screen.findByRole('menuitem', { name: 'Configure' }));
    expect((screen.getByRole('checkbox', { name: 'Amount ($)' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Percent (%)' }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('persists chart config through the instance store across remounts (save/reload)', async () => {
    const user = userEvent.setup();
    const first = renderChartGrid(true);
    await user.click(screen.getByLabelText('Actions for Drawdown Curve'));
    await user.click(await screen.findByRole('menuitem', { name: 'Configure' }));
    await user.click(screen.getByRole('checkbox', { name: 'Percent (%)' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    first.unmount();

    // Reload: a fresh tree reads the persisted instances from localStorage.
    renderChartGrid(true);
    await user.click(screen.getByLabelText('Actions for Drawdown Curve'));
    await user.click(await screen.findByRole('menuitem', { name: 'Configure' }));
    expect((screen.getByRole('checkbox', { name: 'Amount ($)' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Percent (%)' }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('opens the typed Configure dialog for performance-by-setup with a primary-series select', async () => {
    const user = userEvent.setup();
    renderChartGrid(true);
    await user.click(screen.getByLabelText('Actions for Performance by Setup'));
    await user.click(await screen.findByRole('menuitem', { name: 'Configure' }));
    await chooseSelectOption('Primary series', 'Win Rate');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Reopen → the saved primary series is selected (shown in the trigger).
    await user.click(screen.getByLabelText('Actions for Performance by Setup'));
    await user.click(await screen.findByRole('menuitem', { name: 'Configure' }));
    expect(screen.getByRole('combobox', { name: 'Primary series' }).textContent).toContain('Win Rate');
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
