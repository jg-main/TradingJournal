/**
 * Execution contract schemas for the accounting engine.
 *
 * Pure Zod/domain types for execution validation, supported actions,
 * fractional quantities, optional journal attribution, and typed
 * failure codes.
 *
 * No database or Next.js imports — pure validation and type contracts.
 */

import { z } from 'zod';
import type { CanonicalDecimal } from './types';
import type {
  ExecutionAction,
  FifoRejectionCode,
} from '../positions/types';

// ── Shared helpers ──────────────────────────────────────────────────────

const canonicalDecimalSchema = z
  .string()
  .regex(
    /^-?\d+\.\d{2}$/,
    'Must be a canonical decimal (e.g. "100.00")',
  );

const positiveCanonicalDecimalSchema = canonicalDecimalSchema.refine(
  (v) => !v.startsWith('-') && v !== '0.00',
  { message: 'Must be a positive canonical decimal (e.g. "50.00")' },
);

const nonNegativeCanonicalDecimalSchema = canonicalDecimalSchema.refine(
  (v) => !v.startsWith('-'),
  { message: 'Must be a non-negative canonical decimal (e.g. "0.00" or "5.00")' },
);

const uuidSchema = z.string().uuid('Must be a valid UUID');

const descriptionSchema = z.string().max(500).optional();

// ── Supported Execution Actions ──────────────────────────────────────────

export const EXECUTION_ACTION_VALUES = [
  'buy',
  'sell',
  'sell_short',
  'buy_to_cover',
  'add',
  'reduce',
] as const;

export const executionActionSchema = z.enum(EXECUTION_ACTION_VALUES);

// ── Execution Validation Schema ─────────────────────────────────────────

/**
 * Schema for validating an accounting execution fill.
 *
 * Fields:
 * - action: buy/sell/sell_short/buy_to_cover/add/reduce
 * - quantity: Positive canonical decimal (e.g. "50.00")
 * - price: Positive canonical decimal (e.g. "150.75")
 * - fees: Non-negative canonical decimal (defaults to "0.00")
 * - idempotencyKey: Optional UUID for idempotent execution posting
 * - journalTradeId: Optional UUID linking to a journal trade (attribution only)
 * - description: Optional human-readable description
 * - postedAt: Optional ISO-8601 timestamp (defaults to server time)
 */
export const executionInputSchema = z.object({
  action: executionActionSchema,
  quantity: positiveCanonicalDecimalSchema,
  price: positiveCanonicalDecimalSchema,
  fees: nonNegativeCanonicalDecimalSchema.optional().default('0.00'),
  idempotencyKey: uuidSchema.optional(),
  journalTradeId: uuidSchema.optional(),
  description: descriptionSchema,
  postedAt: z.string().datetime().optional(),
});

export type ExecutionInput = z.infer<typeof executionInputSchema>;

// ── Response Schemas ──────────────────────────────────────────────────

/**
 * Schema for an accounting execution in API responses.
 */
export const executionResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  instrumentId: z.string(),
  action: executionActionSchema,
  quantity: z.string(),
  price: z.string(),
  fees: z.string(),
  idempotencyKey: z.string().nullable(),
  journalTradeId: z.string().nullable(),
  description: z.string().nullable(),
  postedAt: z.string(),
  createdAt: z.string(),
});

export type ExecutionResponse = z.infer<typeof executionResponseSchema>;

/**
 * Schema for a FIFO lot in API responses.
 */
export const fifoLotResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  instrumentId: z.string(),
  direction: z.enum(['long', 'short']),
  remainingQuantity: z.string(),
  originalQuantity: z.string(),
  entryPrice: z.string(),
  costBasisTotal: z.string(),
  allocatedFees: z.string(),
  openingExecutionId: z.string(),
  openedAt: z.string(),
});

export type FifoLotResponse = z.infer<typeof fifoLotResponseSchema>;

/**
 * Schema for a lot match in API responses.
 */
export const lotMatchResponseSchema = z.object({
  id: z.string(),
  closingExecutionId: z.string(),
  lotId: z.string(),
  matchQuantity: z.string(),
  matchPrice: z.string(),
  realizedGrossPnl: z.string(),
  allocatedFees: z.string(),
  realizedNetPnl: z.string(),
  sequence: z.number().int(),
});

export type LotMatchResponse = z.infer<typeof lotMatchResponseSchema>;

/**
 * Schema for a position state in API responses.
 */
export const positionStateResponseSchema = z.object({
  accountId: z.string(),
  instrumentId: z.string(),
  direction: z.enum(['long', 'short']).nullable(),
  quantity: z.string(),
  averageCost: z.string(),
  totalCostBasis: z.string(),
  realizedGrossPnl: z.string(),
  realizedFees: z.string(),
  realizedNetPnl: z.string(),
  openLots: z.array(fifoLotResponseSchema),
  lastUpdated: z.string(),
});

export type PositionStateResponse = z.infer<typeof positionStateResponseSchema>;

/**
 * Schema for a successful execution response (includes position state).
 */
export const executionSuccessResponseSchema = z.object({
  success: z.literal(true),
  execution: executionResponseSchema,
  position: positionStateResponseSchema,
});

export type ExecutionSuccessResponse = z.infer<typeof executionSuccessResponseSchema>;

/**
 * Schema for a rejected execution response.
 */
export const executionRejectionResponseSchema = z.object({
  success: z.literal(false),
  code: z.string(),
  message: z.string(),
});

export type ExecutionRejectionResponse = z.infer<typeof executionRejectionResponseSchema>;

// ── Error Response Types ────────────────────────────────────────────────

/**
 * Typed API error response for execution failures.
 */
export interface ExecutionApiError {
  error: string;
  code: FifoRejectionCode;
  details?: {
    action: string;
    quantity?: string;
    availableQuantity?: string;
  };
}

// ── Idempotent Execution Request (POST body) ─────────────────────────────

/**
 * Schema for POST /api/accounts/:id/executions request body.
 */
export const postExecutionSchema = executionInputSchema;

export type PostExecutionRequest = z.infer<typeof postExecutionSchema>;

// ── List Executions Query ───────────────────────────────────────────────

/**
 * Schema for GET /api/accounts/:id/executions query parameters.
 */
export const listExecutionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  instrumentId: z.string().uuid().optional(),
  action: executionActionSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;

// ── Positions Query ─────────────────────────────────────────────────────

/**
 * Schema for GET /api/accounts/:id/positions query parameters.
 */
export const listPositionsQuerySchema = z.object({
  instrumentId: z.string().uuid().optional(),
  direction: z.enum(['long', 'short']).optional(),
});

export type ListPositionsQuery = z.infer<typeof listPositionsQuerySchema>;
