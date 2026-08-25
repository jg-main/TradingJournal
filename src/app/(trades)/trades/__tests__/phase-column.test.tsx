/**
 * Phase column tests (S05/T03).
 *
 * The Open tab distinguishes "Open" (no management activity yet) from
 * "Managed" (add/reduce execution or stop/target adjustment) via a narrow
 * Phase column fed by the derived workflowPhase field from GET /api/trades.
 * The Phase column exists only in openColumns — planned/closed/deleted tabs
 * never render it.
 *
 * DynamicTable is mocked with a cell-rendering harness so the Phase column's
 * badge output is observable (the real table component is covered elsewhere).
 *
 * Run: npx vitest run "src/app/(trades)/trades/__tests__/phase-column.test.tsx"
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import React, { type ComponentType } from 'react';

let TradesPage: ComponentType;

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/trades',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    React.createElement('a', { href, className }, children),
}));

vi.mock('lucide-react', () => ({
  NotebookPen: () => React.createElement('span', { 'data-icon': 'NotebookPen' }),
  EllipsisVertical: () => React.createElement('span', { 'data-icon': 'EllipsisVertical' }),
  Eye: () => React.createElement('span', { 'data-icon': 'Eye' }),
  Pencil: () => React.createElement('span', { 'data-icon': 'Pencil' }),
  Trash2: () => React.createElement('span', { 'data-icon': 'Trash2' }),
  XIcon: () => React.createElement('span', { 'data-icon': 'XIcon' }),
  PlusCircle: () => React.createElement('span', { 'data-icon': 'PlusCircle' }),
  SlidersHorizontal: () => React.createElement('span', { 'data-icon': 'SlidersHorizontal' }),
  RefreshCw: () => React.createElement('span', { 'data-icon': 'RefreshCw' }),
  Download: () => React.createElement('span', { 'data-icon': 'Download' }),
  Star: () => React.createElement('span', { 'data-icon': 'Star' }),
  AlertTriangle: () => React.createElement('span', { 'data-icon': 'AlertTriangle' }),
  Clock: () => React.createElement('span', { 'data-icon': 'Clock' }),
}));

// Cell-rendering harness: renders each column's cell per row so badge output
// (the Phase column) is observable. Cells only read getValue / row.original.
type MockColumn = {
  id: string;
  accessorKey?: string;
  accessorFn?: (row: Record<string, unknown>) => unknown;
  cell?: (ctx: {
    getValue: () => unknown;
    row: { original: Record<string, unknown> };
  }) => React.ReactNode;
};

vi.mock('@/components/dynamic-table', () => ({
  default: ({ columns, data }: { columns: MockColumn[]; data: Array<Record<string, unknown>> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'dynamic-table' },
      data.map((row) =>
        React.createElement(
          'div',
          { key: String(row.id), 'data-testid': `row-${String(row.id)}` },
          columns.map((col) => {
            const ctx = {
              getValue: () =>
                col.accessorFn ? col.accessorFn(row) : row[col.accessorKey ?? col.id],
              row: { original: row },
            };
            const content = col.cell ? col.cell(ctx) : String(ctx.getValue() ?? '');
            return React.createElement(
              'span',
              { key: col.id, 'data-testid': `cell-${col.id}` },
              content,
            );
          }),
        ),
      ),
    ),
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'tabs' }, children),
  TabsList: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'tabs-list' }, children),
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement('button', { 'data-testid': `tab-trigger-${value}` }, children),
  TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement('div', { 'data-testid': `tab-content-${value}` }, children),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => React.createElement('button', {}, children),
  DropdownMenuSeparator: () => React.createElement('hr'),
}));

let selectOnValueChange: ((v: string) => void) | null = null;
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value }: { children: React.ReactNode; value?: string }) =>
    React.createElement('div', { 'data-testid': 'select', 'data-value': value }, children),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  SelectContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement('button', { type: 'button', onClick: () => selectOnValueChange?.(value) }, children),
  SelectValue: () => React.createElement('span', {}, ''),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', { ...props }),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => React.createElement('div', { 'data-testid': 'skeleton' }),
}));

vi.mock('@/components/empty-state', () => ({
  EmptyState: () => React.createElement('div', { 'data-testid': 'empty-state' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Canonical account scope (M007/D037): resolved provider — the page fetches
// trades scoped to acc-001.
vi.mock('@/lib/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'acc-001', name: 'Test Account', broker: null, currency: 'USD', isActive: true }],
    loading: false,
    error: null,
    accountId: 'acc-001',
    setAccountId: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ── Fixtures ───────────────────────────────────────────────────────────

const mockAccounts = [{ id: 'acc-001', name: 'Test Account', currency: 'USD' }];

function makeRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 't1',
    tradeCode: 'TC-001',
    symbol: 'AAPL',
    direction: 'long',
    accountId: 'acc-001',
    accountName: 'Test Account',
    accountCurrency: 'USD',
    status: 'open',
    workflowPhase: 'open',
    openedAt: '2024-06-01T10:00:00.000Z',
    closedAt: null,
    currentPrice: 155,
    metrics: {
      position: { holdingPeriodDays: 1, totalNetPnl: 0, marketValue: 15500, openedAt: '2024-06-01T10:00:00.000Z', closedAt: null },
      size: { sizeDisplay: '100', entryQuantity: 100, openQuantity: 100 },
      averagePrices: { openAvgCost: 150, avgEntryPrice: 150, avgExitPrice: null },
      unrealizedPnl: { grossUnrealizedPnl: 0, netUnrealizedPnl: 0 },
      realizedPnl: { grossRealizedPnl: 0, netRealizedPnl: 0 },
      fees: { realizedFees: 0, totalFees: 0 },
      risk: { initialRisk: 500, initialRiskPct: 0.01, openRisk: 500, activeStop: 145, lockedPnl: null, riskToAccount: null },
      returnMetrics: { returnPct: 0, rMultiple: null },
    },
    ...overrides,
  };
}

/** Serves status-specific rows: open returns managed+plain, others one row each. */
function setupFetchMocks() {
  const managedRow = makeRow({ id: 'open-managed', symbol: 'MSFT', workflowPhase: 'managed' });
  const plainRow = makeRow({ id: 'open-plain', symbol: 'AAPL', workflowPhase: 'open' });
  const plannedRow = makeRow({ id: 'planned-1', symbol: 'NVDA', status: 'planned', workflowPhase: 'planned' });
  const closedRow = makeRow({ id: 'closed-1', symbol: 'TSLA', status: 'closed', workflowPhase: 'closed' });
  const deletedRow = makeRow({ id: 'deleted-1', symbol: 'AMD', status: 'deleted', workflowPhase: 'deleted' });

  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr === '/api/accounts') {
      return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (urlStr.startsWith('/api/trades')) {
      let data: Array<Record<string, unknown>> = [];
      if (urlStr.includes('status=open')) data = [managedRow, plainRow];
      else if (urlStr.includes('status=planned')) data = [plannedRow];
      else if (urlStr.includes('status=closed')) data = [closedRow];
      else if (urlStr.includes('status=deleted')) data = [deletedRow];
      return new Response(JSON.stringify({
        data,
        total: data.length,
        totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('Not found', { status: 404 });
  });
}

beforeAll(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const mod = await import('../page');
  TradesPage = mod.default;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  selectOnValueChange = null;
});

// ── Phase column (S05/T03) ─────────────────────────────────────────────

describe('Open tab Phase column (S05/T03)', () => {
  it('renders a Managed badge for a managed open trade', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      const row = screen.getByTestId('row-open-managed');
      const phaseCell = within(row).getByTestId('cell-phase');
      expect(within(phaseCell).getByText('Managed')).toBeTruthy();
      // The economic Open status is untouched by the phase badge
      expect(within(row).getByTestId('cell-direction')).toBeTruthy();
    });
  });

  it('renders a plain Open badge for an open trade without management activity', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      const row = screen.getByTestId('row-open-plain');
      const phaseCell = within(row).getByTestId('cell-phase');
      expect(within(phaseCell).getByText('Open')).toBeTruthy();
      expect(within(phaseCell).queryByText('Managed')).toBeNull();
    });
  });

  it('falls back to Open when workflowPhase is absent (older API response)', async () => {
    setupFetchMocks();
    // Override the fetch so the open tab returns a row with no workflowPhase
    vi.restoreAllMocks();
    const legacyRow = makeRow({ id: 'open-legacy', symbol: 'IBM' });
    delete legacyRow.workflowPhase;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') {
        return new Response(JSON.stringify(mockAccounts), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlStr.startsWith('/api/trades')) {
        const data = urlStr.includes('status=open') ? [legacyRow] : [];
        return new Response(JSON.stringify({
          data,
          total: data.length,
          totals: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      const row = screen.getByTestId('row-open-legacy');
      const phaseCell = within(row).getByTestId('cell-phase');
      expect(within(phaseCell).getByText('Open')).toBeTruthy();
    });
  });

  it('does not render the Phase column in planned, closed, or deleted tabs', async () => {
    setupFetchMocks();
    render(React.createElement(TradesPage));
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      expect(screen.getByTestId('row-planned-1')).toBeTruthy();
      expect(screen.getByTestId('row-closed-1')).toBeTruthy();
      expect(screen.getByTestId('row-deleted-1')).toBeTruthy();
    });

    for (const id of ['row-planned-1', 'row-closed-1', 'row-deleted-1']) {
      const row = screen.getByTestId(id);
      expect(within(row).queryByTestId('cell-phase')).toBeNull();
    }
    // The Open tab is the only tab with the Phase column
    expect(within(screen.getByTestId('row-open-managed')).getByTestId('cell-phase')).toBeTruthy();
  });
});
