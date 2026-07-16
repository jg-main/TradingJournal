'use client';

import { useEffect, useState, use } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import AccountActivity from '@/components/accounting/account-activity';
import AccountPerformance from '@/components/accounting/account-performance';
import AccountValuationForm from '@/components/accounting/account-valuation-form';

interface AccountDetail {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  startingBalance: number | null;
  currentBalance: number;
  netDeposits: number;
  kpis?: {
    netPnl: number;
    tradeCount: number;
    winRate: number | null;
    avgR: number | null;
    avgGrade: number | null;
  };
}

function getNetPnl(account: AccountDetail): number {
  // Account KPI is embedded in a nested kpis object from the API
  return account.kpis?.netPnl ?? 0;
}

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [performanceRefreshKey, setPerformanceRefreshKey] = useState(0);

  const fetchAccount = async () => {
    try {
      const acctRes = await fetch(`/api/accounts/${id}`);

      if (!acctRes.ok) {
        setMessage({ type: 'error', text: 'Account not found.' });
        setLoading(false);
        return;
      }

      const acctData = await acctRes.json();
      setAccount(acctData);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load account data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // The async loader updates loading/error state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleMarkSubmitted = () => {
    // Trigger a performance refresh after a mark is posted
    setPerformanceRefreshKey((k) => k + 1);
  };

  const formatCurrency = (v: number) => {
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading account details...</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link href="/accounts" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          <ArrowLeft className="size-4" />
          Back to Accounts
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-400">Account not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Back link */}
      <Link
        href="/accounts"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Accounts
      </Link>

      {/* Account header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {account.name}
        </h1>
        <div className="mt-2 flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-300">
          {account.broker && <span>{account.broker}</span>}
          <span>{account.currency}</span>
        </div>
      </div>

      {/* Balance card */}
      <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Current Balance</p>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${
          account.currentBalance >= 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-red-600 dark:text-red-400'
        }`}>
          ${formatCurrency(account.currentBalance)}
        </p>
        <div className="mt-3 flex gap-6 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Net P&amp;L: <span className={getNetPnl(account) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
            {getNetPnl(account) >= 0 ? '+' : ''}${formatCurrency(getNetPnl(account))}
          </span></span>
        </div>
      </div>

      {/* Error message */}
      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Payoff summary */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Starting Balance</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            ${formatCurrency(account.startingBalance ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Net Deposits</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${
            account.netDeposits >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}>
            ${formatCurrency(account.netDeposits)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Net P&amp;L</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${
            getNetPnl(account) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {getNetPnl(account) >= 0 ? '+' : ''}${formatCurrency(getNetPnl(account))}
          </p>
        </div>
      </div>

      {/* Accounting Performance & Valuation section */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
            Valuation &amp; Performance
          </h2>
          <AccountValuationForm accountId={id} onMarkSubmitted={handleMarkSubmitted} />
        </div>
        <AccountPerformance
          key={`perf-${performanceRefreshKey}`}
          accountId={id}
        />
      </div>

      {/* Accounting Activity (replaces legacy transaction view) */}
      <AccountActivity accountId={id} />
    </div>
  );
}
