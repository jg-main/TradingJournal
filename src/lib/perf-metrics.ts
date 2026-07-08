/**
 * perf-metrics.ts
 *
 * Pure (no side effects) per-trade performance metric functions.
 * Decoupled from the Drizzle schema — reuses ExecutionData from trade-calc.ts
 * so this module can be tested independently without a database.
 *
 * Provides:
 *   - Duration (hold time in milliseconds)
 *   - Return % (P&L as a percentage of cost basis)
 *   - Total Fees (sum of all execution fees)
 */

import type { ExecutionData } from './trade-calc';

// ── Public types ────────────────────────────────────────────────────────

export interface PerfMetrics {
  duration: number | null;
  returnPercent: number | null;
  totalFees: number;
}

// ── 1. Duration ─────────────────────────────────────────────────────────

/**
 * Calculate trade duration in milliseconds.
 *
 * Returns the difference between closedAt and openedAt.
 * Returns null when openedAt is null (no entries).
 * When closedAt is null (open trade), returns null — the caller
 * should pass the current timestamp as `closedAt` for open trades.
 */
export function calculateDuration(
  openedAt: string | null,
  closedAt: string | null,
): number | null {
  if (openedAt === null || openedAt === '') return null;
  if (closedAt === null || closedAt === '') return null;

  const openMs = new Date(openedAt).getTime();
  const closeMs = new Date(closedAt).getTime();

  if (isNaN(openMs) || isNaN(closeMs)) return null;

  return closeMs - openMs;
}

// ── 2. Return % ─────────────────────────────────────────────────────────

/**
 * Calculate return as a percentage of the cost basis.
 *
 * Formula: (realizedPnL / (avgEntryPrice * totalEntryQty)) * 100
 *
 * Returns null when avgEntryPrice is null (no entries) or
 * totalEntryQty is 0 (guarding against division by zero).
 */
export function calculateReturnPercent(
  realizedPnL: number,
  avgEntryPrice: number | null,
  totalEntryQty: number,
): number | null {
  if (avgEntryPrice === null || avgEntryPrice === undefined) return null;
  if (totalEntryQty <= 0) return null;

  const costBasis = avgEntryPrice * totalEntryQty;
  if (costBasis === 0) return 0; // price is 0, P&L on zero-cost basis is 0% return

  return (realizedPnL / costBasis) * 100;
}

// ── 3. Total Fees ───────────────────────────────────────────────────────

/**
 * Sum all execution fees. Null fees are treated as 0.
 * Always returns a number (0 for empty executions).
 */
export function calculateTotalFees(executions: ExecutionData[]): number {
  return executions.reduce((sum, e) => sum + (e.fees ?? 0), 0);
}

// ── 4. Orchestrator ─────────────────────────────────────────────────────

/**
 * Compute all per-trade performance metrics in one call.
 */
export function computePerfMetrics(
  executions: ExecutionData[],
  openedAt: string | null,
  closedAt: string | null,
  realizedPnL: number,
  avgEntryPrice: number | null,
  totalEntryQty: number,
): PerfMetrics {
  return {
    duration: calculateDuration(openedAt, closedAt),
    returnPercent: calculateReturnPercent(realizedPnL, avgEntryPrice, totalEntryQty),
    totalFees: calculateTotalFees(executions),
  };
}
