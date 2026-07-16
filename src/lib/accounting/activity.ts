/**
 * Deterministic activity and cash projection.
 *
 * Reads all posted financial events for an account and produces a sorted
 * activity list with parsed economic effects.  Provides a pure-function
 * rebuild path that proves deposits/withdrawals are treated as cash flows
 * rather than profit/loss inputs.
 *
 * Pure projection logic — never creates, updates, or deletes any rows.
 * Every call with the same data produces identical output.
 *
 * @module activity
 */

import Database from 'better-sqlite3';
import { fromMicros, toMicros } from './decimal';
import type { CanonicalDecimal, EventType, EventEffect } from './types';

// ── Activity Types ──────────────────────────────────────────────────────

/**
 * One event in the account activity list, with parsed effect.
 */
export interface ActivityEventItem {
  /** Financial event ID. */
  eventId: string;
  /** The event type label (e.g. 'deposit', 'stock_split'). */
  eventType: EventType;
  /** Human-readable description, or null. */
  description: string | null;
  /** ISO-8601 posting timestamp. */
  postedAt: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Parsed event payload object, or null. */
  payload: Record<string, unknown> | null;
  /** Parsed economic effect, or null. */
  effect: EventEffect | null;
  /** Whether ledger postings exist for this event. */
  postingStatus: 'posted' | 'pending';
}

/**
 * The full account-activity projection for one account.
 *
 * Deterministic — identical input data always produces the same output.
 * Rebuilt at query time; never stored (always a derived view).
 */
export interface AccountActivity {
  /** The account this projection covers. */
  accountId: string;
  /** Events in deterministic posted_at/id order. */
  events: ActivityEventItem[];
  /** Total number of events. */
  totalCount: number;
  /** ISO-8601 timestamp of when the rebuild was computed. */
  rebuiltAt: string;
}

/**
 * Summary of cash flows from all financial events with cash effects.
 */
export interface CashFlowSummary {
  /** Total cash inflow (increase effects) as canonical decimal. */
  totalCashInflow: CanonicalDecimal;
  /** Total cash inflow in integer micros. */
  totalCashInflowMicros: number;
  /** Total cash outflow (decrease effects) as canonical decimal. */
  totalCashOutflow: CanonicalDecimal;
  /** Total cash outflow in integer micros. */
  totalCashOutflowMicros: number;
  /** Net cash impact (inflow - outflow) as canonical decimal. */
  netCashImpact: CanonicalDecimal;
  /** Net cash impact in integer micros. */
  netCashImpactMicros: number;
  /** Number of inflow events. */
  inflowCount: number;
  /** Number of outflow events. */
  outflowCount: number;
  /** ISO-8601 timestamp of when the rebuild was computed. */
  rebuiltAt: string;
}

// ── Raw Row Types ───────────────────────────────────────────────────────

interface ActivityEventRow {
  id: string;
  event_type: string;
  description: string | null;
  payload: string | null;
  effect: string | null;
  posted_at: string;
  created_at: string;
  entry_id: string | null;
}

// ── Activity Rebuild ────────────────────────────────────────────────────

/**
 * Reconstruct the full account activity for one account from its
 * immutable financial events.
 *
 * Returns a deterministic, sorted list of all events with their parsed
 * payload and effect descriptors.  Independent of legacy transaction tables.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param accountId - The account to rebuild activity for.
 * @returns The computed AccountActivity projection.
 */
export function computeAccountActivity(
  sqlite: Database.Database,
  accountId: string,
): AccountActivity {
  const rows = sqlite
    .prepare(
      `SELECT fe.id, fe.event_type, fe.description, fe.payload, fe.effect,
              fe.posted_at, fe.created_at,
              le.id AS entry_id
       FROM financial_events fe
       LEFT JOIN ledger_entries le ON le.financial_event_id = fe.id
       WHERE fe.account_id = ?
       ORDER BY fe.posted_at ASC, fe.id ASC`,
    )
    .all(accountId) as ActivityEventRow[];

  const events: ActivityEventItem[] = rows.map((r) => ({
    eventId: r.id,
    eventType: r.event_type as EventType,
    description: r.description,
    postedAt: r.posted_at,
    createdAt: r.created_at,
    payload: r.payload ? tryParseJSON(r.payload) : null,
    effect: deriveActivityEffect(
      r.event_type as EventType,
      r.payload ? tryParseJSON(r.payload) : null,
      r.effect ? (tryParseJSON(r.effect) as EventEffect | null) : null,
    ),
    postingStatus: r.entry_id ? 'posted' : 'pending',
  }));

  return {
    accountId,
    events,
    totalCount: events.length,
    rebuiltAt: new Date().toISOString(),
  };
}

/**
 * Return a usable cash effect for an activity event.
 *
 * Early migrated trade executions stored a `#skip#` display placeholder in
 * their immutable effect JSON. Their payload retains the economic inputs, so
 * reconstruct the real effect at read time without rewriting the event.
 */
function deriveActivityEffect(
  eventType: EventType,
  payload: unknown,
  effect: EventEffect | null,
): EventEffect | null {
  // Execution payloads are the immutable economic source of truth. This also
  // repairs legacy `#skip#` effects and earlier correction rows whose effect
  // direction was recorded incorrectly.
  if (eventType !== 'trade_execution') {
    return effect;
  }

  if (!payload || typeof payload !== 'object') {
    return effect;
  }

  const execution = payload as { action?: unknown; quantity?: unknown; price?: unknown };
  if (
    typeof execution.action !== 'string'
    || typeof execution.quantity !== 'string'
    || typeof execution.price !== 'string'
  ) {
    return effect;
  }

  const cashIncreaseActions = new Set(['sell', 'reduce', 'sell_short']);
  const cashDecreaseActions = new Set(['buy', 'add', 'buy_to_cover']);
  if (!cashIncreaseActions.has(execution.action) && !cashDecreaseActions.has(execution.action)) {
    return effect;
  }

  try {
    const considerationMicros = Number(
      (BigInt(toMicros(execution.quantity)) * BigInt(toMicros(execution.price))) / BigInt(1_000_000),
    );
    return {
      kind: 'cash',
      direction: cashIncreaseActions.has(execution.action) ? 'increase' : 'decrease',
      amount: fromMicros(considerationMicros),
      amountMicros: considerationMicros,
    };
  } catch {
    return effect;
  }
}

// ── Cash Flow Projection ────────────────────────────────────────────────

/**
 * Compute the net cash impact from account activity.
 *
 * Replays all events with cash effects and produces a summary of
 * inflows vs outflows.  Proves deposits/withdrawals are treated as
 * cash flows rather than profit/loss inputs — only events with
 * `effect.kind === 'cash'` contribute to the cash summary.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param accountId - The account to compute the cash impact for.
 * @returns The computed CashFlowSummary.
 */
export function computeAccountCashImpact(
  sqlite: Database.Database,
  accountId: string,
): CashFlowSummary {
  const activity = computeAccountActivity(sqlite, accountId);
  return computeRebuildCashFlow(activity.events);
}

/**
 * Pure function: rebuild cash flow result from a list of ActivityEventItem.
 *
 * Deterministic — same input always produces the same output.
 * Useful for testing the cash flow projection without a database.
 *
 * Only events with `effect.kind === 'cash'` are counted.
 * - `direction === 'increase'` → inflow
 * - `direction === 'decrease'` → outflow
 * - Market effects (stock_split) → ignored (no cash impact)
 *
 * @param events - Sorted list of activity events with parsed effects.
 * @returns The computed CashFlowSummary.
 */
export function computeRebuildCashFlow(events: ActivityEventItem[]): CashFlowSummary {
  let totalInflowMicros = 0;
  let totalOutflowMicros = 0;
  let inflowCount = 0;
  let outflowCount = 0;

  for (const event of events) {
    if (!event.effect || event.effect.kind !== 'cash') continue;

    if (event.effect.direction === 'increase') {
      totalInflowMicros += event.effect.amountMicros;
      inflowCount++;
    } else if (event.effect.direction === 'decrease') {
      totalOutflowMicros += event.effect.amountMicros;
      outflowCount++;
    }
  }

  const netMicros = totalInflowMicros - totalOutflowMicros;

  return {
    totalCashInflow: fromMicros(totalInflowMicros),
    totalCashInflowMicros: totalInflowMicros,
    totalCashOutflow: fromMicros(totalOutflowMicros),
    totalCashOutflowMicros: totalOutflowMicros,
    netCashImpact: fromMicros(netMicros),
    netCashImpactMicros: netMicros,
    inflowCount,
    outflowCount,
    rebuiltAt: new Date().toISOString(),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Safely parse a JSON string, returning null on failure.
 */
function tryParseJSON(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
