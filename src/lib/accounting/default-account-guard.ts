/**
 * Default-account eligibility guard (A8).
 *
 * Enforces the default-account invariant: `settings.defaultAccountId` must
 * reference an existing, ACTIVE, supported-currency account (currently USD).
 * A default is an account preference — it does NOT require full Trading
 * Workflow readiness (risk params, commission, opening cash, position state).
 *
 * Invalid references:
 *   - missing account            → AccountNotFoundError (HTTP 404)
 *   - inactive (draft/deactivated) → AccountInactiveError (HTTP 409, ACCOUNT_INACTIVE)
 *   - legacy non-USD currency    → UnsupportedAccountCurrencyError (HTTP 400)
 *
 * Eligibility is derived — no persistent `isDefaultEligible` / `tradingReady`
 * flag is introduced.
 */

import Database from 'better-sqlite3';
import {
  AccountNotFoundError,
  AccountInactiveError,
  UnsupportedAccountCurrencyError,
} from './errors';
import { isSupportedAccountCurrency, UNSUPPORTED_CURRENCY_GUIDANCE } from './currency-contract';

/**
 * Verify an account may be referenced as the saved default.
 *
 * @throws {AccountNotFoundError}            Account does not exist.
 * @throws {AccountInactiveError}            Account is a draft or deactivated.
 * @throws {UnsupportedAccountCurrencyError} Legacy non-USD account (USD-only contract).
 * @returns The account's persisted currency (always supported when no error).
 */
export function assertAccountEligibleAsDefault(
  sqlite: Database.Database,
  accountId: string,
): void {
  const row = sqlite
    .prepare('SELECT is_active, currency FROM accounts WHERE id = ?')
    .get(accountId) as { is_active: number | null; currency: string | null } | undefined;
  if (!row) {
    throw new AccountNotFoundError(accountId);
  }
  if (row.is_active !== 1) {
    throw new AccountInactiveError(accountId);
  }
  const currency = row.currency ?? 'USD';
  if (!isSupportedAccountCurrency(currency)) {
    throw new UnsupportedAccountCurrencyError(accountId, currency, UNSUPPORTED_CURRENCY_GUIDANCE);
  }
}

/**
 * Lightweight read-only check whether a saved default reference is usable
 * (exists, active, supported currency). Used by automatic account-resolution
 * consumers (trade creation, dashboard v2) so a stale historical default is
 * ignored and falls through to the eligible-account chain — WITHOUT mutating
 * settings during a read.
 */
export function isAccountEligibleAsDefault(
  sqlite: Database.Database,
  accountId: string,
): boolean {
  const row = sqlite
    .prepare('SELECT is_active, currency FROM accounts WHERE id = ?')
    .get(accountId) as { is_active: number | null; currency: string | null } | undefined;
  if (!row) return false;
  if (row.is_active !== 1) return false;
  return isSupportedAccountCurrency(row.currency ?? 'USD');
}
