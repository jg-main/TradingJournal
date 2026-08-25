'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

import PlanTradeForm from '@/components/plan-trade-form';
import type { Account, SetupDefinition } from '@/components/plan-trade-form';
import { EmptyState } from '@/components/empty-state';

export default function NewTradePage() {
  const router = useRouter();

  useEffect(() => {
    document.title = 'Plan Trade — Trading Journal';
  }, []);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [setups, setSetups] = useState<SetupDefinition[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [accountsRes, setupsRes, settingsRes] = await Promise.all([
          fetch('/api/accounts'),
          fetch('/api/setup-definitions'),
          fetch('/api/settings'),
        ]);

        if (cancelled) return;

        if (!accountsRes.ok || !setupsRes.ok) {
          setError('Failed to load form data. Please try again.');
          return;
        }

        const accountsData: Account[] = await accountsRes.json();
        const setupsData = await setupsRes.json();
        const settingsData = await settingsRes.json();

        setAccounts(Array.isArray(accountsData) ? accountsData : []);
        setSetups(Array.isArray(setupsData.data) ? setupsData.data : []);

        // Resolve default account ID
        let defaultId: string | null = null;
        if (settingsData?.defaultAccountId) {
          defaultId = settingsData.defaultAccountId;
        } else {
          const firstActive = (Array.isArray(accountsData) ? accountsData : []).find(
            (a: Account) => a.isActive
          );
          if (firstActive) defaultId = firstActive.id;
        }
        setDefaultAccountId(defaultId);
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

  const handleSuccess = (tradeId: string) => {
    router.push(`/trades/${tradeId}`);
  };

  const handleCancel = () => {
    router.push('/trades');
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-8 py-20">
        <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading form data...</p>
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
        accounts={accounts}
        setups={setups}
        defaultAccountId={defaultAccountId}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  );
}
