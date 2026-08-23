/**
 * Trade execution → accounting sync library.
 *
 * Mirrors legacy trade_executions (from POST /api/trades/[id]/execute and
 * POST /api/trades/[id]/executions) to the accounting_executions table
 * with idempotency protection, then triggers a FIFO position rebuild so
 * that add/reduce/close operations immediately update account_positions.
 *
 * Non-fatal: sync failures do NOT throw — they log structured events and
 * return error information so the caller (trade execution API route) can
 * continue without rolling back the trade execution itself.
 *
 * Upstream surfaces consumed:
 *   - src/db/accounting-repository.ts (findAccountingExecutionByIdempotencyKey,
 *     findOrCreateInstrument, insertAccountingExecution)
 *   - src/lib/positions/rebuild.ts (rebuildPositions)
 */

import Database from 'better-sqlite3';
import { normalizeDecimal } from '../accounting/decimal';
import { ensureExecutionFinancialEvent } from '../accounting/execution-posting';
import { assertSupportedAccountCurrency } from '../accounting/posting';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';
import { rebuildPositions } from './rebuild';
import type { RebuildResult } from './types';
import type { AccountingExecutionRow } from '../../db/accounting-repository';
import {
  findAccountingExecutionByIdempotencyKey,
  findOrCreateInstrument,
  insertAccountingExecution,
} from '../../db/accounting-repository';

// ── Structured Logging ───────────────────────────────────────────────────

function logInfo(message: string, ...args: unknown[]): void {
  console.log(`[trade-sync] ${message}`, ...args);
}

function logError(message: string, ...args: unknown[]): void {
  console.error(`[trade-sync] ${message}`, ...args);
}

// ── Helper: convert legacy execution values to canonical decimals ────────

/**
 * Convert a legacy numeric value (stored as REAL in trade_executions) to a
 * canonical decimal string for the accounting system.
 *
 * Degenerate cases (null, undefined, NaN) return "0.00".
 */
function toCanonicalDecimal(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0.00';
  return normalizeDecimal(value);
}

// ── Idempotency Key ──────────────────────────────────────────────────────

/**
 * Build the accounting idempotency key for a legacy trade execution.
 *
 * The key namespaces the original trade execution ID so it cannot collide
 * with idempotency keys from other domains (e.g. financial events).
 *
 * Exported for the trade-scoped correction route (POST /api/trades/[id]/executions/[execId]/correct),
 * which resolves the mirrored accounting execution by this same key — the key MUST stay in sync with
 * the mirror writes in syncTradeExecution below.
 */
export function tradeExecutionIdempotencyKey(tradeExecutionId: string): string {
  return `trade-execution-${tradeExecutionId}`;
}

// ── Exported Functions ──────────────────────────────────────────────────

/**
 * Mirror a single legacy trade_execution to the accounting_executions table.
 *
 * Idempotent: if an accounting_execution with the matching idempotency key
 * already exists, returns it without inserting a duplicate.
 *
 * @param sqlite        - Raw better-sqlite3 Database handle.
 * @param tradeExecution - The legacy trade_executions row to mirror.
 * @param accountId     - The account ID (from the parent trade).
 * @param symbol        - The instrument symbol (from the parent trade).
 * @returns The AccountingExecutionRow (existing or newly inserted).
 */
export function syncTradeExecution(
  sqlite: Database.Database,
  tradeExecution: {
    id: string;
    tradeId: string;
    action: string;
    quantity: number;
    price: number;
    fees: number | null;
    executedAt: string | null;
  },
  accountId: string,
  symbol: string,
): AccountingExecutionRow {
  const idempotencyKey = tradeExecutionIdempotencyKey(tradeExecution.id);

  // ── Enforce the USD-only account currency contract ──────────────────
  // Legacy trade-execution mirroring must not create new ledger activity for
  // a non-USD account. Throws before any instrument/execution-row mutation,
  // so a rejected sync leaves no partial state.
  assertSupportedAccountCurrency(sqlite, accountId);

  // ── Check idempotency ──────────────────────────────────────────────
  const existing = findAccountingExecutionByIdempotencyKey(sqlite, idempotencyKey);
  if (existing) {
    logInfo(
      `trade-sync.execution-created (idempotent)`,
      JSON.stringify({
        tradeExecutionId: tradeExecution.id,
        accountingExecutionId: existing.id,
        action: tradeExecution.action,
        symbol,
        idempotent: true,
      }),
    );
    return existing;
  }

  // ── Resolve instrument by symbol ──────────────────────────────────
  const instrument = findOrCreateInstrument(sqlite, symbol);

  // ── Convert values to canonical decimals ──────────────────────────
  const quantity = toCanonicalDecimal(tradeExecution.quantity);
  const price = toCanonicalDecimal(tradeExecution.price);
  const fees = toCanonicalDecimal(tradeExecution.fees);
  const postedAt = tradeExecution.executedAt ?? new Date().toISOString();

  // ── Insert accounting execution ───────────────────────────────────
  const accountingExecution = insertAccountingExecution(sqlite, {
    accountId,
    instrumentId: instrument.id,
    action: tradeExecution.action,
    quantity,
    price,
    fees,
    idempotencyKey,
    journalTradeId: tradeExecution.tradeId,
    description: `Mirrored from trade_execution: ${tradeExecution.action} ${quantity} @ ${price}`,
    postedAt,
  });

  logInfo(
    `trade-sync.execution-created`,
    JSON.stringify({
      tradeExecutionId: tradeExecution.id,
      accountingExecutionId: accountingExecution.id,
      action: tradeExecution.action,
      symbol,
      idempotent: false,
    }),
  );

  return accountingExecution;
}

/**
 * Sync a trade execution to accounting AND rebuild the FIFO position
 * projection for the affected account + instrument pair.
 *
 * Non-fatal: if the sync or rebuild fails, the error is logged as a
 * structured event and the function returns `{ error }` instead of
 * throwing. The caller (trade execution API route) is expected to
 * continue its normal response flow without rolling back the trade.
 *
 * @param sqlite        - Raw better-sqlite3 Database handle.
 * @param tradeExecution - The legacy trade_executions row to mirror.
 * @param accountId     - The account ID (from the parent trade).
 * @param symbol        - The instrument symbol (from the parent trade).
 * @returns On success: { accountingExecution, rebuildResult }.
 *          On failure: { error: string }.
 */
export function syncAndRebuildPositions(
  sqlite: Database.Database,
  tradeExecution: {
    id: string;
    tradeId: string;
    action: string;
    quantity: number;
    price: number;
    fees: number | null;
    executedAt: string | null;
  },
  accountId: string,
  symbol: string,
): { accountingExecution: AccountingExecutionRow; rebuildResult: RebuildResult } | { error: string } {
  try {
    // 1. Mirror to accounting_executions
    const accountingExecution = syncTradeExecution(
      sqlite,
      tradeExecution,
      accountId,
      symbol,
    );

    // 2. Ensure the immutable execution has its matching cash event. Legacy
    // syncs created FIFO rows without this effect, so this is intentionally
    // idempotent and also repairs any retried partial sync.
    ensureExecutionFinancialEvent(sqlite, accountingExecution, symbol);

    // 3. Resolve instrument ID for rebuild
    const instrument = findOrCreateInstrument(sqlite, symbol);

    // 4. Rebuild FIFO position projection for this (account, instrument) pair
    const rebuildResult = rebuildPositions(sqlite, accountId, instrument.id);

    // 5. Rebuild the persisted performance projection from canonical cash,
    // position, and mark data so account and dashboard readers are current.
    const performanceResult = rebuildAccountPerformance(sqlite, accountId);
    if (!performanceResult.success) {
      throw new Error(performanceResult.error ?? 'Failed to rebuild account performance');
    }

    // Emit position-rebuilt event from the computed position state
    const positionKey = `${accountId}:${instrument.id}`;
    const position = rebuildResult.positions.get(positionKey);
    if (position) {
      logInfo(
        `trade-sync.position-rebuilt`,
        JSON.stringify({
          accountId,
          instrumentId: instrument.id,
          symbol,
          quantity: position.quantity,
          averageCost: position.averageCost,
          executionCount: rebuildResult.executionCount,
        }),
      );
    } else {
      // Position is flat after this execution — still valid, emit flat state
      logInfo(
        `trade-sync.position-rebuilt (flat)`,
        JSON.stringify({
          accountId,
          instrumentId: instrument.id,
          symbol,
          quantity: '0.00',
          averageCost: '0.00',
          executionCount: rebuildResult.executionCount,
        }),
      );
    }

    return { accountingExecution, rebuildResult };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logError(
      `trade-sync.error`,
      JSON.stringify({
        error: errorMessage,
        tradeExecutionId: tradeExecution.id,
        tradeId: tradeExecution.tradeId,
        accountId,
        symbol,
        action: tradeExecution.action,
      }),
    );
    return { error: errorMessage };
  }
}
