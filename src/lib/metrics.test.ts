/**
 * metrics.test.ts
 *
 * Unit tests for all functions in src/lib/metrics.ts.
 * Pure function tests — no database required.
 *
 * Run: npx tsx src/lib/metrics.test.ts
 *
 * Pattern: src/lib/dashboard.test.ts, src/lib/trade-calc.test.ts
 */

import {
  classifyPnlDecision,
  computeWinRate,
  average,
  averageRMultiples,
  averageProcessScore,
  type WinRatePolicy,
} from './metrics';

// ── Helpers ─────────────────────────────────────────────────────────────

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${e}`);
    console.error(`     actual:   ${a}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${label}`);
  }
}

function assertClose(actual: number | null, expected: number | null, label: string, tolerance = 0.001): void {
  if (actual === null && expected === null) {
    console.log(`  ✅ PASS: ${label} (both null)`);
    return;
  }
  if (actual === null || expected === null) {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${expected}, actual: ${actual}`);
    process.exitCode = 1;
    return;
  }
  if (Math.abs(actual - expected) > tolerance) {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${expected}, actual: ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${label}`);
  }
}

function assertNull(actual: unknown, label: string): void {
  if (actual === null) {
    console.log(`  ✅ PASS: ${label}`);
  } else {
    console.error(`  ❌ FAIL: ${label} — expected null, got ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }
}

let testCount = 0;

function test(name: string, fn: () => void): void {
  testCount++;
  console.log(`\n#${testCount}: ${name}`);
  fn();
}

// ── classifyPnlDecision — IncludeZeroAsLoss ─────────────────────────────

test('classifyPnlDecision — includeZeroAsLoss: positive PnL = win', () => {
  assertEqual(classifyPnlDecision(100, 'includeZeroAsLoss'), 'win', 'positive => win');
});

test('classifyPnlDecision — includeZeroAsLoss: negative PnL = loss', () => {
  assertEqual(classifyPnlDecision(-100, 'includeZeroAsLoss'), 'loss', 'negative => loss');
});

test('classifyPnlDecision — includeZeroAsLoss: zero PnL = loss', () => {
  assertEqual(classifyPnlDecision(0, 'includeZeroAsLoss'), 'loss', 'zero => loss');
});

test('classifyPnlDecision — includeZeroAsLoss: very small positive = win', () => {
  assertEqual(classifyPnlDecision(0.01, 'includeZeroAsLoss'), 'win', '0.01 => win');
});

test('classifyPnlDecision — includeZeroAsLoss: very small negative = loss', () => {
  assertEqual(classifyPnlDecision(-0.01, 'includeZeroAsLoss'), 'loss', '-0.01 => loss');
});

// ── classifyPnlDecision — ExcludeScratches ──────────────────────────────

test('classifyPnlDecision — excludeScratches: positive PnL = win', () => {
  assertEqual(classifyPnlDecision(100, 'excludeScratches'), 'win', 'positive => win');
});

test('classifyPnlDecision — excludeScratches: negative PnL = loss', () => {
  assertEqual(classifyPnlDecision(-100, 'excludeScratches'), 'loss', 'negative => loss');
});

test('classifyPnlDecision — excludeScratches: zero PnL = scratch', () => {
  assertEqual(classifyPnlDecision(0, 'excludeScratches'), 'scratch', 'zero => scratch');
});

test('classifyPnlDecision — excludeScratches: very small positive = win', () => {
  assertEqual(classifyPnlDecision(0.01, 'excludeScratches'), 'win', '0.01 => win');
});

test('classifyPnlDecision — excludeScratches: very small negative = loss', () => {
  assertEqual(classifyPnlDecision(-0.01, 'excludeScratches'), 'loss', '-0.01 => loss');
});

// ── classifyPnlDecision — AllDecisions ──────────────────────────────────

test('classifyPnlDecision — allDecisions: positive PnL = win', () => {
  assertEqual(classifyPnlDecision(100, 'allDecisions'), 'win', 'positive => win');
});

test('classifyPnlDecision — allDecisions: negative PnL = loss', () => {
  assertEqual(classifyPnlDecision(-100, 'allDecisions'), 'loss', 'negative => loss');
});

test('classifyPnlDecision — allDecisions: zero PnL = loss', () => {
  assertEqual(classifyPnlDecision(0, 'allDecisions'), 'loss', 'zero => loss');
});

test('classifyPnlDecision — allDecisions: very small positive = win', () => {
  assertEqual(classifyPnlDecision(0.01, 'allDecisions'), 'win', '0.01 => win');
});

test('classifyPnlDecision — allDecisions: very small negative = loss', () => {
  assertEqual(classifyPnlDecision(-0.01, 'allDecisions'), 'loss', '-0.01 => loss');
});

// ── computeWinRate — IncludeZeroAsLoss ──────────────────────────────────

test('computeWinRate — includeZeroAsLoss: 2 wins, 1 loss', () => {
  assertClose(computeWinRate([1000, -500, 2000], 'includeZeroAsLoss'), 2 / 3, '2/3 = 0.667');
});

test('computeWinRate — includeZeroAsLoss: scratch counted as loss', () => {
  // 1 win, 1 loss, 1 scratch (zero PnL) — scratch counted as loss
  assertClose(computeWinRate([1000, -500, 0], 'includeZeroAsLoss'), 1 / 3, '1 win / 3 decisions = 0.333');
});

test('computeWinRate — includeZeroAsLoss: all wins', () => {
  assertClose(computeWinRate([100, 200, 300], 'includeZeroAsLoss'), 1, '3/3 = 1.0');
});

test('computeWinRate — includeZeroAsLoss: all losses', () => {
  assertClose(computeWinRate([-100, -200, 0], 'includeZeroAsLoss'), 0, '0/3 = 0');
});

test('computeWinRate — includeZeroAsLoss: empty array returns null', () => {
  assertNull(computeWinRate([], 'includeZeroAsLoss'), 'empty => null');
});

test('computeWinRate — includeZeroAsLoss: single win', () => {
  assertClose(computeWinRate([500], 'includeZeroAsLoss'), 1, '1/1 = 1');
});

test('computeWinRate — includeZeroAsLoss: single loss', () => {
  assertClose(computeWinRate([-500], 'includeZeroAsLoss'), 0, '0/1 = 0');
});

test('computeWinRate — includeZeroAsLoss: single scratch', () => {
  assertClose(computeWinRate([0], 'includeZeroAsLoss'), 0, '0/1 = 0');
});

// ── computeWinRate — ExcludeScratches ───────────────────────────────────

test('computeWinRate — excludeScratches: 2 wins, 1 loss, no scratches', () => {
  assertClose(computeWinRate([1000, -500, 2000], 'excludeScratches'), 2 / 3, '2/3 = 0.667');
});

test('computeWinRate — excludeScratches: scratch excluded from denominator', () => {
  // 1 win, 1 loss, 1 scratch — scratch excluded, so 1 win / 2 decisions
  assertClose(computeWinRate([1000, -500, 0], 'excludeScratches'), 0.5, '1 win / 2 decisions = 0.5');
});

test('computeWinRate — excludeScratches: all scratches returns null', () => {
  assertNull(computeWinRate([0, 0, 0], 'excludeScratches'), 'all scratches => null');
});

test('computeWinRate — excludeScratches: live scratch excluded', () => {
  // A live scratch: small negative fees-only PnL
  // PnL = -3 (fees only)
  assertClose(computeWinRate([1000, -3, 0], 'excludeScratches'), 0.5, '1 win / 2 decisions');
});

test('computeWinRate — excludeScratches: empty array returns null', () => {
  assertNull(computeWinRate([], 'excludeScratches'), 'empty => null');
});

test('computeWinRate — excludeScratches: all wins', () => {
  assertClose(computeWinRate([100, 200], 'excludeScratches'), 1, '2/2 = 1');
});

test('computeWinRate — excludeScratches: all losses', () => {
  assertClose(computeWinRate([-100, -200], 'excludeScratches'), 0, '0/2 = 0');
});

test('computeWinRate — excludeScratches: single scratch', () => {
  assertNull(computeWinRate([0], 'excludeScratches'), 'single scratch => null');
});

test('computeWinRate — excludeScratches: precision edge — exact zero', () => {
  assertNull(computeWinRate([0, 0], 'excludeScratches'), 'two scratches => null');
});

test('computeWinRate — excludeScratches: positive and zero mixed', () => {
  assertClose(computeWinRate([100, 0, 200, 0], 'excludeScratches'), 1, '2 wins / 2 decisions = 1');
});

test('computeWinRate — excludeScratches: negative and zero mixed', () => {
  assertClose(computeWinRate([-100, 0, -200], 'excludeScratches'), 0, '0 wins / 2 decisions = 0');
});

// ── computeWinRate — AllDecisions ───────────────────────────────────

test('computeWinRate — allDecisions: 2 wins, 1 loss', () => {
  assertClose(computeWinRate([1000, -500, 2000], 'allDecisions'), 2 / 3, '2/3 = 0.667');
});

test('computeWinRate — allDecisions: scratch counted as loss', () => {
  assertClose(computeWinRate([1000, -500, 0], 'allDecisions'), 1 / 3, '1 win / 3 decisions = 0.333');
});

test('computeWinRate — allDecisions: empty array returns null', () => {
  assertNull(computeWinRate([], 'allDecisions'), 'empty => null');
});

test('computeWinRate — allDecisions: all wins', () => {
  assertClose(computeWinRate([100, 200], 'allDecisions'), 1, '2/2 = 1');
});

test('computeWinRate — allDecisions: all losses', () => {
  assertClose(computeWinRate([-100, -200, 0], 'allDecisions'), 0, '0/3 = 0');
});

test('computeWinRate — allDecisions: single win', () => {
  assertClose(computeWinRate([500], 'allDecisions'), 1, '1/1 = 1');
});

test('computeWinRate — allDecisions: single scratch', () => {
  assertClose(computeWinRate([0], 'allDecisions'), 0, '0/1 = 0');
});

test('computeWinRate — allDecisions: same result as includeZeroAsLoss for same data', () => {
  const pnls = [1000, -500, 0, 200, -100];
  const a = computeWinRate(pnls, 'allDecisions');
  const b = computeWinRate(pnls, 'includeZeroAsLoss');
  assertClose(a, b, 'identical to includeZeroAsLoss for same input');
});

// ── average ─────────────────────────────────────────────────────────────

test('average — normal case', () => {
  assertClose(average([10, 20, 30]), 20, '(10+20+30)/3 = 20');
});

test('average — single value', () => {
  assertClose(average([42]), 42, 'single value = 42');
});

test('average — empty array returns null', () => {
  assertNull(average([]), 'empty => null');
});

test('average — negative values', () => {
  assertClose(average([-10, 0, 10]), 0, '(-10+0+10)/3 = 0');
});

test('average — floating point values', () => {
  assertClose(average([1.5, 2.5, 3.0]), 7 / 3, '(1.5+2.5+3)/3 = 7/3');
});

test('average — large numbers', () => {
  assertClose(average([1000000, 2000000]), 1500000, '1.5M');
});

// ── averageRMultiples ───────────────────────────────────────────────────

test('averageRMultiples — normal case', () => {
  assertClose(averageRMultiples([2.5, 3.5, -1.0]), (2.5 + 3.5 - 1) / 3, '(2.5+3.5-1)/3 = 1.667');
});

test('averageRMultiples — single value', () => {
  assertClose(averageRMultiples([5.0]), 5.0, 'single = 5.0');
});

test('averageRMultiples — empty returns null', () => {
  assertNull(averageRMultiples([]), 'empty => null');
});

test('averageRMultiples — all positive', () => {
  assertClose(averageRMultiples([1, 2, 3, 4, 5]), 3, '(1+2+3+4+5)/5 = 3');
});

test('averageRMultiples — all negative', () => {
  assertClose(averageRMultiples([-5, -3, -1]), -3, '(-5-3-1)/3 = -3');
});

test('averageRMultiples — mixed win and loss R-multiples', () => {
  // Simulating: 2 winners (R=2.49, R=5.0) and 1 loser (R=-2.008)
  assertClose(averageRMultiples([2.49, -2.008, 5.0]), (2.49 + (-2.008) + 5.0) / 3, 'avg R-multiple');
});

// ── averageProcessScore ────────────────────────────────────────────────

test('averageProcessScore — normal case', () => {
  assertClose(averageProcessScore([48, 21, 30]), (48 + 21 + 30) / 3, '(48+21+30)/3 = 33');
});

test('averageProcessScore — single value', () => {
  assertClose(averageProcessScore([55]), 55, 'single = 55');
});

test('averageProcessScore — empty returns null', () => {
  assertNull(averageProcessScore([]), 'empty => null');
});

test('averageProcessScore — all high scores', () => {
  assertClose(averageProcessScore([58, 60, 55, 54]), (58 + 60 + 55 + 54) / 4, 'avg of A-range scores');
});

test('averageProcessScore — all low scores', () => {
  assertClose(averageProcessScore([5, 10, 15]), 10, '(5+10+15)/3 = 10');
});

test('averageProcessScore — score boundary values', () => {
  assertClose(averageProcessScore([0, 60]), 30, '(0+60)/2 = 30');
});

// ── Inter-policy consistency ────────────────────────────────────────────

test('includeZeroAsLoss vs allDecisions — same classification for nonzero values', () => {
  // For any nonzero PnL, both policies produce same result
  const pnls = [1000, -500, 234, -10, 0.5, -0.1];
  const a = computeWinRate(pnls, 'includeZeroAsLoss');
  const b = computeWinRate(pnls, 'allDecisions');
  assertClose(a, b, 'identical for nonzero PnLs');
});

test('includeZeroAsLoss vs excludeScratches — differ only when scratches present', () => {
  // Without scratches (no zero PnL), both produce same result
  const pnls = [1000, -500, 200, -100, 50];
  const a = computeWinRate(pnls, 'includeZeroAsLoss');
  const b = computeWinRate(pnls, 'excludeScratches');
  assertClose(a, b, 'identical when no zero PnL values');
});

test('includeZeroAsLoss vs excludeScratches — differ when scratches present', () => {
  // With scratches, denominators differ
  const pnls = [1000, -500, 0, 200, 0]; // 2 wins, 1 loss, 2 scratches
  const a = computeWinRate(pnls, 'includeZeroAsLoss'); // 2/5 = 0.4
  const b = computeWinRate(pnls, 'excludeScratches'); // 2/3 = 0.667
  assertClose(a, 0.4, 'includeZeroAsLoss: 2/5 = 0.4');
  assertClose(b, 2 / 3, 'excludeScratches: 2/3 = 0.667');
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n=== Ran ${testCount} tests ===`);
if (process.exitCode) {
  console.error('Some tests FAILED.');
} else {
  console.log('All tests PASSED.');
}
