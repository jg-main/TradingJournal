/**
 * equity.ts
 *
 * Pure (no side effects) equity curve and drawdown computation library.
 * Transforms account_rollforward time-series rows into ECharts-compatible
 * arrays for the dashboard equity curve and drawdown chart panels.
 *
 * Pattern: src/lib/dashboard.ts
 * Depends on: src/lib/dashboard.ts (RollforwardRow type)
 */

import { type RollforwardRow } from './dashboard';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * A single data point on the equity curve line chart.
 *
 * - date:            Calendar date of the data point (x-axis)
 * - equity:          Account ending equity at this date
 * - cumulativePnl:   Cumulative P&L at this date
 * - highWaterMark:   Running high-water mark at this date
 */
export interface EquityDataPoint {
  date: string;
  equity: number;
  cumulativePnl: number;
  highWaterMark: number;
}

/**
 * A single data point on the drawdown area chart.
 *
 * - date:            Calendar date of the data point (x-axis)
 * - drawdownAmount:  Drawdown amount in currency units
 * - drawdownPct:     Drawdown as a decimal fraction (e.g. -0.034)
 *                    NOT multiplied by 100 — chart formatting handles display
 */
export interface DrawdownDataPoint {
  date: string;
  drawdownAmount: number;
  drawdownPct: number;
}

/**
 * Combined result from both equity curve and drawdown computations.
 */
export interface EquityDrawdownResult {
  equityCurve: EquityDataPoint[];
  drawdown: DrawdownDataPoint[];
}

// ── Library ─────────────────────────────────────────────────────────────

/**
 * Transform account_rollforward rows into equity curve data points.
 *
 * Filters out rows where endingEquity is null (no equity value to plot).
 * Expects rows sorted by date ASC (enforced by the API query).
 *
 * For each valid row:
 * - equity:         Uses endingEquity (known non-null after filter)
 * - cumulativePnl:  Uses cumulativePnl, falling back to 0 when null
 * - highWaterMark:  Uses highWaterMark, falling back to equity value when null
 *
 * @param rows - Account rollforward rows sorted by date ASC
 * @returns Array of equity curve data points
 */
export function computeEquityCurve(rows: RollforwardRow[]): EquityDataPoint[] {
  return rows
    .filter((row): row is RollforwardRow & { endingEquity: number } =>
      row.endingEquity !== null,
    )
    .map((row) => ({
      date: row.date,
      equity: row.endingEquity,
      cumulativePnl: row.cumulativePnl ?? 0,
      highWaterMark: row.highWaterMark ?? row.endingEquity,
    }));
}

/**
 * Transform account_rollforward rows into drawdown data points.
 *
 * Filters out rows where drawdownPct is null.
 * drawdownPct is a decimal (e.g. -0.034) — returned as-is, NOT multiplied
 * by 100 (chart formatting handles percentage display).
 *
 * Expects rows sorted by date ASC (enforced by the API query).
 *
 * @param rows - Account rollforward rows sorted by date ASC
 * @returns Array of drawdown data points
 */
export function computeDrawdown(rows: RollforwardRow[]): DrawdownDataPoint[] {
  return rows
    .filter((row): row is RollforwardRow & { drawdownPct: number } =>
      row.drawdownPct !== null,
    )
    .map((row) => ({
      date: row.date,
      drawdownAmount: row.drawdownAmount ?? 0,
      drawdownPct: row.drawdownPct,
    }));
}
