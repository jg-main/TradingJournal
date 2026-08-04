'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AccountDetailHeader } from '@/components/accounting/account-detail-header';
import { AccountDetailNav } from '@/components/accounting/account-detail-nav';

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

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      try {
        const res = await fetch(`/api/accounts/${id}`);

        if (!res.ok) {
          if (!cancelled) setError('Account not found.');
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setAccount({
            id: data.id,
            name: data.name,
            broker: data.broker ?? null,
            currency: data.currency,
            isActive: data.isActive,
          });
        }
      } catch {
        if (!cancelled) setError('Failed to load account.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAccount();

    return () => {
      cancelled = true;
    };
  }, [id]);

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
