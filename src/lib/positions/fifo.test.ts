/**
 * Pure FIFO allocation engine tests.
 *
 * Tests are pure — no database, no API routes.
 * Every scenario is table-driven and covers the full allocation contract.
 *
 * Coverage areas:
 * 1. Long FIFO — buy creates lots, sell matches oldest first
 * 2. Short FIFO — sell_short creates lots, buy_to_cover matches oldest first
 * 3. Partial close — selling part of a lot leaves remaining quantity
 * 4. Add / reduce — adding to existing position, reducing from it
 * 5. Full close — closing all lots flattens the position
 * 6. Over-close — rejection when closing > available
 * 7. Unsupported flip — sell_short when long / buy when short
 * 8. Mixed side — sell when short / buy_to_cover when long
 * 9. No position to close — sell/buy_to_cover/reduce with no position
 * 10. Add/reduce with no position — MIXED_SIDE / NO_POSITION_TO_CLOSE
 * 11. Fractional quantities — exact decimal arithmetic
 * 12. P&L calculation — long and short profit/loss
 * 13. Fee allocation — proportional fee distribution across matches
 * 14. Deterministic ordering — same inputs produce same outputs
 * 15. Same-timestamp ordering — sequence then id tiebreaker
 * 16. Flat position after full close — direction null, quantity "0.00"
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { allocateFifo } from './fifo';
import type { FifoLot, PositionState, FifoExecutionInput, ExecutionAction } from './types';
import type { CanonicalDecimal } from '../accounting/types';

// ── Helpers ──────────────────────────────────────────────────────────────

function lot(
  overrides: Partial<FifoLot> & { remainingQuantity?: CanonicalDecimal; originalQuantity: CanonicalDecimal },
): any {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? randomUUID(),
    accountId: overrides.accountId ?? 'acct-1',
    instrumentId: overrides.instrumentId ?? 'inst-1',
    direction: (overrides.direction ?? 'long') as 'long' | 'short',
    remainingQuantity: (overrides.remainingQuantity ?? overrides.originalQuantity) as CanonicalDecimal,
    originalQuantity: overrides.originalQuantity,
    entryPrice: (overrides.entryPrice ?? '100.00') as CanonicalDecimal,
    costBasisTotal: (overrides.costBasisTotal ?? '10000.00') as CanonicalDecimal,
    allocatedFees: (overrides.allocatedFees ?? '5.00') as CanonicalDecimal,
    openingExecutionId: overrides.openingExecutionId ?? randomUUID(),
    openedAt: overrides.openedAt ?? now,
  } as unknown as FifoLot;
}

function position(overrides: Partial<PositionState> = {}): any {
  const now = new Date().toISOString();
  return {
    accountId: overrides.accountId ?? 'acct-1',
    instrumentId: overrides.instrumentId ?? 'inst-1',
    direction: overrides.direction ?? null,
    quantity: (overrides.quantity ?? '0.00') as CanonicalDecimal,
    averageCost: (overrides.averageCost ?? '0.00') as CanonicalDecimal,
    totalCostBasis: (overrides.totalCostBasis ?? '0.00') as CanonicalDecimal,
    realizedGrossPnl: (overrides.realizedGrossPnl ?? '0.00') as CanonicalDecimal,
    realizedFees: (overrides.realizedFees ?? '0.00') as CanonicalDecimal,
    realizedNetPnl: (overrides.realizedNetPnl ?? '0.00') as CanonicalDecimal,
    openLots: overrides.openLots ?? [],
    lastUpdated: overrides.lastUpdated ?? now,
  } as unknown as PositionState;
}

function execution(
  overrides: Partial<FifoExecutionInput> & { action: ExecutionAction; quantity: string; price: string },
): any {
  return {
    executionId: overrides.executionId ?? randomUUID(),
    accountId: overrides.accountId ?? 'acct-1',
    instrumentId: overrides.instrumentId ?? 'inst-1',
    action: overrides.action,
    quantity: overrides.quantity as CanonicalDecimal,
    price: overrides.price as CanonicalDecimal,
    fees: (overrides.fees ?? '0.00') as CanonicalDecimal,
    postedAt: overrides.postedAt ?? new Date().toISOString(),
  } as unknown as FifoExecutionInput;
}

function idGen(): string {
  return randomUUID();
}

// ── 1. Long FIFO — buy creates lots, sell matches oldest first ────────

describe('Long FIFO — opening buys', () => {
  it('creates a new lot and long position on first buy', () => {
    const result = allocateFifo(
      execution({ action: 'buy', quantity: '100.00', price: '150.75' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // Lot created
    expect(result.openedLots).toHaveLength(1);
    expect(result.openedLots[0].direction).toBe('long');
    expect(result.openedLots[0].remainingQuantity).toBe('100.00');
    expect(result.openedLots[0].originalQuantity).toBe('100.00');
    expect(result.openedLots[0].entryPrice).toBe('150.75');
    expect(result.openedLots[0].costBasisTotal).toBe('15075.00');
    expect(result.openedLots[0].allocatedFees).toBe('0.00');

    // Position updated
    expect(result.position.direction).toBe('long');
    expect(result.position.quantity).toBe('100.00');
    expect(result.position.averageCost).toBe('150.75');
    expect(result.position.totalCostBasis).toBe('15075.00');
    expect(result.position.realizedGrossPnl).toBe('0.00');

    // No matches
    expect(result.matches).toHaveLength(0);
  });

  it('creates a lot with fees', () => {
    const result = allocateFifo(
      execution({ action: 'buy', quantity: '100.00', price: '150.75', fees: '15.00' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.openedLots).toHaveLength(1);
    // costBasisTotal = 100 * 150.75 + 15.00 = 15090.00
    expect(result.openedLots[0].costBasisTotal).toBe('15075.00');
    expect(result.openedLots[0].allocatedFees).toBe('15.00');
  });

  it('supports add action on existing long position', () => {
    const existingLot = lot({
      remainingQuantity: '50.00' as CanonicalDecimal,
      originalQuantity: '50.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      costBasisTotal: '5000.00' as CanonicalDecimal,
      direction: 'long',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '50.00' as CanonicalDecimal,
      averageCost: '100.00' as CanonicalDecimal,
      totalCostBasis: '5000.00' as CanonicalDecimal,
      openLots: [existingLot],
    });

    const result = allocateFifo(
      execution({ action: 'add', quantity: '25.00', price: '120.00' }),
      currentPos,
      [existingLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.openedLots).toHaveLength(1);
    expect(result.openedLots[0].direction).toBe('long');
    expect(result.openedLots[0].remainingQuantity).toBe('25.00');
    expect(result.openedLots[0].entryPrice).toBe('120.00');

    // Position quantity aggregated
    expect(result.position.quantity).toBe('75.00');
    // Average cost = (50*100 + 25*120) / 75 = (5000 + 3000) / 75 = 106.67 (rounded)
    expect(result.position.averageCost).toBe('106.67');
  });
});

// ── 2. Short FIFO — sell_short creates lots, buy_to_cover matches oldest first

describe('Short FIFO — opening sell_shorts', () => {
  it('creates a new short lot and short position on sell_short', () => {
    const result = allocateFifo(
      execution({ action: 'sell_short', quantity: '200.00', price: '75.50', fees: '10.00' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.openedLots).toHaveLength(1);
    expect(result.openedLots[0].direction).toBe('short');
    expect(result.openedLots[0].remainingQuantity).toBe('200.00');
    expect(result.openedLots[0].originalQuantity).toBe('200.00');
    expect(result.openedLots[0].entryPrice).toBe('75.50');
    expect(result.openedLots[0].costBasisTotal).toBe('15100.00');

    expect(result.position.direction).toBe('short');
    expect(result.position.quantity).toBe('200.00');
    expect(result.position.averageCost).toBe('75.50');
  });

  it('creates a short lot on add with short direction', () => {
    const existingLot = lot({
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '80.00' as CanonicalDecimal,
      direction: 'short',
    });
    const currentPos = position({
      direction: 'short',
      quantity: '100.00' as CanonicalDecimal,
      averageCost: '80.00' as CanonicalDecimal,
      totalCostBasis: '8000.00' as CanonicalDecimal,
      openLots: [existingLot],
    });

    const result = allocateFifo(
      execution({ action: 'add', quantity: '50.00', price: '75.00' }),
      currentPos,
      [existingLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.openedLots).toHaveLength(1);
    expect(result.openedLots[0].direction).toBe('short');
    expect(result.position.quantity).toBe('150.00');
  });
});

// ── 3. Long close FIFO matching

describe('Long FIFO — selling closes oldest lots first', () => {
  it('sells against a single lot', () => {
    const openLot = lot({
      id: 'lot-1',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      costBasisTotal: '10000.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      averageCost: '100.00' as CanonicalDecimal,
      totalCostBasis: '10000.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '100.00', price: '150.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // Lot fully closed
    expect(result.openedLots).toHaveLength(0);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].lotId).toBe('lot-1');
    expect(result.matches[0].matchQuantity).toBe('100.00');
    expect(result.matches[0].matchPrice).toBe('150.00');
    // P&L = (150 - 100) * 100 = 5000.00
    expect(result.matches[0].realizedGrossPnl).toBe('5000.00');

    // Position flat
    expect(result.position.direction).toBeNull();
    expect(result.position.quantity).toBe('0.00');
    expect(result.position.realizedGrossPnl).toBe('5000.00');
  });

  it('sells against multiple lots in FIFO order', () => {
    const oldLot = lot({
      id: 'lot-old',
      remainingQuantity: '50.00' as CanonicalDecimal,
      originalQuantity: '50.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const midLot = lot({
      id: 'lot-mid',
      remainingQuantity: '30.00' as CanonicalDecimal,
      originalQuantity: '30.00' as CanonicalDecimal,
      entryPrice: '110.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-02-01T00:00:00.000Z',
    });
    const newLot = lot({
      id: 'lot-new',
      remainingQuantity: '20.00' as CanonicalDecimal,
      originalQuantity: '20.00' as CanonicalDecimal,
      entryPrice: '120.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-03-01T00:00:00.000Z',
    });

    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      averageCost: '107.00' as CanonicalDecimal, // (50*100 + 30*110 + 20*120) / 100
      totalCostBasis: '10700.00' as CanonicalDecimal,
      openLots: [oldLot, midLot, newLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '70.00', price: '150.00' }),
      currentPos,
      [oldLot, midLot, newLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // Should match lot-old (50) then lot-mid (20) — FIFO order
    expect(result.matches).toHaveLength(2);

    // First match: lot-old = 50 @ 150 vs 100 entry = 50 * 50 = 2500
    expect(result.matches[0].lotId).toBe('lot-old');
    expect(result.matches[0].matchQuantity).toBe('50.00');
    expect(result.matches[0].realizedGrossPnl).toBe('2500.00');
    expect(result.matches[0].sequence).toBe(1);

    // Second match: lot-mid = 20 @ 150 vs 110 entry = 20 * 40 = 800
    expect(result.matches[1].lotId).toBe('lot-mid');
    expect(result.matches[1].matchQuantity).toBe('20.00');
    expect(result.matches[1].realizedGrossPnl).toBe('800.00');
    expect(result.matches[1].sequence).toBe(2);

    // Remaining lots: lot-mid (10 remaining), lot-new (20)
    expect(result.position.quantity).toBe('30.00');
    expect(result.position.direction).toBe('long');
    expect(result.position.realizedGrossPnl).toBe('3300.00');
  });

  it('matches oldest lots first when multiple lots have same timestamp', () => {
    const ts = '2026-01-15T10:00:00.000Z';
    const lotA = lot({
      id: 'lot-a', // will sort first by id
      remainingQuantity: '50.00' as CanonicalDecimal,
      originalQuantity: '50.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: ts,
    });
    const lotB = lot({
      id: 'lot-b', // will sort second by id
      remainingQuantity: '30.00' as CanonicalDecimal,
      originalQuantity: '30.00' as CanonicalDecimal,
      entryPrice: '105.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: ts,
    });

    const currentPos = position({
      direction: 'long',
      quantity: '80.00' as CanonicalDecimal,
      openLots: [lotA, lotB],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '60.00', price: '120.00' }),
      currentPos,
      [lotA, lotB],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.matches).toHaveLength(2);
    // lot-a should be matched first (oldest id when timestamps equal)
    expect(result.matches[0].lotId).toBe('lot-a');
    expect(result.matches[0].matchQuantity).toBe('50.00');
    expect(result.matches[1].lotId).toBe('lot-b');
    expect(result.matches[1].matchQuantity).toBe('10.00');
  });
});

// ── 4. Short close FIFO matching

describe('Short FIFO — buy_to_cover closes oldest lots first', () => {
  it('closes a short position with profit', () => {
    const shortLot = lot({
      id: 'short-lot',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '80.00' as CanonicalDecimal,
      direction: 'short',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const currentPos = position({
      direction: 'short',
      quantity: '100.00' as CanonicalDecimal,
      averageCost: '80.00' as CanonicalDecimal,
      totalCostBasis: '8000.00' as CanonicalDecimal,
      openLots: [shortLot],
    });

    const result = allocateFifo(
      execution({ action: 'buy_to_cover', quantity: '100.00', price: '60.00' }),
      currentPos,
      [shortLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].lotId).toBe('short-lot');
    // Short P&L = (entryPrice - matchPrice) * quantity = (80 - 60) * 100 = 2000
    expect(result.matches[0].realizedGrossPnl).toBe('2000.00');

    expect(result.position.direction).toBeNull();
    expect(result.position.quantity).toBe('0.00');
    expect(result.position.realizedGrossPnl).toBe('2000.00');
  });

  it('closes a short position with loss', () => {
    const shortLot = lot({
      id: 'short-lot-loss',
      remainingQuantity: '50.00' as CanonicalDecimal,
      originalQuantity: '50.00' as CanonicalDecimal,
      entryPrice: '80.00' as CanonicalDecimal,
      direction: 'short',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const currentPos = position({
      direction: 'short',
      quantity: '50.00' as CanonicalDecimal,
      averageCost: '80.00' as CanonicalDecimal,
      totalCostBasis: '4000.00' as CanonicalDecimal,
      openLots: [shortLot],
    });

    const result = allocateFifo(
      execution({ action: 'buy_to_cover', quantity: '50.00', price: '100.00' }),
      currentPos,
      [shortLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // Short P&L = (80 - 100) * 50 = -1000 (loss)
    expect(result.matches[0].realizedGrossPnl).toBe('-1000.00');
    expect(result.position.realizedGrossPnl).toBe('-1000.00');
  });
});

// ── 5. Partial close

describe('Partial close — selling part of a lot', () => {
  it('partially closes a lot, leaving remaining quantity', () => {
    const openLot = lot({
      id: 'lot-partial',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      averageCost: '100.00' as CanonicalDecimal,
      totalCostBasis: '10000.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '30.00', price: '120.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchQuantity).toBe('30.00');
    // P&L = (120 - 100) * 30 = 600
    expect(result.matches[0].realizedGrossPnl).toBe('600.00');

    // Lot still open with remaining quantity
    expect(result.position.quantity).toBe('70.00');
    expect(result.position.direction).toBe('long');
    // Average cost stays the same for partial close
    expect(result.position.averageCost).toBe('100.00');
    // Total cost basis = 70 * 100 = 7000
    expect(result.position.totalCostBasis).toBe('7000.00');
  });

  it('does partial reduce on long position', () => {
    const openLot = lot({
      id: 'lot-reduce',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'reduce', quantity: '40.00', price: '110.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchQuantity).toBe('40.00');
    // P&L = (110 - 100) * 40 = 400
    expect(result.matches[0].realizedGrossPnl).toBe('400.00');
    expect(result.position.quantity).toBe('60.00');
  });
});

// ── 6. Full close flattens position

describe('Full close — selling all lots flattens the position', () => {
  it('flattens position after selling full quantity', () => {
    const openLot = lot({
      id: 'lot-full',
      remainingQuantity: '75.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '75.00' as CanonicalDecimal,
      averageCost: '100.00' as CanonicalDecimal,
      totalCostBasis: '7500.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '75.00', price: '150.00', fees: '15.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchQuantity).toBe('75.00');
    // P&L = (150 - 100) * 75 = 3750
    expect(result.matches[0].realizedGrossPnl).toBe('3750.00');
    // Fees: 15.00
    expect(result.matches[0].allocatedFees).toBe('15.00');
    expect(result.matches[0].realizedNetPnl).toBe('3735.00');

    expect(result.position.direction).toBeNull();
    expect(result.position.quantity).toBe('0.00');
    expect(result.position.averageCost).toBe('0.00');
    expect(result.position.totalCostBasis).toBe('0.00');
    expect(result.position.realizedGrossPnl).toBe('3750.00');
    expect(result.position.realizedFees).toBe('15.00');
    expect(result.position.realizedNetPnl).toBe('3735.00');
    expect(result.position.openLots).toHaveLength(0);
  });
});

// ── 7. Over-close rejection

describe('Over-close rejection', () => {
  it('rejects sell exceeding long position', () => {
    const openLot = lot({
      id: 'lot-over',
      remainingQuantity: '50.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '50.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '60.00', price: '150.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('REVERSAL');
  });

  it('rejects buy_to_cover exceeding short position', () => {
    const shortLot = lot({
      id: 'short-over',
      remainingQuantity: '30.00' as CanonicalDecimal,
      originalQuantity: '30.00' as CanonicalDecimal,
      entryPrice: '80.00' as CanonicalDecimal,
      direction: 'short',
    });
    const currentPos = position({
      direction: 'short',
      quantity: '30.00' as CanonicalDecimal,
      openLots: [shortLot],
    });

    const result = allocateFifo(
      execution({ action: 'buy_to_cover', quantity: '50.00', price: '90.00' }),
      currentPos,
      [shortLot],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('REVERSAL');
  });
});

// ── 8. Unsupported flip rejection

describe('Unsupported flip rejection', () => {
  it('rejects sell_short when position is long (unsupported flip)', () => {
    const openLot = lot({
      id: 'lot-long',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell_short', quantity: '50.00', price: '110.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('UNSUPPORTED_FLIP');
  });

  it('rejects buy when position is short (unsupported flip)', () => {
    const shortLot = lot({
      id: 'lot-short',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '80.00' as CanonicalDecimal,
      direction: 'short',
    });
    const currentPos = position({
      direction: 'short',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [shortLot],
    });

    const result = allocateFifo(
      execution({ action: 'buy', quantity: '50.00', price: '90.00' }),
      currentPos,
      [shortLot],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('UNSUPPORTED_FLIP');
  });
});

// ── 9. Mixed side rejection

describe('Mixed side rejection', () => {
  it('rejects sell when position is short', () => {
    const shortLot = lot({
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '80.00' as CanonicalDecimal,
      direction: 'short',
    });
    const currentPos = position({
      direction: 'short',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [shortLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '50.00', price: '90.00' }),
      currentPos,
      [shortLot],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('MIXED_SIDE');
  });

  it('rejects buy_to_cover when position is long', () => {
    const openLot = lot({
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'buy_to_cover', quantity: '50.00', price: '110.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('MIXED_SIDE');
  });
});

// ── 10. No position to close

describe('No position to close rejection', () => {
  it('rejects sell with no position', () => {
    const result = allocateFifo(
      execution({ action: 'sell', quantity: '100.00', price: '150.00' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('NO_POSITION_TO_CLOSE');
  });

  it('rejects buy_to_cover with no position', () => {
    const result = allocateFifo(
      execution({ action: 'buy_to_cover', quantity: '100.00', price: '150.00' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('NO_POSITION_TO_CLOSE');
  });

  it('rejects reduce with no position', () => {
    const result = allocateFifo(
      execution({ action: 'reduce', quantity: '50.00', price: '120.00' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('NO_POSITION_TO_CLOSE');
  });

  it('rejects add with no position (ambiguous direction)', () => {
    const result = allocateFifo(
      execution({ action: 'add', quantity: '50.00', price: '120.00' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('NO_POSITION_TO_CLOSE');
  });
});

// ── 11. Fractional quantities

describe('Fractional quantities', () => {
  it('supports fractional buy and sell', () => {
    const result = allocateFifo(
      execution({ action: 'buy', quantity: '0.50', price: '150.75' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.openedLots[0].remainingQuantity).toBe('0.50');
    expect(result.position.quantity).toBe('0.50');
    expect(result.position.averageCost).toBe('150.75');
  });

  it('supports fractional partial close', () => {
    const openLot = lot({
      id: 'frac-lot',
      remainingQuantity: '1.50' as CanonicalDecimal,
      originalQuantity: '1.50' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '1.50' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '0.75', price: '120.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.matches[0].matchQuantity).toBe('0.75');
    // P&L = (120 - 100) * 0.75 = 15.00
    expect(result.matches[0].realizedGrossPnl).toBe('15.00');
    expect(result.position.quantity).toBe('0.75');
  });
});

// ── 12. Exact decimal arithmetic

describe('Exact decimal arithmetic', () => {
  it('computes correct P&L for long at various prices', () => {
    const lot1 = lot({
      id: 'lot-decimal-1',
      remainingQuantity: '33.33' as CanonicalDecimal,
      originalQuantity: '33.33' as CanonicalDecimal,
      entryPrice: '150.75' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-01-01T00:00:00.000Z',
    });

    const currentPos = position({
      direction: 'long',
      quantity: '33.33' as CanonicalDecimal,
      openLots: [lot1],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '33.33', price: '200.50' }),
      currentPos,
      [lot1],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // P&L = (200.50 - 150.75) * 33.33 = 49.75 * 33.33 = 1657.57 (rounded to nearest cent)
    // 49.75 * 33.33 = 1658.1675... let me recalculate:
    // toMicros('200.50') = 200500000
    // toMicros('150.75') = 150750000
    // diff = 49750000 micros = 49.75
    // multiply(49.75, 33.33):
    // 49.75 * 33.33 = 1658.1675
    // Rounded: 1658.17
    expect(result.matches[0].realizedGrossPnl).toBe('1658.17');
  });

  it('computes correct P&L for short at various prices', () => {
    const shortLot = lot({
      id: 'short-dp',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '200.50' as CanonicalDecimal,
      direction: 'short',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const currentPos = position({
      direction: 'short',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [shortLot],
    });

    const result = allocateFifo(
      execution({ action: 'buy_to_cover', quantity: '100.00', price: '180.25' }),
      currentPos,
      [shortLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // Short P&L = (200.50 - 180.25) * 100 = 20.25 * 100 = 2025.00
    expect(result.matches[0].realizedGrossPnl).toBe('2025.00');
  });
});

// ── 13. Fee allocation

describe('Fee allocation across matches', () => {
  it('allocates fees proportionally across multiple lot matches', () => {
    const lot1 = lot({
      id: 'fee-lot-1',
      remainingQuantity: '60.00' as CanonicalDecimal,
      originalQuantity: '60.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const lot2 = lot({
      id: 'fee-lot-2',
      remainingQuantity: '40.00' as CanonicalDecimal,
      originalQuantity: '40.00' as CanonicalDecimal,
      entryPrice: '110.00' as CanonicalDecimal,
      direction: 'long',
      openedAt: '2026-02-01T00:00:00.000Z',
    });

    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [lot1, lot2],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '100.00', price: '150.00', fees: '15.00' }),
      currentPos,
      [lot1, lot2],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.matches).toHaveLength(2);

    // Lot1: 60/100 * 15 = 9.00
    expect(result.matches[0].allocatedFees).toBe('9.00');
    expect(result.matches[0].realizedNetPnl).toBe('2991.00'); // (150-100)*60 - 9 = 3000 - 9 = 2991

    // Lot2: 40/100 * 15 = 6.00
    expect(result.matches[1].allocatedFees).toBe('6.00');
    expect(result.matches[1].realizedNetPnl).toBe('1594.00'); // (150-110)*40 - 6 = 1600 - 6 = 1594

    // Position total fees
    expect(result.position.realizedFees).toBe('15.00');
    expect(result.position.realizedNetPnl).toBe('4585.00'); // 2991 + 1594 = 4585
  });

  it('handles zero fees cleanly', () => {
    const openLot = lot({
      id: 'zero-fee',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const result = allocateFifo(
      execution({ action: 'sell', quantity: '100.00', price: '150.00', fees: '0.00' }),
      currentPos,
      [openLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.matches[0].allocatedFees).toBe('0.00');
    expect(result.matches[0].realizedNetPnl).toBe(result.matches[0].realizedGrossPnl);
  });
});

// ── 14. Deterministic ordering

describe('Deterministic ordering', () => {
  it('produces identical output for identical inputs (two calls)', () => {
    const openLot = lot({
      id: 'det-lot',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
    });
    const currentPos = position({
      direction: 'long',
      quantity: '100.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const exec = execution({ action: 'sell', quantity: '50.00', price: '150.00' });

    const result1 = allocateFifo(exec, currentPos, [openLot], idGen);
    const result2 = allocateFifo(exec, currentPos, [openLot], idGen);
    const result3 = allocateFifo(exec, currentPos, [openLot], idGen);

    expect(result1.status).toBe('success');
    expect(result2.status).toBe('success');
    expect(result3.status).toBe('success');

    if (result1.status !== 'success' || result2.status !== 'success' || result3.status !== 'success') return;

    // Same P&L, same match quantities, same position state
    expect(result1.matches[0].realizedGrossPnl).toBe(result2.matches[0].realizedGrossPnl);
    expect(result2.matches[0].realizedGrossPnl).toBe(result3.matches[0].realizedGrossPnl);
    expect(result1.position.quantity).toBe(result2.position.quantity);
    expect(result2.position.quantity).toBe(result3.position.quantity);
  });
});

// ── 15. Reduce on short position

describe('Reduce action on short position', () => {
  it('reduces a short position with profit', () => {
    const shortLot = lot({
      id: 'short-reduce',
      remainingQuantity: '100.00' as CanonicalDecimal,
      originalQuantity: '100.00' as CanonicalDecimal,
      entryPrice: '80.00' as CanonicalDecimal,
      direction: 'short',
      openedAt: '2026-01-01T00:00:00.000Z',
    });
    const currentPos = position({
      direction: 'short',
      quantity: '100.00' as CanonicalDecimal,
      averageCost: '80.00' as CanonicalDecimal,
      totalCostBasis: '8000.00' as CanonicalDecimal,
      openLots: [shortLot],
    });

    const result = allocateFifo(
      execution({ action: 'reduce', quantity: '40.00', price: '70.00' }),
      currentPos,
      [shortLot],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // Short P&L = (80 - 70) * 40 = 400
    expect(result.matches[0].realizedGrossPnl).toBe('400.00');
    expect(result.position.quantity).toBe('60.00');
    expect(result.position.direction).toBe('short');
  });
});

// ── 16. Edge: sell entire position then add more

describe('Edge cases — sell all then add more', () => {
  it('correctly transitions from flat to new long position via buy', () => {
    const openLot = lot({
      id: 'flat-then-buy',
      remainingQuantity: '50.00' as CanonicalDecimal,
      originalQuantity: '50.00' as CanonicalDecimal,
      entryPrice: '100.00' as CanonicalDecimal,
      direction: 'long',
    });
    const currentPos1 = position({
      direction: 'long',
      quantity: '50.00' as CanonicalDecimal,
      openLots: [openLot],
    });

    const sellResult = allocateFifo(
      execution({ action: 'sell', quantity: '50.00', price: '150.00' }),
      currentPos1,
      [openLot],
      idGen,
    );

    expect(sellResult.status).toBe('success');
    if (sellResult.status !== 'success') return;
    expect(sellResult.position.direction).toBeNull();
    expect(sellResult.position.quantity).toBe('0.00');

    // Now buy again from flat position
    const buyResult = allocateFifo(
      execution({ action: 'buy', quantity: '100.00', price: '120.00' }),
      sellResult.position,
      sellResult.position.openLots,
      idGen,
    );

    expect(buyResult.status).toBe('success');
    if (buyResult.status !== 'success') return;
    expect(buyResult.position.direction).toBe('long');
    expect(buyResult.position.quantity).toBe('100.00');
    // Realized P&L from the previous sell is preserved
    // P&L from sell was (150-100)*50 = 2500
    expect(buyResult.position.realizedGrossPnl).toBe('2500.00');
  });
});

// ── 17. Empty lots array

describe('Edge cases — empty lots', () => {
  it('opens a long position with empty lots', () => {
    const result = allocateFifo(
      execution({ action: 'buy', quantity: '100.00', price: '100.00' }),
      null,
      [],
      idGen,
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.openedLots).toHaveLength(1);
  });
});
