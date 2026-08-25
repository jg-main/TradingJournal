/**
 * Fix 5 — Trade Detail account reconciliation (hook-level coverage).
 *
 * A. Same account: global A + trade A → setAccountId never called.
 * B. Initial mismatch: global A + trade B → setAccountId(B), detail renders.
 * C. No trade loaded (404) → no adoption.
 * D. Failed fetch (no trade) → no adoption.
 * E. After settlement, user selects A → onDivergence fires, account not forced back.
 * F. Refetch of a settled trade → no repeated adoption.
 *
 * Run: npx vitest run src/lib/__tests__/use-trade-detail-account-reconciliation.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { useTradeDetailAccountReconciliation } from '../use-trade-detail-account-reconciliation';

function renderRecon(init: {
  trade?: { accountId: string | null } | null;
  globalAccountId?: string;
} = {}) {
  const setAccountId = vi.fn();
  const onDivergence = vi.fn();
  const { result, rerender } = renderHook(
    ({ trade, globalAccountId }: { trade: { accountId: string | null } | null; globalAccountId: string }) =>
      useTradeDetailAccountReconciliation({ trade, globalAccountId, setAccountId, onDivergence }),
    {
      initialProps: {
        trade: init.trade ?? null,
        globalAccountId: init.globalAccountId ?? 'acc-A',
      },
    },
  );
  return { result, rerender, setAccountId, onDivergence };
}

describe('useTradeDetailAccountReconciliation (Fix 5)', () => {
  it('A. same account: global A + trade A → no account mutation', () => {
    const { result, setAccountId } = renderRecon();
    act(() => {
      result.current.adoptTradeAccount('acc-A');
    });
    expect(setAccountId).not.toHaveBeenCalled();
  });

  it('B. initial mismatch: global A + trade B → adopts B', () => {
    const { result, setAccountId } = renderRecon();
    act(() => {
      result.current.adoptTradeAccount('acc-B');
    });
    expect(setAccountId).toHaveBeenCalledWith('acc-B');
  });

  it('C. no trade loaded (404) → no adoption, no divergence', () => {
    const { result, setAccountId, onDivergence } = renderRecon();
    // adoptTradeAccount is only ever called after a successful fetch; with no
    // trade there is nothing to adopt, and no settled relationship exists.
    act(() => {
      result.current.adoptTradeAccount(null);
    });
    expect(setAccountId).not.toHaveBeenCalled();
    expect(onDivergence).not.toHaveBeenCalled();
  });

  it('D. failed fetch → no adoption', () => {
    const { result, setAccountId } = renderRecon();
    act(() => {
      result.current.adoptTradeAccount(undefined);
    });
    expect(setAccountId).not.toHaveBeenCalled();
  });

  it('B→E. mismatch settles, then a deliberate global A change navigates away without forcing back', () => {
    const { result, rerender, setAccountId, onDivergence } = renderRecon();
    // Load trade B while global A → adopt B.
    act(() => {
      result.current.adoptTradeAccount('acc-B');
    });
    expect(setAccountId).toHaveBeenCalledWith('acc-B');

    // Provider reflects B → relationship settles (trade B, global B).
    rerender({ trade: { accountId: 'acc-B' }, globalAccountId: 'acc-B' });

    // User deliberately changes the sidebar back to A.
    rerender({ trade: { accountId: 'acc-B' }, globalAccountId: 'acc-A' });
    expect(onDivergence).toHaveBeenCalledTimes(1);
    // The selection is preserved — setAccountId was NOT called again (no force-back).
    expect(setAccountId).toHaveBeenCalledTimes(1);
  });

  it('F. refetch of a settled trade does not re-adopt', () => {
    const { result, rerender, setAccountId, onDivergence } = renderRecon();
    act(() => {
      result.current.adoptTradeAccount('acc-B');
    });
    expect(setAccountId).toHaveBeenCalledTimes(1);

    // Settle.
    rerender({ trade: { accountId: 'acc-B' }, globalAccountId: 'acc-B' });

    // Refetch of the same trade while already reconciled → no re-adoption.
    act(() => {
      result.current.adoptTradeAccount('acc-B');
    });
    expect(setAccountId).toHaveBeenCalledTimes(1);

    // Agreement persists across the refetch (no divergence on global B).
    rerender({ trade: { accountId: 'acc-B' }, globalAccountId: 'acc-B' });
    expect(onDivergence).not.toHaveBeenCalled();
  });

  it('no ping-pong: adoption in flight is never mistaken for a user switch', () => {
    const { result, rerender, onDivergence } = renderRecon();
    // Trade B loads while global A → adopt. owningAccountRef is NOT yet set
    // (agreement effect requires global === trade.accountId).
    act(() => {
      result.current.adoptTradeAccount('acc-B');
    });
    // Render with trade B but global STILL A (provider hasn't reflected yet) —
    // must NOT navigate (this is adoption, not a user switch).
    rerender({ trade: { accountId: 'acc-B' }, globalAccountId: 'acc-A' });
    expect(onDivergence).not.toHaveBeenCalled();

    // Now the provider reflects B → settle.
    rerender({ trade: { accountId: 'acc-B' }, globalAccountId: 'acc-B' });
    expect(onDivergence).not.toHaveBeenCalled();
  });
});
