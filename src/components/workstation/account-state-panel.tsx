'use client';

// AccountStatePanel — account-level financial state summary (S07, dense S02).
//
// Renders a compact metrics grid sourced exclusively from the workstation
// context (fixtures.dashboardV2.metrics + fixtures.dashboardV2.valuation).
// The equity/drawdown chart and its compact drawdown summary row were
// removed in M017/S02: the chart moves to the future analysis workspace
// (DASHBOARD_DENSE_LAYOUT_REQUIREMENTS), so this summary panel carries only
// stat cells — account balances, valuation state, current Open P&L,
// realized/total P&L with stated scope, and drawdown.
//
// Every cell renders an API-declared value; classification is never
// re-implemented. Valuation qualifiers (valuation.state, presentationLabel)
// are rendered verbatim so a partial or unavailable aggregate can never
// look like a complete total.
//
// Metrics grid cells:
//   Cash              — metrics.cash + provenance.asOf
//   Marked positions  — metrics.markedPositions + valuation qualifier
//   NAV               — metrics.nav + valuation qualification
//   Realized P&L      — metrics.realizedPnl (PnL coloured)
//   Open P&L          — riskSummary.openPnl (PnL coloured) + qualifier.
//                        This is the current account-position valuation used
//                        by the risk strip; never substitute the persisted
//                        period-performance projection here.
//   Total P&L         — metrics.totalPnl (PnL coloured), explicitly scoped
//                        to the period-performance projection.
//   Time-Weighted Return — metrics.twr (canonical Dashboard V2 value,
//                        formatted as a percentage; null → dash).
//   Modified Dietz Return — metrics.modifiedDietzReturn (canonical Dashboard
//                        V2 value, formatted as a percentage; null → dash).
//   Drawdown          — metrics.drawdown + drawdownPct (ALWAYS ws-neg)

import { useWorkstation } from './workstation-context';
import type { DashboardV2Response } from '@/lib/accounting/dashboard-v2';

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

function pnlClass(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  if (n > 0) return 'ws-pos';
  if (n < 0) return 'ws-neg';
  return '';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtPct(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(2)}%`;
}

// ── Valuation qualifiers ────────────────────────────────────────────────

type ValuationState = DashboardV2Response['valuation']['state'];

/** Sub-line text for marked positions based on valuation completeness. */
function markedPositionsQualifier(state: ValuationState): string {
  if (state === 'partial') return 'Partial valuation';
  if (state === 'unavailable') return 'Unavailable';
  if (state === 'stale') return 'Stale valuation';
  // 'complete'
  return '';
}

/** NAV qualification label. */
function navQualification(state: ValuationState): string {
  if (state === 'complete') return 'Full';
  if (state === 'partial') return 'Partial';
  if (state === 'unavailable') return 'Ledger only';
  return 'Stale valuation';
}

// ── Stat cell ───────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  sub,
  valueClassName,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  testId: string;
}) {
  return (
    <div className="ws-account-stat-row" data-testid={testId}>
      <div className="ws-account-stat-label">
        <span>{label}</span>
        {sub !== undefined && sub !== '' && (
          <span className="ws-account-stat-meta ws-mono">{sub}</span>
        )}
      </div>
      <span className={`ws-account-stat-value ws-num ${valueClassName ?? ''}`}>{value}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function AccountStatePanel() {
  const { fixtures } = useWorkstation();
  const { dashboardV2 } = fixtures;
  const { metrics, valuation, riskSummary } = dashboardV2;

  const vState = valuation.state;
  const valuationIsComplete = vState === 'complete';
  const valuationIsStale = vState === 'stale';
  const valuationIsPriced = valuationIsComplete || valuationIsStale;
  const qualifiedValuation =
    valuation.presentationLabel ??
    (vState === 'unavailable' ? '— Unavailable' : '— Partial valuation');

  // ── Derived cell values ─────────────────────────────────────────────
  const cashSub = fmtDate(metrics.provenance.asOf);

  const markedSub = markedPositionsQualifier(vState);
  const markedValue = valuationIsPriced
    ? fmtCurrency(metrics.markedPositions)
    : qualifiedValuation;
  const markedLabel = valuationIsStale ? 'Stale marked positions' : 'Marked positions';

  const navValue = valuationIsPriced ? fmtCurrency(metrics.nav) : qualifiedValuation;
  const navSub = navQualification(vState);
  const navLabel = valuationIsStale ? 'Stale NAV' : 'NAV';

  const realizedClass = pnlClass(metrics.realizedPnl);

  // Current open P&L has one owner in the dashboard snapshot:
  // riskSummary.openPnl. The period-performance projection's
  // metrics.unrealizedPnl can have an earlier as-of timestamp, so using it
  // here would display a stale number beside the current risk strip.
  const openPnlValue = valuationIsPriced
    ? fmtCurrency(riskSummary.openPnl)
    : qualifiedValuation;
  const openPnlClass = valuationIsPriced ? pnlClass(riskSummary.openPnl) : '';
  const openPnlSub =
    valuationIsComplete
      ? 'Open positions'
      : valuationIsStale
        ? 'Last marked value'
        : qualifiedValuation;
  const openPnlLabel = valuationIsStale ? 'Stale Open P&L' : 'Open P&L';

  const totalValue = valuationIsPriced
    ? fmtCurrency(metrics.totalPnl)
    : qualifiedValuation;
  const totalClass = valuationIsPriced ? pnlClass(metrics.totalPnl) : '';
  // Presentation-only scope wording (M004 9D.2 §16): "Account performance"
  // is faithful to the V2 account_performance projection and cannot be
  // mistaken for the sidebar's user-selected global Period. The underlying
  // value is unchanged.
  const totalSub = valuationIsPriced
    ? `Account performance · ${fmtDate(metrics.provenance.asOf)}`
    : qualifiedValuation;
  const totalLabel = valuationIsStale ? 'Stale Total P&L' : 'Total P&L';

  // Canonical period-performance returns — formatted exactly as supplied by
  // Dashboard V2 (never recomputed client-side). Null → dash. Positive and
  // negative values use the established P&L colouring; zero stays neutral.
  const twrValue = fmtPct(metrics.twr);
  const twrClass = pnlClass(metrics.twr);
  const dietzValue = fmtPct(metrics.modifiedDietzReturn);
  const dietzClass = pnlClass(metrics.modifiedDietzReturn);

  // Drawdown is ALWAYS negative class — it represents a loss from peak.
  const drawdownValue = fmtCurrency(metrics.drawdown);
  const drawdownPct = fmtPct(metrics.drawdownPct);
  const drawdownDisplay =
    drawdownValue !== '—'
      ? `${drawdownValue} (${drawdownPct})`
      : drawdownValue;

  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'account' }}
      data-testid="ws-panel-account-state"
    >
      <div className="ws-panel-header">
        <span>Account State</span>
        <span className="ws-panel-meta ws-mono">
          {vState} · {metrics.provenance.source}
        </span>
      </div>
      <div className="ws-panel-body">
        {/* Metrics grid */}
        <div data-testid="ws-account-state-metrics">
          <StatCell
            label="Cash"
            value={fmtCurrency(metrics.cash)}
            sub={cashSub}
            testId="ws-account-state-cash"
          />
          <StatCell
            label={markedLabel}
            value={markedValue}
            sub={markedSub}
            testId="ws-account-state-marked"
          />
          <StatCell
            label={navLabel}
            value={navValue}
            sub={navSub}
            testId="ws-account-state-nav"
          />
          <StatCell
            label="Realized P&L"
            value={fmtCurrency(metrics.realizedPnl)}
            sub="Closed positions"
            valueClassName={realizedClass}
            testId="ws-account-state-realized"
          />
          <StatCell
            label={openPnlLabel}
            value={openPnlValue}
            sub={openPnlSub}
            valueClassName={openPnlClass}
            testId="ws-account-state-open-pnl"
          />
          <StatCell
            label={totalLabel}
            value={totalValue}
            sub={totalSub}
            valueClassName={totalClass}
            testId="ws-account-state-total"
          />
          <StatCell
            label="Time-Weighted Return"
            value={twrValue}
            sub="Account performance"
            valueClassName={twrClass}
            testId="ws-account-state-twr"
          />
          <StatCell
            label="Modified Dietz Return"
            value={dietzValue}
            sub="Account performance"
            valueClassName={dietzClass}
            testId="ws-account-state-modified-dietz"
          />
          <StatCell
            label="Drawdown"
            value={drawdownDisplay}
            sub="from peak"
            valueClassName="ws-neg"
            testId="ws-account-state-drawdown"
          />
        </div>
      </div>
    </section>
  );
}
