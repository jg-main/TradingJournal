#!/usr/bin/env tsx
/**
 * period-matrix.test.ts
 *
 * Unit tests for the period-over-period computation library.
 * Tests in isolation without a database — fixtures are plain objects
 * matching PeriodMatrixTradeInput.
 *
 * Run: npx tsx src/lib/period-matrix.test.ts
 *
 * Pattern: src/lib/calendar-heatmap.test.ts, src/lib/dashboard.test.ts
 */

import {
  computePeriodMatrix,
  getPeriodFromDate,
  generatePriorPeriods,
  type PeriodComparisonType,
  type PeriodMatrixTradeInput,
  type PeriodDescriptor,
} from './period-matrix';
import { type ExecutionData } from './trade-metrics';

// ── Helpers ─────────────────────────────────────────────────────────────

// D8: tests must explicitly state the timezone controlling attribution.
const TEST_TIMEZONE = 'UTC';

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
  riskSnapshot: { initialRiskAmount: number | null } | null = null,
): PeriodMatrixTradeInput {
  return { id, direction, executions, riskSnapshot, closedAt };
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

function assertNotEqual<T>(actual: T, unexpected: T, label: string): void {
  const a = JSON.stringify(actual);
  const u = JSON.stringify(unexpected);
  if (a === u) {
    console.error(`  ❌ FAIL: ${label} — got unexpected ${u}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${label}`);
  }
}

let testCount = 0;

function runTest(name: string, fn: () => void): void {
  testCount++;
  console.log(`\n#${testCount}: ${name}`);
  fn();
}

// ── Fixtures ───────────────────────────────────────────────────────────

// Week 1 (Mon Dec 29, 2025 - Sun Jan 4, 2026): one winning trade
const W1_WIN_TRADE = makeTrade(
  'w1-win', 'long',
  longTradeExecutions(50, 60, 100, 2, 2),  // PnL = (60-50)*100 - 4 = 996
  '2026-01-02T10:00:00Z',                  // Fri of W1
  { initialRiskAmount: 500 },
);

// Week 2 (Mon Jan 5 - Sun Jan 11, 2026): one losing trade
const W2_LOSS_TRADE = makeTrade(
  'w2-loss', 'long',
  longTradeExecutions(50, 40, 100, 2, 2),  // PnL = (40-50)*100 - 4 = -1004
  '2026-01-09T14:00:00Z',                  // Fri of W2
  { initialRiskAmount: 500 },
);

// Week 3 (Mon Jan 12 - Sun Jan 18, 2026): two trades — one win, one loss
const W3_WIN_TRADE = makeTrade(
  'w3-win', 'short',
  shortTradeExecutions(60, 50, 100, 2, 2),  // PnL = (60-50)*100 - 4 = 996
  '2026-01-14T11:00:00Z',                   // Wed of W3
  { initialRiskAmount: 600 },
);
const W3_LOSS_TRADE = makeTrade(
  'w3-loss', 'long',
  longTradeExecutions(50, 45, 100, 2, 2),  // PnL = (45-50)*100 - 4 = -504
  '2026-01-15T15:00:00Z',                   // Thu of W3
  { initialRiskAmount: 400 },
);

// Week 4 (Mon Jan 19 - Sun Jan 25, 2026): scratch trade (P&L ≈ -2, clearly a loss)
const W4_SCRATCH_TRADE = makeTrade(
  'w4-scratch', 'long',
  longTradeExecutions(50, 50, 100, 1, 1),  // PnL = (50-50)*100 - 2 = -2
  '2026-01-23T16:00:00Z',                      // Fri of W4
  { initialRiskAmount: 500 },
);

// Week 5 (Mon Jan 26 - Sun Feb 1, 2026): two winning trades
const W5_WIN_1 = makeTrade(
  'w5-win-1', 'long',
  longTradeExecutions(50, 62, 100, 2, 2),     // PnL = (62-50)*100 - 4 = 1196
  '2026-01-28T10:00:00Z',                     // Wed of W5
  { initialRiskAmount: 500 },
);
const W5_WIN_2 = makeTrade(
  'w5-win-2', 'short',
  shortTradeExecutions(70, 55, 100, 2, 2),    // PnL = (70-55)*100 - 4 = 1496
  '2026-01-30T14:00:00Z',                     // Fri of W5
  { initialRiskAmount: 600 },
);

// Trade spanning a different month (Feb 2026)
const FEB_WIN_TRADE = makeTrade(
  'feb-win', 'long',
  longTradeExecutions(50, 65, 100, 2, 2),     // PnL = (65-50)*100 - 4 = 1496
  '2026-02-13T11:00:00Z',                      // Fri Feb 13
  { initialRiskAmount: 500 },
);

// Trade in Q2 2026 (Apr-Jun)
const Q2_WIN_TRADE = makeTrade(
  'q2-win', 'long',
  longTradeExecutions(50, 70, 100, 2, 2),     // PnL = (70-50)*100 - 4 = 1996
  '2026-04-15T11:00:00Z',                      // Wed Apr 15
  { initialRiskAmount: 500 },
);

// Trade without risk data (R-multiple should be null)
const NO_RISK_TRADE = makeTrade(
  'no-risk', 'long',
  longTradeExecutions(50, 55, 100, 2, 2),     // PnL = (55-50)*100 - 4 = 496
  '2026-01-14T10:00:00Z',                      // Wed of W3
  null,                                         // No risk snapshot
);

// Trade without closedAt (should be skipped)
const OPEN_TRADE = makeTrade(
  'open-trade', 'long',
  longTradeExecutions(50, 55, 100, 2, 2),     // PnL = 496
  null,
  { initialRiskAmount: 500 },
);

// ── getPeriodFromDate Tests ─────────────────────────────────────────────

runTest('getPeriodFromDate: WoW returns correct ISO week 1 for 2026-01-02', () => {
  const result = getPeriodFromDate('2026-01-02T10:00:00Z', 'wow', TEST_TIMEZONE);

  assertEqual(result.periodId, '2026-W01', 'periodId = 2026-W01');
  assertEqual(result.periodLabel, 'Week 1', 'periodLabel = Week 1');
  // ISO week 1 of 2026 starts on Monday Dec 29, 2025 based on the first Thursday rule
  // 2026-01-01 is a Thursday → W1 starts Mon Dec 29
  assertEqual(result.startDate, '2025-12-29', 'startDate = 2025-12-29');
  assertEqual(result.endDate, '2026-01-04', 'endDate = 2026-01-04');
});

runTest('getPeriodFromDate: WoW returns correct ISO week 2 for 2026-01-09', () => {
  const result = getPeriodFromDate('2026-01-09', 'wow', TEST_TIMEZONE);

  assertEqual(result.periodId, '2026-W02', 'periodId = 2026-W02');
  assertEqual(result.periodLabel, 'Week 2', 'periodLabel = Week 2');
  assertEqual(result.startDate, '2026-01-05', 'startDate = 2026-01-05');
  assertEqual(result.endDate, '2026-01-11', 'endDate = 2026-01-11');
});

runTest('getPeriodFromDate: WoW returns correct ISO week 5 for 2026-01-30', () => {
  const result = getPeriodFromDate('2026-01-30', 'wow', TEST_TIMEZONE);

  assertEqual(result.periodId, '2026-W05', 'periodId = 2026-W05');
  assertEqual(result.periodLabel, 'Week 5', 'periodLabel = Week 5');
  assertEqual(result.startDate, '2026-01-26', 'startDate = 2026-01-26');
  assertEqual(result.endDate, '2026-02-01', 'endDate = 2026-02-01');
});

runTest('getPeriodFromDate: MoM returns January 2026', () => {
  const result = getPeriodFromDate('2026-01-15', 'mom', TEST_TIMEZONE);

  assertEqual(result.periodId, '2026-01', 'periodId = 2026-01');
  assertEqual(result.periodLabel, 'Jan 2026', 'periodLabel = Jan 2026');
  assertEqual(result.startDate, '2026-01-01', 'startDate = 2026-01-01');
  assertEqual(result.endDate, '2026-01-31', 'endDate = 2026-01-31');
});

runTest('getPeriodFromDate: MoM returns February 2026', () => {
  const result = getPeriodFromDate('2026-02-13', 'mom', TEST_TIMEZONE);

  assertEqual(result.periodId, '2026-02', 'periodId = 2026-02');
  assertEqual(result.periodLabel, 'Feb 2026', 'periodLabel = Feb 2026');
  assertEqual(result.startDate, '2026-02-01', 'startDate = 2026-02-01');
  assertEqual(result.endDate, '2026-02-28', 'endDate = 2026-02-28');
});

runTest('getPeriodFromDate: QoQ returns Q1 2026 for January', () => {
  const result = getPeriodFromDate('2026-01-15', 'qoq', TEST_TIMEZONE);

  assertEqual(result.periodId, '2026-Q1', 'periodId = 2026-Q1');
  assertEqual(result.periodLabel, 'Q1 2026', 'periodLabel = Q1 2026');
  assertEqual(result.startDate, '2026-01-01', 'startDate = 2026-01-01');
  assertEqual(result.endDate, '2026-03-31', 'endDate = 2026-03-31');
});

runTest('getPeriodFromDate: QoQ returns Q2 2026 for April', () => {
  const result = getPeriodFromDate('2026-04-15', 'qoq', TEST_TIMEZONE);

  assertEqual(result.periodId, '2026-Q2', 'periodId = 2026-Q2');
  assertEqual(result.periodLabel, 'Q2 2026', 'periodLabel = Q2 2026');
  assertEqual(result.startDate, '2026-04-01', 'startDate = 2026-04-01');
  assertEqual(result.endDate, '2026-06-30', 'endDate = 2026-06-30');
});

// ── generatePriorPeriods Tests ──────────────────────────────────────────

runTest('generatePriorPeriods: generates 4 WoW periods', () => {
  const periods = generatePriorPeriods('2026-01-30', 'wow', 4, TEST_TIMEZONE);

  assertLength(periods, 4);
  // Should be: W02, W03, W04, W05 (oldest first)
  assertEqual(periods[0].periodId, '2026-W02', 'first = W02');
  assertEqual(periods[1].periodId, '2026-W03', 'second = W03');
  assertEqual(periods[2].periodId, '2026-W04', 'third = W04');
  assertEqual(periods[3].periodId, '2026-W05', 'fourth = W05');
});

runTest('generatePriorPeriods: generates 3 MoM periods across year boundary', () => {
  const periods = generatePriorPeriods('2026-01-15', 'mom', 3, TEST_TIMEZONE);

  assertLength(periods, 3);
  assertEqual(periods[0].periodId, '2025-11', 'first = Nov 2025');
  assertEqual(periods[1].periodId, '2025-12', 'second = Dec 2025');
  assertEqual(periods[2].periodId, '2026-01', 'third = Jan 2026');
});

runTest('generatePriorPeriods: generates 2 QoQ periods', () => {
  const periods = generatePriorPeriods('2026-06-15', 'qoq', 2, TEST_TIMEZONE);

  assertLength(periods, 2);
  assertEqual(periods[0].periodId, '2026-Q1', 'first = Q1 2026');
  assertEqual(periods[1].periodId, '2026-Q2', 'second = Q2 2026');
});

// ── computePeriodMatrix: WoW Tests ──────────────────────────────────────

const ALL_TRADES = [
  W1_WIN_TRADE,   // W1: win  996
  W2_LOSS_TRADE,  // W2: -1004
  W3_WIN_TRADE,   // W3: win  996
  W3_LOSS_TRADE,  // W3: -504  (net: 492)
  W4_SCRATCH_TRADE, // W4: ≈0  (scratch → loss per includeZeroAsLoss)
  W5_WIN_1,       // W5: 1196
  W5_WIN_2,       // W5: 1496  (net: 2692)
];

runTest('computePeriodMatrix: WoW with 6 trades over 5 weeks, 4 periods', () => {
  const result = computePeriodMatrix(ALL_TRADES, 'wow', TEST_TIMEZONE, 4);

  assertEqual(result.comparisonType, 'wow', 'comparisonType = wow');
  // 4 periods → 3 comparison rows
  assertLength(result.rows, 3, '3 comparison rows for 4 periods');

  // Rows ordered most recent first: W5 vs W4, W4 vs W3, W3 vs W2
  const [row1, row2, row3] = result.rows;

  // Row 1: W5 (current) vs W4 (previous)
  assertEqual(row1.current.periodId, '2026-W05', 'row1 current = W05');
  assertEqual(row1.current.tradeCount, 2, 'row1 current tradeCount = 2');
  assertClose(row1.current.pnl, 2692, 'row1 current PnL = 2692');
  assertClose(row1.current.winRate!, 1, 'row1 current winRate = 1.0');

  assertEqual(row1.previous.periodId, '2026-W04', 'row1 previous = W04');
  assertEqual(row1.previous.tradeCount, 1, 'row1 previous tradeCount = 1');
  assertClose(row1.previous.pnl, -2, 'row1 previous PnL = -2 (scratch loss)');
  // Scratch is a loss per includeZeroAsLoss → winRate = 0
  assertClose(row1.previous.winRate!, 0, 'row1 previous winRate = 0');

  // Deltas
  assertClose(row1.delta.winRate!, 1, 'row1 delta winRate = +1 (100% vs 0%)');
  assertClose(row1.delta.pnl!, 2694, 'row1 delta PnL = +2694');
  assertClose(row1.delta.tradeCount!, 1, 'row1 delta tradeCount = +1');

  // Row 2: W4 vs W3
  assertEqual(row2.current.periodId, '2026-W04', 'row2 current = W04');
  assertEqual(row2.current.tradeCount, 1, 'row2 current tradeCount = 1');
  assertClose(row2.current.pnl, -2, 'row2 current PnL = -2');

  assertEqual(row2.previous.periodId, '2026-W03', 'row2 previous = W03');
  assertEqual(row2.previous.tradeCount, 2, 'row2 previous tradeCount = 2');
  assertClose(row2.previous.pnl, 492, 'row2 previous PnL = 492 (996 - 504)');

  // Row 3: W3 vs W2
  assertEqual(row3.current.periodId, '2026-W03', 'row3 current = W03');
  assertEqual(row3.current.tradeCount, 2, 'row3 current tradeCount = 2');
  assertClose(row3.current.pnl, 492, 'row3 current PnL = 492');

  assertEqual(row3.previous.periodId, '2026-W02', 'row3 previous = W02');
  assertEqual(row3.previous.tradeCount, 1, 'row3 previous tradeCount = 1');
  assertClose(row3.previous.pnl, -1004, 'row3 previous PnL = -1004');
});

runTest('computePeriodMatrix: WoW R-multiple values are computed correctly', () => {
  const result = computePeriodMatrix(ALL_TRADES, 'wow', TEST_TIMEZONE, 4);

  // Row 1: W5 - two trades with risk data
  //   W5_WIN_1: 1196/500 = 2.392R
  //   W5_WIN_2: 1496/600 = 2.493R
  //   avgR ≈ (2.392 + 2.493)/2 = 2.443
  const row1 = result.rows[0];
  assertClose(row1.current.avgR, 2.443, 'W5 avgR ≈ 2.443', 0.01);
  assertClose(row1.previous.avgR, -0.004, 'W4 avgR = -0.004 (-2/500)', 0.001);

  // Row 3: W3 - two trades
  //   W3_WIN: 996/600 = 1.66R
  //   W3_LOSS: -504/400 = -1.26R
  //   avgR ≈ (1.66 + (-1.26))/2 = 0.2
  const row3 = result.rows[2];
  assertClose(row3.current.avgR, 0.2, 'W3 avgR ≈ 0.2', 0.01);
});

runTest('computePeriodMatrix: WoW with 2 periods (minimum)', () => {
  const result = computePeriodMatrix(ALL_TRADES, 'wow', TEST_TIMEZONE, 2);

  assertLength(result.rows, 1, '2 periods → 1 comparison row');
  assertEqual(result.rows[0].current.periodId, '2026-W05', 'current = W05');
  assertEqual(result.rows[0].previous.periodId, '2026-W04', 'previous = W04');
});

// ── computePeriodMatrix: MoM Tests ──────────────────────────────────────

const MONTHLY_TRADES = [
  // Place specific months
  makeTrade('m-jan1', 'long', longTradeExecutions(50, 60, 100), '2026-01-05T10:00:00Z', { initialRiskAmount: 500 }),  // Jan: win 996
  makeTrade('m-jan2', 'long', longTradeExecutions(50, 40, 100), '2026-01-20T10:00:00Z', { initialRiskAmount: 500 }),  // Jan: -1004
  makeTrade('m-feb1', 'long', longTradeExecutions(50, 65, 100), '2026-02-10T10:00:00Z', { initialRiskAmount: 500 }),  // Feb: win 1496
  makeTrade('m-mar1', 'short', shortTradeExecutions(60, 40, 200), '2026-03-15T10:00:00Z', { initialRiskAmount: 1000 }), // Mar: (60-40)*200 = 4000
  makeTrade('m-apr1', 'long', longTradeExecutions(50, 55, 100), '2026-04-01T10:00:00Z', { initialRiskAmount: 500 }),  // Apr: win 496
];

runTest('computePeriodMatrix: MoM with 4 periods spanning Jan-Apr', () => {
  const result = computePeriodMatrix(MONTHLY_TRADES, 'mom', TEST_TIMEZONE, 4);

  assertEqual(result.comparisonType, 'mom', 'comparisonType = mom');
  // 4 periods → 3 comparison rows
  assertLength(result.rows, 3, '3 comparison rows for 4 months');

  // Most recent period should be April (latest trade: Apr 1)
  const [row1] = result.rows;
  assertEqual(row1.current.periodId, '2026-04', 'row1 current = Apr 2026');
  assertEqual(row1.current.tradeCount, 1, 'row1 current tradeCount = 1');
  assertClose(row1.current.pnl, 500, 'row1 current PnL = 500');

  // Previous period: March
  assertEqual(row1.previous.periodId, '2026-03', 'row1 previous = Mar 2026');
  assertEqual(row1.previous.tradeCount, 1, 'row1 previous tradeCount = 1');
  assertClose(row1.previous.pnl, 4000, 'row1 previous PnL = 4000');

  // March P&L is higher than April → negative delta
  assertClose(row1.delta.pnl!, -3500, 'row1 delta PnL = -3500');
});

// ── computePeriodMatrix: QoQ Tests ──────────────────────────────────────

const QUARTERLY_TRADES = [
  makeTrade('q-q1-1', 'long', longTradeExecutions(50, 60, 100), '2026-01-15T10:00:00Z', { initialRiskAmount: 500 }),  // Q1: win 996
  makeTrade('q-q1-2', 'long', longTradeExecutions(50, 40, 100), '2026-02-20T10:00:00Z', { initialRiskAmount: 500 }),  // Q1: -1004
  makeTrade('q-q2-1', 'long', longTradeExecutions(50, 70, 100), '2026-04-10T10:00:00Z', { initialRiskAmount: 500 }),  // Q2: win 1996
  makeTrade('q-q2-2', 'short', shortTradeExecutions(60, 50, 100), '2026-05-15T10:00:00Z', { initialRiskAmount: 500 }), // Q2: win 996
];

runTest('computePeriodMatrix: QoQ with Q1 vs Q2', () => {
  const result = computePeriodMatrix(QUARTERLY_TRADES, 'qoq', TEST_TIMEZONE, 2);

  assertEqual(result.comparisonType, 'qoq', 'comparisonType = qoq');
  assertLength(result.rows, 1, '2 periods → 1 comparison row');

  const row1 = result.rows[0];
  assertEqual(row1.current.periodId, '2026-Q2', 'current = Q2 2026');
  assertEqual(row1.current.tradeCount, 2, 'Q2 tradeCount = 2');
  // Fixtures use default fees of 0 → PnL before fees only
  // q-q2-1: (70-50)*100 = 2000, q-q2-2: (60-50)*100 = 1000, total = 3000
  assertClose(row1.current.pnl, 3000, 'Q2 PnL = 3000 (2000 + 1000)');

  assertEqual(row1.previous.periodId, '2026-Q1', 'previous = Q1 2026');
  assertEqual(row1.previous.tradeCount, 2, 'Q1 tradeCount = 2');
  // q-q1-1: (60-50)*100 = 1000, q-q1-2: (40-50)*100 = -1000, total = 0
  assertClose(row1.previous.pnl, 0, 'Q1 PnL = 0 (1000 - 1000)');
});

// ── Edge Cases ──────────────────────────────────────────────────────────

runTest('computePeriodMatrix: empty trades returns empty rows', () => {
  const result = computePeriodMatrix([], 'wow', TEST_TIMEZONE);

  assertEqual(result.comparisonType, 'wow', 'comparisonType preserved');
  assertLength(result.rows, 0, 'no rows for empty input');
});

runTest('computePeriodMatrix: all null closedAt returns empty rows', () => {
  const result = computePeriodMatrix([OPEN_TRADE, OPEN_TRADE], 'wow', TEST_TIMEZONE);

  assertLength(result.rows, 0, 'no rows when all trades are open');
});

runTest('computePeriodMatrix: trades without risk data have avgR null', () => {
  const result = computePeriodMatrix([NO_RISK_TRADE, W3_WIN_TRADE], 'wow', TEST_TIMEZONE, 2);

  // Both trades in W3
  assertLength(result.rows, 1, '1 comparison row');
  assertEqual(result.rows[0].current.tradeCount, 2, '2 trades in period');
  // W3_WIN has risk, NO_RISK_TRADE doesn't → only 1 valid R-multiple
  assertClose(result.rows[0].current.avgR!, 1.66, 'avgR based on only the trade with risk data', 0.01);
});

runTest('computePeriodMatrix: all trades in same period produces single row', () => {
  const sameWeekTrades = [
    W5_WIN_1,
    makeTrade('same-w2', 'long', longTradeExecutions(30, 35, 200), '2026-01-30T10:00:00Z'),
    makeTrade('same-w3', 'long', longTradeExecutions(40, 45, 200), '2026-01-30T14:00:00Z'),
  ];

  const result = computePeriodMatrix(sameWeekTrades, 'wow', TEST_TIMEZONE, 2);

  // All in W05 → current = W05, previous = W04 (no trades)
  assertLength(result.rows, 1, '1 comparison row');
  assertEqual(result.rows[0].current.tradeCount, 3, '3 trades in current');
  assertEqual(result.rows[0].previous.tradeCount, 0, '0 trades in previous');
  assertNull(result.rows[0].previous.winRate, 'previous winRate = null');
  assertNull(result.rows[0].previous.avgR, 'previous avgR = null');
});

runTest('computePeriodMatrix: null deltas when previous has no metrics', () => {
  const singleWeekTrades = [W5_WIN_1, W5_WIN_2];

  const result = computePeriodMatrix(singleWeekTrades, 'wow', TEST_TIMEZONE, 2);

  assertLength(result.rows, 1, '1 comparison row');
  // Previous week has no trades → metrics are null
  assertNull(result.rows[0].delta.winRate, 'delta winRate = null (previous null)');
  assertNull(result.rows[0].delta.avgR, 'delta avgR = null (previous null)');
  // PnL and tradeCount are always numbers (not null)
  assertNotEqual(result.rows[0].delta.pnl, null, 'delta pnl is not null');
  assertNotEqual(result.rows[0].delta.tradeCount, null, 'delta tradeCount is not null');
});

// ── Negative Tests (Q7) ─────────────────────────────────────────────────

runTest('Q7-NEGATIVE: zero-quantity executions produce zero PnL per period', () => {
  const zeroQtyExecutions: ExecutionData[] = [
    { action: 'buy', quantity: 0, price: 50, fees: 0, executedAt: '2026-01-02T10:00:00Z' },
    { action: 'sell', quantity: 0, price: 60, fees: 0, executedAt: '2026-01-02T14:00:00Z' },
  ];
  const trade = makeTrade('zero-qty', 'long', zeroQtyExecutions, '2026-01-02T14:00:00Z', { initialRiskAmount: 500 });

  const result = computePeriodMatrix([trade], 'wow', TEST_TIMEZONE, 2);

  assertLength(result.rows, 1, '1 comparison row');
  assertClose(result.rows[0].current.pnl, 0, 'zero qty → PnL = 0');
});

runTest('Q7-NEGATIVE: trade with null fees still computes correctly', () => {
  const nullFeesExecutions: ExecutionData[] = [
    { action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-02T10:00:00Z' },
    { action: 'sell', quantity: 100, price: 60, fees: null, executedAt: '2026-01-02T14:00:00Z' },
  ];
  const trade = makeTrade('null-fees', 'long', nullFeesExecutions, '2026-01-02T14:00:00Z', { initialRiskAmount: 500 });

  const result = computePeriodMatrix([trade], 'wow', TEST_TIMEZONE, 2);

  assertClose(result.rows[0].current.pnl, 1000, 'null fees → PnL = 1000 (fees treated as 0)');
  assertClose(result.rows[0].current.avgR!, 2, 'null fees → avgR = 2 (1000/500)');
});

runTest('Q7-NEGATIVE: maxPeriods less than 2 is clamped to 2', () => {
  const result = computePeriodMatrix(ALL_TRADES, 'wow', TEST_TIMEZONE, 1);

  assertLength(result.rows, 1, 'clamped to 2 → 1 row');
});

runTest('Q7-NEGATIVE: very many periods still produce valid comparison rows', () => {
  // Use the all-period spanning trades (W1-W5) to test with 10 periods
  const result = computePeriodMatrix(ALL_TRADES, 'wow', TEST_TIMEZONE, 10);

  // Should produce 9 comparison rows
  assertLength(result.rows, 9, '10 periods → 9 rows');
  // First row should still be W5
  assertEqual(result.rows[0].current.periodId, '2026-W05', 'first row = W05');
  // Earlier periods should have 0 trades (no data)
  const lastRow = result.rows[result.rows.length - 1];
  assertEqual(lastRow.previous.tradeCount, 0, 'earliest period has 0 trades');
});

runTest('Q7-NEGATIVE: trades at exact period boundary are included', () => {
  // Trade closing exactly on the last day of W5 (Sun Feb 1)
  const exactBoundary = makeTrade(
    'boundary', 'long',
    longTradeExecutions(50, 60, 100, 2, 2),
    '2026-02-01T23:59:00Z',
    { initialRiskAmount: 500 },
  );

  const result = computePeriodMatrix([exactBoundary, W4_SCRATCH_TRADE], 'wow', TEST_TIMEZONE, 2);

  assertLength(result.rows, 1, '1 comparison row');
  assertEqual(result.rows[0].current.periodId, '2026-W05', 'boundary trade in W5');
  assertEqual(result.rows[0].current.tradeCount, 1, '1 trade in W5');
});

runTest('Q7-NEGATIVE: empty executions array produces zero PnL', () => {
  const trade = makeTrade('empty-exec', 'long', [], '2026-01-02T10:00:00Z', { initialRiskAmount: 500 });

  const result = computePeriodMatrix([trade], 'wow', TEST_TIMEZONE, 2);

  assertClose(result.rows[0].current.pnl, 0, 'empty exec → PnL = 0');
  assertClose(result.rows[0].current.avgR!, 0, 'empty exec → avgR = 0 (0/500)');
});

// ── D8 regression tests (canonical app-timezone period attribution) ────

runTest('D8: month boundary — Bogotá late-evening close lands in previous local month (MoM)', () => {
  // 2026-04-01T03:30:00Z = 2026-03-31 22:30 in America/Bogota → March 2026, NOT April.
  const trade = makeTrade('mom-boundary-001', 'long', longTradeExecutions(50, 60), '2026-04-01T03:30:00.000Z');

  const bogota = getPeriodFromDate('2026-04-01T03:30:00.000Z', 'mom', 'America/Bogota');
  assertEqual(bogota.periodId, '2026-03', 'Bogotá MoM period = 2026-03');

  const utc = getPeriodFromDate('2026-04-01T03:30:00.000Z', 'mom', 'UTC');
  assertEqual(utc.periodId, '2026-04', 'UTC MoM period = 2026-04');

  // Trade attribution follows the same local calendar.
  const matrix = computePeriodMatrix([trade], 'mom', 'America/Bogota', 2);
  assertEqual(matrix.rows[0].current.periodId, '2026-03', 'trade assigned to 2026-03');
  assertEqual(matrix.rows[0].current.tradeCount, 1, 'trade counted in March period');
});

runTest('D8: quarter boundary — Bogotá late-evening close lands in Q1 (QoQ)', () => {
  // 2026-04-01T03:30:00Z = 2026-03-31 22:30 in America/Bogota → Q1 2026, NOT Q2.
  const bogota = getPeriodFromDate('2026-04-01T03:30:00.000Z', 'qoq', 'America/Bogota');
  assertEqual(bogota.periodId, '2026-Q1', 'Bogotá QoQ period = 2026-Q1');

  const utc = getPeriodFromDate('2026-04-01T03:30:00.000Z', 'qoq', 'UTC');
  assertEqual(utc.periodId, '2026-Q2', 'UTC QoQ period = 2026-Q2');
});

runTest('D8: week boundary — UTC Monday that is still Sunday locally stays in the PREVIOUS local ISO week', () => {
  // 2026-03-09T00:30:00Z = 2026-03-08 19:30 in America/Bogota (Sunday) → ISO week of Mon 2026-03-02.
  const bogota = getPeriodFromDate('2026-03-09T00:30:00.000Z', 'wow', 'America/Bogota');
  assertEqual(bogota.startDate, '2026-03-02', 'Bogotá WoW start = previous local Monday 2026-03-02');
  assertEqual(bogota.periodId, '2026-W10', 'Bogotá WoW period = 2026-W10');

  const utc = getPeriodFromDate('2026-03-09T00:30:00.000Z', 'wow', 'UTC');
  assertEqual(utc.startDate, '2026-03-09', 'UTC WoW start = 2026-03-09');
});

runTest('D8: same instant under different configured timezones controls period assignment', () => {
  // 2026-03-09T00:30:00Z = Monday 00:30 UTC but Sunday 19:30 in Bogotá —
  // different local dates AND different ISO weeks.
  const trade = makeTrade('tz-config-001', 'long', longTradeExecutions(50, 60), '2026-03-09T00:30:00.000Z');

  const bogota = computePeriodMatrix([trade], 'wow', 'America/Bogota', 2);
  const utc = computePeriodMatrix([trade], 'wow', 'UTC', 2);
  assertEqual(bogota.rows[0].current.periodId, '2026-W10', 'Bogotá WoW period = 2026-W10 (Sunday still previous week)');
  assertEqual(utc.rows[0].current.periodId, '2026-W11', 'UTC WoW period = 2026-W11 (Monday)');
  assertNotEqual(bogota.rows[0].current.periodId, utc.rows[0].current.periodId,
    'configured timezone changes the WoW period of the same instant');
});

runTest('D8: year-crossing ISO week assignment uses local date', () => {
  // 2026-01-01T00:30:00Z = 2025-12-31 19:30 in America/Bogota → ISO week 1 of 2026 starts Mon 2025-12-29.
  const bogota = getPeriodFromDate('2026-01-01T00:30:00.000Z', 'wow', 'America/Bogota');
  assertEqual(bogota.startDate, '2025-12-29', 'local week start crosses into 2025');

  const utc = getPeriodFromDate('2026-01-01T00:30:00.000Z', 'wow', 'UTC');
  assertEqual(utc.startDate, '2025-12-29', 'UTC week start also 2025-12-29');
});

// ── Summary ───────────────────────────────────────────────────────────

const failures = process.exitCode ? 'SOME FAILED' : 'ALL PASSED';
console.log(`\n${'─'.repeat(50)}`);
console.log(`  period-matrix.test.ts — ${failures}`);
console.log(`  ${testCount} tests run`);
console.log(`${'─'.repeat(50)}`);
