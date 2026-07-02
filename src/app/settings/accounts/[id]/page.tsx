'use client';

import { useEffect, useState, use, useCallback } from 'react';
import { ArrowLeft, Plus, Minus, TriangleAlert, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

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
  isActive: boolean;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  startingBalance: number | null;
  currentBalance?: number;
  realizedPnl?: number;
  kpis?: {
    tradeCount: number;
    netPnl: number;
    winRate: number | null;
    avgR: number | null;
    avgGrade: number | null;
  };
}

interface ClosureSummary {
  accountId: string;
  accountName: string;
  startingBalance: number;
  depositsTotal: number;
  withdrawalsTotal: number;
  realizedPnl: number;
  finalBalance: number;
  netReturn: number | null;
  kpis: {
    tradeCount: number;
    netPnl: number;
    winRate: number | null;
    avgR: number | null;
    avgGrade: number | null;
  };
  datesActive: {
    from: string;
    to: string;
  };
  closedAt: string;
}

export default function AccountDetailSettingsPage({ params }: { params: Promise<{ id: string }> }) {
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
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closureSummary, setClosureSummary] = useState<ClosureSummary | null>(null);
  const [actionPending, setActionPending] = useState<'deactivate' | 'reactivate' | 'delete' | null>(null);

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

      if (acctData.currentBalance != null) {
        setCurrentBalance(acctData.currentBalance);
      }

      if (txnRes.ok) {
        const txnData = await txnRes.json();
        setTransactions(txnData.data ?? []);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load account data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const surfaceError = (payload: { error?: string; details?: unknown } | null, fallback: string) => {
    if (!payload) return fallback;
    if (payload.details) return typeof payload.details === 'string' ? payload.details : JSON.stringify(payload.details);
    return payload.error ?? fallback;
  };

  const mutateLifecycle = async (method: 'PUT' | 'DELETE', body: unknown, pending: 'deactivate' | 'reactivate' | 'delete', success: string, fallback: string) => {
    setActionPending(pending);
    setMessage(null);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ type: 'error', text: surfaceError(payload, fallback) });
        return;
      }
      setMessage({ type: 'success', text: success });
      await fetchData();
    } catch {
      setMessage({ type: 'error', text: fallback });
    } finally {
      setActionPending(null);
    }
  };

  const handleDeactivateAccount = async () => {
    if (!confirm('Deactivate this account? It will remain accessible from Settings.')) return;
    await mutateLifecycle('PUT', { isActive: false }, 'deactivate', 'Account deactivated.', 'Failed to deactivate account.');
  };

  const handleReactivateAccount = async () => {
    await mutateLifecycle('PUT', { isActive: true }, 'reactivate', 'Account reactivated.', 'Failed to reactivate account.');
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Delete this account? This cannot be undone.')) return;
    await mutateLifecycle('DELETE', undefined, 'delete', 'Account deleted.', 'Failed to delete account.');
  };

  const handleCloseAccount = async () => {
    setIsClosing(true);
    setMessage(null);

    try {
      await mutateLifecycle(
        'PUT',
        { isActive: false },
        'deactivate',
        'Account deactivated.',
        'Failed to deactivate account.',
      );
      setCloseDialogOpen(false);
    } finally {
      setIsClosing(false);
    }
  };

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
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading account details...</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link href="/settings" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-400">Account not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Back link */}
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      {/* Account header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {account.name}
          </h1>
          {account.isActive ? (
            <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              Active
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
              Closed
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          {account.broker && <span>{account.broker}</span>}
          <span>{account.currency}</span>
        </div>
      </div>

      {/* Balance card */}
      <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Current Balance</p>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${
          currentBalance >= 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-red-600 dark:text-red-400'
        }`}>
          ${formatCurrency(currentBalance)}
        </p>
      </div>

      {/* Risk Parameters card */}
      <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">Risk Parameters</p>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Max Risk Per Trade</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {account.maxRiskPerTradePct != null ? `${account.maxRiskPerTradePct}%` : (
                <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">Using global defaults</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Default Commission</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {account.defaultCommission != null ? `$${account.defaultCommission.toFixed(2)}` : (
                <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">Using global defaults</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Starting Balance</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {account.startingBalance != null ? `$${account.startingBalance.toFixed(2)}` : (
                <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">Using global defaults</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Performance Metrics card */}
      {account.kpis && (
        <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">Performance Metrics</p>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Net P&amp;L</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${
                account.kpis.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {account.kpis.netPnl >= 0 ? '+' : ''}${formatCurrency(account.kpis.netPnl)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Win Rate</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {account.kpis.winRate != null
                  ? `${(account.kpis.winRate * 100).toFixed(1)}%`
                  : <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">N/A</span>
                }
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Trade Count</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {account.kpis.tradeCount}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Avg R</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {account.kpis.avgR != null
                  ? account.kpis.avgR.toFixed(2)
                  : <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">N/A</span>
                }
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Avg Grade</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {account.kpis.avgGrade != null
                  ? account.kpis.avgGrade.toFixed(1)
                  : <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">N/A</span>
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Transaction form */}
      {message && (
        <div
          role="alert"
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {account.isActive && (
        <div className="mb-8">
          {!showForm ? (
            <div className="flex gap-3">
              <Button
                onClick={() => { setTxnType('deposit'); setShowForm(true); setMessage(null); }}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="size-4" />
                Add Funds
              </Button>
              <Button
                variant="outline"
                onClick={() => { setTxnType('withdrawal'); setShowForm(true); setMessage(null); }}
              >
                <Minus className="size-4" />
                Withdraw
              </Button>
            </div>
          ) : (
            <form onSubmit={handleTransaction} className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {txnType === 'deposit' ? 'Add Funds' : 'Withdraw Funds'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="amount" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Amount ($)
                  </label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={txnType === 'deposit' ? 'Amount to deposit' : 'Amount to withdraw'}
                    autoFocus
                  />
                  {txnType === 'withdrawal' && (
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                      Current balance: ${formatCurrency(currentBalance)}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="notes" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Notes (optional)
                  </label>
                  <Input
                    id="notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Initial deposit, Profit withdrawal"
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  type="submit"
                  disabled={saving}
                  className={
                    txnType === 'deposit'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : ''
                  }
                >
                  {saving ? 'Processing...' : txnType === 'deposit' ? 'Add Funds' : 'Withdraw'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setShowForm(false); setMessage(null); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Closure Summary Card */}
      {closureSummary && (
        <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">Closure Summary</p>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Final Balance</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${
                closureSummary.finalBalance >= 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-red-600 dark:text-red-400'
              }`}>
                ${formatCurrency(closureSummary.finalBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Net P&amp;L</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${
                closureSummary.realizedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {closureSummary.realizedPnl >= 0 ? '+' : ''}${formatCurrency(closureSummary.realizedPnl)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Net Return</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${
                closureSummary.netReturn != null && closureSummary.netReturn >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {closureSummary.netReturn != null
                  ? `${closureSummary.netReturn >= 0 ? '+' : ''}${closureSummary.netReturn.toFixed(2)}%`
                  : <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">N/A</span>
                }
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Trade Count</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {closureSummary.kpis.tradeCount}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Win Rate</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {closureSummary.kpis.winRate != null
                  ? `${(closureSummary.kpis.winRate * 100).toFixed(1)}%`
                  : <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">N/A</span>
                }
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Avg R</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {closureSummary.kpis.avgR != null
                  ? closureSummary.kpis.avgR.toFixed(2)
                  : <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">N/A</span>
                }
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Avg Grade</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {closureSummary.kpis.avgGrade != null
                  ? closureSummary.kpis.avgGrade.toFixed(1)
                  : <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500">N/A</span>
                }
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Deposits</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                ${formatCurrency(closureSummary.depositsTotal)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Withdrawals</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
                ${formatCurrency(closureSummary.withdrawalsTotal)}
              </p>
            </div>
            <div className="col-span-3">
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Dates Active</p>
              <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {formatDate(closureSummary.datesActive.from)} &ndash; {formatDate(closureSummary.datesActive.to)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div>
        <h2 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Transaction History
        </h2>

        {transactions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No transactions yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance After</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((txn) => (
                  <TableRow key={txn.id}>
                    <TableCell className="text-zinc-600 dark:text-zinc-400">
                      {formatDate(txn.date)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          txn.type === 'deposit'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {txn.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${
                      txn.type === 'deposit'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}>
                      {txn.type === 'deposit' ? '+' : '-'}${formatCurrency(txn.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                      ${formatCurrency(txn.balanceAfter)}
                    </TableCell>
                    <TableCell className="text-zinc-500 dark:text-zinc-400 max-w-[200px] truncate">
                      {txn.notes ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Close Account button */}
      {account.isActive && (
        <div className="mt-8 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <Button
            variant="destructive"
            onClick={() => { setCloseDialogOpen(true); setMessage(null); }}
          >
            <TriangleAlert className="size-4" />
            Close Account
          </Button>
        </div>
      )}

      {/* Lifecycle actions for inactive accounts */}
      {!account.isActive && (
        <div className="mt-8 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <p className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Account Actions
          </p>
          <Button
            onClick={handleReactivateAccount}
            disabled={actionPending === 'reactivate'}
          >
            <RotateCcw className="size-4" />
            Reactivate Account
          </Button>
        </div>
      )}

      {/* Close Account Confirmation Dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Account</DialogTitle>
            <DialogDescription>
              Are you sure? This will archive the account. All trade data is preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCloseDialogOpen(false)}
              disabled={isClosing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleCloseAccount}
              disabled={isClosing}
            >
              {isClosing ? 'Closing...' : 'Confirm Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
