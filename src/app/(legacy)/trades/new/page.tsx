'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

import PlanTradeForm from '@/components/plan-trade-form';
import type { Account, SetupDefinition } from '@/components/plan-trade-form';
import { EmptyState } from '@/components/empty-state';
import { useAccount } from '@/lib/account-context';

export default function NewTradePage() {
  const router = useRouter();

  useEffect(() => {
    document.title = 'Plan Trade — Trading Journal';
  }, []);

  const [setups, setSetups] = useState<SetupDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Canonical account scope (M007/D037): the sidebar AccountProvider owns
  // the account list and the current selection. The form's Account options
  // come from the provider and the initial selection is the CURRENT global
  // account — NOT settings.defaultAccountId (the server keeps that for its
  // automatic planning-account fallback).
  const { accounts, accountId, loading: accountsLoading, error: accountsError, setAccountId } = useAccount();

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const setupsRes = await fetch('/api/setup-definitions');
        if (cancelled) return;
        if (!setupsRes.ok) {
          setError('Failed to load form data. Please try again.');
          return;
        }
        const setupsData = await setupsRes.json();
        setSetups(Array.isArray(setupsData.data) ? setupsData.data : []);
      } catch (err) {
        if (!cancelled) {
          setError(String(err instanceof Error ? err.message : 'Failed to load form data.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSuccess = (result: { id: string; accountId: string }) => {
    // The persisted trade is the source of truth. When it belongs to a
    // different account than the current global selection, adopt that
    // account so the sidebar scope matches the trade we just created.
    if (result.accountId && result.accountId !== accountId) {
      setAccountId(result.accountId);
    }
    router.push(`/trades/${result.id}`);
  };

  const handleCancel = () => {
    router.push('/trades');
  };

  if (loading || accountsLoading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-8 py-20">
        <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading form data...</p>
      </div>
    );
  }

  if (accountsError) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <EmptyState
          icon={<AlertCircle className="size-12 text-muted-foreground" strokeWidth={1} />}
          title="Accounts unavailable"
          description={accountsError}
          action={
            <Link
              href="/trades"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
            >
              <ArrowLeft className="size-4" />
              Back to Trades
            </Link>
          }
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <Link
          href="/trades"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Trades
        </Link>
        <EmptyState
          icon={<AlertCircle className="size-12 text-muted-foreground" strokeWidth={1} />}
          title="Error"
          description={error}
          action={
            <Link
              href="/trades"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
            >
              <ArrowLeft className="size-4" />
              Back to Trades
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link
        href="/trades"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Trades
      </Link>

      <p className="mb-6 text-sm text-muted-foreground">
        Set the ticker, direction, account, setup, and planned price levels. Saving creates a Planned trade that you can edit until the first execution.
      </p>

      <PlanTradeForm
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          broker: a.broker,
          currency: a.currency,
          isActive: Boolean(a.isActive),
          // The form only displays id/name/broker for selection; the
          // execution-grade fields are server-owned.
          maxRiskPerTradePct: null,
          defaultCommission: null,
          startingBalance: null,
        }))}
        setups={setups}
        defaultAccountId={accountId || null}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  );
}
