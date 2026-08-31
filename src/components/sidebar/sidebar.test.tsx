/**
 * Tests for Sidebar route visibility of the global period selector (M004/T9B).
 *
 * The Period selector renders on the exact primary operational routes that
 * consume it: / (workstation), /trades, and /performance (M004 9D.2 §11).
 *
 * Run: npx vitest run src/components/sidebar/sidebar.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

let mockPathname = '/trades';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('@/lib/account-context', () => ({
  useAccount: () => ({
    accounts: [],
    loading: true,
    error: null,
    accountId: null,
    setAccountId: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/operational-date-range-context', () => ({
  useOperationalDateRange: () => ({
    selection: { preset: 'YTD', from: '', to: '' },
    resolvedRange: { from: '2026-01-01', to: '' },
    hydrated: true,
    setPreset: vi.fn(),
    setCustomRange: vi.fn(),
  }),
}));

// Lightweight stubs for the other sidebar children.
vi.mock('./sidebar-brand', () => ({ SidebarBrand: () => <div /> }));
vi.mock('./sidebar-value', () => ({ SidebarValue: () => <div /> }));
vi.mock('../theme-toggle', () => ({ ThemeToggle: () => <div /> }));
vi.mock('./nav-item', () => ({ SidebarNavItem: () => <div /> }));
vi.mock('@/components/ui/separator', () => ({ Separator: () => <div /> }));

import { Sidebar } from './sidebar';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Sidebar period selector route visibility (M004/T9B/T9C/T9D.2)', () => {
  it.each(['/', '/trades', '/performance'])('renders the period selector on %s', (path) => {
    mockPathname = path;
    render(<Sidebar />);
    expect(screen.getByTestId('sidebar-period')).toBeTruthy();
  });

  it.each([
    ['/trades/new', 'new trade'],
    ['/trades/abc-123', 'trade detail'],
    ['/settings', 'settings hub'],
    ['/settings/accounts', 'accounts'],
  ])('does NOT render the period selector on %s (%s)', (path) => {
    mockPathname = path;
    render(<Sidebar />);
    expect(screen.queryByTestId('sidebar-period')).toBeNull();
  });
});
