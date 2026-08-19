'use client';

// TradesWorkspacePanel — full-width tabbed Trades workspace (M017/S03).
//
// Switches between the current open workflow and the historical closed
// workflow (DASHBOARD_DENSE_LAYOUT_REQUIREMENTS §Trades workspace). Tab
// labels state their real universe — "Open positions" and "Closed trades" —
// and each tab's totals come from exactly one source, so a current account
// total can never be mixed with a period-filtered total:
//
//   Open tab   → DashboardV2Response['valuation']['positions'] (the same
//                reconciled snapshot the alert strip and risk band
//                consume), rendered by RiskPositionsTableContent with its
//                canonical live mark / risk / data-quality indicators.
//   Closed tab → GET /api/trades?status=closed&accountId=… (server-computed
//                full-dataset totals for the filtered closed universe),
//                scoped to the active account from WorkstationContext.
//
// The outer wrapper keeps the `ws-panel-positions` testid and the
// `gridArea: 'trades'` grid cell so existing e2e assertions that target the
// panel survive; the inner open-table testids (ws-positions-table,
// ws-position-row-*, ws-positions-empty, …) are preserved unchanged. The
// `ws-trades-tab-open` / `ws-trades-tab-closed` testids pin the tab labels.
//
// Loading / error / empty states are first-class: a failed closed-trades
// fetch renders an in-panel error with Retry and never throws; it is
// surfaced, not swallowed, so live-mode failures stay visible (Q5).

import { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkstation } from './workstation-context';
import { RiskPositionsTableContent } from './risk-positions-table';
import { formatPnl } from '@/lib/format-pnl';
import {
  formatDateShort,
  formatPercent,
  formatRMultiple,
} from '@/lib/trade-formatters';
import type { DashboardPositionSummary } from '@/lib/accounting/dashboard-v2';

// ── Closed-trades API contract (subset of GET /api/trades) ─────────────

/** One closed trade row as returned by GET /api/trades?status=closed. */
export interface ClosedTradeRow {
  id: string;
  tradeCode: string | null;
  symbol: string | null;
  direction: 'long' | 'short' | null;
  setupName: string | null;
  closedAt: string | null;
  realizedPnl: number | null;
  returnPct: number | null;
  metrics?: {
    position?: {
      closedAt: string | null;
      holdingPeriodDays: number | null;
    };
    returnMetrics?: {
      rMultiple: number | null;
    };
  };
}

/** Server-computed aggregates over the full filtered dataset (never the
 *  current page only). */
export interface ClosedTradesTotals {
  grossRealizedPnl: number;
  netRealizedPnl: number;
  totalFees: number;
  grossUnrealizedPnl: number | null;
  netUnrealizedPnl: number | null;
  totalOpenRisk: number;
  portfolioHeatAmount: number;
  portfolioHeatPct: number;
  unpricedOpenPositions: number;
}

export interface ClosedTradesResponse {
  data: ClosedTradeRow[];
  total: number;
  page: number;
  limit: number;
  totals: ClosedTradesTotals;
}

/** Closed-tab fetch state machine. `requestKey` identifies which request
 *  produced a ready/error state so stale data from a previous account or
 *  retry is never displayed while the new fetch is in flight. */
export type ClosedTradesState =
  | { status: 'loading' }
  | { status: 'error'; requestKey: string; message: string }
  | { status: 'ready'; requestKey: string; data: ClosedTradesResponse };

/** How many closed trades the panel requests (latest first). */
const CLOSED_LIMIT = 50;

// ── Formatters ─────────────────────────────────────────────────────────

/** P&L sign class using the workstation palette (same as the open table). */
function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value > 0) return 'ws-pos';
  if (value < 0) return 'ws-neg';
  return '';
}

function directionLabel(direction: 'long' | 'short' | null): string {
  if (direction === 'long') return 'L';
  if (direction === 'short') return 'S';
  return '—';
}

function directionClass(direction: 'long' | 'short' | null): string {
  if (direction === 'long') return 'ws-dir-long';
  if (direction === 'short') return 'ws-dir-short';
  return '';
}

// ── Closed tab body ────────────────────────────────────────────────────

function ClosedTabBody({
  state,
  onRetry,
}: {
  state: ClosedTradesState;
  onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <div className="ws-empty" data-testid="ws-trades-closed-loading" role="status">
        Loading closed trades…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div
        className="ws-trades-error"
        data-testid="ws-trades-closed-error"
        role="alert"
      >
        <span>Closed trades unavailable: {state.message}</span>
        <button
          type="button"
          className="ws-trades-retry"
          data-testid="ws-trades-closed-retry"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    );
  }

  const { data } = state;

  if (data.data.length === 0) {
    return (
      <div className="ws-empty" data-testid="ws-trades-closed-empty">
        No closed trades for this account
      </div>
    );
  }

  // The table shows the most recent page; the universe line states exactly
  // what is visible so the panel never implies a complete history it did
  // not render. The totals below are server-computed over the full
  // filtered closed dataset.
  const scopeText =
    data.total <= data.data.length
      ? `All ${data.total.toLocaleString('en-US')} closed trades`
      : `Latest ${data.data.length} of ${data.total.toLocaleString('en-US')} closed trades`;

  return (
    <>
      <div className="ws-trades-scope" data-testid="ws-trades-closed-scope">
        {scopeText}
      </div>
      <table className="ws-table" data-testid="ws-trades-closed-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Setup</th>
            <th>Exit date</th>
            <th className="ws-num">Net P&L</th>
            <th className="ws-num">Return %</th>
            <th className="ws-num">R-Multiple</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((trade) => (
            <tr
              key={trade.id}
              data-testid={`ws-trades-closed-row-${trade.symbol ?? trade.id}`}
            >
              <td className="ws-mono">{trade.symbol ?? '—'}</td>
              <td className={directionClass(trade.direction)}>
                {directionLabel(trade.direction)}
              </td>
              <td className="ws-cell-sub">{trade.setupName ?? '—'}</td>
              <td className="ws-cell-sub ws-num">
                {formatDateShort(trade.metrics?.position?.closedAt ?? trade.closedAt)}
              </td>
              <td
                className={`ws-num ws-cell-primary ${pnlClass(trade.realizedPnl)}`}
                data-testid="ws-trades-closed-cell-pnl"
              >
                {formatPnl(trade.realizedPnl)}
              </td>
              <td className={`ws-num ${pnlClass(trade.returnPct)}`}>
                {formatPercent(trade.returnPct)}
              </td>
              <td className={`ws-num ${pnlClass(trade.metrics?.returnMetrics?.rMultiple ?? null)}`}>
                {formatRMultiple(trade.metrics?.returnMetrics?.rMultiple ?? null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Scoped totals: every figure in this footer derives from the
          closed-trades API response only — never an open/current account
          total (no-mixing invariant). The label states the scope. */}
      <div className="ws-trades-totals" data-testid="ws-trades-closed-totals">
        <span className="ws-trades-totals-label">Net P&L · all closed trades</span>
        <span
          className={`ws-trades-totals-value ws-num ${pnlClass(data.totals.netRealizedPnl)}`}
          data-testid="ws-trades-closed-net-pnl"
        >
          {formatPnl(data.totals.netRealizedPnl)}
        </span>
      </div>
    </>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────

/**
 * TradesWorkspacePanel — the full-width Trades workspace with Open/current
 * and Closed/historical tabs. The Open tab is the current open account
 * positions workflow (fixtures/live valuation snapshot); the Closed tab
 * fetches the account's closed trades from the API with server-computed
 * scoped totals. Tab labels state their real universe; switching tabs never
 * mixes a current account total with a period-filtered total.
 */
export function TradesWorkspacePanel({
  positions,
}: {
  positions: DashboardPositionSummary[];
}) {
  const { activeAccountId } = useWorkstation();

  const [closed, setClosed] = useState<ClosedTradesState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  const handleRetry = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  // Request identity: the closed-tab fetch is scoped to the active account
  // and one retry generation. A change in either must invalidate any stale
  // ready/error state immediately (no cross-account leftovers).
  const requestKey = `${activeAccountId}:${reloadKey}`;

  // React-sanctioned render adjustment (same idiom as workstation-context):
  // when the request identity changes (account switch or retry), drop the
  // previous request's data synchronously so the panel never shows another
  // account's closed trades (or a stale error) while the new fetch is in
  // flight. The effect only writes ready/error from async callbacks.
  if (
    (closed.status === 'ready' || closed.status === 'error') &&
    closed.requestKey !== requestKey
  ) {
    setClosed({ status: 'loading' });
  }

  useEffect(() => {
    if (!activeAccountId) return;
    const controller = new AbortController();
    let cancelled = false;

    const params = new URLSearchParams({
      status: 'closed',
      accountId: activeAccountId,
      limit: String(CLOSED_LIMIT),
    });

    fetch(`/api/trades?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Trades API responded ${res.status}`);
        }
        return (await res.json()) as ClosedTradesResponse;
      })
      .then((data) => {
        if (cancelled || controller.signal.aborted) return;
        setClosed({ status: 'ready', requestKey, data });
      })
      .catch((err: unknown) => {
        // Abort is a lifecycle event (account switch / unmount), not a
        // user-visible fetch error.
        if (cancelled || controller.signal.aborted) return;
        setClosed({
          status: 'error',
          requestKey,
          message: err instanceof Error ? err.message : 'unknown error',
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeAccountId, reloadKey, requestKey]);

  const closedCount = closed.status === 'ready' ? closed.data.total : null;

  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'trades' }}
      data-testid="ws-panel-positions"
      role="region"
      aria-label="Trades workspace"
    >
      <div className="ws-panel-header">
        <span>Trades Workspace</span>
      </div>
      <div className="ws-panel-body">
        <Tabs defaultValue="open" className="ws-trades-root">
          <TabsList className="ws-trades-tabs" aria-label="Trades workspace scope">
            <TabsTrigger
              value="open"
              className="ws-trades-tab"
              data-testid="ws-trades-tab-open"
            >
              Open positions
              <span className="ws-trades-tab-count ws-num" data-testid="ws-trades-open-count">
                {positions.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="closed"
              className="ws-trades-tab"
              data-testid="ws-trades-tab-closed"
            >
              Closed trades
              {closedCount !== null && (
                <span
                  className="ws-trades-tab-count ws-num"
                  data-testid="ws-trades-closed-count"
                >
                  {closedCount.toLocaleString('en-US')}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="open"
            className="ws-trades-content"
            data-testid="ws-trades-open-content"
          >
            <RiskPositionsTableContent positions={positions} />
          </TabsContent>

          <TabsContent
            value="closed"
            className="ws-trades-content"
            data-testid="ws-trades-closed-content"
          >
            <ClosedTabBody state={closed} onRetry={handleRetry} />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
