/**
 * execution-equity.ts
 *
 * M002-A2 — canonical execution equity-at-open resolver.
 *
 * ONE resolver for execution equity across planned-risk preview, execution
 * readiness, max-risk enforcement, and the persisted first-entry risk
 * snapshot. Replaces the split/divergent logic where:
 *
 *   - execution readiness / planned-risk preview used
 *     computeExecutionContext() (legacy startingBalance + accountTransactions
 *     + journal realized P&L + settings fallback), while
 *   - the persisted risk snapshot used resolveCanonicalEquity()
 *     (account_performance.nav → rollforward → startingBalance → settings)
 *
 * The two could disagree, and Trading Workflow must use canonical M006 Account
 * Workflow state (financial_events / ledger / account_performance / canonical
 * rollforwards) as economic truth — never legacy `accounts.startingBalance` or
 * `accountTransactions` for a canonical account.
 *
 * Required invariant:
 *
 *   For a given first fill and execution timestamp, planned-risk preview,
 *   execution readiness, max-risk enforcement, and the persisted initial risk
 *   snapshot use the SAME canonical pre-fill account-equity context, with
 *   explicit provenance.
 *
 * Provenance contract (ExecutionEquitySource):
 *
 *   current_projection       account_performance.nav (pre-fill, current)
 *   historical_rollforward   account_rollforward.ending_equity at/before asOf
 *   reconstructed_canonical  correction-aware cash + realized P&L at asOf
 *   legacy_compatibility     explicit legacy startingBalance/accountTransactions
 *   unavailable              no canonical or legacy evidence
 *
 * Pure resolver: no NextResponse. Database access ONLY through the injected
 * raw better-sqlite3 handle.
 */

import type Database from 'better-sqlite3';
import {
  computeEquityAtOpen,
  computeRealizedPnLFromClosedTrades,
  type PriorClosedTradeData,
} from '@/lib/risk-snapshot';
import { computeAccountActivity, computeRebuildCashFlow } from '@/lib/accounting/activity';
import type { Direction, ExecutionData } from '@/lib/trade-metrics';

/** Where the resolved equity value came from. */
export type ExecutionEquitySource =
  | 'current_projection'
  | 'historical_rollforward'
  | 'reconstructed_canonical'
  | 'legacy_compatibility'
  | 'unavailable';

/** Canonical execution equity context shared by preview / readiness / engine. */
export interface ExecutionEquityContext {
  /** Equity at open (canonical pre-fill); null when unavailable. Zero is a real value. */
  equity: number | null;
  /** Explicit provenance of the equity value. */
  source: ExecutionEquitySource;
  /** As-of marker: the projection's computed_as_of, rollforward date, or the asOfTimestamp. */
  asOf: string | null;
  /** True when the account has usable positive canonical equity. */
  hasUsableEquity: boolean;
}

/** Return the "no evidence" context (equity unknown). */
function unavailable(): ExecutionEquityContext {
  return { equity: null, source: 'unavailable', asOf: null, hasUsableEquity: false };
}

/**
 * Detect whether the account has canonical M006 funding/activity history.
 *
 * A2 rule: canonical state is evidenced by canonical FUNDING events — any
 * financial_event that is not a trade_execution (opening_balance, deposit,
 * withdrawal, fee, dividend, interest, manual_adjustment, ...). trade_execution
 * events are excluded because the canonical engine itself creates them for
 * EVERY fill, so their presence cannot distinguish a canonical M006 account
 * from a legacy account that simply began trading. Likewise the
 * account_performance row is a derived projection the engine rebuilds on every
 * fill — its existence alone is NOT canonical funding evidence (a legacy
 * account's startingBalance is never represented as a canonical event, so its
 * rebuild produces a misleading zero NAV).
 *
 * A legacy account is "positively identified as legacy" by its legacy funding
 * rows (starting_balance / account_transactions). Once canonical funding
 * history exists, canonical truth wins over contradictory legacy rows.
 */
function hasCanonicalFundingHistory(sqlite: Database.Database, accountId: string): boolean {
  return Boolean(
    sqlite
      .prepare(
        `SELECT 1 FROM financial_events
         WHERE account_id = ? AND event_type != 'trade_execution'
         LIMIT 1`,
      )
      .get(accountId),
  );
}

/**
 * Resolve the account row's legacy fields (used only on the legacy path).
 */
function legacyFields(
  sqlite: Database.Database,
  accountId: string,
): { startingBalance: number | null } | undefined {
  const row = sqlite
    .prepare('SELECT starting_balance FROM accounts WHERE id = ?')
    .get(accountId) as { starting_balance: number | null } | undefined;
  return row ? { startingBalance: row.starting_balance } : undefined;
}

/** Journal trades closed at/before asOf (for realized P&L reconstruction). */
function closedTradesAt(
  sqlite: Database.Database,
  accountId: string,
  asOf: string,
): PriorClosedTradeData[] {
  const rows = sqlite
    .prepare(
      `SELECT id, direction FROM trades
       WHERE account_id = ? AND closed_at IS NOT NULL AND closed_at <= ?
       ORDER BY closed_at ASC`,
    )
    .all(accountId, asOf) as Array<{ id: string; direction: string }>;
  return rows.map((trade) => {
    const execs = sqlite
      .prepare(
        `SELECT action, quantity, price, fees, executed_at, created_at
         FROM trade_executions WHERE trade_id = ? ORDER BY executed_at ASC, created_at ASC`,
      )
      .all(trade.id) as Array<{
      action: string;
      quantity: number;
      price: number;
      fees: number | null;
      executed_at: string | null;
      created_at: string | null;
    }>;
    return {
      direction: trade.direction as Direction,
      executions: execs.map((e): ExecutionData => ({
        id: e.executed_at ?? e.created_at ?? '',
        action: e.action,
        quantity: e.quantity,
        price: e.price,
        fees: e.fees,
        executedAt: e.executed_at ?? e.created_at ?? '',
      })),
    };
  });
}

/**
 * Correction-aware net cash (in UNITS, not micros) at/before asOf from
 * canonical financial_events.
 *
 * Sums ALL cash-effect events (opening_balance + deposits/withdrawals/fees +
 * trade executions) bounded by posted_at <= asOf via the canonical activity
 * replay. Reversal/replacement events carry opposite/corrected effect
 * directions, so original + reversal + replacement nets to the corrected
 * value naturally (A4 opening corrections, financial-event corrections).
 * This is the SAME cash truth the account-performance projection uses, so
 * reconstruction and projection never disagree on cash.
 */
function canonicalNetCashAt(sqlite: Database.Database, accountId: string, asOf: string): number {
  const activity = computeAccountActivity(sqlite, accountId);
  const bounded = activity.events.filter((event) => event.postedAt <= asOf);
  const cash = computeRebuildCashFlow(bounded);
  return cash.netCashImpactMicros / 1_000_000;
}

/**
 * Resolve the canonical execution equity context for an account at asOf.
 *
 * Precedence (A2 binding contract):
 *
 *   1. current_projection       — account_performance.nav when the projection
 *                                 is at least as fresh as the execution
 *                                 (asOf >= computed_as_of). nav '0.00' → 0.
 *   2. historical_rollforward   — latest account_rollforward row with
 *                                 date <= asOf (bounded, never "latest row
 *                                 overall").
 *   3. reconstructed_canonical  — correction-aware net cash at asOf + realized
 *                                 P&L from journal trades closed at/before
 *                                 asOf. Documented approximation: excludes
 *                                 unrealized P&L on positions open at asOf (no
 *                                 historical marks — false precision is worse
 *                                 than unavailable risk).
 *   4. legacy_compatibility     — ONLY when no canonical evidence exists AND
 *                                 the account has legacy rows
 *                                 (startingBalance/accountTransactions). The
 *                                 legacy computeEquityAtOpen contract (incl.
 *                                 the documented settings.startingAccountValue
 *                                 fallback) applies here and only here.
 *   5. unavailable              — no canonical evidence and no legacy evidence.
 *
 * Canonical zero (nav '0.00') NEVER falls through to a global starting value.
 * settings.startingAccountValue can never fund a canonical account.
 *
 * @param sqlite        - Raw better-sqlite3 handle.
 * @param accountId     - The account to resolve equity for.
 * @param asOfTimestamp - The execution timestamp (ISO-8601).
 */
export function resolveExecutionEquityContext(
  sqlite: Database.Database,
  accountId: string,
  asOfTimestamp: string,
): ExecutionEquityContext {
  const account = legacyFields(sqlite, accountId);
  if (!account) return unavailable();

  if (hasCanonicalFundingHistory(sqlite, accountId)) {
    const projection = sqlite
      .prepare(
        `SELECT computed_as_of, nav FROM account_performance WHERE account_id = ?`,
      )
      .get(accountId) as { computed_as_of: string; nav: string } | undefined;

    if (projection && asOfTimestamp >= projection.computed_as_of) {
      // 1. Current projection is pre-fill evidence. Parse even '0.00' → 0.
      const nav = Number.parseFloat(projection.nav);
      const equity = Number.isFinite(nav) ? nav : null;
      return {
        equity,
        source: 'current_projection',
        asOf: projection.computed_as_of,
        hasUsableEquity: equity != null && equity > 0,
      };
    }

    // 2. Historical: bounded rollforward lookup.
    const asOfDate = asOfTimestamp.slice(0, 10);
    const rollforward = sqlite
      .prepare(
        `SELECT ending_equity, date FROM account_rollforward
         WHERE account_id = ? AND date <= ?
         ORDER BY date DESC, created_at DESC LIMIT 1`,
      )
      .get(accountId, asOfDate) as { ending_equity: number | null; date: string } | undefined;
    if (rollforward?.ending_equity != null) {
      return {
        equity: rollforward.ending_equity,
        source: 'historical_rollforward',
        asOf: rollforward.date,
        hasUsableEquity: rollforward.ending_equity > 0,
      };
    }

    // 3. Reconstructed canonical: correction-aware cash + realized P&L at asOf.
    const netCash = canonicalNetCashAt(sqlite, accountId, asOfTimestamp);
    const realized = computeRealizedPnLFromClosedTrades(closedTradesAt(sqlite, accountId, asOfTimestamp));
    const equity = netCash + realized;
    return {
      equity,
      source: 'reconstructed_canonical',
      asOf: asOfTimestamp,
      hasUsableEquity: equity > 0,
    };
  }

  // 4. Legacy compatibility — only for accounts with NO canonical funding
  //    history (no non-trade financial events).
  const hasLegacyTransactions = Boolean(
    sqlite
      .prepare('SELECT 1 FROM account_transactions WHERE account_id = ? LIMIT 1')
      .get(accountId),
  );
  const hasLegacyData =
    account.startingBalance != null || hasLegacyTransactions;
  if (hasLegacyData) {
    const txns = sqlite
      .prepare(
        `SELECT type, amount, date FROM account_transactions
         WHERE account_id = ? AND date <= ?`,
      )
      .all(accountId, asOfTimestamp.slice(0, 10)) as Array<{
      type: string;
      amount: number;
      date: string;
    }>;
    const deposits = txns
      .filter((t) => t.type === 'deposit')
      .reduce((sum, t) => sum + t.amount, 0);
    const withdrawals = txns
      .filter((t) => t.type === 'withdrawal')
      .reduce((sum, t) => sum + t.amount, 0);
    const realized = computeRealizedPnLFromClosedTrades(closedTradesAt(sqlite, accountId, asOfTimestamp));
    const settingsRow = sqlite
      .prepare("SELECT starting_account_value FROM settings WHERE id = 'default'")
      .get() as { starting_account_value: number | null } | undefined;
    const equity = computeEquityAtOpen({
      startingBalance: account.startingBalance ?? 0,
      deposits,
      withdrawals,
      realizedPnL: realized,
      hasNoAccountData: account.startingBalance == null && txns.length === 0,
      fallbackValue: settingsRow?.starting_account_value ?? null,
    });
    return {
      equity,
      source: 'legacy_compatibility',
      asOf: asOfTimestamp,
      hasUsableEquity: equity != null && equity > 0,
    };
  }

  // 5. No canonical evidence and no legacy evidence.
  return unavailable();
}
