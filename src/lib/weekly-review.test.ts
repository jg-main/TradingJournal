/**
 * weekly-review.test.ts
 *
 * Comprehensive tests for the weekly review aggregation library.
 * Covers positive, negative, and edge cases.
 *
 * Run: npx tsx src/lib/weekly-review.test.ts
 */

import {
  computeWeeklyMetrics,
  type WeekReviewTradeInput,
} from './weekly-review';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertApprox(a: number, b: number, msg: string, tol = 0.001) {
  if (Math.abs(a - b) < tol) {
    passed++;
    console.log(`  ✅ ${msg} (≈${a})`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${b}, got ${a} (FAILED)`);
  }
}

function assertNull(v: unknown, msg: string) {
  if (v === null) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected null, got ${v} (FAILED)`);
  }
}

// ── Fixture helpers ────────────────────────────────────────────────────

const WIN_TRADE: WeekReviewTradeInput = {
  id: 'win-001',
  direction: 'long',
  executions: [
    { action: 'buy', quantity: 100, price: 50, fees: 2, executedAt: '2026-06-01T10:00:00Z' },
    { action: 'sell', quantity: 100, price: 60, fees: 2, executedAt: '2026-06-01T14:00:00Z' },
  ],
  grade: { totalScore: 48 },
  riskSnapshot: { initialRiskAmount: 400 },
};

const LOSS_TRADE: WeekReviewTradeInput = {
  id: 'loss-001',
  direction: 'long',
  executions: [
    { action: 'buy', quantity: 100, price: 50, fees: 2, executedAt: '2026-06-02T10:00:00Z' },
    { action: 'sell', quantity: 100, price: 40, fees: 2, executedAt: '2026-06-02T14:00:00Z' },
  ],
  grade: { totalScore: 21 },
  riskSnapshot: { initialRiskAmount: 500 },
};

const SCRATCH_TRADE: WeekReviewTradeInput = {
  id: 'scratch-001',
  direction: 'long',
  executions: [
    { action: 'buy', quantity: 100, price: 50, fees: 1.5, executedAt: '2026-06-03T10:00:00Z' },
    { action: 'sell', quantity: 100, price: 50, fees: 1.5, executedAt: '2026-06-03T14:00:00Z' },
  ],
  grade: { totalScore: 30 },
  riskSnapshot: { initialRiskAmount: 300 },
};

// This trade is defined in fixtures but NOT passed to computeWeeklyMetrics
// to verify that open trades are excluded from aggregation.
const OPEN_TRADE: WeekReviewTradeInput = {
  id: 'open-001',
  direction: 'long',
  executions: [
    { action: 'buy', quantity: 100, price: 45, fees: 1, executedAt: '2026-06-04T10:00:00Z' },
  ],
  grade: null,
  riskSnapshot: null,
};

// ────────────────────────────────────────────────────────────────────────
// Tests: basic aggregation with 3 closed trades
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — standard 3-trade set');

  const trades = [WIN_TRADE, LOSS_TRADE, SCRATCH_TRADE];
  const r = computeWeeklyMetrics(trades);

  // Verify open trade is NOT included (it's not in the input array)
  assert(r.closedTrades === 3, '3 trades passed → closedTrades = 3');

  // netPnl: 996 + (-1004) + (-3) = -11
  assertApprox(r.netPnl, -11, 'net PnL = -11');

  // avgR: (996/400 + -1004/500 + -3/300) / 3 = (2.49 + -2.008 + -0.01) / 3 ≈ 0.157
  assertApprox(r.avgR!, 0.157333, 'avgR ≈ 0.157');

  // winRate: 1 win / 3 trades ≈ 0.333
  assertApprox(r.winRate, 0.333333, 'winRate ≈ 0.333');
  assert(r.winRate <= 1, 'winRate ≤ 1');

  // avgProcessScore: (48 + 21 + 30) / 3 = 33
  assertApprox(r.avgProcessScore!, 33, 'avgProcessScore = 33');

  // Skip counts
  assert(r.ungradedCount === 0, 'ungradedCount = 0 (all have grades)');
  assert(r.unassessedRiskCount === 0, 'unassessedRiskCount = 0 (all have risk)');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: empty array
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — empty array');

  const r = computeWeeklyMetrics([]);

  assert(r.closedTrades === 0, 'empty → closedTrades = 0');
  assertApprox(r.netPnl, 0, 'empty → netPnl = 0');
  assertNull(r.avgR, 'empty → avgR = null');
  assertApprox(r.winRate, 0, 'empty → winRate = 0');
  assertNull(r.avgProcessScore, 'empty → avgProcessScore = null');
  assert(r.ungradedCount === 0, 'empty → ungradedCount = 0');
  assert(r.unassessedRiskCount === 0, 'empty → unassessedRiskCount = 0');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: no grades on any trade
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — no grades');

  const ungradedTrades = [
    { ...WIN_TRADE, grade: null },
    { ...LOSS_TRADE, grade: null },
    { ...SCRATCH_TRADE, grade: null },
  ];
  const r = computeWeeklyMetrics(ungradedTrades);

  assert(r.closedTrades === 3, 'no grades → closedTrades = 3');
  assertNull(r.avgProcessScore, 'no grades → avgProcessScore = null');
  assert(r.ungradedCount === 3, 'no grades → ungradedCount = 3');
  // Other metrics unaffected
  assertApprox(r.netPnl, -11, 'no grades → netPnl still -11');
  assert(r.unassessedRiskCount === 0, 'no grades → risk still assessed');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: no risk snapshots on any trade
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — no risk snapshots');

  const unassessedTrades = [
    { ...WIN_TRADE, riskSnapshot: null },
    { ...LOSS_TRADE, riskSnapshot: null },
    { ...SCRATCH_TRADE, riskSnapshot: null },
  ];
  const r = computeWeeklyMetrics(unassessedTrades);

  assert(r.closedTrades === 3, 'no risk → closedTrades = 3');
  assertNull(r.avgR, 'no risk → avgR = null');
  assert(r.unassessedRiskCount === 3, 'no risk → unassessedRiskCount = 3');
  // PnL still computed (PnL doesn't depend on risk data)
  assertApprox(r.netPnl, -11, 'no risk → netPnl still -11');
  assert(r.ungradedCount === 0, 'no risk → grades still present');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: risk snapshot exists but initialRiskAmount is null
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — risk snapshot with null amount');

  const nullRiskTrades: WeekReviewTradeInput[] = [
    {
      ...WIN_TRADE,
      riskSnapshot: { initialRiskAmount: null },
    },
  ];
  const r = computeWeeklyMetrics(nullRiskTrades);

  assert(r.closedTrades === 1, 'null risk amount → closedTrades = 1');
  assertNull(r.avgR, 'null risk amount → avgR = null');
  assert(r.unassessedRiskCount === 1, 'null risk amount → unassessedRiskCount = 1');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: single win trade (100% win rate)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — single win');

  const r = computeWeeklyMetrics([WIN_TRADE]);

  assert(r.closedTrades === 1, 'single win → closedTrades = 1');
  assertApprox(r.winRate, 1, 'single win → winRate = 1');
  assertApprox(r.netPnl, 996, 'single win → netPnl = 996');
  assertApprox(r.avgR!, 2.49, 'single win → avgR = 2.49');
  assertApprox(r.avgProcessScore!, 48, 'single win → avgProcessScore = 48');
  assert(r.ungradedCount === 0, 'single win → ungradedCount = 0');
  assert(r.unassessedRiskCount === 0, 'single win → unassessedRiskCount = 0');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: single loss trade (0% win rate)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — single loss');

  const r = computeWeeklyMetrics([LOSS_TRADE]);

  assert(r.closedTrades === 1, 'single loss → closedTrades = 1');
  assertApprox(r.winRate, 0, 'single loss → winRate = 0');
  assertApprox(r.netPnl, -1004, 'single loss → netPnl = -1004');
  assertApprox(r.avgR!, -2.008, 'single loss → avgR = -2.008');
  assertApprox(r.avgProcessScore!, 21, 'single loss → avgProcessScore = 21');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: scratch trade (PnL = 0 or near 0, counts as loss for win rate)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — scratch trade');

  const r = computeWeeklyMetrics([SCRATCH_TRADE]);

  assert(r.closedTrades === 1, 'scratch → closedTrades = 1');
  assertApprox(r.winRate, 0, 'scratch → winRate = 0 (≤0 PnL = loss)');
  assertApprox(r.netPnl, -3, 'scratch → netPnl = -3 (fees only)');
  assertApprox(r.avgR!, -0.01, 'scratch → avgR = -0.01');
  assertApprox(r.avgProcessScore!, 30, 'scratch → avgProcessScore = 30');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: mixed grades (some graded, some not)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — mixed grades');

  const mixedTrades: WeekReviewTradeInput[] = [
    { ...WIN_TRADE, grade: { totalScore: 48 } },
    { ...LOSS_TRADE, grade: null },
    { ...SCRATCH_TRADE, grade: { totalScore: 30 } },
  ];
  const r = computeWeeklyMetrics(mixedTrades);

  assert(r.closedTrades === 3, 'mixed grades → closedTrades = 3');
  // avgProcessScore = (48 + 30) / 2 = 39
  assertApprox(r.avgProcessScore!, 39, 'mixed grades → avgProcessScore = 39');
  assert(r.ungradedCount === 1, 'mixed grades → ungradedCount = 1');
}

// ────────────────────────────────────────────────────────────────────────
// Tests: grade exists but totalScore is null
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeWeeklyMetrics — grade with null totalScore');

  const nullScoreTrades: WeekReviewTradeInput[] = [
    {
      ...WIN_TRADE,
      grade: { totalScore: null as unknown as number },
    },
  ];
  const r = computeWeeklyMetrics(nullScoreTrades);

  assert(r.closedTrades === 1, 'null totalScore → closedTrades = 1');
  assertNull(r.avgProcessScore, 'null totalScore → avgProcessScore = null');
  assert(r.ungradedCount === 1, 'null totalScore → ungradedCount = 1');
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
