/**
 * New-activity lifecycle guard (A6).
 *
 * Enforces the account lifecycle invariant that an inactive account cannot
 * originate NEW financial or execution activity, while remaining historically
 * readable. Reactivation is the explicit boundary that restores permission.
 *
 * State model (preserving the existing isActive architecture):
 *   - pristine draft       isActive=false + no history → initialization only
 *   - active               isActive=true  → normal activity
 *   - historical inactive  isActive=false + history   → read-only for new
 *                                                        activity (historical
 *                                                        corrections remain
 *                                                        immutable-correction
 *                                                        operations)
 *
 * The guard is placed on NEW-ACTIVITY domain entry points (the normal
 * financial-event posting service and the execution-fill service), NOT on the
 * low-level posting kernel — the kernel is legitimately reused by account
 * initialization (which must operate on a pristine inactive account) and by
 * financial-event correction (which must operate on inactive accounts without
 * pretending the account resumed trading).
 */

import Database from 'better-sqlite3';
import { AccountNotFoundError, AccountInactiveError } from './errors';

/**
 * Verify an account exists and is active before new activity.
 *
 * @throws {AccountNotFoundError} when the account does not exist.
 * @throws {AccountInactiveError} when the account is inactive (draft or
 *         deactivated) — new financial/execution activity is not permitted.
 *         Active accounts return normally.
 */
export function assertAccountAcceptsNewActivity(
  sqlite: Database.Database,
  accountId: string,
): void {
  const row = sqlite
    .prepare('SELECT is_active FROM accounts WHERE id = ?')
    .get(accountId) as { is_active: number | null } | undefined;
  if (!row) {
    throw new AccountNotFoundError(accountId);
  }
  if (row.is_active !== 1) {
    throw new AccountInactiveError(accountId);
  }
}
