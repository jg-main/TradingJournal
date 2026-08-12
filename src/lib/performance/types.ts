/**
 * Pure domain types for valuation marks and performance calculation.
 *
 * No database or Next.js imports — these are pure TypeScript types
 * consumed by the valuation/performance functions and API contracts.
 *
 * @module performance/types
 */

import type { CanonicalDecimal } from '../accounting/types';
import type { PositionDirection } from '../positions/types';

// ── Mark Source ─────────────────────────────────────────────────────────

export const MARK_SOURCES = ['user', 'market_data', 'import', 'system'] as const;
export type MarkSource = (typeof MARK_SOURCES)[number];

// ── Mark Status ─────────────────────────────────────────────────────────

export const MARK_STATUSES = ['fresh', 'stale', 'missing'] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

// ── Cash Flow Type ──────────────────────────────────────────────────────

export const CASH_FLOW_TYPES = ['deposit', 'withdrawal'] as const;
export type CashFlowType = (typeof CASH_FLOW_TYPES)[number];

// ── Valuation Mark ──────────────────────────────────────────────────────

/**
 * An immutable valuation mark for a single instrument at a point in time.
 *
 * Represents the authoritative price used for marking a position to market.
 * Marks may come from different sources (user-entered, market data feed,
 * imported, or system-generated).
 */
export interface ValuationMark {
  /** Instrument ID this mark applies to. */
  instrumentId: string;
  /** Mark price per unit (canonical decimal). */
  price: CanonicalDecimal;
  /** ISO-8601 timestamp of when this mark was recorded. */
  markTimestamp: string;
  /** Source of the mark (user, market_data, import, system). */
  source: MarkSource;
}

// ── Valuation Position ──────────────────────────────────────────────────

/**
 * A single (account, instrument) position with its valuation state.
 *
 * Carries a valuation-normalized projection of FIFO position state (direction,
 * signed quantity, cost basis, realized P&L) and the current valuation state
 * (mark price, marked value, unrealized P&L, mark freshness).
 *
 * Null fields indicate missing or non-computable values rather than zero.
 */
export interface ValuationPosition {
  /** Instrument ID. */
  instrumentId: string;
  /** Current position direction (null = flat/closed). */
  direction: PositionDirection | null;
  /** Signed valuation quantity (positive long, negative short, "0.00" flat). */
  quantity: CanonicalDecimal;
  /** Average cost basis per unit (canonical decimal). */
  averageCost: CanonicalDecimal;
  /** Total cost basis = sum of all open lot costBasisTotals. */
  totalCostBasis: CanonicalDecimal;
  /** Aggregate realized gross P&L for this position. */
  realizedPnl: CanonicalDecimal;
  /** Aggregate realized fees for this position. */
  realizedFees: CanonicalDecimal;
  /** Aggregate realized net P&L = realizedGrossPnl - realizedFees. */
  realizedNetPnl: CanonicalDecimal;
  /** Current mark price per unit, or null if no mark exists. */
  markPrice: CanonicalDecimal | null;
  /** Mark status (fresh, stale, or missing). */
  markStatus: MarkStatus;
  /** Marked-to-market value of the position = quantity × markPrice, or null. */
  markedValue: CanonicalDecimal | null;
  /** Unrealized P&L for the position, or null if not computable. */
  unrealizedPnl: CanonicalDecimal | null;
  /** ISO-8601 timestamp of the mark, or null if missing. */
  markTimestamp: string | null;
  /** Source of the mark, or null if missing. */
  markSource: MarkSource | null;
  /** Age of the mark in minutes at computation time, or null if missing. */
  markAgeMinutes: number | null;
}

// ── NAV Breakdown ───────────────────────────────────────────────────────

/**
 * Detailed breakdown of Net Asset Value components.
 */
export interface NavBreakdown {
  /** Cash balance from the ledger. */
  cash: CanonicalDecimal;
  /** Sum of all marked position values. */
  markedPositions: CanonicalDecimal;
}

// ── Account Valuation ───────────────────────────────────────────────────

/**
 * Full valuation snapshot for an account at a point in time.
 *
 * Aggregates net cash, all position valuations, and derived metrics
 * (NAV, P&L, exposure).  Warnings surface data-quality issues such as
 * missing or stale marks for open positions.
 */
export interface AccountValuation {
  /** Account ID. */
  accountId: string;
  /** Net cash balance from the ledger. */
  netCash: CanonicalDecimal;
  /** Valuation state for each (account, instrument) position. */
  positions: ValuationPosition[];
  /** Sum of all marked position values. */
  markedPositions: CanonicalDecimal;
  /** Net Asset Value = netCash + markedPositions. */
  nav: CanonicalDecimal;
  /** Detailed NAV breakdown. */
  navDetail: NavBreakdown;
  /** Sum of realized net P&L across all positions. */
  realizedPnl: CanonicalDecimal;
  /** Sum of unrealized P&L across all marked positions. */
  unrealizedPnl: CanonicalDecimal;
  /** Total P&L = realizedPnl + unrealizedPnl. */
  totalPnl: CanonicalDecimal;
  /** Sum of realized fees across all positions (counted once). */
  realizedFees: CanonicalDecimal;
  /** Gross exposure = sum of absolute marked position values. */
  grossExposure: CanonicalDecimal;
  /** Net exposure = sum of signed marked position values (long - short). */
  netExposure: CanonicalDecimal;
  /** Data-quality warnings (missing marks, stale marks, etc.). */
  warnings: string[];
  /** ISO-8601 timestamp of when this valuation was computed. */
  computedAt: string;
}

/**
 * Input to computeAccountValuation: account metadata + raw valuations.
 */
export interface AccountValuationInput {
  /** Account ID. */
  accountId: string;
  /** Net cash balance from the ledger. */
  netCash: CanonicalDecimal;
  /** Valuation state for each position (pre-computed mark status/value). */
  positions: ValuationPosition[];
}

// ── Cash Flow ───────────────────────────────────────────────────────────

/**
 * A deposit or withdrawal affecting account cash.
 *
 * Used by the performance engine to exclude external cash flows
 * from profit calculations (Modified Dietz / TWR).
 */
export interface CashFlow {
  /** ISO-8601 date of the cash flow. */
  date: string;
  /** Amount (positive absolute, canonical decimal). */
  amount: CanonicalDecimal;
  /** Type of cash flow. */
  type: CashFlowType;
}

// ── Performance Input ───────────────────────────────────────────────────

/**
 * Input to the performance calculation engine.
 *
 * Carries the NAV bookends and cash flows for a period.
 */
export interface PerformanceInput {
  /** NAV at the start of the period. */
  startNav: CanonicalDecimal;
  /** NAV at the end of the period. */
  endNav: CanonicalDecimal;
  /** Cash flows within the period (deposits and withdrawals). */
  cashFlows: CashFlow[];
  /** ISO-8601 start date. */
  startDate: string;
  /** ISO-8601 end date. */
  endDate: string;
}

// ── Sub-Period Return ──────────────────────────────────────────────────

/**
 * A single sub-period return for TWR chaining.
 *
 * Between two cash flow events, the holding-period return is
 * computed as the pure market return without external influence.
 */
export interface SubPeriodReturn {
  /** ISO-8601 start date of the sub-period. */
  startDate: string;
  /** ISO-8601 end date of the sub-period. */
  endDate: string;
  /** Holding period return (decimal, e.g. "0.05" = 5%). */
  return: CanonicalDecimal;
  /** Number of calendar days in the sub-period. */
  days: number;
}

// ── Performance Result ─────────────────────────────────────────────────

/**
 * Complete performance result for an account over a period.
 */
export interface PerformanceResult {
  /** Modified Dietz return (single-period simplified). */
  modifiedDietzReturn: CanonicalDecimal;
  /** Time-Weighted Return (chain-linked sub-periods). */
  twr: CanonicalDecimal;
  /** Individual sub-period returns used for TWR computation. */
  subPeriodReturns: SubPeriodReturn[];
  /** High-water mark (maximum observed NAV). */
  highWaterMark: CanonicalDecimal;
  /** Absolute drawdown from high-water mark. */
  drawdown: CanonicalDecimal;
  /** Drawdown as a percentage of high-water mark. */
  drawdownPct: CanonicalDecimal;
  /** Computation warnings (e.g., zero NAV, no marks). */
  warnings: string[];
}

// ── Historical NAV ──────────────────────────────────────────────────────

/**
 * A historical NAV observation used for high-water mark computation.
 */
export interface HistoricalNavValue {
  /** NAV at this point in time. */
  nav: CanonicalDecimal;
  /** ISO-8601 date of the NAV observation. */
  date: string;
}

/**
 * Input to the high-water mark computation.
 */
export interface HighWaterMarkInput {
  /** Current NAV. */
  currentNav: CanonicalDecimal;
  /** Historical NAV observations. */
  historicalNavValues: HistoricalNavValue[];
}
