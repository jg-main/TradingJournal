/**
 * execution-context.ts
 *
 * Execution-time account context shared by the P1 execute and P2 executions
 * routes (T04 / S02, M002-A2). Resolves the trade's account row and global
 * settings (for the A1 effective-configuration cascade) and the canonical
 * execution equity via the single A2 resolver
 * (resolveExecutionEquityContext), which carries explicit provenance.
 *
 * A2: current execution equity comes from canonical M006 Account Workflow
 * state (account_performance / financial_events / canonical rollforwards),
 * NEVER from legacy `accounts.startingBalance` / `accountTransactions` as
 * primary truth. The legacy path is explicit, last, and only for accounts
 * with no canonical evidence.
 *
 * Accepts the drizzle instance and the raw sqlite handle as parameters so the
 * route mirror test harnesses (which run against their own test databases)
 * reuse the identical computation instead of re-implementing it.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import {
  resolveExecutionEquityContext,
  type ExecutionEquitySource,
} from '@/lib/execution-equity';

export interface ExecutionContext {
  /** The trade's account row, or undefined when missing. */
  account: typeof schema.accounts.$inferSelect | undefined;
  /** The global settings row (A1 config fallback source), or undefined. */
  globalSettings: typeof schema.settings.$inferSelect | undefined;
  /** Canonical equity at open (null when unavailable; zero is a real value). */
  equityAtOpen: number | null;
  /** Explicit provenance of the equity value. */
  equitySource: ExecutionEquitySource;
  /** As-of marker (projection computed_as_of, rollforward date, or asOf). */
  equityAsOf: string | null;
  /** True when the account has usable positive canonical equity. */
  hasUsableEquity: boolean;
}

/**
 * Resolve the execution context for a trade at a given as-of date.
 *
 * A2: equity resolution delegates entirely to resolveExecutionEquityContext —
 * the SAME resolver planned-risk preview, execution readiness, max-risk
 * enforcement, and the persisted risk snapshot consume. No independent equity
 * reconstruction happens here.
 */
export function computeExecutionContext(
  dbHandle: BetterSQLite3Database<typeof schema>,
  sqlite: Database.Database,
  accountId: string | null | undefined,
  asOfDate: string,
): ExecutionContext {
  const globalSettings = dbHandle.select().from(schema.settings).get();

  if (!accountId) {
    return {
      account: undefined,
      globalSettings,
      equityAtOpen: null,
      equitySource: 'unavailable',
      equityAsOf: null,
      hasUsableEquity: false,
    };
  }

  const account = dbHandle
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .get();

  if (!account) {
    return {
      account: undefined,
      globalSettings,
      equityAtOpen: null,
      equitySource: 'unavailable',
      equityAsOf: null,
      hasUsableEquity: false,
    };
  }

  const equity = resolveExecutionEquityContext(sqlite, accountId, asOfDate);

  return {
    account,
    globalSettings,
    equityAtOpen: equity.equity,
    equitySource: equity.source,
    equityAsOf: equity.asOf,
    hasUsableEquity: equity.hasUsableEquity,
  };
}
