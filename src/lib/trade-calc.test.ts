/**
 * trade-calc.test.ts
 *
 * Comprehensive tests for the trade calculation library.
 * Covers positive, negative, and edge cases.
 *
 * Run: npx tsx src/lib/trade-calc.test.ts
 */

import {
  deriveTradeStatus,
  calculateAvgCost,
  calculateRealizedPnL,
  calculatePnL,
  calculateRMultiple,
  type ExecutionData,
} from './trade-calc';

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

// ────────────────────────────────────────────────────────────────────────
// Tests: deriveTradeStatus
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## deriveTradeStatus');

  // --- Positive tests ---

  // 1. No entries → planned
  {
    const r = deriveTradeStatus([], 'long');
    assert(r.status === 'planned', 'empty execs → planned (long)');
    assert(r.openedAt === null, 'empty → openedAt null');
    assert(r.closedAt === null, 'empty → closedAt null');
    assert(r.openQuantity === 0, 'empty → openQuantity 0');
  }

  // 2. Entry but no exit → open
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'long');
    assert(r.status === 'open', 'entry only → open');
    assert(r.openedAt === '2026-01-10T10:00:00Z', 'entry → openedAt set');
    assert(r.closedAt === null, 'entry → closedAt null');
    assert(r.openQuantity === 100, 'entry → openQuantity 100');
  }

  // 3. Partial exit → open (was partially_closed)
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 30, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'long');
    assert(r.status === 'open', 'partial exit → open');
    assert(r.openQuantity === 70, 'partial exit → openQuantity 70');
    assert(r.totalExitQty === 30, 'partial exit → totalExitQty 30');
  }

  // 4. Full exit → closed (long)
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 60, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'long');
    assert(r.status === 'closed', 'full exit → closed');
    assert(r.closedAt === '2026-01-10T14:00:00Z', 'full exit → closedAt set');
    assert(r.openQuantity === 0, 'full exit → openQuantity 0');
  }

  // 5. Short trade: sell_short entry + buy_to_cover exit
  {
    const execs: ExecutionData[] = [
      { action: 'sell_short', quantity: 200, price: 100, fees: 0, executedAt: '2026-01-10T09:00:00Z' },
      { action: 'buy_to_cover', quantity: 200, price: 95, fees: 0, executedAt: '2026-01-10T15:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'short');
    assert(r.status === 'closed', 'short full exit → closed');
    assert(r.totalEntryQty === 200, 'short → totalEntryQty 200');
    assert(r.totalExitQty === 200, 'short → totalExitQty 200');
    assert(r.openQuantity === 0, 'short full exit → openQuantity 0');
  }

  // 6. Short trade: partial exit
  {
    const execs: ExecutionData[] = [
      { action: 'sell_short', quantity: 100, price: 80, fees: 0, executedAt: '2026-01-10T09:00:00Z' },
      { action: 'buy_to_cover', quantity: 40, price: 78, fees: 0, executedAt: '2026-01-10T11:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'short');
    assert(r.status === 'open', 'short partial exit → open');
    assert(r.openQuantity === 60, 'short partial exit → openQuantity 60');
  }

  // 7. Multiple entries (add action)
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 50, price: 48, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'add', quantity: 50, price: 52, fees: 0, executedAt: '2026-01-10T11:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'long');
    assert(r.status === 'open', 'multiple entries → open');
    assert(r.totalEntryQty === 100, 'multiple entries → totalEntryQty 100');
  }

  // 8. Reduce action treated as exit
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'reduce', quantity: 40, price: 55, fees: 0, executedAt: '2026-01-10T13:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'long');
    assert(r.status === 'open', 'reduce → open');
    assert(r.totalExitQty === 40, 'reduce → totalExitQty 40');
  }

  // --- Negative / edge cases ---

  // 9. Over-exit (more exit qty than entry qty)
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 150, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'long');
    assert(r.status === 'closed', 'over-exit → closed');
    assert(r.openQuantity === 0, 'over-exit → openQuantity capped at 0');
  }

  // 10. Zero quantity entry
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 0, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
    ];
    const r = deriveTradeStatus(execs, 'long');
    assert(r.status === 'planned', 'zero qty entry → planned');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: calculateAvgCost
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculateAvgCost');

  // 1. Single entry
  {
    const entries: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
    ];
    const r = calculateAvgCost(entries);
    assertApprox(r.avgEntryPrice!, 50, 'single entry → avg 50');
    assert(r.totalEntryQty === 100, 'single entry → qty 100');
  }

  // 2. Weighted average with two entries
  {
    const entries: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'add', quantity: 200, price: 45, fees: 0, executedAt: '2026-01-10T11:00:00Z' },
    ];
    const r = calculateAvgCost(entries);
    // (100*50 + 200*45) / 300 = (5000 + 9000) / 300 = 14000/300 ≈ 46.667
    assertApprox(r.avgEntryPrice!, 46.667, 'weighted avg → 46.667');
    assert(r.totalEntryQty === 300, 'two entries → qty 300');
  }

  // Negative / edge cases

  // 3. Empty entries
  {
    const r = calculateAvgCost([]);
    assertNull(r.avgEntryPrice, 'empty entries → avg null');
    assert(r.totalEntryQty === 0, 'empty entries → qty 0');
  }

  // 4. Zero quantity in all entries
  {
    const entries: ExecutionData[] = [
      { action: 'buy', quantity: 0, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
    ];
    const r = calculateAvgCost(entries);
    assertNull(r.avgEntryPrice, 'zero qty entries → avg null');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: calculateRealizedPnL
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculateRealizedPnL');

  // 1. Long: single full exit at profit
  {
    const exits: ExecutionData[] = [
      { action: 'sell', quantity: 100, price: 60, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculateRealizedPnL(50, 100, exits, 'long');
    // (60 - 50) * 100 = 1000
    assertApprox(r.realizedPnL, 1000, 'long full exit → P&L 1000');
    assert(r.remainingQuantity === 0, 'long full exit → remaining 0');
  }

  // 2. Long: single full exit at loss
  {
    const exits: ExecutionData[] = [
      { action: 'sell', quantity: 100, price: 40, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculateRealizedPnL(50, 100, exits, 'long');
    assertApprox(r.realizedPnL, -1000, 'long full exit at loss → P&L -1000');
  }

  // 3. Short: single full exit at profit
  {
    const exits: ExecutionData[] = [
      { action: 'buy_to_cover', quantity: 100, price: 45, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculateRealizedPnL(50, 100, exits, 'short');
    // (50 - 45) * 100 = 500
    assertApprox(r.realizedPnL, 500, 'short full exit → P&L 500');
  }

  // 4. Short: single full exit at loss
  {
    const exits: ExecutionData[] = [
      { action: 'buy_to_cover', quantity: 100, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculateRealizedPnL(50, 100, exits, 'short');
    assertApprox(r.realizedPnL, -500, 'short full exit at loss → P&L -500');
  }

  // 5. Partial exit (long)
  {
    const exits: ExecutionData[] = [
      { action: 'sell', quantity: 30, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculateRealizedPnL(50, 100, exits, 'long');
    // (55 - 50) * 30 = 150
    assertApprox(r.realizedPnL, 150, 'long partial exit → P&L 150');
    assert(r.remainingQuantity === 70, 'long partial exit → remaining 70');
  }

  // 6. Multiple exits processed chronologically
  {
    const exits: ExecutionData[] = [
      { action: 'sell', quantity: 30, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
      { action: 'sell', quantity: 70, price: 60, fees: 0, executedAt: '2026-01-10T15:00:00Z' },
    ];
    const r = calculateRealizedPnL(50, 100, exits, 'long');
    // (55-50)*30 + (60-50)*70 = 150 + 700 = 850
    assertApprox(r.realizedPnL, 850, 'multiple exits → P&L 850');
    assert(r.remainingQuantity === 0, 'multiple exits → remaining 0');
  }

  // Negative / edge cases

  // 7. No exits
  {
    const r = calculateRealizedPnL(50, 100, [], 'long');
    assertApprox(r.realizedPnL, 0, 'no exits → P&L 0');
    assert(r.remainingQuantity === 100, 'no exits → remaining 100');
  }

  // 8. Over-exit: cap cumulative exit at totalOpenQty
  {
    const exits: ExecutionData[] = [
      { action: 'sell', quantity: 150, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculateRealizedPnL(50, 100, exits, 'long');
    // Capped at 100 of 150: (55-50)*100 = 500
    assertApprox(r.realizedPnL, 500, 'over-exit → capped P&L 500');
    assert(r.remainingQuantity === 0, 'over-exit → remaining 0');
  }

  // 9. Zero exit quantity
  {
    const exits: ExecutionData[] = [
      { action: 'sell', quantity: 0, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculateRealizedPnL(50, 100, exits, 'long');
    assertApprox(r.realizedPnL, 0, 'zero qty exit → P&L 0');
    assert(r.remainingQuantity === 100, 'zero qty exit → remaining 100');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: calculatePnL (orchestrator)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculatePnL');

  // 1. Long: full cycle with profit
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 2, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 60, fees: 2, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculatePnL(execs, 'long');
    // Gross: (60-50)*100 = 1000, less fees: 4, net: 996
    assertApprox(r.totalRealizedPnL, 996, 'long full cycle P&L 996');
    assertApprox(r.avgEntryPrice!, 50, 'long full cycle avg 50');
    assert(r.totalEntryQty === 100, 'long full cycle entry 100');
    assert(r.totalExitQty === 100, 'long full cycle exit 100');
    assert(r.openQuantity === 0, 'long full cycle open 0');
  }

  // 2. Short: full cycle with profit
  {
    const execs: ExecutionData[] = [
      { action: 'sell_short', quantity: 100, price: 100, fees: 1, executedAt: '2026-01-10T09:00:00Z' },
      { action: 'buy_to_cover', quantity: 100, price: 95, fees: 1, executedAt: '2026-01-10T15:00:00Z' },
    ];
    const r = calculatePnL(execs, 'short');
    // Gross: (100-95)*100 = 500, less fees: 2, net: 498
    assertApprox(r.totalRealizedPnL, 498, 'short full cycle P&L 498');
    assertApprox(r.avgEntryPrice!, 100, 'short full cycle avg 100');
  }

  // 3. Partial exit
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 200, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 80, price: 55, fees: 0, executedAt: '2026-01-10T13:00:00Z' },
    ];
    const r = calculatePnL(execs, 'long');
    // (55-50)*80 = 400
    assertApprox(r.totalRealizedPnL, 400, 'partial exit P&L 400');
    assert(r.openQuantity === 120, 'partial exit open 120');
    assert(r.totalExitQty === 80, 'partial exit qty 80');
  }

  // Negative / edge cases

  // 4. No entries at all
  {
    const r = calculatePnL([], 'long');
    assertApprox(r.totalRealizedPnL, 0, 'no entries P&L 0');
    assertNull(r.avgEntryPrice, 'no entries avg null');
    assert(r.openQuantity === 0, 'no entries open 0');
  }

  // 5. Entries with no exits
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 3, executedAt: '2026-01-10T10:00:00Z' },
    ];
    const r = calculatePnL(execs, 'long');
    // Fees only: -3
    assertApprox(r.totalRealizedPnL, -3, 'entries only → P&L = -fees');
    assert(r.openQuantity === 100, 'entries only → open 100');
  }

  // 6. Over-exit (exit qty > entry qty)
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 200, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculatePnL(execs, 'long');
    // (55-50)*100 = 500 (capped at 100)
    assertApprox(r.totalRealizedPnL, 500, 'over-exit P&L 500');
    assert(r.totalExitQty === 100, 'over-exit exit capped at 100');
    assert(r.openQuantity === 0, 'over-exit open 0');
  }

  // 7. Null fees treated as 0
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 60, fees: null, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const r = calculatePnL(execs, 'long');
    // (60-50)*100 = 1000, fees 0
    assertApprox(r.totalRealizedPnL, 1000, 'null fees P&L 1000');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: calculateRMultiple
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculateRMultiple');

  // 1. Normal case
  {
    const r = calculateRMultiple(500, 200);
    assertApprox(r.rMultiple!, 2.5, 'P&L 500 risk 200 → R 2.5');
    assert(r.initialRiskUsed === true, 'risk used = true');
  }

  // 2. Negative P&L
  {
    const r = calculateRMultiple(-100, 200);
    assertApprox(r.rMultiple!, -0.5, 'P&L -100 risk 200 → R -0.5');
  }

  // Negative / edge cases

  // 3. Null risk
  {
    const r = calculateRMultiple(500, null);
    assertNull(r.rMultiple, 'null risk → null R');
    assert(r.initialRiskUsed === false, 'null risk → not used');
  }

  // 4. Zero risk
  {
    const r = calculateRMultiple(500, 0);
    assertNull(r.rMultiple, 'zero risk → null R');
  }

  // 5. Negative risk
  {
    const r = calculateRMultiple(500, -100);
    assertNull(r.rMultiple, 'negative risk → null R');
  }

  // 6. Zero P&L
  {
    const r = calculateRMultiple(0, 200);
    assertApprox(r.rMultiple!, 0, 'zero P&L → R 0');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
