/**
 * Account Positions API Route
 *
 * GET /api/accounts/:id/positions — list current positions for an account
 *   with open FIFO lots, realized P&L, fees, and instrument symbols.
 *
 * Uses the persisted account_positions/fifo_lots projection (rebuild on
 * every execution POST) so responses are fast read-only queries against
 * the pre-computed projection rows.
 *
 * Validates query parameters with Zod and maps errors to the project's
 * existing JSON error conventions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';
import { listPositionsQuerySchema } from '@/lib/accounting/execution-contracts';
import {
  listAccountPositions,
  findAccountPosition,
  findFifoLotsByAccountInstrument,
  findInstrumentById,
  listLatestValuationMarks,
} from '@/db/accounting-repository';
import { mapPositionRow } from '@/lib/account-detail';
import type { PositionRowInput } from '@/lib/account-detail';

import {
  InvalidAmountError,
} from '@/lib/accounting/errors';

type RouteParams = { params: Promise<{ id: string }> };

// ── Row type helpers ──────────────────────────────────────────────────────

/** Raw row shape from listAccountPositions. */
interface PositionRow {
  id: string;
  account_id: string;
  instrument_id: string;
  direction: string | null;
  quantity: string;
  average_cost: string;
  total_cost_basis: string;
  realized_gross_pnl: string;
  realized_fees: string;
  realized_net_pnl: string;
  last_updated: string;
  created_at: string;
}

/** Raw row shape from findFifoLotsByAccountInstrument. */
interface FifoLotRow {
  id: string;
  instrument_id: string;
  direction: string;
  remaining_quantity: string;
  original_quantity: string;
  entry_price: string;
  cost_basis_total: string;
  allocated_fees: string;
  opening_execution_id: string;
  opened_at: string;
}

// ── GET ─────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts/:id/positions
 *
 * List current positions with open FIFO lots and instrument metadata.
 * Returns an empty array when no positions exist for the account.
 *
 * Query params:
 * - instrumentId (UUID, optional): filter to a single instrument
 * - direction (string, optional): filter by direction ("long" | "short")
 *
 * Responses:
 * - 200: Positions array with total count
 * - 400: Invalid query parameters
 * - 500: Unexpected server error
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;

    // 1. Parse query params
    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsedQuery = listPositionsQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { instrumentId, direction } = parsedQuery.data;
    const sqlite = getSqliteHandle();

    // 2a. Fetch latest valuation marks for mark enrichment
    const valuationMarks = listLatestValuationMarks(sqlite, accountId);
    const markMap = new Map<string, { price: string; timestamp: string; markAgeMinutes: number | null }>();
    for (const mark of valuationMarks) {
      const markAgeMinutes = Math.floor(
        (Date.now() - new Date(mark.mark_timestamp).getTime()) / 60000,
      );
      markMap.set(mark.instrument_id, {
        price: mark.price,
        timestamp: mark.mark_timestamp,
        markAgeMinutes,
      });
    }

    // 2. Instrument cache for symbol resolution
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

    // 3. Fetch positions
    let positionRows: PositionRow[];

    if (instrumentId) {
      // Single position lookup
      const row = findAccountPosition(sqlite, accountId, instrumentId);
      positionRows = row ? [row as unknown as PositionRow] : [];
    } else {
      // All positions for the account
      positionRows = listAccountPositions(sqlite, accountId) as unknown as PositionRow[];
    }

    // 4. Build responses with open FIFO lots
    const positions = positionRows
      .filter((row) => {
        // This endpoint is the Current Positions feed: realized rows belong
        // in performance/history, never alongside open holdings.
        if (row.quantity === '0.00' || row.direction === null) return false;
        if (direction && row.direction !== direction) return false;
        return true;
      })
      .map((row) => {
        // Fetch open FIFO lots for this position
        const lotRows = findFifoLotsByAccountInstrument(
          sqlite,
          row.account_id,
          row.instrument_id,
        ) as unknown as FifoLotRow[];

        const instrumentInfo = resolveInstrument(row.instrument_id);

        // Build valuation-enriched position using pure mapping contract
        const markData = markMap.get(row.instrument_id);
        const positionRowInput: PositionRowInput = {
          symbol: instrumentInfo.symbol,
          direction: row.direction,
          quantity: row.quantity,
          averageCost: row.average_cost,
          totalCostBasis: row.total_cost_basis,
          realizedGrossPnl: row.realized_gross_pnl,
          realizedNetPnl: row.realized_net_pnl,
          markTimestamp: markData?.timestamp ?? null,
          markPrice: markData?.price ?? null,
          markAgeMinutes: markData?.markAgeMinutes ?? null,
        };
        const enriched = mapPositionRow(positionRowInput);

        return {
          accountId: row.account_id,
          instrumentId: row.instrument_id,
          symbol: enriched.symbol,
          direction: enriched.direction,
          quantity: enriched.quantity,
          averageCost: enriched.averageCost,
          totalCostBasis: enriched.totalCostBasis,
          // Valuation mark fields (null when no mark exists)
          markStatus: enriched.markStatus,
          markPrice: enriched.markPrice,
          markedValue: enriched.markedValue,
          unrealizedPnl: enriched.unrealizedPnl,
          // Realized P&L
          realizedGrossPnl: enriched.realizedGrossPnl,
          realizedFees: row.realized_fees,
          realizedNetPnl: enriched.realizedNetPnl,
          lastUpdated: row.last_updated,
          openLots: lotRows
            .filter((lot) => lot.remaining_quantity !== '0.00')
            .map((lot) => ({
              id: lot.id,
              instrumentId: lot.instrument_id,
              direction: lot.direction,
              remainingQuantity: lot.remaining_quantity,
              originalQuantity: lot.original_quantity,
              entryPrice: lot.entry_price,
              costBasisTotal: lot.cost_basis_total,
              allocatedFees: lot.allocated_fees,
              openingExecutionId: lot.opening_execution_id,
              openedAt: lot.opened_at,
            })),
        };
      });

    return NextResponse.json(
      {
        positions,
        total: positions.length,
      },
      { status: 200 },
    );
  } catch (error) {
    // Map known domain errors
    if (error instanceof InvalidAmountError) {
      return NextResponse.json(
        {
          error: 'Invalid amount',
          details: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to list positions',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
