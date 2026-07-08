/**
 * scorecard.ts
 *
 * Zod schema and validation for AI trade quality assessment scorecards.
 * Defines the contract for JSON stored in trade_assessment_snapshots.scorecard_json.
 *
 * Provides typed parse errors with distinguishable error codes, enabling
 * callers to handle validation failures programmatically.
 *
 * Pattern: src/lib/grading.ts (pure types + functions, no DB dependency)
 */

import { z } from 'zod';

// ── Error Codes ──────────────────────────────────────────────────────────

/**
 * Distinguishable error codes for scorecard validation failures.
 * Each code identifies a specific category of parse error so callers
 * can branch on the code rather than parsing error messages.
 */
export const ScorecardErrorCode = {
  /** Input could not be parsed as JSON */
  INVALID_JSON: 'INVALID_JSON',
  /** The dimensions array is missing or empty */
  MISSING_DIMENSIONS: 'MISSING_DIMENSIONS',
  /** A dimension entry has an invalid key, label, or score shape */
  INVALID_DIMENSIONS: 'INVALID_DIMENSIONS',
  /** Dimension score outside the valid 1-10 range */
  DIMENSION_SCORE_OUT_OF_RANGE: 'DIMENSION_SCORE_OUT_OF_RANGE',
  /** Dimension score is not an integer */
  DIMENSION_SCORE_NOT_INTEGER: 'DIMENSION_SCORE_NOT_INTEGER',
  /** Overall score outside the valid 0-100 range */
  INVALID_OVERALL_SCORE: 'INVALID_OVERALL_SCORE',
  /** Grade label is empty or more than one character */
  INVALID_GRADE_LABEL: 'INVALID_GRADE_LABEL',
  /** An evaluation field has an invalid type value */
  INVALID_EVALUATION_TYPE: 'INVALID_EVALUATION_TYPE',
  /** An evaluation field has an invalid value for its declared type */
  INVALID_EVALUATION_VALUE: 'INVALID_EVALUATION_VALUE',
  /** A required field is missing from the payload */
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  /** AssessmentType is not a valid value */
  INVALID_ASSESSMENT_TYPE: 'INVALID_ASSESSMENT_TYPE',
  /** Evaluation weight outside the 0-1 range */
  INVALID_EVALUATION_WEIGHT: 'INVALID_EVALUATION_WEIGHT',
} as const;

export type ScorecardErrorCode =
  (typeof ScorecardErrorCode)[keyof typeof ScorecardErrorCode];

// ── Enums ────────────────────────────────────────────────────────────────

export const FieldTypeEnum = z.enum(['boolean', 'score_1_5', 'score_1_10', 'text']);
export type FieldType = z.infer<typeof FieldTypeEnum>;

export const AssessmentTypeEnum = z.enum(['ai_quality', 'ai_review']);
export type AssessmentType = z.infer<typeof AssessmentTypeEnum>;

// ── Sub-schemas ──────────────────────────────────────────────────────────

/**
 * A single evaluation field result, matched to a playEvaluationFields row.
 *
 * - fieldKey:  Matches playEvaluationFields.fieldKey
 * - label:     Human-readable label from the definition
 * - fieldType: Determines the allowed shape of `value`
 * - value:     boolean for 'boolean', number for 'score_1_5' / 'score_1_10',
 *              string for 'text'
 * - weight:    Contribution weight (0.0 - 1.0), defaults to 1.0
 */
export const PlayEvaluationSchema = z.object({
  fieldKey: z.string().min(1, 'Evaluation fieldKey is required'),
  label: z.string().min(1, 'Evaluation label is required'),
  fieldType: FieldTypeEnum,
  value: z.union([z.boolean(), z.number(), z.string()]),
  weight: z
    .number()
    .min(0, 'Weight must be >= 0')
    .max(1, 'Weight must be <= 1')
    .default(1),
});
export type PlayEvaluation = z.infer<typeof PlayEvaluationSchema>;

/**
 * A single rubric dimension score (matching grading.ts GradeScores).
 *
 * - key:    Dimension identifier (e.g. 'setup', 'risk', 'entry')
 * - label:  Human-readable label
 * - score:  Integer 1-10
 * - notes:  Optional justification or comment
 */
export const ScorecardDimensionSchema = z.object({
  key: z.string().min(1, 'Dimension key is required'),
  label: z
    .string()
    .min(1, 'Dimension label is required')
    .max(100, 'Dimension label must be 100 chars or fewer'),
  score: z
    .number({ message: 'Dimension score must be a number' })
    .int('Dimension score must be an integer')
    .min(1, 'Dimension score min is 1')
    .max(10, 'Dimension score max is 10'),
  notes: z.string().max(500, 'Notes must be 500 chars or fewer').optional(),
});
export type ScorecardDimension = z.infer<typeof ScorecardDimensionSchema>;

/**
 * Optional metadata about the AI model used to produce the assessment.
 */
export const ScorecardMetadataSchema = z.object({
  modelUsed: z.string().optional(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
});
export type ScorecardMetadata = z.infer<typeof ScorecardMetadataSchema>;

// ── Root Scorecard Schema ────────────────────────────────────────────────

/**
 * Full scorecard contract validated by Zod.
 *
 * Stored as serialized JSON in trade_assessment_snapshots.scorecard_json.
 * All fields are validated with constraints matching the domain model:
 * dimension scores 1-10, overall score 0-100, grade label single char A-F.
 */
export const ScorecardSchema = z.object({
  /** Rubric dimensions (1-20) */
  dimensions: z
    .array(ScorecardDimensionSchema)
    .min(1, 'At least one dimension is required')
    .max(20, 'Maximum 20 dimensions allowed'),
  /** Optional per-play evaluation field results */
  evaluations: z.array(PlayEvaluationSchema).optional(),
  /** Aggregate quality score 0-100 */
  overallScore: z
    .number()
    .min(0, 'Overall score min is 0')
    .max(100, 'Overall score max is 100'),
  /** Single-character letter grade (A-F) */
  gradeLabel: z
    .string()
    .min(1, 'Grade label is required')
    .max(1, 'Grade label must be a single character'),
  /** Optional narrative summary of the assessment */
  summary: z.string().max(2000, 'Summary must be 2000 chars or fewer').optional(),
  /** Type of assessment performed */
  assessmentType: AssessmentTypeEnum,
  /** Optional AI model metadata */
  metadata: ScorecardMetadataSchema.optional(),
});
export type Scorecard = z.infer<typeof ScorecardSchema>;

// ── Error Code Resolver ──────────────────────────────────────────────────

/**
 * Structured parse error with a distinguishable error code and the original
 * Zod issues for downstream inspection.
 */
export interface ScorecardParseError {
  /** Machine-readable error code */
  code: ScorecardErrorCode;
  /** Human-readable description */
  message: string;
  /** Original Zod issues for detailed inspection */
  issues: z.ZodIssue[];
}

/**
 * Resolve the most specific ScorecardErrorCode from an array of Zod issues.
 *
 * Examines issue paths and Zod error codes to return a business-relevant
 * error code rather than a generic validation message.
 */
export function resolveScorecardErrorCode(
  issues: z.ZodIssue[],
): ScorecardErrorCode {
  if (issues.length === 0) {
    return ScorecardErrorCode.INVALID_DIMENSIONS;
  }

  // Walk through issues and return the most specific matching code
  for (const issue of issues) {
    const path = issue.path.join('.');

    // Top-level type error (e.g. null input)
    if (path === '' && issue.code === 'invalid_type') {
      return ScorecardErrorCode.INVALID_DIMENSIONS;
    }

    // Check for missing/invalid at root level via path and code
    if (issue.code === 'invalid_type') {
      if (path === 'dimensions') {
        // Zod v4 uses message to indicate received type
        if (issue.message.includes('received undefined')) {
          return ScorecardErrorCode.MISSING_DIMENSIONS;
        }
        return ScorecardErrorCode.INVALID_DIMENSIONS;
      }
      if (path === 'overallScore') return ScorecardErrorCode.INVALID_OVERALL_SCORE;
      if (path === 'gradeLabel') return ScorecardErrorCode.INVALID_GRADE_LABEL;
      if (path === 'assessmentType') return ScorecardErrorCode.INVALID_ASSESSMENT_TYPE;
      // Dimension subfield type errors (e.g. score is not an integer)
      if (path.startsWith('dimensions.')) {
        if (path.includes('score')) {
          return ScorecardErrorCode.DIMENSION_SCORE_NOT_INTEGER;
        }
        return ScorecardErrorCode.INVALID_DIMENSIONS;
      }
      return ScorecardErrorCode.MISSING_REQUIRED_FIELD;
    }

    // Dimension-specific errors
    if (path.startsWith('dimensions')) {
      // too_small on the dimensions array itself (empty array)
      if (issue.code === 'too_small' && path === 'dimensions') {
        return ScorecardErrorCode.MISSING_DIMENSIONS;
      }
      if (path.includes('score')) {
        if (issue.message.includes('integer') || issue.message.includes('int')) {
          return ScorecardErrorCode.DIMENSION_SCORE_NOT_INTEGER;
        }
        return ScorecardErrorCode.DIMENSION_SCORE_OUT_OF_RANGE;
      }
      return ScorecardErrorCode.INVALID_DIMENSIONS;
    }

    // Overall score
    if (path === 'overallScore') {
      return ScorecardErrorCode.INVALID_OVERALL_SCORE;
    }

    // Grade label
    if (path === 'gradeLabel') {
      return ScorecardErrorCode.INVALID_GRADE_LABEL;
    }

    // Assessment type
    if (path === 'assessmentType') {
      return ScorecardErrorCode.INVALID_ASSESSMENT_TYPE;
    }

    // Evaluation-specific errors
    if (path.startsWith('evaluations')) {
      if (path.includes('fieldType')) {
        return ScorecardErrorCode.INVALID_EVALUATION_TYPE;
      }
      if (path.includes('value')) {
        return ScorecardErrorCode.INVALID_EVALUATION_VALUE;
      }
      if (path.includes('weight')) {
        return ScorecardErrorCode.INVALID_EVALUATION_WEIGHT;
      }
    }

    // Root-level required field missing
    if (issue.code === 'invalid_union') {
      return ScorecardErrorCode.INVALID_ASSESSMENT_TYPE;
    }
  }

  return ScorecardErrorCode.INVALID_DIMENSIONS;
}

/**
 * Parse and validate a JSON string as a Scorecard.
 *
 * Returns a discriminated result: { success: true, data } on success or
 * { success: false, error: ScorecardParseError } on failure.
 * The error includes a machine-readable code for programmatic handling.
 */
export function parseScorecard(
  json: string,
): { success: true; data: Scorecard } | { success: false; error: ScorecardParseError } {
  // Step 1: Parse raw JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      success: false,
      error: {
        code: ScorecardErrorCode.INVALID_JSON,
        message: 'Input is not valid JSON',
        issues: [],
      },
    };
  }

  // Step 2: Validate against schema
  const result = ScorecardSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues;
    return {
      success: false,
      error: {
        code: resolveScorecardErrorCode(issues),
        message: issues[0]?.message ?? 'Scorecard validation failed',
        issues,
      },
    };
  }

  return { success: true, data: result.data };
}

/**
 * Convenience wrapper: parse a JSON object (already parsed) against the
 * Scorecard schema. Useful when the caller already has a parsed object.
 */
export function validateScorecard(
  input: unknown,
): { success: true; data: Scorecard } | { success: false; error: ScorecardParseError } {
  const result = ScorecardSchema.safeParse(input);

  if (!result.success) {
    const issues = result.error.issues;
    return {
      success: false,
      error: {
        code: resolveScorecardErrorCode(issues),
        message: issues[0]?.message ?? 'Scorecard validation failed',
        issues,
      },
    };
  }

  return { success: true, data: result.data };
}

/**
 * Parse and return the error code only (fast-path for error branching).
 * Returns null when the input is valid.
 */
export function getScorecardErrorCode(
  json: string,
): ScorecardErrorCode | null {
  const result = parseScorecard(json);
  if (result.success) return null;
  return result.error.code;
}
