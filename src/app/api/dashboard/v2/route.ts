/**
 * Dashboard V2 API Route
 *
 * GET /api/dashboard/v2 — ledger-derived dashboard aggregation for one
 *   account, including cutover integrity state, valuation completeness,
 *   journal attribution, and reconciliation eligibility.
 *
 * Uses the S04 performance projection and S05 reconciliation report
 * underneath the S04/S05 cutover gate, with no legacy P&L fallback.
 *
 * @module dashboard/v2/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSqliteHandle } from '@/db';
import { ALL_DASHBOARD_V2_FIELDS, computeDashboardV2 } from '@/lib/accounting/dashboard-v2';
import type { DashboardV2Field } from '@/lib/accounting/dashboard-v2';
import { accountExists } from '@/db/accounting-repository';

// ── Query Schema ────────────────────────────────────────────────────────

const FIELD_NAMES = ALL_DASHBOARD_V2_FIELDS as unknown as [string, ...string[]];

const dashboardV2QuerySchema = z.object({
  accountId: z.string().uuid('Account ID must be a valid UUID').optional(),
  freshnessThresholdMinutes: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(
      z
        .number()
        .int()
        .positive('Freshness threshold must be a positive integer')
        .optional(),
    ),
  fields: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const parts = val.split(',').map((f) => f.trim()).filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    })
    .pipe(
      z
        .array(z.enum(FIELD_NAMES))
        .optional(),
    ),
});

// ── Account Resolution ──────────────────────────────────────────────────

/**
 * Resolve the target account ID from the request query parameters,
 * falling back to settings.defaultAccountId, then the first active account.
 *
 * Returns the account ID or null if no account can be resolved.
 */
function resolveAccountId(sqlite: ReturnType<typeof getSqliteHandle>): string | undefined {
  // Try settings.defaultAccountId
  const setting = sqlite
    .prepare('SELECT default_account_id FROM settings LIMIT 1')
    .get() as { default_account_id: string | null } | undefined;

  if (setting?.default_account_id) {
    return setting.default_account_id;
  }

  // Fall back to first active account whose base currency is supported
  // (USD-only contract). A legacy non-USD account is never auto-selected as
  // the effective account for current-state workflows; it remains readable
  // only when explicitly requested via accountId.
  const firstActive = sqlite
    .prepare(
      "SELECT id FROM accounts WHERE is_active = 1 AND currency = 'USD' ORDER BY created_at ASC LIMIT 1",
    )
    .get() as { id: string } | undefined;

  return firstActive?.id ?? undefined;
}

// ── GET ─────────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/v2
 *
 * Return one timestamped, typed current-state snapshot for one account.
 * The snapshot carries a deterministic snapshotId, scope metadata declaring
 * what each section represents, per-position attribution and mark
 * provenance, completeness state for price-derived aggregates, risk
 * state with stop coverage, and journal-linked per-trade metrics with a
 * dashboard-vs-Trades reconciliation section. Unknown values are null,
 * never '0.00'.
 * The envelope fields (snapshotId, scopes, computedAt) are always present.
 *
 * Query parameters:
 * - accountId (UUID, optional): target account.  Falls back to
 *   settings.defaultAccountId, then the first active account.
 * - freshnessThresholdMinutes (number, optional): max age in minutes
 *   for a fresh valuation mark (default 1440 = 24h).
 * - fields (comma-separated, optional): subset of sections to return.
 *   Valid values: account, metrics, valuation, journalAttribution,
 *   journalLinked, reconciliation, riskSummary, integrity. When omitted,
 *   the full response is returned (backward compatible).
 *
 * Responses:
 * - 200: Dashboard V2 current-state snapshot (see DashboardV2Response)
 * - 400: No account resolved, invalid query params, or account not found
 * - 500: Unexpected server error
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Parse query parameters
    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsedQuery = dashboardV2QuerySchema.safeParse(queryParams);

    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const sqlite = getSqliteHandle();

    // 2. Resolve account ID
    let accountId = parsedQuery.data.accountId;
    if (!accountId) {
      accountId = resolveAccountId(sqlite);
    }

    if (!accountId) {
      return NextResponse.json(
        {
          error: 'No account found',
          details:
            'No account specified and no default account or active account found. Create an account first.',
        },
        { status: 400 },
      );
    }

    if (!accountExists(sqlite, accountId)) {
      return NextResponse.json(
        {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
        { status: 400 },
      );
    }

    // 3. Compute the Dashboard V2 aggregation
    const dashboard = computeDashboardV2(sqlite, accountId, {
      freshnessThresholdMinutes: parsedQuery.data.freshnessThresholdMinutes,
      fields: parsedQuery.data.fields as DashboardV2Field[] | undefined,
    });

    if (!dashboard) {
      return NextResponse.json(
        {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
        { status: 404 },
      );
    }

    // 4. Return the result
    return NextResponse.json(dashboard, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to compute dashboard V2',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
