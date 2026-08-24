/**
 * fee-repair.ts
 *
 * M002-A6 — auditable, idempotent historical repair for MISSING execution
 * fee cash events.
 *
 * Pre-A6, `postExecutionFill` recorded gross trade consideration in cash but
 * never posted the execution fee as a cash outflow, and legacy syncs created
 * FIFO rows without fee effects. This service appends the missing fee cash
 * event for every EFFECTIVE execution with a factual fee, and rebuilds the
 * position/performance projections under the corrected A6 allocator.
 *
 * Effective executions (reusing the correction/effective-stream semantics the
 * FIFO rebuild uses):
 *   - uncorrected executions
 *   - correction REPLACEMENTS
 * Excluded:
 *   - correction_lineage.original_execution_id (superseded — its fee was
 *     refunded at correction time if it ever posted one; a pre-A6 original
 *     was never charged in cash)
 *   - correction_lineage.reversal_execution_id (accounting machinery — never
 *     charged an execution fee)
 *
 * Deterministic idempotency: each appended fee event uses
 *   accounting-execution-fee:<executionId>:v1
 * A second run posts zero new fee events and changes no cash/P&L/NAV.
 *
 * Immutable originals are never rewritten. Standalone (non-execution) fee
 * events are never touched.
 */

import type Database from 'better-sqlite3';
import { postFinancialEvent } from './posting';
import { toMicros } from './decimal';
import {
  buildExecutionFeeFinancialEventInput,
  executionFeeFinancialEventIdempotencyKey,
} from './execution-posting';
import { findEventByIdempotencyKey, findInstrumentById } from '../../db/accounting-repository';
import { rebuildPositions } from '../positions/rebuild';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';

export interface FeeRepairOutcome {
  /** Effective executions with a factual fee scanned. */
  scanned: number;
  /** Fee events appended this run. */
  repaired: number;
  /** Fee events that already existed (skipped). */
  alreadyPresent: number;
}

/** Effective (non-superseded) executions for an account with fees > 0. */
function effectiveFeeBearingExecutions(
  sqlite: Database.Database,
  accountId: string,
): Array<{ id: string; account_id: string; instrument_id: string; action: string; fees: string; journal_trade_id: string | null; posted_at: string }> {
  return sqlite
    .prepare(
      `SELECT ae.id, ae.account_id, ae.instrument_id, ae.action, ae.fees,
              ae.journal_trade_id, ae.posted_at
       FROM accounting_executions ae
       LEFT JOIN correction_lineage cl
         ON ae.id = cl.original_execution_id OR ae.id = cl.reversal_execution_id
       WHERE ae.account_id = ?
         AND cl.id IS NULL
         AND ae.fees IS NOT NULL AND ae.fees != '0.00'
       ORDER BY ae.posted_at ASC, ae.id ASC`,
    )
    .all(accountId) as Array<{
    id: string;
    account_id: string;
    instrument_id: string;
    action: string;
    fees: string;
    journal_trade_id: string | null;
    posted_at: string;
  }>;
}

/**
 * Repair missing execution fee cash events for ONE account, atomically.
 *
 * Compensating fee events + position rebuild + account-performance rebuild
 * share one transaction: a projection failure rolls back the new fee events
 * (never an unprojected repair reported as success).
 */
export function repairExecutionFeesForAccount(
  sqlite: Database.Database,
  accountId: string,
): FeeRepairOutcome {
  const outcome: FeeRepairOutcome = { scanned: 0, repaired: 0, alreadyPresent: 0 };

  const transaction = sqlite.transaction(() => {
    const instrumentIds = new Set<string>();
    const rows = effectiveFeeBearingExecutions(sqlite, accountId);
    outcome.scanned = rows.length;

    for (const row of rows) {
      const key = executionFeeFinancialEventIdempotencyKey(row.id);
      if (findEventByIdempotencyKey(sqlite, key)) {
        outcome.alreadyPresent += 1;
        continue;
      }
      const instrument = findInstrumentById(sqlite, row.instrument_id);
      postFinancialEvent(
        sqlite,
        buildExecutionFeeFinancialEventInput({
          accountingExecutionId: row.id,
          accountId,
          symbol: instrument?.symbol ?? 'UNKNOWN',
          action: row.action,
          fees: row.fees,
          journalTradeId: row.journal_trade_id,
          postedAt: row.posted_at,
        }),
      );
      outcome.repaired += 1;
      instrumentIds.add(row.instrument_id);
    }

    // Rebuild positions under the corrected A6 fee allocator, then the
    // account-wide projection (net cash now includes the fee outflows).
    for (const instrumentId of instrumentIds) {
      rebuildPositions(sqlite, accountId, instrumentId);
    }
    if (outcome.repaired > 0 || instrumentIds.size > 0) {
      const perf = rebuildAccountPerformance(sqlite, accountId);
      if (!perf.success) {
        throw new Error(perf.error ?? 'Failed to rebuild account performance after fee repair');
      }
    }
  });

  transaction();
  return outcome;
}

/**
 * Scan a whole database and repair every affected account.
 * Convenience for the one-time migration/repair command.
 */
export function repairAllExecutionFees(
  sqlite: Database.Database,
): { accounts: string[]; totalRepaired: number; totalScanned: number } {
  const accounts = sqlite
    .prepare(
      `SELECT DISTINCT ae.account_id AS account_id
       FROM accounting_executions ae
       LEFT JOIN correction_lineage cl
         ON ae.id = cl.original_execution_id OR ae.id = cl.reversal_execution_id
       WHERE cl.id IS NULL AND ae.fees IS NOT NULL AND ae.fees != '0.00'`,
    )
    .all() as Array<{ account_id: string }>;

  const repairedAccounts: string[] = [];
  let totalRepaired = 0;
  let totalScanned = 0;
  for (const { account_id } of accounts) {
    const result = repairExecutionFeesForAccount(sqlite, account_id);
    if (result.repaired > 0) repairedAccounts.push(account_id);
    totalRepaired += result.repaired;
    totalScanned += result.scanned;
  }
  return { accounts: repairedAccounts, totalRepaired, totalScanned };
}

/** Keep the micros guard available for callers/tests. */
export { toMicros };
