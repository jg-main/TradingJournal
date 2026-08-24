/**
 * trade-correction-lifecycle.ts
 *
 * S06/T02-T03 — deterministic trade lifecycle rebuild and initial risk
 * snapshot repair after an accounting execution correction.
 *
 * When a trade-scoped correction changes the effective execution set
 * (reversal + replacement), the journal must stay coherent with accounting
 * truth:
 *
 *   - a closed trade whose exit fill is corrected to a smaller quantity
 *     reopens (status: open, closedAt: null)
 *   - an open trade whose partial exit is corrected upward can reclose
 *   - a corrected first entry shifts openedAt to the replacement's timeline
 *   - a corrected first entry also invalidates the stored initial risk
 *     snapshot (initial entry price / quantity / derived risk values), which
 *     is repaired from the corrected entry values
 *
 * The effective execution set is derived by resolving correction_lineage:
 * for every corrected execution, the original and its reversal cancel out
 * economically; the replacement (and every uncorrected original) survives.
 *
 * Orchestration convention: this module owns the lineage resolution,
 * lifecycle derivation, and risk-snapshot repair orchestration. The pure
 * computation kernels (computeTradeMetrics, computeRiskSnapshotValues,
 * equity cascade) live in trade-metrics.ts / risk-snapshot.ts and are
 * imported here. Database access happens ONLY through injected handles: the
 * raw better-sqlite3 handle and the drizzle transaction passed by the
 * caller, so the module stays testable and the correction stays atomic.
 */

import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { AccountingExecutionRow } from '@/db/accounting-repository';
import {
  computeTradeMetrics,
  isEntryAction,
  type ExecutionData,
  type Direction,
  type TradeStatus,
} from '@/lib/trade-metrics';
import { computeRiskSnapshotValues } from '@/lib/risk-snapshot';
import { resolveExecutionEquityContext } from '@/lib/execution-equity';

// The drizzle transaction type produced by db.transaction() (same extraction
// pattern as trade-execution-engine.ts). Repair writes go through this tx so
// they commit or roll back with the rest of the correction.
type EngineTx = BetterSQLite3Database<typeof schema> extends {
  transaction<TReturn>(cb: (tx: infer TTx) => TReturn, config?: unknown): TReturn;
} ? TTx : never;

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

  // A replacement occupies its ORIGINAL's stream position: the reversal
  // cancels the original at the original's posted_at slot, and the
  // replacement is the true economic fill at that same slot. Ordering
  // replacements by their own posted_at (correction time) would let a fill
  // posted between the original and the correction (e.g. an exit in the
  // same 1-2ms window) sort BEFORE the replacement — journal metrics would
  // derive the open quantity from an order the accounting FIFO replay
  // rejects (S08 zero-divergence contract). Inheriting the original's
  // posted_at makes the effective stream order identical to rebuild.ts and
  // deterministic regardless of wall-clock spacing between fills and the
  // correction.
  const streamPositionRows = sqlite
    .prepare(
      `SELECT cl.replacement_execution_id AS execution_id,
              orig.posted_at AS stream_posted_at
       FROM correction_lineage cl
       JOIN accounting_executions orig ON orig.id = cl.original_execution_id
       WHERE cl.original_execution_id IN (
         SELECT id FROM accounting_executions WHERE journal_trade_id = ?
       )`,
    )
    .all(tradeId) as Array<{ execution_id: string; stream_posted_at: string }>;
  const streamPositions = new Map(
    streamPositionRows.map((r) => [r.execution_id, r.stream_posted_at]),
  );

  return rows
    .filter((row) => !excluded.has(row.id))
    .map((row) => ({
      execution: {
        id: row.id,
        action: row.action,
        quantity: Number(row.quantity),
        price: Number(row.price),
        fees: row.fees === null ? null : Number(row.fees),
        executedAt: row.posted_at,
      },
      // Internal sort key: the original's stream position for replacements.
      streamPostedAt: streamPositions.get(row.id) ?? row.posted_at,
    }))
    .sort((a, b) => {
      const t = a.streamPostedAt.localeCompare(b.streamPostedAt);
      if (t !== 0) return t;
      // A replacement inherits its original's stream slot: when a later fill
      // shares the same timestamp (same-ms window), the replacement must
      // still precede it so metrics never derive from an order the
      // accounting FIFO replay rejects.
      const aIsReplacement = streamPositions.has(a.execution.id) ? 0 : 1;
      const bIsReplacement = streamPositions.has(b.execution.id) ? 0 : 1;
      if (aIsReplacement !== bIsReplacement) return aIsReplacement - bIsReplacement;
      return (a.execution.id ?? '').localeCompare(b.execution.id ?? '');
    })
    .map(({ execution }) => execution);
}

// ── Read-Surface Execution Resolution ──────────────────────────────────

/**
 * Resolve the execution set that read surfaces (trades list, trades detail,
 * dashboard) must feed into computeTradeMetrics for a trade.
 *
 * S08 zero-divergence contract: after an economic correction, the immutable
 * trade_executions journal still holds the original fills while the
 * accounting_executions + correction_lineage stream holds the effective
 * (reversal + replacement resolved) set. Read surfaces must derive metrics
 * from the EFFECTIVE set whenever corrections exist, otherwise the /trades
 * surfaces diverge from positions/overview/ledger/performance (e.g. a
 * corrected entry that reopens a trade reports flat in list/detail while
 * positions show the reopened quantity).
 *
 * Falls back to the journal rows (mapped to ExecutionData) when the trade
 * has no corrections, so the common path is byte-identical to previous
 * behavior and adds no accounting queries.
 *
 * @param sqlite      - Raw better-sqlite3 handle (read-only use).
 * @param tradeId     - The journal trade id.
 * @param journalRows - The raw trade_executions rows already loaded by the route.
 * @returns ExecutionData-compatible executions for computeTradeMetrics.
 */
export function resolveTradeMetricsExecutions(
  sqlite: Database.Database,
  tradeId: string,
  journalRows: Array<{
    id: string;
    action: string;
    quantity: number;
    price: number;
    fees: number | null;
    executedAt: string | null;
    createdAt: string | null;
  }>,
): ExecutionData[] {
  const hasCorrections = sqlite
    .prepare(
      `SELECT 1 FROM correction_lineage cl
       WHERE cl.original_execution_id IN (
         SELECT id FROM accounting_executions WHERE journal_trade_id = ?
       )
          OR cl.reversal_execution_id IN (
         SELECT id FROM accounting_executions WHERE journal_trade_id = ?
       )
          OR cl.replacement_execution_id IN (
         SELECT id FROM accounting_executions WHERE journal_trade_id = ?
       )
       LIMIT 1`,
    )
    .get(tradeId, tradeId, tradeId);

  if (!hasCorrections) {
    return journalRows.map((r) => ({
      id: r.id,
      action: r.action,
      quantity: r.quantity,
      price: r.price,
      fees: r.fees,
      executedAt: r.executedAt ?? r.createdAt ?? '',
    }));
  }

  return resolveEffectiveExecutions(sqlite, tradeId);
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

// ── First-Entry Resolution ─────────────────────────────────────────────

/**
 * Resolve the first (earliest) entry-action execution of an execution set.
 *
 * Entries are entry actions for the direction (buy/add for long,
 * sell_short/add for short). Ordering matches computeTradeMetrics: executedAt
 * ASC, then id ASC as a deterministic tiebreaker. Returns null when the set
 * has no entry actions.
 */
export function resolveFirstEntry(
  executions: ExecutionData[],
  direction: Direction,
): ExecutionData | null {
  return (
    executions
      .filter((e) => isEntryAction(e.action, direction))
      .sort((a, b) => {
        const t = new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime();
        if (t !== 0) return t;
        return (a.id ?? '').localeCompare(b.id ?? '');
      })[0] ?? null
  );
}

// ── Risk Snapshot Repair ───────────────────────────────────────────────

/** The stored risk-snapshot fields that repair may update (row-shaped). */
export interface RiskSnapshotRepairValues {
  initialEntryPrice: number | null;
  initialQuantity: number | null;
  initialStopPrice: number | null;
  riskPerShare: number | null;
  initialRiskAmount: number | null;
  accountRiskPct: number | null;
  accountEquityAtOpen: number | null;
}

export interface RiskSnapshotRepairResult {
  /** True when the snapshot row was actually updated. */
  repaired: boolean;
  /** Why repair did or did not happen. */
  reason:
    | 'no-snapshot' // trade has no risk snapshot row — nothing to repair
    | 'no-entry' // corrected execution is not an entry (or replacement is an exit)
    | 'first-entry-unchanged' // the corrected execution was not the first entry
    | 'repaired';
  /** Snapshot values before repair (null when no snapshot existed). */
  oldValues: RiskSnapshotRepairValues | null;
  /** Snapshot values after repair (null when no update happened). */
  newValues: RiskSnapshotRepairValues | null;
}

/**
 * Repair the trade's initial risk snapshot after a correction that changed
 * the first entry.
 *
 * The trade_risk_snapshots row records the risk profile AT OPEN (initial
 * entry price, quantity, stop price, risk per share, initial risk amount,
 * account risk percentage, equity at open). When the corrected execution WAS
 * the first entry, those stored values are stale and must be recomputed from
 * the corrected entry values through the canonical computeRiskSnapshotValues
 * kernel.
 *
 * Repair is skipped when:
 *   - no risk snapshot exists for the trade (nothing to repair; a planned
 *     trade that never filled has no snapshot and none is created here)
 *   - the corrected execution was NOT the first entry (correcting a later
 *     add/reduce does not change the open-time risk profile)
 *   - the replacement is not an entry action for the direction (no valid
 *     entry values to snapshot)
 *
 * Stop price resolution preserves the open-time stop: the snapshot's stored
 * initialStopPrice wins (it is the stop actually used at open and is never
 * reconstructed), then the trade's plannedStop, then the latest stop
 * adjustment as the best available proxy.
 *
 * Equity at open is re-resolved through the shared A2 execution-equity
 * resolver (resolveExecutionEquityContext) at the corrected effective
 * timestamp, and its provenance is persisted with the repaired values.
 *
 * All writes go through the injected drizzle transaction so the repair
 * commits or rolls back with the rest of the correction.
 *
 * @returns The old and new risk values (for logging) plus the outcome.
 */
export function repairRiskSnapshot(params: {
  tx: EngineTx;
  sqlite: Database.Database;
  tradeId: string;
  accountId: string;
  direction: Direction;
  /** Id of the first entry of the PRE-correction effective set (null when the trade had no entry). */
  preCorrectionFirstEntryId: string | null;
  /** Id of the accounting execution being corrected. */
  correctedOriginalId: string;
  /** The replacement execution produced by the correction (canonical decimals). */
  replacementExecution: { price: string; quantity: string; action: string } | null;
  /** The trade's planned stop (trades.planned_stop). */
  plannedStop: number | null;
  /** Corrected effective timestamp (replacement posted_at) for equity resolution (A2). */
  asOf: string;
}): RiskSnapshotRepairResult {
  const {
    tx,
    sqlite,
    tradeId,
    accountId,
    direction,
    preCorrectionFirstEntryId,
    correctedOriginalId,
    replacementExecution,
    plannedStop,
    asOf,
  } = params;

  // 1. Existing snapshot required — repair never creates one.
  const existing = tx
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, tradeId))
    .get();
  if (!existing) {
    return { repaired: false, reason: 'no-snapshot', oldValues: null, newValues: null };
  }

  const oldValues = rowToRepairValues(existing);

  // 2. The correction must have targeted the first entry. Correcting a later
  //    add/reduce leaves the open-time risk profile intact.
  if (
    preCorrectionFirstEntryId == null ||
    preCorrectionFirstEntryId !== correctedOriginalId
  ) {
    return { repaired: false, reason: 'first-entry-unchanged', oldValues, newValues: null };
  }

  // 3. The replacement must be an entry for the direction, otherwise there is
  //    no valid first-entry value to snapshot (e.g. an entry corrected into
  //    an exit action).
  if (!replacementExecution || !isEntryAction(replacementExecution.action, direction)) {
    return { repaired: false, reason: 'no-entry', oldValues, newValues: null };
  }

  const entryPrice = Number(replacementExecution.price);
  const entryQuantity = Number(replacementExecution.quantity);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryQuantity <= 0) {
    return { repaired: false, reason: 'no-entry', oldValues, newValues: null };
  }

  // 4. Resolve stop price and equity, then recompute through the canonical
  //    kernel (computeRiskSnapshotValues — same function the creation path
  //    uses in trade-execution-engine.maybeCreateRiskSnapshot). Equity is
  //    resolved via the shared A2 resolver at the corrected effective
  //    timestamp, and its provenance is persisted.
  const stopPrice = resolveRepairStopPrice({
    storedInitialStop: existing.initialStopPrice,
    plannedStop,
    sqlite,
    tradeId,
  });
  const { equity: equityAtOpen, source: equitySource, asOf: equityAsOf } =
    resolveRepairEquity(sqlite, accountId, asOf);

  const newValues = computeRiskSnapshotValues({
    avgEntryPrice: entryPrice,
    initialQuantity: entryQuantity,
    initialStopPrice: stopPrice,
    direction,
    accountEquityAtOpen: equityAtOpen,
  });

  // 5. Persist the repaired values inside the caller's transaction, including
  //    the A2 equity provenance. Provenance is written ONLY when equity
  //    actually resolved — a null (unavailable) equity preserves the stored
  //    value and leaves existing provenance untouched (A2 §26: never fabricate
  //    provenance for values that did not resolve).
  const equityResolved = equityAtOpen != null;
  tx.update(schema.tradeRiskSnapshots)
    .set({
      initialEntryPrice: newValues.initialEntryPrice,
      initialQuantity: newValues.initialQuantity,
      initialStopPrice: newValues.initialStopPrice,
      riskPerShare: newValues.riskPerShare,
      initialRiskAmount: newValues.initialRiskAmount,
      accountRiskPct: newValues.accountRiskPct,
      ...(equityResolved ? { accountEquityAtOpen: equityAtOpen } : {}),
      ...(equityResolved && equitySource ? { accountEquitySource: equitySource } : {}),
      ...(equityResolved && equityAsOf != null ? { accountEquityAsOf: equityAsOf } : {}),
    })
    .where(eq(schema.tradeRiskSnapshots.tradeId, tradeId))
    .run();

  return {
    repaired: true,
    reason: 'repaired',
    oldValues,
    // Reflect what is actually persisted: when equity cannot be re-resolved the
    // stored value is preserved (matching the creation path's null-guard), so
    // the old → new log stays truthful.
    newValues: {
      ...newValues,
      accountEquityAtOpen: equityAtOpen ?? existing.accountEquityAtOpen,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function rowToRepairValues(
  row: typeof schema.tradeRiskSnapshots.$inferSelect,
): RiskSnapshotRepairValues {
  return {
    initialEntryPrice: row.initialEntryPrice,
    initialQuantity: row.initialQuantity,
    initialStopPrice: row.initialStopPrice,
    riskPerShare: row.riskPerShare,
    initialRiskAmount: row.initialRiskAmount,
    accountRiskPct: row.accountRiskPct,
    accountEquityAtOpen: row.accountEquityAtOpen,
  };
}

/**
 * Resolve the stop price for a repaired risk snapshot.
 *
 * The stored initialStopPrice is the stop actually used at open (and the
 * snapshot's "initial" semantics forbid reconstructing it), so it wins.
 * Falls back to the trade's planned stop, then the latest stop adjustment
 * as the best available proxy.
 */
function resolveRepairStopPrice(params: {
  storedInitialStop: number | null;
  plannedStop: number | null;
  sqlite: Database.Database;
  tradeId: string;
}): number | null {
  const { storedInitialStop, plannedStop, sqlite, tradeId } = params;
  if (storedInitialStop != null) return storedInitialStop;
  if (plannedStop != null) return plannedStop;

  const adjustment = sqlite
    .prepare(
      `SELECT new_stop FROM trade_stop_adjustments
       WHERE trade_id = ?
       ORDER BY COALESCE(adjusted_at, created_at) DESC, created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(tradeId) as { new_stop: number | null } | undefined;
  return adjustment?.new_stop ?? null;
}

/**
 * Resolve the canonical account equity at open for the risk snapshot repair
 * (M002-A2). Delegates to the shared execution-equity resolver — the SAME
 * one the engine uses for first-fill readiness / max-risk / snapshot — so a
 * correction-driven rebuild stays coherent with the creation path. Equity is
 * resolved at the corrected effective timestamp (the replacement execution's
 * posted_at) rather than wall-clock now.
 */
function resolveRepairEquity(
  sqlite: Database.Database,
  accountId: string,
  asOf: string,
): { equity: number | null; source: string; asOf: string | null } {
  const resolved = resolveExecutionEquityContext(sqlite, accountId, asOf);
  return {
    equity: resolved.equity,
    source: resolved.source,
    asOf: resolved.asOf ?? asOf,
  };
}
