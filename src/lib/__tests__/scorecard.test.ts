/**
 * scorecard.test.ts
 *
 * Comprehensive tests for the Scorecard Zod schema.
 * Covers valid scorecards, malformed payloads, boundary conditions,
 * and typed error code assertions.
 *
 * Tests use inline JSON fixtures only — no database dependency.
 */

import { describe, it, expect } from 'vitest';
import {
  parseScorecard,
  validateScorecard,
  getScorecardErrorCode,
  ScorecardErrorCode,
  type Scorecard,
  type ScorecardDimension,
  type PlayEvaluation,
} from '../scorecard';

// ── Valid Scorecard Factory ──────────────────────────────────────────────

function validScorecard(overrides?: Partial<Scorecard>): Scorecard {
  return {
    dimensions: [
      { key: 'setup', label: 'Setup Quality', score: 8 },
      { key: 'risk', label: 'Risk Management', score: 7 },
      { key: 'entry', label: 'Entry Execution', score: 6 },
    ],
    overallScore: 72,
    gradeLabel: 'B',
    assessmentType: 'ai_quality',
    ...overrides,
  };
}

// ── Positive Tests ──────────────────────────────────────────────────────

describe('parseScorecard', () => {
  it('parses a valid minimal scorecard', () => {
    const data = validScorecard();
    const json = JSON.stringify(data);
    const result = parseScorecard(json);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overallScore).toBe(72);
      expect(result.data.gradeLabel).toBe('B');
      expect(result.data.dimensions).toHaveLength(3);
      expect(result.data.assessmentType).toBe('ai_quality');
    }
  });

  it('parses a scorecard with evaluations', () => {
    const data = validScorecard({
      evaluations: [
        {
          fieldKey: 'followed_plan',
          label: 'Followed the Plan',
          fieldType: 'boolean' as const,
          value: true,
          weight: 1,
        },
        {
          fieldKey: 'execution_quality',
          label: 'Execution Quality',
          fieldType: 'score_1_5' as const,
          value: 4,
          weight: 0.8,
        },
      ],
    });
    const json = JSON.stringify(data);
    const result = parseScorecard(json);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evaluations).toHaveLength(2);
      expect(result.data.evaluations![0].fieldKey).toBe('followed_plan');
      expect(result.data.evaluations![0].value).toBe(true);
      expect(result.data.evaluations![1].value).toBe(4);
    }
  });

  it('parses a scorecard with all optional fields', () => {
    const data = validScorecard({
      summary: 'Good trade execution overall with room for improvement in entry timing.',
      evaluations: [
        {
          fieldKey: 'setup_clarity',
          label: 'Setup Clarity',
          fieldType: 'text' as const,
          value: 'Clear head-and-shoulders pattern on 15m chart',
          weight: 1,
        },
      ],
      metadata: {
        modelUsed: 'gpt-4',
        promptTokens: 1250,
        completionTokens: 340,
      },
    });
    const json = JSON.stringify(data);
    const result = parseScorecard(json);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary).toContain('Good trade execution');
      expect(result.data.metadata?.modelUsed).toBe('gpt-4');
      expect(result.data.metadata?.promptTokens).toBe(1250);
    }
  });

  it('parses a scorecard with all 6 standard dimension scores', () => {
    const data = validScorecard({
      dimensions: [
        { key: 'setup', label: 'Setup Quality', score: 8 },
        { key: 'risk', label: 'Risk Management', score: 7 },
        { key: 'entry', label: 'Entry Execution', score: 6 },
        { key: 'management', label: 'Trade Management', score: 9 },
        { key: 'exit', label: 'Exit Execution', score: 5 },
        { key: 'review', label: 'Review Quality', score: 7 },
      ],
    });
    const json = JSON.stringify(data);
    const result = parseScorecard(json);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dimensions).toHaveLength(6);
    }
  });

  it('parses a scorecard with 1 dimension (minimum)', () => {
    const data = validScorecard({
      dimensions: [{ key: 'overall', label: 'Overall Quality', score: 5 }],
    });
    const json = JSON.stringify(data);
    const result = parseScorecard(json);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dimensions).toHaveLength(1);
    }
  });

  it('parses a scorecard with ai_review assessment type', () => {
    const data = validScorecard({ assessmentType: 'ai_review' });
    const json = JSON.stringify(data);
    const result = parseScorecard(json);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assessmentType).toBe('ai_review');
    }
  });

  it('parses a scorecard with score field notes', () => {
    const data = validScorecard({
      dimensions: [
        {
          key: 'setup',
          label: 'Setup Quality',
          score: 8,
          notes: 'Clear pattern with good R:R setup',
        },
      ],
    });
    const json = JSON.stringify(data);
    const result = parseScorecard(json);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dimensions[0].notes).toBe(
        'Clear pattern with good R:R setup',
      );
    }
  });

  it('parses a scorecard at boundary scores (min 1, max 10)', () => {
    const data = validScorecard({
      dimensions: [
        { key: 'min_dim', label: 'Minimum Dimension', score: 1 },
        { key: 'max_dim', label: 'Maximum Dimension', score: 10 },
      ],
      overallScore: 0,
      gradeLabel: 'F',
    });
    const json = JSON.stringify(data);
    const result = parseScorecard(json);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dimensions[0].score).toBe(1);
      expect(result.data.dimensions[1].score).toBe(10);
      expect(result.data.overallScore).toBe(0);
      expect(result.data.gradeLabel).toBe('F');
    }
  });
});

// ── Validation via validateScorecard (object input) ────────────────────

describe('validateScorecard', () => {
  it('validates an object directly (no JSON serialization)', () => {
    const input = validScorecard();
    const result = validateScorecard(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overallScore).toBe(72);
    }
  });

  it('rejects an invalid object', () => {
    const input = { dimensions: [], gradeLabel: 'BB' };
    const result = validateScorecard(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBeDefined();
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

// ── getScorecardErrorCode (fast-path) ────────────────────────────────────

describe('getScorecardErrorCode', () => {
  it('returns null for a valid scorecard', () => {
    const code = getScorecardErrorCode(JSON.stringify(validScorecard()));
    expect(code).toBeNull();
  });

  it('returns INVALID_JSON for malformed string', () => {
    const code = getScorecardErrorCode('not json');
    expect(code).toBe(ScorecardErrorCode.INVALID_JSON);
  });

  it('returns a non-null code for invalid scorecard', () => {
    const code = getScorecardErrorCode(JSON.stringify({}));
    expect(code).not.toBeNull();
    expect(Object.values(ScorecardErrorCode)).toContain(code);
  });
});

// ── Negative Tests: Invalid JSON ────────────────────────────────────────

describe('parseScorecard - invalid JSON', () => {
  it('rejects malformed JSON string', () => {
    const result = parseScorecard('{ invalid json }');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_JSON);
    }
  });

  it('rejects empty string', () => {
    const result = parseScorecard('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_JSON);
    }
  });

  it('rejects null JSON token', () => {
    const result = parseScorecard('null');
    expect(result.success).toBe(false);
    if (!result.success) {
      // null is a type error at root level, not a missing field
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_DIMENSIONS);
    }
  });
});

// ── Negative Tests: Missing Required Fields ──────────────────────────────

describe('parseScorecard - missing required fields', () => {
  it('rejects when dimensions is missing', () => {
    const result = parseScorecard(
      JSON.stringify({
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.MISSING_DIMENSIONS);
    }
  });

  it('rejects when overallScore is missing', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_OVERALL_SCORE);
    }
  });

  it('rejects when gradeLabel is missing', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_GRADE_LABEL);
    }
  });

  it('rejects when assessmentType is missing', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_ASSESSMENT_TYPE);
    }
  });
});

// ── Negative Tests: Empty Dimensions ─────────────────────────────────────

describe('parseScorecard - empty dimensions', () => {
  it('rejects empty dimensions array', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.MISSING_DIMENSIONS);
    }
  });

  it('rejects null dimensions', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: null,
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_DIMENSIONS);
    }
  });
});

// ── Negative Tests: Score Range Violations ──────────────────────────────

describe('parseScorecard - score range violations', () => {
  it('rejects dimension score below 1', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 0 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(
        ScorecardErrorCode.DIMENSION_SCORE_OUT_OF_RANGE,
      );
    }
  });

  it('rejects dimension score above 10', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 11 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(
        ScorecardErrorCode.DIMENSION_SCORE_OUT_OF_RANGE,
      );
    }
  });

  it('rejects non-integer dimension score', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 7.5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(
        ScorecardErrorCode.DIMENSION_SCORE_NOT_INTEGER,
      );
    }
  });

  it('rejects overallScore below 0', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: -1,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_OVERALL_SCORE);
    }
  });

  it('rejects overallScore above 100', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 101,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_OVERALL_SCORE);
    }
  });
});

// ── Negative Tests: Grade Label ──────────────────────────────────────────

describe('parseScorecard - grade label violations', () => {
  it('rejects empty gradeLabel string', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: '',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_GRADE_LABEL);
    }
  });

  it('rejects multi-character gradeLabel', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'A+',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_GRADE_LABEL);
    }
  });

  it('rejects numeric gradeLabel', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 5,
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ── Negative Tests: Assessment Type ──────────────────────────────────────

describe('parseScorecard - assessment type violations', () => {
  it('rejects invalid assessmentType value', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'manual_review',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_ASSESSMENT_TYPE);
    }
  });

  it('rejects numeric assessmentType', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 123,
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ── Negative Tests: Evaluation Fields ────────────────────────────────────

describe('parseScorecard - evaluation field violations', () => {
  it('rejects invalid fieldType in evaluation', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
        evaluations: [
          {
            fieldKey: 'test',
            label: 'Test',
            fieldType: 'invalid_type',
            value: true,
            weight: 1,
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(
        ScorecardErrorCode.INVALID_EVALUATION_TYPE,
      );
    }
  });

  it('rejects missing fieldKey in evaluation', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
        evaluations: [
          {
            label: 'Missing Key',
            fieldType: 'boolean',
            value: true,
            weight: 1,
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects weight below 0 in evaluation', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
        evaluations: [
          {
            fieldKey: 'test',
            label: 'Test',
            fieldType: 'boolean',
            value: true,
            weight: -0.5,
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(
        ScorecardErrorCode.INVALID_EVALUATION_WEIGHT,
      );
    }
  });

  it('rejects weight above 1 in evaluation', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
        evaluations: [
          {
            fieldKey: 'test',
            label: 'Test',
            fieldType: 'boolean',
            value: true,
            weight: 1.5,
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(
        ScorecardErrorCode.INVALID_EVALUATION_WEIGHT,
      );
    }
  });
});

// ── Negative Tests: String Length Violations ─────────────────────────────

describe('parseScorecard - string length violations', () => {
  it('rejects summary exceeding 2000 characters', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
        summary: 'x'.repeat(2001),
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects dimension notes exceeding 500 characters', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [
          {
            key: 'setup',
            label: 'Setup',
            score: 5,
            notes: 'x'.repeat(501),
          },
        ],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects dimension label exceeding 100 characters', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [
          {
            key: 'setup',
            label: 'x'.repeat(101),
            score: 5,
          },
        ],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects dimension with empty key string', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: '', label: 'My Dim', score: 5 }],
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ── Negative Tests: Extra / Unknown Fields ───────────────────────────────

describe('parseScorecard - extra fields', () => {
  it('strips unknown fields (Zod default behavior)', () => {
    const result = parseScorecard(
      JSON.stringify({
        ...validScorecard(),
        extraField: 'should be stripped',
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      // @ts-expect-error — extraField is not on the type
      expect(result.data.extraField).toBeUndefined();
    }
  });
});

// ── Negative Tests: Type Mismatches ──────────────────────────────────────

describe('parseScorecard - type mismatches', () => {
  it('rejects string overallScore', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 'fifty',
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects boolean dimensions', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: true,
        overallScore: 50,
        gradeLabel: 'C',
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ScorecardErrorCode.INVALID_DIMENSIONS);
    }
  });

  it('rejects object as string for gradeLabel', () => {
    const result = parseScorecard(
      JSON.stringify({
        dimensions: [{ key: 'setup', label: 'Setup', score: 5 }],
        overallScore: 50,
        gradeLabel: { complex: 'type' },
        assessmentType: 'ai_quality',
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ── ScorecardSchema direct tests ─────────────────────────────────────────

describe('ScorecardSchema', () => {
  it('infers correct TypeScript type from schema', () => {
    // Type-level assertion: these should compile
    const dim: ScorecardDimension = {
      key: 'risk',
      label: 'Risk Score',
      score: 7,
    };
    expect(dim.score).toBe(7);

    const eval_: PlayEvaluation = {
      fieldKey: 'followed_rules',
      label: 'Followed Rules',
      fieldType: 'boolean',
      value: true,
      weight: 1,
    };
    expect(eval_.value).toBe(true);

    const sc: Scorecard = {
      dimensions: [dim],
      overallScore: 70,
      gradeLabel: 'B',
      assessmentType: 'ai_quality',
    };
    expect(sc.overallScore).toBe(70);
  });
});
