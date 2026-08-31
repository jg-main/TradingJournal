import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// Canonical global operational period (M004/T9C): the sidebar Period
// selector owns the real provider; tests provide a stable mock.
vi.mock('@/lib/operational-date-range-context', () => ({
  useOperationalDateRange: () => ({
    selection: { preset: 'YTD', from: '', to: '' },
    resolvedRange: { from: '', to: '' },
    hydrated: true,
    setPreset: vi.fn(),
    setCustomRange: vi.fn(),
  }),
}));

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

/** Open the switcher popover via the canonical trigger and flush the overlay. */
async function openSwitcher() {
  fireEvent.click(screen.getByRole('button', { name: /Switch performance dashboard/ }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /Switch performance dashboard/ });
}

describe('DashboardSwitcher', () => {
  it('renders the trigger as a canonical Button with the active dashboard name visible', () => {
    renderSwitcher();
    const t = trigger();
    // The trigger is the canonical Button composed under the shared Popover
    // trigger (radix marks the composed element data-slot=popover-trigger).
    expect(t.tagName).toBe('BUTTON');
    expect(t.getAttribute('data-variant')).toBe('outline');
    expect(t.getAttribute('data-size')).toBe('lg');
    // The current dashboard name remains visible inside the trigger.
    expect(within(t).getByText('Performance Default')).toBeDefined();
  });

  it('shows the active dashboard name on the trigger', () => {
    renderSwitcher();
    expect(trigger()).toBeDefined();
  });

  it('lists all dashboards with a System label on the immutable default', async () => {
    renderSwitcher();
    await openSwitcher();
    expect(screen.getByRole('button', { name: /Performance Default/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /My Dash/ })).toBeDefined();
    expect(screen.getByText('System')).toBeDefined();
  });

  it('switches to the clicked dashboard and closes the overlay', async () => {
    const onSwitch = vi.fn();
    renderSwitcher({ onSwitch, dashboards: [defaultDashboard, userDashboard()] });
    await openSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    expect(onSwitch).toHaveBeenCalledWith('pd-user-test-1');
    // Selection closes the overlay: the option list is gone.
    expect(screen.queryByRole('button', { name: /My Dash/ })).toBeNull();
  });

  it('marks the active dashboard as identifiable without a new color', async () => {
    renderSwitcher({ activeDashboard: userDashboard(), dashboards: [defaultDashboard, userDashboard()] });
    await openSwitcher();
    // Active option uses the secondary (filled) variant; inactive stays ghost.
    const active = screen.getByRole('button', { name: /My Dash/ });
    const inactive = screen.getByRole('button', { name: /Performance Default/ });
    expect(active.getAttribute('data-variant')).toBe('secondary');
    expect(inactive.getAttribute('data-variant')).toBe('ghost');
  });

  it('creates a dashboard with the entered name (trimmed)', async () => {
    const onCreate = vi.fn();
    renderSwitcher({ onCreate });
    await openSwitcher();
    fireEvent.click(screen.getByText('+ New Dashboard'));
    const input = screen.getByPlaceholderText('Dashboard name');
    expect(input.getAttribute('data-slot')).toBe('input');
    fireEvent.change(input, { target: { value: '  Weekly Review  ' } });
    fireEvent.click(screen.getByText('OK'));
    expect(onCreate).toHaveBeenCalledWith('Weekly Review');
  });

  it('creates a dashboard via Enter with the entered name', async () => {
    const onCreate = vi.fn();
    renderSwitcher({ onCreate });
    await openSwitcher();
    fireEvent.click(screen.getByText('+ New Dashboard'));
    fireEvent.change(screen.getByPlaceholderText('Dashboard name'), {
      target: { value: 'Enter Dash' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Dashboard name'), { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('Enter Dash');
  });

  it('creates a dashboard with the default name when the input is blank', async () => {
    const onCreate = vi.fn();
    renderSwitcher({ onCreate });
    await openSwitcher();
    fireEvent.click(screen.getByText('+ New Dashboard'));
    fireEvent.click(screen.getByText('OK'));
    expect(onCreate).toHaveBeenCalledWith('New Dashboard');
  });

  it('clears the create input and closes the overlay after creation', async () => {
    const onCreate = vi.fn();
    renderSwitcher({ onCreate });
    await openSwitcher();
    fireEvent.click(screen.getByText('+ New Dashboard'));
    fireEvent.change(screen.getByPlaceholderText('Dashboard name'), {
      target: { value: 'My Dash' },
    });
    fireEvent.click(screen.getByText('OK'));
    expect(onCreate).toHaveBeenCalledWith('My Dash');
    // Overlay closed after creation.
    expect(screen.queryByPlaceholderText('Dashboard name')).toBeNull();
  });

  it('duplicates the active dashboard', async () => {
    const onDuplicate = vi.fn();
    renderSwitcher({
      onDuplicate,
      activeDashboard: userDashboard(),
      dashboards: [defaultDashboard, userDashboard()],
    });
    await openSwitcher();
    fireEvent.click(screen.getByText('Duplicate'));
    expect(onDuplicate).toHaveBeenCalledWith('pd-user-test-1');
  });

  it('renames a user dashboard via prompt', async () => {
    const onRename = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('Q2 Review');
    renderSwitcher({
      onRename,
      activeDashboard: userDashboard(),
      dashboards: [defaultDashboard, userDashboard()],
    });
    await openSwitcher();
    fireEvent.click(screen.getByText('Rename…'));
    expect(onRename).toHaveBeenCalledWith('pd-user-test-1', 'Q2 Review');
  });

  it('deletes a user dashboard after confirmation', async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSwitcher({
      onDelete,
      activeDashboard: userDashboard(),
      dashboards: [defaultDashboard, userDashboard()],
    });
    await openSwitcher();
    fireEvent.click(screen.getByText('Delete…'));
    expect(onDelete).toHaveBeenCalledWith('pd-user-test-1');
  });

  it('does not offer rename/delete for the immutable system dashboard', async () => {
    renderSwitcher({ activeDashboard: defaultDashboard, dashboards: [defaultDashboard] });
    await openSwitcher();
    expect(screen.queryByText('Rename…')).toBeNull();
    expect(screen.queryByText('Delete…')).toBeNull();
  });

  it('resets the active dashboard to the template', async () => {
    const onReset = vi.fn();
    renderSwitcher({ onReset, activeDashboard: userDashboard() });
    await openSwitcher();
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(onReset).toHaveBeenCalledWith('pd-user-test-1');
  });

  it('surfaces write failures as a warning', () => {
    renderSwitcher({ writeFailed: true });
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/server write failed/)).toBeDefined();
  });

  it('shows the explicit Save button only in edit mode as the primary action', () => {
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
    const save = screen.getByText('Save').closest('[data-slot="button"]') as HTMLElement;
    expect(save.getAttribute('data-variant')).toBe('default');
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalled();
  });

  it('toggles aria-expanded on the trigger as the overlay opens', async () => {
    renderSwitcher();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await openSwitcher();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
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
    await openSwitcher();
    fireEvent.click(screen.getByText('+ New Dashboard'));
    fireEvent.change(screen.getByPlaceholderText('Dashboard name'), {
      target: { value: 'My Dash' },
    });
    fireEvent.click(screen.getByText('OK'));
    await waitFor(() => expect(screen.getByText('My Dash')).toBeDefined());

    // Customize: add a Median R KPI, then explicitly save into My Dash.
    fireEvent.click(screen.getByText('Customize'));
    fireEvent.click(screen.getByText('+ Add KPI'));
    fireEvent.click(screen.getByText('Median R'));
    await waitFor(() => expect(screen.getByText('Median R')).toBeDefined());
    fireEvent.click(screen.getByText('Save'));

    // Switch to the system default: Median R must not be present there.
    await openSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    await waitFor(() => expect(screen.queryByText('Median R')).toBeNull());

    // Switch back to My Dash: the saved instances restore.
    await openSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    await waitFor(() => expect(screen.getByText('Median R')).toBeDefined());

    // The immutable system default still shows its canonical KPI set.
    await openSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
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
    await openSwitcher();
    fireEvent.click(screen.getByText('+ New Dashboard'));
    fireEvent.change(screen.getByPlaceholderText('Dashboard name'), {
      target: { value: 'My Dash' },
    });
    fireEvent.click(screen.getByText('OK'));
    await waitFor(() => expect(screen.getByText('My Dash')).toBeDefined());

    fireEvent.click(screen.getByText('Customize'));
    fireEvent.click(screen.getByText('+ Add KPI'));
    fireEvent.click(screen.getByText('Median R'));
    await waitFor(() => expect(screen.getByText('Median R')).toBeDefined());

    // Switch away (no Save): the added instance must be captured into My Dash.
    await openSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Performance Default/ }));
    await waitFor(() => expect(screen.queryByText('Median R')).toBeNull());

    // Switch back: My Dash restores the captured instances.
    await openSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /My Dash/ }));
    await waitFor(() => expect(screen.getByText('Median R')).toBeDefined());
  });
});
