'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DollarSign,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  Plus,
  Receipt,
  BarChart3,
  ExternalLink,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useAccount, ACCOUNT_CHANGED_EVENT } from '@/lib/account-context';
import { Button } from '@/components/ui/button';
import { AccountInitialization } from './account-initialization';
import { FinancialTransactionComposer } from './financial-transaction-composer';
import { isSupportedAccountCurrency } from '@/lib/accounting/currency-contract';

// ── Types ───────────────────────────────────────────────────────────────

interface OverviewSnapshot {
  netCash: string | null;
  nav: string | null;
  markedPositions: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  totalPnl: string | null;
  realizedFees: string | null;
  grossExposure: string | null;
  netExposure: string | null;
}

interface PositionRow {
  symbol: string;
  direction: string | null;
  quantity: string;
  averageCost: string;
  totalCostBasis: string;
  markStatus: 'fresh' | 'stale' | 'missing' | 'pending';
  markPrice: string | null;
  markedValue: string | null;
  unrealizedPnl: string | null;
  realizedGrossPnl: string;
  realizedNetPnl: string;
}

interface EventRow {
  id: string;
  eventType: string;
  description: string | null;
  postedAt: string;
  tradeId?: string | null;
  status: {
    hasEntry: boolean;
    isBalanced: boolean;
    postingCount: number;
  };
}

interface OverviewResponse {
  accountId: string;
  /** Whether the account is active (draft accounts start inactive). */
  isActive: boolean;
  /** Account display name, for the initialization headline. */
  name: string | null;
  /** Base currency, shown when recording an opening balance. */
  currency: string | null;
  snapshot: OverviewSnapshot;
  positions: PositionRow[];
  positionsTotal: number;
  events: EventRow[];
  eventsTotal: number;
}

// ── Props ───────────────────────────────────────────────────────────────

interface AccountOverviewProps {
  /** Account ID used to fetch the overview endpoint. */
  accountId: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatCurrency(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function getPnlClass(v: string | null): string {
  if (v === null) return 'text-muted-foreground';
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return 'text-muted-foreground';
  return n >= 0
    ? 'text-positive'
    : 'text-negative';
}

function getEventTypeBadge(eventType: string): { label: string; className: string } {
  switch (eventType) {
    case 'opening_balance':
      return { label: 'Opening', className: 'bg-info/10 text-info' };
    case 'deposit':
      return { label: 'Deposit', className: 'bg-positive/10 text-positive' };
    case 'withdrawal':
      return { label: 'Withdrawal', className: 'bg-negative/10 text-negative' };
    case 'dividend':
      return { label: 'Dividend', className: 'bg-positive/10 text-positive' };
    case 'interest':
      return { label: 'Interest', className: 'bg-positive/10 text-positive' };
    case 'fee':
      return { label: 'Fee', className: 'bg-warning/10 text-warning' };
    case 'tax':
      return { label: 'Tax', className: 'bg-negative/10 text-negative' };
    default:
      return { label: eventType, className: 'bg-muted text-muted-foreground' };
  }
}

function getMarkStatusBadge(status: 'fresh' | 'stale' | 'missing' | 'pending'): { label: string; className: string } {
  switch (status) {
    case 'fresh':
      return { label: 'Fresh', className: 'bg-positive/10 text-positive' };
    case 'stale':
      return { label: 'Stale', className: 'bg-warning/10 text-warning' };
    case 'missing':
      return { label: 'Missing', className: 'bg-negative/10 text-negative' };
    case 'pending':
      return { label: 'Pending', className: 'bg-muted text-muted-foreground' };
  }
}

function getDirectionIcon(direction: string | null) {
  if (direction === 'long') return TrendingUp;
  if (direction === 'short') return TrendingDown;
  return Minus;
}

function getDirectionColor(direction: string | null): string {
  if (direction === 'long') return 'text-positive';
  if (direction === 'short') return 'text-negative';
  return 'text-muted-foreground';
}

// ── Metric Card Sub-Component ──────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  valueClass?: string;
  icon?: React.ReactNode;
}

function MetricCard({ label, value, valueClass, icon }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            {label}
          </p>
          <p
            className={cn(
              'mt-0.5 text-lg font-semibold tabular-nums truncate',
              valueClass ?? 'text-foreground',
            )}
          >
            {value}
          </p>
        </div>
        {icon && (
          <div className="ml-3 shrink-0 text-muted-foreground">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export default function AccountOverview({ accountId }: AccountOverviewProps) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const { refresh } = useAccount();

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/overview`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch overview' }));
        throw new Error(err.error ?? 'Failed to fetch account overview');
      }
      const overviewData = (await res.json()) as OverviewResponse;
      setData(overviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    // The async loader updates loading/error state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOverview();
  }, [fetchOverview]);

  /**
   * Shared post-change handoff for every event flow that mutates account
   * state: refresh shared account state (AccountProvider re-resolves the
   * selection), reload the overview so the mutation is immediately visible
   * (initialization state → live overview, or a new event in Recent Events),
   * and notify the detail layout header (via ACCOUNT_CHANGED_EVENT) so the
   * active/inactive badge updates without a navigation.
   *
   * Wired to AccountInitialization.onInitialized (activation) and to the
   * FinancialTransactionComposer.onPosted handoff (transaction posting).
   */
  const handleAccountStateChanged = useCallback(async () => {
    await Promise.all([refresh(), fetchOverview()]);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(ACCOUNT_CHANGED_EVENT, { detail: { accountId } }),
      );
    }
  }, [refresh, fetchOverview, accountId]);

  // ── Loading State ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading overview...</p>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 size-5 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={fetchOverview}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
        >
          <RefreshCw className="size-3" />
          Retry
        </button>
      </div>
    );
  }

  // ── Guard: should not happen once loaded and no error ──────────────
  if (!data) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <BarChart3 className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No overview data available.</p>
      </div>
    );
  }

  const { snapshot, positions, positionsTotal, events, eventsTotal } = data;
  const accountCurrency = data.currency ?? 'USD';
  const currencySupported = isSupportedAccountCurrency(accountCurrency);
  // A6: a non-draft inactive account is HISTORICAL — historically readable but
  // read-only for new activity (no Add Transaction / composer). The draft case
  // (no history) returned the initialization state above.
  const readOnly = !data.isActive;

  // ── Legacy non-USD account (USD-only contract) ────────────────────
  // Preserve historical readability, but block ALL new financially
  // meaningful activity: no opening-balance initialization and no
  // transaction composer. The UI must never present an Amount (EUR) field
  // that would produce USD ledger postings.
  if (!currencySupported) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-6">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {accountCurrency} account — not currently supported for new activity
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              This account was created with base currency {accountCurrency}. TradingJournal
              currently supports USD account accounting only. Existing {accountCurrency} records
              remain readable, but you cannot post opening balances, transactions, or executions
              until multi-currency accounting is supported.
            </p>
          </div>
        </div>

        {/* Historical data remains readable below */}
        <div className="mt-5">
          {eventsTotal === 0 && positionsTotal === 0 ? (
            <p className="text-xs text-muted-foreground">
              This account has no recorded financial history.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Historical overview and ledger data for this account remain accessible on their
              respective tabs.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Draft account (inactive, no financial events, no positions) ──────
  // Show the guided initialization state instead of the empty overview so
  // new accounts present the "Add opening balance" / "Start with zero" paths.
  if (!data.isActive && eventsTotal === 0 && positionsTotal === 0) {
    return (
      <AccountInitialization
        accountId={data.accountId}
        accountName={data.name ?? 'your account'}
        currency={accountCurrency}
        onInitialized={handleAccountStateChanged}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* A6: historical inactive account — read-only for new activity. */}
      {readOnly && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Inactive account.</span>{' '}
            Historical data remains available below. Reactivate this account from{' '}
            <Link
              href={`/settings/accounts/${data.accountId}/settings`}
              className="font-medium underline hover:text-foreground"
            >
              Settings
            </Link>{' '}
            to post new transactions or executions.
          </div>
        </div>
      )}
      {/* ── 1. Primary Metrics (NAV, Cash, Market Value, Open Positions) ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* NAV */}
        <MetricCard
          label="Net Asset Value"
          value={snapshot.nav !== null ? `$${formatCurrency(snapshot.nav)}` : '—'}
          valueClass={
            snapshot.nav !== null
              ? parseFloat(snapshot.nav) >= 0
                ? 'text-foreground'
                : 'text-negative'
              : 'text-muted-foreground'
          }
          icon={<DollarSign className="size-5" />}
        />

        {/* Net Cash */}
        <MetricCard
          label="Net Cash"
          value={snapshot.netCash !== null ? `$${formatCurrency(snapshot.netCash)}` : '—'}
          valueClass={
            snapshot.netCash !== null
              ? parseFloat(snapshot.netCash) >= 0
                ? 'text-foreground'
                : 'text-negative'
              : 'text-muted-foreground'
          }
          icon={<DollarSign className="size-5" />}
        />

        {/* Market Value of Positions */}
        <MetricCard
          label="Market Value"
          value={snapshot.markedPositions !== null ? `$${formatCurrency(snapshot.markedPositions)}` : '—'}
          valueClass={
            snapshot.markedPositions !== null
              ? parseFloat(snapshot.markedPositions) >= 0
                ? 'text-foreground'
                : 'text-negative'
              : 'text-muted-foreground'
          }
          icon={<BarChart3 className="size-5" />}
        />

        {/* Open Positions Count */}
        <MetricCard
          label="Open Positions"
          value={String(positionsTotal)}
          icon={<TrendingUp className="size-5" />}
        />
      </div>

      {/* ── Section: P&L Summary (inline grid below primary metrics) ──── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Realized P&amp;L"
          value={
            snapshot.realizedPnl !== null
              ? `${parseFloat(snapshot.realizedPnl) >= 0 ? '+' : ''}$${formatCurrency(snapshot.realizedPnl)}`
              : '—'
          }
          valueClass={getPnlClass(snapshot.realizedPnl)}
        />
        <MetricCard
          label="Unrealized P&amp;L"
          value={
            snapshot.unrealizedPnl !== null
              ? `${parseFloat(snapshot.unrealizedPnl) >= 0 ? '+' : ''}$${formatCurrency(snapshot.unrealizedPnl)}`
              : '—'
          }
          valueClass={getPnlClass(snapshot.unrealizedPnl)}
        />
        <MetricCard
          label="Total P&amp;L"
          value={
            snapshot.totalPnl !== null
              ? `${parseFloat(snapshot.totalPnl) >= 0 ? '+' : ''}$${formatCurrency(snapshot.totalPnl)}`
              : '—'
          }
          valueClass={getPnlClass(snapshot.totalPnl)}
        />
        <MetricCard
          label="Realized Fees"
          value={snapshot.realizedFees !== null ? `$${formatCurrency(snapshot.realizedFees)}` : '—'}
          valueClass={
            snapshot.realizedFees !== null && parseFloat(snapshot.realizedFees) > 0
              ? 'text-warning'
              : 'text-muted-foreground'
          }
        />
      </div>

      {/* ── 2. Positions Preview (up to 5) ───────────────────────────── */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Open Positions
            {positionsTotal > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({positionsTotal} total)
              </span>
            )}
          </h2>
          {positionsTotal > 0 && (
            <Link
              href={`/settings/accounts/${accountId}/positions`}
              className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
            >
              View all →
            </Link>
          )}
        </div>

        {/* Empty State */}
        {positions.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <BarChart3 className="mx-auto mb-2 size-6 text-muted-foreground" />
            <p className="text-sm text-foreground">No open positions.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Post an execution to open a position.
            </p>
          </div>
        )}

        {/* Positions Table */}
        {positions.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Symbol</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Dir</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Avg Cost</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Mark</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Mkt Value</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Unreal.</th>
                  <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {positions.map((pos) => {
                  const Icon = getDirectionIcon(pos.direction);
                  const badge = getMarkStatusBadge(pos.markStatus);
                  const directionColor = getDirectionColor(pos.direction);

                  return (
                    <tr key={pos.symbol} className="hover:bg-muted/50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">
                        {pos.symbol}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="inline-flex items-center gap-1">
                          <Icon className={cn('size-3.5', directionColor)} />
                          <span className="text-xs text-muted-foreground">
                            {pos.direction ?? '—'}
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                        {parseFloat(pos.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                        ${formatCurrency(pos.averageCost)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                        {pos.markPrice !== null ? `$${formatCurrency(pos.markPrice)}` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                        {pos.markedValue !== null ? `$${formatCurrency(pos.markedValue)}` : '—'}
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', getPnlClass(pos.unrealizedPnl))}>
                        {pos.unrealizedPnl !== null
                          ? `${parseFloat(pos.unrealizedPnl) >= 0 ? '+' : ''}$${formatCurrency(pos.unrealizedPnl)}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={cn('inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium', badge.className)}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {positions.length < positionsTotal && (
              <div className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">
                Showing {positions.length} of {positionsTotal} positions.
                <Link
                  href={`/settings/accounts/${accountId}/positions`}
                  className="ml-1 underline hover:text-foreground"
                >
                  View all →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 4. Recent Events Preview (up to 10) ──────────────────────── */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Recent Events
            {eventsTotal > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({eventsTotal} total)
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            {eventsTotal > 0 && (
              <Link
                href={`/settings/accounts/${accountId}/ledger`}
                className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
              >
                View all →
              </Link>
            )}
            {!readOnly && (
              <Button
                type="button"
                size="sm"
                onClick={() => setComposerOpen(true)}
                aria-haspopup="dialog"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add Transaction
              </Button>
            )}
          </div>
        </div>

        {/* Empty State */}
        {events.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Receipt className="mx-auto mb-2 size-6 text-muted-foreground" />
            <p className="text-sm text-foreground">No events yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Post financial events to see activity here.
            </p>
          </div>
        )}

        {/* Events Table */}
        {events.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</th>
                  <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((ev) => {
                  const badge = getEventTypeBadge(ev.eventType);
                  return (
                    <tr key={ev.id} className="hover:bg-muted/50">
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {formatDateTime(ev.postedAt)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', badge.className)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-2 text-foreground">
                        <div className="flex items-center gap-2">
                          <span className="truncate">
                            {ev.description ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                          {/* Trade navigation link for trade_execution events with association */}
                          {ev.tradeId && ev.eventType === 'trade_execution' && (
                            <Link
                              href={`/trades/${ev.tradeId}`}
                              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-info underline hover:text-info"
                              aria-label={`View trade ${ev.tradeId.slice(0, 8)}`}
                            >
                              <ExternalLink className="size-2.5" aria-hidden="true" />
                              Trade
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 text-xs font-medium',
                            ev.status.hasEntry && ev.status.isBalanced
                              ? 'text-positive'
                              : 'text-warning',
                          )}
                        >
                          {ev.status.hasEntry && ev.status.isBalanced ? (
                            <>
                              <CheckCircle2 className="size-3" />
                              Posted
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="size-3" />
                              Pending
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Financial Transaction Composer (S03/T02 entry point) ───────
             Not mounted for historical inactive accounts (A6); the server/
             domain guard is authoritative regardless. */}
      {!readOnly && (
        <FinancialTransactionComposer
          accountId={data.accountId}
          currency={data.currency ?? 'USD'}
          open={composerOpen}
          onOpenChange={setComposerOpen}
          onPosted={handleAccountStateChanged}
        />
      )}
    </div>
  );
}
