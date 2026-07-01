import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { reviewActionItems } from '@/db/schema';
import { eq, and, like } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const SOURCE_TYPES = ['weekly_review', 'trade_review', 'general'] as const;
const STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

const createActionItemSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  sourceId: z.string().trim().optional(),
  actionText: z.string().trim().min(1, 'Action text is required'),
  status: z.enum(STATUSES).optional().default('open'),
  dueDate: z.string().trim().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceType = searchParams.get('sourceType');
    const sourceId = searchParams.get('sourceId');
    const status = searchParams.get('status');

    const conditions: ReturnType<typeof eq>[] = [];

    if (sourceType) {
      conditions.push(eq(reviewActionItems.sourceType, sourceType as 'weekly_review' | 'trade_review' | 'general'));
    }
    if (sourceId) {
      conditions.push(eq(reviewActionItems.sourceId, sourceId));
    }
    if (status) {
      conditions.push(eq(reviewActionItems.status, status as 'open' | 'in_progress' | 'done' | 'cancelled'));
    }

    const query = db
      .select()
      .from(reviewActionItems)
      .orderBy(reviewActionItems.createdAt);

    const items = conditions.length > 0
      ? query.where(and(...conditions)).all()
      : query.all();

    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch action items', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createActionItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: parsed.error.flatten().fieldErrors } },
        { status: 400 },
      );
    }

    const itemId = randomUUID();
    const now = new Date().toISOString();

    db.insert(reviewActionItems)
      .values({
        id: itemId,
        sourceType: parsed.data.sourceType,
        sourceId: parsed.data.sourceId ?? null,
        actionText: parsed.data.actionText,
        status: parsed.data.status,
        dueDate: parsed.data.dueDate ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = db
      .select()
      .from(reviewActionItems)
      .where(eq(reviewActionItems.id, itemId))
      .get();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create action item', details: String(error) },
      { status: 500 },
    );
  }
}
