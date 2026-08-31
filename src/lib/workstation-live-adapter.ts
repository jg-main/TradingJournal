/**
 * Workstation Live Data Adapter
 *
 * Fetches real data from the /api/dashboard, /api/dashboard/v2, /api/watchlist,
 * and /api/accounts endpoints and transforms the responses into the shapes
 * consumed by workstation panels (DashboardResponse, DashboardV2Response,
 * WorkstationWatchlistItem[], WorkstationAccount[], WorkstationPosition[],
 * WorkstationRisk).
 *
 * Data-boundary contract (M004 9D.1): the adapter separates CURRENT
 * workstation state from date-aware V1 dashboard / retrospective state.
 *  - CURRENT acquisition (fetchCurrentLiveDashboardData) touches only
 *    /api/dashboard/v2, /api/watchlist, and /api/accounts. It must never
 *    fetch /api/dashboard V1 and never carry a date parameter.
 *  - The V1 dashboard fetch (fetchDashboardLive) is the adapter's single
 *    date-aware entry point: it accepts an OPTIONAL already-resolved plain
 *    YMD range and serializes it only as dateFrom/dateTo. No date math, no
 *    calendar/time-zone arithmetic, and no period presets happen here — the
 *    adapter only forwards already-resolved values (M004 9D.1 §4).
 *  - fetchAllLiveDashboardData composes the two boundaries and remains the
 *    compatibility path consumed by WorkstationContext (unchanged here).
 *
 * All functions are pure data-fetching and transformation — no React state,
 * no side effects beyond the HTTP request.  Designed to slot into
 * WorkstationContext live-mode (T02) as a drop-in replacement for the
 * fixture builder.
 *
 * Error handling is explicit: every fetch returns LiveFetchResult<T> with
 * success/error discrimination.  Callers never need try/catch — check
 * `result.success` instead.
 *
 * @module workstation-live-adapter
 */

import type {
  DashboardResponse,
  MarketIndexSnapshot,
  SymbolPriceData,
  TradeIdea,
  WorkstationPosition,
  WorkstationRisk,
  WorkstationWatchlistItem,
} from '@/lib/workstation-fixtures';
import { MARKET_INDEX_SYMBOLS } from '@/lib/workstation-fixtures';
import type { DashboardV2Response, DashboardPositionSummary } from '@/lib/accounting/dashboard-v2';
import type { QuoteResult } from '@/lib/market-quote';
import { resolveMtmRefreshIntervalSeconds } from '@/lib/market-data-refresh-interval';

// ═══════════════════════════════════════════════════════════════════════════
// Result types
// ═══════════════════════════════════════════════════════════════════════════

/** Success variant of a live fetch. */
export interface LiveFetchSuccess<T> {
  success: true;
  data: T;
}

/** Error variant of a live fetch. */
export interface LiveFetchError {
  success: false;
  error: string;
  status?: number;
}

/** Discriminated result of an async fetch. */
export type LiveFetchResult<T> = LiveFetchSuccess<T> | LiveFetchError;

/** Bundled live data for one account (used by T02 context). */
export interface LiveDashboardData {
  dashboard: DashboardResponse;
  dashboardV2: DashboardV2Response;
  watchlist: WorkstationWatchlistItem[];
  accounts: WorkstationAccount[];
  positions: WorkstationPosition[];
  risk: WorkstationRisk;
}

/** Account shape consumed by the workstation account switcher. */
export interface WorkstationAccount {
  id: string;
  name: string;
  currency: string;
}

/**
 * Already-resolved plain YMD (YYYY-MM-DD) date range.  Empty strings mean
 * "no bound".  The adapter performs no date math on these values — callers
 * supply the resolved range and the adapter only forwards it to the
 * date-aware Dashboard V1 fetch (M004 9D.1 §4).
 */
export interface ResolvedDateRange {
  from: string;
  to: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Core fetch wrapper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch JSON from a URL and return a discriminated result.
 *
 * Handles:
 *  - Network errors (fetch throws TypeError)
 *  - Non-2xx responses (parses the error body if present)
 *  - Malformed JSON (SyntaxError from response.json())
 *  - Empty bodies (null response — treated as an error)
 */
async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<LiveFetchResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, error: 'Request was aborted' };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown network error',
    };
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as Record<string, unknown>;
      detail = typeof body.error === 'string' ? body.error : JSON.stringify(body);
    } catch {
      detail = response.statusText || 'Unknown error';
    }
    return {
      success: false,
      error: detail,
      status: response.status,
    };
  }

  let body: unknown;
  try {
    const text = await response.text();
    if (!text) {
      return { success: false, error: 'Empty response body', status: response.status };
    }
    body = JSON.parse(text) as unknown;
  } catch (err) {
    if (
      signal?.aborted ||
      (err instanceof DOMException && err.name === 'AbortError')
    ) {
      return { success: false, error: 'Request was aborted' };
    }
    return {
      success: false,
      error: err instanceof SyntaxError ? `Malformed JSON response: ${err.message}` : 'Failed to parse response',
      status: response.status,
    };
  }

  return { success: true, data: body as T };
}

// ═══════════════════════════════════════════════════════════════════════════
// API fetch functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the Dashboard V1 response from /api/dashboard.
 *
 * The API response shape matches DashboardResponse directly — no
 * transformation needed.  The adapter validates via the typings;
 * runtime validation is deferred to the consuming context so it
 * can surface loading/error states to the UI.
 *
 * This is the adapter's single date-aware fetch (M004 9D.1 §6).  It accepts
 * an OPTIONAL already-resolved plain YMD range:
 *  - range omitted, or both bounds empty (Max): the URL stays EXACTLY
 *    `/api/dashboard?accountId=<id>` — no date parameters.
 *  - range supplied: only dateFrom/dateTo are appended, verbatim.
 * No other query behavior changes.
 */
export async function fetchDashboardLive(
  accountId: string,
  signal?: AbortSignal,
  range?: ResolvedDateRange,
): Promise<LiveFetchResult<DashboardResponse>> {
  const params = new URLSearchParams({ accountId });
  if (range) {
    if (range.from !== '') params.set('dateFrom', range.from);
    if (range.to !== '') params.set('dateTo', range.to);
  }
  return fetchJson<DashboardResponse>(`/api/dashboard?${params.toString()}`, signal);
}

/**
 * Fetch the Dashboard V2 response from /api/dashboard/v2.
 *
 * The API response shape matches DashboardV2Response directly.
 */
export async function fetchDashboardV2Live(
  accountId: string,
  signal?: AbortSignal,
): Promise<LiveFetchResult<DashboardV2Response>> {
  const params = new URLSearchParams({ accountId });
  return fetchJson<DashboardV2Response>(`/api/dashboard/v2?${params.toString()}`, signal);
}

/**
 * Fetch the raw watchlist items from /api/watchlist.
 *
 * The response is an array of watchlist_items rows matching the
 * WorkstationWatchlistItem shape.  No transformation needed.
 */
export async function fetchWatchlistLive(
  signal?: AbortSignal,
): Promise<LiveFetchResult<WorkstationWatchlistItem[]>> {
  return fetchJson<WorkstationWatchlistItem[]>('/api/watchlist', signal);
}

/**
 * Fetch the account list from /api/accounts and adapt to
 * WorkstationAccount[] (id, name, currency).
 */
export async function fetchAccountsLive(
  signal?: AbortSignal,
): Promise<LiveFetchResult<WorkstationAccount[]>> {
  const result = await fetchJson<RawAccountRow[]>('/api/accounts', signal);
  if (!result.success) return result;
  return { success: true, data: adaptAccounts(result.data) };
}

/** Result returned after refreshing persisted open-position marks. */
export interface MtmRefreshResult {
  updated: number;
  failed: string[];
  timestamp: string;
}

/**
 * Ask the server to fetch fresh quotes and persist open-position marks.
 * Call this before reloading dashboard valuation data so the workstation
 * never represents an ordinary GET as a successful market-data refresh.
 */
export async function refreshMtmPricesLive(
  signal?: AbortSignal,
): Promise<LiveFetchResult<MtmRefreshResult>> {
  return fetchJson<MtmRefreshResult>(
    '/api/trades/mtm/refresh',
    signal,
    { method: 'POST' },
  );
}

/**
 * Read the configured mark-refresh cadence. Rows created before this setting
 * existed intentionally receive the same default as newly created rows.
 */
export async function fetchMtmRefreshIntervalLive(
  signal?: AbortSignal,
): Promise<LiveFetchResult<number>> {
  const result = await fetchJson<{ refreshIntervalSeconds?: unknown }>(
    '/api/market-data/settings',
    signal,
  );
  if (!result.success) return result;

  return {
    success: true,
    data: resolveMtmRefreshIntervalSeconds(result.data.refreshIntervalSeconds),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Transformation functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Raw account row from the /api/accounts endpoint.
 * The actual table has more columns; we only need id, name, currency.
 */
interface RawAccountRow {
  id: string;
  name: string;
  currency?: string | null;
}

/**
 * Map raw account rows to the WorkstationAccount shape.
 */
export function adaptAccounts(rows: RawAccountRow[]): WorkstationAccount[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currency: row.currency ?? 'USD',
  }));
}

/**
 * Adapt Dashboard V2 position summaries into WorkstationPosition[].
 *
 * The V2 positions carry all the fields except initialRiskAmount and
 * rMultiple, which require per-trade risk snapshot data not included
 * in the V2 response.  These are set to null here and may be enriched
 * by a subsequent per-position risk lookup (T03).
 */
export function adaptPositions(
  v2Positions: DashboardPositionSummary[],
): WorkstationPosition[] {
  return v2Positions.map((p) => ({
    instrumentId: p.instrumentId,
    symbol: p.symbol,
    direction: p.direction,
    quantity: p.quantity,
    averageCost: p.averageCost,
    markStatus: p.markStatus,
    markPrice: p.markPrice,
    markedValue: p.markedValue,
    unrealizedPnl: p.unrealizedPnl,
    markTimestamp: p.markTimestamp,
    markAgeMinutes: p.markAgeMinutes,
    initialRiskAmount: null,
    rMultiple: null,
  }));
}

/**
 * Derive WorkstationRisk from the two dashboard responses.
 *
 * Sources:
 *  - PTD realized data   → dashboard.kpis and dashboardV2.metrics
 *  - PTD drawdown        → dashboard.kpis
 *  - Current open risk   → dashboardV2.riskSummary
 *  - Current exposure    → dashboardV2.metrics.markedPositions
 *
 * The dashboard /api/dashboard response includes realized P&L and
 * drawdown metrics in the kpis block.  The V2 response includes
 * current-state metrics (open PnL, open risk, portfolio heat,
 * missing stops count) in its riskSummary, and gross exposure in
 * its metrics block.
 */
export function adaptRisk(
  dashboard: DashboardResponse,
  v2: DashboardV2Response,
): WorkstationRisk {
  return {
    ptd: {
      realizedPnl: String(dashboard.kpis.netPnl),
      realizedFees: v2.metrics.realizedFees ?? '0.00',
      drawdown:
        dashboard.kpis.currentDrawdown != null
          ? String(dashboard.kpis.currentDrawdown)
          : null,
      drawdownPct:
        dashboard.kpis.currentDrawdownPct != null
          ? String(dashboard.kpis.currentDrawdownPct)
          : null,
    },
    current: {
      openPnl: v2.riskSummary.openPnl ?? '0.00',
      openRisk: v2.riskSummary.openRisk ?? '0.00',
      portfolioHeat: v2.riskSummary.portfolioHeat,
      missingStops: v2.riskSummary.missingStops,
      positionsWithStop: v2.riskSummary.positionsWithStop,
      exposure: v2.metrics.markedPositions ?? '0.00',
    },
  };
}

/**
 * Adapt a V2 account object into the workstation account shape.
 * Pure pass-through — the V2 `account` field already matches the
 * { id, name, currency } shape.
 */
export function adaptV2Account(
  v2Account: DashboardV2Response['account'],
): WorkstationAccount {
  return {
    id: v2Account.id,
    name: v2Account.name,
    currency: v2Account.currency,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Live market prices (M005 remediation — fills marketIndices, symbolPrices,
// tradeIdeas gaps in liveDataToFixtures)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch live prices for a set of symbols from /api/watchlist/prices.
 *
 * Used for both market indices (SPX, NDX, RUT, VIX) and individual
 * watchlist symbols.  Returns a Record<symbol, QuoteResult> or an error.
 */
export async function fetchWatchlistPricesLive(
  symbols: string[],
  signal?: AbortSignal,
): Promise<LiveFetchResult<Record<string, QuoteResult>>> {
  // Build URL directly — small symbol lists keep the URL under size limits.
  const params = new URLSearchParams({ symbols: symbols.join(',') });

  const result = await fetchJson<{ prices: Record<string, QuoteResult> }>(
    `/api/watchlist/prices?${params.toString()}`,
    signal,
  );
  if (!result.success) return result;
  return { success: true, data: result.data.prices };
}

/**
 * Convert live market quotes for index symbols into MarketIndexSnapshot[].
 *
 * Fills lastPrice, change, and changePct from the QuoteResult.  When a quote
 * is missing or has a null price the index is omitted rather than rendered
 * as a fake zero — this prevents misleading displays.
 */
export function adaptMarketIndices(
  prices: Record<string, QuoteResult>,
): MarketIndexSnapshot[] {
  const indices: MarketIndexSnapshot[] = [];
  for (const symbol of MARKET_INDEX_SYMBOLS) {
    const quote = prices[symbol];
    if (!quote || quote.price === null) continue;
    indices.push({
      symbol: quote.symbol,
      lastPrice: quote.price,
      change: quote.change ?? 0,
      changePct: quote.changePercent ?? 0,
    });
  }
  return indices;
}

/** Derive gap and trigger-distance metrics from a single quote and a set of
 *  watchlist items for that symbol.  Returns null when the price is
 *  unavailable. */
function buildSingleSymbolPrice(
  quote: QuoteResult,
  watchlistForSymbol: WorkstationWatchlistItem[],
): SymbolPriceData | null {
  if (quote.price === null) return null;
  const lastPrice = quote.price;
  const previousClose = quote.previousClose ?? lastPrice;
  const gap = lastPrice - previousClose;
  const gapPct = previousClose !== 0 ? gap / previousClose : 0;

  const item = watchlistForSymbol[0];
  const triggerPrice = item?.triggerPrice ?? null;
  let distanceToTrigger: number | null = null;
  let distanceToTriggerPct: number | null = null;
  if (triggerPrice !== null && triggerPrice > 0 && lastPrice > 0) {
    distanceToTrigger = Math.abs(lastPrice - triggerPrice);
    distanceToTriggerPct = distanceToTrigger / triggerPrice;
  }

  return {
    symbol: quote.symbol,
    lastPrice,
    previousClose,
    gap,
    gapPct,
    triggerPrice,
    distanceToTrigger,
    distanceToTriggerPct,
  };
}

/**
 * Convert a batch of market quotes into per-symbol price data with gap
 * and trigger-distance metrics for the watchlist proximity indicators.
 */
export function adaptSymbolPrices(
  prices: Record<string, QuoteResult>,
  watchlist: WorkstationWatchlistItem[],
): Record<string, SymbolPriceData> {
  const result: Record<string, SymbolPriceData> = {};
  for (const [symbol, quote] of Object.entries(prices)) {
    const wlItems = watchlist.filter(
      (w) => w.symbol.toUpperCase() === symbol.toUpperCase(),
    );
    if (wlItems.length === 0) continue;
    const data = buildSingleSymbolPrice(quote, wlItems);
    if (data) result[symbol] = data;
  }
  return result;
}

/** Round to 2 decimal places (same helper as fixture system). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Derive trade ideas from watchlist items with trigger prices that haven't
 * been promoted to a trade yet.  Ported from the fixture `buildTradeIdeas`
 * in src/lib/workstation-fixtures.ts — direction-aware risk/reward calculation.
 */
export function buildTradeIdeasFromWatchlist(
  watchlist: WorkstationWatchlistItem[],
  symbolPrices: Record<string, SymbolPriceData>,
  setupNames: Record<string, string> = {},
): TradeIdea[] {
  return watchlist
    .filter((item) => item.triggerPrice !== null && item.promotedTradeId === null)
    .map((item) => {
      const price = symbolPrices[item.symbol];
      const entryPrice = item.triggerPrice;
      const stopPrice = item.plannedStop;
      const targetPrice = item.targetPrice;

      let riskPerShare: number | null = null;
      let rewardPerShare: number | null = null;
      let riskRewardRatio: number | null = null;

      if (entryPrice !== null && stopPrice !== null) {
        if (item.direction === 'long') {
          riskPerShare = round2(entryPrice - stopPrice);
          if (targetPrice !== null) {
            rewardPerShare = round2(targetPrice - entryPrice);
          }
        } else {
          riskPerShare = round2(stopPrice - entryPrice);
          if (targetPrice !== null) {
            rewardPerShare = round2(entryPrice - targetPrice);
          }
        }
        if (riskPerShare > 0 && rewardPerShare !== null) {
          riskRewardRatio = round2(rewardPerShare / riskPerShare);
        }
      }

      const setupName =
        item.setupId && setupNames[item.setupId]
          ? setupNames[item.setupId]
          : null;

      return {
        watchlistItemId: item.id,
        symbol: item.symbol,
        name: item.name,
        direction: item.direction,
        setupId: item.setupId,
        setupName,
        entryPrice,
        stopPrice,
        targetPrice,
        riskPerShare,
        rewardPerShare,
        riskRewardRatio,
        status: item.status,
        lastPrice: price?.lastPrice ?? null,
      };
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// CURRENT-state acquisition boundary (M004 9D.1 §5)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bundled CURRENT workstation state for one account.  This is the
 * date-independent half of the live data: the Dashboard V2 snapshot,
 * watchlist, accounts, and derived positions all describe the account as it
 * is right now and must NEVER be scoped by a period (M004 9D.1 §3).
 */
export interface LiveCurrentDashboardData {
  dashboardV2: DashboardV2Response;
  watchlist: WorkstationWatchlistItem[];
  accounts: WorkstationAccount[];
  positions: WorkstationPosition[];
}

/**
 * Fetch only the CURRENT-state resources for one account, in parallel:
 *  - /api/dashboard/v2 (ledger-derived current snapshot)
 *  - /api/watchlist
 *  - /api/accounts unless skipAccounts (the caller owns the accounts list)
 *
 * Never fetches /api/dashboard V1 and never sends a date parameter.
 * On partial failure the first error is returned (V2, then watchlist, then
 * accounts) and any successful responses are discarded — the same
 * all-or-nothing policy as fetchAllLiveDashboardData.
 */
export async function fetchCurrentLiveDashboardData(
  accountId: string,
  signal?: AbortSignal,
  options?: { skipAccounts?: boolean },
): Promise<LiveFetchResult<LiveCurrentDashboardData>> {
  const skipAccounts = options?.skipAccounts === true;

  const [v2Result, wlResult, acctResult] = await Promise.all([
    fetchDashboardV2Live(accountId, signal),
    fetchWatchlistLive(signal),
    skipAccounts
      ? Promise.resolve({ success: true as const, data: [] as WorkstationAccount[] })
      : fetchAccountsLive(signal),
  ]);

  // Collect errors in order of priority
  const results: LiveFetchResult<unknown>[] = [v2Result, wlResult, acctResult];
  for (const r of results) {
    if (!r.success) return r as LiveFetchError;
  }

  const dashboardV2 = (v2Result as LiveFetchSuccess<DashboardV2Response>).data;
  const watchlist = (wlResult as LiveFetchSuccess<WorkstationWatchlistItem[]>).data;
  const accounts = (acctResult as LiveFetchSuccess<WorkstationAccount[]>).data;

  return {
    success: true,
    data: {
      dashboardV2,
      watchlist,
      accounts,
      positions: adaptPositions(dashboardV2.valuation.positions),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Batched fetch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all live dashboard data for one account in parallel.
 *
 * Composes the two explicit adapter boundaries (M004 9D.1 §7):
 *  1. the date-aware V1 dashboard fetch (retrospective analytics)
 *  2. the CURRENT-state acquisition (V2 snapshot + watchlist + accounts)
 *
 * On partial failure (some succeed, some fail) the first error is returned
 * in priority order — dashboard, then V2, then watchlist, then accounts —
 * and any successful responses are discarded.  This all-or-nothing approach
 * prevents the UI from rendering with half-live data.
 *
 * The optional `range` argument is reserved for Task 9D.2: it forwards an
 * already-resolved plain YMD range to the V1 fetch only.  The default call
 * with no range is behaviorally identical to the pre-9D.1 adapter, and the
 * CURRENT legs never receive any date parameter.
 */
export async function fetchAllLiveDashboardData(
  accountId: string,
  signal?: AbortSignal,
  options?: { skipAccounts?: boolean },
  range?: ResolvedDateRange,
): Promise<LiveFetchResult<LiveDashboardData>> {
  // When the caller owns the accounts list (e.g. the global AccountProvider
  // in the legacy shell, M007/D037), the accounts leg is redundant — skip it
  // so MTM polling does not re-fetch /api/accounts every 30s.
  const skipAccounts = options?.skipAccounts === true;

  const [dashResult, currentResult] = await Promise.all([
    fetchDashboardLive(accountId, signal, range),
    fetchCurrentLiveDashboardData(accountId, signal, { skipAccounts }),
  ]);

  // Collect errors in order of priority
  const results: LiveFetchResult<unknown>[] = [dashResult, currentResult];
  for (const r of results) {
    if (!r.success) return r as LiveFetchError;
  }

  const dashboard = (dashResult as LiveFetchSuccess<DashboardResponse>).data;
  const { dashboardV2, watchlist, accounts, positions } = (
    currentResult as LiveFetchSuccess<LiveCurrentDashboardData>
  ).data;

  return {
    success: true,
    data: {
      dashboard,
      dashboardV2,
      watchlist,
      accounts,
      positions,
      risk: adaptRisk(dashboard, dashboardV2),
    },
  };
}
