/**
 * Tests for the tabbed Trades workspace panel (M017/S03 T02).
 *
 * TradesWorkspacePanel is the full-width Trades workspace that switches
 * between the current open workflow (Open positions tab) and the
 * historical closed workflow (Closed trades tab). Tab labels state their
 * real universe, and each tab's totals come from exactly one source so a
 * current account total can never be mixed with a period-filtered total
 * (DASHBOARD_DENSE_LAYOUT_REQUIREMENTS §Trades workspace):
 *
 *   Open tab   → DashboardV2Response['valuation']['positions'] via
 *                RiskPositionsTableContent (fixtures / live snapshot).
 *   Closed tab → GET /api/trades?status=closed&accountId=…&limit=50 with
 *                server-computed full-dataset totals.
 *
 * These tests pin:
 *   - the shell wrapper keeps ws-panel-positions with the Trades
 *     Workspace header
 *   - ws-trades-tab-open / ws-trades-tab-closed testids pin the tab
 *     labels, with per-universe counts (open = positions.length; closed =
 *     API total, absent until ready)
 *   - content rendering per tab (open table / closed table, one mounted
 *     at a time)
 *   - the closed-tab fetch contract (status=closed, accountId scope,
 *     limit=50)
 *   - loading / error + Retry / empty / ready state rendering
 *   - the no-mixing invariant: the Net P&L footer is the API's
 *     server-computed totals.netRealizedPnl labelled 'Net P&L · all
 *     closed trades' — never a client-side row sum and never an
 *     open/current total
 *   - request scoping: a stale ready state from a previous account is
 *     dropped synchronously when the account changes
 *
 * Run: npx vitest run src/components/workstation/trades-workspace-panel.test.tsx
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import type { DashboardPositionSummary } from '@/lib/accounting/dashboard-v2';
import {
  TradesWorkspacePanel,
  type ClosedTradesResponse,
} from './trades-workspace-panel';

// ── Mock workstation context ────────────────────────────────────────────
// The panel reads activeAccountId, the controlled resolved period, and the
// configured timezone; the mutable mockCtx lets a test switch accounts or
// periods mid-render to exercise request scoping.

type MockContextValue = {
  activeAccountId: string;
  resolvedPeriod: { from: string; to: string };
  timezone: string;
};

let mockCtx: MockContextValue;

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockCtx,
}));

// ── Fetch mock ──────────────────────────────────────────────────────────
// Response.json() is not available in jsdom (same approach as
// workstation-live-adapter.test.ts), so the fake Response implements
// json()/text() directly.

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 500 ? 'Internal Server Error' : 'Unknown',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this;
    },
  } as Response;
}

/** Manually-resolvable promise for controlling when a fetch settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Fixture factories ───────────────────────────────────────────────────

const COMPUTED_AT = '2026-07-17T20:15:00.000Z';
const AS_OF = '2026-07-17T19:58:00.000Z';

function position(
  overrides: Partial<DashboardPositionSummary> = {},
): DashboardPositionSummary {
  return {
    instrumentId: 'inst-xxxx',
    symbol: 'XXXX',
    direction: 'long',
    quantity: '100',
    averageCost: '100.00',
    markStatus: 'fresh',
    markPrice: '110.00',
    markedValue: '11000.00',
    unrealizedPnl: '1000.00',
    markTimestamp: AS_OF,
    markAgeMinutes: 5,
    attribution: { kind: 'journal', executionCount: 10, journalTradeCount: 1 },
    markProvenance: { source: 'market_data', asOf: AS_OF, computedAt: COMPUTED_AT, status: 'fresh' },
    risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '1500.00', openTrades: 1 },
    journalLinkedMetrics: null,
    ...overrides,
  };
}

const OPEN_POSITIONS: DashboardPositionSummary[] = [
  position({ instrumentId: 'inst-nvda', symbol: 'NVDA' }),
  position({ instrumentId: 'inst-amd', symbol: 'AMD', direction: 'short' }),
];

/**
 * Default closed-trades response. The row P&L sum (300 − 120.5 = 179.5)
 * deliberately differs from totals.netRealizedPnl (175.0) so the no-mixing
 * invariant is verifiable: the footer must render the server total, never
 * a client-side row sum.
 */
function closedTradesResponse(
  overrides: Partial<ClosedTradesResponse> = {},
): ClosedTradesResponse {
  return {
    data: [
      {
        id: 't-nvda',
        tradeCode: 'TC-1',
        symbol: 'NVDA',
        direction: 'long',
        setupName: 'Breakout',
        closedAt: '2026-07-10T20:00:00.000Z',
        realizedPnl: 300,
        returnPct: 0.021,
        metrics: {
          position: { closedAt: '2026-07-10T20:00:00.000Z', holdingPeriodDays: 4 },
          returnMetrics: { rMultiple: 1.5 },
        },
      },
      {
        id: 't-amd',
        tradeCode: null,
        symbol: 'AMD',
        direction: 'short',
        setupName: null,
        closedAt: '2026-07-08T18:30:00.000Z',
        realizedPnl: -120.5,
        returnPct: -0.008,
        metrics: {
          position: { closedAt: '2026-07-08T18:30:00.000Z', holdingPeriodDays: 2 },
          returnMetrics: { rMultiple: -0.6 },
        },
      },
    ],
    total: 2,
    page: 1,
    limit: 50,
    totals: {
      grossRealizedPnl: 179.5,
      netRealizedPnl: 175.0,
      totalFees: 4.5,
      grossUnrealizedPnl: null,
      netUnrealizedPnl: null,
      totalOpenRisk: 0,
      portfolioHeatAmount: 0,
      portfolioHeatPct: 0,
      unpricedOpenPositions: 0,
    },
    ...overrides,
  };
}

function renderPanel(
  positions: DashboardPositionSummary[] = OPEN_POSITIONS,
) {
  return render(<TradesWorkspacePanel positions={positions} />);
}

function openClosedTab() {
  // Radix TabsTrigger activates on mousedown (button 0), not click — see
  // node_modules/@radix-ui/react-tabs TabsTrigger onMouseDown handler.
  fireEvent.mouseDown(screen.getByTestId('ws-trades-tab-closed'));
}

beforeEach(() => {
  mockCtx = {
    activeAccountId: 'acc-1',
    resolvedPeriod: { from: '', to: '' },
    timezone: 'America/Bogota',
  };
  mockFetch.mockReset();
  // Re-install the fetch stub: the previous test's afterEach unstubbed it.
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Shell and tab labels ────────────────────────────────────────────────

describe('TradesWorkspacePanel shell and tab labels', () => {
  it('keeps the ws-panel-positions wrapper with the Trades Workspace header', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();

    const panel = screen.getByTestId('ws-panel-positions');
    expect(panel.getAttribute('aria-label')).toBe('Trades workspace');
    expect(panel.querySelector('.ws-panel-header')?.textContent).toContain(
      'Trades Workspace',
    );
  });

  it('pins both tab labels with their testids and per-universe counts', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse(200, closedTradesResponse({ total: 42 })),
    );
    renderPanel();

    const openTab = screen.getByTestId('ws-trades-tab-open');
    expect(openTab.textContent).toContain('Open positions');
    // Open count = the live snapshot universe (positions.length).
    expect(
      within(openTab).getByTestId('ws-trades-open-count').textContent,
    ).toBe(String(OPEN_POSITIONS.length));

    const closedTab = screen.getByTestId('ws-trades-tab-closed');
    expect(closedTab.textContent).toContain('Closed trades');

    // Closed count is the API total and stays hidden until ready.
    expect(within(closedTab).queryByTestId('ws-trades-closed-count')).toBeNull();

    await screen.findByTestId('ws-trades-closed-count');
    expect(
      within(closedTab).getByTestId('ws-trades-closed-count').textContent,
    ).toBe('42');
  });

  it('shows exactly one tab content active at a time, defaulting to Open', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();

    // Default tab: open content active, closed content present but hidden
    // (Radix keeps inactive content mounted with a hidden attribute).
    const openContent = screen.getByTestId('ws-trades-open-content');
    expect(openContent.getAttribute('data-state')).toBe('active');
    const closedContent = screen.getByTestId('ws-trades-closed-content');
    expect(closedContent.getAttribute('data-state')).toBe('inactive');
    expect(closedContent.hasAttribute('hidden')).toBe(true);

    // Switching to Closed activates the closed content and hides Open.
    openClosedTab();
    expect(closedContent.getAttribute('data-state')).toBe('active');
    expect(closedContent.hasAttribute('hidden')).toBe(false);
    expect(openContent.getAttribute('data-state')).toBe('inactive');
    await screen.findByTestId('ws-trades-closed-table');
  });
});

// ── Open tab (current universe) ─────────────────────────────────────────

describe('TradesWorkspacePanel open tab', () => {
  it('renders the canonical open positions table with preserved row testids', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();

    // The open tab reuses RiskPositionsTableContent: same testids, risk-first
    // rows, no re-implemented classification.
    const table = screen.getByTestId('ws-positions-table');
    expect(table).toBeTruthy();
    expect(screen.getByTestId('ws-position-row-NVDA')).toBeTruthy();
    expect(screen.getByTestId('ws-position-row-AMD')).toBeTruthy();
  });

  it('renders the open empty state with no table when there are no positions', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel([]);

    expect(screen.getByTestId('ws-positions-empty').textContent).toContain(
      'No open account positions',
    );
    expect(screen.queryByTestId('ws-positions-table')).toBeNull();
    expect(
      within(screen.getByTestId('ws-trades-tab-open')).getByTestId(
        'ws-trades-open-count',
      ).textContent,
    ).toBe('0');
  });
});

// ── Closed tab: fetch contract and states ───────────────────────────────

describe('TradesWorkspacePanel closed tab fetch contract', () => {
  it('fetches the active account closed trades with the scoped query', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/trades?');
    expect(url).toContain('status=closed');
    expect(url).toContain('accountId=acc-1');
    expect(url).toContain('limit=50');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('renders the loading state while the closed fetch is in flight', () => {
    const gate = deferred<Response>();
    mockFetch.mockReturnValueOnce(gate.promise);
    renderPanel();

    openClosedTab();
    const loading = screen.getByTestId('ws-trades-closed-loading');
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.textContent).toContain('Loading closed trades…');
  });

  it('renders the error state with Retry and recovers on retry', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(500, {}));
    renderPanel();
    openClosedTab();

    const error = await screen.findByTestId('ws-trades-closed-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain(
      'Closed trades unavailable: Trades API responded 500',
    );
    // A failed fetch never throws out of the panel.
    expect(screen.queryByTestId('ws-trades-closed-table')).toBeNull();

    // Retry refetches and recovers.
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    fireEvent.click(screen.getByTestId('ws-trades-closed-retry'));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    await screen.findByTestId('ws-trades-closed-table');
    expect(screen.queryByTestId('ws-trades-closed-error')).toBeNull();
  });

  it('renders the empty state when the API returns no closed trades', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse(200, closedTradesResponse({ data: [], total: 0 })),
    );
    renderPanel();
    openClosedTab();

    const empty = await screen.findByTestId('ws-trades-closed-empty');
    expect(empty.textContent).toContain('No closed trades for this account');
    expect(screen.queryByTestId('ws-trades-closed-table')).toBeNull();
    expect(screen.queryByTestId('ws-trades-closed-net-pnl')).toBeNull();
  });
});

// ── Closed tab: ready state, scope, and no-mixing invariant ─────────────

describe('TradesWorkspacePanel closed tab ready state', () => {
  it('renders the closed table rows with formatted cells', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();
    openClosedTab();

    await screen.findByTestId('ws-trades-closed-table');

    // Row testids use the trade symbol.
    const nvdaRow = screen.getByTestId('ws-trades-closed-row-NVDA');
    expect(nvdaRow.textContent).toContain('NVDA');
    expect(nvdaRow.textContent).toContain('L');
    expect(nvdaRow.textContent).toContain('Breakout');
    expect(
      within(nvdaRow).getByTestId('ws-trades-closed-cell-pnl').textContent,
    ).toBe('+$300.00');
    expect(nvdaRow.textContent).toContain('+2.10%');
    expect(nvdaRow.textContent).toContain('+1.50R');
    // Exit date renders M/D/YY (timezone-safe shape, never an em dash).
    const exitDate = nvdaRow.querySelectorAll('td')[3];
    expect(exitDate.textContent).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}$/);

    const amdRow = screen.getByTestId('ws-trades-closed-row-AMD');
    expect(
      within(amdRow).getByTestId('ws-trades-closed-cell-pnl').textContent,
    ).toBe('-$120.50');
    expect(amdRow.textContent).toContain('-0.80%');
    expect(amdRow.textContent).toContain('-0.60R');
  });

  it('states the visible universe in the scope line for a full page', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();
    openClosedTab();

    await screen.findByTestId('ws-trades-closed-scope');
    expect(screen.getByTestId('ws-trades-closed-scope').textContent).toBe(
      'All 2 closed trades',
    );
  });

  it('states the visible universe for a partial page (Latest X of N)', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse(200, closedTradesResponse({ total: 120 })),
    );
    renderPanel();
    openClosedTab();

    await screen.findByTestId('ws-trades-closed-scope');
    expect(screen.getByTestId('ws-trades-closed-scope').textContent).toBe(
      'Latest 2 of 120 closed trades',
    );
  });

  it('renders the Net P&L footer from the API total, never a row sum (no-mixing)', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();
    openClosedTab();

    await screen.findByTestId('ws-trades-closed-totals');

    const totals = screen.getByTestId('ws-trades-closed-totals');
    // The label states the exact universe of the figure.
    expect(totals.textContent).toContain('Net P&L · all closed trades');
    // Row P&L sum is 300 − 120.5 = 179.5; the API total is 175.0 — the
    // footer must show the server-computed total, not the client sum.
    expect(
      within(totals).getByTestId('ws-trades-closed-net-pnl').textContent,
    ).toBe('+$175.00');
    expect(totals.textContent).not.toContain('$179.50');
  });

  it('never mixes an open/current total into the closed tab', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();
    openClosedTab();

    await screen.findByTestId('ws-trades-closed-totals');

    // The closed tab is scoped to its own universe: no open-position
    // language, no current-account aggregate, anywhere in the panel.
    expect(screen.queryByText('Open account positions')).toBeNull();
    const closedContent = screen.getByTestId('ws-trades-closed-content');
    expect(closedContent.textContent).not.toContain('Open positions');
    // The only totals block in the closed tab is the labelled closed one.
    expect(
      within(closedContent).queryAllByTestId('ws-trades-closed-totals'),
    ).toHaveLength(1);
  });
});

// ── Request scoping: no cross-account leftovers ─────────────────────────

describe('TradesWorkspacePanel request scoping', () => {
  it('drops a stale ready state synchronously when the account changes', async () => {
    const first = deferred<Response>();
    mockFetch.mockReturnValueOnce(first.promise);
    const { rerender } = renderPanel();
    openClosedTab();

    // Account acc-1 resolves with its closed trades.
    first.resolve(fakeResponse(200, closedTradesResponse()));
    await screen.findByTestId('ws-trades-closed-table');
    expect(screen.getByTestId('ws-trades-closed-row-NVDA')).toBeTruthy();

    // Switch to acc-2 while its fetch is still in flight.
    const second = deferred<Response>();
    mockFetch.mockReturnValueOnce(second.promise);
    mockCtx = {
      activeAccountId: 'acc-2',
      resolvedPeriod: { from: '', to: '' },
      timezone: 'America/Bogota',
    };
    rerender(<TradesWorkspacePanel positions={OPEN_POSITIONS} />);

    // acc-1 data must not linger: the panel shows loading, not stale rows.
    expect(screen.queryByTestId('ws-trades-closed-table')).toBeNull();
    expect(screen.getByTestId('ws-trades-closed-loading')).toBeTruthy();

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain('accountId=acc-2');

    // acc-2 resolves and its rows render.
    second.resolve(
      fakeResponse(
        200,
        closedTradesResponse({ data: [{ id: 't-msft', tradeCode: null, symbol: 'MSFT', direction: 'long', setupName: null, closedAt: '2026-07-11T15:00:00.000Z', realizedPnl: 50, returnPct: 0.005, metrics: { position: { closedAt: '2026-07-11T15:00:00.000Z', holdingPeriodDays: 1 }, returnMetrics: { rMultiple: 0.25 } } }], total: 1 }),
      ),
    );
    await screen.findByTestId('ws-trades-closed-row-MSFT');
    expect(screen.queryByTestId('ws-trades-closed-row-NVDA')).toBeNull();
  });
});

// ── Closed tab: global selected period (M004 9D.2 §12/§13/§23) ──────────

describe('TradesWorkspacePanel closed tab global period', () => {
  it('adds no from/to for a Max (empty) period — legacy unbounded URL', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();
    openClosedTab();

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('/api/trades?status=closed&accountId=acc-1&limit=50');
    expect(url).not.toMatch(/[?&](from|to)=/);
  });

  it('serializes a bounded from using the timezone day-start instant', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    mockCtx = {
      activeAccountId: 'acc-1',
      resolvedPeriod: { from: '2026-06-01', to: '' },
      timezone: 'America/Bogota',
    };
    renderPanel();
    openClosedTab();

    const [url] = mockFetch.mock.calls[0] as [string];
    // Bogotá 2026-06-01 local midnight → 05:00Z.
    expect(url).toContain('from=2026-06-01T05%3A00%3A00.000Z');
    expect(url).not.toContain('to=');
  });

  it('serializes a bounded to using the timezone day-end instant', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    mockCtx = {
      activeAccountId: 'acc-1',
      resolvedPeriod: { from: '', to: '2026-06-30' },
      timezone: 'America/Bogota',
    };
    renderPanel();
    openClosedTab();

    const [url] = mockFetch.mock.calls[0] as [string];
    // Bogotá 2026-06-30 end of day → 2026-07-01T04:59:59.999Z.
    expect(url).toContain('to=2026-07-01T04%3A59%3A59.999Z');
    expect(url).not.toContain('from=');
  });

  it('builds the exact Custom both-bound URL', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    mockCtx = {
      activeAccountId: 'acc-1',
      resolvedPeriod: { from: '2026-06-01', to: '2026-06-30' },
      timezone: 'America/Bogota',
    };
    renderPanel();
    openClosedTab();

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(
      '/api/trades?status=closed&accountId=acc-1&limit=50' +
        '&from=2026-06-01T05%3A00%3A00.000Z&to=2026-07-01T04%3A59%3A59.999Z',
    );
  });

  it('honors the configured timezone for the ISO boundaries', () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    mockCtx = {
      activeAccountId: 'acc-1',
      resolvedPeriod: { from: '2026-06-01', to: '' },
      timezone: 'UTC',
    };
    renderPanel();
    openClosedTab();

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('from=2026-06-01T00%3A00%3A00.000Z');
  });

  it('refetches the closed request only when the period changes', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    const { rerender } = renderPanel();
    openClosedTab();
    await screen.findByTestId('ws-trades-closed-table');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockResolvedValueOnce(
      fakeResponse(200, closedTradesResponse({ total: 7, data: [] })),
    );
    mockCtx = {
      activeAccountId: 'acc-1',
      resolvedPeriod: { from: '2026-06-01', to: '2026-06-30' },
      timezone: 'America/Bogota',
    };
    rerender(<TradesWorkspacePanel positions={OPEN_POSITIONS} />);
    await screen.findByTestId('ws-trades-closed-empty');

    // Exactly one NEW request (the closed history), carrying the period.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain('from=2026-06-01');
    expect(url).toContain('to=2026-07-01T04%3A59%3A59.999Z');
  });

  it('keeps the Open tab (current V2 positions) untouched by a period change', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    const { rerender } = renderPanel();

    // Open tab is the passed V2 positions — a period change never re-fetches
    // them and never changes the open row set.
    expect(screen.getByTestId('ws-position-row-NVDA')).toBeTruthy();

    mockCtx = {
      activeAccountId: 'acc-1',
      resolvedPeriod: { from: '2026-06-01', to: '' },
      timezone: 'America/Bogota',
    };
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    rerender(<TradesWorkspacePanel positions={OPEN_POSITIONS} />);

    expect(screen.getByTestId('ws-position-row-NVDA')).toBeTruthy();
    expect(screen.getByTestId('ws-position-row-AMD')).toBeTruthy();
    // Open count still matches the live snapshot universe.
    expect(
      within(screen.getByTestId('ws-trades-tab-open')).getByTestId('ws-trades-open-count').textContent,
    ).toBe(String(OPEN_POSITIONS.length));
  });

  it('drops stale closed state synchronously when the period changes', async () => {
    const first = deferred<Response>();
    mockFetch.mockReturnValueOnce(first.promise);
    const { rerender } = renderPanel();
    openClosedTab();
    first.resolve(fakeResponse(200, closedTradesResponse()));
    await screen.findByTestId('ws-trades-closed-table');
    expect(screen.getByTestId('ws-trades-closed-row-NVDA')).toBeTruthy();

    // Period changes while its fetch is still in flight.
    const second = deferred<Response>();
    mockFetch.mockReturnValueOnce(second.promise);
    mockCtx = {
      activeAccountId: 'acc-1',
      resolvedPeriod: { from: '2026-06-01', to: '2026-06-30' },
      timezone: 'America/Bogota',
    };
    rerender(<TradesWorkspacePanel positions={OPEN_POSITIONS} />);

    // The previous period's rows must not linger.
    expect(screen.queryByTestId('ws-trades-closed-table')).toBeNull();
    expect(screen.getByTestId('ws-trades-closed-loading')).toBeTruthy();

    second.resolve(
      fakeResponse(200, closedTradesResponse({ total: 1, data: [{ id: 't-aapl', tradeCode: null, symbol: 'AAPL', direction: 'long', setupName: null, closedAt: '2026-06-15T15:00:00.000Z', realizedPnl: 10, returnPct: 0.001, metrics: { position: { closedAt: '2026-06-15T15:00:00.000Z', holdingPeriodDays: 1 }, returnMetrics: { rMultiple: 0.1 } } }], totals: { ...closedTradesResponse().totals, netRealizedPnl: 10 } })),
    );
    await screen.findByTestId('ws-trades-closed-row-AAPL');
    expect(screen.queryByTestId('ws-trades-closed-row-NVDA')).toBeNull();
  });

  it('labels a bounded closed universe as selected period', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    mockCtx = {
      activeAccountId: 'acc-1',
      resolvedPeriod: { from: '2026-06-01', to: '2026-06-30' },
      timezone: 'America/Bogota',
    };
    renderPanel();
    openClosedTab();

    await screen.findByTestId('ws-trades-closed-scope');
    expect(screen.getByTestId('ws-trades-closed-scope').textContent).toBe(
      'All 2 closed trades · selected period',
    );
    expect(screen.getByTestId('ws-trades-closed-totals').textContent).toContain(
      'Net P&L · selected period',
    );
  });

  it('keeps Max scope copy truthful (all history wording)', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(200, closedTradesResponse()));
    renderPanel();
    openClosedTab();

    await screen.findByTestId('ws-trades-closed-scope');
    expect(screen.getByTestId('ws-trades-closed-scope').textContent).toBe(
      'All 2 closed trades',
    );
    expect(screen.getByTestId('ws-trades-closed-totals').textContent).toContain(
      'Net P&L · all closed trades',
    );
  });
});
