/**
 * execution-context.ts
 *
 * Execution-time account context shared by the P1 execute and P2 executions
 * routes (T04 / S02). Resolves the trade's account row, computes the canonical
 * equity-at-open (computeEquityAtOpen with the exact inputs both routes used
 * inline), and derives the hasOpeningCash flag that the execution-readiness
 * gate consumes.
 *
 * Accepts the drizzle instance as a parameter so the route mirror test
 * harnesses (which run against their own test databases) reuse the identical
 * computation instead of re-implementing it.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and, lte } from 'drizzle-orm';
import * as schema from '@/db/schema';
import {
  computeEquityAtOpen,
  computeRealizedPnLFromClosedTrades,
  type PriorClosedTradeData,
} from '@/lib/risk-snapshot';
import type { Direction, ExecutionData } from '@/lib/trade-metrics';

export interface ExecutionContext {
  /** The trade's account row, or undefined when missing. */
  account: typeof schema.accounts.$inferSelect | undefined;
  /** The global settings row (max-risk fallback source), or undefined. */
  globalSettings: typeof schema.settings.$inferSelect | undefined;
  /** Canonical equity at open (null when no equity value can be determined). */
  equityAtOpen: number | null;
  /** True when the account has positive equity to trade with. */
  hasOpeningCash: boolean;
}

function toExecutionData(
  rows: typeof schema.tradeExecutions.$inferSelect[],
): ExecutionData[] {
  return rows.map((r) => ({
    action: r.action,
    quantity: r.quantity,
    price: r.price,
    fees: r.fees,
    executedAt: r.executedAt ?? r.createdAt ?? '',
  }));
}

/**
 * Resolve the execution context for a trade at a given as-of date.
 *
 * Mirrors the equity-at-open derivation that both execution routes previously
 * performed inline inside their risk-snapshot sections (starting balance +
 * deposits − withdrawals + realized P&L from prior closed trades, with the
 * global settings fallback when there is no account data at all).
 */
export function computeExecutionContext(
  dbHandle: BetterSQLite3Database<typeof schema>,
  accountId: string | null | undefined,
  asOfDate: string,
): ExecutionContext {
  const globalSettings = dbHandle.select().from(schema.settings).get();

  if (!accountId) {
    return { account: undefined, globalSettings, equityAtOpen: null, hasOpeningCash: false };
  }

  const account = dbHandle
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .get();

  if (!account) {
    return { account: undefined, globalSettings, equityAtOpen: null, hasOpeningCash: false };
  }

  const allTxns = dbHandle
    .select()
    .from(schema.accountTransactions)
    .where(
      and(
        eq(schema.accountTransactions.accountId, accountId),
        lte(schema.accountTransactions.date, asOfDate),
      ),
    )
    .all();

  const sumDeposits = allTxns
    .filter((txn) => txn.type === 'deposit')
    .reduce((s, txn) => s + txn.amount, 0);
  const sumWithdrawals = allTxns
    .filter((txn) => txn.type === 'withdrawal')
    .reduce((s, txn) => s + txn.amount, 0);

  const priorClosedTrades = dbHandle
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.accountId, accountId))
    .all()
    .filter((t) => t.closedAt != null && t.closedAt <= asOfDate);

  const priorTradeData: PriorClosedTradeData[] = priorClosedTrades.map((ct) => {
    const execs = dbHandle
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, ct.id))
      .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
      .all();
    return {
      direction: ct.direction as Direction,
      executions: toExecutionData(execs),
    };
  });

  const realizedPnL = computeRealizedPnLFromClosedTrades(priorTradeData);

  const equityAtOpen = computeEquityAtOpen({
    startingBalance: account.startingBalance ?? 0,
    deposits: sumDeposits,
    withdrawals: sumWithdrawals,
    realizedPnL,
    hasNoAccountData:
      account.startingBalance == null &&
      allTxns.length === 0 &&
      priorClosedTrades.length === 0,
    fallbackValue: globalSettings?.startingAccountValue ?? null,
  });

  return {
    account,
    globalSettings,
    equityAtOpen,
    hasOpeningCash: equityAtOpen != null && equityAtOpen > 0,
  };
}
