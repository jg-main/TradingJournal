/**
 * Ledger API Route
 *
 * GET /api/accounts/:id/ledger — list financial events for an account as
 *   a unified ledger workspace with correction-group deduplication, category
 *   filtering, pagination, posting pairs, and cash impact.
 *
 * Composes the T01 pure ledger projection adapter from the financial-event,
 * ledger-entry, ledger-posting, and correction-lineage repositories. The
 * correction-lineage execution IDs are resolved to financial event IDs before
 * being passed to the adapter.
 *
 * Preserves idempotency keys and correction-group constituent IDs for audit
 * inspection without exposing secrets.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSqliteHandle } from '@/db';
import { listAccountEvents, accountExists, findPostingsByEntryId } from '@/db/accounting-repository';
import { buildLedgerProjection } from '@/lib/accounting/ledger';
import type { LedgerEventInput, LedgerEntryInput, LedgerPostingInput } from '@/lib/accounting/ledger';
import { resolveCorrectionGroupsForAccount } from '@/lib/accounting/ledger-route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

// ── Query parameter schema ──────────────────────────────────────────────

const ledgerQuerySchema = z.object({
  /** Comma-separated list of event types to filter (e.g. "trade_execution,deposit"). */
  eventTypes: z.string().optional(),
  /** 1-indexed page number. Default 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Maximum rows per page. Default 50, max 200. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── GET ─────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts/:id/ledger
 *
 * List financial events for an account as a unified ledger workspace.
 * Returns a paginated, category-filtered list with posting pairs,
 * cash impact, status, and grouped correction display.
 *
 * Query params:
 * - eventTypes (optional): comma-separated event type filter
 *   (e.g. "trade_execution,deposit,dividend")
 * - page (default 1): 1-indexed page number
 * - limit (default 50, max 200): rows per page
 *
 * Responses:
 * - 200: Paginated ledger projection with events, total, page metadata
 * - 400: Invalid query parameters
 * - 404: Account not found
 * - 500: Unexpected server error
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;

    // 1. Parse query params
    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsedQuery = ledgerQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { page, limit } = parsedQuery.data;

    // Parse eventTypes from comma-separated string
    const eventTypes: string[] = parsedQuery.data.eventTypes
      ? parsedQuery.data.eventTypes.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    // 2. Get the raw SQLite handle
    const sqlite = getSqliteHandle();

    // 3. Check account exists
    if (!accountExists(sqlite, accountId)) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 },
      );
    }

    // 4. Fetch financial events with entry status
    //    We fetch all events for the account (no pagination at DB level)
    //    because we need the full set for correction-group deduplication.
    //    Pagination is applied by the adapter.
    const eventRows = listAccountEvents(sqlite, accountId);

    // 5. Collect all entries and postings
    //    Events that have no ledger entry (entry_id is null) still appear
    //    in the projection with hasEntry=false and postings=null.
    const entries: LedgerEntryInput[] = [];
    const postings: LedgerPostingInput[] = [];

    for (const row of eventRows) {
      if (row.entry_id) {
        const existingEntry = entries.find((e) => e.id === row.entry_id);
        if (!existingEntry) {
          entries.push({
            id: row.entry_id as string,
            financial_event_id: row.id,
            account_id: row.account_id,
            description: row.description,
            posted_at: row.posted_at,
            created_at: row.created_at,
          });
        }

        // Fetch postings for this entry
        const postingRows = findPostingsByEntryId(sqlite, row.entry_id as string);
        for (const pr of postingRows) {
          const exists = postings.some((p) => p.id === pr.id);
          if (!exists) {
            postings.push({
              id: pr.id,
              ledger_entry_id: pr.ledger_entry_id,
              account_id: pr.account_id,
              side: pr.side,
              amount: pr.amount,
              amount_micros: pr.amount_micros,
              currency: pr.currency,
              sequence: pr.sequence,
              created_at: pr.created_at,
            });
          }
        }
      }
    }

    // 6. Convert events to adapter format
    const events: LedgerEventInput[] = eventRows.map((row) => ({
      id: row.id,
      account_id: row.account_id,
      event_type: row.event_type,
      idempotency_key: row.idempotency_key,
      description: row.description,
      payload: row.payload,
      effect: row.effect,
      posted_at: row.posted_at,
      created_at: row.created_at,
    }));

    // 7. Resolve correction groups from execution IDs to event IDs
    const correctionGroups = resolveCorrectionGroupsForAccount(sqlite, accountId);

    // 8. Build the ledger projection
    const ledgerResponse = buildLedgerProjection(
      { events, entries, postings, correctionGroups },
      { eventTypes: eventTypes.length > 0 ? eventTypes : undefined, page, limit },
    );

    return NextResponse.json(ledgerResponse, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch account ledger',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
