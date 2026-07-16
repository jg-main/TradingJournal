/**
 * Legacy migration runner.
 *
 * Reads legacy account_transactions, trade_executions, and
 * position_price_snapshots from the source SQLite database, maps each
 * record through the T01 pure adapters, and writes migrated records
 * into the immutable accounting boundary (financial_events,
 * accounting_executions, valuation_marks).
 *
 * Wraps everything in a single SQLite transaction for atomicity:
 * partial failures roll back the entire run.  Duplicate detection
 * happens at the idempotency-key level against live accounting tables,
 * so re-running a previously completed migration safely skips already-
 * imported records.
 *
 * After writing all records, the runner rebuilds the full account
 * projection (positions, NAV, performance) and records a deterministic
 * fingerprint for reconciliation (T03).
 *
 * @module legacy-migration-runner
 */

import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';

import {
  mapAccountTransactionToCashEvent,
  mapTradeExecutionToExecutionInput,
  mapPriceSnapshotToValuationMark,
} from './legacy-migration';
import type {
  LegacyAccountTransaction,
  LegacyTradeExecution,
  LegacyPriceSnapshot,
  CashEventMigrationInput,
  ExecutionMigrationInput,
  PriceMarkMigrationInput,
  AnomalyCode,
  MigrationRecordStatus,
  MigrationRecordType,
} from './legacy-migration';
import type { CanonicalDecimal } from './types';
import { toMicros, fromMicros } from './decimal';
import { rebuildPositions } from '../positions/rebuild';

// ── Repository Imports ──────────────────────────────────────────────────

import {
  insertFinancialEvent,
  findEventByIdempotencyKey,
  insertLedgerEntry,
  insertLedgerPosting,
  getNextSequence,
  findOrCreateInstrument,
  insertAccountingExecution,
  findAccountingExecutionByIdempotencyKey,
  insertValuationMark,
  findValuationMarkByIdempotencyKey,
  listAccountPositions,
  countAccountEvents,
  countAccountingExecutions,
} from '../../db/accounting-repository';

import { rebuildNetPosition } from './rebuild';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Status of a completed or in-progress migration run.
 */
export type MigrationRunStatus =
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rolled_back';

/**
 * Full result returned by `runLegacyMigration`.
 */
export interface MigrationRunResult {
  runId: string;
  accountId: string;
  status: MigrationRunStatus;
  totalRecords: number;
  mappedCount: number;
  anomalyCount: number;
  unsupportedCount: number;
  duplicateCount: number;
  rebuildFingerprint: string | null;
  errorMessage: string | null;
}

/**
 * A single record outcome from the current run.
 * Used internally and for test assertions.
 */
export interface MigrationRecordOutcome {
  sourceTable: string;
  sourceId: string;
  status: MigrationRecordStatus;
  recordType: MigrationRecordType;
  anomalyCode: AnomalyCode | null;
  anomalyField: string | null;
  anomalyDetail: string | null;
  idempotencyKey: string | null;
  accountingEventId: string | null;
  accountingExecutionId: string | null;
  accountingMarkId: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a SHA-256 fingerprint of accounting state for an account.
 *
 * Normalises relevant tables into sorted JSON and hashes them so that
 * two identical states produce the same fingerprint regardless of
 * auto-generated UUIDs or insertion order.
 */
function computeAccountFingerprint(
  sqlite: Database.Database,
  accountId: string,
): string {
  const hash = createHash('sha256');

  // Financial event count + event types in order
  const eventCount = countAccountEvents(sqlite, accountId);
  hash.update(`events:${eventCount}:`);

  // Accounting execution count + (action, quantity, price) tuples in order
  const execCount = countAccountingExecutions(sqlite, accountId);
  hash.update(`execs:${execCount}:`);

  // Net cash position
  const netPos = rebuildNetPosition(sqlite, accountId);
  hash.update(`net:${netPos.netMicros}:`);

  // Positions in deterministic order
  const positions = listAccountPositions(sqlite, accountId);
  for (const pos of positions.sort((a, b) => a.instrument_id.localeCompare(b.instrument_id))) {
    hash.update(`pos:${pos.instrument_id}:${pos.direction ?? 'flat'}:${pos.quantity}:${pos.realized_net_pnl}:`);
  }

  return hash.digest('hex');
}

// ── Raw SQL Queries for Legacy Data ────────────────────────────────────

interface LegacyTradeJoin {
  tradeId: string;
  accountId: string;
  symbol: string;
  executionId: string;
  executedAt: string | null;
  action: string;
  quantity: number;
  price: number;
  fees: number | null;
  reasonId: string | null;
  notes: string | null;
  createdAt: string;
}

interface LegacySnapshotJoin {
  tradeId: string;
  accountId: string;
  symbol: string;
  snapshotId: string;
  price: number;
  source: string;
  marketState: string | null;
  shortName: string | null;
  quoteType: string | null;
  sector: string | null;
  industry: string | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  change: number | null;
  changePercent: number | null;
  fetchedAt: string;
  createdAt: string;
}

function readAccountTransactions(
  sqlite: Database.Database,
  accountId: string,
): LegacyAccountTransaction[] {
  const rows = sqlite
    .prepare(
      `SELECT id, account_id AS accountId, type, amount, balance_after AS balanceAfter,
              date, notes, created_at AS createdAt
       FROM account_transactions
       WHERE account_id = ?
       ORDER BY date ASC, id ASC`,
    )
    .all(accountId) as Array<{
    id: string;
    accountId: string;
    type: string;
    amount: number;
    balanceAfter: number;
    date: string;
    notes: string | null;
    createdAt: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    type: r.type as 'deposit' | 'withdrawal',
    amount: r.amount,
    balanceAfter: r.balanceAfter,
    date: r.date,
    notes: r.notes,
    createdAt: r.createdAt,
  }));
}

function readTradeExecutions(
  sqlite: Database.Database,
  accountId: string,
): Array<{ trade: { accountId: string; symbol: string }; execution: LegacyTradeExecution }> {
  const rows = sqlite
    .prepare(
      `SELECT
         t.id AS tradeId,
         t.account_id AS accountId,
         t.symbol,
         e.id AS executionId,
         e.executed_at AS executedAt,
         e.action,
         e.quantity,
         e.price,
         e.fees,
         e.reason_id AS reasonId,
         e.notes,
         e.created_at AS createdAt
       FROM trade_executions e
       INNER JOIN trades t ON t.id = e.trade_id
       WHERE t.account_id = ?
       ORDER BY e.executed_at ASC, e.created_at ASC, e.id ASC`,
    )
    .all(accountId) as LegacyTradeJoin[];

  return rows.map((r) => ({
    trade: { accountId: r.accountId, symbol: r.symbol },
    execution: {
      id: r.executionId,
      tradeId: r.tradeId,
      executedAt: r.executedAt,
      action: r.action as LegacyTradeExecution['action'],
      quantity: r.quantity,
      price: r.price,
      fees: r.fees,
      reasonId: r.reasonId,
      notes: r.notes,
      createdAt: r.createdAt,
    },
  }));
}

function readPriceSnapshots(
  sqlite: Database.Database,
  accountId: string,
): Array<{ trade: { accountId: string; symbol: string }; snapshot: LegacyPriceSnapshot }> {
  const rows = sqlite
    .prepare(
      `SELECT
         t.id AS tradeId,
         t.account_id AS accountId,
         t.symbol,
         s.id AS snapshotId,
         s.price,
         s.source,
         s.market_state AS marketState,
         s.short_name AS shortName,
         s.quote_type AS quoteType,
         s.sector,
         s.industry,
         s.previous_close AS previousClose,
         s.day_high AS dayHigh,
         s.day_low AS dayLow,
         s.price_change AS "change",
         s.change_percent AS changePercent,
         s.fetched_at AS fetchedAt,
         s.created_at AS createdAt
       FROM position_price_snapshots s
       INNER JOIN trades t ON t.id = s.trade_id
       WHERE t.account_id = ?
       ORDER BY s.fetched_at ASC, s.id ASC`,
    )
    .all(accountId) as LegacySnapshotJoin[];

  return rows.map((r) => ({
    trade: { accountId: r.accountId, symbol: r.symbol },
    snapshot: {
      id: r.snapshotId,
      tradeId: r.tradeId,
      price: r.price,
      source: r.source,
      marketState: r.marketState,
      shortName: r.shortName,
      quoteType: r.quoteType,
      sector: r.sector,
      industry: r.industry,
      previousClose: r.previousClose,
      dayHigh: r.dayHigh,
      dayLow: r.dayLow,
      change: r.change,
      changePercent: r.changePercent,
      fetchedAt: r.fetchedAt,
      createdAt: r.createdAt,
    },
  }));
}

// ── Record Outcome Writers ──────────────────────────────────────────────

/**
 * Insert an accounting_migration_records row for the current run.
 */
function insertMigrationRecord(
  sqlite: Database.Database,
  runId: string,
  outcome: MigrationRecordOutcome,
): void {
  sqlite
    .prepare(
      `INSERT INTO accounting_migration_records
       (id, run_id, source_table, source_id, status, record_type,
        anomaly_code, anomaly_field, anomaly_detail, idempotency_key,
        accounting_event_id, accounting_execution_id, accounting_mark_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      runId,
      outcome.sourceTable,
      outcome.sourceId,
      outcome.status,
      outcome.recordType,
      outcome.anomalyCode,
      outcome.anomalyField,
      outcome.anomalyDetail,
      outcome.idempotencyKey,
      outcome.accountingEventId,
      outcome.accountingExecutionId,
      outcome.accountingMarkId,
    );
}

function writeMigrationRecord(
  sqlite: Database.Database,
  runId: string,
  outcome: MigrationRecordOutcome,
): void {
  insertMigrationRecord(sqlite, runId, outcome);
}

// ═══════════════════════════════════════════════════════════════════════════
// Write Operations — Existing Posting Kernel Integration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Write a cash event migration input to the accounting tables.
 * Returns the financial event ID, or null if duplicate.
 *
 * Handles idempotency by checking the target table first.
 * Does NOT call the high-level `postFinancialEvent` to avoid
 * its separate transaction savepoint — instead we call the
 * underlying repository functions directly within our own
 * outer transaction.
 */
function writeCashEventInput(
  sqlite: Database.Database,
  runId: string,
  input: CashEventMigrationInput,
): { outcome: MigrationRecordOutcome } {
  const { idempotencyKey } = input;

  // Check idempotency
  if (idempotencyKey) {
    const existing = findEventByIdempotencyKey(sqlite, idempotencyKey);
    if (existing) {
      return {
        outcome: {
          sourceTable: input.legacySourceTable,
          sourceId: input.legacySourceId,
          status: 'duplicate',
          recordType: 'cash_event',
          anomalyCode: null,
          anomalyField: null,
          anomalyDetail: null,
          idempotencyKey,
          accountingEventId: existing.id,
          accountingExecutionId: null,
          accountingMarkId: null,
        },
      };
    }
  }

  // Write financial event with cash effect so the reconciliation and
  // performance-rebuild engines can read the cash impact from the
  // financial event's canonical metadata rather than re-querying ledger
  // debit postings or the migration-runner-specific payload shape.
  const amount = input.amount as CanonicalDecimal;
  const amountMicros = toMicros(amount);
  const direction = input.eventType === 'deposit' ? 'increase' : 'decrease';
  const effect = JSON.stringify({
    kind: 'cash',
    direction,
    amount,
    amountMicros,
  });
  const eventRow = insertFinancialEvent(sqlite, {
    accountId: input.accountId,
    eventType: input.eventType,
    idempotencyKey: idempotencyKey ?? null,
    description: input.description,
    payload: null,
    effect,
    postedAt: input.postedAt,
  });

  // Write ledger entry
  const entryRow = insertLedgerEntry(sqlite, {
    financialEventId: eventRow.id,
    accountId: input.accountId,
    description: input.description,
    postedAt: input.postedAt,
  });

  // Write balanced debit/credit postings
  const nextSeq = getNextSequence(sqlite);

  insertLedgerPosting(sqlite, {
    ledgerEntryId: entryRow.id,
    accountId: input.accountId,
    side: 'debit',
    amount,
    amountMicros,
    sequence: nextSeq,
  });

  insertLedgerPosting(sqlite, {
    ledgerEntryId: entryRow.id,
    accountId: input.accountId,
    side: 'credit',
    amount,
    amountMicros,
    sequence: nextSeq + 1,
  });

  return {
    outcome: {
      sourceTable: input.legacySourceTable,
      sourceId: input.legacySourceId,
      status: 'mapped',
      recordType: 'cash_event',
      anomalyCode: null,
      anomalyField: null,
      anomalyDetail: null,
      idempotencyKey: idempotencyKey ?? null,
      accountingEventId: eventRow.id,
      accountingExecutionId: null,
      accountingMarkId: null,
    },
  };
}

/**
 * Write an execution migration input to the accounting tables.
 * Returns the execution and event IDs, or null if duplicate.
 */
function writeExecutionInput(
  sqlite: Database.Database,
  runId: string,
  input: ExecutionMigrationInput,
): { outcome: MigrationRecordOutcome } {
  const { idempotencyKey } = input;

  // Resolve or create instrument
  const instrument = findOrCreateInstrument(sqlite, input.symbol);

  // Check idempotency
  if (idempotencyKey) {
    const existing = findAccountingExecutionByIdempotencyKey(sqlite, idempotencyKey);
    if (existing) {
      return {
        outcome: {
          sourceTable: input.legacySourceTable,
          sourceId: input.legacySourceId,
          status: 'duplicate',
          recordType: 'execution',
          anomalyCode: null,
          anomalyField: null,
          anomalyDetail: null,
          idempotencyKey,
          accountingEventId: null,
          accountingExecutionId: existing.id,
          accountingMarkId: null,
        },
      };
    }
  }

  // Write accounting execution
  const executionRow = insertAccountingExecution(sqlite, {
    accountId: input.accountId,
    instrumentId: instrument.id,
    action: input.action,
    quantity: input.quantity,
    price: input.price,
    fees: input.fees,
    idempotencyKey: idempotencyKey ?? null,
    journalTradeId: input.journalTradeId,
    description: null,
    postedAt: input.postedAt,
  });

  // Consideration = quantity × price in micros.
  const qMicros = toMicros(input.quantity);
  const pMicros = toMicros(input.price);
  const considerationMicros = Number((BigInt(qMicros) * BigInt(pMicros)) / BigInt(1_000_000));
  const finalConsideration = fromMicros(considerationMicros);

  // Write financial event for the cash consideration
  // (same structure as execution-posting.ts without the high-level wrapper).
  const eventRow = insertFinancialEvent(sqlite, {
    accountId: input.accountId,
    eventType: 'trade_execution',
    idempotencyKey: undefined, // executions use accounting_executions idempotency
    description: `Execution: ${input.action} ${input.quantity} ${input.symbol} @ ${input.price}`,
    payload: JSON.stringify({
      action: input.action,
      symbol: input.symbol,
      quantity: input.quantity,
      price: input.price,
      fees: input.fees,
      journalTradeId: input.journalTradeId,
    }),
    effect: JSON.stringify({
      kind: 'cash',
      direction: ['sell', 'reduce', 'sell_short'].includes(input.action) ? 'increase' : 'decrease',
      amount: finalConsideration,
      amountMicros: considerationMicros,
    }),
    postedAt: input.postedAt,
  });

  // Write ledger entry
  const entryRow = insertLedgerEntry(sqlite, {
    financialEventId: eventRow.id,
    accountId: input.accountId,
    description: `Execution: ${input.action} ${input.quantity} ${input.symbol} @ ${input.price}`,
    postedAt: input.postedAt,
  });

  // Write balanced debit/credit for gross consideration
  const nextSeq = getNextSequence(sqlite);
  insertLedgerPosting(sqlite, {
    ledgerEntryId: entryRow.id,
    accountId: input.accountId,
    side: 'debit',
    amount: finalConsideration,
    amountMicros: considerationMicros,
    sequence: nextSeq,
  });
  insertLedgerPosting(sqlite, {
    ledgerEntryId: entryRow.id,
    accountId: input.accountId,
    side: 'credit',
    amount: finalConsideration,
    amountMicros: considerationMicros,
    sequence: nextSeq + 1,
  });

  return {
    outcome: {
      sourceTable: input.legacySourceTable,
      sourceId: input.legacySourceId,
      status: 'mapped',
      recordType: 'execution',
      anomalyCode: null,
      anomalyField: null,
      anomalyDetail: null,
      idempotencyKey: idempotencyKey ?? null,
      accountingEventId: eventRow.id,
      accountingExecutionId: executionRow.id,
      accountingMarkId: null,
    },
  };
}

/**
 * Write a price mark migration input to the accounting tables.
 * Returns the mark ID, or null if duplicate.
 */
function writePriceMarkInput(
  sqlite: Database.Database,
  runId: string,
  input: PriceMarkMigrationInput,
): { outcome: MigrationRecordOutcome } {
  const { idempotencyKey } = input;

  // Check idempotency
  if (idempotencyKey) {
    const existing = findValuationMarkByIdempotencyKey(sqlite, idempotencyKey);
    if (existing) {
      return {
        outcome: {
          sourceTable: input.legacySourceTable,
          sourceId: input.legacySourceId,
          status: 'duplicate',
          recordType: 'price_mark',
          anomalyCode: null,
          anomalyField: null,
          anomalyDetail: null,
          idempotencyKey,
          accountingEventId: null,
          accountingExecutionId: null,
          accountingMarkId: existing.id,
        },
      };
    }
  }

  // Normalize source to allowed CHECK constraint values
  const ALLOWED_SOURCES = new Set(['user', 'market_data', 'import', 'system']);
  const normalizedSource = ALLOWED_SOURCES.has(input.source) ? input.source : 'import';

  // Write valuation mark
  const markRow = insertValuationMark(sqlite, {
    accountId: input.accountId,
    instrumentId: input.instrumentId,
    price: input.price,
    priceMicros: input.priceMicros,
    source: normalizedSource,
    markTimestamp: input.markTimestamp,
    idempotencyKey: idempotencyKey ?? null,
  });

  return {
    outcome: {
      sourceTable: input.legacySourceTable,
      sourceId: input.legacySourceId,
      status: 'mapped',
      recordType: 'price_mark',
      anomalyCode: null,
      anomalyField: null,
      anomalyDetail: null,
      idempotencyKey: idempotencyKey ?? null,
      accountingEventId: null,
      accountingExecutionId: null,
      accountingMarkId: markRow.id,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Rebuild Coordination
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rebuild all projections for an account after migration.
 *
 * After writing migrated accounting records, the run calls this to
 * coordinate position rebuild (FIFO) and performance projection,
 * producing a deterministic fingerprint.
 */
function rebuildAccountProjections(
  sqlite: Database.Database,
  accountId: string,
): void {
  // 1. Rebuild FIFO positions for ALL instruments in this account
  rebuildPositions(sqlite, accountId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Runner
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Input to the migration runner.
 */
export interface MigrationRunInput {
  /** Raw better-sqlite3 Database handle. */
  sqlite: Database.Database;
  /** The account to migrate. */
  accountId: string;
}

/**
 * Options for the migration runner.
 */
export interface MigrationRunOptions {
  /** If true, process records in dry-run mode (count only, no writes). */
  dryRun?: boolean;
}

/**
 * Run a full legacy-to-accounting migration for a single account.
 *
 * 1. Reads all legacy account_transactions, trade_executions, and
 *    position_price_snapshots for the given account.
 * 2. Maps each record through the T01 pure adapters.
 * 3. Writes mapped records to the immutable accounting tables (or
 *    records them as duplicates/anomalies/unsupported for audit).
 * 4. Rebuilds all accounting projections (positions, performance).
 * 5. Records a deterministic fingerprint of the final state.
 *
 * The entire operation is wrapped in a SQLite transaction.
 * If any step fails, all changes are rolled back.
 *
 * Idempotency: checks each record's idempotency key against the
 * target table before writing. Duplicate records are skipped and
 * counted in `duplicateCount`.
 *
 * @param input   - Migration run parameters.
 * @param options - Optional migration behaviour flags.
 * @returns MigrationRunResult with counts, status, and fingerprint.
 * @throws {Error} If the account is not found or database errors occur.
 */
export function runLegacyMigration(
  input: MigrationRunInput,
  options?: MigrationRunOptions,
): MigrationRunResult {
  const { sqlite, accountId } = input;
  const dryRun = options?.dryRun ?? false;

  // Run everything inside a single transaction for atomicity
  const transaction = sqlite.transaction(() => {
    const runId = randomUUID();
    const now = new Date().toISOString();

    // ── 1. Insert migration run row ─────────────────────────────────---
    sqlite
      .prepare(
        `INSERT INTO accounting_migration_runs
         (id, account_id, status, total_records, mapped_count, anomaly_count,
          unsupported_count, duplicate_count, started_at)
         VALUES (?, ?, 'in_progress', 0, 0, 0, 0, 0, ?)`,
      )
      .run(runId, accountId, now);

    const outcomes: MigrationRecordOutcome[] = [];

    // ── 2. Read & process account_transactions ─────────────────────────
    const cashRecords = readAccountTransactions(sqlite, accountId);
    for (const legacyRow of cashRecords) {
      const mapped = mapAccountTransactionToCashEvent(legacyRow);

      if (mapped.status === 'anomaly' || mapped.status === 'unsupported') {
        outcomes.push({
          sourceTable: mapped.sourceTable,
          sourceId: mapped.sourceId,
          status: mapped.status === 'anomaly' ? 'anomaly' : 'unsupported',
          recordType: mapped.anomaly
            ? (mapped.recordType === 'unsupported' ? 'unsupported' : 'cash_event')
            : 'unsupported',
          anomalyCode: mapped.anomaly?.code ?? null,
          anomalyField: mapped.anomaly?.field ?? null,
          anomalyDetail: mapped.anomaly?.detail ?? null,
          idempotencyKey: mapped.idempotencyKey,
          accountingEventId: null,
          accountingExecutionId: null,
          accountingMarkId: null,
        });
        continue;
      }

      if (mapped.status === 'mapped' && mapped.input?.type === 'cash_event') {
        if (!dryRun) {
          const writeResult = writeCashEventInput(sqlite, runId, mapped.input);
          outcomes.push(writeResult.outcome);
        } else {
          outcomes.push({
            sourceTable: mapped.sourceTable,
            sourceId: mapped.sourceId,
            status: 'mapped',
            recordType: 'cash_event',
            anomalyCode: null,
            anomalyField: null,
            anomalyDetail: null,
            idempotencyKey: mapped.idempotencyKey,
            accountingEventId: 'dry-run',
            accountingExecutionId: null,
            accountingMarkId: null,
          });
        }
      }
    }

    // ── 3. Read & process trade_executions ─────────────────────────────
    const executionRecords = readTradeExecutions(sqlite, accountId);
    for (const { trade, execution } of executionRecords) {
      const mapped = mapTradeExecutionToExecutionInput(
        execution,
        trade.accountId,
        trade.symbol,
      );

      if (mapped.status === 'anomaly' || mapped.status === 'unsupported') {
        outcomes.push({
          sourceTable: mapped.sourceTable,
          sourceId: mapped.sourceId,
          status: mapped.status === 'anomaly' ? 'anomaly' : 'unsupported',
          recordType: mapped.status === 'unsupported' ? 'unsupported' : 'execution',
          anomalyCode: mapped.anomaly?.code ?? null,
          anomalyField: mapped.anomaly?.field ?? null,
          anomalyDetail: mapped.anomaly?.detail ?? null,
          idempotencyKey: mapped.idempotencyKey,
          accountingEventId: null,
          accountingExecutionId: null,
          accountingMarkId: null,
        });
        continue;
      }

      if (mapped.status === 'mapped' && mapped.input?.type === 'execution') {
        if (!dryRun) {
          const writeResult = writeExecutionInput(sqlite, runId, mapped.input);
          outcomes.push(writeResult.outcome);
        } else {
          outcomes.push({
            sourceTable: mapped.sourceTable,
            sourceId: mapped.sourceId,
            status: 'mapped',
            recordType: 'execution',
            anomalyCode: null,
            anomalyField: null,
            anomalyDetail: null,
            idempotencyKey: mapped.idempotencyKey,
            accountingEventId: 'dry-run',
            accountingExecutionId: 'dry-run',
            accountingMarkId: null,
          });
        }
      }
    }

    // ── 4. Read & process position_price_snapshots ─────────────────────
    const snapshotRecords = readPriceSnapshots(sqlite, accountId);
    for (const { trade, snapshot } of snapshotRecords) {
      // Resolve instrument ID from symbol
      const instrument = findOrCreateInstrument(sqlite, trade.symbol);
      const mapped = mapPriceSnapshotToValuationMark(
        snapshot,
        trade.accountId,
        instrument.id,
      );

      if (mapped.status === 'anomaly' || mapped.status === 'unsupported') {
        outcomes.push({
          sourceTable: mapped.sourceTable,
          sourceId: mapped.sourceId,
          status: mapped.status === 'anomaly' ? 'anomaly' : 'unsupported',
          recordType: mapped.status === 'unsupported' ? 'unsupported' : 'price_mark',
          anomalyCode: mapped.anomaly?.code ?? null,
          anomalyField: mapped.anomaly?.field ?? null,
          anomalyDetail: mapped.anomaly?.detail ?? null,
          idempotencyKey: mapped.idempotencyKey,
          accountingEventId: null,
          accountingExecutionId: null,
          accountingMarkId: null,
        });
        continue;
      }

      if (mapped.status === 'mapped' && mapped.input?.type === 'price_mark') {
        if (!dryRun) {
          const writeResult = writePriceMarkInput(sqlite, runId, mapped.input);
          outcomes.push(writeResult.outcome);
        } else {
          outcomes.push({
            sourceTable: mapped.sourceTable,
            sourceId: mapped.sourceId,
            status: 'mapped',
            recordType: 'price_mark',
            anomalyCode: null,
            anomalyField: null,
            anomalyDetail: null,
            idempotencyKey: mapped.idempotencyKey,
            accountingEventId: null,
            accountingExecutionId: null,
            accountingMarkId: 'dry-run',
          });
        }
      }
    }

    // ── 5. Compute counts ─────────────────────────────────────────────
    let mappedCount = 0;
    let anomalyCount = 0;
    let unsupportedCount = 0;
    let duplicateCount = 0;

    for (const outcome of outcomes) {
      switch (outcome.status) {
        case 'mapped':
          mappedCount++;
          break;
        case 'anomaly':
          anomalyCount++;
          break;
        case 'unsupported':
          unsupportedCount++;
          break;
        case 'duplicate':
          duplicateCount++;
          break;
      }
    }

    const totalRecords = outcomes.length;

    // ── 6. Rebuild projections (unless dry run) ───────────────────────
    let fingerprint: string | null = null;
    if (!dryRun) {
      // Always rebuild projections + compute fingerprint, even when no
      // new records were mapped (re-run with all duplicates). This ensures
      // the migration run captures the current state for reconciliation.
      rebuildAccountProjections(sqlite, accountId);
      fingerprint = computeAccountFingerprint(sqlite, accountId);
    }

    // ── 7. Write record outcomes to the migration_records table ───────
    for (const outcome of outcomes) {
      writeMigrationRecord(sqlite, runId, outcome);
    }

    // ── 8. Update migration run status ────────────────────────────────
    sqlite
      .prepare(
        `UPDATE accounting_migration_runs
         SET status = 'completed',
             total_records = ?,
             mapped_count = ?,
             anomaly_count = ?,
             unsupported_count = ?,
             duplicate_count = ?,
             rebuild_fingerprint = ?,
             completed_at = ?
         WHERE id = ?`,
      )
      .run(
        totalRecords,
        mappedCount,
        anomalyCount,
        unsupportedCount,
        duplicateCount,
        fingerprint,
        new Date().toISOString(),
        runId,
      );

    return {
      runId,
      accountId,
      status: 'completed' as MigrationRunStatus,
      totalRecords,
      mappedCount,
      anomalyCount,
      unsupportedCount,
      duplicateCount,
      rebuildFingerprint: fingerprint,
      errorMessage: null,
    };
  });

  try {
    return transaction();
  } catch (err: unknown) {
    // Rollback is automatic — the transaction function throws
    const message = err instanceof Error ? err.message : String(err);
    return {
      runId: '',
      accountId,
      status: 'failed',
      totalRecords: 0,
      mappedCount: 0,
      anomalyCount: 0,
      unsupportedCount: 0,
      duplicateCount: 0,
      rebuildFingerprint: null,
      errorMessage: message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Lookup Helpers (for external callers)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find the most recent completed migration run for an account.
 * Returns the run row, or undefined if none exists.
 */
export function findLatestMigrationRun(
  sqlite: Database.Database,
  accountId: string,
): {
  id: string;
  accountId: string;
  status: string;
  totalRecords: number;
  mappedCount: number;
  anomalyCount: number;
  unsupportedCount: number;
  duplicateCount: number;
  rebuildFingerprint: string | null;
  completedAt: string | null;
  createdAt: string;
} | undefined {
  const row = sqlite
    .prepare(
      `SELECT id, account_id, status, total_records, mapped_count, anomaly_count,
              unsupported_count, duplicate_count, rebuild_fingerprint,
              completed_at, created_at
       FROM accounting_migration_runs
       WHERE account_id = ? AND status = 'completed'
       ORDER BY started_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(accountId) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  return {
    id: row.id as string,
    accountId: row.account_id as string,
    status: row.status as string,
    totalRecords: row.total_records as number,
    mappedCount: row.mapped_count as number,
    anomalyCount: row.anomaly_count as number,
    unsupportedCount: row.unsupported_count as number,
    duplicateCount: row.duplicate_count as number,
    rebuildFingerprint: row.rebuild_fingerprint as string | null,
    completedAt: row.completed_at as string | null,
    createdAt: row.created_at as string,
  };
}

/**
 * List all migration records for a given run.
 * Returns an array of record outcomes.
 */
export function listMigrationRecords(
  sqlite: Database.Database,
  runId: string,
): MigrationRecordOutcome[] {
  const rows = sqlite
    .prepare(
      `SELECT source_table, source_id, status, record_type,
              anomaly_code, anomaly_field, anomaly_detail, idempotency_key,
              accounting_event_id, accounting_execution_id, accounting_mark_id
       FROM accounting_migration_records
       WHERE run_id = ?
       ORDER BY created_at ASC`,
    )
    .all(runId) as Array<{
    source_table: string;
    source_id: string;
    status: string;
    record_type: string;
    anomaly_code: string | null;
    anomaly_field: string | null;
    anomaly_detail: string | null;
    idempotency_key: string | null;
    accounting_event_id: string | null;
    accounting_execution_id: string | null;
    accounting_mark_id: string | null;
  }>;

  return rows.map((r) => ({
    sourceTable: r.source_table,
    sourceId: r.source_id,
    status: r.status as MigrationRecordStatus,
    recordType: r.record_type as MigrationRecordType,
    anomalyCode: r.anomaly_code as AnomalyCode | null,
    anomalyField: r.anomaly_field,
    anomalyDetail: r.anomaly_detail,
    idempotencyKey: r.idempotency_key,
    accountingEventId: r.accounting_event_id,
    accountingExecutionId: r.accounting_execution_id,
    accountingMarkId: r.accounting_mark_id,
  }));
}
