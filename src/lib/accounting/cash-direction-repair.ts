/**
 * cash-direction-repair.ts
 *
 * M002-A5 — auditable, idempotent repair for HISTORICAL short add/reduce
 * executions whose financial-event cash direction was inverted.
 *
 * Pre-A5, the accounting cash boundary derived direction from the raw action
 * (sell/reduce/sell_short → increase; buy/add/buy_to_cover → decrease). That
 * mapping is only correct for LONG management. For SHORT trades:
 *
 *   add    = sell more short    → cash must INCREASE (was recorded decrease)
 *   reduce = buy to cover       → cash must DECREASE (was recorded increase)
 *
 * A5 fixes all NEW writes (engine + direct account route resolve the concrete
 * economic action first). This service repairs AFFECTED HISTORICAL rows
 * without rewriting the immutable originals: it appends a clearly typed
 * compensating financial event (event_type manual_adjustment with a typed
 * payload) whose delta exactly neutralizes the wrong recorded direction and
 * applies the correct one.
 *
 *   short add 20 @ 45:  recorded -900, correct +900  → compensation +1,800
 *   short reduce 20 @40: recorded +800, correct -800 → compensation -1,600
 *
 * Idempotency: each compensation carries the deterministic key
 *   cash-direction-repair:<accountingExecutionId>:v1
 * on the financial event; re-running the repair never applies an event twice
 * (no fuzzy description matching).
 *
 * Repair scope: only trade-linked (journal_trade_id) rows whose raw action is
 * a generic alias AND whose recorded direction provably differs from the
 * economic side implied by the linked trade's direction. Concrete actions
 * (buy/sell/sell_short/buy_to_cover) and correct long aliases are skipped.
 * Unlinked add/reduce rows have no resolvable direction — never guessed.
 *
 * Compensating event + account-performance projection rebuild are atomic per
 * account (single transaction).
 */

import type Database from 'better-sqlite3';
import { postFinancialEvent } from './posting';
import {
  findEventByIdempotencyKey,
} from '../../db/accounting-repository';
import {
  cashDirectionForEconomicAction,
  resolveEconomicExecutionAction,
  isGenericManagementAction,
  type EconomicAction,
} from './economic-action';
import { toMicros, fromMicros } from './decimal';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';

/** Deterministic repair key (never applied twice). */
export function cashDirectionRepairKey(accountingExecutionId: string): string {
  return `cash-direction-repair:${accountingExecutionId}:v1`;
}

/** Legacy recorded direction rule for a raw (pre-resolution) action. */
function legacyRecordedDirection(action: string): 'increase' | 'decrease' {
  return action === 'reduce' ? 'increase' : 'decrease'; // add / buy etc → decrease
}

export interface CashDirectionRepairOutcome {
  /** Affected rows where the recorded direction provably differs. */
  repaired: number;
  /** Scanned trade-linked generic rows (repaired + already-correct). */
  scanned: number;
  /** Compensating event ids posted this run. */
  compensations: string[];
}

interface AffectedRow {
  id: string;
  action: string;
  quantity: string;
  price: string;
  tradeDirection: 'long' | 'short';
  journalTradeId: string | null;
}

/**
 * Repair historical cash-direction inversions for ONE account, atomically.
 *
 * @param sqlite    - Raw better-sqlite3 handle.
 * @param accountId - The account to scan and repair.
 */
export function repairExecutionCashDirectionForAccount(
  sqlite: Database.Database,
  accountId: string,
): CashDirectionRepairOutcome {
  const rows = sqlite
    .prepare(
      `SELECT ae.id, ae.action, ae.quantity, ae.price, ae.journal_trade_id,
              t.direction AS trade_direction
       FROM accounting_executions ae
       JOIN trades t ON t.id = ae.journal_trade_id
       WHERE ae.account_id = ? AND ae.journal_trade_id IS NOT NULL`,
    )
    .all(accountId) as Array<{
    id: string;
    action: string;
    quantity: string;
    price: string;
    journal_trade_id: string | null;
    trade_direction: 'long' | 'short';
  }>;

  const outcome: CashDirectionRepairOutcome = { repaired: 0, scanned: 0, compensations: [] };

  const transaction = sqlite.transaction(() => {
    for (const row of rows) {
      if (!isGenericManagementAction(row.action)) continue; // concrete → unambiguous
      outcome.scanned += 1;

      const economic = resolveEconomicExecutionAction(row.action, row.trade_direction);
      const correctDirection = cashDirectionForEconomicAction(economic);
      const recordedDirection = legacyRecordedDirection(row.action);
      if (recordedDirection === correctDirection) continue; // long add/reduce already correct

      // Wrong recorded direction → compensating event with |Δ| = 2 × consideration.
      const key = cashDirectionRepairKey(row.id);
      if (findEventByIdempotencyKey(sqlite, key)) continue; // already repaired

      const qMicros = toMicros(row.quantity);
      const pMicros = toMicros(row.price);
      const considerationMicros = Number(
        (BigInt(qMicros) * BigInt(pMicros)) / BigInt(1_000_000),
      );
      const deltaMicros = considerationMicros * 2;
      const delta = fromMicros(deltaMicros);
      const compensationDirection: 'increase' | 'decrease' =
        recordedDirection === 'decrease' ? 'increase' : 'decrease';

      const event = postFinancialEvent(sqlite, {
        accountId,
        eventType: 'manual_adjustment',
        amount: delta,
        idempotencyKey: key,
        description:
          `M002-A5 cash-direction repair for execution ${row.id} ` +
          `(short ${row.action} recorded ${recordedDirection}, correct ${correctDirection})`,
        payload: JSON.stringify({
          repairKey: key,
          repairType: 'cash_direction_repair',
          accountingExecutionId: row.id,
          originalAction: row.action,
          correctAction: economic,
          tradeDirection: row.trade_direction,
          recordedDirection,
          correctDirection,
          version: 1,
        }),
        effect: JSON.stringify({
          kind: 'cash',
          direction: compensationDirection,
          amount: delta,
          amountMicros: deltaMicros,
        }),
        postedAt: new Date().toISOString(),
      });

      outcome.repaired += 1;
      outcome.compensations.push(event.event.id);
    }

    // Projection rebuild is part of the same transaction: a failure rolls
    // back the compensations (never an unprojected repair reported as success).
    if (outcome.repaired > 0) {
      const perf = rebuildAccountPerformance(sqlite, accountId);
      if (!perf.success) {
        throw new Error(perf.error ?? 'Failed to rebuild account performance after cash-direction repair');
      }
    }
  });

  transaction();
  return outcome;
}

/**
 * Scan a whole database (all accounts) and repair each affected account.
 * Convenience for the one-time migration/repair command.
 */
export function repairAllExecutionCashDirections(
  sqlite: Database.Database,
): { accounts: string[]; totalRepaired: number; totalScanned: number } {
  const accounts = sqlite
    .prepare(
      `SELECT DISTINCT ae.account_id AS account_id
       FROM accounting_executions ae
       JOIN trades t ON t.id = ae.journal_trade_id
       WHERE ae.action IN ('add', 'reduce')`,
    )
    .all() as Array<{ account_id: string }>;

  const repairedAccounts: string[] = [];
  let totalRepaired = 0;
  let totalScanned = 0;
  for (const { account_id } of accounts) {
    const result = repairExecutionCashDirectionForAccount(sqlite, account_id);
    if (result.repaired > 0) repairedAccounts.push(account_id);
    totalRepaired += result.repaired;
    totalScanned += result.scanned;
  }
  return { accounts: repairedAccounts, totalRepaired, totalScanned };
}

/** Re-exported for callers that need the pure mapping (tests/route use). */
export type { EconomicAction };
