import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeExecutions, tradeRiskSnapshots } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  deriveTradeStatus,
  calculateAvgCost,
  type ExecutionData,
} from '@/lib/trade-calc';

const createExecutionSchema = z.object({
  action: z.enum([
    'buy',
    'sell',
    'buy_to_cover',
    'sell_short',
    'add',
    'reduce',
  ]),
  quantity: z.number().positive(),
  price: z.number().positive(),
  executedAt: z.string().optional(),
  fees: z.number().min(0).optional().default(0),
  reasonId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

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

    const executions = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.tradeId, id))
      .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
      .all();

    return NextResponse.json(executions);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch executions', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = createExecutionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
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

    if (trade.status === 'scratched') {
      return NextResponse.json(
        { error: 'Cannot add executions to a scratched trade' },
        { status: 400 },
      );
    }

    if (trade.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot add executions to a closed trade' },
        { status: 400 },
      );
    }

    const executionId = randomUUID();
    const now = new Date().toISOString();

    db.insert(tradeExecutions)
      .values({
        id: executionId,
        tradeId: id,
        action: parsed.data.action,
        quantity: parsed.data.quantity,
        price: parsed.data.price,
        fees: parsed.data.fees,
        executedAt: parsed.data.executedAt ?? now,
        reasonId: parsed.data.reasonId ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
      })
      .run();

    // ── Recalculate trade status and timestamps ──────────────────────

    const allExecutions = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.tradeId, id))
      .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
      .all();

    const execData = toExecutionData(allExecutions);
    const derived = deriveTradeStatus(execData, trade.direction as 'long' | 'short');

    db.update(trades)
      .set({
        status: derived.status,
        openedAt: derived.openedAt,
        closedAt: derived.closedAt,
        updatedAt: now,
      })
      .where(eq(trades.id, id))
      .run();

    // ── Upsert risk snapshot on first entry ──────────────────────────

    if (derived.status !== 'planned' && derived.totalEntryQty > 0) {
      const existingSnapshot = db
        .select()
        .from(tradeRiskSnapshots)
        .where(eq(tradeRiskSnapshots.tradeId, id))
        .get();

      if (!existingSnapshot) {
        const entryCount = execData.filter((e) =>
          trade.direction === 'long'
            ? e.action === 'buy' || e.action === 'add'
            : e.action === 'sell_short',
        ).length;

        if (entryCount > 0) {
          const { avgEntryPrice } = calculateAvgCost(
            execData.filter((e) =>
              trade.direction === 'long'
                ? e.action === 'buy' || e.action === 'add'
                : e.action === 'sell_short',
            ),
          );

          if (avgEntryPrice !== null) {
            const snapshotValues: Record<string, unknown> = {
              id: randomUUID(),
              tradeId: id,
              initialEntryPrice: avgEntryPrice,
              initialQuantity: derived.totalEntryQty,
              createdAt: now,
            };

            if (trade.plannedStop != null) {
              snapshotValues.initialStopPrice = trade.plannedStop;
            }

            db.insert(tradeRiskSnapshots)
              .values(snapshotValues as any)
              .run();
          }
        }
      }
    }

    const created = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.id, executionId))
      .get();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create execution', details: String(error) },
      { status: 500 },
    );
  }
}
