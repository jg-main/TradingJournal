import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeGrades } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Trade review completion API (S07/T01).
 *
 * POST  /api/trades/[id]/review  — mark a closed trade as reviewed. Requires
 *        the review-evidence contract: a non-empty lesson AND a tradeGrades
 *        row. Optionally persists lesson / exitNotes supplied in the body.
 * DELETE /api/trades/[id]/review  — reopen the review (clears reviewedAt).
 *
 * The reviewedAt marker is the durable driver of the 'reviewed' workflow
 * phase (deriveWorkflowPhase in src/lib/workflow-phase.ts). Setting it here
 * makes the phase reachable through the API; grade changes clear it so a
 * re-graded trade must be re-reviewed (S06/S07 integration).
 */

const reviewBodySchema = z.object({
  lesson: z.string().optional(),
  exitNotes: z.string().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = reviewBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    if (trade.status !== 'closed') {
      return NextResponse.json(
        {
          error: `Only closed trades can be marked reviewed; this trade is ${trade.status}.`,
        },
        { status: 409 },
      );
    }

    // Persist review-evidence fields when supplied (partial edits are saved
    // even if the full contract is not yet satisfied — e.g. exitNotes before
    // a lesson has been written).
    if (parsed.data.lesson !== undefined || parsed.data.exitNotes !== undefined) {
      db.update(trades)
        .set({
          ...(parsed.data.lesson !== undefined ? { lesson: parsed.data.lesson } : {}),
          ...(parsed.data.exitNotes !== undefined ? { exitNotes: parsed.data.exitNotes } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trades.id, id))
        .run();
    }

    // Re-read the lesson after the potential update above (the contract
    // validates the persisted value, not the request payload).
    const current = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!current) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // Evidence contract: non-empty lesson (after trim) AND a grade row.
    const missing: string[] = [];
    if (!(current.lesson ?? '').trim()) missing.push('lesson');
    const grade = db
      .select({ id: tradeGrades.id })
      .from(tradeGrades)
      .where(eq(tradeGrades.tradeId, id))
      .get();
    if (!grade) missing.push('grade');

    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'Review evidence incomplete', missing },
        { status: 422 },
      );
    }

    const reviewedAt = new Date().toISOString();
    db.update(trades)
      .set({ reviewedAt, updatedAt: reviewedAt })
      .where(eq(trades.id, id))
      .run();

    return NextResponse.json({ reviewedAt, workflowPhase: 'reviewed' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to mark trade reviewed', details: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    if (trade.status !== 'closed') {
      return NextResponse.json(
        {
          error: `Only closed trades can have their review reopened; this trade is ${trade.status}.`,
        },
        { status: 409 },
      );
    }

    db.update(trades)
      .set({ reviewedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(trades.id, id))
      .run();

    return NextResponse.json({ reviewedAt: null, workflowPhase: 'closed' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reopen trade review', details: String(error) },
      { status: 500 },
    );
  }
}
