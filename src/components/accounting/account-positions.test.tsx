/**
 * Component tests for AccountPositions (dense table workspace).
 *
 * Covers:
 * - Populated positions table with summary strip and expandable FIFO lots
 * - Empty state (no positions)
 * - Loading state
 * - Error state with retry
 * - Expand/collapse FIFO lots with keyboard-operable controls
 * - Mark status badges (fresh, stale, missing, pending)
 * - Summary strip aggregate values
 * - Accessibility (aria-expanded, aria-controls, table aria-label)
 *
 * Run: npx vitest run --reporter verbose src/components/accounting/account-positions.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import AccountPositions from './account-positions';

// ── Fixtures ───────────────────────────────────────────────────────────

/** Fully populated positions with FIFO lots, marks, and mixed directions. */
const FIXTURE_POPULATED = {
  positions: [
    {
      accountId: 'acct-001',
      instrumentId: 'inst-aapl-001',
      symbol: 'AAPL',
      direction: 'long',
      quantity: '100.00',
      averageCost: '150.50',
      totalCostBasis: '15050.00',
      markStatus: 'fresh' as const,
      markPrice: '165.75',
      markedValue: '16575.00',
      unrealizedPnl: '1525.00',
      realizedGrossPnl: '500.00',
      realizedFees: '25.00',
      realizedNetPnl: '475.00',
      lastUpdated: '2026-07-15T14:30:00.000Z',
      openLots: [
        {
          id: 'lot-aapl-001',
          instrumentId: 'inst-aapl-001',
          direction: 'long',
          remainingQuantity: '60.00',
          originalQuantity: '60.00',
          entryPrice: '148.00',
          costBasisTotal: '8880.00',
          allocatedFees: '12.00',
          openingExecutionId: 'exec-aapl-buy-001',
          openedAt: '2026-06-01T09:30:00.000Z',
        },
        {
          id: 'lot-aapl-002',
          instrumentId: 'inst-aapl-001',
          direction: 'long',
          remainingQuantity: '40.00',
          originalQuantity: '50.00',
          entryPrice: '155.00',
          costBasisTotal: '6200.00',
          allocatedFees: '10.00',
          openingExecutionId: 'exec-aapl-buy-002',
          openedAt: '2026-06-15T10:00:00.000Z',
        },
      ],
    },
    {
      accountId: 'acct-001',
      instrumentId: 'inst-msft-001',
      symbol: 'MSFT',
      direction: 'short',
      quantity: '200.00',
      averageCost: '380.00',
      totalCostBasis: '76000.00',
      markStatus: 'missing' as const,
      markPrice: null,
      markedValue: null,
      unrealizedPnl: null,
      realizedGrossPnl: '-300.00',
      realizedFees: '30.00',
      realizedNetPnl: '-330.00',
      lastUpdated: '2026-07-14T09:00:00.000Z',
      openLots: [
        {
          id: 'lot-msft-001',
          instrumentId: 'inst-msft-001',
          direction: 'short',
          remainingQuantity: '200.00',
          originalQuantity: '200.00',
          entryPrice: '380.00',
          costBasisTotal: '76000.00',
          allocatedFees: '30.00',
          openingExecutionId: 'exec-msft-short-001',
          openedAt: '2026-07-01T11:00:00.000Z',
        },
      ],
    },
    {
      accountId: 'acct-001',
      instrumentId: 'inst-tsla-002',
      symbol: 'TSLA',
      direction: 'long',
      quantity: '50.00',
      averageCost: '220.00',
      totalCostBasis: '11000.00',
      markStatus: 'stale' as const,
      markPrice: '235.00',
      markedValue: '11750.00',
      unrealizedPnl: '750.00',
      realizedGrossPnl: '0.00',
      realizedFees: '0.00',
      realizedNetPnl: '0.00',
      lastUpdated: '2026-07-13T16:00:00.000Z',
      openLots: [],
    },
  ],
  total: 3,
};

/** Empty positions — no open positions. */
const FIXTURE_EMPTY = {
  positions: [],
  total: 0,
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

describe('AccountPositions — populated state', () => {
  it('renders header with total count', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Current Positions')).toBeTruthy();
    });

    expect(screen.getByText('(3 total)')).toBeTruthy();
  });

  it('renders symbol, direction, quantity for each position', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('MSFT')).toBeTruthy();
    expect(screen.getByText('TSLA')).toBeTruthy();

    // Direction labels — "long" appears twice (AAPL + TSLA)
    const longElements = screen.getAllByText('long');
    expect(longElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('short')).toBeTruthy();
  });

  it('renders summary strip with aggregate values', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Open Positions')).toBeTruthy();
    });

    // Positions count in summary
    expect(screen.getByText('3')).toBeTruthy();

    // Market Value (markedValue sum: 16575.00 + null + 11750.00 = 28325.00)
    expect(screen.getByText('$28,325.00')).toBeTruthy();

    // Unrealized P&L (unrealizedPnl sum: 1525.00 + null + 750.00 = 2275.00)
    expect(screen.getByText('+$2,275.00')).toBeTruthy();

    // Realized Net P&L (realizedNetPnl sum: 475.00 + (-330.00) + 0.00 = 145.00)
    expect(screen.getByText('+$145.00')).toBeTruthy();
  });

  it('renders mark status badges', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Fresh')).toBeTruthy();
    });

    expect(screen.getByText('Fresh')).toBeTruthy();
    expect(screen.getByText('Missing')).toBeTruthy();
    expect(screen.getByText('Stale')).toBeTruthy();
  });

  it('renders "—" for missing mark values', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    // The MSFT row has markPrice: null, markedValue: null, unrealizedPnl: null
    // These should render as "—" not "$0.00"
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it('renders refresh button', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByTitle('Refresh positions')).toBeTruthy();
    });
  });
});

describe('AccountPositions — empty state', () => {
  it('renders empty state message', async () => {
    mockFetchSuccess(FIXTURE_EMPTY);
    render(<AccountPositions accountId="acct-empty" />);

    await waitFor(() => {
      expect(screen.getByText('No open positions.')).toBeTruthy();
    });

    expect(
      screen.getByText('Post an execution to open a position.'),
    ).toBeTruthy();
  });
});

describe('AccountPositions — loading state', () => {
  it('renders loading indicator while fetching', () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<AccountPositions accountId="acct-loading" />);

    expect(screen.getByText('Loading positions...')).toBeTruthy();
  });
});

describe('AccountPositions — error state', () => {
  it('renders error message and retry button on network error', async () => {
    mockFetchNetworkError();
    render(<AccountPositions accountId="acct-error" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });

    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('retry button re-fetches and recovers', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    render(<AccountPositions accountId="acct-retry" />);

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
      expect(screen.getByText('AAPL')).toBeTruthy();
    });
  });
});

describe('AccountPositions — expand/collapse FIFO lots', () => {
  it('shows expand buttons for positions with open lots', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    // AAPL and MSFT have lots, TSLA has no lots
    const expandButtons = screen.getAllByLabelText('Expand FIFO lots');
    expect(expandButtons.length).toBe(2);
  });

  it('expands a row to show FIFO lot details', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    // Expand AAPL lots
    const expandBtns = screen.getAllByLabelText('Expand FIFO lots');
    await act(async () => {
      fireEvent.click(expandBtns[0]);
    });

    // Verify expanded lot section shows lot column headers
    await waitFor(() => {
      expect(screen.getByText('Side')).toBeTruthy();
    });

    expect(screen.getByText('Remaining')).toBeTruthy();
    expect(screen.getByText('Entry Price')).toBeTruthy();
    expect(screen.getByText('Cost Basis')).toBeTruthy();
    expect(screen.getByText('Fees')).toBeTruthy();
    expect(screen.getByText('Opening Exec')).toBeTruthy();
    expect(screen.getByText('Opened')).toBeTruthy();
  });

  it('collapses FIFO lots on second click', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    // Expand
    const expandBtns = screen.getAllByLabelText('Expand FIFO lots');
    await act(async () => {
      fireEvent.click(expandBtns[0]);
    });

    await waitFor(() => {
      expect(screen.getByText('Side')).toBeTruthy();
    });

    // Collapse
    const collapseBtn = screen.getByLabelText('Collapse FIFO lots');
    await act(async () => {
      fireEvent.click(collapseBtn);
    });

    // After collapse, the lot table headers should be gone
    expect(screen.queryByText('Remaining')).toBeNull();
  });

  it('shows lot entry price and cost data', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    const expandBtns = screen.getAllByLabelText('Expand FIFO lots');
    await act(async () => {
      fireEvent.click(expandBtns[0]);
    });

    await waitFor(() => {
      expect(screen.getByText('$148.00')).toBeTruthy();
    });

    // Check lot values from fixture
    expect(screen.getByText('$148.00')).toBeTruthy();
    expect(screen.getByText('$8,880.00')).toBeTruthy();
    expect(screen.getByText('$12.00')).toBeTruthy();
  });

  it('expands MSFT short positions too', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('MSFT')).toBeTruthy();
    });

    const expandBtns = screen.getAllByLabelText('Expand FIFO lots');
    // MSFT is the second position with lots
    await act(async () => {
      fireEvent.click(expandBtns[1]);
    });

    // $380.00 appears as avg cost AND as lot entry price — use getAllByText
    await waitFor(() => {
      const priceElements = screen.getAllByText('$380.00');
      expect(priceElements.length).toBeGreaterThanOrEqual(1);
    });

    // Verify short direction badge appears — appears both in row and lot badge
    const shortElements = screen.getAllByText('short');
    expect(shortElements.length).toBeGreaterThanOrEqual(1);
  });
});

describe('AccountPositions — accessibility', () => {
  it('positions table has accessible label', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      const table = screen.getByRole('table', { name: 'Open positions' });
      expect(table).toBeTruthy();
    });
  });

  it('expand buttons have aria-expanded and aria-controls', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    const expandBtns = screen.getAllByLabelText('Expand FIFO lots');
    expect(expandBtns[0].getAttribute('aria-expanded')).toBe('false');
    expect(expandBtns[0].getAttribute('aria-controls')).toMatch(/^fifo-lots-/);
  });

  it('expanded region has role="region"', async () => {
    mockFetchSuccess(FIXTURE_POPULATED);
    render(<AccountPositions accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });

    const expandBtns = screen.getAllByLabelText('Expand FIFO lots');
    await act(async () => {
      fireEvent.click(expandBtns[0]);
    });

    const regions = document.querySelectorAll('[role="region"]');
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions[0].getAttribute('aria-label')).toBe('Open FIFO lots');
  });
});
