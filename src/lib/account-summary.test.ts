/**
 * account-summary.test.ts
 *
 * Comprehensive tests for account-level KPI, balance, and dates-active computation.
 * Covers positive, negative, and edge cases for all three exported functions.
 *
 * Run: npx tsx src/lib/account-summary.test.ts
 */

import {
  computeAccountKPIs,
  computeAccountBalance,
  computeDatesActive,
  type ClosedTradeData,
  type RiskSnapshotData,
  type GradeData,
  type AccountTransactionData,
  type ExecutionData,
} from './account-summary';

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

function assertNotNull(v: unknown, msg: string) {
  if (v !== null) {
    passed++;
    console.log(`  ✅ ${msg} (${v})`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected non-null, got null (FAILED)`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function makeTrade(id: string, direction: 'long' | 'short', createdAt?: string): ClosedTradeData {
  return { id, direction, createdAt: createdAt ?? null };
}

function makeExec(
  action: string,
  quantity: number,
  price: number,
  fees?: number,
  executedAt?: string,
): ExecutionData {
  return { action, quantity, price, fees: fees ?? 0, executedAt: executedAt ?? '2026-01-10T12:00:00Z' };
}

function makeRisk(tradeId: string, initialRiskAmount: number | null): RiskSnapshotData {
  return { tradeId, initialRiskAmount };
}

function makeGrade(tradeId: string, totalScore: number | null): GradeData {
  return { tradeId, totalScore };
}

function makeTx(type: string, amount: number, date?: string): AccountTransactionData {
  return { type, amount, date: date ?? null };
}

function execMap(trades: Record<string, ExecutionData[]>): Map<string, ExecutionData[]> {
  return new Map(Object.entries(trades));
}

// ────────────────────────────────────────────────────────────────────────
// Tests: computeAccountKPIs
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeAccountKPIs');

  // ── Empty / zero cases ──

  // 1. No closed trades → zero KPIs, null derived fields
  {
    const r = computeAccountKPIs([], execMap({}), [], []);
    assert(r.tradeCount === 0, 'empty: tradeCount → 0');
    assert(r.netPnl === 0, 'empty: netPnl → 0');
    assertNull(r.winRate, 'empty: winRate → null');
    assertNull(r.avgR, 'empty: avgR → null');
    assertNull(r.avgGrade, 'empty: avgGrade → null');
  }

  // 2. Trade with no executions → included in tradeCount, excluded from netPnl/winRate
  {
    const trades = [makeTrade('t1', 'long')];
    const r = computeAccountKPIs(trades, execMap({}), [], []);
    assert(r.tradeCount === 1, 'no exec: tradeCount → 1');
    assert(r.netPnl === 0, 'no exec: netPnl → 0');
    assertNull(r.winRate, 'no exec: winRate → null (no decisions)');
    assertNull(r.avgR, 'no exec: avgR → null');
    assertNull(r.avgGrade, 'no exec: avgGrade → null');
  }

  // ── P&L and win rate (no risk/grade data) ──

  // 3. Single winning long trade: buy 100 @ 50, sell 100 @ 60
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 50), makeExec('sell', 100, 60)],
    };
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    assert(r.tradeCount === 1, 'winning long: tradeCount → 1');
    assertApprox(r.netPnl, 1000, 'winning long: netPnl → 1000');
    assert(r.winRate === 1, 'winning long: winRate → 1');
    assertNull(r.avgR, 'winning long: no risk data → avgR null');
    assertNull(r.avgGrade, 'winning long: no grades → avgGrade null');
  }

  // 4. Single losing long trade: buy 100 @ 60, sell 100 @ 50
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 60), makeExec('sell', 100, 50)],
    };
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    assert(r.tradeCount === 1, 'losing long: tradeCount → 1');
    assertApprox(r.netPnl, -1000, 'losing long: netPnl → -1000');
    assert(r.winRate === 0, 'losing long: winRate → 0');
  }

  // 5. Multiple trades: mix of winners and losers
  {
    const trades = [makeTrade('t1', 'long'), makeTrade('t2', 'long'), makeTrade('t3', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 50), makeExec('sell', 100, 60)],   // +1000
      t2: [makeExec('buy', 100, 80), makeExec('sell', 100, 90)],   // +1000
      t3: [makeExec('buy', 50, 100), makeExec('sell', 50, 40)],    // -3000
    };
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    assert(r.tradeCount === 3, 'mixed trades: tradeCount → 3');
    assertApprox(r.netPnl, -1000, 'mixed trades: netPnl → -1000');
    assertApprox(r.winRate!, 2 / 3, 'mixed trades: winRate → 2/3');
  }

  // 6. Short trade: sell_short 100 @ 100, buy_to_cover 100 @ 80 → profit
  {
    const trades = [makeTrade('t1', 'short')];
    const execs = {
      t1: [makeExec('sell_short', 100, 100), makeExec('buy_to_cover', 100, 80)],
    };
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    assert(r.tradeCount === 1, 'winning short: tradeCount → 1');
    assertApprox(r.netPnl, 2000, 'winning short: netPnl → 2000');
    assert(r.winRate === 1, 'winning short: winRate → 1');
  }

  // 7. Losing short trade: sell_short 100 @ 100, buy_to_cover 100 @ 120 → loss
  {
    const trades = [makeTrade('t1', 'short')];
    const execs = {
      t1: [makeExec('sell_short', 100, 100), makeExec('buy_to_cover', 100, 120)],
    };
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    assertApprox(r.netPnl, -2000, 'losing short: netPnl → -2000');
    assert(r.winRate === 0, 'losing short: winRate → 0');
  }

  // ── R-multiple tests ──

  // 8. Single trade with risk snapshot: R-multiple computed
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 50), makeExec('sell', 100, 60)],
    };
    // P&L = 1000, initialRiskAmount = 500 → R = 2.0
    const risks = [makeRisk('t1', 500)];
    const r = computeAccountKPIs(trades, execMap(execs), risks, []);
    assertNotNull(r.avgR, 'with risk: avgR is not null');
    assertApprox(r.avgR!, 2.0, 'with risk: avgR → 2.0');
  }

  // 9. Risk snapshot with zero initialRiskAmount → R excluded (not > 0)
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 50), makeExec('sell', 100, 60)],
    };
    const risks = [makeRisk('t1', 0)];
    const r = computeAccountKPIs(trades, execMap(execs), risks, []);
    assertNull(r.avgR, 'zero risk amount: avgR → null');
  }

  // 10. Risk snapshot with null initialRiskAmount → R excluded
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 50), makeExec('sell', 100, 60)],
    };
    const risks = [makeRisk('t1', null)];
    const r = computeAccountKPIs(trades, execMap(execs), risks, []);
    assertNull(r.avgR, 'null risk amount: avgR → null');
  }

  // 11. Multiple trades, some with risk snapshots, average R computed
  {
    const trades = [makeTrade('t1', 'long'), makeTrade('t2', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 50), makeExec('sell', 100, 60)],   // P&L = 1000
      t2: [makeExec('buy', 200, 100), makeExec('sell', 200, 110)], // P&L = 2000
    };
    // t1: riskAmount = 500 → R = 2.0
    // t2: riskAmount = 1000 → R = 2.0
    // avgR = 2.0
    const risks = [makeRisk('t1', 500), makeRisk('t2', 1000)];
    const r = computeAccountKPIs(trades, execMap(execs), risks, []);
    assertApprox(r.avgR!, 2.0, 'multiple risks: avgR → 2.0');
  }

  // 12. Trade with loss and risk snapshot → negative R-multiple
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 100), makeExec('sell', 100, 80)], // P&L = -2000
    };
    const risks = [makeRisk('t1', 500)];
    const r = computeAccountKPIs(trades, execMap(execs), risks, []);
    assertApprox(r.avgR!, -4.0, 'loss with risk: avgR → -4.0');
  }

  // ── Grade tests ──

  // 13. Single trade with grade
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 10, 100), makeExec('sell', 10, 110)],
    };
    const grades = [makeGrade('t1', 85)];
    const r = computeAccountKPIs(trades, execMap(execs), [], grades);
    assert(r.avgGrade === 85, 'single grade: avgGrade → 85');
  }

  // 14. Multiple trades with grades → average
  {
    const trades = [makeTrade('t1', 'long'), makeTrade('t2', 'long')];
    const execs = {
      t1: [makeExec('buy', 10, 100), makeExec('sell', 10, 110)],
      t2: [makeExec('buy', 10, 50), makeExec('sell', 10, 60)],
    };
    const grades = [makeGrade('t1', 90), makeGrade('t2', 70)];
    const r = computeAccountKPIs(trades, execMap(execs), [], grades);
    assert(r.avgGrade === 80, 'multiple grades: avgGrade → 80');
  }

  // 15. Null totalScore in grade → excluded from average
  {
    const trades = [makeTrade('t1', 'long'), makeTrade('t2', 'long')];
    const execs = {
      t1: [makeExec('buy', 10, 100), makeExec('sell', 10, 110)],
      t2: [makeExec('buy', 10, 50), makeExec('sell', 10, 60)],
    };
    const grades = [makeGrade('t1', 90), makeGrade('t2', null)];
    const r = computeAccountKPIs(trades, execMap(execs), [], grades);
    assert(r.avgGrade === 90, 'null grade excluded: avgGrade → 90');
  }

  // ── Aggregate (all features) ──

  // 16. Full set: trades + execs + risks + grades
  {
    const trades = [
      makeTrade('t1', 'long', '2026-01-10T09:00:00Z'),
      makeTrade('t2', 'short', '2026-01-11T09:00:00Z'),
    ];
    const execs = {
      t1: [makeExec('buy', 100, 50), makeExec('sell', 100, 60)],
      t2: [makeExec('sell_short', 50, 80), makeExec('buy_to_cover', 50, 70)],
    };
    // t1: P&L = 1000, risk 200 → R=5, grade=80, winner
    // t2: P&L = 500, risk 250 → R=2, grade=60, winner
    // netPnl = 1500, winRate = 2/2 = 1, avgR = 3.5, avgGrade = 70
    const risks = [makeRisk('t1', 200), makeRisk('t2', 250)];
    const grades = [makeGrade('t1', 80), makeGrade('t2', 60)];
    const r = computeAccountKPIs(trades, execMap(execs), risks, grades);
    assert(r.tradeCount === 2, 'full set: tradeCount → 2');
    assertApprox(r.netPnl, 1500, 'full set: netPnl → 1500');
    assert(r.winRate === 1, 'full set: winRate → 1');
    assertApprox(r.avgR!, 3.5, 'full set: avgR → 3.5');
    assert(r.avgGrade === 70, 'full set: avgGrade → 70');
  }

  // ── Edge cases ──

  // 17. Fees deducted from P&L
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 50, 10), makeExec('sell', 100, 60, 10)],
    };
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    // Gross: (60-50)*100 = 1000, fees: 20, net: 980
    assertApprox(r.netPnl, 980, 'fees deducted: netPnl → 980');
  }

  // 18. Trade with no executions mixed with trades that have executions
  {
    const trades = [makeTrade('t1', 'long'), makeTrade('t2', 'long'), makeTrade('t3', 'long')];
    const execs = {
      t1: [makeExec('buy', 10, 100), makeExec('sell', 10, 110)],  // +100
      t3: [makeExec('buy', 10, 50), makeExec('sell', 10, 60)],    // +100
    };
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    assert(r.tradeCount === 3, 'mixed exec presence: tradeCount → 3');
    assertApprox(r.netPnl, 200, 'mixed exec presence: netPnl → 200');
    assert(r.winRate === 1, 'mixed exec presence: winRate → 1');
  }

  // 19. Partial fills / multiple entries and exits per trade
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [
        makeExec('buy', 50, 40),
        makeExec('buy', 50, 60),
        makeExec('sell', 30, 55),
        makeExec('sell', 70, 65),
      ],
    };
    // Avg entry = (50*40 + 50*60) / 100 = 50
    // Sell 30 @ 55 PnL = (55-50)*30 = 150
    // Sell 70 @ 65 PnL = (65-50)*70 = 1050
    // Total = 1200
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    assertApprox(r.netPnl, 1200, 'partial fills: netPnl → 1200');
  }

  // 20. Breakeven trade (P&L = 0) → winRate counts it as not a win
  {
    const trades = [makeTrade('t1', 'long')];
    const execs = {
      t1: [makeExec('buy', 100, 50), makeExec('sell', 100, 50)],
    };
    const r = computeAccountKPIs(trades, execMap(execs), [], []);
    assert(r.netPnl === 0, 'breakeven: netPnl → 0');
    assert(r.winRate === 0, 'breakeven: winRate → 0');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: computeAccountBalance
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeAccountBalance');

  // ── Positive tests ──

  // 1. Starting balance only, no transactions, no P&L
  {
    const r = computeAccountBalance(10000, [], 0);
    assert(r.currentBalance === 10000, 'starting balance only → 10000');
    assert(r.netDeposits === 0, 'no deposits → 0');
    assert(r.netWithdrawals === 0, 'no withdrawals → 0');
    assert(r.realizedPnl === 0, 'no P&L → 0');
  }

  // 2. Starting balance + deposits
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 5000),
      makeTx('deposit', 3000),
    ];
    const r = computeAccountBalance(10000, txs, 0);
    assert(r.currentBalance === 18000, 'balance + deposits → 18000');
    assert(r.netDeposits === 8000, 'net deposits → 8000');
  }

  // 3. Starting balance + deposits + withdrawals
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 10000),
      makeTx('withdrawal', 4000),
      makeTx('withdrawal', 1000),
    ];
    const r = computeAccountBalance(50000, txs, 0);
    assert(r.currentBalance === 55000, 'balance + deposits - withdrawals → 55000');
    assert(r.netDeposits === 10000, 'net deposits → 10000');
    assert(r.netWithdrawals === 5000, 'net withdrawals → 5000');
  }

  // 4. All components: startingBalance + deposits - withdrawals + realizedPnl
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 20000),
      makeTx('withdrawal', 5000),
    ];
    const r = computeAccountBalance(50000, txs, 10000);
    assert(r.currentBalance === 75000, 'all components: balance + deposits - withdrawals + P&L → 75000');
    assert(r.realizedPnl === 10000, 'realized P&L → 10000');
  }

  // 5. Negative realized P&L (losses)
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 10000),
    ];
    const r = computeAccountBalance(50000, txs, -15000);
    assert(r.currentBalance === 45000, 'negative P&L: 50000 + 10000 - 0 - 15000 → 45000');
  }

  // 6. Only deposits, no withdrawals
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 1000),
      makeTx('deposit', 2000),
      makeTx('deposit', 3000),
    ];
    const r = computeAccountBalance(5000, txs, 0);
    assert(r.currentBalance === 11000, 'multiple deposits: 5000 + 6000 → 11000');
    assert(r.netDeposits === 6000, 'sum deposits → 6000');
    assert(r.netWithdrawals === 0, 'no withdrawals → 0');
  }

  // 7. Only withdrawals, no deposits (margin drawdown)
  {
    const txs: AccountTransactionData[] = [
      makeTx('withdrawal', 5000),
      makeTx('withdrawal', 3000),
    ];
    const r = computeAccountBalance(20000, txs, 0);
    assert(r.currentBalance === 12000, 'withdrawals only: 20000 - 8000 → 12000');
    assert(r.netDeposits === 0, 'no deposits → 0');
    assert(r.netWithdrawals === 8000, 'net withdrawals → 8000');
  }

  // ── Edge cases ──

  // 8. Zero starting balance, all equity from deposits + P&L
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 10000),
    ];
    const r = computeAccountBalance(0, txs, 5000);
    assert(r.currentBalance === 15000, 'zero start: 0 + 10000 + 5000 → 15000');
  }

  // 9. Negative starting balance (theoretically possible from data issues)
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 10000),
    ];
    const r = computeAccountBalance(-5000, txs, 2000);
    assert(r.currentBalance === 7000, 'negative start: -5000 + 10000 + 2000 → 7000');
  }

  // 10. Empty transactions array
  {
    const r = computeAccountBalance(25000, [], 500);
    assert(r.currentBalance === 25500, 'empty txs: 25000 + 500 → 25500');
    assert(r.netDeposits === 0, 'empty txs: netDeposits → 0');
    assert(r.netWithdrawals === 0, 'empty txs: netWithdrawals → 0');
  }

  // 11. Transaction type filtering — only 'deposit' and 'withdrawal' matter
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 5000),
      makeTx('adjustment', 1000),   // should be ignored
      makeTx('deposit', 3000),
      makeTx('fee', 500),            // should be ignored
      makeTx('withdrawal', 2000),
      makeTx('transfer', 1000),      // should be ignored
    ];
    const r = computeAccountBalance(10000, txs, 0);
    assert(r.currentBalance === 16000, 'type filtering: 10000 + 8000 - 2000 → 16000');
    assert(r.netDeposits === 8000, 'type filtering: only deposit types summed');
    assert(r.netWithdrawals === 2000, 'type filtering: only withdrawal types summed');
  }

  // 12. Large numbers to check for overflow / precision
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 1_000_000),
      makeTx('withdrawal', 500_000),
    ];
    const r = computeAccountBalance(2_000_000, txs, 250_000);
    assert(r.currentBalance === 2_750_000, 'large numbers: 2M + 1M - 0.5M + 0.25M → 2.75M');
  }

  // 13. Fractional amounts
  {
    const txs: AccountTransactionData[] = [
      makeTx('deposit', 1000.50),
      makeTx('withdrawal', 250.25),
    ];
    const r = computeAccountBalance(5000, txs, 100.75);
    assertApprox(r.currentBalance, 5851, 'fractional: 5000 + 1000.50 - 250.25 + 100.75 → 5851');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: computeDatesActive
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeDatesActive');

  // ── Positive tests ──

  // 1. Account created today, no transactions, explicit reference date
  {
    const r = computeDatesActive('2026-01-15T10:00:00Z', [], '2026-01-15T18:00:00Z');
    assert(r.from === '2026-01-15T10:00:00Z', 'no txs: from is accountCreatedAt');
    assert(r.to === '2026-01-15T18:00:00Z', 'no txs: to is referenceDate');
  }

  // 2. Account created, one transaction after creation date → from uses earliest
  {
    const txs = [makeTx('deposit', 1000, '2026-01-20T12:00:00.000Z')];
    const r = computeDatesActive('2026-01-15T10:00:00.000Z', txs, '2026-01-25T00:00:00.000Z');
    // accountCreatedAt: Jan 15,  only tx: Jan 20 → earliest is Jan 15
    assert(r.from === '2026-01-15T10:00:00.000Z', 'tx after creation: from is accountCreatedAt');
    assert(r.to === '2026-01-25T00:00:00.000Z', 'to is referenceDate');
  }

  // 3. Transaction before account creation date → from uses transaction date
  {
    const txs = [makeTx('deposit', 1000, '2026-01-10T08:00:00.000Z')];
    const r = computeDatesActive('2026-01-15T10:00:00.000Z', txs, '2026-01-25T00:00:00.000Z');
    // tx: Jan 10, account: Jan 15 → earliest is Jan 10
    assert(r.from === '2026-01-10T08:00:00.000Z', 'tx before creation: from is earliest tx date');
  }

  // 4. Multiple transactions with various dates
  {
    const txs = [
      makeTx('deposit', 500, '2026-01-05T09:00:00.000Z'),
      makeTx('deposit', 300, '2026-01-20T14:00:00.000Z'),
      makeTx('withdrawal', 200, '2026-01-12T11:00:00.000Z'),
    ];
    const r = computeDatesActive('2026-01-15T10:00:00.000Z', txs, '2026-01-25T00:00:00.000Z');
    // Earliest tx: Jan 5 < Jan 15 → from = Jan 5
    assert(r.from === '2026-01-05T09:00:00.000Z', 'multiple txs: from is earliest tx date');
  }

  // ── Edge cases ──

  // 5. Transactions with null dates → excluded from min calculation
  {
    const txs = [
      makeTx('deposit', 500, '2026-01-20T12:00:00.000Z'),
      makeTx('deposit', 300, null as unknown as string),  // null date
    ];
    const r = computeDatesActive('2026-01-15T10:00:00.000Z', txs, '2026-01-25T00:00:00.000Z');
    // Only the non-null date (Jan 20) is considered, accountCreatedAt Jan 15 → earliest is Jan 15
    assert(r.from === '2026-01-15T10:00:00.000Z', 'null tx date excluded: from is accountCreatedAt');
  }

  // 6. All transaction dates are null → falls back to accountCreatedAt
  {
    const txs = [
      makeTx('deposit', 500, null as unknown as string),
      makeTx('withdrawal', 200, null as unknown as string),
    ];
    const r = computeDatesActive('2026-01-15T10:00:00Z', txs, '2026-01-25T00:00:00Z');
    assert(r.from === '2026-01-15T10:00:00Z', 'all null tx dates: from is accountCreatedAt');
  }

  // 7. Transaction date exactly equal to account creation date
  {
    const txs = [makeTx('deposit', 1000, '2026-01-15T10:00:00.000Z')];
    const r = computeDatesActive('2026-01-15T10:00:00.000Z', txs, '2026-01-25T00:00:00.000Z');
    assert(r.from === '2026-01-15T10:00:00.000Z', 'tx same as creation: from is that date');
  }

  // 8. referenceDate is earlier than any transaction (unusual but possible)
  {
    const txs = [makeTx('deposit', 1000, '2026-01-20T12:00:00.000Z')];
    const r = computeDatesActive('2026-01-15T10:00:00.000Z', txs, '2026-01-10T00:00:00.000Z');
    assert(r.from === '2026-01-15T10:00:00.000Z', 'from unaffected by to date: accountCreatedAt');
    assert(r.to === '2026-01-10T00:00:00.000Z', 'to is explicitly passed referenceDate');
  }

  // 9. No referenceDate provided → 'to' is a real ISO string (not null/undefined)
  {
    const r = computeDatesActive('2026-01-15T10:00:00Z', []);
    assert(r.from === '2026-01-15T10:00:00Z', 'no ref date: from is accountCreatedAt');
    assertNotNull(r.to, 'no ref date: to is not null');
    // to should be a valid ISO string (new Date().toISOString())
    assert(typeof r.to === 'string' && r.to.length > 10, 'no ref date: to is valid ISO string');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
