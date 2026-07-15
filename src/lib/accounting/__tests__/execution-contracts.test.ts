/**
 * Contract-level tests for the accounting execution and FIFO contracts.
 *
 * Tests pure Zod/domain type contracts — no database, no API routes.
 *
 * Coverage areas:
 * 1. Execution input validation — valid/invalid actions, quantities, prices, fees
 * 2. Canonical decimal rejection — non-canonical, negative, zero amounts
 * 3. Optional fields — idempotencyKey, journalTradeId, description, postedAt
 * 4. Execution action constants — predictable direction groups
 * 5. Response schema shapes — execution, lot, match, position, success, rejection
 * 6. Query parameter validation — listExecutions, listPositions
 * 7. Rejection codes — stable typed failure contract
 * 8. Position types — FifoLot, LotMatch, PositionState, RebuildResult structure
 * 9. Action direction resolution — actionImpliedDirection, resolveEffectiveDirection
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  executionInputSchema,
  executionActionSchema,
  executionResponseSchema,
  fifoLotResponseSchema,
  lotMatchResponseSchema,
  positionStateResponseSchema,
  executionSuccessResponseSchema,
  executionRejectionResponseSchema,
  listExecutionsQuerySchema,
  listPositionsQuerySchema,
  EXECUTION_ACTION_VALUES,
} from '../execution-contracts';
import {
  EXECUTION_ACTIONS,
  LONG_OPENING_ACTIONS,
  LONG_CLOSING_ACTIONS,
  SHORT_OPENING_ACTIONS,
  SHORT_CLOSING_ACTIONS,
  POSITION_DIRECTIONS,
  FIFO_REJECTION_MESSAGES,
  actionImpliedDirection,
  resolveEffectiveDirection,
} from '../../positions/types';
import type {
  FifoRejectionCode,
  FifoLot,
  LotMatch,
  PositionState,
  RebuildResult,
  FifoExecutionInput,
  FifoAllocationResult,
} from '../../positions/types';
import type { CanonicalDecimal } from '../types';

// ── Execution Action Contract ───────────────────────────────────────────

describe('Execution Action Contract — EXECUTION_ACTION_VALUES', () => {
  it('includes all 6 supported actions', () => {
    expect(EXECUTION_ACTION_VALUES).toEqual([
      'buy', 'sell', 'sell_short', 'buy_to_cover', 'add', 'reduce',
    ]);
  });

  it('matches EXECUTION_ACTIONS constant', () => {
    expect(EXECUTION_ACTION_VALUES).toEqual([...EXECUTION_ACTIONS]);
  });
});

describe('Execution Action Contract — direction groups', () => {
  it('LONG_OPENING_ACTIONS includes buy and add', () => {
    expect(LONG_OPENING_ACTIONS).toContain('buy');
    expect(LONG_OPENING_ACTIONS).toContain('add');
    expect(LONG_OPENING_ACTIONS).toHaveLength(2);
  });

  it('LONG_CLOSING_ACTIONS includes sell and reduce', () => {
    expect(LONG_CLOSING_ACTIONS).toContain('sell');
    expect(LONG_CLOSING_ACTIONS).toContain('reduce');
    expect(LONG_CLOSING_ACTIONS).toHaveLength(2);
  });

  it('SHORT_OPENING_ACTIONS includes sell_short and add', () => {
    expect(SHORT_OPENING_ACTIONS).toContain('sell_short');
    expect(SHORT_OPENING_ACTIONS).toContain('add');
    expect(SHORT_OPENING_ACTIONS).toHaveLength(2);
  });

  it('SHORT_CLOSING_ACTIONS includes buy_to_cover and reduce', () => {
    expect(SHORT_CLOSING_ACTIONS).toContain('buy_to_cover');
    expect(SHORT_CLOSING_ACTIONS).toContain('reduce');
    expect(SHORT_CLOSING_ACTIONS).toHaveLength(2);
  });
});

describe('Execution Action Contract — actionImpliedDirection', () => {
  it('returns long for buy', () => {
    expect(actionImpliedDirection('buy', null)).toBe('long');
  });

  it('returns long for buy_to_cover', () => {
    expect(actionImpliedDirection('buy_to_cover', null)).toBe('long');
  });

  it('returns short for sell', () => {
    expect(actionImpliedDirection('sell', null)).toBe('short');
  });

  it('returns short for sell_short', () => {
    expect(actionImpliedDirection('sell_short', null)).toBe('short');
  });

  it('returns currentDirection for add', () => {
    expect(actionImpliedDirection('add', 'long')).toBe('long');
    expect(actionImpliedDirection('add', 'short')).toBe('short');
  });

  it('returns currentDirection for reduce', () => {
    expect(actionImpliedDirection('reduce', 'long')).toBe('long');
    expect(actionImpliedDirection('reduce', 'short')).toBe('short');
  });
});

describe('Execution Action Contract — resolveEffectiveDirection', () => {
  it('mirrors actionImpliedDirection for deterministic actions', () => {
    expect(resolveEffectiveDirection('buy', null)).toBe('long');
    expect(resolveEffectiveDirection('sell', null)).toBe('short');
    expect(resolveEffectiveDirection('sell_short', null)).toBe('short');
    expect(resolveEffectiveDirection('buy_to_cover', null)).toBe('long');
  });

  it('returns currentDirection for add and reduce', () => {
    expect(resolveEffectiveDirection('add', 'long')).toBe('long');
    expect(resolveEffectiveDirection('add', 'short')).toBe('short');
    expect(resolveEffectiveDirection('reduce', 'long')).toBe('long');
  });

  it('returns null for add/reduce with no current direction', () => {
    expect(resolveEffectiveDirection('add', null)).toBeNull();
    expect(resolveEffectiveDirection('reduce', null)).toBeNull();
  });
});

// ── Execution Input Validation ─────────────────────────────────────────

describe('Execution Input Validation — executionInputSchema', () => {
  it('accepts a valid buy execution', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.75',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fees).toBe('0.00');
    }
  });

  it('accepts a valid sell execution', () => {
    const result = executionInputSchema.safeParse({
      action: 'sell',
      quantity: '50.00',
      price: '155.00',
      fees: '10.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid sell_short execution', () => {
    const result = executionInputSchema.safeParse({
      action: 'sell_short',
      quantity: '200.00',
      price: '75.50',
      fees: '5.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid buy_to_cover execution', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy_to_cover',
      quantity: '100.00',
      price: '80.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts add and reduce actions', () => {
    const addResult = executionInputSchema.safeParse({
      action: 'add',
      quantity: '25.00',
      price: '160.00',
    });
    expect(addResult.success).toBe(true);

    const reduceResult = executionInputSchema.safeParse({
      action: 'reduce',
      quantity: '30.00',
      price: '145.00',
    });
    expect(reduceResult.success).toBe(true);
  });

  it('accepts execution with idempotencyKey (UUID)', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      idempotencyKey: randomUUID(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts execution with journalTradeId (UUID)', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      journalTradeId: randomUUID(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts execution with description', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      description: 'Initial position entry',
    });
    expect(result.success).toBe(true);
  });

  it('accepts execution with postedAt (ISO datetime)', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      postedAt: '2026-07-15T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts execution with all optional fields', () => {
    const result = executionInputSchema.safeParse({
      action: 'sell',
      quantity: '50.00',
      price: '200.00',
      fees: '15.00',
      idempotencyKey: randomUUID(),
      journalTradeId: randomUUID(),
      description: 'Partial close',
      postedAt: '2026-07-15T14:30:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('defaults fees to "0.00" when not provided', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fees).toBe('0.00');
    }
  });

  // ── Negative cases ──────────────────────────────────────────────────

  it('rejects invalid action string', () => {
    const result = executionInputSchema.safeParse({
      action: 'invalid_action',
      quantity: '100.00',
      price: '150.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing action', () => {
    const result = executionInputSchema.safeParse({
      quantity: '100.00',
      price: '150.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing quantity', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      price: '150.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing price', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative quantity', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '-100.00',
      price: '150.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero quantity', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '0.00',
      price: '150.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative price', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '-50.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero price', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '0.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative fees', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      fees: '-5.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-canonical decimal quantity', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100',
      price: '150.00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-canonical decimal price', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.5',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-canonical decimal fees', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      fees: '10',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID idempotencyKey', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      idempotencyKey: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID journalTradeId', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      journalTradeId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects description longer than 500 characters', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      description: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-datetime postedAt', () => {
    const result = executionInputSchema.safeParse({
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      postedAt: 'tomorrow',
    });
    expect(result.success).toBe(false);
  });
});

// ── Execution Action Schema ────────────────────────────────────────────

describe('Execution Action Schema — executionActionSchema', () => {
  for (const action of EXECUTION_ACTION_VALUES) {
    it(`accepts "${action}"`, () => {
      const result = executionActionSchema.safeParse(action);
      expect(result.success).toBe(true);
    });
  }

  it('rejects unknown action', () => {
    const result = executionActionSchema.safeParse('unknown');
    expect(result.success).toBe(false);
  });
});

// ── Response Schemas ───────────────────────────────────────────────────

describe('Response Schema — executionResponseSchema', () => {
  const validExecution = {
    id: randomUUID(),
    accountId: randomUUID(),
    instrumentId: randomUUID(),
    action: 'buy' as const,
    quantity: '100.00',
    price: '150.75',
    fees: '0.00',
    idempotencyKey: null,
    journalTradeId: null,
    description: null,
    postedAt: '2026-07-15T10:00:00.000Z',
    createdAt: '2026-07-15T10:00:00.000Z',
  };

  it('validates a complete execution response', () => {
    const result = executionResponseSchema.safeParse(validExecution);
    expect(result.success).toBe(true);
  });

  it('validates execution with optional fields', () => {
    const withOpts = {
      ...validExecution,
      idempotencyKey: randomUUID(),
      journalTradeId: randomUUID(),
      description: 'Test execution',
    };
    const result = executionResponseSchema.safeParse(withOpts);
    expect(result.success).toBe(true);
  });

  it('rejects missing id field', () => {
    const { id: _, ...rest } = validExecution;
    const result = executionResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('Response Schema — fifoLotResponseSchema', () => {
  const validLot = {
    id: randomUUID(),
    accountId: randomUUID(),
    instrumentId: randomUUID(),
    direction: 'long' as const,
    remainingQuantity: '100.00',
    originalQuantity: '100.00',
    entryPrice: '150.75',
    costBasisTotal: '15075.00',
    allocatedFees: '5.00',
    openingExecutionId: randomUUID(),
    openedAt: '2026-07-15T10:00:00.000Z',
  };

  it('validates a complete FIFO lot response', () => {
    const result = fifoLotResponseSchema.safeParse(validLot);
    expect(result.success).toBe(true);
  });

  it('validates a short-direction lot', () => {
    const shortLot = { ...validLot, direction: 'short' as const };
    const result = fifoLotResponseSchema.safeParse(shortLot);
    expect(result.success).toBe(true);
  });

  it('rejects invalid direction', () => {
    const badLot = { ...validLot, direction: 'invalid' };
    const result = fifoLotResponseSchema.safeParse(badLot);
    expect(result.success).toBe(false);
  });
});

describe('Response Schema — lotMatchResponseSchema', () => {
  const validMatch = {
    id: randomUUID(),
    closingExecutionId: randomUUID(),
    lotId: randomUUID(),
    matchQuantity: '50.00',
    matchPrice: '155.00',
    realizedGrossPnl: '212.50',
    allocatedFees: '5.00',
    realizedNetPnl: '207.50',
    sequence: 1,
  };

  it('validates a complete lot match response', () => {
    const result = lotMatchResponseSchema.safeParse(validMatch);
    expect(result.success).toBe(true);
  });

  it('rejects non-integer sequence', () => {
    const badMatch = { ...validMatch, sequence: 1.5 };
    const result = lotMatchResponseSchema.safeParse(badMatch);
    expect(result.success).toBe(false);
  });

  it('validates a loss-making match', () => {
    const lossMatch = {
      ...validMatch,
      realizedGrossPnl: '-100.00',
      realizedNetPnl: '-105.00',
    };
    const result = lotMatchResponseSchema.safeParse(lossMatch);
    expect(result.success).toBe(true);
  });
});

describe('Response Schema — positionStateResponseSchema', () => {
  const validPosition = {
    accountId: randomUUID(),
    instrumentId: randomUUID(),
    direction: 'long' as const,
    quantity: '100.00',
    averageCost: '150.75',
    totalCostBasis: '15075.00',
    realizedGrossPnl: '500.00',
    realizedFees: '15.00',
    realizedNetPnl: '485.00',
    openLots: [{
      id: randomUUID(),
      accountId: randomUUID(),
      instrumentId: randomUUID(),
      direction: 'long' as const,
      remainingQuantity: '100.00',
      originalQuantity: '100.00',
      entryPrice: '150.75',
      costBasisTotal: '15075.00',
      allocatedFees: '5.00',
      openingExecutionId: randomUUID(),
      openedAt: '2026-07-15T10:00:00.000Z',
    }],
    lastUpdated: '2026-07-15T10:00:00.000Z',
  };

  it('validates a complete position state response', () => {
    const result = positionStateResponseSchema.safeParse(validPosition);
    expect(result.success).toBe(true);
  });

  it('validates a flat position (direction null, quantity "0.00")', () => {
    const flatPosition = {
      ...validPosition,
      direction: null,
      quantity: '0.00',
      openLots: [],
    };
    const result = positionStateResponseSchema.safeParse(flatPosition);
    expect(result.success).toBe(true);
  });

  it('validates a short position', () => {
    const shortPosition = { ...validPosition, direction: 'short' as const };
    const result = positionStateResponseSchema.safeParse(shortPosition);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { accountId: _, ...rest } = validPosition;
    const result = positionStateResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('Response Schema — executionSuccessResponseSchema', () => {
  it('validates a successful execution response', () => {
    const result = executionSuccessResponseSchema.safeParse({
      success: true as const,
      execution: {
        id: randomUUID(),
        accountId: randomUUID(),
        instrumentId: randomUUID(),
        action: 'buy',
        quantity: '100.00',
        price: '150.75',
        fees: '0.00',
        idempotencyKey: null,
        journalTradeId: null,
        description: null,
        postedAt: '2026-07-15T10:00:00.000Z',
        createdAt: '2026-07-15T10:00:00.000Z',
      },
      position: {
        accountId: randomUUID(),
        instrumentId: randomUUID(),
        direction: 'long',
        quantity: '100.00',
        averageCost: '150.75',
        totalCostBasis: '15075.00',
        realizedGrossPnl: '0.00',
        realizedFees: '0.00',
        realizedNetPnl: '0.00',
        openLots: [],
        lastUpdated: '2026-07-15T10:00:00.000Z',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects success:false in success response', () => {
    const result = executionSuccessResponseSchema.safeParse({
      success: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('Response Schema — executionRejectionResponseSchema', () => {
  it('validates an over-close rejection', () => {
    const result = executionRejectionResponseSchema.safeParse({
      success: false as const,
      code: 'OVER_CLOSE',
      message: 'Execution quantity exceeds available open position quantity',
    });
    expect(result.success).toBe(true);
  });

  it('rejects success:true in rejection response', () => {
    const result = executionRejectionResponseSchema.safeParse({
      success: true,
    });
    expect(result.success).toBe(false);
  });
});

// ── Query Parameter Schemas ────────────────────────────────────────────

describe('Query Parameters — listExecutionsQuerySchema', () => {
  it('defaults limit and offset when empty', () => {
    const result = listExecutionsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it('accepts explicit limit and offset', () => {
    const result = listExecutionsQuerySchema.safeParse({ limit: '25', offset: '10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(10);
    }
  });

  it('coerces string numbers to integers', () => {
    const result = listExecutionsQuerySchema.safeParse({ limit: '10', offset: '5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(5);
    }
  });

  it('rejects limit > 100', () => {
    const result = listExecutionsQuerySchema.safeParse({ limit: '200' });
    expect(result.success).toBe(false);
  });

  it('rejects negative offset', () => {
    const result = listExecutionsQuerySchema.safeParse({ offset: '-1' });
    expect(result.success).toBe(false);
  });

  it('accepts optional filters', () => {
    const result = listExecutionsQuerySchema.safeParse({
      instrumentId: randomUUID(),
      action: 'buy',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.999Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action filter', () => {
    const result = listExecutionsQuerySchema.safeParse({ action: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('Query Parameters — listPositionsQuerySchema', () => {
  it('accepts empty query', () => {
    const result = listPositionsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts instrumentId filter', () => {
    const result = listPositionsQuerySchema.safeParse({
      instrumentId: randomUUID(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts direction filter', () => {
    const result = listPositionsQuerySchema.safeParse({ direction: 'long' });
    expect(result.success).toBe(true);

    const shortResult = listPositionsQuerySchema.safeParse({ direction: 'short' });
    expect(shortResult.success).toBe(true);
  });

  it('rejects invalid direction', () => {
    const result = listPositionsQuerySchema.safeParse({ direction: 'flat' });
    expect(result.success).toBe(false);
  });
});

// ── Rejection Code Contracts ───────────────────────────────────────────

describe('Rejection Code Contract — FIFO_REJECTION_MESSAGES', () => {
  const expectedCodes: FifoRejectionCode[] = [
    'OVER_CLOSE',
    'UNSUPPORTED_FLIP',
    'MIXED_SIDE',
    'REVERSAL',
    'INVALID_QUANTITY',
    'INVALID_PRICE',
    'NO_POSITION_TO_CLOSE',
    'POSITION_DIRECTION_MISMATCH',
  ];

  for (const code of expectedCodes) {
    it(`has a message for ${code}`, () => {
      expect(FIFO_REJECTION_MESSAGES[code]).toBeDefined();
      expect(typeof FIFO_REJECTION_MESSAGES[code]).toBe('string');
      expect(FIFO_REJECTION_MESSAGES[code].length).toBeGreaterThan(0);
    });
  }

  it('has exactly 8 rejection codes', () => {
    expect(Object.keys(FIFO_REJECTION_MESSAGES)).toHaveLength(8);
  });
});

// ── POSITION_DIRECTIONS — ──────────────────────────────────────────────

describe('Position Direction — POSITION_DIRECTIONS', () => {
  it('includes long and short', () => {
    expect(POSITION_DIRECTIONS).toEqual(['long', 'short']);
  });
});

// ── Type Structure (compile-time) ──────────────────────────────────────

describe('Type Structure — FifoLot', () => {
  it('has all required fields when constructed', () => {
    const lot: FifoLot = {
      id: randomUUID(),
      accountId: randomUUID(),
      instrumentId: randomUUID(),
      direction: 'long',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '150.75' as CanonicalDecimal,
      costBasisTotal: '15075.00' as CanonicalDecimal,
      allocatedFees: '5.00' as CanonicalDecimal,
      openingExecutionId: randomUUID(),
      openedAt: '2026-07-15T10:00:00.000Z',
    };
    expect(lot.direction).toBe('long');
    expect(lot.remainingQuantity).toBe('100.00');
  });
});

describe('Type Structure — LotMatch', () => {
  it('has all required fields when constructed', () => {
    const match: LotMatch = {
      id: randomUUID(),
      closingExecutionId: randomUUID(),
      lotId: randomUUID(),
      matchQuantity: '50.00' as CanonicalDecimal,
      matchPrice: '155.00' as CanonicalDecimal,
      realizedGrossPnl: '212.50' as CanonicalDecimal,
      allocatedFees: '5.00' as CanonicalDecimal,
      realizedNetPnl: '207.50' as CanonicalDecimal,
      sequence: 1,
    };
    expect(match.sequence).toBe(1);
    expect(match.realizedNetPnl).toBe('207.50');
  });
});

describe('Type Structure — PositionState', () => {
  it('has all required fields when constructed', () => {
    const position: PositionState = {
      accountId: randomUUID(),
      instrumentId: randomUUID(),
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      averageCost: '150.75' as CanonicalDecimal,
      totalCostBasis: '15075.00' as CanonicalDecimal,
      realizedGrossPnl: '500.00' as CanonicalDecimal,
      realizedFees: '15.00' as CanonicalDecimal,
      realizedNetPnl: '485.00' as CanonicalDecimal,
      openLots: [],
      lastUpdated: '2026-07-15T10:00:00.000Z',
    };
    expect(position.direction).toBe('long');
    expect(position.quantity).toBe('100.00');
    expect(position.openLots).toEqual([]);
  });
});

describe('Type Structure — FifoExecutionInput', () => {
  it('has all required fields when constructed', () => {
    const input: FifoExecutionInput = {
      executionId: randomUUID(),
      accountId: randomUUID(),
      instrumentId: randomUUID(),
      action: 'buy',
      quantity: '100.00' as CanonicalDecimal,
      price: '150.75' as CanonicalDecimal,
      fees: '0.00' as CanonicalDecimal,
      postedAt: '2026-07-15T10:00:00.000Z',
    };
    expect(input.action).toBe('buy');
    expect(input.quantity).toBe('100.00');
  });
});

describe('Type Structure — FifoAllocationResult', () => {
  it('discriminates success and rejection', () => {
    const success: FifoAllocationResult = {
      status: 'success',
      openedLots: [],
      matches: [],
      position: {
        accountId: randomUUID(),
        instrumentId: randomUUID(),
        direction: null,
        quantity: '0.00' as CanonicalDecimal,
        averageCost: '0.00' as CanonicalDecimal,
        totalCostBasis: '0.00' as CanonicalDecimal,
        realizedGrossPnl: '0.00' as CanonicalDecimal,
        realizedFees: '0.00' as CanonicalDecimal,
        realizedNetPnl: '0.00' as CanonicalDecimal,
        openLots: [],
        lastUpdated: '2026-07-15T10:00:00.000Z',
      },
    };
    expect(success.status).toBe('success');

    const rejection: FifoAllocationResult = {
      status: 'rejected',
      code: 'OVER_CLOSE',
      message: 'Over-close',
    };
    expect(rejection.status).toBe('rejected');
    if (rejection.status === 'rejected') {
      expect(rejection.code).toBe('OVER_CLOSE');
    }
  });
});

describe('Type Structure — RebuildResult', () => {
  it('has all required fields when constructed', () => {
    const result: RebuildResult = {
      positions: new Map(),
      openLots: [],
      allMatches: [],
      executionCount: 10,
      lotCount: 5,
      matchCount: 3,
    };
    expect(result.executionCount).toBe(10);
    expect(result.lotCount).toBe(5);
    expect(result.matchCount).toBe(3);
    expect(result.positions.size).toBe(0);
  });
});
