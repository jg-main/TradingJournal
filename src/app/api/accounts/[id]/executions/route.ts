/**
 * Account Execution API Route
 *
 * POST /api/accounts/:id/executions — post an economic-side fill execution
 *   that creates an immutable accounting execution record, balanced cash
 *   and position ledger effects, and an updated position projection.
 *
 * GET /api/accounts/:id/executions — list executions for an account in
 *   deterministic order (posted_at, created_at), with optional instrument
 *   filter and pagination.
 *
 * Validates the request body with Zod, resolves the target account,
 * performs a pre-flight FIFO check to reject over-closes and unsupported
 * flips before any writes, delegates to the execution-posting service,
 * rebuilds the position projection, and maps domain errors to the project's
 * existing JSON error conventions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSqliteHandle } from '@/db';
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { rebuildPositions } from '@/lib/positions/rebuild';
import { allocateFifo } from '@/lib/positions/fifo';
import {
  postExecutionSchema,
  listExecutionsQuerySchema,
} from '@/lib/accounting/execution-contracts';
import {
  accountExists,
  findOrCreateInstrument,
  findAccountingExecutionByIdempotencyKey,
  listAccountingExecutions,
  countAccountingExecutions,
  listLegacyTradeExecutionsForAccount,
  findAccountPosition,
  findFifoLotsByAccountInstrument,
  findInstrumentById,
} from '@/db/accounting-repository';
import type { PositionState, FifoLot, FifoExecutionInput, ExecutionAction } from '@/lib/positions/types';
import type { CanonicalDecimal } from '@/lib/accounting/types';
import {
  InvalidAmountError,
  InvalidMicrosBoundsError,
  AccountNotFoundError,
  DuplicateExecutionIdempotencyError,
  FifoAllocationRejectedError,
} from '@/lib/accounting/errors';

type RouteParams = { params: Promise<{ id: string }> };

// ── Row-to-domain helpers ───────────────────────────────────────────────

function lotRowToFifoLot(row: Record<string, unknown>): FifoLot {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    instrumentId: row.instrument_id as string,
    direction: row.direction as FifoLot['direction'],
    remainingQuantity: row.remaining_quantity as CanonicalDecimal,
    originalQuantity: row.original_quantity as CanonicalDecimal,
    entryPrice: row.entry_price as CanonicalDecimal,
    costBasisTotal: row.cost_basis_total as CanonicalDecimal,
    allocatedFees: row.allocated_fees as CanonicalDecimal,
    openingExecutionId: row.opening_execution_id as string,
    openedAt: row.opened_at as string,
  };
}

function positionRowToPositionState(
  row: Record<string, unknown>,
  openLots: FifoLot[],
): PositionState {
  return {
    accountId: row.account_id as string,
    instrumentId: row.instrument_id as string,
    direction: row.direction as PositionState['direction'],
    quantity: row.quantity as CanonicalDecimal,
    averageCost: row.average_cost as CanonicalDecimal,
    totalCostBasis: row.total_cost_basis as CanonicalDecimal,
    realizedGrossPnl: row.realized_gross_pnl as CanonicalDecimal,
    realizedFees: row.realized_fees as CanonicalDecimal,
    realizedNetPnl: row.realized_net_pnl as CanonicalDecimal,
    openLots,
    lastUpdated: row.last_updated as string,
  };
}

// ── POST ────────────────────────────────────────────────────────────────

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

    const parsed = postExecutionSchema.safeParse(body);
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
      symbol,
      action,
      quantity,
      price,
      fees,
      idempotencyKey,
      journalTradeId,
      description,
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

    // 3. Pre-flight idempotency check
    if (idempotencyKey) {
      const existingExecution = findAccountingExecutionByIdempotencyKey(sqlite, idempotencyKey);
      if (existingExecution) {
        return NextResponse.json(
          {
            error: 'Duplicate idempotency key',
            details: `Accounting execution with idempotency key "${idempotencyKey}" already exists`,
          },
          { status: 409 },
        );
      }
    }

    // 4. Pre-flight FIFO check: read current position + lots and run
    //    speculative allocation to catch over-close / flip before any writes.
    const instrument = findOrCreateInstrument(sqlite, symbol);
    const currentPositionRow = findAccountPosition(sqlite, accountId, instrument.id);
    const currentLotRows = findFifoLotsByAccountInstrument(sqlite, accountId, instrument.id);

    const currentPosition: PositionState | null = currentPositionRow
      ? positionRowToPositionState(
          currentPositionRow as unknown as Record<string, unknown>,
          (currentLotRows as unknown as Record<string, unknown>[]).map(lotRowToFifoLot),
        )
      : null;

    const currentLots: FifoLot[] = (currentLotRows as unknown as Record<string, unknown>[]).map(lotRowToFifoLot);

    const preflightInput: FifoExecutionInput = {
      executionId: 'preflight',
      accountId,
      instrumentId: instrument.id,
      action: action as ExecutionAction,
      quantity: quantity as CanonicalDecimal,
      price: price as CanonicalDecimal,
      fees: fees as CanonicalDecimal,
      postedAt: postedAt ?? new Date().toISOString(),
    };

    const preflightResult = allocateFifo(
      preflightInput,
      currentPosition ?? null,
      currentLots,
      () => randomUUID(),
    );

    if (preflightResult.status === 'rejected') {
      return NextResponse.json(
        {
          error: 'FIFO allocation rejected',
          code: preflightResult.code,
          message: preflightResult.message,
          details: {
            action,
            quantity,
          },
        },
        { status: 422 },
      );
    }

    // 5. Post the execution fill (creates immutable execution + ledger effects)
    const fillResult = postExecutionFill(sqlite, {
      accountId,
      symbol,
      action,
      quantity,
      price,
      fees,
      idempotencyKey,
      journalTradeId,
      description,
      postedAt,
    });

    // 6. Rebuild positions to persist the projection
    const rebuildResult = rebuildPositions(sqlite, accountId, instrument.id);

    // 7. Read back updated position for the response
    const updatedPositionRow = findAccountPosition(sqlite, accountId, instrument.id);
    const updatedLotRows = findFifoLotsByAccountInstrument(sqlite, accountId, instrument.id);

    const position = updatedPositionRow
      ? positionRowToPositionState(
          updatedPositionRow as unknown as Record<string, unknown>,
          (updatedLotRows as unknown as Record<string, unknown>[]).map(lotRowToFifoLot),
        )
      : null;

    // 8. Build the response shape
    const positionResponse = position
      ? {
          accountId: position.accountId,
          instrumentId: position.instrumentId,
          direction: position.direction,
          quantity: position.quantity,
          averageCost: position.averageCost,
          totalCostBasis: position.totalCostBasis,
          realizedGrossPnl: position.realizedGrossPnl,
          realizedFees: position.realizedFees,
          realizedNetPnl: position.realizedNetPnl,
          openLots: position.openLots.map((lot) => ({
            id: lot.id,
            accountId: lot.accountId,
            instrumentId: lot.instrumentId,
            direction: lot.direction,
            remainingQuantity: lot.remainingQuantity,
            originalQuantity: lot.originalQuantity,
            entryPrice: lot.entryPrice,
            costBasisTotal: lot.costBasisTotal,
            allocatedFees: lot.allocatedFees,
            openingExecutionId: lot.openingExecutionId,
            openedAt: lot.openedAt,
          })),
          lastUpdated: position.lastUpdated,
        }
      : null;

    return NextResponse.json(
      {
        success: true,
        execution: {
          id: fillResult.execution.id,
          accountId: fillResult.execution.accountId,
          instrumentId: fillResult.execution.instrumentId,
          action: fillResult.execution.action,
          quantity: fillResult.execution.quantity,
          price: fillResult.execution.price,
          fees: fillResult.execution.fees,
          idempotencyKey: fillResult.execution.idempotencyKey,
          journalTradeId: fillResult.execution.journalTradeId,
          description: fillResult.execution.description,
          postedAt: fillResult.execution.postedAt,
          createdAt: fillResult.execution.createdAt,
          symbol,
        },
        position: positionResponse,
        rebuildStatus: {
          executionCount: rebuildResult.executionCount,
          lotCount: rebuildResult.lotCount,
          matchCount: rebuildResult.matchCount,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    // Map domain errors to HTTP error responses
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

    if (error instanceof DuplicateExecutionIdempotencyError) {
      return NextResponse.json(
        {
          error: 'Duplicate idempotency key',
          details: error.message,
        },
        { status: 409 },
      );
    }

    if (error instanceof FifoAllocationRejectedError) {
      return NextResponse.json(
        {
          error: 'FIFO allocation rejected',
          code: error.code,
          message: error.message,
          details: {
            action: error.action,
            quantity: error.quantity,
            availableQuantity: error.availableQuantity,
          },
        },
        { status: 422 },
      );
    }

    // Unexpected errors fall through to 500
    return NextResponse.json(
      {
        error: 'Failed to post execution',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// ── GET ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;

    // 1. Parse query params
    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsedQuery = listExecutionsQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { limit, offset, instrumentId } = parsedQuery.data;

    const sqlite = getSqliteHandle();

    // 2. Fetch executions from the repository
    // 2. Fetch accounting executions
    const executionRows = listAccountingExecutions(sqlite, accountId, {
      limit,
      offset,
      instrumentId,
    });
    const accountingTotal = countAccountingExecutions(sqlite, accountId, {
      instrumentId,
    });

    // 3. Also fetch legacy trade_executions for this account
    const legacyRows = listLegacyTradeExecutionsForAccount(sqlite, accountId);

    // 4. Resolve instrument symbols for the response
    const instrumentCache = new Map<string, { id: string; symbol: string }>();
    function resolveInstrument(instrumentIdOrSymbol: string): { id: string; symbol: string } {
      const cached = instrumentCache.get(instrumentIdOrSymbol);
      if (cached) return cached;
      const instrument = findInstrumentById(sqlite, instrumentIdOrSymbol);
      if (instrument) {
        const entry = { id: instrument.id, symbol: instrument.symbol };
        instrumentCache.set(instrumentIdOrSymbol, entry);
        return entry;
      }
      // Not a valid instrument ID — treat as symbol, create on the fly for legacy data
      try {
        const created = findOrCreateInstrument(sqlite, instrumentIdOrSymbol);
        const entry = { id: created.id, symbol: created.symbol };
        instrumentCache.set(instrumentIdOrSymbol, entry);
        return entry;
      } catch {
        return { id: instrumentIdOrSymbol, symbol: instrumentIdOrSymbol };
      }
    }

    // 5. Transform accounting executions
    const accountingExecs = (executionRows as unknown as Record<string, unknown>[]).map((row) => {
      const instr = resolveInstrument(row.instrument_id as string);
      return {
        id: row.id as string,
        accountId: row.account_id as string,
        instrumentId: instr.id,
        symbol: instr.symbol,
        action: row.action as string,
        quantity: row.quantity as string,
        price: row.price as string,
        fees: row.fees as string,
        idempotencyKey: row.idempotency_key as string | null,
        journalTradeId: row.journal_trade_id as string | null,
        description: row.description as string | null,
        postedAt: row.posted_at as string,
        createdAt: row.created_at as string,
      };
    });

    // 6. Transform legacy trade executions
    const legacyExecs = legacyRows.map((row) => {
      const instr = resolveInstrument(row._symbol);
      return {
        id: row.id,
        accountId: row.account_id,
        instrumentId: instr.id,
        symbol: instr.symbol,
        action: row.action,
        quantity: row.quantity,
        price: row.price,
        fees: row.fees,
        idempotencyKey: row.idempotency_key,
        journalTradeId: row.journal_trade_id,
        description: row.description,
        postedAt: row.posted_at,
        createdAt: row.created_at,
      };
    });

    // 7. Merge: accounting executions first, then legacy, sorted by postedAt ASC, id ASC
    const allExecs = [...accountingExecs, ...legacyExecs].sort((a, b) => {
      const dateCmp = a.postedAt.localeCompare(b.postedAt);
      if (dateCmp !== 0) return dateCmp;
      return a.id.localeCompare(b.id);
    });
    const mergedTotal = allExecs.length;

    // 8. Apply pagination on merged result
    const paginatedExecs = allExecs.slice(offset, offset + limit);

    return NextResponse.json(
      {
        executions: paginatedExecs,
        total: mergedTotal,
        limit,
        offset,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to list executions',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
