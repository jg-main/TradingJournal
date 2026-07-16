/**
 * Account Valuation Mark API Route
 *
 * POST /api/accounts/:id/valuations — submit a valuation mark for an instrument.
 * GET /api/accounts/:id/valuations — list valuation marks for an account.
 *
 * Validates the request body with Zod, resolves the target account and instrument,
 * delegates to the validated mark insertion service, and maps domain errors to
 * the project's existing JSON error conventions.
 *
 * @module valuations/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';
import {
  postValuationMarkSchema,
  listValuationMarksQuerySchema,
} from '@/lib/performance/api-contracts';
import {
  insertValidatedValuationMark,
  ValuationMarkError,
} from '@/lib/performance/valuation-repository';
import {
  listAccountValuationMarks,
  countAccountValuationMarks,
  accountExists,
  findInstrumentById,
} from '@/db/accounting-repository';

type RouteParams = { params: Promise<{ id: string }> };

// ── POST ────────────────────────────────────────────────────────────────

/**
 * POST /api/accounts/:id/valuations
 *
 * Submit a valuation mark for an instrument.
 *
 * Request body (Zod-validated):
 * - instrumentId (UUID, optional): existing instrument UUID
 * - symbol (string, optional): ticker to look up or create
 * - price (string | number): canonical decimal or number
 * - source (enum): "user" | "market_data" | "import" | "system"
 * - markTimestamp (ISO datetime): when the price was observed
 * - idempotencyKey (UUID, optional): idempotent posting
 * - description (string, optional): human-readable note
 *
 * One of instrumentId or symbol is required.
 *
 * Responses:
 * - 201: Mark created successfully
 * - 400: Validation failure or invalid input
 * - 404: Account not found
 * - 409: Duplicate idempotency key
 * - 500: Unexpected server error
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;

    // 1. Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const parsed = postValuationMarkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { instrumentId, symbol, price, source, markTimestamp, idempotencyKey, description } =
      parsed.data;

    const sqlite = getSqliteHandle();

    // 2. Pre-flight: verify account exists
    if (!accountExists(sqlite, accountId)) {
      return NextResponse.json(
        {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
        { status: 404 },
      );
    }

    // 3. Insert the validated valuation mark
    const insertResult = insertValidatedValuationMark(sqlite, {
      accountId,
      instrumentId,
      instrumentSymbol: symbol,
      price,
      source,
      markTimestamp,
      idempotencyKey: idempotencyKey ?? null,
    });

    if (!insertResult.inserted) {
      // Idempotency match — return 200 (idempotent success) rather than 201
      const instrument = findInstrumentById(sqlite, insertResult.mark.instrumentId);
      return NextResponse.json(
        {
          id: insertResult.rowId,
          accountId,
          instrumentId: insertResult.mark.instrumentId,
          symbol: instrument?.symbol ?? 'UNKNOWN',
          price: insertResult.mark.price,
          source: insertResult.mark.source,
          markTimestamp: insertResult.mark.markTimestamp,
          idempotencyKey: idempotencyKey ?? null,
          createdAt: new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    // 4. Resolve instrument symbol for the response
    const instrument = findInstrumentById(sqlite, insertResult.mark.instrumentId);

    return NextResponse.json(
      {
        id: insertResult.rowId,
        accountId,
        instrumentId: insertResult.mark.instrumentId,
        symbol: instrument?.symbol ?? 'UNKNOWN',
        price: insertResult.mark.price,
        source: insertResult.mark.source,
        markTimestamp: insertResult.mark.markTimestamp,
        idempotencyKey: idempotencyKey ?? null,
        description: description ?? null,
        createdAt: new Date().toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    // Map ValuationMarkError to appropriate HTTP responses
    if (error instanceof ValuationMarkError) {
      switch (error.code) {
        case 'unknown_account':
          return NextResponse.json(
            { error: 'Account not found', details: error.message },
            { status: 404 },
          );
        case 'unknown_instrument':
          return NextResponse.json(
            { error: 'Instrument not found', details: error.message },
            { status: 404 },
          );
        case 'invalid_price':
        case 'invalid_mark':
          return NextResponse.json(
            { error: 'Invalid mark', details: error.message },
            { status: 400 },
          );
        default:
          return NextResponse.json(
            { error: 'Invalid mark', details: error.message },
            { status: 400 },
          );
      }
    }

    // Unexpected errors fall through to 500
    return NextResponse.json(
      {
        error: 'Failed to post valuation mark',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// ── GET ─────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts/:id/valuations
 *
 * List valuation marks for an account, newest first.
 * Supports optional filtering by instrument, date range, and pagination.
 *
 * Query params:
 * - limit (number, default 50): max results
 * - offset (number, default 0): pagination offset
 * - instrumentId (UUID, optional): filter to a single instrument
 * - from (ISO datetime, optional): lower bound for mark_timestamp
 * - to (ISO datetime, optional): upper bound for mark_timestamp
 *
 * Responses:
 * - 200: Valuations array with total count
 * - 400: Invalid query parameters
 * - 500: Unexpected server error
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;

    // 1. Parse query params
    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsedQuery = listValuationMarksQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { limit, offset, instrumentId, from, to } = parsedQuery.data;
    const sqlite = getSqliteHandle();

    // 2. Fetch valuation marks from the repository
    const markRows = listAccountValuationMarks(sqlite, accountId, {
      limit,
      offset,
      instrumentId,
      fromDate: from,
      toDate: to,
    });
    const total = countAccountValuationMarks(sqlite, accountId);

    // 3. Resolve instrument symbols for the response
    const instrumentCache = new Map<string, { id: string; symbol: string }>();
    function resolveInstrument(instrId: string): { id: string; symbol: string } {
      const cached = instrumentCache.get(instrId);
      if (cached) return cached;
      const instrument = findInstrumentById(sqlite, instrId);
      if (instrument) {
        const entry = { id: instrument.id, symbol: instrument.symbol };
        instrumentCache.set(instrId, entry);
        return entry;
      }
      return { id: instrId, symbol: 'UNKNOWN' };
    }

    // 4. Transform to camelCase response shape
    const marks = markRows.map((row) => {
      const instr = resolveInstrument(row.instrument_id);
      return {
        id: row.id,
        accountId: row.account_id,
        instrumentId: row.instrument_id,
        symbol: instr.symbol,
        price: row.price,
        source: row.source,
        markTimestamp: row.mark_timestamp,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at,
      };
    });

    return NextResponse.json(
      {
        marks,
        total,
        limit,
        offset,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to list valuation marks',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
