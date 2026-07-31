import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeStopAdjustments } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const createStopAdjustmentSchema = z.object({
  adjustedAt: z.string().optional(),
  previousStop: z.number().positive(),
  newStop: z.number().positive(),
  reason: z.string().nullable().optional(),
  ruleBased: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    const adjustments = db
      .select()
      .from(tradeStopAdjustments)
      .where(eq(tradeStopAdjustments.tradeId, id))
      .orderBy(desc(tradeStopAdjustments.adjustedAt), desc(tradeStopAdjustments.createdAt), desc(tradeStopAdjustments.id))
      .all();

    return NextResponse.json(adjustments);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch stop adjustments', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = createStopAdjustmentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: parsed.error.flatten().fieldErrors } },
        { status: 400 },
      );
    }

    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    const adjustmentId = randomUUID();
    const now = new Date().toISOString();

    db.insert(tradeStopAdjustments)
      .values({
        id: adjustmentId,
        tradeId: id,
        previousStop: parsed.data.previousStop,
        newStop: parsed.data.newStop,
        adjustedAt: parsed.data.adjustedAt ?? now,
        reason: parsed.data.reason ?? null,
        ruleBased: parsed.data.ruleBased ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
      })
      .run();

    const created = db
      .select()
      .from(tradeStopAdjustments)
      .where(eq(tradeStopAdjustments.id, adjustmentId))
      .get();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create stop adjustment', details: String(error) },
      { status: 500 },
    );
  }
}

