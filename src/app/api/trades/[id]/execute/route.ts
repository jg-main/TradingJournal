import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, tradeExecutions } from '@/db/schema';
import { eq, and, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  executeTradeFill,
  TradeNotFoundError,
  TradeDeletedError,
  TradeClosedError,
  ExecutionIdempotencyConflictError,
  IdempotentReplayError,
  ReadinessFailureError,
  ActionDirectionError,
  ChecklistGateError,
  OverCloseError,
  OpenPositionRequiredError,
  type ExecuteTradeFillInput,
  type TradeExecutionAction,
} from '@/lib/trade-execution-engine';

const executeTradeSchema = z.object({
  entryPrice: z.number().positive(),
  entryQuantity: z.number().positive(),
  stopPrice: z.number().optional(),
  exit1Price: z.number().positive().optional(),
  exit1Quantity: z.number().positive().optional(),
  exit2Price: z.number().positive().optional(),
  exit2Quantity: z.number().positive().optional(),
  executedAt: z.string().optional(),
  fees: z.number().min(0).optional().default(0),
  checkResults: z.array(z.object({
    checklistDefinitionId: z.string(),
    passed: z.boolean(),
    comment: z.string().optional(),
  })).optional(),
  riskOverrideReason: z.string().min(1).max(500).optional(),
  // Client-generated idempotency key for the whole bulk request. The adapter
  // derives one per-fill key from it (entry/exit1/exit2), so retrying the same
  // bulk request with the same key is replay-safe across every fill.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/trades/:id/execute — thin COMPATIBILITY ADAPTER over the canonical
 * atomic execution engine (S03). The bulk request (entry + exit1 + exit2) is
 * decomposed into individual fills and each fill is committed by
 * `executeTradeFill` — the ONE execution path in the product. This route owns
 * NO execution logic: no inline transaction, no checklist gate, no readiness
 * gate, no trade status derivation, no risk snapshot, no accounting sync.
 *
 * Each fill is independently atomic: if exit1 commits but exit2 fails, the
 * error is returned immediately and entry + exit1 remain committed (each fill
 * is correct on its own). A retried request with the same idempotency key
 * replays every fill and returns the original executions.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = executeTradeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      entryPrice,
      entryQuantity,
      stopPrice,
      exit1Price,
      exit1Quantity,
      exit2Price,
      exit2Quantity,
      executedAt,
      fees,
      checkResults,
      riskOverrideReason,
      idempotencyKey,
    } = parsed.data;

    // ── Adapter-level validation (contract preserved from the legacy P1) ──

    // Exit quantities must not exceed the entry quantity.
    const exitQty1 = exit1Quantity ?? 0;
    const exitQty2 = exit2Quantity ?? 0;
    if (exitQty1 + exitQty2 > entryQuantity) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exitQuantity: [
                `Total exit quantity (${exitQty1 + exitQty2}) exceeds entry quantity (${entryQuantity})`,
              ],
            },
          },
        },
        { status: 409 },
      );
    }

    // Exit prices must be provided when exit quantities are given, and vice versa.
    if ((exit1Price != null && exit1Quantity == null) || (exit1Quantity != null && exit1Price == null)) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit1: ['Both exit1Price and exit1Quantity must be provided together'],
            },
          },
        },
        { status: 400 },
      );
    }

    if ((exit2Price != null && exit2Quantity == null) || (exit2Quantity != null && exit2Price == null)) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit2: ['Both exit2Price and exit2Quantity must be provided together'],
            },
          },
        },
        { status: 400 },
      );
    }

    // Exit 2 requires exit 1.
    if (exit2Price != null && exit1Price == null) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit2: ['Exit 2 requires Exit 1 to be provided first'],
            },
          },
        },
        { status: 400 },
      );
    }

    // ── Fetch the trade (needed to derive entry/exit actions + direction) ──

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

    if (trade.status === 'deleted') {
      return NextResponse.json(
        { error: 'Cannot execute a deleted trade' },
        { status: 400 },
      );
    }

    // The bulk path is a first-fill entry flow: only planned trades execute.
    // Exception: an idempotent replay of a previously executed bulk request is
    // allowed even after the trade left 'planned' — the derived per-fill keys
    // already exist, so the engine replays every fill and creates no new rows.
    if (trade.status !== 'planned') {
      // M002-A13: a derived key owned by ANOTHER trade must never make this
      // trade look like an idempotent bulk replay — the entry row must exist
      // AND belong to THIS trade.
      const replayEntry =
        idempotencyKey != null
          ? db
              .select()
              .from(tradeExecutions)
              .where(eq(tradeExecutions.idempotencyKey, `${idempotencyKey}:entry`))
              .get()
          : undefined;
      if (replayEntry && replayEntry.tradeId !== id) {
        return NextResponse.json(
          {
            error: 'Idempotency key conflict',
            code: 'EXECUTION_IDEMPOTENCY_CONFLICT',
            details: 'This idempotency key is already associated with another trade.',
          },
          { status: 409 },
        );
      }
      const isReplay = replayEntry != null;
      if (!isReplay) {
        if (trade.status === 'closed') {
          // M002-A12: a closed trade has no ordinary execution surface — map
          // the canonical lifecycle rejection to the stable contract (same
          // response the engine produces for a genuinely new request).
          return NextResponse.json(
            {
              error: 'Closed trades cannot accept new executions',
              code: 'TRADE_CLOSED_EXECUTION_REJECTED',
              details: 'Use execution correction to alter historical fills.',
            },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: 'Trade is not in planned status' },
          { status: 400 },
        );
      }
    }

    // ── Decompose into individual fills ─────────────────────────────────

    const entryAction: TradeExecutionAction =
      trade.direction === 'long' ? 'buy' : 'sell_short';
    const exitAction: TradeExecutionAction =
      trade.direction === 'long' ? 'sell' : 'buy_to_cover';

    // One base key per bulk request; each fill gets a deterministic derived
    // key so a client retry with the same base key replays every fill.
    // M002-A13: a CALLER-SUPPLIED base key is required for replay across
    // network retries — the server-minted fallback guarantees uniqueness of
    // the accepted call only (the client never knows the derived keys).
    const baseKey = idempotencyKey ?? randomUUID();

    const fills: ExecuteTradeFillInput[] = [
      {
        tradeId: id,
        action: entryAction,
        quantity: entryQuantity,
        price: entryPrice,
        fees: fees ?? 0,
        executedAt,
        // First-fill risk snapshot stop (falls back to trade.plannedStop).
        stopPrice,
        // First-fill gates: checklist evidence + max-risk override reason.
        checkResults,
        riskOverrideReason,
        idempotencyKey: `${baseKey}:entry`,
      },
    ];

    if (exit1Price != null && exit1Quantity != null) {
      fills.push({
        tradeId: id,
        action: exitAction,
        quantity: exit1Quantity,
        price: exit1Price,
        fees: 0,
        executedAt,
        idempotencyKey: `${baseKey}:exit1`,
      });
    }

    if (exit2Price != null && exit2Quantity != null) {
      fills.push({
        tradeId: id,
        action: exitAction,
        quantity: exit2Quantity,
        price: exit2Price,
        fees: 0,
        executedAt,
        idempotencyKey: `${baseKey}:exit2`,
      });
    }

    // ── M002-A13: ownership-preflight every derived key BEFORE any fill ──
    // Each fill is independently atomic; without a full preflight a foreign
    // collision on exit1/exit2 would only be discovered AFTER the entry
    // committed. Cross-trade conflict must produce ZERO new fills, so all
    // derived keys that already exist anywhere must be owned by THIS trade.
    if (idempotencyKey != null) {
      const derivedKeys = fills.map((f) => f.idempotencyKey as string);
      const foreign = db
        .select()
        .from(tradeExecutions)
        .where(
          and(
            inArray(tradeExecutions.idempotencyKey, derivedKeys),
            ne(tradeExecutions.tradeId, id),
          ),
        )
        .all();
      if (foreign.length > 0) {
        return NextResponse.json(
          {
            error: 'Idempotency key conflict',
            code: 'EXECUTION_IDEMPOTENCY_CONFLICT',
            details: 'This idempotency key is already associated with another trade.',
          },
          { status: 409 },
        );
      }
    }

    // ── Execute each fill through the canonical engine ─────────────────

    // A concurrent duplicate for the same derived key surfaces as an
    // IdempotentReplayError with the original result attached; the fill
    // already exists, so treat it as a successful replay and continue.
    const context = { db, sqlite: getSqliteHandle() };

    for (const fill of fills) {
      try {
        executeTradeFill(fill, context);
      } catch (err) {
        if (err instanceof IdempotentReplayError) {
          continue;
        }
        if (err instanceof TradeNotFoundError) {
          return NextResponse.json(
            { error: 'Trade not found' },
            { status: 404 },
          );
        }
        if (err instanceof TradeDeletedError) {
          return NextResponse.json(
            { error: 'Cannot execute a deleted trade' },
            { status: 400 },
          );
        }
        if (err instanceof TradeClosedError) {
          // M002-A12: compatibility adapter maps the canonical lifecycle
          // rejection — no independent business rule here.
          return NextResponse.json(
            {
              error: 'Closed trades cannot accept new executions',
              code: 'TRADE_CLOSED_EXECUTION_REJECTED',
              details: 'Use execution correction to alter historical fills.',
            },
            { status: 409 },
          );
        }
        if (err instanceof ExecutionIdempotencyConflictError) {
          return NextResponse.json(
            {
              error: 'Idempotency key conflict',
              code: 'EXECUTION_IDEMPOTENCY_CONFLICT',
              details: 'This idempotency key is already associated with another trade.',
            },
            { status: 409 },
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
          // S04 pre-flight rejection: a closing fill exceeded the persisted
          // open quantity (defense-in-depth — the adapter's exit-quantity
          // guard compares against the REQUEST entry quantity, the engine
          // compares against the PERSISTED open position).
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
        // Unknown engine failure: bubble up (the engine rolled back the fill).
        throw err;
      }
    }

    // ── Backward-compatible response: all executions + updated trade ──

    const executions = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.tradeId, id))
      .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
      .all();

    const updatedTrade = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    return NextResponse.json({ executions, trade: updatedTrade }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to execute trade', details: String(error) },
      { status: 500 },
    );
  }
}
