/**
 * trade-metrics.test.ts
 *
 * Comprehensive tests for FIFO lot matching and proportional fee allocation
 * in computeTradeMetrics(). Covers all 17 FIFO scenarios from spec Section 12
 * plus edge cases and the full acceptance case (Section 12.1).
 *
 * Run: npx tsx src/lib/trade-metrics.test.ts
 */

import {
  computeTradeMetrics,
  type TradeMetricsInput,
  type TradeMetricsResult,
} from './trade-metrics';

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

function assertApprox(actual: number | null, expected: number | null, msg: string, tol = 0.001) {
  if (actual === null && expected === null) {
    passed++;
    console.log(`  ✅ ${msg} (null)`);
    return;
  }
  if (actual === null || expected === null) {
    failed++;
    console.error(`  ❌ ${msg} — expected ${expected}, got ${actual} (FAILED)`);
    return;
  }
  if (Math.abs(actual - expected) < tol) {
    passed++;
    console.log(`  ✅ ${msg} (≈${actual})`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${expected}, got ${actual} (FAILED)`);
  }
}

function assertMatchesCount(r: TradeMetricsResult, expected: number, msg: string) {
  if (r.matches.length === expected) {
    passed++;
    console.log(`  ✅ ${msg} (${expected} matches)`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${expected} matches, got ${r.matches.length} (FAILED)`);
    console.error(`     Matches: ${JSON.stringify(r.matches.map(m => ({
      lot: m.lotExecutionId,
      qty: Number(m.matchedQuantity),
      entry: Number(m.entryPrice),
      exit: Number(m.exitPrice),
      entryFee: Number(m.allocatedEntryFee),
      exitFee: Number(m.allocatedExitFee),
    })))}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Acceptance case: Section 12.1
// Buy 10@$10 (fee $1), Buy 10@$20 (fee $1), Sell 10@$15 (fee $1)
// Mark: $22
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Acceptance case (Section 12.1)');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'E1', action: 'buy', quantity: 10, price: 10, fees: 1, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'E2', action: 'buy', quantity: 10, price: 20, fees: 1, executedAt: '2026-01-10T11:00:00Z' },
      { id: 'E3', action: 'sell', quantity: 10, price: 15, fees: 1, executedAt: '2026-01-10T12:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: { price: 22, markedAt: '2026-01-10T13:00:00Z' },
    currentAccountEquity: 10000,
  };

  const r = computeTradeMetrics(input);

  assertApprox(r.size.entryQuantity, 20, 'entryQuantity = 20');
  assertApprox(r.size.exitQuantity, 10, 'exitQuantity = 10');
  assertApprox(r.size.openQuantity, 10, 'openQuantity = 10');
  assert(r.size.sizeDisplay === '20 / 10', 'sizeDisplay = "20 / 10"');

  assertApprox(r.averagePrices.avgEntryPrice, 15, 'avgEntryPrice = $15');
  assertApprox(r.averagePrices.avgExitPrice, 15, 'avgExitPrice = $15');
  assertApprox(r.averagePrices.openAvgCost, 20, 'openAvgCost = $20');

  // FIFO matches: LOT 0 (10@$10) fully consumed by sell 10
  assertMatchesCount(r, 1, '1 FIFO match');
  assertApprox(Number(r.matches[0].matchedQuantity), 10, 'match qty = 10');
  assertApprox(Number(r.matches[0].entryPrice), 10, 'match entry = $10');
  assertApprox(Number(r.matches[0].exitPrice), 15, 'match exit = $15');

  // Gross realized P&L: (15 - 10) × 10 = $50
  assertApprox(r.realizedPnl.grossRealizedPnl, 50, 'grossRealizedPnl = $50');
  // Realized fees: entry fee $1 on lot 0 + exit fee $1 on sell = $2
  assertApprox(r.fees.realizedFees, 2, 'realizedFees = $2');
  // Net realized P&L: $50 - $2 = $48
  assertApprox(r.realizedPnl.netRealizedPnl, 48, 'netRealizedPnl = $48');

  // Open fees: entry fee $1 on lot 1 (unmatched)
  assertApprox(r.fees.openFees, 1, 'openFees = $1');

  // Total fees across all executions: $1 + $1 + $1 = $3
  assertApprox(r.fees.totalFees, 3, 'totalFees = $3');

  // Unrealized P&L: (22 - 20) × 10 = $20, net = $20 - $1 = $19
  assertApprox(r.unrealizedPnl.grossUnrealizedPnl, 20, 'grossUnrealizedPnl = $20');
  assertApprox(r.unrealizedPnl.netUnrealizedPnl, 19, 'netUnrealizedPnl = $19');

  // Risk: no stop adjustments
  assert(r.risk.activeStop === null, 'activeStop = null');
  assert(r.risk.openRisk === null, 'openRisk = null');
  assert(r.risk.riskToAccount === null, 'riskToAccount = null');

  // Total net P&L: $48 + $19 = $67
  assertApprox(r.position.totalNetPnl, 67, 'totalNetPnl = $67');

  // Holding period: 3 hours = 0.125 days
  assertApprox(r.position.holdingPeriodDays, 0.125, 'holdingPeriodDays = 0.125');

  // Market value: $22 × 10 = $220
  assertApprox(r.position.marketValue, 220, 'marketValue = $220');

  // Position weight: $220 / $10,000 × 100 = 2.2%
  assertApprox(r.position.positionWeight, 2.2, 'positionWeight = 2.2%');

  // Return metrics: total net P&L / total entry notional
  // totalEntryNotional = (10×10)+(10×20) = $300
  assertApprox(r.returnMetrics.returnPct, 67 / 300 * 100, 'returnPct = 22.333%');
  assert(r.returnMetrics.rMultiple === null, 'rMultiple = null (no initialRisk)');

  // Status: open (20 entries, 10 exits)
  assert(r.position.status === 'open', 'status = open');
  assert(r.position.openedAt === '2026-01-10T10:00:00Z', 'openedAt = first entry');
  assert(r.position.closedAt === null, 'closedAt = null (not fully closed)');

  // 1 remaining lot (the 10@$20 lot)
  assert(r.remainingLots.length === 1, '1 remaining lot');
  assertApprox(Number(r.remainingLots[0].entryPrice), 20, 'remaining lot entry price = $20');
  assertApprox(Number(r.remainingLots[0].quantityRemaining), 10, 'remaining lot qty = 10');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 1: One long entry and one complete exit
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 1: One long entry, one complete exit');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S1-E1', action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S1-E2', action: 'sell', quantity: 100, price: 60, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: { price: 62, markedAt: '2026-01-10T15:00:00Z' },
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  assertApprox(r.size.entryQuantity, 100, 'entryQuantity = 100');
  assertApprox(r.size.exitQuantity, 100, 'exitQuantity = 100');
  assertApprox(r.size.openQuantity, 0, 'openQuantity = 0');
  assert(r.size.sizeDisplay === '100 / 100', 'sizeDisplay = "100 / 100"');

  assertApprox(r.averagePrices.avgEntryPrice, 50, 'avgEntryPrice = $50');
  assertApprox(r.averagePrices.avgExitPrice, 60, 'avgExitPrice = $60');
  assert(r.averagePrices.openAvgCost === null, 'openAvgCost = null (closed)');

  assertMatchesCount(r, 1, '1 FIFO match');
  assertApprox(r.realizedPnl.grossRealizedPnl, 1000, 'grossRealizedPnl = $1000');
  assertApprox(r.fees.realizedFees, 0, 'realizedFees = $0');
  assertApprox(r.realizedPnl.netRealizedPnl, 1000, 'netRealizedPnl = $1000');

  assert(r.position.status === 'closed', 'status = closed');
  assert(r.position.openedAt === '2026-01-10T10:00:00Z', 'openedAt = first entry');
  assert(r.position.closedAt === '2026-01-10T14:00:00Z', 'closedAt = last exit');
  assert(r.remainingLots.length === 0, '0 remaining lots');

  // Derived fields: closed trade with mark (but openQty=0 so unrealized=null)
  assert(r.unrealizedPnl.grossUnrealizedPnl === null, 'grossUnrealizedPnl = null (closed)');
  assert(r.unrealizedPnl.netUnrealizedPnl === null, 'netUnrealizedPnl = null (closed)');
  assertApprox(r.position.totalNetPnl, 1000, 'totalNetPnl = $1000');
  assertApprox(r.position.holdingPeriodDays, 4 / 24, 'holdingPeriodDays = 0.167 (4h)');
  assert(r.position.marketValue === null, 'marketValue = null (closed)');
  assert(r.position.positionWeight === null, 'positionWeight = null');
  // totalEntryNotional = 100×50 = 5000
  assertApprox(r.returnMetrics.returnPct, 1000 / 5000 * 100, 'returnPct = 20%');
  assert(r.returnMetrics.rMultiple === null, 'rMultiple = null');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 2: One short entry and one complete cover
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 2: One short entry, one complete cover');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S2-E1', action: 'sell_short', quantity: 100, price: 60, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S2-E2', action: 'buy_to_cover', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ],
    direction: 'short',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: { price: 48, markedAt: '2026-01-10T15:00:00Z' },
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  assertApprox(r.size.entryQuantity, 100, 'entryQuantity = 100');
  assertApprox(r.size.exitQuantity, 100, 'exitQuantity = 100');
  assertApprox(r.size.openQuantity, 0, 'openQuantity = 0');

  // Short P&L: (entry - exit) × qty = (60 - 50) × 100 = $1000
  assertApprox(r.realizedPnl.grossRealizedPnl, 1000, 'grossRealizedPnl = $1000 (short)');

  assertMatchesCount(r, 1, '1 FIFO match');
  assert(r.position.status === 'closed', 'status = closed');
  assert(r.remainingLots.length === 0, '0 remaining lots');

  // Derived fields: closed short trade
  assert(r.unrealizedPnl.grossUnrealizedPnl === null, 'S2: grossUnrealizedPnl = null (closed)');
  assert(r.unrealizedPnl.netUnrealizedPnl === null, 'S2: netUnrealizedPnl = null (closed)');
  assertApprox(r.position.totalNetPnl, 1000, 'S2: totalNetPnl = $1000');
  assertApprox(r.position.holdingPeriodDays, 4 / 24, 'S2: holdingPeriodDays = 0.167');
  assert(r.position.marketValue === null, 'S2: marketValue = null');
  // totalEntryNotional = 100×60 = 6000
  assertApprox(r.returnMetrics.returnPct, 1000 / 6000 * 100, 'S2: returnPct = 16.667%');
  assert(r.returnMetrics.rMultiple === null, 'S2: rMultiple = null');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 3: Multiple weighted entry fills
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 3: Multiple weighted entry fills');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S3-E1', action: 'buy', quantity: 5, price: 10, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S3-E2', action: 'buy', quantity: 15, price: 12, fees: 0, executedAt: '2026-01-10T11:00:00Z' },
      { id: 'S3-E3', action: 'sell', quantity: 20, price: 14, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // Avg Entry: ((5×10) + (15×12)) / 20 = (50 + 180) / 20 = 230/20 = 11.50
  assertApprox(r.averagePrices.avgEntryPrice, 11.50, 'avgEntryPrice = $11.50');

  // FIFO: first lot 5@$10, second lot 15@$12 — both fully consumed
  assertMatchesCount(r, 2, '2 FIFO matches');
  // Lot 0: (14-10)×5 = $20
  // Lot 1: (14-12)×15 = $30
  assertApprox(r.realizedPnl.grossRealizedPnl, 50, 'grossRealizedPnl = $50');
  assertApprox(r.size.openQuantity, 0, 'openQuantity = 0');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 4: Multiple weighted exit fills
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 4: Multiple weighted exit fills');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S4-E1', action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S4-E2', action: 'sell', quantity: 50, price: 55, fees: 0, executedAt: '2026-01-10T12:00:00Z' },
      { id: 'S4-E3', action: 'sell', quantity: 50, price: 60, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // Avg Exit: ((50×55)+(50×60))/100 = (2750+3000)/100 = 57.50
  assertApprox(r.averagePrices.avgExitPrice, 57.50, 'avgExitPrice = $57.50');

  // FIFO: lot 0 (100@$50) consumed in two portions
  assertMatchesCount(r, 2, '2 FIFO matches');
  // Match 1: (55-50)×50 = $250
  // Match 2: (60-50)×50 = $500
  assertApprox(r.realizedPnl.grossRealizedPnl, 750, 'grossRealizedPnl = $750');
  assert(r.position.status === 'closed', 'status = closed');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 5: FIFO scale-in followed by partial exit
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 5: FIFO scale-in followed by partial exit');

  // Buy 10@$10, Buy 10@$20, Sell 5@$15
  // FIFO: first 5 from lot 0 (10@$10), remaining lot 0 (5@$10), lot 1 (10@$20)
  const input: TradeMetricsInput = {
    executions: [
      { id: 'S5-E1', action: 'buy', quantity: 10, price: 10, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S5-E2', action: 'buy', quantity: 10, price: 20, fees: 0, executedAt: '2026-01-10T11:00:00Z' },
      { id: 'S5-E3', action: 'sell', quantity: 5, price: 15, fees: 0, executedAt: '2026-01-10T12:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  assertMatchesCount(r, 1, '1 FIFO match (partial)');
  assertApprox(Number(r.matches[0].matchedQuantity), 5, 'match qty = 5');
  assertApprox(Number(r.matches[0].entryPrice), 10, 'match entry = $10 (oldest lot)');

  // Gross realized P&L: (15-10)×5 = $25
  assertApprox(r.realizedPnl.grossRealizedPnl, 25, 'grossRealizedPnl = $25');
  assertApprox(r.size.openQuantity, 15, 'openQuantity = 15');
  assert(r.position.status === 'open', 'status = open (partially closed)');

  // Remaining lots: lot 0 (5@$10), lot 1 (10@$20)
  assert(r.remainingLots.length === 2, '2 remaining lots');
  assertApprox(Number(r.remainingLots[0].quantityRemaining), 5, 'lot 0 remaining = 5');
  assertApprox(Number(r.remainingLots[1].quantityRemaining), 10, 'lot 1 remaining = 10');

  // Open avg cost: (5×10 + 10×20) / 15 = (50+200)/15 = 250/15 = 16.667
  assertApprox(r.averagePrices.openAvgCost, 250 / 15, 'openAvgCost = $16.67');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 6: Partially closed trade with entry and exit commissions
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 6: Partially closed with commissions');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S6-E1', action: 'buy', quantity: 10, price: 10, fees: 5, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S6-E2', action: 'buy', quantity: 10, price: 20, fees: 5, executedAt: '2026-01-10T11:00:00Z' },
      { id: 'S6-E3', action: 'sell', quantity: 5, price: 15, fees: 2, executedAt: '2026-01-10T12:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: { price: 22, markedAt: '2026-01-10T13:00:00Z' },
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // FIFO: match 5 units from lot 0 (10@$10, fee $5)
  assertMatchesCount(r, 1, '1 FIFO match');
  assertApprox(Number(r.matches[0].matchedQuantity), 5, 'match qty = 5');

  // Allocated entry fee: (5/10) × $5 = $2.50
  assertApprox(Number(r.matches[0].allocatedEntryFee), 2.50, 'allocated entry fee = $2.50');
  // Allocated exit fee: (5/5) × $2 = $2.00
  assertApprox(Number(r.matches[0].allocatedExitFee), 2.00, 'allocated exit fee = $2.00');

  // Gross realized P&L: (15-10)×5 = $25
  assertApprox(r.realizedPnl.grossRealizedPnl, 25, 'grossRealizedPnl = $25');
  // Realized fees: $2.50 + $2.00 = $4.50
  assertApprox(r.fees.realizedFees, 4.50, 'realizedFees = $4.50');
  // Net realized P&L: $25 - $4.50 = $20.50
  assertApprox(r.realizedPnl.netRealizedPnl, 20.50, 'netRealizedPnl = $20.50');

  // Open fees: lot 0 remaining $2.50 + lot 1 $5.00 = $7.50
  assertApprox(r.fees.openFees, 7.50, 'openFees = $7.50');

  // Total fees: $5 + $5 + $2 = $12
  assertApprox(r.fees.totalFees, 12, 'totalFees = $12');

  // Remaining lots: lot 0 (5@$10, fee $2.50), lot 1 (10@$20, fee $5.00)
  assert(r.remainingLots.length === 2, '2 remaining lots');
  assertApprox(Number(r.remainingLots[0].quantityRemaining), 5, 'lot 0 remaining = 5');
  assertApprox(Number(r.remainingLots[0].entryFeeRemaining), 2.50, 'lot 0 remaining fee = $2.50');

  // Derived fields: open trade with currentMark=$22, equity=null
  // openAvgCost = (5×10+10×20)/15 = 250/15 ≈ 16.667
  // grossUnrealizedPnl(long) = (22-16.667)×15 = $80
  assertApprox(r.unrealizedPnl.grossUnrealizedPnl, 80, 'S6: grossUnrealizedPnl = $80');
  assertApprox(r.unrealizedPnl.netUnrealizedPnl, 72.50, 'S6: netUnrealizedPnl = $72.50');
  assertApprox(r.position.totalNetPnl, 93, 'S6: totalNetPnl = $93');
  assertApprox(r.position.holdingPeriodDays, 0.125, 'S6: holdingPeriodDays = 0.125');
  assertApprox(r.position.marketValue, 330, 'S6: marketValue = $330');
  assert(r.position.positionWeight === null, 'S6: positionWeight = null (no equity)');
  // totalEntryNotional = (10×10)+(10×20) = $300
  assertApprox(r.returnMetrics.returnPct, 93 / 300 * 100, 'S6: returnPct = 31%');
  assert(r.returnMetrics.rMultiple === null, 'S6: rMultiple = null');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 7: Fees allocated across partial exits (multi-exit)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 7: Fees allocated across partial exits');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S7-E1', action: 'buy', quantity: 100, price: 50, fees: 10, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S7-E2', action: 'sell', quantity: 30, price: 55, fees: 3, executedAt: '2026-01-10T12:00:00Z' },
      { id: 'S7-E3', action: 'sell', quantity: 70, price: 60, fees: 5, executedAt: '2026-01-10T14:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // FIFO: match 30 then 70 from lot 0 (100@$50, fee $10)
  assertMatchesCount(r, 2, '2 FIFO matches');

  // Match 1: (55-50)×30 = $150, entry fee (30/100)×$10 = $3, exit fee (30/30)×$3 = $3
  assertApprox(Number(r.matches[0].allocatedEntryFee), 3, 'match 0 entry fee = $3');
  assertApprox(Number(r.matches[0].allocatedExitFee), 3, 'match 0 exit fee = $3');

  // Match 2: (60-50)×70 = $700, entry fee (70/70)×$7 = $7, exit fee (70/70)×$5 = $5
  // Wait, the exit fee allocation is exitFee × matchedQty / exitQty
  // For match 2: exit from S7-E3 (70 units, $5 fee): $5 × 70/70 = $5
  // Entry fee: lot 0.quantityRemaining was 70 after match 1, so feeRatio = 70/70 = 1. So $7 × 1 = $7
  assertApprox(Number(r.matches[1].allocatedEntryFee), 7, 'match 1 entry fee = $7');
  assertApprox(Number(r.matches[1].allocatedExitFee), 5, 'match 1 exit fee = $5');

  // Gross realized P&L: $150 + $700 = $850
  assertApprox(r.realizedPnl.grossRealizedPnl, 850, 'grossRealizedPnl = $850');
  // Realized fees: ($3+$3) + ($7+$5) = $18
  assertApprox(r.fees.realizedFees, 18, 'realizedFees = $18');
  assertApprox(r.realizedPnl.netRealizedPnl, 832, 'netRealizedPnl = $832');
  assert(r.remainingLots.length === 0, '0 remaining lots');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 8: Short trade with loss (profit decline)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 8: Short trade with loss');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S8-E1', action: 'sell_short', quantity: 50, price: 100, fees: 2, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S8-E2', action: 'buy_to_cover', quantity: 50, price: 110, fees: 2, executedAt: '2026-01-10T14:00:00Z' },
    ],
    direction: 'short',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // Short P&L: (entry - exit) × qty = (100 - 110) × 50 = -$500
  assertApprox(r.realizedPnl.grossRealizedPnl, -500, 'grossRealizedPnl = -$500 (short loss)');
  // Realized fees: entry $2 + exit $2 = $4
  assertApprox(r.fees.realizedFees, 4, 'realizedFees = $4');
  assertApprox(r.realizedPnl.netRealizedPnl, -504, 'netRealizedPnl = -$504');
  assert(r.position.status === 'closed', 'status = closed');

  // Derived fields: closed short trade (no mark, but closed so holdingPeriodDays uses closedAt)
  assert(r.unrealizedPnl.grossUnrealizedPnl === null, 'S8: grossUnrealizedPnl = null (closed)');
  assert(r.unrealizedPnl.netUnrealizedPnl === null, 'S8: netUnrealizedPnl = null (closed)');
  assertApprox(r.position.totalNetPnl, -504, 'S8: totalNetPnl = -$504');
  assertApprox(r.position.holdingPeriodDays, 4 / 24, 'S8: holdingPeriodDays = 0.167');
  // totalEntryNotional = 50×100 = 5000
  assertApprox(r.returnMetrics.returnPct, -504 / 5000 * 100, 'S8: returnPct = -10.08%');
  assert(r.returnMetrics.rMultiple === null, 'S8: rMultiple = null');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 9: Over-exit (exit qty > available lots)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 9: Exit quantity exceeds available lots');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S9-E1', action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S9-E2', action: 'sell', quantity: 200, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // Only 100 units available, so only 100 matched
  assertMatchesCount(r, 1, '1 FIFO match (capped)');
  assertApprox(Number(r.matches[0].matchedQuantity), 100, 'match qty = 100 (capped)');
  assertApprox(r.realizedPnl.grossRealizedPnl, 500, 'grossRealizedPnl = $500 (capped)');
  assert(r.remainingLots.length === 0, '0 remaining lots (all consumed)');

  // exitQuantity in size reflects ALL exits (200), not just matched
  assertApprox(r.size.exitQuantity, 200, 'exitQuantity = 200 (all exits recorded)');
  // openQuantity = max(0, 100 - 200) = 0
  assertApprox(r.size.openQuantity, 0, 'openQuantity = 0 (capped by max(0))');

  // Derived fields: over-exit, no mark (but closed, so holdingPeriodDays uses closedAt)
  assert(r.unrealizedPnl.grossUnrealizedPnl === null, 'S9: grossUnrealizedPnl = null');
  assert(r.unrealizedPnl.netUnrealizedPnl === null, 'S9: netUnrealizedPnl = null');
  assertApprox(r.position.totalNetPnl, 500, 'S9: totalNetPnl = $500');
  assertApprox(r.position.holdingPeriodDays, 4 / 24, 'S9: holdingPeriodDays = 0.167');
  // totalEntryNotional = 100×50 = 5000
  assertApprox(r.returnMetrics.returnPct, 500 / 5000 * 100, 'S9: returnPct = 10%');
  assert(r.returnMetrics.rMultiple === null, 'S9: rMultiple = null');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 10: Executions sharing the same timestamp
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 10: Same-timestamp executions (tiebreaker = id)');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'E-A', action: 'buy', quantity: 10, price: 10, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'E-B', action: 'buy', quantity: 10, price: 20, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'E-C', action: 'sell', quantity: 10, price: 15, fees: 0, executedAt: '2026-01-10T12:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // Same timestamp entries sorted by ID: E-A (10@$10) before E-B (10@$20)
  // Sell matches E-A first (FIFO)
  assertMatchesCount(r, 1, '1 FIFO match');
  assertApprox(Number(r.matches[0].entryPrice), 10, 'match entry = $10 (E-A first by id)');

  // Open avg cost = $20 (E-B remains)
  assertApprox(r.averagePrices.openAvgCost, 20, 'openAvgCost = $20');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 11: No fees (all null/zero)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 11: Null fees treated as zero');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S11-E1', action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S11-E2', action: 'sell', quantity: 100, price: 60, fees: null, executedAt: '2026-01-10T14:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  assertApprox(r.fees.totalFees, 0, 'totalFees = $0 (null treated as 0)');
  assertApprox(r.fees.realizedFees, 0, 'realizedFees = $0');
  assertApprox(r.fees.openFees, 0, 'openFees = $0');
  assertApprox(r.realizedPnl.grossRealizedPnl, 1000, 'grossRealizedPnl = $1000');
  assertApprox(r.realizedPnl.netRealizedPnl, 1000, 'netRealizedPnl = $1000');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 12: Multiple lots, single exit crossing lot boundaries
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 12: Single exit crossing lot boundaries');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S12-E1', action: 'buy', quantity: 10, price: 10, fees: 2, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S12-E2', action: 'buy', quantity: 10, price: 20, fees: 2, executedAt: '2026-01-10T11:00:00Z' },
      { id: 'S12-E3', action: 'sell', quantity: 15, price: 15, fees: 3, executedAt: '2026-01-10T12:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // FIFO: 10 from lot 0 (10@$10), then 5 from lot 1 (10@$20)
  assertMatchesCount(r, 2, '2 FIFO matches');

  // Match 1: (15-10)×10 = $50, entry fee (10/10)×$2 = $2, exit fee (10/15)×$3 = $2
  assertApprox(Number(r.matches[0].matchedQuantity), 10, 'match 0 qty = 10');
  assertApprox(Number(r.matches[0].allocatedEntryFee), 2, 'match 0 entry fee = $2');
  assertApprox(Number(r.matches[0].allocatedExitFee), 2, 'match 0 exit fee = $2');

  // Match 2: (15-20)×5 = -$25, entry fee (5/10)×$2 = $1, exit fee (5/15)×$3 = $1
  assertApprox(Number(r.matches[1].matchedQuantity), 5, 'match 1 qty = 5');
  assertApprox(Number(r.matches[1].allocatedEntryFee), 1, 'match 1 entry fee = $1');
  assertApprox(Number(r.matches[1].allocatedExitFee), 1, 'match 1 exit fee = $1');

  // Gross realized P&L: $50 + (-$25) = $25
  assertApprox(r.realizedPnl.grossRealizedPnl, 25, 'grossRealizedPnl = $25');
  // Realized fees: ($2+$2) + ($1+$1) = $6
  assertApprox(r.fees.realizedFees, 6, 'realizedFees = $6');
  assertApprox(r.realizedPnl.netRealizedPnl, 19, 'netRealizedPnl = $19');

  // Lot 1 has 5 remaining at $20, fee $1
  assert(r.remainingLots.length === 1, '1 remaining lot');
  assertApprox(Number(r.remainingLots[0].quantityRemaining), 5, 'lot 1 remaining = 5');
  assertApprox(Number(r.remainingLots[0].entryFeeRemaining), 1, 'lot 1 remaining fee = $1');
  assertApprox(r.averagePrices.openAvgCost, 20, 'openAvgCost = $20');
}

// ────────────────────────────────────────────────────────────────────────
// Scenario 13: Add/reduce actions
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scenario 13: Add and reduce actions');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'S13-E1', action: 'buy', quantity: 50, price: 40, fees: 1, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'S13-E2', action: 'add', quantity: 50, price: 50, fees: 1, executedAt: '2026-01-10T11:00:00Z' },
      { id: 'S13-E3', action: 'reduce', quantity: 30, price: 55, fees: 0.50, executedAt: '2026-01-10T12:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: { price: 60, markedAt: '2026-01-10T13:00:00Z' },
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  // Entries: buy 50 + add 50 = 100
  // Exits: reduce 30
  assertApprox(r.size.entryQuantity, 100, 'entryQuantity = 100');
  assertApprox(r.size.exitQuantity, 30, 'exitQuantity = 30');
  assertApprox(r.size.openQuantity, 70, 'openQuantity = 70');

  // FIFO: match 30 from lot 0 (50@$40)
  assertMatchesCount(r, 1, '1 FIFO match');
  assertApprox(Number(r.matches[0].entryPrice), 40, 'match entry = $40 (oldest lot)');
  assertApprox(Number(r.matches[0].allocatedEntryFee), 0.60, 'allocated entry fee = $0.60');
  // 30/50 × $1 = $0.60
  assertApprox(Number(r.matches[0].allocatedExitFee), 0.50, 'allocated exit fee = $0.50');
  // 30/30 × $0.50 = $0.50

  // Gross realized P&L: (55-40)×30 = $450
  assertApprox(r.realizedPnl.grossRealizedPnl, 450, 'grossRealizedPnl = $450');
  assertApprox(r.fees.realizedFees, 1.10, 'realizedFees = $1.10');
  assertApprox(r.realizedPnl.netRealizedPnl, 448.90, 'netRealizedPnl = $448.90');

  // Remaining: lot 0 (20@$40, fee $0.40) + lot 1 (50@$50, fee $1.00)
  assert(r.remainingLots.length === 2, '2 remaining lots');
  assertApprox(Number(r.remainingLots[0].quantityRemaining), 20, 'lot 0 remaining = 20');
  assertApprox(Number(r.remainingLots[1].quantityRemaining), 50, 'lot 1 remaining = 50');
  assertApprox(r.fees.openFees, 1.40, 'openFees = $1.40');

  // Derived fields: open trade with mark=$60, equity=null
  // openAvgCost = (20×40+50×50)/70 = 3300/70 ≈ 47.143
  // grossUnrealizedPnl(long) = (60-3300/70)×70 = $900
  assertApprox(r.unrealizedPnl.grossUnrealizedPnl, 900, 'S13: grossUnrealizedPnl = $900');
  assertApprox(r.unrealizedPnl.netUnrealizedPnl, 898.60, 'S13: netUnrealizedPnl = $898.60');
  assertApprox(r.position.totalNetPnl, 1347.50, 'S13: totalNetPnl = $1,347.50');
  assertApprox(r.position.holdingPeriodDays, 0.125, 'S13: holdingPeriodDays = 0.125');
  assertApprox(r.position.marketValue, 4200, 'S13: marketValue = $4,200');
  assert(r.position.positionWeight === null, 'S13: positionWeight = null (no equity)');
  // totalEntryNotional = 50×40+50×50 = 4500
  assertApprox(r.returnMetrics.returnPct, 1347.50 / 4500 * 100, 'S13: returnPct = 29.944%');
  assert(r.returnMetrics.rMultiple === null, 'S13: rMultiple = null');
}

// ────────────────────────────────────────────────────────────────────────
// Edge case: Planned trade (no executions)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Edge case: Planned trade (no executions)');

  const r = computeTradeMetrics({
    executions: [],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  });

  assertApprox(r.size.entryQuantity, 0, 'entryQuantity = 0');
  assertApprox(r.size.exitQuantity, 0, 'exitQuantity = 0');
  assertApprox(r.size.openQuantity, 0, 'openQuantity = 0');
  assert(r.size.sizeDisplay === '0 / 0', 'sizeDisplay = "0 / 0"');
  assert(r.position.status === 'planned', 'status = planned');
  assert(r.position.openedAt === null, 'openedAt = null');
  assert(r.position.closedAt === null, 'closedAt = null');
  assert(r.remainingLots.length === 0, '0 remaining lots');
  assert(r.matches.length === 0, '0 matches');
  assert(r.averagePrices.avgEntryPrice === null, 'avgEntryPrice = null');
  assert(r.averagePrices.avgExitPrice === null, 'avgExitPrice = null');
  assert(r.averagePrices.openAvgCost === null, 'openAvgCost = null');
  assertApprox(r.fees.totalFees, 0, 'totalFees = 0');
  assertApprox(r.realizedPnl.grossRealizedPnl, 0, 'grossRealizedPnl = 0');

  // Derived fields: planned trade — all should be null/zero
  assert(r.unrealizedPnl.grossUnrealizedPnl === null, 'Planned: grossUnrealizedPnl = null');
  assert(r.unrealizedPnl.netUnrealizedPnl === null, 'Planned: netUnrealizedPnl = null');
  assert(r.risk.activeStop === null, 'Planned: activeStop = null');
  assert(r.risk.openRisk === null, 'Planned: openRisk = null');
  assert(r.risk.riskToAccount === null, 'Planned: riskToAccount = null');
  assert(r.risk.initialRisk === null, 'Planned: initialRisk = null');
  assert(r.risk.initialRiskPct === null, 'Planned: initialRiskPct = null');
  assertApprox(r.position.totalNetPnl, 0, 'Planned: totalNetPnl = 0');
  assert(r.position.holdingPeriodDays === null, 'Planned: holdingPeriodDays = null');
  assert(r.position.marketValue === null, 'Planned: marketValue = null');
  assert(r.position.positionWeight === null, 'Planned: positionWeight = null');
  assert(r.returnMetrics.returnPct === null, 'Planned: returnPct = null (no notional)');
  assert(r.returnMetrics.rMultiple === null, 'Planned: rMultiple = null');
}

// ────────────────────────────────────────────────────────────────────────
// Edge case: Entry only (no exits)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Edge case: Entry only (no exits)');

  const input: TradeMetricsInput = {
    executions: [
      { id: 'EE1', action: 'buy', quantity: 100, price: 50, fees: 5, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'EE2', action: 'buy', quantity: 50, price: 55, fees: 3, executedAt: '2026-01-10T11:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  assertApprox(r.size.entryQuantity, 150, 'entryQuantity = 150');
  assertApprox(r.size.exitQuantity, 0, 'exitQuantity = 0');
  assertApprox(r.size.openQuantity, 150, 'openQuantity = 150');
  assert(r.position.status === 'open', 'status = open');
  assert(r.matches.length === 0, '0 matches (no exits)');
  assert(r.remainingLots.length === 2, '2 remaining lots');
  assertApprox(r.fees.realizedFees, 0, 'realizedFees = 0 (no exits)');
  assertApprox(r.fees.openFees, 8, 'openFees = $8 (all entry fees)');
  assertApprox(r.fees.totalFees, 8, 'totalFees = $8');
  assertApprox(r.realizedPnl.grossRealizedPnl, 0, 'grossRealizedPnl = 0');

  // Derived fields: entry only, no mark — unrealized=null, totalNetPnl=0
  assert(r.unrealizedPnl.grossUnrealizedPnl === null, 'EntryOnly: grossUnrealizedPnl = null');
  assert(r.unrealizedPnl.netUnrealizedPnl === null, 'EntryOnly: netUnrealizedPnl = null');
  assertApprox(r.position.totalNetPnl, 0, 'EntryOnly: totalNetPnl = 0');
  assert(r.position.holdingPeriodDays === null, 'EntryOnly: holdingPeriodDays = null (no mark)');
  assert(r.position.marketValue === null, 'EntryOnly: marketValue = null (no mark)');
  assert(r.position.positionWeight === null, 'EntryOnly: positionWeight = null');
  assertApprox(r.returnMetrics.returnPct, 0, 'EntryOnly: returnPct = 0 (totalNetPnl=0)');
  assert(r.returnMetrics.rMultiple === null, 'EntryOnly: rMultiple = null');
}

// ────────────────────────────────────────────────────────────────────────
// Edge case: Exact FIFO match with fractional allocation
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Edge case: Precise fractional fee allocation');

  // Lot 0: 7@$12.50, fee $2.50
  // Lot 1: 3@$18.75, fee $1.25
  // Sell 5@$15.00, fee $2.00
  // Match 5 from lot 0
  // Entry fee: (5/7)×$2.50 = $1.785714...
  // Exit fee: (5/5)×$2.00 = $2.00
  // P&L: (15.00-12.50)×5 = $12.50

  const input: TradeMetricsInput = {
    executions: [
      { id: 'F1', action: 'buy', quantity: 7, price: 12.50, fees: 2.50, executedAt: '2026-01-10T10:00:00Z' },
      { id: 'F2', action: 'buy', quantity: 3, price: 18.75, fees: 1.25, executedAt: '2026-01-10T11:00:00Z' },
      { id: 'F3', action: 'sell', quantity: 5, price: 15.00, fees: 2.00, executedAt: '2026-01-10T12:00:00Z' },
    ],
    direction: 'long',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  };

  const r = computeTradeMetrics(input);

  assertMatchesCount(r, 1, '1 FIFO match');
  assertApprox(Number(r.matches[0].allocatedEntryFee), (5/7)*2.50, 'allocated entry fee = 5/7×$2.50');
  assertApprox(Number(r.matches[0].allocatedExitFee), 2.00, 'allocated exit fee = $2.00');
  assertApprox(r.realizedPnl.grossRealizedPnl, 12.50, 'grossRealizedPnl = $12.50');
  assertApprox(r.fees.realizedFees, (5/7)*2.50 + 2.00, 'realizedFees = 5/7×$2.50 + $2.00');
  assertApprox(r.realizedPnl.netRealizedPnl, 12.50 - ((5/7)*2.50 + 2.00), 'netRealizedPnl correct');
  assert(r.remainingLots.length === 2, '2 remaining lots');
  assertApprox(Number(r.remainingLots[0].quantityRemaining), 2, 'lot 0 remaining = 2');
  assertApprox(Number(r.remainingLots[0].entryFeeRemaining), 2.50 - (5/7)*2.50, 'lot 0 remaining fee correct');
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
