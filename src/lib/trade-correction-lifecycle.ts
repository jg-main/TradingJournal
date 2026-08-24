/**
 * trade-correction-lifecycle.ts
 *
 * S06/T02 — deterministic trade lifecycle rebuild after an accounting
 * execution correction.
 *
 * When a trade-scoped correction changes the effective execution set
 * (reversal + replacement), the trade row's status/openedAt/closedAt must
 * be recomputed so the journal stays coherent with accounting truth:
 *
 *   - a closed trade whose exit fill is corrected to a smaller quantity
 *     reopens (status: open, closedAt: null)
 *   - an open trade whose partial exit is corrected upward can reclose
 *   - a corrected first entry shifts openedAt to the replacement's timeline
 *
 * The effective execution set is derived by resolving correction_lineage:
 * for every corrected execution, the original and its reversal cancel out
 * economically; the replacement (and every uncorrected original) survives.
 *
 * Pure-computation convention (M026): this module owns the lineage
 * resolution and lifecycle derivation only. It imports the canonical
 * computeTradeMetrics kernel from trade-metrics.ts and must not import
 * database access or NextResponse. The sqlite handle is passed in.
 */

import type Database from 'better-sqlite3';
import type { AccountingExecutionRow } from '@/db/accounting-repository';
import {
  computeTradeMetrics,
  type ExecutionData,
  type Direction,
  type TradeStatus,
} from '@/lib/trade-metrics';

// ── Effective Execution Resolution ─────────────────────────────────────

/**
 * Resolve the effective (post-correction) execution set for a trade.
 *
 * Reads every accounting_execution carrying the trade's journal_trade_id,
 * then excludes original+reversal pairs for every correction lineage that
 * touches the set. Uncorrected originals and replacement executions remain,
 * so the returned stream represents the trade's true economic fills.
 *
 * Ordering follows the accounting stream (posted_at ASC, id ASC) so
 * lifecycle derivation is deterministic regardless of write order.
 *
 * @param sqlite  - Raw better-sqlite3 handle (same connection as the caller's transaction).
 * @param tradeId - The journal trade id (accounting_executions.journal_trade_id).
 * @returns ExecutionData-compatible executions for the trade.
 */
export function resolveEffectiveExecutions(
  sqlite: Database.Database,
  tradeId: string,
): ExecutionData[] {
  const rows = sqlite
    .prepare(
      `SELECT id, account_id, instrument_id, action, quantity, price, fees,
              idempotency_key, journal_trade_id, description, posted_at, created_at
       FROM accounting_executions
       WHERE journal_trade_id = ?
       ORDER BY posted_at ASC, id ASC`,
    )
    .all(tradeId) as AccountingExecutionRow[];

  if (rows.length === 0) return [];

  // Collect every correction lineage that references one of this trade's
  // executions (as original, reversal, or replacement). Reversal and
  // replacement inherit journal_trade_id from the original (S06/T01), so a
  // lineage whose original is in the set always has its reversal in the set
  // too. Matching all three roles is defensive against future linkage drift.
  const excluded = new Set<string>();
  const lineageRows = sqlite
    .prepare(
      `SELECT original_execution_id, reversal_execution_id
       FROM correction_lineage
       WHERE original_execution_id IN (
         SELECT id FROM accounting_executions WHERE journal_trade_id = ?
       )
          OR reversal_execution_id IN (
         SELECT id FROM accounting_executions WHERE journal_trade_id = ?
       )
          OR replacement_execution_id IN (
         SELECT id FROM accounting_executions WHERE journal_trade_id = ?
       )`,
    )
    .all(tradeId, tradeId, tradeId) as {
    original_execution_id: string;
    reversal_execution_id: string;
  }[];

  for (const lineage of lineageRows) {
    excluded.add(lineage.original_execution_id);
    excluded.add(lineage.reversal_execution_id);
  }

  return rows
    .filter((row) => !excluded.has(row.id))
    .map((row) => ({
      id: row.id,
      action: row.action,
      quantity: Number(row.quantity),
      price: Number(row.price),
      fees: row.fees === null ? null : Number(row.fees),
      executedAt: row.posted_at,
    }));
}

// ── Lifecycle Derivation ───────────────────────────────────────────────

export interface TradeLifecycle {
  status: TradeStatus;
  openedAt: string | null;
  closedAt: string | null;
}

/**
 * Recompute the trade lifecycle (status/openedAt/closedAt) from the
 * effective execution set through the canonical computeTradeMetrics kernel.
 *
 * status: 'planned' when no entry, 'open' when entries exceed exits,
 *         'closed' when cumulative exits reach the cumulative entries.
 * openedAt: timestamp of the first entry execution.
 * closedAt: timestamp of the final exit execution when the trade is flat,
 *           otherwise null.
 *
 * @param effectiveExecutions - The resolved post-correction execution set.
 * @param direction           - Trade direction ('long' | 'short').
 */
export function recomputeTradeLifecycle(
  effectiveExecutions: ExecutionData[],
  direction: Direction,
): TradeLifecycle {
  const metrics = computeTradeMetrics({
    executions: effectiveExecutions,
    direction,
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  });

  return {
    status: metrics.position.status,
    openedAt: metrics.position.openedAt,
    closedAt: metrics.position.closedAt,
  };
}
