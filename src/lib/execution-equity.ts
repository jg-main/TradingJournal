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
 *   reconstructed_canonical  canonical net cash at asOf ONLY when no prior
 *                            canonical trade-execution activity exists
 *   legacy_compatibility     explicit legacy startingBalance/accountTransactions
 *   unavailable              no canonical or legacy evidence, OR historical
 *                            trade activity with no trusted as-of valuation
 *
 * A2.1 invariant: reconstructed_canonical NEVER adds journal-derived realized
 * P&L to net cash. Canonical trade-execution financial events already embed
 * the full economic consideration of every fill (cash in for sells/shorts,
 * cash out for buys/covers), so a flat account's NAV equals its net cash
 * exactly. Adding journal realized P&L on top would count each execution's
 * economic effect twice. When trade activity exists at/before asOf, a safe
 * historical marked valuation (cash + open positions) is not provable from
 * available canonical state, so the resolver returns unavailable rather than
 * fabricate equity (A2 false-precision rule).
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
import { validateDecimal } from '@/lib/accounting/decimal';
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

/**
 * Journal trades closed at/before asOf.
 *
 * LEGACY-PATH ONLY (A2.1): used solely by the explicit legacy_compatibility
 * branch below, which preserves the pre-M006 computeEquityAtOpen contract
 * (startingBalance + accountTransactions + journal realized P&L). The
 * canonical reconstructed_canonical branch NEVER uses journal P&L — canonical
 * execution financial events already encode the economic proceeds.
 */
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
 * Detect canonical trade-execution activity at/before asOf.
 *
 * A2.1 economic criterion: a canonical financial_event with
 * event_type = 'trade_execution' posted at/before asOf. Journal
 * trades/trade_executions rows are attribution/workflow records — they are
 * NOT the economic criterion, and journal status is never inspected.
 * Reversal/replacement events from the correction kernel also carry
 * event_type = 'trade_execution', so corrected executions count as activity
 * at their posted (effective) timestamps.
 */
function hasCanonicalTradeActivityAt(
  sqlite: Database.Database,
  accountId: string,
  asOf: string,
): boolean {
  return Boolean(
    sqlite
      .prepare(
        `SELECT 1 FROM financial_events
         WHERE account_id = ? AND event_type = 'trade_execution' AND posted_at <= ?
         LIMIT 1`,
      )
      .get(accountId, asOf),
  );
}

/**
 * Determine whether the account's current account_performance projection is a
 * COMPLETE marked valuation — the trust boundary for accepting its NAV as
 * current execution equity.
 *
 * A projection is complete for execution-risk purposes only when every open
 * (nonzero-quantity) position carries a persisted valuation mark. Unmarked
 * open positions contribute zero to the projection's marked_positions, so the
 * persisted NAV degrades to cash-only: that UNDERSTATES long equity and
 * OVERSTATES short equity (the short case can weaken max-risk enforcement).
 * A flat/closed position (signed quantity "0.00", direction null) never makes
 * a projection incomplete, and a cash-only account with no open positions
 * remains a valid complete projection.
 *
 * The completeness signal is STRUCTURAL (positions_json), never presentation
 * text: each serialized ValuationPosition exposes markStatus and markedValue
 * directly. Malformed projection data fails closed (treated as incomplete).
 *
 * @param sqlite    - Raw better-sqlite3 handle.
 * @param accountId - The account whose projection is being assessed.
 */
function projectionIsCompleteForExecution(
  sqlite: Database.Database,
  accountId: string,
): boolean {
  const row = sqlite
    .prepare('SELECT positions_json FROM account_performance WHERE account_id = ?')
    .get(accountId) as { positions_json: string } | undefined;
  if (!row) return false;

  let positions: unknown;
  try {
    positions = JSON.parse(row.positions_json);
  } catch {
    return false;
  }
  if (!Array.isArray(positions)) return false;

  for (const position of positions) {
    // Each member must be a non-null ordinary object (never an array or other
    // JSON value) exposing the structured completeness fields.
    if (typeof position !== 'object' || position === null || Array.isArray(position)) {
      return false;
    }
    const p = position as Record<string, unknown>;

    // quantity must be a PERSISTED canonical decimal STRING (never a JS
    // number/boolean/array/object or malformed text). Strict non-coercive
    // validation: Number(...) alone must never qualify a value.
    const quantity = p.quantity;
    if (typeof quantity !== 'string' || !validateDecimal(quantity).valid) return false;
    const signedQuantity = Number(quantity);
    if (!Number.isFinite(signedQuantity)) return false;

    // Flat/closed positions never invalidate a projection.
    if (signedQuantity === 0) continue;

    // Open positions must carry a real persisted valuation mark. markStatus
    // must be EXACTLY 'fresh' or 'stale' (stale policy unchanged); 'missing',
    // absent, null, or any unknown value fails closed.
    const markStatus = p.markStatus;
    if (markStatus !== 'fresh' && markStatus !== 'stale') return false;

    // markedValue must be a PERSISTED canonical decimal STRING — never null,
    // boolean, array, object, empty/whitespace, NaN, Infinity, or malformed
    // numeric text. Long may be positive, short negative, zero valid.
    const markedValue = p.markedValue;
    if (typeof markedValue !== 'string' || !validateDecimal(markedValue).valid) return false;
  }

  return true;
}

/**
 * Resolve the canonical execution equity context for an account at asOf.
 *
 * Precedence (A2 binding contract):
 *
 *   1. current_projection       — account_performance.nav when the projection
 *                                 is at least as fresh as the execution
 *                                 (asOf >= computed_as_of) AND is a COMPLETE
 *                                 marked valuation of every open position
 *                                 (projectionIsCompleteForExecution). An
 *                                 incomplete projection (unmarked open
 *                                 position) is never usable as execution
 *                                 equity: its cash-only NAV understates long
 *                                 equity and overstates short equity. It falls
 *                                 through the canonical precedence instead.
 *                                 nav '0.00' → 0.
 *   2. historical_rollforward   — latest account_rollforward row with
 *                                 date <= asOf (bounded, never "latest row
 *                                 overall").
 *   3. reconstructed_canonical  — canonical net cash at asOf ONLY when there is
 *                                 NO prior canonical trade-execution activity
 *                                 at/before asOf (financial_event
 *                                 event_type = 'trade_execution'). Canonical
 *                                 execution cash flows already embed the full
 *                                 economic consideration of every fill, so for
 *                                 a cash-only account NAV = net cash exactly.
 *                                 NEVER adds journal-derived realized P&L (A2.1
 *                                 double-count fix). With prior trade activity
 *                                 and no trusted historical rollforward/
 *                                 projection, historical marked equity is not
 *                                 provable → unavailable.
 *   4. legacy_compatibility     — ONLY when no canonical evidence exists AND
 *                                 the account has legacy rows
 *                                 (startingBalance/accountTransactions). The
 *                                 legacy computeEquityAtOpen contract (incl.
 *                                 the documented settings.startingAccountValue
 *                                 fallback) applies here and only here.
 *   5. unavailable              — no canonical evidence and no legacy evidence,
 *                                 or historical trade activity with no trusted
 *                                 as-of valuation.
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
      // 1. Current projection is pre-fill evidence ONLY when it is a complete
      //    marked valuation. An unmarked open position makes the persisted
      //    NAV cash-only (marked_positions = 0): valid as a reporting NAV, but
      //    never as execution-risk equity — long NAV is understated and short
      //    NAV is overstated. Incomplete projections fall through the rest of
      //    the canonical precedence rather than being trusted.
      if (projectionIsCompleteForExecution(sqlite, accountId)) {
        // Parse even '0.00' → 0.
        const nav = Number.parseFloat(projection.nav);
        const equity = Number.isFinite(nav) ? nav : null;
        return {
          equity,
          source: 'current_projection',
          asOf: projection.computed_as_of,
          hasUsableEquity: equity != null && equity > 0,
        };
      }
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

    // 3. Reconstructed canonical: canonical net cash at asOf, ONLY when there
    //    is NO prior canonical trade-execution activity at/before asOf.
    //
    //    Canonical execution financial events (event_type = 'trade_execution')
    //    already embed the full economic consideration of each fill (cash in
    //    for sells/shorts, cash out for buys/covers), so a cash-only account's
    //    equity equals its net cash exactly. Adding journal-derived realized
    //    P&L on top would count each execution's economic effect twice (A2.1).
    //    When trade activity exists and no trusted historical rollforward/
    //    projection is available, a safe historical marked valuation
    //    (cash + open positions) is not provable from canonical state →
    //    unavailable (false precision is worse than unavailable risk).
    if (hasCanonicalTradeActivityAt(sqlite, accountId, asOfTimestamp)) {
      return unavailable();
    }
    const equity = canonicalNetCashAt(sqlite, accountId, asOfTimestamp);
    return {
      equity,
      source: 'reconstructed_canonical',
      asOf: asOfTimestamp,
      hasUsableEquity: equity > 0,
    };
  }

  // 4. Legacy compatibility — only for accounts with NO canonical funding
  //    history (no non-trade financial events). The pre-M006 contract
  //    (startingBalance + accountTransactions + journal realized P&L +
  //    settings fallback) is preserved here and ONLY here (A2/A2.1: the
  //    canonical reconstructed branch never adds journal P&L).
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
