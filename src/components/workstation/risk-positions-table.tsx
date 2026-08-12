'use client';

// RiskPositionsTable — primary 'Open account positions: N' table (S04 T03).
//
// Consumes ONLY DashboardV2Response['valuation']['positions'] (the
// DashboardPositionSummary array) — the same reconciled snapshot the alert
// strip (T01) and risk band (T02) consume. Classification is never
// re-implemented here: every cell renders an API-declared value verbatim
// (markStatus, markProvenance, attribution, risk state), and the default
// sort uses only per-position state the API already computed.
//
// Columns (R034 / §7.1 Tier 1 / §8.1):
//   Symbol        — sticky instrument symbol (mono)
//   Attribution   — Journal / Account only / Mixed + linked-journal-trade count
//   Side/qty      — direction (L/S) + quantity
//   Avg cost      — open average cost
//   Mark          — price + data-state text + source + as-of; 'Unpriced' for
//                   missing marks (state is never conveyed by an amber dot
//                   alone — R034 §8.1)
//   Unrealized P&L— value, or — when incalculable (a partial sum is never
//                   presented as a complete value)
//   Active stop   — effective stop price or 'No valid stop'
//   Current risk  — remaining risk-to-stop or 'Incomplete'
//   Exposure      — marked value with mark-completeness state
//
// Default sort (R034): missing/invalid stop first, then missing/stale mark,
// then largest current risk or exposure. Exported as sortPositionsRiskFirst
// so the contract is unit-testable without a DOM.
//
// Readability (R034 §8.1): headers ≥12px (ws-text-xs), data cells ≥13px
// (ws-text-md), primary financial values 16px (ws-text-lg, the 16–20px
// tier), rows 36–40px (ws-row-md), tabular numerals on financial columns.
//
// Data-testid attributes (row/panel ids kept stable for the e2e
// row-navigation suite):
//   ws-panel-positions, ws-positions-table, ws-positions-empty,
//   ws-position-row-{symbol}, ws-position-cell-side, ws-position-cell-pnl,
//   ws-position-cell-risk, ws-position-cell-mark-state,
//   ws-mark-stale-indicator

import type { DashboardPositionSummary } from '@/lib/accounting/dashboard-v2';

// ═════════════════════════════════════════════════════════════════════════
// Risk-first default sort (pure, exported for unit tests)
// ═════════════════════════════════════════════════════════════════════════

/** Stop-state rank: no valid stop (0) sorts before a valid stop (1). */
function stopRank(position: DashboardPositionSummary): number {
  return position.risk.hasValidStop ? 1 : 0;
}

/** Mark-state ranks for risk-first sorting: lower = needs attention. */
function markRank(position: DashboardPositionSummary): number {
  switch (position.markStatus) {
    case 'missing':
      return 0;
    case 'stale':
      return 1;
    default:
      return 2;
  }
}

/**
 * Dollar magnitude for the tertiary sort key: current risk-to-stop when the
 * API computed it, else the marked value (exposure) as a size proxy, else 0.
 */
function sortMagnitude(position: DashboardPositionSummary): number {
  const risk = Number(position.risk.currentRiskToStop);
  if (Number.isFinite(risk)) return risk;
  const exposure = Number(position.markedValue);
  return Number.isFinite(exposure) ? exposure : 0;
}

/**
 * Risk-first default sort for the open-positions table (R034 §8.1):
 *   1. missing/invalid stop first,
 *   2. then missing/stale mark (missing < stale < fresh),
 *   3. then largest current risk or exposure (descending),
 *   4. symbol ascending as a deterministic tiebreak.
 *
 * Pure function of the API positions; returns a new array and never mutates
 * the input. The API aggregate is the authority — no freshness/coverage
 * classification is recomputed from raw timestamps or rows here.
 */
export function sortPositionsRiskFirst(
  positions: DashboardPositionSummary[],
): DashboardPositionSummary[] {
  return [...positions].sort((a, b) => {
    const byStop = stopRank(a) - stopRank(b);
    if (byStop !== 0) return byStop;
    const byMark = markRank(a) - markRank(b);
    if (byMark !== 0) return byMark;
    const byMagnitude = sortMagnitude(b) - sortMagnitude(a);
    if (byMagnitude !== 0) return byMagnitude;
    return a.symbol.localeCompare(b.symbol);
  });
}

// ═════════════════════════════════════════════════════════════════════════
// Formatters
// ═════════════════════════════════════════════════════════════════════════

function fmtCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact UTC rendering of an ISO-8601 timestamp for provenance sub-lines. */
function fmtTimestamp(value: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
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

/** Attribution display label (R034: Journal / Account only / Mixed). */
function attributionLabel(kind: DashboardPositionSummary['attribution']['kind']): string {
  switch (kind) {
    case 'journal':
      return 'Journal';
    case 'account_only':
      return 'Account only';
    case 'mixed':
      return 'Mixed';
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Cell renderers
// ═════════════════════════════════════════════════════════════════════════

/** Mark cell: price + data-state text + source + as-of (R034 §8.1). */
function MarkCell({ position }: { position: DashboardPositionSummary }) {
  const { markStatus, markPrice, markProvenance } = position;
  const isFresh = markStatus === 'fresh';
  const isMissing = markStatus === 'missing';
  const source = markProvenance.source ?? 'n/a';
  const asOf = fmtTimestamp(markProvenance.asOf);
  const title = `source ${source} · as-of ${asOf} · computed ${fmtTimestamp(markProvenance.computedAt)}`;

  return (
    <td className="ws-num">
      <div className="ws-cell-primary" title={title}>
        {!isFresh && (
          <span
            className="ws-mark-stale-indicator"
            data-testid="ws-mark-stale-indicator"
            aria-label={
              isMissing
                ? 'Mark data missing'
                : `Mark stale: ${position.markAgeMinutes ?? 0} min old`
            }
          />
        )}
        {isMissing ? 'Unpriced' : fmtCurrency(markPrice)}
      </div>
      {!isFresh && (
        <div className="ws-cell-sub ws-mono" data-testid="ws-position-cell-mark-state">
          {isMissing ? 'Missing mark' : 'Stale'} · {source} · {asOf}
        </div>
      )}
    </td>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════════

/**
 * RiskPositionsTable — self-contained panel rendering the primary open
 * account positions table in risk-first sort order. Prop-driven pure
 * consumer of API state (the same pattern as DataQualityAlertStrip): no
 * provider machinery, no local classification.
 */
export function RiskPositionsTable({
  positions,
}: {
  positions: DashboardPositionSummary[];
}) {
  const sorted = sortPositionsRiskFirst(positions);

  // ── Empty state (R034 §8.1: 'No open account positions', compact space) ──
  if (sorted.length === 0) {
    return (
      <section
        className="ws-panel"
        style={{ gridArea: 'positions' }}
        data-testid="ws-panel-positions"
        role="region"
        aria-label="Open account positions"
      >
        <div className="ws-panel-header">
          <span>Open account positions: 0</span>
        </div>
        <div className="ws-panel-body">
          <div className="ws-empty" data-testid="ws-positions-empty">
            No open account positions
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'positions' }}
      data-testid="ws-panel-positions"
      role="region"
      aria-label="Open account positions"
    >
      <div className="ws-panel-header">
        <span>Open account positions: {sorted.length}</span>
      </div>
      <div className="ws-panel-body">
        <table className="ws-table ws-positions-table" data-testid="ws-positions-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Attribution</th>
              <th>Side/qty</th>
              <th className="ws-num">Avg cost</th>
              <th className="ws-num">Mark</th>
              <th className="ws-num">Unrealized P&L</th>
              <th className="ws-num">Active stop</th>
              <th className="ws-num">Current risk</th>
              <th className="ws-num">Exposure</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((pos) => {
              const isFresh = pos.markStatus === 'fresh';
              const isMissing = pos.markStatus === 'missing';
              return (
                <tr
                  key={pos.instrumentId}
                  data-testid={`ws-position-row-${pos.symbol}`}
                >
                  <td className="ws-mono ws-pos-symbol">{pos.symbol}</td>

                  <td>
                    <div>{attributionLabel(pos.attribution.kind)}</div>
                    {pos.attribution.kind !== 'account_only' && (
                      <div className="ws-cell-sub ws-mono">
                        {pos.attribution.journalTradeCount} linked
                      </div>
                    )}
                  </td>

                  <td
                    className={dirClass(pos.direction)}
                    data-testid="ws-position-cell-side"
                  >
                    {dirLabel(pos.direction)} {pos.quantity}
                  </td>

                  <td className="ws-num">{fmtCurrency(pos.averageCost)}</td>

                  <MarkCell position={pos} />

                  <td
                    className={`ws-num ws-cell-primary ${pnlClass(pos.unrealizedPnl)}`}
                    data-testid="ws-position-cell-pnl"
                  >
                    {pos.unrealizedPnl === null ? '—' : fmtCurrency(pos.unrealizedPnl)}
                  </td>

                  <td className="ws-num">
                    {pos.risk.hasValidStop && pos.risk.stopPrice !== null ? (
                      fmtCurrency(pos.risk.stopPrice)
                    ) : (
                      <span className="ws-warn-text">No valid stop</span>
                    )}
                  </td>

                  <td
                    className="ws-num ws-cell-primary"
                    data-testid="ws-position-cell-risk"
                  >
                    {pos.risk.currentRiskToStop !== null ? (
                      fmtCurrency(pos.risk.currentRiskToStop)
                    ) : (
                      <span className="ws-warn-text">Incomplete</span>
                    )}
                  </td>

                  <td className="ws-num">
                    <div className="ws-cell-primary">
                      {fmtCurrency(pos.markedValue)}
                    </div>
                    {!isFresh && (
                      <div className="ws-cell-sub ws-mono">
                        {isMissing ? 'Unpriced' : 'Stale'}
                      </div>
                    )}
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
