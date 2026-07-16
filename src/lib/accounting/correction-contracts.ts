/**
 * Correction contract schemas for the accounting engine.
 *
 * Pure Zod/domain types for correction validation, reversal action mapping,
 * response shapes, and typed failure codes.
 *
 * No database or Next.js imports — pure validation and type contracts.
 */

import { z } from 'zod';

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

const symbolSchema = z
  .string()
  .min(1, 'Symbol must not be empty')
  .max(20, 'Symbol must be at most 20 characters')
  .regex(
    /^[A-Z0-9.]+$/,
    'Symbol must be uppercase alphanumeric (e.g. "AAPL", "SPY")',
  );

export const EXECUTION_ACTION_VALUES = [
  'buy',
  'sell',
  'sell_short',
  'buy_to_cover',
  'add',
  'reduce',
] as const;

export const executionActionSchema = z.enum(EXECUTION_ACTION_VALUES);

// ── Reversal Action Mapping ─────────────────────────────────────────────

/**
 * Map an execution action to its reversal (opposite) action.
 *
 * buy → sell, sell → buy, sell_short → buy_to_cover,
 * buy_to_cover → sell_short, add → reduce, reduce → add
 */
export function reverseAction(action: string): string {
  const REVERSAL_MAP: Record<string, string> = {
    buy: 'sell',
    sell: 'buy',
    sell_short: 'buy_to_cover',
    buy_to_cover: 'sell_short',
    add: 'reduce',
    reduce: 'add',
  };
  const reversed = REVERSAL_MAP[action];
  if (!reversed) {
    throw new Error(`Unknown action "${action}" — cannot determine reversal`);
  }
  return reversed;
}

// ── Correction Input Schema ─────────────────────────────────────────────

/**
 * Schema for validating a correction request.
 *
 * Fields mirror the execution input schema but require a replacement
 * payload (not just a reversal). The original execution ID is taken
 * from the URL path.
 *
 * Fields:
 * - symbol: Instrument symbol for the replacement (e.g. "AAPL")
 * - action: Replacement execution action
 * - quantity: Replacement quantity (positive canonical decimal)
 * - price: Replacement price (positive canonical decimal)
 * - fees: Replacement fees (non-negative canonical decimal, defaults to "0.00")
 * - reason: Optional human-readable reason for the correction
 * - idempotencyKey: Optional UUID for idempotent correction
 * - postedAt: Optional ISO-8601 timestamp (defaults to server time)
 */
export const correctionInputSchema = z.object({
  symbol: symbolSchema,
  action: executionActionSchema,
  quantity: positiveCanonicalDecimalSchema,
  price: positiveCanonicalDecimalSchema,
  fees: nonNegativeCanonicalDecimalSchema.optional().default('0.00'),
  reason: z.string().min(1).max(1000).optional(),
  idempotencyKey: uuidSchema.optional(),
  postedAt: z.string().datetime().optional(),
});

export type CorrectionInput = z.infer<typeof correctionInputSchema>;

// ── Response Schemas ──────────────────────────────────────────────────

/**
 * Schema for an accounting execution in correction API responses.
 */
export const correctionExecutionResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  instrumentId: z.string(),
  symbol: z.string(),
  action: z.string(),
  quantity: z.string(),
  price: z.string(),
  fees: z.string(),
  idempotencyKey: z.string().nullable(),
  journalTradeId: z.string().nullable(),
  description: z.string().nullable(),
  postedAt: z.string(),
  createdAt: z.string(),
});

export type CorrectionExecutionResponse = z.infer<typeof correctionExecutionResponseSchema>;

/**
 * Schema for a position state in correction API responses.
 */
export const correctionPositionResponseSchema = z.object({
  accountId: z.string(),
  instrumentId: z.string(),
  direction: z.string().nullable(),
  quantity: z.string(),
  averageCost: z.string(),
  totalCostBasis: z.string(),
  realizedGrossPnl: z.string(),
  realizedFees: z.string(),
  realizedNetPnl: z.string(),
  openLots: z.array(z.object({
    id: z.string(),
    remainingQuantity: z.string(),
    originalQuantity: z.string(),
    entryPrice: z.string(),
    openingExecutionId: z.string(),
    openedAt: z.string(),
  })),
  lastUpdated: z.string(),
});

export type CorrectionPositionResponse = z.infer<typeof correctionPositionResponseSchema>;

/**
 * Schema for the full correction response body.
 */
export const correctionResponseSchema = z.object({
  success: z.literal(true),
  correction: z.object({
    id: z.string(),
    accountId: z.string(),
    originalExecutionId: z.string(),
    reversalExecutionId: z.string(),
    replacementExecutionId: z.string(),
    reason: z.string().nullable(),
    correctedAt: z.string(),
  }),
  originalExecution: correctionExecutionResponseSchema,
  reversalExecution: correctionExecutionResponseSchema,
  replacementExecution: correctionExecutionResponseSchema,
  position: correctionPositionResponseSchema.nullable(),
  rebuildStatus: z.object({
    executionCount: z.number(),
    lotCount: z.number(),
    matchCount: z.number(),
  }),
});

export type CorrectionResponse = z.infer<typeof correctionResponseSchema>;
