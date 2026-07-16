/**
 * Legacy migration adapters and types.
 *
 * Pure types, adapters, and mapping functions for converting legacy
 * account_transactions, trade_executions, and position_price_snapshots
 * into the immutable accounting boundary (financial_events, accounting_executions,
 * valuation_marks).
 *
 * No database, Next.js, or server imports — pure data-mapping functions.
 * The migration runner (T02 + T03) provides repository access; these
 * adapters are injected with the data they need as plain arguments.
 *
 * @module legacy-migration
 */

import { normalizeDecimal, toMicros } from './decimal';
import type { CanonicalDecimal, EventType } from './types';
import type { ExecutionAction, FifoRejectionCode } from '../positions/types';

// ═══════════════════════════════════════════════════════════════════════════
// Anomaly Codes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stable anomaly codes for classifying malformed, ambiguous, or unsupported
 * legacy records.  Each code appears in migration reconciliation reports
 * and persists in the migration run log for audit.
 *
 * Codes prefixed with `ANOMALY_` for grep-ability and stable cross-version
 * compatibility.
 */
export const ANOMALY_CODES = {
  /** account_transaction type is not 'deposit' or 'withdrawal'. */
  UNSUPPORTED_EVENT_TYPE: 'ANOMALY_UNSUPPORTED_EVENT_TYPE',
  /** trade_execution action is not a recognised accounting action. */
  UNSUPPORTED_EXECUTION_ACTION: 'ANOMALY_UNSUPPORTED_EXECUTION_ACTION',
  /** Execution price is missing (zero/falsy). */
  MISSING_PRICE: 'ANOMALY_MISSING_PRICE',
  /** Execution price is negative. */
  NEGATIVE_PRICE: 'ANOMALY_NEGATIVE_PRICE',
  /** Execution quantity is negative. */
  NEGATIVE_QUANTITY: 'ANOMALY_NEGATIVE_QUANTITY',
  /** Execution quantity is zero. */
  ZERO_QUANTITY: 'ANOMALY_ZERO_QUANTITY',
  /** Legacy source identity clashes with a previously imported record. */
  DUPLICATE_SOURCE_IDENTITY: 'ANOMALY_DUPLICATE_SOURCE_IDENTITY',
  /** Price snapshot has no price (zero/falsy). */
  MISSING_PRICE_SNAPSHOT_PRICE: 'ANOMALY_MISSING_PRICE_SNAPSHOT_PRICE',
  /** Price snapshot price is negative. */
  INVALID_PRICE_SNAPSHOT: 'ANOMALY_INVALID_PRICE_SNAPSHOT',
  /** Record is missing a required timestamp. */
  MISSING_TIMESTAMP: 'ANOMALY_MISSING_TIMESTAMP',
  /** Record type cannot be mapped to any accounting concept. */
  UNSUPPORTED_RECORD: 'ANOMALY_UNSUPPORTED_RECORD',
  /** Execution fees are negative. */
  NEGATIVE_FEES: 'ANOMALY_NEGATIVE_FEES',
} as const;

export type AnomalyCode = (typeof ANOMALY_CODES)[keyof typeof ANOMALY_CODES];

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Source Record Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Raw shape of a legacy account_transactions row (from the journal DB schema).
 * All numeric amounts are stored as `real` (IEEE-754 float) in SQLite;
 * the migration adapter must normalise them to canonical decimals.
 */
export interface LegacyAccountTransaction {
  id: string;
  accountId: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  balanceAfter: number;
  date: string;
  notes: string | null;
  createdAt: string;
}

/**
 * Raw shape of a legacy trade_executions row.
 * Quantity, price, and fees are real (float) values.
 */
export interface LegacyTradeExecution {
  id: string;
  tradeId: string;
  executedAt: string | null;
  action: 'buy' | 'sell' | 'buy_to_cover' | 'sell_short' | 'add' | 'reduce';
  quantity: number;
  price: number;
  fees: number | null;
  reasonId: string | null;
  notes: string | null;
  createdAt: string;
}

/**
 * Raw shape of a legacy position_price_snapshots row.
 * Price is a real (float) value.
 */
export interface LegacyPriceSnapshot {
  id: string;
  tradeId: string;
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

/** Discriminated union of all legacy source record types. */
export type LegacySourceRecord =
  | { table: 'account_transactions'; row: LegacyAccountTransaction }
  | { table: 'trade_executions'; row: LegacyTradeExecution }
  | { table: 'position_price_snapshots'; row: LegacyPriceSnapshot };

// ═══════════════════════════════════════════════════════════════════════════
// Migration Input / Output Types
// ═══════════════════════════════════════════════════════════════════════════

/** Classification of a single legacy record after mapping. */
export type MigrationRecordStatus =
  | 'mapped'
  | 'anomaly'
  | 'unsupported'
  | 'duplicate';

/** Stable classification of what type of accounting record a legacy row maps to. */
export type MigrationRecordType =
  | 'cash_event'
  | 'execution'
  | 'price_mark'
  | 'unsupported';

/**
 * A single anomaly found during mapping.
 * Each anomaly references the source table, the source row ID, the field
 * that caused the issue, and a human-readable detail message.
 */
export interface MigrationAnomaly {
  code: AnomalyCode;
  sourceTable: string;
  sourceId: string;
  field: string;
  detail: string;
}

// ── Cash Event Migration Input ──────────────────────────────────────────

/**
 * Input shape for creating a cash financial event from a legacy
 * account_transactions record.
 */
export interface CashEventMigrationInput {
  type: 'cash_event';
  accountId: string;
  eventType: Extract<EventType, 'deposit' | 'withdrawal'>;
  amount: CanonicalDecimal;
  description: string | null;
  postedAt: string;
  idempotencyKey: string;
  legacySourceTable: string;
  legacySourceId: string;
}

// ── Execution Migration Input ───────────────────────────────────────────

/**
 * Input shape for creating an accounting execution from a legacy
 * trade_executions record.
 *
 * The caller is responsible for resolving the instrument symbol and
 * account ID (e.g. from the parent trade row).
 */
export interface ExecutionMigrationInput {
  type: 'execution';
  accountId: string;
  symbol: string;
  action: ExecutionAction;
  quantity: CanonicalDecimal;
  price: CanonicalDecimal;
  fees: CanonicalDecimal;
  postedAt: string;
  idempotencyKey: string;
  journalTradeId: string;
  legacySourceTable: string;
  legacySourceId: string;
}

// ── Price Mark Migration Input ──────────────────────────────────────────

/**
 * Input shape for creating a valuation mark from a legacy
 * position_price_snapshots record.
 *
 * The caller is responsible for resolving the instrument ID and account ID.
 * The mark price must be a positive canonical decimal (prices <= 0 are
 * flagged as anomalies by the adapter).
 */
export interface PriceMarkMigrationInput {
  type: 'price_mark';
  accountId: string;
  instrumentId: string;
  price: CanonicalDecimal;
  priceMicros: number;
  source: string;
  markTimestamp: string;
  idempotencyKey: string;
  legacySourceTable: string;
  legacySourceId: string;
}

/** Discriminated union of all supported migration input types. */
export type MigrationInput =
  | CashEventMigrationInput
  | ExecutionMigrationInput
  | PriceMarkMigrationInput;

// ── Mapping Result ──────────────────────────────────────────────────────

/**
 * Result of mapping a single legacy record through an adapter.
 *
 * - `mapped`: Successfully mapped; `input` contains the accounting input.
 * - `anomaly`: Record has issues; `input` is absent, `anomaly` describes
 *   the problem.  The record is still recorded in the migration run log
 *   for audit.
 * - `unsupported`: Record type cannot be mapped at all (e.g. unknown
 *   transaction type).  Recorded for audit but no input is produced.
 * - `duplicate`: Same source identity already imported.  Suppressed
 *   (no input produced, no anomaly) for idempotent reruns.
 */
export interface MapResult {
  status: MigrationRecordStatus;
  recordType: MigrationRecordType;
  input: MigrationInput | null;
  anomaly: MigrationAnomaly | null;
  idempotencyKey: string;
  sourceTable: string;
  sourceId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Idempotency Key Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a deterministic idempotency key from the source table name and
 * source record ID.
 *
 * Pattern: `migrated:{table}:{id}`
 *
 * This ensures that replaying the same source record always produces
 * the same key, and the accounting repository can reject duplicates.
 */
export function buildIdempotencyKey(
  sourceTable: string,
  sourceId: string,
): string {
  return `migrated:${sourceTable}:${sourceId}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mapping Adapters
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map a legacy account_transactions row to a cash event migration input.
 *
 * Validation rules:
 * - Only `deposit` and `withdrawal` types are supported.
 * - The `date` field is used as `postedAt`.
 * - `amount` is normalised from a float to a canonical decimal.
 * - If `amount` is negative or zero, it is flagged as an anomaly.
 *
 * @param row   - Legacy account_transactions row.
 * @returns     - MapResult with either a CashEventMigrationInput or an anomaly.
 */
export function mapAccountTransactionToCashEvent(
  row: LegacyAccountTransaction,
): MapResult {
  const idempotencyKey = buildIdempotencyKey('account_transactions', row.id);
  const sourceTable = 'account_transactions';

  // Validate event type
  if (row.type !== 'deposit' && row.type !== 'withdrawal') {
    return {
      status: 'anomaly',
      recordType: 'unsupported',
      input: null,
      anomaly: {
        code: ANOMALY_CODES.UNSUPPORTED_EVENT_TYPE,
        sourceTable,
        sourceId: row.id,
        field: 'type',
        detail: `Unsupported account_transaction type: "${row.type}". Expected "deposit" or "withdrawal".`,
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  // Amount validation
  if (row.amount <= 0) {
    return {
      status: 'anomaly',
      recordType: 'cash_event',
      input: null,
      anomaly: {
        code: row.amount === 0 ? ANOMALY_CODES.UNSUPPORTED_RECORD : ANOMALY_CODES.UNSUPPORTED_RECORD,
        sourceTable,
        sourceId: row.id,
        field: 'amount',
        detail: `Cash ${row.type} amount must be positive, got: ${row.amount}`,
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  // Timestamp validation
  if (!row.date || row.date.length === 0) {
    return {
      status: 'anomaly',
      recordType: 'cash_event',
      input: null,
      anomaly: {
        code: ANOMALY_CODES.MISSING_TIMESTAMP,
        sourceTable,
        sourceId: row.id,
        field: 'date',
        detail: 'account_transaction has no date value.',
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  const amount = normalizeDecimal(row.amount);
  const eventType = row.type === 'deposit' ? 'deposit' : 'withdrawal';

  return {
    status: 'mapped',
    recordType: 'cash_event',
    input: {
      type: 'cash_event',
      accountId: row.accountId,
      eventType,
      amount,
      description: row.notes,
      postedAt: row.date,
      idempotencyKey,
      legacySourceTable: sourceTable,
      legacySourceId: row.id,
    },
    anomaly: null,
    idempotencyKey,
    sourceTable,
    sourceId: row.id,
  };
}

/**
 * Map a legacy trade_executions row to an execution migration input.
 *
 * The `accountId` and `symbol` must be resolved by the caller from the
 * parent trade row (the legacy execution only has a `tradeId` FK).
 *
 * Validation rules:
 * - All standard execution actions (buy, sell, sell_short, buy_to_cover,
 *   add, reduce) are supported.
 * - Quantity must be positive.
 * - Price must be positive.
 * - Fees, if present, must be non-negative.
 * - `executedAt` (or `createdAt` as fallback) is used as `postedAt`.
 *
 * @param row       - Legacy trade_executions row.
 * @param accountId - Account ID resolved from the parent trade.
 * @param symbol    - Instrument symbol resolved from the parent trade.
 * @returns         - MapResult with either an ExecutionMigrationInput or an anomaly.
 */
export function mapTradeExecutionToExecutionInput(
  row: LegacyTradeExecution,
  accountId: string,
  symbol: string,
): MapResult {
  const idempotencyKey = buildIdempotencyKey('trade_executions', row.id);
  const sourceTable = 'trade_executions';

  // Validate quantity
  if (row.quantity <= 0) {
    return {
      status: 'anomaly',
      recordType: 'execution',
      input: null,
      anomaly: {
        code: row.quantity === 0 ? ANOMALY_CODES.ZERO_QUANTITY : ANOMALY_CODES.NEGATIVE_QUANTITY,
        sourceTable,
        sourceId: row.id,
        field: 'quantity',
        detail: `Execution quantity must be positive, got: ${row.quantity}`,
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  // Validate price
  if (!row.price || row.price <= 0) {
    return {
      status: 'anomaly',
      recordType: 'execution',
      input: null,
      anomaly: {
        code: !row.price ? ANOMALY_CODES.MISSING_PRICE : ANOMALY_CODES.NEGATIVE_PRICE,
        sourceTable,
        sourceId: row.id,
        field: 'price',
        detail: !row.price
          ? 'Execution price is missing.'
          : `Execution price must be positive, got: ${row.price}`,
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  // Validate fees
  const fees = row.fees ?? 0;
  if (fees < 0) {
    return {
      status: 'anomaly',
      recordType: 'execution',
      input: null,
      anomaly: {
        code: ANOMALY_CODES.NEGATIVE_FEES,
        sourceTable,
        sourceId: row.id,
        field: 'fees',
        detail: `Execution fees must be non-negative, got: ${fees}`,
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  // Timestamp: prefer executedAt, fall back to createdAt
  const postedAt = row.executedAt || row.createdAt;
  if (!postedAt) {
    return {
      status: 'anomaly',
      recordType: 'execution',
      input: null,
      anomaly: {
        code: ANOMALY_CODES.MISSING_TIMESTAMP,
        sourceTable,
        sourceId: row.id,
        field: 'executedAt',
        detail: 'Execution has no timestamp (executedAt or createdAt).',
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  return {
    status: 'mapped',
    recordType: 'execution',
    input: {
      type: 'execution',
      accountId,
      symbol,
      action: row.action,
      quantity: normalizeDecimal(row.quantity),
      price: normalizeDecimal(row.price),
      fees: normalizeDecimal(fees),
      postedAt,
      idempotencyKey,
      journalTradeId: row.tradeId,
      legacySourceTable: sourceTable,
      legacySourceId: row.id,
    },
    anomaly: null,
    idempotencyKey,
    sourceTable,
    sourceId: row.id,
  };
}

/**
 * Map a legacy position_price_snapshots row to a valuation mark input.
 *
 * The `accountId` and `instrumentId` must be resolved by the caller
 * (the snapshot only references a `tradeId`).
 *
 * Validation rules:
 * - Price must be positive (no zero or negative prices).
 * - `fetchedAt` is used as `markTimestamp`.
 *
 * @param row          - Legacy position_price_snapshots row.
 * @param accountId    - Account ID resolved from the parent trade.
 * @param instrumentId - Instrument ID resolved for the parent trade's symbol.
 * @returns            - MapResult with either a PriceMarkMigrationInput or an anomaly.
 */
export function mapPriceSnapshotToValuationMark(
  row: LegacyPriceSnapshot,
  accountId: string,
  instrumentId: string,
): MapResult {
  const idempotencyKey = buildIdempotencyKey('position_price_snapshots', row.id);
  const sourceTable = 'position_price_snapshots';

  // Price validation
  if (!row.price || row.price <= 0) {
    return {
      status: 'anomaly',
      recordType: 'price_mark',
      input: null,
      anomaly: {
        code: !row.price
          ? ANOMALY_CODES.MISSING_PRICE_SNAPSHOT_PRICE
          : ANOMALY_CODES.INVALID_PRICE_SNAPSHOT,
        sourceTable,
        sourceId: row.id,
        field: 'price',
        detail: !row.price
          ? 'Price snapshot has no price value.'
          : `Price snapshot price must be positive, got: ${row.price}`,
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  // Timestamp validation
  if (!row.fetchedAt || row.fetchedAt.length === 0) {
    return {
      status: 'anomaly',
      recordType: 'price_mark',
      input: null,
      anomaly: {
        code: ANOMALY_CODES.MISSING_TIMESTAMP,
        sourceTable,
        sourceId: row.id,
        field: 'fetchedAt',
        detail: 'Price snapshot has no fetchedAt timestamp.',
      },
      idempotencyKey,
      sourceTable,
      sourceId: row.id,
    };
  }

  const price = normalizeDecimal(row.price);
  const priceMicros = toMicros(price);
  const source = row.source || 'import';

  return {
    status: 'mapped',
    recordType: 'price_mark',
    input: {
      type: 'price_mark',
      accountId,
      instrumentId,
      price,
      priceMicros,
      source,
      markTimestamp: row.fetchedAt,
      idempotencyKey,
      legacySourceTable: sourceTable,
      legacySourceId: row.id,
    },
    anomaly: null,
    idempotencyKey,
    sourceTable,
    sourceId: row.id,
  };
}

/**
 * Convenience function to classify a legacy record before mapping.
 * Returns the expected record type based on the source table.
 */
export function classifyLegacyRecord(
  source: LegacySourceRecord,
): MigrationRecordType {
  switch (source.table) {
    case 'account_transactions':
      return 'cash_event';
    case 'trade_executions':
      return 'execution';
    case 'position_price_snapshots':
      return 'price_mark';
    default:
      return 'unsupported';
  }
}
