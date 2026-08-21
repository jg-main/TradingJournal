'use client';

import { useCallback, useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AccountDetailHeader } from '@/components/accounting/account-detail-header';
import { AccountDetailNav } from '@/components/accounting/account-detail-nav';
import { ACCOUNT_CHANGED_EVENT } from '@/lib/account-context';

/**
 * Minimal account identity used by the layout shell.
 */
interface AccountBasic {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
}

/**
 * Account detail layout providing the shared workspace shell.
 *
 * Fetches the account identity for the header and renders:
 * - Back link to /accounts
 * - Account header (name, broker, currency, status badge)
 * - Workspace tab navigation (Overview, Ledger, Positions, Settings)
 * - Active tab content from the child route
 *
 * Loading, not-found, and error states are handled within this layout.
 */
export default function AccountDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [account, setAccount] = useState<AccountBasic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${id}`);

      if (!res.ok) {
        setError('Account not found.');
        return;
      }

      const data = await res.json();
      setAccount({
        id: data.id,
        name: data.name,
        broker: data.broker ?? null,
        currency: data.currency,
        isActive: data.isActive,
      });
    } catch {
      setError('Failed to load account.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial identity fetch on mount. The async loader updates loading/error
  // state after the request resolves.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAccount();
  }, [loadAccount]);

  // Re-fetch identity when the account is initialized in place (e.g. "Start
  // with zero" activates the account) so the header status badge stays
  // accurate without a navigation.
  useEffect(() => {
    function handleAccountChanged(event: Event) {
      const detail = (event as CustomEvent<{ accountId?: string }>).detail;
      if (detail?.accountId && detail.accountId !== id) return;
      void loadAccount();
    }
    window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged);
  }, [id, loadAccount]);

  // ── Loading state ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Loading account...</p>
      </div>
    );
  }

  // ── Error / not-found state ────────────────────────────────────────
  if (!account || error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <Link
          href="/settings/accounts"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Accounts
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
          <p className="text-sm text-destructive">
            {error ?? 'Account not found.'}
          </p>
        </div>
      </div>
    );
  }

  // ── Loaded shell ───────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Back link */}
      <Link
        href="/settings/accounts"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Accounts
      </Link>

      {/* Account header */}
      <AccountDetailHeader
        name={account.name}
        broker={account.broker}
        currency={account.currency}
        isActive={account.isActive}
      />

      {/* Workspace tab navigation */}
      <AccountDetailNav accountId={id} />

      {/* Active tab content */}
      {children}
    </div>
  );
}
