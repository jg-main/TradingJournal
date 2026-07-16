/**
 * Account Performance Projection API Route
 *
 * GET /api/accounts/:id/performance — read the current projection.
 * POST /api/accounts/:id/performance — trigger a rebuild of the projection.
 *
 * The GET endpoint returns the persisted single-row projection from the
 * account_performance table.  The POST endpoint triggers a deterministic
 * rebuild that reads posted ledger data, positions, and marks, computes
 * valuations and performance metrics through the T01 pure functions, and
 * persists the result.
 *
 * @module performance/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';
import {
  postPerformanceRebuildSchema,
} from '@/lib/performance/api-contracts';
import {
  rebuildAccountPerformance,
} from '@/lib/performance/performance-rebuild';
import {
  accountExists,
  findAccountPerformance,
  findInstrumentById,
} from '@/db/accounting-repository';

type RouteParams = { params: Promise<{ id: string }> };

// ── GET ─────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts/:id/performance
 *
 * Read the current account performance projection.
 * Returns the full projection including NAV, realized/unrealized P&L, fees,
 * exposure, TWR, high-water mark, drawdown, warnings, and valuation positions.
 *
 * Responses:
 * - 200: Performance projection (or empty projection if none exists)
 * - 404: Account not found
 * - 500: Unexpected server error
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    // 2. Read the current projection
    const projection = findAccountPerformance(sqlite, accountId);

    if (!projection) {
      // No projection yet — return an empty state
      return NextResponse.json(
        {
          accountId,
          computedAt: new Date().toISOString(),
          netCash: '0.00',
          nav: '0.00',
          markedPositions: '0.00',
          realizedPnl: '0.00',
          unrealizedPnl: '0.00',
          totalPnl: '0.00',
          realizedFees: '0.00',
          grossExposure: '0.00',
          netExposure: '0.00',
          modifiedDietzReturn: null,
          twr: null,
          highWaterMark: null,
          drawdown: null,
          drawdownPct: null,
          warnings: [],
          positions: [],
          rebuildCount: 0,
          lastRebuiltAt: null,
        },
        { status: 200 },
      );
    }

    // 3. Parse warnings and positions JSON
    let warnings: string[] = [];
    try {
      warnings = JSON.parse(projection.warnings);
    } catch {
      warnings = [];
    }

    let rawPositions: unknown[] = [];
    try {
      rawPositions = JSON.parse(projection.positions_json);
    } catch {
      rawPositions = [];
    }

    // 4. Resolve instrument symbols for positions
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

    // 5. Build response
    const positions = rawPositions.map((pos: unknown) => {
      const vp = pos as Record<string, unknown>;
      const instr = resolveInstrument(vp.instrumentId as string);
      return {
        instrumentId: vp.instrumentId as string,
        symbol: instr.symbol,
        direction: vp.direction as string | null,
        quantity: vp.quantity as string,
        averageCost: vp.averageCost as string,
        totalCostBasis: vp.totalCostBasis as string,
        realizedPnl: vp.realizedPnl as string,
        realizedFees: vp.realizedFees as string,
        realizedNetPnl: vp.realizedNetPnl as string,
        markPrice: vp.markPrice as string | null,
        markStatus: vp.markStatus as string,
        markedValue: vp.markedValue as string | null,
        unrealizedPnl: vp.unrealizedPnl as string | null,
        markTimestamp: vp.markTimestamp as string | null,
        markSource: vp.markSource as string | null,
        markAgeMinutes: vp.markAgeMinutes as number | null,
      };
    });

    return NextResponse.json(
      {
        accountId: projection.account_id,
        computedAt: projection.computed_as_of,
        netCash: projection.net_cash,
        nav: projection.nav,
        markedPositions: projection.marked_positions,
        realizedPnl: projection.realized_pnl,
        unrealizedPnl: projection.unrealized_pnl,
        totalPnl: projection.total_pnl,
        realizedFees: projection.realized_fees,
        grossExposure: projection.gross_exposure,
        netExposure: projection.net_exposure,
        modifiedDietzReturn: projection.modified_dietz_return,
        twr: projection.twr,
        highWaterMark: projection.high_water_mark,
        drawdown: projection.drawdown,
        drawdownPct: projection.drawdown_pct,
        warnings,
        positions,
        rebuildCount: projection.rebuild_count,
        lastRebuiltAt: projection.last_rebuilt_at,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to read performance projection',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// ── POST ────────────────────────────────────────────────────────────────

/**
 * POST /api/accounts/:id/performance
 *
 * Trigger a deterministic rebuild of the account performance projection.
 * Reads the current state of the ledger, positions, and marks, computes
 * valuations and performance metrics, and persists the projection.
 *
 * Request body (optional):
 * - freshnessThresholdMinutes (number, default 1440): max age of a fresh mark
 * - includePerformance (boolean, default true): compute performance metrics
 *
 * Responses:
 * - 200: Rebuild completed successfully
 * - 404: Account not found
 * - 500: Rebuild failed
 */
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

    // 2. Parse optional request body
    let freshnessThresholdMinutes: number | undefined;
    let includePerformance: boolean | undefined;

    if (request.body) {
      try {
        const body = await request.json();
        const parsed = postPerformanceRebuildSchema.safeParse(body);
        if (parsed.success) {
          freshnessThresholdMinutes = parsed.data.freshnessThresholdMinutes;
          includePerformance = parsed.data.includePerformance;
        }
      } catch {
        // Empty body or non-JSON body is fine — use defaults
      }
    }

    // 3. Run the rebuild
    const result = rebuildAccountPerformance(sqlite, accountId, {
      freshnessThresholdMinutes,
      includePerformance,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Performance rebuild failed',
          details: result.error ?? 'Unknown rebuild error',
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        accountId: result.accountId,
        success: result.success,
        rebuildCount: result.rebuildCount,
        computedAt: result.computedAt,
        positionCount: result.positionCount,
        markCount: result.markCount,
        nav: result.nav,
        warnings: result.warnings,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to rebuild performance projection',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
