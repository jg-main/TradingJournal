import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DashboardSwitcher } from '../dashboard-switcher';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider } from '../performance-instance-context';
import { PerformanceDashboardShell } from '../performance-dashboard-shell';
import {
  cloneDashboardConfig,
  createSystemDefaultDashboard,
  type PerformanceDashboardEnvelope,
} from '@/lib/performance-view-types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

const defaultDashboard = createSystemDefaultDashboard();

function userDashboard(id = 'pd-user-test-1', name = 'My Dash'): PerformanceDashboardEnvelope {
  return {
    id,
    name,
    isSystem: false,
    config: { ...cloneDashboardConfig(defaultDashboard.config), name },
  };
}

interface RenderSwitcherOptions {
  editMode?: boolean;
  writeFailed?: boolean;
  dashboards?: PerformanceDashboardEnvelope[];
  activeDashboard?: PerformanceDashboardEnvelope | null;
  onSave?: () => void;
  onSwitch?: (id: string) => void;
  onCreate?: (name: string) => void;
  onRename?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onReset?: (id: string) => void;
}

function renderSwitcher(options: RenderSwitcherOptions = {}) {
  const dashboards = options.dashboards ?? [defaultDashboard, userDashboard()];
  const activeDashboard = options.activeDashboard ?? dashboards[0];
  return render(
    <DashboardSwitcher
      editMode={options.editMode ?? false}
      dashboards={dashboards}
      activeDashboard={activeDashboard}
      writeFailed={options.writeFailed ?? false}
      onSave={options.onSave ?? (() => {})}
      onSwitch={options.onSwitch ?? (() => {})}
      onCreate={options.onCreate ?? (() => {})}
      onRename={options.onRename ?? (() => {})}
      onDuplicate={options.onDuplicate ?? (() => {})}
      onDelete={options.onDelete ?? (() => {})}
      onReset={options.onReset ?? (() => {})}
    />,
  );
}

describe('DashboardSwitcher', () => {
  it('shows the active dashboard name on the trigger', () => {
    renderSwitcher();
    expect(screen.getByRole('button', { name: /Performance Default/ })).toBeDefined();
  });

  it('lists all dashboards with a System badge on the immutable default', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    expect(screen.getByRole('option', { name: /Performance Default/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /My Dash/ })).toBeDefined();
    expect(screen.getByText('System')).toBeDefined();
  });

  it('switches to the clicked dashboard', () => {
    const onSwitch = vi.fn();
    renderSwitcher({ onSwitch, dashboards: [defaultDashboard, userDashboard()] });
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    fireEvent.click(screen.getByRole('option', { name: /My Dash/ }));
    expect(onSwitch).toHaveBeenCalledWith('pd-user-test-1');
  });

  it('creates a dashboard with the entered name', () => {
    const onCreate = vi.fn();
    renderSwitcher({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    fireEvent.click(screen.getByText('+ New Dashboard'));
    const input = screen.getByPlaceholderText('Dashboard name');
    fireEvent.change(input, { target: { value: 'Weekly Review' } });
    fireEvent.click(screen.getByText('OK'));
    expect(onCreate).toHaveBeenCalledWith('Weekly Review');
  });

  it('creates a dashboard with the default name when the input is blank', () => {
    const onCreate = vi.fn();
    renderSwitcher({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    fireEvent.click(screen.getByText('+ New Dashboard'));
    fireEvent.click(screen.getByText('OK'));
    expect(onCreate).toHaveBeenCalledWith('New Dashboard');
  });

  it('duplicates the active dashboard', () => {
    const onDuplicate = vi.fn();
    renderSwitcher({
      onDuplicate,
      activeDashboard: userDashboard(),
      dashboards: [defaultDashboard, userDashboard()],
    });
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    fireEvent.click(screen.getByText('Duplicate'));
    expect(onDuplicate).toHaveBeenCalledWith('pd-user-test-1');
  });

  it('renames a user dashboard via prompt', () => {
    const onRename = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('Q2 Review');
    renderSwitcher({
      onRename,
      activeDashboard: userDashboard(),
      dashboards: [defaultDashboard, userDashboard()],
    });
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    fireEvent.click(screen.getByText('Rename…'));
    expect(onRename).toHaveBeenCalledWith('pd-user-test-1', 'Q2 Review');
  });

  it('deletes a user dashboard after confirmation', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSwitcher({
      onDelete,
      activeDashboard: userDashboard(),
      dashboards: [defaultDashboard, userDashboard()],
    });
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    fireEvent.click(screen.getByText('Delete…'));
    expect(onDelete).toHaveBeenCalledWith('pd-user-test-1');
  });

  it('does not offer rename/delete for the immutable system dashboard', () => {
    renderSwitcher({ activeDashboard: defaultDashboard, dashboards: [defaultDashboard] });
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    expect(screen.queryByText('Rename…')).toBeNull();
    expect(screen.queryByText('Delete…')).toBeNull();
  });

  it('resets the active dashboard to the template', () => {
    const onReset = vi.fn();
    renderSwitcher({ onReset, activeDashboard: userDashboard() });
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(onReset).toHaveBeenCalledWith('pd-user-test-1');
  });

  it('surfaces write failures as a warning', () => {
    renderSwitcher({ writeFailed: true });
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/server write failed/)).toBeDefined();
  });

  it('shows the explicit Save button only in edit mode', () => {
    const onSave = vi.fn();
    const { rerender } = renderSwitcher({ editMode: false, onSave });
    expect(screen.queryByText('Save')).toBeNull();

    rerender(
      <DashboardSwitcher
        editMode
        dashboards={[defaultDashboard]}
        activeDashboard={defaultDashboard}
        writeFailed={false}
        onSave={onSave}
        onSwitch={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReset={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalled();
  });
});

describe('DashboardSwitcher persistence wiring (shell level)', () => {
  it('captures, switches, and restores widget instances across dashboards', async () => {
    render(
      <PerformanceDashboardProvider>
        <PerformanceInstanceProvider>
          <PerformanceDashboardShell />
        </PerformanceInstanceProvider>
      </PerformanceDashboardProvider>,
    );

    // Wait for the store to hydrate (mount gate passes).
    await waitFor(() => expect(screen.getByText('Customize')).toBeDefined());

    // Create a user dashboard from the current state.
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    fireEvent.click(screen.getByText('+ New Dashboard'));
    fireEvent.change(screen.getByPlaceholderText('Dashboard name'), {
      target: { value: 'My Dash' },
    });
    fireEvent.click(screen.getByText('OK'));
    await waitFor(() => expect(screen.getByRole('button', { name: /My Dash/ })).toBeDefined());

    // Customize: add a Median R KPI, then explicitly save into My Dash.
    fireEvent.click(screen.getByText('Customize'));
    fireEvent.click(screen.getByText('+ Add KPI'));
    fireEvent.click(screen.getByText('Median R'));
    await waitFor(() => expect(screen.getByText('Median R')).toBeDefined());
    fireEvent.click(screen.getByText('Save'));

    // Switch to the system default: Median R must not be present there.
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    fireEvent.click(screen.getByRole('option', { name: /Performance Default/ }));
    await waitFor(() => expect(screen.queryByText('Median R')).toBeNull());

    // Switch back to My Dash: the saved instances restore.
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    fireEvent.click(screen.getByRole('option', { name: /My Dash/ }));
    await waitFor(() => expect(screen.getByText('Median R')).toBeDefined());

    // The immutable system default still shows its canonical KPI set.
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    fireEvent.click(screen.getByRole('option', { name: /Performance Default/ }));
    await waitFor(() => expect(screen.getByText('Net P&L')).toBeDefined());
    await waitFor(() => expect(screen.queryByText('Median R')).toBeNull());
  });

  it('captures edits made after creation when switching away (no explicit Save)', async () => {
    render(
      <PerformanceDashboardProvider>
        <PerformanceInstanceProvider>
          <PerformanceDashboardShell />
        </PerformanceInstanceProvider>
      </PerformanceDashboardProvider>,
    );

    await waitFor(() => expect(screen.getByText('Customize')).toBeDefined());

    // Create a dashboard, then customize without ever clicking Save.
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    fireEvent.click(screen.getByText('+ New Dashboard'));
    fireEvent.change(screen.getByPlaceholderText('Dashboard name'), {
      target: { value: 'My Dash' },
    });
    fireEvent.click(screen.getByText('OK'));
    await waitFor(() => expect(screen.getByRole('button', { name: /My Dash/ })).toBeDefined());

    fireEvent.click(screen.getByText('Customize'));
    fireEvent.click(screen.getByText('+ Add KPI'));
    fireEvent.click(screen.getByText('Median R'));
    await waitFor(() => expect(screen.getByText('Median R')).toBeDefined());

    // Switch away (no Save): the added instance must be captured into My Dash.
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    fireEvent.click(screen.getByRole('option', { name: /Performance Default/ }));
    await waitFor(() => expect(screen.queryByText('Median R')).toBeNull());

    // Switch back: My Dash restores the captured instances.
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    fireEvent.click(screen.getByRole('option', { name: /My Dash/ }));
    await waitFor(() => expect(screen.getByText('Median R')).toBeDefined());
  });
});
