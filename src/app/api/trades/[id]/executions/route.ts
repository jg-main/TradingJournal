import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, tradeExecutions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  executeTradeFill,
  TradeNotFoundError,
  TradeDeletedError,
  IdempotentReplayError,
  ReadinessFailureError,
  ActionDirectionError,
  ChecklistGateError,
  OverCloseError,
  OpenPositionRequiredError,
  type ExecuteTradeFillInput,
} from '@/lib/trade-execution-engine';

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
  checkResults: z.array(z.object({
    checklistDefinitionId: z.string(),
    passed: z.boolean(),
    comment: z.string().optional(),
  })).optional(),
  riskOverrideReason: z.string().min(1).max(500).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
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

/**
 * POST /api/trades/:id/executions — thin HTTP adapter over the canonical
 * atomic execution engine (S03). All execution logic — action-direction
 * validation, first-fill readiness gate, checklist gate with item-text
 * snapshots, trade status derivation, risk snapshot, accounting posting, FIFO
 * position rebuild, performance rebuild — lives in executeTradeFill. This
 * route only parses the body, supplies an idempotency key when the client
 * did not, maps engine errors to HTTP responses, and serializes the result.
 */
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

    const {
      action,
      quantity,
      price,
      executedAt,
      fees,
      reasonId,
      notes,
      checkResults,
      riskOverrideReason,
      idempotencyKey,
    } = parsed.data;

    const input: ExecuteTradeFillInput = {
      tradeId: id,
      action,
      quantity,
      price,
      fees: fees ?? 0,
      executedAt,
      // Client-generated key wins; otherwise mint one so retries are
      // replay-safe even when the UI does not send a key (S03).
      idempotencyKey: idempotencyKey ?? randomUUID(),
      checkResults,
      riskOverrideReason,
      reasonId: reasonId ?? null,
      notes: notes ?? null,
    };

    try {
      const result = executeTradeFill(input, {
        db,
        sqlite: getSqliteHandle(),
      });
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      // Idempotent replay: a concurrent duplicate (or a retried request) hit
      // the partial unique index; return the original result with 200.
      if (err instanceof IdempotentReplayError) {
        return NextResponse.json(err.result, { status: 200 });
      }
      if (err instanceof TradeNotFoundError) {
        return NextResponse.json(
          { error: 'Trade not found' },
          { status: 404 },
        );
      }
      if (err instanceof TradeDeletedError) {
        return NextResponse.json(
          { error: 'Cannot add executions to a deleted trade' },
          { status: 400 },
        );
      }
      if (err instanceof ReadinessFailureError) {
        // Non-max-risk failures block unconditionally.
        const nonMaxRisk = err.failures.find(
          (f) => f.code !== 'max-risk-exceeded',
        );
        if (nonMaxRisk) {
          const status =
            nonMaxRisk.code === 'account-not-active' ||
            nonMaxRisk.code === 'account-not-trading-ready'
              ? 409
              : 400;
          return NextResponse.json({ error: nonMaxRisk.message }, { status });
        }
        // Max-risk is overrideable when the client supplies a reason.
        const maxRisk = err.failures.find((f) => f.code === 'max-risk-exceeded');
        if (maxRisk) {
          return NextResponse.json(
            {
              error: 'Max risk exceeded',
              details: {
                limit: maxRisk.limit ?? null,
                computed: maxRisk.computed ?? null,
                overrideable: true,
              },
            },
            { status: 422 },
          );
        }
        return NextResponse.json({ error: 'Execution not ready' }, { status: 400 });
      }
      if (err instanceof ActionDirectionError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: {
              fieldErrors: {
                action: [err.message],
              },
            },
          },
          { status: 400 },
        );
      }
      if (err instanceof OverCloseError) {
        // S04 pre-flight rejection: a closing fill exceeded the open quantity.
        // Thrown before any mutation — nothing to roll back, so a friendly 400.
        return NextResponse.json(
          {
            error: 'Over-close rejected',
            details: {
              requestedQuantity: err.requestedQuantity,
              openQuantity: err.openQuantity,
            },
          },
          { status: 400 },
        );
      }
      if (err instanceof OpenPositionRequiredError) {
        // S04 pre-flight rejection: 'add'/'reduce' on a trade with no open
        // position (still planned).
        return NextResponse.json(
          {
            error: 'Action requires open position',
            details: {
              action: err.action,
            },
          },
          { status: 400 },
        );
      }
      if (err instanceof ChecklistGateError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: {
              fieldErrors: {
                checkResults: [
                  ...(err.missing.length > 0
                    ? [`Missing check results for: ${err.missing.join(', ')}`]
                    : []),
                  ...(err.notPassed.length > 0
                    ? [`Checklist items must be passed before execution: ${err.notPassed.join(', ')}`]
                    : []),
                ],
              },
            },
          },
          { status: 400 },
        );
      }
      // Unknown engine failure: bubble up (the engine rolled back everything).
      throw err;
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create execution', details: String(error) },
      { status: 500 },
    );
  }
}
