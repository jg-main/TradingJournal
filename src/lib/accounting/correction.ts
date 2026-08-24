/**
 * Accounting execution correction service.
 *
 * Provides the correction flow for posted accounting executions using the
 * reversal-and-replacement pattern. Posted executions are immutable, so
 * corrections preserve the original economic event and create linked
 * reversal and replacement records with full audit lineage.
 *
 * Flow:
 * 1. Validate original execution exists and belongs to the account
 * 2. Check the execution hasn't already been corrected
 * 3. Check correction idempotency key (if provided)
 * 4. In a transaction:
 *    a. Create reversal execution (opposite action, same quantity/price/fees)
 *    b. Post reversal as a financial event (trade_execution)
 *    c. Create replacement execution (corrected values)
 *    d. Post replacement as a financial event (trade_execution)
 *    e. Create correction lineage record
 * 5. Rebuild FIFO positions and performance projections
 * 6. Return lineage/status/position data
 */

import Database from 'better-sqlite3';
import { toMicros, fromMicros } from './decimal';
import type { CanonicalDecimal } from './types';
import { postFinancialEvent } from './posting';
import { executionFinancialEventIdempotencyKey } from './execution-posting';
import { rebuildPositions } from '../positions/rebuild';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';
import { reverseAction } from './correction-contracts';
import {
  AccountNotFoundError,
  ExecutionAlreadyCorrectedError,
  ExecutionNotMutableError,
  DuplicateCorrectionIdempotencyError,
  FifoAllocationRejectedError,
} from './errors';
import {
  accountExists,
  findAccountingExecutionById,
  findOrCreateInstrument,
  insertAccountingExecution,
  insertCorrectionLineage,
  findCorrectionByOriginalExecution,
  findCorrectionByIdempotencyKey,
  findCorrectionByRelatedExecution,
  findAccountPosition,
  findFifoLotsByAccountInstrument,
  findInstrumentById,
} from '../../db/accounting-repository';
import type { FifoLot, PositionState } from '../positions/types';

// ── Input Types ──────────────────────────────────────────────────────────

/**
 * Validated input for correcting an execution.
 *
 * The originalExecutionId comes from the URL path; replacement values
 * come from the validated request body. Idempotency is handled at the
 * correction level, not at the individual execution level.
 */
export interface CorrectExecutionInput {
  /** Account ID from the URL path. */
  accountId: string;
  /** Original execution ID from the URL path. */
  originalExecutionId: string;
  /** Replacement instrument symbol. */
  symbol: string;
  /** Replacement action. */
  action: string;
  /** Replacement quantity (positive canonical decimal). */
  quantity: string;
  /** Replacement price (positive canonical decimal). */
  price: string;
  /** Replacement fees (non-negative canonical decimal, defaults to "0.00"). */
  fees?: string;
  /** Optional human-readable reason for the correction. */
  reason?: string;
  /** Optional UUID for idempotent correction. */
  idempotencyKey?: string;
  /** ISO-8601 timestamp. Defaults to current UTC time. */
  postedAt?: string;
}

export interface CorrectExecutionResult {
  correction: {
    id: string;
    accountId: string;
    originalExecutionId: string;
    reversalExecutionId: string;
    replacementExecutionId: string;
    reason: string | null;
    correctedAt: string;
  };
  originalExecution: {
    id: string;
    accountId: string;
    instrumentId: string;
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
    idempotencyKey: string | null;
    journalTradeId: string | null;
    description: string | null;
    postedAt: string;
    createdAt: string;
  };
  reversalExecution: {
    id: string;
    accountId: string;
    instrumentId: string;
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
    idempotencyKey: string | null;
    journalTradeId: string | null;
    description: string | null;
    postedAt: string;
    createdAt: string;
  };
  replacementExecution: {
    id: string;
    accountId: string;
    instrumentId: string;
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
    idempotencyKey: string | null;
    journalTradeId: string | null;
    description: string | null;
    postedAt: string;
    createdAt: string;
  };
  position: PositionState | null;
  rebuildStatus: {
    executionCount: number;
    lotCount: number;
    matchCount: number;
  };
}

type RowToDomainExecution = {
  id: string;
  accountId: string;
  instrumentId: string;
  action: string;
  quantity: string;
  price: string;
  fees: string;
  idempotencyKey: string | null;
  journalTradeId: string | null;
  description: string | null;
  postedAt: string;
  createdAt: string;
};

function rowToExecution(row: Record<string, unknown>): RowToDomainExecution {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    instrumentId: row.instrument_id as string,
    action: row.action as string,
    quantity: row.quantity as string,
    price: row.price as string,
    fees: row.fees as string,
    idempotencyKey: row.idempotency_key as string | null,
    journalTradeId: row.journal_trade_id as string | null,
    description: row.description as string | null,
    postedAt: row.posted_at as string,
    createdAt: row.created_at as string,
  };
}

function lotRowToFifoLot(row: Record<string, unknown>): FifoLot {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    instrumentId: row.instrument_id as string,
    direction: row.direction as FifoLot['direction'],
    remainingQuantity: row.remaining_quantity as CanonicalDecimal,
    originalQuantity: row.original_quantity as CanonicalDecimal,
    entryPrice: row.entry_price as CanonicalDecimal,
    costBasisTotal: row.cost_basis_total as CanonicalDecimal,
    allocatedFees: row.allocated_fees as CanonicalDecimal,
    openingExecutionId: row.opening_execution_id as string,
    openedAt: row.opened_at as string,
  };
}

function positionRowToPositionState(
  row: Record<string, unknown>,
  openLots: FifoLot[],
): PositionState {
  return {
    accountId: row.account_id as string,
    instrumentId: row.instrument_id as string,
    direction: row.direction as PositionState['direction'],
    quantity: row.quantity as CanonicalDecimal,
    averageCost: row.average_cost as CanonicalDecimal,
    totalCostBasis: row.total_cost_basis as CanonicalDecimal,
    realizedGrossPnl: row.realized_gross_pnl as CanonicalDecimal,
    realizedFees: row.realized_fees as CanonicalDecimal,
    realizedNetPnl: row.realized_net_pnl as CanonicalDecimal,
    openLots,
    lastUpdated: row.last_updated as string,
  };
}

// ── Correction Service ───────────────────────────────────────────────────

/**
 * Correct a posted execution through the reversal-and-replacement pattern.
 *
 * The original execution is never modified. Instead:
 * 1. A reversal execution mirrors the original with the opposite action
 * 2. A replacement execution carries the corrected values
 * 3. Both are posted as immutable accounting_executions with ledger effects
 * 4. A correction lineage record links all three
 * 5. FIFO positions and performance projections are rebuilt
 *
 * Idempotency is handled at the correction level — the same idempotencyKey
 * always produces the same correction (reversal + replacement pair).
 *
 * @param sqlite - Raw better-sqlite3 Database handle.
 * @param input  - Validated correction input (account, original execution, replacement values).
 * @returns CorrectExecutionResult with lineage data and rebuilt position state.
 * @throws {AccountNotFoundError}            If the account does not exist.
 * @throws {ExecutionNotMutableError}        If the execution is a reversal/replacement.
 * @throws {ExecutionAlreadyCorrectedError}  If the execution was already corrected.
 * @throws {DuplicateCorrectionIdempotencyError} If the idempotency key is already used.
 */
export function correctExecution(
  sqlite: Database.Database,
  input: CorrectExecutionInput,
): CorrectExecutionResult {
  const {
    accountId,
    originalExecutionId,
    symbol,
    action: replacementAction,
    quantity: replacementQuantity,
    price: replacementPrice,
    fees: replacementFees,
    reason,
    idempotencyKey,
    postedAt: rawPostedAt,
  } = input;

  // ── 1. Validate account exists ───────────────────────────────────────
  if (!accountExists(sqlite, accountId)) {
    throw new AccountNotFoundError(accountId);
  }

  // ── 2. Find and validate original execution ──────────────────────────
  const originalExecution = findAccountingExecutionById(sqlite, originalExecutionId);
  if (!originalExecution) {
    throw new AccountNotFoundError(`Execution ${originalExecutionId} not found`);
  }

  const fees = replacementFees ?? '0.00';

  // Anchor the reversal/replacement to the ORIGINAL execution's position in
  // the FIFO stream (+1ms / +2ms) rather than to `now`. Using `now` pushes
  // the pair past any fill posted between the original and the correction
  // (e.g. correcting a closed trade's ENTRY after its exit): the projection
  // replay then consumes the exit against nothing and the replacement opens
  // a fresh unmatched lot — journal/effective P&L says 5 remaining while
  // positions say 15 (S08 zero-divergence contract). An explicit postedAt
  // (user backdate) is honored as a floor, never below original+1ms.
  const baseDateMs = Math.max(
    new Date(originalExecution.posted_at).getTime() + 1,
    rawPostedAt ? new Date(rawPostedAt).getTime() : 0,
  );
  const effectivePostedAt = new Date(baseDateMs).toISOString();
  // Reversal first (same timestamp as effective), replacement 1ms later
  const reversalPostedAt = effectivePostedAt;
  const replacementPostedAt = new Date(baseDateMs + 1).toISOString();

  // Verify the execution belongs to the target account
  if (originalExecution.account_id !== accountId) {
    throw new FifoAllocationRejectedError(
      'CROSS_ACCOUNT_CORRECTION',
      'correct',
      `Execution "${originalExecutionId}" does not belong to account "${accountId}"`,
    );
  }

  // ── 3. Check execution is not a reversal or replacement ──────────────
  const relatedCorrection = findCorrectionByRelatedExecution(sqlite, originalExecutionId);
  if (relatedCorrection) {
    throw new ExecutionNotMutableError(
      originalExecutionId,
      `it is a ${originalExecutionId === relatedCorrection.reversal_execution_id ? 'reversal' : 'replacement'} execution of correction "${relatedCorrection.id}"`,
    );
  }

  // ── 4. Check correction idempotency first ──────────────────────────
  // Check idempotency BEFORE already-corrected so that a legitimate replay
  // of the same correction idempotency key gets the right error,
  // not a misleading "already corrected" error for a subsequent
  // correction of the same original execution.
  if (idempotencyKey) {
    const existingIdemCorrection = findCorrectionByIdempotencyKey(sqlite, idempotencyKey);
    if (existingIdemCorrection) {
      throw new DuplicateCorrectionIdempotencyError(idempotencyKey);
    }
  }

  // ── 5. Check execution hasn't already been corrected ─────────────────
  const existingCorrection = findCorrectionByOriginalExecution(sqlite, originalExecutionId);
  if (existingCorrection) {
    throw new ExecutionAlreadyCorrectedError(originalExecutionId, existingCorrection.id);
  }

  // ── 6. Resolve instrument for reversal and replacement ───────────────
  const originalInstrument = findInstrumentById(sqlite, originalExecution.instrument_id);
  if (!originalInstrument) {
    throw new Error(`Original instrument ${originalExecution.instrument_id} not found`);
  }

  // The replacement may use a different symbol (in case the ticker changed)
  const replacementInstrument = findOrCreateInstrument(sqlite, symbol);

  // ── 7. Execute correction atomically ─────────────────────────────────
  const transaction = sqlite.transaction(() => {
    const correctedAt = new Date().toISOString();

    // ── 7a. Create reversal execution ──────────────────────────────────
    // The reversal mirrors the original: same quantity, same price, opposite action
    const reversalAction = reverseAction(originalExecution.action);
    const reversalDescription = `Correction reversal for ${originalExecution.id}: ${reversalAction} ${originalExecution.quantity} ${originalInstrument.symbol} @ ${originalExecution.price}`;

    const reversalExecution = insertAccountingExecution(sqlite, {
      accountId,
      instrumentId: originalExecution.instrument_id,
      action: reversalAction,
      quantity: originalExecution.quantity,
      price: originalExecution.price,
      fees: originalExecution.fees,
      idempotencyKey: null, // No public idempotency key for internal reversal
      journalTradeId: originalExecution.journal_trade_id,
      description: reversalDescription,
      postedAt: reversalPostedAt,
    });

    // Post reversal as a financial event
    const reversalConsiderationMicros = computeConsiderationMicros(
      originalExecution.quantity,
      originalExecution.price,
    );
    const reversalPayload = JSON.stringify({
      action: reversalAction,
      symbol: originalInstrument.symbol,
      quantity: originalExecution.quantity,
      price: originalExecution.price,
      fees: originalExecution.fees,
      correctionType: 'reversal',
      originalExecutionId: originalExecution.id,
    });
    const reversalEffect = JSON.stringify({
      kind: 'cash',
      direction: ['sell', 'reduce', 'sell_short'].includes(reversalAction) ? 'increase' : 'decrease',
      amount: fromMicros(reversalConsiderationMicros),
      amountMicros: reversalConsiderationMicros,
    });

    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'trade_execution',
      amount: fromMicros(reversalConsiderationMicros),
      idempotencyKey: executionFinancialEventIdempotencyKey(reversalExecution.id),
      description: reversalDescription,
      payload: reversalPayload,
      effect: reversalEffect,
      postedAt: reversalPostedAt,
    });

    // ── 7b. Create replacement execution ───────────────────────────────
    const replacementDescription = `Correction replacement for ${originalExecution.id}: ${replacementAction} ${replacementQuantity} ${symbol} @ ${replacementPrice}`;

    const replacementExecution = insertAccountingExecution(sqlite, {
      accountId,
      instrumentId: replacementInstrument.id,
      action: replacementAction,
      quantity: replacementQuantity,
      price: replacementPrice,
      fees,
      idempotencyKey: null, // No public idempotency key for internal replacement
      journalTradeId: originalExecution.journal_trade_id,
      description: replacementDescription,
      postedAt: replacementPostedAt,
    });

    // Post replacement as a financial event
    const replacementConsiderationMicros = computeConsiderationMicros(
      replacementQuantity,
      replacementPrice,
    );
    const replacementPayload = JSON.stringify({
      action: replacementAction,
      symbol,
      quantity: replacementQuantity,
      price: replacementPrice,
      fees,
      correctionType: 'replacement',
      originalExecutionId: originalExecution.id,
    });
    const replacementEffect = JSON.stringify({
      kind: 'cash',
      direction: ['sell', 'reduce', 'sell_short'].includes(replacementAction) ? 'increase' : 'decrease',
      amount: fromMicros(replacementConsiderationMicros),
      amountMicros: replacementConsiderationMicros,
    });

    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'trade_execution',
      amount: fromMicros(replacementConsiderationMicros),
      idempotencyKey: executionFinancialEventIdempotencyKey(replacementExecution.id),
      description: replacementDescription,
      payload: replacementPayload,
      effect: replacementEffect,
      postedAt: replacementPostedAt,
    });

    // ── 7c. Create correction lineage record ───────────────────────────
    const correction = insertCorrectionLineage(sqlite, {
      accountId,
      originalExecutionId: originalExecution.id,
      reversalExecutionId: reversalExecution.id,
      replacementExecutionId: replacementExecution.id,
      idempotencyKey: idempotencyKey ?? null,
      reason: reason ?? null,
      correctedAt,
    });

    return {
      correction,
      reversalExecution,
      replacementExecution,
    };
  });

  const { correction, reversalExecution, replacementExecution } = transaction();

  // ── 8. Rebuild positions for both instruments ────────────────────────
  // Rebuild the original instrument's positions (affected by reversal)
  rebuildPositions(sqlite, accountId, originalExecution.instrument_id);

  // If the replacement uses a different instrument, rebuild that too
  if (replacementExecution.instrument_id !== originalExecution.instrument_id) {
    rebuildPositions(sqlite, accountId, replacementExecution.instrument_id);
  }

  // Rebuild the aggregate cash/NAV projection only after both position
  // projections reflect the reversal-and-replacement correction.
  rebuildAccountPerformance(sqlite, accountId);

  // ── 9. Read back position state for the replacement instrument ───────
  const updatedPositionRow = findAccountPosition(sqlite, accountId, replacementExecution.instrument_id);
  const updatedLotRows = findFifoLotsByAccountInstrument(sqlite, accountId, replacementExecution.instrument_id);

  const position = updatedPositionRow
    ? positionRowToPositionState(
        updatedPositionRow as unknown as Record<string, unknown>,
        (updatedLotRows as unknown as Record<string, unknown>[]).map(lotRowToFifoLot),
      )
    : null;

  // Read back the original and reversal execution for the response
  const persistedOriginal = findAccountingExecutionById(sqlite, originalExecutionId)!;
  const persistedReversal = findAccountingExecutionById(sqlite, reversalExecution.id)!;
  const persistedReplacement = findAccountingExecutionById(sqlite, replacementExecution.id)!;

  // Compute rebuild status counts
  const rebuildFingerprint = computeRebuildFingerprint(sqlite, accountId);

  return {
    correction: {
      id: correction.id,
      accountId: correction.account_id,
      originalExecutionId: correction.original_execution_id,
      reversalExecutionId: correction.reversal_execution_id,
      replacementExecutionId: correction.replacement_execution_id,
      reason: correction.reason,
      correctedAt: correction.corrected_at,
    },
    originalExecution: {
      ...rowToExecution(persistedOriginal as unknown as Record<string, unknown>),
      symbol: originalInstrument.symbol,
    },
    reversalExecution: {
      ...rowToExecution(persistedReversal as unknown as Record<string, unknown>),
      symbol: originalInstrument.symbol,
    },
    replacementExecution: {
      ...rowToExecution(persistedReplacement as unknown as Record<string, unknown>),
      symbol,
    },
    position,
    rebuildStatus: {
      executionCount: rebuildFingerprint.executionCount,
      lotCount: rebuildFingerprint.lotCount,
      matchCount: rebuildFingerprint.matchCount,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Compute the gross consideration (quantity × price) in micros.
 */
function computeConsiderationMicros(quantity: string, price: string): number {
  const qMicros = toMicros(quantity);
  const pMicros = toMicros(price);
  const prodBig = BigInt(qMicros) * BigInt(pMicros);
  return Number(prodBig / BigInt(1_000_000));
}

/**
 * Compute a quick rebuild fingerprint by counting executions, lots, and matches.
 */
function computeRebuildFingerprint(
  sqlite: Database.Database,
  accountId: string,
): { executionCount: number; lotCount: number; matchCount: number } {
  const execRow = sqlite
    .prepare('SELECT COUNT(*) AS count FROM accounting_executions WHERE account_id = ?')
    .get(accountId) as { count: number };

  const lotRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM fifo_lots WHERE account_id = ?`,
    )
    .get(accountId) as { count: number };

  const matchRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM lot_matches WHERE closing_execution_id IN (
         SELECT id FROM accounting_executions WHERE account_id = ?
       )`,
    )
    .get(accountId) as { count: number };

  return {
    executionCount: execRow.count,
    lotCount: lotRow.count,
    matchCount: matchRow.count,
  };
}
