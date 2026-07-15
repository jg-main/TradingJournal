/**
 * Accounting projection rebuild engine.
 *
 * Reads immutable ledger postings and reconstructs derived projections
 * deterministically. The first projection boundary is opening cash:
 * the sum of all debit-side opening-balance postings for a given account.
 *
 * Pure projection logic — no mutations, no random IDs, no side effects.
 * Every call with the same data produces identical output.
 *
 * @module rebuild
 */

import Database from 'better-sqlite3';
import { fromMicros } from './decimal';
import type { CanonicalDecimal, EventType } from './types';

// ── Projection Types ────────────────────────────────────────────────────

/**
 * One event that contributed to the opening cash projection.
 */
export interface CashContributingEvent {
  /** Financial event ID. */
  eventId: string;
  /** The event type (always 'opening_balance' in this projection). */
  eventType: EventType;
  /** The canonical amount of the debit posting. */
  amount: CanonicalDecimal;
  /** The amount in integer micros. */
  amountMicros: number;
  /** ISO-8601 timestamp of when this event was posted. */
  postedAt: string;
  /** Stable sequence number (from ledger_postings). */
  sequence: number;
}

/**
 * The full opening-cash projection for one account.
 *
 * Deterministic — identical input data always produces the same output.
 * Rebuilt at query time; never stored (always a derived view).
 */
export interface OpeningCashProjection {
  /** The account this projection covers. */
  accountId: string;
  /** Total opening cash as a canonical decimal string. */
  totalOpeningCash: CanonicalDecimal;
  /** Total opening cash in integer micros. */
  totalOpeningCashMicros: number;
  /** The individual events contributing to this projection. */
  events: CashContributingEvent[];
  /** ISO-8601 timestamp of when the rebuild was computed. */
  rebuiltAt: string;
}

// ── Raw Row Types (SQLite -> projection) ────────────────────────────────

interface EventRow {
  event_id: string;
  event_type: string;
  posted_at: string;
}

interface PostingRow {
  posting_id: string;
  ledger_entry_id: string;
  side: string;
  amount: string;
  amount_micros: number;
  sequence: number;
}

// ── Rebuild ─────────────────────────────────────────────────────────────

/**
 * Reconstruct the opening-cash projection for an account from its
 * immutable ledger postings.
 *
 * Computes total opening cash by aggregating all debit-side postings
 * from opening-balance events for the account.  The result is
 * deterministic — same data always yields the same total and event
 * list (sorted by sequence).
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param accountId - The account to rebuild the projection for.
 * @returns The fully computed OpeningCashProjection.
 */
export function rebuildOpeningCash(
  sqlite: Database.Database,
  accountId: string,
): OpeningCashProjection {
  // 1. Fetch all opening_balance financial events for this account, ordered by posted_at
  const eventRows = sqlite
    .prepare(
      `SELECT fe.id AS event_id, fe.event_type, fe.posted_at
       FROM financial_events fe
       WHERE fe.account_id = ? AND fe.event_type = 'opening_balance'
       ORDER BY fe.posted_at ASC, fe.id ASC`,
    )
    .all(accountId) as EventRow[];

  if (eventRows.length === 0) {
    return {
      accountId,
      totalOpeningCash: '0.00' as CanonicalDecimal,
      totalOpeningCashMicros: 0,
      events: [],
      rebuiltAt: new Date().toISOString(),
    };
  }

  // 2. For each event, find the associated debit posting
  const events: CashContributingEvent[] = [];
  let totalMicros = 0;

  for (const eventRow of eventRows) {
    // Find the matching ledger entry
    const entry = sqlite
      .prepare(
        `SELECT le.id AS entry_id
         FROM ledger_entries le
         WHERE le.financial_event_id = ?
         LIMIT 1`,
      )
      .get(eventRow.event_id) as { entry_id: string } | undefined;

    if (!entry) continue;

    // Get the debit posting for this entry (stable ordering by side ASC so debit=1st)
    const debitPosting = sqlite
      .prepare(
        `SELECT lp.id AS posting_id, lp.ledger_entry_id, lp.side,
                lp.amount, lp.amount_micros, lp.sequence
         FROM ledger_postings lp
         WHERE lp.ledger_entry_id = ? AND lp.side = 'debit'
         ORDER BY lp.sequence ASC
         LIMIT 1`,
      )
      .get(entry.entry_id) as PostingRow | undefined;

    if (!debitPosting) continue;

    totalMicros += debitPosting.amount_micros;

    events.push({
      eventId: eventRow.event_id,
      eventType: eventRow.event_type as EventType,
      amount: debitPosting.amount as CanonicalDecimal,
      amountMicros: debitPosting.amount_micros,
      postedAt: eventRow.posted_at,
      sequence: debitPosting.sequence,
    });
  }

  // 3. Compute the total
  const totalCash = fromMicros(totalMicros);

  return {
    accountId,
    totalOpeningCash: totalCash,
    totalOpeningCashMicros: totalMicros,
    events: events.sort((a, b) => a.sequence - b.sequence),
    rebuiltAt: new Date().toISOString(),
  };
}

// ── Activities ────────────────────────────────────────────────────────

/**
 * Raw activity event returned by rebuildAccountActivity.
 * Provides a raw (non-parsed) view of events for the activity rebuild path.
 */
export interface AccountActivityRow {
  eventId: string;
  eventType: EventType;
  description: string | null;
  payload: string | null;
  effect: string | null;
  postedAt: string;
  createdAt: string;
  hasEntry: boolean;
}

/**
 * Rebuild all financial events for an account (raw query path).
 *
 * Returns events in posted_at/id order with raw payload/effect JSON strings.
 * Unlike `computeAccountActivity` in `activity.ts`, this returns raw strings
 * for the rebuild/projection path and does not parse effect objects.
 *
 * Deterministic — same data always produces the same output.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param accountId - The account to rebuild events for.
 * @returns Ordered array of AccountActivityRow.
 */
export function rebuildAccountActivity(
  sqlite: Database.Database,
  accountId: string,
): AccountActivityRow[] {
  const rows = sqlite
    .prepare(
      `SELECT fe.id, fe.event_type, fe.description, fe.payload, fe.effect,
              fe.posted_at, fe.created_at,
              CASE WHEN le.id IS NOT NULL THEN 1 ELSE 0 END AS has_entry
       FROM financial_events fe
       LEFT JOIN ledger_entries le ON le.financial_event_id = fe.id
       WHERE fe.account_id = ?
       ORDER BY fe.posted_at ASC, fe.id ASC`,
    )
    .all(accountId) as Array<{
      id: string;
      event_type: string;
      description: string | null;
      payload: string | null;
      effect: string | null;
      posted_at: string;
      created_at: string;
      has_entry: number;
    }>;

  return rows.map((r) => ({
    eventId: r.id,
    eventType: r.event_type as EventType,
    description: r.description,
    payload: r.payload,
    effect: r.effect,
    postedAt: r.posted_at,
    createdAt: r.created_at,
    hasEntry: r.has_entry === 1,
  }));
}

/**
 * Rebuild the postings projection: net cash position for an account
 * from all posted ledger entries (all event types).
 *
 * Computes net = sum(all debit amounts for the account) -
 *               sum(all credit amounts for the account).
 *
 * For a balanced ledger, net over all accounts is zero; for a single
 * account this gives the account's net cash position.
 *
 * Determinisic — same data always produces identical output.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param accountId - The account to compute the net position for.
 * @returns The net cash position.
 */
export function rebuildNetPosition(
  sqlite: Database.Database,
  accountId: string,
): { netMicros: number; netAmount: CanonicalDecimal } {
  const debitTotal = sqlite
    .prepare(
      `SELECT COALESCE(SUM(lp.amount_micros), 0) AS total
       FROM ledger_postings lp
       WHERE lp.account_id = ? AND lp.side = 'debit'`,
    )
    .get(accountId) as { total: number };

  const creditTotal = sqlite
    .prepare(
      `SELECT COALESCE(SUM(lp.amount_micros), 0) AS total
       FROM ledger_postings lp
       WHERE lp.account_id = ? AND lp.side = 'credit'`,
    )
    .get(accountId) as { total: number };

  const netMicros = debitTotal.total - creditTotal.total;

  return {
    netMicros,
    netAmount: fromMicros(netMicros),
  };
}

/**
 * Verify that the ledger is globally balanced (sum of all debits == sum of all credits).
 * Returns the difference in micros; 0 means the ledger is balanced.
 */
export function checkLedgerBalance(
  sqlite: Database.Database,
): { isBalanced: boolean; debitTotal: number; creditTotal: number; difference: number } {
  const debitTotal = sqlite
    .prepare('SELECT COALESCE(SUM(amount_micros), 0) AS total FROM ledger_postings WHERE side = \'debit\'')
    .get() as { total: number };

  const creditTotal = sqlite
    .prepare('SELECT COALESCE(SUM(amount_micros), 0) AS total FROM ledger_postings WHERE side = \'credit\'')
    .get() as { total: number };

  const difference = debitTotal.total - creditTotal.total;

  return {
    isBalanced: difference === 0,
    debitTotal: debitTotal.total,
    creditTotal: creditTotal.total,
    difference,
  };
}
