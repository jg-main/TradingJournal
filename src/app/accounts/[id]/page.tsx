'use client';

import { useCallback, useEffect, useState, use } from 'react';
import {
  BookOpen,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import AccountActivity from '@/components/accounting/account-activity';
import AccountExecutionForm from '@/components/accounting/account-execution-form';
import AccountExecutionsActivity from '@/components/accounting/account-executions-activity';
import AccountPositions from '@/components/accounting/account-positions';
import AccountPerformance from '@/components/accounting/account-performance';
import AccountValuationForm from '@/components/accounting/account-valuation-form';
import AccountReconciliationSummary from '@/components/accounting/account-reconciliation-summary';
import { Badge } from '@/components/ui/badge';

// ── Types ───────────────────────────────────────────────────────────────

interface AccountDetail {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  startingBalance: number | null;
  currentBalance: number;
  netDeposits: number;
  isActive: boolean;
  kpis?: {
    netPnl: number;
    tradeCount: number;
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
  };
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

interface CloseResponse {
  accountId: string;
  accountName: string;
  startingBalance: number;
  depositsTotal: number;
  withdrawalsTotal: number;
  realizedPnl: number;
  finalBalance: number;
  netReturn: number | null;
  closedAt: string;
}

/** Journal attribution computed from execution list data. */
interface JournalAttribution {
  journalExecutionCount: number;
  accountOnlyExecutionCount: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getNetPnl(account: AccountDetail): number {
  return account.kpis?.netPnl ?? 0;
}

function formatCurrency(v: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Page Component ─────────────────────────────────────────────────────

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // ── Account state ─────────────────────────────────────────────────
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [accountRefreshKey, setAccountRefreshKey] = useState(0);

  // ── Refresh coordination keys ─────────────────────────────────────
  const [performanceRefreshKey, setPerformanceRefreshKey] = useState(0);
  const [executionsRefreshKey, setExecutionsRefreshKey] = useState(0);
  // reconciliation refresh is triggered by the component's own Refresh button
  // and is not currently bound to external mutation keys

  // ── Close account state ──────────────────────────────────────────
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<CloseResponse | null>(null);

  // ── Journal attribution state (computed from executions) ────────
  const [journalAttribution, setJournalAttribution] = useState<JournalAttribution | null>(null);

  // ── Fetch account ──────────────────────────────────────────────────

  const fetchAccount = useCallback(async () => {
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
  }, [id]);

  useEffect(() => {
    // The async loader updates loading/error state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, accountRefreshKey]);

  // ── Handler: valuation mark submitted ──────────────────────────────

  const handleMarkSubmitted = useCallback(() => {
    setPerformanceRefreshKey((k) => k + 1);
  }, []);

  // ── Handler: execution posted ─────────────────────────────────────

  const handleExecutionPosted = useCallback(() => {
    // Bump all refresh keys so downstream projections update
    setPerformanceRefreshKey((k) => k + 1);
    setExecutionsRefreshKey((k) => k + 1);
  }, []);

  // ── Handler: fetch journal attribution from execution list ──────────

  const fetchJournalAttribution = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${id}/executions?limit=100&offset=0`);
      if (!res.ok) return;
      const data = await res.json();
      const executions: Array<{ journalTradeId: string | null }> = data.executions ?? [];
      let journalExecutionCount = 0;
      let accountOnlyExecutionCount = 0;
      for (const exec of executions) {
        if (exec.journalTradeId) {
          journalExecutionCount++;
        } else {
          accountOnlyExecutionCount++;
        }
      }
      setJournalAttribution({ journalExecutionCount, accountOnlyExecutionCount });
    } catch {
      // Non-critical — silently ignore attribution fetch failures
    }
  }, [id]);

  // Update attribution whenever executions refresh key bumps
  useEffect(() => {
    // The async loader updates attribution after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchJournalAttribution();
  }, [fetchJournalAttribution, executionsRefreshKey]);

  // ── Handler: close account ─────────────────────────────────────────

  const handleCloseAccount = async () => {
    setClosing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/accounts/${id}/close`, { method: 'POST' });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to close account' }));
        setMessage({ type: 'error', text: err.error ?? err.details ?? 'Failed to close account.' });
        setClosing(false);
        return;
      }

      const data: CloseResponse = await res.json();
      setCloseResult(data);
      setShowCloseConfirm(false);
      // Refresh account data (which will now show isActive = false)
      setAccountRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to close account.' });
    } finally {
      setClosing(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading account details...</p>
      </div>
    );
  }

  // ── Account not found state ────────────────────────────────────────

  if (!account) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
        <p className="text-sm text-red-700 dark:text-red-400">Account not found.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">


      {/* ── Balance Card ────────────────────────────────────────────── */}
      <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Current Balance</p>
        <p
          className={`mt-1 text-3xl font-semibold tabular-nums ${
            account.currentBalance >= 0
              ? 'text-zinc-900 dark:text-zinc-50'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          ${formatCurrency(account.currentBalance)}
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

      {/* ── Payoff Summary ──────────────────────────────────────────── */}
      <div className="mb-8 grid grid-cols-3 gap-4">
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
          <p
            className={`mt-1 text-lg font-semibold tabular-nums ${
              account.netDeposits >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            ${formatCurrency(account.netDeposits)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Account Net P&amp;L
          </p>
          <p
            className={`mt-1 text-lg font-semibold tabular-nums ${
              getNetPnl(account) >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {getNetPnl(account) >= 0 ? '+' : ''}${formatCurrency(getNetPnl(account))}
          </p>
        </div>
      </div>

      {/* ── Accounting Integrity Banner ─────────────────────────────── */}
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

      {/* ── Message Banner ──────────────────────────────────────────── */}
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

      {/* ── Close Result Summary ────────────────────────────────────── */}
      {closeResult && (
        <div className="mb-8 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                Account Closed
              </p>
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                {closeResult.accountName} closed at{' '}
                {formatDateTime(closeResult.closedAt)}. Final balance: $
                {formatCurrency(closeResult.finalBalance)}.
                {closeResult.netReturn !== null &&
                  ` Net return: ${closeResult.netReturn.toFixed(2)}%.`}
              </p>
            </div>
            <button
              onClick={() => setCloseResult(null)}
              className="shrink-0 text-xs text-emerald-600 underline hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-emerald-200 pt-3 dark:border-emerald-800">
            <div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Starting Balance
              </p>
              <p className="text-sm font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">
                ${formatCurrency(closeResult.startingBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Deposits
              </p>
              <p className="text-sm font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">
                ${formatCurrency(closeResult.depositsTotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Realized P&amp;L
              </p>
              <p
                className={`text-sm font-semibold tabular-nums ${
                  closeResult.realizedPnl >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {closeResult.realizedPnl >= 0 ? '+' : ''}${' '}
                {formatCurrency(closeResult.realizedPnl)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Close Account Section ────────────────────────────────────── */}
      {account.isActive && !closeResult && (
        <div className="mb-8">
          {!showCloseConfirm ? (
            <button
              onClick={() => {
                setShowCloseConfirm(true);
                setMessage(null);
              }}
              className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Close Account
            </button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
              <div className="mb-3 flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">
                    Close &ldquo;{account.name}&rdquo;?
                  </p>
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    This will deactivate the account, compute final balance, and
                    generate a closure summary. It cannot be undone for accounts
                    with trade history. Accounts with open trades cannot be closed.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCloseAccount}
                  disabled={closing}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {closing ? 'Closing...' : 'Confirm Close'}
                </button>
                <button
                  onClick={() => {
                    setShowCloseConfirm(false);
                    setMessage(null);
                  }}
                  disabled={closing}
                  className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Account vs Journal Performance Labels ─────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <Badge variant="outline" className="gap-1">
          <BookOpen className="size-3" />
          Account performance (ledger)
        </Badge>
        {journalAttribution && (
          <Badge variant="outline" className="gap-1">
            <Activity className="size-3" />
            Journal attribution: {journalAttribution.journalExecutionCount} linked,{' '}
            {journalAttribution.accountOnlyExecutionCount} direct
          </Badge>
        )}
      </div>

      {/* ── Performance & Valuation Section ──────────────────────────── */}
      <div className="mb-8">
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

      {/* ── Trade Execution Section ──────────────────────────────────── */}
      <AccountExecutionForm accountId={id} onExecutionPosted={handleExecutionPosted} />
      <AccountExecutionsActivity
        key={`execs-${executionsRefreshKey}`}
        accountId={id}
        refreshKey={executionsRefreshKey}
      />

      {/* ── Current Positions ─────────────────────────────────────────── */}
      <AccountPositions
        key={`pos-${executionsRefreshKey}`}
        accountId={id}
        refreshKey={executionsRefreshKey}
      />

      {/* ── Reconciliation Summary ────────────────────────────────────── */}
      <AccountReconciliationSummary
        accountId={id}
      />

      {/* ── Account Activity (Financial Events) ───────────────────────── */}
      <AccountActivity accountId={id} />
    </div>
  );
}
