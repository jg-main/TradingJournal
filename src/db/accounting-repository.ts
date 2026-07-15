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
import type { CanonicalDecimal, EventType, PostingSide } from '../lib/accounting/types';

// ── Row Shape Helpers (matching Drizzle table columns) ──────────────────

export interface FinancialEventRow {
  id: string;
  account_id: string;
  event_type: string;
  idempotency_key: string | null;
  description: string | null;
  posted_at: string;
  created_at: string;
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
      `SELECT id, account_id, event_type, idempotency_key, description, posted_at, created_at
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
    postedAt: string;
  },
): FinancialEventRow {
  const id = values.id ?? randomUUID();
  sqlite
    .prepare(
      `INSERT INTO financial_events (id, account_id, event_type, idempotency_key, description, posted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.accountId,
      values.eventType,
      values.idempotencyKey ?? null,
      values.description ?? null,
      values.postedAt,
    );
  // Return the canonical row shape
  return {
    id,
    account_id: values.accountId,
    event_type: values.eventType,
    idempotency_key: values.idempotencyKey ?? null,
    description: values.description ?? null,
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
      `SELECT id, account_id, event_type, idempotency_key, description, posted_at, created_at
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
