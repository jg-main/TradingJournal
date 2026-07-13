/**
 * position-sizing.test.ts
 *
 * Comprehensive tests for the position sizing library.
 * Covers basic calculations, edge cases, and error conditions.
 *
 * Run: npx tsx src/lib/position-sizing.test.ts
 */

import { calculatePositionSize, calculatePlanRiskRewardPreview } from './position-sizing';

let passed = 0;
let failed = 0;

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

function assertNull(v: unknown, msg: string) {
  if (v === null) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected null, got ${v} (FAILED)`);
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
// Tests: calculatePlanRiskRewardPreview
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculatePlanRiskRewardPreview');

  // 1. Long with all inputs
  // entry=100, stop=95, target=115, qty=40, long
  // riskPct = ((100-95)/100)*100 = 5
  // riskDollar = (5/100)*100*40 = 200
  // rewardPct = ((115-100)/100)*100 = 15
  // rewardDollar = (15/100)*100*40 = 600
  // rr = 15/5 = 3
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 100,
      stopPrice: 95,
      targetPrice: 115,
      quantity: 40,
      direction: 'long',
    });
    assertApprox(r.riskPct!, 5, 'long: riskPct = 5');
    assertApprox(r.riskDollar!, 200, 'long: riskDollar = 200');
    assertApprox(r.rewardPct!, 15, 'long: rewardPct = 15');
    assertApprox(r.rewardDollar!, 600, 'long: rewardDollar = 600');
    assertApprox(r.riskRewardRatio!, 3, 'long: rr = 3');
  }

  // 2. Short with all inputs
  // entry=80, stop=85, target=70, qty=20, short
  // riskPct = ((85-80)/80)*100 = 6.25
  // riskDollar = (6.25/100)*80*20 = 100
  // rewardPct = ((80-70)/80)*100 = 12.5
  // rewardDollar = (12.5/100)*80*20 = 200
  // rr = 12.5/6.25 = 2
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 80,
      stopPrice: 85,
      targetPrice: 70,
      quantity: 20,
      direction: 'short',
    });
    assertApprox(r.riskPct!, 6.25, 'short: riskPct = 6.25');
    assertApprox(r.riskDollar!, 100, 'short: riskDollar = 100');
    assertApprox(r.rewardPct!, 12.5, 'short: rewardPct = 12.5');
    assertApprox(r.rewardDollar!, 200, 'short: rewardDollar = 200');
    assertApprox(r.riskRewardRatio!, 2, 'short: rr = 2');
  }

  // 3. Long, no quantity
  // riskDollar/rewardDollar should be 0 (qty defaults to 0)
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 100,
      stopPrice: 95,
      targetPrice: 115,
      direction: 'long',
    });
    assertApprox(r.riskPct!, 5, 'no qty: riskPct = 5');
    assertApprox(r.riskDollar!, 0, 'no qty: riskDollar = 0');
    assertApprox(r.rewardPct!, 15, 'no qty: rewardPct = 15');
    assertApprox(r.rewardDollar!, 0, 'no qty: rewardDollar = 0');
    assertApprox(r.riskRewardRatio!, 3, 'no qty: rr = 3');
  }

  // 4. Long, no target (only stop)
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 100,
      stopPrice: 95,
      quantity: 40,
      direction: 'long',
    });
    assertApprox(r.riskPct!, 5, 'no target: riskPct = 5');
    assertApprox(r.riskDollar!, 200, 'no target: riskDollar = 200');
    assertNull(r.rewardPct, 'no target: rewardPct null');
    assertNull(r.rewardDollar, 'no target: rewardDollar null');
    assertNull(r.riskRewardRatio, 'no target: rr null');
  }

  // 5. Long, no stop (only target)
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 100,
      targetPrice: 115,
      quantity: 40,
      direction: 'long',
    });
    assertNull(r.riskPct, 'no stop: riskPct null');
    assertNull(r.riskDollar, 'no stop: riskDollar null');
    assertApprox(r.rewardPct!, 15, 'no stop: rewardPct = 15');
    assertApprox(r.rewardDollar!, 600, 'no stop: rewardDollar = 600');
    assertNull(r.riskRewardRatio, 'no stop: rr null');
  }

  // 6. Only entry (no stop, no target, no qty)
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 100,
      direction: 'long',
    });
    assertNull(r.riskPct, 'only entry: riskPct null');
    assertNull(r.riskDollar, 'only entry: riskDollar null');
    assertNull(r.rewardPct, 'only entry: rewardPct null');
    assertNull(r.rewardDollar, 'only entry: rewardDollar null');
    assertNull(r.riskRewardRatio, 'only entry: rr null');
  }

  // 7. Entry price = 0 → all null
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 0,
      stopPrice: 95,
      targetPrice: 115,
      quantity: 40,
      direction: 'long',
    });
    assertNull(r.riskPct, 'zero entry: riskPct null');
    assertNull(r.riskDollar, 'zero entry: riskDollar null');
    assertNull(r.rewardPct, 'zero entry: rewardPct null');
    assertNull(r.rewardDollar, 'zero entry: rewardDollar null');
    assertNull(r.riskRewardRatio, 'zero entry: rr null');
  }

  // 8. Entry price negative → all null
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: -50,
      stopPrice: 95,
      targetPrice: 115,
      quantity: 40,
      direction: 'long',
    });
    assertNull(r.riskPct, 'negative entry: riskPct null');
    assertNull(r.riskDollar, 'negative entry: riskDollar null');
    assertNull(r.rewardPct, 'negative entry: rewardPct null');
    assertNull(r.rewardDollar, 'negative entry: rewardDollar null');
    assertNull(r.riskRewardRatio, 'negative entry: rr null');
  }

  // 9. Short, no quantity
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 80,
      stopPrice: 85,
      targetPrice: 70,
      direction: 'short',
    });
    assertApprox(r.riskPct!, 6.25, 'short no qty: riskPct = 6.25');
    assertApprox(r.riskDollar!, 0, 'short no qty: riskDollar = 0');
    assertApprox(r.rewardPct!, 12.5, 'short no qty: rewardPct = 12.5');
    assertApprox(r.rewardDollar!, 0, 'short no qty: rewardDollar = 0');
    assertApprox(r.riskRewardRatio!, 2, 'short no qty: rr = 2');
  }

  // 10. No stop, no target, no qty (only direction and entry)
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 100,
      direction: 'short',
    });
    assertNull(r.riskPct, 'short only entry: riskPct null');
    assertNull(r.riskDollar, 'short only entry: riskDollar null');
    assertNull(r.rewardPct, 'short only entry: rewardPct null');
    assertNull(r.rewardDollar, 'short only entry: rewardDollar null');
    assertNull(r.riskRewardRatio, 'short only entry: rr null');
  }

  // 11. Qty explicitly 0 — same as no qty
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 100,
      stopPrice: 95,
      targetPrice: 115,
      quantity: 0,
      direction: 'long',
    });
    assertApprox(r.riskPct!, 5, 'qty=0: riskPct = 5');
    assertApprox(r.riskDollar!, 0, 'qty=0: riskDollar = 0');
    assertApprox(r.rewardPct!, 15, 'qty=0: rewardPct = 15');
    assertApprox(r.rewardDollar!, 0, 'qty=0: rewardDollar = 0');
    assertApprox(r.riskRewardRatio!, 3, 'qty=0: rr = 3');
  }

  // 12. Verify exact in-form behavior: risk with qty=NaN via parseFloat('')
  // In the form, parseFloat('') returns NaN, and (NaN || 0) yields 0.
  // Our helper uses (quantity ?? 0), so undefined qty → 0, which matches.
  {
    const r = calculatePlanRiskRewardPreview({
      entryPrice: 100,
      stopPrice: 95,
      targetPrice: 115,
      direction: 'long',
    });
    assertApprox(r.riskDollar!, 0, 'undefined qty: riskDollar = 0 (matches (NaN || 0) behavior)');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
