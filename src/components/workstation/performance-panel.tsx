'use client';

// PerformancePanel — period performance KPIs, monthly breakdown,
// R-multiple distribution, setup ranking, and Tier 3 gated analytics
// for the workstation grid.
//
// Consumes fixtures.dashboard (DashboardResponse) from the workstation
// context — no independent fetches. All data flows through the single
// workstation data owner per AGENTS.md state rules.
//
// Sections:
//   1. Period Performance — stat rows (Net P&L, Win Rate, Profit Factor,
//      Avg R, Avg Win, Avg Loss, Total Trades, Open Trades)
//   2. Monthly Performance — compact table, top 4 months
//   3. R Distribution — bin label + count
//   4. Setup Ranking — top 3 setups (name, count, avgR)
//   5. Advanced Analytics — Tier 3 gated metrics (Unavailable)
//
// CSS classes: ws-panel, ws-panel-header, ws-panel-body, ws-panel-meta,
// ws-num, ws-pos, ws-neg, ws-stat-row, ws-mono, ws-risk-section,
// ws-risk-section-header, ws-table, ws-empty

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

function profitFactorClass(value: number | null): string {
  if (value === null) return '';
  if (value > 1.5) return 'ws-pos';
  if (value < 1.0) return 'ws-neg';
  return '';
}

function fmtMonth(yyyymm: string): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const monthPart = yyyymm.slice(5, 7);
  const idx = parseInt(monthPart, 10) - 1;
  return months[idx] ?? monthPart;
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

function Tier3Row({
  label,
  prerequisite,
  testId,
}: {
  label: string;
  prerequisite: string;
  testId: string;
}) {
  return (
    <div className="ws-stat-row" data-testid={testId}>
      <span>{label}</span>
      <span className="ws-num ws-tier3-unavailable" title={prerequisite}>
        Unavailable
      </span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function PerformancePanel() {
  const { fixtures } = useWorkstation();
  const { dashboard } = fixtures;
  const { kpis, monthlyPerformance, rDistribution, setupRanking } = dashboard;

  const hasMonthly = monthlyPerformance.length > 0;
  const hasRDistribution = rDistribution.length > 0;
  const hasSetups = setupRanking.length > 0;
  const hasData =
    kpis.totalTrades > 0 || hasMonthly || hasRDistribution || hasSetups;

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

  const top4Months = monthlyPerformance.slice(0, 4);
  const top3Setups = setupRanking.slice(0, 3);

  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'perf' }}
      data-testid="ws-panel-performance"
    >
      <div className="ws-panel-header">
        <span>Performance</span>
        <span className="ws-panel-meta ws-mono">
          {kpis.totalTrades} trades
        </span>
      </div>
      <div className="ws-panel-body">

        {/* ── Period Performance ─────────────────────────────────────── */}
        <div className="ws-risk-section" data-testid="ws-performance-kpis">
          <StatRow
            label="Net P&L"
            value={fmtCurrency(kpis.netPnl)}
            className={pnlClass(kpis.netPnl)}
            testId="ws-perf-net-pnl"
          />
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
            label="Avg R"
            value={fmtDecimal(kpis.avgR, 2)}
            testId="ws-perf-avg-r"
          />
          <StatRow
            label="Avg Win"
            value={fmtCurrency(kpis.avgWin)}
            className={pnlClass(kpis.avgWin)}
            testId="ws-perf-avg-win"
          />
          <StatRow
            label="Avg Loss"
            value={fmtCurrency(kpis.avgLoss)}
            className={pnlClass(kpis.avgLoss)}
            testId="ws-perf-avg-loss"
          />
          <StatRow
            label="Total Trades"
            value={String(kpis.totalTrades)}
            testId="ws-perf-total-trades"
          />
          <StatRow
            label="Open Trades"
            value={String(kpis.openTrades)}
            testId="ws-perf-open-trades"
          />
        </div>

        {/* ── Monthly Performance ────────────────────────────────────── */}
        {hasMonthly && (
          <div className="ws-risk-section" data-testid="ws-performance-monthly">
            <div className="ws-risk-section-header">Monthly Performance</div>
            <table className="ws-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="ws-num">P&L</th>
                  <th className="ws-num">Win%</th>
                  <th className="ws-num">Trades</th>
                </tr>
              </thead>
              <tbody>
                {top4Months.map((m) => (
                  <tr key={m.month}>
                    <td>{fmtMonth(m.month)}</td>
                    <td className={`ws-num ${pnlClass(m.netPnl)}`}>
                      {fmtCurrency(m.netPnl)}
                    </td>
                    <td className="ws-num">
                      {m.winRate !== null
                        ? `${(m.winRate * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="ws-num">{m.tradeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── R Distribution ─────────────────────────────────────────── */}
        {hasRDistribution && (
          <div className="ws-risk-section" data-testid="ws-performance-r-dist">
            <div className="ws-risk-section-header">R Distribution</div>
            {rDistribution.map((bin) => (
              <div className="ws-stat-row" key={bin.label} data-testid={`ws-r-bin-${bin.label}`}>
                <span className="ws-mono">{bin.label}</span>
                <span className="ws-num">{bin.count}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Setup Ranking ──────────────────────────────────────────── */}
        {hasSetups && (
          <div className="ws-risk-section" data-testid="ws-performance-setups">
            <div className="ws-risk-section-header">Setup Ranking</div>
            <table className="ws-table">
              <thead>
                <tr>
                  <th>Setup</th>
                  <th className="ws-num">N</th>
                  <th className="ws-num">Avg R</th>
                </tr>
              </thead>
              <tbody>
                {top3Setups.map((s) => (
                  <tr key={s.setupId ?? s.setupName} data-testid={`ws-setup-${s.setupId ?? s.setupName}`}>
                    <td>{s.setupName}</td>
                    <td className="ws-num">{s.count}</td>
                    <td className={`ws-num ${s.avgR !== null && s.avgR > 0 ? 'ws-pos' : s.avgR !== null && s.avgR < 0 ? 'ws-neg' : ''}`}>
                      {s.avgR !== null ? s.avgR.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Advanced Analytics (Tier 3 gated) ──────────────────────── */}
        <div className="ws-risk-section" data-testid="ws-performance-tier3">
          <div className="ws-risk-section-header">Advanced Analytics</div>
          <Tier3Row
            label="MAE/MFE"
            prerequisite="Requires intratrade price history"
            testId="ws-tier3-mae-mfe"
          />
          <Tier3Row
            label="Sharpe/Sortino"
            prerequisite="Requires documented return series"
            testId="ws-tier3-sharpe-sortino"
          />
          <Tier3Row
            label="Risk of Ruin"
            prerequisite="Requires approved statistical model"
            testId="ws-tier3-risk-of-ruin"
          />
          <Tier3Row
            label="Pips/Points"
            prerequisite="Requires asset-specific unit definitions"
            testId="ws-tier3-pips-points"
          />
        </div>

      </div>
    </section>
  );
}
