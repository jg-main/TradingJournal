'use client';

// MarketStrip — compact horizontal ribbon showing major index levels.
//
// Renders 4 market indices (SPX, NDX, RUT, VIX) with last price, change, and
// change% from fixture context. Designed as a thin sub-ribbon that sits above
// the watchlist table inside the watchlist grid area. Color indicators
// (ws-pos / ws-neg) on change values follow the same scheme as the KPI strip.

import { useWorkstation } from './workstation-context';

function fmtIndexPrice(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function fmtSignedPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return '—';
  const sign = fraction > 0 ? '+' : '';
  return `${sign}${fraction.toFixed(2)}%`;
}

function changeClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n > 0) return 'ws-pos';
  if (n < 0) return 'ws-neg';
  return '';
}

export function MarketStrip() {
  const { fixtures } = useWorkstation();
  const { marketIndices } = fixtures;

  if (marketIndices.length === 0) {
    return (
      <div className="ws-market-strip" data-testid="ws-market-strip">
        <div className="ws-empty">No market data</div>
      </div>
    );
  }

  return (
    <div className="ws-market-strip" data-testid="ws-market-strip">
      {marketIndices.map((idx) => {
        const cls = changeClass(idx.change);
        return (
          <div
            key={idx.symbol}
            className="ws-market-index"
            data-testid={`ws-market-index-${idx.symbol}`}
          >
            <span className="ws-market-index-symbol">{idx.symbol}</span>
            <span className="ws-market-index-value ws-num">
              {fmtIndexPrice(idx.lastPrice)}
            </span>
            <span className={`ws-market-index-change ws-num ${cls}`}>
              {fmtSigned(idx.change)}
            </span>
            <span className={`ws-market-index-change-pct ws-num ${cls}`}>
              {fmtSignedPct(idx.changePct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
