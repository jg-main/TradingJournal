/**
 * risk-snapshot.ts
 *
 * Pure computation module for risk snapshot derivation.
 * No database imports, no NextResponse — pure functions only.
 *
 * Extracts the duplicate equity-at-open derivation and initial risk amount
 * logic that previously lived in both execution creation routes.
 * See: src/app/api/trades/[id]/executions/route.ts,
 *      src/app/api/trades/[id]/execute/route.ts
 */

import { computeTradeMetrics, type ExecutionData, type Direction } from './trade-metrics';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Data from a single closed trade, used to compute the realized P&L
 * contributions to current account equity.
 */
export interface PriorClosedTradeData {
  direction: Direction;
  executions: ExecutionData[];
}

/**
 * Aggregated inputs for the account-equity-at-open computation.
 * The caller is responsible for fetching and aggregating the raw data
 * from the database; this function is purely computational.
 */
export interface EquityAtOpenInput {
  /** Account starting balance (0 if unspecified) */
  startingBalance: number;
  /** Sum of all deposit amounts up to the execution date */
  deposits: number;
  /** Sum of all withdrawal amounts up to the execution date */
  withdrawals: number;
  /** Total realized P&L from prior closed trades */
  realizedPnL: number;
  /**
   * True when there is genuinely no account-level data at all
   * (no startingBalance, no transactions, no prior closed trades).
   * When true, the function may fall back to the global fallbackValue.
   */
  hasNoAccountData: boolean;
  /**
   * Global fallback from settings.startingAccountValue, or null
   * when no fallback is configured.
   */
  fallbackValue: number | null;
}

/**
 * Inputs for the full risk-snapshot-values computation.
 */
export interface RiskSnapshotInput {
  avgEntryPrice: number;
  initialQuantity: number;
  initialStopPrice: number | null;
  direction: Direction;
  accountEquityAtOpen: number | null;
}

/**
 * The computed risk-snapshot fields that get stored in trade_risk_snapshots.
 */
export interface RiskSnapshotValues {
  initialEntryPrice: number;
  initialQuantity: number;
  initialStopPrice: number | null;
  riskPerShare: number | null;
  initialRiskAmount: number | null;
  accountRiskPct: number | null;
}

/**
 * Input for the initial-risk-amount derivation.
 * Mirrors the shape of a trade_risk_snapshots row from the database.
 * All fields are nullable because the caller may have a partial or null snapshot.
 */
export interface InitialRiskAmountInput {
  /** The computed initialRiskAmount, or null when not yet computed */
  initialRiskAmount: number | null;
  /** The entry price at trade open, or null when not available */
  initialEntryPrice: number | null;
  /** The stop price at trade open, or null when not set */
  initialStopPrice: number | null;
  /** The quantity at trade open, or null when not available */
  initialQuantity: number | null;
}

// ── Equity-at-open computation ─────────────────────────────────────────

/**
 * Compute account equity at the time a trade is opened.
 *
 * Returns the effective equity when it is positive. Falls back to the
 * global `fallbackValue` when there is no account data at all and the
 * fallback is configured. Returns `null` when no equity value can be
 * determined.
 *
 * Pure function — no side effects, no database access.
 */
export function computeEquityAtOpen(input: EquityAtOpenInput): number | null {
  const effectiveEquity =
    input.startingBalance +
    input.deposits -
    input.withdrawals +
    input.realizedPnL;

  if (effectiveEquity > 0) {
    return effectiveEquity;
  }

  // When there is genuinely no account data, fall back to global setting
  if (
    input.hasNoAccountData &&
    input.fallbackValue != null &&
    input.fallbackValue > 0
  ) {
    return input.fallbackValue;
  }

  return null;
}

// ── Initial risk amount derivation ─────────────────────────────────────

/**
 * Derive the initial risk amount for a trade, falling back to a raw
 * computation when the stored (computed) value is null.
 *
 * When `snapshot.initialRiskAmount` is non-null, returns it directly.
 * Otherwise, computes `|entryPrice - stopPrice| * quantity` from the
 * raw fields, returning `null` when any of the three raw fields is null.
 *
 * Pure function — no side effects, no database access.
 */
export function deriveInitialRiskAmount(
  snapshot: InitialRiskAmountInput,
): number | null {
  return (
    snapshot.initialRiskAmount ??
    (snapshot.initialEntryPrice != null &&
     snapshot.initialStopPrice != null &&
     snapshot.initialQuantity != null
      ? Math.abs(snapshot.initialEntryPrice - snapshot.initialStopPrice) *
        snapshot.initialQuantity
      : null)
  );
}

// ── Realized P&L aggregation ───────────────────────────────────────────

/**
 * Sum the realized P&L across an array of closed trades.
 *
 * Reuses `computeTradeMetrics` from `trade-metrics` for each trade's
 * execution history. This is the aggregation step that both execution
 * routes performed inline with a for-loop over prior closed trades.
 */
export function computeRealizedPnLFromClosedTrades(
  priorTrades: PriorClosedTradeData[],
): number {
  let total = 0;
  for (const pt of priorTrades) {
    const result = computeTradeMetrics({
      executions: pt.executions,
      direction: pt.direction,
      riskSnapshot: null,
      stopAdjustments: [],
      currentMark: null,
      currentAccountEquity: null,
    });
    total += result.realizedPnl.netRealizedPnl;
  }
  return total;
}

// ── Risk snapshot values computation ───────────────────────────────────

/**
 * Compute all derived risk-snapshot fields from the trade parameters.
 *
 * Fields computed:
 * - riskPerShare       = |entryPrice - stopPrice|
 * - initialRiskAmount  = riskPerShare * initialQuantity
 * - accountRiskPct     = (initialRiskAmount / accountEquityAtOpen) * 100
 *
 * Pure function — no side effects, no database access.
 */
export function computeRiskSnapshotValues(
  input: RiskSnapshotInput,
): RiskSnapshotValues {
  const { avgEntryPrice, initialQuantity, initialStopPrice } = input;

  const riskPerShare =
    initialStopPrice != null
      ? Math.abs(avgEntryPrice - initialStopPrice)
      : null;

  const initialRiskAmount =
    riskPerShare != null ? riskPerShare * initialQuantity : null;

  const accountRiskPct =
    initialRiskAmount != null &&
    input.accountEquityAtOpen != null &&
    input.accountEquityAtOpen > 0
      ? (initialRiskAmount / input.accountEquityAtOpen) * 100
      : null;

  return {
    initialEntryPrice: avgEntryPrice,
    initialQuantity,
    initialStopPrice,
    riskPerShare,
    initialRiskAmount,
    accountRiskPct,
  };
}
