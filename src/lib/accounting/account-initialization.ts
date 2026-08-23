/**
 * Account initialization service (A2).
 *
 * Makes "record the opening balance" and "start with zero" complete account
 * initialization as ONE authoritative server-side transaction:
 *
 *   opening balance posting (if any) + account activation
 *
 * executed inside a single SQLite transaction, so the product invariant
 * holds on every path:
 *
 *   Opening-balance path → active = true, opening_balance event exists once
 *   Start-with-zero path  → active = true, opening_balance count = 0
 *
 * There is no successful initialization that ends with financial history AND
 * a draft account. The opening balance remains an immutable financial event
 * (never an editable account property); this service reuses the posting
 * kernel for the event/entry/posting pair and only adds the activation
 * UPDATE inside the same transaction boundary.
 *
 * Eligibility is restricted to pristine new drafts:
 *   - account must be inactive (a deactivated historical account is NOT
 *     reactivated through this path — that is the lifecycle workflow's job)
 *   - no financial events, no accounting executions, no positions, no trades
 *
 * A second initialization attempt is rejected with AccountAlreadyInitializedError
 * (409 at the API). Replays with the same idempotency key are safe: once the
 * account is initialized it can never be re-initialized, so no duplicate
 * opening balance / entry / postings can ever be created.
 */

import Database from 'better-sqlite3';
import { postFinancialEvent } from './posting';
import { toMicros } from './decimal';
import type { FinancialEventWithPostings, CanonicalDecimal } from './types';
import {
  AccountNotFoundError,
  AccountAlreadyInitializedError,
  DuplicateIdempotencyKeyError,
} from './errors';
import {
  accountExists,
  countAccountEvents,
  countAccountingExecutions,
  listAccountPositions,
  findEventByIdempotencyKey,
} from '../../db/accounting-repository';
import { assertSupportedAccountCurrency } from './posting';

// ── Public Input Types ──────────────────────────────────────────────────

export type InitializationMode = 'opening_balance' | 'zero';

export interface InitializeAccountInput {
  /** Target account ID. */
  accountId: string;
  /** Which initialization path to run. */
  mode: InitializationMode;
  /** Required when mode === 'opening_balance'. Canonical decimal string. */
  amount?: CanonicalDecimal | string;
  /** Optional idempotency key for replay-safe posting (opening_balance only). */
  idempotencyKey?: string;
  /** Optional human-readable description (opening_balance only). */
  description?: string;
  /** ISO-8601 timestamp (opening_balance only). Defaults to current UTC. */
  postedAt?: string;
}

export interface InitializeAccountResult {
  /** Always true after a successful initialization. */
  isActive: true;
  /**
   * The posted opening-balance aggregate for mode 'opening_balance';
   * null for mode 'zero' (no financial event is fabricated).
   */
  openingBalance: FinancialEventWithPostings | null;
}

// ── Pristine-Draft Eligibility Guard ────────────────────────────────────

/**
 * Verify the account is a pristine new draft: inactive with no financial
 * events, no accounting executions, no positions, and no trades.
 *
 * Throws {@link AccountNotFoundError} when the account does not exist and
 * {@link AccountAlreadyInitializedError} (409 at the API) when any
 * eligibility condition fails. Runs BEFORE any mutation so rejection leaves
 * no partial state.
 */
export function assertPristineDraft(
  sqlite: Database.Database,
  accountId: string,
): void {
  if (!accountExists(sqlite, accountId)) {
    throw new AccountNotFoundError(accountId);
  }

  const account = sqlite
    .prepare('SELECT is_active, currency FROM accounts WHERE id = ?')
    .get(accountId) as { is_active: number | null; currency: string | null } | undefined;
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  // Inactive accounts are not necessarily new drafts: a deactivated
  // historical account must NOT be reactivated through this path.
  if (account.is_active === 1) {
    throw new AccountAlreadyInitializedError(
      accountId,
      'the account is already active',
    );
  }

  const eventCount = countAccountEvents(sqlite, accountId);
  if (eventCount > 0) {
    throw new AccountAlreadyInitializedError(
      accountId,
      `the account already has ${eventCount} financial event(s)`,
    );
  }

  const executionCount = countAccountingExecutions(sqlite, accountId);
  if (executionCount > 0) {
    throw new AccountAlreadyInitializedError(
      accountId,
      `the account already has ${executionCount} execution(s)`,
    );
  }

  const positions = listAccountPositions(sqlite, accountId);
  if (positions.length > 0) {
    throw new AccountAlreadyInitializedError(
      accountId,
      `the account already has ${positions.length} open position(s)`,
    );
  }

  const tradeRow = sqlite
    .prepare('SELECT EXISTS(SELECT 1 FROM trades WHERE account_id = ?) AS has_trade')
    .get(accountId) as { has_trade: number };
  if (tradeRow.has_trade === 1) {
    throw new AccountAlreadyInitializedError(
      accountId,
      'the account already has trade history',
    );
  }
}

// ── Initialization Service ──────────────────────────────────────────────

/**
 * Complete account initialization in one server-side transaction.
 *
 * 1. USD-only currency guard (also confirms the account exists).
 * 2. Pristine-draft eligibility guard (throws 409-equivalent domain error).
 * 3. Idempotency pre-check for opening_balance mode.
 * 4. Single SQLite transaction:
 *    - mode 'opening_balance': post the immutable opening-balance event
 *      (financial event + ledger entry + balanced postings) via the posting
 *      kernel — better-sqlite3 nests this as a savepoint within the outer
 *      transaction, so a later activation failure rolls it back too;
 *    - mode 'zero': no event is created;
 *    - activation UPDATE (is_active = 1) inside the same transaction.
 *
 * Either the account ends active WITH its opening balance, or neither change
 * persists — there is no persisted "funded but inactive" state.
 *
 * @throws {AccountNotFoundError}          Account does not exist.
 * @throws {UnsupportedAccountCurrencyError} Legacy non-USD account (USD-only contract).
 * @throws {AccountAlreadyInitializedError}  Not a pristine draft (active, or has history).
 * @throws {DuplicateIdempotencyKeyError}    Idempotency key already used.
 * @throws {InvalidAmountError | InvalidMicrosBoundsError} Bad opening-balance amount.
 */
export function initializeAccount(
  sqlite: Database.Database,
  input: InitializeAccountInput,
): InitializeAccountResult {
  const { accountId, mode, amount, idempotencyKey, description, postedAt } = input;

  // 1. Currency + existence guard (throws before any mutation).
  assertSupportedAccountCurrency(sqlite, accountId);

  // 2. Pristine-draft eligibility guard (throws before any mutation).
  assertPristineDraft(sqlite, accountId);

  // 3. Idempotency pre-check (fail fast, matches posting-kernel convention).
  if (mode === 'opening_balance' && idempotencyKey) {
    const existingEvent = findEventByIdempotencyKey(sqlite, idempotencyKey);
    if (existingEvent) {
      throw new DuplicateIdempotencyKeyError(idempotencyKey);
    }
  }

  // 4. Single authoritative transaction: posting (if any) + activation.
  const transaction = sqlite.transaction(() => {
    let openingBalance: FinancialEventWithPostings | null = null;
    if (mode === 'opening_balance') {
      // Post through the generalized posting kernel with the SAME canonical
      // payload/effect that the generic financial-event route produces for
      // opening_balance (payload {amount}, effect {kind:'cash',direction:
      // 'increase'}) so the ledger/activity projections derive cash impact
      // identically. better-sqlite3 nests this as a savepoint within the
      // outer transaction, so a later activation failure rolls it back too.
      openingBalance = postFinancialEvent(sqlite, {
        accountId,
        eventType: 'opening_balance',
        amount: amount as string,
        idempotencyKey,
        description,
        postedAt,
        payload: JSON.stringify({ amount: amount as string }),
        effect: JSON.stringify({
          kind: 'cash',
          direction: 'increase',
          amount: amount as string,
          amountMicros: toMicros(amount as string),
        }),
      });
    }

    // Activation must not go through the generic lifecycle PUT (which is the
    // manual reactivation path for historical accounts); this is the
    // initialization boundary, so the UPDATE is co-located with the posting
    // inside one transaction.
    sqlite
      .prepare('UPDATE accounts SET is_active = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), accountId);

    return { openingBalance };
  });

  const { openingBalance } = transaction();

  return { isActive: true, openingBalance };
}

// ── Response Helpers ────────────────────────────────────────────────────

/** Build a JSON-safe FinancialEventWithPostings record for API responses. */
export function toInitializationEventRecord(
  aggregate: FinancialEventWithPostings | null,
): {
  event: Record<string, unknown> | null;
  entry: Record<string, unknown> | null;
  postings: Record<string, unknown> | null;
} {
  if (!aggregate) {
    return { event: null, entry: null, postings: null };
  }
  return {
    event: {
      id: aggregate.event.id,
      accountId: aggregate.event.accountId,
      eventType: aggregate.event.eventType,
      idempotencyKey: aggregate.event.idempotencyKey,
      description: aggregate.event.description,
      payload: aggregate.event.payload,
      effect: aggregate.event.effect,
      postedAt: aggregate.event.postedAt,
      createdAt: aggregate.event.createdAt,
    },
    entry: {
      id: aggregate.entry.id,
      financialEventId: aggregate.entry.financialEventId,
      accountId: aggregate.entry.accountId,
      description: aggregate.entry.description,
      postedAt: aggregate.entry.postedAt,
      createdAt: aggregate.entry.createdAt,
    },
    postings: {
      debit: {
        id: aggregate.postings.debit.id,
        ledgerEntryId: aggregate.postings.debit.ledgerEntryId,
        accountId: aggregate.postings.debit.accountId,
        side: aggregate.postings.debit.side,
        amount: aggregate.postings.debit.amount,
        amountMicros: aggregate.postings.debit.amountMicros,
        currency: aggregate.postings.debit.currency,
        sequence: aggregate.postings.debit.sequence,
        createdAt: aggregate.postings.debit.createdAt,
      },
      credit: {
        id: aggregate.postings.credit.id,
        ledgerEntryId: aggregate.postings.credit.ledgerEntryId,
        accountId: aggregate.postings.credit.accountId,
        side: aggregate.postings.credit.side,
        amount: aggregate.postings.credit.amount,
        amountMicros: aggregate.postings.credit.amountMicros,
        currency: aggregate.postings.credit.currency,
        sequence: aggregate.postings.credit.sequence,
        createdAt: aggregate.postings.credit.createdAt,
      },
    },
  };
}
