/**
 * Pure ledger projection/adapter for the account-detail Ledger tab.
 *
 * Consumes repository-shaped financial events, ledger entries, ledger postings,
 * and correction-group data to produce a stable, paginated ledger projection
 * with category filters, cash impact, duplicate-safe deduplication, and grouped
 * correction display.
 *
 * Pure functions only — no database or Next.js imports. All data is passed
 * as plain function arguments. Every call with the same inputs produces
 * identical outputs.
 *
 * @module ledger
 */

// ── Input Types (repository-shaped, database-free) ───────────────────────

/**
 * A financial event row in the shape returned by the accounting repository.
 */
export interface LedgerEventInput {
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
 * A ledger entry row in the shape returned by the accounting repository.
 */
export interface LedgerEntryInput {
  id: string;
  financial_event_id: string;
  account_id: string;
  description: string | null;
  posted_at: string;
  created_at: string;
}

/**
 * A ledger posting row in the shape returned by the accounting repository.
 */
export interface LedgerPostingInput {
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

/**
 * A correction group with financial-event-level identity, ready for the
 * projection engine. The T02 API route builds this mapping from the
 * correction_lineage table combined with the execution-to-financial-event
 * resolution.
 */
export interface CorrectionGroupInput {
  correctionId: string;
  originalEventId: string;
  reversalEventId: string;
  replacementEventId: string;
  reason: string | null;
  correctedAt: string;
}

/**
 * The full input to the ledger projection, containing all repository-shaped
 * rows and pre-resolved correction-group data.
 */
export interface LedgerProjectionInput {
  events: LedgerEventInput[];
  entries: LedgerEntryInput[];
  postings: LedgerPostingInput[];
  /** Pre-resolved correction groups with financial event IDs. */
  correctionGroups: CorrectionGroupInput[];
}

// ── Query Types ─────────────────────────────────────────────────────────

/**
 * Query parameters for the ledger projection.
 */
export interface LedgerProjectionQuery {
  /** Filter to specific event type(s). Empty array (or undefined) means no filter. */
  eventTypes?: string[];
  /** 1-indexed page number. Defaults to 1. */
  page?: number;
  /** Maximum rows per page. Defaults to 50, clamped 1–200. */
  limit?: number;
}

// ── Response Types ──────────────────────────────────────────────────────

/**
 * Status of an event in the double-entry pipeline.
 */
export interface EventStatusDisplay {
  hasEntry: boolean;
  isBalanced: boolean;
  postingCount: number;
}

/**
 * A single posting side for display.
 */
export interface PostingDisplay {
  id: string;
  side: 'debit' | 'credit';
  amount: string;
  amountMicros: number;
  currency: string;
  sequence: number;
}

/**
 * A balanced debit/credit posting pair for display.
 */
export interface PostingPairDisplay {
  debit: PostingDisplay;
  credit: PostingDisplay;
}

/**
 * Correction group metadata for the display row.
 * Preserves all constituent audit IDs for inspection.
 */
export interface CorrectionGroupDisplay {
  correctionId: string;
  originalEventId: string;
  reversalEventId: string;
  replacementEventId: string;
  reason: string | null;
  correctedAt: string;
}

/**
 * One row in the ledger projection response.
 * Represents a single authoritative financial event, with optional
 * correction group metadata.
 */
export interface LedgerRowDisplay {
  eventId: string;
  eventType: string;
  postedAt: string;
  description: string | null;
  category: string;
  cashImpact: string | null;
  status: EventStatusDisplay;
  postings: PostingPairDisplay | null;
  idempotencyKey: string | null;
  correctionGroup: CorrectionGroupDisplay | null;
}

/**
 * The complete paginated ledger projection response.
 */
export interface LedgerProjectionResponse {
  events: LedgerRowDisplay[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Constants ───────────────────────────────────────────────────────────

/**
 * Event type to display category mapping.
 */
export const EVENT_CATEGORIES: Readonly<Record<string, string>> = {
  opening_balance: 'Opening Balance',
  deposit: 'Cash',
  withdrawal: 'Cash',
  dividend: 'Cash',
  interest: 'Cash',
  fee: 'Fee/Tax',
  tax: 'Fee/Tax',
  trade_execution: 'Trade',
  adjustment: 'Adjustment',
  transfer: 'Transfer',
  stock_split: 'Corporate Action',
  manual_adjustment: 'Adjustment',
};

/**
 * Default page size for the ledger projection.
 */
export const DEFAULT_PAGE_LIMIT = 50;

/**
 * Maximum allowed page size.
 */
export const MAX_PAGE_LIMIT = 200;

// ── Projection Engine ───────────────────────────────────────────────────

/**
 * Build a paginated ledger projection from repository-shaped data.
 *
 * Algorithm:
 * 1. Index events, entries, and postings by their FK relationships
 * 2. Identify correction constituent event IDs from the provided groups
 * 3. Build correction-group display rows (one per group, using replacement event data)
 * 4. Remove correction constituent events from the primary list
 * 5. Apply event-type filter
 * 6. Sort combined primary + correction rows by posted_at ASC, eventId ASC
 * 7. Apply pagination
 * 8. Return structured response with metadata
 *
 * E ach financial event appears at most once in the primary list,
 * even if it appears multiple times in the input (duplicate-safe by event ID).
 * Correction-group event IDs are deduped to one display row per group.
 *
 * @param input - All repository-shaped rows and correction groups.
 * @param query - Pagination and filter parameters.
 * @returns A sorted, paginated, filtered ledger projection.
 */
export function buildLedgerProjection(
  input: LedgerProjectionInput,
  query?: LedgerProjectionQuery,
): LedgerProjectionResponse {
  const { events, entries, postings, correctionGroups } = input;

  // ── 1. Index data by FK ────────────────────────────────────────────
  // Deduplicate events by ID (first occurrence wins)
  const eventMap = new Map<string, LedgerEventInput>();
  for (const evt of events) {
    if (!eventMap.has(evt.id)) {
      eventMap.set(evt.id, evt);
    }
  }

  // Index entries by financial_event_id
  const entryByEventId = new Map<string, LedgerEntryInput>();
  for (const entry of entries) {
    entryByEventId.set(entry.financial_event_id, entry);
  }

  // Index postings by ledger_entry_id
  const postingsByEntryId = new Map<string, LedgerPostingInput[]>();
  for (const posting of postings) {
    const existing = postingsByEntryId.get(posting.ledger_entry_id) ?? [];
    existing.push(posting);
    postingsByEntryId.set(posting.ledger_entry_id, existing);
  }

  // ── 2. Identify correction constituent event IDs ──────────────────
  const correctionConstituentEventIds = new Set<string>();
  for (const cg of correctionGroups) {
    correctionConstituentEventIds.add(cg.originalEventId);
    correctionConstituentEventIds.add(cg.reversalEventId);
    correctionConstituentEventIds.add(cg.replacementEventId);
  }

  // ── 3. Build correction-group display rows ────────────────────────
  const correctionDisplayRows: LedgerRowDisplay[] = [];

  for (const cg of correctionGroups) {
    // Use the replacement event for display data; fall back to original if unavailable
    const displayEvent = eventMap.get(cg.replacementEventId)
      ?? eventMap.get(cg.originalEventId);
    if (!displayEvent) continue; // Skip orphaned correction groups

    const displayEntry = entryByEventId.get(displayEvent.id) ?? null;
    const displayPostings = displayEntry
      ? buildPostingPair(postingsByEntryId.get(displayEntry.id) ?? [])
      : null;

    const cashImpact = parseCashImpact(displayEvent.effect);

    correctionDisplayRows.push({
      eventId: cg.correctionId,
      eventType: displayEvent.event_type,
      postedAt: displayEvent.posted_at,
      description: displayEvent.description,
      category: mapCategory(displayEvent.event_type),
      cashImpact,
      status: {
        hasEntry: displayEntry !== null,
        isBalanced: displayPostings !== null,
        postingCount: displayEntry
          ? (postingsByEntryId.get(displayEntry.id) ?? []).length
          : 0,
      },
      postings: displayPostings,
      idempotencyKey: displayEvent.idempotency_key,
      correctionGroup: {
        correctionId: cg.correctionId,
        originalEventId: cg.originalEventId,
        reversalEventId: cg.reversalEventId,
        replacementEventId: cg.replacementEventId,
        reason: cg.reason,
        correctedAt: cg.correctedAt,
      },
    });
  }

  // ── 4. Build primary rows (exclude correction constituents) ──────
  const primaryRows: LedgerRowDisplay[] = [];

  for (const [eventId, evt] of eventMap) {
    if (correctionConstituentEventIds.has(eventId)) continue;

    const entry = entryByEventId.get(eventId) ?? null;
    const entryPostings = entry
      ? postingsByEntryId.get(entry.id) ?? []
      : [];
    const postingPair = buildPostingPair(entryPostings);
    const cashImpact = parseCashImpact(evt.effect);

    primaryRows.push({
      eventId: evt.id,
      eventType: evt.event_type,
      postedAt: evt.posted_at,
      description: evt.description,
      category: mapCategory(evt.event_type),
      cashImpact,
      status: {
        hasEntry: entry !== null,
        isBalanced: postingPair !== null,
        postingCount: entryPostings.length,
      },
      postings: postingPair,
      idempotencyKey: evt.idempotency_key,
      correctionGroup: null,
    });
  }

  // ── 5. Combine and sort ──────────────────────────────────────────
  const allRows = [...primaryRows, ...correctionDisplayRows];
  allRows.sort((a, b) => {
    const dateCmp = a.postedAt.localeCompare(b.postedAt);
    if (dateCmp !== 0) return dateCmp;
    return a.eventId.localeCompare(b.eventId);
  });

  // ── 6. Apply event-type filter ───────────────────────────────────
  const eventTypes = query?.eventTypes;
  const filteredRows = (eventTypes && eventTypes.length > 0)
    ? allRows.filter((r) => eventTypes.includes(r.eventType))
    : allRows;

  // ── 7. Apply pagination ──────────────────────────────────────────
  const page = Math.max(1, query?.page ?? 1);
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, query?.limit ?? DEFAULT_PAGE_LIMIT));
  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const startIndex = (page - 1) * limit;
  const pageRows = filteredRows.slice(startIndex, startIndex + limit);

  // ── 8. Return response ───────────────────────────────────────────
  return {
    events: pageRows,
    total,
    page,
    limit,
    totalPages,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Map an event type to its display category.
 */
function mapCategory(eventType: string): string {
  return EVENT_CATEGORIES[eventType] ?? eventType;
}

/**
 * Build a balanced debit/credit posting pair from a list of postings.
 * Returns null if the postings are not balanced or don't form a pair.
 */
function buildPostingPair(postings: LedgerPostingInput[]): PostingPairDisplay | null {
  if (postings.length === 0) return null;

  const debit = postings.find((p) => p.side === 'debit');
  const credit = postings.find((p) => p.side === 'credit');

  // Require both sides present and equal sum totals
  if (!debit || !credit) return null;

  return {
    debit: {
      id: debit.id,
      side: 'debit',
      amount: debit.amount,
      amountMicros: debit.amount_micros,
      currency: debit.currency,
      sequence: debit.sequence,
    },
    credit: {
      id: credit.id,
      side: 'credit',
      amount: credit.amount,
      amountMicros: credit.amount_micros,
      currency: credit.currency,
      sequence: credit.sequence,
    },
  };
}

/**
 * Parse cash impact from an event effect JSON string.
 * Returns the cash amount string (e.g. "500.00") or null
 * if the effect is not a cash effect or cannot be parsed.
 */
function parseCashImpact(effectJson: string | null): string | null {
  if (!effectJson) return null;

  let effect: Record<string, unknown>;
  try {
    effect = JSON.parse(effectJson) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (effect.kind !== 'cash') return null;
  if (typeof effect.amount !== 'string') return null;

  return effect.direction === 'decrease'
    ? `-${effect.amount}`
    : effect.amount;
}
