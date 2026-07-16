/**
 * Reconciliation API Route
 *
 * GET /api/accounts/:id/reconciliation — compute a reconciliation report
 *   comparing legacy source data against rebuilt accounting projections.
 *
 * The report includes per-dimension comparisons (cash, execution count,
 * fees, price marks, positions, NAV), anomaly summaries, and a boolean
 * cutover eligibility result.
 *
 * @module reconciliation/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';
import {
  accountExists,
} from '@/db/accounting-repository';
import { computeReconciliation } from '@/lib/accounting/reconciliation';

type RouteParams = { params: Promise<{ id: string }> };

// ── GET ─────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts/:id/reconciliation
 *
 * Compute a reconciliation report for the account's latest completed
 * migration run.  Compares legacy source data (account_transactions,
 * trade_executions, position_price_snapshots) against rebuilt accounting
 * projections and classifies every difference.
 *
 * Responses:
 * - 200: Complete reconciliation report with comparisons, anomaly summaries,
 *        record status counts, and cutover eligibility
 * - 400: No completed migration runs exist for this account
 * - 404: Account not found
 * - 500: Unexpected server error
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;
    const sqlite = getSqliteHandle();

    // 1. Verify account exists
    if (!accountExists(sqlite, accountId)) {
      return NextResponse.json(
        {
          error: 'Account not found',
          details: `Account "${accountId}" not found`,
        },
        { status: 404 },
      );
    }

    // 2. Compute reconciliation
    const report = computeReconciliation(sqlite, accountId);

    if (!report) {
      return NextResponse.json(
        {
          error: 'No migration run found',
          details: `No completed migration runs exist for account "${accountId}". Run a migration first via POST /api/accounts/${accountId}/migration.`,
        },
        { status: 400 },
      );
    }

    // 3. Return the report
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to compute reconciliation report',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
