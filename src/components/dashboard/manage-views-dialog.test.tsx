/**
 * Tests for the ManageViewsDialog component.
 *
 * Covers: dialog open/close, system views section with edit action,
 * user views section with rename/duplicate/delete/set-default actions,
 * inline rename flow, delete confirmation flow, switch view from name
 * click, empty user views state, active/default indicator badges.
 *
 * Run: npx vitest run src/components/dashboard/manage-views-dialog.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ManageViewsDialog } from './manage-views-dialog';
import type { DashboardView } from '@/types/dashboard-view';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const NOW = '2026-01-01T00:00:00.000Z';

const SYSTEM_VIEWS: DashboardView[] = [
  {
    id: 'system-default',
    name: 'Default',
    layout: [],
    hiddenWidgetIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isDefault: true,
  },
  {
    id: 'system-trading-risk',
    name: 'Trading Risk',
    layout: [],
    hiddenWidgetIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isDefault: false,
  },
  {
    id: 'system-performance',
    name: 'Performance',
    layout: [],
    hiddenWidgetIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isDefault: false,
  },
  {
    id: 'system-process-review',
    name: 'Process Review',
    layout: [],
    hiddenWidgetIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isDefault: false,
  },
];

const USER_VIEWS: DashboardView[] = [
  {
    id: 'user-1',
    name: 'My Custom View',
    layout: [],
    hiddenWidgetIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: false,
    isDefault: false,
  },
  {
    id: 'user-2',
    name: 'Weekly Focus',
    layout: [],
    hiddenWidgetIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: false,
    isDefault: false,
  },
];

const DEFAULT_USER_VIEW: DashboardView = {
  id: 'user-default',
  name: 'Default Copy',
  layout: [],
  hiddenWidgetIds: [],
  createdAt: NOW,
  updatedAt: NOW,
  isSystem: false,
  isDefault: true,
};

const ALL_VIEWS = [...SYSTEM_VIEWS, ...USER_VIEWS];

// ═══════════════════════════════════════════════════════════════════════════
// Setup / Teardown
// ═══════════════════════════════════════════════════════════════════════════

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderManageViewsDialog({
  open = true,
  onOpenChange = vi.fn(),
  views = ALL_VIEWS,
  activeViewId = 'system-default',
  onRename = vi.fn(),
  onDuplicate = vi.fn(),
  onDelete = vi.fn(),
  onSetDefault = vi.fn(),
  onEditSystemView = undefined,
  onSwitchView = vi.fn(),
}: Partial<Parameters<typeof ManageViewsDialog>[0]> = {}) {
  return render(
    <ManageViewsDialog
      open={open}
      onOpenChange={onOpenChange}
      views={views}
      activeViewId={activeViewId}
      onRename={onRename}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      onSetDefault={onSetDefault}
      onEditSystemView={onEditSystemView}
      onSwitchView={onSwitchView}
    />,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('ManageViewsDialog', () => {
  // ── Dialog Open/Close ─────────────────────────────────────────────

  it('renders the dialog when open is true', () => {
    renderManageViewsDialog({ open: true });
    expect(screen.getByTestId('manage-views-dialog')).toBeTruthy();
  });

  it('does not render the dialog when open is false', () => {
    renderManageViewsDialog({ open: false });
    expect(screen.queryByTestId('manage-views-dialog')).toBeNull();
  });

  it('has a descriptive dialog title', () => {
    renderManageViewsDialog();
    expect(screen.getByText('Manage Views')).toBeTruthy();
  });

  it('has a dialog description', () => {
    renderManageViewsDialog();
    expect(
      screen.getByText(/Rename, duplicate, or delete your custom views/),
    ).toBeTruthy();
  });

  it('calls onOpenChange when the dialog is closed', async () => {
    const onOpenChange = vi.fn();
    renderManageViewsDialog({ onOpenChange });
    const user = userEvent.setup();

    // Click the close button — use getAllByRole since there are multiple
    // Close buttons: one in DialogContent (X icon) and one in DialogFooter.
    // The content close button has data-slot="dialog-close" on its closest ancestor.
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    // Click the first one (the X icon in the dialog header)
    await user.click(closeButtons[0]);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ── System Views Section ──────────────────────────────────────────

  it('shows the System Views section', () => {
    renderManageViewsDialog();
    expect(screen.getByTestId('system-views-section')).toBeTruthy();
    expect(screen.getByText('System Views')).toBeTruthy();
  });

  it('shows all system view names', () => {
    renderManageViewsDialog();
    // Use getAllByText for 'Default' since it appears both as the view name
    // AND in the "Default" badge. Assert at least one occurrence.
    const defaults = screen.getAllByText('Default');
    expect(defaults.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Trading Risk')).toBeTruthy();
    expect(screen.getByText('Performance')).toBeTruthy();
    expect(screen.getByText('Process Review')).toBeTruthy();
  });

  it('shows a "System" badge on system view rows', () => {
    renderManageViewsDialog();
    const badges = screen.getAllByText('System');
    expect(badges).toHaveLength(SYSTEM_VIEWS.length);
  });

  it('shows "Default" badge on the default system view', () => {
    renderManageViewsDialog();
    const badge = screen.getByTestId('manage-view-system-default-default-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Default');
  });

  it('shows "Active" indicator on the active view', () => {
    renderManageViewsDialog({ activeViewId: 'system-trading-risk' });
    const badge = screen.getByTestId(
      'manage-view-system-trading-risk-active-badge',
    );
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('Active');
  });

  it('shows an Edit button on each system view row', () => {
    renderManageViewsDialog();
    for (const view of SYSTEM_VIEWS) {
      const editButton = screen.getByTestId(`manage-view-${view.id}-edit`);
      expect(editButton).toBeTruthy();
    }
  });

  it('calls onEditSystemView when Edit is clicked on a system view', async () => {
    const onEditSystemView = vi.fn();
    renderManageViewsDialog({ onEditSystemView });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-system-default-edit'));
    expect(onEditSystemView).toHaveBeenCalledTimes(1);
    expect(onEditSystemView).toHaveBeenCalledWith('system-default');
  });

  it('calls onDuplicate as fallback when onEditSystemView is not provided', async () => {
    const onDuplicate = vi.fn();
    renderManageViewsDialog({ onDuplicate });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-system-default-edit'));
    expect(onDuplicate).toHaveBeenCalledWith('system-default');
  });

  // ── User Views Section ────────────────────────────────────────────

  it('shows the User Views section', () => {
    renderManageViewsDialog();
    expect(screen.getByTestId('user-views-section')).toBeTruthy();
    expect(screen.getByText('User Views')).toBeTruthy();
  });

  it('shows user view count in the section header', () => {
    renderManageViewsDialog();
    expect(screen.getByText('(2)')).toBeTruthy();
  });

  it('shows all user view names', () => {
    renderManageViewsDialog();
    expect(screen.getByText('My Custom View')).toBeTruthy();
    expect(screen.getByText('Weekly Focus')).toBeTruthy();
  });

  it('shows action buttons on user view rows (rename, duplicate, delete)', () => {
    renderManageViewsDialog();
    for (const view of USER_VIEWS) {
      expect(
        screen.getByTestId(`manage-view-${view.id}-rename`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`manage-view-${view.id}-duplicate`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`manage-view-${view.id}-delete`),
      ).toBeTruthy();
    }
  });

  it('shows "Set as Default" button only for non-default user views', () => {
    renderManageViewsDialog();
    for (const view of USER_VIEWS) {
      // These are not default, so set-default should be visible
      expect(
        screen.getByTestId(`manage-view-${view.id}-set-default`),
      ).toBeTruthy();
    }
  });

  it('does not show "Set as Default" button on the default user view', () => {
    const viewsWithDefault = [DEFAULT_USER_VIEW, ...USER_VIEWS];
    renderManageViewsDialog({
      views: viewsWithDefault,
      activeViewId: DEFAULT_USER_VIEW.id,
    });
    expect(
      screen.queryByTestId(
        `manage-view-${DEFAULT_USER_VIEW.id}-set-default`,
      ),
    ).toBeNull();
  });

  it('shows "Default" badge on the default user view', () => {
    const viewsWithDefault = [DEFAULT_USER_VIEW, ...USER_VIEWS];
    renderManageViewsDialog({
      views: viewsWithDefault,
    });
    expect(
      screen.getByTestId(`manage-view-${DEFAULT_USER_VIEW.id}-default-badge`),
    ).toBeTruthy();
  });

  it('shows "Active" badge on the currently active user view', () => {
    renderManageViewsDialog({ activeViewId: 'user-1' });
    const badge = screen.getByTestId('manage-view-user-1-active-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('Active');
  });

  it('does not show "Active" badge on non-active user views', () => {
    renderManageViewsDialog({ activeViewId: 'system-default' });
    expect(
      screen.queryByTestId('manage-view-user-1-active-badge'),
    ).toBeNull();
  });

  it('renders empty state when no user views exist', () => {
    renderManageViewsDialog({ views: SYSTEM_VIEWS });
    expect(screen.getByTestId('no-user-views')).toBeTruthy();
    expect(
      screen.getByText('No user views yet. Create one from the View dropdown.'),
    ).toBeTruthy();
  });

  // ── Callbacks ─────────────────────────────────────────────────────

  it('calls onDuplicate when duplicate button is clicked', async () => {
    const onDuplicate = vi.fn();
    renderManageViewsDialog({ onDuplicate });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-duplicate'));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledWith('user-1');
  });

  it('calls onSetDefault when set-default button is clicked', async () => {
    const onSetDefault = vi.fn();
    renderManageViewsDialog({ onSetDefault });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-set-default'));
    expect(onSetDefault).toHaveBeenCalledTimes(1);
    expect(onSetDefault).toHaveBeenCalledWith('user-1');
  });

  it('calls onSwitchView when a user view name is clicked', async () => {
    const onSwitchView = vi.fn();
    renderManageViewsDialog({ onSwitchView });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-name'));
    expect(onSwitchView).toHaveBeenCalledTimes(1);
    expect(onSwitchView).toHaveBeenCalledWith('user-1');
  });

  // ── Inline Rename ─────────────────────────────────────────────────

  it('shows inline rename input when rename button is clicked', async () => {
    renderManageViewsDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-rename'));
    expect(screen.getByTestId('inline-rename')).toBeTruthy();
    expect(screen.getByTestId('inline-rename-input')).toBeTruthy();
  });

  it('calls onRename when rename is saved via save button', async () => {
    const onRename = vi.fn();
    renderManageViewsDialog({ onRename });
    const user = userEvent.setup();

    // Click rename to show input
    await user.click(screen.getByTestId('manage-view-user-1-rename'));

    // Clear and type new name
    const input = screen.getByTestId('inline-rename-input');
    await user.clear(input);
    await user.type(input, 'Renamed View');

    // Click save
    await user.click(screen.getByTestId('inline-rename-save'));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('user-1', 'Renamed View');
  });

  it('calls onRename when Enter is pressed in rename input', async () => {
    const onRename = vi.fn();
    renderManageViewsDialog({ onRename });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-rename'));

    const input = screen.getByTestId('inline-rename-input');
    await user.clear(input);
    await user.type(input, 'EnterNamed{Enter}');

    expect(onRename).toHaveBeenCalledWith('user-1', 'EnterNamed');
  });

  it('cancels rename when Escape is pressed', async () => {
    const onRename = vi.fn();
    renderManageViewsDialog({ onRename });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-rename'));
    const input = screen.getByTestId('inline-rename-input');
    await user.clear(input);
    await user.type(input, 'Changed{Escape}');

    // Rename should not have been called
    expect(onRename).not.toHaveBeenCalled();
    // Inline rename should be gone
    expect(screen.queryByTestId('inline-rename')).toBeNull();
  });

  it('cancels rename when cancel button is clicked', async () => {
    const onRename = vi.fn();
    renderManageViewsDialog({ onRename });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-rename'));
    await user.click(screen.getByTestId('inline-rename-cancel'));

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inline-rename')).toBeNull();
  });

  it('disables rename save button when input is empty', async () => {
    renderManageViewsDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-rename'));
    const input = screen.getByTestId('inline-rename-input');
    await user.clear(input);

    // Save button should be disabled
    const saveBtn = screen.getByTestId('inline-rename-save');
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('hides action buttons during rename', async () => {
    renderManageViewsDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-rename'));

    // Action buttons should be hidden while renaming
    expect(
      screen.queryByTestId('manage-view-user-1-rename'),
    ).toBeNull();
    expect(
      screen.queryByTestId('manage-view-user-1-duplicate'),
    ).toBeNull();
    expect(
      screen.queryByTestId('manage-view-user-1-delete'),
    ).toBeNull();
  });

  // ── Delete Confirmation ───────────────────────────────────────────

  it('shows delete confirmation prompt when delete button is clicked', async () => {
    renderManageViewsDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-delete'));

    expect(screen.getByTestId('confirm-prompt')).toBeTruthy();
    expect(screen.getByText(/Delete "My Custom View"\?/)).toBeTruthy();
  });

  it('calls onDelete when delete is confirmed', async () => {
    const onDelete = vi.fn();
    renderManageViewsDialog({ onDelete });
    const user = userEvent.setup();

    // Click delete to show confirm prompt
    await user.click(screen.getByTestId('manage-view-user-1-delete'));

    // Confirm delete
    await user.click(screen.getByTestId('confirm-prompt-yes'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('user-1');
  });

  it('cancels delete when cancel is clicked in confirm prompt', async () => {
    const onDelete = vi.fn();
    renderManageViewsDialog({ onDelete });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('manage-view-user-1-delete'));
    await user.click(screen.getByTestId('confirm-prompt-no'));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-prompt')).toBeNull();
  });

  // ── Reset State on Close ──────────────────────────────────────────

  it('resets rename state when dialog closes', async () => {
    const { rerender } = render(
      <ManageViewsDialog
        open={true}
        onOpenChange={vi.fn()}
        views={ALL_VIEWS}
        activeViewId="system-default"
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onSwitchView={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    // Initiate rename
    await user.click(screen.getByTestId('manage-view-user-1-rename'));
    expect(screen.getByTestId('inline-rename')).toBeTruthy();

    // Close and reopen
    rerender(
      <ManageViewsDialog
        open={false}
        onOpenChange={vi.fn()}
        views={ALL_VIEWS}
        activeViewId="system-default"
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onSwitchView={vi.fn()}
      />,
    );
    rerender(
      <ManageViewsDialog
        open={true}
        onOpenChange={vi.fn()}
        views={ALL_VIEWS}
        activeViewId="system-default"
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onSwitchView={vi.fn()}
      />,
    );

    // Rename state should be cleared
    expect(screen.queryByTestId('inline-rename')).toBeNull();
  });

  it('resets delete confirmation state when dialog closes', async () => {
    const { rerender } = render(
      <ManageViewsDialog
        open={true}
        onOpenChange={vi.fn()}
        views={ALL_VIEWS}
        activeViewId="system-default"
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onSwitchView={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    // Initiate delete
    await user.click(screen.getByTestId('manage-view-user-1-delete'));
    expect(screen.getByTestId('confirm-prompt')).toBeTruthy();

    // Close and reopen
    rerender(
      <ManageViewsDialog
        open={false}
        onOpenChange={vi.fn()}
        views={ALL_VIEWS}
        activeViewId="system-default"
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onSwitchView={vi.fn()}
      />,
    );
    rerender(
      <ManageViewsDialog
        open={true}
        onOpenChange={vi.fn()}
        views={ALL_VIEWS}
        activeViewId="system-default"
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onSwitchView={vi.fn()}
      />,
    );

    // Delete confirmation state should be cleared
    expect(screen.queryByTestId('confirm-prompt')).toBeNull();
  });

  // ── Edge Cases ────────────────────────────────────────────────────

  it('hides system views section when there are no system views', () => {
    renderManageViewsDialog({ views: USER_VIEWS });
    expect(screen.queryByTestId('system-views-section')).toBeNull();
  });

  it('renders with only system views (no user views)', () => {
    renderManageViewsDialog({ views: SYSTEM_VIEWS });
    expect(screen.getByTestId('user-views-section')).toBeTruthy();
    expect(screen.getByTestId('no-user-views')).toBeTruthy();
  });

  it('renders with a single user view', () => {
    const singleUserView = USER_VIEWS.slice(0, 1);
    renderManageViewsDialog({
      views: [...SYSTEM_VIEWS, ...singleUserView],
      activeViewId: singleUserView[0].id,
    });
    expect(screen.getByText('My Custom View')).toBeTruthy();
    expect(
      screen.getByTestId('manage-view-user-1-active-badge'),
    ).toBeTruthy();
  });

  it('all views use data-testid attributes', () => {
    renderManageViewsDialog();
    for (const view of ALL_VIEWS) {
      expect(
        screen.getByTestId(`manage-view-${view.id}`),
      ).toBeTruthy();
    }
  });

  it('all action buttons use data-testid', () => {
    renderManageViewsDialog();
    for (const view of USER_VIEWS) {
      expect(
        screen.getByTestId(`manage-view-${view.id}-rename`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`manage-view-${view.id}-duplicate`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`manage-view-${view.id}-delete`),
      ).toBeTruthy();
    }
  });

  it('dialog has a scrollable body for many views', () => {
    const manyViews = Array.from({ length: 20 }, (_, i) => ({
      id: `user-${i + 10}`,
      name: `User View ${i + 1}`,
      layout: [],
      hiddenWidgetIds: [],
      createdAt: NOW,
      updatedAt: NOW,
      isSystem: false,
      isDefault: i === 0,
    }));
    renderManageViewsDialog({
      views: [...SYSTEM_VIEWS, ...manyViews],
    });
    const body = screen.getByTestId('manage-views-body');
    expect(body.className).toContain('overflow-y-auto');
  });
});
