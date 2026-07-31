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

/**
 * Result of deriving trade status from executions.
 * Mirrors the shape from trade-calc.ts for backward compatibility.
 */
export interface DeriveStatusResult {
  status: TradeStatus;
  openedAt: string | null;
  closedAt: string | null;
  openQuantity: number;
  totalEntryQty: number;
  totalExitQty: number;
}

/** Initial risk snapshot recorded at first execution. */
export interface RiskSnapshotData {
  /** Dollar amount of initial risk. */
  initialRiskAmount: number | null;
  /** Account equity at the time of first execution. */
  accountEquityAtOpen: number | null;
  /** Stored initial stop price (never reconstructed from risk amount). */
  initialStopPrice?: number | null;
  /** Stored initial entry price from risk snapshot. */
  initialEntryPrice?: number | null;
}

/** A single stop adjustment record. */
export interface StopAdjustmentData {
  /** Adjusted stop price. */
  stopPrice: number;
  /** ISO 8601 timestamp of the adjustment. */
  adjustedAt: string;
  /** ISO 8601 timestamp when the adjustment row was created (tiebreaker after adjustedAt). */
  createdAt?: string;
  /** Stop adjustment row id (final deterministic tiebreaker). */
  id?: string;
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
  /**
   * Optional 'current time' in epoch milliseconds, used as the holding-period
   * end for open trades. Defaults to Date.now() when omitted. Injectable for
   * deterministic tests.
   */
  now?: number;
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
  /** Active stop price (latest adjustment, or initial stop from risk snapshot). */
  activeStop: number | null;
  /** Open risk: potential loss on remaining position at active stop (clamped to 0). */
  openRisk: number | null;
  /** Locked-in profit when the active stop is past the entry price (0 when none). */
  lockedPnl: number | null;
  /** Open risk as percentage of current account equity. */
  riskToAccount: number | null;
  /** Initial risk amount (from risk snapshot). */
  initialRisk: number | null;
  /** Initial risk as percentage of account equity at first execution. */
  initialRiskPct: number | null;
  /** Initial stop price from risk snapshot (stored exact value, never reconstructed). */
  initialStop: number | null;
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

/**
 * Compact trade metrics result for list views, excluding FIFO debugging detail.
 * The full `TradeMetricsResult` (with `remainingLots` and `matches`) remains
 * available for the trade-detail endpoint and other consumers that need it.
 */
export type TradeListMetrics = Omit<TradeMetricsResult, 'remainingLots' | 'matches'>;

// ── Helper functions ───────────────────────────────────────────────────

/**
 * Parse a timestamp string to epoch milliseconds. Invalid, null, or empty
 * values sort as 0 (oldest) so ordering stays fully deterministic even when
 * a field is missing or malformed (e.g. `new Date('').getTime()` → NaN would
 * otherwise poison comparator results).
 */
function parseTimestamp(value: string | undefined | null): number {
  if (value == null || value === '') return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

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

  // ── Build FIFO lot queue from entries ──────────────────────────
  // Each entry execution creates a lot with remaining quantity, entry price,
  // and proportional entry fees. Lots are ordered chronologically (FIFO).

  const lots: FifoLot[] = entries.map((e) => ({
    executionId: e.id ?? '',
    quantityRemaining: new Decimal(e.quantity),
    entryPrice: new Decimal(e.price),
    entryFeeRemaining: new Decimal(e.fees ?? 0),
    executedAt: e.executedAt,
  }));

  // ── FIFO matching: process exits against oldest lots ───────────
  // Per spec Section 4:
  //   - Each exit consumes the oldest available lot.
  //   - Long: gross P&L = (exitPrice − entryPrice) × matchedQty
  //   - Short: gross P&L = (entryPrice − exitPrice) × matchedQty
  //   - Entry fees allocated proportionally to matched quantity.
  //   - Exit fees allocated proportionally across matched portions.

  const matches: FifoMatch[] = [];
  let totalGrossRealizedPnl = new Decimal(0);
  let totalRealizedFees = new Decimal(0);

  for (const exit of exits) {
    const exitQty = new Decimal(exit.quantity);
    const exitFee = new Decimal(exit.fees ?? 0);
    const exitPriceDec = new Decimal(exit.price);
    let remainingExitQty = exitQty;

    while (remainingExitQty.gt(0) && lots.length > 0) {
      const lot = lots[0];

      // Quantity available to match from this lot
      const matchedQty = Decimal.min(remainingExitQty, lot.quantityRemaining);

      if (matchedQty.isZero()) {
        lots.shift();
        continue;
      }

      // Proportional entry fee allocation
      // The portion of this lot's remaining entry fee that travels with the matched quantity
      const feeRatio = lot.quantityRemaining.gt(0)
        ? matchedQty.div(lot.quantityRemaining)
        : new Decimal(0);
      const allocatedEntryFee = lot.entryFeeRemaining.mul(feeRatio);

      // Proportional exit fee allocation for this matched portion
      // The exit execution's total fee is split across matched portions
      const allocatedExitFee = exitFee.mul(matchedQty).div(exitQty);

      // Gross realized P&L for this matched portion per direction
      const pnl = direction === 'long'
        ? exitPriceDec.sub(lot.entryPrice).mul(matchedQty)
        : lot.entryPrice.sub(exitPriceDec).mul(matchedQty);

      totalGrossRealizedPnl = totalGrossRealizedPnl.add(pnl);
      totalRealizedFees = totalRealizedFees.add(allocatedEntryFee).add(allocatedExitFee);

      matches.push({
        lotExecutionId: lot.executionId,
        matchedQuantity: matchedQty,
        entryPrice: lot.entryPrice,
        exitPrice: exitPriceDec,
        allocatedEntryFee,
        allocatedExitFee,
      });

      // Update the lot: reduce remaining quantity and entry fees
      lot.quantityRemaining = lot.quantityRemaining.sub(matchedQty);
      lot.entryFeeRemaining = lot.entryFeeRemaining.sub(allocatedEntryFee);
      remainingExitQty = remainingExitQty.sub(matchedQty);

      // Remove fully consumed lot
      if (lot.quantityRemaining.isZero()) {
        lots.shift();
      }
    }
  }

  // ── Remaining lots after all matching ──────────────────────────

  const fifoOpenQty = lots.reduce(
    (s, lot) => s.add(lot.quantityRemaining),
    new Decimal(0),
  );

  const totalOpenCost = lots.reduce(
    (s, lot) => s.add(lot.entryPrice.mul(lot.quantityRemaining)),
    new Decimal(0),
  );

  const openAvgCost = fifoOpenQty.gt(0)
    ? totalOpenCost.div(fifoOpenQty).toNumber()
    : null;

  const openFeesDec = lots.reduce(
    (s, lot) => s.add(lot.entryFeeRemaining),
    new Decimal(0),
  );

  const grossRealizedPnlNum = totalGrossRealizedPnl.toNumber();
  const realizedFeesNum = totalRealizedFees.toNumber();
  // P2 hardening: net realized P&L stays in Decimal.js (no float subtraction drift).
  const netRealizedPnlNum = totalGrossRealizedPnl.minus(totalRealizedFees).toNumber();
  // P2 hardening: fee total is a monetary aggregate — reduce in Decimal.js, not floats.
  const totalFeesNum = executions
    .reduce((s, e) => s.plus(new Decimal(e.fees ?? 0)), new Decimal(0))
    .toNumber();

  // ── Quantity-weighted average prices ───────────────────────────

  const totalEntryNotional = entries.reduce(
    (s, e) => s.add(new Decimal(e.price).mul(new Decimal(e.quantity))),
    new Decimal(0),
  );
  const avgEntryPrice = entryQuantity.gt(0)
    ? totalEntryNotional.div(entryQuantity).toNumber()
    : null;

  const totalExitNotional = exits.reduce(
    (s, e) => s.add(new Decimal(e.price).mul(new Decimal(e.quantity))),
    new Decimal(0),
  );
  const avgExitPrice = exitQuantity.gt(0)
    ? totalExitNotional.div(exitQuantity).toNumber()
    : null;

  // ── Derived fields (T03) ────────────────────────────────────────

  // Unrealized P&L (Section 5.8)
  const grossUnrealizedPnl =
    currentMark != null && openAvgCost != null && openQuantity > 0
      ? (direction === 'long'
          ? new Decimal(currentMark.price).minus(new Decimal(openAvgCost))
          : new Decimal(openAvgCost).minus(new Decimal(currentMark.price))
        ).mul(new Decimal(openQuantity)).toNumber()
      : null;

  const netUnrealizedPnl =
    grossUnrealizedPnl != null
      ? new Decimal(grossUnrealizedPnl).minus(new Decimal(openFeesDec)).toNumber()
      : null;

  // Risk metrics (Section 6)
  // Active stop: latest adjustment, or fall back to derived initial stop from risk snapshot
  // When deriving from risk snapshot:
  //   initialRiskAmount = |avgEntryPrice - initialStopPrice| * entryQuantity
  //   so initialStopPrice = avgEntryPrice - (initialRiskAmount / entryQuantity) for long
  //   or  initialStopPrice = avgEntryPrice + (initialRiskAmount / entryQuantity) for short
  //
  // Defensive sort: ensure stop adjustments are chronologically ordered (oldest first)
  // with fully deterministic tiebreakers per the plan: latest adjustedAt, then latest
  // createdAt for identical adjustedAt, then id as the final fallback. Price magnitude
  // is deliberately NOT a tiebreaker — event chronology decides. The last element after
  // the ascending sort is the most recent event (picked by [length-1] below).
  const sortedStopAdjustments = [...stopAdjustments].sort((a, b) => {
    const t = parseTimestamp(a.adjustedAt) - parseTimestamp(b.adjustedAt);
    if (t !== 0) return t;
    const c = parseTimestamp(a.createdAt) - parseTimestamp(b.createdAt);
    if (c !== 0) return c;
    return (a.id ?? '').localeCompare(b.id ?? '');
  });

  let activeStop: number | null = null;

  if (sortedStopAdjustments.length > 0) {
    activeStop = sortedStopAdjustments[sortedStopAdjustments.length - 1].stopPrice;
  } else if (riskSnapshot?.initialStopPrice != null) {
    // Use stored exact initialStopPrice directly (never reconstructed from risk amount)
    activeStop = riskSnapshot.initialStopPrice;
  } else if (
    riskSnapshot?.initialRiskAmount != null &&
    avgEntryPrice != null &&
    entryQuantity.gt(0)
  ) {
    // Backward compatibility: derive from initialRiskAmount when initialStopPrice is null
    const riskPerShare = new Decimal(riskSnapshot.initialRiskAmount).div(entryQuantity);
    activeStop = direction === 'long'
      ? new Decimal(avgEntryPrice).minus(riskPerShare).toNumber()
      : new Decimal(avgEntryPrice).plus(riskPerShare).toNumber();
  }

  // Open risk: clamped to 0 (never negative), with separate lockedPnl
  // When stop has moved past entry (e.g. stop above avg cost for a long trade),
  // the position has no risk — openRisk = 0 and lockedPnl captures the locked profit.
  let openRisk: number | null = null;
  let lockedPnl: number | null = null;

  if (activeStop != null && openAvgCost != null && openQuantity > 0) {
    const riskPerUnit = direction === 'long'
      ? new Decimal(openAvgCost).minus(new Decimal(activeStop))
      : new Decimal(activeStop).minus(new Decimal(openAvgCost));

    const lockPerUnit = direction === 'long'
      ? new Decimal(activeStop).minus(new Decimal(openAvgCost))
      : new Decimal(openAvgCost).minus(new Decimal(activeStop));

    openRisk = Decimal.max(0, riskPerUnit).mul(new Decimal(openQuantity)).toNumber();
    lockedPnl = Decimal.max(0, lockPerUnit).mul(new Decimal(openQuantity)).toNumber();
  }

  const riskToAccount =
    openRisk != null && currentAccountEquity != null && currentAccountEquity > 0
      ? (new Decimal(openRisk).div(new Decimal(currentAccountEquity))).toNumber()
      : null;

  const initialRisk = riskSnapshot?.initialRiskAmount ?? null;
  const initialRiskPct =
    riskSnapshot?.initialRiskAmount != null &&
    riskSnapshot?.accountEquityAtOpen != null &&
    riskSnapshot.accountEquityAtOpen > 0
      ? (new Decimal(riskSnapshot.initialRiskAmount).div(new Decimal(riskSnapshot.accountEquityAtOpen))).toNumber()
      : null;

  // Position fields
  const status = deriveStatus(entryQuantity, exitQuantity);
  const openedAt = entries.length > 0 ? entries[0].executedAt : null;
  const closedAt =
    exits.length > 0 && cappedExitQuantity.gte(entryQuantity)
      ? exits[exits.length - 1].executedAt
      : null;

  const totalNetPnl = netUnrealizedPnl != null
    ? new Decimal(netRealizedPnlNum).plus(new Decimal(netUnrealizedPnl)).toNumber()
    : openQuantity > 0
      ? null
      : netRealizedPnlNum;

  // Holding period: closed trades use closedAt; open trades use the current time
  // (input.now or Date.now()), NOT the stale market-mark timestamp. The mark is
  // irrelevant to elapsed holding time, so no currentMark guard applies.
  const nowMs = input.now ?? Date.now();
  const holdingPeriodDays =
    openedAt != null && closedAt != null
      ? (new Date(closedAt).getTime() - new Date(openedAt).getTime()) / (1000 * 60 * 60 * 24)
      : openedAt != null
        ? (nowMs - new Date(openedAt).getTime()) / (1000 * 60 * 60 * 24)
        : null;

  const marketValue =
    currentMark != null && openQuantity > 0
      ? new Decimal(currentMark.price).mul(new Decimal(openQuantity)).toNumber()
      : null;

  const positionWeight =
    marketValue != null && currentAccountEquity != null && currentAccountEquity > 0
      ? new Decimal(marketValue).div(new Decimal(currentAccountEquity)).toNumber()
      : null;

  // Return metrics (Section 5.10)
  const returnPct =
    totalNetPnl != null && totalEntryNotional.gt(0)
      ? new Decimal(totalNetPnl).div(totalEntryNotional).toNumber()
      : null;

  const rMultiple =
    totalNetPnl != null && initialRisk != null && initialRisk > 0
      ? new Decimal(totalNetPnl).div(new Decimal(initialRisk)).toNumber()
      : null;

  return {
    size: {
      entryQuantity: entryQuantity.toNumber(),
      exitQuantity: exitQuantity.toNumber(),
      openQuantity,
      sizeDisplay,
    },
    averagePrices: {
      avgEntryPrice,
      avgExitPrice,
      openAvgCost,
    },
    fees: {
      totalFees: totalFeesNum,
      realizedFees: realizedFeesNum,
      openFees: openFeesDec.toNumber(),
    },
    realizedPnl: {
      grossRealizedPnl: grossRealizedPnlNum,
      netRealizedPnl: netRealizedPnlNum,
    },
    unrealizedPnl: {
      grossUnrealizedPnl,
      netUnrealizedPnl,
    },
    risk: {
      activeStop,
      openRisk,
      lockedPnl,
      riskToAccount,
      initialRisk,
      initialRiskPct,
      initialStop: riskSnapshot?.initialStopPrice ?? null,
    },
    returnMetrics: {
      returnPct,
      rMultiple,
    },
    position: {
      totalNetPnl,
      holdingPeriodDays,
      status,
      openedAt,
      closedAt,
      marketValue,
      positionWeight,
    },
    remainingLots: lots,
    matches,
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
