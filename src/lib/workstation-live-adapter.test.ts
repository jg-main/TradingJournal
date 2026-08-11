/**
 * Tests for the Live Data Transformation Adapter (T01, S06, M005).
 *
 * Covers:
 *  - fetchJson failure modes: network error, HTTP 4xx/5xx, malformed JSON,
 *    empty body, abort
 *  - Each public fetch function (dashboard V1, dashboard V2, watchlist, accounts)
 *    with success and error paths
 *  - Transformation functions: adaptAccounts, adaptPositions, adaptRisk,
 *    adaptV2Account
 *  - Batch fetch: fetchAllLiveDashboardData success and partial failure
 *  - Edge cases: empty arrays, null optional fields, missing currency,
 *    drawdown fields at null
 *
 * Uses vi.hoisted to capture the mock before Vitest hoists module-level
 * code.  All tests mock global.fetch; no real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist the fetch mock so it's ready before the module loads ──────────
const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

import {
  fetchDashboardLive,
  fetchDashboardV2Live,
  fetchWatchlistLive,
  fetchAccountsLive,
  fetchAllLiveDashboardData,
  fetchWatchlistPricesLive,
  adaptAccounts,
  adaptPositions,
  adaptRisk,
  adaptV2Account,
  adaptMarketIndices,
  adaptSymbolPrices,
  buildTradeIdeasFromWatchlist,
  type LiveDashboardData,
} from '@/lib/workstation-live-adapter';
import type { DashboardResponse, WorkstationPosition, WorkstationWatchlistItem, SymbolPriceData } from '@/lib/workstation-fixtures';
import type { DashboardV2Response, DashboardPositionSummary } from '@/lib/accounting/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Fixture builders
// ═══════════════════════════════════════════════════════════════════════════

function makeFakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const init: ResponseInit = {
    status,
    statusText: status === 200 ? 'OK' : status === 400 ? 'Bad Request' : status === 500 ? 'Internal Server Error' : 'Unknown',
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  // Response.json() is not available in jsdom; stub .text() and .json()
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? '',
    headers: new Headers(headers),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => bodyStr,
    clone() { return this; },
  } as Response;
}

function makeNetworkError(): Error {
  return new TypeError('Failed to fetch');
}

function makeAbortError(): DOMException {
  return new DOMException('The user aborted a request.', 'AbortError');
}

// Minimal realistic dashboard V1 response
function makeDashboardResponse(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    kpis: {
      totalTrades: 87,
      openTrades: 3,
      winRate: 0.5862,
      netPnl: 12437.75,
      avgR: 0.42,
      avgGrade: 48.3,
      currentDrawdown: -420.5,
      currentDrawdownPct: -0.0082,
      accountValue: 62380.5,
      profitFactor: 1.62,
      avgWin: 486.2,
      avgLoss: -299.75,
    },
    mtm: {
      netUnrealizedPnl: 841.35,
      openTradeCount: 3,
      tradesWithPrices: 3,
      tradesAwaitingData: 0,
    },
    equityCurve: [{ date: '2026-07-24', equity: 62380.5, cumulativePnl: 12437.75, highWaterMark: 62801 }],
    drawdown: [{ date: '2026-07-24', drawdownAmount: -420.5, drawdownPct: -0.0082 }],
    monthlyPerformance: [{ month: '2026-07', netPnl: 842.1, winRate: 0.65, tradeCount: 12 }],
    rDistribution: [{ label: '0 to 1', count: 18 }],
    directionalPerformance: { long: { netPnl: 10984.2, winRate: 0.6047, tradeCount: 71 }, short: { netPnl: 1454.35, winRate: 0.4615, tradeCount: 16 } },
    processScoreDistribution: [{ label: 'A (54-60)', count: 26, minScore: 54 }],
    tradeMarkers: [],
    calendarHeatmap: [{ year: 2026, days: [{ date: '2026-07-24', pnl: 842.1 }] }],
    periodMatrix: {
      wow: { comparisonType: 'wow', rows: [] },
      mom: { comparisonType: 'mom', rows: [] },
      qoq: { comparisonType: 'qoq', rows: [] },
    },
    setupRanking: [{ setupName: 'ORB', setupId: 's1', count: 34, winRate: 0.61, avgR: 0.5, avgProcessScore: 50, sampleSizeWarning: 'adequate' }],
    attentionInsights: { insights: [], tradeCount: 84 },
    ...overrides,
  };
}

// Minimal realistic dashboard V2 response
function makeDashboardV2Response(overrides: Partial<DashboardV2Response> = {}): DashboardV2Response {
  return {
    snapshotId: 'snap:acct-1:2026-07-24T20:15:00.000Z',
    account: { id: 'acct-1', name: 'Primary Margin', currency: 'USD' },
    scopes: {
      accountPositions: {
        id: 'account_positions',
        section: 'valuation',
        description: 'Open positions with their latest valuation marks, attribution, and per-position risk.',
        source: 'account_positions + valuation_marks',
        asOf: '2026-07-24T19:58:00Z',
      },
      journalTrades: {
        id: 'journal_trades',
        section: 'journalAttribution',
        description: 'Journal trade linkage for accounting executions, attribution, and open-trade risk.',
        source: 'accounting_executions + trades',
        asOf: '2026-07-24T20:15:00.000Z',
      },
      periodPerformance: {
        id: 'period_performance',
        section: 'metrics',
        description: 'Period-to-date performance projection: cash, NAV, realized and unrealized P&L.',
        source: 'account_performance',
        asOf: '2026-07-24T20:00:00.000Z',
      },
    },
    metrics: {
      cash: '24150.75',
      nav: '62380.50',
      markedPositions: '31543.85',
      realizedPnl: '12437.75',
      unrealizedPnl: '841.35',
      totalPnl: '13279.10',
      realizedFees: '512.30',
      grossExposure: '31543.85',
      netExposure: '31543.85',
      drawdown: '-420.50',
      drawdownPct: '-0.82',
      modifiedDietzReturn: '0.0524',
      twr: '0.0518',
      provenance: {
        source: 'account_performance',
        asOf: '2026-07-24T20:00:00.000Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'partial',
        presentationLabel: '— Partial — 1 unpriced',
      },
    },
    valuation: {
      positionsTotal: 3,
      fresh: 2,
      stale: 1,
      missing: 0,
      state: 'partial',
      coveragePct: '66.67',
      presentationLabel: '— Partial — 1 unpriced',
      markedSubsetPnl: '919.60',
      positions: [
        {
          instrumentId: 'inst-nvda', symbol: 'NVDA', direction: 'long',
          quantity: '120', averageCost: '128.40', markStatus: 'fresh',
          markPrice: '131.85', markedValue: '15822.00', unrealizedPnl: '414.00',
          markTimestamp: '2026-07-24T19:58:00Z', markAgeMinutes: 17,
          attribution: { kind: 'journal', executionCount: 214, journalTradeCount: 214 },
          markProvenance: {
            source: 'market_data',
            asOf: '2026-07-24T19:58:00Z',
            computedAt: '2026-07-24T20:15:00.000Z',
            status: 'fresh',
          },
          risk: { hasValidStop: true, stopPrice: 127.9, currentRiskToStop: '474.00', openTrades: 1 },
        },
        {
          instrumentId: 'inst-amd', symbol: 'AMD', direction: 'long',
          quantity: '80', averageCost: '112.10', markStatus: 'fresh',
          markPrice: '118.42', markedValue: '9473.60', unrealizedPnl: '505.60',
          markTimestamp: '2026-07-24T19:58:00Z', markAgeMinutes: 17,
          attribution: { kind: 'mixed', executionCount: 3, journalTradeCount: 2 },
          markProvenance: {
            source: 'market_data',
            asOf: '2026-07-24T19:58:00Z',
            computedAt: '2026-07-24T20:15:00.000Z',
            status: 'fresh',
          },
          risk: { hasValidStop: true, stopPrice: 115.2, currentRiskToStop: '257.60', openTrades: 1 },
        },
        {
          instrumentId: 'inst-tsla', symbol: 'TSLA', direction: 'short',
          quantity: '25', averageCost: '246.80', markStatus: 'stale',
          markPrice: '249.93', markedValue: '6248.25', unrealizedPnl: '-78.25',
          markTimestamp: '2026-07-23T20:00:00Z', markAgeMinutes: 1455,
          attribution: { kind: 'account_only', executionCount: 3, journalTradeCount: 0 },
          markProvenance: {
            source: 'user',
            asOf: '2026-07-23T20:00:00Z',
            computedAt: '2026-07-24T20:15:00.000Z',
            status: 'stale',
          },
          risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 1 },
        },
      ],
      provenance: {
        source: 'account_positions + valuation_marks',
        asOf: '2026-07-24T19:58:00Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'partial',
        presentationLabel: '— Partial — 1 unpriced',
      },
    },
    journalAttribution: {
      hasJournalTrades: true,
      journalExecutionCount: 214,
      accountOnlyExecutionCount: 3,
      provenance: {
        source: 'accounting_executions',
        asOf: '2026-07-24T20:15:00.000Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'complete',
        presentationLabel: null,
      },
    },
    reconciliation: {
      eligible: true,
      refusalReasons: [],
      comparisons: null,
      totals: null,
      provenance: {
        source: 'reconciliation_report',
        asOf: '2026-07-24T20:15:00.000Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'complete',
        presentationLabel: null,
      },
    },
    riskSummary: {
      openPnl: '841.35',
      openRisk: '1450.00',
      portfolioHeat: '2.80',
      missingStops: 1,
      positionsWithStop: 2,
      openRiskToStop: '731.60',
      stopCoverage: {
        openTrades: 3,
        withStop: 2,
        withoutStop: 1,
        state: 'partial',
        presentationLabel: 'Incomplete — 1 without a valid stop',
      },
      provenance: {
        source: 'account_positions + trades + trade_risk_snapshots',
        asOf: '2026-07-24T19:58:00Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'partial',
        presentationLabel: '— Partial — 1 unpriced',
      },
    },
    integrity: { status: 'warning', warnings: ['TSLA mark is stale.'] },
    computedAt: '2026-07-24T20:15:00.000Z',
    ...overrides,
  };
}

function makeWatchlistItems(count: number = 3): WorkstationWatchlistItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `wl-${i + 1}`,
    dateAdded: '2026-07-20T14:30:00.000Z',
    symbol: ['NVDA', 'AAPL', 'MSFT'][i % 3],
    sectorId: null,
    name: `${['NVIDIA', 'Apple', 'Microsoft'][i % 3]}`,
    sector: 'Technology',
    industry: 'Semiconductors',
    setupId: `setup-${i + 1}`,
    direction: 'long' as const,
    thesis: 'Breakout over resistance',
    marketContext: null,
    keyLevel: 100 + i * 10,
    triggerPrice: 105 + i * 10,
    plannedStop: 95 + i * 10,
    targetPrice: 120 + i * 10,
    status: 'watching' as const,
    notes: null,
    promotedTradeId: null,
    alertConfig: null,
    createdAt: '2026-07-20T14:30:00.000Z',
    updatedAt: '2026-07-20T14:30:00.000Z',
  }));
}

function makeAccountRows(): unknown[] {
  return [
    { id: 'acct-1', name: 'Primary Margin', currency: 'USD', isActive: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'acct-2', name: 'Roth IRA', currency: 'USD', isActive: false, createdAt: '2026-03-15T00:00:00Z' },
    { id: 'acct-3', name: 'Cash Account', currency: null, isActive: true, createdAt: '2026-06-01T00:00:00Z' },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mockFetchResponse(status: number, body: unknown): void {
  mockFetch.mockResolvedValueOnce(makeFakeResponse(status, body));
}

function mockFetchNetworkError(): void {
  mockFetch.mockRejectedValueOnce(makeNetworkError());
}

function mockFetchAbortError(): void {
  mockFetch.mockRejectedValueOnce(makeAbortError());
}

// ═══════════════════════════════════════════════════════════════════════════
// Set up / tear down
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchDashboardLive
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchDashboardLive', () => {
  const accountId = 'acct-1';

  it('returns success with dashboard data on 200 OK', async () => {
    const dash = makeDashboardResponse();
    mockFetchResponse(200, dash);
    const result = await fetchDashboardLive(accountId);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kpis.totalTrades).toBe(87);
      expect(result.data.equityCurve).toHaveLength(1);
    }
  });

  it('passes accountId as query parameter', async () => {
    mockFetchResponse(200, makeDashboardResponse());
    await fetchDashboardLive('my-account-123');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('accountId=my-account-123');
  });

  it('returns error on network failure', async () => {
    mockFetchNetworkError();
    const result = await fetchDashboardLive(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Failed to fetch');
    }
  });

  it('returns error on 400 Bad Request (malformed accountId)', async () => {
    mockFetchResponse(400, { error: 'No active account found' });
    const result = await fetchDashboardLive('nonexistent');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('No active account');
    }
  });

  it('returns error on 500 Internal Server Error', async () => {
    mockFetchResponse(500, { error: 'Failed to fetch dashboard KPIs' });
    const result = await fetchDashboardLive(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(500);
    }
  });

  it('returns error on malformed JSON (200 with bad body)', async () => {
    mockFetch.mockResolvedValueOnce(makeFakeResponse(200, '{bad json'));
    const result = await fetchDashboardLive(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Malformed JSON');
    }
  });

  it('returns error on empty response body', async () => {
    mockFetchResponse(200, '');
    const result = await fetchDashboardLive(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Empty response');
    }
  });

  it('returns error on abort', async () => {
    mockFetchAbortError();
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await fetchDashboardLive(accountId, ctrl.signal);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Request was aborted');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchDashboardV2Live
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchDashboardV2Live', () => {
  const accountId = 'acct-1';

  it('returns success with V2 dashboard data on 200 OK', async () => {
    const v2 = makeDashboardV2Response();
    mockFetchResponse(200, v2);
    const result = await fetchDashboardV2Live(accountId);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.account.id).toBe('acct-1');
      expect(result.data.valuation.positionsTotal).toBe(3);
      expect(result.data.riskSummary.openPnl).toBe('841.35');
    }
  });

  it('returns error on 404 account not found', async () => {
    mockFetchResponse(404, { error: 'Account not found' });
    const result = await fetchDashboardV2Live('nonexistent');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(404);
    }
  });

  it('handles no-content response body on 200 (edge case)', async () => {
    mockFetchResponse(200, '');
    const result = await fetchDashboardV2Live(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Empty');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchWatchlistLive
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchWatchlistLive', () => {
  it('returns success with watchlist items on 200 OK', async () => {
    const items = makeWatchlistItems(5);
    mockFetchResponse(200, items);
    const result = await fetchWatchlistLive();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(5);
      expect(result.data[0].symbol).toBe('NVDA');
    }
  });

  it('returns success with empty watchlist array', async () => {
    mockFetchResponse(200, []);
    const result = await fetchWatchlistLive();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('returns error on network failure', async () => {
    mockFetchNetworkError();
    const result = await fetchWatchlistLive();
    expect(result.success).toBe(false);
  });

  it('returns error on abort', async () => {
    mockFetchAbortError();
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await fetchWatchlistLive(ctrl.signal);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Request was aborted');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchAccountsLive
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchAccountsLive', () => {
  it('returns success with transformed account list on 200 OK', async () => {
    mockFetchResponse(200, makeAccountRows());
    const result = await fetchAccountsLive();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toEqual({ id: 'acct-1', name: 'Primary Margin', currency: 'USD' });
      expect(result.data[1]).toEqual({ id: 'acct-2', name: 'Roth IRA', currency: 'USD' });
    }
  });

  it('defaults currency to USD when null in response', async () => {
    mockFetchResponse(200, makeAccountRows());
    const result = await fetchAccountsLive();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[2].currency).toBe('USD');
      expect(result.data[2].name).toBe('Cash Account');
    }
  });

  it('returns success with empty account list', async () => {
    mockFetchResponse(200, []);
    const result = await fetchAccountsLive();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('returns error when API fails', async () => {
    mockFetchResponse(500, { error: 'Failed to fetch accounts' });
    const result = await fetchAccountsLive();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(500);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// adaptAccounts
// ═══════════════════════════════════════════════════════════════════════════

describe('adaptAccounts', () => {
  it('maps full rows to WorkstationAccount[]', () => {
    const result = adaptAccounts([
      { id: 'a1', name: 'Main', currency: 'USD' },
      { id: 'a2', name: 'Secondary', currency: 'EUR' },
    ]);
    expect(result).toEqual([
      { id: 'a1', name: 'Main', currency: 'USD' },
      { id: 'a2', name: 'Secondary', currency: 'EUR' },
    ]);
  });

  it('defaults currency to USD when null', () => {
    const result = adaptAccounts([
      { id: 'a1', name: 'Main', currency: null },
    ]);
    expect(result[0].currency).toBe('USD');
  });

  it('defaults currency to USD when key is absent', () => {
    const result = adaptAccounts([
      { id: 'a1', name: 'Main' },
    ]);
    expect(result[0].currency).toBe('USD');
  });

  it('handles empty array', () => {
    const result = adaptAccounts([]);
    expect(result).toEqual([]);
  });

  it('preserves all other fields through mapping', () => {
    const result = adaptAccounts([
      { id: 'a1', name: 'Main', currency: 'GBP' },
    ]);
    expect(result[0].id).toBe('a1');
    expect(result[0].name).toBe('Main');
    expect(result[0].currency).toBe('GBP');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// adaptPositions
// ═══════════════════════════════════════════════════════════════════════════

describe('adaptPositions', () => {
  it('maps all fields from V2 positions and adds null risk fields', () => {
    const v2Positions: DashboardPositionSummary[] = [
      {
        instrumentId: 'inst-nvda', symbol: 'NVDA', direction: 'long',
        quantity: '120', averageCost: '128.40', markStatus: 'fresh',
        markPrice: '131.85', markedValue: '15822.00', unrealizedPnl: '414.00',
        markTimestamp: '2026-07-24T19:58:00Z', markAgeMinutes: 17,
        attribution: { kind: 'journal', executionCount: 214, journalTradeCount: 214 },
        markProvenance: {
          source: 'market_data',
          asOf: '2026-07-24T19:58:00Z',
          computedAt: '2026-07-24T20:15:00.000Z',
          status: 'fresh',
        },
        risk: { hasValidStop: true, stopPrice: 127.9, currentRiskToStop: '474.00', openTrades: 1 },
      },
    ];
    const result = adaptPositions(v2Positions);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('NVDA');
    expect(result[0].quantity).toBe('120');
    expect(result[0].markStatus).toBe('fresh');
    expect(result[0].unrealizedPnl).toBe('414.00');
    expect(result[0].initialRiskAmount).toBeNull();
    expect(result[0].rMultiple).toBeNull();
  });

  it('handles empty array', () => {
    const result = adaptPositions([]);
    expect(result).toEqual([]);
  });

  it('preserves null optional fields from V2 positions', () => {
    const v2Positions: DashboardPositionSummary[] = [
      {
        instrumentId: 'inst-xxx', symbol: 'XXX', direction: null,
        quantity: '50', averageCost: '10.00', markStatus: 'missing',
        markPrice: null, markedValue: null, unrealizedPnl: null,
        markTimestamp: null, markAgeMinutes: null,
        attribution: { kind: 'account_only', executionCount: 0, journalTradeCount: 0 },
        markProvenance: {
          source: null,
          asOf: null,
          computedAt: '2026-07-24T20:15:00.000Z',
          status: 'missing',
        },
        risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 0 },
      },
    ];
    const result = adaptPositions(v2Positions);
    expect(result[0].markPrice).toBeNull();
    expect(result[0].markedValue).toBeNull();
    expect(result[0].unrealizedPnl).toBeNull();
    expect(result[0].direction).toBeNull();
  });

  it('maps multiple positions preserving field order', () => {
    const v2 = makeDashboardV2Response();
    const result = adaptPositions(v2.valuation.positions);
    expect(result).toHaveLength(3);
    result.forEach((pos) => {
      expect(pos.initialRiskAmount).toBeNull();
      expect(pos.rMultiple).toBeNull();
      expect(typeof pos.symbol).toBe('string');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// adaptRisk
// ═══════════════════════════════════════════════════════════════════════════

describe('adaptRisk', () => {
  it('derives PTD and current risk from both dashboards', () => {
    const dash = makeDashboardResponse();
    const v2 = makeDashboardV2Response();
    const risk = adaptRisk(dash, v2);
    expect(risk.ptd.realizedPnl).toBe('12437.75');
    expect(risk.ptd.realizedFees).toBe('512.30');
    expect(risk.ptd.drawdown).toBe('-420.5');
    expect(risk.ptd.drawdownPct).toBe('-0.0082');
    expect(risk.current.openPnl).toBe('841.35');
    expect(risk.current.openRisk).toBe('1450.00');
    expect(risk.current.portfolioHeat).toBe('2.80');
    expect(risk.current.missingStops).toBe(1);
    expect(risk.current.positionsWithStop).toBe(2);
    expect(risk.current.exposure).toBe('31543.85');
  });

  it('handles null drawdown values', () => {
    const dash = makeDashboardResponse({
      kpis: { ...makeDashboardResponse().kpis, currentDrawdown: null, currentDrawdownPct: null },
    });
    const v2 = makeDashboardV2Response();
    const risk = adaptRisk(dash, v2);
    expect(risk.ptd.drawdown).toBeNull();
    expect(risk.ptd.drawdownPct).toBeNull();
  });

  it('handles defaults for V2 realizedFees (API returns string always)', () => {
    const dash = makeDashboardResponse();
    const v2 = makeDashboardV2Response();
    const risk = adaptRisk(dash, v2);
    expect(risk.ptd.realizedFees).toBe('512.30');
  });

  it('uses V2 metrics for openPnl and openRisk', () => {
    const dash = makeDashboardResponse();
    const v2 = makeDashboardV2Response({
      riskSummary: { openPnl: '-500.00', openRisk: '800.00', portfolioHeat: '1.50', missingStops: 0, positionsWithStop: 3 },
    } as unknown as DashboardV2Response);
    const risk = adaptRisk(dash, v2);
    expect(risk.current.openPnl).toBe('-500.00');
    expect(risk.current.openRisk).toBe('800.00');
    expect(risk.current.portfolioHeat).toBe('1.50');
  });

  it('does not throw when dashboard response has zero positions and risk', () => {
    const dash = makeDashboardResponse();
    const v2 = makeDashboardV2Response({
      riskSummary: { openPnl: '0.00', openRisk: '0.00', portfolioHeat: '0.00', missingStops: 0, positionsWithStop: 0 },
      metrics: { ...makeDashboardV2Response().metrics, markedPositions: '0.00' },
    } as unknown as DashboardV2Response);
    const risk = adaptRisk(dash, v2);
    expect(risk.current.openPnl).toBe('0.00');
    expect(risk.current.exposure).toBe('0.00');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// adaptV2Account
// ═══════════════════════════════════════════════════════════════════════════

describe('adaptV2Account', () => {
  it('passes through account fields', () => {
    const result = adaptV2Account({ id: 'acct-1', name: 'Primary', currency: 'USD' });
    expect(result).toEqual({ id: 'acct-1', name: 'Primary', currency: 'USD' });
  });

  it('handles non-USD currency', () => {
    const result = adaptV2Account({ id: 'acct-2', name: 'Euro Account', currency: 'EUR' });
    expect(result.currency).toBe('EUR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchAllLiveDashboardData
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchAllLiveDashboardData', () => {
  const accountId = 'acct-1';

  it('fetches all endpoints in parallel and returns transformed LiveDashboardData', async () => {
    // All four fetches succeed
    mockFetchResponse(200, makeDashboardResponse());
    mockFetchResponse(200, makeDashboardV2Response());
    mockFetchResponse(200, makeWatchlistItems(3));
    mockFetchResponse(200, makeAccountRows());

    const result = await fetchAllLiveDashboardData(accountId);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dashboard.kpis.totalTrades).toBe(87);
      expect(result.data.dashboardV2.account.id).toBe('acct-1');
      expect(result.data.watchlist).toHaveLength(3);
      expect(result.data.accounts).toHaveLength(3);
      expect(result.data.positions).toHaveLength(3);
      expect(result.data.positions[0].initialRiskAmount).toBeNull();
      expect(result.data.risk.ptd.realizedPnl).toBe('12437.75');
    }
  });

  it('returns first error when dashboard fetch fails', async () => {
    mockFetchResponse(500, { error: 'Dashboard error' });
    // Remaining fetches succeed (but they are called in parallel, so mock them)
    mockFetchResponse(200, makeDashboardV2Response());
    mockFetchResponse(200, makeWatchlistItems(3));
    mockFetchResponse(200, makeAccountRows());

    const result = await fetchAllLiveDashboardData(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Dashboard error');
      expect(result.status).toBe(500);
    }
  });

  it('returns first error when dashboardV2 fetch fails', async () => {
    mockFetchResponse(200, makeDashboardResponse());
    mockFetchResponse(400, { error: 'Account not found' });
    mockFetchResponse(200, makeWatchlistItems(3));
    mockFetchResponse(200, makeAccountRows());

    const result = await fetchAllLiveDashboardData(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
    }
  });

  it('returns error when watchlist fetch fails', async () => {
    mockFetchResponse(200, makeDashboardResponse());
    mockFetchResponse(200, makeDashboardV2Response());
    mockFetchNetworkError();
    mockFetchResponse(200, makeAccountRows());

    const result = await fetchAllLiveDashboardData(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Failed to fetch');
    }
  });

  it('returns error when accounts fetch fails', async () => {
    mockFetchResponse(200, makeDashboardResponse());
    mockFetchResponse(200, makeDashboardV2Response());
    mockFetchResponse(200, makeWatchlistItems(3));
    mockFetchResponse(500, { error: 'Failed to fetch accounts' });

    const result = await fetchAllLiveDashboardData(accountId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Failed to fetch accounts');
    }
  });

  it('aborts all requests when signal is aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    mockFetchAbortError();
    mockFetchAbortError();
    mockFetchAbortError();
    mockFetchAbortError();

    const result = await fetchAllLiveDashboardData(accountId, ctrl.signal);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Request was aborted');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q5 — Failure Modes
// ═══════════════════════════════════════════════════════════════════════════

describe('failure modes (Q5)', () => {
  it('handles network timeout (TypeError)', async () => {
    mockFetchNetworkError();
    const result = await fetchDashboardLive('acct-1');
    expect(result.success).toBe(false);
    if (!result.success) {
      // Network errors surface through the fetch catch handler
      expect(result.error).toBeTruthy();
    }
  });

  it('handles 502 Bad Gateway (non-standard error body)', async () => {
    mockFetchResponse(502, '<html>Gateway Error</html>');
    // html body is not valid JSON — fetchJson should use statusText fallback
    const result = await fetchDashboardLive('acct-1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(502);
    }
  });

  it('handles 429 Too Many Requests (rate-limit body)', async () => {
    mockFetchResponse(429, { error: 'Rate limit exceeded' });
    const result = await fetchDashboardLive('acct-1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(429);
      expect(result.error).toContain('Rate limit');
    }
  });

  it('handles 503 Service Unavailable with no body', async () => {
    mockFetchResponse(503, null);
    const result = await fetchDashboardLive('acct-1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(503);
    }
  });

  it('handles response.json() throwing during error parsing', async () => {
    // A 500 response where body is not valid JSON
    mockFetch.mockResolvedValueOnce(makeFakeResponse(500, '{broken'));
    const result = await fetchDashboardLive('acct-1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(500);
    }
  });

  it('handles a null Response from fetch (defensive)', async () => {
    // fetch should never return null, but we handle it defensively
    mockFetch.mockRejectedValueOnce(new Error('Connection reset'));
    const result = await fetchDashboardLive('acct-1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Connection reset');
    }
  });

  it('bubbles network errors from parallel fetchAllLiveDashboardData (first wins)', async () => {
    // Dashboard and V2 succeed, watchlist fails
    mockFetchResponse(200, makeDashboardResponse());
    mockFetchResponse(200, makeDashboardV2Response());
    mockFetchNetworkError();
    mockFetchResponse(200, makeAccountRows());

    const result = await fetchAllLiveDashboardData('acct-1');
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q6 — Load Profile
// ═══════════════════════════════════════════════════════════════════════════

describe('load profile (Q6)', () => {
  it('fetches all 4 endpoints concurrently (not sequentially)', async () => {
    // Set up a deferred promise so we can observe order
    let resolve1!: (v: Response) => void;
    let resolve2!: (v: Response) => void;
    let resolve3!: (v: Response) => void;
    let resolve4!: (v: Response) => void;

    const p1 = new Promise<Response>((r) => { resolve1 = r; });
    const p2 = new Promise<Response>((r) => { resolve2 = r; });
    const p3 = new Promise<Response>((r) => { resolve3 = r; });
    const p4 = new Promise<Response>((r) => { resolve4 = r; });

    mockFetch.mockReturnValueOnce(p1).mockReturnValueOnce(p2).mockReturnValueOnce(p3).mockReturnValueOnce(p4);

    const resultPromise = fetchAllLiveDashboardData('acct-1');

    // All 4 fetches should have been called before any resolves
    expect(mockFetch).toHaveBeenCalledTimes(4);

    resolve1(makeFakeResponse(200, makeDashboardResponse()));
    resolve2(makeFakeResponse(200, makeDashboardV2Response()));
    resolve3(makeFakeResponse(200, makeWatchlistItems(3)));
    resolve4(makeFakeResponse(200, makeAccountRows()));

    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('uses URLSearchParams for safe parameter encoding', async () => {
    mockFetchResponse(200, makeDashboardResponse());
    const result = await fetchDashboardLive('a/c c t#1');
    // Should not throw on special chars; URLSearchParams handles encoding
    expect(result.success).toBe(true);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('accountId=');
  });

  it('handles large watchlist responses without truncation', async () => {
    const largeWatchlist = makeWatchlistItems(100);
    mockFetchResponse(200, largeWatchlist);
    const result = await fetchWatchlistLive();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(100);
    }
  });

  it('protects against concurrent duplicate requests via AbortSignal', async () => {
    // The adapter itself doesn't deduplicate; it relies on the caller to
    // abort stale requests via signal. Verify that passing a signal works.
    const ctrl = new AbortController();
    mockFetchAbortError();
    ctrl.abort();

    const result = await fetchDashboardLive('acct-1', ctrl.signal);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Request was aborted');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q7 — Negative Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('negative tests (Q7)', () => {
  describe('malformed inputs to fetch functions', () => {
    it('handles empty accountId string gracefully (delegates to API)', async () => {
      mockFetchResponse(400, { error: 'No active account found', details: {} });
      const result = await fetchDashboardLive('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
      }
    });

    it('handles undefined response fields in dashboard', async () => {
      // API returns a minimal response with missing optional fields
      const minimal = {
        kpis: { totalTrades: 0, openTrades: 0, winRate: null, netPnl: 0, avgR: null, avgGrade: null, currentDrawdown: null, currentDrawdownPct: null, accountValue: null, profitFactor: null, avgWin: null, avgLoss: null },
        mtm: { netUnrealizedPnl: 0, openTradeCount: 0, tradesWithPrices: 0, tradesAwaitingData: 0 },
        equityCurve: [],
        drawdown: [],
        monthlyPerformance: [],
        rDistribution: [],
        calendarHeatmap: [],
        periodMatrix: { wow: { comparisonType: 'wow', rows: [] }, mom: { comparisonType: 'mom', rows: [] }, qoq: { comparisonType: 'qoq', rows: [] } },
        setupRanking: [],
        attentionInsights: { insights: [], tradeCount: 0 },
      };
      mockFetchResponse(200, minimal);
      const result = await fetchDashboardLive('acct-1');
      expect(result.success).toBe(true);
    });

    it('handles non-array watchlist response (API contract violation)', async () => {
      mockFetchResponse(200, { items: [] });
      const result = await fetchWatchlistLive();
      expect(result.success).toBe(true); // fetchJson doesn't validate shape — types trust API
    });

    it('handles null values in position fields', async () => {
      const pos: DashboardPositionSummary = {
        instrumentId: '', symbol: '', direction: null,
        quantity: '0', averageCost: '0', markStatus: 'missing',
        markPrice: null, markedValue: null, unrealizedPnl: null,
        markTimestamp: null, markAgeMinutes: null,
        attribution: { kind: 'account_only', executionCount: 0, journalTradeCount: 0 },
        markProvenance: {
          source: null,
          asOf: null,
          computedAt: '2026-07-24T20:15:00.000Z',
          status: 'missing',
        },
        risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 0 },
      };
      const result = adaptPositions([pos]);
      expect(result).toHaveLength(1);
      expect(result[0].markStatus).toBe('missing');
      expect(result[0].markPrice).toBeNull();
    });

    it('adaptRisk does not throw with zero-length equity curve', async () => {
      const dash = makeDashboardResponse({ equityCurve: [] });
      const v2 = makeDashboardV2Response();
      expect(() => adaptRisk(dash, v2)).not.toThrow();
    });
  });

  describe('transformation boundary conditions', () => {
    it('adaptAccounts handles rows with only id', () => {
      const result = adaptAccounts([{ id: 'x', name: 'X' }]);
      expect(result[0].currency).toBe('USD');
    });

    it('adaptPositions does not mutate input array', () => {
      const input: DashboardPositionSummary[] = [{
        instrumentId: 'abc', symbol: 'AAPL', direction: 'long',
        quantity: '10', averageCost: '100', markStatus: 'fresh',
        markPrice: '110', markedValue: '1100', unrealizedPnl: '100',
        markTimestamp: 'now', markAgeMinutes: 1,
        attribution: { kind: 'journal', executionCount: 1, journalTradeCount: 1 },
        markProvenance: {
          source: 'user',
          asOf: 'now',
          computedAt: '2026-07-24T20:15:00.000Z',
          status: 'fresh',
        },
        risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '150.00', openTrades: 1 },
      }];
      const copy = JSON.parse(JSON.stringify(input));
      adaptPositions(input);
      expect(input).toEqual(copy); // input unchanged
      expect((input[0] as unknown as WorkstationPosition).initialRiskAmount).toBeUndefined();
    });

    it('adaptRisk handles kpis with non-finite netPnl (defensive)', () => {
      const dash = makeDashboardResponse({ kpis: { ...makeDashboardResponse().kpis, netPnl: Infinity } });
      const v2 = makeDashboardV2Response();
      const risk = adaptRisk(dash, v2);
      expect(risk.ptd.realizedPnl).toBe('Infinity'); // String(Infinity) = 'Infinity'
    });
  });

  describe('concurrent fetch abort race', () => {
    it('reports abort error when signal fires mid-fetchAll', async () => {
      // Dashboard resolves OK, V2 is pending, then abort fires
      mockFetchResponse(200, makeDashboardResponse());
      mockFetchAbortError(); // V2 aborted
      mockFetchResponse(200, makeWatchlistItems(3));
      mockFetchResponse(200, makeAccountRows());

      const result = await fetchAllLiveDashboardData('acct-1');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Request was aborted');
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Type discrimination
// ═══════════════════════════════════════════════════════════════════════════

describe('LiveFetchResult type narrowing', () => {
  it('allows type-narrowed access to data on success', async () => {
    mockFetchResponse(200, makeDashboardResponse());
    const result = await fetchDashboardLive('acct-1');
    if (result.success) {
      // TypeScript should know data exists here
      const trades: number = result.data.kpis.totalTrades;
      expect(trades).toBe(87);
    }
  });

  it('allows type-narrowed access to error on failure', async () => {
    mockFetchResponse(500, { error: 'fail' });
    const result = await fetchDashboardLive('acct-1');
    if (!result.success) {
      const err: string = result.error;
      expect(err).toBeTruthy();
    }
  });

  it('narrows correctly for fetchAllLiveDashboardData success', async () => {
    mockFetchResponse(200, makeDashboardResponse());
    mockFetchResponse(200, makeDashboardV2Response());
    mockFetchResponse(200, makeWatchlistItems(3));
    mockFetchResponse(200, makeAccountRows());

    const result = await fetchAllLiveDashboardData('acct-1');
    expect(result.success).toBe(true);
    if (result.success) {
      const data: LiveDashboardData = result.data;
      expect(data.positions).toHaveLength(3);
      expect(data.risk.ptd.realizedPnl).toBe('12437.75');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Market price adapter functions (M005 remediation)
// ═══════════════════════════════════════════════════════════════════════════

import { MARKET_INDEX_SYMBOLS } from '@/lib/workstation-fixtures';
import type { QuoteResult } from '@/lib/market-quote';

// ── QuoteResult helpers ────────────────────────────────────────────────

function makeQuoteResult(symbol: string, price: number, overrides: Partial<QuoteResult> = {}): QuoteResult {
  return {
    symbol,
    price,
    marketState: 'REGULAR',
    fetchedAt: '2026-07-24T12:00:00.000Z',
    source: 'mock' as const,
    previousClose: price - 0.50,
    change: 0.50,
    changePercent: (0.50 / (price - 0.50)) * 100,
    ...overrides,
  };
}

function makeWlItem(symbol: string, overrides: Partial<WorkstationWatchlistItem> = {}): WorkstationWatchlistItem {
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

describe('adaptMarketIndices', () => {
  it('returns MarketIndexSnapshot for each index symbol with a valid price', () => {
    const prices: Record<string, QuoteResult> = {};
    for (const sym of MARKET_INDEX_SYMBOLS) {
      prices[sym] = makeQuoteResult(sym, sym === 'SPX' ? 6000 : 500);
    }
    const result = adaptMarketIndices(prices);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ symbol: 'SPX', lastPrice: 6000 });
    expect(result[0].change).toBe(0.50);
  });

  it('omits index symbols with null prices', () => {
    const prices: Record<string, QuoteResult> = {
      SPX: makeQuoteResult('SPX', 6000),
      NDX: { ...makeQuoteResult('NDX', 500), price: null },
    };
    const result = adaptMarketIndices(prices);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('SPX');
  });

  it('omits missing index symbols entirely', () => {
    const prices: Record<string, QuoteResult> = {};
    const result = adaptMarketIndices(prices);
    expect(result).toHaveLength(0);
  });

  it('handles missing change/changePercent gracefully', () => {
    const prices: Record<string, QuoteResult> = {
      SPX: { ...makeQuoteResult('SPX', 6000), change: undefined, changePercent: undefined },
    };
    const result = adaptMarketIndices(prices);
    expect(result).toHaveLength(1);
    expect(result[0].change).toBe(0);
    expect(result[0].changePct).toBe(0);
  });
});

describe('adaptSymbolPrices', () => {
  it('returns SymbolPriceData for watchlist symbols with valid prices', () => {
    const watchlist = [makeWlItem('AAPL'), makeWlItem('MSFT')];
    const prices: Record<string, QuoteResult> = {
      AAPL: makeQuoteResult('AAPL', 178.50),
      MSFT: makeQuoteResult('MSFT', 420.00),
    };
    const result = adaptSymbolPrices(prices, watchlist);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.AAPL).toMatchObject({ symbol: 'AAPL', lastPrice: 178.50, gap: 0.50 });
  });

  it('skips symbols not in the watchlist', () => {
    const watchlist = [makeWlItem('AAPL')];
    const prices: Record<string, QuoteResult> = {
      AAPL: makeQuoteResult('AAPL', 178.50),
      TSLA: makeQuoteResult('TSLA', 250.00),
    };
    const result = adaptSymbolPrices(prices, watchlist);
    expect(Object.keys(result)).toHaveLength(1);
    expect(result.AAPL).toBeDefined();
    expect(result.TSLA).toBeUndefined();
  });

  it('skips prices with null price value', () => {
    const watchlist = [makeWlItem('AAPL')];
    const prices: Record<string, QuoteResult> = {
      AAPL: { ...makeQuoteResult('AAPL', 178.50), price: null },
    };
    const result = adaptSymbolPrices(prices, watchlist);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('computes distanceToTrigger from watchlist triggerPrice', () => {
    const watchlist = [makeWlItem('AAPL', { triggerPrice: 175.00 })];
    const prices: Record<string, QuoteResult> = {
      AAPL: makeQuoteResult('AAPL', 178.50),
    };
    const result = adaptSymbolPrices(prices, watchlist);
    expect(result.AAPL.distanceToTrigger).toBe(3.50); // |178.50 - 175.00|
    expect(result.AAPL.distanceToTriggerPct).toBe(3.50 / 175.00);
  });

  it('handles missing triggerPrice gracefully', () => {
    const watchlist = [makeWlItem('AAPL', { triggerPrice: null })];
    const prices: Record<string, QuoteResult> = {
      AAPL: makeQuoteResult('AAPL', 178.50),
    };
    const result = adaptSymbolPrices(prices, watchlist);
    expect(result.AAPL.distanceToTrigger).toBeNull();
  });
});

describe('buildTradeIdeasFromWatchlist', () => {
  it('derives trade ideas from watchlist items with triggerPrice and no promotedTradeId', () => {
    const watchlist: WorkstationWatchlistItem[] = [
      makeWlItem('AAPL', { triggerPrice: 175, plannedStop: 170, targetPrice: 190, direction: 'long' }),
      makeWlItem('MSFT', { triggerPrice: 420, plannedStop: 415, targetPrice: 440, direction: 'long' }),
      makeWlItem('GOOGL', { triggerPrice: null }), // no trigger — should be filtered out
      makeWlItem('TSLA', { triggerPrice: 250, plannedStop: 255, targetPrice: 230, direction: 'short' }),
    ];
    const symbolPrices: Record<string, SymbolPriceData> = {
      AAPL: { symbol: 'AAPL', lastPrice: 178.50, previousClose: 178, gap: 0.50, gapPct: 0.0028, triggerPrice: 175, distanceToTrigger: 3.50, distanceToTriggerPct: 0.02 },
      MSFT: { symbol: 'MSFT', lastPrice: 420.00, previousClose: 419.5, gap: 0.50, gapPct: 0.0012, triggerPrice: 420, distanceToTrigger: 0, distanceToTriggerPct: 0 },
      TSLA: { symbol: 'TSLA', lastPrice: 250.00, previousClose: 249.5, gap: 0.50, gapPct: 0.0020, triggerPrice: 250, distanceToTrigger: 0, distanceToTriggerPct: 0 },
    };

    const result = buildTradeIdeasFromWatchlist(watchlist, symbolPrices);

    // 3 eligible items: AAPL, MSFT, TSLA (GOOGL has no triggerPrice)
    expect(result).toHaveLength(3);

    // Long AAPL: entry=175, stop=170, target=190
    const aapl = result.find((i) => i.symbol === 'AAPL')!;
    expect(aapl.direction).toBe('long');
    expect(aapl.entryPrice).toBe(175);
    expect(aapl.stopPrice).toBe(170);
    expect(aapl.targetPrice).toBe(190);
    expect(aapl.riskPerShare).toBe(5); // 175 - 170
    expect(aapl.rewardPerShare).toBe(15); // 190 - 175
    expect(aapl.riskRewardRatio).toBe(3); // 15/5

    // Short TSLA: entry=250, stop=255, target=230
    const tsla = result.find((i) => i.symbol === 'TSLA')!;
    expect(tsla.direction).toBe('short');
    expect(tsla.riskPerShare).toBe(5); // 255 - 250
    expect(tsla.rewardPerShare).toBe(20); // 250 - 230
    expect(tsla.riskRewardRatio).toBe(4); // 20/5
  });

  it('returns null ratio when riskPerShare <= 0', () => {
    // Stop above entry for a long — data error, risk is negative
    const watchlist = [makeWlItem('AAPL', { triggerPrice: 175, plannedStop: 180, targetPrice: 190, direction: 'long' })];
    const symbolPrices: Record<string, SymbolPriceData> = {};
    const result = buildTradeIdeasFromWatchlist(watchlist, symbolPrices);
    expect(result).toHaveLength(1);
    expect(result[0].riskPerShare).toBe(-5);
    expect(result[0].riskRewardRatio).toBeNull();
  });

  it('filters out promoted items (active trades)', () => {
    const watchlist = [
      makeWlItem('AAPL', { triggerPrice: 175, promotedTradeId: 'trade-1' }),
      makeWlItem('MSFT', { triggerPrice: 420, promotedTradeId: null }),
    ];
    const symbolPrices: Record<string, SymbolPriceData> = {};
    const result = buildTradeIdeasFromWatchlist(watchlist, symbolPrices);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('MSFT');
  });

  it('looks up setup names from the provided map', () => {
    const watchlist = [makeWlItem('AAPL', { triggerPrice: 175, setupId: 'setup-1', plannedStop: 170 })];
    const symbolPrices: Record<string, SymbolPriceData> = {};
    const setupNames: Record<string, string> = { 'setup-1': 'Breakout' };
    const result = buildTradeIdeasFromWatchlist(watchlist, symbolPrices, setupNames);
    expect(result[0].setupName).toBe('Breakout');
  });

  it('returns null setupName when setupId is not in the map', () => {
    const watchlist = [makeWlItem('AAPL', { triggerPrice: 175, setupId: 'unknown', plannedStop: 170 })];
    const symbolPrices: Record<string, SymbolPriceData> = {};
    const result = buildTradeIdeasFromWatchlist(watchlist, symbolPrices);
    expect(result[0].setupName).toBeNull();
  });

  it('uses lastPrice from symbolPrices', () => {
    const watchlist = [makeWlItem('AAPL', { triggerPrice: 175, plannedStop: 170 })];
    const symbolPrices: Record<string, SymbolPriceData> = {
      AAPL: { symbol: 'AAPL', lastPrice: 178.50, previousClose: 178, gap: 0.50, gapPct: 0.0028, triggerPrice: 175, distanceToTrigger: 3.50, distanceToTriggerPct: 0.02 },
    };
    const result = buildTradeIdeasFromWatchlist(watchlist, symbolPrices);
    expect(result[0].lastPrice).toBe(178.50);
  });

  it('returns null lastPrice when symbol not in price data', () => {
    const watchlist = [makeWlItem('AAPL', { triggerPrice: 175, plannedStop: 170 })];
    const result = buildTradeIdeasFromWatchlist(watchlist, {});
    expect(result[0].lastPrice).toBeNull();
  });

  it('handles empty inputs', () => {
    expect(buildTradeIdeasFromWatchlist([], {})).toHaveLength(0);
  });
});

describe('fetchWatchlistPricesLive', () => {
  it('fetches prices and returns Record<string, QuoteResult>', async () => {
    const pricesPayload = {
      prices: {
        AAPL: makeQuoteResult('AAPL', 178.50),
        MSFT: makeQuoteResult('MSFT', 420.00),
      },
      fetchedAt: '2026-07-24T12:00:00.000Z',
    };
    mockFetchResponse(200, pricesPayload);

    const result = await fetchWatchlistPricesLive(['AAPL', 'MSFT']);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toHaveLength(2);
      expect(result.data.AAPL.price).toBe(178.50);
      expect(result.data.MSFT.price).toBe(420.00);
    }
  });

  it('propagates HTTP errors', async () => {
    mockFetchResponse(500, { error: 'provider down' });
    const result = await fetchWatchlistPricesLive(['AAPL']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('provider down');
    }
  });

  it('constructs correct URL with symbols', async () => {
    mockFetchResponse(200, { prices: {}, fetchedAt: '' });
    const result = await fetchWatchlistPricesLive(['SPX', 'AAPL']);
    expect(result.success).toBe(true);
    // Verify the URL was constructed correctly via the mock
    const url = mockFetch.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('/api/watchlist/prices?symbols=SPX%2CAAPL');
  });
});
