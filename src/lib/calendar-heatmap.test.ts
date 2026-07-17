#!/usr/bin/env tsx
/**
 * calendar-heatmap.test.ts
 *
 * Unit tests for the calendar heatmap computation library.
 * Tests in isolation without a database — fixtures are plain objects
 * matching CalendarHeatmapTradeInput.
 *
 * Run: npx tsx src/lib/calendar-heatmap.test.ts
 *
 * Pattern: src/lib/dashboard.test.ts, src/lib/metrics.test.ts
 */

import {
  aggregateDailyPnL,
  groupByYear,
  computeCalendarHeatmap,
  toEChartsCalendarData,
  computeCalendarHeatmapStats,
  type CalendarHeatmapTradeInput,
  type CalendarHeatmapDay,
  type CalendarHeatmapYearData,
} from './calendar-heatmap';
import { type ExecutionData } from './trade-calc';

// ── Helpers ─────────────────────────────────────────────────────────────

function longTradeExecutions(entryPrice: number, exitPrice: number, qty = 100, entryFees = 0, exitFees = 0): ExecutionData[] {
  return [
    { action: 'buy', quantity: qty, price: entryPrice, fees: entryFees, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'sell', quantity: qty, price: exitPrice, fees: exitFees, executedAt: '2026-01-01T14:00:00Z' },
  ];
}

function shortTradeExecutions(entryPrice: number, exitPrice: number, qty = 100, entryFees = 0, exitFees = 0): ExecutionData[] {
  return [
    { action: 'sell_short', quantity: qty, price: entryPrice, fees: entryFees, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'buy_to_cover', quantity: qty, price: exitPrice, fees: exitFees, executedAt: '2026-01-01T14:00:00Z' },
  ];
}

function makeTrade(
  id: string,
  direction: 'long' | 'short',
  executions: ExecutionData[],
  closedAt: string | null,
): CalendarHeatmapTradeInput {
  return { id, direction, executions, closedAt };
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${e}`);
    console.error(`     actual:   ${a}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${label}`);
  }
}

function assertClose(actual: number | null, expected: number | null, label: string, tolerance = 0.001): void {
  if (actual === null && expected === null) {
    console.log(`  ✅ PASS: ${label} (both null)`);
    return;
  }
  if (actual === null || expected === null) {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${expected}, actual: ${actual}`);
    process.exitCode = 1;
    return;
  }
  if (Math.abs(actual - expected) > tolerance) {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${expected}, actual: ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${label}`);
  }
}

function assertNull(v: unknown, label: string): void {
  if (v === null) {
    console.log(`  ✅ PASS: ${label}`);
  } else {
    console.error(`  ❌ FAIL: ${label} — expected null, got ${JSON.stringify(v)}`);
    process.exitCode = 1;
  }
}

function assertLength(arr: unknown[], expected: number, label?: string): void {
  if (arr.length === expected) {
    console.log(`  ✅ PASS: ${label} (length=${expected})`);
  } else {
    console.error(`  ❌ FAIL: ${label} — expected length ${expected}, got ${arr.length}`);
    process.exitCode = 1;
  }
}

let testCount = 0;

function runTest(name: string, fn: () => void): void {
  testCount++;
  console.log(`\n#${testCount}: ${name}`);
  fn();
}

// ── Fixtures ───────────────────────────────────────────────────────────

const LONG_WIN_TRADE = makeTrade(
  'long-win-001', 'long',
  longTradeExecutions(50, 60, 100, 2, 2),  // PnL = (60-50)*100 - 4 = 996
  '2026-01-15T14:00:00Z',
);

const LONG_LOSS_TRADE = makeTrade(
  'long-loss-001', 'long',
  longTradeExecutions(50, 40, 100, 2, 2),  // PnL = (40-50)*100 - 4 = -1004
  '2026-01-20T15:30:00Z',
);

const SHORT_WIN_TRADE = makeTrade(
  'short-win-001', 'short',
  shortTradeExecutions(60, 50, 200, 3, 3),  // PnL = (60-50)*200 - 6 = 1994
  '2026-02-10T11:00:00Z',
);

const SCRATCH_TRADE = makeTrade(
  'scratch-001', 'long',
  longTradeExecutions(50, 50.02, 100, 1, 1),  // PnL ≈ (50.02-50)*100 - 2 = 0 (breakeven)
  '2026-01-20T16:00:00Z',
);

const TRADE_NO_CLOSED_AT = makeTrade(
  'open-001', 'long',
  longTradeExecutions(50, 55, 100, 2, 2),  // PnL = 498
  null,  // Not closed — should be skipped
);

// ── Tests ──────────────────────────────────────────────────────────────

// 1. Basic daily aggregation — single trade per day
runTest('aggregateDailyPnL: single trade per day, different days', () => {
  const result = aggregateDailyPnL([LONG_WIN_TRADE, LONG_LOSS_TRADE]);

  assertLength(result, 2);
  assertEqual(result[0], { date: '2026-01-15', pnl: 996 }, 'first day = 2026-01-15 with PnL 996');
  assertEqual(result[1], { date: '2026-01-20', pnl: -1004 }, 'second day = 2026-01-20 with PnL -1004');
});

// 2. Multiple trades on the same date — P&L should be summed
runTest('aggregateDailyPnL: multiple trades on same day sum P&L', () => {
  // Both trades on 2026-01-20: loss (-1004) + scratch (~0) ≈ -1004
  const result = aggregateDailyPnL([LONG_LOSS_TRADE, SCRATCH_TRADE]);

  assertLength(result, 1);
  // Scratch: (50.02-50)*100 - 2 = 0, Loss: -1004, total ≈ -1004
  assertClose(result[0].pnl, -1004, 'summed PnL on 2026-01-20 ≈ -1004');
  assertEqual(result[0].date, '2026-01-20', 'date is 2026-01-20');
});

// 3. Short trades
runTest('aggregateDailyPnL: short win trade produces positive P&L', () => {
  const result = aggregateDailyPnL([SHORT_WIN_TRADE]);

  assertLength(result, 1);
  // Short: (60-50)*200 - 6 = 1994
  assertClose(result[0].pnl, 1994, 'short win PnL ≈ 1994');
  assertEqual(result[0].date, '2026-02-10', 'date is 2026-02-10');
});

// 4. Trades without closedAt are skipped
runTest('aggregateDailyPnL: trades without closedAt are skipped', () => {
  const result = aggregateDailyPnL([TRADE_NO_CLOSED_AT]);

  assertLength(result, 0);
});

// 5. Mixed: some with closedAt, some without
runTest('aggregateDailyPnL: skips null closedAt among valid trades', () => {
  const result = aggregateDailyPnL([LONG_WIN_TRADE, TRADE_NO_CLOSED_AT, LONG_LOSS_TRADE]);

  assertLength(result, 2);
  assertEqual(result[0].date, '2026-01-15', 'first entry is 2026-01-15');
  assertEqual(result[1].date, '2026-01-20', 'second entry is 2026-01-20');
});

// 6. Empty input
runTest('aggregateDailyPnL: empty input returns empty array', () => {
  const result = aggregateDailyPnL([]);

  assertLength(result, 0);
});

// 7. Sorted chronologically
runTest('aggregateDailyPnL: results sorted by date ascending', () => {
  // Add in reverse order
  const result = aggregateDailyPnL([LONG_LOSS_TRADE, SHORT_WIN_TRADE, LONG_WIN_TRADE]);

  assertLength(result, 3);
  assertEqual(result[0].date, '2026-01-15', 'first = 2026-01-15');
  assertEqual(result[1].date, '2026-01-20', 'second = 2026-01-20');
  assertEqual(result[2].date, '2026-02-10', 'third = 2026-02-10');
});

// 8. groupByYear — single year
runTest('groupByYear: all days in same year', () => {
  const days: CalendarHeatmapDay[] = [
    { date: '2026-01-15', pnl: 996 },
    { date: '2026-01-20', pnl: -1004 },
    { date: '2026-02-10', pnl: 1994 },
  ];

  const result = groupByYear(days);

  assertLength(result, 1);
  assertEqual(result[0].year, 2026, 'year = 2026');
  assertLength(result[0].days, 3);
});

// 9. groupByYear — multiple years
runTest('groupByYear: days span multiple years', () => {
  const days: CalendarHeatmapDay[] = [
    { date: '2025-12-01', pnl: 500 },
    { date: '2026-01-15', pnl: 996 },
    { date: '2027-03-10', pnl: -200 },
  ];

  const result = groupByYear(days);

  assertLength(result, 3);
  assertEqual(result[0].year, 2025, 'first year = 2025');
  assertEqual(result[1].year, 2026, 'second year = 2026');
  assertEqual(result[2].year, 2027, 'third year = 2027');
  assertLength(result[0].days, 1);
  assertLength(result[1].days, 1);
  assertLength(result[2].days, 1);
});

// 10. groupByYear — empty input
runTest('groupByYear: empty input returns empty array', () => {
  const result = groupByYear([]);

  assertLength(result, 0);
});

// 11. computeCalendarHeatmap — orchestrator
runTest('computeCalendarHeatmap: full pipeline from trades to year-groups', () => {
  const result = computeCalendarHeatmap([LONG_WIN_TRADE, LONG_LOSS_TRADE, SHORT_WIN_TRADE]);

  assertLength(result, 1); // All 2026
  assertEqual(result[0].year, 2026, 'year = 2026');
  assertLength(result[0].days, 3);

  // Verify daily P&L values
  const dayMap = new Map(result[0].days.map((d) => [d.date, d.pnl]));
  assertClose(dayMap.get('2026-01-15')!, 996, '2026-01-15 PnL = 996');
  assertClose(dayMap.get('2026-01-20')!, -1004, '2026-01-20 PnL ≈ -1004');
  assertClose(dayMap.get('2026-02-10')!, 1994, '2026-02-10 PnL = 1994');
});

// 12. computeCalendarHeatmap — empty input
runTest('computeCalendarHeatmap: empty input returns empty array', () => {
  const result = computeCalendarHeatmap([]);

  assertLength(result, 0);
});

// 13. computeCalendarHeatmap — skips trades without closedAt
runTest('computeCalendarHeatmap: skips trades without closedAt', () => {
  const result = computeCalendarHeatmap([TRADE_NO_CLOSED_AT]);

  assertLength(result, 0);
});

// 14. toEChartsCalendarData
runTest('toEChartsCalendarData: converts to [date, value] tuples', () => {
  const yearData: CalendarHeatmapYearData = {
    year: 2026,
    days: [
      { date: '2026-01-15', pnl: 996 },
      { date: '2026-01-20', pnl: -1004 },
    ],
  };

  const result = toEChartsCalendarData(yearData);

  assertLength(result, 2);
  assertEqual(result[0], ['2026-01-15', 996], 'first ECharts entry');
  assertEqual(result[1], ['2026-01-20', -1004], 'second ECharts entry');
});

// 15. toEChartsCalendarData — empty days
runTest('toEChartsCalendarData: empty days returns empty array', () => {
  const yearData: CalendarHeatmapYearData = { year: 2026, days: [] };

  const result = toEChartsCalendarData(yearData);

  assertLength(result, 0);
});

// 16. computeCalendarHeatmapStats — with data
runTest('computeCalendarHeatmapStats: computes min/max/days/trades', () => {
  const result = computeCalendarHeatmapStats([LONG_WIN_TRADE, LONG_LOSS_TRADE, SHORT_WIN_TRADE]);

  assertClose(result.minPnl!, -1004, 'minPnl = -1004');
  assertClose(result.maxPnl!, 1994, 'maxPnl = 1994');
  assertEqual(result.totalDays, 3, 'totalDays = 3');
  assertEqual(result.totalTrades, 3, 'totalTrades = 3');
});

// 17. computeCalendarHeatmapStats — empty input
runTest('computeCalendarHeatmapStats: empty input returns null stats', () => {
  const result = computeCalendarHeatmapStats([]);

  assertNull(result.minPnl, 'minPnl is null');
  assertNull(result.maxPnl, 'maxPnl is null');
  assertEqual(result.totalDays, 0, 'totalDays = 0');
  assertEqual(result.totalTrades, 0, 'totalTrades = 0');
});

// 18. computeCalendarHeatmapStats — skips null closedAt for trade count
runTest('computeCalendarHeatmapStats: only counts trades with closedAt', () => {
  const result = computeCalendarHeatmapStats([LONG_WIN_TRADE, TRADE_NO_CLOSED_AT]);

  assertEqual(result.totalTrades, 1, 'totalTrades = 1 (only closed trades counted)');
  assertEqual(result.totalDays, 1, 'totalDays = 1');
});

// 19. computeCalendarHeatmapStats — single trade, same min/max
runTest('computeCalendarHeatmapStats: single trade has same min/max', () => {
  const result = computeCalendarHeatmapStats([LONG_WIN_TRADE]);

  assertClose(result.minPnl!, 996, 'minPnl = 996');
  assertClose(result.maxPnl!, 996, 'maxPnl = 996');
  assertEqual(result.totalDays, 1, 'totalDays = 1');
  assertEqual(result.totalTrades, 1, 'totalTrades = 1');
});

// ── Negative Tests (Q7) ─────────────────────────────────────────────────

runTest('Q7-NEGATIVE: trades with empty executions array produce zero PnL', () => {
  const trade = makeTrade('empty-exec-001', 'long', [], '2026-01-15T10:00:00Z');

  const result = aggregateDailyPnL([trade]);

  assertLength(result, 1);
  assertClose(result[0].pnl, 0, 'empty executions = PnL 0');
  assertEqual(result[0].date, '2026-01-15', 'date preserved');
});

runTest('Q7-NEGATIVE: trades with zero-quantity executions produce zero PnL', () => {
  const executions: ExecutionData[] = [
    { action: 'buy', quantity: 0, price: 50, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'sell', quantity: 0, price: 60, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
  ];
  const trade = makeTrade('zero-qty-001', 'long', executions, '2026-01-15T10:00:00Z');

  const result = aggregateDailyPnL([trade]);

  assertLength(result, 1);
  assertClose(result[0].pnl, 0, 'zero quantity executions = PnL 0');
});

runTest('Q7-NEGATIVE: trade with null fees still computes PnL', () => {
  const executions: ExecutionData[] = [
    { action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'sell', quantity: 100, price: 60, fees: null, executedAt: '2026-01-01T14:00:00Z' },
  ];
  const trade = makeTrade('null-fees-001', 'long', executions, '2026-01-15T10:00:00Z');

  const result = aggregateDailyPnL([trade]);

  assertLength(result, 1);
  assertClose(result[0].pnl, 1000, 'null fees = PnL 1000 (fees treated as 0)');
});

runTest('Q7-NEGATIVE: invalid date string in closedAt is handled gracefully', () => {
  const trade = makeTrade('bad-date-001', 'long', longTradeExecutions(50, 60), 'not-a-date');

  const result = aggregateDailyPnL([trade]);

  assertLength(result, 1);
  // Should produce an entry with the raw string sliced to 10 chars
  assertEqual(result[0].date, 'not-a-date', 'date derived from slice(0,10) of raw string');
});

runTest('Q7-NEGATIVE: groupByYear handles dates from different years without day overlap', () => {
  const days: CalendarHeatmapDay[] = [
    { date: '2025-01-01', pnl: 100 },
    { date: '2027-12-31', pnl: 200 },
  ];

  const result = groupByYear(days);

  assertLength(result, 2);
  assertEqual(result[0].year, 2025, 'first year = 2025');
  assertEqual(result[1].year, 2027, 'second year = 2027');
});

runTest('Q7-NEGATIVE: multiple trades same date in same year group correctly', () => {
  const trades = [
    makeTrade('a', 'long', longTradeExecutions(50, 60, 100), '2026-01-15T10:00:00Z'),
    makeTrade('b', 'long', longTradeExecutions(50, 55, 100), '2026-01-15T11:00:00Z'),
    makeTrade('c', 'long', longTradeExecutions(50, 70, 100), '2026-01-15T12:00:00Z'),
  ];

  const result = computeCalendarHeatmap(trades);

  assertLength(result, 1);
  assertLength(result[0].days, 1);
  // (60-50)*100 + (55-50)*100 + (70-50)*100 = 1000 + 500 + 2000 = 3500
  assertClose(result[0].days[0].pnl, 3500, 'three trades same day summed PnL ≈ 3500');
});

// ── Summary ───────────────────────────────────────────────────────────

const failures = process.exitCode ? 'SOME FAILED' : 'ALL PASSED';
console.log(`\n${'─'.repeat(50)}`);
console.log(`  calendar-heatmap.test.ts — ${failures}`);
console.log(`  ${testCount} tests run`);
console.log(`${'─'.repeat(50)}`);
