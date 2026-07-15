/**
 * API contract schemas for the accounting ledger.
 *
 * Zod validation schemas and TypeScript types for request/response
 * shapes of the financial events API surface.
 *
 * Pure types and schemas only — no database or Next.js imports.
 */

import { z } from 'zod';
import type { CanonicalDecimal } from './types';

// ── Request Schemas ──────────────────────────────────────────────────────

/**
 * Schema for POST /api/accounts/:id/financial-events
 *
 * Currently only supports opening_balance; extended with
 * additional event types in downstream milestones.
 */
export const postFinancialEventSchema = z.object({
  /** The type of financial event. Only opening_balance for now. */
  eventType: z.enum(['opening_balance'], {
    message: 'Event type must be "opening_balance"',
  }),

  /** Canonical decimal amount (e.g. "5000.00"). */
  amount: z.string().min(1, 'Amount is required'),

  /** Optional UUID idempotency key for replay-safe posting. */
  idempotencyKey: z.string().uuid('Idempotency key must be a valid UUID').optional(),

  /** Optional human-readable description. */
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
});

export type PostFinancialEventRequest = z.infer<typeof postFinancialEventSchema>;

// ── Response Schemas ─────────────────────────────────────────────────────

/**
 * Schema for a canonical posting side (debit or credit).
 */
const postingResponseSchema = z.object({
  id: z.string(),
  ledgerEntryId: z.string(),
  accountId: z.string(),
  side: z.enum(['debit', 'credit']),
  amount: z.string(),
  amountMicros: z.number(),
  currency: z.string(),
  sequence: z.number(),
  createdAt: z.string(),
});

/**
 * Schema for a ledger entry.
 */
const entryResponseSchema = z.object({
  id: z.string(),
  financialEventId: z.string(),
  accountId: z.string(),
  description: z.string().nullable(),
  postedAt: z.string(),
  createdAt: z.string(),
});

/**
 * Schema for a financial event.
 */
const eventResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  eventType: z.string(),
  idempotencyKey: z.string().nullable(),
  description: z.string().nullable(),
  postedAt: z.string(),
  createdAt: z.string(),
});

/**
 * Schema for the full financial event response.
 */
export const financialEventResponseSchema = z.object({
  event: eventResponseSchema,
  entry: entryResponseSchema,
  postings: z.object({
    debit: postingResponseSchema,
    credit: postingResponseSchema,
  }),
});

export type FinancialEventResponse = z.infer<typeof financialEventResponseSchema>;

// ── Error Response Types ─────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}
