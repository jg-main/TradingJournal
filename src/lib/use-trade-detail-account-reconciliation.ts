'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Fix 5 — Trade Detail account reconciliation.
 *
 * A specific trade detail is authoritative about which account owns that
 * trade. Opening `/trades/:id` reconciles the global AccountProvider
 * selection to the persisted trade's account (adoption), and after that
 * relationship is settled, a deliberate sidebar change navigates back to the
 * Trades workspace (preserving the user's explicit choice — the selector is
 * never forced back).
 *
 * State machine (no ping-pong loops):
 * - trade not loaded → nothing happens.
 * - trade loaded with account B (adoptTradeAccount called) → if the global
 *   selection differs, setAccountId(B); the agreement effect marks the
 *   relationship settled once the provider reflects B.
 * - AFTER settled: if the global selection changes away from B, onDivergence()
 *   fires (page navigates to /trades). Adoption in flight is never mistaken
 *   for a user switch because owningAccountRef is only set on agreement.
 * - Refetches of a settled trade never re-adopt (owningAccountRef guard).
 */
export function useTradeDetailAccountReconciliation(opts: {
  /** The currently loaded trade (null until the first successful fetch). */
  trade: { accountId: string | null } | null;
  /** Current global AccountProvider selection. */
  globalAccountId: string;
  /** AccountProvider setAccountId — persisted under the canonical app:account key. */
  setAccountId: (id: string) => void;
  /** Fired once the settled relationship diverges (page navigates to /trades). */
  onDivergence: () => void;
}): {
  /** Call after a successful trade fetch to adopt the persisted account. */
  adoptTradeAccount: (accountId: string | null | undefined) => void;
} {
  const { trade, globalAccountId, setAccountId, onDivergence } = opts;

  // The account of the trade whose detail/account relationship has settled.
  const owningAccountRef = useRef<string | null>(null);
  // Latest global account without re-running the caller's load effect on
  // provider changes (adoption itself changes the global account).
  const latestGlobalRef = useRef(globalAccountId);
  useEffect(() => {
    latestGlobalRef.current = globalAccountId;
  }, [globalAccountId]);

  /** Adopt the persisted trade's account — no-op for settled/refetch trades. */
  const adoptTradeAccount = useCallback(
    (accountId: string | null | undefined) => {
      if (!accountId) return;
      if (
        accountId !== latestGlobalRef.current &&
        owningAccountRef.current !== accountId
      ) {
        setAccountId(accountId);
      }
    },
    [setAccountId],
  );

  // (1) Agreement: once the global selection matches the loaded trade's
  //     account, the relationship is established. Further refetches of this
  //     trade must not re-adopt.
  useEffect(() => {
    if (!trade?.accountId) return;
    if (globalAccountId === trade.accountId) {
      owningAccountRef.current = trade.accountId;
    }
  }, [trade, globalAccountId]);

  // (2) Post-reconciliation divergence: the relationship is settled AND the
  //     global selection moved away from the owning account (user action).
  //     Preserve their choice and leave the detail. Adoption in flight is
  //     excluded because owningAccountRef is only set on agreement.
  useEffect(() => {
    if (!trade?.accountId) return;
    if (owningAccountRef.current !== trade.accountId) return;
    if (globalAccountId === trade.accountId) return;
    onDivergence();
  }, [trade, globalAccountId, onDivergence]);

  return { adoptTradeAccount };
}
