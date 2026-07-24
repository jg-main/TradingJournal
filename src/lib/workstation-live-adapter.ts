/**
 * Workstation Live Data Adapter
 *
 * Fetches real data from the /api/dashboard, /api/dashboard/v2, /api/watchlist,
 * and /api/accounts endpoints and transforms the responses into the shapes
 * consumed by workstation panels (DashboardResponse, DashboardV2Response,
 * WorkstationWatchlistItem[], WorkstationAccount[], WorkstationPosition[],
 * WorkstationRisk).
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

import type { DashboardResponse, WorkstationPosition, WorkstationRisk, WorkstationWatchlistItem } from '@/lib/workstation-fixtures';
import type { DashboardV2Response, DashboardPositionSummary } from '@/lib/accounting/dashboard-v2';

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
async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<LiveFetchResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
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
 */
export async function fetchDashboardLive(
  accountId: string,
  signal?: AbortSignal,
): Promise<LiveFetchResult<DashboardResponse>> {
  const params = new URLSearchParams({ accountId });
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
      openPnl: v2.riskSummary.openPnl,
      openRisk: v2.riskSummary.openRisk,
      portfolioHeat: v2.riskSummary.portfolioHeat,
      missingStops: v2.riskSummary.missingStops,
      positionsWithStop: v2.riskSummary.positionsWithStop,
      exposure: v2.metrics.markedPositions,
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
// Batched fetch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all live dashboard data for one account in parallel.
 *
 * Requests dashboard, dashboardV2, watchlist, and accounts concurrently.
 * On partial failure (some succeed, some fail) the first error is returned
 * and any successful responses are discarded.  This all-or-nothing approach
 * prevents the UI from rendering with half-live data.
 */
export async function fetchAllLiveDashboardData(
  accountId: string,
  signal?: AbortSignal,
): Promise<LiveFetchResult<LiveDashboardData>> {
  const [dashResult, v2Result, wlResult, acctResult] = await Promise.all([
    fetchDashboardLive(accountId, signal),
    fetchDashboardV2Live(accountId, signal),
    fetchWatchlistLive(signal),
    fetchAccountsLive(signal),
  ]);

  // Collect errors in order of priority
  const results: LiveFetchResult<unknown>[] = [dashResult, v2Result, wlResult, acctResult];
  for (const r of results) {
    if (!r.success) return r as LiveFetchError;
  }

  const dashboard = (dashResult as LiveFetchSuccess<DashboardResponse>).data;
  const dashboardV2 = (v2Result as LiveFetchSuccess<DashboardV2Response>).data;
  const watchlist = (wlResult as LiveFetchSuccess<WorkstationWatchlistItem[]>).data;
  const accounts = (acctResult as LiveFetchSuccess<WorkstationAccount[]>).data;

  return {
    success: true,
    data: {
      dashboard,
      dashboardV2,
      watchlist,
      accounts,
      positions: adaptPositions(dashboardV2.valuation.positions),
      risk: adaptRisk(dashboard, dashboardV2),
    },
  };
}
