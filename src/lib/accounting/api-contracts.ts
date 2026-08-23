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

// ── Shared helpers ──────────────────────────────────────────────────────

export const canonicalDecimalSchema = z
  .string()
  .regex(
    /^-?\d+\.\d{2}$/,
    'Must be a canonical decimal (e.g. "100.00")',
  );

export const optionalUuidSchema = z.string().uuid('Must be a valid UUID').optional();

export const descriptionSchema = z.string().max(500).optional();

// ── Event-type-specific payload schemas ──────────────────────────────────

/** Payload schema for cash-flow events (deposit, withdrawal, dividend, etc.). */
const cashEventPayloadSchema = z.object({
  amount: canonicalDecimalSchema.refine(
    (v) => !v.startsWith('-'),
    { message: 'Cash amount must be a positive canonical decimal' },
  ),
  perShareAmount: canonicalDecimalSchema.optional(),
  shares: z.number().int().positive().optional(),
  rate: z.string().optional(),
  feeType: z.string().optional(),
  taxType: z.string().optional(),
  reason: z.string().max(1000).optional(),
});

/** Payload schema for stock-split corporate actions. */
const stockSplitPayloadSchema = z.object({
  symbol: z.string().min(1).max(20),
  ratio: z.string().regex(/^\d+\.?\d*:\d+\.?\d*$/, 'Stock split ratio must be in X:Y format (e.g. "4:1")'),
  oldShares: z.number().int().positive(),
  newShares: z.number().int().positive(),
  oldPrice: canonicalDecimalSchema.optional(),
  newPrice: canonicalDecimalSchema.optional(),
});

/** Payload schema for manual adjustments (signed amounts). */
const manualAdjustmentPayloadSchema = z.object({
  amount: canonicalDecimalSchema.refine(
    (v) => v !== '0.00',
    { message: 'Manual adjustment amount must be non-zero' },
  ),
  reason: z.string().max(1000).optional(),
});

// ── Per-event-type request schemas ──────────────────────────────────────

const depositSchema = z.object({
  eventType: z.literal('deposit'),
  amount: canonicalDecimalSchema.refine(
    (v) => !v.startsWith('-'),
    { message: 'Deposit amount must be positive' },
  ),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

const withdrawalSchema = z.object({
  eventType: z.literal('withdrawal'),
  amount: canonicalDecimalSchema.refine(
    (v) => !v.startsWith('-'),
    { message: 'Withdrawal amount must be positive' },
  ),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

const dividendSchema = z.object({
  eventType: z.literal('dividend'),
  amount: canonicalDecimalSchema.refine(
    (v) => !v.startsWith('-'),
    { message: 'Dividend amount must be positive' },
  ),
  perShareAmount: canonicalDecimalSchema.optional(),
  shares: z.number().int().positive().optional(),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

const interestSchema = z.object({
  eventType: z.literal('interest'),
  amount: canonicalDecimalSchema.refine(
    (v) => !v.startsWith('-'),
    { message: 'Interest amount must be positive' },
  ),
  rate: z.string().optional(),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

const feeSchema = z.object({
  eventType: z.literal('fee'),
  amount: canonicalDecimalSchema.refine(
    (v) => !v.startsWith('-'),
    { message: 'Fee amount must be positive' },
  ),
  feeType: z.string().optional(),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

const taxSchema = z.object({
  eventType: z.literal('tax'),
  amount: canonicalDecimalSchema.refine(
    (v) => !v.startsWith('-'),
    { message: 'Tax amount must be positive' },
  ),
  taxType: z.string().optional(),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

const stockSplitSchema = z.object({
  eventType: z.literal('stock_split'),
  symbol: z.string().min(1).max(20),
  ratio: z.string().regex(/^\d+\.?\d*:\d+\.?\d*$/, 'Stock split ratio must be in X:Y format (e.g. "4:1")'),
  oldShares: z.number().int().positive(),
  newShares: z.number().int().positive(),
  oldPrice: canonicalDecimalSchema.optional(),
  newPrice: canonicalDecimalSchema.optional(),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

const manualAdjustmentSchema = z.object({
  eventType: z.literal('manual_adjustment'),
  /** Signed canonical decimal: positive = cash inflow, negative = outflow. */
  amount: canonicalDecimalSchema.refine(
    (v) => v !== '0.00',
    { message: 'Adjustment amount must be non-zero' },
  ),
  reason: z.string().max(1000).optional(),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

// ── Request Schemas ──────────────────────────────────────────────────────

/**
 * Schema for POST /api/accounts/:id/financial-events
 *
 * Discriminated union that validates the correct payload shape for each
 * supported event type. Opening-balance validation reuses the existing
 * S01 `postFinancialEventSchema` pattern for backward compatibility.
 */
/** Legacy opening-balance event schema (S01). Preserved for backward compatibility. */
const openingBalanceSchema = z.object({
  eventType: z.literal('opening_balance'),
  amount: canonicalDecimalSchema.refine(
    (v) => !v.startsWith('-'),
    { message: 'Opening balance amount must be positive' },
  ),
  idempotencyKey: optionalUuidSchema,
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

export const postFinancialEventSchema = z.discriminatedUnion('eventType', [
  openingBalanceSchema,
  depositSchema,
  withdrawalSchema,
  dividendSchema,
  interestSchema,
  feeSchema,
  taxSchema,
  stockSplitSchema,
  manualAdjustmentSchema,
]);

export type PostFinancialEventRequest = z.infer<typeof postFinancialEventSchema>;

// ── Account Initialization Schemas (A2) ────────────────────────────────

/**
 * Schema for POST /api/accounts/:id/initialize.
 *
 * Completes new-account initialization in one server-side transaction.
 * mode 'opening_balance' records the initial capital as an immutable
 * opening_balance financial event AND activates the account; mode 'zero'
 * activates with a zero balance and no financial event.
 */
export const initializeAccountRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('opening_balance'),
    amount: canonicalDecimalSchema.refine(
      (v) => !v.startsWith('-'),
      { message: 'Opening balance amount must be positive' },
    ),
    idempotencyKey: optionalUuidSchema,
    description: descriptionSchema,
    postedAt: z.string().datetime().optional(),
  }),
  z.object({
    mode: z.literal('zero'),
  }),
]);

export type InitializeAccountRequest = z.infer<typeof initializeAccountRequestSchema>;

// ── Financial Event Correction Schemas ──────────────────────────────────

/**
 * Schema for POST /api/accounts/:id/financial-events/:eventId/correct
 *
 * Corrects a posted financial event through the immutable
 * reversal-and-replacement pattern. The original event is never modified;
 * a reversal event cancels its cash effect and a replacement event carries
 * the corrected values, linked by a correction lineage record.
 *
 * Fields:
 * - amount: Replacement amount (canonical decimal). Signed for
 *   manual_adjustment (positive = inflow, negative = outflow); must be
 *   positive for all other correctable types.
 * - description: Optional replacement description (max 500 chars).
 * - reason: Required human-readable reason for the correction.
 * - idempotencyKey: Optional UUID for idempotent correction.
 * - postedAt: Optional ISO-8601 timestamp (defaults to server time).
 */
export const financialEventCorrectionInputSchema = z.object({
  amount: canonicalDecimalSchema.refine(
    (v) => v !== '0.00',
    { message: 'Correction amount must be non-zero' },
  ),
  description: descriptionSchema,
  reason: z.string().min(1, 'Correction reason is required').max(1000),
  idempotencyKey: optionalUuidSchema,
  postedAt: z.string().datetime().optional(),
});

export type FinancialEventCorrectionInput = z.infer<typeof financialEventCorrectionInputSchema>;

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
 * Schema for a financial event (includes payload/effect fields).
 */
const eventResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  eventType: z.string(),
  idempotencyKey: z.string().nullable(),
  description: z.string().nullable(),
  payload: z.string().nullable(),
  effect: z.string().nullable(),
  postedAt: z.string(),
  createdAt: z.string(),
});

/**
 * Schema for a financial event in correction API responses.
 * Reuses the event response shape (already includes eventType).
 */
export const correctionFinancialEventResponseSchema = eventResponseSchema;

export type CorrectionFinancialEventResponse = z.infer<typeof correctionFinancialEventResponseSchema>;

/**
 * Schema for the full financial event correction response.
 */
export const financialEventCorrectionResponseSchema = z.object({
  success: z.literal(true),
  correction: z.object({
    id: z.string(),
    accountId: z.string(),
    originalEventId: z.string(),
    reversalEventId: z.string(),
    replacementEventId: z.string(),
    reason: z.string(),
    correctedAt: z.string(),
  }),
  originalEvent: correctionFinancialEventResponseSchema,
  reversalEvent: correctionFinancialEventResponseSchema,
  replacementEvent: correctionFinancialEventResponseSchema,
});

export type FinancialEventCorrectionResponse = z.infer<typeof financialEventCorrectionResponseSchema>;

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

/**
 * Schema for a single event item in the account-activity list.
 */
export const eventStatusResponseSchema = z.object({
  hasEntry: z.boolean(),
  isBalanced: z.boolean(),
  postingCount: z.number(),
});

export const accountEventListItemSchema = z.object({
  event: eventResponseSchema,
  entry: entryResponseSchema.nullable(),
  postings: z.object({
    debit: postingResponseSchema,
    credit: postingResponseSchema,
  }).nullable(),
  status: eventStatusResponseSchema,
});

export type AccountEventListItemResponse = z.infer<typeof accountEventListItemSchema>;

/**
 * Schema for the list response.
 */
export const listFinancialEventsResponseSchema = z.object({
  events: z.array(accountEventListItemSchema),
  total: z.number(),
});

export type ListFinancialEventsResponse = z.infer<typeof listFinancialEventsResponseSchema>;

// ── Error Response Types ─────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}
