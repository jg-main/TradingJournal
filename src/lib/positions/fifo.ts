/**
 * Pure deterministic FIFO lot allocation engine.
 *
 * No database, no API routes, no side effects.
 * Takes validated fills and current position state, returns updated lots,
 * matches, position state, or typed rejection.
 *
 * Core design:
 * - Opening actions (buy, sell_short, add) create new lots
 * - Closing actions (sell, buy_to_cover, reduce) match against existing
 *   FIFO-ordered lots (oldest-first by openedAt → sequence → id)
 * - All P&L computed with exact BigInt decimal arithmetic
 * - Fees proportionally distributed across matches with remainder
 *   absorbed by the last match
 */

import {
  toMicros,
  fromMicros,
  addDecimal,
  subtractDecimal,
  negateDecimal,
  sumDecimals,
  compareDecimal,
  MICROS_PER_UNIT,
} from '../accounting/decimal';
import type { CanonicalDecimal } from '../accounting/types';
import type {
  FifoLot,
  LotMatch,
  PositionState,
  FifoExecutionInput,
  FifoAllocationResult,
  ExecutionAction,
  PositionDirection,
} from './types';
import {
  LONG_OPENING_ACTIONS,
  SHORT_OPENING_ACTIONS,
  FIFO_REJECTION_MESSAGES,
  resolveEffectiveDirection,
} from './types';
import type { FifoRejectionCode } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Multiply two canonical decimals using exact BigInt arithmetic.
 *
 * Both inputs have exactly 2 fraction digits, making the product
 * after dividing by MICROS_PER_UNIT always an exact integer micros.
 */
function multiplyDecimal(a: CanonicalDecimal, b: CanonicalDecimal): CanonicalDecimal {
  const product = BigInt(toMicros(a)) * BigInt(toMicros(b));
  return fromMicros(Number(product / BigInt(MICROS_PER_UNIT)));
}

/**
 * Compute realized gross P&L for a lot match.
 *
 * Long:  (matchPrice - entryPrice) × quantity
 * Short: (entryPrice - matchPrice) × quantity  = -((matchPrice - entryPrice) × quantity)
 */
function computeMatchPnl(
  entryPrice: CanonicalDecimal,
  matchPrice: CanonicalDecimal,
  matchQuantity: CanonicalDecimal,
  direction: PositionDirection,
): CanonicalDecimal {
  const priceDiff = subtractDecimal(matchPrice, entryPrice);
  const grossPnl = multiplyDecimal(priceDiff, matchQuantity);
  if (direction === 'short') {
    return negateDecimal(grossPnl);
  }
  return grossPnl;
}

/**
 * Allocate fees proportionally across match quantities.
 *
 * Each match gets: ceil(fees × matchQty / totalQty)
 * Last match absorbs the remainder to guarantee sum(matches) === totalFees.
 */
function allocateMatchFees(
  totalFees: CanonicalDecimal,
  totalClosingQuantity: CanonicalDecimal,
  matchQuantities: CanonicalDecimal[],
): CanonicalDecimal[] {
  if (matchQuantities.length === 0) return [];
  const feeMicros = toMicros(totalFees);
  if (feeMicros === 0) {
    return matchQuantities.map(() => '0.00' as CanonicalDecimal);
  }
  const totalQtyMicros = toMicros(totalClosingQuantity);
  const allocs: CanonicalDecimal[] = [];
  let allocatedMicros = 0;

  for (let i = 0; i < matchQuantities.length; i++) {
    const matchMicros = toMicros(matchQuantities[i]);
    let allocM: number;
    if (i < matchQuantities.length - 1) {
      allocM = Number(
        (BigInt(feeMicros) * BigInt(matchMicros)) / BigInt(totalQtyMicros),
      );
    } else {
      // Last match absorbs any remainder
      allocM = feeMicros - allocatedMicros;
    }
    allocatedMicros += allocM;
    allocs.push(fromMicros(allocM));
  }

  return allocs;
}

/**
 * Sort lots for FIFO matching: oldest openedAt first, then sequence, then id.
 */
function sortLotsFifo(lots: FifoLot[]): FifoLot[] {
  return [...lots].sort((a, b) => {
    const tsCmp = a.openedAt.localeCompare(b.openedAt);
    if (tsCmp !== 0) return tsCmp;
    const seqCmp = (a.sequence ?? 0) - (b.sequence ?? 0);
    if (seqCmp !== 0) return seqCmp;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Sum the remaining quantity of all open lots.
 */
function sumRemainingQuantity(lots: FifoLot[]): CanonicalDecimal {
  if (lots.length === 0) return '0.00' as CanonicalDecimal;
  return sumDecimals(lots.map((l) => l.remainingQuantity));
}

/**
 * Compute weighted average entry price across existing and new lots.
 *
 * Uses BigInt arithmetic on micros values to preserve precision:
 *   avg = (oldQty*oldAvgCost + newQty*newPrice) / (oldQty + newQty)
 *
 * Fees are tracked separately in allocatedFees / realizedFees and are NOT
 * included in the average cost. This keeps the average cost consistent
 * between long (entryPrice is purchase price) and short (entryPrice is
 * short-sale price) positions.
 */
function computeWeightedAverageCost(
  oldQty: CanonicalDecimal,
  oldAvgCost: CanonicalDecimal,
  newQty: CanonicalDecimal,
  newPrice: CanonicalDecimal,
): CanonicalDecimal {
  const totalQMicros = BigInt(toMicros(oldQty)) + BigInt(toMicros(newQty));
  if (totalQMicros === BigInt(0)) {
    return '0.00' as CanonicalDecimal;
  }
  const oQ = BigInt(toMicros(oldQty));
  const oA = BigInt(toMicros(oldAvgCost));
  const nQ = BigInt(toMicros(newQty));
  const nP = BigInt(toMicros(newPrice));

  // numerator = oQ*oA + nQ*nP  (all in micros-squared)
  const numerator = oQ * oA + nQ * nP;
  const avgMicros = Number(numerator / totalQMicros);
  return fromMicros(avgMicros);
}

/**
 * Compute average cost across a set of lots (legacy / fallback).
 */
function computeAverageCost(
  totalCostBasis: CanonicalDecimal,
  totalQuantity: CanonicalDecimal,
): CanonicalDecimal {
  if (compareDecimal(totalQuantity, '0.00' as CanonicalDecimal) === 0) {
    return '0.00' as CanonicalDecimal;
  }
  // averageCost = totalCostBasis / totalQuantity
  // In micros: totalCostBasisMicros / (totalQuantityMicros / MICROS_PER_UNIT)
  // = totalCostBasisMicros * MICROS_PER_UNIT / totalQuantityMicros
  const costMicros = toMicros(totalCostBasis);
  const qtyMicros = toMicros(totalQuantity);
  const avgMicros = Number(
    (BigInt(costMicros) * BigInt(MICROS_PER_UNIT)) / BigInt(qtyMicros),
  );
  return fromMicros(avgMicros);
}

// ── Validation ──────────────────────────────────────────────────────────

function rejection(code: FifoRejectionCode): FifoAllocationResult {
  return {
    status: 'rejected',
    code,
    message: FIFO_REJECTION_MESSAGES[code],
  };
}

/**
 * Check whether an action requires an existing position.
 */
function actionRequiresPosition(action: ExecutionAction): boolean {
  return (
    action === 'sell' ||
    action === 'buy_to_cover' ||
    action === 'reduce' ||
    action === 'add'
  );
}

/**
 * Check whether an action is an UNSUPPORTED_FLIP (explicitly opposite side).
 */
function isUnsupportedFlip(
  action: ExecutionAction,
  currentDirection: PositionDirection | null,
): boolean {
  if (!currentDirection) return false;
  if (currentDirection === 'long' && action === 'sell_short') return true;
  if (currentDirection === 'short' && action === 'buy') return true;
  return false;
}

/**
 * Check whether an action is MIXED_SIDE (close action for wrong position direction).
 */
function isMixedSide(
  action: ExecutionAction,
  currentDirection: PositionDirection | null,
): boolean {
  if (!currentDirection) return false;
  if (currentDirection === 'long' && action === 'buy_to_cover') return true;
  if (currentDirection === 'short' && action === 'sell') return true;
  return false;
}

/**
 * Check whether an action opens/increases a position (as opposed to closing/reducing).
 */
function isOpeningAction(
  action: ExecutionAction,
  positionDirection: PositionDirection | null,
): boolean {
  if (!positionDirection) {
    // With no position, only buy and sell_short are opening
    return action === 'buy' || action === 'sell_short';
  }
  if (positionDirection === 'long') {
    return (LONG_OPENING_ACTIONS as readonly ExecutionAction[]).includes(action);
  }
  // short
  return (SHORT_OPENING_ACTIONS as readonly ExecutionAction[]).includes(action);
}

// ── Opening Execution Handler ────────────────────────────────────────────

function handleOpening(
  input: FifoExecutionInput,
  currentPosition: PositionState | null,
  openLots: FifoLot[],
  effectiveDirection: PositionDirection,
  idGenerator: () => string,
): FifoAllocationResult {
  const { executionId, accountId, instrumentId, quantity, price, fees, postedAt } = input;

  // Compute transaction value for the new lot (fees tracked separately in allocatedFees)
  const costBasisTotal = multiplyDecimal(quantity, price);

  const newLot: FifoLot = {
    id: idGenerator(),
    accountId,
    instrumentId,
    direction: effectiveDirection,
    remainingQuantity: quantity,
    originalQuantity: quantity,
    entryPrice: price,
    costBasisTotal,
    allocatedFees: fees,
    openingExecutionId: executionId,
    openedAt: postedAt,
  };

  const updatedOpenLots = [...openLots, newLot];

  // Compute new position state
  const prevQuantity = currentPosition?.quantity ?? ('0.00' as CanonicalDecimal);
  const prevCostBasis = currentPosition?.totalCostBasis ?? ('0.00' as CanonicalDecimal);
  const prevRealizedPnl = currentPosition?.realizedGrossPnl ?? ('0.00' as CanonicalDecimal);
  const prevRealizedFees = currentPosition?.realizedFees ?? ('0.00' as CanonicalDecimal);
  const prevRealizedNetPnl = currentPosition?.realizedNetPnl ?? ('0.00' as CanonicalDecimal);

  const newQuantity = addDecimal(prevQuantity, quantity);
  const newCostBasis = addDecimal(prevCostBasis, costBasisTotal);
  const newAvgCost = computeWeightedAverageCost(
    currentPosition?.quantity ?? ('0.00' as CanonicalDecimal),
    currentPosition?.averageCost ?? ('0.00' as CanonicalDecimal),
    quantity,
    price,
  );

  const position: PositionState = {
    accountId,
    instrumentId,
    direction: effectiveDirection,
    quantity: newQuantity,
    averageCost: newAvgCost,
    totalCostBasis: newCostBasis,
    realizedGrossPnl: prevRealizedPnl,
    realizedFees: prevRealizedFees,
    realizedNetPnl: prevRealizedNetPnl,
    openLots: updatedOpenLots,
    lastUpdated: postedAt,
  };

  return {
    status: 'success',
    openedLots: [newLot],
    matches: [],
    position,
  };
}

// ── Closing Execution Handler ────────────────────────────────────────────

function handleClosing(
  input: FifoExecutionInput,
  currentPosition: PositionState,
  openLots: FifoLot[],
  effectiveDirection: PositionDirection,
  idGenerator: () => string,
): FifoAllocationResult {
  const { executionId, accountId, instrumentId, quantity, price, fees, postedAt } = input;
  const currentDirection = currentPosition.direction!;

  // Sort lots FIFO for matching
  const sortedLots = sortLotsFifo(openLots);

  // Check for REVERSAL (closing quantity exceeds total open quantity)
  const totalRemaining = sumRemainingQuantity(sortedLots);
  if (compareDecimal(quantity, totalRemaining) > 0) {
    return rejection('REVERSAL');
  }

  // Perform FIFO matching
  let remainingToClose = quantity;
  const matches: LotMatch[] = [];
  const updatedLots: FifoLot[] = [];
  const matchQuantities: CanonicalDecimal[] = [];
  let sequence = 0;

  for (const lot of sortedLots) {
    if (compareDecimal(remainingToClose, '0.00' as CanonicalDecimal) <= 0) {
      // No more quantity to close — keep remaining lots as-is
      updatedLots.push(lot);
      continue;
    }

    const matchQty = compareDecimal(remainingToClose, lot.remainingQuantity) >= 0
      ? lot.remainingQuantity
      : remainingToClose;

    matchQuantities.push(matchQty);

    // Compute P&L for this match
    const realizedGrossPnl = computeMatchPnl(
      lot.entryPrice,
      price,
      matchQty,
      currentDirection,
    );

    sequence++;

    const match: LotMatch = {
      id: idGenerator(),
      closingExecutionId: executionId,
      lotId: lot.id,
      matchQuantity: matchQty,
      matchPrice: price,
      realizedGrossPnl,
      allocatedFees: '0.00' as CanonicalDecimal, // placeholder, set below
      realizedNetPnl: '0.00' as CanonicalDecimal, // placeholder, set below
      sequence,
    };

    matches.push(match);

    // Update remaining quantity on the lot
    const newRemaining = subtractDecimal(lot.remainingQuantity, matchQty);
    if (compareDecimal(newRemaining, '0.00' as CanonicalDecimal) > 0) {
      // Lot still open
      updatedLots.push({
        ...lot,
        remainingQuantity: newRemaining,
      });
    }
    // If newRemaining is "0.00", the lot is fully closed — don't add to updatedLots

    remainingToClose = subtractDecimal(remainingToClose, matchQty);
  }

  // Allocate fees across matches proportionally
  const feeAllocations = allocateMatchFees(fees, quantity, matchQuantities);

  for (let i = 0; i < matches.length; i++) {
    const alloc = feeAllocations[i];
    matches[i].allocatedFees = alloc;
    matches[i].realizedNetPnl = subtractDecimal(matches[i].realizedGrossPnl, alloc);
  }

  // Compute new position state
  const closedQuantity = sumDecimals(matchQuantities);

  // Sum up realized P&L from this execution
  const executionRealizedGrossPnl = sumDecimals(matches.map((m) => m.realizedGrossPnl));
  const executionRealizedFees = sumDecimals(matches.map((m) => m.allocatedFees));
  const executionRealizedNetPnl = sumDecimals(matches.map((m) => m.realizedNetPnl));

  const prevRealizedGrossPnl = currentPosition.realizedGrossPnl;
  const prevRealizedFees = currentPosition.realizedFees;
  const prevRealizedNetPnl = currentPosition.realizedNetPnl;

  // New position aggregate values
  const newQuantity = subtractDecimal(currentPosition.quantity, closedQuantity);
  const isFlat = compareDecimal(newQuantity, '0.00' as CanonicalDecimal) === 0;

  let newTotalCostBasis: CanonicalDecimal;
  let newAvgCost: CanonicalDecimal;

  if (isFlat) {
    newTotalCostBasis = '0.00' as CanonicalDecimal;
    newAvgCost = '0.00' as CanonicalDecimal;
  } else {
    // Remaining lots keep exact cost basis: remainingQuantity × entryPrice.
    // The previous proportional-ratio scaling (originalQty × entryPrice ×
    // remainingRatio) rounded the ratio to cents through fromMicros, so a
    // partial close like 10 of 15 (@ 100) left 495.00 instead of 500.00 on
    // the remaining 5 shares (S08 zero-divergence: journal/effective P&L and
    // the accounting projection disagreed on cost basis for non-divisible
    // quantities).
    updatedLots.forEach((lot) => {
      lot.costBasisTotal = multiplyDecimal(
        lot.remainingQuantity as CanonicalDecimal,
        lot.entryPrice as CanonicalDecimal,
      );
    });
    newTotalCostBasis = sumDecimals(updatedLots.map((l) => l.costBasisTotal));
    newAvgCost = computeAverageCost(newTotalCostBasis, newQuantity);
  }

  const position: PositionState = {
    accountId,
    instrumentId,
    direction: isFlat ? null : currentDirection,
    quantity: newQuantity,
    averageCost: newAvgCost,
    totalCostBasis: newTotalCostBasis,
    realizedGrossPnl: addDecimal(prevRealizedGrossPnl, executionRealizedGrossPnl),
    realizedFees: addDecimal(prevRealizedFees, executionRealizedFees),
    realizedNetPnl: addDecimal(prevRealizedNetPnl, executionRealizedNetPnl),
    openLots: updatedLots,
    lastUpdated: postedAt,
  };

  return {
    status: 'success',
    openedLots: [],
    matches,
    position,
  };
}

// ── Main Allocator ───────────────────────────────────────────────────────

/**
 * Pure FIFO allocation engine.
 *
 * @param input - The validated execution fill to allocate.
 * @param currentPosition - Current position state (null = flat/no position).
 * @param openLots - Current open FIFO lots.
 * @param idGenerator - Function to generate unique IDs for new lots and matches.
 * @returns FifoAllocationResult — success with lots/matches/position, or rejection.
 */
export function allocateFifo(
  input: FifoExecutionInput,
  currentPosition: PositionState | null,
  openLots: FifoLot[],
  idGenerator: () => string,
): FifoAllocationResult {
  const currentDirection = currentPosition?.direction ?? null;

  // ── Validation ─────────────────────────────────────────────────────

  // Action requires a position but none exists
  if (!currentPosition && actionRequiresPosition(input.action)) {
    return rejection('NO_POSITION_TO_CLOSE');
  }

  // Unsupported flip (explicitly opposite side)
  if (isUnsupportedFlip(input.action, currentDirection)) {
    return rejection('UNSUPPORTED_FLIP');
  }

  // Mixed side (wrong close direction for current position)
  if (isMixedSide(input.action, currentDirection)) {
    return rejection('MIXED_SIDE');
  }

  // Determine effective direction
  const effectiveDirection = resolveEffectiveDirection(input.action, currentDirection) ?? 'long';

  // Dispatch
  if (isOpeningAction(input.action, currentPosition?.direction ?? null)) {
    return handleOpening(input, currentPosition, openLots, effectiveDirection, idGenerator);
  }

  // Must be a closing action
  return handleClosing(input, currentPosition!, openLots, effectiveDirection, idGenerator);
}
