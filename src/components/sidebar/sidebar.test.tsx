/**
 * Tests for Sidebar route visibility of the global period selector (M004/T9B).
 *
 * The Period selector renders ONLY on the exact /trades pathname. Performance
 * and Workstation do not consume the global period until Tasks 9C/9D, so a
 * visible global selector must never imply a surface consumes a context it
 * ignores.
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

describe('Sidebar period selector route visibility (M004/T9B)', () => {
  it('renders the period selector on the exact /trades pathname', () => {
    mockPathname = '/trades';
    render(<Sidebar />);
    expect(screen.getByTestId('sidebar-period')).toBeTruthy();
  });

  it.each([
    ['/', 'root workstation'],
    ['/performance', 'performance'],
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
