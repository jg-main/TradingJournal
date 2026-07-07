import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { checklistDefinitions, setupDefinitions } from '@/db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { z } from 'zod';

const createCheckSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500),
  sortOrder: z.number().int().min(0).optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const setup = db.select().from(setupDefinitions).where(eq(setupDefinitions.id, id)).get();
    if (!setup) {
      return NextResponse.json({ error: 'Setup not found' }, { status: 404 });
    }

    const rows = db
      .select()
      .from(checklistDefinitions)
      .where(
        and(
          eq(checklistDefinitions.setupId, id),
          isNull(checklistDefinitions.deletedAt),
        ),
      )
      .orderBy(asc(checklistDefinitions.sortOrder), asc(checklistDefinitions.createdAt))
      .all();

    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch setup checks', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const setup = db.select().from(setupDefinitions).where(eq(setupDefinitions.id, id)).get();
    if (!setup) {
      return NextResponse.json({ error: 'Setup not found' }, { status: 404 });
    }

    const body = await request.json();
    const parsed = createCheckSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const checkId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Auto-assign sort_order if not provided
    let sortOrder = parsed.data.sortOrder;
    if (sortOrder === undefined) {
      const maxOrder = db
        .select({ max: checklistDefinitions.sortOrder })
        .from(checklistDefinitions)
        .where(
          and(
            eq(checklistDefinitions.setupId, id),
            isNull(checklistDefinitions.deletedAt),
          ),
        )
        .all();
      const maxVal = maxOrder[0]?.max ?? null;
      sortOrder = (maxVal ?? -1) + 1;
    }

    db.insert(checklistDefinitions)
      .values({
        id: checkId,
        setupId: id,
        description: parsed.data.description,
        sortOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db
      .select()
      .from(checklistDefinitions)
      .where(eq(checklistDefinitions.id, checkId))
      .get();

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create setup check', details: String(error) },
      { status: 500 },
    );
  }
}
