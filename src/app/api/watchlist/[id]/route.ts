import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { watchlistItems } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const updateWatchlistItemSchema = z.object({
  symbol: z.string().trim().min(1).max(20).optional(),
  keyLevel: z.number().nullable().optional(),
  alertConfig: z.any().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const row = db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.id, id))
      .get();

    if (!row) {
      return NextResponse.json(
        { error: 'Watchlist item not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch watchlist item', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateWatchlistItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Watchlist item not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.symbol !== undefined) updateData.symbol = parsed.data.symbol;
    if (parsed.data.keyLevel !== undefined) updateData.keyLevel = parsed.data.keyLevel;
    if (parsed.data.alertConfig !== undefined) updateData.alertConfig = parsed.data.alertConfig != null ? JSON.stringify(parsed.data.alertConfig) : null;
    updateData.updatedAt = new Date().toISOString();

    db.update(watchlistItems)
      .set(updateData)
      .where(eq(watchlistItems.id, id))
      .run();

    const row = db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.id, id))
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update watchlist item', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Watchlist item not found' },
        { status: 404 }
      );
    }

    // Soft delete: mark as expired instead of removing
    db.update(watchlistItems)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(watchlistItems.id, id))
      .run();

    return NextResponse.json({ message: 'Watchlist item expired' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete watchlist item', details: String(error) },
      { status: 500 }
    );
  }
}
