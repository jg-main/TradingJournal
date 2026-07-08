/**
 * /api/trades/[id]/assessments
 *
 * POST: Trigger an AI trade quality assessment for a trade.
 * GET:  Browse versioned assessment history for a trade.
 *
 * POST maps AssessmentError codes to appropriate HTTP status codes:
 *   TRADE_NOT_FOUND      → 404
 *   AI_NOT_CONFIGURED    → 400  ("AI is not configured — set up AI settings first")
 *   AI_PROVIDER_ERROR    → 502  ("AI provider error — check credentials or try again later")
 *   SCORECARD_PARSE_ERROR → 502 ("AI returned invalid assessment — try again")
 *   CLICKHOUSE_ERROR     → 200  (optional evidence; warnings in scorecard)
 *   MISSING_MARKET_DATA  → 200  (optional evidence; warnings in scorecard)
 *
 * Secret-safe: never log or return apiKey in any response.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeAssessmentSnapshots } from '@/db/schema';
import { eq, desc, count } from 'drizzle-orm';
import { z } from 'zod';
import { performAssessment, AssessmentError, AssessmentErrorCode } from '@/lib/assessment-engine';
import type { AssessmentType } from '@/lib/scorecard';

// ── Zod Schemas ─────────────────────────────────────────────────────────

const postAssessmentSchema = z.object({
  assessmentType: z
    .enum(['ai_quality', 'ai_review'])
    .optional()
    .default('ai_quality'),
});

// ── Route Parameter Type ────────────────────────────────────────────────

type RouteParams = { params: Promise<{ id: string }> };

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a safe version of a snapshot row suitable for JSON responses.
 * Strips raw scorecardJson and any sensitive fields; scorecard is returned
 * as a separate parsed field.
 */
function buildSnapshotResponse(row: typeof tradeAssessmentSnapshots.$inferSelect) {
  let parsedScorecard: unknown = null;
  if (row.scorecardJson) {
    try {
      parsedScorecard = JSON.parse(row.scorecardJson);
    } catch {
      // If scorecardJson is somehow invalid, return null instead of crashing
      parsedScorecard = null;
    }
  }

  return {
    id: row.id,
    tradeId: row.tradeId,
    assessedAt: row.assessedAt,
    assessmentType: row.assessmentType,
    overallScore: row.overallScore,
    modelUsed: row.modelUsed,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    notes: row.notes,
    createdAt: row.createdAt,
    scorecard: parsedScorecard,
  };
}

/**
 * Map AssessmentErrorCode to HTTP status code and safe message.
 *
 * Returns { status, safeMessage } where safeMessage is user-facing and
 * never leaks implementation details. All errors are logged server-side
 * with full context; only the safe message is returned to the client.
 */
function mapAssessmentError(err: AssessmentError): {
  status: number;
  safeMessage: string;
} {
  switch (err.code) {
    case AssessmentErrorCode.TRADE_NOT_FOUND:
      return { status: 404, safeMessage: err.message };
    case AssessmentErrorCode.AI_NOT_CONFIGURED:
      return {
        status: 400,
        safeMessage: 'AI is not configured — set up AI settings first',
      };
    case AssessmentErrorCode.AI_PROVIDER_ERROR:
      return {
        status: 502,
        safeMessage: 'AI provider error — check credentials or try again later',
      };
    case AssessmentErrorCode.SCORECARD_PARSE_ERROR:
      return {
        status: 502,
        safeMessage: 'AI returned invalid assessment — try again',
      };
    case AssessmentErrorCode.CLICKHOUSE_ERROR:
      // ClickHouse is optional evidence; degrade gracefully
      return { status: 200, safeMessage: err.message };
    case AssessmentErrorCode.MISSING_MARKET_DATA:
      return { status: 200, safeMessage: err.message };
    default:
      return { status: 500, safeMessage: 'Assessment failed due to an unexpected error' };
  }
}

// ── POST /api/trades/[id]/assessments ───────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tradeId } = await params;

    // ── Validate trade exists ───────────────────────────────────
    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    // ── Parse optional body ─────────────────────────────────────
    let assessmentType: AssessmentType = 'ai_quality';
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      const parsed = postAssessmentSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      assessmentType = parsed.data.assessmentType;
    }

    console.log(
      JSON.stringify({
        event: 'assessment_request',
        tradeId,
        assessmentType,
      }),
    );

    // ── Execute assessment pipeline ─────────────────────────────
    let result: Awaited<ReturnType<typeof performAssessment>>;

    try {
      result = await performAssessment(tradeId, undefined, { assessmentType });
    } catch (err) {
      if (err instanceof AssessmentError) {
        const { status, safeMessage } = mapAssessmentError(err);
        console.log(
          JSON.stringify({
            event: 'assessment_error',
            tradeId,
            errorCode: err.code,
            message: err.message,
          }),
        );
        return NextResponse.json(
          { error: safeMessage, code: err.code },
          { status },
        );
      }
      // Unexpected non-AssessmentError
      console.log(
        JSON.stringify({
          event: 'assessment_error',
          tradeId,
          errorCode: 'UNEXPECTED',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return NextResponse.json(
        { error: 'Unexpected assessment error' },
        { status: 500 },
      );
    }

    // ── Persist snapshot ────────────────────────────────────────
    // performAssessment already writes to DB in its own transaction.
    // We compute snapshotVersion as the count of existing snapshots.
    const existingCount = db
      .select({ count: count() })
      .from(tradeAssessmentSnapshots)
      .where(eq(tradeAssessmentSnapshots.tradeId, tradeId))
      .get();

    const snapshotVersion = (existingCount?.count ?? 1);

    console.log(
      JSON.stringify({
        event: 'assessment_saved',
        snapshotId: result.snapshot.id,
        overallScore: result.scorecard.overallScore,
        snapshotVersion,
      }),
    );

    // ── Read back the persisted snapshot for response ─────────
    const savedRow = db
      .select()
      .from(tradeAssessmentSnapshots)
      .where(eq(tradeAssessmentSnapshots.id, result.snapshot.id))
      .get();

    if (!savedRow) {
      // Should not happen — the assessment engine just inserted it
      return NextResponse.json(
        { error: 'Assessment completed but snapshot could not be read back' },
        { status: 500 },
      );
    }

    const snapshotResponse = buildSnapshotResponse(savedRow);

    return NextResponse.json(
      {
        snapshot: {
          ...snapshotResponse,
          snapshotVersion,
        },
        scorecard: result.scorecard,
        warnings: result.warnings,
      },
      { status: 201 },
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        event: 'assessment_error',
        tradeId: 'unknown',
        errorCode: 'UNEXPECTED',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      { error: 'Failed to process assessment request' },
      { status: 500 },
    );
  }
}

// ── GET /api/trades/[id]/assessments ────────────────────────────────────

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tradeId } = await params;

    // ── Validate trade exists ───────────────────────────────────
    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    // ── Query snapshots DESC by assessedAt ──────────────────────
    const rows = db
      .select()
      .from(tradeAssessmentSnapshots)
      .where(eq(tradeAssessmentSnapshots.tradeId, tradeId))
      .orderBy(desc(tradeAssessmentSnapshots.assessedAt), desc(tradeAssessmentSnapshots.createdAt))
      .all();

    // Compute snapshotVersion as 1-based index from oldest.
    // Since rows are DESC, reverse and map.
    const totalCount = rows.length;
    const data = rows.map((row, index) => {
      const version = totalCount - index; // oldest = 1, newest = totalCount
      const snapshot = buildSnapshotResponse(row);
      return { ...snapshot, snapshotVersion: version };
    });

    console.log(
      JSON.stringify({
        event: 'history_request',
        tradeId,
        snapshotCount: data.length,
      }),
    );

    return NextResponse.json({ data, tradeId });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch assessments', details: String(error) },
      { status: 500 },
    );
  }
}
