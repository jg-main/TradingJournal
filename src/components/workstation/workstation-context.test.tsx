/**
 * Tests for WorkstationProvider controlled account mode (M007 S02/D037).
 *
 * Controlled mode: the global AccountProvider owns accounts + selection;
 * the workstation consumes them via props, skips its own accounts
 * bootstrap fetch, and routes selection changes to onAccountIdChange.
 * Uncontrolled mode (isolated /workspace) must be unchanged.
 *
 * Run: npx vitest run src/components/workstation/workstation-context.test.tsx
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

// ── Mock the live adapter before importing the provider ─────────────

const fetchAccountsLive = vi.fn();
const fetchAllLiveDashboardData = vi.fn();
const fetchCurrentLiveDashboardData = vi.fn();
const fetchDashboardLive = vi.fn();
const fetchSetupLookupsLive = vi.fn();
const refreshMtmPricesLive = vi.fn();
const fetchMtmRefreshIntervalLive = vi.fn();
const fetchWatchlistPricesLive = vi.fn();

vi.mock('@/lib/workstation-live-adapter', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/workstation-live-adapter')>();
  return {
    ...original,
    fetchAccountsLive: (...args: unknown[]) => fetchAccountsLive(...args),
    fetchAllLiveDashboardData: (...args: unknown[]) =>
      fetchAllLiveDashboardData(...args),
    fetchCurrentLiveDashboardData: (...args: unknown[]) =>
      fetchCurrentLiveDashboardData(...args),
    fetchDashboardLive: (...args: unknown[]) => fetchDashboardLive(...args),
    fetchSetupLookupsLive: (...args: unknown[]) =>
      fetchSetupLookupsLive(...args),
    refreshMtmPricesLive: (...args: unknown[]) =>
      refreshMtmPricesLive(...args),
    fetchMtmRefreshIntervalLive: (...args: unknown[]) =>
      fetchMtmRefreshIntervalLive(...args),
    fetchWatchlistPricesLive: (...args: unknown[]) =>
      fetchWatchlistPricesLive(...args),
  };
});

import { WorkstationProvider, useWorkstation } from './workstation-context';

// ── Live snapshot fixture ───────────────────────────────────────────
// A realistic-enough LiveDashboardData for the provider's internal
// recomposition (adaptRisk + liveDataToFixtures). The dashboard carries a
// `tag` marker so tests can assert which period's V1 payload is rendered.

function makeLiveData(
  overrides: Record<string, unknown> = {},
  dashboardTag = 'P1',
) {
  const { dashboardV2, ...rest } = overrides as {
    dashboardV2?: Record<string, unknown>;
  };
  return {
    success: true as const,
    data: {
      accounts: controlledAccounts,
      positions: [] as unknown[],
      watchlist: [] as never[],
      dashboard: {
        kpis: { netPnl: 0, totalTrades: 0, currentDrawdown: null, currentDrawdownPct: null },
        setupRanking: [],
        ...(dashboardTag ? ({ tag: dashboardTag } as unknown as Record<string, unknown>) : {}),
      } as unknown as import('@/lib/workstation-fixtures').DashboardResponse,
      dashboardV2: {
        account: { id: 'acc-1', name: 'Main', currency: 'USD' },
        metrics: { realizedFees: '0.00', markedPositions: '0.00' },
        riskSummary: {
          openPnl: '0.00',
          openRisk: '0.00',
          portfolioHeat: '0.00',
          missingStops: 0,
          positionsWithStop: 0,
        },
        valuation: { positions: [] },
        ...(dashboardV2 ?? {}),
      } as unknown as import('@/lib/accounting/dashboard-v2').DashboardV2Response,
      risk: {
        ptd: { realizedPnl: '0.00', realizedFees: '0.00', drawdown: null, drawdownPct: null },
        current: {
          openPnl: '0.00',
          openRisk: '0.00',
          portfolioHeat: '0.00',
          missingStops: 0,
          positionsWithStop: 0,
          exposure: '0.00',
        },
      },
      ...rest,
    },
  };
}

function makeCurrentData(
  positions: unknown[] = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    success: true as const,
    data: {
      accounts: controlledAccounts,
      positions,
      watchlist: [] as never[],
      dashboardV2: {
        account: { id: 'acc-1', name: 'Main', currency: 'USD' },
        metrics: { realizedFees: '0.00', markedPositions: '0.00' },
        riskSummary: {
          openPnl: '0.00',
          openRisk: '0.00',
          portfolioHeat: '0.00',
          missingStops: 0,
          positionsWithStop: 0,
        },
        valuation: { positions },
      } as unknown as import('@/lib/accounting/dashboard-v2').DashboardV2Response,
      ...overrides,
    },
  };
}

/** A Dashboard V1 response carrying enough kpis for adaptRisk plus a `tag`
 *  marker so tests can assert which period's payload is rendered. */
function makeDashboardResult(tag: string, netPnl = 0, extra: Record<string, unknown> = {}) {
  return {
    success: true as const,
    data: {
      kpis: { netPnl, totalTrades: 0, currentDrawdown: null, currentDrawdownPct: null },
      setupRanking: [],
      tag,
      ...extra,
    } as never,
  };
}

// ── Probe ───────────────────────────────────────────────────────────

function Probe() {
  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    accountSelectionExternal,
    error,
    isLoading,
    mtmPollingState,
    refreshLiveData,
    fixtures,
    resolvedPeriod,
    periodHydrated,
  } = useWorkstation();
  const dashboardTag = (fixtures.dashboard as unknown as { tag?: string }).tag ?? '';
  return (
    <div>
      <span data-testid="external">{String(accountSelectionExternal)}</span>
      <span data-testid="active">{activeAccountId}</span>
      <span data-testid="accounts">{accounts.map((a) => a.id).join(',')}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="mtm-state">{mtmPollingState}</span>
      <span data-testid="watchlist">
        {fixtures.watchlist.map((w) => w.symbol).join(',')}
      </span>
      <span data-testid="symbol-prices">
        {Object.keys(fixtures.symbolPrices).join(',')}
      </span>
      <span data-testid="dashboard-tag">{dashboardTag}</span>
      <span data-testid="risk">{JSON.stringify(fixtures.risk)}</span>
      <span data-testid="trade-ideas">
        {fixtures.tradeIdeas.map((t) => `${t.symbol}:${t.setupName ?? 'null'}`).join(';')}
      </span>
      <span data-testid="period">{`${resolvedPeriod.from}|${resolvedPeriod.to}`}</span>
      <span data-testid="period-hydrated">{String(periodHydrated)}</span>
      <button data-testid="switch" onClick={() => setActiveAccountId('acc-2')} />
      <button data-testid="refresh" onClick={() => refreshLiveData()} />
    </div>
  );
}

const controlledAccounts = [
  { id: 'acc-1', name: 'Main', currency: 'USD' },
  { id: 'acc-2', name: 'Taxable', currency: 'USD' },
];

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('WorkstationProvider account control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAllLiveDashboardData.mockResolvedValue(makeLiveData());
    fetchCurrentLiveDashboardData.mockResolvedValue(makeCurrentData());
    fetchDashboardLive.mockResolvedValue(makeDashboardResult('P1'));
    fetchSetupLookupsLive.mockResolvedValue({ success: true, data: {} });
    refreshMtmPricesLive.mockResolvedValue({
      success: true,
      data: { updated: 1, failed: [], timestamp: '2026-08-13T15:00:00.000Z' },
    });
    fetchMtmRefreshIntervalLive.mockResolvedValue({ success: true, data: 45 });
    fetchWatchlistPricesLive.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('controlled mode uses provided accounts and selection, skips bootstrap fetch', async () => {
    const onAccountIdChange = vi.fn();
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={onAccountIdChange}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    expect(screen.getByTestId('external').textContent).toBe('true');
    expect(screen.getByTestId('active').textContent).toBe('acc-1');
    expect(screen.getByTestId('accounts').textContent).toBe('acc-1,acc-2');
    // Bootstrap accounts fetch must NOT fire — the provider owns accounts.
    expect(fetchAccountsLive).not.toHaveBeenCalled();
  });

  it('controlled mode routes selection changes to onAccountIdChange', async () => {
    const onAccountIdChange = vi.fn();
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={onAccountIdChange}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    act(() => {
      screen.getByTestId('switch').click();
    });

    expect(onAccountIdChange).toHaveBeenCalledWith('acc-2');
  });

  it('controlled mode falls back to first account for an unknown id', async () => {
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-unknown"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    expect(screen.getByTestId('active').textContent).toBe('acc-1');
  });

  it('uncontrolled mode keeps internal state and flags selection as local', async () => {
    // Fixture mode (no liveMode) — the isolated /workspace path.
    render(
      <WorkstationProvider>
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    expect(screen.getByTestId('external').textContent).toBe('false');
    // Fixture account from the default scenario.
    expect(screen.getByTestId('active').textContent).not.toBe('');

    act(() => {
      screen.getByTestId('switch').click();
    });
    // Internal fallback: 'acc-2' is not a fixture account, so it falls
    // back to the fixture account id — but crucially no crash and no
    // external callback involvement.
    expect(screen.getByTestId('external').textContent).toBe('false');
  });

  it('refreshes marks before reloading current data for open positions', async () => {
    fetchAllLiveDashboardData.mockResolvedValue(
      makeLiveData({ positions: [{}], dashboardV2: { valuation: { positions: [{}] } } }),
    );
    fetchCurrentLiveDashboardData.mockResolvedValue(
      makeCurrentData([{}]),
    );

    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();
    await flush();

    expect(refreshMtmPricesLive).toHaveBeenCalled();
    // The MTM reload is CURRENT-only (9D.2 §10): it uses the current
    // acquisition boundary, never the full-bundle compatibility fetch.
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
    expect(fetchCurrentLiveDashboardData).toHaveBeenCalled();
    expect(refreshMtmPricesLive.mock.invocationCallOrder[0]).toBeLessThan(
      fetchCurrentLiveDashboardData.mock.invocationCallOrder[0],
    );
  });

  it('keeps live state when another visible surface already refreshed marks', async () => {
    fetchAllLiveDashboardData.mockResolvedValue(
      makeLiveData({ positions: [{}], dashboardV2: { valuation: { positions: [{}] } } }),
    );
    fetchCurrentLiveDashboardData.mockResolvedValue(makeCurrentData([{}]));
    refreshMtmPricesLive.mockResolvedValue({
      success: false,
      error: 'Rate limited',
      status: 429,
    });

    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();
    await flush();

    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('error').textContent).toBe('');
    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
  });

  it('refreshLiveData re-fetches dashboard data and refreshes watchlist + symbolPrices', async () => {
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    // Initial load: empty watchlist, no prices.
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('watchlist').textContent).toBe('');
    expect(screen.getByTestId('symbol-prices').textContent).toBe('');

    // The next refresh returns a watchlist row + a quote for its symbol.
    fetchAllLiveDashboardData.mockResolvedValueOnce(
      makeLiveData({
        positions: [],
        watchlist: [
          {
            id: 'wl-1',
            dateAdded: '2026-08-13T00:00:00.000Z',
            symbol: 'AAPL',
            sectorId: null,
            name: 'Apple Inc.',
            sector: null,
            industry: null,
            setupId: null,
            direction: 'long',
            thesis: null,
            marketContext: null,
            keyLevel: null,
            triggerPrice: 200,
            plannedStop: null,
            targetPrice: null,
            status: 'watching',
            notes: null,
            promotedTradeId: null,
            alertConfig: null,
            createdAt: '2026-08-13T00:00:00.000Z',
            updatedAt: '2026-08-13T00:00:00.000Z',
          },
        ],
      }),
    );
    fetchWatchlistPricesLive.mockResolvedValueOnce({
      success: true,
      data: {
        AAPL: {
          symbol: 'AAPL',
          price: 205,
          marketState: 'REGULAR',
          fetchedAt: '2026-08-13T15:01:00.000Z',
          source: 'mock',
          previousClose: 202,
          change: 3,
          changePercent: 1.485,
        },
      },
    });

    act(() => {
      screen.getByTestId('refresh').click();
    });
    await flush();
    await flush();

    // Refresh re-fetched without changing selection or the account list.
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('active').textContent).toBe('acc-1');
    expect(screen.getByTestId('accounts').textContent).toBe('acc-1,acc-2');
    // Watchlist row and its derived price data are visible in fixtures.
    expect(screen.getByTestId('watchlist').textContent).toBe('AAPL');
    expect(screen.getByTestId('symbol-prices').textContent).toBe('AAPL');
  });

  it('refreshLiveData failure surfaces the error and keeps prior data', async () => {
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    fetchAllLiveDashboardData.mockResolvedValueOnce({
      success: false,
      error: 'Dashboard API unavailable',
      status: 503,
    });

    act(() => {
      screen.getByTestId('refresh').click();
    });
    await flush();

    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('error').textContent).toBe(
      'Dashboard API unavailable',
    );
    // Prior data is retained (stale-while-revalidate), and the account is
    // untouched.
    expect(screen.getByTestId('watchlist').textContent).toBe('');
    expect(screen.getByTestId('active').textContent).toBe('acc-1');
  });

  it('refreshLiveData toggles isLoading across the refresh window and clears a prior error', async () => {
    // First load fails → error state, not loading.
    fetchAllLiveDashboardData.mockResolvedValueOnce({
      success: false,
      error: 'Boom',
      status: 500,
    });

    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    expect(screen.getByTestId('error').textContent).toBe('Boom');
    expect(screen.getByTestId('loading').textContent).toBe('false');

    // Manual refresh with the fetch kept pending so the in-flight window
    // is observable: loading is entered synchronously with the refresh
    // call and the prior error clears at the same time (T05 preserves
    // this loading/error timing while moving the transition off the
    // effect tick for react-hooks/set-state-in-effect).
    let resolveFetch!: (v: unknown) => void;
    fetchAllLiveDashboardData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    act(() => {
      screen.getByTestId('refresh').click();
    });

    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('error').textContent).toBe('');

    await act(async () => {
      resolveFetch(makeLiveData());
    });
    await flush();

    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('refreshLiveData is a safe no-op in fixture mode', async () => {
    render(
      <WorkstationProvider>
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    const callsBefore = fetchAllLiveDashboardData.mock.calls.length;

    act(() => {
      screen.getByTestId('refresh').click();
    });
    await flush();

    // No live fetch fires, nothing crashes, selection stays local.
    expect(fetchAllLiveDashboardData.mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId('external').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('');
  });
});

// ── MTM polling eligibility lifecycle ───────────────────────────────────────
// The polling lifecycle must depend on BOOLEAN "has open positions" (zero vs
// nonzero), not the exact position count: a user switching accounts with
// 2 positions -> 1 position must not tear down/restart polling (which would
// abort the in-flight refresh/reload). Only eligibility flips, account
// changes, and other real lifecycle changes re-run the polling effect.

function liveDataWithPositions(count: number) {
  const positions = Array.from({ length: count }, (_, i) => ({ symbol: `P${i}` }));
  return makeLiveData({
    positions,
    dashboardV2: {
      account: { id: 'acc-1', name: 'Main', currency: 'USD' },
      metrics: { realizedFees: '0.00', markedPositions: '0.00' },
      riskSummary: {
        openPnl: '0.00',
        openRisk: '0.00',
        portfolioHeat: '0.00',
        missingStops: 0,
        positionsWithStop: 0,
      },
      valuation: { positions },
    },
  });
}

/** Render the provider in live controlled mode and settle the initial fetch + tick. */
async function renderLiveProvider() {
  const view = render(
    <WorkstationProvider
      liveMode
      accounts={controlledAccounts}
      accountId="acc-1"
      onAccountIdChange={vi.fn()}
    >
      <Probe />
    </WorkstationProvider>,
  );
  await flush();
  await flush();
  return view;
}

describe('MTM polling eligibility lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchAllLiveDashboardData.mockResolvedValue(makeLiveData());
    fetchCurrentLiveDashboardData.mockResolvedValue(makeCurrentData());
    fetchDashboardLive.mockResolvedValue(makeDashboardResult('P1'));
    fetchSetupLookupsLive.mockResolvedValue({ success: true, data: {} });
    refreshMtmPricesLive.mockResolvedValue({
      success: true,
      data: { updated: 1, failed: [], timestamp: '2026-08-13T15:00:00.000Z' },
    });
    fetchMtmRefreshIntervalLive.mockResolvedValue({ success: true, data: 45 });
    fetchWatchlistPricesLive.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(async () => {
    await act(async () => {
      cleanup();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('does not restart polling or abort in-flight MTM work when the nonzero position count changes (2 -> 1)', async () => {
    let fetchCall = 0;
    fetchAllLiveDashboardData.mockImplementation(async () => {
      fetchCall += 1;
      return liveDataWithPositions(fetchCall <= 2 ? 2 : 1);
    });
    // MTM reloads are CURRENT-only; keep the merged snapshot nonzero so the
    // eligibility boolean (zero vs nonzero) is what the test changes.
    fetchCurrentLiveDashboardData.mockImplementation(async () =>
      makeCurrentData([{ symbol: 'CUR' }]),
    );

    await renderLiveProvider();

    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
    const refreshCalls = refreshMtmPricesLive.mock.calls.length;
    expect(refreshCalls).toBeGreaterThan(0);
    const firstSignal = refreshMtmPricesLive.mock.calls[0][0] as AbortSignal;

    // Switch positions 2 -> 1 via a manual refresh: eligibility stays nonzero.
    act(() => {
      screen.getByTestId('refresh').click();
    });
    await flush();
    await flush();

    // No new MTM tick fired and the existing MTM request was not torn down.
    expect(refreshMtmPricesLive.mock.calls.length).toBe(refreshCalls);
    expect(firstSignal.aborted).toBe(false);
    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
  });

  it('does not restart polling when the nonzero position count changes (1 -> 3)', async () => {
    let fetchCall = 0;
    fetchAllLiveDashboardData.mockImplementation(async () => {
      fetchCall += 1;
      return liveDataWithPositions(fetchCall <= 2 ? 1 : 3);
    });
    fetchCurrentLiveDashboardData.mockImplementation(async () =>
      makeCurrentData([{ symbol: 'CUR' }]),
    );

    await renderLiveProvider();

    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
    const refreshCalls = refreshMtmPricesLive.mock.calls.length;

    act(() => {
      screen.getByTestId('refresh').click();
    });
    await flush();
    await flush();

    expect(refreshMtmPricesLive.mock.calls.length).toBe(refreshCalls);
    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
  });

  it('starts polling when eligibility flips zero -> nonzero (0 -> 1)', async () => {
    let fetchCall = 0;
    fetchAllLiveDashboardData.mockImplementation(async () => {
      fetchCall += 1;
      return liveDataWithPositions(fetchCall <= 1 ? 0 : 1);
    });
    fetchCurrentLiveDashboardData.mockImplementation(async () =>
      makeCurrentData([{ symbol: 'CUR' }]),
    );
    await renderLiveProvider();

    expect(screen.getByTestId('mtm-state').textContent).toBe('paused');
    expect(refreshMtmPricesLive).not.toHaveBeenCalled();

    act(() => {
      screen.getByTestId('refresh').click();
    });
    await flush();
    await flush();

    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
    expect(refreshMtmPricesLive).toHaveBeenCalled();
  });

  it('stops polling with legitimate cleanup when eligibility flips nonzero -> zero (1 -> 0)', async () => {
    let fetchCall = 0;
    fetchAllLiveDashboardData.mockImplementation(async () => {
      fetchCall += 1;
      return liveDataWithPositions(fetchCall <= 1 ? 1 : 0);
    });
    const resolvers: Array<(v: unknown) => void> = [];
    refreshMtmPricesLive.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    await renderLiveProvider();

    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
    const firstSignal = refreshMtmPricesLive.mock.calls[0][0] as AbortSignal;
    const refreshCalls = refreshMtmPricesLive.mock.calls.length;

    act(() => {
      screen.getByTestId('refresh').click();
    });
    await flush();
    await flush();

    // Polling stopped and the in-flight MTM request was legitimately aborted.
    expect(screen.getByTestId('mtm-state').textContent).toBe('paused');
    expect(firstSignal.aborted).toBe(true);
    expect(refreshMtmPricesLive.mock.calls.length).toBe(refreshCalls);

    await act(async () => {
      for (const resolve of resolvers) {
        resolve({ success: true, data: { updated: 1, failed: [], timestamp: 'x' } });
      }
    });
    await flush();
  });

  it('rebinds polling to the new account on account change (nonzero -> nonzero)', async () => {
    fetchAllLiveDashboardData.mockResolvedValue(liveDataWithPositions(2));
    fetchCurrentLiveDashboardData.mockImplementation(async () =>
      makeCurrentData([{ symbol: 'CUR' }]),
    );

    const view = await renderLiveProvider();

    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
    const refreshCalls = refreshMtmPricesLive.mock.calls.length;
    expect(refreshCalls).toBeGreaterThan(0);

    view.rerender(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-2"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();
    await flush();

    // The old account's polling lifecycle was replaced: a new MTM tick fired
    // for the new account (rebind) and the selection updated.
    expect(refreshMtmPricesLive.mock.calls.length).toBeGreaterThan(refreshCalls);
    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
    expect(screen.getByTestId('active').textContent).toBe('acc-2');
  });
});

// ── M004 9D.2 — global period drives period-sensitive V1 only ────────────
// The workstation consumes the canonical global period as CONTROLLED
// read-only input. A PERIOD-ONLY change must refetch ONLY the date-aware V1
// dashboard; CURRENT legs (V2/watchlist/accounts/prices/MTM) must not move.

describe('M004 9D.2 — global period drives period-sensitive V1 only', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchAllLiveDashboardData.mockResolvedValue(makeLiveData());
    fetchCurrentLiveDashboardData.mockResolvedValue(makeCurrentData());
    fetchDashboardLive.mockResolvedValue(makeDashboardResult('P1'));
    fetchSetupLookupsLive.mockResolvedValue({ success: true, data: {} });
    refreshMtmPricesLive.mockResolvedValue({
      success: true,
      data: { updated: 1, failed: [], timestamp: '2026-08-13T15:00:00.000Z' },
    });
    fetchMtmRefreshIntervalLive.mockResolvedValue({ success: true, data: 45 });
    fetchWatchlistPricesLive.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(async () => {
    await act(async () => {
      cleanup();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  function providerElement(
    props: {
      resolvedPeriod?: { from: string; to: string };
      periodHydrated?: boolean;
      accountId?: string;
    } = {},
  ) {
    const {
      resolvedPeriod = { from: '2026-05-01', to: '' },
      periodHydrated = true,
      accountId = 'acc-1',
    } = props;
    return (
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId={accountId}
        onAccountIdChange={vi.fn()}
        resolvedPeriod={resolvedPeriod}
        periodHydrated={periodHydrated}
        timezone="America/Bogota"
      >
        <Probe />
      </WorkstationProvider>
    );
  }

  function makeWatchlistItem(symbol: string, overrides: Record<string, unknown> = {}) {
    return {
      id: `wl-${symbol.toLowerCase()}`,
      dateAdded: '2026-01-01',
      symbol,
      sectorId: null,
      name: `${symbol} Corp`,
      sector: null,
      industry: null,
      setupId: null,
      direction: 'long',
      thesis: null,
      marketContext: null,
      keyLevel: null,
      triggerPrice: null,
      plannedStop: null,
      targetPrice: null,
      status: 'watching',
      notes: null,
      promotedTradeId: null,
      alertConfig: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('waits for period hydration before issuing the first V1 request', async () => {
    const view = render(providerElement({ periodHydrated: false }));
    await flush();
    expect(fetchAllLiveDashboardData).not.toHaveBeenCalled();

    view.rerender(providerElement({ periodHydrated: true }));
    await flush();
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
  });

  it('first hydrated request uses the resolved plain-YMD range', async () => {
    const view = render(providerElement({ periodHydrated: false }));
    await flush();
    view.rerender(providerElement({ periodHydrated: true }));
    await flush();

    const args = fetchAllLiveDashboardData.mock.calls[0] as unknown[];
    expect(args[3]).toEqual({ from: '2026-05-01', to: '' });
    expect(screen.getByTestId('period').textContent).toBe('2026-05-01|');
  });

  it('a period-only change calls the V1 dashboard fetch', async () => {
    fetchDashboardLive.mockResolvedValue(makeDashboardResult('P2'));
    const view = render(providerElement());
    await flush();
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dashboard-tag').textContent).toBe('P1');

    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();

    expect(fetchDashboardLive).toHaveBeenCalledTimes(1);
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dashboard-tag').textContent).toBe('P2');
  });

  it('a period-only change does NOT refetch the V2 dashboard', async () => {
    const view = render(providerElement());
    await flush();
    const allCalls = fetchAllLiveDashboardData.mock.calls.length;
    const currentCalls = fetchCurrentLiveDashboardData.mock.calls.length;

    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();

    expect(fetchAllLiveDashboardData.mock.calls.length).toBe(allCalls);
    expect(fetchCurrentLiveDashboardData.mock.calls.length).toBe(currentCalls);
  });

  it('a period-only change does NOT refetch the watchlist', async () => {
    const view = render(providerElement());
    await flush();

    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();

    // V2 + watchlist + accounts are only reachable through the composition
    // or CURRENT boundaries — neither may move on a period change.
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
    expect(fetchCurrentLiveDashboardData).not.toHaveBeenCalled();
  });

  it('a period-only change does NOT refetch accounts', async () => {
    const view = render(providerElement());
    await flush();

    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();

    expect(fetchAccountsLive).not.toHaveBeenCalled();
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
  });

  it('a period-only change does NOT refetch watchlist prices', async () => {
    const view = render(providerElement());
    await flush();
    // Initial load fetches prices once (index symbols); a period change must
    // not add a second price request.
    const priceCalls = fetchWatchlistPricesLive.mock.calls.length;
    expect(priceCalls).toBeGreaterThanOrEqual(1);

    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();

    expect(fetchWatchlistPricesLive.mock.calls.length).toBe(priceCalls);
  });

  it('a period-only change does NOT trigger the MTM refresh POST', async () => {
    const view = render(providerElement());
    await flush();

    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();

    expect(refreshMtmPricesLive).not.toHaveBeenCalled();
    expect(fetchCurrentLiveDashboardData).not.toHaveBeenCalled();
  });

  it('a newer period response wins over an older slower response', async () => {
    const view = render(providerElement());
    await flush();

    let resolveP2!: (v: unknown) => void;
    let resolveP3!: (v: unknown) => void;
    fetchDashboardLive
      .mockImplementationOnce(() => new Promise((r) => { resolveP2 = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveP3 = r; }));

    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();
    view.rerender(providerElement({ resolvedPeriod: { from: '2026-07-01', to: '' } }));
    await flush();

    // The newer (3M) request settles first and renders.
    await act(async () => {
      resolveP3(makeDashboardResult('P3'));
    });
    await flush();
    expect(screen.getByTestId('dashboard-tag').textContent).toBe('P3');

    // The older (2M) request settles later — it must be rejected.
    await act(async () => {
      resolveP2(makeDashboardResult('P2'));
    });
    await flush();
    expect(screen.getByTestId('dashboard-tag').textContent).toBe('P3');
  });

  it('an account change refreshes CURRENT + selected-period V1 with the resolved period', async () => {
    const view = render(providerElement());
    await flush();
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);

    view.rerender(providerElement({ accountId: 'acc-2' }));
    await flush();

    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(2);
    const lastCall = fetchAllLiveDashboardData.mock.calls[1] as unknown[];
    expect(lastCall[0]).toBe('acc-2');
    expect(lastCall[3]).toEqual({ from: '2026-05-01', to: '' });
  });

  it('a manual refresh always uses the current resolved period (never unbounded)', async () => {
    render(providerElement());
    await flush();

    act(() => {
      screen.getByTestId('refresh').click();
    });
    await flush();

    const lastCall = fetchAllLiveDashboardData.mock.calls.at(-1) as unknown[];
    expect(lastCall[3]).toEqual({ from: '2026-05-01', to: '' });
  });

  it('MTM reload uses CURRENT-only acquisition and preserves selected-period V1', async () => {
    fetchAllLiveDashboardData.mockResolvedValue(
      makeLiveData({ positions: [{}], dashboardV2: { valuation: { positions: [{}] } } }, 'P1'),
    );
    fetchCurrentLiveDashboardData.mockResolvedValue(makeCurrentData([{}]));

    render(providerElement());
    await flush();
    await flush();

    expect(fetchCurrentLiveDashboardData).toHaveBeenCalled();
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
    expect(fetchDashboardLive).not.toHaveBeenCalled();
    expect(screen.getByTestId('dashboard-tag').textContent).toBe('P1');
  });

  it('changing Period does not restart MTM polling or trigger a refresh', async () => {
    fetchAllLiveDashboardData.mockResolvedValue(
      makeLiveData({ positions: [{}], dashboardV2: { valuation: { positions: [{}] } } }, 'P1'),
    );
    fetchCurrentLiveDashboardData.mockResolvedValue(makeCurrentData([{}]));

    const view = render(providerElement());
    await flush();
    await flush();

    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
    const refreshCalls = refreshMtmPricesLive.mock.calls.length;
    const currentCalls = fetchCurrentLiveDashboardData.mock.calls.length;
    expect(refreshCalls).toBeGreaterThan(0);

    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();
    await flush();

    expect(refreshMtmPricesLive.mock.calls.length).toBe(refreshCalls);
    expect(fetchCurrentLiveDashboardData.mock.calls.length).toBe(currentCalls);
    expect(screen.getByTestId('mtm-state').textContent).toBe('active');
  });

  it('adaptRisk recomposition keeps PTD from the new V1 and current from the untouched V2', async () => {
    const view = render(providerElement());
    await flush();

    fetchDashboardLive.mockResolvedValue(makeDashboardResult('P2', 1234));
    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();

    const risk = JSON.parse(screen.getByTestId('risk').textContent as string) as {
      ptd: { realizedPnl: string };
      current: { openPnl: string };
    };
    expect(risk.ptd.realizedPnl).toBe('1234');
    expect(risk.current.openPnl).toBe('0.00');
  });

  it('period props are optional — an isolated provider stays unbounded and functional', async () => {
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    expect(screen.getByTestId('period').textContent).toBe('|');
    expect(screen.getByTestId('period-hydrated').textContent).toBe('true');
    expect(fetchAllLiveDashboardData).toHaveBeenCalledTimes(1);
    const args = fetchAllLiveDashboardData.mock.calls[0] as unknown[];
    expect(args[3]).toEqual({ from: '', to: '' });
  });

  it('current trade idea setup names never derive from period-scoped setupRanking', async () => {
    // Stable reference map resolves the name; the period-scoped V1
    // setupRanking carries a DIFFERENT name. Trade ideas must use the
    // reference map (M004 9D.2 §3/§17/§24).
    fetchSetupLookupsLive.mockResolvedValue({ success: true, data: { 'setup-1': 'ReferenceName' } });
    fetchAllLiveDashboardData.mockResolvedValue(
      makeLiveData({
        watchlist: [
          makeWatchlistItem('AAPL', {
            setupId: 'setup-1',
            triggerPrice: 100,
            plannedStop: 95,
            targetPrice: 120,
          }),
        ],
        dashboard: {
          setupRanking: [{ setupId: 'setup-1', setupName: 'PeriodName', count: 1, winRate: 0.5, avgR: 0.5, avgProcessScore: 50, sampleSizeWarning: 'adequate' }],
        } as never,
      }, 'P1'),
    );

    const view = render(providerElement());
    await flush();
    expect(screen.getByTestId('trade-ideas').textContent).toContain('AAPL:ReferenceName');

    // Change period → the retrospective V1 setupRanking renames the setup.
    // The CURRENT trade idea label must NOT follow it.
    fetchDashboardLive.mockResolvedValue(
      makeDashboardResult('P2', 0, {
        setupRanking: [{ setupId: 'setup-1', setupName: 'CompletelyDifferent', count: 1, winRate: 0.5, avgR: 0.5, avgProcessScore: 50, sampleSizeWarning: 'adequate' }],
      }),
    );
    view.rerender(providerElement({ resolvedPeriod: { from: '2026-06-01', to: '' } }));
    await flush();

    expect(screen.getByTestId('dashboard-tag').textContent).toBe('P2');
    expect(screen.getByTestId('trade-ideas').textContent).toContain('AAPL:ReferenceName');
    expect(screen.getByTestId('trade-ideas').textContent).not.toContain('PeriodName');
    expect(screen.getByTestId('trade-ideas').textContent).not.toContain('CompletelyDifferent');
  });
});
