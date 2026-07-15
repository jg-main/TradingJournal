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
