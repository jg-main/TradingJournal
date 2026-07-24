'use client';

// PositionsPanel — terminal-dense 7-column open positions table.
//
// Renders the workstation.fixtures.positions array in a compact table
// with the 7 canonical columns: Symbol, Side, Size, Entry, Mark, uP&L, R.
// Consumes only WorkstationContext. Renders its own Panel chrome (header + body)
// so T04 can drop <PositionsPanel /> directly into the grid.
//
// Columns:
//   Symbol  — instrument symbol (mono)
//   Side    — direction (L/S) with color coding
//   Size    — quantity (right-aligned numeric)
//   Entry   — average cost (right-aligned currency)
//   Mark    — current mark price with stale indicator
//   uP&L    — unrealized P&L (right-aligned, colored by sign)
//   R       — R-multiple (right-aligned, colored by sign, null-safe)
//
// Visual indicators:
//   ws-dir-long / ws-dir-short — direction color coding
//   ws-pos / ws-neg            — P&L/R sign color
//   ws-mark-stale-indicator    — amber dot when markStatus is 'stale' or 'missing'
//
// Data-testid attributes per slice verification contract:
//   ws-positions-table, ws-positions-empty,
//   ws-position-row-{symbol}, ws-position-cell-r,
//   ws-mark-stale-indicator

import { useWorkstation } from './workstation-context';

// ── Formatters ──────────────────────────────────────────────────────────

function fmtCurrency(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtRMultiple(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}R`;
}

function pnlClass(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  if (n > 0) return 'ws-pos';
  if (n < 0) return 'ws-neg';
  return '';
}

function dirClass(direction: string | null): string {
  if (direction === 'long') return 'ws-dir-long';
  if (direction === 'short') return 'ws-dir-short';
  return '';
}

function dirLabel(direction: string | null): string {
  if (direction === 'long') return 'L';
  if (direction === 'short') return 'S';
  return '—';
}

function fmtSize(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value;
}

export function PositionsPanel() {
  const { fixtures } = useWorkstation();
  const { positions } = fixtures;

  // ── Empty state ──────────────────────────────────────────────────────
  if (positions.length === 0) {
    return (
      <section
        className="ws-panel"
        style={{ gridArea: 'positions' }}
        data-testid="ws-panel-positions"
      >
        <div className="ws-panel-header">
          <span>Positions</span>
        </div>
        <div className="ws-panel-body">
          <div className="ws-empty" data-testid="ws-positions-empty">
            No open positions
          </div>
        </div>
      </section>
    );
  }

  // ── Populated state ──────────────────────────────────────────────────
  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'positions' }}
      data-testid="ws-panel-positions"
    >
      <div className="ws-panel-header">
        <span>Positions</span>
        <span className="ws-panel-meta ws-mono">
          {positions.length} open
        </span>
      </div>
      <div className="ws-panel-body">
        <table className="ws-table" data-testid="ws-positions-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th className="ws-num">Size</th>
              <th className="ws-num">Entry</th>
              <th className="ws-num">Mark</th>
              <th className="ws-num">uP&L</th>
              <th className="ws-num">R</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const isStale = pos.markStatus === 'stale';
              const isMissing = pos.markStatus === 'missing';
              const needsIndicator = isStale || isMissing;

              return (
                <tr
                  key={pos.instrumentId}
                  data-testid={`ws-position-row-${pos.symbol}`}
                >
                  <td className="ws-mono">{pos.symbol}</td>
                  <td className={dirClass(pos.direction)}>
                    {dirLabel(pos.direction)}
                  </td>
                  <td className="ws-num">
                    {fmtSize(pos.quantity)}
                  </td>
                  <td className="ws-num">
                    {fmtCurrency(pos.averageCost)}
                  </td>
                  <td className="ws-num">
                    {needsIndicator && (
                      <span
                        className="ws-mark-stale-indicator"
                        data-testid="ws-mark-stale-indicator"
                        aria-label={
                          isMissing
                            ? 'Mark data missing'
                            : `Mark stale: ${pos.markAgeMinutes} min old`
                        }
                      />
                    )}
                    {isMissing
                      ? '—'
                      : fmtCurrency(pos.markPrice)}
                  </td>
                  <td className={`ws-num ${pnlClass(pos.unrealizedPnl)}`}>
                    {fmtCurrency(pos.unrealizedPnl)}
                  </td>
                  <td
                    className={`ws-num ${pnlClass(pos.rMultiple)}`}
                    data-testid="ws-position-cell-r"
                  >
                    {fmtRMultiple(pos.rMultiple)}
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
