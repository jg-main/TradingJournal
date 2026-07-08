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

import { calculateAvgCost, type ExecutionData } from './trade-calc';
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

// ── Trade Marker Types ──────────────────────────────────────────────────

/**
 * A single trade marker on the equity curve chart.
 *
 * - date:        Calendar date of the marker (x-axis)
 * - equity:      Account equity at this date (y-axis)
 * - tradeId:     Trade identifier
 * - symbol:      Trading symbol / instrument
 * - direction:   Trade direction (long or short)
 * - markerType:  Whether this is an entry or exit marker
 * - price:       Average entry or exit price
 * - pnl:         Realized P&L for the trade (same value on both entry and exit markers)
 */
export interface TradeMarkerPoint {
  date: string;
  equity: number;
  tradeId: string;
  symbol: string;
  direction: 'long' | 'short';
  markerType: 'entry' | 'exit';
  price: number;
  pnl: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

function isEntryAction(action: string, direction: 'long' | 'short'): boolean {
  if (direction === 'long') return action === 'buy' || action === 'add';
  return action === 'sell_short';
}

function isExitAction(action: string, direction: 'long' | 'short'): boolean {
  if (direction === 'long') return action === 'sell' || action === 'reduce';
  return action === 'buy_to_cover';
}

/**
 * Resolve the equity value nearest to a given date from rollforward rows.
 *
 * Strategy:
 * 1. Exact date match (preferred)
 * 2. First row with date >= target date (next available)
 * 3. Last row with non-null endingEquity (fallback when date is outside range)
 *
 * @returns Equity value, or null if no rows have non-null endingEquity.
 */
function findEquityAtDate(
  date: string,
  rows: { date: string; endingEquity: number | null }[],
): number | null {
  // 1. Exact date match
  const exact = rows.find((r) => r.date === date);
  if (exact && exact.endingEquity !== null) return exact.endingEquity;

  // 2. First row with date >= target and non-null equity
  const next = rows.find((r) => r.date >= date && r.endingEquity !== null);
  if (next && next.endingEquity !== null) return next.endingEquity;

  // 3. Fallback: last row with non-null equity
  const last = [...rows].reverse().find((r) => r.endingEquity !== null);
  return last?.endingEquity ?? null;
}

/**
 * Compute trade markers for the equity curve chart.
 *
 * Produces an entry marker and an exit marker for each closed trade that has
 * both valid entry and exit executions. Trades without complete execution
 * data are silently excluded (their markers are filtered out of the result).
 *
 * @param closedTrades    Closed trades with pre-fetched executions
 * @param rollforwardRows Account rollforward rows sorted by date ASC
 * @returns Array of trade marker points (2 per qualifying trade)
 */
export function computeTradeMarkers(
  closedTrades: { id: string; direction: 'long' | 'short'; executions: ExecutionData[]; closedAt: string | null }[],
  rollforwardRows: RollforwardRow[],
): TradeMarkerPoint[] {
  const markers: TradeMarkerPoint[] = [];

  for (const trade of closedTrades) {
    const entries = trade.executions.filter((e) => isEntryAction(e.action, trade.direction));
    const exits = trade.executions.filter((e) => isExitAction(e.action, trade.direction));

    if (entries.length === 0 || exits.length === 0) continue;

    // Entry: avg price + earliest execution date
    const { avgEntryPrice } = calculateAvgCost(entries);
    if (avgEntryPrice === null) continue;

    const sortedEntries = [...entries].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
    );
    const entryDate = sortedEntries[0].executedAt.slice(0, 10);

    // Exit: avg price of exits + latest execution date
    const { avgEntryPrice: avgExitPrice } = calculateAvgCost(exits);
    if (avgExitPrice === null) continue;

    const sortedExits = [...exits].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
    );
    const exitDate = sortedExits[sortedExits.length - 1].executedAt.slice(0, 10);

    // Compute P&L using calculateAvgCost entry + exit prices (simple estimate)
    // This mirrors the pattern in trade-calc's calculatePnL
    const totalEntryQty = entries.reduce((s, e) => s + e.quantity, 0);
    const totalExitQty = Math.min(exits.reduce((s, e) => s + e.quantity, 0), totalEntryQty);
    const pnl =
      trade.direction === 'long'
        ? (avgExitPrice - avgEntryPrice) * totalExitQty
        : (avgEntryPrice - avgExitPrice) * totalExitQty;
    const totalFees = trade.executions.reduce((s, e) => s + (e.fees ?? 0), 0);
    const realizedPnl = pnl - totalFees;

    // Look up equity at entry and exit dates
    const entryEquity = findEquityAtDate(entryDate, rollforwardRows);
    const exitEquity = findEquityAtDate(exitDate, rollforwardRows);

    if (entryEquity !== null) {
      markers.push({
        date: entryDate,
        equity: entryEquity,
        tradeId: trade.id,
        symbol: '', // symbol not available in KpiTradeInput; left empty for tooltip
        direction: trade.direction,
        markerType: 'entry',
        price: avgEntryPrice,
        pnl: realizedPnl,
      });
    }

    if (exitEquity !== null) {
      markers.push({
        date: exitDate,
        equity: exitEquity,
        tradeId: trade.id,
        symbol: '',
        direction: trade.direction,
        markerType: 'exit',
        price: avgExitPrice,
        pnl: realizedPnl,
      });
    }
  }

  return markers;
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
