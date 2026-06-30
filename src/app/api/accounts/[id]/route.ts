import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { accounts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const updateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  broker: z.string().max(200).nullable().optional(),
  currency: z.string().min(1).max(3).optional(),
  isActive: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateAccountSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    db.update(accounts)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update account', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Soft delete: mark as inactive instead of removing
    db.update(accounts)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    return NextResponse.json({ message: 'Account deactivated' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete account', details: String(error) },
      { status: 500 }
    );
  }
}
