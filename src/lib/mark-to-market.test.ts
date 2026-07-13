/**
 * mark-to-market.test.ts
 *
 * Comprehensive tests for src/lib/mark-to-market.ts MTM helpers.
 * Covers computeOpenPosition, calculateUnrealizedPnL, and
 * computeMarkToMarketSummary for positive, negative, and edge cases.
 *
 * Run: npx tsx src/lib/mark-to-market.test.ts
 */

import {
  computeOpenPosition,
  calculateUnrealizedPnL,
  computeMarkToMarketSummary,
  type FeePolicy,
  type OpenTrade,
} from './mark-to-market';
import type { ExecutionData, Direction } from './trade-calc';

// ── Test harness (matches trade-calc.test.ts pattern) ──────────────────

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

function assertDeepEqual<T>(actual: T, expected: T, msg: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${expectedJson}, got ${actualJson} (FAILED)`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function exec(
  action: string,
  quantity: number,
  price: number,
  fees: number | null = 0,
  executedAt = '2026-01-10T10:00:00Z',
): ExecutionData {
  return { action, quantity, price, fees, executedAt };
}

// ────────────────────────────────────────────────────────────────────────
// Tests: computeOpenPosition
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeOpenPosition');

  // --- Positive tests ---

  // 1. Long: single entry, no exit → fully open
  {
    const r = computeOpenPosition([exec('buy', 100, 50)], 'long');
    assertApprox(r.avgEntryPrice!, 50, 'single long entry → avg 50');
    assert(r.openQuantity === 100, 'single long entry → open 100');
  }

  // 2. Long: multiple entries (add action)
  {
    const r = computeOpenPosition(
      [
        exec('buy', 50, 48),
        exec('add', 50, 52),
      ],
      'long',
    );
    // Weighted avg: (50*48 + 50*52) / 100 = (2400+2600)/100 = 50
    assertApprox(r.avgEntryPrice!, 50, 'multiple long entries → avg 50');
    assert(r.openQuantity === 100, 'multiple long entries → open 100');
  }

  // 3. Long: partial exit → reduced open quantity
  {
    const r = computeOpenPosition(
      [
        exec('buy', 100, 50, 0, '2026-01-10T10:00:00Z'),
        exec('sell', 30, 55, 0, '2026-01-10T14:00:00Z'),
      ],
      'long',
    );
    assertApprox(r.avgEntryPrice!, 50, 'long partial exit → avg 50');
    assert(r.openQuantity === 70, 'long partial exit → open 70');
  }

  // 4. Long: full exit → flat (open 0)
  {
    const r = computeOpenPosition(
      [
        exec('buy', 100, 50, 0, '2026-01-10T10:00:00Z'),
        exec('sell', 100, 60, 0, '2026-01-10T14:00:00Z'),
      ],
      'long',
    );
    assert(r.avgEntryPrice === null, 'long full exit → avg null');
    assert(r.openQuantity === 0, 'long full exit → open 0');
  }

  // 5. Short: single entry (sell_short), no exit
  {
    const r = computeOpenPosition([exec('sell_short', 200, 100)], 'short');
    assertApprox(r.avgEntryPrice!, 100, 'short single entry → avg 100');
    assert(r.openQuantity === 200, 'short single entry → open 200');
  }

  // 6. Short: partial exit (buy_to_cover)
  {
    const r = computeOpenPosition(
      [
        exec('sell_short', 100, 80, 0, '2026-01-10T09:00:00Z'),
        exec('buy_to_cover', 40, 78, 0, '2026-01-10T11:00:00Z'),
      ],
      'short',
    );
    assertApprox(r.avgEntryPrice!, 80, 'short partial exit → avg 80');
    assert(r.openQuantity === 60, 'short partial exit → open 60');
  }

  // 7. Reduce action treated as exit (long)
  {
    const r = computeOpenPosition(
      [
        exec('buy', 100, 50, 0, '2026-01-10T10:00:00Z'),
        exec('reduce', 40, 55, 0, '2026-01-10T13:00:00Z'),
      ],
      'long',
    );
    assert(r.openQuantity === 60, 'reduce → open 60');
  }

  // --- Negative / edge cases ---

  // 8. No entries → flat
  {
    const r = computeOpenPosition([], 'long');
    assertNull(r.avgEntryPrice, 'no entries → avg null');
    assert(r.openQuantity === 0, 'no entries → open 0');
  }

  // 9. Only exit actions, no entries → flat
  {
    const r = computeOpenPosition([exec('sell', 100, 55)], 'long');
    assertNull(r.avgEntryPrice, 'exits only → avg null');
    assert(r.openQuantity === 0, 'exits only → open 0');
  }

  // 10. Over-exit (exit > entry) → flat
  {
    const r = computeOpenPosition(
      [
        exec('buy', 100, 50, 0, '2026-01-10T10:00:00Z'),
        exec('sell', 150, 55, 0, '2026-01-10T14:00:00Z'),
      ],
      'long',
    );
    assertNull(r.avgEntryPrice, 'over-exit → avg null');
    assert(r.openQuantity === 0, 'over-exit → open 0');
  }

  // 11. Zero quantity entries → flat
  {
    const r = computeOpenPosition([exec('buy', 0, 50)], 'long');
    assertNull(r.avgEntryPrice, 'zero qty entry → avg null');
    assert(r.openQuantity === 0, 'zero qty entry → open 0');
  }

  // 12. Empty array → flat
  {
    const r = computeOpenPosition([], 'short');
    assertNull(r.avgEntryPrice, 'empty array short → avg null');
    assert(r.openQuantity === 0, 'empty array short → open 0');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: calculateUnrealizedPnL
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculateUnrealizedPnL');

  // --- Positive tests (exclude_entry_fees) ---

  // 1. Long: unrealized profit
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('buy', 100, 50)],
      direction: 'long',
      currentPrice: 60,
      feePolicy: 'exclude_entry_fees',
    });
    assertApprox(r!, 1000, 'long profit (60-50)*100 = 1000');
  }

  // 2. Long: unrealized loss
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('buy', 100, 50)],
      direction: 'long',
      currentPrice: 40,
      feePolicy: 'exclude_entry_fees',
    });
    assertApprox(r!, -1000, 'long loss (40-50)*100 = -1000');
  }

  // 3. Short: unrealized profit
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('sell_short', 100, 100)],
      direction: 'short',
      currentPrice: 90,
      feePolicy: 'exclude_entry_fees',
    });
    assertApprox(r!, 1000, 'short profit (100-90)*100 = 1000');
  }

  // 4. Short: unrealized loss
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('sell_short', 100, 100)],
      direction: 'short',
      currentPrice: 110,
      feePolicy: 'exclude_entry_fees',
    });
    assertApprox(r!, -1000, 'short loss (100-110)*100 = -1000');
  }

  // 5. Partial exit: P&L computed on remaining open qty only
  {
    const r = calculateUnrealizedPnL({
      executions: [
        exec('buy', 100, 50, 0, '2026-01-10T10:00:00Z'),
        exec('sell', 30, 55, 0, '2026-01-10T14:00:00Z'),
      ],
      direction: 'long',
      currentPrice: 65,
      feePolicy: 'exclude_entry_fees',
    });
    // Open qty = 70, avg price = 50
    // (65 - 50) * 70 = 15 * 70 = 1050
    assertApprox(r!, 1050, 'partial exit → P&L on open qty 1050');
  }

  // 6. Multiple entries with weighted avg price
  {
    const r = calculateUnrealizedPnL({
      executions: [
        exec('buy', 100, 40, 0, '2026-01-10T10:00:00Z'),
        exec('add', 100, 60, 0, '2026-01-10T11:00:00Z'),
      ],
      direction: 'long',
      currentPrice: 55,
      feePolicy: 'exclude_entry_fees',
    });
    // avg = (100*40 + 100*60)/200 = 50
    // (55 - 50) * 200 = 1000
    assertApprox(r!, 1000, 'weighted avg → P&L 1000');
  }

  // --- Positive tests (include_entry_fees) ---

  // 7. include_entry_fees: subtracts entry fees
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('buy', 100, 50, 15)],
      direction: 'long',
      currentPrice: 60,
      feePolicy: 'include_entry_fees',
    });
    // (60-50)*100 = 1000, less 15 fees = 985
    assertApprox(r!, 985, 'include_entry_fees → 1000 - 15 = 985');
  }

  // 8. include_entry_fees: multiple entries with fees
  {
    const r = calculateUnrealizedPnL({
      executions: [
        exec('buy', 50, 48, 5, '2026-01-10T10:00:00Z'),
        exec('add', 50, 52, 3, '2026-01-10T11:00:00Z'),
      ],
      direction: 'long',
      currentPrice: 55,
      feePolicy: 'include_entry_fees',
    });
    // avg = (50*48 + 50*52)/100 = 50
    // (55-50)*100 = 500, less 5+3=8 fees = 492
    assertApprox(r!, 492, 'multiple entry fees → 500 - 8 = 492');
  }

  // 9. exclude_entry_fees overrides fee subtraction even with fees present
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('buy', 100, 50, 15)],
      direction: 'long',
      currentPrice: 60,
      feePolicy: 'exclude_entry_fees',
    });
    // (60-50)*100 = 1000, no fee subtraction
    assertApprox(r!, 1000, 'exclude_entry_fees → 1000, fees ignored');
  }

  // 10. include_entry_fees with zero fees → same as exclude
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('buy', 100, 50, 0)],
      direction: 'long',
      currentPrice: 60,
      feePolicy: 'include_entry_fees',
    });
    assertApprox(r!, 1000, 'include_entry_fees with 0 fees → 1000');
  }

  // 11. Short with include_entry_fees
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('sell_short', 100, 100, 8)],
      direction: 'short',
      currentPrice: 90,
      feePolicy: 'include_entry_fees',
    });
    // (100-90)*100 = 1000, less 8 fees = 992
    assertApprox(r!, 992, 'short include_entry_fees → 992');
  }

  // 12. Partial exit with include_entry_fees
  {
    const r = calculateUnrealizedPnL({
      executions: [
        exec('buy', 100, 50, 10, '2026-01-10T10:00:00Z'),
        exec('sell', 30, 55, 0, '2026-01-10T14:00:00Z'),
      ],
      direction: 'long',
      currentPrice: 65,
      feePolicy: 'include_entry_fees',
    });
    // avg = 50, open = 70
    // (65-50)*70 = 1050, less 10 entry fees = 1040
    assertApprox(r!, 1040, 'partial exit include_entry_fees → 1040');
  }

  // --- Negative / edge cases ---

  // 13. Flat position (no entries) → null
  {
    const r = calculateUnrealizedPnL({
      executions: [],
      direction: 'long',
      currentPrice: 60,
      feePolicy: 'exclude_entry_fees',
    });
    assertNull(r, 'no entries → null');
  }

  // 14. Fully exited position → null
  {
    const r = calculateUnrealizedPnL({
      executions: [
        exec('buy', 100, 50, 0, '2026-01-10T10:00:00Z'),
        exec('sell', 100, 60, 0, '2026-01-10T14:00:00Z'),
      ],
      direction: 'long',
      currentPrice: 65,
      feePolicy: 'exclude_entry_fees',
    });
    assertNull(r, 'fully exited → null');
  }

  // 15. Zero quantity entry → null
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('buy', 0, 50)],
      direction: 'long',
      currentPrice: 60,
      feePolicy: 'exclude_entry_fees',
    });
    assertNull(r, 'zero qty entry → null');
  }

  // 16. Null fees with include_entry_fees → treated as 0
  {
    const r = calculateUnrealizedPnL({
      executions: [{ action: 'buy', quantity: 100, price: 50, fees: null, executedAt: '2026-01-10T10:00:00Z' }],
      direction: 'long',
      currentPrice: 60,
      feePolicy: 'include_entry_fees',
    });
    assertApprox(r!, 1000, 'null fees → treated as 0 → 1000');
  }

  // 17. P&L at breakeven (currentPrice === avgEntryPrice) → 0
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('buy', 100, 50)],
      direction: 'long',
      currentPrice: 50,
      feePolicy: 'exclude_entry_fees',
    });
    assertApprox(r!, 0, 'breakeven → 0');
  }

  // 18. Short: at breakeven → 0
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('sell_short', 100, 50)],
      direction: 'short',
      currentPrice: 50,
      feePolicy: 'exclude_entry_fees',
    });
    assertApprox(r!, 0, 'short breakeven → 0');
  }

  // 19. Large numbers: no overflow issues
  {
    const r = calculateUnrealizedPnL({
      executions: [exec('buy', 10000, 150.25)],
      direction: 'long',
      currentPrice: 175.50,
      feePolicy: 'exclude_entry_fees',
    });
    // (175.50 - 150.25) * 10000 = 25.25 * 10000 = 252500
    assertApprox(r!, 252500, 'large position → 252500');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: computeMarkToMarketSummary
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## computeMarkToMarketSummary');

  // Helper to build OpenTrade quickly
  const trade = (
    direction: Direction,
    currentPrice: number | null,
    execs: ExecutionData[],
  ): OpenTrade => ({ executions: execs, direction, currentPrice });

  const longOpenTrade = trade('long', 60, [exec('buy', 100, 50)]);
  const shortOpenTrade = trade('short', 90, [exec('sell_short', 100, 100)]);

  // --- Positive tests ---

  // 1. Single open trade (long, profit)
  {
    const r = computeMarkToMarketSummary([longOpenTrade], 'exclude_entry_fees');
    assertApprox(r.netUnrealizedPnl!, 1000, 'single long trade → P&L 1000');
    assert(r.tradesWithPrices === 1, 'single long → tradesWithPrices 1');
    assert(r.tradesAwaitingData === 0, 'single long → awaiting 0');
    assert(r.openTradeCount === 1, 'single long → count 1');
  }

  // 2. Two trades: long profit + short profit
  {
    const r = computeMarkToMarketSummary(
      [longOpenTrade, shortOpenTrade],
      'exclude_entry_fees',
    );
    // long: 1000, short: (100-90)*100=1000, total=2000
    assertApprox(r.netUnrealizedPnl!, 2000, 'two profitable trades → 2000');
    assert(r.tradesWithPrices === 2, 'two trades → tradesWithPrices 2');
    assert(r.openTradeCount === 2, 'two trades → count 2');
  }

  // 3. Mix: one with price, one awaiting data
  {
    const awaitingTrade = trade('long', null, [exec('buy', 50, 30)]);
    const r = computeMarkToMarketSummary(
      [longOpenTrade, awaitingTrade],
      'exclude_entry_fees',
    );
    assertApprox(r.netUnrealizedPnl!, 1000, 'one priced one awaiting → 1000');
    assert(r.tradesWithPrices === 1, 'mix → tradesWithPrices 1');
    assert(r.tradesAwaitingData === 1, 'mix → awaiting 1');
    assert(r.openTradeCount === 2, 'mix → count 2');
  }

  // 4. All trades awaiting data → netUnrealizedPnl null
  {
    const r = computeMarkToMarketSummary(
      [
        trade('long', null, [exec('buy', 100, 50)]),
        trade('short', null, [exec('sell_short', 50, 80)]),
      ],
      'exclude_entry_fees',
    );
    assertNull(r.netUnrealizedPnl, 'all awaiting → net null');
    assert(r.tradesWithPrices === 0, 'all awaiting → tradesWithPrices 0');
    assert(r.tradesAwaitingData === 2, 'all awaiting → awaiting 2');
    assert(r.openTradeCount === 2, 'all awaiting → count 2');
  }

  // 5. Dashboard scenario: include_entry_fees with 2 trades
  {
    const tradeWithFees: OpenTrade = trade('long', 65, [
      exec('buy', 100, 50, 12),
    ]);
    const tradeNoFees: OpenTrade = trade('long', 45, [
      exec('buy', 50, 40, 5),
    ]);
    // tradeWithFees: (65-50)*100=1500 less 12=1488
    // tradeNoFees: (45-40)*50=250 less 5=245
    // total = 1733
    const r = computeMarkToMarketSummary(
      [tradeWithFees, tradeNoFees],
      'include_entry_fees',
    );
    assertApprox(r.netUnrealizedPnl!, 1733, 'dashboard scenario → 1733');
    assert(r.tradesWithPrices === 2, 'dashboard → both priced');
    assert(r.openTradeCount === 2, 'dashboard → count 2');
  }

  // 6. All trades awaiting data via undefined currentPrice
  {
    const r = computeMarkToMarketSummary(
      [trade('long', undefined as unknown as null, [exec('buy', 100, 50)])],
      'exclude_entry_fees',
    );
    assertNull(r.netUnrealizedPnl, 'undefined price → null');
    assert(r.tradesAwaitingData === 1, 'undefined price → awaiting 1');
  }

  // --- Negative / edge cases ---

  // 7. Empty array → net null, all counts 0
  {
    const r = computeMarkToMarketSummary([], 'exclude_entry_fees');
    assertNull(r.netUnrealizedPnl, 'empty → net null');
    assert(r.tradesWithPrices === 0, 'empty → tradesWithPrices 0');
    assert(r.tradesAwaitingData === 0, 'empty → awaiting 0');
    assert(r.openTradeCount === 0, 'empty → count 0');
  }

  // 8. Trade with flat position (fully exited) — skipped, no P&L contribution
  {
    const flatTrade: OpenTrade = trade('long', 70, [
      exec('buy', 100, 50, 0, '2026-01-10T10:00:00Z'),
      exec('sell', 100, 60, 0, '2026-01-10T14:00:00Z'),
    ]);
    const r = computeMarkToMarketSummary([flatTrade], 'exclude_entry_fees');
    // Flat position → calculateUnrealizedPnL returns null, so no P&L added
    assertApprox(r.netUnrealizedPnl!, 0, 'flat position → net 0');
    assert(r.tradesWithPrices === 1, 'flat position → priced 1 (price exists)');
    assert(r.openTradeCount === 1, 'flat position → count 1');
  }

  // 9. Loss on all trades
  {
    const lossTrade: OpenTrade = trade('long', 30, [exec('buy', 100, 50)]);
    const r = computeMarkToMarketSummary([lossTrade], 'exclude_entry_fees');
    assertApprox(r.netUnrealizedPnl!, -2000, 'loss trade → -2000');
  }

  // 10. Loss and profit cancel each other
  {
    const profitTrade = trade('long', 60, [exec('buy', 100, 50)]);    // +1000
    const lossTrade = trade('short', 110, [exec('sell_short', 100, 100)]); // -1000
    const r = computeMarkToMarketSummary([profitTrade, lossTrade], 'exclude_entry_fees');
    assertApprox(r.netUnrealizedPnl!, 0, 'profit + loss cancel → 0');
  }

  // 11. Zero quantity trade with price → net 0 (trade has a price but no position)
  {
    const zeroQtyTrade: OpenTrade = trade('long', 60, [exec('buy', 0, 50)]);
    const r = computeMarkToMarketSummary([zeroQtyTrade], 'exclude_entry_fees');
    // calculateUnrealizedPnL returns null (zero open qty), trade has a currentPrice
    // so anyWithPrices is true → net is 0 (no position generates P&L)
    assertApprox(r.netUnrealizedPnl!, 0, 'zero qty trade → net 0');
    assert(r.tradesWithPrices === 1, 'zero qty → priced 1');
  }

  // 12. Dashboard: include_entry_fees applied to aggregate summary
  {
    const r = computeMarkToMarketSummary(
      [longOpenTrade],
      'include_entry_fees',
    );
    // (60-50)*100 = 1000, no entry fees on this trade → 1000
    assertApprox(r.netUnrealizedPnl!, 1000, 'include fees but none present → 1000');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
