/**
 * Supported account base-currency contract (USD-only).
 *
 * TradingJournal's accounting, execution, valuation, and performance
 * pipeline is effectively USD-only: the canonical posting kernel writes
 * ledger postings with `currency = 'USD'`, and trade instruments,
 * execution prices, marks, realized P&L, NAV, and performance assume a
 * single base currency without FX semantics.
 *
 * Until an explicit multi-currency accounting/FX milestone lands, the
 * product contract is:
 *
 *   Supported account base currency = USD only.
 *
 * UI and API both consume this contract. Non-USD accounts that predate
 * this contract remain readable (their historical rows are never rewritten
 * or converted), but new financially meaningful posting/activity on them is
 * blocked by the posting-kernel guard (see UnsupportedAccountCurrencyError
 * and assertSupportedAccountCurrency).
 */

import { z } from 'zod';

/** The exhaustive set of supported account base currencies. */
export const SUPPORTED_ACCOUNT_CURRENCIES = ['USD'] as const;

/** The default (and only supported) account base currency. */
export const DEFAULT_ACCOUNT_CURRENCY = 'USD' as const;

/** Zod schema: accepts only the supported currencies (USD today). */
export const accountCurrencySchema = z
  .literal(DEFAULT_ACCOUNT_CURRENCY)
  .default(DEFAULT_ACCOUNT_CURRENCY);

/** Narrow a raw currency string to a supported currency, or null. */
export function isSupportedAccountCurrency(value: unknown): value is (typeof SUPPORTED_ACCOUNT_CURRENCIES)[number] {
  return (
    typeof value === 'string' &&
    (SUPPORTED_ACCOUNT_CURRENCIES as readonly string[]).includes(value)
  );
}

/**
 * Human-readable explanation of the current support boundary, reused by UI
 * helper copy and API error messages so they never disagree.
 */
export const UNSUPPORTED_CURRENCY_GUIDANCE =
  'This installation currently supports USD account accounting only.';

/** Error message used when a legacy non-USD account blocks new activity. */
export function unsupportedCurrencyMessage(currency: string): string {
  return `Unsupported account currency "${currency}". ${UNSUPPORTED_CURRENCY_GUIDANCE}`;
}
