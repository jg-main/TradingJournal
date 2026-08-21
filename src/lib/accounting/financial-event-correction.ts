/**
 * Financial event correction service.
 *
 * Provides the correction flow for posted financial events (deposit,
 * withdrawal, dividend, interest, fee, tax, manual_adjustment) using the
 * immutable reversal-and-replacement pattern. Posted financial events are
 * protected by BEFORE UPDATE / BEFORE DELETE triggers — they can never be
 * mutated. Corrections therefore preserve the original event and create
 * linked reversal and replacement events with full audit lineage.
 *
 * Flow:
 * 1. Validate account and original event exist and belong together
 * 2. Check the event type is correctable (cash events only)
 * 3. Check the event isn't a reversal/replacement constituent
 * 4. Check the event hasn't already been corrected
 * 5. Check correction idempotency key (if provided)
 * 6. Validate replacement amount sign semantics for the event type
 * 7. In a transaction:
 *    a. Post a reversal financial event (same event type, opposite cash
 *       effect direction, correctionType:"reversal" payload marker)
 *    b. Post a replacement financial event (corrected values,
 *       correctionType:"replacement" payload marker)
 *    c. Create a financial_event_correction_lineage record with the
 *       required reason
 * 8. Rebuild the account performance/NAV projection
 * 9. Return the correction lineage and the three linked events
 */

import Database from 'better-sqlite3';
import { toMicros, fromMicros } from './decimal';
import type { EventType } from './types';
import { postFinancialEvent } from './posting';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';
import {
  AccountNotFoundError,
  FinancialEventNotFoundError,
  EventAlreadyCorrectedError,
  EventNotCorrectableError,
  DuplicateCorrectionIdempotencyError,
  InvalidAmountError,
} from './errors';
import {
  accountExists,
  findEventById,
  insertFinancialEventCorrectionLineage,
  findFinancialEventCorrectionByOriginalEvent,
  findFinancialEventCorrectionByIdempotencyKey,
  findFinancialEventCorrectionByRelatedEvent,
} from '../../db/accounting-repository';
import type { FinancialEventRow } from '../../db/accounting-repository';

// ── Eligibility ──────────────────────────────────────────────────────────

/**
 * Event types that may be corrected through the reversal-and-replacement
 * pattern. All are cash-flow events with a reversible economic effect.
 * opening_balance, trade_execution, stock_split, adjustment, and transfer
 * are excluded — they either carry no independent cash effect (stock_split)
 * or define the account baseline (opening_balance).
 */
export const CORRECTABLE_EVENT_TYPES: readonly EventType[] = [
  'deposit',
  'withdrawal',
  'dividend',
  'interest',
  'fee',
  'tax',
  'manual_adjustment',
] as const;

const CORRECTABLE_SET = new Set<string>(CORRECTABLE_EVENT_TYPES);

/** Cash-event types whose effect direction is "increase". */
const CASH_INCREASE_TYPES = new Set<string>(['deposit', 'dividend', 'interest']);

/** Cash-event types whose effect direction is "decrease". */
const CASH_DECREASE_TYPES = new Set<string>(['withdrawal', 'fee', 'tax']);

// ── Input / Output Types ────────────────────────────────────────────────

/**
 * Validated input for correcting a financial event.
 *
 * The originalEventId comes from the URL path; replacement values come
 * from the validated request body. Idempotency is handled at the
 * correction level, not at the individual event level.
 */
export interface CorrectFinancialEventInput {
  /** Account ID from the URL path. */
  accountId: string;
  /** Original financial event ID from the URL path. */
  originalEventId: string;
  /** Replacement amount. Signed canonical decimal for manual_adjustment, positive otherwise. */
  amount: string;
  /** Optional replacement description (max 500 chars). */
  description?: string;
  /** Required human-readable reason for the correction. */
  reason: string;
  /** Optional UUID for idempotent correction. */
  idempotencyKey?: string;
  /** ISO-8601 timestamp. Defaults to current UTC time. */
  postedAt?: string;
}

/** A financial event in correction responses. */
export interface CorrectionFinancialEvent {
  id: string;
  accountId: string;
  eventType: string;
  idempotencyKey: string | null;
  description: string | null;
  payload: string | null;
  effect: string | null;
  postedAt: string;
  createdAt: string;
}

export interface CorrectFinancialEventResult {
  correction: {
    id: string;
    accountId: string;
    originalEventId: string;
    reversalEventId: string;
    replacementEventId: string;
    reason: string;
    correctedAt: string;
  };
  originalEvent: CorrectionFinancialEvent;
  reversalEvent: CorrectionFinancialEvent;
  replacementEvent: CorrectionFinancialEvent;
}

// ── Row Conversion ──────────────────────────────────────────────────────

function rowToCorrectionEvent(row: FinancialEventRow): CorrectionFinancialEvent {
  return {
    id: row.id,
    accountId: row.account_id,
    eventType: row.event_type,
    idempotencyKey: row.idempotency_key,
    description: row.description,
    payload: row.payload,
    effect: row.effect,
    postedAt: row.posted_at,
    createdAt: row.created_at,
  };
}

// ── Effect Helpers (pure) ───────────────────────────────────────────────

/**
 * Build the canonical cash effect JSON for a correction constituent.
 */
function cashEffectJson(direction: 'increase' | 'decrease', amount: string): string {
  const amountMicros = toMicros(amount);
  return JSON.stringify({
    kind: 'cash',
    direction,
    amount,
    amountMicros,
  });
}

/**
 * Extract the recorded cash amount from the original event's effect JSON.
 * Returns null when the event has no usable cash amount.
 */
function readOriginalCashAmount(effectJson: string | null): { amount: string; direction: 'increase' | 'decrease' } | null {
  if (!effectJson) return null;
  try {
    const effect = JSON.parse(effectJson) as {
      kind?: string;
      direction?: string;
      amount?: unknown;
      amountMicros?: unknown;
    };
    if (effect.kind !== 'cash' || typeof effect.amount !== 'string') {
      return null;
    }
    const direction: 'increase' | 'decrease' =
      effect.direction === 'decrease' ? 'decrease' : 'increase';
    return { amount: effect.amount, direction };
  } catch {
    return null;
  }
}

/**
 * Build the reversal event metadata for an original financial event.
 *
 * The reversal cancels the original's economic effect: same event type,
 * same absolute amount, flipped cash direction, and a payload marker
 * (correctionType:"reversal", originalEventId) for audit and lineage
 * resolution.
 */
export function buildReversalEventMeta(original: FinancialEventRow): {
  eventType: EventType;
  postingAmount: string;
  payload: Record<string, unknown>;
  effect: string;
  description: string;
} {
  const eventType = original.event_type as EventType;
  const cash = readOriginalCashAmount(original.effect);
  if (!cash) {
    throw new EventNotCorrectableError(
      original.id,
      `original event has no recorded cash effect to reverse`,
    );
  }

  const reversalDirection: 'increase' | 'decrease' =
    cash.direction === 'increase' ? 'decrease' : 'increase';
  const postingAmount = cash.amount;
  const signedReversalAmount = cash.direction === 'increase' ? negate(cash.amount) : cash.amount;

  return {
    eventType,
    postingAmount,
    payload: {
      correctionType: 'reversal',
      originalEventId: original.id,
      amount: signedReversalAmount,
      direction: reversalDirection,
    },
    effect: cashEffectJson(reversalDirection, postingAmount),
    description: `Correction reversal for ${original.id}: ${eventType} ${postingAmount}`,
  };
}

/**
 * Build the replacement event metadata for a correction.
 *
 * The replacement carries the corrected values with the same event type.
 * Its effect direction follows the event type (or the signed amount for
 * manual_adjustment); the payload carries the correctionType:"replacement"
 * marker plus the reason and user description for full lineage.
 */
export function buildReplacementEventMeta(
  original: FinancialEventRow,
  input: Pick<CorrectFinancialEventInput, 'amount' | 'description' | 'reason'>,
): {
  eventType: EventType;
  postingAmount: string;
  payload: Record<string, unknown>;
  effect: string;
  description: string;
} {
  const eventType = original.event_type as EventType;
  const amount = input.amount;

  let direction: 'increase' | 'decrease';
  let postingAmount: string;

  if (eventType === 'manual_adjustment') {
    // Signed amount: positive = inflow, negative = outflow.
    direction = amount.startsWith('-') ? 'decrease' : 'increase';
    postingAmount = amount.startsWith('-') ? amount.slice(1) : amount;
  } else {
    // Cash event types derive direction from the type.
    if (CASH_INCREASE_TYPES.has(eventType)) {
      direction = 'increase';
    } else if (CASH_DECREASE_TYPES.has(eventType)) {
      direction = 'decrease';
    } else {
      throw new EventNotCorrectableError(original.id, `unsupported event type "${eventType}"`);
    }
    postingAmount = amount;
  }

  const description =
    input.description && input.description.trim().length > 0
      ? input.description.trim()
      : `Correction replacement for ${original.id}: ${eventType} ${postingAmount}`;

  return {
    eventType,
    postingAmount,
    payload: {
      correctionType: 'replacement',
      originalEventId: original.id,
      amount,
      description: input.description ?? null,
      reason: input.reason,
    },
    effect: cashEffectJson(direction, postingAmount),
    description,
  };
}

/**
 * Negate a canonical decimal string.
 */
function negate(amount: string): string {
  return fromMicros(-toMicros(amount)) as string;
}

// ── Correction Service ──────────────────────────────────────────────────

/**
 * Correct a posted financial event through the reversal-and-replacement
 * pattern.
 *
 * The original event is never modified. Instead:
 * 1. A reversal event cancels the original's cash effect (same type,
 *    opposite direction)
 * 2. A replacement event carries the corrected values
 * 3. Both are posted immutably through the canonical posting kernel with
 *    balanced ledger postings
 * 4. A financial_event_correction_lineage record links all three with the
 *    required reason
 * 5. The account performance/NAV projection is rebuilt
 *
 * Idempotency is handled at the correction level — the same idempotencyKey
 * always produces the same correction (reversal + replacement pair).
 *
 * @param sqlite - Raw better-sqlite3 Database handle.
 * @param input  - Validated correction input (account, original event, replacement values).
 * @returns CorrectFinancialEventResult with lineage data and the three events.
 * @throws {AccountNotFoundError}           If the account does not exist.
 * @throws {FinancialEventNotFoundError}    If the original event is missing or cross-account.
 * @throws {EventNotCorrectableError}       If the event type is not eligible or the event is a constituent.
 * @throws {EventAlreadyCorrectedError}     If the event was already corrected.
 * @throws {DuplicateCorrectionIdempotencyError} If the idempotency key is already used.
 * @throws {InvalidAmountError}             If the replacement amount violates type sign rules.
 */
export function correctFinancialEvent(
  sqlite: Database.Database,
  input: CorrectFinancialEventInput,
): CorrectFinancialEventResult {
  const {
    accountId,
    originalEventId,
    amount,
    description,
    reason,
    idempotencyKey,
    postedAt: rawPostedAt,
  } = input;

  // ── 1. Validate account exists ──────────────────────────────────────
  if (!accountExists(sqlite, accountId)) {
    throw new AccountNotFoundError(accountId);
  }

  // ── 2. Find and validate original event ─────────────────────────────
  const originalEvent = findEventById(sqlite, originalEventId);
  if (!originalEvent) {
    throw new FinancialEventNotFoundError(originalEventId);
  }

  // Verify the event belongs to the target account
  if (originalEvent.account_id !== accountId) {
    throw new FinancialEventNotFoundError(originalEventId);
  }

  // ── 3. Check event type is correctable ──────────────────────────────
  const eventType = originalEvent.event_type;
  if (!CORRECTABLE_SET.has(eventType)) {
    throw new EventNotCorrectableError(
      originalEventId,
      `event type "${eventType}" is not eligible for correction`,
    );
  }

  // ── 4. Check event is not a reversal or replacement constituent ─────
  const relatedCorrection = findFinancialEventCorrectionByRelatedEvent(sqlite, originalEventId);
  if (relatedCorrection) {
    const isReversal = relatedCorrection.reversal_event_id === originalEventId;
    throw new EventNotCorrectableError(
      originalEventId,
      `it is a ${isReversal ? 'reversal' : 'replacement'} event of correction "${relatedCorrection.id}"`,
    );
  }

  // Guard against payload-marked constituents whose lineage row is
  // somehow absent (defense in depth — the lineage row is written in the
  // same transaction as the events, so this should never fire).
  if (originalEvent.payload) {
    try {
      const parsedPayload = JSON.parse(originalEvent.payload) as { correctionType?: string };
      if (parsedPayload.correctionType === 'reversal' || parsedPayload.correctionType === 'replacement') {
        throw new EventNotCorrectableError(
          originalEventId,
          `it is a ${parsedPayload.correctionType} event of a prior correction`,
        );
      }
    } catch {
      // Malformed payload — ignore, the type/lineage checks already ran.
    }
  }

  // ── 5. Check correction idempotency first ───────────────────────────
  // Check idempotency BEFORE already-corrected so that a legitimate replay
  // of the same correction idempotency key gets the right error,
  // not a misleading "already corrected" error for a subsequent
  // correction of the same original event.
  if (idempotencyKey) {
    const existingIdemCorrection = findFinancialEventCorrectionByIdempotencyKey(sqlite, idempotencyKey);
    if (existingIdemCorrection) {
      throw new DuplicateCorrectionIdempotencyError(idempotencyKey);
    }
  }

  // ── 6. Check event hasn't already been corrected ────────────────────
  const existingCorrection = findFinancialEventCorrectionByOriginalEvent(sqlite, originalEventId);
  if (existingCorrection) {
    throw new EventAlreadyCorrectedError(originalEventId, existingCorrection.id);
  }

  // ── 7. Validate replacement amount sign semantics ───────────────────
  validateReplacementAmount(eventType, amount);

  // Compute postedAt ordering: both reversal and replacement MUST come
  // AFTER the original event in the ledger stream so the original's cash
  // effect is processed before the reversal cancels it.
  const postedAt = rawPostedAt ?? new Date().toISOString();
  const baseDateMs = Math.max(
    new Date(originalEvent.posted_at).getTime() + 1,
    new Date(postedAt).getTime(),
  );
  const reversalPostedAt = new Date(baseDateMs).toISOString();
  const replacementPostedAt = new Date(baseDateMs + 1).toISOString();

  // ── 8. Execute correction atomically ────────────────────────────────
  const transaction = sqlite.transaction(() => {
    const correctedAt = new Date().toISOString();

    // ── 8a. Post reversal event ───────────────────────────────────────
    const reversalMeta = buildReversalEventMeta(originalEvent);
    const reversalPosting = postFinancialEvent(sqlite, {
      accountId,
      eventType: reversalMeta.eventType,
      amount: reversalMeta.postingAmount,
      idempotencyKey: undefined,
      description: reversalMeta.description,
      payload: JSON.stringify(reversalMeta.payload),
      effect: reversalMeta.effect,
      postedAt: reversalPostedAt,
    });

    // ── 8b. Post replacement event ────────────────────────────────────
    const replacementMeta = buildReplacementEventMeta(originalEvent, {
      amount,
      description,
      reason,
    });
    const replacementPosting = postFinancialEvent(sqlite, {
      accountId,
      eventType: replacementMeta.eventType,
      amount: replacementMeta.postingAmount,
      idempotencyKey: undefined,
      description: replacementMeta.description,
      payload: JSON.stringify(replacementMeta.payload),
      effect: replacementMeta.effect,
      postedAt: replacementPostedAt,
    });

    // ── 8c. Create correction lineage record ──────────────────────────
    const correction = insertFinancialEventCorrectionLineage(sqlite, {
      accountId,
      originalEventId: originalEvent.id,
      reversalEventId: reversalPosting.event.id,
      replacementEventId: replacementPosting.event.id,
      idempotencyKey: idempotencyKey ?? null,
      reason,
      correctedAt,
    });

    return { correction, reversalPosting, replacementPosting };
  });

  const { correction, reversalPosting, replacementPosting } = transaction();

  // ── 9. Rebuild the account performance/NAV projection ───────────────
  // The correction net-changes cash: original effect + reversal + replacement.
  // Rebuild so persisted NAV/performance reflects the corrected stream.
  rebuildAccountPerformance(sqlite, accountId);

  // ── 10. Read back persisted rows for the response ───────────────────
  const persistedOriginal = findEventById(sqlite, originalEventId)!;
  const persistedReversal = findEventById(sqlite, reversalPosting.event.id)!;
  const persistedReplacement = findEventById(sqlite, replacementPosting.event.id)!;

  return {
    correction: {
      id: correction.id,
      accountId: correction.account_id,
      originalEventId: correction.original_event_id,
      reversalEventId: correction.reversal_event_id,
      replacementEventId: correction.replacement_event_id,
      reason: correction.reason,
      correctedAt: correction.corrected_at,
    },
    originalEvent: rowToCorrectionEvent(persistedOriginal),
    reversalEvent: rowToCorrectionEvent(persistedReversal),
    replacementEvent: rowToCorrectionEvent(persistedReplacement),
  };
}

/**
 * Validate the replacement amount against the original event type's sign
 * semantics:
 * - manual_adjustment: any non-zero signed amount.
 * - All other correctable cash types: positive amount (no minus sign).
 *
 * Throws InvalidAmountError on violation.
 */
export function validateReplacementAmount(eventType: string, amount: string): void {
  if (amount === '0.00' || amount.startsWith('-0.')) {
    throw new InvalidAmountError(amount, 'Correction amount must be non-zero');
  }
  if (eventType !== 'manual_adjustment' && amount.startsWith('-')) {
    throw new InvalidAmountError(
      amount,
      `Correction amount for ${eventType} must be positive`,
    );
  }
}
