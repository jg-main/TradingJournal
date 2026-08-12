/**
 * Tests for the WorkstationViewSwitcher dropdown component (M016/S06-T03).
 *
 * Covers: trigger rendering with the active view name, dropdown content
 * grouped by system/user views, active-view checkmark, view selection
 * callback, create-new-view prompt flow (accept / dismiss / whitespace),
 * write-failure warning footer, and empty-views edge case.
 *
 * Run: npx vitest run src/components/workstation/workstation-view-switcher.test.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { WorkstationViewSwitcher } from './workstation-view-switcher';
import { WORKSTATION_SYSTEM_VIEW_IDS, type WorkstationView } from '@/hooks/use-workstation-views';
import {
  WORKSTATION_TEMPLATE_IDS,
  createViewFromTemplate,
} from '@/lib/workstation-view-types';

// ── Fixtures ───────────────────────────────────────────────────────────

const NOW = '2026-01-01T00:00:00.000Z';

const SYSTEM_VIEWS: WorkstationView[] = [
  {
    id: WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS,
    name: 'Risk & Positions',
    config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS),
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isStartup: true,
  },
  {
    id: WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE,
    name: 'Performance',
    config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE),
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isStartup: false,
  },
  {
    id: WORKSTATION_SYSTEM_VIEW_IDS.PROCESS_REVIEW,
    name: 'Process Review',
    config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW),
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: true,
    isStartup: false,
  },
];

const USER_VIEWS: WorkstationView[] = [
  {
    id: 'ws-user-1',
    name: 'My Custom View',
    config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS),
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: false,
    isStartup: false,
  },
  {
    id: 'ws-user-2',
    name: 'Weekly Focus',
    config: createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE),
    createdAt: NOW,
    updatedAt: NOW,
    isSystem: false,
    isStartup: false,
  },
];

const ALL_VIEWS = [...SYSTEM_VIEWS, ...USER_VIEWS];

// ── Setup / Teardown ───────────────────────────────────────────────────

beforeEach(() => {
  vi.spyOn(window, 'prompt').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSwitcher({
  views = ALL_VIEWS,
  activeViewId = WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS,
  onSelectView = vi.fn(),
  onCreateView = vi.fn(),
  writeFailed = false,
}: Partial<Parameters<typeof WorkstationViewSwitcher>[0]> = {}) {
  return render(
    <WorkstationViewSwitcher
      views={views}
      activeViewId={activeViewId}
      onSelectView={onSelectView}
      onCreateView={onCreateView}
      writeFailed={writeFailed}
    />,
  );
}

/** Open the dropdown by clicking the trigger. */
async function openDropdown() {
  const user = userEvent.setup();
  const trigger = screen.getByTestId('ws-view-switcher-trigger');
  await user.click(trigger);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('WorkstationViewSwitcher', () => {
  // ── Trigger ──────────────────────────────────────────────────────

  it('renders the trigger with the active system view name', () => {
    renderSwitcher();
    expect(screen.getByTestId('ws-view-switcher-trigger')).toBeTruthy();
    expect(screen.getByTestId('ws-view-switcher-current-name').textContent).toBe(
      'Risk & Positions',
    );
  });

  it('shows a different active system view name', () => {
    renderSwitcher({ activeViewId: WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE });
    expect(screen.getByTestId('ws-view-switcher-current-name').textContent).toBe(
      'Performance',
    );
  });

  it('shows user view name when active', () => {
    renderSwitcher({ activeViewId: 'ws-user-1' });
    expect(screen.getByTestId('ws-view-switcher-current-name').textContent).toBe(
      'My Custom View',
    );
  });

  it('falls back to "View" when active view is not found', () => {
    renderSwitcher({ activeViewId: 'nonexistent' });
    expect(screen.getByTestId('ws-view-switcher-current-name').textContent).toBe(
      'View',
    );
  });

  it('trigger button has a chevron-down icon', () => {
    renderSwitcher();
    const trigger = screen.getByTestId('ws-view-switcher-trigger');
    expect(trigger.querySelector('svg')).toBeTruthy();
  });

  // ── Dropdown Content: System Views ───────────────────────────────

  it('opens dropdown with "System Views" label and all three presets', async () => {
    renderSwitcher();
    await openDropdown();

    expect(screen.getByText('System Views')).toBeTruthy();
    expect(
      screen.getByTestId(`ws-view-item-${WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS}`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`ws-view-item-${WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE}`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`ws-view-item-${WORKSTATION_SYSTEM_VIEW_IDS.PROCESS_REVIEW}`),
    ).toBeTruthy();
  });

  it('shows a checkmark on the active view in the dropdown', async () => {
    renderSwitcher({ activeViewId: WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE });
    await openDropdown();

    const activeItem = screen.getByTestId(
      `ws-view-item-${WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE}`,
    );
    expect(activeItem.querySelector('svg')).toBeTruthy();
  });

  it('shows no checkmark on non-active system views', async () => {
    renderSwitcher({ activeViewId: WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS });
    await openDropdown();

    const inactiveItem = screen.getByTestId(
      `ws-view-item-${WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE}`,
    );
    expect(inactiveItem.querySelector('svg')).toBeNull();
  });

  // ── Dropdown Content: User Views ─────────────────────────────────

  it('shows "User Views" label and user views when present', async () => {
    renderSwitcher();
    await openDropdown();

    expect(screen.getByText('User Views')).toBeTruthy();
    expect(screen.getByText('My Custom View')).toBeTruthy();
    expect(screen.getByText('Weekly Focus')).toBeTruthy();
  });

  it('shows a checkmark on the active user view', async () => {
    renderSwitcher({ activeViewId: 'ws-user-1' });
    await openDropdown();

    const activeItem = screen.getByTestId('ws-view-item-ws-user-1');
    expect(activeItem.querySelector('svg')).toBeTruthy();
  });

  it('hides the "User Views" section when there are no user views', async () => {
    renderSwitcher({ views: SYSTEM_VIEWS });
    await openDropdown();

    expect(screen.queryByText('User Views')).toBeNull();
  });

  // ── Action Items ─────────────────────────────────────────────────

  it('shows the "Create New View" action item', async () => {
    renderSwitcher();
    await openDropdown();

    expect(screen.getByText('Create New View')).toBeTruthy();
  });

  // ── Callbacks ────────────────────────────────────────────────────

  it('calls onSelectView with the view ID when a system view is clicked', async () => {
    const onSelectView = vi.fn();
    renderSwitcher({ onSelectView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByText('Performance'));

    expect(onSelectView).toHaveBeenCalledTimes(1);
    expect(onSelectView).toHaveBeenCalledWith(WORKSTATION_SYSTEM_VIEW_IDS.PERFORMANCE);
  });

  it('calls onSelectView with the view ID when a user view is clicked', async () => {
    const onSelectView = vi.fn();
    renderSwitcher({ onSelectView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByText('My Custom View'));

    expect(onSelectView).toHaveBeenCalledWith('ws-user-1');
  });

  it('calls onCreateView with the name when the user accepts the prompt', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('My New View');
    const onCreateView = vi.fn();
    renderSwitcher({ onCreateView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('ws-view-create-new'));

    expect(onCreateView).toHaveBeenCalledTimes(1);
    expect(onCreateView).toHaveBeenCalledWith('My New View');
  });

  it('does not call onCreateView when the user dismisses the prompt', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const onCreateView = vi.fn();
    renderSwitcher({ onCreateView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('ws-view-create-new'));

    expect(onCreateView).not.toHaveBeenCalled();
  });

  it('does not call onCreateView for empty/whitespace prompt input', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    const onCreateView = vi.fn();
    renderSwitcher({ onCreateView });
    await openDropdown();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('ws-view-create-new'));

    expect(onCreateView).not.toHaveBeenCalled();
  });

  // ── Write Failure ─────────────────────────────────────────────────

  it('shows a write-failure warning when writeFailed is true', async () => {
    renderSwitcher({ writeFailed: true });
    await openDropdown();

    expect(screen.getByTestId('ws-view-write-failed')).toBeTruthy();
    expect(screen.getByText('Changes may not be saved')).toBeTruthy();
  });

  it('does not show the write-failure warning by default', async () => {
    renderSwitcher();
    await openDropdown();

    expect(screen.queryByTestId('ws-view-write-failed')).toBeNull();
  });

  // ── Edge Cases ───────────────────────────────────────────────────

  it('renders gracefully with an empty views array', () => {
    const { container } = renderSwitcher({ views: [], activeViewId: '' });
    expect(screen.getByTestId('ws-view-switcher-current-name').textContent).toBe(
      'View',
    );
    expect(
      container.querySelector('[data-testid="ws-view-switcher-content"]'),
    ).toBeNull();
  });

  it('renders with only system views and no user views', async () => {
    renderSwitcher({ views: SYSTEM_VIEWS });
    await openDropdown();

    expect(screen.getByText('System Views')).toBeTruthy();
    expect(screen.queryByText('User Views')).toBeNull();
    expect(screen.queryByText('My Custom View')).toBeNull();
    expect(screen.getByText('Create New View')).toBeTruthy();
  });

  it('all view items use data-testid for reliable selection', async () => {
    renderSwitcher();
    await openDropdown();

    expect(
      screen.getByTestId(`ws-view-item-${WORKSTATION_SYSTEM_VIEW_IDS.RISK_POSITIONS}`),
    ).toBeTruthy();
    expect(screen.getByTestId('ws-view-item-ws-user-1')).toBeTruthy();
    expect(screen.getByTestId('ws-view-item-ws-user-2')).toBeTruthy();
    expect(screen.getByTestId('ws-view-create-new')).toBeTruthy();
  });
});
