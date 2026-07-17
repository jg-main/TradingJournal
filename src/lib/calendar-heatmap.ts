/**
 * calendar-heatmap.ts
 *
 * Pure (no side effects) calendar heatmap computation library.
 * Transforms closed trade data into daily P&L aggregates grouped by
 * calendar date, suitable for rendering as an ECharts calendar heatmap.
 *
 * Follows the M026 pattern established by dashboard.ts, metrics.ts,
 * and trade-calc.ts — pure functions, own input types, no DB imports,
 * no NextResponse.
 */

import { calculatePnL, type ExecutionData } from './trade-calc';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * A single closed trade with pre-fetched related data for daily P&L
 * aggregation.
 *
 * - executions: All trade_executions for this trade (used by calculatePnL)
 * - closedAt:   Timestamp of when the trade was fully closed
 */
export interface CalendarHeatmapTradeInput {
  id: string;
  direction: 'long' | 'short';
  executions: ExecutionData[];
  closedAt: string | null;
}

/**
 * A single day's aggregate P&L on the calendar heatmap.
 *
 * - date: Calendar date in YYYY-MM-DD format
 * - pnl:  Total realised P&L (including fees) for all trades closed on this day
 */
export interface CalendarHeatmapDay {
  date: string; // YYYY-MM-DD
  pnl: number;
}

/**
 * All days grouped by year for ECharts calendar coordinate consumption.
 *
 * - year: Calendar year (e.g. 2026)
 * - days: Array of daily P&L entries within that year
 */
export interface CalendarHeatmapYearData {
  year: number;
  days: CalendarHeatmapDay[];
}

/**
 * An ECharts calendar heatmap data entry — a tuple of [dateString, value].
 *
 * The first element is the date in YYYY-MM-DD format; the second is the
 * P&L amount.  This format is what ECharts' calendar coordinate system
 * consumes directly.
 */
export type CalendarHeatmapEChartsEntry = [string, number];

/**
 * Summary statistics for a calendar heatmap, useful for configuring
 * visual range and tooltip formatting.
 *
 * - minPnl: The most negative daily P&L in the dataset, or null
 * - maxPnl: The most positive daily P&L in the dataset, or null
 * - totalDays: Number of days with trade activity
 * - totalTrades: Number of closed trades aggregated
 */
export interface CalendarHeatmapStats {
  minPnl: number | null;
  maxPnl: number | null;
  totalDays: number;
  totalTrades: number;
}

// ── Library ─────────────────────────────────────────────────────────────

/**
 * Aggregate daily P&L from an array of closed trades.
 *
 * Each trade's P&L is computed via calculatePnL (including fees) and
 * attributed to the trade's closedAt date.  Trades without a closedAt
 * timestamp are skipped.
 *
 * Returns an array of CalendarHeatmapDay objects sorted chronologically
 * (oldest date first).  Multiple trades closing on the same date have
 * their P&L summed.
 *
 * @param trades Closed trades with pre-fetched executions
 * @returns Daily P&L aggregates, sorted by date ascending
 */
export function aggregateDailyPnL(trades: CalendarHeatmapTradeInput[]): CalendarHeatmapDay[] {
  const dailyMap = new Map<string, number>();

  for (const trade of trades) {
    if (!trade.closedAt) continue;

    const dateKey = trade.closedAt.slice(0, 10); // YYYY-MM-DD
    const { totalRealizedPnL } = calculatePnL(trade.executions, trade.direction);
    const current = dailyMap.get(dateKey) ?? 0;
    dailyMap.set(dateKey, current + totalRealizedPnL);
  }

  return Array.from(dailyMap.entries())
    .map(([date, pnl]) => ({ date, pnl }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Group daily P&L entries by calendar year.
 *
 * Each year group contains all days with trade activity in that year,
 * sorted chronologically.  Years without any trade days are not emitted.
 *
 * @param days Daily P&L entries (from aggregateDailyPnL)
 * @returns Array of year-grouped heatmap data, sorted by year ascending
 */
export function groupByYear(days: CalendarHeatmapDay[]): CalendarHeatmapYearData[] {
  const yearMap = new Map<number, CalendarHeatmapDay[]>();

  for (const day of days) {
    const year = parseInt(day.date.slice(0, 4), 10);
    const yearDays = yearMap.get(year) ?? [];
    yearDays.push(day);
    yearMap.set(year, yearDays);
  }

  return Array.from(yearMap.entries())
    .map(([year, yearDays]) => ({ year, days: yearDays }))
    .sort((a, b) => a.year - b.year);
}

/**
 * Compute the full calendar heatmap dataset from closed trades.
 *
 * This is the primary orchestrator: aggregates daily P&L and groups
 * by year in one call.
 *
 * @param trades Closed trades with pre-fetched executions
 * @returns Year-grouped daily P&L data, sorted by year ascending
 */
export function computeCalendarHeatmap(trades: CalendarHeatmapTradeInput[]): CalendarHeatmapYearData[] {
  const dailyPnL = aggregateDailyPnL(trades);
  return groupByYear(dailyPnL);
}

/**
 * Convert CalendarHeatmapYearData to ECharts heatmap data format.
 *
 * ECharts' calendar coordinate system expects data as an array of
 * [dateString, value] tuples.  This helper produces that format
 * directly.
 *
 * @param yearData One year's worth of calendar heatmap data
 * @returns Array of [dateString, pnl] tuples for ECharts
 */
export function toEChartsCalendarData(yearData: CalendarHeatmapYearData): CalendarHeatmapEChartsEntry[] {
  return yearData.days.map((day) => [day.date, day.pnl]);
}

/**
 * Compute summary statistics for a calendar heatmap dataset.
 *
 * Returns the min/max daily P&L, the total number of active days,
 * and the total number of trades processed.  Useful for configuring
 * the ECharts visualMap range and tooltip text.
 *
 * @param trades Closed trades with pre-fetched executions
 * @returns Summary statistics (all fields set; minPnl/maxPnl are null for empty input)
 */
export function computeCalendarHeatmapStats(trades: CalendarHeatmapTradeInput[]): CalendarHeatmapStats {
  const totalTrades = trades.filter((t) => t.closedAt !== null).length;
  const daily = aggregateDailyPnL(trades);

  if (daily.length === 0) {
    return { minPnl: null, maxPnl: null, totalDays: 0, totalTrades };
  }

  let minPnl = daily[0].pnl;
  let maxPnl = daily[0].pnl;

  for (const day of daily) {
    if (day.pnl < minPnl) minPnl = day.pnl;
    if (day.pnl > maxPnl) maxPnl = day.pnl;
  }

  return {
    minPnl,
    maxPnl,
    totalDays: daily.length,
    totalTrades,
  };
}
