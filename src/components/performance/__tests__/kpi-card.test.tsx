import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { KpiCard } from '../kpi-card';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';

afterEach(() => cleanup());

// Wrap with provider so the card can consume the context.
function renderCard(widgetType: string, config: Record<string, unknown> = {}, initialFilter?: Record<string, unknown>) {
  return render(
    <PerformanceDashboardProvider initialFilter={initialFilter as never}>
      <KpiCard instanceId="inst-1" widgetType={widgetType} config={config} />
    </PerformanceDashboardProvider>,
  );
}

describe('KpiCard', () => {
  it('renders a currency metric', () => {
    renderCard('net-pnl');
    expect(screen.getByText('Net P&L')).toBeDefined();
    // No analytics data loaded yet → em dash
    expect(screen.getByText('—')).toBeDefined();
  });

  it('renders title override', () => {
    renderCard('net-pnl', { titleOverride: 'My Net P&L' });
    expect(screen.getByText('My Net P&L')).toBeDefined();
  });

  it('renders fixed-semantic metric (win rate stays %)', () => {
    renderCard('win-rate');
    expect(screen.getByText('Win Rate')).toBeDefined();
  });

  it('renders count metric', () => {
    renderCard('total-trades');
    expect(screen.getByText('Total Trades')).toBeDefined();
  });

  it('renders edit mode controls when editMode is on', () => {
    render(
      <PerformanceDashboardProvider>
        <KpiCard
          instanceId="inst-1"
          widgetType="net-pnl"
          config={{}}
          editMode
          onConfigure={() => {}}
          onDuplicate={() => {}}
          onRemove={() => {}}
        />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByLabelText('Configure Net P&L')).toBeDefined();
    expect(screen.getByLabelText('Duplicate Net P&L')).toBeDefined();
    expect(screen.getByLabelText('Remove Net P&L')).toBeDefined();
  });

  it('does not render edit controls in normal mode', () => {
    renderCard('net-pnl');
    expect(screen.queryByLabelText('Configure Net P&L')).toBeNull();
    expect(screen.queryByLabelText('Duplicate Net P&L')).toBeNull();
    expect(screen.queryByLabelText('Remove Net P&L')).toBeNull();
  });
});
