'use client';

// WorkstationShell — risk-first CSS Grid layout proving the S04 concept at
// 2560×1440 and effective 1536×960, extended by S06 to render the active
// saved view's panel configuration.
//
// S06 (R035): the shell consumes the active workstation view from
// useWorkstationViews and computes the dynamic grid-template-areas /
// -columns / -rows from the view's layout config (see
// src/lib/workstation-view-types.ts). Only the panels visible in the active
// view are rendered; hidden optional panels simply have no cells in the
// grid. When no view is active yet (defensive fallback), the immutable
// Risk & Positions template grid is rendered.
//
// The data-quality alert strip (T01) renders above the grid, outside it, so
// it stays visible in every view and can never be hidden or rearranged by a
// saved layout. Panels scroll internally and the surface itself never
// scrolls (see .ws and .ws-grid in workstation.css).

import { Fragment, type ReactNode } from 'react';
import { useWorkstation } from './workstation-context';
import { useWorkstationViewsContext } from './workstation-views-context';
import { DataQualityAlertStrip } from './data-quality-alert-strip';
import { RiskPositionsTable } from './risk-positions-table';
import { RiskPanel } from './risk-panel';
import { WatchlistPanel } from './watchlist-panel';
import { AccountStatePanel } from './account-state-panel';
import { PerformancePanel } from './performance-panel';
import { ProcessReviewPanel } from './process-review-panel';
import {
  WORKSTATION_PANEL_IDS,
  WORKSTATION_TEMPLATE_IDS,
  computeGridTemplateAreas,
  computeGridTemplateColumns,
  computeGridTemplateRows,
  computeVisiblePanels,
  createViewFromTemplate,
  type WorkstationPanelId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

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

// ── KPI strip ──────────────────────────────────────────────────────────
// Compact period-performance band at the bottom of the grid, below the risk
// area (§5.1 area 7). Never a competing first-row wall. Consumes the same
// fixtures as every other panel (single data owner per AGENTS.md).

function KpiStrip() {
  const { fixtures } = useWorkstation();
  const { kpis } = fixtures.dashboard;

  return (
    <section
      className="ws-panel ws-kpi-strip"
      style={{ gridArea: WORKSTATION_PANEL_IDS.KPIS }}
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
  );
}

// ── View grid ──────────────────────────────────────────────────────────

/**
 * Defensive fallback grid: the immutable Risk & Positions template. Used
 * only when the hook has no active view yet (it always does after the first
 * render — the store initialises synchronously — so this is a safety net).
 */
const DEFAULT_VIEW_CONFIG: WorkstationViewConfig = createViewFromTemplate(
  WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
);

/**
 * Return the panel component for one catalogue panel id. Renderers receive
 * the values they need as arguments so the map stays pure; the positions
 * table consumes the same reconciled valuation snapshot the alert strip and
 * risk band consume.
 */
function renderPanelById(
  id: WorkstationPanelId,
  positions: Parameters<typeof RiskPositionsTable>[0]['positions'],
): ReactNode {
  switch (id) {
    case WORKSTATION_PANEL_IDS.RISK:
      return <RiskPanel />;
    case WORKSTATION_PANEL_IDS.POSITIONS:
      return <RiskPositionsTable positions={positions} />;
    case WORKSTATION_PANEL_IDS.ACCOUNT:
      return <AccountStatePanel />;
    case WORKSTATION_PANEL_IDS.PERFORMANCE:
      return <PerformancePanel />;
    case WORKSTATION_PANEL_IDS.PROCESS_REVIEW:
      return <ProcessReviewPanel />;
    case WORKSTATION_PANEL_IDS.WATCHLIST:
      return <WatchlistPanel />;
    case WORKSTATION_PANEL_IDS.KPIS:
      return <KpiStrip />;
  }
}

export function WorkstationShell() {
  const { fixtures } = useWorkstation();
  const { dashboardV2 } = fixtures;
  const { valuation } = dashboardV2;

  // Saved workstation views (S06): the provider owns the view store; the
  // shell renders the active view's layout config as the dynamic grid.
  const viewsState = useWorkstationViewsContext();

  // The active view's layout config is the rendered truth: hidden panels
  // have no cells in the grid. Fall back to the Risk & Positions template
  // while no active view exists (defensive).
  const config = viewsState.activeView?.config ?? DEFAULT_VIEW_CONFIG;

  const gridStyle = {
    gridTemplateAreas: computeGridTemplateAreas(config),
    gridTemplateColumns: computeGridTemplateColumns(config),
    gridTemplateRows: computeGridTemplateRows(config),
  };

  const visiblePanels = computeVisiblePanels(config);

  return (
    <>
      {/* Data-quality alert strip — fixed above the grid, outside any
          editable layout (§5.1 area 2). It is rendered before the grid in
          every view and cannot be hidden by a saved layout. Pure consumer
          of API provenance state; renders nothing when every section is
          healthy. */}
      <DataQualityAlertStrip dashboardV2={dashboardV2} />

      <main
        className="ws-grid"
        style={gridStyle}
        data-testid="ws-grid"
        id="ws-main-content"
        tabIndex={-1}
      >
        {visiblePanels.map((id) => (
          <Fragment key={id}>{renderPanelById(id, valuation.positions)}</Fragment>
        ))}
      </main>
    </>
  );
}
