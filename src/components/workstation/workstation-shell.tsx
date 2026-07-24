'use client';

// WorkstationShell — terminal-dense CSS Grid layout proving the milestone's
// density concept at 1440x900. Named grid-template-areas give each panel a
// fixed, purpose-built region; panels scroll internally and the surface
// itself never scrolls (see .ws in workstation.css).
//
// Panels render real fixture data (not lorem ipsum) so the browser evidence
// in T04 measures realistic density. S06 swaps the fixture source in context
// for live API data without touching these panels.

import { useWorkstation } from './workstation-context';
import { PositionsPanel } from './positions-panel';
import { RiskPanel } from './risk-panel';
import { WatchlistPanel } from './watchlist-panel';
import { SetupsPanel } from './setups-panel';
import { EquityChart } from './equity-chart';
import { PerformanceSummary } from './performance-summary';

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

function Panel({
  area,
  title,
  meta,
  children,
}: {
  area: string;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ws-panel" style={{ gridArea: area }} data-testid={`ws-panel-${area}`}>
      <div className="ws-panel-header">
        <span>{title}</span>
        {meta && <span className="ws-panel-meta ws-mono">{meta}</span>}
      </div>
      <div className="ws-panel-body">{children}</div>
    </section>
  );
}

export function WorkstationShell() {
  const { fixtures } = useWorkstation();
  const { dashboard, dashboardV2 } = fixtures;
  const { kpis } = dashboard;
  const { metrics } = dashboardV2;

  const firstEquity = dashboard.equityCurve[0];
  const lastEquity = dashboard.equityCurve[dashboard.equityCurve.length - 1];

  return (
    <main className="ws-grid" data-testid="ws-grid">
      {/* KPI strip — account overview at a glance */}
      <section className="ws-panel ws-kpi-strip" style={{ gridArea: 'kpis' }} data-testid="ws-panel-kpis">
        <KpiCell label="Net P&L" value={fmtCurrency(kpis.netPnl)} className={pnlClass(kpis.netPnl)} />
        <KpiCell label="Win Rate" value={fmtPct(kpis.winRate)} />
        <KpiCell label="Profit Factor" value={fmtFixed(kpis.profitFactor, 2)} />
        <KpiCell label="Avg R" value={fmtFixed(kpis.avgR, 2)} />
        <KpiCell label="Trades" value={String(kpis.totalTrades)} />
        <KpiCell label="Open" value={String(kpis.openTrades)} />
        <KpiCell
          label="Drawdown"
          value={fmtCurrency(kpis.currentDrawdown)}
          className={pnlClass(kpis.currentDrawdown)}
        />
        <KpiCell label="Account Value" value={fmtCurrency(kpis.accountValue)} />
        <KpiCell label="NAV (V2)" value={fmtCurrency(metrics.nav)} />
      </section>

      {/* Equity curve — ECharts chart + monthly performance summary */}
      <Panel
        area="equity"
        title="Equity"
        meta={
          firstEquity && lastEquity
            ? `${firstEquity.date} → ${lastEquity.date}`
            : undefined
        }
      >
        <EquityChart
          equityCurve={dashboard.equityCurve}
          drawdown={dashboard.drawdown}
          tradeMarkers={dashboard.tradeMarkers ?? []}
        />
        <PerformanceSummary
          monthlyPerformance={dashboard.monthlyPerformance}
          drawdown={dashboard.drawdown}
          currentDrawdown={kpis.currentDrawdown}
          currentDrawdownPct={kpis.currentDrawdownPct}
        />
      </Panel>

      {/* Open positions — standalone 7-column terminal-dense table */}
      <PositionsPanel />

      {/* Watchlist — enhanced 7-column table with MarketStrip sub-ribbon */}
      <WatchlistPanel />

      {/* Risk — PTD/current-state visual separation */}
      <RiskPanel />

      {/* Setups & Ideas — setup ranking, attention insights, trade ideas */}
      <SetupsPanel />
    </main>
  );
}
