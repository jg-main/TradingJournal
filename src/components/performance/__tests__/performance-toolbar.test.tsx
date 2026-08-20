import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PerformanceToolbar } from '../performance-toolbar';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider } from '../performance-instance-context';
import { PerformanceDashboardShell } from '../performance-dashboard-shell';
import { createSystemDefaultDashboard } from '@/lib/performance-view-types';

afterEach(() => cleanup());

const defaultDashboard = createSystemDefaultDashboard();

function renderToolbar(editMode: boolean, onToggleEditMode = () => {}) {
  return render(
    <PerformanceToolbar
      editMode={editMode}
      onToggleEditMode={onToggleEditMode}
      onSave={() => {}}
      onSwitch={() => {}}
      dashboards={[defaultDashboard]}
      activeDashboard={defaultDashboard}
      writeFailed={false}
      onCreate={() => {}}
      onRename={() => {}}
      onDuplicate={() => {}}
      onDelete={() => {}}
      onReset={() => {}}
      tradeCount={5}
    />,
  );
}

describe('PerformanceToolbar', () => {
  it('shows Customize button in normal mode', () => {
    renderToolbar(false);
    expect(screen.getByText('Customize')).toBeDefined();
    expect(screen.getByText('5 trades')).toBeDefined();
  });

  it('shows Done button in edit mode', () => {
    renderToolbar(true);
    expect(screen.getByText('Done')).toBeDefined();
    expect(screen.queryByText('Customize')).toBeNull();
  });

  it('toggles mode on click', () => {
    let mode = false;
    const toggle = () => { mode = !mode; };
    const { rerender } = renderToolbar(mode, toggle);
    fireEvent.click(screen.getByText('Customize'));
    rerender(
      <PerformanceToolbar
        editMode={mode}
        onToggleEditMode={toggle}
        onSave={() => {}}
        onSwitch={() => {}}
        dashboards={[defaultDashboard]}
        activeDashboard={defaultDashboard}
        writeFailed={false}
        onCreate={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText('Done')).toBeDefined();
  });
});

describe('PerformanceDashboardShell mode flow', () => {
  it('normal mode has no edit chrome; Customize reveals edit controls', () => {
    render(
      <PerformanceDashboardProvider>
        <PerformanceInstanceProvider>
          <PerformanceDashboardShell />
        </PerformanceInstanceProvider>
      </PerformanceDashboardProvider>,
    );
    // Normal mode: no add/reset controls
    expect(screen.queryByText('+ Add KPI')).toBeNull();
    expect(screen.queryByText('+ Add Chart')).toBeNull();
    expect(screen.getByText('Customize')).toBeDefined();

    // Enter edit mode
    fireEvent.click(screen.getByText('Customize'));
    expect(screen.getByText('Done')).toBeDefined();
    expect(screen.getByText('+ Add KPI')).toBeDefined();
    expect(screen.getByText('+ Add Chart')).toBeDefined();
  });
});
