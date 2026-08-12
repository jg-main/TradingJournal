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
    <>
      {/* Data-quality alert strip — fixed above the grid, outside any
          editable layout (§5.1 area 2). Pure consumer of API provenance
          state; renders nothing when every section is healthy. */}
      <DataQualityAlertStrip dashboardV2={dashboardV2} />

      <main className="ws-grid" data-testid="ws-grid" id="ws-main-content" tabIndex={-1}>
        {/* Current exposure and risk summary band — full width, top row (§5.1 area 3) */}
        <RiskPanel />

        {/* Open positions — tall dominant left column (§5.1 area 4) */}
        <PositionsPanel />

        {/* Account state and drawdown — equity chart + monthly summary */}
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

        {/* Watchlist — secondary attention surface on the right rail */}
        <WatchlistPanel />

        {/* Setups & Ideas — setup ranking, attention insights, trade ideas */}
        <SetupsPanel />

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
          <KpiCell
            label="Drawdown"
            value={fmtCurrency(kpis.currentDrawdown)}
            className={pnlClass(kpis.currentDrawdown)}
          />
          <KpiCell label="Account Value" value={fmtCurrency(kpis.accountValue)} />
          <KpiCell label="NAV (V2)" value={fmtCurrency(metrics.nav)} />
        </section>
      </main>
    </>
  );
}
