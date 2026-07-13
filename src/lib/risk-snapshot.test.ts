/**
 * risk-snapshot.test.ts
 *
 * Comprehensive tests for the risk snapshot derivation library.
 * Covers positive, negative, and edge cases for all exported functions.
 *
 * Run: npx tsx src/lib/risk-snapshot.test.ts
 */

import {
  computeEquityAtOpen,
  computeRealizedPnLFromClosedTrades,
  computeRiskSnapshotValues,
  deriveInitialRiskAmount,
  type EquityAtOpenInput,
  type InitialRiskAmountInput,
  type PriorClosedTradeData,
  type RiskSnapshotInput,
} from './risk-snapshot';

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
// Tests: computeEquityAtOpen
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeEquityAtOpen');

  // --- Positive tests ---

  // 1. Simple positive equity from starting balance only
  {
    const input: EquityAtOpenInput = {
      startingBalance: 10000,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: 0,
      hasNoAccountData: false,
      fallbackValue: null,
    };
    const r = computeEquityAtOpen(input);
    assert(r === 10000, 'starting balance only → 10000');
  }

  // 2. Equity with deposits and realized P&L added
  {
    const input: EquityAtOpenInput = {
      startingBalance: 10000,
      deposits: 5000,
      withdrawals: 0,
      realizedPnL: 2500,
      hasNoAccountData: false,
      fallbackValue: null,
    };
    const r = computeEquityAtOpen(input);
    assert(r === 17500, 'balance + deposits + P&L → 17500');
  }

  // 3. Equity with withdrawals subtracted
  {
    const input: EquityAtOpenInput = {
      startingBalance: 20000,
      deposits: 0,
      withdrawals: 3000,
      realizedPnL: 0,
      hasNoAccountData: false,
      fallbackValue: null,
    };
    const r = computeEquityAtOpen(input);
    assert(r === 17000, 'balance minus withdrawals → 17000');
  }

  // 4. Equity with all components: balance + deposits - withdrawals + P&L
  {
    const input: EquityAtOpenInput = {
      startingBalance: 50000,
      deposits: 10000,
      withdrawals: 5000,
      realizedPnL: -2000,
      hasNoAccountData: false,
      fallbackValue: null,
    };
    const r = computeEquityAtOpen(input);
    assert(r === 53000, 'balance + deposits - withdrawals + P&L → 53000');
  }

  // --- Fallback tests ---

  // 5. No account data with valid fallback → returns fallback
  {
    const input: EquityAtOpenInput = {
      startingBalance: 0,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: 0,
      hasNoAccountData: true,
      fallbackValue: 25000,
    };
    const r = computeEquityAtOpen(input);
    assert(r === 25000, 'no account data + valid fallback → 25000');
  }

  // 6. No account data but negative effective equity + fallback → still uses fallback
  {
    const input: EquityAtOpenInput = {
      startingBalance: 0,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: 0,
      hasNoAccountData: true,
      fallbackValue: 100000,
    };
    const r = computeEquityAtOpen(input);
    assert(r === 100000, 'zero effective equity + hasNoAccountData + fallback → 100000');
  }

  // --- Negative / edge cases ---

  // 7. Negative equity with account data → null (no fallback)
  {
    const input: EquityAtOpenInput = {
      startingBalance: 1000,
      deposits: 0,
      withdrawals: 5000,
      realizedPnL: 0,
      hasNoAccountData: false,
      fallbackValue: null,
    };
    const r = computeEquityAtOpen(input);
    assertNull(r, 'negative equity with account data → null');
  }

  // 8. Zero equity with account data → null
  {
    const input: EquityAtOpenInput = {
      startingBalance: 0,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: 0,
      hasNoAccountData: false,
      fallbackValue: null,
    };
    const r = computeEquityAtOpen(input);
    assertNull(r, 'zero equity with account data → null');
  }

  // 9. Negative equity from P&L losses → null
  {
    const input: EquityAtOpenInput = {
      startingBalance: 10000,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: -15000,
      hasNoAccountData: false,
      fallbackValue: null,
    };
    const r = computeEquityAtOpen(input);
    assertNull(r, 'P&L losses make equity negative → null');
  }

  // 10. No account data with null fallback → null
  {
    const input: EquityAtOpenInput = {
      startingBalance: 0,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: 0,
      hasNoAccountData: true,
      fallbackValue: null,
    };
    const r = computeEquityAtOpen(input);
    assertNull(r, 'no account data + null fallback → null');
  }

  // 11. No account data with zero fallback → null (fallbackValue > 0 check)
  {
    const input: EquityAtOpenInput = {
      startingBalance: 0,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: 0,
      hasNoAccountData: true,
      fallbackValue: 0,
    };
    const r = computeEquityAtOpen(input);
    assertNull(r, 'no account data + zero fallback → null');
  }

  // 12. No account data with negative fallback → null
  {
    const input: EquityAtOpenInput = {
      startingBalance: 0,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: 0,
      hasNoAccountData: true,
      fallbackValue: -100,
    };
    const r = computeEquityAtOpen(input);
    assertNull(r, 'no account data + negative fallback → null');
  }

  // 13. Negative effective equity but hasNoAccountData is false with fallback → null
  //     (This tests that the fallback only applies when hasNoAccountData is true)
  {
    const input: EquityAtOpenInput = {
      startingBalance: 0,
      deposits: 0,
      withdrawals: 5000,
      realizedPnL: 0,
      hasNoAccountData: false,
      fallbackValue: 25000,
    };
    const r = computeEquityAtOpen(input);
    assertNull(r, 'negative equity + account data exists + fallback present → null (hasNoAccountData=false takes priority)');
  }

  // 14. Positive equity with hasNoAccountData=true → returns positive equity, not fallback
  {
    const input: EquityAtOpenInput = {
      startingBalance: 50000,
      deposits: 0,
      withdrawals: 0,
      realizedPnL: 0,
      hasNoAccountData: true,
      fallbackValue: 25000,
    };
    const r = computeEquityAtOpen(input);
    assert(r === 50000, 'positive equity trumps fallback → 50000');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: computeRealizedPnLFromClosedTrades
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeRealizedPnLFromClosedTrades');

  // --- Positive tests ---

  // 1. Empty array → 0
  {
    const r = computeRealizedPnLFromClosedTrades([]);
    assert(r === 0, 'empty array → 0');
  }

  // 2. Single long trade with profit
  {
    const priorTrades: PriorClosedTradeData[] = [
      {
        direction: 'long',
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
          { action: 'sell', quantity: 100, price: 60, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
        ],
      },
    ];
    const r = computeRealizedPnLFromClosedTrades(priorTrades);
    assertApprox(r, 1000, 'single long profit → 1000');
  }

  // 3. Single short trade with profit
  {
    const priorTrades: PriorClosedTradeData[] = [
      {
        direction: 'short',
        executions: [
          { action: 'sell_short', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-10T09:00:00Z' },
          { action: 'buy_to_cover', quantity: 100, price: 90, fees: 0, executedAt: '2026-01-10T15:00:00Z' },
        ],
      },
    ];
    const r = computeRealizedPnLFromClosedTrades(priorTrades);
    assertApprox(r, 1000, 'single short profit → 1000');
  }

  // 4. Multiple trades: aggregate P&L
  {
    const priorTrades: PriorClosedTradeData[] = [
      {
        direction: 'long',
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
          { action: 'sell', quantity: 100, price: 60, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
        ],
      },
      {
        direction: 'short',
        executions: [
          { action: 'sell_short', quantity: 200, price: 80, fees: 0, executedAt: '2026-01-11T09:00:00Z' },
          { action: 'buy_to_cover', quantity: 200, price: 75, fees: 0, executedAt: '2026-01-11T15:00:00Z' },
        ],
      },
    ];
    const r = computeRealizedPnLFromClosedTrades(priorTrades);
    // Trade 1: (60-50)*100 = 1000
    // Trade 2: (80-75)*200 = 1000
    // Total: 2000
    assertApprox(r, 2000, 'multiple profitable trades → 2000');
  }

  // 5. Mix of winning and losing trades
  {
    const priorTrades: PriorClosedTradeData[] = [
      {
        direction: 'long',
        executions: [
          { action: 'buy', quantity: 100, price: 100, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
          { action: 'sell', quantity: 100, price: 120, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
        ],
      },
      {
        direction: 'long',
        executions: [
          { action: 'buy', quantity: 50, price: 80, fees: 0, executedAt: '2026-01-11T10:00:00Z' },
          { action: 'sell', quantity: 50, price: 60, fees: 0, executedAt: '2026-01-11T14:00:00Z' },
        ],
      },
    ];
    const r = computeRealizedPnLFromClosedTrades(priorTrades);
    // Trade 1: (120-100)*100 = 2000
    // Trade 2: (60-80)*50 = -1000
    // Total: 1000
    assertApprox(r, 1000, 'winning + losing trades → 1000');
  }

  // 6. Open trades (no exits) → 0 P&L contribution (fees only)
  {
    const priorTrades: PriorClosedTradeData[] = [
      {
        direction: 'long',
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 5, executedAt: '2026-01-10T10:00:00Z' },
        ],
      },
    ];
    const r = computeRealizedPnLFromClosedTrades(priorTrades);
    assertApprox(r, -5, 'open trade with fees only → -5');
  }

  // 7. Trades with fees included
  {
    const priorTrades: PriorClosedTradeData[] = [
      {
        direction: 'long',
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: 10, executedAt: '2026-01-10T10:00:00Z' },
          { action: 'sell', quantity: 100, price: 60, fees: 10, executedAt: '2026-01-10T14:00:00Z' },
        ],
      },
    ];
    const r = computeRealizedPnLFromClosedTrades(priorTrades);
    // Gross: (60-50)*100 = 1000, fees: 20, net: 980
    assertApprox(r, 980, 'trade with fees → 980');
  }

  // --- Edge cases ---

  // 8. Trade with partial exit
  {
    const priorTrades: PriorClosedTradeData[] = [
      {
        direction: 'long',
        executions: [
          { action: 'buy', quantity: 200, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
          { action: 'sell', quantity: 80, price: 55, fees: 0, executedAt: '2026-01-10T13:00:00Z' },
        ],
      },
    ];
    const r = computeRealizedPnLFromClosedTrades(priorTrades);
    // (55-50)*80 = 400
    assertApprox(r, 400, 'partial exit → 400');
  }

  // 9. Null fees treated as 0
  {
    const priorTrades: PriorClosedTradeData[] = [
      {
        direction: 'long',
        executions: [
          { action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-10T10:00:00Z' },
          { action: 'sell', quantity: 100, price: 60, fees: null, executedAt: '2026-01-10T14:00:00Z' },
        ],
      },
    ];
    const r = computeRealizedPnLFromClosedTrades(priorTrades);
    assertApprox(r, 1000, 'null fees → 1000');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: computeRiskSnapshotValues
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeRiskSnapshotValues');

  // --- Positive tests ---

  // 1. Long trade with stop, positive equity
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 50,
      initialQuantity: 100,
      initialStopPrice: 45,
      direction: 'long',
      accountEquityAtOpen: 10000,
    };
    const r = computeRiskSnapshotValues(input);
    // riskPerShare = |50 - 45| = 5
    // initialRiskAmount = 5 * 100 = 500
    // accountRiskPct = 500 / 10000 * 100 = 5
    assert(r.initialEntryPrice === 50, 'entry price → 50');
    assert(r.initialQuantity === 100, 'quantity → 100');
    assert(r.initialStopPrice === 45, 'stop price → 45');
    assert(r.riskPerShare === 5, 'long: riskPerShare → 5');
    assert(r.initialRiskAmount === 500, 'long: initialRiskAmount → 500');
    assertApprox(r.accountRiskPct!, 5, 'long: accountRiskPct → 5%');
  }

  // 2. Short trade with stop, positive equity
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 100,
      initialQuantity: 200,
      initialStopPrice: 110,
      direction: 'short',
      accountEquityAtOpen: 50000,
    };
    const r = computeRiskSnapshotValues(input);
    // riskPerShare = |100 - 110| = 10 (absolute difference)
    // initialRiskAmount = 10 * 200 = 2000
    // accountRiskPct = 2000 / 50000 * 100 = 4
    assert(r.initialEntryPrice === 100, 'short entry price → 100');
    assert(r.initialQuantity === 200, 'short quantity → 200');
    assert(r.initialStopPrice === 110, 'short stop price → 110');
    assert(r.riskPerShare === 10, 'short: riskPerShare → 10');
    assert(r.initialRiskAmount === 2000, 'short: initialRiskAmount → 2000');
    assertApprox(r.accountRiskPct!, 4, 'short: accountRiskPct → 4%');
  }

  // 3. Wide stop (larger risk per share)
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 50,
      initialQuantity: 100,
      initialStopPrice: 30,
      direction: 'long',
      accountEquityAtOpen: 10000,
    };
    const r = computeRiskSnapshotValues(input);
    // riskPerShare = |50 - 30| = 20
    // initialRiskAmount = 20 * 100 = 2000
    // accountRiskPct = 2000 / 10000 * 100 = 20
    assert(r.riskPerShare === 20, 'wide stop: riskPerShare → 20');
    assert(r.initialRiskAmount === 2000, 'wide stop: initialRiskAmount → 2000');
    assertApprox(r.accountRiskPct!, 20, 'wide stop: accountRiskPct → 20%');
  }

  // --- Negative / edge cases ---

  // 4. No stop → null riskPerShare, null initialRiskAmount, null accountRiskPct
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 50,
      initialQuantity: 100,
      initialStopPrice: null,
      direction: 'long',
      accountEquityAtOpen: 10000,
    };
    const r = computeRiskSnapshotValues(input);
    assert(r.initialEntryPrice === 50, 'no stop: entry price → 50');
    assertNull(r.riskPerShare, 'no stop: riskPerShare → null');
    assertNull(r.initialRiskAmount, 'no stop: initialRiskAmount → null');
    assertNull(r.accountRiskPct, 'no stop: accountRiskPct → null');
  }

  // 5. Zero quantity → riskPerShare computed, initialRiskAmount = 0, accountRiskPct = 0
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 50,
      initialQuantity: 0,
      initialStopPrice: 45,
      direction: 'long',
      accountEquityAtOpen: 10000,
    };
    const r = computeRiskSnapshotValues(input);
    assert(r.riskPerShare === 5, 'zero qty: riskPerShare → 5');
    assert(r.initialRiskAmount === 0, 'zero qty: initialRiskAmount → 0');
    assert(r.accountRiskPct === 0, 'zero qty: accountRiskPct → 0');
  }

  // 6. Null accountEquityAtOpen → null accountRiskPct
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 50,
      initialQuantity: 100,
      initialStopPrice: 45,
      direction: 'long',
      accountEquityAtOpen: null,
    };
    const r = computeRiskSnapshotValues(input);
    assert(r.riskPerShare === 5, 'null equity: riskPerShare → 5');
    assert(r.initialRiskAmount === 500, 'null equity: initialRiskAmount → 500');
    assertNull(r.accountRiskPct, 'null equity: accountRiskPct → null');
  }

  // 7. Zero account equity → null accountRiskPct
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 50,
      initialQuantity: 100,
      initialStopPrice: 45,
      direction: 'long',
      accountEquityAtOpen: 0,
    };
    const r = computeRiskSnapshotValues(input);
    assert(r.riskPerShare === 5, 'zero equity: riskPerShare → 5');
    assert(r.initialRiskAmount === 500, 'zero equity: initialRiskAmount → 500');
    assertNull(r.accountRiskPct, 'zero equity: accountRiskPct → null');
  }

  // 8. Negative account equity → null accountRiskPct
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 50,
      initialQuantity: 100,
      initialStopPrice: 45,
      direction: 'long',
      accountEquityAtOpen: -5000,
    };
    const r = computeRiskSnapshotValues(input);
    assert(r.riskPerShare === 5, 'negative equity: riskPerShare → 5');
    assert(r.initialRiskAmount === 500, 'negative equity: initialRiskAmount → 500');
    assertNull(r.accountRiskPct, 'negative equity: accountRiskPct → null');
  }

  // 9. Fractional prices and quantities
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 150.50,
      initialQuantity: 33.5,
      initialStopPrice: 148.25,
      direction: 'long',
      accountEquityAtOpen: 50000,
    };
    const r = computeRiskSnapshotValues(input);
    // riskPerShare = |150.50 - 148.25| = 2.25
    // initialRiskAmount = 2.25 * 33.5 = 75.375
    // accountRiskPct = 75.375 / 50000 * 100 = 0.15075
    assertApprox(r.riskPerShare!, 2.25, 'fractional: riskPerShare → 2.25');
    assertApprox(r.initialRiskAmount!, 75.375, 'fractional: initialRiskAmount → 75.375');
    assertApprox(r.accountRiskPct!, 0.15075, 'fractional: accountRiskPct → 0.15075%');
  }

  // 10. Very small risk (1 cent per share, 1 share)
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 100.00,
      initialQuantity: 1,
      initialStopPrice: 99.99,
      direction: 'long',
      accountEquityAtOpen: 1000000,
    };
    const r = computeRiskSnapshotValues(input);
    // riskPerShare = 0.01
    // initialRiskAmount = 0.01 * 1 = 0.01
    // accountRiskPct = 0.01 / 1000000 * 100 = 0.000001
    assertApprox(r.riskPerShare!, 0.01, 'tiny risk: riskPerShare → 0.01');
    assertApprox(r.initialRiskAmount!, 0.01, 'tiny risk: initialRiskAmount → 0.01');
    assertApprox(r.accountRiskPct!, 0.000001, 'tiny risk: accountRiskPct → 0.000001%');
  }

  // 11. Very large values (to avoid overflow / precision issues)
  {
    const input: RiskSnapshotInput = {
      avgEntryPrice: 1000,
      initialQuantity: 100000,
      initialStopPrice: 999,
      direction: 'long',
      accountEquityAtOpen: 100000000,
    };
    const r = computeRiskSnapshotValues(input);
    // riskPerShare = 1
    // initialRiskAmount = 1 * 100000 = 100000
    // accountRiskPct = 100000 / 100000000 * 100 = 0.1
    assert(r.riskPerShare === 1, 'large values: riskPerShare → 1');
    assert(r.initialRiskAmount === 100000, 'large values: initialRiskAmount → 100000');
    assertApprox(r.accountRiskPct!, 0.1, 'large values: accountRiskPct → 0.1%');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: deriveInitialRiskAmount
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## deriveInitialRiskAmount');

  // --- Positive: has computed value ---

  // 1. Computed initialRiskAmount exists → returns it directly
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: 500,
      initialEntryPrice: 50,
      initialStopPrice: 45,
      initialQuantity: 100,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assert(r === 500, 'computed value exists → returns computed value 500');
  }

  // 2. Computed initialRiskAmount is 0 → returns 0 (0 is not null, ?? keeps it)
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: 0,
      initialEntryPrice: 50,
      initialStopPrice: 45,
      initialQuantity: 100,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assert(r === 0, 'computed value is 0 → returns 0');
  }

  // 3. Computed initialRiskAmount with fractional value
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: 75.375,
      initialEntryPrice: 150.50,
      initialStopPrice: 148.25,
      initialQuantity: 33.5,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assertApprox(r!, 75.375, 'computed fractional value → 75.375');
  }

  // --- Fallback: computed value is null, raw fields present ---

  // 4. No computed value, all raw fields present (long) → |50 - 45| * 100 = 500
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: 50,
      initialStopPrice: 45,
      initialQuantity: 100,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assert(r === 500, 'null computed + raw fields long → |50-45|*100 = 500');
  }

  // 5. No computed value, all raw fields present (short) → |100 - 110| * 200 = 2000
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: 100,
      initialStopPrice: 110,
      initialQuantity: 200,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assert(r === 2000, 'null computed + raw fields short → |100-110|*200 = 2000');
  }

  // 6. No computed value, zero quantity → |50 - 45| * 0 = 0
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: 50,
      initialStopPrice: 45,
      initialQuantity: 0,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assert(r === 0, 'null computed + zero quantity → 0');
  }

  // 7. No computed value, fractional prices and quantity
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: 150.50,
      initialStopPrice: 148.25,
      initialQuantity: 33.5,
    };
    const r = deriveInitialRiskAmount(snapshot);
    // |150.50 - 148.25| * 33.5 = 2.25 * 33.5 = 75.375
    assertApprox(r!, 75.375, 'null computed + fractional → 75.375');
  }

  // --- Negative: null fields ---

  // 8. No computed value, null entryPrice → null
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: null,
      initialStopPrice: 45,
      initialQuantity: 100,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assertNull(r, 'null computed + null entryPrice → null');
  }

  // 9. No computed value, null stopPrice → null
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: 50,
      initialStopPrice: null,
      initialQuantity: 100,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assertNull(r, 'null computed + null stopPrice → null');
  }

  // 10. No computed value, null quantity → null
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: 50,
      initialStopPrice: 45,
      initialQuantity: null,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assertNull(r, 'null computed + null quantity → null');
  }

  // 11. No computed value, all raw fields null → null
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: null,
      initialStopPrice: null,
      initialQuantity: null,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assertNull(r, 'null computed + all raw fields null → null');
  }

  // 12. Entire snapshot null-like (all fields null) → null
  {
    const snapshot: InitialRiskAmountInput = {
      initialRiskAmount: null,
      initialEntryPrice: null,
      initialStopPrice: null,
      initialQuantity: null,
    };
    const r = deriveInitialRiskAmount(snapshot);
    assertNull(r, 'all-null snapshot → null');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
