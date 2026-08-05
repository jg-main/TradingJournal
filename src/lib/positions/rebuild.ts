/**
 * FIFO position rebuild engine.
 *
 * Reads immutable accounting execution events in deterministic order,
 * invokes the pure FIFO allocator for each execution, and persists
 * replaceable projection rows (account_positions, fifo_lots, lot_matches).
 *
 * The projection is fully rebuildable: clearing existing rows and replaying
 * all executions produces byte-identical output.  Rebuilds can be scoped
 * to a single (account, instrument) pair or run for an entire account.
 *
 * Pure projection logic — all side effects go through the repository module
 * and the caller-provided SQLite handle.
 */

import Database from 'better-sqlite3';

import { allocateFifo } from './fifo';
import type {
  FifoLot,
  LotMatch,
  PositionState,
  RebuildResult,
  FifoExecutionInput,
} from './types';
import type { CanonicalDecimal } from '../accounting/types';
import {
  deleteProjectionByAccountInstrument,
  upsertAccountPosition,
  listAccountingExecutions,
} from '../../db/accounting-repository';


// ── Rebuild ──────────────────────────────────────────────────────────────

/**
 * Rebuild the FIFO position projection for an account + instrument.
 *
 * 1. Clear the existing projection rows (account_positions, fifo_lots,
 *    lot_matches) for the given account + instrument.
 * 2. Read ALL accounting_executions for the account + instrument in
 *    deterministic order (posted_at ASC, id ASC).
 * 3. For each execution, invoke the pure FIFO allocator against the
 *    in-memory accumulator for that (account_id, instrument_id) pair.
 * 4. Persist the final position state, all open FIFO lots, and all
 *    lot matches as replaceable projection rows.
 * 5. Return the aggregated RebuildResult.
 *
 * The rebuild is deterministic — identical input data always produces
 * identical output rows (except for auto-generated UUIDs, which are
 * fine since the projection is replaceable by design).
 *
 * @param sqlite       - Raw better-sqlite3 Database handle.
 * @param accountId    - The account to rebuild positions for.
 * @param instrumentId - The specific instrument to rebuild (omit to rebuild all).
 * @returns RebuildResult with computed positions, lots, and matches.
 */
export function rebuildPositions(
  sqlite: Database.Database,
  accountId: string,
  instrumentId?: string,
  options?: { withinTransaction?: boolean },
): RebuildResult {
  const rebuild = () => {
    // ── 1. Clear existing projection rows ──────────────────────────────
    if (instrumentId) {
      deleteProjectionByAccountInstrument(sqlite, accountId, instrumentId);
    } else {
      // Full account rebuild — clear all
      sqlite
        .prepare(
          `DELETE FROM lot_matches WHERE closing_execution_id IN (
             SELECT id FROM accounting_executions WHERE account_id = ?
           )`,
        )
        .run(accountId);
      sqlite.prepare('DELETE FROM fifo_lots WHERE account_id = ?').run(accountId);
      sqlite.prepare('DELETE FROM account_positions WHERE account_id = ?').run(accountId);
    }

    // ── 2. Read all executions in deterministic order ──────────────────
    const rawExecutions = listAccountingExecutions(sqlite, accountId, {
      instrumentId,
      limit: 100000, // High limit to avoid pagination during rebuild
      offset: 0,
    });

    // Corrections are reversal-and-replacement pairs. Projection replay must
    // consume the replacement once, not replay the invalid original and its
    // compensating reversal (which can transiently create impossible lots).
    const supersededRows = sqlite
      .prepare(
        `SELECT original_execution_id AS execution_id FROM correction_lineage WHERE account_id = ?
         UNION ALL
         SELECT reversal_execution_id AS execution_id FROM correction_lineage WHERE account_id = ?`,
      )
      .all(accountId, accountId) as Array<{ execution_id: string }>;
    const supersededExecutionIds = new Set(supersededRows.map((row) => row.execution_id));
    const executions = rawExecutions.filter((execution) => !supersededExecutionIds.has(execution.id));

    if (executions.length === 0) {
      return {
        positions: new Map<string, PositionState>(),
        openLots: [] as FifoLot[],
        allMatches: [] as LotMatch[],
        executionCount: 0,
        lotCount: 0,
        matchCount: 0,
      } as RebuildResult;
    }

    // ── 3. Accumulate per (accountId, instrumentId) ────────────────────
    // Key: `${accountId}:${instrumentId}`
    const accumulators = new Map<
      string,
      {
        position: PositionState | null;
        lots: FifoLot[];
        allMatches: LotMatch[];
        allNewLots: FifoLot[];
      }
    >();

    let idCounter = 0;
    const idGen = () => {
      idCounter++;
      const hex = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
      return `rb-${idCounter}-${hex}`;
    };

    for (const exec of executions) {
      const key = `${accountId}:${exec.instrument_id}`;
      let acc = accumulators.get(key);
      if (!acc) {
        acc = { position: null, lots: [], allMatches: [], allNewLots: [] };
        accumulators.set(key, acc);
      }

      const currentLots = acc.lots;
      const currentPosition = acc.position;

      // Build FifoExecutionInput from the execution row
      const fifoInput: FifoExecutionInput = {
        executionId: exec.id,
        accountId: exec.account_id,
        instrumentId: exec.instrument_id,
        action: exec.action as FifoExecutionInput['action'],
        quantity: exec.quantity as CanonicalDecimal,
        price: exec.price as CanonicalDecimal,
        fees: exec.fees as CanonicalDecimal,
        postedAt: exec.posted_at,
      };

      // Invoke the pure FIFO allocator
      const result = allocateFifo(
        fifoInput,
        currentPosition,
        currentLots,
        idGen,
      );

      if (result.status === 'rejected') {
        // A restore must fail closed when immutable source events cannot be
        // replayed. Best-effort rebuild callers retain the historical skip
        // behavior, but transactional restore callers must roll back rather
        // than commit source rows without matching projections.
        if (options?.withinTransaction) {
          throw new Error(
            `FIFO rebuild rejected execution ${exec.id}: ${result.code} — ${result.message}`,
          );
        }
        continue;
      }

      // Update accumulator with the result
      acc.position = result.position;
      acc.lots = result.position.openLots;
      acc.allMatches.push(...result.matches);
      acc.allNewLots.push(...result.openedLots);
    }

    // ── 4. Persist projection rows ─────────────────────────────────────
    const persistedPositions = new Map<string, PositionState>();
    let lotCount = 0;
    let matchCount = 0;
    const insertLot = sqlite.prepare(
      `INSERT INTO fifo_lots
       (id, account_id, instrument_id, direction, remaining_quantity,
        original_quantity, entry_price, cost_basis_total, allocated_fees,
        opening_execution_id, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMatch = sqlite.prepare(
      `INSERT INTO lot_matches
       (id, closing_execution_id, lot_id, match_quantity, match_price,
        realized_gross_pnl, allocated_fees, realized_net_pnl, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const [key, acc] of accumulators.entries()) {
      const pos = acc.position!;

      // ── Persist position ─────────────────────────────────────────────
      upsertAccountPosition(sqlite, {
        accountId: pos.accountId,
        instrumentId: pos.instrumentId,
        direction: pos.direction,
        quantity: pos.quantity,
        averageCost: pos.averageCost,
        totalCostBasis: pos.totalCostBasis,
        realizedGrossPnl: pos.realizedGrossPnl,
        realizedFees: pos.realizedFees,
        realizedNetPnl: pos.realizedNetPnl,
        lastUpdated: pos.lastUpdated,
      });
      persistedPositions.set(key, pos);

      // Keep closed lots for lot_match foreign-key history, but persist them
      // with zero remaining quantity so neither API nor UI can mistake them
      // for current open lots.
      const lotsById = new Map<string, FifoLot>();
      for (const lot of acc.allNewLots) lotsById.set(lot.id, { ...lot });
      for (const match of acc.allMatches) {
        const lot = lotsById.get(match.lotId);
        if (lot) lotsById.set(match.lotId, { ...lot, remainingQuantity: '0.00' as CanonicalDecimal });
      }
      for (const lot of acc.lots) lotsById.set(lot.id, { ...lot });

      for (const lot of lotsById.values()) {
        insertLot.run(
          lot.id,
          lot.accountId,
          lot.instrumentId,
          lot.direction,
          lot.remainingQuantity,
          lot.originalQuantity,
          lot.entryPrice,
          lot.costBasisTotal,
          lot.allocatedFees,
          lot.openingExecutionId,
          lot.openedAt,
        );
        lotCount++;
      }

      // ── Persist all matches ──────────────────────────────────────────
      for (const m of acc.allMatches) {
        const matchId = `rm-${matchCount + 1}-${Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0')}`;
        insertMatch.run(
          matchId,
          m.closingExecutionId,
          m.lotId,
          m.matchQuantity,
          m.matchPrice,
          m.realizedGrossPnl,
          m.allocatedFees,
          m.realizedNetPnl,
          m.sequence,
        );
        matchCount++;
      }
    }

    // ── 5. Build the open lots view (only lots with remaining_quantity > "0.00") ──
    const allOpenLots: FifoLot[] = [];
    for (const acc of accumulators.values()) {
      if (acc.position) {
        allOpenLots.push(...acc.position.openLots);
      }
    }

    // ── 6. Build all matches ───────────────────────────────────────────
    const allMatches: LotMatch[] = [];
    for (const acc of accumulators.values()) {
      allMatches.push(...acc.allMatches);
    }

    const result: RebuildResult = {
      positions: persistedPositions,
      openLots: allOpenLots,
      allMatches,
      executionCount: executions.length,
      lotCount,
      matchCount,
    };

    return result;
  };

  return options?.withinTransaction ? rebuild() : sqlite.transaction(rebuild)();
}

/**
 * Rebuild projections while an outer transaction already owns the SQLite
 * connection. SQLite does not support starting a nested transaction, so
 * restore uses this explicit entry point after replacing source rows.
 */
export function rebuildPositionsWithinTransaction(
  sqlite: Database.Database,
  accountId: string,
  instrumentId?: string,
): RebuildResult {
  return rebuildPositions(sqlite, accountId, instrumentId, { withinTransaction: true });
}
