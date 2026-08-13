'use client';

// PerformancePanel — period performance KPI stat rows for the dense summary
// row (M017/S02).
//
// Consumes fixtures.dashboard (DashboardResponse) from the workstation
// context — no independent fetches. All data flows through the single
// workstation data owner per AGENTS.md state rules.
//
// Dense contract (DASHBOARD_DENSE_LAYOUT_REQUIREMENTS §compact summary row):
//   Performance contains period metrics only — net P&L, closed-decision
//   count, win rate, profit factor, average R, expectancy, payoff, average
//   win/loss, fees, and best/worst trade. It shows data points, not charts,
//   distributions, or ranking tables. The monthly table, R distribution,
//   setup ranking, and Tier 3 gated analytics no longer share the summary
//   row; their future home is the full-width analysis workspace below
//   trades.
//
// CSS classes: ws-panel, ws-panel-header, ws-panel-body, ws-panel-meta,
// ws-num, ws-pos, ws-neg, ws-stat-row, ws-mono, ws-risk-section, ws-empty,
// ws-perf-grid, ws-perf-column, ws-perf-group, ws-perf-group-header

import { useWorkstation } from './workstation-context';

// ── Formatters ──────────────────────────────────────────────────────────

function fmtCurrency(value: number | null): string {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pnlClass(value: number | null): string {
  if (value === null) return '';
  if (value > 0) return 'ws-pos';
  if (value < 0) return 'ws-neg';
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

// ── Sub-components ──────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  className,
  testId,
}: {
  label: string;
  value: string;
  className?: string;
  testId: string;
}) {
  return (
    <div className="ws-stat-row" data-testid={testId}>
      <span>{label}</span>
      <span className={`ws-num ${className ?? ''}`}>{value}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function PerformancePanel() {
  const { fixtures } = useWorkstation();
  const { dashboard } = fixtures;
  const { kpis } = dashboard;

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
          {closedTrades ?? kpis.totalTrades} closed
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
              <div className="ws-perf-group-header">P&L</div>
              <StatRow
                label="Net P&L"
                value={fmtCurrency(kpis.netPnl)}
                className={pnlClass(kpis.netPnl)}
                testId="ws-perf-net-pnl"
              />
              <StatRow
                label="Fees"
                value={fmtCurrency(kpis.totalFees ?? null)}
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
              <div className="ws-perf-group-header">Risk</div>
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
              <div className="ws-perf-group-header">Win Edge</div>
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
              <div className="ws-perf-group-header">Activity</div>
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
