/**
 * Canonical Account Closure (A3).
 *
 * Removes the Account Close workflow's dependency on legacy account-balance
 * sources (accounts.startingBalance, accountTransactions,
 * computeAccountBalance, computeDatesActive). Financial/account state now
 * comes EXCLUSIVELY from the canonical accounting model:
 *
 *   - account identity/lifecycle  → accounts table
 *   - opening capital / deposits / withdrawals / activity dates
 *                                → financial_events + canonical effects
 *                                  (via computeAccountActivity)
 *   - current financial state     → account_performance, freshly rebuilt
 *                                  through the canonical engine (the rebuild
 *                                  is REQUIRED and its success enforced)
 *   - trade statistics            → existing canonical/shared trade-metric
 *                                  computation (computeAccountKPIs)
 *
 * Correction-aware by construction: financial-event corrections are
 * append-only (original + reversal + replacement), so deposit/withdrawal
 * totals are derived from the canonical cash-effect DIRECTION
 * (increase/decrease) with integer-micros arithmetic — a reversal nets out
 * its original, and no correction description/ID special-casing is needed.
 *
 * The legacy schema/table is NOT deleted or rewritten here; historical
 * compatibility and schema retirement are separate concerns. Current account
 * closure simply must not depend on the legacy table.
 */

import Database from 'better-sqlite3';
import { fromMicros, toMicros } from './decimal';
import { computeAccountActivity, type ActivityEventItem } from './activity';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';
import { findAccountPerformance } from '../../db/accounting-repository';
import { AccountClosureProjectionError } from './errors';
import type { CanonicalDecimal } from './types';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Effective external-capital closure figures derived from the canonical
 * financial-event stream, correction-netted through effect directions.
 */
export interface AccountClosureCapital {
  /** Effective canonical opening balance (opening_balance event net). */
  openingBalance: CanonicalDecimal;
  /** Effective deposits (deposit events netted through corrections). */
  depositsTotal: CanonicalDecimal;
  /** Effective withdrawals magnitude (withdrawal events netted through corrections). */
  withdrawalsTotal: CanonicalDecimal;
  /** Earliest canonical event postedAt timestamp, or null when no events. */
  firstActivityAt: string | null;
}

/** Closure financials computed from a fresh canonical projection. */
export interface AccountClosureFinancials {
  accountId: string;
  /** Effective canonical opening balance (number, backward-compatible). */
  startingBalance: number;
  /** Same value under a clearer name. */
  openingBalance: number;
  depositsTotal: number;
  withdrawalsTotal: number;
  /** Canonical account-performance realized P&L. */
  realizedPnl: number;
  /** Canonical account-performance NAV. */
  finalBalance: number;
  /**
   * Simple realized return on contributed capital:
   *   contributedCapital = effectiveOpeningBalance + effectiveDeposits
   *   netReturn = realizedPnl / contributedCapital * 100
   * null when contributedCapital <= 0. Withdrawals do not become negative
   * contributions in this simple metric. This is NOT TWR / Modified Dietz /
   * total-return analytics — it is an explicit simple closure metric.
   */
  netReturn: number | null;
  /** Activity date range: earliest of account createdAt and canonical event
   *  timestamps → the closure timestamp. */
  datesActive: { from: string; to: string };
  /** Single captured closure timestamp, reused across the response. */
  closedAt: string;
  /** Canonical provenance — always ledger-derived for a current account. */
  accounting: {
    ledgerDerived: true;
    realizedPnl: string;
    nav: string;
  };
}

// ── Pure Capital Derivation (correction-aware, exact micros) ────────────

/**
 * Derive the effective external-capital figures from canonical activity.
 *
 * Pure function over `computeAccountActivity` output — no DB access, no
 * floats. Money is aggregated with integer micros; only the event's own
 * `effect.direction` decides sign, which makes reversal/replacement
 * corrections part of the same economic stream automatically:
 *
 *   deposit +2,500 (increase +2500)
 *   reversal of deposit (decrease -2500)
 *   replacement deposit +2,000 (increase +2000)
 *   → effective deposits = 2,000
 *
 * Events that are NOT external capital (dividend, interest, fee, tax,
 * manual_adjustment, trade_execution, stock_split) are excluded from
 * deposits/withdrawals totals; opening balance is reported separately.
 *
 * @param events - Canonical activity events (from computeAccountActivity).
 */
export function deriveAccountClosureCapital(
  events: ActivityEventItem[],
): AccountClosureCapital {
  let openingMicros = 0;
  let depositMicros = 0;
  let withdrawalMicros = 0;
  let firstActivityAt: string | null = null;

  for (const event of events) {
    // Dates-active: earliest canonical event timestamp (any type).
    if (firstActivityAt === null || event.postedAt < firstActivityAt) {
      firstActivityAt = event.postedAt;
    }

    const effect = event.effect;
    if (!effect || effect.kind !== 'cash' || effect.amountMicros === undefined) {
      continue;
    }
    const signedMicros =
      effect.direction === 'increase' ? effect.amountMicros : -effect.amountMicros;

    switch (event.eventType) {
      case 'opening_balance':
        openingMicros += signedMicros;
        break;
      case 'deposit':
        depositMicros += signedMicros;
        break;
      case 'withdrawal':
        // Original withdrawals are decrease effects (-magnitude); a reversal
        // is an increase effect (+magnitude) that reduces the total.
        withdrawalMicros -= signedMicros;
        break;
      default:
        // dividend / interest / fee / tax / manual_adjustment /
        // trade_execution / stock_split are NOT external capital.
        break;
    }
  }

  return {
    openingBalance: fromMicros(openingMicros),
    depositsTotal: fromMicros(depositMicros),
    withdrawalsTotal: fromMicros(withdrawalMicros),
    firstActivityAt,
  };
}

// ── Closure Financials Service ──────────────────────────────────────────

/**
 * Compute the canonical closure financials for an account.
 *
 * 1. Rebuilds the account-performance projection through the canonical
 *    engine (FRESH projection — never a possibly-stale row) and REQUIRES
 *    `success === true`. A failed rebuild throws
 *    {@link AccountClosureProjectionError} — the caller must NOT deactivate
 *    the account, so a failed close leaves the account active and retryable.
 * 2. Reads the freshly rebuilt projection for NAV / realized P&L (authoritative).
 * 3. Rebuilds canonical activity and derives correction-aware capital.
 * 4. Computes netReturn (simple realized return on contributed capital:
 *    openingBalance + deposits) and datesActive from canonical activity.
 *
 * @param sqlite    - Raw better-sqlite3 Database handle.
 * @param accountId - Target account ID.
 * @param closedAt  - Single closure timestamp (captured once by the caller)
 *                    reused for datesActive.to and the response.
 * @param accountCreatedAt - accounts.createdAt for the datesActive floor.
 * @throws {AccountClosureProjectionError} when the projection rebuild fails.
 */
export function computeAccountClosureFinancials(
  sqlite: Database.Database,
  accountId: string,
  closedAt: string,
  accountCreatedAt: string,
): AccountClosureFinancials {
  // 1. Fresh canonical rebuild, enforced.
  const rebuild = rebuildAccountPerformance(sqlite, accountId);
  if (!rebuild.success) {
    throw new AccountClosureProjectionError(accountId, rebuild.error);
  }

  // 2. Read the freshly rebuilt projection (authoritative).
  const projection = findAccountPerformance(sqlite, accountId);
  if (!projection) {
    throw new AccountClosureProjectionError(
      accountId,
      'projection row missing after a successful rebuild',
    );
  }

  const nav = projection.nav ?? '0.00';
  const realizedPnl = projection.realized_pnl ?? '0.00';

  // 3. Canonical activity → correction-aware capital.
  const activity = computeAccountActivity(sqlite, accountId);
  const capital = deriveAccountClosureCapital(activity.events);

  // 4. Simple realized return on contributed capital.
  const contributedMicros =
    toMicros(capital.openingBalance) + toMicros(capital.depositsTotal);
  const netReturn =
    contributedMicros > 0
      ? (parseFloat(realizedPnl) / (contributedMicros / 1_000_000)) * 100
      : null;

  // 5. Dates active: earliest of account creation and canonical activity.
  const from =
    capital.firstActivityAt !== null && capital.firstActivityAt < accountCreatedAt
      ? capital.firstActivityAt
      : accountCreatedAt;

  return {
    accountId,
    startingBalance: parseFloat(capital.openingBalance),
    openingBalance: parseFloat(capital.openingBalance),
    depositsTotal: parseFloat(capital.depositsTotal),
    withdrawalsTotal: parseFloat(capital.withdrawalsTotal),
    realizedPnl: parseFloat(realizedPnl),
    finalBalance: parseFloat(nav),
    netReturn,
    datesActive: { from, to: closedAt },
    closedAt,
    accounting: {
      ledgerDerived: true,
      realizedPnl,
      nav,
    },
  };
}
