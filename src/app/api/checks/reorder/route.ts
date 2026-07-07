import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { checklistDefinitions } from '@/db/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { z } from 'zod';

const reorderItemSchema = z.object({
  id: z.string().min(1, 'Item id is required'),
  sortOrder: z.number().int().min(0, 'sortOrder must be >= 0'),
});

const reorderSchema = z.object({
  items: z.array(reorderItemSchema).min(1, 'At least one item is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = reorderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const items = parsed.data.items;
    const ids = items.map((i) => i.id);

    // Fetch existing checks to validate they all exist and are not soft-deleted
    const existing = db
      .select({ id: checklistDefinitions.id })
      .from(checklistDefinitions)
      .where(
        and(
          inArray(checklistDefinitions.id, ids),
          isNull(checklistDefinitions.deletedAt),
        ),
      )
      .all();

    const existingIds = new Set(existing.map((r) => r.id));
    const missing = ids.filter((id) => !existingIds.has(id));

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              items: missing.map((id) => `Check "${id}" not found or already deleted`),
            },
          },
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    // Use db.transaction for atomic batch update
    const updatedItems = db.transaction(() => {
      for (const item of items) {
        db.update(checklistDefinitions)
          .set({ sortOrder: item.sortOrder, updatedAt: now })
          .where(eq(checklistDefinitions.id, item.id))
          .run();
      }

      return db
        .select()
        .from(checklistDefinitions)
        .where(inArray(checklistDefinitions.id, ids))
        .all();
    });

    return NextResponse.json(updatedItems);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reorder checks', details: String(error) },
      { status: 500 },
    );
  }
}
