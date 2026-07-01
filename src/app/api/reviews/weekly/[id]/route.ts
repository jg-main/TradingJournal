import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { weeklyReviews } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const IMMUTABLE_FIELDS = [
  'weekStart', 'weekEnd', 'accountId',
  'closedTrades', 'netPnl', 'avgR', 'winRate', 'avgProcessScore',
] as const;

const updateReviewSchema = z.object({
  notes: z.string().optional().nullable(),
  focusNextWeek: z.string().optional().nullable(),
}).refine(
  (data) => data.notes !== undefined || data.focusNextWeek !== undefined,
  { message: 'At least one of notes or focusNextWeek must be provided' },
);

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const row = db
      .select()
      .from(weeklyReviews)
      .where(eq(weeklyReviews.id, id))
      .get();

    if (!row) {
      return NextResponse.json(
        { error: 'Weekly review not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch weekly review', details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(weeklyReviews)
      .where(eq(weeklyReviews.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Weekly review not found' },
        { status: 404 },
      );
    }

    const body = await request.json();

    // Reject attempts to modify immutable metrics fields
    const attemptedImmutable = Object.keys(body).filter((k) =>
      (IMMUTABLE_FIELDS as readonly string[]).includes(k),
    );
    if (attemptedImmutable.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot modify immutable fields',
          details: { fields: attemptedImmutable },
        },
        { status: 400 },
      );
    }

    const parsed = updateReviewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: { fieldErrors: parsed.error.flatten().fieldErrors },
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const updateValues: Record<string, string | null> = { updatedAt: now };

    if (parsed.data.notes !== undefined) {
      updateValues.notes = parsed.data.notes;
    }
    if (parsed.data.focusNextWeek !== undefined) {
      updateValues.focusNextWeek = parsed.data.focusNextWeek;
    }

    db.update(weeklyReviews)
      .set(updateValues)
      .where(eq(weeklyReviews.id, id))
      .run();

    const updated = db
      .select()
      .from(weeklyReviews)
      .where(eq(weeklyReviews.id, id))
      .get();

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update weekly review', details: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(weeklyReviews)
      .where(eq(weeklyReviews.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Weekly review not found' },
        { status: 404 },
      );
    }

    db.delete(weeklyReviews)
      .where(eq(weeklyReviews.id, id))
      .run();

    return NextResponse.json({ message: 'Weekly review removed' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete weekly review', details: String(error) },
      { status: 500 },
    );
  }
}
