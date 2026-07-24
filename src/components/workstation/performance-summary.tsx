'use client';

// PerformanceSummary — compact monthly breakdown and drawdown statistics
// placed below the EquityChart within the equity panel body.
//
// Renders two sub-sections:
//   1. Monthly Performance table (Month, P&L, Win %, Trades)
//   2. Drawdown Summary stat block (max DD $, max DD %, current DD $, current DD %)
//
// Uses existing workstation CSS classes: ws-table, ws-stat-row, ws-num,
// ws-pos, ws-neg, ws-risk-section, ws-risk-section-header.
//
// All four workstation fixture scenarios carry monthlyPerformance and
// drawdown arrays, so this component never receives empty arrays in
// normal operation. Defensive empty checks are provided for robustness.

import type { MonthlyPerformanceItem } from '@/lib/dashboard';
import type { DrawdownDataPoint } from '@/lib/equity';

export interface PerformanceSummaryProps {
  /** Monthly performance data points (YYYY-MM, netPnl, winRate, tradeCount) */
  monthlyPerformance: MonthlyPerformanceItem[];
  /** Drawdown time series for computing max drawdown */
  drawdown: DrawdownDataPoint[];
  /** Current drawdown amount in currency (from kpis.currentDrawdown) */
  currentDrawdown: number | null;
  /** Current drawdown percentage as decimal fraction (from kpis.currentDrawdownPct) */
  currentDrawdownPct: number | null;
}

// ── Formatters ──────────────────────────────────────────────────────────

/**
 * Format a numeric value as currency: "$1,234.56" with sign.
 * Returns "—" for null or undefined.
 */
function fmtCurrency(value: number | null): string {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Convert a YYYY-MM string to a short month label ("Jan", "Feb", ...).
 * Returns the raw value when the month portion is not recognized.
 */
function fmtMonth(yyyymm: string): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const monthPart = yyyymm.slice(5, 7);
  const idx = parseInt(monthPart, 10) - 1;
  return months[idx] ?? monthPart;
}

/**
 * Color class for a numeric value:
 *   positive → ws-pos (green)
 *   negative → ws-neg (red)
 *   zero/null → no class
 */
function pnlClass(value: number | null): string {
  if (value === null) return '';
  if (value > 0) return 'ws-pos';
  if (value < 0) return 'ws-neg';
  return '';
}

// ── Computation ─────────────────────────────────────────────────────────

/**
 * Compute the maximum (deepest) drawdown from the drawdown time series.
 *
 * Scans the full array for the minimum (most negative) drawdownAmount
 * and drawdownPct. Returns null when the array is empty.
 */
function computeMaxDrawdown(
  drawdown: DrawdownDataPoint[],
): { amount: number; pct: number } | null {
  if (drawdown.length === 0) return null;

  let maxAmount = drawdown[0].drawdownAmount;
  let maxPct = drawdown[0].drawdownPct;

  for (let i = 1; i < drawdown.length; i++) {
    if (drawdown[i].drawdownAmount < maxAmount) {
      maxAmount = drawdown[i].drawdownAmount;
    }
    if (drawdown[i].drawdownPct < maxPct) {
      maxPct = drawdown[i].drawdownPct;
    }
  }

  return { amount: maxAmount, pct: maxPct };
}

// ── Component ───────────────────────────────────────────────────────────

/**
 * Compact performance summary for the workstation equity panel.
 *
 * Intended as a sibling of EquityChart inside the ws-panel-body of the
 * equity panel. Renders two sub-sections using workstation density tokens:
 *
 * - Monthly table (`data-testid="ws-perf-monthly-table"`):
 *   Month | P&L | Win % | Trades — sorted chronologically by YYYY-MM
 *
 * - Drawdown stats (`data-testid="ws-perf-drawdown-summary"`):
 *   Max DD, Max DD %, Current DD, Current DD % with color coding
 *
 * @example
 * ```tsx
 * <PerformanceSummary
 *   monthlyPerformance={dashboard.monthlyPerformance}
 *   drawdown={dashboard.drawdown}
 *   currentDrawdown={kpis.currentDrawdown}
 *   currentDrawdownPct={kpis.currentDrawdownPct}
 * />
 * ```
 */
export function PerformanceSummary({
  monthlyPerformance,
  drawdown,
  currentDrawdown,
  currentDrawdownPct,
}: PerformanceSummaryProps) {
  const hasMonthly = monthlyPerformance.length > 0;
  const hasDrawdown = drawdown.length > 0;
  const maxDD = hasDrawdown ? computeMaxDrawdown(drawdown) : null;

  return (
    <>
      {/* ── Monthly Performance Table ────────────────────────────── */}
      {hasMonthly && (
        <div
          className="ws-risk-section"
          data-testid="ws-perf-monthly-table"
        >
          <div className="ws-risk-section-header">Monthly Performance</div>
          <table className="ws-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="ws-num">P&amp;L</th>
                <th className="ws-num">Win %</th>
                <th className="ws-num">Trades</th>
              </tr>
            </thead>
            <tbody>
              {monthlyPerformance.map((m) => (
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

      {/* ── Drawdown Summary Stat Block ──────────────────────────── */}
      {hasDrawdown && (
        <div
          className="ws-risk-section"
          data-testid="ws-perf-drawdown-summary"
        >
          <div className="ws-risk-section-header">Drawdown</div>
          {maxDD && (
            <>
              <div className="ws-stat-row">
                <span>Max DD</span>
                <span className="ws-num ws-neg">
                  {fmtCurrency(maxDD.amount)}
                </span>
              </div>
              <div className="ws-stat-row">
                <span>Max DD %</span>
                <span className="ws-num ws-neg">
                  {Math.abs(maxDD.pct * 100).toFixed(1)}%
                </span>
              </div>
            </>
          )}
          <div className="ws-stat-row">
            <span>Current DD</span>
            <span className={`ws-num ${pnlClass(currentDrawdown)}`}>
              {fmtCurrency(currentDrawdown)}
            </span>
          </div>
          <div className="ws-stat-row">
            <span>Current DD %</span>
            <span className={`ws-num ${pnlClass(currentDrawdownPct)}`}>
              {currentDrawdownPct !== null
                ? `${Math.abs(currentDrawdownPct * 100).toFixed(1)}%`
                : '—'}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
