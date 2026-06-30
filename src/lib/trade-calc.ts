/**
 * trade-calc.ts
 *
 * Pure (no side effects) P&L, R-multiple, and trade-status derivation functions.
 * Decoupled from the Drizzle schema — uses its own ExecutionData shape so this
 * module can be tested independently without a database.
 */

export interface ExecutionData {
  action: string;
  quantity: number;
  price: number;
  fees: number | null;
  executedAt: string;
}

export type Direction = 'long' | 'short';
export type TradeStatus = 'planned' | 'open' | 'partially_closed' | 'closed';

export interface DeriveStatusResult {
  status: TradeStatus;
  openedAt: string | null;
  closedAt: string | null;
  openQuantity: number;
  totalEntryQty: number;
  totalExitQty: number;
}

export interface AvgCostResult {
  avgEntryPrice: number | null;
  totalEntryQty: number;
}

export interface RealizedPnLResult {
  realizedPnL: number;
  remainingQuantity: number;
}

export interface PnLResult {
  totalRealizedPnL: number;
  avgEntryPrice: number | null;
  totalEntryQty: number;
  totalExitQty: number;
  openQuantity: number;
}

export interface RMultipleResult {
  rMultiple: number | null;
  initialRiskUsed: boolean;
}

// ── Internal helpers ────────────────────────────────────────────────────

function isEntryAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'buy' || action === 'add';
  return action === 'sell_short';
}

function isExitAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'sell' || action === 'reduce';
  return action === 'buy_to_cover';
}

// ── 1. Status derivation ───────────────────────────────────────────────

export function deriveTradeStatus(
  executions: ExecutionData[],
  direction: Direction,
): DeriveStatusResult {
  const entries = executions.filter((e) => isEntryAction(e.action, direction));
  const exits = executions.filter((e) => isExitAction(e.action, direction));

  const totalEntryQty = entries.reduce((s, e) => s + e.quantity, 0);
  const totalExitQty = exits.reduce((s, e) => s + e.quantity, 0);

  let status: TradeStatus;
  let openedAt: string | null = null;
  let closedAt: string | null = null;

  if (totalEntryQty === 0) {
    status = 'planned';
  } else if (totalExitQty === 0) {
    status = 'open';
  } else if (totalExitQty < totalEntryQty) {
    status = 'partially_closed';
  } else {
    status = 'closed';
  }

  if (totalEntryQty > 0 && entries.length > 0) {
    const sortedEntries = [...entries].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
    );
    openedAt = sortedEntries[0].executedAt;
  }

  if (totalExitQty >= totalEntryQty && exits.length > 0) {
    const sortedExits = [...exits].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
    );
    closedAt = sortedExits[sortedExits.length - 1].executedAt;
  }

  const openQuantity = Math.max(0, totalEntryQty - totalExitQty);

  return {
    status,
    openedAt,
    closedAt,
    openQuantity,
    totalEntryQty,
    totalExitQty,
  };
}

// ── 2. Average cost calculation ────────────────────────────────────────

export function calculateAvgCost(entries: ExecutionData[]): AvgCostResult {
  const totalEntryQty = entries.reduce((s, e) => s + e.quantity, 0);

  if (totalEntryQty === 0) {
    return { avgEntryPrice: null, totalEntryQty: 0 };
  }

  const weightedSum = entries.reduce(
    (s, e) => s + e.price * e.quantity,
    0,
  );

  return {
    avgEntryPrice: weightedSum / totalEntryQty,
    totalEntryQty,
  };
}

// ── 3. Realized P&L (chronological exits) ──────────────────────────────

export function calculateRealizedPnL(
  avgEntryPrice: number,
  totalOpenQty: number,
  exits: ExecutionData[],
  direction: Direction,
): RealizedPnLResult {
  if (exits.length === 0 || totalOpenQty <= 0) {
    return { realizedPnL: 0, remainingQuantity: totalOpenQty };
  }

  const sortedExits = [...exits].sort(
    (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
  );

  let realizedPnL = 0;
  let remaining = totalOpenQty;

  for (const exit of sortedExits) {
    const exitQty = Math.min(exit.quantity, remaining);
    if (exitQty <= 0) break;

    if (direction === 'long') {
      realizedPnL += (exit.price - avgEntryPrice) * exitQty;
    } else {
      realizedPnL += (avgEntryPrice - exit.price) * exitQty;
    }

    remaining -= exitQty;
  }

  return { realizedPnL, remainingQuantity: remaining };
}

// ── 4. Combined P&L orchestrator ───────────────────────────────────────

export function calculatePnL(
  executions: ExecutionData[],
  direction: Direction,
): PnLResult {
  const entries = executions.filter((e) => isEntryAction(e.action, direction));
  const exits = executions.filter((e) => isExitAction(e.action, direction));

  const { avgEntryPrice, totalEntryQty } = calculateAvgCost(entries);

  const totalExitQty = exits.reduce((s, e) => s + e.quantity, 0);
  const cappedExitQty = Math.min(totalExitQty, totalEntryQty);

  let totalRealizedPnL = 0;

  if (avgEntryPrice !== null) {
    const { realizedPnL } = calculateRealizedPnL(
      avgEntryPrice,
      totalEntryQty,
      exits,
      direction,
    );
    totalRealizedPnL = realizedPnL;
  }

  // Subtract fees (null fees treated as 0)
  const totalFees = executions.reduce(
    (s, e) => s + (e.fees ?? 0),
    0,
  );
  totalRealizedPnL -= totalFees;

  const openQuantity = Math.max(0, totalEntryQty - cappedExitQty);

  return {
    totalRealizedPnL,
    avgEntryPrice,
    totalEntryQty,
    totalExitQty: cappedExitQty,
    openQuantity,
  };
}

// ── 5. R multiple calculation ──────────────────────────────────────────

export function calculateRMultiple(
  totalRealizedPnL: number,
  initialRiskAmount: number | null,
): RMultipleResult {
  if (initialRiskAmount === null || initialRiskAmount === undefined || initialRiskAmount <= 0) {
    return { rMultiple: null, initialRiskUsed: false };
  }

  return {
    rMultiple: totalRealizedPnL / initialRiskAmount,
    initialRiskUsed: true,
  };
}
