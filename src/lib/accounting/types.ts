/**
 * Shared accounting types.
 *
 * Pure domain types — no database or Next.js imports.
 * Used by the posting kernel, API contracts, and projections.
 */

// ── Branded type for validated canonical decimal strings ─────────────────

/** A string in canonical decimal format (e.g. "1000.00", "-50.00").
 *  At minimum validates: optional minus sign, digits, period, exactly 2 fraction digits.
 *  Created via `normalizeDecimal` in decimal.ts. */
export type CanonicalDecimal = string & { readonly __brand: 'CanonicalDecimal' };

// ── Enums / Unions ──────────────────────────────────────────────────────

export const EVENT_TYPES = [
  'opening_balance',
  'trade_execution',
  'adjustment',
  'transfer',
  'deposit',
  'withdrawal',
  'dividend',
  'interest',
  'fee',
  'tax',
  'stock_split',
  'manual_adjustment',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const CASH_EVENT_TYPES: readonly EventType[] = [
  'opening_balance',
  'deposit',
  'withdrawal',
  'dividend',
  'interest',
  'fee',
  'tax',
  'manual_adjustment',
] as const;

export const CORPORATE_ACTION_EVENT_TYPES: readonly EventType[] = [
  'stock_split',
] as const;

export const POSTING_SIDES = ['debit', 'credit'] as const;

export type PostingSide = (typeof POSTING_SIDES)[number];

// ── Event Payload Types ───────────────────────────────────────────────────
//
// Payload is event-type-specific JSON stored in the financial_events.payload
// column. It carries the original data that triggered the event for audit,
// replay, and display purposes.
//
// Effect is a standardised economic-effect descriptor stored in the
// financial_events.effect column. It normalises cash vs non-cash effects
// so the projection engine can rebuild account activity without payload
// awareness.

/** Cash event payload — amount is always a positive absolute value. */
export interface CashEventPayload {
  amount: string;
  perShareAmount?: string;
  shares?: number;
  rate?: string;
  feeType?: string;
  taxType?: string;
  reason?: string;
}

/** Stock-split payload — ratio and quantity metadata, no cash amount. */
export interface StockSplitPayload {
  symbol: string;
  ratio: string;
  oldShares: number;
  newShares: number;
  oldPrice?: string;
  newPrice?: string;
}

/** Manual adjustment payload — amount is signed (+/-) to indicate direction. */
export interface ManualAdjustmentPayload {
  amount: string;
  reason?: string;
}

/** Discriminated union of all supported event payload shapes. */
export type FinancialEventPayload =
  | ({ type: 'deposit' | 'withdrawal' | 'dividend' | 'interest' | 'fee' | 'tax' } & CashEventPayload)
  | ({ type: 'stock_split' } & StockSplitPayload)
  | ({ type: 'manual_adjustment' } & ManualAdjustmentPayload);

// ── Event Effect Types ───────────────────────────────────────────────────
//
// Standardised economic effect descriptor, normalised so the projection
// engine can rebuild account activity without inspecting raw payload.

export interface CashEffect {
  kind: 'cash';
  direction: 'increase' | 'decrease';
  amount: string;
  amountMicros: number;
}

export interface NoCashEffect {
  kind: 'none';
  details?: string;
}

export interface MarketEffect {
  kind: 'market';
  symbol: string;
  details?: string;
}

export type EventEffect = CashEffect | NoCashEffect | MarketEffect;

// ── Posting Status Types ─────────────────────────────────────────────────
//
// Used by the account-activity list view to indicate whether an event has
// been posted to the ledger and whether its postings are balanced.

export type PostingStatus = 'posted' | 'pending' | 'failed';

/**
 * Status of an event in the double-entry pipeline.
 * - hasEntry: true if a ledger_entry row exists for this event
 * - isBalanced: true if debit sum === credit sum for the entry's postings
 * - postingCount: total number of ledger postings for this entry
 */
export interface EventStatus {
  hasEntry: boolean;
  isBalanced: boolean;
  postingCount: number;
}

// ── Domain Records ──────────────────────────────────────────────────────

export interface FinancialEventRecord {
  id: string;
  accountId: string;
  eventType: EventType;
  idempotencyKey: string | null;
  description: string | null;
  payload: string | null;
  effect: string | null;
  postedAt: string;
  createdAt: string;
}

export interface LedgerEntryRecord {
  id: string;
  financialEventId: string;
  accountId: string;
  description: string | null;
  postedAt: string;
  createdAt: string;
}

export interface LedgerPostingRecord {
  id: string;
  ledgerEntryId: string;
  accountId: string;
  side: PostingSide;
  amount: CanonicalDecimal;
  amountMicros: number;
  currency: string;
  sequence: number;
  createdAt: string;
}

// ── Aggregate response shapes (non-DB) ──────────────────────────────────

export interface BalancedPostingPair {
  debit: LedgerPostingRecord;
  credit: LedgerPostingRecord;
}

export interface FinancialEventWithPostings {
  event: FinancialEventRecord;
  entry: LedgerEntryRecord;
  postings: BalancedPostingPair;
}

export interface AccountEventListItem {
  event: FinancialEventRecord;
  entry: LedgerEntryRecord | null;
  postings: BalancedPostingPair | null;
  status: EventStatus;
}
