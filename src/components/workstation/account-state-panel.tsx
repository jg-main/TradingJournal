'use client';

// AccountStatePanel — account-level financial state summary (S07).
//
// Renders a compact metrics grid sourced exclusively from the workstation
// context (fixtures.dashboardV2.metrics + fixtures.dashboardV2.valuation),
// followed by the EquityChart and a drawdown summary from
// fixtures.dashboard.
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
//   Unrealized P&L    — metrics.unrealizedPnl (PnL coloured) + qualifier
//   Total P&L         — metrics.totalPnl (PnL coloured) + qualifier
//   Drawdown          — metrics.drawdown + drawdownPct (ALWAYS ws-neg)

import { useWorkstation } from './workstation-context';
import { EquityChart } from './equity-chart';
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
  // 'complete' or 'stale' — no qualifier needed
  return '';
}

/** NAV qualification label. */
function navQualification(state: ValuationState): string {
  if (state === 'complete') return 'Full';
  if (state === 'partial') return 'Partial';
  if (state === 'unavailable') return 'Ledger only';
  // 'stale' — treat like partial
  return 'Partial';
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
    <div className="ws-stat-row" data-testid={testId}>
      <span>{label}</span>
      <span className={`ws-num ${valueClassName ?? ''}`}>{value}</span>
      {sub !== undefined && sub !== '' && (
        <span className="ws-mono" style={{ fontSize: '11px', opacity: 0.7 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function AccountStatePanel() {
  const { fixtures } = useWorkstation();
  const { dashboardV2, dashboard } = fixtures;
  const { metrics, valuation } = dashboardV2;

  const vState = valuation.state;

  // ── Derived cell values ─────────────────────────────────────────────
  const cashSub = fmtDate(metrics.provenance.asOf);

  const markedSub = markedPositionsQualifier(vState);

  const navValue = fmtCurrency(metrics.nav);
  const navSub = navQualification(vState);

  const realizedClass = pnlClass(metrics.realizedPnl);

  const unrealizedClass = pnlClass(metrics.unrealizedPnl);
  const unrealizedSub =
    vState === 'complete'
      ? 'Open positions'
      : (valuation.presentationLabel ?? '');

  const totalClass = pnlClass(metrics.totalPnl);
  const totalSub =
    vState === 'complete'
      ? 'Realized + Unrealized'
      : (valuation.presentationLabel ?? '');

  // Drawdown is ALWAYS negative class — it represents a loss from peak.
  const drawdownValue = fmtCurrency(metrics.drawdown);
  const drawdownPct = fmtPct(metrics.drawdownPct);
  const drawdownDisplay =
    drawdownValue !== '—'
      ? `${drawdownValue} (${drawdownPct})`
      : drawdownValue;

  // ── Equity chart data ───────────────────────────────────────────────
  const equityCurve = dashboard.equityCurve;
  const drawdownData = dashboard.drawdown;
  const tradeMarkers = dashboard.tradeMarkers ?? [];

  // ── Drawdown summary from kpis ──────────────────────────────────────
  const kpis = dashboard.kpis;
  const currentDd = kpis.currentDrawdown;
  const currentDdPct = kpis.currentDrawdownPct;

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
            label="Marked positions"
            value={fmtCurrency(metrics.markedPositions)}
            sub={markedSub}
            testId="ws-account-state-marked"
          />
          <StatCell
            label="NAV"
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
            label="Unrealized P&L"
            value={fmtCurrency(metrics.unrealizedPnl)}
            sub={unrealizedSub}
            valueClassName={unrealizedClass}
            testId="ws-account-state-unrealized"
          />
          <StatCell
            label="Total P&L"
            value={fmtCurrency(metrics.totalPnl)}
            sub={totalSub}
            valueClassName={totalClass}
            testId="ws-account-state-total"
          />
          <StatCell
            label="Drawdown"
            value={drawdownDisplay}
            sub="from peak"
            valueClassName="ws-neg"
            testId="ws-account-state-drawdown"
          />
        </div>

        {/* Equity chart */}
        <div style={{ marginTop: '8px', minHeight: '180px' }}>
          <EquityChart
            equityCurve={equityCurve}
            drawdown={drawdownData}
            tradeMarkers={tradeMarkers}
          />
        </div>

        {/* Compact drawdown summary */}
        <div
          className="ws-stat-row"
          data-testid="ws-account-state-dd-summary"
          style={{ marginTop: '4px' }}
        >
          <span>Current drawdown</span>
          <span className="ws-num ws-neg">
            {currentDd !== null
              ? fmtCurrency(String(currentDd))
              : '—'}
            {currentDdPct !== null ? ` (${fmtPct(String(currentDdPct))})` : ''}
          </span>
        </div>
      </div>
    </section>
  );
}
