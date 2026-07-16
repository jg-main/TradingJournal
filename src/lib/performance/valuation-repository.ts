/**
 * Repository-injected service for persisted valuation marks.
 *
 * Wraps the raw accounting-repository insert/find operations with validation,
 * exact-decimal price normalization, idempotency handling, and structured
 * domain errors.  This is the canonical write path for submitting new marks.
 *
 * Every method takes a raw better-sqlite3 Database handle so callers
 * (API routes, rebuild engine, import pipelines) can manage their own
 * transactions.
 *
 * @module performance/valuation-repository
 */

import Database from 'better-sqlite3';
import {
  insertValuationMark,
  findValuationMarkByIdempotencyKey,
  listLatestValuationMarks,
  listAccountValuationMarks,
  countAccountValuationMarks,
  accountExists,
  findInstrumentById,
  findOrCreateInstrument,
} from '../../db/accounting-repository';
import {
  toMicros,
  normalizeDecimal,
} from '../accounting/decimal';
import type { CanonicalDecimal } from '../accounting/types';
import type { MarkSource, ValuationMark } from './types';

// ── Domain Error Types ──────────────────────────────────────────────────

export class ValuationMarkError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_mark' | 'invalid_price' | 'unknown_instrument' | 'unknown_account' | 'idempotency_conflict',
  ) {
    super(message);
    this.name = 'ValuationMarkError';
  }
}

// ── Insert Result ────────────────────────────────────────────────────────

export interface InsertValuationMarkResult {
  /** The inserted mark as a domain ValuationMark. */
  mark: ValuationMark;
  /** The raw database row (for internal use). */
  rowId: string;
  /** Whether this was a new insertion (true) or idempotent no-op (false). */
  inserted: boolean;
}

// ── Mark Insertion (Validated) ──────────────────────────────────────────

/**
 * Insert a new valuation mark with full validation.
 *
 * Validates:
 * - Account exists
 * - Instrument exists (or creates by symbol)
 * - Price is a well-formed canonical decimal
 * - Source is a valid MarkSource
 * - Idempotency key is unique if provided
 *
 * Returns a structured InsertValuationMarkResult.  Throws ValuationMarkError
 * for any validation failure.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param params    - Mark parameters.
 * @returns InsertValuationMarkResult with the persisted mark.
 * @throws ValuationMarkError on validation failure.
 */
export function insertValidatedValuationMark(
  sqlite: Database.Database,
  params: {
    accountId: string;
    instrumentId?: string;
    instrumentSymbol?: string;
    price: string | number;
    source: string;
    markTimestamp: string;
    idempotencyKey?: string | null;
  },
): InsertValuationMarkResult {
  // 1. Validate account exists
  if (!accountExists(sqlite, params.accountId)) {
    throw new ValuationMarkError(
      `Account ${params.accountId} not found`,
      'unknown_account',
    );
  }

  // 2. Resolve instrument
  let instrumentId = params.instrumentId;
  if (!instrumentId && params.instrumentSymbol) {
    const instrument = findOrCreateInstrument(sqlite, params.instrumentSymbol);
    instrumentId = instrument.id;
  }
  if (!instrumentId) {
    throw new ValuationMarkError(
      'Either instrumentId or instrumentSymbol is required',
      'unknown_instrument',
    );
  }

  // Verify the instrument exists
  const resolvedInstrument = findInstrumentById(sqlite, instrumentId);
  if (!resolvedInstrument) {
    throw new ValuationMarkError(
      `Instrument ${instrumentId} not found`,
      'unknown_instrument',
    );
  }

  // 3. Validate and normalize price
  let price: CanonicalDecimal;
  try {
    price = normalizeDecimal(params.price);
  } catch {
    throw new ValuationMarkError(
      `Invalid price: ${params.price}`,
      'invalid_price',
    );
  }
  const priceMicros = toMicros(price);

  // 4. Validate source
  const validSources = ['user', 'market_data', 'import', 'system'];
  if (!validSources.includes(params.source)) {
    throw new ValuationMarkError(
      `Invalid mark source: ${params.source}`,
      'invalid_mark',
    );
  }

  // 5. Validate mark timestamp
  const ts = new Date(params.markTimestamp);
  if (isNaN(ts.getTime())) {
    throw new ValuationMarkError(
      `Invalid mark timestamp: ${params.markTimestamp}`,
      'invalid_mark',
    );
  }

  // 6. Check idempotency
  if (params.idempotencyKey) {
    const existing = findValuationMarkByIdempotencyKey(sqlite, params.idempotencyKey);
    if (existing) {
      return {
        mark: {
          instrumentId: existing.instrument_id,
          price: existing.price as CanonicalDecimal,
          markTimestamp: existing.mark_timestamp,
          source: existing.source as MarkSource,
        },
        rowId: existing.id,
        inserted: false,
      };
    }
  }

  // 7. Insert
  const row = insertValuationMark(sqlite, {
    accountId: params.accountId,
    instrumentId,
    price,
    priceMicros,
    source: params.source,
    markTimestamp: params.markTimestamp,
    idempotencyKey: params.idempotencyKey ?? null,
  });

  return {
    mark: {
      instrumentId: row.instrument_id,
      price: row.price as CanonicalDecimal,
      markTimestamp: row.mark_timestamp,
      source: row.source as MarkSource,
    },
    rowId: row.id,
    inserted: true,
  };
}

// ── Read Marks ──────────────────────────────────────────────────────────

/**
 * Get the latest valuation mark for each instrument in an account.
 * Returns domain ValuationMark objects.
 */
export function getLatestMarks(
  sqlite: Database.Database,
  accountId: string,
): ValuationMark[] {
  const rows = listLatestValuationMarks(sqlite, accountId);
  return rows.map((r) => ({
    instrumentId: r.instrument_id,
    price: r.price as CanonicalDecimal,
    markTimestamp: r.mark_timestamp,
    source: r.source as MarkSource,
  }));
}

/**
 * List valuation marks for an account with optional filtering.
 */
export function listMarks(
  sqlite: Database.Database,
  accountId: string,
  options?: {
    instrumentId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  },
): ValuationMark[] {
  const rows = listAccountValuationMarks(sqlite, accountId, options);
  return rows.map((r) => ({
    instrumentId: r.instrument_id,
    price: r.price as CanonicalDecimal,
    markTimestamp: r.mark_timestamp,
    source: r.source as MarkSource,
  }));
}

/**
 * Count valuation marks for an account.
 */
export function countMarks(
  sqlite: Database.Database,
  accountId: string,
): number {
  return countAccountValuationMarks(sqlite, accountId);
}
