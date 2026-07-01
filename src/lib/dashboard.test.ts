/**
 * dashboard.test.ts
 *
 * Unit tests for the dashboard KPI computation library.
 * Tests in isolation without a database — fixtures are plain objects
 * matching KpiTradeInput and RollforwardRow.
 *
 * Run: npx tsx src/lib/dashboard.test.ts
 *
 * Pattern: src/lib/weekly-review.test.ts, src/lib/review-dashboard.test.ts
 */

import {
  computeKpiMetrics,
  computeWinRate,
  type KpiTradeInput,
  type RollforwardRow,
} from './dashboard';
import { type ExecutionData } from './trade-calc';

// ── Helpers ─────────────────────────────────────────────────────────────

function longTradeExecutions(entryPrice: number, exitPrice: number, qty = 100, entryFees = 0, exitFees = 0): ExecutionData[] {
  return [
    { action: 'buy', quantity: qty, price: entryPrice, fees: entryFees, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'sell', quantity: qty, price: exitPrice, fees: exitFees, executedAt: '2026-01-01T14:00:00Z' },
  ];
}

function makeTrade(
  id: string,
  direction: 'long' | 'short',
  status: string,
  executions: ExecutionData[],
  grade: { totalScore: number } | null = null,
  riskSnapshot: { initialRiskAmount: number | null } | null = null,
): KpiTradeInput {
  return { id, direction, status, executions, grade, riskSnapshot };
}

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

function assertNotNull(v: unknown, label: string): void {
  if (v !== null && v !== undefined) {
    console.log(`  ✅ PASS: ${label}`);
  } else {
    console.error(`  ❌ FAIL: ${label} — expected non-null, got ${JSON.stringify(v)}`);
    process.exitCode = 1;
  }
}

function assertApprox(actual: number, expected: number, label: string, tolerance = 0.001): void {
  if (Math.abs(actual - expected) < tolerance) {
    console.log(`  ✅ PASS: ${label} (≈${actual})`);
  } else {
    console.error(`  ❌ FAIL: ${label} — expected ${expected}, got ${actual}`);
    process.exitCode = 1;
  }
}

let testCount = 0;

function test(name: string, fn: () => void): void {
  testCount++;
  console.log(`\n#${testCount}: ${name}`);
  fn();
}

// ── Fixtures ───────────────────────────────────────────────────────────

const WIN_TRADE: KpiTradeInput = makeTrade(
  'win-001', 'long', 'closed',
  longTradeExecutions(50, 60, 100, 2, 2),  // PnL = (60-50)*100 - 4 = 996
  { totalScore: 48 },
  { initialRiskAmount: 400 },
);

const LOSS_TRADE: KpiTradeInput = makeTrade(
  'loss-001', 'long', 'closed',
  longTradeExecutions(50, 40, 100, 2, 2),  // PnL = (40-50)*100 - 4 = -1004
  { totalScore: 21 },
  { initialRiskAmount: 500 },
);

const SCRATCH_TRADE: KpiTradeInput = makeTrade(
  'scratch-001', 'long', 'closed',
  longTradeExecutions(50, 50, 100, 1.5, 1.5),  // PnL = (50-50)*100 - 3 = -3 (fees only)
  { totalScore: 30 },
  { initialRiskAmount: 300 },
);

const OPEN_TRADE: KpiTradeInput = makeTrade(
  'open-001', 'long', 'open',
  [
    { action: 'buy', quantity: 100, price: 50, fees: 2, executedAt: '2026-01-01T10:00:00Z' },
  ],
  null,
  null,
);

const PARTIALLY_CLOSED_TRADE: KpiTradeInput = makeTrade(
  'partial-001', 'long', 'partially_closed',
  [
    { action: 'buy', quantity: 100, price: 50, fees: 2, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'sell', quantity: 50, price: 55, fees: 1, executedAt: '2026-01-01T14:00:00Z' },
  ],
  null,
  null,
);

const PLANNED_TRADE: KpiTradeInput = makeTrade(
  'planned-001', 'long', 'planned', [], null, null,
);

const ROLLFORWARD: RollforwardRow = {
  date: '2026-06-30',
  endingEquity: 12500,
  drawdownAmount: 850,
  drawdownPct: 6.8,
  cumulativePnl: 2500,
  highWaterMark: 13000,
};

// ────────────────────────────────────────────────────────────────────────
// Tests: computeWinRate
// ────────────────────────────────────────────────────────────────────────

test('computeWinRate — normal case', () => {
  assertClose(computeWinRate(7, 10), 0.7, '7/10 = 0.7');
});

test('computeWinRate — all wins', () => {
  assertClose(computeWinRate(5, 5), 1.0, '5/5 = 1.0');
});

test('computeWinRate — no wins', () => {
  assertClose(computeWinRate(0, 8), 0.0, '0/8 = 0.0');
});

test('computeWinRate — zero decisions returns null', () => {
  assertNull(computeWinRate(0, 0), '0 decisions => null');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: empty trades returns zeros/nulls
// ────────────────────────────────────────────────────────────────────────

test('empty trades — returns zeros and nulls', () => {
  const r = computeKpiMetrics([], [], null, null);

  assertEqual(r.totalTrades, 0, 'totalTrades = 0');
  assertEqual(r.openTrades, 0, 'openTrades = 0');
  assertNull(r.winRate, 'winRate = null');
  assertApprox(r.netPnl, 0, 'netPnl = 0');
  assertNull(r.avgR, 'avgR = null');
  assertNull(r.avgGrade, 'avgGrade = null');
  assertNull(r.currentDrawdown, 'currentDrawdown = null');
  assertNull(r.currentDrawdownPct, 'currentDrawdownPct = null');
  assertNull(r.accountValue, 'accountValue = null');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: mix of winning/losing trades computes correct win rate
// ────────────────────────────────────────────────────────────────────────

test('mix of winning and losing trades — correct win rate', () => {
  const allTrades = [WIN_TRADE, LOSS_TRADE];
  const closedTrades = [WIN_TRADE, LOSS_TRADE];
  const r = computeKpiMetrics(allTrades, closedTrades, null, null);

  assertEqual(r.totalTrades, 2, 'totalTrades = 2');
  assertEqual(r.openTrades, 0, 'openTrades = 0');
  assertClose(r.winRate, 0.5, 'winRate = 0.5 (1 win / 2 decisions)');
  assertApprox(r.netPnl, 996 + (-1004), 'netPnl = -8');
  assertClose(r.avgGrade, (48 + 21) / 2, 'avgGrade = 34.5');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: avg R computation with mixed risk data
// ────────────────────────────────────────────────────────────────────────

test('avg R with mixed risk data — null risk skipped', () => {
  const tradeWithRisk = makeTrade(
    'r1', 'long', 'closed',
    longTradeExecutions(100, 120, 100, 0, 0),  // PnL = (120-100)*100 = 2000
    null, { initialRiskAmount: 400 },
  );
  const tradeNoRisk = makeTrade(
    'r2', 'long', 'closed',
    longTradeExecutions(100, 110, 100, 0, 0),  // PnL = (110-100)*100 = 1000
    null, null,
  );
  const tradeNullRisk = makeTrade(
    'r3', 'long', 'closed',
    longTradeExecutions(100, 130, 100, 0, 0),  // PnL = (130-100)*100 = 3000
    null, { initialRiskAmount: null },
  );

  const closedTrades = [tradeWithRisk, tradeNoRisk, tradeNullRisk];
  const allTrades = [...closedTrades];
  const r = computeKpiMetrics(allTrades, closedTrades, null, null);

  // avgR = only tradeWithRisk contributes: 2000/400 = 5
  assertClose(r.avgR, 5, 'avgR = 5 (only trade with valid risk)');
  assertClose(r.winRate, 1, 'winRate = 1 (all profitable)');
  assertApprox(r.netPnl, 2000 + 1000 + 3000, 'netPnl = 6000');
});

test('avg R with zero risk amount — skipped', () => {
  const tradeZeroRisk = makeTrade(
    'z1', 'long', 'closed',
    longTradeExecutions(100, 110, 100, 0, 0),
    null, { initialRiskAmount: 0 },
  );
  const r = computeKpiMetrics([tradeZeroRisk], [tradeZeroRisk], null, null);
  assertNull(r.avgR, 'avgR = null when all risk is zero or null');
});

test('avg R with negative risk amount — skipped', () => {
  const tradeNegRisk = makeTrade(
    'n1', 'long', 'closed',
    longTradeExecutions(100, 110, 100, 0, 0),
    null, { initialRiskAmount: -5 },
  );
  const r = computeKpiMetrics([tradeNegRisk], [tradeNegRisk], null, null);
  assertNull(r.avgR, 'avgR = null when risk is negative');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: avg grade computation across graded trades
// ────────────────────────────────────────────────────────────────────────

test('avg grade — across multiple graded trades', () => {
  const gradedTrades = [
    makeTrade('g1', 'long', 'closed', longTradeExecutions(100, 110), { totalScore: 50 }),
    makeTrade('g2', 'long', 'closed', longTradeExecutions(100, 120), { totalScore: 70 }),
    makeTrade('g3', 'long', 'closed', longTradeExecutions(100, 90), { totalScore: 30 }),
  ];
  const r = computeKpiMetrics(gradedTrades, gradedTrades, null, null);

  assertClose(r.avgGrade, (50 + 70 + 30) / 3, 'avgGrade = 50');
  assertEqual(r.totalTrades, 3, 'totalTrades = 3');
});

test('avg grade — null when no trades graded', () => {
  const ungradedTrades = [
    makeTrade('u1', 'long', 'closed', longTradeExecutions(100, 110), null),
    makeTrade('u2', 'long', 'closed', longTradeExecutions(100, 120), null),
  ];
  const r = computeKpiMetrics(ungradedTrades, ungradedTrades, null, null);

  assertNull(r.avgGrade, 'avgGrade = null when no trades graded');
});

test('avg grade — null when grade totalScore is null', () => {
  const nullScoreTrades = [
    makeTrade('ns1', 'long', 'closed', longTradeExecutions(100, 110), { totalScore: null as unknown as number }),
  ];
  const r = computeKpiMetrics(nullScoreTrades, nullScoreTrades, null, null);

  assertNull(r.avgGrade, 'avgGrade = null when totalScore is null');
});

test('avg grade — skips trades with null grade', () => {
  const mixedTrades = [
    makeTrade('m1', 'long', 'closed', longTradeExecutions(100, 110), { totalScore: 50 }),
    makeTrade('m2', 'long', 'closed', longTradeExecutions(100, 120), null),
    makeTrade('m3', 'long', 'closed', longTradeExecutions(100, 90), { totalScore: 40 }),
  ];
  const r = computeKpiMetrics(mixedTrades, mixedTrades, null, null);

  assertClose(r.avgGrade, (50 + 40) / 2, 'avgGrade = 45 (skips null grade)');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: account value from rollforward vs fallback
// ────────────────────────────────────────────────────────────────────────

test('account value — uses rollforward endingEquity when available', () => {
  const r = computeKpiMetrics([], [], ROLLFORWARD, 10000);
  assertEqual(r.accountValue, 12500, 'accountValue = 12500 from rollforward');
});

test('account value — falls back to startingAccountValue when no rollforward', () => {
  const r = computeKpiMetrics([], [], null, 10000);
  assertEqual(r.accountValue, 10000, 'accountValue = 10000 from startingAccountValue');
});

test('account value — null when neither rollforward nor startingAccountValue', () => {
  const r = computeKpiMetrics([], [], null, null);
  assertNull(r.accountValue, 'accountValue = null');
});

test('drawdown — extracted from rollforward', () => {
  const r = computeKpiMetrics([], [], ROLLFORWARD, null);
  assertEqual(r.currentDrawdown, 850, 'drawdown = 850');
  assertEqual(r.currentDrawdownPct, 6.8, 'drawdownPct = 6.8');
});

test('drawdown — null when no rollforward', () => {
  const r = computeKpiMetrics([], [], null, null);
  assertNull(r.currentDrawdown, 'drawdown = null');
  assertNull(r.currentDrawdownPct, 'drawdownPct = null');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: scratches (PnL=0) count as losses per D013
// ────────────────────────────────────────────────────────────────────────

test('scratches count as losses per D013 — PnL=0 trades are losses', () => {
  // Scratch: entry == exit, but fees make PnL slightly negative
  // To get exactly $0 PnL, use zero fees and equal prices
  const scratchExact = makeTrade(
    's1', 'long', 'closed',
    longTradeExecutions(100, 100, 100, 0, 0),  // PnL = (100-100)*100 - 0 = 0
    null, null,
  );
  const win = makeTrade(
    'w1', 'long', 'closed',
    longTradeExecutions(100, 110, 100, 0, 0),  // PnL = (110-100)*100 = 1000
    null, null,
  );

  const r = computeKpiMetrics([scratchExact, win], [scratchExact, win], null, null);

  // win rate: 1 win / 2 decisions (scratch counted as loss per D013) = 0.5
  assertClose(r.winRate, 0.5, 'winRate = 0.5 (scratch counted as loss)');
  assertApprox(r.netPnl, 0 + 1000, 'netPnl = 1000');
});

test('all scratches — winRate = 0 (all counted as losses)', () => {
  const scratches = [
    makeTrade('s1', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0)),
    makeTrade('s2', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0)),
  ];
  const r = computeKpiMetrics(scratches, scratches, null, null);

  assertClose(r.winRate, 0, 'winRate = 0 (all scratches = losses per D013)');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: openTrades counts correctly
// ────────────────────────────────────────────────────────────────────────

test('openTrades counts open and partially_closed trades', () => {
  const allTrades = [WIN_TRADE, OPEN_TRADE, PARTIALLY_CLOSED_TRADE, PLANNED_TRADE];
  const r = computeKpiMetrics(allTrades, [WIN_TRADE], null, null);

  assertEqual(r.totalTrades, 4, 'totalTrades = 4');
  assertEqual(r.openTrades, 2, 'openTrades = 2 (open + partially_closed)');
});

test('openTrades — planned and idea trades not counted as open', () => {
  const ideaTrade = makeTrade('idea-1', 'long', 'idea', [], null, null);
  const scratchedTrade = makeTrade('s1', 'long', 'scratched', longTradeExecutions(100, 100), null, null);
  const allTrades = [ideaTrade, scratchedTrade, PLANNED_TRADE];
  const r = computeKpiMetrics(allTrades, [], null, null);

  assertEqual(r.totalTrades, 3, 'totalTrades = 3');
  assertEqual(r.openTrades, 0, 'openTrades = 0');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: all wins — winRate = 1
// ────────────────────────────────────────────────────────────────────────

test('all wins — winRate = 1', () => {
  const winners = [
    makeTrade('w1', 'long', 'closed', longTradeExecutions(100, 150), null, null),
    makeTrade('w2', 'long', 'closed', longTradeExecutions(100, 130), null, null),
  ];
  const r = computeKpiMetrics(winners, winners, null, null);
  assertClose(r.winRate, 1, 'all wins => winRate = 1');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: all losses — winRate = 0
// ────────────────────────────────────────────────────────────────────────

test('all losses — winRate = 0', () => {
  const losers = [
    makeTrade('l1', 'long', 'closed', longTradeExecutions(100, 80), null, null),
    makeTrade('l2', 'long', 'closed', longTradeExecutions(100, 70), null, null),
  ];
  const r = computeKpiMetrics(losers, losers, null, null);
  assertClose(r.winRate, 0, 'all losses => winRate = 0');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: open trades in closedTrades are excluded from P&L metrics
// ────────────────────────────────────────────────────────────────────────

test('open trades not in closedTrades — excluded from P&L metrics', () => {
  const allTrades = [WIN_TRADE, OPEN_TRADE];
  const r = computeKpiMetrics(allTrades, [WIN_TRADE], null, null);

  assertEqual(r.totalTrades, 2, 'totalTrades = 2');
  assertEqual(r.openTrades, 1, 'openTrades = 1');
  assertClose(r.netPnl, 996, 'netPnl = 996 (only WIN_TRADE counted)');
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
