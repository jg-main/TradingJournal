/**
 * Accounting execution posting service.
 *
 * Creates an immutable accounting execution row and posts balanced ledger
 * effects for economic-side fills.  Instrument resolution, account validation,
 * idempotency, and journal attribution are handled atomically.
 *
 * The execution posting creates the IMMUTABLE source record (accounting_executions)
 * and the balanced double-entry ledger effect (financial_events + postings).
 * Position rebuild (reading executions → FIFO allocation → projection rows)
 * is a separate concern handled by src/lib/positions/rebuild.ts.
 *
 * Pure service — all side effects go through the repository module and the
 * caller-provided SQLite handle.
 */

import Database from 'better-sqlite3';
import { toMicros, fromMicros } from './decimal';
import type { CanonicalDecimal } from './types';
import type { FinancialEventWithPostings } from './types';
import { postFinancialEvent, assertSupportedAccountCurrency } from './posting';
import { assertAccountAcceptsNewActivity } from './activity-guard';
import {
  AccountNotFoundError,
  DuplicateExecutionIdempotencyError,
} from './errors';
import {
  findEventByIdempotencyKey,
  findOrCreateInstrument,
  findAccountingExecutionByIdempotencyKey,
  insertAccountingExecution,
} from '../../db/accounting-repository';
import type { AccountingExecutionRow } from '../../db/accounting-repository';

// ── Input Types ──────────────────────────────────────────────────────────

/**
 * Validated input for posting an accounting execution fill.
 *
 * Fields are pre-validated (via execution-contracts.ts zod schema) and
 * ready for service-level processing.
 */
export interface PostExecutionFillInput {
  /** Account ID the execution belongs to. */
  accountId: string;
  /** Instrument symbol (e.g. "AAPL") to resolve/create an instrument. */
  symbol: string;
  /** Execution action. */
  action: string;
  /** Fill quantity as canonical decimal (e.g. "100.00"). */
  quantity: string;
  /** Fill price per unit as canonical decimal (e.g. "150.75"). */
  price: string;
  /** Execution fees as canonical decimal (defaults to "0.00"). */
  fees?: string;
  /** Optional UUID for idempotent retry. */
  idempotencyKey?: string;
  /** Optional UUID linking to a journal trade (attribution only). */
  journalTradeId?: string;
  /** Optional human-readable description. */
  description?: string;
  /** ISO-8601 timestamp. Defaults to current UTC time. */
  postedAt?: string;
}

/**
 * Result of a successful execution fill posting.
 */
export interface PostExecutionFillResult {
  /** The immutable accounting execution record. */
  execution: {
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
  /** The balanced ledger event + entry + postings. */
  eventWithPostings: FinancialEventWithPostings;
}

/**
 * The financial-event idempotency key for an immutable accounting execution.
 *
 * Keeping this link deterministic lets the ledger repair process safely
 * identify executions that were synchronized before cash effects existed.
 */
export function executionFinancialEventIdempotencyKey(accountingExecutionId: string): string {
  return `accounting-execution-${accountingExecutionId}`;
}

type ExecutionFinancialEventInput = Parameters<typeof postFinancialEvent>[1];

/**
 * Build the immutable cash effect for one accounting execution.
 *
 * The calculation is shared by direct accounting entries, legacy journal
 * synchronization, and the one-time repair command so those paths cannot
 * disagree about available cash or NAV.
 */
export function buildExecutionFinancialEventInput(input: {
  accountingExecutionId: string;
  accountId: string;
  symbol: string;
  action: string;
  quantity: string;
  price: string;
  fees: string;
  journalTradeId?: string | null;
  description?: string | null;
  postedAt: string;
}): ExecutionFinancialEventInput {
  const qMicros = toMicros(input.quantity);
  const pMicros = toMicros(input.price);
  const considerationMicros = Number(
    (BigInt(qMicros) * BigInt(pMicros)) / BigInt(1_000_000),
  );
  const amount = fromMicros(considerationMicros);
  const description = input.description ?? `Execution: ${input.action} ${input.quantity} ${input.symbol} @ ${input.price}`;

  return {
    accountId: input.accountId,
    eventType: 'trade_execution',
    amount,
    idempotencyKey: executionFinancialEventIdempotencyKey(input.accountingExecutionId),
    description,
    payload: JSON.stringify({
      accountingExecutionId: input.accountingExecutionId,
      action: input.action,
      symbol: input.symbol,
      quantity: input.quantity,
      price: input.price,
      fees: input.fees,
      ...(input.journalTradeId ? { journalTradeId: input.journalTradeId } : {}),
      ...(input.description ? { description: input.description } : {}),
    }),
    effect: JSON.stringify({
      kind: 'cash',
      direction: ['sell', 'reduce', 'sell_short'].includes(input.action) ? 'increase' : 'decrease',
      amount,
      amountMicros: considerationMicros,
    }),
    postedAt: input.postedAt,
  };
}

/**
 * Ensure an immutable accounting execution has its corresponding cash event.
 *
 * Returning an existing event instead of throwing makes recovery safe after a
 * prior partial legacy sync: replaying the same execution never changes cash
 * twice.
 */
export function ensureExecutionFinancialEvent(
  sqlite: Database.Database,
  execution: AccountingExecutionRow,
  symbol: string,
): { inserted: boolean; eventWithPostings: FinancialEventWithPostings | null } {
  const idempotencyKey = executionFinancialEventIdempotencyKey(execution.id);
  if (findEventByIdempotencyKey(sqlite, idempotencyKey)) {
    return { inserted: false, eventWithPostings: null };
  }

  return {
    inserted: true,
    eventWithPostings: postFinancialEvent(
      sqlite,
      buildExecutionFinancialEventInput({
        accountingExecutionId: execution.id,
        accountId: execution.account_id,
        symbol,
        action: execution.action,
        quantity: execution.quantity,
        price: execution.price,
        fees: execution.fees,
        journalTradeId: execution.journal_trade_id,
        description: execution.description,
        postedAt: execution.posted_at,
      }),
    ),
  };
}

// ── Service ──────────────────────────────────────────────────────────────

/**
 * Post an economic-side execution fill atomically.
 *
 * 1. Validates the account exists
 * 2. Resolves or creates the instrument by symbol
 * 3. Checks for idempotency key on accounting_executions (if provided)
 * 4. Creates the immutable accounting_execution row
 * 5. Posts balanced ledger effects via the generalized posting kernel
 *    (one financial_event with payload describing the fill, one ledger_entry,
 *     one balanced debit/credit posting pair for the gross consideration)
 * 6. Attaches optional journal_trade_id (attribution only — no P&L dependency)
 *
 * The ledger posting amount is the gross consideration (quantity × price).
 * Fees are recorded in the accounting_executions row for FIFO allocation
 * but are NOT split into separate ledger postings — the ledger records the
 * gross cash movement and fee allocation is a position-level concern.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle for transactional control.
 * @param input     - Validated execution fill input.
 * @returns PostExecutionFillResult with the execution record and ledger event.
 * @throws {AccountNotFoundError}               If the account does not exist.
 * @throws {DuplicateExecutionIdempotencyError}  If the idempotency key already exists.
 */
export function postExecutionFill(
  sqlite: Database.Database,
  input: PostExecutionFillInput,
): PostExecutionFillResult {
  const {
    accountId,
    symbol,
    action,
    quantity,
    price,
    fees: rawFees,
    idempotencyKey,
    journalTradeId,
    description,
    postedAt: rawPostedAt,
  } = input;

  const postedAt = rawPostedAt ?? new Date().toISOString();
  const fees = rawFees ?? '0.00';

  // ── 0. A6 lifecycle guard: NEW execution origination requires an ACTIVE
  //        account. Runs before any instrument/execution-row/financial-event/
  //        ledger mutation so a rejected execution creates nothing and
  //        consumes no idempotency key. This service is exclusively the
  //        new-execution boundary (execution correction uses the posting
  //        kernel directly and remains available for historical records).
  assertAccountAcceptsNewActivity(sqlite, accountId);

  // ── 1. Validate account exists and its base currency is supported (USD-
  // ─────    only contract). Runs BEFORE any mutation — instrument creation,
  // ─────    execution-row insert, and ledger posting all depend on it — so a
  // ─────    rejected execution leaves no partial state.
  assertSupportedAccountCurrency(sqlite, accountId);

  // ── 2. Resolve or create instrument ──────────────────────────────────
  const instrument = findOrCreateInstrument(sqlite, symbol);

  // ── 3. Check idempotency key on accounting_executions ─────────────────
  if (idempotencyKey) {
    const existing = findAccountingExecutionByIdempotencyKey(sqlite, idempotencyKey);
    if (existing) {
      throw new DuplicateExecutionIdempotencyError(idempotencyKey);
    }
  }

  // ── 4. Begin atomic transaction ───────────────────────────────────────
  const transaction = sqlite.transaction(() => {
    // ── 5. Create the accounting_execution row ─────────────────────────
    const executionRow = insertAccountingExecution(sqlite, {
      accountId,
      instrumentId: instrument.id,
      action,
      quantity,
      price,
      fees,
      idempotencyKey: idempotencyKey ?? null,
      journalTradeId: journalTradeId ?? null,
      description: description ?? null,
      postedAt,
    });

    // ── 6. Post balanced ledger effects via the shared execution kernel ─
    const eventWithPostings = postFinancialEvent(
      sqlite,
      buildExecutionFinancialEventInput({
        accountingExecutionId: executionRow.id,
        accountId,
        symbol,
        action,
        quantity,
        price,
        fees,
        journalTradeId,
        description,
        postedAt,
      }),
    );

    return {
      execution: {
        id: executionRow.id,
        accountId: executionRow.account_id,
        instrumentId: executionRow.instrument_id,
        action: executionRow.action,
        quantity: executionRow.quantity,
        price: executionRow.price,
        fees: executionRow.fees,
        idempotencyKey: executionRow.idempotency_key,
        journalTradeId: executionRow.journal_trade_id,
        description: executionRow.description,
        postedAt: executionRow.posted_at,
        createdAt: executionRow.created_at,
      },
      eventWithPostings,
    };
  });

  return transaction();
}
