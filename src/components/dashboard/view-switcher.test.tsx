/**
 * Tests for the ViewSwitcher dropdown component.
 *
 * Covers: trigger rendering, dropdown content with views grouped by
 * system/user, active view checkmark, view selection callback, create
 * new view prompt/flow, manage views callback, write failure indicator,
 * empty views edge case, and user-views-only scenarios.
 *
 * Run: npx vitest run src/components/dashboard/view-switcher.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ViewSwitcher } from './view-switcher';
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

const ALL_VIEWS = [...SYSTEM_VIEWS, ...USER_VIEWS];

// ═══════════════════════════════════════════════════════════════════════════
// Setup / Teardown
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.spyOn(window, 'prompt').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderViewSwitcher({
  views = ALL_VIEWS,
  activeViewId = 'system-default',
  onSelectView = vi.fn(),
  onCreateView = vi.fn(),
  onManageViews = vi.fn(),
  writeFailed = false,
}: Partial<Parameters<typeof ViewSwitcher>[0]> = {}) {
  return render(
    <ViewSwitcher
      views={views}
      activeViewId={activeViewId}
      onSelectView={onSelectView}
      onCreateView={onCreateView}
      onManageViews={onManageViews}
      writeFailed={writeFailed}
    />,
  );
}

/** Open the dropdown by clicking the trigger. */
async function openDropdown() {
  const user = userEvent.setup();
  const trigger = screen.getByTestId('view-switcher-trigger');
  await user.click(trigger);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('ViewSwitcher', () => {
  // ── Trigger ──────────────────────────────────────────────────────

  it('renders the trigger with the active view name', () => {
    renderViewSwitcher({ activeViewId: 'system-default' });
    const trigger = screen.getByTestId('view-switcher-trigger');
    expect(trigger).toBeTruthy();
    expect(screen.getByTestId('view-switcher-current-name').textContent).toBe(
      'Default',
    );
  });

  it('shows a different active view name', () => {
    renderViewSwitcher({ activeViewId: 'system-trading-risk' });
    expect(screen.getByTestId('view-switcher-current-name').textContent).toBe(
      'Trading Risk',
    );
  });

  it('shows user view name when active', () => {
    renderViewSwitcher({ activeViewId: 'user-1' });
    expect(screen.getByTestId('view-switcher-current-name').textContent).toBe(
      'My Custom View',
    );
  });

  it('falls back to "View" when active view is not found', () => {
    renderViewSwitcher({ activeViewId: 'nonexistent' });
    expect(screen.getByTestId('view-switcher-current-name').textContent).toBe(
      'View',
    );
  });

  it('trigger button has a chevron-down icon', () => {
    renderViewSwitcher();
    const trigger = screen.getByTestId('view-switcher-trigger');
    // ChevronDown renders as an SVG element inside the button
    expect(trigger.querySelector('svg')).toBeTruthy();
  });

  // ── Dropdown Content: System Views ───────────────────────────────

  it('opens dropdown with "System Views" label and all system views', async () => {
    renderViewSwitcher();
    await openDropdown();

    expect(screen.getByText('System Views')).toBeTruthy();
    expect(screen.getByTestId('view-item-system-default')).toBeTruthy();
    expect(screen.getByTestId('view-item-system-trading-risk')).toBeTruthy();
    expect(screen.getByTestId('view-item-system-performance')).toBeTruthy();
    expect(screen.getByTestId('view-item-system-process-review')).toBeTruthy();
  });

  it('shows checkmark on the active view in the dropdown', async () => {
    renderViewSwitcher({ activeViewId: 'system-trading-risk' });
    await openDropdown();

    const activeItem = screen.getByTestId('view-item-system-trading-risk');
    expect(activeItem.querySelector('svg')).toBeTruthy();
  });

  it('no checkmark on non-active system views', async () => {
    renderViewSwitcher({ activeViewId: 'system-default' });
    await openDropdown();

    const inactiveItem = screen.getByTestId('view-item-system-trading-risk');
    expect(inactiveItem.querySelector('svg')).toBeNull();
  });

  // ── Dropdown Content: User Views ─────────────────────────────────

  it('shows "User Views" label and user views when present', async () => {
    renderViewSwitcher();
    await openDropdown();

    expect(screen.getByText('User Views')).toBeTruthy();
    expect(screen.getByText('My Custom View')).toBeTruthy();
    expect(screen.getByText('Weekly Focus')).toBeTruthy();
  });

  it('shows checkmark on the active user view', async () => {
    renderViewSwitcher({ activeViewId: 'user-1' });
    await openDropdown();

    const activeItem = screen.getByTestId('view-item-user-1');
    expect(activeItem.querySelector('svg')).toBeTruthy();
  });

  it('hides "User Views" section when there are no user views', async () => {
    renderViewSwitcher({ views: SYSTEM_VIEWS });
    await openDropdown();

    expect(screen.queryByText('User Views')).toBeNull();
  });

  // ── Action Items ─────────────────────────────────────────────────

  it('shows "Create New View" and "Manage Views…" action items', async () => {
    renderViewSwitcher();
    await openDropdown();

    expect(screen.getByText('Create New View')).toBeTruthy();
    expect(screen.getByText('Manage Views…')).toBeTruthy();
  });

  // ── Callbacks ────────────────────────────────────────────────────

  it('calls onSelectView with view ID when a system view is clicked', async () => {
    const onSelectView = vi.fn();
    renderViewSwitcher({ onSelectView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByText('Trading Risk'));

    expect(onSelectView).toHaveBeenCalledTimes(1);
    expect(onSelectView).toHaveBeenCalledWith('system-trading-risk');
  });

  it('calls onSelectView with view ID when a user view is clicked', async () => {
    const onSelectView = vi.fn();
    renderViewSwitcher({ onSelectView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByText('My Custom View'));

    expect(onSelectView).toHaveBeenCalledWith('user-1');
  });

  it('calls onCreateView with name when user accepts the prompt', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('My New View');
    const onCreateView = vi.fn();
    renderViewSwitcher({ onCreateView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('view-create-new'));

    expect(onCreateView).toHaveBeenCalledTimes(1);
    expect(onCreateView).toHaveBeenCalledWith('My New View');
  });

  it('does not call onCreateView when user dismisses the prompt', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const onCreateView = vi.fn();
    renderViewSwitcher({ onCreateView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('view-create-new'));

    expect(onCreateView).not.toHaveBeenCalled();
  });

  it('does not call onCreateView for empty/whitespace prompt input', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    const onCreateView = vi.fn();
    renderViewSwitcher({ onCreateView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('view-create-new'));

    expect(onCreateView).not.toHaveBeenCalled();
  });

  it('calls onManageViews when "Manage Views…" is clicked', async () => {
    const onManageViews = vi.fn();
    renderViewSwitcher({ onManageViews });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByText('Manage Views…'));

    expect(onManageViews).toHaveBeenCalledTimes(1);
  });

  // ── Write Failure ─────────────────────────────────────────────────

  it('shows write failure warning when writeFailed is true', async () => {
    renderViewSwitcher({ writeFailed: true });
    await openDropdown();

    expect(screen.getByTestId('view-write-failed')).toBeTruthy();
    expect(screen.getByText('Changes may not be saved')).toBeTruthy();
  });

  it('does not show write failure warning when writeFailed is false/omitted', async () => {
    renderViewSwitcher({ writeFailed: false });
    await openDropdown();

    expect(screen.queryByTestId('view-write-failed')).toBeNull();
  });

  it('does not show write failure warning by default', async () => {
    renderViewSwitcher();
    await openDropdown();

    expect(screen.queryByTestId('view-write-failed')).toBeNull();
  });

  // ── Edge Cases ───────────────────────────────────────────────────

  it('renders with empty views array gracefully', () => {
    // Should not crash; trigger shows fallback name
    const { container } = renderViewSwitcher({ views: [], activeViewId: '' });
    expect(screen.getByTestId('view-switcher-current-name').textContent).toBe(
      'View',
    );
    expect(container.querySelector('[data-testid="view-switcher-content"]')).toBeNull();
  });

  it('renders with only system views and no user views', async () => {
    renderViewSwitcher({ views: SYSTEM_VIEWS });
    await openDropdown();

    expect(screen.getByText('System Views')).toBeTruthy();
    expect(screen.queryByText('User Views')).toBeNull();
    expect(screen.queryByText('My Custom View')).toBeNull();
    // Action items should still be present
    expect(screen.getByText('Create New View')).toBeTruthy();
    expect(screen.getByText('Manage Views…')).toBeTruthy();
  });

  it('renders with only user views and no system views', async () => {
    renderViewSwitcher({ views: USER_VIEWS });
    await openDropdown();

    // System Views label shows since there are system views (0) -- it always renders
    expect(screen.getByText('System Views')).toBeTruthy();
    // User views label should show
    expect(screen.getByText('User Views')).toBeTruthy();
    expect(screen.getByText('My Custom View')).toBeTruthy();
  });

  it('all view items use data-testid for reliable selection', async () => {
    renderViewSwitcher();
    await openDropdown();

    expect(screen.getByTestId('view-item-system-default')).toBeTruthy();
    expect(screen.getByTestId('view-item-system-trading-risk')).toBeTruthy();
    expect(screen.getByTestId('view-item-system-performance')).toBeTruthy();
    expect(screen.getByTestId('view-item-system-process-review')).toBeTruthy();
    expect(screen.getByTestId('view-item-user-1')).toBeTruthy();
    expect(screen.getByTestId('view-item-user-2')).toBeTruthy();
  });

  it('action items use data-testid', async () => {
    renderViewSwitcher();
    await openDropdown();

    expect(screen.getByTestId('view-create-new')).toBeTruthy();
    expect(screen.getByTestId('view-manage-views')).toBeTruthy();
  });
});
