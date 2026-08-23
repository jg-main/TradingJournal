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
import { ACCOUNT_CHANGED_EVENT } from '@/lib/account-context';

// ── Account-context mock (S03/T02) ─────────────────────────────────────
// Provide a controllable AccountProvider.refresh so the success handoff
// (refresh + overview refetch + ACCOUNT_CHANGED_EVENT) is directly
// observable. All other context fields keep their real shapes, and
// AccountInitialization does not consume useAccount, so the existing draft
// tests are unaffected.

const mockRefresh = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/account-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/account-context')>();
  return {
    ...actual,
    useAccount: () => ({
      accounts: [],
      loading: false,
      error: null,
      accountId: 'acct-001',
      setAccountId: vi.fn(),
      refresh: mockRefresh,
    }),
  };
});

// ── Fixtures ───────────────────────────────────────────────────────────

/** Fully populated overview with all sections. */
const FIXTURE_POPULATED = {
  accountId: 'acct-001',
  isActive: true,
  name: 'Main Brokerage',
  currency: 'USD',
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

/** Empty but ACTIVE account — no projection, positions, or events. */
const FIXTURE_EMPTY = {
  accountId: 'acct-empty',
  isActive: true,
  name: 'Empty Account',
  currency: 'USD',
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

/** Draft account — inactive with no events, positions, or projection. */
const FIXTURE_DRAFT = {
  accountId: 'acct-draft',
  isActive: false,
  name: 'New Brokerage',
  currency: 'USD',
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
  isActive: true,
  name: 'Main Brokerage',
  currency: 'USD',
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
  mockRefresh.mockClear();
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
      (l) => l.closest('a')?.getAttribute('href') === '/settings/accounts/acct-001/positions',
    );
    const ledgerLink = viewAllLinks.find(
      (l) => l.closest('a')?.getAttribute('href') === '/settings/accounts/acct-001/ledger',
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

describe('AccountOverview — draft account initialization', () => {
  it('renders the initialization state for an inactive account with no events', async () => {
    mockFetchSuccess(FIXTURE_DRAFT);
    render(<AccountOverview accountId="acct-draft" />);

    await waitFor(() => {
      expect(screen.getByText('Set up New Brokerage')).toBeTruthy();
    });

    expect(screen.getByText('Add opening balance')).toBeTruthy();
    expect(screen.getByText('Start with zero')).toBeTruthy();
    // The plain empty-overview messages are replaced by the guided state.
    expect(screen.queryByText('No events yet.')).toBeNull();
    expect(screen.queryByText('No open positions.')).toBeNull();
  });

  it('does not show initialization for an inactive account that already has events', async () => {
    mockFetchSuccess({ ...FIXTURE_POPULATED, isActive: false });
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Net Asset Value')).toBeTruthy();
    });

    expect(screen.queryByText('Start with zero')).toBeNull();
    expect(screen.queryByText('Add opening balance')).toBeNull();
  });

  it('does not show initialization for an active account with no events', async () => {
    mockFetchSuccess(FIXTURE_EMPTY);
    render(<AccountOverview accountId="acct-empty" />);

    await waitFor(() => {
      expect(screen.getByText('No events yet.')).toBeTruthy();
    });

    expect(screen.queryByText('Start with zero')).toBeNull();
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

describe('AccountOverview — Add Transaction entry point (S03/T02)', () => {
  it('renders an Add Transaction button on a populated overview', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Net Asset Value')).toBeTruthy();
    });

    const addButton = screen.getByRole('button', { name: 'Add Transaction' });
    expect(addButton).toBeTruthy();
    expect(addButton.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('renders the entry point on an active empty account (no events yet)', async () => {
    mockFetchSuccess(FIXTURE_EMPTY);
    render(<AccountOverview accountId="acct-empty" />);

    await waitFor(() => {
      expect(screen.getByText('No events yet.')).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'Add Transaction' })).toBeTruthy();
  });

  it('does not render the entry point in the draft initialization state', async () => {
    mockFetchSuccess(FIXTURE_DRAFT);
    render(<AccountOverview accountId="acct-draft" />);

    await waitFor(() => {
      expect(screen.getByText('Set up New Brokerage')).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Add Transaction' })).toBeNull();
  });

  it('opens the composer dialog with the curated 7-type event selector', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Net Asset Value')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Transaction' }));

    // Dialog is open with its title and description.
    expect(screen.getByRole('heading', { name: 'Add Transaction' })).toBeTruthy();
    expect(
      screen.getByText(
        'Post a cash-flow event to the account ledger. Each event creates a balanced double-entry posting and updates account cash.',
      ),
    ).toBeTruthy();

    // Exactly the 7 R014-curated types; opening_balance/transfer/stock_split
    // are not offered from this surface.
    const select = screen.getByLabelText('Event Type') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual([
      'deposit',
      'withdrawal',
      'dividend',
      'interest',
      'fee',
      'tax',
      'manual_adjustment',
    ]);
    expect(options).not.toContain('opening_balance');
    expect(options).not.toContain('transfer');
    expect(options).not.toContain('stock_split');
  });

  it('posts a deposit through the canonical route and refreshes account state on success', async () => {
    const updatedEvents = [
      {
        id: 'evt-005',
        eventType: 'deposit',
        description: 'Cash transfer from bank',
        postedAt: '2026-08-21T12:00:00.000Z',
        status: { hasEntry: true, isBalanced: true, postingCount: 2 },
      },
      ...FIXTURE_POPULATED.events,
    ];

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => FIXTURE_POPULATED });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // POST financial-events
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...FIXTURE_POPULATED, events: updatedEvents, eventsTotal: 5 }),
    }); // overview refetch after handoff

    const changedSpy = vi.fn();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, changedSpy);

    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Net Asset Value')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Transaction' }));
    fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /Post Transaction/ }));

    // Perceivable success state, then the handoff: refresh + refetch + event.
    await waitFor(() => {
      expect(screen.getByText('Deposit posted')).toBeTruthy();
    });
    await waitFor(
      () => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    expect(changedSpy).toHaveBeenCalledTimes(1);

    // POST went through the canonical route with the deposit body.
    const postCall = fetchMock.mock.calls[1];
    expect(postCall[0]).toBe('/api/accounts/acct-001/financial-events');
    expect((postCall[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((postCall[1] as RequestInit).body as string)).toEqual({
      eventType: 'deposit',
      amount: '1000.00',
      postedAt: expect.any(String),
    });

    // Dialog closed after the handoff, and the overview refetch made the new
    // event visible in Recent Events.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Add Transaction' })).toBeNull();
    });
    expect(screen.getByText('Cash transfer from bank')).toBeTruthy();

    window.removeEventListener(ACCOUNT_CHANGED_EVENT, changedSpy);
  });

  it('surfaces a 500 API error in a role=alert banner without losing the overview', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => FIXTURE_POPULATED });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Posting failed' }),
    }); // POST financial-events rejected

    render(<AccountOverview accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Net Asset Value')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Transaction' }));
    fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /Post Transaction/ }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('Posting failed');
    });

    // The composer stays open for retry, the overview is untouched, and the
    // success handoff (refresh) must NOT fire on a failed post.
    expect(screen.getByRole('heading', { name: 'Add Transaction' })).toBeTruthy();
    expect(screen.getByText('Net Asset Value')).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// ── A6: historical inactive account is read-only for new activity ───────

describe('AccountOverview — historical inactive account (A6)', () => {
  const FIXTURE_HISTORICAL_INACTIVE = {
    ...FIXTURE_POPULATED,
    accountId: 'acct-historical',
    isActive: false,
  };

  it('renders historical data read-only: no Add Transaction, guidance to reactivate', async () => {
    mockFetchSuccess(FIXTURE_HISTORICAL_INACTIVE);
    render(<AccountOverview accountId="acct-historical" />);

    await waitFor(() => {
      expect(screen.getByText('Net Asset Value')).toBeTruthy();
    });

    // Historical data remains visible.
    expect(screen.getByText('Recent Events')).toBeTruthy();
    expect(screen.getByText('Initial deposit')).toBeTruthy();

    // No Add Transaction action and no composer for an inactive account.
    expect(screen.queryByRole('button', { name: 'Add Transaction' })).toBeNull();

    // Compact read-only guidance with a Settings link to reactivate.
    expect(screen.getByText(/Inactive account\./)).toBeTruthy();
    const settingsLink = screen.getByRole('link', { name: /Settings/i });
    expect(settingsLink.getAttribute('href')).toBe('/settings/accounts/acct-historical/settings');
  });
});
