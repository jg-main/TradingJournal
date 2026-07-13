#!/usr/bin/env tsx
/**
 * golden-scenarios.test.tsx
 *
 * Golden scenario integration test suite.
 *
 * Exercises cross-library consistency by running ALL consolidation computation
 * libraries against the same representative scenarios and verifying that the
 * results are coherent across modules.
 *
 * Each scenario is a realistic trading situation. The test verifies that:
 *   1. Each library produces internally consistent results
 *   2. Results from one library match expectations derived from another (e.g.,
 *      trade-calc P&L → metrics win classification → account-summary KPI)
 *   3. No library disagrees with another on the same underlying data
 *
 * Scenarios:
 *   1. Long winner — profitable long trade with risk snapshot
 *   2. Short winner — profitable short trade with risk snapshot
 *   3. Scratch with fees — breakeven trade after fees consume a tiny gain
 *   4. Missing risk snapshot — closed trade where risk snapshot was never created
 *   5. Null initialRiskAmount — explicit null in the risk snapshot record
 *   6. Account lifecycle — starting balance + deposits + withdrawals + realized P&L
 *   7. Open positions — trades still open for mark-to-market evaluation
 *
 * Run: npx tsx src/lib/__fixtures__/golden-scenarios.test.tsx
 *
 * The runner exits 0 only when ALL scenarios pass.
 */

/* ── Imports ──────────────────────────────────────────────────────────── */

import { calculatePnL, calculateRMultiple, deriveTradeStatus, type ExecutionData, type Direction } from '../trade-calc';
import {
  computeEquityAtOpen,
  deriveInitialRiskAmount,
  computeRealizedPnLFromClosedTrades,
  computeRiskSnapshotValues,
  type EquityAtOpenInput,
  type RiskSnapshotInput,
} from '../risk-snapshot';
import {
  computeAccountKPIs,
  computeAccountBalance,
  computeDatesActive,
  type ClosedTradeData,
  type RiskSnapshotData,
  type GradeData,
} from '../account-summary';
import {
  computeWinRate,
  averageRMultiples,
  averageProcessScore,
} from '../metrics';
import {
  computeOpenPosition,
  computeMarkToMarketSummary,
  calculateUnrealizedPnL,
  type FeePolicy,
} from '../mark-to-market';
import {
  calculatePositionSize,
  calculatePlanRiskRewardPreview,
  type PositionSizingParams,
} from '../position-sizing';

/* ── Assertion helpers ────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
let currentScenario = '';

function scenario(name: string): void {
  currentScenario = name;
}

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    const msg = detail ? `  expected: ${detail}` : '';
    console.error(`  ✗ [${currentScenario}] ${label}${msg}`);
  }
}

function assertClose(
  label: string,
  actual: number | null | undefined,
  expected: number | null | undefined,
  tolerance = 0.001,
): void {
  if (actual === expected) {
    passed++;
    return;
  }
  if (actual === null && expected !== null) {
    failed++;
    console.error(`  ✗ [${currentScenario}] ${label}: expected ${expected}, got null`);
    return;
  }
  if (expected === null && actual !== null) {
    failed++;
    console.error(`  ✗ [${currentScenario}] ${label}: expected null, got ${actual}`);
    return;
  }
  if (actual == null || expected == null) {
    failed++;
    console.error(`  ✗ [${currentScenario}] ${label}: expected ${expected}, got ${actual}`);
    return;
  }
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
  } else {
    failed++;
    console.error(
      `  ✗ [${currentScenario}] ${label}: expected ${expected}, got ${actual} (diff ${diff})`,
    );
  }
}

/* ── Shared helpers ───────────────────────────────────────────────────── */

function makeExec(action: string, qty: number, price: number, fees = 0, date?: string): ExecutionData {
  return {
    action,
    quantity: qty,
    price,
    fees: fees || null,
    executedAt: date ?? '2025-06-01T10:00:00.000Z',
  };
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  SCENARIO 1: Long winner                                                */
/*  A long trade that buys 100 shares at $50, sells at $60.                */
/*  P&L = (60 - 50) * 100 - fees. R-multiple with initialRisk $200.        */
/* ════════════════════════════════════════════════════════════════════════ */

scenario('Long winner');

(function testLongWinner() {
  const dir: Direction = 'long';
  const entries: ExecutionData[] = [
    makeExec('buy', 100, 50, 5, '2025-06-01T10:00:00Z'),
  ];
  const exits: ExecutionData[] = [
    makeExec('sell', 100, 60, 5, '2025-06-05T14:00:00Z'),
  ];
  const allExecs = [...entries, ...exits];

  // trade-calc: P&L derivation
  const pnlResult = calculatePnL(allExecs, dir);
  assertClose('  P&L: avgEntryPrice', pnlResult.avgEntryPrice, 50);
  assertClose('  P&L: totalRealizedPnL', pnlResult.totalRealizedPnL, 1000 - 10); // $1000 - $10 fees
  assert('  P&L: openQuantity === 0', pnlResult.openQuantity === 0);
  assert('  P&L: totalEntryQty === 100', pnlResult.totalEntryQty === 100);
  assert('  P&L: totalExitQty === 100', pnlResult.totalExitQty === 100);

  // trade-calc: status derivation
  const status = deriveTradeStatus(allExecs, dir);
  assert('  Status: closed', status.status === 'closed');
  assert('  Status: openedAt set', status.openedAt !== null);
  assert('  Status: closedAt set', status.closedAt !== null);
  assert('  Status: openQuantity === 0', status.openQuantity === 0);

  // trade-calc: R-multiple with initialRiskAmount = $200
  const rMult = calculateRMultiple(pnlResult.totalRealizedPnL, 200);
  assertClose('  R-multiple', rMult.rMultiple, 990 / 200); // 4.95
  assert('  R-multiple: initialRiskUsed', rMult.initialRiskUsed === true);

  // metrics: win rate classification
  const winRate = computeWinRate([pnlResult.totalRealizedPnL], 'includeZeroAsLoss');
  assertClose('  Win rate (includeZeroAsLoss)', winRate, 1.0);
  const winRateExcl = computeWinRate([pnlResult.totalRealizedPnL], 'excludeScratches');
  assertClose('  Win rate (excludeScratches)', winRateExcl, 1.0);

  // metrics: average R-multiple
  const avgR = averageRMultiples([rMult.rMultiple!]);
  assertClose('  Avg R-multiple', avgR, 4.95);

  // risk-snapshot: risk snapshot values at trade open
  const riskValues = computeRiskSnapshotValues({
    avgEntryPrice: 50,
    initialQuantity: 100,
    initialStopPrice: 48,
    direction: 'long',
    accountEquityAtOpen: 10000,
  });
  assertClose('  Risk: riskPerShare', riskValues.riskPerShare, 2);
  assertClose('  Risk: initialRiskAmount', riskValues.initialRiskAmount, 200);
  assertClose('  Risk: accountRiskPct', riskValues.accountRiskPct, 2.0);
  assert('  Risk: initialEntryPrice === 50', riskValues.initialEntryPrice === 50);
  assert('  Risk: initialQuantity === 100', riskValues.initialQuantity === 100);
  assert('  Risk: initialStopPrice === 48', riskValues.initialStopPrice === 48);

  // risk-snapshot: deriveInitialRiskAmount (stored value exists)
  const derivedRisk = deriveInitialRiskAmount({
    initialRiskAmount: 200,
    initialEntryPrice: 50,
    initialStopPrice: 48,
    initialQuantity: 100,
  });
  assertClose('  Derived risk amount (stored)', derivedRisk, 200);

  // position-sizing: plan-trade risk/reward preview
  const preview = calculatePlanRiskRewardPreview({
    entryPrice: 50,
    direction: 'long',
    stopPrice: 48,
    targetPrice: 60,
    quantity: 100,
  });
  assertClose('  Preview: riskPct', preview.riskPct, 4.0); // (50-48)/50*100 = 4%
  assertClose('  Preview: riskDollar', preview.riskDollar, 200);
  assertClose('  Preview: rewardPct', preview.rewardPct, 20.0); // (60-50)/50*100 = 20%
  assertClose('  Preview: rewardDollar', preview.rewardDollar, 1000);
  assertClose('  Preview: riskRewardRatio', preview.riskRewardRatio, 5.0); // 20/4 = 5

  // position-sizing: full position sizing
  const sizingResult = calculatePositionSize({
    accountEquity: 10000,
    riskPerTradePct: 2,
    entryPrice: 50,
    stopPrice: 48,
    direction: 'long',
    targetPrice: 60,
  });
  assertClose('  Sizing: riskPerShare', sizingResult.riskPerShare, 2);
  assertClose('  Sizing: positionSize', sizingResult.positionSize, 100); // $200 / $2
  assertClose('  Sizing: riskAmount', sizingResult.riskAmount, 200);
  assertClose('  Sizing: rewardRiskRatio', sizingResult.rewardRiskRatio, 5);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  SCENARIO 2: Short winner                                                */
/*  A short trade that sells 200 shares at $80 (sell_short), covers at $70. */
/*  P&L for short: (entry - exit) * quantity - fees.                       */
/* ════════════════════════════════════════════════════════════════════════ */

scenario('Short winner');

(function testShortWinner() {
  const dir: Direction = 'short';
  const entries: ExecutionData[] = [
    makeExec('sell_short', 200, 80, 8, '2025-06-10T09:30:00Z'),
  ];
  const exits: ExecutionData[] = [
    makeExec('buy_to_cover', 200, 70, 8, '2025-06-12T11:00:00Z'),
  ];
  const allExecs = [...entries, ...exits];

  // trade-calc: P&L for short (entryPrice=80, exitPrice=70, qty=200)
  // short P&L = (80 - 70) * 200 - fees = 2000 - 16 = 1984
  const pnlResult = calculatePnL(allExecs, dir);
  assertClose('  P&L: avgEntryPrice', pnlResult.avgEntryPrice, 80);
  assertClose('  P&L: totalRealizedPnL', pnlResult.totalRealizedPnL, 2000 - 16);
  assert('  P&L: openQuantity === 0', pnlResult.openQuantity === 0);

  // trade-calc: status for short
  const status = deriveTradeStatus(allExecs, dir);
  assert('  Status: closed', status.status === 'closed');
  assert('  Status: openQuantity === 0', status.openQuantity === 0);

  // trade-calc: R-multiple with initialRisk = $500 (stop at $82.50)
  // risk = |80 - 82.50| * 200 = 500
  const rMult = calculateRMultiple(pnlResult.totalRealizedPnL, 500);
  assertClose('  R-multiple', rMult.rMultiple, 1984 / 500);

  // metrics: win rate classification
  const winRate = computeWinRate([pnlResult.totalRealizedPnL], 'allDecisions');
  assertClose('  Win rate (allDecisions)', winRate, 1.0);

  // risk-snapshot: risk snapshot values for short trade
  const riskValues = computeRiskSnapshotValues({
    avgEntryPrice: 80,
    initialQuantity: 200,
    initialStopPrice: 82.50,
    direction: 'short',
    accountEquityAtOpen: 25000,
  });
  // Short: riskPerShare = |80 - 82.50| = 2.50
  assertClose('  Risk: riskPerShare', riskValues.riskPerShare, 2.50);
  assertClose('  Risk: initialRiskAmount', riskValues.initialRiskAmount, 500);
  assertClose('  Risk: accountRiskPct', riskValues.accountRiskPct, 2.0); // 500/25000*100 = 2%

  // position-sizing: plan-trade risk/reward for short
  const preview = calculatePlanRiskRewardPreview({
    entryPrice: 80,
    direction: 'short',
    stopPrice: 82.50,
    targetPrice: 70,
    quantity: 200,
  });
  assertClose('  Preview: riskPct', preview.riskPct, 3.125); // (82.50-80)/80*100 = 3.125%
  assertClose('  Preview: riskDollar', preview.riskDollar, 500);
  assertClose('  Preview: rewardPct', preview.rewardPct, 12.5); // (80-70)/80*100 = 12.5%
  assertClose('  Preview: rewardDollar', preview.rewardDollar, 2000);
  assertClose('  Preview: riskRewardRatio', preview.riskRewardRatio, 4.0); // 12.5/3.125 = 4
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  SCENARIO 3: Scratch with fees                                          */
/*  A trade with a tiny gross profit that is entirely consumed by fees.    */
/*  Tests breakeven handling across libraries.                             */
/* ════════════════════════════════════════════════════════════════════════ */

scenario('Scratch with fees');

(function testScratchWithFees() {
  const dir: Direction = 'long';
  const entries: ExecutionData[] = [
    makeExec('buy', 50, 40, 10, '2025-06-15T09:00:00Z'),
  ];
  const exits: ExecutionData[] = [
    makeExec('sell', 50, 40.10, 5, '2025-06-15T15:00:00Z'),
  ];
  const allExecs = [...entries, ...exits];

  // Gross P&L = (40.10 - 40) * 50 = $5.00
  // Total fees = 10 + 5 = $15
  // Net P&L = 5 - 15 = -$10
  const pnlResult = calculatePnL(allExecs, dir);
  assertClose('  P&L: avgEntryPrice', pnlResult.avgEntryPrice, 40);
  assertClose('  P&L: totalRealizedPnL', pnlResult.totalRealizedPnL, -10);
  assert('  P&L: openQuantity === 0', pnlResult.openQuantity === 0);

  // metrics: win rate classification
  // includeZeroAsLoss: P&L <= 0 → loss
  const wrLoss = computeWinRate([pnlResult.totalRealizedPnL], 'includeZeroAsLoss');
  assertClose('  Win rate (includeZeroAsLoss)', wrLoss, 0);
  // excludeScratches: P&L < 0 → loss
  const wrExcl = computeWinRate([pnlResult.totalRealizedPnL], 'excludeScratches');
  assertClose('  Win rate (excludeScratches)', wrExcl, 0);
  // allDecisions: P&L <= 0 → loss
  const wrAll = computeWinRate([pnlResult.totalRealizedPnL], 'allDecisions');
  assertClose('  Win rate (allDecisions)', wrAll, 0);

  // R-multiple: initialRisk = $0 (no real risk — small move)
  const rMultNull = calculateRMultiple(pnlResult.totalRealizedPnL, 0);
  assert('  R-multiple: null with zero risk', rMultNull.rMultiple === null);
  assert('  R-multiple: initialRiskUsed === false', rMultNull.initialRiskUsed === false);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  SCENARIO 4: Missing risk snapshot                                      */
/*  A closed trade with executions but NO risk snapshot record.            */
/*  Tests that account-summary KPI computation handles missing snapshots.  */
/* ════════════════════════════════════════════════════════════════════════ */

scenario('Missing risk snapshot');

(function testMissingRiskSnapshot() {
  const dir: Direction = 'long';
  const allExecs: ExecutionData[] = [
    makeExec('buy', 100, 25, 3, '2025-06-20T10:00:00Z'),
    makeExec('sell', 100, 30, 3, '2025-06-22T12:00:00Z'),
  ];

  // trade-calc: P&L (gross = $500, fees = $6, net = $494)
  const pnlResult = calculatePnL(allExecs, dir);
  assertClose('  P&L: totalRealizedPnL', pnlResult.totalRealizedPnL, 500 - 6);

  // risk-snapshot: deriveInitialRiskAmount with null values (no snapshot)
  // When all fields are null → returns null (cannot derive)
  const derived = deriveInitialRiskAmount({
    initialRiskAmount: null,
    initialEntryPrice: null,
    initialStopPrice: null,
    initialQuantity: null,
  });
  assert('  Derive risk: null when all null', derived === null);

  // When stored initialRiskAmount is null but raw fields exist → derives from raw
  const derivedFromRaw = deriveInitialRiskAmount({
    initialRiskAmount: null,
    initialEntryPrice: 25,
    initialStopPrice: 23,
    initialQuantity: 100,
  });
  assertClose('  Derive risk: from raw fields', derivedFromRaw, 200); // |25-23|*100 = 200

  // R-multiple with null initialRiskAmount → null
  const rMultNull = calculateRMultiple(pnlResult.totalRealizedPnL, null);
  assert('  R-multiple: null when risk null', rMultNull.rMultiple === null);
  assert('  R-multiple: initialRiskUsed === false', rMultNull.initialRiskUsed === false);

  // account-summary: KPI with missing risk snapshot
  const tradeId = 'trade-missing-rs-01';
  const closedTrades: ClosedTradeData[] = [{ id: tradeId, direction: 'long', createdAt: '2025-06-20T10:00:00Z' }];
  const execMap = new Map<string, ExecutionData[]>();
  execMap.set(tradeId, allExecs);
  const riskSnapshots: RiskSnapshotData[] = []; // empty — no snapshot for this trade
  const grades: GradeData[] = [{ tradeId, totalScore: 85 }];

  const kpis = computeAccountKPIs(closedTrades, execMap, riskSnapshots, grades);
  assert('  KPI: tradeCount === 1', kpis.tradeCount === 1);
  assertClose('  KPI: netPnl', kpis.netPnl, 494);
  assertClose('  KPI: avgGrade', kpis.avgGrade, 85);
  // No risk snapshots → avgR should be null
  assert('  KPI: avgR is null when missing risk snapshots', kpis.avgR === null);

  // metrics: average R-multiples with empty array → null
  const avgR = averageRMultiples([]);
  assert('  Avg R: null with empty array', avgR === null);

  // metrics: average process score
  const avgScore = averageProcessScore([85]);
  assertClose('  Avg score', avgScore, 85);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  SCENARIO 5: Null initialRiskAmount                                     */
/*  A trade with a risk snapshot record where initialRiskAmount is null.   */
/*  The raw fields (entryPrice, stopPrice, quantity) are available.        */
/*  Tests that deriveInitialRiskAmount falls back to raw computation.      */
/* ════════════════════════════════════════════════════════════════════════ */

scenario('Null initialRiskAmount');

(function testNullInitialRiskAmount() {
  const dir: Direction = 'long';
  const allExecs: ExecutionData[] = [
    makeExec('buy', 50, 100, 5, '2025-07-01T10:00:00Z'),
    makeExec('sell', 50, 110, 5, '2025-07-03T14:00:00Z'),
  ];

  // P&L (gross = $500, fees = $10, net = $490)
  const pnlResult = calculatePnL(allExecs, dir);
  assertClose('  P&L: totalRealizedPnL', pnlResult.totalRealizedPnL, 490);

  // risk-snapshot: null stored, but raw fields available
  const derived = deriveInitialRiskAmount({
    initialRiskAmount: null,
    initialEntryPrice: 100,
    initialStopPrice: 98,
    initialQuantity: 50,
  });
  assertClose('  Derive risk: from raw fields', derived, 100); // |100-98|*50 = 100

  // R-multiple using the derived risk
  const rMult = calculateRMultiple(490, 100);
  assertClose('  R-multiple: using derived risk', rMult.rMultiple, 4.9);
  assert('  R-multiple: initialRiskUsed === true', rMult.initialRiskUsed === true);

  // risk-snapshot: when initialRiskAmount is non-null, that value is used directly
  const derivedStored = deriveInitialRiskAmount({
    initialRiskAmount: 250,  // stored (computed) value
    initialEntryPrice: 100,
    initialStopPrice: 98,
    initialQuantity: 50,
  });
  assertClose('  Derive risk: stored value used', derivedStored, 250);

  // account-summary KPI with this trade
  const tradeId = 'trade-null-risk-01';
  const closedTrades: ClosedTradeData[] = [
    { id: tradeId, direction: 'long', createdAt: '2025-07-01T10:00:00Z' },
  ];
  const execMap = new Map<string, ExecutionData[]>();
  execMap.set(tradeId, allExecs);
  const riskSnapshots: RiskSnapshotData[] = [
    { tradeId, initialRiskAmount: null },  // null stored, but raw would give 100
  ];
  const grades: GradeData[] = [{ tradeId, totalScore: 75 }];

  const kpis = computeAccountKPIs(closedTrades, execMap, riskSnapshots, grades);
  assert('  KPI: tradeCount === 1', kpis.tradeCount === 1);
  assertClose('  KPI: netPnl', kpis.netPnl, 490);
  // avgR: risk snapshot has initialRiskAmount=null, so R-multiple can't be computed
  assert('  KPI: avgR is null', kpis.avgR === null);
  assertClose('  KPI: avgGrade', kpis.avgGrade, 75);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  SCENARIO 6: Account lifecycle — starting balance + deposits +          */
/*  withdrawals + realized P&L                                              */
/*  Tests the full account rollforward across risk-snapshot, account-       */
/*  summary, and multiple closed trades.                                   */
/* ════════════════════════════════════════════════════════════════════════ */

scenario('Account lifecycle');

(function testAccountLifecycle() {
  // Account: $10,000 starting balance, $2,000 deposit, $500 withdrawal
  const startingBalance = 10000;
  const deposits = [{ type: 'deposit', amount: 2000, date: '2025-05-01T00:00:00Z' }] as const;
  const withdrawals = [{ type: 'withdrawal', amount: 500, date: '2025-06-01T00:00:00Z' }] as const;
  const transactions = [...deposits, ...withdrawals];

  // Two closed trades
  const tradeAExecs: ExecutionData[] = [
    makeExec('buy', 100, 50, 10, '2025-06-10T10:00:00Z'),
    makeExec('sell', 100, 60, 10, '2025-06-15T14:00:00Z'),
  ]; // net P&L = 1000 - 20 = 980

  const tradeBExecs: ExecutionData[] = [
    makeExec('sell_short', 50, 200, 5, '2025-06-20T10:00:00Z'),
    makeExec('buy_to_cover', 50, 210, 5, '2025-06-25T12:00:00Z'),
  ]; // short loss: (200-210)*50 - 10 = -510

  // Compute per-trade P&L via trade-calc
  const pnlA = calculatePnL(tradeAExecs, 'long');
  const pnlB = calculatePnL(tradeBExecs, 'short');

  assertClose('  Trade A P&L (long winner)', pnlA.totalRealizedPnL, 980);
  assertClose('  Trade B P&L (short loser)', pnlB.totalRealizedPnL, -510);

  // risk-snapshot: computeRealizedPnLFromClosedTrades (aggregation)
  const priorTrades = [
    { direction: 'long' as Direction, executions: tradeAExecs },
    { direction: 'short' as Direction, executions: tradeBExecs },
  ];
  const aggregatedPnL = computeRealizedPnLFromClosedTrades(priorTrades);
  assertClose('  Aggregated P&L from closed trades', aggregatedPnL, 980 - 510); // 470

  // risk-snapshot: computeEquityAtOpen with full account data
  const equityInput: EquityAtOpenInput = {
    startingBalance: 10000,
    deposits: 2000,
    withdrawals: 500,
    realizedPnL: aggregatedPnL,
    hasNoAccountData: false,
    fallbackValue: null,
  };
  const equity = computeEquityAtOpen(equityInput);
  assertClose('  Equity at open', equity, 10000 + 2000 - 500 + 470); // 11970

  // account-summary: computeAccountBalance (rollforward)
  const balance = computeAccountBalance(
    startingBalance,
    transactions.map(t => ({ type: t.type, amount: t.amount, date: t.date })),
    aggregatedPnL,
  );
  assertClose('  Balance: currentBalance', balance.currentBalance, 11970);
  assertClose('  Balance: netDeposits', balance.netDeposits, 2000);
  assertClose('  Balance: netWithdrawals', balance.netWithdrawals, 500);
  assertClose('  Balance: realizedPnl', balance.realizedPnl, 470);

  // account-summary: computeDatesActive
  const datesActive = computeDatesActive(
    '2025-04-01T00:00:00Z',
    transactions.map(t => ({ type: t.type, amount: t.amount, date: t.date })),
    '2025-07-01T00:00:00Z',
  );
  assert('  Dates active: from correct', datesActive.from === '2025-04-01T00:00:00.000Z');
  assert('  Dates active: to correct', datesActive.to === '2025-07-01T00:00:00Z');

  // account-summary: computeAccountKPIs with two trades
  const tradeAId = 'trade-lifecycle-A';
  const tradeBId = 'trade-lifecycle-B';
  const closedTrades: ClosedTradeData[] = [
    { id: tradeAId, direction: 'long', createdAt: '2025-06-10T10:00:00Z' },
    { id: tradeBId, direction: 'short', createdAt: '2025-06-20T10:00:00Z' },
  ];
  const execMap = new Map<string, ExecutionData[]>();
  execMap.set(tradeAId, tradeAExecs);
  execMap.set(tradeBId, tradeBExecs);
  const riskSnapshots: RiskSnapshotData[] = [
    { tradeId: tradeAId, initialRiskAmount: 200 },   // |50-48|*100
    { tradeId: tradeBId, initialRiskAmount: 500 },    // |200-210|*50
  ];
  const grades: GradeData[] = [
    { tradeId: tradeAId, totalScore: 90 },
    { tradeId: tradeBId, totalScore: 60 },
  ];

  const kpis = computeAccountKPIs(closedTrades, execMap, riskSnapshots, grades);
  assert('  KPI: tradeCount === 2', kpis.tradeCount === 2);
  assertClose('  KPI: netPnl', kpis.netPnl, 470);
  assertClose('  KPI: winRate', kpis.winRate, 0.5); // 1 win out of 2
  // R-multiples: 980/200=4.9 (win), -510/500=-1.02 (loss) → avg = (4.9 + -1.02) / 2 = 1.94
  assertClose('  KPI: avgR', kpis.avgR, (980 / 200 + (-510 / 500)) / 2, 0.01);
  assertClose('  KPI: avgGrade', kpis.avgGrade, 75); // (90 + 60) / 2
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  SCENARIO 7: Open positions — MTM and unrealized P&L                    */
/*  Trades that are still open, with current market prices for MTM.        */
/*  Tests mark-to-market and cross-library consistency.                    */
/* ════════════════════════════════════════════════════════════════════════ */

scenario('Open positions');

(function testOpenPositions() {
  const dir: Direction = 'long';

  // Open long trade: bought 150 shares at $75, current price $82
  const openTradeExecs: ExecutionData[] = [
    makeExec('buy', 150, 75, 15, '2025-07-05T10:00:00Z'),
  ];

  // trade-calc: P&L for open trade (no exits yet) — should show openQuantity > 0
  const pnlResult = calculatePnL(openTradeExecs, dir);
  assert('  P&L: openQuantity === 150', pnlResult.openQuantity === 150);
  assertClose('  P&L: avgEntryPrice', pnlResult.avgEntryPrice, 75);
  assert('  P&L: totalRealizedPnL === -$15 (fees)', Math.abs(pnlResult.totalRealizedPnL - (-15)) < 0.001);

  // trade-calc: status derivation
  const status = deriveTradeStatus(openTradeExecs, dir);
  assert('  Status: open', status.status === 'open');
  assert('  Status: openQuantity === 150', status.openQuantity === 150);

  // mark-to-market: computeOpenPosition
  const openPos = computeOpenPosition(openTradeExecs, dir);
  assertClose('  MTM: avgEntryPrice', openPos.avgEntryPrice, 75);
  assert('  MTM: openQuantity === 150', openPos.openQuantity === 150);

  // mark-to-market: calculateUnrealizedPnL with feePolicy=include_entry_fees
  const unrealizedWithFees = calculateUnrealizedPnL({
    executions: openTradeExecs,
    direction: 'long',
    currentPrice: 82,
    feePolicy: 'include_entry_fees',
  });
  // Gross: (82-75)*150 = 1050, minus entry fees $15 = 1035
  assertClose('  MTM: unrealizedP&L (include fees)', unrealizedWithFees, 1050 - 15);

  // mark-to-market: calculateUnrealizedPnL with feePolicy=exclude_entry_fees
  const unrealizedNoFees = calculateUnrealizedPnL({
    executions: openTradeExecs,
    direction: 'long',
    currentPrice: 82,
    feePolicy: 'exclude_entry_fees',
  });
  // Gross: (82-75)*150 = 1050, no fee subtraction
  assertClose('  MTM: unrealizedP&L (exclude fees)', unrealizedNoFees, 1050);
  // The two policies must differ by entry fees
  assertClose('  MTM: fee policy difference equals entry fees', unrealizedWithFees! - unrealizedNoFees!, -15);

  // mark-to-market: computeMarkToMarketSummary with multiple open trades
  const summary = computeMarkToMarketSummary(
    [
      { executions: openTradeExecs, direction: 'long', currentPrice: 82 },
      // Second open trade: short 100 shares at $200, current price $195
      {
        executions: [
          makeExec('sell_short', 100, 200, 10, '2025-07-06T10:00:00Z'),
        ],
        direction: 'short',
        currentPrice: 195,
      },
      // Third trade: no current price (awaiting data)
      {
        executions: [
          makeExec('buy', 50, 120, 5, '2025-07-07T10:00:00Z'),
        ],
        direction: 'long',
        currentPrice: null,
      },
    ],
    'include_entry_fees',
  );
  // Long: (82-75)*150 - 15 = 1035
  // Short: (200-195)*100 - 10 = 490
  // Total: 1035 + 490 = 1525
  assertClose('  MTM: netUnrealizedPnl', summary.netUnrealizedPnl, 1035 + 490, 0.01);
  assert('  MTM: tradesWithPrices === 2', summary.tradesWithPrices === 2);
  assert('  MTM: tradesAwaitingData === 1', summary.tradesAwaitingData === 1);
  assert('  MTM: openTradeCount === 3', summary.openTradeCount === 3);

  // Empty open trades → null net
  const emptySummary = computeMarkToMarketSummary([], 'include_entry_fees');
  assert('  MTM: empty summary has null net', emptySummary.netUnrealizedPnl === null);
  assert('  MTM: empty summary has 0 trades', emptySummary.openTradeCount === 0);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  CROSS-LIBRARY CONSISTENCY CHECKS                                       */
/*  Verify that metrics from one library align with results from another.  */
/* ════════════════════════════════════════════════════════════════════════ */

scenario('Cross-library consistency');

(function testCrossLibraryConsistency() {
  // Take the two trades from Scenario 6 (account lifecycle)
  // Trade A: long, 980 P&L, risk $200 → R=4.9
  // Trade B: short, -510 P&L, risk $500 → R=-1.02

  // 1. Position sizing should match risk-snapshot riskPerShare
  const sizingResult = calculatePositionSize({
    accountEquity: 10000,
    riskPerTradePct: 2,
    entryPrice: 50,
    stopPrice: 48,
    direction: 'long',
  });
  assertClose('  Sizing riskPerShare == Risk-snapshot riskPerShare', sizingResult.riskPerShare, 2);

  // 2. computeRiskSnapshotValues should produce same riskPerShare as position-sizing
  const riskValues = computeRiskSnapshotValues({
    avgEntryPrice: 50,
    initialQuantity: 100,
    initialStopPrice: 48,
    direction: 'long',
    accountEquityAtOpen: 10000,
  });
  assertClose('  Risk riskPerShare == Sizing riskPerShare', riskValues.riskPerShare, sizingResult.riskPerShare);

  // 3. account-risk-pct from risk-snapshot should match position-sizing risk-pct
  assertClose('  accountRiskPct == riskPerTradePct', riskValues.accountRiskPct, 2);

  // 4. Multiple P&L values → metrics computeWinRate → account-summary winRate consistency
  const pnls = [980, -510];
  const wrInclude = computeWinRate(pnls, 'includeZeroAsLoss');
  assertClose('  Win rate 1/2 = 0.5', wrInclude, 0.5);

  const wrExcl = computeWinRate(pnls, 'excludeScratches');
  assertClose('  Win rate (exclude) 1/2 = 0.5', wrExcl, 0.5);

  // 5. R-multiple of 0 from scratch trade
  const rMult = calculateRMultiple(-5, 100);
  assert('  R-multiple negative on loss', rMult.rMultiple! < 0);

  // 6. computeAccountBalance should match risk-snapshot equity computation
  // Both add startingBalance + deposits - withdrawals + realizedPnL
  const balance = computeAccountBalance(
    10000,
    [{ type: 'deposit', amount: 2000, date: '2025-05-01T00:00:00Z' }],
    470,
  );
  assertClose('  Balance == equity rollforward', balance.currentBalance, 10000 + 2000 + 470);

  // 7. computeRiskSnapshotValues with null stop → null riskPerShare
  const noStop = computeRiskSnapshotValues({
    avgEntryPrice: 50,
    initialQuantity: 100,
    initialStopPrice: null,
    direction: 'long',
    accountEquityAtOpen: 5000,
  });
  assert('  No stop: riskPerShare === null', noStop.riskPerShare === null);
  assert('  No stop: initialRiskAmount === null', noStop.initialRiskAmount === null);
  assert('  No stop: accountRiskPct === null', noStop.accountRiskPct === null);

  // 8. deriveInitialRiskAmount with all null
  const allNull = deriveInitialRiskAmount({
    initialRiskAmount: null,
    initialEntryPrice: null,
    initialStopPrice: null,
    initialQuantity: null,
  });
  assert('  All null: derives to null', allNull === null);

  // 9. deriveInitialRiskAmount with only 2 of 3 raw fields → null
  const partial = deriveInitialRiskAmount({
    initialRiskAmount: null,
    initialEntryPrice: 50,
    initialStopPrice: null,
    initialQuantity: 100,
  });
  assert('  Partial raw: null', partial === null);

  // 10. computeEquityAtOpen with no account data and fallback
  const fallbackEquity = computeEquityAtOpen({
    startingBalance: 0,
    deposits: 0,
    withdrawals: 0,
    realizedPnL: 0,
    hasNoAccountData: true,
    fallbackValue: 5000,
  });
  assertClose('  Fallback equity', fallbackEquity, 5000);

  // 11. computeEquityAtOpen with zero effective equity but no fallback
  const nullEquity = computeEquityAtOpen({
    startingBalance: 0,
    deposits: 0,
    withdrawals: 0,
    realizedPnL: 0,
    hasNoAccountData: true,
    fallbackValue: null,
  });
  assert('  Null equity when no fallback', nullEquity === null);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  SUMMARY                                                                */
/* ════════════════════════════════════════════════════════════════════════ */

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  Golden Scenario Integration Test Suite');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Tests passed: ${passed}`);
console.log(`  Tests failed: ${failed}`);
console.log('───────────────────────────────────────────────────────────');

if (failed > 0) {
  console.log('  ❌ SOME SCENARIOS FAILED');
  console.log('───────────────────────────────────────────────────────────');
  process.exit(1);
} else {
  console.log('  ✅ ALL SCENARIOS PASSED');
  console.log('───────────────────────────────────────────────────────────');
  process.exit(0);
}
