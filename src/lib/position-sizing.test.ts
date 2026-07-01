/**
 * position-sizing.test.ts
 *
 * Comprehensive tests for the position sizing library.
 * Covers basic calculations, edge cases, and error conditions.
 *
 * Run: npx tsx src/lib/position-sizing.test.ts
 */

import { calculatePositionSize } from './position-sizing';

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

function assertThrows(fn: () => void, msg: string) {
  try {
    fn();
    failed++;
    console.error(`  ❌ ${msg} — expected throw but did not throw (FAILED)`);
  } catch {
    passed++;
    console.log(`  ✅ ${msg}`);
  }
}

function assertUndefined(v: unknown, msg: string) {
  if (v === undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected undefined, got ${v} (FAILED)`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: calculatePositionSize
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculatePositionSize');

  // --- Positive tests ---

  // 1. Basic long calculation with known values
  // Account: $10,000, risk 2%, entry $100, stop $95, long
  // riskPerShare = |100 - 95| = $5
  // dollarRisk = 10000 * 2% = $200
  // positionSize = 200 / 5 = 40 shares
  // riskAmount = 40 * 5 = $200
  {
    const r = calculatePositionSize({
      accountEquity: 10000,
      riskPerTradePct: 2,
      entryPrice: 100,
      stopPrice: 95,
      direction: 'long',
    });
    assertApprox(r.riskPerShare, 5, 'long: riskPerShare = 5');
    assertApprox(r.positionSize, 40, 'long: positionSize = 40');
    assertApprox(r.riskAmount, 200, 'long: riskAmount = 200');
    assertUndefined(r.rewardRiskRatio, 'long without target: rewardRiskRatio undefined');
  }

  // 2. Basic short calculation
  // Account: $50,000, risk 1%, entry $200, stop $210, short
  // riskPerShare = |200 - 210| = $10
  // dollarRisk = 50000 * 1% = $500
  // positionSize = 500 / 10 = 50 shares
  {
    const r = calculatePositionSize({
      accountEquity: 50000,
      riskPerTradePct: 1,
      entryPrice: 200,
      stopPrice: 210,
      direction: 'short',
    });
    assertApprox(r.riskPerShare, 10, 'short: riskPerShare = 10');
    assertApprox(r.positionSize, 50, 'short: positionSize = 50');
    assertApprox(r.riskAmount, 500, 'short: riskAmount = 500');
  }

  // 3. Long with target price for RR ratio
  // Account: $10,000, risk 2%, entry $100, stop $95, target $115, long
  // riskPerShare = $5
  // rewardRiskRatio = |115 - 100| / 5 = 15 / 5 = 3
  {
    const r = calculatePositionSize({
      accountEquity: 10000,
      riskPerTradePct: 2,
      entryPrice: 100,
      stopPrice: 95,
      direction: 'long',
      targetPrice: 115,
    });
    assertApprox(r.rewardRiskRatio!, 3, 'long with target: RR = 3');
    assertApprox(r.positionSize, 40, 'long with target: positionSize = 40');
  }

  // 4. Short with target price for RR ratio
  // Account: $10,000, risk 1%, entry $80, stop $85, target $70, short
  // riskPerShare = |80 - 85| = $5
  // rewardRiskRatio = |70 - 80| / 5 = 10 / 5 = 2
  {
    const r = calculatePositionSize({
      accountEquity: 10000,
      riskPerTradePct: 1,
      entryPrice: 80,
      stopPrice: 85,
      direction: 'short',
      targetPrice: 70,
    });
    assertApprox(r.rewardRiskRatio!, 2, 'short with target: RR = 2');
    assertApprox(r.positionSize, 20, 'short with target: positionSize = 20');
  }

  // 5. Small account, small risk
  // Account: $500, risk 0.5%, entry $10, stop $9.50, long
  // riskPerShare = |10 - 9.50| = $0.50
  // dollarRisk = 500 * 0.5% = $2.50
  // positionSize = 2.50 / 0.50 = 5 shares
  {
    const r = calculatePositionSize({
      accountEquity: 500,
      riskPerTradePct: 0.5,
      entryPrice: 10,
      stopPrice: 9.5,
      direction: 'long',
    });
    assertApprox(r.riskPerShare, 0.5, 'small: riskPerShare = 0.5');
    assertApprox(r.positionSize, 5, 'small: positionSize = 5');
    assertApprox(r.riskAmount, 2.5, 'small: riskAmount = 2.5');
  }

  // 6. Fractional position size
  // Account: $10,000, risk 1%, entry $150.25, stop $149.00, long
  // riskPerShare = |150.25 - 149.00| = $1.25
  // dollarRisk = 10000 * 1% = $100
  // positionSize = 100 / 1.25 = 80 shares
  {
    const r = calculatePositionSize({
      accountEquity: 10000,
      riskPerTradePct: 1,
      entryPrice: 150.25,
      stopPrice: 149.0,
      direction: 'long',
    });
    assertApprox(r.riskPerShare, 1.25, 'fractional: riskPerShare = 1.25');
    assertApprox(r.positionSize, 80, 'fractional: positionSize = 80');
  }

  // 7. Tight stop, large position
  // Account: $100,000, risk 0.5%, entry $500, stop $499, long
  // riskPerShare = $1
  // dollarRisk = 100000 * 0.5% = $500
  // positionSize = 500 / 1 = 500 shares
  {
    const r = calculatePositionSize({
      accountEquity: 100000,
      riskPerTradePct: 0.5,
      entryPrice: 500,
      stopPrice: 499,
      direction: 'long',
    });
    assertApprox(r.riskPerShare, 1, 'tight stop: riskPerShare = 1');
    assertApprox(r.positionSize, 500, 'tight stop: positionSize = 500');
  }

  // --- Negative / edge cases ---

  // 8. Zero accountEquity throws
  assertThrows(
    () =>
      calculatePositionSize({
        accountEquity: 0,
        riskPerTradePct: 1,
        entryPrice: 100,
        stopPrice: 95,
        direction: 'long',
      }),
    'zero equity throws',
  );

  // 9. Negative accountEquity throws
  assertThrows(
    () =>
      calculatePositionSize({
        accountEquity: -1000,
        riskPerTradePct: 1,
        entryPrice: 100,
        stopPrice: 95,
        direction: 'long',
      }),
    'negative equity throws',
  );

  // 10. Zero riskPerTradePct throws
  assertThrows(
    () =>
      calculatePositionSize({
        accountEquity: 10000,
        riskPerTradePct: 0,
        entryPrice: 100,
        stopPrice: 95,
        direction: 'long',
      }),
    'zero risk percentage throws',
  );

  // 11. Entry price equals stop price throws (riskPerShare = 0)
  assertThrows(
    () =>
      calculatePositionSize({
        accountEquity: 10000,
        riskPerTradePct: 1,
        entryPrice: 100,
        stopPrice: 100,
        direction: 'long',
      }),
    'entry equals stop throws',
  );

  // 12. Zero entry price throws
  assertThrows(
    () =>
      calculatePositionSize({
        accountEquity: 10000,
        riskPerTradePct: 1,
        entryPrice: 0,
        stopPrice: 95,
        direction: 'long',
      }),
    'zero entry price throws',
  );

  // 13. Zero stop price throws
  assertThrows(
    () =>
      calculatePositionSize({
        accountEquity: 10000,
        riskPerTradePct: 1,
        entryPrice: 100,
        stopPrice: 0,
        direction: 'long',
      }),
    'zero stop price throws',
  );

  // 14. NaN accountEquity throws
  assertThrows(
    () =>
      calculatePositionSize({
        accountEquity: NaN,
        riskPerTradePct: 1,
        entryPrice: 100,
        stopPrice: 95,
        direction: 'long',
      }),
    'NaN equity throws',
  );

  // 15. NaN riskPerTradePct throws
  assertThrows(
    () =>
      calculatePositionSize({
        accountEquity: 10000,
        riskPerTradePct: NaN,
        entryPrice: 100,
        stopPrice: 95,
        direction: 'long',
      }),
    'NaN risk percentage throws',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
