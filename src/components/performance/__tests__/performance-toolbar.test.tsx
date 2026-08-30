import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PerformanceToolbar } from '../performance-toolbar';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider } from '../performance-instance-context';
import { PerformanceDashboardShell } from '../performance-dashboard-shell';
import { createSystemDefaultDashboard } from '@/lib/performance-view-types';

afterEach(() => cleanup());

const defaultDashboard = createSystemDefaultDashboard();

function renderToolbar(editMode: boolean, onToggleEditMode = () => {}, onSave = () => {}) {
  return render(
    <PerformanceToolbar
      editMode={editMode}
      onToggleEditMode={onToggleEditMode}
      onSave={onSave}
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

  it('renders Customize through the canonical Button (outline entry action)', () => {
    renderToolbar(false);
    const customize = screen.getByText('Customize').closest('[data-slot="button"]') as HTMLElement;
    expect(customize.getAttribute('data-slot')).toBe('button');
    expect(customize.getAttribute('data-variant')).toBe('outline');
    expect(customize.getAttribute('data-size')).toBe('lg');
  });

  it('renders Done through the canonical Button as the secondary action', () => {
    renderToolbar(true);
    const done = screen.getByText('Done').closest('[data-slot="button"]') as HTMLElement;
    expect(done.getAttribute('data-slot')).toBe('button');
    expect(done.getAttribute('data-variant')).toBe('secondary');
  });

  it('edit mode shows Save as primary and Done as secondary', () => {
    renderToolbar(true);
    const save = screen.getByText('Save').closest('[data-slot="button"]') as HTMLElement;
    expect(save.getAttribute('data-variant')).toBe('default');
    const done = screen.getByText('Done').closest('[data-slot="button"]') as HTMLElement;
    expect(done.getAttribute('data-variant')).toBe('secondary');
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

  it('Done exits edit mode without implicitly saving', () => {
    const onSave = vi.fn();
    const onToggle = vi.fn();
    renderToolbar(true, onToggle, onSave);
    fireEvent.click(screen.getByText('Done'));
    expect(onToggle).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
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
