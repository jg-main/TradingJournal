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
  computeMonthlyPerformance,
  computeRDistribution,
  type KpiTradeInput,
  type MonthlyPerformanceItem,
  type RDistributionBin,
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
  closedAt: string | null = null,
): KpiTradeInput {
  return { id, direction, status, executions, grade, riskSnapshot, closedAt };
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
// Tests: computeMonthlyPerformance
// ────────────────────────────────────────────────────────────────────────

test('computeMonthlyPerformance — single month, single winning trade', () => {
  const t = makeTrade('m1', 'long', 'closed', longTradeExecutions(50, 60, 100, 2, 2), null, { initialRiskAmount: 400 }, '2026-01-15T10:00:00Z');
  const r = computeMonthlyPerformance([t]);
  assertEqual(r.length, 1, 'one month group');
  assertEqual(r[0].month, '2026-01', 'month = 2026-01');
  assertApprox(r[0].netPnl, 996, 'netPnl = 996');
  assertClose(r[0].winRate, 1, 'winRate = 1');
  assertEqual(r[0].tradeCount, 1, 'tradeCount = 1');
});

test('computeMonthlyPerformance — single month, multiple mixed trades', () => {
  const t1 = makeTrade('mp1', 'long', 'closed', longTradeExecutions(50, 60, 100, 2, 2), null, null, '2026-01-05T10:00:00Z');  // +996
  const t2 = makeTrade('mp2', 'long', 'closed', longTradeExecutions(50, 40, 100, 2, 2), null, null, '2026-01-10T10:00:00Z');  // -1004
  const t3 = makeTrade('mp3', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0), null, null, '2026-01-20T10:00:00Z');  // 0 (scratch)
  const r = computeMonthlyPerformance([t1, t2, t3]);
  assertEqual(r.length, 1, 'one month group');
  assertClose(r[0].winRate, 1 / 3, 'winRate = 0.333 (1 win, scratch=loss per D013)');
  assertApprox(r[0].netPnl, 996 + (-1004) + 0, 'netPnl = -8');
  assertEqual(r[0].tradeCount, 3, 'tradeCount = 3');
});

test('computeMonthlyPerformance — multiple months, sorted chronologically', () => {
  const t1 = makeTrade('mm1', 'long', 'closed', longTradeExecutions(50, 60, 100, 0, 0), null, null, '2025-12-01T10:00:00Z'); // +1000
  const t2 = makeTrade('mm2', 'long', 'closed', longTradeExecutions(50, 40, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // -1000
  const t3 = makeTrade('mm3', 'long', 'closed', longTradeExecutions(50, 55, 100, 0, 0), null, null, '2026-02-01T10:00:00Z'); // +500
  const r = computeMonthlyPerformance([t3, t1, t2]);
  assertEqual(r.length, 3, 'three month groups');
  assertEqual(r[0].month, '2025-12', 'first month = 2025-12');
  assertEqual(r[1].month, '2026-01', 'second month = 2026-01');
  assertEqual(r[2].month, '2026-02', 'third month = 2026-02');
  assertApprox(r[0].netPnl, 1000, '2025-12 netPnl = 1000');
  assertApprox(r[1].netPnl, -1000, '2026-01 netPnl = -1000');
  assertApprox(r[2].netPnl, 500, '2026-02 netPnl = 500');
});

test('computeMonthlyPerformance — empty trades returns empty array', () => {
  const r = computeMonthlyPerformance([]);
  assertEqual(r.length, 0, 'empty array');
});

test('computeMonthlyPerformance — only non-closed trades excluded', () => {
  const openTrade = makeTrade('o1', 'long', 'open', [
    { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
  ], null, null, null);
  const plannedTrade = makeTrade('p1', 'long', 'planned', [], null, null, null);
  const closedTrade = makeTrade('c1', 'long', 'closed', longTradeExecutions(50, 60, 100, 0, 0), null, null, '2026-03-01T10:00:00Z');
  const r = computeMonthlyPerformance([openTrade, plannedTrade, closedTrade]);
  assertEqual(r.length, 1, 'only closed trade counted');
  assertEqual(r[0].month, '2026-03', 'month = 2026-03');
  assertEqual(r[0].tradeCount, 1, 'tradeCount = 1');
});

test('computeMonthlyPerformance — null closedAt excluded', () => {
  const t1 = makeTrade('nc1', 'long', 'closed', longTradeExecutions(50, 60, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');
  const t2 = makeTrade('nc2', 'long', 'closed', longTradeExecutions(50, 55, 100, 0, 0), null, null, null);
  const r = computeMonthlyPerformance([t1, t2]);
  assertEqual(r.length, 1, 'only trade with non-null closedAt counted');
  assertEqual(r[0].month, '2026-01', 'month = 2026-01');
  assertEqual(r[0].tradeCount, 1, 'tradeCount = 1');
});

test('computeMonthlyPerformance — mixed direction trades per month', () => {
  const t1 = makeTrade('d1', 'long', 'closed', longTradeExecutions(50, 60, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // +1000
  const t2 = makeTrade('d2', 'short', 'closed', [
    { action: 'sell_short', quantity: 100, price: 80, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'buy_to_cover', quantity: 100, price: 70, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
  ], null, null, '2026-01-02T10:00:00Z');  // short: (80-70)*100 = +1000
  const t3 = makeTrade('d3', 'short', 'closed', [
    { action: 'sell_short', quantity: 100, price: 80, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'buy_to_cover', quantity: 100, price: 90, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
  ], null, null, '2026-01-03T10:00:00Z');  // short: (80-90)*100 = -1000
  const r = computeMonthlyPerformance([t1, t2, t3]);
  assertEqual(r.length, 1, 'one month group');
  assertApprox(r[0].netPnl, 1000 + 1000 + (-1000), 'netPnl = 1000');
  assertClose(r[0].winRate, 2 / 3, 'winRate = 0.667 (2 wins / 3 decisions)');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: computeRDistribution
// ────────────────────────────────────────────────────────────────────────

test('computeRDistribution — all 8 bins filled with correct ranges', () => {
  // Create one trade per bin boundary
  // Bin: <= -3  (r <= -3)
  // Bin: -3 to -2  (-3 <= r < -2)
  // Bin: -2 to -1  (-2 <= r < -1)
  // Bin: -1 to 0   (-1 <= r < 0)
  // Bin: 0 to 1    (0 <= r < 1)
  // Bin: 1 to 2    (1 <= r < 2)
  // Bin: 2 to 3    (2 <= r < 3)
  // Bin: > 3       (r >= 3)
  const trades = [
    makeTrade('b0', 'long', 'closed', longTradeExecutions(100, 70, 100, 0, 0), null, { initialRiskAmount: 100 }, '2026-01-01T10:00:00Z'),    // R = -3000/100 = -30 → <= -3
    makeTrade('b1', 'long', 'closed', longTradeExecutions(100, 80, 100, 0, 0), null, { initialRiskAmount: 100 }, '2026-01-01T10:00:00Z'),    // R = -2000/100 = -20 → <= -3
    makeTrade('b2', 'long', 'closed', longTradeExecutions(100, 75, 100, 0, 0), null, { initialRiskAmount: 100 }, '2026-01-01T10:00:00Z'),    // shift: use risk amounts to target bins
  ];
  // Use precise risk amounts to land in specific bins
  const binTrades = [
    // r = -4.0 → <= -3
    makeTrade('r1', 'long', 'closed', longTradeExecutions(100, 60, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -4000, R = -4
    // r = -2.5 → -3 to -2
    makeTrade('r2', 'long', 'closed', longTradeExecutions(100, 75, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -2500, R = -2.5
    // r = -1.5 → -2 to -1
    makeTrade('r3', 'long', 'closed', longTradeExecutions(100, 85, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -1500, R = -1.5
    // r = -0.5 → -1 to 0
    makeTrade('r4', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -500, R = -0.5
    // r = 0.5 → 0 to 1
    makeTrade('r5', 'long', 'closed', longTradeExecutions(100, 105, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = 500, R = 0.5
    // r = 1.5 → 1 to 2
    makeTrade('r6', 'long', 'closed', longTradeExecutions(100, 115, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = 1500, R = 1.5
    // r = 2.5 → 2 to 3
    makeTrade('r7', 'long', 'closed', longTradeExecutions(100, 125, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = 2500, R = 2.5
    // r = 4.0 → > 3
    makeTrade('r8', 'long', 'closed', longTradeExecutions(100, 140, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = 4000, R = 4
  ];
  const r = computeRDistribution(binTrades);
  assertEqual(r.length, 8, 'all 8 bins returned');
  assertEqual(r[0].label, '<= -3', 'bin 0 label');
  assertEqual(r[1].label, '-3 to -2', 'bin 1 label');
  assertEqual(r[2].label, '-2 to -1', 'bin 2 label');
  assertEqual(r[3].label, '-1 to 0', 'bin 3 label');
  assertEqual(r[4].label, '0 to 1', 'bin 4 label');
  assertEqual(r[5].label, '1 to 2', 'bin 5 label');
  assertEqual(r[6].label, '2 to 3', 'bin 6 label');
  assertEqual(r[7].label, '> 3', 'bin 7 label');
  assertEqual(r[0].count, 1, '<= -3: 1');
  assertEqual(r[1].count, 1, '-3 to -2: 1');
  assertEqual(r[2].count, 1, '-2 to -1: 1');
  assertEqual(r[3].count, 1, '-1 to 0: 1');
  assertEqual(r[4].count, 1, '0 to 1: 1');
  assertEqual(r[5].count, 1, '1 to 2: 1');
  assertEqual(r[6].count, 1, '2 to 3: 1');
  assertEqual(r[7].count, 1, '> 3: 1');
});

test('computeRDistribution — empty trades returns zero-filled bins', () => {
  const r = computeRDistribution([]);
  assertEqual(r.length, 8, 'all 8 bins returned');
  for (let i = 0; i < r.length; i++) {
    assertEqual(r[i].count, 0, `bin ${i} count = 0`);
  }
});

test('computeRDistribution — null risk excluded', () => {
  const t1 = makeTrade('nr1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // no risk snapshot
  const t2 = makeTrade('nr2', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, { initialRiskAmount: null }, '2026-01-01T10:00:00Z');  // null risk
  const t3 = makeTrade('nr3', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, { initialRiskAmount: 100 }, '2026-01-01T10:00:00Z');  // valid: 2000/100 = 20 → > 3
  const r = computeRDistribution([t1, t2, t3]);
  // Only t3 contributes
  assertEqual(r[7].count, 1, '> 3 bin = 1 (t3)');
  const totalCount = r.reduce((sum, b) => sum + b.count, 0);
  assertEqual(totalCount, 1, 'total = 1 (null risk excluded)');
});

test('computeRDistribution — zero risk amount excluded', () => {
  const t1 = makeTrade('zr1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, { initialRiskAmount: 0 }, '2026-01-01T10:00:00Z');
  const r = computeRDistribution([t1]);
  const totalCount = r.reduce((sum, b) => sum + b.count, 0);
  assertEqual(totalCount, 0, 'total = 0 (zero risk excluded)');
});

test('computeRDistribution — multiple trades in same bin accumulate', () => {
  const winners = [
    makeTrade('s1', 'long', 'closed', longTradeExecutions(100, 105, 100, 0, 0), null, { initialRiskAmount: 100 }, '2026-01-01T10:00:00Z'),  // R = 500/100 = 5
    makeTrade('s2', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, { initialRiskAmount: 100 }, '2026-01-01T10:00:00Z'),  // R = 1000/100 = 10
    makeTrade('s3', 'long', 'closed', longTradeExecutions(100, 103, 100, 0, 0), null, { initialRiskAmount: 100 }, '2026-01-01T10:00:00Z'),  // R = 300/100 = 3
  ];
  const r = computeRDistribution(winners);
  assertEqual(r[7].count, 3, '> 3 bin = 3 (all R >= 3)');
});

test('computeRDistribution — negative trades land in correct bins', () => {
  const losers = [
    makeTrade('l1', 'long', 'closed', longTradeExecutions(100, 50, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -5000, R = -5 → <= -3
    makeTrade('l2', 'long', 'closed', longTradeExecutions(100, 80, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -2000, R = -2 → -3 to -2? No, -2 is >= -3 and < -2? Wait...
    // Actually: -2 >= -3 (min of bin 2) AND -2 < -2 (max of bin 2)? No. R = -2
    // Bin 1: -3 to -2: min=-3, max=-2. r=-2: -2 >= -3 ✓, -2 < -2 ✗ → NOT in bin 1
    // Bin 2: -2 to -1: min=-2, max=-1. r=-2: -2 >= -2 ✓, -2 < -1 ✓ → in bin 2
    // So R=-2 lands in -2 to -1 bin
  ];
  const r = computeRDistribution(losers);
  assertEqual(r[0].count, 1, '<= -3 bin = 1 (R=-5)');
  assertEqual(r[1].count, 0, '-3 to -2 bin = 0');
  assertEqual(r[2].count, 1, '-2 to -1 bin = 1 (R=-2)');
});

test('computeRDistribution — R at exact bin boundaries', () => {
  // Test edge cases: r = exactly -3, -2, -1, 0, 1, 2, 3
  const boundaryTrades = [
    makeTrade('ex1', 'long', 'closed', longTradeExecutions(100, 70, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -3000, R = -3.0
    // R=-3.0: bin -3 to -2: -3 >= -3 ✓, -3 < -2 ✓ → in bin -3 to -2
    makeTrade('ex2', 'long', 'closed', longTradeExecutions(100, 80, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -2000, R = -2.0
    // R=-2.0: bin -2 to -1: -2 >= -2 ✓, -2 < -1 ✓ → in bin -2 to -1
    makeTrade('ex3', 'long', 'closed', longTradeExecutions(100, 90, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = -1000, R = -1.0
    // R=-1.0: bin -1 to 0: -1 >= -1 ✓, -1 < 0 ✓ → in bin -1 to 0
    makeTrade('ex4', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = 0, R = 0
    // R=0: bin 0 to 1: 0 >= 0 ✓, 0 < 1 ✓ → in bin 0 to 1
    makeTrade('ex5', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = 1000, R = 1
    // R=1: bin 1 to 2: 1 >= 1 ✓, 1 < 2 ✓ → in bin 1 to 2
    makeTrade('ex6', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = 2000, R = 2
    // R=2: bin 2 to 3: 2 >= 2 ✓, 2 < 3 ✓ → in bin 2 to 3
    makeTrade('ex7', 'long', 'closed', longTradeExecutions(100, 130, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),  // PnL = 3000, R = 3
    // R=3: last bin >3: 3 >= 3 ✓ → in > 3
  ];
  const r = computeRDistribution(boundaryTrades);
  // R=-3.0: -3 >= -3 AND -3 < -2 → bin -3 to -2
  assertEqual(r[1].count, 1, '-3 to -2: 1 (R=-3.0 lower bound inclusive)');
  // R=-2.0: -2 >= -2 AND -2 < -1 → bin -2 to -1
  assertEqual(r[2].count, 1, '-2 to -1: 1 (R=-2.0)');
  // R=-1.0: -1 >= -1 AND -1 < 0 → bin -1 to 0
  assertEqual(r[3].count, 1, '-1 to 0: 1 (R=-1.0)');
  // R=0: 0 >= 0 AND 0 < 1 → bin 0 to 1
  assertEqual(r[4].count, 1, '0 to 1: 1 (R=0)');
  // R=1: 1 >= 1 AND 1 < 2 → bin 1 to 2
  assertEqual(r[5].count, 1, '1 to 2: 1 (R=1.0)');
  // R=2: 2 >= 2 AND 2 < 3 → bin 2 to 3
  assertEqual(r[6].count, 1, '2 to 3: 1 (R=2.0)');
  // R=3: >= 3 → bin > 3
  assertEqual(r[7].count, 1, '> 3: 1 (R=3.0)');
  // <= -3 bin should be empty
  assertEqual(r[0].count, 0, '<= -3: 0');
});

test('computeRDistribution — mixed valid and null risk, counts correct total', () => {
  const mixed = [
    // PnL = (110-100)*100 = 1000, risk=1000, R = 1.0 → 1 to 2 bin
    makeTrade('mx1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),
    // no risk snapshot, excluded
    makeTrade('mx2', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'),
    // PnL = (130-100)*100 = 3000, risk=1000, R = 3.0 → > 3 bin
    makeTrade('mx3', 'long', 'closed', longTradeExecutions(100, 130, 100, 0, 0), null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),
    // short PnL = (80-70)*100 = 1000, risk=1000, R = 1.0 → 1 to 2 bin
    makeTrade('mx4', 'short', 'closed', [
      { action: 'sell_short', quantity: 100, price: 80, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
      { action: 'buy_to_cover', quantity: 100, price: 70, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
    ], null, { initialRiskAmount: 1000 }, '2026-01-01T10:00:00Z'),
  ];
  const r = computeRDistribution(mixed);
  // mx1: R=1.0 → 1 to 2 (1 >= 1 AND 1 < 2)
  // mx3: R=3.0 → > 3 (3 >= 3)
  // mx4: R=1.0 → 1 to 2 (1 >= 1 AND 1 < 2)
  assertEqual(r[5].count, 2, '1 to 2: 2 (R=1.0 from mx1 and mx4)');
  assertEqual(r[7].count, 1, '> 3: 1 (R=3.0 from mx3)');
  const totalCount = r.reduce((sum, b) => sum + b.count, 0);
  assertEqual(totalCount, 3, 'total = 3 (3 valid R out of 4)');
});

test('computeRDistribution — short trades compute R correctly', () => {
  // Short profit of 1000 with risk 100 → R = 10 (same bin for profit direction)
  const shortWins = [
    makeTrade('sw1', 'short', 'closed', [
      { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
      { action: 'buy_to_cover', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
    ], null, { initialRiskAmount: 200 }, '2026-01-01T10:00:00Z'),  // PnL = (100-50)*100 = 5000, R = 25
  ];
  const r = computeRDistribution(shortWins);
  assertEqual(r[7].count, 1, '> 3: 1 (short profit R=25)');
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
