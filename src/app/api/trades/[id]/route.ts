import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, watchlistItems } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { resolveSetup } from '@/lib/setup-resolver';

const updateTradeSchema = z.object({
  setup: z.string().nullable().optional(),
  setupId: z.string().uuid().nullable().optional(),
  sectorId: z.string().nullable().optional(),
  marketConditionId: z.string().nullable().optional(),
  thesis: z.string().nullable().optional(),
  plannedEntry: z.number().nullable().optional(),
  plannedStop: z.number().nullable().optional(),
  plannedTarget1: z.number().nullable().optional(),
  plannedQuantity: z.number().nullable().optional(),

  invalidationCondition: z.string().nullable().optional(),
  preTradePlan: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const row = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!row) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch trade', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateTradeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    // Map 'setup' back to 'setupId' for the DB column
    const updateData: Record<string, unknown> = {};
    if (parsed.data.setupId !== undefined) {
      updateData.setupId = parsed.data.setupId;
    } else if (parsed.data.setup !== undefined) {
      if (parsed.data.setup === null) {
        updateData.setupId = null;
      } else {
        const resolved = resolveSetup(parsed.data.setup);
        if (!resolved) {
          // This shouldn't happen since resolveSetup always creates a record for non-null values
          updateData.setupId = null;
        } else {
          updateData.setupId = resolved.id;
        }
      }
    }
    if (parsed.data.sectorId !== undefined) updateData.sectorId = parsed.data.sectorId;
    if (parsed.data.marketConditionId !== undefined) updateData.marketConditionId = parsed.data.marketConditionId;
    if (parsed.data.thesis !== undefined) updateData.thesis = parsed.data.thesis;
    if (parsed.data.plannedEntry !== undefined) updateData.plannedEntry = parsed.data.plannedEntry;
    if (parsed.data.plannedStop !== undefined) updateData.plannedStop = parsed.data.plannedStop;
    if (parsed.data.plannedTarget1 !== undefined) updateData.plannedTarget1 = parsed.data.plannedTarget1;
    if (parsed.data.plannedQuantity !== undefined) updateData.plannedQuantity = parsed.data.plannedQuantity;

    if (parsed.data.invalidationCondition !== undefined) updateData.invalidationCondition = parsed.data.invalidationCondition;
    if (parsed.data.preTradePlan !== undefined) updateData.preTradePlan = parsed.data.preTradePlan;
    updateData.updatedAt = new Date().toISOString();

    db.update(trades)
      .set(updateData)
      .where(eq(trades.id, id))
      .run();

    const row = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update trade', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    // Hard delete: nullify watchlist FK references first, then delete
    db.update(watchlistItems)
      .set({ promotedTradeId: null })
      .where(eq(watchlistItems.promotedTradeId, id))
      .run();

    db.delete(trades)
      .where(eq(trades.id, id))
      .run();

    return NextResponse.json({ message: 'Trade deleted' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete trade', details: String(error) },
      { status: 500 }
    );
  }
}
