import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeTargetAdjustments } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { deriveCurrentTarget } from '@/lib/trade-levels';

const createTargetAdjustmentSchema = z.object({
  adjustedAt: z.string().optional(),
  // M019: previousTarget is intentionally NOT part of the client contract.
  // It is derived server-side from the adjustment chain for the same target
  // index (latest newTarget), else the planned target. Client-sent values
  // are stripped by zod and never trusted — same policy as previousStop.
  targetIndex: z.literal(1).or(z.literal(2)),
  newTarget: z.number().positive(),
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
      .from(tradeTargetAdjustments)
      .where(eq(tradeTargetAdjustments.tradeId, id))
      .orderBy(desc(tradeTargetAdjustments.adjustedAt), desc(tradeTargetAdjustments.createdAt), desc(tradeTargetAdjustments.id))
      .all();

    return NextResponse.json(adjustments);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch target adjustments', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = createTargetAdjustmentSchema.safeParse(body);

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

    // Target adjustments follow the same lifecycle rule as stop adjustments
    // (R020 spirit): only open trades have live target levels. Planned trades
    // have not entered the market; closed and deleted trades are immutable
    // history. Reject before any write so the audit trail stays consistent.
    if (trade.status !== 'open') {
      return NextResponse.json(
        { error: 'Target adjustments are only allowed for open trades.' },
        { status: 409 },
      );
    }

    const adjustmentId = randomUUID();
    const now = new Date().toISOString();

    // M019: derive previousTarget server-side — the latest target adjustment
    // for the same targetIndex, else the planned target for that index.
    // plannedTarget1/2 stay immutable once the trade leaves planned status.
    const existingAdjustments = db
      .select()
      .from(tradeTargetAdjustments)
      .where(eq(tradeTargetAdjustments.tradeId, id))
      .all();

    const plannedTarget = parsed.data.targetIndex === 1 ? trade.plannedTarget1 : trade.plannedTarget2;

    const previousTarget = deriveCurrentTarget(
      plannedTarget ?? null,
      parsed.data.targetIndex,
      existingAdjustments.map((a) => ({
        id: a.id,
        targetIndex: a.targetIndex,
        newTarget: a.newTarget,
        adjustedAt: a.adjustedAt,
        createdAt: a.createdAt,
      })),
    );

    db.insert(tradeTargetAdjustments)
      .values({
        id: adjustmentId,
        tradeId: id,
        targetIndex: parsed.data.targetIndex,
        previousTarget,
        newTarget: parsed.data.newTarget,
        adjustedAt: parsed.data.adjustedAt ?? now,
        reason: parsed.data.reason ?? null,
        ruleBased: parsed.data.ruleBased ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
      })
      .run();

    const created = db
      .select()
      .from(tradeTargetAdjustments)
      .where(eq(tradeTargetAdjustments.id, adjustmentId))
      .get();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create target adjustment', details: String(error) },
      { status: 500 },
    );
  }
}
