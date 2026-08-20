import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { KpiRow } from '../kpi-row';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider } from '../performance-instance-context';

afterEach(() => cleanup());

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
  it('renders default KPI instances', () => {
    renderKpiRow();
    // Default dashboard: Net P&L, Win Rate, Profit Factor, Average R, Total Trades, Expectancy
    expect(screen.getByText('Net P&L')).toBeDefined();
    expect(screen.getByText('Win Rate')).toBeDefined();
    expect(screen.getByText('Profit Factor')).toBeDefined();
    expect(screen.getByText('Average R')).toBeDefined();
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

  it('duplicates a KPI card creating a second instance', () => {
    renderKpiRow(true);
    const duplicateButtons = screen.getAllByLabelText('Duplicate Net P&L');
    expect(duplicateButtons.length).toBeGreaterThan(0);
    fireEvent.click(duplicateButtons[0]);
    // Two Net P&L cards now
    expect(screen.getAllByText('Net P&L').length).toBe(2);
  });

  it('removes a KPI card', () => {
    renderKpiRow(true);
    const before = screen.getAllByText('Net P&L').length;
    const removeButtons = screen.getAllByLabelText('Remove Net P&L');
    fireEvent.click(removeButtons[0]);
    expect(screen.getAllByText('Net P&L').length).toBe(before - 1);
  });

  it('resets to default instances', () => {
    renderKpiRow(true);
    // Remove a card, then reset
    fireEvent.click(screen.getAllByLabelText('Remove Net P&L')[0]);
    const afterRemove = screen.queryAllByText('Net P&L').length;
    expect(afterRemove).toBeLessThan(screen.getAllByText('Win Rate').length + 1);
    fireEvent.click(screen.getByText('Reset'));
    expect(screen.getAllByText('Net P&L').length).toBeGreaterThan(0);
  });
});
