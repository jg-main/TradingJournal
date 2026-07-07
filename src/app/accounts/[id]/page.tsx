'use client';

import { useEffect, useState, use } from 'react';
import { ArrowLeft, Plus, Minus } from 'lucide-react';
import Link from 'next/link';

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  balanceAfter: number;
  date: string;
  notes: string | null;
  createdAt: string;
}

interface AccountDetail {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
}

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [txnType, setTxnType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [showForm, setShowForm] = useState(false);

  const fetchData = async () => {
    try {
      const [acctRes, txnRes] = await Promise.all([
        fetch(`/api/accounts/${id}`),
        fetch(`/api/accounts/${id}/transactions`),
      ]);

      if (!acctRes.ok) {
        setMessage({ type: 'error', text: 'Account not found.' });
        setLoading(false);
        return;
      }

      const acctData = await acctRes.json();
      setAccount(acctData);

      if (txnRes.ok) {
        const txnData = await txnRes.json();
        setTransactions(txnData.data ?? []);
        setCurrentBalance(txnData.currentBalance ?? 0);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load account data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid positive amount.' });
      setSaving(false);
      return;
    }

    if (txnType === 'withdrawal' && parsedAmount > currentBalance) {
      setMessage({ type: 'error', text: `Insufficient balance. Current balance: $${currentBalance.toFixed(2)}` });
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/accounts/${id}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: txnType,
          amount: parsedAmount,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Transaction failed.') });
        return;
      }

      setMessage({ type: 'success', text: `${txnType === 'deposit' ? 'Deposit' : 'Withdrawal'} recorded.` });
      setAmount('');
      setNotes('');
      setShowForm(false);
      await fetchData();
    } catch {
      setMessage({ type: 'error', text: 'Failed to record transaction.' });
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (v: number) => {
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return d;
    }
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
    <div className="mx-auto max-w-3xl px-6 py-8">
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
          currentBalance >= 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-red-600 dark:text-red-400'
        }`}>
          ${formatCurrency(currentBalance)}
        </p>
      </div>

      {/* Transaction form */}
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

      <div className="mb-8">
        {!showForm ? (
          <div className="flex gap-3">
            <button
              onClick={() => { setTxnType('deposit'); setShowForm(true); setMessage(null); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Plus className="size-4" />
              Add Funds
            </button>
            <button
              onClick={() => { setTxnType('withdrawal'); setShowForm(true); setMessage(null); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <Minus className="size-4" />
              Withdraw
            </button>
          </div>
        ) : (
          <form onSubmit={handleTransaction} className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
              {txnType === 'deposit' ? 'Add Funds' : 'Withdraw Funds'}
            </h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="amount" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Amount ($)
                </label>
                <input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  placeholder={txnType === 'deposit' ? 'Amount to deposit' : 'Amount to withdraw'}
                  autoFocus
                />
                {txnType === 'withdrawal' && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Current balance: ${formatCurrency(currentBalance)}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="notes" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Notes (optional)
                </label>
                <input
                  id="notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  placeholder="e.g. Initial deposit, Profit withdrawal"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  txnType === 'deposit'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                }`}
              >
                {saving ? 'Processing...' : txnType === 'deposit' ? 'Add Funds' : 'Withdraw'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setMessage(null); }}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Transaction history */}
      <div>
        <h2 className="mb-4 text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
          Transaction History
        </h2>

        {transactions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">No transactions yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Type</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Amount</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Balance After</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {transactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {formatDate(txn.date)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          txn.type === 'deposit'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {txn.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-medium ${
                      txn.type === 'deposit'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}>
                      {txn.type === 'deposit' ? '+' : '-'}${formatCurrency(txn.amount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                      ${formatCurrency(txn.balanceAfter)}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300 max-w-[200px] truncate">
                      {txn.notes ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
