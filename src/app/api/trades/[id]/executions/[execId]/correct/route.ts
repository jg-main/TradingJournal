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
 * 2. Looks up the accounting execution created for this journal execution
 *    via the deterministic idempotency key `trade-execution-<execId>` — the
 *    same key executeTradeFill() writes when it creates the journal
 *    execution and canonical accounting execution atomically
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
import { tradeExecutionIdempotencyKey } from '@/lib/trade-execution-idempotency';
import { findAccountingExecutionByIdempotencyKey } from '@/db/accounting-repository';
import {
  resolveEffectiveExecutions,
  recomputeTradeLifecycle,
  resolveFirstEntry,
  repairRiskSnapshot,
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
  ExecutionCorrectionProjectionError,
} from '@/lib/accounting/errors';

function logInfo(message: string, ...args: unknown[]): void {
  console.log(`[trade-correction] ${message}`, ...args);
}


type RouteParams = { params: Promise<{ id: string; execId: string }> };

// The canonical execution engine (executeTradeFill) creates the journal
// execution AND the canonical accounting execution atomically inside one
// transaction. The accounting execution uses the deterministic idempotency
// key built by tradeExecutionIdempotencyKey — the same key this route uses
// to resolve it, so the writer and the correction reader MUST share the
// builder rather than duplicating the format.

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

    // 3. Look up the accounting execution created for this journal execution.
    //    executeTradeFill() creates the journal execution and the canonical
    //    accounting execution atomically, keyed by trade-execution-<execId>,
    //    so this route resolves it by that same deterministic key.
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
      // 4a. Capture the PRE-correction effective set first so the risk
      //     snapshot repair can tell whether the corrected execution was the
      //     trade's first entry (correcting a later add/reduce must leave the
      //     open-time risk profile untouched).
      const preCorrectionExecutions = resolveEffectiveExecutions(sqlite, tradeId);
      const preCorrectionFirstEntryId =
        resolveFirstEntry(preCorrectionExecutions, trade.direction)?.id ?? null;

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
        // M007-S01 (D1): the persisted trade direction is the canonical
        // economic boundary — an alias replacement (add/reduce) resolves to
        // its concrete side and accounting_executions never persists aliases.
        direction: trade.direction,
      });

      // 4b. Resolve the effective execution set and recompute the trade's
      //     lifecycle (status / openedAt / closedAt) from accounting truth.
      const effectiveExecutions = resolveEffectiveExecutions(sqlite, tradeId);
      const lifecycle = recomputeTradeLifecycle(
        effectiveExecutions,
        trade.direction,
      );

      // 4c. Repair the initial risk snapshot when the corrected execution was
      //     the first entry (stale initial entry price/quantity/derived risk
      //     values). Skipped when no snapshot exists or a later fill was
      //     corrected. Writes inside this tx so a failure rolls back the
      //     whole correction.
      const riskRepair = repairRiskSnapshot({
        tx,
        sqlite,
        tradeId,
        accountId: trade.accountId,
        direction: trade.direction,
        preCorrectionFirstEntryId,
        correctedOriginalId: accountingExecution.id,
        replacementExecution: correctionResult.replacementExecution,
        plannedStop: trade.plannedStop,
        // A2: resolve equity at the corrected effective timestamp (the
        // replacement execution's posted_at), never wall-clock now.
        asOf: correctionResult.replacementExecution.postedAt,
      });

      // 4d. Persist the recomputed lifecycle. reviewedAt is cleared whenever
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

      if (riskRepair.repaired) {
        logInfo('risk-snapshot-repair', {
          tradeId,
          from: riskRepair.oldValues,
          to: riskRepair.newValues,
        });
      }

      return { correction: correctionResult, lifecycle, riskRepair };
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
        riskSnapshotRepair: result.riskRepair,
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

    // M002-A8: a FIFO / account-performance projection failure inside the
    // correction transaction (the outer trade transaction has already rolled
    // back everything) is an unexpected server-side persistence failure —
    // never a user-domain conflict. The correction idempotency key is not
    // consumed; the original execution remains correctable on retry.
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
