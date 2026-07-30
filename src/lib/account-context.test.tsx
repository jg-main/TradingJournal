/**
 * Tests for the AccountProvider / useAccount global account context (M007 S02).
 *
 * Covers: default first-active-account resolution, persisted-id restore,
 * invalid persisted id fallback, setAccountId persistence, fetch error state,
 * and single-fetch behavior.
 *
 * Run: npx vitest run src/lib/account-context.test.tsx
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';
import { AccountProvider, useAccount, type Account } from './account-context';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const mockAccounts: Account[] = [
  { id: 'acc-inactive', name: 'Old', broker: null, currency: 'USD', isActive: false },
  { id: 'acc-1', name: 'Main Account', broker: 'IBKR', currency: 'USD', isActive: true },
  { id: 'acc-2', name: 'Taxable', broker: 'SCHWAB', currency: 'USD', isActive: 1 },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mockFetchAccounts(accounts: Account[]) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(accounts),
  } as Response);
}

async function flushFetch() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Probe component that exposes context values to assertions. */
function Probe() {
  const { accounts, loading, error, accountId, setAccountId } = useAccount();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="account-id">{accountId}</span>
      <span data-testid="count">{accounts.length}</span>
      <button data-testid="select-acc-2" onClick={() => setAccountId('acc-2')} />
    </div>
  );
}

function renderProvider() {
  return render(
    <AccountProvider>
      <Probe />
    </AccountProvider>,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('AccountProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('fetches accounts once and defaults to the first active account', async () => {
    const fetchSpy = mockFetchAccounts(mockAccounts);
    renderProvider();
    await flushFetch();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/accounts');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('count').textContent).toBe('3');
    // acc-inactive is inactive; first active is acc-1
    expect(screen.getByTestId('account-id').textContent).toBe('acc-1');
  });

  it('restores a valid persisted account id', async () => {
    localStorage.setItem('app:account', 'acc-2');
    mockFetchAccounts(mockAccounts);
    renderProvider();
    await flushFetch();

    expect(screen.getByTestId('account-id').textContent).toBe('acc-2');
  });

  it('falls back to first active account when the persisted id no longer exists', async () => {
    localStorage.setItem('app:account', 'acc-deleted');
    mockFetchAccounts(mockAccounts);
    renderProvider();
    await flushFetch();

    expect(screen.getByTestId('account-id').textContent).toBe('acc-1');
  });

  it('persists selection changes to localStorage', async () => {
    mockFetchAccounts(mockAccounts);
    renderProvider();
    await flushFetch();

    act(() => {
      screen.getByTestId('select-acc-2').click();
    });

    expect(screen.getByTestId('account-id').textContent).toBe('acc-2');
    expect(localStorage.getItem('app:account')).toBe('acc-2');
  });

  it('surfaces an error state when the fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    renderProvider();
    await flushFetch();

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('Network error');
    expect(screen.getByTestId('account-id').textContent).toBe('');
  });

  it('handles a non-ok response as an error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    renderProvider();
    await flushFetch();

    expect(screen.getByTestId('error').textContent).toBe('Failed to load accounts');
  });

  it('resolves to empty id when there are no accounts', async () => {
    mockFetchAccounts([]);
    renderProvider();
    await flushFetch();

    expect(screen.getByTestId('account-id').textContent).toBe('');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});
