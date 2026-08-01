/**
 * planned-risk.test.ts
 *
 * Tests for the shared direction-aware planned risk helper (R021).
 *
 * Covers the R021 scenarios and negative/boundary cases:
 *   - Long  100/95  → valid risk; Long  100/105 → null (invalid direction)
 *   - Short 100/105 → valid risk; Short 100/95  → null (invalid direction)
 *   - null/zero inputs, zero/negative quantity, unknown direction → null
 *
 * Run: npx tsx src/lib/planned-risk.test.ts
 */

import { computePlannedRiskAmount } from './planned-risk';

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
// R021: direction-aware validity
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Direction-aware risk (R021 scenarios)');

  assertApprox(
    computePlannedRiskAmount('long', 100, 95, 10)!,
    50,
    'Long entry 100 stop 95 qty 10 → $50 risk',
  );
  assertNull(
    computePlannedRiskAmount('long', 100, 105, 10),
    'Long entry 100 stop 105 (stop above entry) → null',
  );

  assertApprox(
    computePlannedRiskAmount('short', 100, 105, 10)!,
    50,
    'Short entry 100 stop 105 qty 10 → $50 risk',
  );
  assertNull(
    computePlannedRiskAmount('short', 100, 95, 10),
    'Short entry 100 stop 95 (stop below entry) → null',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Boundary: entry === stop
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Entry equals stop (zero per-unit risk)');

  assertNull(
    computePlannedRiskAmount('long', 100, 100, 10),
    'Long entry 100 stop 100 (diff 0) → null',
  );
  assertNull(
    computePlannedRiskAmount('short', 100, 100, 10),
    'Short entry 100 stop 100 (diff 0) → null',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Null / undefined inputs
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Null / undefined inputs');

  assertNull(computePlannedRiskAmount(null, 100, 95, 10), 'null direction → null');
  assertNull(computePlannedRiskAmount(undefined, 100, 95, 10), 'undefined direction → null');
  assertNull(computePlannedRiskAmount('long', null, 95, 10), 'null entry → null');
  assertNull(computePlannedRiskAmount('long', undefined, 95, 10), 'undefined entry → null');
  assertNull(computePlannedRiskAmount('long', 100, null, 10), 'null stop → null');
  assertNull(computePlannedRiskAmount('long', 100, undefined, 10), 'undefined stop → null');
  assertNull(computePlannedRiskAmount('long', 100, 95, null), 'null quantity → null');
  assertNull(computePlannedRiskAmount('long', 100, 95, undefined), 'undefined quantity → null');
}

// ────────────────────────────────────────────────────────────────────────
// Zero / negative numeric inputs
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Zero / negative numeric inputs');

  assertNull(computePlannedRiskAmount('long', 0, 95, 10), 'zero entry → null');
  assertNull(computePlannedRiskAmount('long', 100, 0, 10), 'zero stop → null');
  assertNull(computePlannedRiskAmount('long', 100, 95, 0), 'zero quantity → null');
  assertNull(computePlannedRiskAmount('long', 100, 95, -5), 'negative quantity → null');
}

// ────────────────────────────────────────────────────────────────────────
// Unknown direction value
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Unknown direction value');

  assertNull(computePlannedRiskAmount('LONG', 100, 95, 10), "uppercase 'LONG' → null");
  assertNull(computePlannedRiskAmount('garbage', 100, 95, 10), "unrecognized direction → null");
  assertNull(computePlannedRiskAmount('', 100, 95, 10), 'empty string direction → null');
}

// ────────────────────────────────────────────────────────────────────────
// Scaling and decimals
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Scaling and decimal precision');

  assertApprox(
    computePlannedRiskAmount('long', 100, 95, 100)!,
    500,
    'Long 100/95 qty 100 → $500',
  );
  assertApprox(
    computePlannedRiskAmount('short', 100, 105, 1)!,
    5,
    'Short 100/105 qty 1 → $5 (per-unit)',
  );
  assertApprox(
    computePlannedRiskAmount('long', 105.5, 101.25, 2)!,
    8.5,
    'Long 105.5/101.25 qty 2 → $8.50',
  );
  assertApprox(
    computePlannedRiskAmount('short', 99.99, 102.01, 3)!,
    6.06,
    'Short 99.99/102.01 qty 3 → $6.06',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
