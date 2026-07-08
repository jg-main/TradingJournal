/**
 * perf-metrics.test.ts
 *
 * Comprehensive tests for the per-trade performance metrics library.
 * Covers positive, negative, and edge cases for all 3 metric functions
 * plus the orchestrator.
 *
 * Run: npx tsx src/lib/perf-metrics.test.ts
 */

import {
  calculateDuration,
  calculateReturnPercent,
  calculateTotalFees,
  computePerfMetrics,
  type PerfMetrics,
} from './perf-metrics';
import type { ExecutionData } from './trade-calc';

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
// Tests: calculateDuration
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculateDuration');

  // --- Positive tests ---

  // 1. Closed trade: exact difference
  {
    const d = calculateDuration('2026-01-10T10:00:00Z', '2026-01-10T14:30:00Z');
    // 4 hours 30 min = 4 * 3600 * 1000 + 30 * 60 * 1000 = 14,400,000 + 1,800,000 = 16,200,000
    assert(d === 16200000, 'closed trade 4h30m → 16200000ms');
  }

  // 2. Closed trade: multi-day difference
  {
    const d = calculateDuration('2026-01-10T10:00:00Z', '2026-01-13T10:00:00Z');
    // 3 days = 3 * 86400 * 1000 = 259,200,000
    assert(d === 259200000, 'multi-day trade → 259200000ms');
  }

  // 3. Closed trade: same minute
  {
    const d = calculateDuration('2026-01-10T10:00:00Z', '2026-01-10T10:05:30Z');
    // 5 min 30 sec = 330,000ms
    assert(d === 330000, 'same hour 5m30s → 330000ms');
  }

  // Negative / edge cases

  // 4. Null openedAt
  {
    assertNull(calculateDuration(null, '2026-01-10T14:00:00Z'), 'null openedAt → null');
  }

  // 5. Empty string openedAt
  {
    assertNull(calculateDuration('', '2026-01-10T14:00:00Z'), 'empty openedAt → null');
  }

  // 6. Null closedAt (open trade)
  {
    assertNull(calculateDuration('2026-01-10T10:00:00Z', null), 'null closedAt → null');
  }

  // 7. Both null
  {
    assertNull(calculateDuration(null, null), 'both null → null');
  }

  // 8. Invalid date string (openedAt)
  {
    assertNull(calculateDuration('not-a-date', '2026-01-10T14:00:00Z'), 'invalid openedAt → null');
  }

  // 9. Invalid date string (closedAt)
  {
    assertNull(calculateDuration('2026-01-10T10:00:00Z', 'not-a-date'), 'invalid closedAt → null');
  }

  // 10. Reverse order (closedAt before openedAt — negative duration)
  {
    const d = calculateDuration('2026-01-10T14:00:00Z', '2026-01-10T10:00:00Z');
    assert(d !== null && d < 0, 'reversed dates → negative duration');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: calculateReturnPercent
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculateReturnPercent');

  // --- Positive tests ---

  // 1. Simple profit
  {
    // P&L 500, cost basis = 50 * 100 = 5000, return = 500/5000 * 100 = 10%
    const r = calculateReturnPercent(500, 50, 100);
    assertApprox(r!, 10, 'profit 500 on cost 5000 → 10%');
  }

  // 2. Simple loss
  {
    // P&L -250, cost basis = 50 * 100 = 5000, return = -250/5000 * 100 = -5%
    const r = calculateReturnPercent(-250, 50, 100);
    assertApprox(r!, -5, 'loss -250 on cost 5000 → -5%');
  }

  // 3. Zero P&L
  {
    const r = calculateReturnPercent(0, 50, 100);
    assertApprox(r!, 0, 'zero P&L → 0%');
  }

  // 4. Large profit percentage
  {
    // P&L 100, cost basis = 10 * 10 = 100, return = 100%
    const r = calculateReturnPercent(100, 10, 10);
    assertApprox(r!, 100, 'double return → 100%');
  }

  // 5. Fractional share quantity
  {
    // P&L 15, cost basis = 100 * 0.5 = 50, return = 15/50 * 100 = 30%
    const r = calculateReturnPercent(15, 100, 0.5);
    assertApprox(r!, 30, 'fractional shares → 30%');
  }

  // Negative / edge cases

  // 6. Null avgEntryPrice
  {
    assertNull(calculateReturnPercent(500, null, 100), 'null avgEntryPrice → null');
  }

  // 7. Undefined avgEntryPrice
  {
    // Testing the undefined handling via a typed variable
    const price: number | null | undefined = undefined as unknown as number | null;
    assertNull(calculateReturnPercent(500, price, 100), 'undefined avgEntryPrice → null');
  }

  // 8. Zero totalEntryQty
  {
    assertNull(calculateReturnPercent(500, 50, 0), 'zero totalEntryQty → null');
  }

  // 9. Negative totalEntryQty (should not happen, but guard)
  {
    assertNull(calculateReturnPercent(500, 50, -10), 'negative totalEntryQty → null');
  }

  // 10. Zero price (cost basis is 0)
  {
    const r = calculateReturnPercent(100, 0, 100);
    assert(r === 0, 'zero price → 0% return');
  }

  // 11. Very small price and quantity
  {
    // P&L 0.01, cost basis = 0.01 * 1 = 0.01, return = 0.01/0.01 * 100 = 100%
    const r = calculateReturnPercent(0.01, 0.01, 1);
    assertApprox(r!, 100, 'small values → 100%');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: calculateTotalFees
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculateTotalFees');

  // --- Positive tests ---

  // 1. Multiple executions with fees
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 2.5, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 55, fees: 2.5, executedAt: '2026-01-10T14:00:00Z' },
    ];
    assertApprox(calculateTotalFees(execs), 5, 'two execs with fees → 5');
  }

  // 2. Single execution fee
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 10, price: 100, fees: 0.75, executedAt: '2026-01-10T10:00:00Z' },
    ];
    assertApprox(calculateTotalFees(execs), 0.75, 'single exec fee → 0.75');
  }

  // 3. Many small fees adding up
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 1, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'add', quantity: 50, price: 52, fees: 0.5, executedAt: '2026-01-10T11:00:00Z' },
      { action: 'reduce', quantity: 50, price: 54, fees: 0.5, executedAt: '2026-01-10T12:00:00Z' },
      { action: 'sell', quantity: 100, price: 56, fees: 1, executedAt: '2026-01-10T14:00:00Z' },
    ];
    assertApprox(calculateTotalFees(execs), 3, 'four execs with fees → 3');
  }

  // Negative / edge cases

  // 4. Empty executions
  {
    assert(calculateTotalFees([]) === 0, 'empty executions → 0');
  }

  // 5. All null fees
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 55, fees: null, executedAt: '2026-01-10T14:00:00Z' },
    ];
    assert(calculateTotalFees(execs) === 0, 'all null fees → 0');
  }

  // 6. Mixed null and numeric fees
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 55, fees: 3, executedAt: '2026-01-10T14:00:00Z' },
    ];
    assert(calculateTotalFees(execs) === 3, 'mixed null/numeric fees → 3');
  }

  // 7. Zero fees
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 0, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 55, fees: 0, executedAt: '2026-01-10T14:00:00Z' },
    ];
    assert(calculateTotalFees(execs) === 0, 'zero fees → 0');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: computePerfMetrics (orchestrator)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computePerfMetrics');

  // 1. Closed trade with complete data
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 2.5, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 55, fees: 2.5, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const m = computePerfMetrics(execs, '2026-01-10T10:00:00Z', '2026-01-10T14:00:00Z', 500, 50, 100);
    assert(m.duration === 14400000, 'closed trade duration 4h');
    assertApprox(m.returnPercent!, 10, 'closed trade return 10%');
    assert(m.totalFees === 5, 'closed trade total fees 5');
  }

  // 2. No entries (planned trade)
  {
    const m = computePerfMetrics([], null, null, 0, null, 0);
    assertNull(m.duration, 'no entries → duration null');
    assertNull(m.returnPercent, 'no entries → return null');
    assert(m.totalFees === 0, 'no entries → fees 0');
  }

  // 3. Entries with no exits (open trade), closedAt passed as null
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 3, executedAt: '2026-01-10T10:00:00Z' },
    ];
    const m = computePerfMetrics(execs, '2026-01-10T10:00:00Z', null, -3, 50, 100);
    assertNull(m.duration, 'open trade no closedAt → duration null');
    // Return: -3 / (50*100) * 100 = -0.06%
    assertApprox(m.returnPercent!, -0.06, 'open trade return -0.06%');
    assert(m.totalFees === 3, 'open trade fees 3');
  }

  // 4. Open trade with caller passing current time as closedAt
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: 2, executedAt: '2026-01-10T10:00:00Z' },
    ];
    // Simulate: openedAt 10am, "now" is 2pm same day
    const m = computePerfMetrics(execs, '2026-01-10T10:00:00Z', '2026-01-10T14:00:00Z', 0, 50, 100);
    assert(m.duration === 14400000, 'open trade with passed closedAt → duration 4h');
    assert(m.totalFees === 2, 'open trade fees 2');
  }

  // 5. Null fees in executions
  {
    const execs: ExecutionData[] = [
      { action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-10T10:00:00Z' },
      { action: 'sell', quantity: 100, price: 60, fees: null, executedAt: '2026-01-10T14:00:00Z' },
    ];
    const m = computePerfMetrics(execs, '2026-01-10T10:00:00Z', '2026-01-10T14:00:00Z', 1000, 50, 100);
    assert(m.totalFees === 0, 'null fees → 0');
    assertApprox(m.returnPercent!, 20, 'null fees return 20%');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
