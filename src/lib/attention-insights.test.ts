/**
 * attention-insights.test.ts
 *
 * Standalone tests for the attention-insights.ts pure computation library.
 * Follows the same pattern as trade-calc.test.ts (npx tsx runner).
 *
 * Covers:
 *   - Day-of-week win rate comparison
 *   - Trades without stop loss detection
 *   - Ungraded trade detection
 *   - Extreme trade detection (best/worst by R-multiple)
 *   - Win/loss streak detection
 *   - Setup concentration analysis
 *   - Empty/edge case inputs
 */

import { computeAttentionInsights, type AttentionInsightTradeInput } from './attention-insights';

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

function assertCount(actual: number, expected: number, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg} (${actual})`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${expected}, got ${actual} (FAILED)`);
  }
}

function assertFound(insights: { type: string }[], type: string, msg: string) {
  if (insights.some((i) => i.type === type)) {
    passed++;
    console.log(`  ✅ ${msg} (found ${type})`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected insight type "${type}" not found (FAILED)`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

// D8: tests must explicitly state the timezone controlling attribution.
const TEST_TIMEZONE = 'UTC';

function makeTrade(overrides: Partial<AttentionInsightTradeInput> & { id: string }): AttentionInsightTradeInput {
  return {
    direction: 'long',
    executions: [],
    riskSnapshot: null,
    grade: null,
    closedAt: null,
    openedAt: null,
    setupId: null,
    ...overrides,
  };
}

// ── Test: Empty input ────────────────────────────────────────────────────

{
  console.log('\n## Empty input');

  const result = computeAttentionInsights([], TEST_TIMEZONE);
  assertCount(result.insights.length, 0, 'empty trades → no insights');
  assertCount(result.tradeCount, 0, 'empty trades → tradeCount 0');
}

// ── Test: Only open trades (no closedAt) ─────────────────────────────────

{
  console.log('\n## Only open trades');

  const trades: AttentionInsightTradeInput[] = [
    makeTrade({ id: 't1' }),
    makeTrade({ id: 't2' }),
  ];

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertCount(result.insights.length, 0, 'only open trades → no insights');
}

// ── Test: Trades without stop loss ────────────────────────────────────────

{
  console.log('\n## Trades without stop loss');

  const trades: AttentionInsightTradeInput[] = [
    makeTrade({
      id: 't1',
      closedAt: '2026-01-10T14:00:00Z',
      riskSnapshot: { initialRiskAmount: null },
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
      ],
    }),
    makeTrade({
      id: 't2',
      closedAt: '2026-01-11T14:00:00Z',
      riskSnapshot: null, // no snapshot at all
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-11T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 52, fees: 0, executedAt: '2026-01-11T14:00:00Z' },
      ],
    }),
    makeTrade({
      id: 't3', // has a stop — should not be flagged
      closedAt: '2026-01-12T14:00:00Z',
      riskSnapshot: { initialRiskAmount: 200 },
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-12T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 48, fees: 0, executedAt: '2026-01-12T14:00:00Z' },
      ],
    }),
  ];

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertFound(result.insights, 'no_stop_loss', 'no stop insight present');
  const noStop = result.insights.find((i) => i.type === 'no_stop_loss');
  assert(noStop !== undefined, 'found no_stop_loss insight');
  if (noStop) {
    assert(noStop.value === 2, `counts 2 no-stop trades, got ${noStop.value}`);
    assert(noStop.severity === 'warning', '2 no-stop trades → warning (not critical)');
  }
}

// ── Test: 5+ trades without stop → critical ─────────────────────────────

{
  console.log('\n## 5+ trades without stop → critical');

  const trades: AttentionInsightTradeInput[] = [];
  for (let i = 0; i < 7; i++) {
    trades.push(
      makeTrade({
        id: `no-stop-${i}`,
        closedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z`,
        riskSnapshot: null,
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z` },
          { action: 'sell', quantity: 100, price: 55, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z` },
        ],
      }),
    );
  }

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  const noStop = result.insights.find((i) => i.type === 'no_stop_loss');
  assert(noStop !== undefined, 'no stop insight present for 7 trades');
  if (noStop) {
    assert(noStop.severity === 'critical', '7 no-stop trades → critical severity');
  }
}

// ── Test: Day-of-week win rate comparison ───────────────────────────────

{
  console.log('\n## Day-of-week win rate');

  // Tuesday (day 2): 4 wins, 0 losses → 100%
  // Wednesday (day 3): 0 wins, 4 losses → 0%
  // Gap is 100pp → significant
  const trades: AttentionInsightTradeInput[] = [];

  // Tuesday winners
  for (let i = 0; i < 4; i++) {
    trades.push(
      makeTrade({
        id: `tue-win-${i}`,
        closedAt: '2026-01-06T14:00:00Z', // Tuesday (UTC)
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-06T10:00:00Z' },
          { action: 'sell', quantity: 100, price: 55, fees: 0, executedAt: '2026-01-06T14:00:00Z' },
        ],
      }),
    );
  }

  // Wednesday losers
  for (let i = 0; i < 4; i++) {
    trades.push(
      makeTrade({
        id: `wed-loss-${i}`,
        closedAt: '2026-01-07T14:00:00Z', // Wednesday (UTC)
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-07T10:00:00Z' },
          { action: 'sell', quantity: 100, price: 45, fees: 0, executedAt: '2026-01-07T14:00:00Z' },
        ],
      }),
    );
  }

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertFound(result.insights, 'day_of_week_best', 'best day insight present');
  const bestDay = result.insights.find((i) => i.type === 'day_of_week_best');
  assert(bestDay !== undefined, 'best day insight found');
  if (bestDay) {
    assert(bestDay.title.includes('Tuesday'), `best day is Tuesday, got "${bestDay.title}"`);
  }
}

// ── Test: Day-of-week — small gap does not trigger insight ──────────────

{
  console.log('\n## Day-of-week — small gap suppressed');

  // Monday: 3 wins, 4 losses → 42.9% WR
  // Tuesday: 4 wins, 3 losses → 57.1% WR
  // Gap is ~14pp → less than 20pp threshold, and worst day > 30%
  const trades: AttentionInsightTradeInput[] = [];

  for (let i = 0; i < 7; i++) {
    trades.push(
      makeTrade({
        id: `mon-t${i}`,
        closedAt: '2026-01-05T14:00:00Z', // Monday
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-05T10:00:00Z' },
          { action: 'sell', quantity: 100, price: i < 3 ? 55 : 45, fees: 0, executedAt: '2026-01-05T14:00:00Z' },
        ],
      }),
    );
  }

  for (let i = 0; i < 7; i++) {
    trades.push(
      makeTrade({
        id: `tue-t${i}`,
        closedAt: '2026-01-06T14:00:00Z', // Tuesday
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-06T10:00:00Z' },
          { action: 'sell', quantity: 100, price: i < 4 ? 55 : 45, fees: 0, executedAt: '2026-01-06T14:00:00Z' },
        ],
      }),
    );
  }

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  const bestDay = result.insights.find((i) => i.type === 'day_of_week_best');
  assert(bestDay === undefined, 'small gap → no day_of_week_best insight');
}

// ── Test: Ungraded trades ────────────────────────────────────────────────

{
  console.log('\n## Ungraded trades');

  const trades: AttentionInsightTradeInput[] = [
    makeTrade({
      id: 'graded-1',
      closedAt: '2026-01-10T14:00:00Z',
      grade: { totalScore: 85 },
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
      ],
    }),
    makeTrade({
      id: 'ungraded-1',
      closedAt: '2026-01-11T14:00:00Z',
      grade: null, // not graded
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-11T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 52, fees: 0, executedAt: '2026-01-11T14:00:00Z' },
      ],
    }),
    makeTrade({
      id: 'ungraded-2',
      closedAt: '2026-01-12T14:00:00Z',
      grade: { totalScore: null }, // grade exists but no score
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-12T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 48, fees: 0, executedAt: '2026-01-12T14:00:00Z' },
      ],
    }),
  ];

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertFound(result.insights, 'ungraded_trades', 'ungraded trades insight present');
  const ungraded = result.insights.find((i) => i.type === 'ungraded_trades');
  assert(ungraded !== undefined, 'found ungraded_trades insight');
  if (ungraded) {
    assert(ungraded.value === 2, `counts 2 ungraded trades, got ${ungraded.value}`);
  }
}

// ── Test: Best/worst trade by R-multiple ─────────────────────────────────

{
  console.log('\n## Best and worst trade by R-multiple');

  const trades: AttentionInsightTradeInput[] = [
    // Best trade: 3.0R
    makeTrade({
      id: 'best-trade',
      closedAt: '2026-01-10T14:00:00Z',
      riskSnapshot: { initialRiskAmount: 100 },
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 80, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
      ],
    }),
    // Worst trade: -2.5R
    makeTrade({
      id: 'worst-trade',
      closedAt: '2026-01-11T14:00:00Z',
      riskSnapshot: { initialRiskAmount: 200 },
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-11T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 45, fees: 0, executedAt: '2026-01-11T14:00:00Z' },
      ],
    }),
    // Middle trade: 1.0R (not extreme)
    makeTrade({
      id: 'mid-trade',
      closedAt: '2026-01-12T14:00:00Z',
      riskSnapshot: { initialRiskAmount: 100 },
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-12T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 60, fees: 0, executedAt: '2026-01-12T14:00:00Z' },
      ],
    }),
  ];

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertFound(result.insights, 'top_trade', 'top trade insight present');
  assertFound(result.insights, 'worst_trade', 'worst trade insight present');

  const topTrade = result.insights.find((i) => i.type === 'top_trade');
  assert(topTrade !== undefined, 'found top_trade');
  if (topTrade) {
    assert(typeof topTrade.value === 'string' && topTrade.value.startsWith('3'), `best trade ≈3.0R, got "${topTrade.value}"`);
  }
}

// ── Test: Win streak detection ───────────────────────────────────────────

{
  console.log('\n## Win streak detection');

  const trades: AttentionInsightTradeInput[] = [];
  // 3 wins, 2 losses, then 4 wins (current streak)
  const patterns: { pnl: 'win' | 'loss' }[] = [
    { pnl: 'win' }, { pnl: 'win' }, { pnl: 'win' },
    { pnl: 'loss' }, { pnl: 'loss' },
    { pnl: 'win' }, { pnl: 'win' }, { pnl: 'win' }, { pnl: 'win' },
  ];

  patterns.forEach((p, i) => {
    const price = p.pnl === 'win' ? 55 : 45;
    trades.push(
      makeTrade({
        id: `streak-${i}`,
        closedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z`,
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z` },
          { action: 'sell', quantity: 100, price, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z` },
        ],
      }),
    );
  });

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertFound(result.insights, 'win_streak', 'win streak insight present');
  const streak = result.insights.find((i) => i.type === 'win_streak');
  assert(streak !== undefined, 'found win_streak');
  if (streak) {
    assert(streak.value === 4, `4-trade win streak, got ${streak.value}`);
  }
}

// ── Test: Losing streak detection ────────────────────────────────────────

{
  console.log('\n## Losing streak detection');

  const trades: AttentionInsightTradeInput[] = [];
  // 2 wins, then 3 losses (current streak)
  const patterns: { pnl: 'win' | 'loss' }[] = [
    { pnl: 'win' }, { pnl: 'win' },
    { pnl: 'loss' }, { pnl: 'loss' }, { pnl: 'loss' },
  ];

  patterns.forEach((p, i) => {
    const price = p.pnl === 'win' ? 55 : 45;
    trades.push(
      makeTrade({
        id: `lstreak-${i}`,
        closedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z`,
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z` },
          { action: 'sell', quantity: 100, price, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z` },
        ],
      }),
    );
  });

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertFound(result.insights, 'losing_streak', 'losing streak insight present');
  const streak = result.insights.find((i) => i.type === 'losing_streak');
  assert(streak !== undefined, 'found losing_streak');
  if (streak) {
    assert(streak.value === 3, `3-trade losing streak, got ${streak.value}`);
  }
}

// ── Test: Scratches excluded from streaks ────────────────────────────────

{
  console.log('\n## Scratches excluded from streaks');

  const trades: AttentionInsightTradeInput[] = [];
  // 2 wins, 1 scratch, 2 wins → current streak is 3 (scratch is not a win/loss,
  // so it's skipped, connecting the initial win to the trailing wins)
  const patterns = [
    { pnl: 'win', price: 55 },
    { pnl: 'scratch', price: 50 }, // P&L = 0
    { pnl: 'win', price: 55 },
    { pnl: 'win', price: 55 },
  ];

  patterns.forEach((p, i) => {
    trades.push(
      makeTrade({
        id: `scratch-streak-${i}`,
        closedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z`,
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z` },
          { action: 'sell', quantity: 100, price: p.price, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z` },
        ],
      }),
    );
  });

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  const streak = result.insights.find((i) => i.type === 'win_streak');
  assert(streak !== undefined, 'win streak found after scratch gap');
  if (streak) {
    assert(streak.value === 3, `3-trade win streak (scratch skipped, 2 trailing + 1 before scratch), got ${streak.value}`);
  }
}

// ── Test: Setup concentration ───────────────────────────────────────────

{
  console.log('\n## Setup concentration — diverse setups');

  // 12 trades across 6 setups → diverse (≥5 unique)
  const trades: AttentionInsightTradeInput[] = [];
  const setups = ['s1', 's2', 's3', 's4', 's5', 's6'];
  for (let i = 0; i < 12; i++) {
    trades.push(
      makeTrade({
        id: `diverse-${i}`,
        closedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z`,
        setupId: setups[i % setups.length],
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z` },
          { action: 'sell', quantity: 100, price: 55, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z` },
        ],
      }),
    );
  }

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertFound(result.insights, 'setup_diversity', 'setup diversity insight present');
}

// ── Test: Unclassified setups warning ────────────────────────────────────

{
  console.log('\n## Unclassified setups warning');

  const trades: AttentionInsightTradeInput[] = [];
  for (let i = 0; i < 12; i++) {
    trades.push(
      makeTrade({
        id: `unclass-${i}`,
        closedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z`,
        setupId: null, // no setup recorded
        riskSnapshot: { initialRiskAmount: 100 },
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z` },
          { action: 'sell', quantity: 100, price: 55, fees: 0, executedAt: `2026-01-${String(i + 1).padStart(2, '0')}T14:00:00Z` },
        ],
      }),
    );
  }

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assertFound(result.insights, 'unclassified_setups', 'unclassified setups insight present');
}

// ── Test: No insights for single day of data ────────────────────────────

{
  console.log('\n## Single day only → no day-of-week insight');

  const trades: AttentionInsightTradeInput[] = [
    makeTrade({
      id: 'mon-1',
      closedAt: '2026-01-05T14:00:00Z',
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-05T10:00:00Z' },
        { action: 'sell', quantity: 100, price: 55, fees: 0, executedAt: '2026-01-05T14:00:00Z' },
      ],
    }),
    makeTrade({
      id: 'mon-2',
      closedAt: '2026-01-05T15:00:00Z',
      executions: [
        { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-05T11:00:00Z' },
        { action: 'sell', quantity: 100, price: 45, fees: 0, executedAt: '2026-01-05T15:00:00Z' },
      ],
    }),
  ];

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  const bestDay = result.insights.find((i) => i.type.startsWith('day_of_week'));
  assert(bestDay === undefined, 'single day data → no day-of-week insight');
}

// ── Test: Short trades (short direction) ────────────────────────────────

{
  console.log('\n## Short trades');

  const trades: AttentionInsightTradeInput[] = [
    makeTrade({
      id: 'short-win',
      direction: 'short',
      closedAt: '2026-01-10T14:00:00Z',
      riskSnapshot: { initialRiskAmount: 200 },
      executions: [
        { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
        { action: 'buy_to_cover', quantity: 100, price: 80, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
      ],
    }),
    makeTrade({
      id: 'short-loss',
      direction: 'short',
      closedAt: '2026-01-11T14:00:00Z',
      riskSnapshot: { initialRiskAmount: 100 },
      executions: [
        { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-11T10:00:00Z' },
        { action: 'buy_to_cover', quantity: 100, price: 110, fees: 0, executedAt: '2026-01-11T14:00:00Z' },
      ],
    }),
  ];

  const result = computeAttentionInsights(trades, TEST_TIMEZONE);
  assert(result.insights.length > 0, 'short trades generate insights');
  assertFound(result.insights, 'top_trade', 'top trade found for short trades');
}

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
