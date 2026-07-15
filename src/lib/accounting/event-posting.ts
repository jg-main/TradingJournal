/**
 * Financial event posting service.
 *
 * Maps each validated event type to its canonical payload, economic effect,
 * and posting amount. Delegates double-entry persistence to the posting kernel.
 *
 * Pure logic — payload/effect builders are stateless functions.
 * The postEventWithEffect service function is the entry point for T03's API route.
 *
 * Stock-split recording stops at the ledger entry level: this task records the
 * corporate-action event and its zero-balanced posting pair without calculating
 * FIFO lots. S03 owns position-level projection.
 */

import Database from 'better-sqlite3';
import type { PostFinancialEventRequest } from './api-contracts';
import { postFinancialEvent } from './posting';
import { toMicros } from './decimal';
import type { FinancialEventWithPostings, EventType } from './types';

// ── Event Type Classifications ──────────────────────────────────────────

const CASH_INCREASING_EVENTS = new Set<EventType>(['deposit', 'dividend', 'interest']);
const CASH_DECREASING_EVENTS = new Set<EventType>(['withdrawal', 'fee', 'tax']);

// ── Payload Builders ────────────────────────────────────────────────────

/**
 * Compute the canonical payload JSON object for a validated event request.
 *
 * Payload captures the original data that triggered the event for audit, replay,
 * and display purposes. Each event type produces a different shape.
 */
export function computePayload(event: PostFinancialEventRequest): Record<string, unknown> {
  switch (event.eventType) {
    case 'opening_balance':
      return { amount: event.amount };

    case 'deposit':
    case 'withdrawal':
    case 'dividend':
    case 'interest':
    case 'fee':
    case 'tax': {
      const payload: Record<string, unknown> = { amount: event.amount };
      if ('perShareAmount' in event && event.perShareAmount !== undefined) payload.perShareAmount = event.perShareAmount;
      if ('shares' in event && event.shares !== undefined) payload.shares = event.shares;
      if ('rate' in event && event.rate !== undefined) payload.rate = event.rate;
      if ('feeType' in event && event.feeType !== undefined) payload.feeType = event.feeType;
      if ('taxType' in event && event.taxType !== undefined) payload.taxType = event.taxType;
      return payload;
    }

    case 'stock_split':
      return {
        symbol: event.symbol,
        ratio: event.ratio,
        oldShares: event.oldShares,
        newShares: event.newShares,
        ...(event.oldPrice !== undefined ? { oldPrice: event.oldPrice } : {}),
        ...(event.newPrice !== undefined ? { newPrice: event.newPrice } : {}),
      };

    case 'manual_adjustment':
      return {
        amount: event.amount,
        ...(event.reason !== undefined ? { reason: event.reason } : {}),
      };
  }
}

// ── Effect Builders ────────────────────────────────────────────────────

/**
 * Compute the standardised economic effect descriptor for a validated event request.
 *
 * Effect normalises cash vs non-cash effects so the projection engine can rebuild
 * account activity without inspecting raw payload.  Proves deposits/withdrawals
 * are treated as cash flows rather than profit/loss inputs.
 */
export function computeEffect(event: PostFinancialEventRequest): Record<string, unknown> {
  switch (event.eventType) {
    case 'opening_balance':
    case 'deposit':
    case 'dividend':
    case 'interest':
      return {
        kind: 'cash',
        direction: 'increase',
        amount: event.amount,
        amountMicros: toMicros(event.amount),
      };

    case 'withdrawal':
    case 'fee':
    case 'tax':
      return {
        kind: 'cash',
        direction: 'decrease',
        amount: event.amount,
        amountMicros: toMicros(event.amount),
      };

    case 'stock_split':
      return {
        kind: 'market',
        symbol: event.symbol,
        details: `${event.ratio} stock split`,
      };

    case 'manual_adjustment': {
      const direction = event.amount.startsWith('-') ? 'decrease' : 'increase';
      const positiveAmount = event.amount.startsWith('-') ? event.amount.slice(1) : event.amount;
      return {
        kind: 'cash',
        direction,
        amount: positiveAmount,
        amountMicros: toMicros(positiveAmount),
      };
    }
  }
}

// ── Posting Amount Extraction ───────────────────────────────────────────

/**
 * Extract the canonical posting amount from a validated event request.
 *
 * For standard cash events the amount from the request is used directly
 * (always positive per Zod validation).  For manual_adjustment, the absolute
 * value is used (direction is in the effect).  For stock_split, "0.00" is
 * returned (non-cash event with a zero-balanced posting pair).
 */
export function getPostingAmount(event: PostFinancialEventRequest): string {
  switch (event.eventType) {
    case 'stock_split':
      return '0.00';
    case 'manual_adjustment':
      return event.amount.startsWith('-') ? event.amount.slice(1) : event.amount;
    default:
      // All cash events have a 'amount' field that is already positive per Zod
      return event.amount;
  }
}

// ── Event Posting Service ───────────────────────────────────────────────

/**
 * Post a financial event of any supported type through the posting kernel.
 *
 * 1. Computes event-specific canonical payload and economic effect.
 * 2. Extracts the posting amount (absolute value for cash events, "0.00" for stock_split).
 * 3. Delegates to the generalized posting kernel which atomically creates
 *    the financial event (with payload/effect), ledger entry, and balanced
 *    debit/credit posting pair in a single SQLite transaction.
 * 4. Reuses existing idempotency, sequence, rollback, micros-bound, and
 *    immutability protections from the posting kernel.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle for transactional posting.
 * @param accountId - Target account ID (must exist in accounts table).
 * @param event     - Validated event request (from postFinancialEventSchema).
 * @returns The fully hydrated FinancialEventWithPostings aggregate.
 * @throws {InvalidAmountError}         If the amount is not valid.
 * @throws {InvalidMicrosBoundsError}   If micros exceeds safe integer bounds.
 * @throws {AccountNotFoundError}       If the account does not exist.
 * @throws {DuplicateIdempotencyKeyError} If the idempotency key is already used.
 */
export function postEventWithEffect(
  sqlite: Database.Database,
  accountId: string,
  event: PostFinancialEventRequest,
): FinancialEventWithPostings {
  const payload = computePayload(event);
  const effect = computeEffect(event);
  const postingAmount = getPostingAmount(event);

  return postFinancialEvent(sqlite, {
    accountId,
    eventType: event.eventType,
    amount: postingAmount,
    idempotencyKey: 'idempotencyKey' in event ? (event as { idempotencyKey?: string }).idempotencyKey : undefined,
    description: 'description' in event ? (event as { description?: string }).description : undefined,
    payload: JSON.stringify(payload),
    effect: JSON.stringify(effect),
    postedAt: 'postedAt' in event ? (event as { postedAt?: string }).postedAt : undefined,
  });
}
