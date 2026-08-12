'use client';

// RiskPanel — current exposure and risk summary band (S04 T02).
//
// Full-width horizontal band occupying the top row of the risk-first grid
// (requirements §5.1 area 3). Consumes ONLY the DashboardV2Response from
// the workstation context (fixtures.dashboardV2) — the same reconciled
// snapshot the alert strip and positions table consume. Classification is
// never re-implemented here: every cell renders an API-declared value or
// the API's qualified presentationLabel (valuation.presentationLabel,
// stopCoverage.presentationLabel) when completeness is partial/unavailable
// (§6.4 / §6.6) — a bare signed total is never presented for a partial sum.
//
// Cells (left → right):
//   Open positions — account-position count, plus the open journal trade
//     count as a sub-line when it differs (§5.1 area 3, §6.1).
//   Open P&L — signed total when valuation is complete, else the qualified
//     presentationLabel ('— Partial — N unpriced'); marked-subset P&L as a
//     subordinate sub-line when the API provides it.
//   Open risk — stopCoverage.presentationLabel when coverage is partial
//     ('Incomplete — N without a valid stop'), else riskSummary.openRisk.
//   Portfolio heat — same stop-coverage gating (§6.6), else heat %.
//   Stop coverage — withStop/openTrades, or the qualified label when partial.
//   Gross / Net exposure — metrics.grossExposure / netExposure.
//
// Largest concentration is intentionally omitted: the DashboardV2Response
// contract declares no concentration field, and the panel must not derive
// a financial aggregate the API does not provide.
//
// Data-testid attributes per slice verification contract:
//   ws-panel-risk, ws-risk-cell-{positions,open-pnl,open-risk,heat,coverage,gross,net}

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

/** Canonical-decimal percentage (e.g. '2.80' → '2.80%') — no ×100. */
function fmtPct(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function pnlClass(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  if (n > 0) return 'ws-pos';
  if (n < 0) return 'ws-neg';
  return '';
}

// ── Render helpers ──────────────────────────────────────────────────────

function RiskCell({
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
    <div className="ws-risk-cell" data-testid={testId}>
      <div className={`ws-risk-value ws-num ${valueClassName ?? ''}`}>
        {value}
      </div>
      <div className="ws-risk-label">{label}</div>
      {sub !== undefined && sub !== null && (
        <div className="ws-risk-sub ws-num">{sub}</div>
      )}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function RiskPanel() {
  const { fixtures } = useWorkstation();
  const { dashboardV2 } = fixtures;
  const { riskSummary, valuation, metrics, journalLinked } = dashboardV2;
  const { stopCoverage } = riskSummary;

  const positionsTotal = valuation.positionsTotal;
  const journalTrades = journalLinked.tradeCount;
  const coveragePartial = stopCoverage.state === 'partial';

  // ── Qualified values (never a bare signed total for a partial sum) ────
  const openPnl =
    valuation.state === 'complete'
      ? fmtCurrency(riskSummary.openPnl)
      : (valuation.presentationLabel ?? '—');
  const openPnlClass = valuation.state === 'complete' ? pnlClass(riskSummary.openPnl) : '';

  const openRisk = coveragePartial
    ? (stopCoverage.presentationLabel ?? 'Incomplete')
    : fmtCurrency(riskSummary.openRisk);
  const heat = coveragePartial
    ? (stopCoverage.presentationLabel ?? 'Incomplete')
    : fmtPct(riskSummary.portfolioHeat);
  const coverage = coveragePartial
    ? (stopCoverage.presentationLabel ?? 'Incomplete')
    : `${stopCoverage.withStop}/${stopCoverage.openTrades}`;

  const markedSubset =
    valuation.state !== 'complete' && valuation.markedSubsetPnl !== null
      ? `Marked subset ${fmtCurrency(valuation.markedSubsetPnl)}`
      : undefined;

  return (
    <section
      className="ws-panel ws-risk-band"
      style={{ gridArea: 'risk' }}
      data-testid="ws-panel-risk"
    >
      <div className="ws-panel-header">
        <span>Risk</span>
        <span className="ws-panel-meta ws-mono">
          {valuation.state === 'complete' ? 'current' : valuation.state} ·{' '}
          {stopCoverage.state} coverage
        </span>
      </div>
      <div className="ws-panel-body">
        <RiskCell
          label="Open positions"
          value={String(positionsTotal)}
          sub={
            journalTrades !== positionsTotal
              ? `${journalTrades} journal trades`
              : undefined
          }
          testId="ws-risk-cell-positions"
        />
        <RiskCell
          label="Open P&L"
          value={openPnl}
          sub={markedSubset}
          valueClassName={openPnlClass}
          testId="ws-risk-cell-open-pnl"
        />
        <RiskCell
          label="Open risk"
          value={openRisk}
          testId="ws-risk-cell-open-risk"
        />
        <RiskCell
          label="Portfolio heat"
          value={heat}
          testId="ws-risk-cell-heat"
        />
        <RiskCell
          label="Stop coverage"
          value={coverage}
          testId="ws-risk-cell-coverage"
        />
        <RiskCell
          label="Gross exposure"
          value={fmtCurrency(metrics.grossExposure)}
          testId="ws-risk-cell-gross"
        />
        <RiskCell
          label="Net exposure"
          value={fmtCurrency(metrics.netExposure)}
          testId="ws-risk-cell-net"
        />
      </div>
    </section>
  );
}
