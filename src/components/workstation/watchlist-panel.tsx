'use client';

// WatchlistPanel — terminal-dense enhanced watchlist table.
//
// Replaces S01's placeholder 4-column watchlist (Symbol, Dir, Status, Trigger)
// with an enhanced 7-column table showing symbol, direction, last price,
// gap %, trigger price, distance-to-trigger %, and status. Merges watchlist
// items from context with per-symbol price data from the extended fixture
// system (T01).
//
// Visual indicators:
//   ws-pos / ws-neg — gap direction color (green/red, same as KPI strip)
//   ws-approaching — distance < 2% from trigger (amber)
//   ws-urgent      — distance < 0.5% from trigger (bright orange)
//   ws-dir-long / ws-dir-short — direction color coding on the "Dir" column
//
// The component renders its own Panel chrome (header + body) with a
// MarketStrip sub-ribbon inside the panel body, so T04 can drop
// <WatchlistPanel /> directly into the grid without wrapping.

import { useWorkstation } from './workstation-context';
import { MarketStrip } from './market-strip';

// ── Formatters ──────────────────────────────────────────────────────────

function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function fmtAbsPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(2)}%`;
}

function gapClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n > 0) return 'ws-pos';
  if (n < 0) return 'ws-neg';
  return '';
}

function proximityClass(distancePct: number | null | undefined): string {
  if (distancePct === null || distancePct === undefined) return '';
  if (distancePct < 0.5) return 'ws-urgent';
  if (distancePct < 2.0) return 'ws-approaching';
  return '';
}

function dirClass(direction: 'long' | 'short'): string {
  return direction === 'long' ? 'ws-dir-long' : 'ws-dir-short';
}

function dirLabel(direction: 'long' | 'short'): string {
  return direction === 'long' ? 'L' : 'S';
}

export function WatchlistPanel() {
  const { fixtures } = useWorkstation();
  const { watchlist, symbolPrices } = fixtures;

  // ── Empty state ──────────────────────────────────────────────────────
  if (watchlist.length === 0) {
    return (
      <section
        className="ws-panel"
        style={{ gridArea: 'watchlist' }}
        data-testid="ws-panel-watchlist"
      >
        <div className="ws-panel-header">
          <span>Watchlist</span>
        </div>
        <div className="ws-panel-body">
          <div className="ws-empty" data-testid="ws-watchlist-empty">
            Watchlist is empty
          </div>
        </div>
      </section>
    );
  }

  // ── Populated state ──────────────────────────────────────────────────
  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'watchlist' }}
      data-testid="ws-panel-watchlist"
    >
      <div className="ws-panel-header">
        <span>Watchlist</span>
        <span className="ws-panel-meta ws-mono">
          {watchlist.length} items
        </span>
      </div>
      <div className="ws-panel-body">
        <MarketStrip />
        <table className="ws-table" data-testid="ws-watchlist-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Dir</th>
              <th className="ws-num">Last</th>
              <th className="ws-num">Gap%</th>
              <th className="ws-num">Trigger</th>
              <th className="ws-num">Dist%</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map((item) => {
              const price = symbolPrices[item.symbol];
              const gapCls = price ? gapClass(price.gapPct) : '';
              const proxCls = price
                ? proximityClass(price.distanceToTriggerPct)
                : '';

              return (
                <tr
                  key={item.id}
                  data-testid={`ws-watchlist-row-${item.symbol}`}
                >
                  <td className="ws-mono">{item.symbol}</td>
                  <td className={dirClass(item.direction)}>
                    {dirLabel(item.direction)}
                  </td>
                  <td className="ws-num">
                    {price ? fmtPrice(price.lastPrice) : '—'}
                  </td>
                  <td className={`ws-num ${gapCls}`}>
                    {price ? fmtSignedPct(price.gapPct) : '—'}
                  </td>
                  <td className="ws-num">
                    {item.triggerPrice !== null
                      ? fmtPrice(item.triggerPrice)
                      : '—'}
                  </td>
                  <td className={`ws-num ${proxCls}`}>
                    {price
                      ? fmtAbsPct(price.distanceToTriggerPct)
                      : '—'}
                  </td>
                  <td>
                    <span
                      className={`ws-status ws-status-${item.status}`}
                      data-testid={`ws-status-${item.symbol}`}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
