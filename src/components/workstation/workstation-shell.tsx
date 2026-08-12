'use client';

// WorkstationShell — risk-first CSS Grid layout proving the S04 concept at
// 2560×1440 and effective 1536×960. Named grid-template-areas give each
// panel a fixed, purpose-built region following the requirements §5.1
// vertical priority: risk summary band (top, full width) → open positions
// (tall dominant left column) → account state / watchlist / insights on the
// right rail → compact period-performance KPI band at the bottom. The
// data-quality alert strip (T01) renders above the grid, outside the grid,
// so it stays visible whenever a current-value condition fires. Panels
// scroll internally and the surface itself never scrolls (see .ws and
// .ws-grid in workstation.css).
//
// Panels render real fixture data (not lorem ipsum) so the browser evidence
// in T04 measures realistic density. S06 swaps the fixture source in context
// for live API data without touching these panels.

import { useWorkstation } from './workstation-context';
import { DataQualityAlertStrip } from './data-quality-alert-strip';
import { RiskPositionsTable } from './risk-positions-table';
import { RiskPanel } from './risk-panel';
import { WatchlistPanel } from './watchlist-panel';
import { AccountStatePanel } from './account-state-panel';
import { PerformancePanel } from './performance-panel';
import { ProcessReviewPanel } from './process-review-panel';

function fmtCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return '—';
  return `${(fraction * 100).toFixed(1)}%`;
}

function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n > 0) return 'ws-pos';
  if (n < 0) return 'ws-neg';
  return '';
}

function fmtFixed(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(digits);
}

function KpiCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="ws-kpi">
      <div className={`ws-kpi-value ws-num ${className ?? ''}`}>{value}</div>
      <div className="ws-kpi-label">{label}</div>
    </div>
  );
}

export function WorkstationShell() {
  const { fixtures } = useWorkstation();
  const { dashboard, dashboardV2 } = fixtures;
  const { kpis } = dashboard;
  const { valuation } = dashboardV2;

  return (
    <>
      {/* Data-quality alert strip — fixed above the grid, outside any
          editable layout (§5.1 area 2). Pure consumer of API provenance
          state; renders nothing when every section is healthy. */}
      <DataQualityAlertStrip dashboardV2={dashboardV2} />

      <main className="ws-grid" data-testid="ws-grid" id="ws-main-content" tabIndex={-1}>
        {/* Current exposure and risk summary band — full width, top row (§5.1 area 3) */}
        <RiskPanel />

        {/* Open positions — tall dominant left column (§5.1 area 4). The
            primary first-screen object: 9-column risk-first table over the
            same reconciled snapshot the alert strip and risk band consume. */}
        <RiskPositionsTable positions={valuation.positions} />

        {/* Account state — §6.7 unambiguous labels (Cash, Marked, NAV, P&L, Drawdown) */}
        <AccountStatePanel />

        {/* Performance — Tier 2 metric catalogue with Tier 3 gating */}
        <PerformancePanel />

        {/* Process Review — discipline metrics and attention items */}
        <ProcessReviewPanel />

        {/* Watchlist — secondary attention surface on the right rail */}
        <WatchlistPanel />

        {/* Period-performance KPI band — compact bottom band below the risk
            area (§5.1 area 7): never a competing first-row KPI wall. */}
        <section
          className="ws-panel ws-kpi-strip"
          style={{ gridArea: 'kpis' }}
          data-testid="ws-panel-kpis"
        >
          <KpiCell label="Net P&L" value={fmtCurrency(kpis.netPnl)} className={pnlClass(kpis.netPnl)} />
          <KpiCell label="Win Rate" value={fmtPct(kpis.winRate)} />
          <KpiCell label="Profit Factor" value={fmtFixed(kpis.profitFactor, 2)} />
          <KpiCell label="Avg R" value={fmtFixed(kpis.avgR, 2)} />
          <KpiCell label="Trades" value={String(kpis.totalTrades)} />
          <KpiCell label="Open" value={String(kpis.openTrades)} />
          {/* Drawdown, Account Value, NAV now in AccountStatePanel — kept here
              as compact references for the bottom band */}
          <KpiCell
            label="Drawdown"
            value={fmtCurrency(kpis.currentDrawdown)}
            className={pnlClass(kpis.currentDrawdown)}
          />
        </section>
      </main>
    </>
  );
}
