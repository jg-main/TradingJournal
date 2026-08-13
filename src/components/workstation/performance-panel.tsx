'use client';

// PerformancePanel — completed-decision KPIs plus a scoped, live P&L readout
// for the dense summary row (M017/S02).
//
// Consumes fixtures.dashboard + fixtures.dashboardV2 from the workstation
// context — no independent fetches. All data flows through the single
// workstation data owner per AGENTS.md state rules. The P&L selector chooses
// Realized (all exit quantity, including partials), Open (current MTM), or
// Total (realized + current MTM); completed-decision quality KPIs stay
// intentionally unchanged so a scale-out never becomes an extra decision.
//
// Dense contract (DASHBOARD_DENSE_LAYOUT_REQUIREMENTS §compact summary row):
//   Performance has a single live P&L reading control plus completed-decision
//   metrics: closed-decision count, win rate, profit factor, average R,
//   expectancy, payoff, average win/loss, fees, and best/worst trade. It
//   shows data points, not charts, distributions, or ranking tables. The
//   monthly table, R distribution, setup ranking, and Tier 3 gated analytics
//   no longer share the summary row; their future home is the full-width
//   analysis workspace below trades.
//
// CSS classes: ws-panel, ws-panel-header, ws-panel-body, ws-panel-meta,
// ws-num, ws-pos, ws-neg, ws-stat-row, ws-mono, ws-risk-section, ws-empty,
// ws-perf-grid, ws-perf-column, ws-perf-group, ws-perf-group-header

import { useWorkstation } from './workstation-context';
import { usePerformancePnlScope } from '@/hooks/use-performance-pnl-scope';
import {
  computePerformancePnlScope,
  type PerformancePnlScope,
} from '@/lib/performance-pnl-scope';

// ── Formatters ──────────────────────────────────────────────────────────

function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtCurrency(value: number | string | null | undefined): string {
  const amount = asNumber(value);
  if (amount === null) return '—';
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pnlClass(value: number | string | null | undefined): string {
  const amount = asNumber(value);
  if (amount === null) return '';
  if (amount > 0) return 'ws-pos';
  if (amount < 0) return 'ws-neg';
  return '';
}

function fmtPct(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtDecimal(value: number | null, decimals: number): string {
  if (value === null) return '—';
  return value.toFixed(decimals);
}

function fmtLossCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const magnitude = Math.abs(value);
  if (magnitude === 0) return '$0.00';
  return `-$${magnitude.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDays(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}d`;
}

function profitFactorClass(value: number | null): string {
  if (value === null) return '';
  if (value > 1.5) return 'ws-pos';
  if (value < 1.0) return 'ws-neg';
  return '';
}

const PNL_SCOPE_OPTIONS: ReadonlyArray<{
  value: PerformancePnlScope;
  label: string;
  title: string;
}> = [
  {
    value: 'realized',
    label: 'Realized',
    title: 'Show all realized P&L, including partial exits',
  },
  {
    value: 'open',
    label: 'Open',
    title: 'Show current mark-to-market P&L for open quantity',
  },
  {
    value: 'total',
    label: 'Total',
    title: 'Show realized P&L plus current mark-to-market P&L',
  },
];

// ── Sub-components ──────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  sub,
  className,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
  testId: string;
}) {
  return (
    <div className="ws-stat-row" data-testid={testId}>
      <span className="ws-stat-label">
        <span>{label}</span>
        {sub && <span className="ws-stat-sub ws-mono">{sub}</span>}
      </span>
      <span className={`ws-num ${className ?? ''}`}>{value}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function PerformancePanel() {
  const { fixtures } = useWorkstation();
  const { dashboard, dashboardV2 } = fixtures;
  const { kpis } = dashboard;
  const { scope, setScope } = usePerformancePnlScope();
  const scopedPnl = computePerformancePnlScope({
    scope,
    realizedPnl: dashboardV2.metrics.realizedPnl,
    openPnl: dashboardV2.riskSummary.openPnl,
    valuationState: dashboardV2.valuation.state,
  });

  const hasData = kpis.totalTrades > 0;

  // ── Empty state ─────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <section
        className="ws-panel"
        data-testid="ws-panel-performance"
      >
        <div className="ws-panel-header">
          <span>Performance</span>
        </div>
        <div className="ws-panel-body">
          <div className="ws-empty" data-testid="ws-performance-empty">
            No performance data
          </div>
        </div>
      </section>
    );
  }

  const closedTrades = kpis.closedTrades ?? null;

  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'perf' }}
      data-testid="ws-panel-performance"
    >
      <div className="ws-panel-header">
        <span>Performance</span>
        <span className="ws-panel-meta ws-mono">
          Live P&amp;L · {closedTrades ?? kpis.totalTrades} closed decisions
        </span>
      </div>
      <div className="ws-panel-body">

        {/* ── Period Performance (dense: data points only) ─────────────
             M018/S01: the 16 period metrics render as two columns of
             logical KPI groups (P&L + Risk | Win Edge + Activity) with
             compact group headers, so the panel sits at roughly Account
             State height in the default summary row. */}
        <div className="ws-risk-section ws-perf-grid" data-testid="ws-performance-kpis">
          <div className="ws-perf-column">
            <div className="ws-perf-group" data-testid="ws-perf-group-pnl">
              <div className="ws-perf-group-header ws-perf-pnl-group-header">
                <span>Live P&amp;L</span>
                <div className="ws-perf-scope" role="group" aria-label="Performance P&L scope">
                  {PNL_SCOPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`ws-perf-scope-option${scope === option.value ? ' ws-perf-scope-option-active' : ''}`}
                      data-testid={`ws-perf-scope-${option.value}`}
                      aria-pressed={scope === option.value}
                      title={option.title}
                      onClick={() => setScope(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <StatRow
                label={scopedPnl.label}
                value={fmtCurrency(scopedPnl.value)}
                sub={scopedPnl.description}
                className={pnlClass(scopedPnl.value)}
                testId="ws-perf-net-pnl"
              />
              <StatRow
                label="Realized fees"
                value={fmtCurrency(dashboardV2.metrics.realizedFees)}
                testId="ws-perf-fees"
              />
              <StatRow
                label="Expectancy"
                value={fmtCurrency(kpis.expectancy ?? null)}
                className={pnlClass(kpis.expectancy ?? null)}
                testId="ws-perf-expectancy"
              />
              <StatRow
                label="Best Trade"
                value={fmtCurrency(kpis.bestTrade ?? null)}
                className={pnlClass(kpis.bestTrade ?? null)}
                testId="ws-perf-best-trade"
              />
              <StatRow
                label="Worst Trade"
                value={fmtCurrency(kpis.worstTrade ?? null)}
                className={pnlClass(kpis.worstTrade ?? null)}
                testId="ws-perf-worst-trade"
              />
            </div>
            <div className="ws-perf-group" data-testid="ws-perf-group-risk">
              <div className="ws-perf-group-header">Closed-trade risk</div>
              <StatRow
                label="Avg R"
                value={fmtDecimal(kpis.avgR, 2)}
                testId="ws-perf-avg-r"
              />
              <StatRow
                label="Expectancy R"
                value={fmtDecimal(kpis.expectancyR ?? null, 2)}
                className={pnlClass(kpis.expectancyR ?? null)}
                testId="ws-perf-expectancy-r"
              />
            </div>
          </div>
          <div className="ws-perf-column">
            <div className="ws-perf-group" data-testid="ws-perf-group-win-edge">
              <div className="ws-perf-group-header">Closed-trade edge</div>
              <StatRow
                label="Win Rate"
                value={fmtPct(kpis.winRate)}
                testId="ws-perf-win-rate"
              />
              <StatRow
                label="Profit Factor"
                value={fmtDecimal(kpis.profitFactor, 2)}
                className={profitFactorClass(kpis.profitFactor)}
                testId="ws-perf-profit-factor"
              />
              <StatRow
                label="Payoff Ratio"
                value={fmtDecimal(kpis.payoffRatio ?? null, 2)}
                testId="ws-perf-payoff"
              />
              <StatRow
                label="Avg Win"
                value={fmtCurrency(kpis.avgWin)}
                className={pnlClass(kpis.avgWin)}
                testId="ws-perf-avg-win"
              />
              <StatRow
                label="Avg Loss"
                value={fmtLossCurrency(kpis.avgLoss)}
                className={kpis.avgLoss != null && Math.abs(kpis.avgLoss) > 0 ? 'ws-neg' : ''}
                testId="ws-perf-avg-loss"
              />
            </div>
            <div className="ws-perf-group" data-testid="ws-perf-group-activity">
              <div className="ws-perf-group-header">Trade activity</div>
              <StatRow
                label="All Trades"
                value={String(kpis.totalTrades)}
                testId="ws-perf-total-trades"
              />
              <StatRow
                label="Closed Decisions"
                value={closedTrades !== null ? String(closedTrades) : '—'}
                testId="ws-perf-closed-trades"
              />
              <StatRow
                label="Open Trades"
                value={String(kpis.openTrades)}
                testId="ws-perf-open-trades"
              />
              <StatRow
                label="Avg Holding"
                value={fmtDays(kpis.averageHoldingDays)}
                testId="ws-perf-holding-days"
              />
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
