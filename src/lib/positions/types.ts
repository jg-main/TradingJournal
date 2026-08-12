/**
 * Pure domain types for position management and FIFO lot allocation.
 *
 * No database or Next.js imports — these are pure TypeScript types
 * used by the FIFO allocator, rebuild engine, and API contracts.
 */

import type { CanonicalDecimal } from '../accounting/types';

// ── Position Direction ──────────────────────────────────────────────────

export const POSITION_DIRECTIONS = ['long', 'short'] as const;
export type PositionDirection = (typeof POSITION_DIRECTIONS)[number];

// ── Execution Actions ───────────────────────────────────────────────────

/**
 * Supported execution actions for the accounting engine.
 *
 * These mirror the legacy trade_executions actions but operate on
 * economic-side fills separate from the journal trade lifecycle.
 *
 * - buy: Open or add to a long position (increases long quantity)
 * - sell: Close or reduce a long position (decreases long quantity)
 * - sell_short: Open or add to a short position (increases short quantity)
 * - buy_to_cover: Close or reduce a short position (decreases short quantity)
 * - add: Add to an existing position (same side as current position)
 * - reduce: Reduce an existing position (opposite side, partial close)
 */
export const EXECUTION_ACTIONS = [
  'buy',
  'sell',
  'sell_short',
  'buy_to_cover',
  'add',
  'reduce',
] as const;

export type ExecutionAction = (typeof EXECUTION_ACTIONS)[number];

/** Actions that open or increase a long position. */
export const LONG_OPENING_ACTIONS: readonly ExecutionAction[] = ['buy', 'add'];
/** Actions that close or reduce a long position. */
export const LONG_CLOSING_ACTIONS: readonly ExecutionAction[] = ['sell', 'reduce'];
/** Actions that open or increase a short position. */
export const SHORT_OPENING_ACTIONS: readonly ExecutionAction[] = ['sell_short', 'add'];
/** Actions that close or reduce a short position. */
export const SHORT_CLOSING_ACTIONS: readonly ExecutionAction[] = ['buy_to_cover', 'reduce'];

/**
 * Determine the position direction an execution action implies.
 * Opening actions set the direction; closing actions consume from it.
 */
export function actionImpliedDirection(
  action: ExecutionAction,
  currentDirection: PositionDirection | null,
): PositionDirection | null {
  switch (action) {
    case 'buy':
    case 'buy_to_cover':
      return 'long';
    case 'sell':
    case 'sell_short':
      return 'short';
    case 'add':
      // Add preserves current direction
      return currentDirection;
    case 'reduce':
      // Reduce preserves current direction
      return currentDirection;
  }
}

// ── FIFO Lot State ──────────────────────────────────────────────────────

/**
 * A single FIFO lot — a cost-basis slice of an open position.
 *
 * Lots are created by opening executions (buy for long, sell_short for short)
 * and consumed by closing executions (sell for long, buy_to_cover for short).
 *
 * A lot with remainingQuantity === "0.00" is fully closed and should be
 * archived/hidden from the open-lots view.
 */
export interface FifoLot {
  /** Unique lot identifier. */
  id: string;
  /** Account ID this lot belongs to. */
  accountId: string;
  /** Instrument ID this lot is for. */
  instrumentId: string;
  /** Position direction (long or short). */
  direction: PositionDirection;
  /** Remaining open quantity (canonical decimal). "0.00" means fully closed. */
  remainingQuantity: CanonicalDecimal;
  /** Original quantity opened (canonical decimal). Never changes. */
  originalQuantity: CanonicalDecimal;
  /** Entry price for this lot (canonical decimal). */
  entryPrice: CanonicalDecimal;
  /** Entry cost basis total = quantity * entryPrice + allocatedFees (canonical decimal). */
  costBasisTotal: CanonicalDecimal;
  /** Allocated entry fees for this lot (canonical decimal). */
  allocatedFees: CanonicalDecimal;
  /** The execution ID that opened this lot. */
  openingExecutionId: string;
  /** Timestamp when the lot was opened. */
  openedAt: string;
  /** Optional stable sequence order for same-timestamp deterministic ordering. */
  sequence?: number;
}

// ── Lot Match ────────────────────────────────────────────────────────────

/**
 * A match between a closing execution and an open FIFO lot.
 *
 * Records the realized P&L and fees for that specific lot slice.
 * Each closing execution can match against multiple lots (partial fills).
 */
export interface LotMatch {
  /** Unique match identifier. */
  id: string;
  /** The closing execution ID (sell, buy_to_cover, or reduce). */
  closingExecutionId: string;
  /** The FIFO lot ID being closed against. */
  lotId: string;
  /** Quantity matched from this lot (canonical decimal). */
  matchQuantity: CanonicalDecimal;
  /** Price at which the match was executed (canonical decimal). */
  matchPrice: CanonicalDecimal;
  /** Realized gross P&L on this match (canonical decimal, positive = gain). */
  realizedGrossPnl: CanonicalDecimal;
  /** Allocated fees for this match (canonical decimal). */
  allocatedFees: CanonicalDecimal;
  /** Realized net P&L = realizedGrossPnl - allocatedFees (canonical decimal). */
  realizedNetPnl: CanonicalDecimal;
  /** Sequence order of this match within the closing execution. */
  sequence: number;
}

// ── Position State ──────────────────────────────────────────────────────

/**
 * Aggregate position state for a single (account, instrument) pair.
 *
 * Rebuildable from the immutable execution event stream.
 */
export interface PositionState {
  /** Account ID. */
  accountId: string;
  /** Instrument ID. */
  instrumentId: string;
  /** Current position direction (null = flat/closed). */
  direction: PositionDirection | null;
  /**
   * Remaining quantity magnitude (non-negative for both long and short;
   * direction carries exposure sign, "0.00" = flat).
   */
  quantity: CanonicalDecimal;
  /** Average cost basis per unit (canonical decimal). */
  averageCost: CanonicalDecimal;
  /** Total cost basis = sum of all open lot costBasisTotals (canonical decimal). */
  totalCostBasis: CanonicalDecimal;
  /** Aggregate realized gross P&L (canonical decimal). */
  realizedGrossPnl: CanonicalDecimal;
  /** Aggregate realized fees (canonical decimal). */
  realizedFees: CanonicalDecimal;
  /** Aggregate realized net P&L = realizedGrossPnl - realizedFees (canonical decimal). */
  realizedNetPnl: CanonicalDecimal;
  /** Open FIFO lots contributing to this position. */
  openLots: FifoLot[];
  /** Timestamp of the last execution affecting this position. */
  lastUpdated: string;
}

// ── Execution Input ─────────────────────────────────────────────────────

/**
 * Input to the FIFO allocator: a validated execution fill.
 *
 * Fields are pre-validated canonical decimals — the allocator trusts
 * its inputs and focuses purely on FIFO matching.
 */
export interface FifoExecutionInput {
  /** Unique execution ID. */
  executionId: string;
  /** Account ID. */
  accountId: string;
  /** Instrument ID. */
  instrumentId: string;
  /** Execution action (buy, sell, sell_short, buy_to_cover, add, reduce). */
  action: ExecutionAction;
  /** Fill quantity (canonical decimal, must be positive). */
  quantity: CanonicalDecimal;
  /** Fill price per unit (canonical decimal, must be positive). */
  price: CanonicalDecimal;
  /** Execution fees (canonical decimal, non-negative). */
  fees: CanonicalDecimal;
  /** ISO-8601 timestamp of execution. */
  postedAt: string;
  /** Stable sequence order (for same-timestamp deterministic ordering). */
  sequence?: number;
}

// ── FIFO Allocation Result ──────────────────────────────────────────────

/** Possible outcomes of a FIFO allocation. */
export type FifoAllocationResult =
  | FifoAllocationSuccess
  | FifoAllocationRejection;

/** Successful FIFO allocation — lots were opened, matched, or both. */
export interface FifoAllocationSuccess {
  status: 'success';
  /** Lots that were opened (if this was an opening execution). */
  openedLots: FifoLot[];
  /** Matches against existing open lots (if this was a closing execution). */
  matches: LotMatch[];
  /** Updated position state after this execution. */
  position: PositionState;
}

/** FIFO allocation rejected — the execution cannot be allocated. */
export interface FifoAllocationRejection {
  status: 'rejected';
  /** Typed failure code for stable API mapping. */
  code: FifoRejectionCode;
  /** Human-readable rejection reason. */
  message: string;
}

// ── Rejection Codes ─────────────────────────────────────────────────────

/**
 * Stable typed failure codes for the FIFO allocation engine.
 *
 * Each code maps to a specific HTTP status and error shape in the API.
 */
export type FifoRejectionCode =
  | 'OVER_CLOSE'
  | 'UNSUPPORTED_FLIP'
  | 'MIXED_SIDE'
  | 'REVERSAL'
  | 'INVALID_QUANTITY'
  | 'INVALID_PRICE'
  | 'NO_POSITION_TO_CLOSE'
  | 'POSITION_DIRECTION_MISMATCH';

/**
 * Human-readable descriptions for each rejection code.
 */
export const FIFO_REJECTION_MESSAGES: Record<FifoRejectionCode, string> = {
  OVER_CLOSE:
    'Execution quantity exceeds available open position quantity for the given side',
  UNSUPPORTED_FLIP:
    'Flipping a position from long to short (or short to long) in a single execution is not supported',
  MIXED_SIDE:
    'Execution action is not consistent with the current position direction',
  REVERSAL:
    'Closing action would reverse the position direction; use separate reduce and open executions',
  INVALID_QUANTITY:
    'Execution quantity must be a positive canonical decimal (e.g. "100.00")',
  INVALID_PRICE:
    'Execution price must be a positive canonical decimal (e.g. "150.00")',
  NO_POSITION_TO_CLOSE:
    'No open position exists to close against',
  POSITION_DIRECTION_MISMATCH:
    'Execution action direction does not match the current position direction',
};

// ── Rebuild Result ──────────────────────────────────────────────────────

/**
 * Result of rebuilding all positions from the immutable execution stream.
 */
export interface RebuildResult {
  /** Per-(account, instrument) position states, keyed by `${accountId}:${instrumentId}`. */
  positions: Map<string, PositionState>;
  /** All open FIFO lots across all positions. */
  openLots: FifoLot[];
  /** All lot matches across all positions. */
  allMatches: LotMatch[];
  /** Count of executions processed. */
  executionCount: number;
  /** Count of lots created. */
  lotCount: number;
  /** Count of matches produced. */
  matchCount: number;
}

// ── Direction Resolution ────────────────────────────────────────────────

/**
 * Resolve the effective direction from an execution action given
 * the current position.
 *
 * Returns null if the action is ambiguous without a current direction
 * (e.g., 'add' or 'reduce' with no current position).
 */
export function resolveEffectiveDirection(
  action: ExecutionAction,
  currentDirection: PositionDirection | null,
): PositionDirection | null {
  switch (action) {
    case 'buy':
    case 'buy_to_cover':
      return 'long';
    case 'sell':
    case 'sell_short':
      return 'short';
    case 'add':
    case 'reduce':
      return currentDirection;
  }
}
