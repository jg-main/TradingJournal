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
        <Loader2 className="mr-2 size-5 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500">Loading form data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <Link
          href="/trades"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          Back to Trade Log
        </Link>
        <EmptyState
          icon={<AlertCircle className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title="Error"
          description={error}
          action={
            <Link
              href="/trades"
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <ArrowLeft className="size-4" />
              Back to Trade Log
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
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Trade Log
      </Link>

      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Set the ticker, direction, account, setup, and planned price levels.
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
