/**
 * Zod contracts for the valuation and performance API endpoints.
 *
 * Pure validation schemas — no database or Next.js imports.
 * Follows the same pattern as `execution-contracts.ts`.
 *
 * @module performance/api-contracts
 */

import { z } from 'zod';

// ── Shared Helpers ──────────────────────────────────────────────────────

const canonicalDecimalSchema = z
  .string()
  .regex(
    /^-?\d+\.\d{2}$/,
    'Must be a canonical decimal (e.g. "100.00")',
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

const isoDatetimeSchema = z.string().datetime({ offset: true }).or(z.string().datetime());

// ── Mark Source ─────────────────────────────────────────────────────────

export const MARK_SOURCE_VALUES = ['user', 'market_data', 'import', 'system'] as const;
export const markSourceSchema = z.enum(MARK_SOURCE_VALUES);

// ── POST Valuation Mark ─────────────────────────────────────────────────

/**
 * Schema for POST /api/accounts/:id/valuations request body.
 *
 * Accepts either:
 * - instrumentId (UUID) for a known instrument, or
 * - symbol (uppercase ticker) to look up or create the instrument.
 *
 * Price is a canonical decimal or number that will be normalized.
 * Source is one of: user, market_data, import, system.
 * markTimestamp is an ISO-8601 datetime string.
 * idempotencyKey is an optional UUID for idempotent posting.
 */
export const postValuationMarkSchema = z.object({
  /** UUID of an existing instrument (mutually exclusive with symbol). */
  instrumentId: uuidSchema.optional(),
  /** Ticker symbol to look up or create (mutually exclusive with instrumentId). */
  symbol: symbolSchema.optional(),
  /** Mark price per unit.  Accepts canonical decimal string or number. */
  price: z.union([canonicalDecimalSchema, z.number().finite()]),
  /** Source of the mark. */
  source: markSourceSchema,
  /** ISO-8601 timestamp of when this mark was observed. */
  markTimestamp: isoDatetimeSchema,
  /** Optional idempotency key for safe retries. */
  idempotencyKey: uuidSchema.optional(),
  /** Optional human-readable description. */
  description: z.string().max(500).optional(),
}).refine(
  (data) => data.instrumentId || data.symbol,
  { message: 'Either instrumentId or symbol is required' },
);

export type PostValuationMarkRequest = z.infer<typeof postValuationMarkSchema>;

// ── Valuation Mark Response ─────────────────────────────────────────────

/**
 * Schema for a valuation mark in API responses.
 */
export const valuationMarkResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  instrumentId: z.string(),
  symbol: z.string(),
  price: z.string(),
  source: z.string(),
  markTimestamp: z.string(),
  idempotencyKey: z.string().nullable(),
  createdAt: z.string(),
});

export type ValuationMarkResponse = z.infer<typeof valuationMarkResponseSchema>;

// ── List Valuation Marks Query ──────────────────────────────────────────

/**
 * Schema for GET /api/accounts/:id/valuations query parameters.
 */
export const listValuationMarksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  instrumentId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type ListValuationMarksQuery = z.infer<typeof listValuationMarksQuerySchema>;

// ─── Valuation Position Response ─────────────────────────────────────────

/**
 * Schema for a single valued position in API responses.
 */
export const valuationPositionResponseSchema = z.object({
  instrumentId: z.string(),
  symbol: z.string(),
  direction: z.enum(['long', 'short']).nullable(),
  quantity: z.string(),
  averageCost: z.string(),
  totalCostBasis: z.string(),
  realizedPnl: z.string(),
  realizedFees: z.string(),
  realizedNetPnl: z.string(),
  markPrice: z.string().nullable(),
  markStatus: z.enum(['fresh', 'stale', 'missing']),
  markedValue: z.string().nullable(),
  unrealizedPnl: z.string().nullable(),
  markTimestamp: z.string().nullable(),
  markSource: z.enum(['user', 'market_data', 'import', 'system']).nullable(),
  markAgeMinutes: z.number().nullable(),
});

export type ValuationPositionResponse = z.infer<typeof valuationPositionResponseSchema>;

// ── Account Valuation Response ──────────────────────────────────────────

/**
 * Schema for account valuation in API responses.
 */
export const accountValuationResponseSchema = z.object({
  accountId: z.string(),
  netCash: z.string(),
  markedPositions: z.string(),
  nav: z.string(),
  realizedPnl: z.string(),
  unrealizedPnl: z.string(),
  totalPnl: z.string(),
  realizedFees: z.string(),
  grossExposure: z.string(),
  netExposure: z.string(),
  warnings: z.array(z.string()),
  computedAt: z.string(),
});

export type AccountValuationResponse = z.infer<typeof accountValuationResponseSchema>;

// ── Performance Response ────────────────────────────────────────────────

/**
 * Schema for the performance projection in API responses (GET /api/accounts/:id/performance).
 */
export const performanceResponseSchema = z.object({
  accountId: z.string(),
  computedAt: z.string(),
  netCash: z.string(),
  nav: z.string(),
  markedPositions: z.string(),
  realizedPnl: z.string(),
  unrealizedPnl: z.string(),
  totalPnl: z.string(),
  realizedFees: z.string(),
  grossExposure: z.string(),
  netExposure: z.string(),
  modifiedDietzReturn: z.string().nullable(),
  twr: z.string().nullable(),
  highWaterMark: z.string().nullable(),
  drawdown: z.string().nullable(),
  drawdownPct: z.string().nullable(),
  warnings: z.array(z.string()),
  positions: z.array(valuationPositionResponseSchema),
  rebuildCount: z.number().int(),
  lastRebuiltAt: z.string(),
});

export type PerformanceResponse = z.infer<typeof performanceResponseSchema>;

// ── Rebuild Performance Response ────────────────────────────────────────

/**
 * Schema for the POST /api/accounts/:id/performance (rebuild) response.
 * Returns the PerformanceRebuildResult from the rebuild engine.
 */
export const rebuildPerformanceResponseSchema = z.object({
  accountId: z.string(),
  success: z.boolean(),
  rebuildCount: z.number().int(),
  computedAt: z.string(),
  positionCount: z.number().int(),
  markCount: z.number().int(),
  nav: z.string().nullable(),
  warnings: z.array(z.string()),
});

export type RebuildPerformanceResponse = z.infer<typeof rebuildPerformanceResponseSchema>;

// ── POST Performance Rebuild ────────────────────────────────────────────

/**
 * Schema for POST /api/accounts/:id/performance request body.
 */
export const postPerformanceRebuildSchema = z.object({
  /** Override freshness threshold in minutes (default: 1440 = 24h). */
  freshnessThresholdMinutes: z.number().int().min(1).max(525600).optional(),
  /** If false, skips performance metric computation (default: true). */
  includePerformance: z.boolean().optional(),
});

export type PostPerformanceRebuildRequest = z.infer<typeof postPerformanceRebuildSchema>;
