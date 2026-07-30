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
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  loading: true,
  error: null,
  accountId: '',
  setAccountId: () => {},
});

const STORAGE_KEY = 'app:account';

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
 * Fetches /api/accounts once per session mount, resolves the selected
 * account from localStorage (falling back to the first active account),
 * and persists every selection change. Consumers read via useAccount();
 * no page or widget should fetch /api/accounts independently.
 */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountIdState] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    fetch('/api/accounts')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load accounts');
        return res.json() as Promise<Account[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setAccounts(data);
        setLoading(false);

        const persisted = readPersistedAccountId();
        const fallback = data.find(isActive)?.id ?? data[0]?.id ?? '';
        const resolved =
          persisted && data.some((a) => a.id === persisted) ? persisted : fallback;
        setAccountIdState(resolved);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load accounts');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setAccountId = useCallback((id: string) => {
    setAccountIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage unavailable — selection still works for the session
    }
  }, []);

  const value = useMemo<AccountContextValue>(
    () => ({ accounts, loading, error, accountId, setAccountId }),
    [accounts, loading, error, accountId, setAccountId],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────────

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
