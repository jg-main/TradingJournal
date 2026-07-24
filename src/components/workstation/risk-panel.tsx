'use client';

// RiskPanel — PTD/current-state visual separation.
//
// Renders the workstation.fixtures.risk payload as a panel with two visually
// separated metric sections:
//   1. PTD (Period-to-Date) — realized P&L, realized fees, drawdown
//   2. Current State — open P&L, open risk, portfolio heat, missing stops, exposure
//
// Section headers are distinct uppercase sub-headers with a bottom border,
// visually lighter than the panel header so the hierarchy reads: panel → section → row.
//
// Consumes only WorkstationContext. Renders its own Panel chrome (header + body)
// so T04 can drop <RiskPanel /> directly into the grid.
//
// Data-testid attributes per slice verification contract:
//   ws-risk-panel, ws-risk-ptd-section, ws-risk-current-section

import { useWorkstation } from './workstation-context';
import type { WorkstationRisk } from '@/lib/workstation-fixtures';

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

function fmtInt(value: number | undefined): string {
  if (value === undefined) return '—';
  return String(value);
}

function fmtStopCoverage(current: WorkstationRisk['current']): string {
  const { positionsWithStop, missingStops } = current;
  const total = positionsWithStop + missingStops;
  if (total === 0) return '—';
  return `${positionsWithStop}/${total}`;
}

// ── Render helpers ──────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="ws-stat-row">
      <span>{label}</span>
      <span className={`ws-num ${className ?? ''}`}>{value}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function RiskPanel() {
  const { fixtures } = useWorkstation();
  const { risk } = fixtures;

  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'risk' }}
      data-testid="ws-risk-panel"
    >
      <div className="ws-panel-header">
        <span>Risk</span>
      </div>
      <div className="ws-panel-body">
        {/* ── PTD section ─────────────────────────────────────────────── */}
        <div
          className="ws-risk-section"
          data-testid="ws-risk-ptd-section"
        >
          <div className="ws-risk-section-header">PTD</div>
          <StatRow
            label="Realized P&L"
            value={fmtCurrency(risk.ptd.realizedPnl)}
            className={pnlClass(risk.ptd.realizedPnl)}
          />
          <StatRow
            label="Realized Fees"
            value={fmtCurrency(risk.ptd.realizedFees)}
          />
          <StatRow
            label="Drawdown"
            value={
              risk.ptd.drawdownPct !== null && Number(risk.ptd.drawdownPct) !== 0
                ? `${fmtCurrency(risk.ptd.drawdown)} (${fmtPct(risk.ptd.drawdownPct)})`
                : fmtCurrency(risk.ptd.drawdown)
            }
            className={pnlClass(risk.ptd.drawdown)}
          />
        </div>

        {/* ── Current State section ───────────────────────────────────── */}
        <div
          className="ws-risk-section"
          data-testid="ws-risk-current-section"
        >
          <div className="ws-risk-section-header">Current</div>
          <StatRow
            label="Open P&L"
            value={fmtCurrency(risk.current.openPnl)}
            className={pnlClass(risk.current.openPnl)}
          />
          <StatRow
            label="Open Risk"
            value={fmtCurrency(risk.current.openRisk)}
          />
          <StatRow
            label="Portfolio Heat"
            value={fmtPct(risk.current.portfolioHeat)}
          />
          <StatRow
            label="Missing Stops"
            value={fmtInt(risk.current.missingStops)}
            className={risk.current.missingStops > 0 ? 'ws-neg' : ''}
          />
          <StatRow
            label="Stop Coverage"
            value={fmtStopCoverage(risk.current)}
          />
          <StatRow
            label="Exposure"
            value={fmtCurrency(risk.current.exposure)}
          />
        </div>
      </div>
    </section>
  );
}
