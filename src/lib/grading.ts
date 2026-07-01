/**
 * grading.ts
 *
 * Pure (no side effects) trade grading functions.
 * Computes a total quality score from 6 rubric dimensions and maps it
 * to a letter grade. Decoupled from the database — tests independently
 * without Drizzle.
 *
 * Pattern: src/lib/trade-calc.ts
 */

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Six quality scores, each rated 1-10.
 *
 * - setupScore:   Quality of the pre-trade setup and thesis
 * - riskScore:    Risk management discipline (position size, stop placement)
 * - entryScore:   Execution of the entry (timing, price, method)
 * - managementScore: How the trade was managed while open (trailing, adjustments)
 * - exitScore:    Execution of the exit (timing, price, discipline)
 * - reviewScore:  Post-trade review quality (journaling, lessons learned)
 */
export interface GradeScores {
  setupScore: number;
  riskScore: number;
  entryScore: number;
  managementScore: number;
  exitScore: number;
  reviewScore: number;
}

export interface GradeResult {
  totalScore: number;
  gradeLabel: string;
}

// ── Constants ───────────────────────────────────────────────────────────

/**
 * Grade rubric: maps total score ranges to letter grades.
 * Total possible range: 6 (all 1s) to 60 (all 10s).
 */
export const GRADE_RUBRIC = [
  { min: 54, label: 'A' },
  { min: 42, label: 'B' },
  { min: 30, label: 'C' },
  { min: 18, label: 'D' },
] as const;

// ── Library ─────────────────────────────────────────────────────────────

/**
 * Calculate the total quality grade for a closed trade.
 *
 * Sums the 6 individual scores (each 1-10) and maps the total to a
 * letter grade via GRADE_RUBRIC.
 *
 * Grade thresholds:
 *   A >= 54, B >= 42, C >= 30, D >= 18, F < 18
 */
export function calculateGrade(scores: GradeScores): GradeResult {
  const totalScore =
    scores.setupScore +
    scores.riskScore +
    scores.entryScore +
    scores.managementScore +
    scores.exitScore +
    scores.reviewScore;

  // Walk rubric thresholds in descending order
  for (const tier of GRADE_RUBRIC) {
    if (totalScore >= tier.min) {
      return { totalScore, gradeLabel: tier.label };
    }
  }

  return { totalScore, gradeLabel: 'F' };
}
