/**
 * account-summary.ts
 *
 * Pure (no side effects, no database access) functions for computing
 * account-level KPIs, balance rollforward, and closure date ranges.
 *
 * These functions extract the duplicated KPI and balance computation
 * from both account route handlers (GET /api/accounts/[id] and
 * POST /api/accounts/[id]/close) into a single shared module.
 *
 * All data must be passed in as arguments — no database queries.
 */

import { calculatePnL, calculateRMultiple, type ExecutionData } from './trade-calc';
export { type ExecutionData };

// ── Types ────────────────────────────────────────────────────────────────

/** Minimal shape of a closed trade for KPI computation. */
export interface ClosedTradeData {
  id: string;
  direction: 'long' | 'short';
  createdAt: string | null;
}

/** Minimal shape of a risk snapshot for R-multiple computation. */
export interface RiskSnapshotData {
  tradeId: string;
  initialRiskAmount: number | null;
}

/** Minimal shape of a grade for average grade computation. */
export interface GradeData {
  tradeId: string;
  totalScore: number | null;
}

/** KPI result object. */
export interface AccountKPIs {
  tradeCount: number;
  netPnl: number;
  winRate: number | null;
  avgR: number | null;
  avgGrade: number | null;
}

/** Minimal shape of an account transaction. */
export interface AccountTransactionData {
  type: string;
  amount: number;
  date: string | null;
}

/** Balance rollforward result. */
export interface AccountBalance {
  currentBalance: number;
  netDeposits: number;
  netWithdrawals: number;
  realizedPnl: number;
}

/** Date range result for closure summary. */
export interface DatesActiveResult {
  from: string;
  to: string;
}

// ── 1. computeAccountKPIs ──────────────────────────────────────────────

/**
 * Compute per-account KPI metrics from closed trades and their associated
 * executions, risk snapshots, and grades.
 *
 * @param closedTrades  Array of closed trades with id, direction, createdAt
 * @param execByTradeId Executions grouped by tradeId (Map<tradeId, ExecutionData[]>)
 * @param riskSnapshots Array of risk snapshots (one per closed trade)
 * @param grades        Array of grades (one per closed trade)
 * @returns AccountKPIs object with tradeCount, netPnl, winRate, avgR, avgGrade
 *
 * When closedTrades is empty, returns zero-valued KPIs with null for derived fields.
 */
export function computeAccountKPIs(
  closedTrades: ClosedTradeData[],
  execByTradeId: Map<string, ExecutionData[]>,
  riskSnapshots: RiskSnapshotData[],
  grades: GradeData[],
): AccountKPIs {
  if (closedTrades.length === 0) {
    return { tradeCount: 0, netPnl: 0, winRate: null, avgR: null, avgGrade: null };
  }

  const riskByTradeId = new Map(riskSnapshots.map((rs) => [rs.tradeId, rs]));
  const gradeByTradeId = new Map(grades.map((g) => [g.tradeId, g]));

  let winCount = 0;
  let netPnl = 0;
  const rMultiples: number[] = [];
  const gradeScores: number[] = [];

  for (const trade of closedTrades) {
    const executions = execByTradeId.get(trade.id) ?? [];
    if (executions.length === 0) continue;

    const execData: ExecutionData[] = executions.map((e) => ({
      action: e.action,
      quantity: e.quantity,
      price: e.price,
      fees: e.fees ?? 0,
      executedAt: e.executedAt ?? trade.createdAt ?? new Date().toISOString(),
    }));

    const pnl = calculatePnL(execData, trade.direction);
    netPnl += pnl.totalRealizedPnL;

    // R-multiple from risk snapshot
    const risk = riskByTradeId.get(trade.id);
    if (risk?.initialRiskAmount != null && risk.initialRiskAmount > 0) {
      const rResult = calculateRMultiple(pnl.totalRealizedPnL, risk.initialRiskAmount);
      if (rResult.rMultiple !== null) rMultiples.push(rResult.rMultiple);
    }

    // Grade score
    const grade = gradeByTradeId.get(trade.id);
    if (grade?.totalScore != null) gradeScores.push(grade.totalScore);

    // Win/loss
    if (pnl.totalRealizedPnL > 0) winCount++;
  }

  const decisions = closedTrades.filter(
    (t) => (execByTradeId.get(t.id)?.length ?? 0) > 0,
  ).length;

  return {
    tradeCount: closedTrades.length,
    netPnl,
    winRate: decisions > 0 ? winCount / decisions : null,
    avgR: rMultiples.length > 0
      ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
      : null,
    avgGrade: gradeScores.length > 0
      ? gradeScores.reduce((a, b) => a + b, 0) / gradeScores.length
      : null,
  };
}

// ── 2. computeAccountBalance ───────────────────────────────────────────

/**
 * Compute account balance by rolling forward from startingBalance through
 * deposits, withdrawals, and realized P&L.
 *
 * @param startingBalance The account's starting balance
 * @param transactions    Account transaction records (deposits and withdrawals)
 * @param realizedPnl     Total realized P&L from closed trades
 * @returns AccountBalance object with currentBalance, netDeposits, netWithdrawals, realizedPnl
 */
export function computeAccountBalance(
  startingBalance: number,
  transactions: AccountTransactionData[],
  realizedPnl: number,
): AccountBalance {
  const netDeposits = transactions
    .filter((t) => t.type === 'deposit')
    .reduce((s, t) => s + t.amount, 0);

  const netWithdrawals = transactions
    .filter((t) => t.type === 'withdrawal')
    .reduce((s, t) => s + t.amount, 0);

  const currentBalance = startingBalance + netDeposits - netWithdrawals + realizedPnl;

  return { currentBalance, netDeposits, netWithdrawals, realizedPnl };
}

// ── 3. computeDatesActive ──────────────────────────────────────────────

/**
 * Compute the date range during which an account was active, based on the
 * earliest of the account creation date and any transaction dates.
 *
 * Accepts an optional referenceDate for deterministic testing; defaults to
 * the current time when omitted.
 *
 * @param accountCreatedAt  ISO date string of account creation
 * @param transactions      Account transaction records
 * @param referenceDate     Optional reference date for the "to" field (for testability)
 * @returns DatesActiveResult with `from` (earliest date) and `to` (reference date)
 */
export function computeDatesActive(
  accountCreatedAt: string,
  transactions: AccountTransactionData[],
  referenceDate?: string,
): DatesActiveResult {
  const to = referenceDate ?? new Date().toISOString();

  const transactionDates = transactions
    .filter((t) => t.date != null)
    .map((t) => t.date as string)
    .sort();

  const earliestDate = transactionDates.length > 0
    ? new Date(Math.min(
        new Date(accountCreatedAt).getTime(),
        ...transactionDates.map((d) => new Date(d).getTime()),
      )).toISOString()
    : accountCreatedAt;

  return { from: earliestDate, to };
}
