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
