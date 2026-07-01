import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeStopAdjustments } from '@/db/schema';
import { eq } from 'drizzle-orm';

type RouteParams = { params: Promise<{ id: string; adjustmentId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, adjustmentId } = await params;

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

    const adjustment = db
      .select()
      .from(tradeStopAdjustments)
      .where(eq(tradeStopAdjustments.id, adjustmentId))
      .get();

    if (!adjustment) {
      return NextResponse.json(
        { error: 'Stop adjustment not found' },
        { status: 404 },
      );
    }

    db.delete(tradeStopAdjustments)
      .where(eq(tradeStopAdjustments.id, adjustmentId))
      .run();

    return NextResponse.json({ message: 'Stop adjustment deleted' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete stop adjustment', details: String(error) },
      { status: 500 },
    );
  }
}
