/**
 * Database repository for the accounting ledger.
 *
 * Operates on the raw better-sqlite3 Database handle so that callers
 * (the posting kernel, rebuild engine, API routes) can manage their own
 * transactions.  Uses Drizzle ORM for type-safe query building.
 *
 * Every method is a pure data access function — no domain logic, no validation.
 * Domain rules belong in the posting kernel or projection engine.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { CanonicalDecimal, EventType, EventStatus, PostingSide } from '../lib/accounting/types';

// ── Row Shape Helpers (matching Drizzle table columns) ──────────────────

export interface FinancialEventRow {
  id: string;
  account_id: string;
  event_type: string;
  idempotency_key: string | null;
  description: string | null;
  payload: string | null;
  effect: string | null;
  posted_at: string;
  created_at: string;
}

/**
 * Extended event row with ledger entry/posting status for the activity list.
 */
export interface FinancialEventWithStatusRow extends FinancialEventRow {
  entry_id: string | null;
  posting_count: number;
  is_balanced: number;
}

export interface LedgerEntryRow {
  id: string;
  financial_event_id: string;
  account_id: string;
  description: string | null;
  posted_at: string;
  created_at: string;
}

export interface LedgerPostingRow {
  id: string;
  ledger_entry_id: string;
  account_id: string;
  side: string;
  amount: string;
  amount_micros: number;
  currency: string;
  sequence: number;
  created_at: string;
}

// ── Idempotency Check ───────────────────────────────────────────────────

/**
 * Look up a financial event by its idempotency key.
 * Returns the row or undefined.
 */
export function findEventByIdempotencyKey(
  sqlite: Database.Database,
  idempotencyKey: string,
): FinancialEventRow | undefined {
  const row = sqlite
    .prepare(
      `SELECT id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at
       FROM financial_events
       WHERE idempotency_key = ?`,
    )
    .get(idempotencyKey) as FinancialEventRow | undefined;
  return row;
}

// ── Account Lookup ──────────────────────────────────────────────────────

/**
 * Check whether an account exists by its ID.
 */
export function accountExists(
  sqlite: Database.Database,
  accountId: string,
): boolean {
  const row = sqlite
    .prepare('SELECT 1 FROM accounts WHERE id = ?')
    .get(accountId) as { 1: number } | undefined;
  return row !== undefined;
}

// ── Sequence Generation ─────────────────────────────────────────────────

/**
 * Get the next stable sequence number for ledger postings.
 * Starts at 1 when no postings exist.
 */
export function getNextSequence(sqlite: Database.Database): number {
  const row = sqlite
    .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq FROM ledger_postings')
    .get() as { next_seq: number };
  return row.next_seq;
}

// ── Insert Operations ───────────────────────────────────────────────────

/**
 * Insert a financial event row.
 */
export function insertFinancialEvent(
  sqlite: Database.Database,
  values: {
    id?: string;
    accountId: string;
    eventType: EventType;
    idempotencyKey?: string | null;
    description?: string | null;
    payload?: string | null;
    effect?: string | null;
    postedAt: string;
  },
): FinancialEventRow {
  const id = values.id ?? randomUUID();
  sqlite
    .prepare(
      `INSERT INTO financial_events (id, account_id, event_type, idempotency_key, description, payload, effect, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.accountId,
      values.eventType,
      values.idempotencyKey ?? null,
      values.description ?? null,
      values.payload ?? null,
      values.effect ?? null,
      values.postedAt,
    );
  // Return the canonical row shape
  return {
    id,
    account_id: values.accountId,
    event_type: values.eventType,
    idempotency_key: values.idempotencyKey ?? null,
    description: values.description ?? null,
    payload: values.payload ?? null,
    effect: values.effect ?? null,
    posted_at: values.postedAt,
    created_at: new Date().toISOString(),
  };
}

/**
 * Insert a ledger entry row.
 */
export function insertLedgerEntry(
  sqlite: Database.Database,
  values: {
    id?: string;
    financialEventId: string;
    accountId: string;
    description?: string | null;
    postedAt: string;
  },
): LedgerEntryRow {
  const id = values.id ?? randomUUID();
  sqlite
    .prepare(
      `INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.financialEventId,
      values.accountId,
      values.description ?? null,
      values.postedAt,
    );
  return {
    id,
    financial_event_id: values.financialEventId,
    account_id: values.accountId,
    description: values.description ?? null,
    posted_at: values.postedAt,
    created_at: new Date().toISOString(),
  };
}

/**
 * Insert a single ledger posting row.
 */
export function insertLedgerPosting(
  sqlite: Database.Database,
  values: {
    id?: string;
    ledgerEntryId: string;
    accountId: string;
    side: PostingSide;
    amount: CanonicalDecimal;
    amountMicros: number;
    currency?: string;
    sequence: number;
  },
): LedgerPostingRow {
  const id = values.id ?? randomUUID();
  sqlite
    .prepare(
      `INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.ledgerEntryId,
      values.accountId,
      values.side,
      values.amount,
      values.amountMicros,
      values.currency ?? 'USD',
      values.sequence,
    );
  return {
    id,
    ledger_entry_id: values.ledgerEntryId,
    account_id: values.accountId,
    side: values.side,
    amount: values.amount,
    amount_micros: values.amountMicros,
    currency: values.currency ?? 'USD',
    sequence: values.sequence,
    created_at: new Date().toISOString(),
  };
}

// ── Read Operations ─────────────────────────────────────────────────────

/**
 * Find a financial event by its ID (event-only, no postings).
 * Returns the row or undefined.
 */
export function findEventById(
  sqlite: Database.Database,
  eventId: string,
): FinancialEventRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at
       FROM financial_events WHERE id = ?`,
    )
    .get(eventId) as FinancialEventRow | undefined;
}

/**
 * Find a financial event by its ID, including its ledger entry and postings.
 * Returns the fully hydrated aggregate, or undefined if not found.
 */
export function findEventWithPostings(
  sqlite: Database.Database,
  eventId: string,
): {
  event: FinancialEventRow;
  entry: LedgerEntryRow;
  postings: LedgerPostingRow[];
} | undefined {
  const event = sqlite
    .prepare(
      `SELECT id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at
       FROM financial_events WHERE id = ?`,
    )
    .get(eventId) as FinancialEventRow | undefined;
  if (!event) return undefined;

  const entry = sqlite
    .prepare(
      `SELECT id, financial_event_id, account_id, description, posted_at, created_at
       FROM ledger_entries WHERE financial_event_id = ?`,
    )
    .get(eventId) as LedgerEntryRow | undefined;
  if (!entry) return { event, entry: undefined as unknown as LedgerEntryRow, postings: [] };

  const postings = sqlite
    .prepare(
      `SELECT id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at
       FROM ledger_postings WHERE ledger_entry_id = ? ORDER BY sequence ASC`,
    )
    .all(entry.id) as LedgerPostingRow[];

  return { event, entry, postings };
}

/**
 * List all financial events for an account in deterministic posted_at/sequence order,
 * including their ledger entry/posting status.
 *
 * Returns an ordered list from oldest to newest.
 * Each row includes the event data plus:
 * - entry_id: the associated ledger entry id (or null if not yet posted)
 * - posting_count: number of ledger postings for this event
 * - is_balanced: 1 if debit sum === credit sum, 0 otherwise
 */
export function listAccountEvents(
  sqlite: Database.Database,
  accountId: string,
  options?: { limit?: number; offset?: number },
): FinancialEventWithStatusRow[] {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  const rows = sqlite
    .prepare(
      `SELECT
         fe.id,
         fe.account_id,
         fe.event_type,
         fe.idempotency_key,
         fe.description,
         fe.payload,
         fe.effect,
         fe.posted_at,
         fe.created_at,
         le.id AS entry_id,
         COALESCE(
           (SELECT COUNT(*) FROM ledger_postings lp WHERE lp.ledger_entry_id = le.id),
           0
         ) AS posting_count,
         CASE
           WHEN le.id IS NULL THEN 0
           WHEN (
             COALESCE((SELECT SUM(lp2.amount_micros) FROM ledger_postings lp2 WHERE lp2.ledger_entry_id = le.id AND lp2.side = 'debit'), 0) =
             COALESCE((SELECT SUM(lp3.amount_micros) FROM ledger_postings lp3 WHERE lp3.ledger_entry_id = le.id AND lp3.side = 'credit'), 0)
           ) THEN 1
           ELSE 0
         END AS is_balanced
       FROM financial_events fe
       LEFT JOIN ledger_entries le ON le.financial_event_id = fe.id
       WHERE fe.account_id = ?
       ORDER BY fe.posted_at ASC, fe.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(accountId, limit, offset) as FinancialEventWithStatusRow[];

  return rows;
}

/**
 * Count all financial events for an account.
 */
export function countAccountEvents(
  sqlite: Database.Database,
  accountId: string,
): number {
  const row = sqlite
    .prepare('SELECT COUNT(*) AS count FROM financial_events WHERE account_id = ?')
    .get(accountId) as { count: number };
  return row.count;
}

/**
 * Find a ledger entry by its financial event ID.
 */
export function findEntryByEventId(
  sqlite: Database.Database,
  financialEventId: string,
): LedgerEntryRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, financial_event_id, account_id, description, posted_at, created_at
       FROM ledger_entries WHERE financial_event_id = ?`,
    )
    .get(financialEventId) as LedgerEntryRow | undefined;
}

/**
 * Find all postings for a given ledger entry.
 */
export function findPostingsByEntryId(
  sqlite: Database.Database,
  ledgerEntryId: string,
): LedgerPostingRow[] {
  return sqlite
    .prepare(
      `SELECT id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at
       FROM ledger_postings WHERE ledger_entry_id = ? ORDER BY sequence ASC`,
    )
    .all(ledgerEntryId) as LedgerPostingRow[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 NEW TABLES: Instruments, Accounting Executions, Account Positions,
// FIFO Lots, and Lot Matches.  See schema.ts / migration 0026.
// ═══════════════════════════════════════════════════════════════════════════

// ── Row Shape Helpers for new tables ─────────────────────────────────────

export interface InstrumentRow {
  id: string;
  symbol: string;
  name: string | null;
  type: string;
  currency: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AccountingExecutionRow {
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

export interface AccountPositionRow {
  id: string;
  account_id: string;
  instrument_id: string;
  direction: string | null;
  quantity: string;
  average_cost: string;
  total_cost_basis: string;
  realized_gross_pnl: string;
  realized_fees: string;
  realized_net_pnl: string;
  last_updated: string;
  created_at: string;
  updated_at: string;
}

export interface FifoLotRow {
  id: string;
  account_id: string;
  instrument_id: string;
  direction: string;
  remaining_quantity: string;
  original_quantity: string;
  entry_price: string;
  cost_basis_total: string;
  allocated_fees: string;
  opening_execution_id: string;
  opened_at: string;
  created_at: string;
}

export interface LotMatchRow {
  id: string;
  closing_execution_id: string;
  lot_id: string;
  match_quantity: string;
  match_price: string;
  realized_gross_pnl: string;
  allocated_fees: string;
  realized_net_pnl: string;
  sequence: number;
  created_at: string;
}

// ── Instruments ─────────────────────────────────────────────────────────--

/**
 * Find an instrument by symbol.  Returns the row or undefined.
 */
export function findInstrumentBySymbol(
  sqlite: Database.Database,
  symbol: string,
): InstrumentRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, symbol, name, type, currency, is_active, created_at, updated_at
       FROM instruments WHERE symbol = ?`,
    )
    .get(symbol) as InstrumentRow | undefined;
}

/**
 * Find an instrument by its UUID.  Returns the row or undefined.
 */
export function findInstrumentById(
  sqlite: Database.Database,
  id: string,
): InstrumentRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, symbol, name, type, currency, is_active, created_at, updated_at
       FROM instruments WHERE id = ?`,
    )
    .get(id) as InstrumentRow | undefined;
}

/**
 * Find an instrument by symbol or create one if none exists.
 * Returns the existing or new row.
 */
export function findOrCreateInstrument(
  sqlite: Database.Database,
  symbol: string,
  name?: string,
  type?: string,
): InstrumentRow {
  const existing = findInstrumentBySymbol(sqlite, symbol);
  if (existing) return existing;

  const id = randomUUID();
  const now = new Date().toISOString();
  const instrumentType = type ?? 'stock';
  sqlite
    .prepare(
      `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', 1, ?, ?)`,
    )
    .run(id, symbol, name ?? null, instrumentType, now, now);

  return {
    id,
    symbol,
    name: name ?? null,
    type: instrumentType,
    currency: 'USD',
    is_active: 1,
    created_at: now,
    updated_at: now,
  };
}

// ── Accounting Executions ─────────────────────────────────────────────---

/**
 * Insert an accounting execution row.  Returns the inserted row.
 */
export function insertAccountingExecution(
  sqlite: Database.Database,
  values: {
    id?: string;
    accountId: string;
    instrumentId: string;
    action: string;
    quantity: string;
    price: string;
    fees?: string;
    idempotencyKey?: string | null;
    journalTradeId?: string | null;
    description?: string | null;
    postedAt: string;
  },
): AccountingExecutionRow {
  const id = values.id ?? randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
       (id, account_id, instrument_id, action, quantity, price, fees, idempotency_key, journal_trade_id, description, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.accountId,
      values.instrumentId,
      values.action,
      values.quantity,
      values.price,
      values.fees ?? '0.00',
      values.idempotencyKey ?? null,
      values.journalTradeId ?? null,
      values.description ?? null,
      values.postedAt,
    );
  return {
    id,
    account_id: values.accountId,
    instrument_id: values.instrumentId,
    action: values.action,
    quantity: values.quantity,
    price: values.price,
    fees: values.fees ?? '0.00',
    idempotency_key: values.idempotencyKey ?? null,
    journal_trade_id: values.journalTradeId ?? null,
    description: values.description ?? null,
    posted_at: values.postedAt,
    created_at: now,
  };
}

/**
 * Find an accounting execution by its idempotency key.
 * Returns the row or undefined.
 */
export function findAccountingExecutionByIdempotencyKey(
  sqlite: Database.Database,
  idempotencyKey: string,
): AccountingExecutionRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, account_id, instrument_id, action, quantity, price, fees,
              idempotency_key, journal_trade_id, description, posted_at, created_at
       FROM accounting_executions WHERE idempotency_key = ?`,
    )
    .get(idempotencyKey) as AccountingExecutionRow | undefined;
}

/**
 * Find an accounting execution by its UUID.
 * Returns the row or undefined.
 */
export function findAccountingExecutionById(
  sqlite: Database.Database,
  id: string,
): AccountingExecutionRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, account_id, instrument_id, action, quantity, price, fees,
              idempotency_key, journal_trade_id, description, posted_at, created_at
       FROM accounting_executions WHERE id = ?`,
    )
    .get(id) as AccountingExecutionRow | undefined;
}

/**
 * List accounting executions for an account in deterministic order.
 * Ordered by posted_at ASC, id ASC.
 */
export function listAccountingExecutions(
  sqlite: Database.Database,
  accountId: string,
  options?: {
    limit?: number;
    offset?: number;
    instrumentId?: string;
  },
): AccountingExecutionRow[] {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  let sql = `SELECT id, account_id, instrument_id, action, quantity, price, fees,
                    idempotency_key, journal_trade_id, description, posted_at, created_at
             FROM accounting_executions
             WHERE account_id = ?`;
  const params: unknown[] = [accountId];

  if (options?.instrumentId) {
    sql += ` AND instrument_id = ?`;
    params.push(options.instrumentId);
  }

  sql += ` ORDER BY posted_at ASC, id ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return sqlite.prepare(sql).all(...params) as AccountingExecutionRow[];
}

/**
 * Count accounting executions for an account (optionally filtered by instrument).
 */
export function countAccountingExecutions(
  sqlite: Database.Database,
  accountId: string,
  options?: { instrumentId?: string },
): number {
  let sql = `SELECT COUNT(*) AS count FROM accounting_executions WHERE account_id = ?`;
  const params: unknown[] = [accountId];
  if (options?.instrumentId) {
    sql += ` AND instrument_id = ?`;
    params.push(options.instrumentId);
  }
  const row = sqlite.prepare(sql).get(...params) as { count: number };
  return row.count;
}

// ── Account Positions ─────────────────────────────────────────────────-──

/**
 * Upsert an account position row using the unique constraint on
 * (account_id, instrument_id).  Returns the row.
 */
export function upsertAccountPosition(
  sqlite: Database.Database,
  values: {
    id?: string;
    accountId: string;
    instrumentId: string;
    direction: string | null;
    quantity: string;
    averageCost: string;
    totalCostBasis: string;
    realizedGrossPnl: string;
    realizedFees: string;
    realizedNetPnl: string;
    lastUpdated: string;
  },
): AccountPositionRow {
  const id = values.id ?? randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO account_positions
       (id, account_id, instrument_id, direction, quantity, average_cost,
        total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
        last_updated, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, instrument_id) DO UPDATE SET
         direction = excluded.direction,
         quantity = excluded.quantity,
         average_cost = excluded.average_cost,
         total_cost_basis = excluded.total_cost_basis,
         realized_gross_pnl = excluded.realized_gross_pnl,
         realized_fees = excluded.realized_fees,
         realized_net_pnl = excluded.realized_net_pnl,
         last_updated = excluded.last_updated,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      values.accountId,
      values.instrumentId,
      values.direction,
      values.quantity,
      values.averageCost,
      values.totalCostBasis,
      values.realizedGrossPnl,
      values.realizedFees,
      values.realizedNetPnl,
      values.lastUpdated,
      now,
      now,
    );
  const row = sqlite
    .prepare(
      `SELECT id, account_id, instrument_id, direction, quantity, average_cost,
              total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
              last_updated, created_at, updated_at
       FROM account_positions WHERE account_id = ? AND instrument_id = ?`,
    )
    .get(values.accountId, values.instrumentId) as AccountPositionRow;
  return row;
}

/**
 * Find an account position by account + instrument.
 * Returns the row or undefined.
 */
export function findAccountPosition(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
): AccountPositionRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, account_id, instrument_id, direction, quantity, average_cost,
              total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
              last_updated, created_at, updated_at
       FROM account_positions WHERE account_id = ? AND instrument_id = ?`,
    )
    .get(accountId, instrumentId) as AccountPositionRow | undefined;
}

/**
 * List all account positions for an account.
 */
export function listAccountPositions(
  sqlite: Database.Database,
  accountId: string,
): AccountPositionRow[] {
  return sqlite
    .prepare(
      `SELECT id, account_id, instrument_id, direction, quantity, average_cost,
              total_cost_basis, realized_gross_pnl, realized_fees, realized_net_pnl,
              last_updated, created_at, updated_at
       FROM account_positions WHERE account_id = ?
       ORDER BY instrument_id ASC`,
    )
    .all(accountId) as AccountPositionRow[];
}

/**
 * Delete all account positions for an account (full rebuild cleanup).
 */
export function deleteAccountPositionsByAccount(
  sqlite: Database.Database,
  accountId: string,
): void {
  sqlite.prepare('DELETE FROM account_positions WHERE account_id = ?').run(accountId);
}

/**
 * Delete an account position for a specific account + instrument.
 */
export function deleteAccountPosition(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
): void {
  sqlite
    .prepare('DELETE FROM account_positions WHERE account_id = ? AND instrument_id = ?')
    .run(accountId, instrumentId);
}

// ── FIFO Lots ───────────────────────────────────────────────────────────

/**
 * Insert a single FIFO lot row.
 */
export function insertFifoLot(
  sqlite: Database.Database,
  values: {
    id?: string;
    accountId: string;
    instrumentId: string;
    direction: string;
    remainingQuantity: string;
    originalQuantity: string;
    entryPrice: string;
    costBasisTotal: string;
    allocatedFees?: string;
    openingExecutionId: string;
    openedAt: string;
  },
): FifoLotRow {
  const id = values.id ?? randomUUID();
  sqlite
    .prepare(
      `INSERT INTO fifo_lots
       (id, account_id, instrument_id, direction, remaining_quantity,
        original_quantity, entry_price, cost_basis_total, allocated_fees,
        opening_execution_id, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.accountId,
      values.instrumentId,
      values.direction,
      values.remainingQuantity,
      values.originalQuantity,
      values.entryPrice,
      values.costBasisTotal,
      values.allocatedFees ?? '0.00',
      values.openingExecutionId,
      values.openedAt,
    );
  return {
    id,
    account_id: values.accountId,
    instrument_id: values.instrumentId,
    direction: values.direction,
    remaining_quantity: values.remainingQuantity,
    original_quantity: values.originalQuantity,
    entry_price: values.entryPrice,
    cost_basis_total: values.costBasisTotal,
    allocated_fees: values.allocatedFees ?? '0.00',
    opening_execution_id: values.openingExecutionId,
    opened_at: values.openedAt,
    created_at: new Date().toISOString(),
  };
}

/**
 * Insert multiple FIFO lots in a loop (for rebuild results).
 */
export function insertFifoLots(
  sqlite: Database.Database,
  lots: Array<{
    id?: string;
    accountId: string;
    instrumentId: string;
    direction: string;
    remainingQuantity: string;
    originalQuantity: string;
    entryPrice: string;
    costBasisTotal: string;
    allocatedFees?: string;
    openingExecutionId: string;
    openedAt: string;
  }>,
): FifoLotRow[] {
  if (lots.length === 0) return [];
  const insert = sqlite.prepare(
    `INSERT INTO fifo_lots
     (id, account_id, instrument_id, direction, remaining_quantity,
      original_quantity, entry_price, cost_basis_total, allocated_fees,
      opening_execution_id, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const results: FifoLotRow[] = [];
  const now = new Date().toISOString();
  for (const lot of lots) {
    const id = lot.id ?? randomUUID();
    insert.run(
      id,
      lot.accountId,
      lot.instrumentId,
      lot.direction,
      lot.remainingQuantity,
      lot.originalQuantity,
      lot.entryPrice,
      lot.costBasisTotal,
      lot.allocatedFees ?? '0.00',
      lot.openingExecutionId,
      lot.openedAt,
    );
    results.push({
      id,
      account_id: lot.accountId,
      instrument_id: lot.instrumentId,
      direction: lot.direction,
      remaining_quantity: lot.remainingQuantity,
      original_quantity: lot.originalQuantity,
      entry_price: lot.entryPrice,
      cost_basis_total: lot.costBasisTotal,
      allocated_fees: lot.allocatedFees ?? '0.00',
      opening_execution_id: lot.openingExecutionId,
      opened_at: lot.openedAt,
      created_at: now,
    });
  }
  return results;
}

/**
 * Find all FIFO lots (including closed) for an account + instrument.
 */
export function findFifoLotsByAccountInstrument(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
): FifoLotRow[] {
  return sqlite
    .prepare(
      `SELECT id, account_id, instrument_id, direction, remaining_quantity,
              original_quantity, entry_price, cost_basis_total, allocated_fees,
              opening_execution_id, opened_at, created_at
       FROM fifo_lots
       WHERE account_id = ? AND instrument_id = ?
       ORDER BY opened_at ASC, id ASC`,
    )
    .all(accountId, instrumentId) as FifoLotRow[];
}

/**
 * Delete all FIFO lots for an account + instrument (for rebuild cleanup).
 */
export function deleteFifoLotsByAccountInstrument(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
): void {
  sqlite
    .prepare('DELETE FROM fifo_lots WHERE account_id = ? AND instrument_id = ?')
    .run(accountId, instrumentId);
}

/**
 * Delete all FIFO lots for an account (for full cleanup).
 */
export function deleteFifoLotsByAccount(
  sqlite: Database.Database,
  accountId: string,
): void {
  sqlite.prepare('DELETE FROM fifo_lots WHERE account_id = ?').run(accountId);
}

// ── Lot Matches ─────────────────────────────────────────────────────────

/**
 * Insert a single lot match row.
 */
export function insertLotMatch(
  sqlite: Database.Database,
  values: {
    id?: string;
    closingExecutionId: string;
    lotId: string;
    matchQuantity: string;
    matchPrice: string;
    realizedGrossPnl: string;
    allocatedFees?: string;
    realizedNetPnl: string;
    sequence: number;
  },
): LotMatchRow {
  const id = values.id ?? randomUUID();
  sqlite
    .prepare(
      `INSERT INTO lot_matches
       (id, closing_execution_id, lot_id, match_quantity, match_price,
        realized_gross_pnl, allocated_fees, realized_net_pnl, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.closingExecutionId,
      values.lotId,
      values.matchQuantity,
      values.matchPrice,
      values.realizedGrossPnl,
      values.allocatedFees ?? '0.00',
      values.realizedNetPnl,
      values.sequence,
    );
  return {
    id,
    closing_execution_id: values.closingExecutionId,
    lot_id: values.lotId,
    match_quantity: values.matchQuantity,
    match_price: values.matchPrice,
    realized_gross_pnl: values.realizedGrossPnl,
    allocated_fees: values.allocatedFees ?? '0.00',
    realized_net_pnl: values.realizedNetPnl,
    sequence: values.sequence,
    created_at: new Date().toISOString(),
  };
}

/**
 * Insert multiple lot matches in a loop (for rebuild results).
 */
export function insertLotMatches(
  sqlite: Database.Database,
  matches: Array<{
    id?: string;
    closingExecutionId: string;
    lotId: string;
    matchQuantity: string;
    matchPrice: string;
    realizedGrossPnl: string;
    allocatedFees?: string;
    realizedNetPnl: string;
    sequence: number;
  }>,
): LotMatchRow[] {
  if (matches.length === 0) return [];
  const insert = sqlite.prepare(
    `INSERT INTO lot_matches
     (id, closing_execution_id, lot_id, match_quantity, match_price,
      realized_gross_pnl, allocated_fees, realized_net_pnl, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const results: LotMatchRow[] = [];
  const now = new Date().toISOString();
  for (const m of matches) {
    const id = m.id ?? randomUUID();
    insert.run(
      id,
      m.closingExecutionId,
      m.lotId,
      m.matchQuantity,
      m.matchPrice,
      m.realizedGrossPnl,
      m.allocatedFees ?? '0.00',
      m.realizedNetPnl,
      m.sequence,
    );
    results.push({
      id,
      closing_execution_id: m.closingExecutionId,
      lot_id: m.lotId,
      match_quantity: m.matchQuantity,
      match_price: m.matchPrice,
      realized_gross_pnl: m.realizedGrossPnl,
      allocated_fees: m.allocatedFees ?? '0.00',
      realized_net_pnl: m.realizedNetPnl,
      sequence: m.sequence,
      created_at: now,
    });
  }
  return results;
}

/**
 * Delete all lot matches for a specific closing execution.
 */
export function deleteLotMatchesByExecution(
  sqlite: Database.Database,
  executionId: string,
): void {
  sqlite
    .prepare('DELETE FROM lot_matches WHERE closing_execution_id = ?')
    .run(executionId);
}

/**
 * Delete all lot matches for an account + instrument via subquery.
 */
export function deleteLotMatchesByAccountInstrument(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
): void {
  sqlite
    .prepare(
      `DELETE FROM lot_matches WHERE closing_execution_id IN (
         SELECT id FROM accounting_executions
         WHERE account_id = ? AND instrument_id = ?
       )`,
    )
    .run(accountId, instrumentId);
}

/**
 * Delete all lot matches for an account via subquery.
 */
export function deleteLotMatchesByAccount(
  sqlite: Database.Database,
  accountId: string,
): void {
  sqlite
    .prepare(
      `DELETE FROM lot_matches WHERE closing_execution_id IN (
         SELECT id FROM accounting_executions WHERE account_id = ?
       )`,
    )
    .run(accountId);
}

// ── All-in-one rebuild cleanup ─────────────────────────────────────────---

/**
 * Delete all rebuildable projection rows for an account + instrument.
 * Called before a full rebuild to clear the previous projection.
 */
export function deleteProjectionByAccountInstrument(
  sqlite: Database.Database,
  accountId: string,
  instrumentId: string,
): void {
  deleteLotMatchesByAccountInstrument(sqlite, accountId, instrumentId);
  deleteFifoLotsByAccountInstrument(sqlite, accountId, instrumentId);
  deleteAccountPosition(sqlite, accountId, instrumentId);
}

// ── Valuation Marks (immutable price observations) ──────────────────────
// row types, insert, find, list

export interface ValuationMarkRow {
  id: string;
  account_id: string;
  instrument_id: string;
  price: string;
  price_micros: number;
  source: string;
  mark_timestamp: string;
  idempotency_key: string | null;
  created_at: string;
}

export interface AccountPerformanceRow {
  id: string;
  account_id: string;
  computed_as_of: string;
  net_cash: string;
  nav: string;
  marked_positions: string;
  realized_pnl: string;
  unrealized_pnl: string;
  total_pnl: string;
  realized_fees: string;
  gross_exposure: string;
  net_exposure: string;
  modified_dietz_return: string | null;
  twr: string | null;
  high_water_mark: string | null;
  drawdown: string | null;
  drawdown_pct: string | null;
  warnings: string;
  positions_json: string;
  rebuild_count: number;
  last_rebuilt_at: string;
  created_at: string;
  updated_at: string;
}

// ── Valuation Marks ─────────────────────────────────────────────────────

/**
 * Insert a valuation mark row.  Returns the inserted row.
 * Marks are immutable — UPDATE/DELETE triggers prevent modification.
 */
export function insertValuationMark(
  sqlite: Database.Database,
  values: {
    id?: string;
    accountId: string;
    instrumentId: string;
    price: string;
    priceMicros: number;
    source: string;
    markTimestamp: string;
    idempotencyKey?: string | null;
  },
): ValuationMarkRow {
  const id = values.id ?? randomUUID();
  sqlite
    .prepare(
      `INSERT INTO valuation_marks
       (id, account_id, instrument_id, price, price_micros, source, mark_timestamp, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.accountId,
      values.instrumentId,
      values.price,
      values.priceMicros,
      values.source,
      values.markTimestamp,
      values.idempotencyKey ?? null,
    );
  return {
    id,
    account_id: values.accountId,
    instrument_id: values.instrumentId,
    price: values.price,
    price_micros: values.priceMicros,
    source: values.source,
    mark_timestamp: values.markTimestamp,
    idempotency_key: values.idempotencyKey ?? null,
    created_at: new Date().toISOString(),
  };
}

/**
 * Find a valuation mark by its idempotency key.
 * Returns the row or undefined.
 */
export function findValuationMarkByIdempotencyKey(
  sqlite: Database.Database,
  idempotencyKey: string,
): ValuationMarkRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, account_id, instrument_id, price, price_micros, source,
              mark_timestamp, idempotency_key, created_at
       FROM valuation_marks WHERE idempotency_key = ?`,
    )
    .get(idempotencyKey) as ValuationMarkRow | undefined;
}

/**
 * Get the most recent valuation mark for each instrument in an account.
 *
 * For each distinct (account_id, instrument_id), returns the mark with the
 * latest mark_timestamp.  Subquery uses MAX(mark_timestamp) for correctness.
 */
export function listLatestValuationMarks(
  sqlite: Database.Database,
  accountId: string,
): ValuationMarkRow[] {
  return sqlite
    .prepare(
      `SELECT vm.id, vm.account_id, vm.instrument_id, vm.price, vm.price_micros,
              vm.source, vm.mark_timestamp, vm.idempotency_key, vm.created_at
       FROM valuation_marks vm
       INNER JOIN (
         SELECT account_id, instrument_id, MAX(mark_timestamp) AS max_ts
         FROM valuation_marks
         WHERE account_id = ?
         GROUP BY account_id, instrument_id
       ) latest
       ON vm.account_id = latest.account_id
       AND vm.instrument_id = latest.instrument_id
       AND vm.mark_timestamp = latest.max_ts`,
    )
    .all(accountId) as ValuationMarkRow[];
}

/**
 * List all valuation marks for an account, newest first.
 * Supports optional instrument filter and date range.
 */
export function listAccountValuationMarks(
  sqlite: Database.Database,
  accountId: string,
  options?: {
    instrumentId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  },
): ValuationMarkRow[] {
  let sql = `SELECT id, account_id, instrument_id, price, price_micros, source,
                    mark_timestamp, idempotency_key, created_at
             FROM valuation_marks WHERE account_id = ?`;
  const params: unknown[] = [accountId];

  if (options?.instrumentId) {
    sql += ` AND instrument_id = ?`;
    params.push(options.instrumentId);
  }
  if (options?.fromDate) {
    sql += ` AND mark_timestamp >= ?`;
    params.push(options.fromDate);
  }
  if (options?.toDate) {
    sql += ` AND mark_timestamp <= ?`;
    params.push(options.toDate);
  }

  sql += ` ORDER BY mark_timestamp DESC, created_at DESC`;

  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return sqlite.prepare(sql).all(...params) as ValuationMarkRow[];
}

/**
 * Count valuation marks for an account.
 */
export function countAccountValuationMarks(
  sqlite: Database.Database,
  accountId: string,
): number {
  const row = sqlite
    .prepare('SELECT COUNT(*) AS count FROM valuation_marks WHERE account_id = ?')
    .get(accountId) as { count: number };
  return row.count;
}

// ── Account Performance Projection ──────────────────────────────────────

/**
 * Upsert the account performance projection using the unique constraint
 * on account_id.  Returns the row.
 */
export function upsertAccountPerformance(
  sqlite: Database.Database,
  values: {
    id?: string;
    accountId: string;
    computedAsOf: string;
    netCash: string;
    nav: string;
    markedPositions: string;
    realizedPnl: string;
    unrealizedPnl: string;
    totalPnl: string;
    realizedFees: string;
    grossExposure: string;
    netExposure: string;
    modifiedDietzReturn?: string | null;
    twr?: string | null;
    highWaterMark?: string | null;
    drawdown?: string | null;
    drawdownPct?: string | null;
    warnings: string;
    positionsJson: string;
    rebuildCount: number;
    lastRebuiltAt: string;
  },
): AccountPerformanceRow {
  const id = values.id ?? randomUUID();
  const now = new Date().toISOString();

  sqlite
    .prepare(
      `INSERT INTO account_performance
       (id, account_id, computed_as_of, net_cash, nav, marked_positions,
        realized_pnl, unrealized_pnl, total_pnl, realized_fees,
        gross_exposure, net_exposure, modified_dietz_return, twr,
        high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
        rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         computed_as_of = excluded.computed_as_of,
         net_cash = excluded.net_cash,
         nav = excluded.nav,
         marked_positions = excluded.marked_positions,
         realized_pnl = excluded.realized_pnl,
         unrealized_pnl = excluded.unrealized_pnl,
         total_pnl = excluded.total_pnl,
         realized_fees = excluded.realized_fees,
         gross_exposure = excluded.gross_exposure,
         net_exposure = excluded.net_exposure,
         modified_dietz_return = excluded.modified_dietz_return,
         twr = excluded.twr,
         high_water_mark = excluded.high_water_mark,
         drawdown = excluded.drawdown,
         drawdown_pct = excluded.drawdown_pct,
         warnings = excluded.warnings,
         positions_json = excluded.positions_json,
         rebuild_count = excluded.rebuild_count,
         last_rebuilt_at = excluded.last_rebuilt_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      values.accountId,
      values.computedAsOf,
      values.netCash,
      values.nav,
      values.markedPositions,
      values.realizedPnl,
      values.unrealizedPnl,
      values.totalPnl,
      values.realizedFees,
      values.grossExposure,
      values.netExposure,
      values.modifiedDietzReturn ?? null,
      values.twr ?? null,
      values.highWaterMark ?? null,
      values.drawdown ?? null,
      values.drawdownPct ?? null,
      values.warnings,
      values.positionsJson,
      values.rebuildCount,
      values.lastRebuiltAt,
      now,
      now,
    );

  return sqlite
    .prepare(
      `SELECT id, account_id, computed_as_of, net_cash, nav, marked_positions,
              realized_pnl, unrealized_pnl, total_pnl, realized_fees,
              gross_exposure, net_exposure, modified_dietz_return, twr,
              high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
              rebuild_count, last_rebuilt_at, created_at, updated_at
       FROM account_performance WHERE account_id = ?`,
    )
    .get(values.accountId) as AccountPerformanceRow;
}

/**
 * Find the current account performance projection for an account.
 * Returns the row or undefined if no projection exists.
 */
export function findAccountPerformance(
  sqlite: Database.Database,
  accountId: string,
): AccountPerformanceRow | undefined {
  return sqlite
    .prepare(
      `SELECT id, account_id, computed_as_of, net_cash, nav, marked_positions,
              realized_pnl, unrealized_pnl, total_pnl, realized_fees,
              gross_exposure, net_exposure, modified_dietz_return, twr,
              high_water_mark, drawdown, drawdown_pct, warnings, positions_json,
              rebuild_count, last_rebuilt_at, created_at, updated_at
       FROM account_performance WHERE account_id = ?`,
    )
    .get(accountId) as AccountPerformanceRow | undefined;
}

/**
 * Delete the account performance projection for an account (rebuild cleanup).
 */
export function deleteAccountPerformanceByAccount(
  sqlite: Database.Database,
  accountId: string,
): void {
  sqlite.prepare('DELETE FROM account_performance WHERE account_id = ?').run(accountId);
}
