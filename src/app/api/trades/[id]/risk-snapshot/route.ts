import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeRiskSnapshots } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const updateRiskSnapshotSchema = z.object({
  accountEquityAtOpen: z.number().nullable().optional(),
  initialEntryPrice: z.number().nullable().optional(),
  initialStopPrice: z.number().nullable().optional(),
  initialQuantity: z.number().nullable().optional(),
  riskPerShare: z.number().nullable().optional(),
  initialRiskAmount: z.number().nullable().optional(),
  accountRiskPct: z.number().nullable().optional(),
  plannedRewardRisk: z.number().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const row = db
      .select()
      .from(tradeRiskSnapshots)
      .where(eq(tradeRiskSnapshots.tradeId, id))
      .get();

    if (!row) {
      return NextResponse.json(
        { error: 'Risk snapshot not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch risk snapshot', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateRiskSnapshotSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Check trade exists
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

    const now = new Date().toISOString();
    const providedFields = parsed.data;

    // Check if a risk snapshot already exists
    const existing = db
      .select()
      .from(tradeRiskSnapshots)
      .where(eq(tradeRiskSnapshots.tradeId, id))
      .get();

    if (!existing) {
      // Create new snapshot with provided fields
      const snapshotId = randomUUID();
      const insertValues: Record<string, unknown> = {
        id: snapshotId,
        tradeId: id,
        createdAt: now,
      };

      for (const [key, value] of Object.entries(providedFields)) {
        if (value !== undefined) {
          insertValues[key] = value;
        }
      }

      db.insert(tradeRiskSnapshots)
        .values(insertValues as any)
        .run();

      const created = db
        .select()
        .from(tradeRiskSnapshots)
        .where(eq(tradeRiskSnapshots.id, snapshotId))
        .get();

      return NextResponse.json(created, { status: 201 });
    }

    // Update existing snapshot with only provided fields
    const updateValues: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(providedFields)) {
      if (value !== undefined) {
        updateValues[key] = value;
      }
    }

    if (Object.keys(updateValues).length > 0) {
      db.update(tradeRiskSnapshots)
        .set(updateValues as any)
        .where(eq(tradeRiskSnapshots.id, existing.id))
        .run();
    }

    const updated = db
      .select()
      .from(tradeRiskSnapshots)
      .where(eq(tradeRiskSnapshots.id, existing.id))
      .get();

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update risk snapshot', details: String(error) },
      { status: 500 },
    );
  }
}
