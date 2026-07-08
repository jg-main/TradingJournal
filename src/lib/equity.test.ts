/**
 * equity.test.ts
 *
 * Unit tests for the equity curve and drawdown computation library.
 * Tests in isolation without a database — fixtures are plain objects
 * matching RollforwardRow.
 *
 * Run: npx tsx src/lib/equity.test.ts
 *
 * Pattern: src/lib/dashboard.test.ts
 */

import {
  computeEquityCurve,
  computeDrawdown,
  computeTradeMarkers,
} from './equity';
import { type RollforwardRow } from './dashboard';

// ── Helpers ─────────────────────────────────────────────────────────────

function assertEqual(actual: unknown, expected: unknown, label: string): void {
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

function assertEqualLen(actual: unknown[], expected: number, label: string): void {
  if (actual.length !== expected) {
    console.error(`  ❌ FAIL: ${label} — expected length ${expected}, got ${actual.length}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${label} (length=${expected})`);
  }
}

let testCount = 0;

function test(name: string, fn: () => void): void {
  testCount++;
  console.log(`\n#${testCount}: ${name}`);
  fn();
}

// ── Fixtures ───────────────────────────────────────────────────────────

const EMPTY_ROWS: RollforwardRow[] = [];

const SINGLE_ROW: RollforwardRow[] = [
  {
    date: '2026-01-01',
    endingEquity: 50000,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: 2000,
    highWaterMark: 50000,
  },
];

const MULTI_ROWS: RollforwardRow[] = [
  {
    date: '2026-01-01',
    endingEquity: 50000,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: 0,
    highWaterMark: 50000,
  },
  {
    date: '2026-01-08',
    endingEquity: 52500,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: 2500,
    highWaterMark: 52500,
  },
  {
    date: '2026-01-15',
    endingEquity: 51000,
    drawdownAmount: -1500,
    drawdownPct: -0.0286,
    cumulativePnl: 1000,
    highWaterMark: 52500,
  },
  {
    date: '2026-01-22',
    endingEquity: 54000,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: 4000,
    highWaterMark: 54000,
  },
];

/** Row where endingEquity is null — should be filtered out of equity curve. */
const NULL_EQUITY_ROWS: RollforwardRow[] = [
  {
    date: '2026-01-01',
    endingEquity: 50000,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: 0,
    highWaterMark: 50000,
  },
  {
    date: '2026-01-08',
    endingEquity: null,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: null,
    highWaterMark: null,
  },
  {
    date: '2026-01-15',
    endingEquity: 51000,
    drawdownAmount: -500,
    drawdownPct: -0.0098,
    cumulativePnl: 1000,
    highWaterMark: 51000,
  },
];

/** Row where drawdownPct is null — should be filtered out of drawdown. */
const NULL_DRAWDOWN_PCT_ROWS: RollforwardRow[] = [
  {
    date: '2026-01-01',
    endingEquity: 50000,
    drawdownAmount: 0,
    drawdownPct: null,
    cumulativePnl: 0,
    highWaterMark: 50000,
  },
  {
    date: '2026-01-08',
    endingEquity: 49500,
    drawdownAmount: -500,
    drawdownPct: -0.01,
    cumulativePnl: -500,
    highWaterMark: 50000,
  },
  {
    date: '2026-01-15',
    endingEquity: 49000,
    drawdownAmount: -1000,
    drawdownPct: null,
    cumulativePnl: -1000,
    highWaterMark: 50000,
  },
];

// ── Trade Marker Fixtures ─────────────────────────────────────────────

const ENTRY_EXECUTIONS = [
  { action: 'buy', quantity: 100, price: 150.50, fees: 5, executedAt: '2026-01-10T09:30:00Z' },
];

const EXIT_EXECUTIONS = [
  { action: 'sell', quantity: 100, price: 162.75, fees: 5, executedAt: '2026-01-15T14:00:00Z' },
];

const SHORT_ENTRY_EXECUTIONS = [
  { action: 'sell_short', quantity: 50, price: 200.00, fees: 3, executedAt: '2026-01-05T10:00:00Z' },
];

const SHORT_EXIT_EXECUTIONS = [
  { action: 'buy_to_cover', quantity: 50, price: 185.00, fees: 3, executedAt: '2026-01-12T11:00:00Z' },
];

const INCOMPLETE_TRADE_EXECUTIONS = [
  { action: 'buy', quantity: 100, price: 100.00, fees: 2, executedAt: '2026-01-20T09:00:00Z' },
  // No exit executions — should be filtered out
];

const TRADE_ROWS: RollforwardRow[] = [
  {
    date: '2026-01-01',
    endingEquity: 50000,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: 0,
    highWaterMark: 50000,
  },
  {
    date: '2026-01-08',
    endingEquity: 52500,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: 2500,
    highWaterMark: 52500,
  },
  {
    date: '2026-01-15',
    endingEquity: 51000,
    drawdownAmount: -1500,
    drawdownPct: -0.0286,
    cumulativePnl: 1000,
    highWaterMark: 52500,
  },
  {
    date: '2026-01-22',
    endingEquity: 54000,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: 4000,
    highWaterMark: 54000,
  },
];

/** Row with null cumulativePnl and highWaterMark — should use fallback defaults. */
const NULL_OPTIONAL_FIELDS: RollforwardRow[] = [
  {
    date: '2026-02-01',
    endingEquity: 60000,
    drawdownAmount: 0,
    drawdownPct: 0,
    cumulativePnl: null,
    highWaterMark: null,
  },
];

// ────────────────────────────────────────────────────────────────────────
// Tests: computeEquityCurve
// ────────────────────────────────────────────────────────────────────────

test('computeEquityCurve — empty array returns empty array', () => {
  const result = computeEquityCurve(EMPTY_ROWS);
  assertEqualLen(result, 0, 'empty input yields empty output');
});

test('computeEquityCurve — single row returns single data point', () => {
  const result = computeEquityCurve(SINGLE_ROW);
  assertEqualLen(result, 1, 'single row yields single point');
  assertEqual(result[0].date, '2026-01-01', 'date preserved');
  assertEqual(result[0].equity, 50000, 'equity matches endingEquity');
  assertEqual(result[0].cumulativePnl, 2000, 'cumulativePnl preserved');
  assertEqual(result[0].highWaterMark, 50000, 'highWaterMark preserved');
});

test('computeEquityCurve — multiple rows preserve order', () => {
  const result = computeEquityCurve(MULTI_ROWS);
  assertEqualLen(result, 4, 'all 4 rows produce data points');
  assertEqual(result[0].date, '2026-01-01', 'first row date preserved');
  assertEqual(result[1].date, '2026-01-08', 'second row date preserved');
  assertEqual(result[2].date, '2026-01-15', 'third row date preserved');
  assertEqual(result[3].date, '2026-01-22', 'fourth row date preserved');
});

test('computeEquityCurve — values computed correctly for multiple rows', () => {
  const result = computeEquityCurve(MULTI_ROWS);
  // Row 1: equity=50000, cumulativePnl=0, highWaterMark=50000
  assertEqual(result[0].equity, 50000, 'row 1 equity');
  assertEqual(result[0].cumulativePnl, 0, 'row 1 cumulativePnl');
  assertEqual(result[0].highWaterMark, 50000, 'row 1 highWaterMark');

  // Row 2: equity=52500, cumulativePnl=2500, highWaterMark=52500
  assertEqual(result[1].equity, 52500, 'row 2 equity');
  assertEqual(result[1].cumulativePnl, 2500, 'row 2 cumulativePnl');
  assertEqual(result[1].highWaterMark, 52500, 'row 2 highWaterMark');

  // Row 3: equity=51000, cumulativePnl=1000, highWaterMark=52500 (unchanged)
  assertEqual(result[2].equity, 51000, 'row 3 equity');
  assertEqual(result[2].cumulativePnl, 1000, 'row 3 cumulativePnl');
  assertEqual(result[2].highWaterMark, 52500, 'row 3 highWaterMark still at prior peak');

  // Row 4: equity=54000, cumulativePnl=4000, highWaterMark=54000 (new peak)
  assertEqual(result[3].equity, 54000, 'row 4 equity');
  assertEqual(result[3].cumulativePnl, 4000, 'row 4 cumulativePnl');
  assertEqual(result[3].highWaterMark, 54000, 'row 4 highWaterMark at new peak');
});

test('computeEquityCurve — filters rows with null endingEquity', () => {
  const result = computeEquityCurve(NULL_EQUITY_ROWS);
  assertEqualLen(result, 2, 'filters out null-endingEquity row');
  // Should have rows 1 and 3 only
  assertEqual(result[0].date, '2026-01-01', 'first valid row date');
  assertEqual(result[0].equity, 50000, 'first valid row equity');
  assertEqual(result[1].date, '2026-01-15', 'second valid row date');
  assertEqual(result[1].equity, 51000, 'second valid row equity');
});

test('computeEquityCurve — fallback when cumulativePnl and highWaterMark are null', () => {
  const result = computeEquityCurve(NULL_OPTIONAL_FIELDS);
  assertEqualLen(result, 1, 'row with null optionals still included');
  assertEqual(result[0].equity, 60000, 'equity preserved');
  assertEqual(result[0].cumulativePnl, 0, 'cumulativePnl falls back to 0');
  assertEqual(result[0].highWaterMark, 60000, 'highWaterMark falls back to equity');
});

test('computeEquityCurve — all rows null endingEquity returns empty', () => {
  const allNull: RollforwardRow[] = [
    {
      date: '2026-01-01',
      endingEquity: null,
      drawdownAmount: 0,
      drawdownPct: 0,
      cumulativePnl: null,
      highWaterMark: null,
    },
    {
      date: '2026-01-08',
      endingEquity: null,
      drawdownAmount: 0,
      drawdownPct: 0,
      cumulativePnl: null,
      highWaterMark: null,
    },
  ];
  const result = computeEquityCurve(allNull);
  assertEqualLen(result, 0, 'all rows filtered out returns empty');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: computeDrawdown
// ────────────────────────────────────────────────────────────────────────

test('computeDrawdown — empty array returns empty array', () => {
  const result = computeDrawdown(EMPTY_ROWS);
  assertEqualLen(result, 0, 'empty input yields empty output');
});

test('computeDrawdown — single row returns single data point', () => {
  const result = computeDrawdown(SINGLE_ROW);
  assertEqualLen(result, 1, 'single row yields single point');
  assertEqual(result[0].date, '2026-01-01', 'date preserved');
  assertEqual(result[0].drawdownAmount, 0, 'drawdownAmount preserved');
  assertEqual(result[0].drawdownPct, 0, 'drawdownPct preserved');
});

test('computeDrawdown — multiple rows preserve order', () => {
  const result = computeDrawdown(MULTI_ROWS);
  assertEqualLen(result, 4, 'all 4 rows produce data points');
  assertEqual(result[0].date, '2026-01-01', 'first row date');
  assertEqual(result[1].date, '2026-01-08', 'second row date');
  assertEqual(result[2].date, '2026-01-15', 'third row date');
  assertEqual(result[3].date, '2026-01-22', 'fourth row date');
});

test('computeDrawdown — values computed correctly for drawdown rows', () => {
  const result = computeDrawdown(MULTI_ROWS);
  // Row 1: no drawdown
  assertEqual(result[0].drawdownAmount, 0, 'row 1 drawdownAmount');
  assertEqual(result[0].drawdownPct, 0, 'row 1 drawdownPct');

  // Row 2: no drawdown
  assertEqual(result[1].drawdownAmount, 0, 'row 2 drawdownAmount');
  assertEqual(result[1].drawdownPct, 0, 'row 2 drawdownPct');

  // Row 3: drawdown present
  assertEqual(result[2].drawdownAmount, -1500, 'row 3 drawdownAmount');
  assertEqual(result[2].drawdownPct, -0.0286, 'row 3 drawdownPct is decimal (not multiplied by 100)');

  // Row 4: no drawdown
  assertEqual(result[3].drawdownAmount, 0, 'row 4 drawdownAmount');
  assertEqual(result[3].drawdownPct, 0, 'row 4 drawdownPct');
});

test('computeDrawdown — filters rows with null drawdownPct', () => {
  const result = computeDrawdown(NULL_DRAWDOWN_PCT_ROWS);
  assertEqualLen(result, 1, 'filters out null-drawdownPct rows');
  assertEqual(result[0].date, '2026-01-08', 'only the middle row with valid drawdownPct');
  assertEqual(result[0].drawdownAmount, -500, 'drawdownAmount preserved');
  assertEqual(result[0].drawdownPct, -0.01, 'drawdownPct preserved');
});

test('computeDrawdown — all rows null drawdownPct returns empty', () => {
  const allNull: RollforwardRow[] = [
    {
      date: '2026-01-01',
      endingEquity: 50000,
      drawdownAmount: 0,
      drawdownPct: null,
      cumulativePnl: 0,
      highWaterMark: 50000,
    },
    {
      date: '2026-01-08',
      endingEquity: 49500,
      drawdownAmount: -500,
      drawdownPct: null,
      cumulativePnl: -500,
      highWaterMark: 50000,
    },
  ];
  const result = computeDrawdown(allNull);
  assertEqualLen(result, 0, 'all rows filtered out returns empty');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: computeTradeMarkers
// ────────────────────────────────────────────────────────────────────────

test('computeTradeMarkers — single long trade produces 2 markers (entry + exit)', () => {
  const closedTrades = [
    {
      id: 'trade-001',
      direction: 'long' as const,
      executions: [...ENTRY_EXECUTIONS, ...EXIT_EXECUTIONS],
      closedAt: '2026-01-15T14:00:00Z',
    },
  ];
  const result = computeTradeMarkers(closedTrades, TRADE_ROWS);
  assertEqualLen(result, 2, 'single trade produces 2 markers');

  // Entry marker
  const entry = result.find((m) => m.markerType === 'entry');
  assertEqual(entry?.tradeId, 'trade-001', 'entry marker tradeId');
  assertEqual(entry?.date, '2026-01-10', 'entry marker date');
  assertEqual(entry?.direction, 'long', 'entry marker direction');
  assertEqual(entry?.price, 150.50, 'entry marker price (avg entry)');

  // Exit marker
  const exit = result.find((m) => m.markerType === 'exit');
  assertEqual(exit?.tradeId, 'trade-001', 'exit marker tradeId');
  assertEqual(exit?.date, '2026-01-15', 'exit marker date');
  assertEqual(exit?.direction, 'long', 'exit marker direction');
  assertEqual(exit?.price, 162.75, 'exit marker price (avg exit)');

  // Both markers share the same P&L
  assertEqual(entry?.pnl, exit?.pnl, 'entry and exit share same P&L');
  // Expected: (162.75 - 150.50) * 100 - 10 (fees) = 1215
  assertEqual(entry?.pnl, 1215, 'P&L for 100 shares at $12.25/share minus $10 fees');
});

test('computeTradeMarkers — multiple trades produce multiple markers', () => {
  const closedTrades = [
    {
      id: 'trade-001',
      direction: 'long' as const,
      executions: [...ENTRY_EXECUTIONS, ...EXIT_EXECUTIONS],
      closedAt: '2026-01-15T14:00:00Z',
    },
    {
      id: 'trade-002',
      direction: 'short' as const,
      executions: [...SHORT_ENTRY_EXECUTIONS, ...SHORT_EXIT_EXECUTIONS],
      closedAt: '2026-01-12T11:00:00Z',
    },
  ];
  const result = computeTradeMarkers(closedTrades, TRADE_ROWS);
  assertEqualLen(result, 4, '2 trades produce 4 markers');

  const trade1Markers = result.filter((m) => m.tradeId === 'trade-001');
  assertEqualLen(trade1Markers, 2, 'trade-001 has 2 markers');

  const trade2Markers = result.filter((m) => m.tradeId === 'trade-002');
  assertEqualLen(trade2Markers, 2, 'trade-002 has 2 markers');

  // Verify short trade direction
  const shortEntry = trade2Markers.find((m) => m.markerType === 'entry');
  assertEqual(shortEntry?.direction, 'short', 'short trade entry direction');
  assertEqual(shortEntry?.price, 200.00, 'short trade avg entry price');

  // Short trade P&L: (200 - 185) * 50 - 6 (fees) = 744
  const shortExit = trade2Markers.find((m) => m.markerType === 'exit');
  assertEqual(shortExit?.pnl, 744, 'short trade P&L');
});

test('computeTradeMarkers — trades with dates outside rollforward range use nearest fallback', () => {
  // Trade dates before the first rollforward row
  const preDateClosedTrades = [
    {
      id: 'trade-003',
      direction: 'long' as const,
      executions: [
        { action: 'buy', quantity: 10, price: 100, fees: 0, executedAt: '2025-12-20T09:00:00Z' },
        { action: 'sell', quantity: 10, price: 110, fees: 0, executedAt: '2025-12-22T09:00:00Z' },
      ],
      closedAt: '2025-12-22T09:00:00Z',
    },
  ];
  const result = computeTradeMarkers(preDateClosedTrades, TRADE_ROWS);
  assertEqualLen(result, 2, '2 markers even when dates precede rollforward range');
  // Both markers should use the first rollforward row as fallback
  assertEqual(result[0].equity, 50000, 'entry marker uses first row fallback equity');
  assertEqual(result[1].equity, 50000, 'exit marker uses first row fallback equity');
});

test('computeTradeMarkers — empty trades returns empty array', () => {
  const result = computeTradeMarkers([], TRADE_ROWS);
  assertEqualLen(result, 0, 'empty trades yields empty markers');
});

test('computeTradeMarkers — incomplete executions produce no markers', () => {
  const closedTrades = [
    {
      id: 'trade-incomplete',
      direction: 'long' as const,
      executions: INCOMPLETE_TRADE_EXECUTIONS,
      closedAt: null,
    },
  ];
  const result = computeTradeMarkers(closedTrades, TRADE_ROWS);
  assertEqualLen(result, 0, 'trade with no exit executions produces no markers');
});

test('computeTradeMarkers — empty rollforward rows still produces markers with null equity skipped', () => {
  const closedTrades = [
    {
      id: 'trade-004',
      direction: 'long' as const,
      executions: [...ENTRY_EXECUTIONS, ...EXIT_EXECUTIONS],
      closedAt: '2026-01-15T14:00:00Z',
    },
  ];
  const result = computeTradeMarkers(closedTrades, []);
  // Both entry and exit need equity lookups; with no rows, equity falls back to null
  assertEqualLen(result, 0, 'no markers when equity lookup returns null for both dates');
});

test('computeTradeMarkers — rollforward with only null equities produces no markers', () => {
  const closedTrades = [
    {
      id: 'trade-005',
      direction: 'long' as const,
      executions: [...ENTRY_EXECUTIONS, ...EXIT_EXECUTIONS],
      closedAt: '2026-01-15T14:00:00Z',
    },
  ];
  const nullRows: RollforwardRow[] = [
    { date: '2026-01-01', endingEquity: null, drawdownAmount: null, drawdownPct: null, cumulativePnl: null, highWaterMark: null },
  ];
  const result = computeTradeMarkers(closedTrades, nullRows);
  assertEqualLen(result, 0, 'no markers when all rollforward equities are null');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: drawdownPct retains decimal form
// ────────────────────────────────────────────────────────────────────────

test('computeDrawdown — drawdownPct is decimal, not percentage', () => {
  const rows: RollforwardRow[] = [
    {
      date: '2026-03-01',
      endingEquity: 50000,
      drawdownAmount: -1700,
      drawdownPct: -0.034,
      cumulativePnl: -1700,
      highWaterMark: 51700,
    },
  ];
  const result = computeDrawdown(rows);
  // -0.034 = -3.4%, but we store as decimal, NOT multiplied by 100
  assertEqual(result[0].drawdownPct, -0.034, 'drawdownPct is decimal -0.034, not -3.4');
});

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────

console.log(`\n=== Ran ${testCount} tests ===`);
if (process.exitCode) {
  console.error('Some tests FAILED.');
} else {
  console.log('All tests PASSED.');
}
