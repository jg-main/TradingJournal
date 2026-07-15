/**
 * Financial Events API Route
 *
 * POST /api/accounts/:id/financial-events — post a financial event
 * (currently only opening_balance) that atomically creates a balanced
 * double-entry ledger posting.
 *
 * Validates the request body with Zod, resolves the target account,
 * delegates to the posting kernel, and maps domain errors to the
 * project's existing JSON error conventions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSqliteHandle } from '@/db';
import { postOpeningBalance } from '@/lib/accounting/posting';
import { postFinancialEventSchema } from '@/lib/accounting/api-contracts';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  AccountNotFoundError,
  DuplicateIdempotencyKeyError,
} from '@/lib/accounting/errors';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/accounts/:id/financial-events
 *
 * Post an opening balance financial event with atomic double-entry posting.
 *
 * Request body:
 * ```json
 * {
 *   "eventType": "opening_balance",
 *   "amount": "5000.00",
 *   "idempotencyKey": "uuid-here" (optional),
 *   "description": "Initial deposit" (optional)
 * }
 * ```
 *
 * Responses:
 * - 201: Event, ledger entry, and balanced postings created
 * - 400: Validation failure (malformed body, invalid amount)
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

    const { amount, idempotencyKey, description } = parsed.data;

    // 2. Get the raw SQLite handle for transactional posting
    const sqlite = getSqliteHandle();

    // 3. Post the opening balance through the kernel
    const result = postOpeningBalance(sqlite, {
      accountId,
      amount,
      idempotencyKey,
      description,
    });

    // 4. Transform domain records to JSON response shape
    return NextResponse.json(
      {
        event: {
          id: result.event.id,
          accountId: result.event.accountId,
          eventType: result.event.eventType,
          idempotencyKey: result.event.idempotencyKey,
          description: result.event.description,
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
