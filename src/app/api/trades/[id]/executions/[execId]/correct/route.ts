/**
 * Trade-scoped Execution Correction API Route
 *
 * POST /api/trades/:id/executions/:execId/correct — correct a posted trade
 *   execution of a NON-planned trade through the canonical accounting
 *   correction flow (reversal + replacement + correction_lineage).
 *
 * Fills past planned status are immutable in the legacy trade_executions
 * table (the direct PUT/DELETE paths are guarded to planned trades only), so
 * corrections of real fills must go through the accounting engine. This route
 * is the trade-side bridge to that engine:
 *
 * 1. Resolves the trade and its accountId
 * 2. Looks up the accounting execution mirrored for this trade execution via
 *    the idempotency key `trade-execution-<execId>` — the exact key the
 *    executions POST sets through syncAndRebuildPositions (see
 *    src/lib/positions/trade-execution-sync.ts)
 * 3. Validates the replacement payload with the canonical correction schema
 * 4. Delegates to correctExecution (reversal + replacement + lineage, FIFO
 *    and performance rebuild)
 * 5. Returns the canonical correction lineage payload
 *
 * Trades without an accountId (or without a mirrored accounting execution)
 * fail gracefully — the CorrectionDialog renders the "No accounting record"
 * state inline instead of opening the form (M019/S04 must-have #5).
 *
 * Responses:
 * - 200: Successful correction with lineage and position state
 * - 400: Invalid JSON body or Zod validation failure
 * - 404: Trade not found, or no accounting execution for the trade execution
 * - 409: Execution already corrected / duplicate correction idempotency key
 * - 422: Trade has no accounting account (NO_ACCOUNTING_RECORD), the
 *        accounting execution is not mutable (reversal/replacement), or FIFO
 *        allocation rejects the replacement
 * - 500: Unexpected server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { correctExecution } from '@/lib/accounting/correction';
import { correctionInputSchema } from '@/lib/accounting/correction-contracts';
import { tradeExecutionIdempotencyKey } from '@/lib/positions/trade-execution-sync';
import { findAccountingExecutionByIdempotencyKey } from '@/db/accounting-repository';
import {
  resolveEffectiveExecutions,
  recomputeTradeLifecycle,
} from '@/lib/trade-correction-lifecycle';
import {
  AccountNotFoundError,
  ExecutionAlreadyCorrectedError,
  ExecutionNotMutableError,
  DuplicateCorrectionIdempotencyError,
  DuplicateExecutionIdempotencyError,
  InvalidAmountError,
  InvalidMicrosBoundsError,
  FifoAllocationRejectedError,
} from '@/lib/accounting/errors';

function logInfo(message: string, ...args: unknown[]): void {
  console.log(`[trade-correction] ${message}`, ...args);
}


type RouteParams = { params: Promise<{ id: string; execId: string }> };

// The accounting mirror for a legacy trade execution lives under the
// idempotency key built by tradeExecutionIdempotencyKey (see
// src/lib/positions/trade-execution-sync.ts) — the key the executions POST
// sets when it syncs a fill. This route resolves the mirror by that key, so
// the two surfaces MUST share the builder rather than duplicating the format.

// ── POST ────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tradeId, execId } = await params;

    // 1. Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const parsed = correctionInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const {
      symbol,
      action,
      quantity,
      price,
      fees,
      reason,
      idempotencyKey,
      postedAt,
    } = parsed.data;

    // 2. Resolve the trade and its account
    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    if (!trade.accountId) {
      return NextResponse.json(
        {
          error: 'No accounting record',
          code: 'NO_ACCOUNTING_RECORD',
          details: `Trade "${tradeId}" has no account, so its executions have no accounting record to correct`,
        },
        { status: 422 },
      );
    }

    // 3. Look up the accounting execution mirrored for this trade execution.
    //    The mirror is created by syncAndRebuildPositions under the
    //    trade-execution-<execId> idempotency key when the fill was posted.
    const sqlite = getSqliteHandle();
    const key = tradeExecutionIdempotencyKey(execId);
    const accountingExecution = findAccountingExecutionByIdempotencyKey(sqlite, key);

    if (
      !accountingExecution ||
      (accountingExecution.journal_trade_id !== null &&
        accountingExecution.journal_trade_id !== tradeId)
    ) {
      return NextResponse.json(
        {
          error: 'Execution not found',
          details: `No accounting record for trade execution "${execId}" (looked up by idempotency key "${key}")`,
        },
        { status: 404 },
      );
    }

    // 4. Delegate to the canonical correction service (reversal + replacement
    //    + correction_lineage; FIFO and performance projections rebuilt) and
    //    deterministically rebuild the trade lifecycle from the effective
    //    execution set — all inside ONE transaction so a failed lifecycle
    //    recomputation rolls back the entire correction.
    //
    //    correctExecution uses sqlite.transaction() internally; nested inside
    //    the outer drizzle transaction it becomes a savepoint (better-sqlite3
    //    nested-transaction semantics), so reversal/replacement writes are
    //    visible to resolveEffectiveExecutions on the same connection and
    //    roll back together with the trade row update if anything throws.
    const result = db.transaction((tx) => {
      const correctionResult = correctExecution(sqlite, {
        accountId: trade.accountId,
        originalExecutionId: accountingExecution.id,
        symbol,
        action,
        quantity,
        price,
        fees: fees ?? '0.00',
        reason,
        idempotencyKey,
        postedAt,
      });

      // 4b. Resolve the effective execution set and recompute the trade's
      //     lifecycle (status / openedAt / closedAt) from accounting truth.
      const effectiveExecutions = resolveEffectiveExecutions(sqlite, tradeId);
      const lifecycle = recomputeTradeLifecycle(
        effectiveExecutions,
        trade.direction,
      );

      // 4c. Persist the recomputed lifecycle. reviewedAt is cleared whenever
      //     an economic correction invalidates a prior review (S07 readiness).
      const now = new Date().toISOString();
      tx.update(trades)
        .set({
          status: lifecycle.status,
          openedAt: lifecycle.openedAt,
          closedAt: lifecycle.closedAt,
          reviewedAt: null,
          updatedAt: now,
        })
        .where(eq(trades.id, tradeId))
        .run();

      logInfo('lifecycle-transition', {
        tradeId,
        from: trade.status,
        to: lifecycle.status,
        effectiveExecutionCount: effectiveExecutions.length,
      });

      return { correction: correctionResult, lifecycle };
    });

    // 5. Build the canonical correction lineage response
    return NextResponse.json(
      {
        success: true,
        correction: result.correction.correction,
        originalExecution: result.correction.originalExecution,
        reversalExecution: result.correction.reversalExecution,
        replacementExecution: result.correction.replacementExecution,
        position: result.correction.position,
        rebuildStatus: result.correction.rebuildStatus,
        tradeLifecycle: result.lifecycle,
      },
      { status: 200 },
    );
  } catch (error) {
    // ── Map accounting domain errors to HTTP responses ──────────────
    if (error instanceof ExecutionAlreadyCorrectedError) {
      return NextResponse.json(
        {
          error: 'Execution already corrected',
          code: error.code,
          details: error.message,
        },
        { status: 409 },
      );
    }

    if (error instanceof ExecutionNotMutableError) {
      return NextResponse.json(
        {
          error: 'Execution not mutable',
          code: error.code,
          details: error.message,
        },
        { status: 422 },
      );
    }

    if (error instanceof DuplicateCorrectionIdempotencyError) {
      return NextResponse.json(
        {
          error: 'Duplicate correction idempotency key',
          code: error.code,
          details: error.message,
        },
        { status: 409 },
      );
    }

    if (error instanceof InvalidAmountError || error instanceof InvalidMicrosBoundsError) {
      return NextResponse.json(
        {
          error: 'Invalid amount',
          details: error.message,
        },
        { status: 400 },
      );
    }

    if (error instanceof AccountNotFoundError) {
      return NextResponse.json(
        {
          error: 'Account not found',
          details: error.message,
        },
        { status: 404 },
      );
    }

    if (error instanceof FifoAllocationRejectedError) {
      return NextResponse.json(
        {
          error: 'FIFO allocation rejected',
          code: error.code,
          message: error.message,
          details: {
            action: error.action,
            quantity: error.quantity,
            availableQuantity: error.availableQuantity,
          },
        },
        { status: 422 },
      );
    }

    if (error instanceof DuplicateExecutionIdempotencyError) {
      return NextResponse.json(
        {
          error: 'Duplicate idempotency key',
          details: error.message,
        },
        { status: 409 },
      );
    }

    // Unexpected errors fall through to 500
    return NextResponse.json(
      {
        error: 'Failed to correct execution',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
