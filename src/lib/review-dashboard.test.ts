/**
 * review-dashboard.test.ts
 *
 * Unit tests for computeSetupPerformance(). Tests in isolation without a
 * database — fixtures are plain objects matching SetupPerfTradeInput.
 *
 * Run: npx tsx src/lib/review-dashboard.test.ts
 */

import { computeSetupPerformance, type SetupPerfTradeInput } from './review-dashboard';
import { type ExecutionData } from './trade-calc';

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal ExecutionData array for a simple round-trip trade.
 * Simulates a long trade: buy at entryPrice, sell at exitPrice.
 */
function longTradeExecutions(entryPrice: number, exitPrice: number, qty = 100, fees = 0): ExecutionData[] {
  return [
    { action: 'buy', quantity: qty, price: entryPrice, fees: null, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'sell', quantity: qty, price: exitPrice, fees: null, executedAt: '2026-01-01T14:00:00Z' },
  ];
}

/**
 * Build a minimal ExecutionData array for a simple short round-trip trade.
 */
function shortTradeExecutions(entryPrice: number, exitPrice: number, qty = 100, fees = 0): ExecutionData[] {
  return [
    { action: 'sell_short', quantity: qty, price: entryPrice, fees: null, executedAt: '2026-01-01T10:00:00Z' },
    { action: 'buy_to_cover', quantity: qty, price: exitPrice, fees: null, executedAt: '2026-01-01T14:00:00Z' },
  ];
}

function makeTrade(
  id: string,
  direction: 'long' | 'short',
  executions: ExecutionData[],
  setupId: string | null,
  grade: { totalScore: number } | null = null,
  riskSnapshot: { initialRiskAmount: number | null } | null = null,
): SetupPerfTradeInput {
  return { id, direction, executions, grade, riskSnapshot, setupId };
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

function assertLength(actual: unknown[], expected: number, label: string): void {
  if (actual.length !== expected) {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected length: ${expected}, actual: ${actual.length}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${label}`);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

let testCount = 0;

function test(name: string, fn: () => void): void {
  testCount++;
  console.log(`\n#${testCount}: ${name}`);
  fn();
}

// ── 1. Normal case: three setups with multiple trades ───────────────────

test('normal case with 3 setups — correct grouping and metrics', () => {
  const trades = [
    // Setup A: 3 trades — 2 wins, 1 loss, all graded, all with risk
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'setup-a', { totalScore: 55 }, { initialRiskAmount: 200 }),
    makeTrade('t2', 'long', longTradeExecutions(100, 120), 'setup-a', { totalScore: 60 }, { initialRiskAmount: 200 }),
    makeTrade('t3', 'long', longTradeExecutions(100, 90), 'setup-a', { totalScore: 40 }, { initialRiskAmount: 200 }),
    // Setup B: 2 trades — 1 win, 1 loss, both graded
    makeTrade('t4', 'long', longTradeExecutions(50, 55), 'setup-b', { totalScore: 50 }, { initialRiskAmount: 100 }),
    makeTrade('t5', 'long', longTradeExecutions(50, 45), 'setup-b', { totalScore: 45 }, { initialRiskAmount: 100 }),
    // Setup C: 1 trade — win
    makeTrade('t6', 'short', shortTradeExecutions(200, 180), 'setup-c', { totalScore: 70 }, { initialRiskAmount: 300 }),
  ];

  const setupNameMap = { 'setup-a': 'Breakout', 'setup-b': 'Pullback', 'setup-c': 'Reversal' };
  const result = computeSetupPerformance(trades, setupNameMap);

  assertEqual(result.totalTrades, 6, 'totalTrades = 6');
  assertLength(result.setupPerformance, 3, '3 setup groups');

  // Setup A: count=3, 2 wins / 0 scratches = 2/3 winRate
  const a = result.setupPerformance.find((s) => s.setupName === 'Breakout')!;
  assertEqual(a.setupId, 'setup-a', 'setup-a id preserved');
  assertEqual(a.count, 3, 'setup-a count = 3');
  assertClose(a.winRate, 2 / 3, 'setup-a winRate = 2/3');
  // avgR: (PnL/buy) for t1=1000, t2=2000, t3=-1000, risk=200 each => (5+10-5)/3 = 3.333
  // Actually: t1 PnL = (110-100)*100 = 1000, /200 = 5; t2 = (120-100)*100=2000, /200=10; t3 = (90-100)*100=-1000, /200=-5
  // avgR = (5 + 10 + (-5)) / 3 = 10/3 = 3.333
  assertClose(a.avgR, 10 / 3, 'setup-a avgR = 10/3');
  assertClose(a.avgProcessScore, (55 + 60 + 40) / 3, 'setup-a avgProcessScore = 51.667');
  assertEqual(a.sampleSizeWarning, 'very_small', 'setup-a sampleSizeWarning = very_small');

  // Setup B: count=2, 1 win / 0 scratches = 0.5
  const b = result.setupPerformance.find((s) => s.setupName === 'Pullback')!;
  assertEqual(b.count, 2, 'setup-b count = 2');
  assertClose(b.winRate, 0.5, 'setup-b winRate = 0.5');
  // t4: (55-50)*100=500/100=5; t5: (45-50)*100=-500/100=-5; avg = 0
  assertClose(b.avgR, 0, 'setup-b avgR = 0');
  assertClose(b.avgProcessScore, (50 + 45) / 2, 'setup-b avgProcessScore = 47.5');

  // Setup C: count=1, 1 win
  const c = result.setupPerformance.find((s) => s.setupName === 'Reversal')!;
  assertEqual(c.count, 1, 'setup-c count = 1');
  assertClose(c.winRate, 1, 'setup-c winRate = 1');
  // t6 short: sell at 200, buy back at 180 => profit = (200-180)*100 = 2000, /300 = 6.667
  assertClose(c.avgR, 2000 / 300, 'setup-c avgR = 6.667');
  assertClose(c.avgProcessScore, 70, 'setup-c avgProcessScore = 70');

  // Sorted by count descending: A(3), B(2), C(1)
  assertEqual(result.setupPerformance.map((s) => s.setupName), ['Breakout', 'Pullback', 'Reversal'], 'sorted by count descending');
});

// ── 2. Single trade in a setup ─────────────────────────────────────────

test('single trade in a setup', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'setup-x', { totalScore: 80 }, { initialRiskAmount: 100 }),
  ];
  const result = computeSetupPerformance(trades, { 'setup-x': 'Momentum' });

  assertLength(result.setupPerformance, 1, '1 setup group');
  const s = result.setupPerformance[0];
  assertEqual(s.setupName, 'Momentum', 'name resolved');
  assertEqual(s.count, 1, 'count = 1');
  assertClose(s.winRate, 1, 'winRate = 1');
  assertEqual(s.sampleSizeWarning, 'very_small', 'sampleSizeWarning = very_small');
});

// ── 3. No trades (empty array) ─────────────────────────────────────────

test('no trades — empty array', () => {
  const result = computeSetupPerformance([]);
  assertLength(result.setupPerformance, 0, 'no setup groups');
  assertEqual(result.totalTrades, 0, 'totalTrades = 0');
  assertEqual(result.ungroupedTrades, 0, 'ungroupedTrades = 0');
});

// ── 4. No grades for any trades ────────────────────────────────────────

test('no grades — avgProcessScore is null', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'setup-a', null, { initialRiskAmount: 50 }),
    makeTrade('t2', 'long', longTradeExecutions(100, 120), 'setup-a', null, { initialRiskAmount: 50 }),
  ];
  const result = computeSetupPerformance(trades, { 'setup-a': 'NoGrades' });
  const s = result.setupPerformance[0];
  assertEqual(s.avgProcessScore, null, 'avgProcessScore is null when no grades');
  assertEqual(s.count, 2, 'count still correct');
});

// ── 5. No risk snapshots — avgR is null ────────────────────────────────

test('no risk snapshots — avgR is null', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'setup-a', { totalScore: 50 }, null),
    makeTrade('t2', 'long', longTradeExecutions(100, 120), 'setup-a', { totalScore: 60 }, null),
  ];
  const result = computeSetupPerformance(trades, { 'setup-a': 'NoRisk' });
  const s = result.setupPerformance[0];
  assertEqual(s.avgR, null, 'avgR is null when no risk snapshots');
  assertEqual(s.count, 2, 'count still correct');
});

// ── 6. Null totalScore in grades — skipped from avgProcessScore ────────

test('null totalScore in grades — skipped from avgProcessScore', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'setup-a', { totalScore: 50 }, null),
    makeTrade('t2', 'long', longTradeExecutions(100, 120), 'setup-a', { totalScore: 60 }, null),
    makeTrade('t3', 'long', longTradeExecutions(100, 90), 'setup-a', { totalScore: null }, null),
  ];
  const result = computeSetupPerformance(trades, { 'setup-a': 'NullScores' });
  const s = result.setupPerformance[0];
  assertClose(s.avgProcessScore, (50 + 60) / 2, 'avgProcessScore skips null totalScore');
  assertEqual(s.count, 3, 'count still 3');
});

// ── 7. All scratches (PnL === 0) — winRate is null ─────────────────────

test('all scratches (PnL === 0) — winRate is null', () => {
  // A scratch: entry == exit price
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 100), 'setup-a', { totalScore: 50 }, { initialRiskAmount: 100 }),
    makeTrade('t2', 'long', longTradeExecutions(100, 100), 'setup-a', { totalScore: 50 }, { initialRiskAmount: 100 }),
  ];
  const result = computeSetupPerformance(trades, { 'setup-a': 'Scratches' });
  const s = result.setupPerformance[0];
  assertEqual(s.winRate, null, 'winRate is null when all scratches');
  assertEqual(s.count, 2, 'count still 2');
  // avgR should be 0 since PnL=0 and risk=100 => 0/100 = 0
  assertClose(s.avgR, 0, 'avgR = 0 for scratches');
});

// ── 8. Mix of scratches and real trades — win rate excludes scratches ──

test('mix of scratches and real trades — win rate excludes scratches', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'setup-a', null, null), // win
    makeTrade('t2', 'long', longTradeExecutions(100, 100), 'setup-a', null, null), // scratch
    makeTrade('t3', 'long', longTradeExecutions(100, 90), 'setup-a', null, null),  // loss
    makeTrade('t4', 'long', longTradeExecutions(100, 100), 'setup-a', null, null), // scratch
  ];
  const result = computeSetupPerformance(trades, { 'setup-a': 'Mixed' });
  const s = result.setupPerformance[0];
  // Wins = 1, Losses = 1, Scratches = 2, decisions = 2, winRate = 0.5
  assertClose(s.winRate, 0.5, 'winRate excludes scratches = 1/2');
  assertEqual(s.count, 4, 'count = 4');
});

// ── 9. Sample size thresholds — boundary testing ───────────────────────

test('sample size boundary — count=1 is very_small', () => {
  const trades = [makeTrade('t1', 'long', longTradeExecutions(100, 110), 's')];
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance[0].sampleSizeWarning, 'very_small', '1 => very_small');
});

test('sample size boundary — count=4 is very_small', () => {
  const trades = Array.from({ length: 4 }, (_, i) =>
    makeTrade(`t${i}`, 'long', longTradeExecutions(100, 110), 's'),
  );
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance[0].sampleSizeWarning, 'very_small', '4 => very_small');
});

test('sample size boundary — count=5 is small', () => {
  const trades = Array.from({ length: 5 }, (_, i) =>
    makeTrade(`t${i}`, 'long', longTradeExecutions(100, 110), 's'),
  );
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance[0].sampleSizeWarning, 'small', '5 => small');
});

test('sample size boundary — count=19 is small', () => {
  const trades = Array.from({ length: 19 }, (_, i) =>
    makeTrade(`t${i}`, 'long', longTradeExecutions(100, 110), 's'),
  );
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance[0].sampleSizeWarning, 'small', '19 => small');
});

test('sample size boundary — count=20 is moderate', () => {
  const trades = Array.from({ length: 20 }, (_, i) =>
    makeTrade(`t${i}`, 'long', longTradeExecutions(100, 110), 's'),
  );
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance[0].sampleSizeWarning, 'moderate', '20 => moderate');
});

test('sample size boundary — count=29 is moderate', () => {
  const trades = Array.from({ length: 29 }, (_, i) =>
    makeTrade(`t${i}`, 'long', longTradeExecutions(100, 110), 's'),
  );
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance[0].sampleSizeWarning, 'moderate', '29 => moderate');
});

test('sample size boundary — count=30 is adequate', () => {
  const trades = Array.from({ length: 30 }, (_, i) =>
    makeTrade(`t${i}`, 'long', longTradeExecutions(100, 110), 's'),
  );
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance[0].sampleSizeWarning, 'adequate', '30 => adequate');
});

test('sample size boundary — count=31 is adequate', () => {
  const trades = Array.from({ length: 31 }, (_, i) =>
    makeTrade(`t${i}`, 'long', longTradeExecutions(100, 110), 's'),
  );
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance[0].sampleSizeWarning, 'adequate', '31 => adequate');
});

// ── 10. Null setupId excluded by default ───────────────────────────────

test('null setupId trades excluded by default', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'setup-a', null, null),
    makeTrade('t2', 'long', longTradeExecutions(100, 120), null, null, null),
    makeTrade('t3', 'long', longTradeExecutions(100, 90), null, null, null),
  ];
  const result = computeSetupPerformance(trades, { 'setup-a': 'Known' });
  assertLength(result.setupPerformance, 1, 'only 1 setup group (null excluded)');
  assertEqual(result.setupPerformance[0].setupName, 'Known', 'null-id trades not merged into Known');
  assertEqual(result.setupPerformance[0].count, 1, 'only the non-null trade');
  assertEqual(result.totalTrades, 3, 'totalTrades still 3');
  assertEqual(result.ungroupedTrades, 2, 'ungroupedTrades = 2');
});

// ── 11. Null setupId included when includeUnknownGroup=true ────────────

test('null setupId included when includeUnknownGroup=true', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'setup-a', null, null),
    makeTrade('t2', 'long', longTradeExecutions(100, 50), null, null, null),
    makeTrade('t3', 'long', longTradeExecutions(100, 120), null, null, null),
  ];
  const result = computeSetupPerformance(trades, { 'setup-a': 'Known' }, true);
  assertLength(result.setupPerformance, 2, '2 setup groups (including Unknown)');
  const unknown = result.setupPerformance.find((s) => s.setupName === 'Unknown')!;
  assertEqual(unknown.setupId, null, 'Unknown setupId = null');
  assertEqual(unknown.count, 2, 'Unknown count = 2');
  assertClose(unknown.winRate, 0.5, 'Unknown winRate = 1/2');
  assertEqual(result.ungroupedTrades, 2, 'ungroupedTrades = 2');
});

// ── 12. Setup name map — unmapped IDs use raw ID ───────────────────────

test('unnapped setup IDs fall back to raw setupId', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'some-raw-id', null, null),
  ];
  const result = computeSetupPerformance(trades); // no name map
  assertEqual(result.setupPerformance[0].setupName, 'some-raw-id', 'falls back to raw setupId');
});

// ── 13. All losses — winRate = 0 ───────────────────────────────────────

test('all losses — winRate = 0', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 80), 's', null, null),
    makeTrade('t2', 'long', longTradeExecutions(100, 70), 's', null, null),
    makeTrade('t3', 'long', longTradeExecutions(100, 90), 's', null, null),
  ];
  const r = computeSetupPerformance(trades);
  assertClose(r.setupPerformance[0].winRate, 0, 'all losses => winRate = 0');
});

// ── 14. All wins — winRate = 1 ─────────────────────────────────────────

test('all wins — winRate = 1', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 150), 's', null, null),
    makeTrade('t2', 'long', longTradeExecutions(100, 130), 's', null, null),
  ];
  const r = computeSetupPerformance(trades);
  assertClose(r.setupPerformance[0].winRate, 1, 'all wins => winRate = 1');
});

// ── 15. Initial risk amount <= 0 — R-multiple returns null ─────────────

test('initialRiskAmount <= 0 — R-multiple returns null for those trades', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 's', null, { initialRiskAmount: 0 }),
    makeTrade('t2', 'long', longTradeExecutions(100, 120), 's', null, { initialRiskAmount: -5 }),
    makeTrade('t3', 'long', longTradeExecutions(100, 130), 's', null, { initialRiskAmount: 50 }),
  ];
  const r = computeSetupPerformance(trades);
  // Only t3 has valid risk: (130-100)*100 = 3000 / 50 = 60
  assertClose(r.setupPerformance[0].avgR, 60, 'avgR only includes valid risk trades');
});

// ── 16. Null initialRiskAmount — skipped from avgR ─────────────────────

test('null initialRiskAmount — skipped from avgR', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 's', null, { initialRiskAmount: null }),
    makeTrade('t2', 'long', longTradeExecutions(100, 120), 's', null, { initialRiskAmount: 100 }),
  ];
  const r = computeSetupPerformance(trades);
  // Only t2: (120-100)*100 = 2000 / 100 = 20
  assertClose(r.setupPerformance[0].avgR, 20, 'avgR excludes null risk trades');
});

// ── 17. Multiple setups sorted by count descending ─────────────────────

test('sorting by count descending', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'c', null, null),
    makeTrade('t2', 'long', longTradeExecutions(100, 110), 'a', null, null),
    makeTrade('t3', 'long', longTradeExecutions(100, 110), 'a', null, null),
    makeTrade('t4', 'long', longTradeExecutions(100, 110), 'a', null, null),
    makeTrade('t5', 'long', longTradeExecutions(100, 110), 'b', null, null),
    makeTrade('t6', 'long', longTradeExecutions(100, 110), 'b', null, null),
  ];
  const r = computeSetupPerformance(trades);
  assertEqual(r.setupPerformance.map((s) => s.setupId), ['a', 'b', 'c'], 'sorted by count descending: a(3), b(2), c(1)');
});

// ── 18. Total trades with mixed setups ─────────────────────────────────

test('totalTrades counts all trades regardless of setupId', () => {
  const trades = [
    makeTrade('t1', 'long', longTradeExecutions(100, 110), 'a', null, null),
    makeTrade('t2', 'long', longTradeExecutions(100, 110), null, null, null),
    makeTrade('t3', 'long', longTradeExecutions(100, 110), null, null, null),
  ];
  const r1 = computeSetupPerformance(trades); // default: exclude null
  assertEqual(r1.totalTrades, 3, 'totalTrades = 3 even with null setupId trades');
  assertEqual(r1.setupPerformance.length, 1, '1 group when excluding nulls');

  const r2 = computeSetupPerformance(trades, {}, true); // include Unknown
  assertEqual(r2.totalTrades, 3, 'totalTrades = 3 with includeUnknown');
  assertEqual(r2.setupPerformance.length, 2, '2 groups when including Unknown');
});

// ── 19. Short trades — win/loss logic works correctly ──────────────────

test('short trades — correct PnL calculation for wins and losses', () => {
  const trades = [
    makeTrade('t1', 'short', shortTradeExecutions(100, 80), 's', null, { initialRiskAmount: 50 }),  // win: (100-80)*100 = 2000, /50 = 40
    makeTrade('t2', 'short', shortTradeExecutions(100, 110), 's', null, { initialRiskAmount: 50 }), // loss: (100-110)*100 = -1000, /50 = -20
  ];
  const r = computeSetupPerformance(trades);
  assertClose(r.setupPerformance[0].winRate, 0.5, 'short trades winRate = 0.5');
  assertClose(r.setupPerformance[0].avgR, (40 + (-20)) / 2, 'short trades avgR = 10');
});

// ── 20. Trades with fees — PnL reflects fees ───────────────────────────

test('trades with fees — PnL reflects fee deduction', () => {
  const trades = [
    makeTrade('t1', 'long', [
      { action: 'buy', quantity: 100, price: 100, fees: 5, executedAt: '2026-01-01T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 110, fees: 5, executedAt: '2026-01-01T14:00:00Z' },
    ], 's', null, { initialRiskAmount: 200 }),
  ];
  // PnL = (110-100)*100 - 10 = 1000 - 10 = 990. /200 = 4.95
  const r = computeSetupPerformance(trades);
  assertClose(r.setupPerformance[0].avgR, 990 / 200, 'fee deduction reflected in avgR');
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n─── Ran ${testCount} tests ───`);
if (process.exitCode) {
  console.error('Some tests FAILED.');
} else {
  console.log('All tests PASSED.');
}
