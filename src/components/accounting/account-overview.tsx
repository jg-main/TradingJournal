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
  Receipt,
  BarChart3,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

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

interface ReconciliationBanner {
  status: 'eligible' | 'stale' | 'blocked';
  cutoverEligible: boolean;
  refusalReasons: string[];
  summary: string;
  comparisonCount: number;
  resolvedCount: number;
  unresolvedCount: number;
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
  status: {
    hasEntry: boolean;
    isBalanced: boolean;
    postingCount: number;
  };
}

interface OverviewResponse {
  accountId: string;
  snapshot: OverviewSnapshot;
  reconciliation: ReconciliationBanner | null;
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
  if (v === null) return 'text-zinc-500 dark:text-zinc-400';
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return 'text-zinc-600 dark:text-zinc-400';
  return n >= 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';
}

function getEventTypeBadge(eventType: string): { label: string; className: string } {
  switch (eventType) {
    case 'opening_balance':
      return { label: 'Opening', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'deposit':
      return { label: 'Deposit', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    case 'withdrawal':
      return { label: 'Withdrawal', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    case 'dividend':
      return { label: 'Dividend', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' };
    case 'interest':
      return { label: 'Interest', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    case 'fee':
      return { label: 'Fee', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };
    case 'tax':
      return { label: 'Tax', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' };
    default:
      return { label: eventType, className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300' };
  }
}

function getMarkStatusBadge(status: 'fresh' | 'stale' | 'missing' | 'pending'): { label: string; className: string } {
  switch (status) {
    case 'fresh':
      return { label: 'Fresh', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    case 'stale':
      return { label: 'Stale', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    case 'missing':
      return { label: 'Missing', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    case 'pending':
      return { label: 'Pending', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300' };
  }
}

function getDirectionIcon(direction: string | null) {
  if (direction === 'long') return TrendingUp;
  if (direction === 'short') return TrendingDown;
  return Minus;
}

function getDirectionColor(direction: string | null): string {
  if (direction === 'long') return 'text-emerald-600 dark:text-emerald-400';
  if (direction === 'short') return 'text-red-600 dark:text-red-400';
  return 'text-zinc-400 dark:text-zinc-500';
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
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-[10px] font-medium tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
            {label}
          </p>
          <p
            className={cn(
              'mt-0.5 text-lg font-semibold tabular-nums truncate',
              valueClass ?? 'text-zinc-900 dark:text-zinc-50',
            )}
          >
            {value}
          </p>
        </div>
        {icon && (
          <div className="ml-3 shrink-0 text-zinc-300 dark:text-zinc-600">
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

  // ── Loading State ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
        <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading overview...</p>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
        <AlertTriangle className="mx-auto mb-2 size-5 text-red-500" />
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <button
          onClick={fetchOverview}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-900/20"
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
      <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
        <BarChart3 className="mx-auto mb-2 size-6 text-zinc-400" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No overview data available.</p>
      </div>
    );
  }

  const { snapshot, reconciliation, positions, positionsTotal, events, eventsTotal } = data;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── 1. Primary Metrics (NAV, Cash, Market Value, Open Positions) ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* NAV */}
        <MetricCard
          label="Net Asset Value"
          value={snapshot.nav !== null ? `$${formatCurrency(snapshot.nav)}` : '—'}
          valueClass={
            snapshot.nav !== null
              ? parseFloat(snapshot.nav) >= 0
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-red-600 dark:text-red-400'
              : 'text-zinc-500 dark:text-zinc-400'
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
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-red-600 dark:text-red-400'
              : 'text-zinc-500 dark:text-zinc-400'
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
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-red-600 dark:text-red-400'
              : 'text-zinc-500 dark:text-zinc-400'
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
              ? 'text-orange-600 dark:text-orange-400'
              : 'text-zinc-500 dark:text-zinc-400'
          }
        />
      </div>

      {/* ── 2. Reconciliation Health Banner ─────────────────────────── */}
      {reconciliation && (
        <div
          className={cn(
            'mb-6 rounded-lg border px-4 py-3 text-sm',
            reconciliation.status === 'eligible'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : reconciliation.status === 'blocked'
              ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
              : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400',
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            {reconciliation.status === 'eligible' ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="size-4 shrink-0" />
            )}
            <span>{reconciliation.summary}</span>
          </div>
          {reconciliation.comparisonCount > 0 && (
            <div className="mt-2 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{reconciliation.resolvedCount} resolved</span>
              {reconciliation.unresolvedCount > 0 && (
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {reconciliation.unresolvedCount} unresolved
                </span>
              )}
              <span>{reconciliation.comparisonCount} total comparisons</span>
            </div>
          )}
        </div>
      )}

      {/* Null reconciliation state (no run data) */}
      {!reconciliation && (
        <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <Minus className="size-4 shrink-0 text-zinc-400" />
            <span>No reconciliation data yet. Post executions and rebuild performance to establish ledger metrics.</span>
          </div>
        </div>
      )}

      {/* ── 3. Positions Preview (up to 5) ───────────────────────────── */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wider text-zinc-600 dark:text-zinc-300 uppercase">
            Open Positions
            {positionsTotal > 0 && (
              <span className="ml-2 text-xs font-normal text-zinc-400 dark:text-zinc-500">
                ({positionsTotal} total)
              </span>
            )}
          </h2>
          {positionsTotal > 0 && (
            <Link
              href={`/accounts/${accountId}/positions`}
              className="text-xs font-medium text-zinc-600 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              View all →
            </Link>
          )}
        </div>

        {/* Empty State */}
        {positions.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <BarChart3 className="mx-auto mb-2 size-6 text-zinc-400" />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">No open positions.</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Post an execution to open a position.
            </p>
          </div>
        )}

        {/* Positions Table */}
        {positions.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Symbol</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Dir</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Avg Cost</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Mark</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Mkt Value</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Unreal.</th>
                  <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {positions.map((pos) => {
                  const Icon = getDirectionIcon(pos.direction);
                  const badge = getMarkStatusBadge(pos.markStatus);
                  const directionColor = getDirectionColor(pos.direction);

                  return (
                    <tr key={pos.symbol} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                        {pos.symbol}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="inline-flex items-center gap-1">
                          <Icon className={cn('size-3.5', directionColor)} />
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">
                            {pos.direction ?? '—'}
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {parseFloat(pos.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        ${formatCurrency(pos.averageCost)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {pos.markPrice !== null ? `$${formatCurrency(pos.markPrice)}` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
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
              <div className="border-t border-zinc-200 px-3 py-2 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                Showing {positions.length} of {positionsTotal} positions.
                <Link
                  href={`/accounts/${accountId}/positions`}
                  className="ml-1 underline hover:text-zinc-700 dark:hover:text-zinc-300"
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
          <h2 className="text-sm font-semibold tracking-wider text-zinc-600 dark:text-zinc-300 uppercase">
            Recent Events
            {eventsTotal > 0 && (
              <span className="ml-2 text-xs font-normal text-zinc-400 dark:text-zinc-500">
                ({eventsTotal} total)
              </span>
            )}
          </h2>
          {eventsTotal > 0 && (
            <Link
              href={`/accounts/${accountId}/ledger`}
              className="text-xs font-medium text-zinc-600 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              View all →
            </Link>
          )}
        </div>

        {/* Empty State */}
        {events.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <Receipt className="mx-auto mb-2 size-6 text-zinc-400" />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">No events yet.</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Post financial events to see activity here.
            </p>
          </div>
        )}

        {/* Events Table */}
        {events.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Description</th>
                  <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {events.map((ev) => {
                  const badge = getEventTypeBadge(ev.eventType);
                  return (
                    <tr key={ev.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                      <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">
                        {formatDateTime(ev.postedAt)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', badge.className)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-2 text-zinc-700 dark:text-zinc-300">
                        {ev.description ?? (
                          <span className="text-zinc-400 dark:text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 text-xs font-medium',
                            ev.status.hasEntry && ev.status.isBalanced
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400',
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
    </div>
  );
}
