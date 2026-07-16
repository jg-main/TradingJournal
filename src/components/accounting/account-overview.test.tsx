/**
 * Component tests for AccountOverview.
 *
 * Covers:
 * - Populated overview with NAV, cash, positions, events
 * - Empty account (no projection, positions, or events)
 * - Missing-price positions (no valuation marks for an open position)
 * - Loading state (skeleton/spinner)
 * - Error state with retry
 *
 * Run: npx vitest run --reporter verbose src/components/accounting/account-overview.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import AccountOverview from './account-overview';

// ── Fixtures ───────────────────────────────────────────────────────────

/** Fully populated overview with all sections. */
const FIXTURE_POPULATED = {
  accountId: 'acct-001',
  snapshot: {
    netCash: '50000.00',
    nav: '150000.00',
    markedPositions: '100000.00',
    realizedPnl: '25000.00',
    unrealizedPnl: '5000.00',
    totalPnl: '30000.00',
    realizedFees: '1500.00',
    grossExposure: '200000.00',
    netExposure: '150000.00',
  },
  positions: [
    {
      symbol: 'AAPL',
      direction: 'long',
      quantity: '50.00',
      averageCost: '150.00',
      totalCostBasis: '7500.00',
      markStatus: 'fresh' as const,
      markPrice: '165.00',
      markedValue: '8250.00',
      unrealizedPnl: '750.00',
      realizedGrossPnl: '200.00',
      realizedNetPnl: '195.00',
    },
    {
      symbol: 'MSFT',
      direction: 'long',
      quantity: '200.00',
      averageCost: '300.00',
      totalCostBasis: '60000.00',
      markStatus: 'missing' as const,
      markPrice: null,
      markedValue: null,
      unrealizedPnl: null,
      realizedGrossPnl: '0.00',
      realizedNetPnl: '-10.00',
    },
  ],
  positionsTotal: 2,
  events: [
    {
      id: 'evt-001',
      eventType: 'dividend',
      description: 'AAPL quarterly dividend',
      postedAt: '2026-07-17T09:00:00.000Z',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
    },
    {
      id: 'evt-002',
      eventType: 'fee',
      description: 'Monthly platform fee',
      postedAt: '2026-07-18T00:00:00.000Z',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
    },
    {
      id: 'evt-003',
      eventType: 'deposit',
      description: 'Initial deposit',
      postedAt: '2026-01-02T10:00:00.000Z',
      status: { hasEntry: false, isBalanced: false, postingCount: 0 },
    },
    {
      id: 'evt-004',
      eventType: 'trade_execution',
      description: 'Buy 100 AAPL @ 150.00',
      postedAt: '2026-07-16T14:00:00.000Z',
      tradeId: 'trade-aapl-live',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
    },
  ],
  eventsTotal: 4,
};

/** Empty account — no projection, positions, or events. */
const FIXTURE_EMPTY = {
  accountId: 'acct-empty',
  snapshot: {
    netCash: null,
    nav: null,
    markedPositions: null,
    realizedPnl: null,
    unrealizedPnl: null,
    totalPnl: null,
    realizedFees: null,
    grossExposure: null,
    netExposure: null,
  },
  positions: [],
  positionsTotal: 0,
  events: [],
  eventsTotal: 0,
};

/** Account with a single position that has no valuation mark (missing price). */
const FIXTURE_MISSING_PRICE = {
  accountId: 'acct-missing',
  snapshot: {
    netCash: '10000.00',
    nav: '25000.00',
    markedPositions: null,
    realizedPnl: '500.00',
    unrealizedPnl: null,
    totalPnl: '500.00',
    realizedFees: '50.00',
    grossExposure: '15000.00',
    netExposure: '15000.00',
  },
  positions: [
    {
      symbol: 'TSLA',
      direction: 'long',
      quantity: '10.00',
      averageCost: '200.00',
      totalCostBasis: '2000.00',
      markStatus: 'missing' as const,
      markPrice: null,
      markedValue: null,
      unrealizedPnl: null,
      realizedGrossPnl: '0.00',
      realizedNetPnl: '0.00',
    },
  ],
  positionsTotal: 1,
  events: [
    {
      id: 'evt-mp-001',
      eventType: 'opening_balance',
      description: 'Opening balance',
      postedAt: '2026-01-01T00:00:00.000Z',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
    },
  ],
  eventsTotal: 1,
};

// ── Test Setup ─────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

function mockFetchSuccess(data: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

function mockFetchNetworkError() {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('AccountOverview — populated state', () => {
  it('renders four primary metric labels with values', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Net Asset Value')).toBeTruthy();
    });

    expect(screen.getByText('Net Asset Value')).toBeTruthy();
    expect(screen.getByText('Net Cash')).toBeTruthy();
    expect(screen.getByText('Market Value')).toBeTruthy();
    // "Open Positions" appears twice (metric card + section heading); verify count
    expect(screen.getAllByText('Open Positions').length).toBe(2);

    // Verify formatted values from fixture
    expect(screen.getByText('$150,000.00')).toBeTruthy();
    expect(screen.getByText('$50,000.00')).toBeTruthy();
    expect(screen.getByText('$100,000.00')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders P&L summary metric labels', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Realized P&L')).toBeTruthy();
    });

    expect(screen.getByText('Realized P&L')).toBeTruthy();
    expect(screen.getByText('Unrealized P&L')).toBeTruthy();
    expect(screen.getByText('Total P&L')).toBeTruthy();
    expect(screen.getByText('Realized Fees')).toBeTruthy();
  });



  it('renders positions table with symbol, direction, and mark status', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('MSFT')).toBeTruthy();

    // Mark status badges
    expect(screen.getByText('Fresh')).toBeTruthy();
    expect(screen.getByText('Missing')).toBeTruthy();

    // Total count indicator in section heading
    expect(screen.getByText('(2 total)')).toBeTruthy();
  });

  it('renders events table with type badges and descriptions', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL quarterly dividend')).toBeTruthy();
    });

    expect(screen.getByText('Dividend')).toBeTruthy();
    expect(screen.getByText('Fee')).toBeTruthy();
    expect(screen.getByText('Deposit')).toBeTruthy();
    expect(screen.getByText('Monthly platform fee')).toBeTruthy();
  });

  it('renders "View all" deep links for positions and events', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      const links = screen.getAllByText(/View all →/);
      expect(links.length).toBeGreaterThanOrEqual(2);
    });

    const viewAllLinks = screen.getAllByText(/View all →/);
    const positionsLink = viewAllLinks.find(
      (l) => l.closest('a')?.getAttribute('href') === '/accounts/acct-001/positions',
    );
    const ledgerLink = viewAllLinks.find(
      (l) => l.closest('a')?.getAttribute('href') === '/accounts/acct-001/ledger',
    );
    expect(positionsLink).toBeTruthy();
    expect(ledgerLink).toBeTruthy();
  });

  it('renders "Recent Events" section heading', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Recent Events')).toBeTruthy();
    });
  });
});

describe('AccountOverview — empty state', () => {
  it('renders empty positions message', async () => {
    mockFetchSuccess(FIXTURE_EMPTY);
    render(<AccountOverview accountId="acct-empty" />);

    await waitFor(() => {
      expect(screen.getByText('No open positions.')).toBeTruthy();
    });

    expect(
      screen.getByText('Post an execution to open a position.'),
    ).toBeTruthy();
  });

  it('renders empty events message', async () => {
    mockFetchSuccess(FIXTURE_EMPTY);
    render(<AccountOverview accountId="acct-empty" />);

    await waitFor(() => {
      expect(screen.getByText('No events yet.')).toBeTruthy();
    });

    expect(
      screen.getByText('Post financial events to see activity here.'),
    ).toBeTruthy();
  });

  it('renders all-null snapshot as em-dashes on metric cards', async () => {
    mockFetchSuccess(FIXTURE_EMPTY);
    render(<AccountOverview accountId="acct-empty" />);

    await waitFor(() => {
      expect(screen.getByText('Net Asset Value')).toBeTruthy();
    });

    // Primary metric cards show "—" when all values are null
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });


});

describe('AccountOverview — missing-price positions', () => {
  it('renders "Missing" badge for unmarked positions', async () => {
    mockFetchSuccess(FIXTURE_MISSING_PRICE);
    render(<AccountOverview accountId="acct-missing" />);

    await waitFor(() => {
      expect(screen.getByText('TSLA')).toBeTruthy();
    });

    expect(screen.getByText('Missing')).toBeTruthy();
  });

  it('shows "—" for mark price and market value when missing', async () => {
    mockFetchSuccess(FIXTURE_MISSING_PRICE);
    render(<AccountOverview accountId="acct-missing" />);

    await waitFor(() => {
      expect(screen.getByText('TSLA')).toBeTruthy();
    });

    // Verify the value cells for mark and market value show "—"
    const tableCells = document.querySelectorAll('td');
    const tableText = Array.from(tableCells).map((c) => c.textContent).join('|');
    expect(tableText).toContain('—');
  });
});

describe('AccountOverview — loading state', () => {
  it('renders loading indicator while fetching', () => {
    // Never resolve the fetch
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<AccountOverview accountId="acct-loading" />);

    expect(screen.getByText('Loading overview...')).toBeTruthy();
  });
});

describe('AccountOverview — trade navigation links', () => {
  it('renders a trade link for trade_execution events with tradeId', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    // 'trade-aapl-live'.slice(0, 8) = 'trade-aa'
    await waitFor(() => {
      const link = screen.getByLabelText('View trade trade-aa');
      expect(link).toBeTruthy();
    });

    const tradeLink = screen.getByLabelText('View trade trade-aa');
    expect(tradeLink.closest('a')?.getAttribute('href')).toBe('/trades/trade-aapl-live');
    expect(tradeLink.textContent).toContain('Trade');
  });
});

describe('AccountOverview — error state', () => {
  it('renders error message and retry button on network error', async () => {
    mockFetchNetworkError();
    render(<AccountOverview accountId="acct-error" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });

    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('retry button re-fetches and recovers', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    render(<AccountOverview accountId="acct-retry" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => FIXTURE_POPULATED,
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText('$150,000.00')).toBeTruthy();
    });
  });
});
