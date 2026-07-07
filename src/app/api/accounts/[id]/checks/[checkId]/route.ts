import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { checklistDefinitions, accounts } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';

const updateCheckSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string; checkId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, checkId } = await params;

    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const row = db
      .select()
      .from(checklistDefinitions)
      .where(
        and(
          eq(checklistDefinitions.id, checkId),
          eq(checklistDefinitions.accountId, id),
          isNull(checklistDefinitions.deletedAt),
        ),
      )
      .get();

    if (!row) {
      return NextResponse.json({ error: 'Check not found' }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch account check', details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, checkId } = await params;

    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const existing = db
      .select()
      .from(checklistDefinitions)
      .where(
        and(
          eq(checklistDefinitions.id, checkId),
          eq(checklistDefinitions.accountId, id),
          isNull(checklistDefinitions.deletedAt),
        ),
      )
      .get();

    if (!existing) {
      return NextResponse.json({ error: 'Check not found' }, { status: 404 });
    }

    const body = await request.json();
    const parsed = updateCheckSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    db.update(checklistDefinitions)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(checklistDefinitions.id, checkId))
      .run();

    const row = db
      .select()
      .from(checklistDefinitions)
      .where(eq(checklistDefinitions.id, checkId))
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update account check', details: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, checkId } = await params;

    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const existing = db
      .select()
      .from(checklistDefinitions)
      .where(
        and(
          eq(checklistDefinitions.id, checkId),
          eq(checklistDefinitions.accountId, id),
          isNull(checklistDefinitions.deletedAt),
        ),
      )
      .get();

    if (!existing) {
      return NextResponse.json({ error: 'Check not found' }, { status: 404 });
    }

    // Soft delete: set deletedAt timestamp
    db.update(checklistDefinitions)
      .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(checklistDefinitions.id, checkId))
      .run();

    return NextResponse.json({ message: 'Check deleted' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete account check', details: String(error) },
      { status: 500 },
    );
  }
}
