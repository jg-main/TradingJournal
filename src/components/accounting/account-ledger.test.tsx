/**
 * Component tests for AccountLedger.
 *
 * Covers:
 * - Populated ledger with multiple event types, postings, and correction groups
 * - Empty account (no events)
 * - Empty filter results (category with no matches)
 * - Loading state
 * - Error state with retry
 * - Category filter buttons (clicking changes the fetch)
 * - Pagination with prev/next
 * - Row expansion showing posting pairs and idempotency keys
 * - Correction group badge and lineage display
 * - Cash impact formatting (positive and negative)
 * - Unposted/unbalanced status indicators
 *
 * Run: npx vitest run src/components/accounting/account-ledger.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import AccountLedger from './account-ledger';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Render the ledger inside the shared TooltipProvider, mirroring the app
 * shell (MEM001). Required because the correction dialog renders a
 * Radix-based HelpTooltip.
 */
function renderLedger(accountId: string) {
  return render(
    <TooltipProvider>
      <AccountLedger accountId={accountId} />
    </TooltipProvider>,
  );
}

// ── Fixtures ───────────────────────────────────────────────────────────

/** Fully populated ledger with all event types and a correction group. */
const FIXTURE_POPULATED = {
  events: [
    {
      eventId: 'evt-open-001',
      eventType: 'opening_balance',
      postedAt: '2026-01-01T00:00:00.000Z',
      description: 'Opening balance',
      category: 'Opening Balance',
      cashImpact: '100000.00',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
      postings: {
        debit: { id: 'p-debit-01', side: 'debit', amount: '100000.00', amountMicros: 100000000000, currency: 'USD', sequence: 0 },
        credit: { id: 'p-credit-01', side: 'credit', amount: '100000.00', amountMicros: 100000000000, currency: 'USD', sequence: 1 },
      },
      idempotencyKey: null,
      correctionGroup: null,
    },
    {
      eventId: 'evt-dep-001',
      eventType: 'deposit',
      postedAt: '2026-01-15T10:30:00.000Z',
      description: 'Initial deposit',
      category: 'Cash',
      cashImpact: '50000.00',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
      postings: {
        debit: { id: 'p-debit-02', side: 'debit', amount: '50000.00', amountMicros: 50000000000, currency: 'USD', sequence: 0 },
        credit: { id: 'p-credit-02', side: 'credit', amount: '50000.00', amountMicros: 50000000000, currency: 'USD', sequence: 1 },
      },
      idempotencyKey: 'idem-dep-001',
      correctionGroup: null,
    },
    {
      eventId: 'evt-fee-001',
      eventType: 'fee',
      postedAt: '2026-02-01T00:00:00.000Z',
      description: 'Monthly platform fee',
      category: 'Fee/Tax',
      cashImpact: '-25.00',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
      postings: {
        debit: { id: 'p-debit-03', side: 'debit', amount: '25.00', amountMicros: 25000000, currency: 'USD', sequence: 0 },
        credit: { id: 'p-credit-03', side: 'credit', amount: '25.00', amountMicros: 25000000, currency: 'USD', sequence: 1 },
      },
      idempotencyKey: null,
      correctionGroup: null,
    },
    {
      eventId: 'evt-trade-001',
      eventType: 'trade_execution',
      postedAt: '2026-03-10T09:00:00.000Z',
      description: 'Buy 100 AAPL @ 150.00',
      category: 'Trade',
      cashImpact: '-15015.00',
      tradeId: 'trade-aapl-001',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
      postings: {
        debit: { id: 'p-debit-04', side: 'debit', amount: '15015.00', amountMicros: 15015000000, currency: 'USD', sequence: 0 },
        credit: { id: 'p-credit-04', side: 'credit', amount: '15015.00', amountMicros: 15015000000, currency: 'USD', sequence: 1 },
      },
      idempotencyKey: 'idem-trade-001',
      correctionGroup: null,
    },
    {
      eventId: 'corr-grp-001',
      eventType: 'trade_execution',
      postedAt: '2026-03-15T14:00:00.000Z',
      description: 'Corrected: Buy 50 AAPL @ 150.00',
      category: 'Trade',
      cashImpact: '-7507.50',
      // Correction group events do have a trade association parsed from the
      // replacement event's payload. UI renders tradeId when present.
      tradeId: 'trade-aapl-001',
      status: { hasEntry: true, isBalanced: true, postingCount: 2 },
      postings: {
        debit: { id: 'p-debit-05', side: 'debit', amount: '7507.50', amountMicros: 7507500000, currency: 'USD', sequence: 0 },
        credit: { id: 'p-credit-05', side: 'credit', amount: '7507.50', amountMicros: 7507500000, currency: 'USD', sequence: 1 },
      },
      idempotencyKey: null,
      correctionGroup: {
        correctionId: 'corr-grp-001',
        originalEventId: 'evt-org-trade-001',
        reversalEventId: 'evt-rev-trade-001',
        replacementEventId: 'evt-rep-trade-001',
        reason: 'Wrong quantity entered — corrected from 100 to 50',
        correctedAt: '2026-03-15T14:00:00.000Z',
      },
    },
  ],
  total: 5,
  page: 1,
  limit: 25,
  totalPages: 1,
};

/** Empty ledger — no events at all. */
const FIXTURE_EMPTY = {
  events: [],
  total: 0,
  page: 1,
  limit: 25,
  totalPages: 1,
};

/** Ledger with only one pageable page (for pagination tests). */
function createPaginatedFixture(totalEvents: number): typeof FIXTURE_POPULATED {
  const events = Array.from({ length: totalEvents }, (_, i) => ({
    eventId: `evt-batch-${String(i).padStart(3, '0')}`,
    eventType: 'deposit',
    postedAt: new Date(2026, 0, i + 1).toISOString(),
    description: `Deposit #${i + 1}`,
    category: 'Cash',
    cashImpact: '1000.00',
    status: { hasEntry: true, isBalanced: true, postingCount: 2 },
    postings: {
      debit: { id: `p-debit-batch-${i}`, side: 'debit', amount: '1000.00', amountMicros: 1000000000, currency: 'USD', sequence: 0 },
      credit: { id: `p-credit-batch-${i}`, side: 'credit', amount: '1000.00', amountMicros: 1000000000, currency: 'USD', sequence: 1 },
    },
    idempotencyKey: null,
    correctionGroup: null,
  }));

  return {
    events,
    total: totalEvents,
    page: 1,
    limit: 10,
    totalPages: Math.ceil(totalEvents / 10),
  };
}

/** Event with no postings or entry (unposted event). */
const FIXTURE_UNPOSTED = {
  events: [
    {
      eventId: 'evt-unposted-001',
      eventType: 'deposit',
      postedAt: '2026-01-15T10:30:00.000Z',
      description: 'Pending deposit',
      category: 'Cash',
      cashImpact: null,
      status: { hasEntry: false, isBalanced: false, postingCount: 0 },
      postings: null,
      idempotencyKey: null,
      correctionGroup: null,
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
  totalPages: 1,
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

describe('AccountLedger — populated state', () => {
  it('renders event rows with date, type badge, description', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });

    expect(screen.getByText('Opening balance')).toBeTruthy();
    expect(screen.getByText('Initial deposit')).toBeTruthy();
    expect(screen.getByText('Monthly platform fee')).toBeTruthy();
    expect(screen.getByText('Buy 100 AAPL @ 150.00')).toBeTruthy();
    expect(screen.getByText('Corrected: Buy 50 AAPL @ 150.00')).toBeTruthy();
  });

  it('renders type badges for various event types', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      // 'Opening' appears twice — once in the filter button, once as a type badge
      const openingElements = screen.getAllByText('Opening');
      expect(openingElements.length).toBeGreaterThanOrEqual(2);
    });

    expect(screen.getAllByText('Deposit').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Fee').length).toBeGreaterThanOrEqual(1);
    // 'Trade' appears 3 times — filter button + 2 event badges
    expect(screen.getAllByText('Trade').length).toBeGreaterThanOrEqual(3);
  });

  it('renders positive and negative cash impact values', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('$100,000.00')).toBeTruthy();
    });

    // Positive cash impact
    expect(screen.getByText('$100,000.00')).toBeTruthy();
    expect(screen.getByText('$50,000.00')).toBeTruthy();

    // Negative cash impact (with hyphen in formatted text)
    expect(screen.getByText('-$25.00')).toBeTruthy();
    expect(screen.getByText('-$15,015.00')).toBeTruthy();
  });

  it('renders status labels for posted events', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      const allPosted = screen.getAllByText('Posted');
      expect(allPosted.length).toBeGreaterThanOrEqual(5);
    });
  });

  it('renders correction group badge', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Corrected')).toBeTruthy();
    });
  });

  it('renders total count in the results info', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('5 events')).toBeTruthy();
    });
  });
});

describe('AccountLedger — filter controls', () => {
  it('renders all category filter buttons', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      const allBtns = screen.getAllByText('All');
      // 'All' appears only in the filter buttons (no event type badge for 'All')
      expect(allBtns.length).toBeGreaterThanOrEqual(1);
    });

    // Use the filter button group to scope assertions
    const filterGroup = screen.getByRole('group', { name: 'Event category filter' });
    expect(filterGroup.textContent).toContain('All');
    expect(filterGroup.textContent).toContain('Opening');
    expect(filterGroup.textContent).toContain('Cash');
    expect(filterGroup.textContent).toContain('Trade');
    expect(filterGroup.textContent).toContain('Fee/Tax');
    expect(filterGroup.textContent).toContain('Adjustment');
    expect(filterGroup.textContent).toContain('Transfer');
    expect(filterGroup.textContent).toContain('Corp. Action');
  });

  it('All filter is selected by default', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      const allBtn = screen.getByText('All');
      expect(allBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('clicking a filter button re-fetches with the new category', async () => {
    // First call returns all events, second returns only trade events
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => FIXTURE_POPULATED,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: FIXTURE_POPULATED.events.filter((e) => e.eventType === 'trade_execution'),
          total: 2,
          page: 1,
          limit: 25,
          totalPages: 1,
        }),
      });

    globalThis.fetch = fetchMock;
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });

    // Click Trade filter (find the button element from the filter group)
    const filterGroup = screen.getByRole('group', { name: 'Event category filter' });
    const tradeBtns = filterGroup.querySelectorAll('button');
    const tradeBtn = Array.from(tradeBtns).find((btn) => btn.textContent === 'Trade');
    expect(tradeBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(tradeBtn!);
    });

    await waitFor(() => {
      // Only trade events should remain
      expect(screen.getByText('Buy 100 AAPL @ 150.00')).toBeTruthy();
      expect(screen.getByText('Corrected: Buy 50 AAPL @ 150.00')).toBeTruthy();
    });

    // Opening and fee should not appear
    expect(screen.queryByText('Opening balance')).toBeNull();
    expect(screen.queryByText('Monthly platform fee')).toBeNull();

    // Verify fetch URL includes eventTypes parameter
    const tradeCall = fetchMock.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('eventTypes'),
    );
    expect(tradeCall).toBeTruthy();
    expect((tradeCall![0] as string)).toContain('eventTypes=trade_execution');
  });

  it('"All" filter sets aria-pressed to true when active', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('5 events')).toBeTruthy();
    });

    const allBtn = screen.getByText('All');
    expect(allBtn.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('AccountLedger — row expansion', () => {
  it('shows expand button for events with details', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });

    const expandButtons = screen.getAllByLabelText('Expand details');
    expect(expandButtons.length).toBeGreaterThanOrEqual(5);
  });

  it('expands a row to show debit/credit postings', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });

    // Expand the first row
    const expandBtn = screen.getAllByLabelText('Expand details')[0];
    await act(async () => {
      fireEvent.click(expandBtn);
    });

    // Verify posting labels appear
    await waitFor(() => {
      expect(screen.getByText('Debit')).toBeTruthy();
    });
    expect(screen.getByText('Credit')).toBeTruthy();
    expect(screen.getByText('Balanced')).toBeTruthy();
  });

  it('shows collapsible label after expansion', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });

    const expandBtn = screen.getAllByLabelText('Expand details')[0];
    await act(async () => {
      fireEvent.click(expandBtn);
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Collapse details')).toBeTruthy();
    });
  });

  it('expands a row with idempotency key to show the key', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Initial deposit')).toBeTruthy();
    });

    // Find and click expand on the deposit row (has idempotencyKey)
    const depositRowExpander = screen.getAllByLabelText('Expand details').find(
      (btn) => btn.closest('tr')?.textContent?.includes('Initial deposit'),
    );
    expect(depositRowExpander).toBeTruthy();

    await act(async () => {
      fireEvent.click(depositRowExpander!);
    });

    await waitFor(() => {
      expect(screen.getByText('Idempotency Key')).toBeTruthy();
    });
    expect(screen.getByText('idem-dep-001')).toBeTruthy();
  });

  it('expands correction group row to show correction lineage', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Corrected')).toBeTruthy();
    });

    // Find and expand the correction group row
    const corrRowExpander = screen.getAllByLabelText('Expand details').find(
      (btn) => btn.closest('tr')?.textContent?.includes('Corrected'),
    );
    expect(corrRowExpander).toBeTruthy();

    await act(async () => {
      fireEvent.click(corrRowExpander!);
    });

    await waitFor(() => {
      expect(screen.getByText('Correction Lineage')).toBeTruthy();
    });

    expect(screen.getByText('Original:')).toBeTruthy();
    expect(screen.getByText('Reversal:')).toBeTruthy();
    expect(screen.getByText('Replacement:')).toBeTruthy();
    expect(screen.getByText(/Wrong quantity entered/)).toBeTruthy();
  });
});

describe('AccountLedger — empty states', () => {
  it('renders empty account message when no events exist', async () => {
    mockFetchSuccess(FIXTURE_EMPTY);
    render(<AccountLedger accountId="acct-empty" />);

    await waitFor(() => {
      expect(screen.getByText('No ledger events yet.')).toBeTruthy();
    });

    expect(
      screen.getByText('Post financial events or executions to see activity here.'),
    ).toBeTruthy();
  });

  it('renders empty filter message when filter matches nothing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => FIXTURE_POPULATED,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => FIXTURE_EMPTY,
      });

    globalThis.fetch = fetchMock;
    render(<AccountLedger accountId="acct-filtered" />);

    await waitFor(() => {
      expect(screen.getByText('5 events')).toBeTruthy();
    });

    // Click Transfer filter (likely has no events in fixture)
    const transferBtn = screen.getByText('Transfer');
    await act(async () => {
      fireEvent.click(transferBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('No matching events.')).toBeTruthy();
    });

    expect(
      screen.getByText('No events match the current filter selection.'),
    ).toBeTruthy();

    // Should have a "Clear filter" button
    expect(screen.getByText('Clear filter')).toBeTruthy();
  });

  it('clear filter button resets to all events', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => FIXTURE_POPULATED,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => FIXTURE_EMPTY,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => FIXTURE_POPULATED,
      });

    globalThis.fetch = fetchMock;
    render(<AccountLedger accountId="acct-filter-clear" />);

    await waitFor(() => {
      expect(screen.getByText('5 events')).toBeTruthy();
    });

    // Apply filter that yields empty
    const transferBtn = screen.getByText('Transfer');
    await act(async () => {
      fireEvent.click(transferBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('No matching events.')).toBeTruthy();
    });

    // Click Clear filter
    await act(async () => {
      fireEvent.click(screen.getByText('Clear filter'));
    });

    await waitFor(() => {
      expect(screen.getByText('5 events')).toBeTruthy();
    });
  });
});

describe('AccountLedger — pagination', () => {
  it('shows pagination when totalPages > 1', async () => {
    const fixture = createPaginatedFixture(25);
    mockFetchSuccess(fixture);
    render(<AccountLedger accountId="acct-paged" />);

    await waitFor(() => {
      expect(screen.getByText('Prev')).toBeTruthy();
    });

    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  });

  it('disables Prev on first page', async () => {
    const fixture = createPaginatedFixture(25);
    mockFetchSuccess(fixture);
    render(<AccountLedger accountId="acct-paged" />);

    await waitFor(() => {
      expect(screen.getByText('Prev')).toBeTruthy();
    });

    const prevBtn = screen.getByLabelText('Previous page');
    expect(prevBtn.hasAttribute('disabled')).toBe(true);

    const nextBtn = screen.getByLabelText('Next page');
    expect(nextBtn.hasAttribute('disabled')).toBe(false);
  });

  it('clicking Next advances to page 2', async () => {
    const fixturePage1 = createPaginatedFixture(25);
    const fixturePage2 = {
      ...fixturePage1,
      page: 2,
      events: fixturePage1.events.slice(10, 20),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => fixturePage1 })
      .mockResolvedValueOnce({ ok: true, json: async () => fixturePage2 });

    globalThis.fetch = fetchMock;
    render(<AccountLedger accountId="acct-paged" />);

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Next page'));
    });

    await waitFor(() => {
      expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    });

    // Page 2 fetch should contain page=2
    const page2Call = fetchMock.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('page=2'),
    );
    expect(page2Call).toBeTruthy();
  });

  it('shows "Showing X-Y of Z" on multi-page results', async () => {
    const fixture = createPaginatedFixture(25);
    mockFetchSuccess(fixture);
    render(<AccountLedger accountId="acct-paged" />);

    await waitFor(() => {
      expect(screen.getByText(/Showing/)).toBeTruthy();
    });

    // The component hardcodes pageLimit=25, so with 25 events it shows 1–25
    expect(screen.getByText('Showing 1–25 of 25')).toBeTruthy();
  });
});

describe('AccountLedger — unposted/unbalanced status', () => {
  it('renders "Unposted" status for events without entries', async () => {
    mockFetchSuccess(FIXTURE_UNPOSTED);
    render(<AccountLedger accountId="acct-unposted" />);

    await waitFor(() => {
      expect(screen.getByText('Unposted')).toBeTruthy();
    });
  });

  it('does not show expand button for events without details', async () => {
    mockFetchSuccess(FIXTURE_UNPOSTED);
    render(<AccountLedger accountId="acct-unposted" />);

    await waitFor(() => {
      expect(screen.getByText('Pending deposit')).toBeTruthy();
    });

    const expandButtons = screen.queryAllByLabelText('Expand details');
    expect(expandButtons.length).toBe(0);
  });
});

describe('AccountLedger — loading state', () => {
  it('renders loading indicator while fetching', () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<AccountLedger accountId="acct-loading" />);

    expect(screen.getByText('Loading ledger...')).toBeTruthy();
  });
});

describe('AccountLedger — error state', () => {
  it('renders error message and retry button on network error', async () => {
    mockFetchNetworkError();
    render(<AccountLedger accountId="acct-error" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });

    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('retry button re-fetches and recovers', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    render(<AccountLedger accountId="acct-retry" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => FIXTURE_POPULATED,
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
    });

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });
  });
});

describe('AccountLedger — accessibility', () => {
  it('filter control group has accessible label', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-a11y" />);

    await waitFor(() => {
      const filterGroup = screen.getByRole('group', { name: 'Event category filter' });
      expect(filterGroup).toBeTruthy();
    });
  });

  it('expand buttons have aria-expanded and aria-controls', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-a11y" />);

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });

    const expandBtn = screen.getAllByLabelText('Expand details')[0];
    expect(expandBtn.getAttribute('aria-expanded')).toBe('false');
    expect(expandBtn.getAttribute('aria-controls')).toMatch(/^ledger-detail-/);
  });

  it('expanded region has role="region" with accessible label', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-a11y" />);

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });

    const expandBtn = screen.getAllByLabelText('Expand details')[0];
    await act(async () => {
      fireEvent.click(expandBtn);
    });

    const region = document.querySelector('[role="region"]');
    expect(region).toBeTruthy();
    expect(region!.getAttribute('aria-label')).toMatch(/Details for/);
  });

  it('pagination buttons have accessible labels', async () => {
    const fixture = createPaginatedFixture(25);
    mockFetchSuccess(fixture);
    render(<AccountLedger accountId="acct-a11y-paged" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Previous page')).toBeTruthy();
    });

    expect(screen.getByLabelText('Next page')).toBeTruthy();
  });
});

describe('AccountLedger — trade navigation links', () => {
  it('renders a trade link for trade_execution events with tradeId', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      // The trade event should have a "Trade" link next to description
      const tradeLinks = screen.getAllByLabelText(/View trade/);
      expect(tradeLinks.length).toBeGreaterThanOrEqual(2);
    });

    // Verify the href is correctly formed for the first trade event
    const tradeLinks = screen.getAllByLabelText(/View trade/);
    const firstLink = tradeLinks[0].closest('a');
    expect(firstLink?.getAttribute('href')).toBe('/trades/trade-aapl-001');
    expect(firstLink?.textContent).toContain('Trade');
  });

  it('does not render a trade link for non-trade events', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Opening balance')).toBeTruthy();
    });

    // Opening, deposit, and fee events should NOT have trade links
    // They should not have the aria-label pattern used for trade links
    const allTradeLinks = screen.queryAllByLabelText(/View trade/);
    // Only the 2 trade_execution events have tradeId
    expect(allTradeLinks.length).toBe(2);
  });

  it('trade link has accessible aria-label with truncated trade ID', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountLedger accountId="acct-001" />);

    await waitFor(() => {
      // Two trade events share 'trade-aapl-001', so slice(0,8) = 'trade-aa'
      const links = screen.getAllByLabelText('View trade trade-aa');
      expect(links.length).toBe(2);
    });
  });

  it('does not render trade link when tradeId is null', async () => {
    // Use a fixture where trade events have no tradeId, like the fee event
    const fixture = {
      ...FIXTURE_POPULATED,
      events: FIXTURE_POPULATED.events.map((e) => ({
        ...e,
        // Remove tradeId from non-trade events (they already don't have it)
        tradeId: e.eventType === 'trade_execution' ? null : e.tradeId ?? null,
      })),
    };
    // Override specific events with null tradeId
    fixture.events = fixture.events.map((e) => {
      if (e.eventType === 'trade_execution') {
        return { ...e, tradeId: null };
      }
      return e;
    });

    mockFetchSuccess(fixture);
    render(<AccountLedger accountId="acct-no-trade" />);

    await waitFor(() => {
      expect(screen.getByText('Buy 100 AAPL @ 150.00')).toBeTruthy();
    });

    // No trade links should be rendered
    const tradeLinks = screen.queryAllByLabelText(/View trade/);
    expect(tradeLinks.length).toBe(0);
  });
});

describe('AccountLedger — results info', () => {
  it('pluralizes event count correctly (1 event)', async () => {
    const fixture = {
      events: [FIXTURE_POPULATED.events[0]],
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
    };
    mockFetchSuccess(fixture);
    render(<AccountLedger accountId="acct-single" />);

    await waitFor(() => {
      expect(screen.getByText('1 event')).toBeTruthy();
    });
  });

  it('shows "(filtered)" suffix when a category filter is active', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => FIXTURE_POPULATED,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [FIXTURE_POPULATED.events.find((e) => e.eventType === 'fee')!],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        }),
      });

    globalThis.fetch = fetchMock;
    render(<AccountLedger accountId="acct-filtered-info" />);

    await waitFor(() => {
      expect(screen.getByText('5 events')).toBeTruthy();
    });

    // Click Fee/Tax filter
    const feeTaxBtn = screen.getByText('Fee/Tax');
    await act(async () => {
      fireEvent.click(feeTaxBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('1 event (filtered)')).toBeTruthy();
    });
  });
});

describe('AccountLedger — correction actions', () => {
  it('renders Correct action only for eligible posted financial events', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    renderLedger('acct-001');

    await waitFor(() => {
      expect(screen.getByText('Initial deposit')).toBeTruthy();
    });

    // Eligible since A4: opening_balance, deposit, fee. Not eligible:
    // trade_execution and the correction-group row (replacement constituent).
    const correctButtons = screen.getAllByRole('button', { name: /^Correct / });
    expect(correctButtons.length).toBe(3);
    const labels = correctButtons.map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => l.includes('opening_balance'))).toBe(true);
    expect(labels.some((l) => l.includes('deposit'))).toBe(true);
    expect(labels.some((l) => l.includes('fee'))).toBe(true);
  });

  it('does not render Correct for correction-group rows or non-eligible types', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    renderLedger('acct-001');

    await waitFor(() => {
      expect(screen.getByText('Corrected: Buy 50 AAPL @ 150.00')).toBeTruthy();
    });

    // The correction-group row (trade_execution with correctionGroup) must not
    // expose a Correct action — the replacement is already part of a lineage.
    const corrGroupBtn = screen
      .getAllByRole('button', { name: /^Correct / })
      .find((b) => b.closest('tr')?.textContent?.includes('Corrected: Buy 50'));
    expect(corrGroupBtn).toBeUndefined();

    // The plain trade_execution row must not either. opening_balance IS
    // correctable since A4 (its original row exposes Correct).
    const correctButtons = screen.getAllByRole('button', { name: /^Correct / });
    expect(
      correctButtons.every((b) => {
        const label = b.getAttribute('aria-label') ?? '';
        return (
          label.includes('deposit') ||
          label.includes('fee') ||
          label.includes('opening_balance')
        );
      }),
    ).toBe(true);
  });

  it('opens the correction dialog with pre-filled amount when Correct is clicked', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    renderLedger('acct-001');

    await waitFor(() => {
      expect(screen.getByText('Initial deposit')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Correct deposit event/ }));
    });

    // Dialog opens with the deposit's amount pre-filled (absolute value of cashImpact)
    await waitFor(() => {
      expect(screen.getByText('Correct Financial Event')).toBeTruthy();
    });
    const amountInput = screen.getByRole('textbox', { name: /amount/i }) as HTMLInputElement;
    expect(amountInput.value).toBe('50000.00');
  });

  it('closes the correction dialog on Cancel', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    renderLedger('acct-001');

    await waitFor(() => {
      expect(screen.getByText('Initial deposit')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Correct deposit event/ }));
    });
    await waitFor(() => {
      expect(screen.getByText('Correct Financial Event')).toBeTruthy();
    });

    const cancelBtn = screen.getByText('Cancel').closest('button');
    expect(cancelBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(cancelBtn!);
    });

    await waitFor(() => {
      expect(screen.queryByText('Correct Financial Event')).toBeNull();
    });
  });

  it('does not render Correct for unposted events', async () => {
    mockFetchSuccess(FIXTURE_UNPOSTED);
    renderLedger('acct-unposted');

    await waitFor(() => {
      expect(screen.getByText('Pending deposit')).toBeTruthy();
    });

    expect(screen.queryAllByRole('button', { name: /^Correct / }).length).toBe(0);
  });

  it('pre-fills the signed amount for manual_adjustment rows', async () => {
    const fixture = {
      events: [
        {
          eventId: 'evt-manual-001',
          eventType: 'manual_adjustment',
          postedAt: '2026-02-10T09:00:00.000Z',
          description: 'Manual adjustment',
          category: 'Adjustment',
          cashImpact: '-150.00',
          status: { hasEntry: true, isBalanced: true, postingCount: 2 },
          postings: {
            debit: { id: 'p-debit-m1', side: 'debit', amount: '150.00', amountMicros: 150000000, currency: 'USD', sequence: 0 },
            credit: { id: 'p-credit-m1', side: 'credit', amount: '150.00', amountMicros: 150000000, currency: 'USD', sequence: 1 },
          },
          idempotencyKey: null,
          correctionGroup: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
    };

    mockFetchSuccess(fixture);
    renderLedger('acct-manual');

    await waitFor(() => {
      expect(screen.getByText('Manual adjustment')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Correct manual_adjustment event/ }));
    });

    await waitFor(() => {
      expect(screen.getByText('Correct Financial Event')).toBeTruthy();
    });
    const amountInput = screen.getByRole('textbox', { name: /amount/i }) as HTMLInputElement;
    expect(amountInput.value).toBe('-150.00');
  });

  it('refetches the ledger after a correction completes', async () => {
    // Intercept only the dialog's 2000ms success auto-close timer.
    let successCb: (() => void) | null = null;
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    setTimeoutSpy.mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === 2000) {
        successCb = handler as () => void;
        return 123 as unknown as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => FIXTURE_POPULATED })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          correction: {
            id: 'corr-0001',
            accountId: 'acct-001',
            originalEventId: 'evt-dep-001',
            reversalEventId: 'rev-0001',
            replacementEventId: 'rep-0001',
            reason: 'Wrong amount entered',
            correctedAt: '2026-03-16T10:00:00.000Z',
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => FIXTURE_POPULATED });

    globalThis.fetch = fetchMock;
    renderLedger('acct-001');

    await waitFor(() => {
      expect(screen.getByText('Initial deposit')).toBeTruthy();
    });

    // Open the dialog and complete the correction flow
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Correct deposit event/ }));
    });
    const reasonInput = screen.getByRole('textbox', { name: /reason/i });
    await act(async () => {
      fireEvent.change(reasonInput, { target: { value: 'Wrong amount entered' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Review Correction').closest('button')!);
    });
    await waitFor(() => {
      // "Confirm Correction" appears as both the confirm heading and the
      // submit button — use getAllByText.
      expect(screen.getAllByText('Confirm Correction').length).toBeGreaterThanOrEqual(1);
    });
    await act(async () => {
      const confirmBtn = screen
        .getAllByText('Confirm Correction')
        .map((el) => el.closest('button'))
        .find((b) => b);
      fireEvent.click(confirmBtn!);
    });

    // The correction POST fires against the correct endpoint
    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes('/correct'),
      );
      expect(postCalls.length).toBe(1);
      expect(postCalls[0][0]).toBe(
        '/api/accounts/acct-001/financial-events/evt-dep-001/correct',
      );
    });

    // Success auto-close triggers the ledger refetch
    await act(async () => {
      successCb?.();
    });

    await waitFor(() => {
      const ledgerGets = fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes('/ledger'),
      );
      expect(ledgerGets.length).toBe(2);
    });

    setTimeoutSpy.mockRestore();
  });
});
