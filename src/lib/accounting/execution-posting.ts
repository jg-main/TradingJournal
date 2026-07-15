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
import { postFinancialEvent } from './posting';
import {
  AccountNotFoundError,
  DuplicateExecutionIdempotencyError,
} from './errors';
import {
  accountExists,
  findOrCreateInstrument,
  findAccountingExecutionByIdempotencyKey,
  insertAccountingExecution,
} from '../../db/accounting-repository';

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

  // ── 1. Validate account exists ───────────────────────────────────────
  if (!accountExists(sqlite, accountId)) {
    throw new AccountNotFoundError(accountId);
  }

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

    // ── 6. Post balanced ledger effects via posting kernel ─────────────
    // The posting amount is the gross consideration (quantity × price).
    // This represents the total cash movement for the fill.
    // Use micros arithmetic for exact computation.
    const qMicros = toMicros(quantity);
    const pMicros = toMicros(price);
    const prodBig = BigInt(qMicros) * BigInt(pMicros);
    const considerationMicros = Number(prodBig / BigInt(1_000_000));
    const finalConsideration = fromMicros(considerationMicros);

    // Build the payload for the financial event
    const payload = JSON.stringify({
      action,
      symbol,
      quantity,
      price,
      fees,
      ...(journalTradeId ? { journalTradeId } : {}),
      ...(description ? { description } : {}),
    });

    // Build the effect descriptor
    const effect = JSON.stringify({
      kind: 'cash',
      direction: 'decrease', // Executions always decrease cash (buy pays out, sell_short receives but is offset by liability)
      amount: finalConsideration,
      amountMicros: Number(considerationMicros),
    });

    const eventWithPostings = postFinancialEvent(sqlite, {
      accountId,
      eventType: 'trade_execution',
      amount: finalConsideration,
      idempotencyKey: undefined, // Use accounting_executions idempotency, not financial_events
      description: description ?? `Execution: ${action} ${quantity} ${symbol} @ ${price}`,
      payload,
      effect,
      postedAt,
    });

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
