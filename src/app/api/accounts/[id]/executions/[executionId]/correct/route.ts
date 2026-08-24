/**
 * Execution Correction API Route
 *
 * POST /api/accounts/:id/executions/:executionId/correct — correct a posted
 *   accounting execution through the immutable reversal-and-replacement pattern.
 *
 * The original execution is never modified. A reversal execution mirrors the
 * original with opposite action and the same quantity/price, and a replacement
 * execution carries the corrected values. Both are posted with balanced ledger
 * effects. A correction lineage record links all three. FIFO positions and
 * performance projections are rebuilt after the correction.
 *
 * Validates the request body with Zod, resolves the target account and original
 * execution, performs pre-flight validation (not already corrected, not a
 * reversal/replacement, no duplicate idempotency key), delegates to the
 * correction service, and maps domain errors to the project's existing JSON
 * error conventions.
 *
 * Responses:
 * - 200: Successful correction with lineage and position state
 * - 400: Invalid JSON body or Zod validation failure
 * - 404: Account or original execution not found
 * - 409: Duplicate correction idempotency key
 * - 422: FIFO allocation rejection
 * - 500: Unexpected server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';
import { correctExecution } from '@/lib/accounting/correction';
import { correctionInputSchema } from '@/lib/accounting/correction-contracts';
import { accountExists, findAccountingExecutionById } from '@/db/accounting-repository';
import {
  AccountNotFoundError,
  ExecutionAlreadyCorrectedError,
  ExecutionNotMutableError,
  DuplicateCorrectionIdempotencyError,
  DuplicateExecutionIdempotencyError,
  InvalidAmountError,
  InvalidMicrosBoundsError,
  FifoAllocationRejectedError,
  ExecutionCorrectionProjectionError,
} from '@/lib/accounting/errors';

type RouteParams = { params: Promise<{ id: string; executionId: string }> };

// ── POST ────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId, executionId } = await params;

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

    const sqlite = getSqliteHandle();

    // 2. Pre-flight account existence check
    if (!accountExists(sqlite, accountId)) {
      return NextResponse.json(
        {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
        { status: 404 },
      );
    }

    // 3. Pre-flight original execution exists
    const originalExecution = findAccountingExecutionById(sqlite, executionId);
    if (!originalExecution) {
      return NextResponse.json(
        {
          error: 'Execution not found',
          details: `Execution "${executionId}" not found`,
        },
        { status: 404 },
      );
    }

    if (originalExecution.account_id !== accountId) {
      return NextResponse.json(
        {
          error: 'Execution not found',
          details: `Execution "${executionId}" does not belong to account "${accountId}"`,
        },
        { status: 404 },
      );
    }

    // 4. Delegate to the correction service
    const result = correctExecution(sqlite, {
      accountId,
      originalExecutionId: executionId,
      symbol,
      action,
      quantity,
      price,
      fees: fees ?? '0.00',
      reason,
      idempotencyKey,
      postedAt,
    });

    // 5. Build the response
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
    // Map domain errors to HTTP error responses
    if (
      error instanceof ExecutionAlreadyCorrectedError
    ) {
      return NextResponse.json(
        {
          error: 'Execution already corrected',
          code: error.code,
          details: error.message,
        },
        { status: 409 },
      );
    }

    if (
      error instanceof ExecutionNotMutableError
    ) {
      return NextResponse.json(
        {
          error: 'Execution not mutable',
          code: error.code,
          details: error.message,
        },
        { status: 422 },
      );
    }

    if (
      error instanceof DuplicateCorrectionIdempotencyError
    ) {
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

    // M002-A8: a FIFO / account-performance projection failure inside the
    // correction transaction (already rolled back) is an unexpected
    // server-side persistence failure — never a user-domain conflict. The
    // correction idempotency key is not consumed; the original execution
    // remains correctable on retry.
    if (error instanceof ExecutionCorrectionProjectionError) {
      return NextResponse.json(
        {
          error: 'Failed to finalize execution correction',
          code: error.code,
          details: error.message,
        },
        { status: 500 },
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
