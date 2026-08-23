/**
 * Balanced immutable posting kernel.
 *
 * Builds the pure posting contract and a transactional service that creates
 * a financial event, one ledger entry, and balanced debit/credit postings
 * atomically. Enforces exact decimal normalization, micros bounds, stable
 * sequence ordering, typed domain errors, and idempotency-key handling.
 *
 * The service is purely functional — all side effects go through the
 * accounting-repository module and the caller-provided SQLite handle.
 * This keeps it reusable by later event and execution routes.
 */

import Database from 'better-sqlite3';
import {
  validateDecimal,
  toMicros,
} from './decimal';
import type { CanonicalDecimal, EventType } from './types';
import type { FinancialEventWithPostings } from './types';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  DuplicateIdempotencyKeyError,
  AccountNotFoundError,
  UnsupportedAccountCurrencyError,
} from './errors';
import {
  accountExists,
  accountBaseCurrency,
  findEventByIdempotencyKey,
  insertFinancialEvent,
  insertLedgerEntry,
  insertLedgerPosting,
  getNextSequence,
} from '../../db/accounting-repository';
import { isSupportedAccountCurrency, UNSUPPORTED_CURRENCY_GUIDANCE } from './currency-contract';

// ── Public Input Types ──────────────────────────────────────────────────

export interface PostOpeningBalanceInput {
  /** Target account ID (must exist in accounts table). */
  accountId: string;
  /** Amount as a canonical decimal string (e.g. "10000.00"). */
  amount: CanonicalDecimal | string;
  /** Optional idempotency key for replay-safe posting. */
  idempotencyKey?: string;
  /** Optional human-readable description. */
  description?: string;
  /** ISO-8601 timestamp. Defaults to current UTC time. */
  postedAt?: string;
}

// ── Supported-Currency Guard ────────────────────────────────────────────

/**
 * Shared financial-integrity guard: verify the target account's base
 * currency is supported before any ledger mutation.
 *
 * The USD-only contract lives here, below the UI/API layer, so a caller
 * cannot bypass it by invoking a posting service directly. Throws
 * {@link UnsupportedAccountCurrencyError} for legacy non-USD accounts
 * BEFORE any event/entry/posting row is written, keeping atomicity
 * guarantees intact (no partial financial state on rejection).
 */
export function assertSupportedAccountCurrency(
  sqlite: Database.Database,
  accountId: string,
): void {
  if (!accountExists(sqlite, accountId)) {
    throw new AccountNotFoundError(accountId);
  }
  const currency = accountBaseCurrency(sqlite, accountId);
  if (!isSupportedAccountCurrency(currency)) {
    throw new UnsupportedAccountCurrencyError(
      accountId,
      currency ?? 'UNKNOWN',
      UNSUPPORTED_CURRENCY_GUIDANCE,
    );
  }
}

// ── Validation Helpers (pure) ───────────────────────────────────────────

/**
 * Validate and convert a posting amount to micros.
 * Throws InvalidAmountError or InvalidMicrosBoundsError on failure.
 */
export function validatePostingAmount(amount: string): {
  amount: CanonicalDecimal;
  amountMicros: number;
} {
  // Validate canonical decimal format
  const validation = validateDecimal(amount);
  if (!validation.valid) {
    throw new InvalidAmountError(amount, validation.error ?? 'Value is not a canonical decimal');
  }

  // Convert to micros
  let amountMicros: number;
  try {
    amountMicros = toMicros(amount);
  } catch {
    throw new InvalidAmountError(amount, 'Failed to convert to micros');
  }

  // Check safe integer bounds
  if (amountMicros > Number.MAX_SAFE_INTEGER || amountMicros < Number.MIN_SAFE_INTEGER) {
    throw new InvalidMicrosBoundsError(amountMicros);
  }

  // Amount must be positive for standard postings
  if (amountMicros <= 0) {
    throw new InvalidAmountError(amount, 'Amount must be positive');
  }

  return { amount: amount as CanonicalDecimal, amountMicros };
}

/**
 * Validate a posting amount to micros, allowing zero for non-cash events.
 * Throws InvalidAmountError or InvalidMicrosBoundsError on failure.
 */
export function validateNonNegativePostingAmount(amount: string): {
  amount: CanonicalDecimal;
  amountMicros: number;
} {
  // Validate canonical decimal format
  const validation = validateDecimal(amount);
  if (!validation.valid) {
    throw new InvalidAmountError(amount, validation.error ?? 'Value is not a canonical decimal');
  }

  // Convert to micros
  let amountMicros: number;
  try {
    amountMicros = toMicros(amount);
  } catch {
    throw new InvalidAmountError(amount, 'Failed to convert to micros');
  }

  // Check safe integer bounds
  if (amountMicros > Number.MAX_SAFE_INTEGER || amountMicros < Number.MIN_SAFE_INTEGER) {
    throw new InvalidMicrosBoundsError(amountMicros);
  }

  // Allow zero (for non-cash events like stock splits), reject negatives
  if (amountMicros < 0) {
    throw new InvalidAmountError(amount, 'Amount must not be negative');
  }

  return { amount: amount as CanonicalDecimal, amountMicros };
}

/**
 * Convert domain FinancialEventWithPostings to the types.ts record shape.
 */
function toFinancialEventRecord(
  eventId: string,
  accountId: string,
  eventType: EventType,
  idempotencyKey: string | null,
  description: string | null,
  postedAt: string,
): FinancialEventWithPostings['event'] {
  return {
    id: eventId,
    accountId,
    eventType,
    idempotencyKey,
    description,
    payload: null,
    effect: null,
    postedAt,
    createdAt: new Date().toISOString(),
  };
}

function toLedgerEntryRecord(
  entryId: string,
  financialEventId: string,
  accountId: string,
  description: string | null,
  postedAt: string,
): FinancialEventWithPostings['entry'] {
  return {
    id: entryId,
    financialEventId,
    accountId,
    description,
    postedAt,
    createdAt: new Date().toISOString(),
  };
}

function toPostingRecord(
  postingId: string,
  ledgerEntryId: string,
  accountId: string,
  side: 'debit' | 'credit',
  amount: CanonicalDecimal,
  amountMicros: number,
  sequence: number,
): FinancialEventWithPostings['postings']['debit' | 'credit'] {
  const record = {
    id: postingId,
    ledgerEntryId,
    accountId,
    side,
    amount,
    amountMicros,
    currency: 'USD',
    sequence,
    createdAt: new Date().toISOString(),
  };
  // Narrow the side type for the branded record
  return record as FinancialEventWithPostings['postings']['debit' | 'credit'];
}

// ── Posting Kernel ──────────────────────────────────────────────────────

// ── Generalized Input Type ──────────────────────────────────────────────

/**
 * Input for the generalized posting kernel.
 * Supports all event types with optional payload/effect metadata.
 */
export interface PostFinancialEventInput {
  /** Target account ID (must exist in accounts table). */
  accountId: string;
  /** The event type (e.g. 'deposit', 'withdrawal', 'stock_split'). */
  eventType: EventType;
  /** Amount as a canonical decimal string (e.g. "10000.00"). May be "0.00" for non-cash events. */
  amount: CanonicalDecimal | string;
  /** Optional idempotency key for replay-safe posting. */
  idempotencyKey?: string;
  /** Optional human-readable description. */
  description?: string;
  /** JSON-encoded event payload metadata (canonical). */
  payload?: string | null;
  /** JSON-encoded economic effect descriptor. */
  effect?: string | null;
  /** ISO-8601 timestamp. Defaults to current UTC time. */
  postedAt?: string;
}

/**
 * Post any financial event type atomically.
 *
 * Generalized version of postOpeningBalance that supports all event types
 * and accepts optional payload/effect for event-type-specific metadata.
 * For non-cash events (stock_split), uses the relaxed validator to allow
 * zero amounts. Cash events use the strict validator.
 *
 * Creates one financial event (with optional payload/effect), one ledger
 * entry, and exactly two balanced ledger postings inside a single SQLite
 * transaction. Reuses existing idempotency, sequence, rollback, micros-bound,
 * and immutability protections.
 *
 * @param sqlite - Raw better-sqlite3 Database handle for transactional control.
 * @param input  - Posting parameters including event type, amount, and metadata.
 * @returns The fully hydrated FinancialEventWithPostings aggregate.
 * @throws {InvalidAmountError}         If the amount is not valid.
 * @throws {InvalidMicrosBoundsError}   If micros exceeds safe integer bounds.
 * @throws {AccountNotFoundError}       If the account does not exist.
 * @throws {DuplicateIdempotencyKeyError} If the idempotency key is already used.
 */
export function postFinancialEvent(
  sqlite: Database.Database,
  input: PostFinancialEventInput,
): FinancialEventWithPostings {
  const { accountId, eventType, amount: rawAmount, idempotencyKey, description, payload, effect, postedAt } = input;
  const postedAtStr = postedAt ?? new Date().toISOString();

  // 1. Validate amount (use non-negative validator for stock_split, standard for other cash events)
  const { amount, amountMicros } = eventType === 'stock_split'
    ? validateNonNegativePostingAmount(rawAmount)
    : validatePostingAmount(rawAmount);

  // 2. Check idempotency (pre-transaction to fail fast)
  if (idempotencyKey) {
    const existingEvent = findEventByIdempotencyKey(sqlite, idempotencyKey);
    if (existingEvent) {
      throw new DuplicateIdempotencyKeyError(idempotencyKey);
    }
  }

  // 3. Verify account exists and its base currency is supported (USD-only
  //    contract). Throws before any ledger mutation so rejection leaves no
  //    partial event/entry/posting state.
  assertSupportedAccountCurrency(sqlite, accountId);

  // 4. Begin transaction
  const transaction = sqlite.transaction(() => {
    // 5. Insert financial event with optional payload/effect
    const eventRow = insertFinancialEvent(sqlite, {
      accountId,
      eventType,
      idempotencyKey: idempotencyKey ?? null,
      description: description ?? null,
      payload: payload ?? null,
      effect: effect ?? null,
      postedAt: postedAtStr,
    });

    // 6. Insert ledger entry
    const entryRow = insertLedgerEntry(sqlite, {
      financialEventId: eventRow.id,
      accountId,
      description: description ?? null,
      postedAt: postedAtStr,
    });

    // 7. Get next sequence for postings
    const nextSeq = getNextSequence(sqlite);

    // 8. Insert debit posting
    const debitRow = insertLedgerPosting(sqlite, {
      ledgerEntryId: entryRow.id,
      accountId,
      side: 'debit',
      amount,
      amountMicros,
      sequence: nextSeq,
    });

    // 9. Insert credit posting (balanced — same amount, credit side)
    const creditRow = insertLedgerPosting(sqlite, {
      ledgerEntryId: entryRow.id,
      accountId,
      side: 'credit',
      amount,
      amountMicros,
      sequence: nextSeq + 1,
    });

    return { eventRow, entryRow, debitRow, creditRow };
  });

  // Execute the transaction — if any step fails, all changes are rolled back
  const result = transaction();

  // 10. Convert to domain record types and return (with payload/effect)
  return {
    event: {
      id: result.eventRow.id,
      accountId,
      eventType,
      idempotencyKey: idempotencyKey ?? null,
      description: description ?? null,
      payload: payload ?? null,
      effect: effect ?? null,
      postedAt: postedAtStr,
      createdAt: new Date().toISOString(),
    },
    entry: toLedgerEntryRecord(
      result.entryRow.id,
      result.eventRow.id,
      accountId,
      description ?? null,
      postedAtStr,
    ),
    postings: {
      debit: toPostingRecord(
        result.debitRow.id,
        result.entryRow.id,
        accountId,
        'debit',
        amount,
        amountMicros,
        result.debitRow.sequence,
      ),
      credit: toPostingRecord(
        result.creditRow.id,
        result.entryRow.id,
        accountId,
        'credit',
        amount,
        amountMicros,
        result.creditRow.sequence,
      ),
    },
  };
}

/**
 * Post an opening balance financial event atomically.
 *
 * Creates one financial event, one ledger entry, and exactly two
 * balanced ledger postings (one debit, one credit) inside a single
 * SQLite transaction.
 *
 * @param sqlite - Raw better-sqlite3 Database handle for transactional control.
 * @param input  - Posting parameters.
 * @returns The fully hydrated FinancialEventWithPostings aggregate.
 * @throws {InvalidAmountError}         If the amount is not a valid canonical decimal.
 * @throws {InvalidMicrosBoundsError}   If the micros value exceeds safe integer bounds.
 * @throws {AccountNotFoundError}       If the account does not exist.
 * @throws {DuplicateIdempotencyKeyError} If the idempotency key is already used.
 */
export function postOpeningBalance(
  sqlite: Database.Database,
  input: PostOpeningBalanceInput,
): FinancialEventWithPostings {
  const { accountId, amount: rawAmount, idempotencyKey, description, postedAt } = input;
  const postedAtStr = postedAt ?? new Date().toISOString();

  // 1. Validate amount
  const { amount, amountMicros } = validatePostingAmount(rawAmount);

  // 2. Check idempotency (pre-transaction to fail fast)
  if (idempotencyKey) {
    const existingEvent = findEventByIdempotencyKey(sqlite, idempotencyKey);
    if (existingEvent) {
      throw new DuplicateIdempotencyKeyError(idempotencyKey);
    }
  }

  // 3. Verify account exists and its base currency is supported (USD-only
  //    contract). Throws before any ledger mutation so rejection leaves no
  //    partial event/entry/posting state.
  assertSupportedAccountCurrency(sqlite, accountId);

  // 4. Begin transaction
  const transaction = sqlite.transaction(() => {
    // 5. Insert financial event
    const eventRow = insertFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      idempotencyKey: idempotencyKey ?? null,
      description: description ?? null,
      postedAt: postedAtStr,
    });

    // 6. Insert ledger entry
    const entryRow = insertLedgerEntry(sqlite, {
      financialEventId: eventRow.id,
      accountId,
      description: description ?? null,
      postedAt: postedAtStr,
    });

    // 7. Get next sequence for postings
    const nextSeq = getNextSequence(sqlite);

    // 8. Insert debit posting (increases asset/equity on the balance sheet)
    const debitRow = insertLedgerPosting(sqlite, {
      ledgerEntryId: entryRow.id,
      accountId,
      side: 'debit',
      amount,
      amountMicros,
      sequence: nextSeq,
    });

    // 9. Insert credit posting (balanced — same amount, credit side)
    const creditRow = insertLedgerPosting(sqlite, {
      ledgerEntryId: entryRow.id,
      accountId,
      side: 'credit',
      amount,
      amountMicros,
      sequence: nextSeq + 1,
    });

    return { eventRow, entryRow, debitRow, creditRow };
  });

  // Execute the transaction — if any step fails, all changes are rolled back
  const result = transaction();

  // 10. Convert to domain record types and return
  return {
    event: toFinancialEventRecord(
      result.eventRow.id,
      accountId,
      'opening_balance',
      idempotencyKey ?? null,
      description ?? null,
      postedAtStr,
    ),
    entry: toLedgerEntryRecord(
      result.entryRow.id,
      result.eventRow.id,
      accountId,
      description ?? null,
      postedAtStr,
    ),
    postings: {
      debit: toPostingRecord(
        result.debitRow.id,
        result.entryRow.id,
        accountId,
        'debit',
        amount,
        amountMicros,
        result.debitRow.sequence,
      ),
      credit: toPostingRecord(
        result.creditRow.id,
        result.entryRow.id,
        accountId,
        'credit',
        amount,
        amountMicros,
        result.creditRow.sequence,
      ),
    },
  };
}
