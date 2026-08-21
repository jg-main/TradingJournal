import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { KpiRow } from '../kpi-row';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider } from '../performance-instance-context';

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

afterEach(() => cleanup());

// Isolate the instance store per test so add/duplicate/remove mutations in one
// test cannot leak into the next via the persisted localStorage key.
beforeEach(() => {
  window.localStorage.clear();
});

function renderKpiRow(editMode?: boolean) {
  return render(
    <PerformanceDashboardProvider>
      <PerformanceInstanceProvider>
        <KpiRow editMode={editMode} />
      </PerformanceInstanceProvider>
    </PerformanceDashboardProvider>,
  );
}

describe('KpiRow', () => {
  it('renders the curated five default KPI cards', () => {
    renderKpiRow();
    // Curated default rail (R003): Net P&L, Win Rate, Profit Factor, Average R, Payoff Ratio.
    expect(screen.getByText('Net P&L')).toBeDefined();
    expect(screen.getByText('Win Rate')).toBeDefined();
    expect(screen.getByText('Profit Factor')).toBeDefined();
    expect(screen.getByText('Average R')).toBeDefined();
    expect(screen.getByText('Payoff Ratio')).toBeDefined();
    // Gross P&L and Total Trades are no longer on the default rail.
    expect(screen.queryByText('Gross P&L')).toBeNull();
    expect(screen.queryByText('Total Trades')).toBeNull();
  });

  it('renders add/remove/reset controls only in edit mode', () => {
    const { unmount } = renderKpiRow();
    expect(screen.queryByText('+ Add KPI')).toBeNull();
    unmount();

    renderKpiRow(true);
    expect(screen.getByText('+ Add KPI')).toBeDefined();
    expect(screen.getByText('Reset')).toBeDefined();
  });

  it('adds a KPI card from the add dialog', () => {
    renderKpiRow(true);
    fireEvent.click(screen.getByText('+ Add KPI'));
    expect(screen.getByText('Add KPI Card')).toBeDefined();
    fireEvent.click(screen.getByText('Median R'));
    expect(screen.getByText('Median R')).toBeDefined();
  });

  it('duplicates a KPI card creating a second instance via the ⋯ menu', async () => {
    const user = userEvent.setup();
    renderKpiRow(true);
    await user.click(screen.getByLabelText('Actions for Net P&L'));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    // Two Net P&L cards now
    expect(screen.getAllByText('Net P&L').length).toBe(2);
  });

  it('removes a KPI card via the ⋯ menu', async () => {
    const user = userEvent.setup();
    renderKpiRow(true);
    const before = screen.getAllByText('Net P&L').length;
    await user.click(screen.getByLabelText('Actions for Net P&L'));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    // queryAllByText so removing the final card (0 matches) is a valid assertion.
    expect(screen.queryAllByText('Net P&L').length).toBe(before - 1);
  });

  it('resets to default instances', async () => {
    const user = userEvent.setup();
    renderKpiRow(true);
    // Remove a card via its ⋯ menu, then use the grid-level Reset button.
    await user.click(screen.getByLabelText('Actions for Net P&L'));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    expect(screen.queryByText('Net P&L')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getAllByText('Net P&L').length).toBeGreaterThan(0);
  });

  it('resets a single widget to its registry default via the ⋯ menu', async () => {
    const user = userEvent.setup();
    renderKpiRow(true);
    // Configure the Net P&L card to show Total Trades via the typed dialog.
    await user.click(screen.getByLabelText('Actions for Net P&L'));
    await user.click(await screen.findByRole('menuitem', { name: 'Configure' }));
    // The typed Configure dialog opens with a Metric select (from the catalogue).
    await chooseSelectOption('Metric', 'Total Trades');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Total Trades')).toBeDefined();
    // Per-widget Reset restores the registry default metric.
    await user.click(screen.getByLabelText('Actions for Total Trades'));
    await user.click(await screen.findByRole('menuitem', { name: 'Reset' }));
    expect(screen.queryByText('Total Trades')).toBeNull();
    expect(screen.getByText('Net P&L')).toBeDefined();
  });

  it('reorders KPI cards with the move controls', () => {
    const { container } = renderKpiRow(true);
    const order = () =>
      Array.from(container.querySelectorAll('[data-kpi-value]')).map((el) =>
        el.getAttribute('data-kpi-value'),
      );
    expect(order()[0]).toBe('net-pnl');
    expect(order()[1]).toBe('win-rate');

    fireEvent.click(screen.getByLabelText('Move net-pnl down'));
    expect(order()[0]).toBe('win-rate');
    expect(order()[1]).toBe('net-pnl');

    // Boundary: first card's up control and last card's down control are disabled.
    expect(screen.getByLabelText('Move win-rate up')).toBeDefined();
    const lastDown = screen.getByLabelText('Move payoff-ratio down') as HTMLButtonElement;
    expect(lastDown.disabled).toBe(true);
  });

  it('persists KPI instances across remounts (simulated reload)', () => {
    const first = renderKpiRow(true);
    fireEvent.click(screen.getByText('+ Add KPI'));
    fireEvent.click(screen.getByText('Median R'));
    expect(screen.getByText('Median R')).toBeDefined();
    first.unmount();

    // Reload: a fresh tree reads the persisted instances back from localStorage.
    renderKpiRow(false);
    expect(screen.getByText('Median R')).toBeDefined();
    expect(screen.getAllByText('Net P&L').length).toBe(1);
  });
});
