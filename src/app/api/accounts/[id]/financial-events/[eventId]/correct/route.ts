/**
 * Financial Event Correction API Route
 *
 * POST /api/accounts/:id/financial-events/:eventId/correct — correct a
 *   posted financial event through the immutable reversal-and-replacement
 *   pattern.
 *
 * The original event is never modified. A reversal financial event cancels
 * the original's cash effect (same event type, opposite direction) and a
 * replacement financial event carries the corrected values. Both are
 * posted with balanced ledger effects. A financial_event_correction_lineage
 * record links all three with the required correction reason. The account
 * performance/NAV projection is rebuilt after the correction.
 *
 * Validates the request body with Zod, resolves the target account and
 * original event, performs pre-flight validation (not already corrected,
 * not a reversal/replacement, no duplicate idempotency key), delegates to
 * the correction service, and maps domain errors to the project's existing
 * JSON error conventions.
 *
 * Responses:
 * - 200: Successful correction with lineage and the three linked events
 * - 400: Invalid JSON body, Zod validation failure, or invalid amount
 * - 404: Account or original event not found
 * - 409: Already-corrected event, or duplicate correction idempotency key
 * - 422: Event type not eligible for correction
 * - 500: Unexpected server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';
import { correctFinancialEvent } from '@/lib/accounting/financial-event-correction';
import { financialEventCorrectionInputSchema } from '@/lib/accounting/api-contracts';
import { accountExists, findEventById } from '@/db/accounting-repository';
import {
  AccountNotFoundError,
  FinancialEventNotFoundError,
  EventAlreadyCorrectedError,
  EventNotCorrectableError,
  DuplicateCorrectionIdempotencyError,
  InvalidAmountError,
  InvalidMicrosBoundsError,
} from '@/lib/accounting/errors';

type RouteParams = { params: Promise<{ id: string; eventId: string }> };

// ── POST ────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId, eventId } = await params;

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

    const parsed = financialEventCorrectionInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const {
      amount,
      description,
      reason,
      idempotencyKey,
      postedAt,
    } = parsed.data;

    const sqlite = getSqliteHandle();

    // 2. Pre-flight account existence check
    if (!accountExists(sqlite, accountId)) {
      return NextResponse.json(
        {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
        { status: 404 },
      );
    }

    // 3. Pre-flight original event exists
    const originalEvent = findEventById(sqlite, eventId);
    if (!originalEvent) {
      return NextResponse.json(
        {
          error: 'Financial event not found',
          details: `Financial event "${eventId}" not found`,
        },
        { status: 404 },
      );
    }

    if (originalEvent.account_id !== accountId) {
      return NextResponse.json(
        {
          error: 'Financial event not found',
          details: `Financial event "${eventId}" does not belong to account "${accountId}"`,
        },
        { status: 404 },
      );
    }

    // 4. Delegate to the correction service
    const result = correctFinancialEvent(sqlite, {
      accountId,
      originalEventId: eventId,
      amount,
      description,
      reason,
      idempotencyKey,
      postedAt,
    });

    // 5. Build the response
    return NextResponse.json(
      {
        success: true,
        correction: result.correction,
        originalEvent: result.originalEvent,
        reversalEvent: result.reversalEvent,
        replacementEvent: result.replacementEvent,
      },
      { status: 200 },
    );
  } catch (error) {
    // Map domain errors to HTTP error responses
    if (error instanceof EventAlreadyCorrectedError) {
      return NextResponse.json(
        {
          error: 'Financial event already corrected',
          code: error.code,
          details: error.message,
        },
        { status: 409 },
      );
    }

    if (error instanceof DuplicateCorrectionIdempotencyError) {
      return NextResponse.json(
        {
          error: 'Duplicate correction idempotency key',
          code: error.code,
          details: error.message,
        },
        { status: 409 },
      );
    }

    if (error instanceof EventNotCorrectableError) {
      return NextResponse.json(
        {
          error: 'Financial event not correctable',
          code: error.code,
          details: error.message,
        },
        { status: 422 },
      );
    }

    if (error instanceof InvalidAmountError || error instanceof InvalidMicrosBoundsError) {
      return NextResponse.json(
        {
          error: 'Invalid amount',
          details: error.message,
        },
        { status: 400 },
      );
    }

    if (error instanceof FinancialEventNotFoundError || error instanceof AccountNotFoundError) {
      return NextResponse.json(
        {
          error: 'Account or financial event not found',
          details: error.message,
        },
        { status: 404 },
      );
    }

    // Unexpected errors fall through to 500
    return NextResponse.json(
      {
        error: 'Failed to correct financial event',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
