'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

// ── Types ───────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean | number;
}

interface AccountContextValue {
  /** All accounts, empty until the initial fetch resolves. */
  accounts: Account[];
  /** True while the initial /api/accounts fetch is in flight. */
  loading: boolean;
  /** Error message when the initial fetch failed, else null. */
  error: string | null;
  /**
   * Selected account id. Empty string until accounts load, then the
   * persisted selection (if still valid) or the first active account.
   */
  accountId: string;
  /** Select an account; persisted to localStorage. */
  setAccountId: (id: string) => void;
  /**
   * Re-fetch /api/accounts and re-resolve the selected account. Keeps the
   * current selection when it still exists, otherwise falls back to the
   * persisted id, then the first active account. Failures surface through
   * the error state so consumers can offer a retry. Resolves when done.
   */
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  loading: true,
  error: null,
  accountId: '',
  setAccountId: () => {},
  refresh: async () => {},
});

const STORAGE_KEY = 'app:account';

/**
 * Window event dispatched after account identity-affecting changes (creation,
 * activation) so consumers that cache account identity — e.g. the account
 * detail layout header — can re-fetch without a full navigation.
 */
export const ACCOUNT_CHANGED_EVENT = 'account:changed';

function readPersistedAccountId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function isActive(account: Account): boolean {
  return account.isActive === true || account.isActive === 1;
}

// ── Provider ────────────────────────────────────────────────────────

/**
 * Single owner of global account selection (M007/D037).
 *
 * Fetches /api/accounts on mount, resolves the selected account from
 * localStorage (falling back to the first active account), and persists
 * every selection change. `refresh()` re-fetches after account creation
 * or other external changes. Consumers read via useAccount(); no page or
 * widget should fetch /api/accounts independently.
 */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountIdState] = useState<string>('');

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) throw new Error('Failed to load accounts');
      const data = (await res.json()) as Account[];
      setAccounts(data);
      setError(null);

      // Keep the current selection when it still exists; otherwise fall
      // back to the persisted id, then the first active account.
      setAccountIdState((current) => {
        const persisted = current || readPersistedAccountId();
        const fallback = data.find(isActive)?.id ?? data[0]?.id ?? '';
        return persisted && data.some((a) => a.id === persisted)
          ? persisted
          : fallback;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch once per session mount. The async loader updates
  // loading/error state after the request resolves.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAccounts();
  }, [loadAccounts]);

  const setAccountId = useCallback((id: string) => {
    setAccountIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage unavailable — selection still works for the session
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadAccounts();
  }, [loadAccounts]);

  const value = useMemo<AccountContextValue>(
    () => ({ accounts, loading, error, accountId, setAccountId, refresh }),
    [accounts, loading, error, accountId, setAccountId, refresh],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────────

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
