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
  computeDirectionalPerformance,
  computeProcessScoreDistribution,
  computeProfitFactor,
  computeAvgWin,
  computeAvgLoss,
  type KpiTradeInput,
  type RollforwardRow,
} from './dashboard';
import { type ExecutionData } from './trade-metrics';

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

const OPEN_TRADE: KpiTradeInput = makeTrade(
  'open-001', 'long', 'open',
  [
    { action: 'buy', quantity: 100, price: 50, fees: 2, executedAt: '2026-01-01T10:00:00Z' },
  ],
  null,
  null,
);

const PARTIALLY_CLOSED_TRADE: KpiTradeInput = makeTrade(
  'partial-001', 'long', 'open',
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

test('openTrades counts open trades', () => {
  const allTrades = [WIN_TRADE, OPEN_TRADE, PARTIALLY_CLOSED_TRADE, PLANNED_TRADE];
  const r = computeKpiMetrics(allTrades, [WIN_TRADE], null, null);

  assertEqual(r.totalTrades, 4, 'totalTrades = 4');
  assertEqual(r.openTrades, 2, 'openTrades = 2 (both open)');
});

test('openTrades — planned, idea, scratched trades not counted as open', () => {
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
// Tests: computeDirectionalPerformance
// ────────────────────────────────────────────────────────────────────────

test('computeDirectionalPerformance — all long trades', () => {
  const longTrades = [
    makeTrade('l1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'),  // PnL = 1000
    makeTrade('l2', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'),  // PnL = 2000
  ];
  const r = computeDirectionalPerformance(longTrades);
  assertApprox(r.long.netPnl, 3000, 'long netPnl = 3000 (1000 + 2000)');
  assertClose(r.long.winRate, 1, 'long winRate = 1 (2 wins / 2 decisions)');
  assertEqual(r.long.tradeCount, 2, 'long tradeCount = 2');
  assertApprox(r.short.netPnl, 0, 'short netPnl = 0');
  assertNull(r.short.winRate, 'short winRate = null');
  assertEqual(r.short.tradeCount, 0, 'short tradeCount = 0');
});

test('computeDirectionalPerformance — all short trades', () => {
  const shortTrades = [
    makeTrade('s1', 'short', 'closed', [
      { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
      { action: 'buy_to_cover', quantity: 100, price: 80, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
    ], null, null, '2026-01-01T10:00:00Z'),  // short PnL = (100-80)*100 = 2000
    makeTrade('s2', 'short', 'closed', [
      { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
      { action: 'buy_to_cover', quantity: 100, price: 90, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
    ], null, null, '2026-01-01T10:00:00Z'),  // short PnL = (100-90)*100 = 1000
  ];
  const r = computeDirectionalPerformance(shortTrades);
  assertApprox(r.short.netPnl, 3000, 'short netPnl = 3000 (2000 + 1000)');
  assertClose(r.short.winRate, 1, 'short winRate = 1');
  assertEqual(r.short.tradeCount, 2, 'short tradeCount = 2');
  assertApprox(r.long.netPnl, 0, 'long netPnl = 0');
  assertNull(r.long.winRate, 'long winRate = null');
  assertEqual(r.long.tradeCount, 0, 'long tradeCount = 0');
});

test('computeDirectionalPerformance — mixed long and short trades', () => {
  const mixed = [
    // Long win
    makeTrade('l1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'),  // +1000
    // Long loss
    makeTrade('l2', 'long', 'closed', longTradeExecutions(100, 90, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'),  // -1000
    // Short win
    makeTrade('s1', 'short', 'closed', [
      { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
      { action: 'buy_to_cover', quantity: 100, price: 80, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
    ], null, null, '2026-01-01T10:00:00Z'),  // +2000
    // Short loss
    makeTrade('s2', 'short', 'closed', [
      { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
      { action: 'buy_to_cover', quantity: 100, price: 110, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
    ], null, null, '2026-01-01T10:00:00Z'),  // -1000
  ];
  const r = computeDirectionalPerformance(mixed);
  assertApprox(r.long.netPnl, 0, 'long netPnl = 0 (1000 + (-1000))');
  assertClose(r.long.winRate, 0.5, 'long winRate = 0.5 (1 win / 2 decisions)');
  assertEqual(r.long.tradeCount, 2, 'long tradeCount = 2');
  assertApprox(r.short.netPnl, 1000, 'short netPnl = 1000 (2000 + (-1000))');
  assertClose(r.short.winRate, 0.5, 'short winRate = 0.5 (1 win / 2 decisions)');
  assertEqual(r.short.tradeCount, 2, 'short tradeCount = 2');
});

test('computeDirectionalPerformance — empty input', () => {
  const r = computeDirectionalPerformance([]);
  assertApprox(r.long.netPnl, 0, 'long netPnl = 0');
  assertNull(r.long.winRate, 'long winRate = null');
  assertEqual(r.long.tradeCount, 0, 'long tradeCount = 0');
  assertApprox(r.short.netPnl, 0, 'short netPnl = 0');
  assertNull(r.short.winRate, 'short winRate = null');
  assertEqual(r.short.tradeCount, 0, 'short tradeCount = 0');
});

test('computeDirectionalPerformance — all scratches (PnL=0) counted as loss per D013', () => {
  const scratches = [
    makeTrade('s1', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'),  // PnL = 0
    makeTrade('s2', 'short', 'closed', [
      { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-01T10:00:00Z' },
      { action: 'buy_to_cover', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-01T14:00:00Z' },
    ], null, null, '2026-01-01T10:00:00Z'),  // PnL = 0
  ];
  const r = computeDirectionalPerformance(scratches);
  assertClose(r.long.winRate, 0, 'long winRate = 0 (scratch counted as loss)');
  assertClose(r.short.winRate, 0, 'short winRate = 0 (scratch counted as loss)');
  assertApprox(r.long.netPnl, 0, 'long netPnl = 0');
  assertApprox(r.short.netPnl, 0, 'short netPnl = 0');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: computeProcessScoreDistribution
// ────────────────────────────────────────────────────────────────────────

test('computeProcessScoreDistribution — all bins filled with trades', () => {
  const trades = [
    makeTrade('a1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 58 }, null, '2026-01-01T10:00:00Z'), // A
    makeTrade('b1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 45 }, null, '2026-01-01T10:00:00Z'), // B
    makeTrade('c1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 35 }, null, '2026-01-01T10:00:00Z'), // C
    makeTrade('d1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 20 }, null, '2026-01-01T10:00:00Z'), // D
    makeTrade('f1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 5 }, null, '2026-01-01T10:00:00Z'),  // F
  ];
  const r = computeProcessScoreDistribution(trades);
  assertEqual(r.length, 5, 'all 5 bins returned');
  assertEqual(r[0].label, 'A (54-60)', 'bin 0 label');
  assertEqual(r[1].label, 'B (42-53)', 'bin 1 label');
  assertEqual(r[2].label, 'C (30-41)', 'bin 2 label');
  assertEqual(r[3].label, 'D (18-29)', 'bin 3 label');
  assertEqual(r[4].label, 'F (0-17)', 'bin 4 label');
  assertEqual(r[0].count, 1, 'A: 1');
  assertEqual(r[1].count, 1, 'B: 1');
  assertEqual(r[2].count, 1, 'C: 1');
  assertEqual(r[3].count, 1, 'D: 1');
  assertEqual(r[4].count, 1, 'F: 1');
  assertEqual(r[0].minScore, 54, 'A minScore = 54');
  assertEqual(r[4].minScore, 0, 'F minScore = 0');
});

test('computeProcessScoreDistribution — multiple trades in one bin accumulate', () => {
  const trades = [
    makeTrade('a1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 55 }, null, '2026-01-01T10:00:00Z'),
    makeTrade('a2', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 58 }, null, '2026-01-01T10:00:00Z'),
    makeTrade('a3', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 60 }, null, '2026-01-01T10:00:00Z'),
    makeTrade('b1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 42 }, null, '2026-01-01T10:00:00Z'),
  ];
  const r = computeProcessScoreDistribution(trades);
  assertEqual(r[0].count, 3, 'A: 3');
  assertEqual(r[1].count, 1, 'B: 1');
  assertEqual(r[2].count, 0, 'C: 0');
  assertEqual(r[3].count, 0, 'D: 0');
  assertEqual(r[4].count, 0, 'F: 0');
});

test('computeProcessScoreDistribution — no graded trades returns all zeros', () => {
  const trades = [
    makeTrade('u1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'),
    makeTrade('u2', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'),
  ];
  const r = computeProcessScoreDistribution(trades);
  assertEqual(r.length, 5, 'all 5 bins returned');
  for (let i = 0; i < r.length; i++) {
    assertEqual(r[i].count, 0, `bin ${i} count = 0`);
  }
});

test('computeProcessScoreDistribution — empty trades returns all zeros', () => {
  const r = computeProcessScoreDistribution([]);
  assertEqual(r.length, 5, 'all 5 bins returned');
  for (let i = 0; i < r.length; i++) {
    assertEqual(r[i].count, 0, `bin ${i} count = 0`);
  }
});

test('computeProcessScoreDistribution — exact bin boundaries', () => {
  const trades = [
    // A: 54-60
    makeTrade('bd1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 54 }, null, '2026-01-01T10:00:00Z'),  // lower bound A
    makeTrade('bd2', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 60 }, null, '2026-01-01T10:00:00Z'),  // upper bound A
    // B: 42-53
    makeTrade('bd3', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 42 }, null, '2026-01-01T10:00:00Z'),  // lower bound B
    makeTrade('bd4', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 53 }, null, '2026-01-01T10:00:00Z'),  // upper bound B
    // C: 30-41
    makeTrade('bd5', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 30 }, null, '2026-01-01T10:00:00Z'),  // lower bound C
    makeTrade('bd6', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 41 }, null, '2026-01-01T10:00:00Z'),  // upper bound C
    // D: 18-29
    makeTrade('bd7', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 18 }, null, '2026-01-01T10:00:00Z'),  // lower bound D
    makeTrade('bd8', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 29 }, null, '2026-01-01T10:00:00Z'),  // upper bound D
    // F: 0-17
    makeTrade('bd9', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 0 }, null, '2026-01-01T10:00:00Z'),   // lower bound F
    makeTrade('bd10', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 17 }, null, '2026-01-01T10:00:00Z'), // upper bound F
  ];
  const r = computeProcessScoreDistribution(trades);
  assertEqual(r[0].count, 2, 'A: 2 (54 and 60)');
  assertEqual(r[1].count, 2, 'B: 2 (42 and 53)');
  assertEqual(r[2].count, 2, 'C: 2 (30 and 41)');
  assertEqual(r[3].count, 2, 'D: 2 (18 and 29)');
  assertEqual(r[4].count, 2, 'F: 2 (0 and 17)');
});

test('computeProcessScoreDistribution — values outside valid range excluded', () => {
  const trades = [
    makeTrade('out1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: -1 }, null, '2026-01-01T10:00:00Z'),  // below range
    makeTrade('out2', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 61 }, null, '2026-01-01T10:00:00Z'),  // above range
    makeTrade('ok1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 30 }, null, '2026-01-01T10:00:00Z'),   // valid C
  ];
  const r = computeProcessScoreDistribution(trades);
  // Only the valid trade counted
  assertEqual(r[2].count, 1, 'C: 1 (only valid trade)');
  const total = r.reduce((s, b) => s + b.count, 0);
  assertEqual(total, 1, 'total = 1 (out-of-range excluded)');
});

test('computeProcessScoreDistribution — spread across multiple bins', () => {
  const trades = [
    makeTrade('s1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 58 }, null, '2026-01-01T10:00:00Z'), // A
    makeTrade('s2', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 48 }, null, '2026-01-01T10:00:00Z'), // B
    makeTrade('s3', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 33 }, null, '2026-01-01T10:00:00Z'), // C
    makeTrade('s4', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 36 }, null, '2026-01-01T10:00:00Z'), // C
    makeTrade('s5', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 10 }, null, '2026-01-01T10:00:00Z'), // F
    makeTrade('s6', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 22 }, null, '2026-01-01T10:00:00Z'), // D
    makeTrade('s7', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), { totalScore: 56 }, null, '2026-01-01T10:00:00Z'), // A
  ];
  const r = computeProcessScoreDistribution(trades);
  assertEqual(r[0].count, 2, 'A: 2');
  assertEqual(r[1].count, 1, 'B: 1');
  assertEqual(r[2].count, 2, 'C: 2');
  assertEqual(r[3].count, 1, 'D: 1');
  assertEqual(r[4].count, 1, 'F: 1');
  const total = r.reduce((s, b) => s + b.count, 0);
  assertEqual(total, 7, 'total = 7 (all trades counted)');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: computeProfitFactor
// ────────────────────────────────────────────────────────────────────────

test('computeProfitFactor — mixed wins and losses', () => {
  const win1 = makeTrade('pf1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const win2 = makeTrade('pf2', 'long', 'closed', longTradeExecutions(100, 105, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +500
  const loss = makeTrade('pf3', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -500
  const pf = computeProfitFactor([win1, win2, loss]);
  assertClose(pf, 1500 / 500, 'PF = 1500/500 = 3.0');
});

test('computeProfitFactor — all wins returns null', () => {
  const win1 = makeTrade('pf4', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const win2 = makeTrade('pf5', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +2000
  assertNull(computeProfitFactor([win1, win2]), 'all wins => null');
});

test('computeProfitFactor — all losses returns 0', () => {
  const loss1 = makeTrade('pf6', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // -500
  const loss2 = makeTrade('pf7', 'long', 'closed', longTradeExecutions(100, 90, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // -1000
  assertClose(computeProfitFactor([loss1, loss2])!, 0, 'all losses => PF = 0');
});

test('computeProfitFactor — empty trades returns null', () => {
  assertNull(computeProfitFactor([]), 'empty => null');
});

test('computeProfitFactor — single win returns null', () => {
  const win = makeTrade('pf8', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  assertNull(computeProfitFactor([win]), 'single win => null');
});

test('computeProfitFactor — single loss returns 0', () => {
  const loss = makeTrade('pf9', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // -500
  assertClose(computeProfitFactor([loss])!, 0, 'single loss => PF = 0');
});

test('computeProfitFactor — scratch treated as loss with zero magnitude', () => {
  // Scratch mixed with wins: scratch has PnL=0, so totalLoss=0, PF=null
  const win = makeTrade('pf10', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const scratch = makeTrade('pf11', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // 0
  assertNull(computeProfitFactor([win, scratch]), 'winner + scratch => null (no actual loss)');
});

test('computeProfitFactor — exact values', () => {
  const win = makeTrade('pf12', 'long', 'closed', longTradeExecutions(100, 125, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +2500
  const loss = makeTrade('pf13', 'long', 'closed', longTradeExecutions(100, 90, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -1000
  assertClose(computeProfitFactor([win, loss])!, 2.5, 'PF = 2500/1000 = 2.5');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: computeAvgWin
// ────────────────────────────────────────────────────────────────────────

test('computeAvgWin — mixed wins and losses', () => {
  const win1 = makeTrade('aw1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const win2 = makeTrade('aw2', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +2000
  const loss = makeTrade('aw3', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -500
  assertClose(computeAvgWin([win1, win2, loss]), 1500, 'avgWin = (1000 + 2000) / 2 = 1500');
});

test('computeAvgWin — all wins', () => {
  const win1 = makeTrade('aw4', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const win2 = makeTrade('aw5', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +2000
  assertClose(computeAvgWin([win1, win2]), 1500, 'avgWin = 1500');
});

test('computeAvgWin — all losses returns null', () => {
  const loss1 = makeTrade('aw6', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // -500
  const loss2 = makeTrade('aw7', 'long', 'closed', longTradeExecutions(100, 90, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // -1000
  assertNull(computeAvgWin([loss1, loss2]), 'all losses => null');
});

test('computeAvgWin — empty trades returns null', () => {
  assertNull(computeAvgWin([]), 'empty => null');
});

test('computeAvgWin — single win', () => {
  const win = makeTrade('aw8', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  assertClose(computeAvgWin([win]), 1000, 'single win => 1000');
});

test('computeAvgWin — scratch not counted as win', () => {
  const win = makeTrade('aw9', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const scratch = makeTrade('aw10', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // 0
  assertClose(computeAvgWin([win, scratch]), 1000, 'avgWin = 1000 (scratch not a win)');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: computeAvgLoss
// ────────────────────────────────────────────────────────────────────────

test('computeAvgLoss — mixed wins and losses', () => {
  const win = makeTrade('al1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');   // +1000
  const loss1 = makeTrade('al2', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -500
  const loss2 = makeTrade('al3', 'long', 'closed', longTradeExecutions(100, 85, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -1500
  assertClose(computeAvgLoss([win, loss1, loss2]), 1000, 'avgLoss = (500 + 1500) / 2 = 1000');
});

test('computeAvgLoss — all wins returns null', () => {
  const win1 = makeTrade('al4', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const win2 = makeTrade('al5', 'long', 'closed', longTradeExecutions(100, 120, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +2000
  assertNull(computeAvgLoss([win1, win2]), 'all wins => null');
});

test('computeAvgLoss — all losses', () => {
  const loss1 = makeTrade('al6', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -500
  const loss2 = makeTrade('al7', 'long', 'closed', longTradeExecutions(100, 85, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -1500
  assertClose(computeAvgLoss([loss1, loss2]), 1000, 'avgLoss = (500 + 1500) / 2 = 1000');
});

test('computeAvgLoss — empty trades returns null', () => {
  assertNull(computeAvgLoss([]), 'empty => null');
});

test('computeAvgLoss — single loss returns absolute magnitude', () => {
  const loss = makeTrade('al8', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -500
  assertClose(computeAvgLoss([loss]), 500, 'avgLoss = 500 (positive magnitude)');
});

test('computeAvgLoss — scratch included as loss with zero magnitude', () => {
  const loss = makeTrade('al9', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -500
  const scratch = makeTrade('al10', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // 0
  assertClose(computeAvgLoss([loss, scratch]), 250, 'avgLoss = (500 + 0) / 2 = 250');
});

test('computeAvgLoss — all scratches returns 0', () => {
  const scratch1 = makeTrade('al11', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // 0
  const scratch2 = makeTrade('al12', 'long', 'closed', longTradeExecutions(100, 100, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // 0
  assertClose(computeAvgLoss([scratch1, scratch2]), 0, 'all scratches => avgLoss = 0');
});

// ────────────────────────────────────────────────────────────────────────
// Tests: computeKpiMetrics wiring for profitFactor, avgWin, avgLoss
// ────────────────────────────────────────────────────────────────────────

test('computeKpiMetrics — includes profitFactor, avgWin, avgLoss fields', () => {
  const win = makeTrade('kw1', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const loss = makeTrade('kw2', 'long', 'closed', longTradeExecutions(100, 95, 100, 0, 0), null, null, '2026-01-01T10:00:00Z');  // -500
  const r = computeKpiMetrics([win, loss], [win, loss], null, null);
  assertClose(r.profitFactor!, 1000 / 500, 'profitFactor = 2.0');
  assertClose(r.avgWin!, 1000, 'avgWin = 1000');
  assertClose(r.avgLoss!, 500, 'avgLoss = 500');
});

test('computeKpiMetrics — profitFactor null when no losses', () => {
  const win = makeTrade('kw3', 'long', 'closed', longTradeExecutions(100, 110, 100, 0, 0), null, null, '2026-01-01T10:00:00Z'); // +1000
  const r = computeKpiMetrics([win], [win], null, null);
  assertNull(r.profitFactor, 'profitFactor = null (no losses)');
  assertClose(r.avgWin!, 1000, 'avgWin = 1000');
  assertNull(r.avgLoss, 'avgLoss = null (no losses)');
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
