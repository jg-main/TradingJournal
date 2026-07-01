import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, lookupValues } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

const updateTradeSchema = z.object({
  setup: z.string().nullable().optional(),
  sectorId: z.string().nullable().optional(),
  marketConditionId: z.string().nullable().optional(),
  thesis: z.string().nullable().optional(),
  plannedEntry: z.number().nullable().optional(),
  plannedStop: z.number().nullable().optional(),
  plannedTarget1: z.number().nullable().optional(),
  plannedTarget2: z.number().nullable().optional(),
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
    if (parsed.data.setup !== undefined) {
      if (parsed.data.setup === null) {
        updateData.setupId = null;
      } else {
        const lowerValue = parsed.data.setup.toLowerCase();
        const lookup = db
          .select()
          .from(lookupValues)
          .where(and(eq(lookupValues.type, 'setup'), eq(lookupValues.value, lowerValue)))
          .get();
        if (!lookup) {
          return NextResponse.json(
            { error: 'Validation failed', details: { fieldErrors: { setup: ['Unknown setup value'] } } },
            { status: 400 }
          );
        }
        updateData.setupId = lookup.id;
      }
    }
    if (parsed.data.sectorId !== undefined) updateData.sectorId = parsed.data.sectorId;
    if (parsed.data.marketConditionId !== undefined) updateData.marketConditionId = parsed.data.marketConditionId;
    if (parsed.data.thesis !== undefined) updateData.thesis = parsed.data.thesis;
    if (parsed.data.plannedEntry !== undefined) updateData.plannedEntry = parsed.data.plannedEntry;
    if (parsed.data.plannedStop !== undefined) updateData.plannedStop = parsed.data.plannedStop;
    if (parsed.data.plannedTarget1 !== undefined) updateData.plannedTarget1 = parsed.data.plannedTarget1;
    if (parsed.data.plannedTarget2 !== undefined) updateData.plannedTarget2 = parsed.data.plannedTarget2;
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

    // Soft delete: mark as scratched instead of removing
    db.update(trades)
      .set({ status: 'scratched', updatedAt: new Date().toISOString() })
      .where(eq(trades.id, id))
      .run();

    return NextResponse.json({ message: 'Trade scratched' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete trade', details: String(error) },
      { status: 500 }
    );
  }
}
