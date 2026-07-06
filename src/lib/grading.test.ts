/**
 * grading.test.ts
 *
 * Comprehensive tests for the grading library.
 * Covers positive, negative, and boundary cases.
 *
 * Run: npx tsx src/lib/grading.test.ts
 */

import { calculateGrade, type GradeScores } from './grading';

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

// ────────────────────────────────────────────────────────────────────────
// Tests: calculateGrade
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## calculateGrade');

  // --- Positive tests ---

  // 1. All 10s → total 60, grade A
  {
    const scores: GradeScores = {
      setupScore: 10,
      riskScore: 10,
      entryScore: 10,
      managementScore: 10,
      exitScore: 10,
      reviewScore: 10,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 60, 'all 10s → total 60');
    assert(r.gradeLabel === 'A', 'all 10s → grade A');
  }

  // 2. All 1s (minimum) → total 6, grade F
  {
    const scores: GradeScores = {
      setupScore: 1,
      riskScore: 1,
      entryScore: 1,
      managementScore: 1,
      exitScore: 1,
      reviewScore: 1,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 6, 'all 1s → total 6');
    assert(r.gradeLabel === 'F', 'all 1s → grade F');
  }

  // 3. All 9s → total 54, grade A (boundary)
  {
    const scores: GradeScores = {
      setupScore: 9,
      riskScore: 9,
      entryScore: 9,
      managementScore: 9,
      exitScore: 9,
      reviewScore: 9,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 54, 'all 9s → total 54');
    assert(r.gradeLabel === 'A', 'all 9s → grade A');
  }

  // 4. Mixed realistic scores → total 39, grade C
  {
    const scores: GradeScores = {
      setupScore: 8,
      riskScore: 7,
      entryScore: 6,
      managementScore: 5,
      exitScore: 7,
      reviewScore: 6,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 39, 'mixed scores → total 39');
    assert(r.gradeLabel === 'C', 'mixed scores (39) → grade C');
  }

  // 5. High-end realistic → total 48, grade B
  {
    const scores: GradeScores = {
      setupScore: 9,
      riskScore: 8,
      entryScore: 8,
      managementScore: 7,
      exitScore: 8,
      reviewScore: 8,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 48, 'high mixed → total 48');
    assert(r.gradeLabel === 'B', 'high mixed (48) → grade B');
  }

  // 6. Low-end realistic → total 21, grade D
  {
    const scores: GradeScores = {
      setupScore: 4,
      riskScore: 3,
      entryScore: 4,
      managementScore: 3,
      exitScore: 4,
      reviewScore: 3,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 21, 'low mixed → total 21');
    assert(r.gradeLabel === 'D', 'low mixed (21) → grade D');
  }

  // --- Boundary tests ---

  // 7. Boundary F/D: total 17 → grade F (just below D)
  {
    const scores: GradeScores = {
      setupScore: 3,
      riskScore: 3,
      entryScore: 3,
      managementScore: 3,
      exitScore: 3,
      reviewScore: 2,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 17, 'boundary 17 → total 17');
    assert(r.gradeLabel === 'F', 'boundary 17 → grade F');
  }

  // 8. Boundary D: total 18 → grade D (minimum D)
  {
    const scores: GradeScores = {
      setupScore: 3,
      riskScore: 3,
      entryScore: 3,
      managementScore: 3,
      exitScore: 3,
      reviewScore: 3,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 18, 'boundary 18 → total 18');
    assert(r.gradeLabel === 'D', 'boundary 18 → grade D');
  }

  // 9. Boundary D/C: total 29 → grade D (just below C)
  {
    const scores: GradeScores = {
      setupScore: 5,
      riskScore: 5,
      entryScore: 5,
      managementScore: 5,
      exitScore: 5,
      reviewScore: 4,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 29, 'boundary 29 → total 29');
    assert(r.gradeLabel === 'D', 'boundary 29 → grade D');
  }

  // 10. Boundary C: total 30 → grade C (minimum C)
  {
    const scores: GradeScores = {
      setupScore: 5,
      riskScore: 5,
      entryScore: 5,
      managementScore: 5,
      exitScore: 5,
      reviewScore: 5,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 30, 'boundary 30 → total 30');
    assert(r.gradeLabel === 'C', 'boundary 30 → grade C');
  }

  // 11. Boundary C/B: total 41 → grade C (just below B)
  {
    const scores: GradeScores = {
      setupScore: 7,
      riskScore: 7,
      entryScore: 7,
      managementScore: 7,
      exitScore: 7,
      reviewScore: 6,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 41, 'boundary 41 → total 41');
    assert(r.gradeLabel === 'C', 'boundary 41 → grade C');
  }

  // 12. Boundary B: total 42 → grade B (minimum B)
  {
    const scores: GradeScores = {
      setupScore: 7,
      riskScore: 7,
      entryScore: 7,
      managementScore: 7,
      exitScore: 7,
      reviewScore: 7,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 42, 'boundary 42 → total 42');
    assert(r.gradeLabel === 'B', 'boundary 42 → grade B');
  }

  // 13. Boundary B/A: total 53 → grade B (just below A)
  {
    const scores: GradeScores = {
      setupScore: 9,
      riskScore: 9,
      entryScore: 9,
      managementScore: 9,
      exitScore: 9,
      reviewScore: 8,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 53, 'boundary 53 → total 53');
    assert(r.gradeLabel === 'B', 'boundary 53 → grade B');
  }

  // 14. Zero scores (no trade reviewed), all 0s → total 0, grade F
  {
    const scores: GradeScores = {
      setupScore: 0,
      riskScore: 0,
      entryScore: 0,
      managementScore: 0,
      exitScore: 0,
      reviewScore: 0,
    };
    const r = calculateGrade(scores);
    assert(r.totalScore === 0, 'all zeros → total 0');
    assert(r.gradeLabel === 'F', 'all zeros → grade F');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
