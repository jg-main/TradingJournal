import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import type { WorkstationContextValue } from './workstation-context';
import { WorkstationToolbar } from './workstation-toolbar';

let mockWorkstation: WorkstationContextValue;

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockWorkstation,
}));

vi.mock('./workstation-views-context', () => ({
  useWorkstationViewsContext: () => ({
    views: [{ id: 'view-1', isSystem: false, config: {} }],
    activeViewId: 'view-1',
  }),
}));

vi.mock('./workstation-customize-context', () => ({
  useWorkstationCustomizeContext: () => ({
    isCustomizing: false,
    enterCustomize: vi.fn(),
  }),
}));

vi.mock('./workstation-view-switcher', () => ({
  WorkstationViewSwitcher: () => null,
}));

function renderToolbar(overrides: Partial<WorkstationContextValue> = {}) {
  mockWorkstation = {
    accounts: [{ id: 'account-1', name: 'Primary', currency: 'USD' }],
    activeAccountId: 'account-1',
    setActiveAccountId: vi.fn(),
    accountSelectionExternal: false,
    isLoading: false,
    error: null,
    mtmPollingState: 'active',
    ...overrides,
  } as WorkstationContextValue;

  return render(<WorkstationToolbar />);
}

afterEach(cleanup);

describe('WorkstationToolbar live data status', () => {
  it('shows a live badge when mark-to-market polling is active', () => {
    renderToolbar();

    const badge = screen.getByTestId('ws-live-badge');
    expect(badge.textContent).toBe('LIVE');
    expect(badge.classList.contains('ws-live-badge-active')).toBe(true);
    expect(badge.getAttribute('title')).toContain('Live data is flowing');
  });

  it('shows a red issue badge when a live data refresh fails', () => {
    renderToolbar({ mtmPollingState: 'error' });

    const badge = screen.getByTestId('ws-live-badge');
    expect(badge.textContent).toBe('ISSUE');
    expect(badge.classList.contains('ws-live-badge-error')).toBe(true);
    expect(badge.getAttribute('role')).toBe('alert');
    expect(badge.getAttribute('title')).toContain('marks may be stale');
  });
});
