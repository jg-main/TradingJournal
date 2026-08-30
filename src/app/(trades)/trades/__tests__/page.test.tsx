/**
 * Component tests for the trades page.
 *
 * Covers:
 * - Page header buttons: Plan Trade, Export CSV, Refresh Prices
 * - Error paths log to console for operator visibility
 * - Direction filter renders, defaults to all, and updates URL/localStorage
 * - Deleted tab (R027): status=deleted fetch, scratched rows, empty state, count-only footer
 * - Negative tests: direction validation on the API route
 *
 * Run: npx vitest run --reporter verbose src/app/(trades)/trades/__tests__/page.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ComponentType } from 'react';

let TradesPage: ComponentType;

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams();

// Mock next/navigation before importing the page
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/trades',
}));

// Mock next/link to render a plain anchor
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => React.createElement('a', { href, className, ...rest }, children),
}));

// Mock lucide-react icons to simple span placeholders for snapshot stability
vi.mock('lucide-react', () => ({
  NotebookPen: () => React.createElement('span', { 'data-icon': 'NotebookPen' }),
  EllipsisVertical: () => React.createElement('span', { 'data-icon': 'EllipsisVertical' }),
  Eye: () => React.createElement('span', { 'data-icon': 'Eye' }),
  Pencil: () => React.createElement('span', { 'data-icon': 'Pencil' }),
  Trash2: () => React.createElement('span', { 'data-icon': 'Trash2' }),
  XIcon: () => React.createElement('span', { 'data-icon': 'XIcon' }),
  PlusCircle: () => React.createElement('span', { 'data-icon': 'PlusCircle', 'data-testid': 'icon-plus-circle' }),
  SlidersHorizontal: () => React.createElement('span', { 'data-icon': 'SlidersHorizontal' }),
  RefreshCw: () => React.createElement('span', { 'data-icon': 'RefreshCw', 'data-testid': 'icon-refresh-cw' }),
  Download: () => React.createElement('span', { 'data-icon': 'Download', 'data-testid': 'icon-download' }),
  Star: () => React.createElement('span', { 'data-icon': 'Star' }),
  AlertTriangle: () => React.createElement('span', { 'data-icon': 'AlertTriangle' }),
}));

// Mock DynamicTable to avoid rendering the complex table
vi.mock('@/components/dynamic-table', () => ({
  default: ({ columns, data }: { columns: unknown[]; data: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'dynamic-table' },
      `Table: ${data.length} rows, ${columns.length} columns`,
    ),
}));

// Mock shadcn UI components to avoid import resolution issues
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, defaultValue }: { children: React.ReactNode; defaultValue?: string }) =>
    React.createElement('div', { 'data-testid': 'tabs', 'data-default': defaultValue }, children),
  TabsList: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'tabs-list' }, children),
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement('button', { 'data-testid': `tab-trigger-${value}` }, children),
  TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement('div', { 'data-testid': `tab-content-${value}` }, children),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'dropdown-menu' }, children),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'dropdown-trigger' }, children),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'dropdown-content' }, children),
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { 'data-testid': 'dropdown-item', onClick }, children),
  DropdownMenuSeparator: () => React.createElement('hr'),
}));

// Module-level bridge to wire Select onValueChange to SelectItem clicks
let selectOnValueChange: ((v: string) => void) | null = null;

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => {
    selectOnValueChange = onValueChange ?? null;
    return React.createElement('div', { 'data-testid': 'select', 'data-value': value }, children);
  },
  SelectTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'select-trigger' }, children),
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'select-content' }, children),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement('button', {
      'data-testid': `select-item-${value}`,
      type: 'button' as const,
      onClick: () => selectOnValueChange?.(value),
    }, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement('span', { 'data-testid': 'select-value' }, placeholder ?? ''),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement('input', { ...props, 'data-testid': 'input' }),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) =>
    React.createElement('div', { 'data-testid': 'skeleton', className }),
}));

vi.mock('@/components/empty-state', () => ({
  EmptyState: ({ title, description, action }: { title?: string; description?: string; action?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'empty-state' }, title ?? '', description ?? '', action ?? null),
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Canonical account scope (M007/D037): the sidebar AccountProvider is the
// single owner. The page consumes useAccount() — a resolved provider
// (account acc-001, not loading, no error) is mocked here. State is mutable
// so the no-account gate (accountId null) is testable.
const mockSetAccountId = vi.fn();
const mockAccountState = vi.hoisted(() => ({
  accountId: 'acc-001' as string | null,
  loading: false,
  error: null as string | null,
}));
vi.mock('@/lib/account-context', () => ({
  useAccount: () => ({
    accounts: [],
    loading: mockAccountState.loading,
    error: mockAccountState.error,
    accountId: mockAccountState.accountId,
    setAccountId: mockSetAccountId,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ---- Mocks for the API responses ----
const mockAccounts = [
  { id: 'acc-001', name: 'Test Account', currency: 'USD' },
];

let fetchMock: ReturnType<typeof vi.spyOn> | null = null;

function setupFetchMocks(fetchImpl?: typeof globalThis.fetch) {
  if (fetchMock) {
    fetchMock.mockRestore();
    fetchMock = null;
  }
  if (fetchImpl) {
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl);
    return;
  }

  // Default mocks: accounts endpoint returns list, trades endpoint returns empty
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (urlStr === '/api/accounts') {
      return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (urlStr.startsWith('/api/trades/export')) {
      return new Response('symbol,entry,exit\nAAPL,150,155\n', {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      });
    }

    if (urlStr.startsWith('/api/trades/mtm/refresh')) {
      return new Response(JSON.stringify({ refreshed: 5 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (urlStr.startsWith('/api/trades')) {
      return new Response(JSON.stringify({ data: [], total: 0, totals: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  });
}

beforeAll(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Dynamic import after all mocks are set up
  const mod = await import('../page');
  TradesPage = mod.default;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  selectOnValueChange = null;
  mockAccountState.accountId = 'acc-001';
  mockAccountState.loading = false;
  mockAccountState.error = null;
  localStorage.clear();
});

// ── Header buttons render ──────────────────────────────────────────────

// ── Direction filter ──────────────────────────────────────────────────

describe('Direction filter', () => {
  it('renders the Direction label and three options', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => {
      expect(screen.getByText('Direction')).toBeTruthy();
      // M007/D037: account scope is the sidebar's; 'all' now appears only
      // for the Direction filter (no page-local Account selector).
      const allItems = screen.getAllByTestId('select-item-all');
      expect(allItems.length).toBe(1);
      // 'long' and 'short' are unique to Direction filter
      expect(screen.getByTestId('select-item-long')).toBeTruthy();
      expect(screen.getByTestId('select-item-short')).toBeTruthy();
    });
  });

  it('defaults to "all" (no direction param in fetch URL)', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    // Advance timers past the 300ms debounce to trigger the initial fetch
    vi.advanceTimersByTime(500);

    await vi.waitFor(() => {
      // Verify fetch URLs for trades don't contain direction param (default 'all' omits it)
      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls.filter((c) => {
        const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url;
        return url.includes('/api/trades') && !url.includes('/export') && !url.includes('/refresh') && !url.includes('/accounts');
      });
      expect(fetchCalls.length).toBeGreaterThan(0);
      for (const call of fetchCalls) {
        const url = typeof call[0] === 'string' ? call[0] : (call[0] as Request).url;
        expect(url).not.toContain('direction');
      }
    });
  });

  it('includes direction=long in fetch URL when Long is selected', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    // Wait for initial fetch to complete
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/trades'),
      );
    });

    // Clear fetch calls from initial render
    vi.clearAllMocks();

    // Click the Long option
    const longBtn = screen.getByTestId('select-item-long');
    longBtn.click();

    // Advance timers past the 300ms debounce
    vi.advanceTimersByTime(500);

    // Verify the fetch URL includes direction=long
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('direction=long'),
      );
    });
  });

  it('includes direction=short in fetch URL when Short is selected', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/trades'),
      );
    });

    vi.clearAllMocks();

    const shortBtn = screen.getByTestId('select-item-short');
    shortBtn.click();

    vi.advanceTimersByTime(500);

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('direction=short'),
      );
    });
  });

  it('omits direction param from fetch URL when All ("all") is selected', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/trades'),
      );
    });

    vi.clearAllMocks();

    // Switch to Long first, then back to All
    screen.getByTestId('select-item-long').click();
    vi.advanceTimersByTime(500);
    vi.clearAllMocks();

    // Now select All — the only 'all' item is the Direction filter's
    // (M007/D037: the page-local Account selector was removed).
    const allItems = screen.getAllByTestId('select-item-all');
    allItems[0].click();
    vi.advanceTimersByTime(500);

    // After selecting 'all', fetch URLs should not contain direction param
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url;
      return url.includes('/api/trades') && !url.includes('/export') && !url.includes('/refresh');
    });

    // None of the fetch calls should include direction
    for (const call of fetchCalls) {
      const url = typeof call[0] === 'string' ? call[0] : (call[0] as Request).url;
      expect(url).not.toContain('direction');
    }
  });
});

describe('Canonical account scope (Fix 3)', () => {
  it('scopes every tab fetch to the AccountProvider accountId', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => {
      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls.filter((c) => {
        const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url;
        return url.includes('/api/trades') && !url.includes('/export') && !url.includes('/refresh');
      });
      expect(fetchCalls.length).toBeGreaterThan(0);
      for (const call of fetchCalls) {
        const url = typeof call[0] === 'string' ? call[0] : (call[0] as Request).url;
        expect(url).toContain('accountId=acc-001');
      }
    });
  });

  it('exports CSV scoped to the AccountProvider accountId', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/trades'),
      );
    });

    screen.getByTestId('icon-download').click();
    await vi.waitFor(() => {
      const exportCalls = vi.mocked(globalThis.fetch).mock.calls.filter((c) => {
        const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url;
        return url.includes('/api/trades/export');
      });
      expect(exportCalls.length).toBe(1);
      expect(typeof exportCalls[0][0] === 'string' ? exportCalls[0][0] : (exportCalls[0][0] as Request).url)
        .toContain('accountId=acc-001');
    });
  });

  it('shows a filter-aware empty state with Clear filters (no account change)', async () => {
    setupFetchMocks(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({ data: [], total: 0, totals: null, plannedTotals: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    render(React.createElement(TradesPage));

    // Apply a direction filter so the empty tab becomes filter-aware.
    await vi.waitFor(() => {
      expect(screen.getByTestId('select-item-long')).toBeTruthy();
    });
    screen.getByTestId('select-item-long').click();
    vi.advanceTimersByTime(500);

    await vi.waitFor(() => {
      // Every tab shows the filter-aware empty state (all tabs empty).
      expect(screen.getAllByText(/match the current filters/i).length).toBeGreaterThan(0);
    });
    const clearBtn = screen.getAllByRole('button', { name: /Clear filters/i })[0];
    clearBtn.click();
    vi.advanceTimersByTime(500);

    // Clear filters clears page-local dates/direction; the global account is
    // untouched (setAccountId never called).
    await vi.waitFor(() => {
      expect(screen.queryAllByText(/match the current filters/i).length).toBe(0);
    });
    expect(mockSetAccountId).not.toHaveBeenCalled();
  });
});

describe('Page header buttons', () => {
  it('renders Plan Trade, Export CSV, and Refresh Prices buttons', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await waitFor(() => {
      expect(screen.getByText('Plan Trade')).toBeTruthy();
      expect(screen.getByText('Export CSV')).toBeTruthy();
      expect(screen.getByText('Refresh Prices')).toBeTruthy();
    });
  });

  it('renders header actions as canonical Button primitives (default/primary + secondary)', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await waitFor(() => {
      expect(screen.getByText('Plan Trade')).toBeTruthy();
    });

    const plan = screen.getByRole('button', { name: /Plan Trade/i });
    expect(plan.getAttribute('data-slot')).toBe('button');
    expect(plan.getAttribute('data-variant')).toBe('default');

    const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
    expect(exportBtn.getAttribute('data-slot')).toBe('button');
    expect(exportBtn.getAttribute('data-variant')).toBe('secondary');

    const refresh = screen.getByRole('button', { name: /Refresh Prices/i });
    expect(refresh.getAttribute('data-slot')).toBe('button');
    expect(refresh.getAttribute('data-variant')).toBe('secondary');
  });

  it('navigates to /trades/new when Plan Trade is clicked', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    const planBtn = await screen.findByText('Plan Trade');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(planBtn);

    expect(mockPush).toHaveBeenCalledWith('/trades/new');
  });

  it('calls fetch with the export URL when Export CSV is clicked', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    const exportBtn = await screen.findByText('Export CSV');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(exportBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/trades/export'),
      );
    });
  });

  it('POSTs to /api/trades/mtm/refresh when Refresh Prices is clicked', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    const refreshBtn = await screen.findByText('Refresh Prices');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(refreshBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/trades/mtm/refresh',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});

// ── Negative tests: error paths ────────────────────────────────────────

describe('Export CSV error paths', () => {
  it('logs to console when export API returns non-ok status', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades/export')) {
        return new Response('Server Error', { status: 500, statusText: 'Internal Server Error' });
      }
      return new Response(JSON.stringify({ data: [], total: 0, totals: {} }), { status: 200 });
    });

    render(React.createElement(TradesPage));
    const exportBtn = await screen.findByText('Export CSV');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(exportBtn);

    // Wait for the async handler to complete
    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Export CSV failed:', 500, 'Internal Server Error');
    });

    consoleSpy.mockRestore();
  });

  it('logs to console when export fetch throws (network error)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      // The accounts fetch happens during initial render, so we must let it succeed
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades/export')) {
        throw new TypeError('Failed to fetch');
      }
      return new Response(JSON.stringify({ data: [], total: 0, totals: {} }), { status: 200 });
    });

    render(React.createElement(TradesPage));
    const exportBtn = await screen.findByText('Export CSV');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(exportBtn);

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Export CSV failed:', expect.any(TypeError));
    });

    consoleSpy.mockRestore();
  });
});

describe('Refresh Prices error paths', () => {
  it('logs to console when refresh API returns non-ok status', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades/mtm/refresh')) {
        return new Response(JSON.stringify({ error: 'Market data unavailable' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [], total: 0, totals: {} }), { status: 200 });
    });

    render(React.createElement(TradesPage));
    const refreshBtn = await screen.findByText('Refresh Prices');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(refreshBtn);

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Refresh prices failed:',
        503,
        'Market data unavailable',
      );
    });

    consoleSpy.mockRestore();
  });

  it('logs to console when refresh fetch throws (network error)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades/mtm/refresh')) {
        throw new TypeError('Network error');
      }
      return new Response(JSON.stringify({ data: [], total: 0, totals: {} }), { status: 200 });
    });

    render(React.createElement(TradesPage));
    const refreshBtn = await screen.findByText('Refresh Prices');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(refreshBtn);

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Refresh prices failed:', expect.any(TypeError));
    });

    consoleSpy.mockRestore();
  });

  it('resets refreshing state after failed refresh', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades/mtm/refresh')) {
        throw new TypeError('Network error');
      }
      return new Response(JSON.stringify({ data: [], total: 0, totals: {} }), { status: 200 });
    });

    render(React.createElement(TradesPage));
    const refreshBtn = await screen.findByText('Refresh Prices');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(refreshBtn);

    // After the async handler completes, the button should show "Refresh Prices" again
    // (not "Refreshing..."), meaning refreshing state was reset
    await vi.waitFor(() => {
      expect(screen.getByText('Refresh Prices')).toBeTruthy();
    });

    consoleSpy.mockRestore();
  });
});

// ── Footer totals tests ────────────────────────────────────────────
// These tests need rows.length > 0 so the TotalsFooter renders (not just EmptyState).
// The Tabs mock renders all three TabsContent nodes at once, so assertions are
// scoped with within() to the specific tab's content region.

function makeMinimalTradeRow(overrides?: Partial<{
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  status: 'open' | 'closed' | 'planned' | 'deleted';
}>): Record<string, unknown> {
  return {
    id: overrides?.id ?? 't1',
    tradeCode: 'TC-001',
    symbol: overrides?.symbol ?? 'AAPL',
    direction: overrides?.direction ?? 'long',
    accountId: 'acc-001',
    accountName: 'Test Account',
    accountCurrency: 'USD',
    status: overrides?.status ?? 'open',
    openedAt: '2024-06-01T10:00:00.000Z',
    closedAt: null,
    currentPrice: 155.00,
    metrics: {
      position: { holdingPeriodDays: 30, totalNetPnl: 500, marketValue: 15000, openedAt: '2024-06-01T10:00:00.000Z', closedAt: null },
      size: { sizeDisplay: '100', entryQuantity: 100, openQuantity: 100 },
      averagePrices: { openAvgCost: 150.00, avgEntryPrice: 150.00, avgExitPrice: null },
      unrealizedPnl: { grossUnrealizedPnl: 500, netUnrealizedPnl: 490 },
      realizedPnl: { grossRealizedPnl: 0, netRealizedPnl: 0 },
      fees: { realizedFees: 10, totalFees: 10 },
      risk: { initialRisk: 1000, initialRiskPct: 0.02, openRisk: 800, activeStop: 148, lockedPnl: null, riskToAccount: null },
      returnMetrics: { returnPct: 0.1, rMultiple: null },
    },
    setupName: 'Breakout',
    returnPct: 0.1,
    riskPct: null,
    realizedPnl: 0,
    unrealizedPnl: 500,
    ...overrides,
  };
}

describe('Footer totals', () => {
  it('renders a single Open Positions Total section (Unrealized P&L, Portfolio Heat $/%, Open Positions) in the open tab footer, without By Currency', async () => {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({
          data: [makeMinimalTradeRow()],
          total: 2,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 500, netUnrealizedPnl: 490, totalOpenRisk: 800, portfolioHeatAmount: 800, portfolioHeatPct: 0.0125 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const openTab = screen.getByTestId('tab-content-open');
    await vi.waitFor(() => {
      // Single authoritative Open Positions Total section with Unrealized P&L,
      // Portfolio Heat $/% and the open position count.
      expect(within(openTab).getByText('Open Positions Total')).toBeTruthy();
      expect(within(openTab).getByText('Unrealized P&L')).toBeTruthy();
      expect(within(openTab).getByText('$490.00')).toBeTruthy();
      expect(within(openTab).getByText('Portfolio Heat $')).toBeTruthy();
      expect(within(openTab).getByText('$800.00')).toBeTruthy();
      expect(within(openTab).getByText('Portfolio Heat %')).toBeTruthy();
      expect(within(openTab).getByText('1.25%')).toBeTruthy();
      expect(within(openTab).getByText('Open Positions')).toBeTruthy();
      expect(within(openTab).getByText('2')).toBeTruthy();
      // No duplicate display: no By Currency / per-currency labels / standalone Portfolio Heat header
      expect(within(openTab).queryByText('By Currency')).toBeNull();
      expect(within(openTab).queryByText('USD')).toBeNull();
      expect(within(openTab).queryByText('Portfolio Heat')).toBeNull();
    });
  });

  it('renders a partial Unrealized P&L state with the unpriced count when some open positions lack a market mark', async () => {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({
          data: [makeMinimalTradeRow(), makeMinimalTradeRow({ id: 't2', symbol: 'MSFT' })],
          total: 2,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: null, netUnrealizedPnl: null, totalOpenRisk: 800, portfolioHeatAmount: 800, portfolioHeatPct: 0.0125, unpricedOpenPositions: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const openTab = screen.getByTestId('tab-content-open');
    await vi.waitFor(() => {
      // M013/S01 partial state: one of two open positions lacks a market mark.
      // The aggregate is never presented as a complete-looking number.
      expect(within(openTab).getByText('Open Positions Total')).toBeTruthy();
      expect(within(openTab).getByText('Unrealized P&L')).toBeTruthy();
      expect(within(openTab).getByText('Partial — 1 unpriced')).toBeTruthy();
      expect(within(openTab).queryByText('Awaiting market prices')).toBeNull();
      expect(within(openTab).queryByText('$490.00')).toBeNull();
      expect(within(openTab).queryByText('$0.00')).toBeNull();
    });
  });

  it('renders "Awaiting market prices" when every open position lacks a market mark', async () => {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({
          data: [makeMinimalTradeRow(), makeMinimalTradeRow({ id: 't2', symbol: 'MSFT' })],
          total: 2,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: null, netUnrealizedPnl: null, totalOpenRisk: 800, portfolioHeatAmount: 800, portfolioHeatPct: 0.0125, unpricedOpenPositions: 2 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const openTab = screen.getByTestId('tab-content-open');
    await vi.waitFor(() => {
      // M013/S01 all-unpriced state: the aggregate is entirely unknown —
      // explicit awaiting copy instead of a misleading $0.00 or blank.
      expect(within(openTab).getByText('Open Positions Total')).toBeTruthy();
      expect(within(openTab).getByText('Awaiting market prices')).toBeTruthy();
      expect(within(openTab).queryByText(/Partial —/)).toBeNull();
      expect(within(openTab).queryByText('$490.00')).toBeNull();
      expect(within(openTab).queryByText('$0.00')).toBeNull();
    });
  });

  it('keeps the numeric Unrealized P&L aggregate when all open positions are priced (unpricedOpenPositions: 0)', async () => {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({
          data: [makeMinimalTradeRow()],
          total: 1,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 500, netUnrealizedPnl: 490, totalOpenRisk: 800, portfolioHeatAmount: 800, portfolioHeatPct: 0.0125, unpricedOpenPositions: 0 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const openTab = screen.getByTestId('tab-content-open');
    await vi.waitFor(() => {
      // M013/S01 all-priced state: the normal numeric aggregate is preserved
      // when the route reports zero unpriced open positions.
      expect(within(openTab).getByText('Open Positions Total')).toBeTruthy();
      expect(within(openTab).getByText('$490.00')).toBeTruthy();
      expect(within(openTab).queryByText('Awaiting market prices')).toBeNull();
      expect(within(openTab).queryByText(/Partial —/)).toBeNull();
    });
  });

  it('formats Portfolio Heat % from the decimal-fraction portfolioHeatPct (×100)', async () => {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({
          data: [makeMinimalTradeRow()],
          total: 1,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 500, netUnrealizedPnl: 490, totalOpenRisk: 1000, portfolioHeatAmount: 1000, portfolioHeatPct: 0.0342 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const openTab = screen.getByTestId('tab-content-open');
    await vi.waitFor(() => {
      // 0.0342 is a fraction of 1.0 → rendered as 3.42% (never 0.03%)
      expect(within(openTab).getByText('3.42%')).toBeTruthy();
      expect(within(openTab).getByText('$1,000.00')).toBeTruthy();
      expect(within(openTab).queryByText('0.03%')).toBeNull();
    });
  });

  it('falls back to $0.00 / 0.00% when the top-level portfolioHeat fields are absent', async () => {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({
          data: [makeMinimalTradeRow()],
          total: 1,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 500, netUnrealizedPnl: 490, totalOpenRisk: 800 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const openTab = screen.getByTestId('tab-content-open');
    await vi.waitFor(() => {
      // Section still renders with zeroed amounts rather than disappearing
      expect(within(openTab).getByText('Open Positions Total')).toBeTruthy();
      expect(within(openTab).getByText('$0.00')).toBeTruthy();
      expect(within(openTab).getByText('0.00%')).toBeTruthy();
    });
  });

  it('renders a single Closed Trades Total section (Gross P&L, Fees, Net P&L, Trades) on the closed tab footer, without By Currency', async () => {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({
          data: [makeMinimalTradeRow()],
          total: 1,
          totals: { grossRealizedPnl: 600, netRealizedPnl: 590, totalFees: 10, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const closedTab = screen.getByTestId('tab-content-closed');
    await vi.waitFor(() => {
      expect(within(closedTab).getByText('Closed Trades Total')).toBeTruthy();
      // Gross/Net P&L, Fees, and the trade count appear exactly once in the single totals section
      expect(within(closedTab).getAllByText('Gross P&L').length).toBe(1);
      expect(within(closedTab).getAllByText('Net P&L').length).toBe(1);
      expect(within(closedTab).getAllByText('Fees').length).toBe(1);
      expect(within(closedTab).getByText('Trades')).toBeTruthy();
      expect(within(closedTab).getByText('1')).toBeTruthy();
      // No per-currency breakdown: no By Currency header, no currency labels
      expect(within(closedTab).queryByText('By Currency')).toBeNull();
      expect(within(closedTab).queryByText('USD')).toBeNull();
      expect(within(closedTab).queryByText('EUR')).toBeNull();
      // Closed tab never shows Portfolio Heat
      expect(within(closedTab).queryByText('Portfolio Heat')).toBeNull();
    });
  });

  it('keeps the Planned Totals footer unchanged', async () => {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        return new Response(JSON.stringify({
          data: [makeMinimalTradeRow()],
          total: 1,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
          plannedTotals: { totalPlannedRisk: 250, totalPlannedCapital: 5000, count: 3 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const plannedTab = screen.getByTestId('tab-content-planned');
    await vi.waitFor(() => {
      expect(within(plannedTab).getByText('Planned Totals')).toBeTruthy();
      expect(within(plannedTab).getByText('Planned Risk')).toBeTruthy();
      expect(within(plannedTab).getByText('Planned Capital')).toBeTruthy();
      expect(within(plannedTab).getByText('Trades')).toBeTruthy();
      expect(within(plannedTab).getByText('$250.00')).toBeTruthy();
      expect(within(plannedTab).getByText('$5,000.00')).toBeTruthy();
      expect(within(plannedTab).getByText('3')).toBeTruthy();
    });
  });
});

// ── Deleted tab (R027) ─────────────────────────────────────────────────
// The Deleted tab is the explicit opt-in view for soft-deleted (scratched)
// trades: it fetches GET /api/trades?status=deleted and renders a count-only
// audit footer (scratched trades carry no P&L aggregates). The Tabs mock
// renders all TabsContent nodes at once, so assertions are scoped with
// within() to the deleted tab's content region.

describe('Deleted tab (R027)', () => {
  // Serves status-specific rows: status=deleted URLs return the scratched
  // fixtures, all other tabs return empty.
  function setupDeletedTabMocks(scratched: Array<Record<string, unknown>>) {
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        const isDeleted = urlStr.includes('status=deleted');
        return new Response(JSON.stringify({
          data: isDeleted ? scratched : [],
          total: isDeleted ? scratched.length : 0,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });
  }

  it('renders the Deleted tab trigger with a Deleted label', async () => {
    setupDeletedTabMocks([]);
    render(React.createElement(TradesPage));

    await vi.waitFor(() => {
      const trigger = screen.getByTestId('tab-trigger-deleted');
      expect(trigger).toBeTruthy();
      expect(within(trigger).getByText('Deleted')).toBeTruthy();
    });
  });

  it('fetches /api/trades with status=deleted for the Deleted tab', async () => {
    setupDeletedTabMocks([]);
    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=deleted'),
      );
    });
  });

  it('renders scratched trades with a count badge and count-only audit footer', async () => {
    const scratched = [
      makeMinimalTradeRow({ id: 'd1', symbol: 'TSLA', status: 'deleted' }),
      makeMinimalTradeRow({ id: 'd2', symbol: 'NVDA', status: 'deleted' }),
    ];
    setupDeletedTabMocks(scratched);
    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const deletedTab = screen.getByTestId('tab-content-deleted');
    await vi.waitFor(() => {
      // Count badge on the tab trigger reflects the scratched-trade total
      expect(within(screen.getByTestId('tab-trigger-deleted')).getByText('2')).toBeTruthy();
      // Showing line and table rows
      expect(within(deletedTab).getByText(/Showing 2 of 2 deleted trades\./)).toBeTruthy();
      expect(within(deletedTab).getByTestId('dynamic-table')).toBeTruthy();
      // Count-only footer — never P&L aggregates for scratched trades
      expect(within(deletedTab).getByText('Scratched Trades')).toBeTruthy();
      expect(within(deletedTab).getByText('Trades')).toBeTruthy();
      expect(within(deletedTab).queryByText('Gross P&L')).toBeNull();
      expect(within(deletedTab).queryByText('Net P&L')).toBeNull();
      expect(within(deletedTab).queryByText('Planned Totals')).toBeNull();
    });
  });

  it('renders the empty state when there are no scratched trades', async () => {
    setupDeletedTabMocks([]);
    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const deletedTab = screen.getByTestId('tab-content-deleted');
    await vi.waitFor(() => {
      // Regex matcher: the EmptyState mock concatenates title+description into
      // one text node, so substring matching is required.
      expect(within(deletedTab).getByText(/No scratched trades/)).toBeTruthy();
      expect(within(deletedTab).queryByTestId('dynamic-table')).toBeNull();
    });
  });

  it('surfaces the fetch error in the Deleted tab content area', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        if (urlStr.includes('status=deleted')) {
          return new Response(JSON.stringify({ error: 'Scratched fetch failed' }), { status: 500 });
        }
        return new Response(JSON.stringify({ data: [], total: 0, totals: {} }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const deletedTab = screen.getByTestId('tab-content-deleted');
    await vi.waitFor(() => {
      // fetchTab throws on non-ok → ErrorBanner with the API error message
      expect(within(deletedTab).getByText('Scratched fetch failed')).toBeTruthy();
      expect(within(deletedTab).queryByTestId('dynamic-table')).toBeNull();
    });

    consoleSpy.mockRestore();
  });
});

// ── Date preset + timezone tests ───────────────────────────────────────
// T02: 1M/3M/6M presets use trailing-day arithmetic (not first-of-month) and
// from/to bounds carry the browser's local timezone offset instead of UTC "Z".

// Mirror of the page's localOffsetSuffix() — computes the env-timezone offset
// for a given instant so assertions adapt to whatever TZ the test runs in.
function localOffsetFor(instant: string): string {
  const offsetMin = -new Date(instant).getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

describe('Date presets (trailing-day arithmetic + local timezone bounds)', () => {
  // Pinned "today" so preset arithmetic is deterministic: July 31, 2026 noon UTC
  // (noon keeps the local calendar date July 31 in every timezone).
  const PINNED_NOW = '2026-07-31T12:00:00Z';

  beforeEach(() => {
    localStorage.clear();
    vi.setSystemTime(new Date(PINNED_NOW));
  });

  afterEach(() => {
    // Re-pin to the auto-advancing fake clock (≈ real now) so later tests are
    // unaffected by the July 31 system-time pinning above.
    vi.setSystemTime(new Date());
    localStorage.clear();
  });

  // Captures the most recent /api/trades URL and serves a generic empty response.
  function setupTradesUrlCapture() {
    let tradesUrl: string | null = null;
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        tradesUrl = urlStr;
        return new Response(JSON.stringify({ data: [], total: 0, totals: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });
    return () => tradesUrl;
  }

  // Encodes a query param the same way URLSearchParams does in the page fetch.
  const encodedParam = (key: string, value: string) => new URLSearchParams({ [key]: value }).toString();

  it('1M preset on July 31 uses trailing-day arithmetic: from = June 30 (not June 1)', async () => {
    const getTradesUrl = setupTradesUrlCapture();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => expect(getTradesUrl()).not.toBeNull());
    screen.getByText('1M').click();
    vi.advanceTimersByTime(500);

    const offset = localOffsetFor(PINNED_NOW);
    await vi.waitFor(() => {
      const url = getTradesUrl();
      expect(url).not.toBeNull();
      expect(url).toContain(encodedParam('from', `2026-06-30T00:00:00.000${offset}`));
      expect(url).not.toContain('from=2026-06-01');
    });
  });

  it('3M preset on July 31 uses 91 trailing days: from = May 1 (not April 1)', async () => {
    const getTradesUrl = setupTradesUrlCapture();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => expect(getTradesUrl()).not.toBeNull());
    screen.getByText('3M').click();
    vi.advanceTimersByTime(500);

    const offset = localOffsetFor(PINNED_NOW);
    await vi.waitFor(() => {
      const url = getTradesUrl();
      expect(url).not.toBeNull();
      expect(url).toContain(encodedParam('from', `2026-05-01T00:00:00.000${offset}`));
      expect(url).not.toContain('from=2026-04-01');
    });
  });

  it('6M preset on July 31 uses 180 trailing days: from = February 1 (not January 1)', async () => {
    const getTradesUrl = setupTradesUrlCapture();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => expect(getTradesUrl()).not.toBeNull());
    screen.getByText('6M').click();
    vi.advanceTimersByTime(500);

    const offset = localOffsetFor(PINNED_NOW);
    await vi.waitFor(() => {
      const url = getTradesUrl();
      expect(url).not.toBeNull();
      expect(url).toContain(encodedParam('from', `2026-02-01T00:00:00.000${offset}`));
      expect(url).not.toContain('from=2026-01-01');
    });
  });

  it('from/to bounds carry the browser local timezone offset, never hardcoded Z', async () => {
    const getTradesUrl = setupTradesUrlCapture();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => expect(getTradesUrl()).not.toBeNull());

    // Set From and To directly through the date inputs (index 0 = From, 1 = To)
    const inputs = screen.getAllByTestId('input');
    fireEvent.change(inputs[0], { target: { value: '2025-07-01' } });
    fireEvent.change(inputs[1], { target: { value: '2025-07-31' } });
    vi.advanceTimersByTime(500);

    const offset = localOffsetFor(PINNED_NOW);
    await vi.waitFor(() => {
      const url = getTradesUrl();
      expect(url).not.toBeNull();
      // Start of local day for From, end of local day for To, both with the
      // browser's local ±HH:MM offset suffix (never "Z").
      expect(url).toContain(encodedParam('from', `2025-07-01T00:00:00.000${offset}`));
      expect(url).toContain(encodedParam('to', `2025-07-31T23:59:59.999${offset}`));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// M004/T4 — secondary filter + pagination + no-account CTA primitives
// ─────────────────────────────────────────────────────────────────────────

describe('Filter and pagination primitives (M004/T4)', () => {
  it('renders date presets as canonical Button primitives with selected/unselected variants', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => expect(screen.getByText('MTD')).toBeTruthy());

    const mtd = screen.getByRole('button', { name: 'MTD' });
    expect(mtd.getAttribute('data-slot')).toBe('button');
    // No preset selected initially → secondary.
    expect(mtd.getAttribute('data-variant')).toBe('secondary');

    mtd.click();
    vi.advanceTimersByTime(500);

    // The selected preset becomes the primary variant; others stay secondary.
    await vi.waitFor(() => {
      expect(mtd.getAttribute('data-variant')).toBe('default');
    });
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('data-variant')).toBe('secondary');
  });

  it('renders pagination as canonical Button primitives preserving disabled/enabled semantics', async () => {
    localStorage.clear();
    const rows = Array.from({ length: 60 }, (_, i) =>
      makeMinimalTradeRow({ id: `t${i}`, symbol: `S${i}` }),
    );
    setupFetchMocks(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        const u = new URL(urlStr, 'http://localhost');
        const page = Number(u.searchParams.get('page') ?? '1');
        const start = (page - 1) * 50;
        return new Response(JSON.stringify({
          data: rows.slice(start, start + 50),
          total: rows.length,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    const openTab = screen.getByTestId('tab-content-open');
    await vi.waitFor(() => {
      expect(within(openTab).getByRole('button', { name: 'Previous page' })).toBeTruthy();
    });

    const prev = within(openTab).getByRole('button', { name: 'Previous page' });
    const next = within(openTab).getByRole('button', { name: 'Next page' });
    expect(prev.getAttribute('data-slot')).toBe('button');
    expect(next.getAttribute('data-slot')).toBe('button');
    // Page 1: Previous disabled, Next enabled.
    expect(prev.hasAttribute('disabled')).toBe(true);
    expect(next.hasAttribute('disabled')).toBe(false);

    fireEvent.click(next);
    vi.advanceTimersByTime(500);

    // Page 2 of 2: Previous enabled, Next disabled. The pagination controls
    // unmount during the loading skeleton, so re-query after the refetch.
    await vi.waitFor(() => {
      const prevAfter = within(openTab).getByRole('button', { name: 'Previous page' });
      const nextAfter = within(openTab).getByRole('button', { name: 'Next page' });
      expect(prevAfter.hasAttribute('disabled')).toBe(false);
      expect(nextAfter.hasAttribute('disabled')).toBe(true);
    });
  });
});

describe('No-account CTA (M004/T4)', () => {
  it('renders Manage accounts as a canonical Button wrapping the /settings/accounts link', async () => {
    mockAccountState.accountId = null;
    mockAccountState.loading = false;
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => {
      const link = screen.getByRole('link', { name: 'Manage accounts' });
      expect(link.getAttribute('href')).toBe('/settings/accounts');
      // Button asChild merges the button primitive onto the link element.
      expect(link.getAttribute('data-slot')).toBe('button');
      expect(link.getAttribute('data-variant')).toBe('default');
    });
  });
});
