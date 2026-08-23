/**
 * Account Initialization API Route (A2)
 *
 * POST /api/accounts/:id/initialize — complete new-account initialization as
 * ONE authoritative server-side operation:
 *
 *   mode 'opening_balance': posts the immutable opening_balance financial
 *     event (event + ledger entry + balanced postings) and activates the
 *     account in a single transaction. Returns 201 only when the initialized
 *     state is coherent (active account with its opening balance).
 *   mode 'zero': activates the account with a zero balance; no financial
 *     event is fabricated.
 *
 * Eligibility: pristine new drafts only (inactive, no financial events, no
 * executions, no positions, no trades). Second initialization attempts are
 * rejected with 409 Account already initialized — the opening balance can
 * never be initialized twice, and deactivated historical accounts are never
 * accidentally reactivated through this path.
 *
 * The generic financial-event route rejects eventType 'opening_balance'
 * (409), so the normal UI cannot bypass initialization semantics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle, db } from '@/db';
import { accounts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { initializeAccountRequestSchema } from '@/lib/accounting/api-contracts';
import { initializeAccount, toInitializationEventRecord } from '@/lib/accounting/account-initialization';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  AccountNotFoundError,
  AccountAlreadyInitializedError,
  DuplicateIdempotencyKeyError,
  UnsupportedAccountCurrencyError,
  AccountInitializationProjectionError,
} from '@/lib/accounting/errors';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/accounts/:id/initialize
 *
 * Request body:
 *   { mode: 'opening_balance', amount, description?, postedAt?, idempotencyKey? }
 *   { mode: 'zero' }
 *
 * Responses:
 * - 201: Account initialized (active; opening_balance event when requested)
 * - 400: Validation failure, invalid amount, or unsupported account currency
 * - 404: Account not found
 * - 409: Account already initialized, or duplicate idempotency key
 * - 500: Unexpected server error
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;

    // 1. Parse and validate request body.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const parsed = initializeAccountRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const requestData = parsed.data;

    // 2. Raw SQLite handle for the transactional initialization service.
    const sqlite = getSqliteHandle();

    // 3. Run the initialization transaction (posting + activation +
    //    performance projection, all-or-nothing). The service rebuilds the
    //    projection INSIDE the transaction and enforces its success, so a
    //    201 here guarantees the account is active AND its projection
    //    (NAV/Cash) was persisted coherently. No post-commit rebuild is
    //    needed — exactly one required rebuild per successful initialization.
    const result = initializeAccount(sqlite, {
      accountId,
      mode: requestData.mode,
      amount: requestData.mode === 'opening_balance' ? requestData.amount : undefined,
      idempotencyKey: requestData.mode === 'opening_balance' ? requestData.idempotencyKey : undefined,
      description: requestData.mode === 'opening_balance' ? requestData.description : undefined,
      postedAt: requestData.mode === 'opening_balance' ? requestData.postedAt : undefined,
    });

    // 4. Read the authoritative account row (drizzle, boolean-mapped).
    const accountRow = db.select().from(accounts).where(eq(accounts.id, accountId)).get();

    // 5. Coherent initialized response. The performance summary proves the
    //    projection succeeded; NAV is the canonical post-initialization value.
    return NextResponse.json(
      {
        account: accountRow ?? null,
        performance: {
          success: true,
          nav: result.performance.nav,
          rebuildCount: result.performance.rebuildCount,
        },
        ...toInitializationEventRecord(result.openingBalance),
      },
      { status: 201 },
    );
  } catch (error) {
    // 6. Map domain errors to HTTP error responses.
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

    if (error instanceof AccountAlreadyInitializedError) {
      return NextResponse.json(
        {
          error: 'Account already initialized',
          details: error.message,
        },
        { status: 409 },
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

    // Projection persistence failure: an unexpected server-side initialization
    // failure — never 409 (that is a lifecycle conflict). The transaction has
    // already rolled back, so the request is safely retryable.
    if (error instanceof AccountInitializationProjectionError) {
      return NextResponse.json(
        {
          error: 'Failed to initialize account',
          details: error.message,
        },
        { status: 500 },
      );
    }

    // 7. Unexpected errors.
    return NextResponse.json(
      {
        error: 'Failed to initialize account',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
