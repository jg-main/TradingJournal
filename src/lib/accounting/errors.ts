/**
 * Typed domain errors for the accounting ledger.
 *
 * Pure error types — no database or Next.js imports.
 * Used by the posting kernel, repository, API routes, and projections.
 */

// ── Base Error ──────────────────────────────────────────────────────────

/**
 * Base class for all accounting domain errors.
 * Each error carries a `code` string for API mapping and a human-readable `message`.
 */
export class AccountingError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AccountingError';
    this.code = code;
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AccountingError.prototype);
  }
}

// ── Amount / Decimal Errors ─────────────────────────────────────────────

/**
 * Thrown when an amount string fails canonical decimal validation.
 */
export class InvalidAmountError extends AccountingError {
  public readonly value: string;

  constructor(value: string, detail: string) {
    super('INVALID_AMOUNT', `Invalid amount "${value}": ${detail}`);
    this.name = 'InvalidAmountError';
    this.value = value;
    Object.setPrototypeOf(this, InvalidAmountError.prototype);
  }
}

/**
 * Thrown when a micros value exceeds the safe integer range
 * for JavaScript arithmetic (Number.MAX_SAFE_INTEGER).
 */
export class InvalidMicrosBoundsError extends AccountingError {
  public readonly micros: number;

  constructor(micros: number) {
    super(
      'INVALID_MICROS_BOUNDS',
      `Micros value ${micros} exceeds safe integer bounds`,
    );
    this.name = 'InvalidMicrosBoundsError';
    this.micros = micros;
    Object.setPrototypeOf(this, InvalidMicrosBoundsError.prototype);
  }
}

// ── Posting / Balance Errors ────────────────────────────────────────────

/**
 * Thrown when a posting transaction's debit and credit totals do not match
 * (unbalanced journal entry).
 */
export class UnbalancedPostingError extends AccountingError {
  public readonly debitMicros: number;
  public readonly creditMicros: number;

  constructor(debitMicros: number, creditMicros: number) {
    super(
      'UNBALANCED_POSTING',
      `Posting is unbalanced: debit ${debitMicros} micros != credit ${creditMicros} micros`,
    );
    this.name = 'UnbalancedPostingError';
    this.debitMicros = debitMicros;
    this.creditMicros = creditMicros;
    Object.setPrototypeOf(this, UnbalancedPostingError.prototype);
  }
}

// ── Idempotency Errors ──────────────────────────────────────────────────

/**
 * Thrown when a financial event with the same idempotency key already exists.
 */
export class DuplicateIdempotencyKeyError extends AccountingError {
  public readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      'DUPLICATE_IDEMPOTENCY_KEY',
      `Financial event with idempotency key "${idempotencyKey}" already exists`,
    );
    this.name = 'DuplicateIdempotencyKeyError';
    this.idempotencyKey = idempotencyKey;
    Object.setPrototypeOf(this, DuplicateIdempotencyKeyError.prototype);
  }
}

/// ── Execution Idempotency Errors ──────────────────────────────────────────

/**
 * Thrown when an accounting execution with the same idempotency key already exists.
 */
export class DuplicateExecutionIdempotencyError extends AccountingError {
  public readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      'DUPLICATE_EXECUTION_IDEMPOTENCY_KEY',
      `Accounting execution with idempotency key "${idempotencyKey}" already exists`,
    );
    this.name = 'DuplicateExecutionIdempotencyError';
    this.idempotencyKey = idempotencyKey;
    Object.setPrototypeOf(this, DuplicateExecutionIdempotencyError.prototype);
  }
}

// ── FIFO Allocation Rejection Error ──────────────────────────────────────

/**
 * Thrown when a FIFO allocation rejects an execution (over-close, unsupported
 * flip, mixed side, or reversal).  Used by API routes to return 422
 * Unprocessable Entity responses with a stable rejection code.
 */
export class FifoAllocationRejectedError extends AccountingError {
  public readonly code: string;
  public readonly action: string;
  public readonly quantity?: string;
  public readonly availableQuantity?: string;

  constructor(
    code: string,
    action: string,
    message: string,
    details?: { quantity?: string; availableQuantity?: string },
  ) {
    super('FIFO_ALLOCATION_REJECTED', message);
    this.name = 'FifoAllocationRejectedError';
    this.code = code;
    this.action = action;
    this.quantity = details?.quantity;
    this.availableQuantity = details?.availableQuantity;
    Object.setPrototypeOf(this, FifoAllocationRejectedError.prototype);
  }
}

// ── Correction Errors ───────────────────────────────────────────────────

/**
 * Thrown when attempting to correct an execution that has already been corrected.
 */
export class ExecutionAlreadyCorrectedError extends AccountingError {
  public readonly executionId: string;
  public readonly correctionId: string;

  constructor(executionId: string, correctionId: string) {
    super(
      'EXECUTION_ALREADY_CORRECTED',
      `Execution "${executionId}" has already been corrected via correction "${correctionId}"`,
    );
    this.name = 'ExecutionAlreadyCorrectedError';
    this.executionId = executionId;
    this.correctionId = correctionId;
    Object.setPrototypeOf(this, ExecutionAlreadyCorrectedError.prototype);
  }
}

/**
 * Thrown when attempting to correct an execution that is a reversal or replacement.
 */
export class ExecutionNotMutableError extends AccountingError {
  public readonly executionId: string;

  constructor(executionId: string, reason: string) {
    super(
      'EXECUTION_NOT_MUTABLE',
      `Execution "${executionId}" cannot be corrected: ${reason}`,
    );
    this.name = 'ExecutionNotMutableError';
    this.executionId = executionId;
    Object.setPrototypeOf(this, ExecutionNotMutableError.prototype);
  }
}

/**
 * Thrown when a correction idempotency key already exists.
 */
export class DuplicateCorrectionIdempotencyError extends AccountingError {
  public readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      'DUPLICATE_CORRECTION_IDEMPOTENCY_KEY',
      `Correction with idempotency key "${idempotencyKey}" already exists`,
    );
    this.name = 'DuplicateCorrectionIdempotencyError';
    this.idempotencyKey = idempotencyKey;
    Object.setPrototypeOf(this, DuplicateCorrectionIdempotencyError.prototype);
  }
}

/**
 * Thrown when a referenced financial event does not exist or does not
 * belong to the target account.
 */
export class FinancialEventNotFoundError extends AccountingError {
  public readonly eventId: string;

  constructor(eventId: string) {
    super(
      'FINANCIAL_EVENT_NOT_FOUND',
      `Financial event "${eventId}" not found`,
    );
    this.name = 'FinancialEventNotFoundError';
    this.eventId = eventId;
    Object.setPrototypeOf(this, FinancialEventNotFoundError.prototype);
  }
}

/**
 * Thrown when attempting to correct a financial event that has already
 * been corrected.
 */
export class EventAlreadyCorrectedError extends AccountingError {
  public readonly eventId: string;
  public readonly correctionId: string;

  constructor(eventId: string, correctionId: string) {
    super(
      'EVENT_ALREADY_CORRECTED',
      `Financial event "${eventId}" has already been corrected via correction "${correctionId}"`,
    );
    this.name = 'EventAlreadyCorrectedError';
    this.eventId = eventId;
    this.correctionId = correctionId;
    Object.setPrototypeOf(this, EventAlreadyCorrectedError.prototype);
  }
}

/**
 * Thrown when attempting to correct a financial event that is not
 * eligible for correction — a non-cash event type, a reversal, or a
 * replacement constituent of an existing correction.
 */
export class EventNotCorrectableError extends AccountingError {
  public readonly eventId: string;

  constructor(eventId: string, reason: string) {
    super(
      'EVENT_NOT_CORRECTABLE',
      `Financial event "${eventId}" cannot be corrected: ${reason}`,
    );
    this.name = 'EventNotCorrectableError';
    this.eventId = eventId;
    Object.setPrototypeOf(this, EventNotCorrectableError.prototype);
  }
}

// ── Account Errors ──────────────────────────────────────────────────────

/**
 * Thrown when a referenced account does not exist.
 */
export class AccountNotFoundError extends AccountingError {
  public readonly accountId: string;

  constructor(accountId: string) {
    super(
      'ACCOUNT_NOT_FOUND',
      `Account "${accountId}" not found`,
    );
    this.name = 'AccountNotFoundError';
    this.accountId = accountId;
    Object.setPrototypeOf(this, AccountNotFoundError.prototype);
  }
}

/**
 * Thrown when a financially meaningful posting targets an account whose
 * base currency is not supported by this installation (USD-only contract).
 *
 * Raised by the shared posting-kernel guard below the UI/API layer so a
 * caller cannot bypass the restriction by invoking a posting service
 * directly. Existing non-USD accounts remain historically readable; only
 * NEW financial activity is blocked. No values are rewritten or converted.
 */
export class UnsupportedAccountCurrencyError extends AccountingError {
  public readonly accountId: string;
  public readonly currency: string;

  constructor(accountId: string, currency: string, guidance?: string) {
    super(
      'UNSUPPORTED_ACCOUNT_CURRENCY',
      `Unsupported account currency "${currency}" for account "${accountId}". ` +
        (guidance ?? 'This installation currently supports USD account accounting only.'),
    );
    this.name = 'UnsupportedAccountCurrencyError';
    this.accountId = accountId;
    this.currency = currency;
    Object.setPrototypeOf(this, UnsupportedAccountCurrencyError.prototype);
  }
}

/**
 * Thrown when NEW financial or execution activity targets an inactive
 * account (draft or deactivated).
 *
 * Inactive accounts remain historically readable but are read-only for new
 * activity; reactivation is the explicit boundary that restores permission.
 * Raised by the new-activity domain guard
 * (`assertAccountAcceptsNewActivity`) at origination service boundaries —
 * NOT inside the low-level posting kernel, which is legitimately reused by
 * account initialization (pristine inactive drafts) and financial-event
 * correction (historical records on inactive accounts).
 *
 * Mapped to HTTP 409 by the financial-event and execution routes (the
 * request is structurally valid but conflicts with the current account
 * lifecycle state).
 */
export class AccountInactiveError extends AccountingError {
  public readonly accountId: string;

  constructor(accountId: string) {
    super(
      'ACCOUNT_INACTIVE',
      `Account "${accountId}" is inactive. Reactivate the account before posting new activity.`,
    );
    this.name = 'AccountInactiveError';
    this.accountId = accountId;
    Object.setPrototypeOf(this, AccountInactiveError.prototype);
  }
}

/**
 * Thrown when opening-balance initialization targets an account that is not
 * a pristine new draft (already active, or already carries financial history
 * / executions / positions / trades).
 *
 * Raised by the initialization service below the UI/API layer so the
 * opening balance + activation boundary is always server/domain controlled.
 * Prevents a second opening balance and prevents accidentally reactivating
 * a deactivated historical account.
 */
export class AccountAlreadyInitializedError extends AccountingError {
  public readonly accountId: string;
  public readonly reason: string;

  constructor(accountId: string, reason: string) {
    super(
      'ACCOUNT_ALREADY_INITIALIZED',
      `Account "${accountId}" is already initialized: ${reason}`,
    );
    this.name = 'AccountAlreadyInitializedError';
    this.accountId = accountId;
    this.reason = reason;
    Object.setPrototypeOf(this, AccountAlreadyInitializedError.prototype);
  }
}

/**
 * Thrown when the canonical account-performance projection cannot be
 * persisted during account initialization.
 *
 * `rebuildAccountPerformance()` returns `{ success: false, error }` rather
 * than throwing for normal rebuild failures, so the initialization service
 * inspects the result explicitly and raises this error INSIDE the
 * initialization transaction — forcing a full rollback of the opening
 * balance + activation + projection. No funded-but-unprojected account may
 * ever result from a failed initialization.
 *
 * Mapped to HTTP 500 by the initialization route (an unexpected server-side
 * initialization failure — never 409, which is a lifecycle conflict).
 */
export class AccountInitializationProjectionError extends AccountingError {
  public readonly accountId: string;
  public readonly rebuildError?: string;

  constructor(accountId: string, rebuildError?: string) {
    super(
      'ACCOUNT_INITIALIZATION_PROJECTION_FAILED',
      `Account "${accountId}" initialization rolled back: account-performance projection could not be persisted` +
        (rebuildError ? ` (${rebuildError})` : ''),
    );
    this.name = 'AccountInitializationProjectionError';
    this.accountId = accountId;
    this.rebuildError = rebuildError;
    Object.setPrototypeOf(this, AccountInitializationProjectionError.prototype);
  }
}

/**
 * Thrown when the canonical account-performance projection cannot be rebuilt
 * during account closure.
 *
 * The close workflow requires a FRESH canonical projection before it may
 * deactivate the account. `rebuildAccountPerformance()` returns
 * `{ success: false }` for normal rebuild failures, so the closure service
 * inspects the result explicitly and raises this error BEFORE any lifecycle
 * mutation — the account remains active, the default-account reference is
 * untouched, and the close is safely retryable.
 *
 * Mapped to HTTP 500 by the close route (an unexpected server-side failure;
 * never a lifecycle conflict).
 */
export class AccountClosureProjectionError extends AccountingError {
  public readonly accountId: string;
  public readonly rebuildError?: string;

  constructor(accountId: string, rebuildError?: string) {
    super(
      'ACCOUNT_CLOSURE_PROJECTION_FAILED',
      `Account "${accountId}" cannot be closed: account-performance projection could not be rebuilt` +
        (rebuildError ? ` (${rebuildError})` : ''),
    );
    this.name = 'AccountClosureProjectionError';
    this.accountId = accountId;
    this.rebuildError = rebuildError;
    Object.setPrototypeOf(this, AccountClosureProjectionError.prototype);
  }
}

/**
 * Thrown when the canonical account-performance projection cannot be rebuilt
 * during a financial-event correction.
 *
 * The correction service rebuilds the projection INSIDE the authoritative
 * correction transaction and explicitly enforces
 * `PerformanceRebuildResult.success` — a failed projection write throws this
 * error inside the transaction, rolling back the reversal event, replacement
 * event, correction lineage, and their ledger entries/postings. No successful
 * correction response may leave the projection stale.
 *
 * Mapped to HTTP 500 by the correction route (an unexpected server-side
 * persistence failure — never a user-domain conflict like
 * EVENT_ALREADY_CORRECTED / EVENT_NOT_CORRECTABLE / 4xx). The transaction is
 * already rolled back, so the request is safely retryable and the correction
 * idempotency key is not consumed.
 */
export class FinancialEventCorrectionProjectionError extends AccountingError {
  public readonly accountId: string;
  public readonly originalEventId: string;
  public readonly rebuildError?: string;

  constructor(accountId: string, originalEventId: string, rebuildError?: string) {
    super(
      'FINANCIAL_EVENT_CORRECTION_PROJECTION_FAILED',
      `Correction of event "${originalEventId}" for account "${accountId}" rolled back: account-performance projection could not be persisted` +
        (rebuildError ? ` (${rebuildError})` : ''),
    );
    this.name = 'FinancialEventCorrectionProjectionError';
    this.accountId = accountId;
    this.originalEventId = originalEventId;
    this.rebuildError = rebuildError;
    Object.setPrototypeOf(this, FinancialEventCorrectionProjectionError.prototype);
  }
}
