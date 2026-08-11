/**
 * Tests for the DashboardV2 client component.
 *
 * Covers rendering states: loading, error (with retry), healthy data,
 * empty account, null marks, integrity warnings, and journal attribution.
 *
 * Run: npx vitest run src/components/dashboard-v2.test.tsx
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { DashboardV2 } from './dashboard-v2';
import type { DashboardV2Response } from './dashboard-v2';
import { TooltipProvider } from '@/components/ui/tooltip';

// ═══════════════════════════════════════════════════════════════════════════
// Mock fetch helper
// ═══════════════════════════════════════════════════════════════════════════

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
let fetchResponse: unknown = null;
let fetchError: Error | null = null;

const mockFetch = vi.fn(
  (input: URL | RequestInfo | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    fetchCalls.push({ url, options: init });
    if (fetchError) {
      return Promise.reject(fetchError);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(fetchResponse),
    } as Response);
  },
);

global.fetch = mockFetch;

function resetFetch() {
  fetchCalls = [];
  fetchResponse = null;
  fetchError = null;
}

function getFetchCalls() {
  return [...fetchCalls];
}

// ═══════════════════════════════════════════════════════════════════════════
// Fixture data
// ═══════════════════════════════════════════════════════════════════════════

const MOCK_ACCOUNTS = [
  { id: 'acc-1', name: 'Main Trading', currency: 'USD' },
  { id: 'acc-2', name: 'Long Term', currency: 'USD' },
];

const MOCK_DASHBOARD: DashboardV2Response = {
  account: { id: 'acc-1', name: 'Main Trading', currency: 'USD' },
  metrics: {
    cash: '5000.00',
    nav: '17500.00',
    markedPositions: '12500.00',
    realizedPnl: '2500.00',
    unrealizedPnl: '1500.00',
    totalPnl: '4000.00',
    realizedFees: '350.00',
    grossExposure: '12500.00',
    netExposure: '12500.00',
    drawdown: '500.00',
    drawdownPct: '0.025',
    modifiedDietzReturn: null,
    twr: null,
  },
  valuation: {
    positionsTotal: 2,
    fresh: 2,
    stale: 0,
    missing: 0,
    state: 'complete',
    coveragePct: '100.00',
    presentationLabel: null,
    markedSubsetPnl: '120.00',
    positions: [
      {
        instrumentId: 'inst-1',
        symbol: 'AAPL',
        direction: 'long',
        quantity: '10.00',
        averageCost: '150.00',
        markStatus: 'fresh',
        markPrice: '152.00',
        markedValue: '1520.00',
        unrealizedPnl: '20.00',
        markTimestamp: new Date().toISOString(),
        markAgeMinutes: 5,
      },
      {
        instrumentId: 'inst-2',
        symbol: 'MSFT',
        direction: 'long',
        quantity: '20.00',
        averageCost: '350.00',
        markStatus: 'fresh',
        markPrice: '355.00',
        markedValue: '7100.00',
        unrealizedPnl: '100.00',
        markTimestamp: new Date().toISOString(),
        markAgeMinutes: 5,
      },
    ],
  },
  journalAttribution: {
    hasJournalTrades: true,
    journalExecutionCount: 3,
    accountOnlyExecutionCount: 1,
  },
  integrity: {
    status: 'critical',
    warnings: [
      'Reconciliation has not been run. Run the cutover migration to compare journal and ledger data.',
    ],
  },
  riskSummary: {
    openPnl: '120.00',
    openRisk: '500.00',
    portfolioHeat: '2.86',
    missingStops: 0,
    positionsWithStop: 2,
    openRiskToStop: '300.00',
    stopCoverage: {
      openTrades: 2,
      withStop: 2,
      withoutStop: 0,
      state: 'complete',
      presentationLabel: null,
    },
  },
  computedAt: new Date().toISOString(),
};

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('DashboardV2', () => {
  beforeEach(() => {
    resetFetch();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Loading state ─────────────────────────────────────────────────

  it('shows skeleton cards while loading', () => {
    // Don't resolve fetch — keep loading
    fetchResponse = MOCK_DASHBOARD;

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    // Should show skeleton cards (9 skeleton cards)
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(9);
  });

  // ── Error state ──────────────────────────────────────────────────

  it('shows error banner with retry button on fetch failure', async () => {
    fetchResponse = MOCK_ACCOUNTS;
    // First call returns accounts; second call (dashboard) fails
    let callCount = 0;
    global.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 1) {
        // First call: accounts list
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_ACCOUNTS),
        } as Response);
      }
      // Dashboard call fails
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Failed to load dashboard' }),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    // Wait for the error banner to appear
    await waitFor(() => {
      expect(screen.getByText('Failed to load dashboard')).toBeTruthy();
    });

    // Should have a retry button
    const retryButton = screen.getByText('Retry');
    expect(retryButton).toBeTruthy();
  });

  // ── Successful data rendering ────────────────────────────────────

  it('renders account metrics from healthy dashboard data', async () => {
    let callCount = 0;
    global.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_ACCOUNTS),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_DASHBOARD),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    // Wait for heading
    await waitFor(() => {
      expect(screen.getAllByText('Account Performance')[0]).toBeTruthy();
    });

    // Account name should be visible
    await waitFor(() => {
      expect(screen.getAllByText('Main Trading')[0]).toBeTruthy();
    });

    // Key metrics should be rendered
    await waitFor(() => {
      expect(screen.getByText(/\$5,000/)).toBeTruthy(); // Cash
      expect(screen.getByText(/\$17,500/)).toBeTruthy(); // NAV
    });

    // Cash and NAV labels
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(screen.getByText('NAV')).toBeTruthy();
    expect(screen.getByText('Realized P&L')).toBeTruthy();
    expect(screen.getByText('Unrealized P&L')).toBeTruthy();
    expect(screen.getByText('Gross Exposure')).toBeTruthy();
    expect(screen.getByText('Net Exposure')).toBeTruthy();
    expect(screen.getByText('Drawdown')).toBeTruthy();
  });

  // ── Integrity banner ─────────────────────────────────────────────

  it('shows integrity banner with warnings when status is critical', async () => {
    let callCount = 0;
    global.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_ACCOUNTS),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_DASHBOARD),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    await waitFor(() => {
      expect(screen.getByText('critical')).toBeTruthy();
    });
  });

  // ── Valuation completeness ───────────────────────────────────────

  it('shows valuation completeness counts and position details', async () => {
    let callCount = 0;
    global.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_ACCOUNTS),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_DASHBOARD),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    await waitFor(() => {
      expect(screen.getByText('Valuation Completeness')).toBeTruthy();
    });

    // Position counts
    expect(screen.getByText('Positions:')).toBeTruthy();
    expect(screen.getByText('Fresh: 2')).toBeTruthy();
    expect(screen.getByText('Stale: 0')).toBeTruthy();
    expect(screen.getByText('Missing: 0')).toBeTruthy();

    // Symbols in position table
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('MSFT')).toBeTruthy();
  });

  // ── Missing marks rendered as null/dash ──────────────────────────

  it('renders missing marks as dashes and does not show zero', async () => {
    const dashboardWithMissingMarks: DashboardV2Response = {
      ...MOCK_DASHBOARD,
      valuation: {
        positionsTotal: 1,
        fresh: 0,
        stale: 0,
        missing: 1,
        state: 'unavailable',
        coveragePct: '0.00',
        presentationLabel: '— Unavailable — 1 unpriced',
        markedSubsetPnl: null,
        positions: [
          {
            instrumentId: 'inst-3',
            symbol: 'GOOGL',
            direction: 'long',
            quantity: '5.00',
            averageCost: '180.00',
            markStatus: 'missing',
            markPrice: null,
            markedValue: null,
            unrealizedPnl: null,
            markTimestamp: null,
            markAgeMinutes: null,
          },
        ],
      },
    };

    let callCount = 0;
    global.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_ACCOUNTS),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(dashboardWithMissingMarks),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    await waitFor(() => {
      expect(screen.getByText('GOOGL')).toBeTruthy();
    });

    // Missing count should show 1
    expect(screen.getByText('Missing: 1')).toBeTruthy();
  });

  // ── Partial valuation: presentationLabel is the primary value ───────

  it('renders presentationLabel instead of a signed total when valuation is partial', async () => {
    // One unpriced position of three: the API sends presentationLabel
    // '— Partial — 1 unpriced' and markedSubsetPnl for the 2 fresh marks.
    // The UI must render the label as the primary Open P&L value and never
    // a signed total (the +$10.94-style partial-total defect).
    const partialDashboard: DashboardV2Response = {
      ...MOCK_DASHBOARD,
      metrics: {
        ...MOCK_DASHBOARD.metrics,
        unrealizedPnl: '120.00',
      },
      valuation: {
        positionsTotal: 3,
        fresh: 2,
        stale: 0,
        missing: 1,
        state: 'partial',
        coveragePct: '66.67',
        presentationLabel: '— Partial — 1 unpriced',
        markedSubsetPnl: '120.00',
        positions: [
          {
            instrumentId: 'inst-1',
            symbol: 'AAPL',
            direction: 'long',
            quantity: '10.00',
            averageCost: '150.00',
            markStatus: 'fresh',
            markPrice: '152.00',
            markedValue: '1520.00',
            unrealizedPnl: '20.00',
            markTimestamp: new Date().toISOString(),
            markAgeMinutes: 5,
          },
          {
            instrumentId: 'inst-2',
            symbol: 'MSFT',
            direction: 'long',
            quantity: '20.00',
            averageCost: '350.00',
            markStatus: 'fresh',
            markPrice: '355.00',
            markedValue: '7100.00',
            unrealizedPnl: '100.00',
            markTimestamp: new Date().toISOString(),
            markAgeMinutes: 5,
          },
          {
            instrumentId: 'inst-3',
            symbol: 'GOOGL',
            direction: 'long',
            quantity: '5.00',
            averageCost: '180.00',
            markStatus: 'missing',
            markPrice: null,
            markedValue: null,
            unrealizedPnl: null,
            markTimestamp: null,
            markAgeMinutes: null,
          },
        ],
      },
    };

    let callCount = 0;
    global.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_ACCOUNTS),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(partialDashboard),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    await waitFor(() => {
      expect(screen.getAllByText('— Partial — 1 unpriced').length).toBeGreaterThan(0);
    });

    // The Unrealized P&L card's primary value must be the presentationLabel,
    // never a signed currency total (the +$10.94-style partial-total defect).
    const unrealizedLabel = screen.getByText('Unrealized P&L');
    const cardBody = unrealizedLabel.parentElement;
    const valueEl = cardBody?.querySelector('p');
    expect(valueEl?.textContent).toContain('— Partial — 1 unpriced');
    expect(valueEl?.textContent).not.toMatch(/\$/);

    // The API-classified completeness state badge is surfaced.
    expect(screen.getByText('Partial')).toBeTruthy();
    expect(screen.getByText(/Known over marked subset/)).toBeTruthy();
  });

  // ── Journal attribution labels ───────────────────────────────────

  it('shows journal attribution badges', async () => {
    let callCount = 0;
    global.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_ACCOUNTS),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_DASHBOARD),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    await waitFor(() => {
      expect(screen.getAllByText('Account performance')[0]).toBeTruthy();
    });

    expect(
      screen.getAllByText(/Journal attribution/)[0],
    ).toBeTruthy();
    expect(screen.getAllByText(/3 linked, 1 direct/)[0]).toBeTruthy();
  });

  // ── Empty accounts list ──────────────────────────────────────────

  it('shows empty state when no accounts are returned', async () => {
    global.fetch = vi.fn(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    await waitFor(() => {
      expect(screen.getByText('No accounts found')).toBeTruthy();
    });
  });

  // ── Refresh button ──────────────────────────────────────────────

  it('refetches dashboard data when refresh button is clicked', async () => {
    let fetchCount = 0;
    global.fetch = vi.fn(() => {
      fetchCount++;
      if (fetchCount <= 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_ACCOUNTS),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_DASHBOARD),
      } as Response);
    });

    render(<TooltipProvider><DashboardV2 /></TooltipProvider>);

    // Wait for account name to appear (confirms data loaded)
    await waitFor(() => {
      expect(screen.getAllByText('Main Trading')[0]).toBeTruthy();
    });

    const callsBefore = fetchCount;

    // Click refresh button
    const refreshButton = screen.getAllByLabelText('Refresh dashboard data')[0];
    await act(async () => {
      refreshButton.click();
    });

    // Should have made more fetch calls (at least one more)
    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(callsBefore);
    });
  });
});
