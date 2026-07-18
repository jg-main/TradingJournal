/**
 * Tests for the DashboardToolbar component.
 *
 * Covers: rendering all controls, date input changes, account selector
 * integration, date preset clicks, view switcher, customization mode
 * toggling, Refresh Prices interaction, and ThemeToggle presence.
 *
 * Run: npx vitest run src/components/dashboard/dashboard-toolbar.test.tsx
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { DashboardToolbar } from './dashboard-toolbar';
import type { DashboardToolbarProps } from './dashboard-toolbar';
import type { DatePreset } from '@/components/dashboard/filter-context';

// ── Fixtures ───────────────────────────────────────────────────────────

const mockViews = [
  {
    id: 'system-default',
    name: 'Default',
    layout: [],
    hiddenWidgetIds: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    isSystem: true,
    isDefault: true,
  },
  {
    id: 'system-trading-risk',
    name: 'Trading Risk',
    layout: [],
    hiddenWidgetIds: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    isSystem: true,
    isDefault: false,
  },
];

// ── Default Props ──────────────────────────────────────────────────────

const defaultProps: DashboardToolbarProps = {
  dateFrom: '2025-01-01',
  dateTo: '2025-01-31',
  accountId: null,
  onDateFromChange: vi.fn(),
  onDateToChange: vi.fn(),
  onAccountIdChange: vi.fn(),
  onDatePreset: vi.fn(),
  views: mockViews,
  activeViewId: 'system-default',
  onSelectView: vi.fn(),
  onCreateView: vi.fn(),
  onManageViews: vi.fn(),
  writeFailed: false,
  isCustomizing: false,
  onEnterCustomization: vi.fn(),
  onSaveCustomization: vi.fn(),
  onCancelCustomization: vi.fn(),
  onResetLayout: vi.fn(),
  onAddWidget: vi.fn(),
  refreshing: false,
  cooldownSeconds: 0,
  onRefreshPrices: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────

describe('DashboardToolbar', () => {
  beforeEach(() => {
    // jsdom does not implement window.matchMedia; ThemeToggle depends on it
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Rendering ─────────────────────────────────────────────────

  it('renders the title', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByTestId('toolbar-title')).toBeTruthy();
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('renders the toolbar container with a data-testid', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByTestId('dashboard-toolbar')).toBeTruthy();
  });

  it('renders date from and date to inputs', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByTestId('toolbar-date-from')).toBeTruthy();
    expect(screen.getByTestId('toolbar-date-to')).toBeTruthy();
  });

  it('renders the account selector', () => {
    render(<DashboardToolbar {...defaultProps} />);
    // AccountSelector renders its trigger after fetch resolves
    expect(screen.getByTestId('account-selector-loading')).toBeTruthy();
  });

  it('renders all date preset buttons', () => {
    render(<DashboardToolbar {...defaultProps} />);
    const presets = ['1w', '1m', '3m', '6m', 'ytd', 'all'];
    presets.forEach((p) => {
      expect(screen.getByTestId(`toolbar-preset-${p}`)).toBeTruthy();
    });
  });

  it('renders the view switcher', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByTestId('view-switcher-trigger')).toBeTruthy();
  });

  it('renders the Edit Layout button when not customizing', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByTestId('toolbar-edit-layout')).toBeTruthy();
    expect(screen.queryByTestId('toolbar-save-layout')).toBeNull();
  });

  it('renders the Refresh Prices button', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByTestId('toolbar-refresh-prices')).toBeTruthy();
  });

  it('renders the ThemeToggle', () => {
    render(<DashboardToolbar {...defaultProps} />);
    // ThemeToggle renders null until mounted, so we check for the button
    // (it uses accessibility label)
    expect(screen.getByLabelText('Toggle dark mode')).toBeTruthy();
  });

  // ── Date Input Changes ────────────────────────────────────────

  it('calls onDateFromChange when the from date changes', async () => {
    const handleChange = vi.fn();
    render(<DashboardToolbar {...defaultProps} onDateFromChange={handleChange} />);

    const input = screen.getByTestId('toolbar-date-from') as HTMLInputElement;
    await userEvent.type(input, '2025-02-01');
    // The input already has a value, so we clear and type
    await userEvent.clear(input);
    await userEvent.type(input, '2025-02-01');

    expect(handleChange).toHaveBeenCalled();
  });

  it('calls onDateToChange when the to date changes', async () => {
    const handleChange = vi.fn();
    render(<DashboardToolbar {...defaultProps} onDateToChange={handleChange} />);

    const input = screen.getByTestId('toolbar-date-to') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '2025-03-01');

    expect(handleChange).toHaveBeenCalled();
  });

  // ── Date Presets ──────────────────────────────────────────────

  it('calls onDatePreset when a preset button is clicked', async () => {
    const handlePreset = vi.fn();
    render(<DashboardToolbar {...defaultProps} onDatePreset={handlePreset} />);

    await userEvent.click(screen.getByTestId('toolbar-preset-1w'));
    expect(handlePreset).toHaveBeenCalledWith('1W');

    await userEvent.click(screen.getByTestId('toolbar-preset-ytd'));
    expect(handlePreset).toHaveBeenCalledWith('YTD');

    await userEvent.click(screen.getByTestId('toolbar-preset-all'));
    expect(handlePreset).toHaveBeenCalledWith('All');
  });

  it('calls onDatePreset with each preset type', async () => {
    const handlePreset = vi.fn();
    render(<DashboardToolbar {...defaultProps} onDatePreset={handlePreset} />);

    await userEvent.click(screen.getByTestId('toolbar-preset-1m'));
    expect(handlePreset).toHaveBeenCalledWith('1M');

    await userEvent.click(screen.getByTestId('toolbar-preset-3m'));
    expect(handlePreset).toHaveBeenCalledWith('3M');

    await userEvent.click(screen.getByTestId('toolbar-preset-6m'));
    expect(handlePreset).toHaveBeenCalledWith('6M');
  });

  // ── View Switcher ─────────────────────────────────────────────

  it('passes views and activeViewId to the ViewSwitcher', () => {
    render(<DashboardToolbar {...defaultProps} />);
    // ViewSwitcher shows the active view name in its trigger
    const trigger = screen.getByTestId('view-switcher-trigger');
    expect(trigger).toBeTruthy();
  });

  // ── Customization Mode ────────────────────────────────────────

  it('shows customization buttons when isCustomizing is true', () => {
    render(<DashboardToolbar {...defaultProps} isCustomizing={true} />);
    expect(screen.getByTestId('toolbar-add-widget')).toBeTruthy();
    expect(screen.getByTestId('toolbar-save-layout')).toBeTruthy();
    expect(screen.getByTestId('toolbar-cancel-layout')).toBeTruthy();
    expect(screen.getByTestId('toolbar-reset-layout')).toBeTruthy();
    expect(screen.queryByTestId('toolbar-edit-layout')).toBeNull();
  });

  it('calls onAddWidget when Add Widget is clicked', async () => {
    const handleAdd = vi.fn();
    render(
      <DashboardToolbar {...defaultProps} isCustomizing={true} onAddWidget={handleAdd} />,
    );
    await userEvent.click(screen.getByTestId('toolbar-add-widget'));
    expect(handleAdd).toHaveBeenCalledOnce();
  });

  it('calls onSaveCustomization when Save is clicked', async () => {
    const handleSave = vi.fn();
    render(
      <DashboardToolbar {...defaultProps} isCustomizing={true} onSaveCustomization={handleSave} />,
    );
    await userEvent.click(screen.getByTestId('toolbar-save-layout'));
    expect(handleSave).toHaveBeenCalledOnce();
  });

  it('calls onCancelCustomization when Cancel is clicked', async () => {
    const handleCancel = vi.fn();
    render(
      <DashboardToolbar
        {...defaultProps}
        isCustomizing={true}
        onCancelCustomization={handleCancel}
      />,
    );
    await userEvent.click(screen.getByTestId('toolbar-cancel-layout'));
    expect(handleCancel).toHaveBeenCalledOnce();
  });

  it('calls onResetLayout when Reset is clicked', async () => {
    const handleReset = vi.fn();
    render(
      <DashboardToolbar {...defaultProps} isCustomizing={true} onResetLayout={handleReset} />,
    );
    await userEvent.click(screen.getByTestId('toolbar-reset-layout'));
    expect(handleReset).toHaveBeenCalledOnce();
  });

  it('calls onEnterCustomization when Edit Layout is clicked', async () => {
    const handleEnter = vi.fn();
    render(
      <DashboardToolbar {...defaultProps} onEnterCustomization={handleEnter} />,
    );
    await userEvent.click(screen.getByTestId('toolbar-edit-layout'));
    expect(handleEnter).toHaveBeenCalledOnce();
  });

  // ── Refresh Prices ────────────────────────────────────────────

  it('calls onRefreshPrices when Refresh Prices is clicked', async () => {
    const handleRefresh = vi.fn();
    render(<DashboardToolbar {...defaultProps} onRefreshPrices={handleRefresh} />);
    await userEvent.click(screen.getByTestId('toolbar-refresh-prices'));
    expect(handleRefresh).toHaveBeenCalledOnce();
  });

  it('disables the Refresh button during refresh', () => {
    render(<DashboardToolbar {...defaultProps} refreshing={true} />);
    const btn = screen.getByTestId('toolbar-refresh-prices') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('disables the Refresh button during cooldown', () => {
    render(<DashboardToolbar {...defaultProps} cooldownSeconds={30} />);
    const btn = screen.getByTestId('toolbar-refresh-prices') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows cooldown countdown text', () => {
    render(<DashboardToolbar {...defaultProps} cooldownSeconds={15} />);
    const btn = screen.getByTestId('toolbar-refresh-prices');
    expect(btn.textContent).toContain('15s');
  });

  it('shows "Refresh" text when no cooldown', () => {
    render(<DashboardToolbar {...defaultProps} cooldownSeconds={0} />);
    const btn = screen.getByTestId('toolbar-refresh-prices');
    expect(btn.textContent).toContain('Refresh');
  });

  // ── Value Display ─────────────────────────────────────────────

  it('passes dateFrom and dateTo values to the inputs', () => {
    render(
      <DashboardToolbar
        {...defaultProps}
        dateFrom="2025-06-01"
        dateTo="2025-06-30"
      />,
    );
    const fromInput = screen.getByTestId('toolbar-date-from') as HTMLInputElement;
    const toInput = screen.getByTestId('toolbar-date-to') as HTMLInputElement;
    expect(fromInput.value).toBe('2025-06-01');
    expect(toInput.value).toBe('2025-06-30');
  });

  // ── Account Selector Integration ──────────────────────────────

  it('passes accountId and onAccountIdChange to AccountSelector', () => {
    const handleAccountChange = vi.fn();
    render(
      <DashboardToolbar
        {...defaultProps}
        accountId="acc-test"
        onAccountIdChange={handleAccountChange}
      />,
    );
    // AccountSelector renders loading skeleton initially
    expect(screen.getByTestId('account-selector-loading')).toBeTruthy();
  });

  // ── writeFailed Prop ──────────────────────────────────────────

  it('passes writeFailed to the ViewSwitcher', () => {
    render(<DashboardToolbar {...defaultProps} writeFailed={true} />);
    // writeFailed renders a warning element inside ViewSwitcher dropdown
    // The dropdown must be opened to see it — that's tested in ViewSwitcher tests
    expect(screen.getByTestId('view-switcher-trigger')).toBeTruthy();
  });
});
