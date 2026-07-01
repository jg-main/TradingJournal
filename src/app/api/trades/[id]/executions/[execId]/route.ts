import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeExecutions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  deriveTradeStatus,
  type ExecutionData,
} from '@/lib/trade-calc';

type RouteParams = { params: Promise<{ id: string; execId: string }> };

function toExecutionData(
  rows: typeof tradeExecutions.$inferSelect[],
): ExecutionData[] {
  return rows.map((r) => ({
    action: r.action,
    quantity: r.quantity,
    price: r.price,
    fees: r.fees,
    executedAt: r.executedAt ?? r.createdAt ?? '',
  }));
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, execId } = await params;

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

    const execution = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.id, execId))
      .get();

    if (!execution) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 },
      );
    }

    db.delete(tradeExecutions)
      .where(eq(tradeExecutions.id, execId))
      .run();

    // ── Recalculate trade status and timestamps ──────────────────────

    const remaining = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.tradeId, id))
      .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
      .all();

    const execData = toExecutionData(remaining);
    const derived = deriveTradeStatus(execData, trade.direction as 'long' | 'short');

    db.update(trades)
      .set({
        status: derived.status,
        openedAt: derived.openedAt,
        closedAt: derived.closedAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trades.id, id))
      .run();

    return NextResponse.json({ message: 'Execution deleted' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete execution', details: String(error) },
      { status: 500 },
    );
  }
}
