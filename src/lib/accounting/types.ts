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
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const POSTING_SIDES = ['debit', 'credit'] as const;

export type PostingSide = (typeof POSTING_SIDES)[number];

// ── Domain Records ──────────────────────────────────────────────────────

export interface FinancialEventRecord {
  id: string;
  accountId: string;
  eventType: EventType;
  idempotencyKey: string | null;
  description: string | null;
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
