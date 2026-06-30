import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { lookupValues } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const updateLookupSchema = z.object({
  value: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateLookupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db.select().from(lookupValues).where(eq(lookupValues.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Lookup not found' }, { status: 404 });
    }

    db.update(lookupValues)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(lookupValues.id, id))
      .run();

    const row = db.select().from(lookupValues).where(eq(lookupValues.id, id)).get();
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update lookup', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db.select().from(lookupValues).where(eq(lookupValues.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Lookup not found' }, { status: 404 });
    }

    db.update(lookupValues)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(lookupValues.id, id))
      .run();

    return NextResponse.json({ message: 'Lookup deactivated' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete lookup', details: String(error) },
      { status: 500 }
    );
  }
}
