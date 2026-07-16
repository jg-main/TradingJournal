'use client';

import { useCallback, useEffect, useState, use } from 'react';
import { useAppTimezone } from '@/lib/timezone-context';
import {
  ArrowLeft,
  Plus,
  Minus,
  TriangleAlert,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Pencil,
} from 'lucide-react';
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

import AccountPositions from '@/components/accounting/account-positions';
import AccountExecutionsActivity from '@/components/accounting/account-executions-activity';
import AccountActivity from '@/components/accounting/account-activity';
import AccountPerformance from '@/components/accounting/account-performance';
import AccountValuationForm from '@/components/accounting/account-valuation-form';
import AccountReconciliationSummary from '@/components/accounting/account-reconciliation-summary';

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
  netDeposits?: number;
  kpis?: {
    tradeCount: number;
    netPnl: number;
    winRate: number | null;
    avgR: number | null;
    avgGrade: number | null;
  };
  accounting?: {
    projection: {
      netCash: string;
      nav: string;
      realizedPnl: string;
      unrealizedPnl: string;
      totalPnl: string;
      grossExposure: string;
      netExposure: string;
      drawdown: string | null;
      highWaterMark: string | null;
      computedAt: string;
      rebuildCount: number;
    } | null;
    realizedPnl: string | null;
    nav: string | null;
    ledgerDerived: boolean;
  } | null;
  accountingIntegrity: {
    status: 'eligible' | 'stale' | 'blocked' | 'not_available';
    cutoverEligible: boolean;
    cutoverRefusalReasons: string[];
    totals: {
      comparisons: number;
      matching: number;
      explained: number;
      unexplained: number;
    } | null;
  } | null;
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
  const [transactions] = useState<Transaction[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [performanceRefreshKey, setPerformanceRefreshKey] = useState(0);
  const [accountRefreshKey, setAccountRefreshKey] = useState(0);

  const [editingParams, setEditingParams] = useState(false);
  const [savingParams, setSavingParams] = useState(false);
  const [paramForm, setParamForm] = useState({ maxRisk: '', defaultCommission: '' });
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closureSummary, setClosureSummary] = useState<ClosureSummary | null>(null);
  const [actionPending, setActionPending] = useState<'deactivate' | 'reactivate' | 'delete' | null>(null);
  const { formatDate } = useAppTimezone();

  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${id}`);

      if (!res.ok) {
        setMessage({ type: 'error', text: 'Account not found.' });
        setLoading(false);
        return;
      }

      const acctData = await res.json();
      setAccount(acctData);

      if (acctData.currentBalance != null) {
        setCurrentBalance(acctData.currentBalance);
      }

      setParamForm({
        maxRisk: acctData.maxRiskPerTradePct != null ? String(acctData.maxRiskPerTradePct) : '',
        defaultCommission: acctData.defaultCommission != null ? String(acctData.defaultCommission) : '',
      });
    } catch {
      setMessage({ type: 'error', text: 'Failed to load account data.' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAccount();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, accountRefreshKey]);


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
      await fetchAccount();
    } catch {
      setMessage({ type: 'error', text: fallback });
    } finally {
      setActionPending(null);
    }
  };

  const handleReactivateAccount = async () => {
    await mutateLifecycle('PUT', { isActive: true }, 'reactivate', 'Account reactivated.', 'Failed to reactivate account.');
  };

  const handleCloseAccount = async () => {
    setIsClosing(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/accounts/${id}/close`, { method: 'POST' });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to close account' }));
        setMessage({ type: 'error', text: err.error ?? err.details ?? 'Failed to close account.' });
        setIsClosing(false);
        return;
      }

      const data: ClosureSummary = await res.json();
      setClosureSummary(data);
      setCloseDialogOpen(false);
      setAccountRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to close account.' });
    } finally {
      setIsClosing(false);
    }
  };

  const handleParamSave = async () => {
    setSavingParams(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {};
      if (paramForm.maxRisk !== '') body.maxRiskPerTradePct = parseFloat(paramForm.maxRisk);
      if (paramForm.defaultCommission !== '') body.defaultCommission = parseFloat(paramForm.defaultCommission);

      const res = await fetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to save' }));
        setMessage({ type: 'error', text: err.error ?? 'Failed to save parameters.' });
        return;
      }

      setEditingParams(false);
      setMessage({ type: 'success', text: 'Parameters saved. Changes apply to future trades.' });
      await fetchAccount();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save parameters.' });
    } finally {
      setSavingParams(false);
    }
  };

  const handleMarkSubmitted = useCallback(() => {
    setPerformanceRefreshKey((k) => k + 1);
  }, []);

  const formatCurrency = (v: number | string) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (isNaN(n)) return String(v);
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  function getNetPnl(acct: AccountDetail): number {
    const nav = acct.accounting?.projection?.nav;
    if (nav !== undefined && acct.startingBalance !== null) {
      // Account P&L is NAV less external funding, not the legacy closed-trade
      // KPI (which excludes realized history retained outside open positions).
      return Number(nav) - acct.startingBalance - (acct.netDeposits ?? 0);
    }
    return acct.kpis?.netPnl ?? 0;
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading account details...</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <Link href="/settings" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
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
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* ── Back link ────────────────────────────────────────────────── */}
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      {/* ── Account header ───────────────────────────────────────────── */}
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
        <div className="mt-2 flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-300">
          {account.broker && <span>{account.broker}</span>}
          <span>{account.currency}</span>
        </div>
      </div>

      {/* ── Message Banner ────────────────────────────────────────────── */}
      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <XCircle className="size-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* ── Balance Card ──────────────────────────────────────────────── */}
      <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Current Balance</p>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${
          currentBalance >= 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-red-600 dark:text-red-400'
        }`}>
          ${formatCurrency(currentBalance)}
        </p>
        <div className="mt-3 flex gap-6 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Account Net P&amp;L:{' '}
            <span
              className={
                getNetPnl(account) >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }
            >
              {getNetPnl(account) >= 0 ? '+' : ''}${formatCurrency(getNetPnl(account))}
            </span>
          </span>
        </div>
      </div>

      {/* ── Payoff Summary ────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Starting Balance
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            ${formatCurrency(account.startingBalance ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Net Deposits
          </p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${
            (account.netDeposits ?? 0) >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            ${formatCurrency(account.netDeposits ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Account Net P&amp;L
          </p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${
            getNetPnl(account) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {getNetPnl(account) >= 0 ? '+' : ''}${formatCurrency(getNetPnl(account))}
          </p>
        </div>
      </div>

      {/* ── Accounting Integrity Banner ──────────────────────────────── */}
      {account.accountingIntegrity && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            account.accountingIntegrity.status === 'eligible'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : account.accountingIntegrity.status === 'blocked'
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            {account.accountingIntegrity.status === 'eligible' ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="size-4 shrink-0" />
            )}
            <span>
              Accounting data:
              {account.accountingIntegrity.status === 'eligible'
                ? ' Ledger reconciled and eligible for cutover.'
                : account.accountingIntegrity.status === 'blocked'
                  ? ` Reconciliation blocked: ${account.accountingIntegrity.cutoverRefusalReasons?.[0] ?? 'See reconciliation report for details.'}`
                  : ' No reconciliation run available. Post executions and rebuild performance to establish ledger metrics.'}
            </span>
          </div>
          {account.accountingIntegrity.totals && (
            <div className="mt-2 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{account.accountingIntegrity.totals.matching} matching</span>
              <span>{account.accountingIntegrity.totals.explained} explained</span>
              {account.accountingIntegrity.totals.unexplained > 0 && (
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {account.accountingIntegrity.totals.unexplained} unexplained
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Parameters ──────────────────────────────────────────────── */}
      <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Parameters</p>
          {!editingParams && (
            <button
              onClick={() => setEditingParams(true)}
              title="Edit parameters"
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <Pencil className="size-4" />
            </button>
          )}
        </div>
        {editingParams ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Max Risk Per Trade (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={paramForm.maxRisk}
                  onChange={(e) => setParamForm({ ...paramForm, maxRisk: e.target.value })}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="e.g. 2"
                />
                <p className="mt-1 text-xs text-zinc-400">Applies to future trades.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Default Commission ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={paramForm.defaultCommission}
                  onChange={(e) => setParamForm({ ...paramForm, defaultCommission: e.target.value })}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="e.g. 0.50"
                />
                <p className="mt-1 text-xs text-zinc-400">Applies to future trades.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleParamSave}
                disabled={savingParams}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {savingParams ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingParams(false); setParamForm({ maxRisk: String(account.maxRiskPerTradePct ?? ''), defaultCommission: String(account.defaultCommission ?? '') }); }}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Max Risk Per Trade</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {account.maxRiskPerTradePct != null ? `${account.maxRiskPerTradePct}%` : (
                  <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">Not set</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Default Commission</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {account.defaultCommission != null ? `$${account.defaultCommission.toFixed(2)}` : (
                  <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">Not set</span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>







      {/* ── Valuation & Performance Section ────────────────────────────── */}
      {account.isActive && (
        <div className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
              Valuation &amp; Performance
            </h2>
            <AccountValuationForm accountId={id} onMarkSubmitted={handleMarkSubmitted} />
          </div>
          <AccountPerformance
            key={`perf-${performanceRefreshKey}`}
            accountId={id}
            refreshKey={performanceRefreshKey}
          />
        </div>
      )}

      {/* ── Executions Feed (from Trade Log) ───────────────────────────── */}
      {account.isActive && (
        <>
          <AccountExecutionsActivity accountId={id} />
          <AccountPositions accountId={id} />
        </>
      )}

      {/* ── Reconciliation Summary ──────────────────────────────────────── */}
      {account.isActive && (
        <div className="mb-6">
          <AccountReconciliationSummary accountId={id} />
        </div>
      )}

      {/* ── Account Activity (Post Event + Financial Events Table) ────── */}
      {account.isActive && (
        <div className="mb-6 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <AccountActivity accountId={id} />
        </div>
      )}

      {/* ── Closure Summary ────────────────────────────────────────────── */}
      {closureSummary && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                Account Closed
              </p>
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                {closureSummary.accountName} closed at{' '}
                {new Date(closureSummary.closedAt).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}. Final balance: $
                {formatCurrency(closureSummary.finalBalance)}.
                {closureSummary.netReturn !== null &&
                  ` Net return: ${closureSummary.netReturn.toFixed(2)}%.`}
              </p>
            </div>
            <button
              onClick={() => setClosureSummary(null)}
              className="shrink-0 text-xs text-emerald-600 underline hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-emerald-200 pt-3 dark:border-emerald-800">
            <div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Starting Balance</p>
              <p className="text-sm font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">
                ${formatCurrency(closureSummary.startingBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Deposits</p>
              <p className="text-sm font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">
                ${formatCurrency(closureSummary.depositsTotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Realized P&amp;L</p>
              <p className={`text-sm font-semibold tabular-nums ${
                closureSummary.realizedPnl >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {closureSummary.realizedPnl >= 0 ? '+' : ''}${formatCurrency(closureSummary.realizedPnl)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Close Account button ──────────────────────────────────────── */}
      {account.isActive && !closureSummary && (
        <div className="mb-6">
          <Button
            variant="destructive"
            onClick={() => { setCloseDialogOpen(true); setMessage(null); }}
          >
            <TriangleAlert className="size-4" />
            Close Account
          </Button>
        </div>
      )}

      {/* ── Lifecycle actions for inactive accounts ────────────────────── */}
      {!account.isActive && (
        <div className="mb-6 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <p className="mb-4 text-sm font-medium text-zinc-600 dark:text-zinc-300">Account Actions</p>
          <Button
            onClick={handleReactivateAccount}
            disabled={actionPending === 'reactivate'}
          >
            <RotateCcw className="size-4" />
            Reactivate Account
          </Button>
        </div>
      )}

      {/* ── Close Account Confirmation Dialog ──────────────────────────── */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Account</DialogTitle>
            <DialogDescription>
              Are you sure? This will archive the account, compute final balance, and
              generate a closure summary. It cannot be undone for accounts with trade history.
              Accounts with open trades cannot be closed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)} disabled={isClosing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleCloseAccount} disabled={isClosing}>
              {isClosing ? 'Closing...' : 'Confirm Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
