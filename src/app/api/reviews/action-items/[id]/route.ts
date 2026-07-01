import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { reviewActionItems } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

const updateActionItemSchema = z.object({
  actionText: z.string().trim().min(1, 'Action text is required').optional(),
  status: z.enum(STATUSES).optional(),
  dueDate: z.string().trim().optional().nullable(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(reviewActionItems)
      .where(eq(reviewActionItems.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Action item not found' },
        { status: 404 },
      );
    }

    const body = await request.json();
    const parsed = updateActionItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: parsed.error.flatten().fieldErrors } },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const updateValues: Record<string, string | null> = { updatedAt: now };

    if (parsed.data.actionText !== undefined) {
      updateValues.actionText = parsed.data.actionText;
    }
    if (parsed.data.status !== undefined) {
      updateValues.status = parsed.data.status;
    }
    if (parsed.data.dueDate !== undefined) {
      updateValues.dueDate = parsed.data.dueDate;
    }

    db.update(reviewActionItems)
      .set(updateValues)
      .where(eq(reviewActionItems.id, id))
      .run();

    const updated = db
      .select()
      .from(reviewActionItems)
      .where(eq(reviewActionItems.id, id))
      .get();

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update action item', details: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(reviewActionItems)
      .where(eq(reviewActionItems.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Action item not found' },
        { status: 404 },
      );
    }

    db.delete(reviewActionItems)
      .where(eq(reviewActionItems.id, id))
      .run();

    return NextResponse.json({ message: 'Action item removed' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete action item', details: String(error) },
      { status: 500 },
    );
  }
}
