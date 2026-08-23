/**
 * Financial Events API Route
 *
 * POST /api/accounts/:id/financial-events — post a financial event of any
 *   supported type (deposit, withdrawal, dividend, interest, fee, tax,
 *   stock_split, manual_adjustment, opening_balance) that atomically creates
 *   a balanced double-entry ledger posting.
 *
 * GET /api/accounts/:id/financial-events — list financial events for an
 *   account in deterministic posted_at/id order, with posting status.
 *
 * Validates the request body with Zod, resolves the target account,
 * delegates to the event-posting service or repository, and maps domain
 * errors to the project's existing JSON error conventions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSqliteHandle } from '@/db';
import { postEventWithEffect } from '@/lib/accounting/event-posting';
import { rebuildAccountPerformance } from '@/lib/performance/performance-rebuild';
import { postFinancialEventSchema } from '@/lib/accounting/api-contracts';
import { listAccountEvents, countAccountEvents } from '@/db/accounting-repository';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  AccountNotFoundError,
  DuplicateIdempotencyKeyError,
  UnsupportedAccountCurrencyError,
} from '@/lib/accounting/errors';

type RouteParams = { params: Promise<{ id: string }> };

// ── Query parameter schema for GET ──────────────────────────────────────

const listEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── POST ────────────────────────────────────────────────────────────────

/**
 * POST /api/accounts/:id/financial-events
 *
 * Post a financial event of any supported type with atomic double-entry
 * posting and event-specific payload/effect metadata.
 *
 * Request body depends on eventType — see postFinancialEventSchema docs.
 *
 * Responses:
 * - 201: Event, ledger entry, and balanced postings created
 * - 400: Validation failure (malformed body, invalid amount, unsupported type)
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

    const parsed = postFinancialEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const eventRequest = parsed.data;

    // 2. Opening balances are an initialization-only event (A2). The generic
    //    financial-event route must not create or duplicate an opening
    //    balance — that would leave a funded-but-inactive account (event
    //    without activation) or a second opening balance on an active one.
    //    The initialization boundary lives in POST /api/accounts/:id/initialize,
    //    which posts the opening balance AND activates the account in one
    //    authoritative server-side transaction.
    if (eventRequest.eventType === 'opening_balance') {
      return NextResponse.json(
        {
          error: 'Opening balance must be recorded through account initialization',
          details:
            'POST /api/accounts/:id/initialize with { mode: "opening_balance", amount } — ' +
            'the generic financial-event route cannot create or duplicate an opening balance.',
        },
        { status: 409 },
      );
    }

    // 3. Get the raw SQLite handle for transactional posting
    const sqlite = getSqliteHandle();

    // 3. Post the event through the event-posting service
    const result = postEventWithEffect(sqlite, accountId, eventRequest);

    // Keep the persisted NAV projection read-your-writes consistent with the
    // immutable event and its cash effect.
    rebuildAccountPerformance(sqlite, accountId);

    // 4. Transform domain records to JSON response shape
    return NextResponse.json(
      {
        event: {
          id: result.event.id,
          accountId: result.event.accountId,
          eventType: result.event.eventType,
          idempotencyKey: result.event.idempotencyKey,
          description: result.event.description,
          payload: result.event.payload,
          effect: result.event.effect,
          postedAt: result.event.postedAt,
          createdAt: result.event.createdAt,
        },
        entry: {
          id: result.entry.id,
          financialEventId: result.entry.financialEventId,
          accountId: result.entry.accountId,
          description: result.entry.description,
          postedAt: result.entry.postedAt,
          createdAt: result.entry.createdAt,
        },
        postings: {
          debit: {
            id: result.postings.debit.id,
            ledgerEntryId: result.postings.debit.ledgerEntryId,
            accountId: result.postings.debit.accountId,
            side: result.postings.debit.side,
            amount: result.postings.debit.amount,
            amountMicros: result.postings.debit.amountMicros,
            currency: result.postings.debit.currency,
            sequence: result.postings.debit.sequence,
            createdAt: result.postings.debit.createdAt,
          },
          credit: {
            id: result.postings.credit.id,
            ledgerEntryId: result.postings.credit.ledgerEntryId,
            accountId: result.postings.credit.accountId,
            side: result.postings.credit.side,
            amount: result.postings.credit.amount,
            amountMicros: result.postings.credit.amountMicros,
            currency: result.postings.credit.currency,
            sequence: result.postings.credit.sequence,
            createdAt: result.postings.credit.createdAt,
          },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    // 5. Map domain errors to HTTP error responses
    if (error instanceof InvalidAmountError || error instanceof InvalidMicrosBoundsError) {
      return NextResponse.json(
        {
          error: 'Invalid amount',
          details: error.message,
        },
        { status: 400 },
      );
    }

    if (error instanceof AccountNotFoundError) {
      return NextResponse.json(
        {
          error: 'Account not found',
          details: error.message,
        },
        { status: 404 },
      );
    }

    if (error instanceof UnsupportedAccountCurrencyError) {
      return NextResponse.json(
        {
          error: error.message,
          details: {
            accountId: error.accountId,
            currency: error.currency,
          },
        },
        { status: 400 },
      );
    }

    if (error instanceof DuplicateIdempotencyKeyError) {
      return NextResponse.json(
        {
          error: 'Duplicate idempotency key',
          details: error.message,
        },
        { status: 409 },
      );
    }

    // 6. Unexpected errors
    return NextResponse.json(
      {
        error: 'Failed to post financial event',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// ── GET ─────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts/:id/financial-events
 *
 * List financial events for an account in deterministic posted_at/id order
 * with their posting status (hasEntry, isBalanced, postingCount).
 *
 * Query params:
 * - limit (default 100, max 200): maximum events to return
 * - offset (default 0): number of events to skip
 *
 * Responses:
 * - 200: Events array with total count
 * - 400: Invalid query parameters
 * - 500: Unexpected server error
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;

    // 1. Parse query params
    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsedQuery = listEventsQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { limit, offset } = parsedQuery.data;

    // 2. Get the raw SQLite handle
    const sqlite = getSqliteHandle();

    // 3. Fetch events from the repository
    const eventRows = listAccountEvents(sqlite, accountId, { limit, offset });
    const total = countAccountEvents(sqlite, accountId);

    // 4. Transform to camelCase response shape
    const events = eventRows.map((row) => ({
      event: {
        id: row.id,
        accountId: row.account_id,
        eventType: row.event_type,
        idempotencyKey: row.idempotency_key,
        description: row.description,
        payload: row.payload,
        effect: row.effect,
        postedAt: row.posted_at,
        createdAt: row.created_at,
      },
      entry: row.entry_id
        ? {
            id: row.entry_id,
            financialEventId: row.id,
            accountId: row.account_id,
            description: row.description,
            postedAt: row.posted_at,
            createdAt: row.created_at,
          }
        : null,
      postings: null,
      status: {
        hasEntry: row.entry_id !== null,
        isBalanced: row.is_balanced === 1,
        postingCount: row.posting_count,
      },
    }));

    return NextResponse.json(
      {
        events,
        total,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to list financial events',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
