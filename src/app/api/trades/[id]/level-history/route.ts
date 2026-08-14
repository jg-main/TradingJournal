import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeStopAdjustments, tradeTargetAdjustments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { compareLevelEventsDesc } from '@/lib/trade-levels';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Unified level-history event: one stop adjustment or one target adjustment,
 * normalized into a single feed shape so a client can render the full level
 * change history of a trade without joining two endpoints.
 *
 * - type 'stop'  → oldValue/newValue are previousStop/newStop, no targetIndex.
 * - type 'target' → oldValue/newValue are previousTarget/newTarget, and
 *   targetIndex (1|2) identifies which planned target level was rewritten.
 *
 * Events are ordered adjustedAt desc, createdAt desc, id desc (the same
 * canonical ordering as each individual adjustment list, via
 * compareLevelEventsDesc from src/lib/trade-levels.ts).
 */
export interface LevelHistoryEvent {
  type: 'stop' | 'target';
  id: string;
  adjustedAt: string | null;
  oldValue: number | null;
  newValue: number | null;
  reason: string | null;
  ruleBased: boolean | null;
  targetIndex?: number;
  createdAt: string | null;
}

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

    const stopAdjustments = db
      .select()
      .from(tradeStopAdjustments)
      .where(eq(tradeStopAdjustments.tradeId, id))
      .all();

    const targetAdjustments = db
      .select()
      .from(tradeTargetAdjustments)
      .where(eq(tradeTargetAdjustments.tradeId, id))
      .all();

    const events: LevelHistoryEvent[] = [
      ...stopAdjustments.map((a) => ({
        type: 'stop' as const,
        id: a.id,
        adjustedAt: a.adjustedAt,
        oldValue: a.previousStop,
        newValue: a.newStop,
        reason: a.reason,
        ruleBased: a.ruleBased,
        createdAt: a.createdAt,
      })),
      ...targetAdjustments.map((a) => ({
        type: 'target' as const,
        id: a.id,
        adjustedAt: a.adjustedAt,
        oldValue: a.previousTarget,
        newValue: a.newTarget,
        reason: a.reason,
        ruleBased: a.ruleBased,
        targetIndex: a.targetIndex,
        createdAt: a.createdAt,
      })),
    ];

    events.sort(compareLevelEventsDesc);

    return NextResponse.json(events);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch level history', details: String(error) },
      { status: 500 },
    );
  }
}
