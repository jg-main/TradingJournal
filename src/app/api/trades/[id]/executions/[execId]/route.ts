import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { trades, tradeExecutions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { computeTradeMetrics, type ExecutionData, type Direction } from '@/lib/trade-metrics';

type RouteParams = { params: Promise<{ id: string; execId: string }> };

const updateExecutionSchema = z.object({
  action: z.enum(['buy', 'sell', 'buy_to_cover', 'sell_short', 'add', 'reduce']).optional(),
  quantity: z.number().positive().optional(),
  price: z.number().positive().optional(),
  executedAt: z.string().optional(),
  fees: z.number().min(0).optional(),
  reasonId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

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

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, execId } = await params;
    const body = await request.json();
    const parsed = updateExecutionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid execution data', details: parsed.error.flatten() },
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

    const execution = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.id, execId))
      .get();

    if (!execution || execution.tradeId !== id) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.action !== undefined) updateData.action = parsed.data.action;
    if (parsed.data.quantity !== undefined) updateData.quantity = parsed.data.quantity;
    if (parsed.data.price !== undefined) updateData.price = parsed.data.price;
    if (parsed.data.executedAt !== undefined) updateData.executedAt = parsed.data.executedAt;
    if (parsed.data.fees !== undefined) updateData.fees = parsed.data.fees;
    if (parsed.data.reasonId !== undefined) updateData.reasonId = parsed.data.reasonId;
    if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

    db.update(tradeExecutions)
      .set(updateData)
      .where(eq(tradeExecutions.id, execId))
      .run();

    const allExecutions = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.tradeId, id))
      .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
      .all();

    const execData = toExecutionData(allExecutions);
    const metrics = computeTradeMetrics({
      executions: execData,
      direction: trade.direction as Direction,
      riskSnapshot: null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    });
    const now = new Date().toISOString();

    db.update(trades)
      .set({
        status: metrics.position.status,
        openedAt: metrics.position.openedAt,
        closedAt: metrics.position.closedAt,
        updatedAt: now,
      })
      .where(eq(trades.id, id))
      .run();

    const updated = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.id, execId))
      .get();

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update execution', details: String(error) },
      { status: 500 },
    );
  }
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
    const metrics = computeTradeMetrics({
      executions: execData,
      direction: trade.direction as Direction,
      riskSnapshot: null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    });

    db.update(trades)
      .set({
        status: metrics.position.status,
        openedAt: metrics.position.openedAt,
        closedAt: metrics.position.closedAt,
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
