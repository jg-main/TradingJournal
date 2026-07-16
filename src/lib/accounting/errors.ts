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
