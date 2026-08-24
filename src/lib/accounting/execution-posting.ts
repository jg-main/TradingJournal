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
import { AmbiguousEconomicActionError, cashDirectionForEconomicAction, ECONOMIC_ACTIONS, type EconomicAction } from './economic-action';
import { AccountExecutionProjectionError } from './errors';
import { rebuildPositionsWithinTransaction } from '../positions/rebuild';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';
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
  /** The balanced ledger event + entry + postings (gross consideration). */
  eventWithPostings: FinancialEventWithPostings;
  /**
   * M002-A6: the execution fee cash event (eventType fee, direction decrease),
   * or null when the execution has no fee (fees = 0 → no meaningless $0 event).
   */
  feeEventWithPostings: FinancialEventWithPostings | null;
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

/**
 * M002-A6: deterministic idempotency key for the execution fee cash event.
 *
 * Same accounting execution → exactly one fee cash event. Repeated
 * synchronization / repair → zero duplicate fee effects. Identified by key,
 * never by fuzzy description.
 */
export function executionFeeFinancialEventIdempotencyKey(accountingExecutionId: string): string {
  return `accounting-execution-fee:${accountingExecutionId}:v1`;
}

/**
 * M002-A6: deterministic key for the fee REFUND posted when an execution
 * correction supersedes an original that already posted a fee cash event.
 * Keyed by the ORIGINAL execution — a refund is never posted twice.
 */
export function executionFeeRefundIdempotencyKey(originalExecutionId: string): string {
  return `correction-execution-fee-refund:${originalExecutionId}:v1`;
}

type ExecutionFinancialEventInput = Parameters<typeof postFinancialEvent>[1];

/**
 * Build the immutable cash effect for one accounting execution.
 *
 * The calculation is shared by direct accounting entries, legacy journal
 * synchronization, and the one-time repair command so those paths cannot
 * disagree about available cash or NAV.
 *
 * M002-A5: `input.action` must be a CONCRETE economic action
 * (buy / sell / sell_short / buy_to_cover). Generic workflow aliases
 * (`add` / `reduce`) are rejected — callers resolve the economic side from
 * position/trade direction via resolveEconomicExecutionAction BEFORE this
 * builder, so no accounting cash effect ever guesses direction from an
 * unresolved management alias.
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

  if (!(ECONOMIC_ACTIONS as readonly string[]).includes(input.action)) {
    throw new AmbiguousEconomicActionError(input.action, 'unknown');
  }
  const economicAction = input.action as EconomicAction;

  return {
    accountId: input.accountId,
    eventType: 'trade_execution',
    amount,
    idempotencyKey: executionFinancialEventIdempotencyKey(input.accountingExecutionId),
    description,
    payload: JSON.stringify({
      accountingExecutionId: input.accountingExecutionId,
      action: economicAction,
      symbol: input.symbol,
      quantity: input.quantity,
      price: input.price,
      fees: input.fees,
      ...(input.journalTradeId ? { journalTradeId: input.journalTradeId } : {}),
      ...(input.description ? { description: input.description } : {}),
    }),
    effect: JSON.stringify({
      kind: 'cash',
      direction: cashDirectionForEconomicAction(economicAction),
      amount,
      amountMicros: considerationMicros,
    }),
    postedAt: input.postedAt,
  };
}

/**
 * M002-A6: build the immutable CASH effect for one execution fee.
 *
 * The fee is a real cash expense at execution time, regardless of the
 * economic action: buy/sell/sell_short/buy_to_cover — fees always reduce
 * cash. The gross trade event stays quantity × price; this separate event
 * posts the fee only (the projection sums both — never change the gross
 * event to net consideration AND post a fee event, which would double-charge).
 *
 * `accounting_executions.fees` remains the factual fee source; this event
 * represents its cash effect, with explicit linkage in the payload.
 */
export function buildExecutionFeeFinancialEventInput(input: {
  accountingExecutionId: string;
  accountId: string;
  symbol: string;
  action: string;
  fees: string;
  journalTradeId?: string | null;
  postedAt: string;
}): ExecutionFinancialEventInput {
  return {
    accountId: input.accountId,
    eventType: 'fee',
    amount: input.fees as CanonicalDecimal,
    idempotencyKey: executionFeeFinancialEventIdempotencyKey(input.accountingExecutionId),
    description: `Execution fee for ${input.action} ${input.symbol} @ ${input.fees}`,
    payload: JSON.stringify({
      feeType: 'execution',
      accountingExecutionId: input.accountingExecutionId,
      action: input.action,
      symbol: input.symbol,
      amount: input.fees,
      ...(input.journalTradeId ? { journalTradeId: input.journalTradeId } : {}),
    }),
    effect: JSON.stringify({
      kind: 'cash',
      direction: 'decrease',
      amount: input.fees,
      amountMicros: toMicros(input.fees),
    }),
    postedAt: input.postedAt,
  };
}

/**
 * Ensure an immutable accounting execution has its corresponding execution
 * fee cash event (deterministic + idempotent). Returns null when the
 * execution has no fee (fees = 0) or the fee event already exists.
 */
export function ensureExecutionFeeFinancialEvent(
  sqlite: Database.Database,
  execution: AccountingExecutionRow,
  symbol: string,
): { inserted: boolean; eventWithPostings: FinancialEventWithPostings | null } {
  if (toMicros(execution.fees) === 0) {
    return { inserted: false, eventWithPostings: null };
  }
  const idempotencyKey = executionFeeFinancialEventIdempotencyKey(execution.id);
  if (findEventByIdempotencyKey(sqlite, idempotencyKey)) {
    return { inserted: false, eventWithPostings: null };
  }
  return {
    inserted: true,
    eventWithPostings: postFinancialEvent(
      sqlite,
      buildExecutionFeeFinancialEventInput({
        accountingExecutionId: execution.id,
        accountId: execution.account_id,
        symbol,
        action: execution.action,
        fees: execution.fees,
        journalTradeId: execution.journal_trade_id,
        postedAt: execution.posted_at,
      }),
    ),
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

    // ── 7. M002-A6: post the execution fee cash event (only when fees > 0) ─
    const feeEventWithPostings = toMicros(fees) > 0
      ? postFinancialEvent(
          sqlite,
          buildExecutionFeeFinancialEventInput({
            accountingExecutionId: executionRow.id,
            accountId,
            symbol,
            action,
            fees,
            journalTradeId,
            postedAt,
          }),
        )
      : null;

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
      feeEventWithPostings,
    };
  });

  return transaction();
}

// ── M002-A7: atomic direct account execution ──────────────────────────────

export interface PostAccountExecutionWithProjectionsInput {
  accountId: string;
  symbol: string;
  /** Concrete economic action (buy/sell/sell_short/buy_to_cover). */
  action: string;
  quantity: string;
  price: string;
  fees?: string;
  idempotencyKey?: string;
  journalTradeId?: string;
  description?: string;
  postedAt?: string;
}

export interface AccountExecutionWithProjectionsResult {
  /** The committed immutable accounting execution record. */
  execution: PostExecutionFillResult['execution'];
  /** Gross consideration event. */
  eventWithPostings: FinancialEventWithPostings;
  /** Execution fee event (null when fees = 0). */
  feeEventWithPostings: FinancialEventWithPostings | null;
  /** FIFO rebuild outcome (counts). */
  rebuildStatus: { executionCount: number; lotCount: number; matchCount: number };
  /** Concise account-performance evidence (proves success inside the txn). */
  performance: { nav: string | null; computedAt: string };
}

/**
 * M002-A7: post a direct account execution WITH its projections, atomically.
 *
 * ONE outer transaction owns the entire operation:
 *
 *   BEGIN
 *     postExecutionFill(...)              — nested savepoint (immutable
 *                                            accounting execution + gross cash
 *                                            event + fee event + ledger)
 *     rebuildPositionsWithinTransaction() — FIFO lot / match / position replay
 *     rebuildAccountPerformance()         — account-wide projection
 *     enforce performance.success === true
 *   COMMIT
 *
 * Any exception — including a FIFO replay rejection and a
 * `{ success: false }` performance rebuild (which catches internal errors) —
 * throws inside the transaction, so the immutable execution, all cash/fee
 * effects, ledger rows, FIFO lots/matches, account position, and projection
 * changes roll back together. HTTP 201 from the route therefore guarantees
 * every projection succeeded; a failure leaves the idempotency key unused and
 * the request safely retryable.
 *
 * @throws {AccountExecutionProjectionError} when a projection stage fails
 * @throws {DuplicateExecutionIdempotencyError} on a reused idempotency key
 */
export function postAccountExecutionWithProjections(
  sqlite: Database.Database,
  input: PostAccountExecutionWithProjectionsInput,
): AccountExecutionWithProjectionsResult {
  const transaction = sqlite.transaction(() => {
    const fill = postExecutionFill(sqlite, {
      accountId: input.accountId,
      symbol: input.symbol,
      action: input.action,
      quantity: input.quantity,
      price: input.price,
      fees: input.fees,
      idempotencyKey: input.idempotencyKey,
      journalTradeId: input.journalTradeId,
      description: input.description,
      postedAt: input.postedAt,
    });

    // FIFO projection — transaction-aware replay (fails closed when the
    // immutable execution stream cannot be replayed).
    let rebuildStatus: { executionCount: number; lotCount: number; matchCount: number };
    try {
      const rebuildResult = rebuildPositionsWithinTransaction(
        sqlite,
        input.accountId,
        fill.execution.instrumentId,
      );
      rebuildStatus = {
        executionCount: rebuildResult.executionCount,
        lotCount: rebuildResult.lotCount,
        matchCount: rebuildResult.matchCount,
      };
    } catch (err) {
      throw new AccountExecutionProjectionError(
        input.accountId,
        'fifo',
        err instanceof Error ? err.message : String(err),
      );
    }

    // Account-performance projection — rebuildAccountPerformance catches
    // internal errors and returns { success: false }, so success is enforced
    // explicitly (never a silent stale projection after a 201).
    const perf = rebuildAccountPerformance(sqlite, input.accountId);
    if (!perf.success) {
      throw new AccountExecutionProjectionError(
        input.accountId,
        'performance',
        perf.error ?? 'rebuild returned success=false',
      );
    }

    return {
      execution: fill.execution,
      eventWithPostings: fill.eventWithPostings,
      feeEventWithPostings: fill.feeEventWithPostings,
      rebuildStatus,
      performance: { nav: perf.nav, computedAt: perf.computedAt },
    };
  });

  return transaction();
}
