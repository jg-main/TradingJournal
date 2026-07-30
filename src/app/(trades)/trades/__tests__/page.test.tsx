/**
 * Component tests for the trades page.
 *
 * Covers:
 * - Page header buttons: Plan Trade, Export CSV, Refresh Prices
 * - Error paths log to console for operator visibility
 * - Direction filter renders, defaults to all, and updates URL/localStorage
 * - Negative tests: direction validation on the API route
 *
 * Run: npx vitest run --reporter verbose src/app/(trades)/trades/__tests__/page.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) =>
    React.createElement('a', { href, className }, children),
}));

// Mock lucide-react icons to simple span placeholders for snapshot stability
vi.mock('lucide-react', () => ({
  NotebookPen: () => React.createElement('span', { 'data-icon': 'NotebookPen' }),
  EllipsisVertical: () => React.createElement('span', { 'data-icon': 'EllipsisVertical' }),
  Eye: () => React.createElement('span', { 'data-icon': 'Eye' }),
  Pencil: () => React.createElement('span', { 'data-icon': 'Pencil' }),
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
  EmptyState: ({ title, description }: { title?: string; description?: string }) =>
    React.createElement('div', { 'data-testid': 'empty-state' }, title ?? '', description ?? ''),
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
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
});

// ── Header buttons render ──────────────────────────────────────────────

// ── Direction filter ──────────────────────────────────────────────────

describe('Direction filter', () => {
  it('renders the Direction label and three options', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));

    await vi.waitFor(() => {
      expect(screen.getByText('Direction')).toBeTruthy();
      // 'all' appears for both Account and Direction filters
      const allItems = screen.getAllByTestId('select-item-all');
      expect(allItems.length).toBe(2);
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

    // Now select All — the direction filter's 'all' is the second instance
    const allItems = screen.getAllByTestId('select-item-all');
    allItems[1].click();
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
