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
  AccountNotFoundError,
  ExecutionAlreadyCorrectedError,
  ExecutionNotMutableError,
  DuplicateCorrectionIdempotencyError,
  DuplicateExecutionIdempotencyError,
  InvalidAmountError,
  InvalidMicrosBoundsError,
  FifoAllocationRejectedError,
} from '@/lib/accounting/errors';

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
    //    + correction_lineage; FIFO and performance projections rebuilt).
    const result = correctExecution(sqlite, {
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

    // 5. Build the canonical correction lineage response
    return NextResponse.json(
      {
        success: true,
        correction: result.correction,
        originalExecution: result.originalExecution,
        reversalExecution: result.reversalExecution,
        replacementExecution: result.replacementExecution,
        position: result.position,
        rebuildStatus: result.rebuildStatus,
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
