/**
 * Migration API Route
 *
 * POST /api/accounts/:id/migration — trigger a full legacy-to-accounting
 * migration for an account.  Reads account_transactions, trade_executions,
 * and position_price_snapshots, maps them into the immutable accounting
 * boundary, and rebuilds all projections.
 *
 * The endpoint returns structured migration run results including record
 * counts, anomaly summaries, and a deterministic rebuild fingerprint.
 * Re-running the same data is safe (idempotent) — previously imported
 * records are detected and skipped.
 *
 * Responses:
 * - 200: Migration completed successfully with full run report
 * - 400: Dry-run mode or account validation error
 * - 404: Account not found
 * - 500: Unexpected server error
 *
 * @module migration/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';
import { accountExists } from '@/db/accounting-repository';
import { runLegacyMigration } from '@/lib/accounting/legacy-migration-runner';

type RouteParams = { params: Promise<{ id: string }> };

// ── POST ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // 2. Parse optional body parameters
    let dryRun = false;
    try {
      const body = await request.json();
      if (body && typeof body.dryRun === 'boolean') {
        dryRun = body.dryRun;
      }
    } catch {
      // No body or invalid JSON — proceed with defaults
    }

    // 3. Run migration
    const result = runLegacyMigration(
      { sqlite, accountId },
      { dryRun },
    );

    if (result.status === 'failed') {
      return NextResponse.json(
        {
          error: 'Migration failed',
          details: result.errorMessage,
        },
        { status: 500 },
      );
    }

    // 4. Return the migration result
    return NextResponse.json(
      {
        runId: result.runId,
        accountId: result.accountId,
        status: result.status,
        totalRecords: result.totalRecords,
        mappedCount: result.mappedCount,
        anomalyCount: result.anomalyCount,
        unsupportedCount: result.unsupportedCount,
        duplicateCount: result.duplicateCount,
        rebuildFingerprint: result.rebuildFingerprint,
        errorMessage: result.errorMessage,
        dryRun,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Migration failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
