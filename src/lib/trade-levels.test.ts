/**
 * trade-levels.test.ts
 *
 * Tests for the trade level derivation library (M019).
 * Covers the stop/target chain fallbacks, ordering, and edge cases.
 *
 * Run: npx tsx src/lib/trade-levels.test.ts
 */

import {
  compareLevelEventsDesc,
  deriveCurrentStop,
  deriveCurrentTarget,
  type StopAdjustmentLike,
  type TargetAdjustmentLike,
} from './trade-levels';

let passed = 0;
let failed = 0;

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function stopAdj(id: string, newStop: number | null, adjustedAt: string | null, createdAt: string | null = null): StopAdjustmentLike {
  return { id, newStop, adjustedAt, createdAt };
}

function targetAdj(id: string, targetIndex: number, newTarget: number | null, adjustedAt: string, createdAt: string | null = null): TargetAdjustmentLike {
  return { id, targetIndex, newTarget, adjustedAt, createdAt };
}

console.log('\n--- trade-levels derivation tests ---\n');

// ── deriveCurrentStop ────────────────────────────────────────────────

console.log('\n1. deriveCurrentStop falls back plannedStop -> risk snapshot -> chain:');
{
  // No adjustments, no risk snapshot: planned stop wins.
  assertEqual(deriveCurrentStop(140, null, []), 140, 'planned stop used when nothing else exists');
  // Risk snapshot overrides planned stop (actual stop at open differs from plan).
  assertEqual(deriveCurrentStop(140, 138.5, []), 138.5, 'initial stop overrides planned stop');
  // Latest adjustment overrides risk snapshot.
  assertEqual(
    deriveCurrentStop(140, 138.5, [stopAdj('a', 142, '2025-06-02T10:00:00Z')]),
    142,
    'latest adjustment overrides initial stop',
  );
}

console.log('\n2. deriveCurrentStop picks the LATEST adjustment by adjustedAt:');
{
  const adjustments = [
    stopAdj('early', 142, '2025-06-01T10:00:00Z'),
    stopAdj('late', 145, '2025-06-03T10:00:00Z'),
    stopAdj('mid', 143, '2025-06-02T10:00:00Z'),
  ];
  assertEqual(deriveCurrentStop(140, null, adjustments), 145, 'latest adjustedAt wins regardless of insertion order');
}

console.log('\n3. deriveCurrentStop tiebreaks by createdAt then id desc:');
{
  const sameTime = [
    stopAdj('id-b', 144, '2025-06-01T10:00:00Z', '2025-06-01T10:00:00Z'),
    stopAdj('id-a', 143, '2025-06-01T10:00:00Z', '2025-06-01T10:00:00Z'),
  ];
  assertEqual(deriveCurrentStop(140, null, sameTime), 144, 'id desc tiebreak (id-b > id-a)');

  const newerCreated = [
    stopAdj('older', 143, '2025-06-01T10:00:00Z', '2025-06-01T09:00:00Z'),
    stopAdj('newer', 144, '2025-06-01T10:00:00Z', '2025-06-01T11:00:00Z'),
  ];
  assertEqual(deriveCurrentStop(140, null, newerCreated), 144, 'createdAt desc tiebreak');
}

console.log('\n4. deriveCurrentStop null handling:');
{
  // Latest adjustment has null newStop -> fall through to initial stop.
  assertEqual(
    deriveCurrentStop(140, 138.5, [stopAdj('a', null, '2025-06-02T10:00:00Z')]),
    138.5,
    'null latest newStop falls through to initial stop',
  );
  // All null -> null.
  assertEqual(deriveCurrentStop(null, null, []), null, 'all null yields null');
  assertEqual(
    deriveCurrentStop(null, null, [stopAdj('a', null, '2025-06-02T10:00:00Z')]),
    null,
    'null chain yields null',
  );
  // Input array is not mutated.
  const input = [stopAdj('a', 142, '2025-06-01T10:00:00Z'), stopAdj('b', 145, '2025-06-03T10:00:00Z')];
  deriveCurrentStop(140, null, input);
  assertEqual(input[0].id, 'a', 'input array not mutated (original order preserved)');
}

// ── deriveCurrentTarget ──────────────────────────────────────────────

console.log('\n5. deriveCurrentTarget uses latest adjustment for the index, else planned target:');
{
  assertEqual(deriveCurrentTarget(165, 1, []), 165, 'planned target used when no adjustments');
  assertEqual(
    deriveCurrentTarget(165, 1, [targetAdj('t1', 1, 170, '2025-06-02T10:00:00Z')]),
    170,
    'latest target adjustment overrides planned target',
  );
  // Index-specific: target 1 adjustment does not affect target 2 derivation.
  assertEqual(
    deriveCurrentTarget(180, 2, [targetAdj('t1', 1, 170, '2025-06-02T10:00:00Z')]),
    180,
    'adjustments for other target indexes are ignored',
  );
  // Mixed indexes: only the matching index's latest adjustment wins.
  assertEqual(
    deriveCurrentTarget(180, 2, [
      targetAdj('t1', 1, 170, '2025-06-01T10:00:00Z'),
      targetAdj('t2', 2, 190, '2025-06-02T10:00:00Z'),
      targetAdj('t3', 2, 195, '2025-06-03T10:00:00Z'),
    ]),
    195,
    'latest matching-index adjustment wins',
  );
}

// ── compareLevelEventsDesc ───────────────────────────────────────────

console.log('\n6. compareLevelEventsDesc sorts newest first:');
{
  const rows = [
    { id: 'b', adjustedAt: '2025-06-01T10:00:00Z', createdAt: '2025-06-01T10:00:00Z' },
    { id: 'a', adjustedAt: '2025-06-03T10:00:00Z', createdAt: '2025-06-03T10:00:00Z' },
  ];
  const sorted = [...rows].sort(compareLevelEventsDesc);
  assertEqual(sorted[0].id, 'a', 'newest adjustedAt first');
  assertEqual(sorted[1].id, 'b', 'older adjustedAt second');
}

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
