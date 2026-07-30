/**
 * trade-metrics.ts
 *
 * Pure (no side effects) computation module for trade-level metrics.
 * Implements FIFO lot matching, proportional fee allocation, and all
 * derived field calculations per the Trade Metrics Specification (Section 5).
 *
 * All financial arithmetic uses decimal.js — no JavaScript floating-point
 * in final values.
 *
 * Pattern: src/lib/trade-calc.ts (M026 pure-computation convention)
 *   - No database imports
 *   - No NextResponse or framework dependencies
 *   - Own input/output types (not Drizzle schema types)
 *   - Plain arguments only
 */

import Decimal from 'decimal.js';

// ── Input Types ─────────────────────────────────────────────────────────

/** A single execution record. */
export interface ExecutionData {
  /** Unique execution identifier (used as FIFO tiebreaker). */
  id?: string;
  /** e.g. 'buy', 'sell', 'sell_short', 'buy_to_cover', 'add', 'reduce' */
  action: string;
  /** Number of shares/units. */
  quantity: number;
  /** Price per share/unit. */
  price: number;
  /** Commission and fees for this execution (null = unknown, treated as 0). */
  fees: number | null;
  /** ISO 8601 timestamp. */
  executedAt: string;
}

/** Trade direction. */
export type Direction = 'long' | 'short';

/** Derived trade status. */
export type TradeStatus = 'planned' | 'open' | 'closed';

/** Initial risk snapshot recorded at first execution. */
export interface RiskSnapshotData {
  /** Dollar amount of initial risk. */
  initialRiskAmount: number | null;
  /** Account equity at the time of first execution. */
  accountEquityAtOpen: number | null;
}

/** A single stop adjustment record. */
export interface StopAdjustmentData {
  /** Adjusted stop price. */
  stopPrice: number;
  /** ISO 8601 timestamp of the adjustment. */
  adjustedAt: string;
}

/** A current market-price mark. */
export interface MarketMarkData {
  /** Market price of the instrument. */
  price: number;
  /** ISO 8601 timestamp when this mark was recorded. */
  markedAt: string;
}

/** Combined input for the computeTradeMetrics function. */
export interface TradeMetricsInput {
  /** All executions for this trade (entries + exits). */
  executions: ExecutionData[];
  /** Trade direction (long or short). */
  direction: Direction;
  /** Stored initial risk snapshot (may be null if not yet set). */
  riskSnapshot: RiskSnapshotData | null;
  /** Stop adjustments ordered chronologically (may be empty). */
  stopAdjustments: StopAdjustmentData[];
  /** Current market price mark (may be null if not available). */
  currentMark: MarketMarkData | null;
  /** Current account equity for risk-to-account computation. */
  currentAccountEquity: number | null;
}

// ── FIFO Lot Types ─────────────────────────────────────────────────────

/** An open FIFO lot resulting from an entry execution. */
export interface FifoLot {
  /** Execution ID that created this lot. */
  executionId: string;
  /** Quantity remaining in this lot (not yet matched by exits). */
  quantityRemaining: Decimal;
  /** Entry price for this lot. */
  entryPrice: Decimal;
  /** Entry fees remaining on this lot (proportionally allocated). */
  entryFeeRemaining: Decimal;
  /** ISO 8601 timestamp of the entry execution. */
  executedAt: string;
}

/** A single FIFO match between an exit and an entry lot. */
export interface FifoMatch {
  /** The entry lot execution ID. */
  lotExecutionId: string;
  /** Quantity matched in this portion. */
  matchedQuantity: Decimal;
  /** Entry price of the matched lot. */
  entryPrice: Decimal;
  /** Exit price for this portion. */
  exitPrice: Decimal;
  /** Entry fee proportionally allocated to this matched quantity. */
  allocatedEntryFee: Decimal;
  /** Exit fee proportionally allocated to this matched quantity. */
  allocatedExitFee: Decimal;
}

// ── Output Types ───────────────────────────────────────────────────────

/** Size-related metrics (Section 5.1). */
export interface SizeMetrics {
  /** Sum of all entry fill quantities. */
  entryQuantity: number;
  /** Sum of all exit fill quantities. */
  exitQuantity: number;
  /** Remaining open quantity (entryQuantity - exitQuantity). */
  openQuantity: number;
  /** Display string: "entryQty / exitQty". */
  sizeDisplay: string;
}

/** Average price metrics (Sections 5.2–5.4). */
export interface AveragePriceMetrics {
  /** Quantity-weighted average entry price (null if no entries). */
  avgEntryPrice: number | null;
  /** Quantity-weighted average exit price (null if no exits). */
  avgExitPrice: number | null;
  /** Average cost of FIFO lots that remain open (null if fully closed). */
  openAvgCost: number | null;
}

/** Fee-related metrics (Section 5.6). */
export interface FeeMetrics {
  /** Total fees across all executions. */
  totalFees: number;
  /** Fees allocated to realized (matched) quantity. */
  realizedFees: number;
  /** Fees remaining on open entry lots. */
  openFees: number;
}

/** Realized P&L metrics (Sections 5.5, 5.7). */
export interface RealizedPnlMetrics {
  /** Realized gain/loss before fees from FIFO-matched closed quantity. */
  grossRealizedPnl: number;
  /** Gross realized P&L minus allocated fees. */
  netRealizedPnl: number;
}

/** Unrealized P&L metrics (Section 5.8). */
export interface UnrealizedPnlMetrics {
  /** Gross unrealized P&L (market movement on open quantity, before fees). */
  grossUnrealizedPnl: number | null;
  /** Gross unrealized P&L minus remaining open fees. */
  netUnrealizedPnl: number | null;
}

/** Risk-related metrics (Section 6). */
export interface RiskMetrics {
  /** Active stop price (latest adjustment, or initial stop). */
  activeStop: number | null;
  /** Open risk: potential loss on remaining position at active stop. */
  openRisk: number | null;
  /** Open risk as percentage of current account equity. */
  riskToAccount: number | null;
  /** Initial risk amount (from risk snapshot). */
  initialRisk: number | null;
  /** Initial risk as percentage of account equity at first execution. */
  initialRiskPct: number | null;
}

/** Return metrics (Section 5.10). */
export interface ReturnMetrics {
  /** Total net P&L as percentage of total entry notional. */
  returnPct: number | null;
  /** Total net P&L divided by initial risk (R-multiple). */
  rMultiple: number | null;
}

/** Performance and position metrics. */
export interface PositionMetrics {
  /** Total net P&L (net realized + net unrealized). */
  totalNetPnl: number | null;
  /** Holding period in days (null if not yet closed). */
  holdingPeriodDays: number | null;
  /** Derived trade status. */
  status: TradeStatus;
  /** Timestamp of first entry execution. */
  openedAt: string | null;
  /** Timestamp of last exit execution (fully closed). */
  closedAt: string | null;
  /** Current market value: market price × open quantity (null if no mark). */
  marketValue: number | null;
  /** Position weight as percentage of current account equity. */
  positionWeight: number | null;
}

/** Complete trade metrics result. */
export interface TradeMetricsResult {
  size: SizeMetrics;
  averagePrices: AveragePriceMetrics;
  fees: FeeMetrics;
  realizedPnl: RealizedPnlMetrics;
  unrealizedPnl: UnrealizedPnlMetrics;
  risk: RiskMetrics;
  returnMetrics: ReturnMetrics;
  position: PositionMetrics;
  /** The FIFO lot queue after all matching (for debugging / inspection). */
  remainingLots: FifoLot[];
  /** The FIFO matches produced during computation (for debugging / inspection). */
  matches: FifoMatch[];
}

// ── Helper functions ───────────────────────────────────────────────────

/**
 * Classify an execution action as an entry for the given direction.
 */
export function isEntryAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'buy' || action === 'add';
  return action === 'sell_short';
}

/**
 * Classify an execution action as an exit for the given direction.
 */
export function isExitAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'sell' || action === 'reduce';
  return action === 'buy_to_cover';
}

// ── Main Computation ───────────────────────────────────────────────────

/**
 * Compute all trade-level metrics from executions, risk data, and market data.
 *
 * This is the sole computation entry point for trade metrics. All downstream
 * surfaces (Trades page, Dashboard, Trade Detail, Account Overview) should
 * call this function with their data rather than duplicating formulas.
 *
 * @param input - All data needed for computation
 * @returns Complete trade metrics result
 */
export function computeTradeMetrics(input: TradeMetricsInput): TradeMetricsResult {
  // TODO: Implement in T02 (FIFO lot matching) and T03 (derived field calculations)

  const { executions, direction, riskSnapshot, stopAdjustments, currentMark, currentAccountEquity } = input;

  // ── Partition executions ───────────────────────────────────────────

  const entries = executions
    .filter((e) => isEntryAction(e.action, direction))
    .sort((a, b) => {
      const t = new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime();
      if (t !== 0) return t;
      return (a.id ?? '').localeCompare(b.id ?? '');
    });

  const exits = executions
    .filter((e) => isExitAction(e.action, direction))
    .sort((a, b) => {
      const t = new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime();
      if (t !== 0) return t;
      return (a.id ?? '').localeCompare(b.id ?? '');
    });

  // ── Aggregate sizes ────────────────────────────────────────────────

  const entryQuantity = entries.reduce((s, e) => s.plus(new Decimal(e.quantity)), new Decimal(0));
  const exitQuantity = exits.reduce((s, e) => s.plus(new Decimal(e.quantity)), new Decimal(0));
  const openQuantityDecimal = Decimal.max(0, entryQuantity.minus(exitQuantity));
  const cappedExitQuantity = Decimal.min(exitQuantity, entryQuantity);

  const openQuantity = openQuantityDecimal.toNumber();

  const sizeDisplay = `${entryQuantity.toNumber()} / ${exitQuantity.toNumber()}`;

  // ── Placeholder results (to be implemented) ────────────────────────

  return {
    size: {
      entryQuantity: entryQuantity.toNumber(),
      exitQuantity: exitQuantity.toNumber(),
      openQuantity,
      sizeDisplay,
    },
    averagePrices: {
      avgEntryPrice: null,
      avgExitPrice: null,
      openAvgCost: null,
    },
    fees: {
      totalFees: executions.reduce((s, e) => s + (e.fees ?? 0), 0),
      realizedFees: 0,
      openFees: 0,
    },
    realizedPnl: {
      grossRealizedPnl: 0,
      netRealizedPnl: 0,
    },
    unrealizedPnl: {
      grossUnrealizedPnl: null,
      netUnrealizedPnl: null,
    },
    risk: {
      activeStop: null,
      openRisk: null,
      riskToAccount: null,
      initialRisk: riskSnapshot?.initialRiskAmount ?? null,
      initialRiskPct: riskSnapshot?.initialRiskAmount != null && riskSnapshot?.accountEquityAtOpen != null && riskSnapshot.accountEquityAtOpen > 0
        ? (riskSnapshot.initialRiskAmount / riskSnapshot.accountEquityAtOpen) * 100
        : null,
    },
    returnMetrics: {
      returnPct: null,
      rMultiple: null,
    },
    position: {
      totalNetPnl: null,
      holdingPeriodDays: null,
      status: deriveStatus(entryQuantity, exitQuantity),
      openedAt: entries.length > 0 ? entries[0].executedAt : null,
      closedAt: exits.length > 0 && cappedExitQuantity.gte(entryQuantity)
        ? exits[exits.length - 1].executedAt
        : null,
      marketValue: null,
      positionWeight: null,
    },
    remainingLots: [],
    matches: [],
  };
}

/**
 * Derive trade status from entry and exit quantities.
 */
function deriveStatus(totalEntryQty: Decimal, totalExitQty: Decimal): TradeStatus {
  if (totalEntryQty.isZero()) return 'planned';
  if (totalExitQty.isZero() || totalExitQty.lessThan(totalEntryQty)) return 'open';
  return 'closed';
}

// ── Re-export for convenience ──────────────────────────────────────────

export type { Decimal };
