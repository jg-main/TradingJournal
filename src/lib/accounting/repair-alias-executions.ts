/**
 * repair-alias-executions.ts
 *
 * M007-S07 — canonical data audit + deterministic repair for accounting_executions
 * rows that still carry journal workflow aliases (`add` / `reduce`).
 *
 * S01/S02 closed the writer boundaries so no NEW alias rows can enter
 * accounting_executions. Any production DB that ran the legacy migration or
 * posted executions before those fixes may still contain alias rows.
 *
 * accounting_executions and financial_events are immutable (migrations
 * 0024/0026 triggers forbid UPDATE/DELETE), so repair cannot rewrite or
 * remove the originals. This service follows the established correction
 * pattern: reversal + replacement + correction_lineage + projection rebuilds.
 * The effective invariant after repair is therefore zero UN-REPAIRED alias
 * rows (findAliasExecutions returns []) — superseded originals persist as
 * immutable audit trail, exactly like any corrected execution.
 *
 *   original alias  →  reversal (reverse of the CONCRETE economic action)
 *                   →  replacement (the concrete economic action)
 *                   →  correction_lineage row linking all three
 *                   →  FIFO positions + account performance rebuilt in-transaction
 *
 * Direction resolves from the linked trade via journal_trade_id; rows without
 * a resolvable trade direction are reported as ANOMALIES (never guessed).
 *
 * Deterministic idempotency: repaired originals are excluded from the audit
 * scan (correction_lineage linkage) AND guarded per-row, so a second run
 * repairs zero rows and writes zero new events/lineage.
 *
 * The FIFO projection is safe under repair because the rebuild engine skips
 * superseded originals/reversals and lets each REPLACEMENT inherit its
 * original's stream position (S08 stream-position contract) — the effective
 * economic stream after repair is exactly the concrete action at the
 * original's slot.
 *
 * Pure domain function: operates only on the provided better-sqlite3 handle,
 * never imports Next.js or database initialization modules.
 */

import type Database from 'better-sqlite3';
import { toMicros, fromMicros } from './decimal';
import { postFinancialEvent } from './posting';
import { executionFinancialEventIdempotencyKey } from './execution-posting';
import {
  AmbiguousEconomicActionError,
  cashDirectionForEconomicAction,
  resolveEconomicExecutionAction,
  type EconomicAction,
  type PositionDirection,
} from './economic-action';
import { reverseAction } from './correction-contracts';
import {
  findCorrectionByOriginalExecution,
  findInstrumentById,
  insertAccountingExecution,
  insertCorrectionLineage,
} from '../../db/accounting-repository';
import { rebuildPositionsWithinTransaction } from '../positions/rebuild';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';

// ── Types ────────────────────────────────────────────────────────────────

/** A raw accounting_executions row (snake_case, as persisted). */
export interface AliasExecutionRow {
  id: string;
  account_id: string;
  instrument_id: string;
  action: string;
  quantity: string;
  price: string;
  fees: string;
  idempotency_key: string | null;
  journal_trade_id: string | null;
  description: string | null;
  posted_at: string;
  created_at: string;
}

/** An alias row that could not be repaired (no resolvable trade direction). */
export interface AliasRepairAnomaly {
  executionId: string;
  action: string;
  reason: string;
}

/** One repaired (or, in dry-run, planned) alias row. */
export interface AliasRepairDetail {
  originalId: string;
  action: string;
  direction: PositionDirection;
  concreteAction: EconomicAction;
  /** Reversal execution id; null in dry-run (not yet applied). */
  reversalId: string | null;
  /** Replacement execution id; null in dry-run (not yet applied). */
  replacementId: string | null;
  /** correction_lineage id; null in dry-run (not yet applied). */
  lineageId: string | null;
}

export interface AliasRepairResult {
  /** Alias rows scanned (the findAliasExecutions result size). */
  scanned: number;
  /** Rows repaired this run (dry-run always reports 0). */
  repaired: number;
  /** Rows already repaired by a prior run (lineage exists). */
  skipped: number;
  /** Rows with no resolvable trade direction — reported, not repaired. */
  anomalies: AliasRepairAnomaly[];
  /** Per-row outcomes; in dry-run the ids are null and nothing was written. */
  details: AliasRepairDetail[];
}

export interface RepairAliasExecutionsOptions {
  /** Report planned repairs without mutating the database. */
  dryRun?: boolean;
}

// ── Audit Query ──────────────────────────────────────────────────────────

/**
 * Find every accounting_executions row still carrying a workflow alias that
 * has NOT already been repaired.
 *
 * Originals are immutable (migration 0026 triggers forbid UPDATE/DELETE), so a
 * repaired alias row persists as a superseded original. It is excluded here
 * via correction_lineage so the audit surface is the EFFECTIVE invariant:
 * zero un-repaired alias rows — which is what the post-repair audit snapshot
 * (T02) and the slice demo ('zero add or reduce after repair') require.
 * Rows corrected through the normal correction flow are excluded the same way.
 *
 * Deterministic order (posted_at ASC, id ASC) so a repair run processes rows
 * in stream order.
 */
export function findAliasExecutions(
  sqlite: Database.Database,
): AliasExecutionRow[] {
  return sqlite
    .prepare(
      `SELECT ae.* FROM accounting_executions ae
       LEFT JOIN correction_lineage cl ON cl.original_execution_id = ae.id
       WHERE ae.action IN ('add', 'reduce')
         AND cl.id IS NULL
       ORDER BY ae.posted_at ASC, ae.id ASC`,
    )
    .all() as AliasExecutionRow[];
}

// ── Repair ───────────────────────────────────────────────────────────────

/**
 * Repair alias accounting_executions rows through the immutable correction
 * pattern (reversal + replacement + correction_lineage + projection rebuilds).
 *
 * For each alias row:
 *   1. Skip when correction_lineage already links this original (idempotent).
 *   2. Resolve direction from the linked trade (journal_trade_id → trades.direction).
 *      No linkage or missing trade → anomaly (never guessed).
 *   3. Resolve the concrete economic action for the direction, then reverse it.
 *   4. dryRun → record the planned repair, continue.
 *   5. Atomically (per-row transaction):
 *      a. insert reversal execution + post its trade_execution event
 *      b. insert replacement execution (concrete action) + post its event
 *      c. insert correction_lineage (idempotency key `audit-repair:<id>`)
 *      d. rebuild FIFO positions + account performance INSIDE the transaction
 *         (fail closed: a projection failure rolls the row's repair back)
 *
 * @param sqlite  - Raw better-sqlite3 handle.
 * @param options - Optional dry-run mode.
 * @returns Structured audit result (scanned/repaired/skipped/anomalies/details).
 * @throws {Error} With the failing execution id when a row's rebuild fails —
 *   that row's repair rolls back; previously repaired rows stay committed and
 *   are skipped on re-run.
 */
export function repairAliasExecutions(
  sqlite: Database.Database,
  options?: RepairAliasExecutionsOptions,
): AliasRepairResult {
  // One repair timestamp shared across the whole invocation (deterministic
  // audit trail — every event written by this call carries the same instant).
  const repairTimestamp = new Date().toISOString();
  const dryRun = options?.dryRun ?? false;

  const rows = findAliasExecutions(sqlite);
  const result: AliasRepairResult = {
    scanned: rows.length,
    repaired: 0,
    skipped: 0,
    anomalies: [],
    details: [],
  };

  for (const row of rows) {
    // ── Idempotency guard: already repaired? ───────────────────────────
    const existingLineage = findCorrectionByOriginalExecution(sqlite, row.id);
    if (existingLineage) {
      result.skipped += 1;
      continue;
    }

    // ── Resolve direction from the linked trade ────────────────────────
    let direction: PositionDirection | null = null;
    if (row.journal_trade_id) {
      const trade = sqlite
        .prepare('SELECT direction FROM trades WHERE id = ?')
        .get(row.journal_trade_id) as { direction: PositionDirection } | undefined;
      direction = trade?.direction ?? null;
    }
    if (!direction) {
      result.anomalies.push({
        executionId: row.id,
        action: row.action,
        reason: row.journal_trade_id
          ? `linked trade ${row.journal_trade_id} not found`
          : 'no journal_trade_id — direction unresolvable',
      });
      continue;
    }

    // ── Resolve the concrete economic action for the direction ─────────
    let concreteAction: EconomicAction;
    try {
      concreteAction = resolveEconomicExecutionAction(row.action, direction);
    } catch (err) {
      result.anomalies.push({
        executionId: row.id,
        action: row.action,
        reason:
          err instanceof AmbiguousEconomicActionError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
      });
      continue;
    }
    // Concrete actions are always reversible to another concrete action.
    const reversalAction = reverseAction(concreteAction) as EconomicAction;

    // ── dry-run: report the plan, mutate nothing ───────────────────────
    if (dryRun) {
      result.details.push({
        originalId: row.id,
        action: row.action,
        direction,
        concreteAction,
        reversalId: null,
        replacementId: null,
        lineageId: null,
      });
      continue;
    }

    // ── Apply the repair atomically for this row ───────────────────────
    const detail = sqlite.transaction((): AliasRepairDetail => {
      const instrument = findInstrumentById(sqlite, row.instrument_id);
      const symbol = instrument?.symbol ?? 'UNKNOWN';

      const reversalDescription =
        `Audit repair reversal for ${row.id}: ${reversalAction} ${row.quantity} ${symbol} @ ${row.price}`;
      const replacementDescription =
        `Audit repair replacement for ${row.id}: ${concreteAction} ${row.quantity} ${symbol} @ ${row.price}`;

      // Gross consideration (quantity × price) in micros, shared by the
      // reversal and replacement events (they cancel: net zero cash delta).
      const considerationMicros = computeConsiderationMicros(row.quantity, row.price);

      // ── a. Reversal execution + event ────────────────────────────────
      const reversalExecution = insertAccountingExecution(sqlite, {
        accountId: row.account_id,
        instrumentId: row.instrument_id,
        action: reversalAction,
        quantity: row.quantity,
        price: row.price,
        fees: row.fees,
        idempotencyKey: null, // internal accounting machinery — no public key
        journalTradeId: row.journal_trade_id,
        description: reversalDescription,
        postedAt: repairTimestamp,
      });

      postFinancialEvent(sqlite, {
        accountId: row.account_id,
        eventType: 'trade_execution',
        amount: fromMicros(considerationMicros),
        idempotencyKey: executionFinancialEventIdempotencyKey(reversalExecution.id),
        description: reversalDescription,
        payload: JSON.stringify({
          action: reversalAction,
          symbol,
          quantity: row.quantity,
          price: row.price,
          fees: row.fees,
          correctionType: 'reversal',
          originalExecutionId: row.id,
          repairType: 'alias_action_repair',
        }),
        effect: JSON.stringify({
          kind: 'cash',
          direction: cashDirectionForEconomicAction(reversalAction),
          amount: fromMicros(considerationMicros),
          amountMicros: considerationMicros,
        }),
        postedAt: repairTimestamp,
      });

      // ── b. Replacement execution (concrete action) + event ───────────
      const replacementExecution = insertAccountingExecution(sqlite, {
        accountId: row.account_id,
        instrumentId: row.instrument_id,
        action: concreteAction,
        quantity: row.quantity,
        price: row.price,
        fees: row.fees,
        idempotencyKey: null,
        journalTradeId: row.journal_trade_id,
        description: replacementDescription,
        postedAt: repairTimestamp,
      });

      postFinancialEvent(sqlite, {
        accountId: row.account_id,
        eventType: 'trade_execution',
        amount: fromMicros(considerationMicros),
        idempotencyKey: executionFinancialEventIdempotencyKey(replacementExecution.id),
        description: replacementDescription,
        payload: JSON.stringify({
          action: concreteAction,
          symbol,
          quantity: row.quantity,
          price: row.price,
          fees: row.fees,
          correctionType: 'replacement',
          originalExecutionId: row.id,
          repairType: 'alias_action_repair',
        }),
        effect: JSON.stringify({
          kind: 'cash',
          direction: cashDirectionForEconomicAction(concreteAction),
          amount: fromMicros(considerationMicros),
          amountMicros: considerationMicros,
        }),
        postedAt: repairTimestamp,
      });

      // ── c. correction_lineage record ─────────────────────────────────
      const lineage = insertCorrectionLineage(sqlite, {
        accountId: row.account_id,
        originalExecutionId: row.id,
        reversalExecutionId: reversalExecution.id,
        replacementExecutionId: replacementExecution.id,
        idempotencyKey: `audit-repair:${row.id}`,
        reason: `S07 canonical data audit: repair alias action ${row.action} → ${concreteAction}`,
        correctedAt: repairTimestamp,
      });

      // ── d. Projection rebuilds INSIDE the transaction (fail closed) ──
      // The rebuild engine excludes superseded originals/reversals and gives
      // the replacement the original's stream slot (S08), so the effective
      // stream after repair is the concrete action at the original's position.
      rebuildPositionsWithinTransaction(sqlite, row.account_id, row.instrument_id);
      const performance = rebuildAccountPerformance(sqlite, row.account_id);
      if (!performance.success) {
        throw new Error(
          `Alias repair failed for execution ${row.id}: account-performance rebuild returned ` +
            `success=false${performance.error ? ` — ${performance.error}` : ''}`,
        );
      }

      return {
        originalId: row.id,
        action: row.action,
        direction,
        concreteAction,
        reversalId: reversalExecution.id,
        replacementId: replacementExecution.id,
        lineageId: lineage.id,
      };
    });

    let applied: AliasRepairDetail;
    try {
      applied = detail();
    } catch (err) {
      // Add the failing execution id to the context so the operator can
      // triage which row blocked the run (previous rows stay repaired and
      // are skipped on re-run via the idempotency guard).
      throw new Error(
        `Alias repair failed for execution ${row.id}: ` +
          (err instanceof Error ? err.message : String(err)),
        { cause: err },
      );
    }

    result.repaired += 1;
    result.details.push(applied);
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Compute the gross consideration (quantity × price) in micros.
 * Mirrors the correction kernel's arithmetic (BigInt-safe).
 */
function computeConsiderationMicros(quantity: string, price: string): number {
  const qMicros = toMicros(quantity);
  const pMicros = toMicros(price);
  const prodBig = BigInt(qMicros) * BigInt(pMicros);
  return Number(prodBig / BigInt(1_000_000));
}
