'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney, formatMoneyPlain } from '@/lib/format-money';
import { formatPnl, formatPnlClass } from '@/lib/format-pnl';

// ── Types ────────────────────────────────────────────────────────────────

interface FifoLot {
  id: string;
  instrumentId: string;
  direction: string;
  remainingQuantity: string;
  originalQuantity: string;
  entryPrice: string;
  costBasisTotal: string;
  allocatedFees: string;
  openingExecutionId: string;
  openedAt: string;
}

interface Position {
  accountId: string;
  instrumentId: string;
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
  realizedFees: string;
  realizedNetPnl: string;
  lastUpdated: string;
  openLots: FifoLot[];
}

interface PositionsResponse {
  positions: Position[];
  total: number;
}

// ── Component Props ────────────────────────────────────────────────────

interface AccountPositionsProps {
  accountId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

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

/** Sum an array of strings that may be null. Returns null if all are null. */
function sumNullable(values: (string | null)[]): number | null {
  let total = 0;
  let hasValue = false;
  for (const v of values) {
    if (v !== null) {
      total += parseFloat(v);
      hasValue = true;
    }
  }
  return hasValue ? total : null;
}

// ── Sub-components ─────────────────────────────────────────────────────

/** Summary strip showing aggregate position metrics. */
function PositionSummaryStrip({ positions }: { positions: Position[] }) {
  const totalMktVal = sumNullable(positions.map((p) => p.markedValue));
  const totalUnrealized = sumNullable(positions.map((p) => p.unrealizedPnl));
  const totalRealizedNet = positions.reduce((acc, p) => acc + parseFloat(p.realizedNetPnl), 0);

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* Open Positions Count */}
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-[10px] font-medium tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
          Open Positions
        </p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {positions.length}
        </p>
      </div>

      {/* Total Market Value */}
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-[10px] font-medium tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
          Market Value
        </p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {totalMktVal !== null ? formatMoney(totalMktVal) : '—'}
        </p>
      </div>

      {/* Total Unrealized P&L */}
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-[10px] font-medium tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
          Unrealized P&amp;L
        </p>
        <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', formatPnlClass(totalUnrealized))}>
          {totalUnrealized !== null ? formatPnl(totalUnrealized) : '—'}
        </p>
      </div>

      {/* Total Realized Net P&L */}
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-[10px] font-medium tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
          Realized Net P&amp;L
        </p>
        <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', formatPnlClass(totalRealizedNet))}>
          {formatPnl(totalRealizedNet)}
        </p>
      </div>
    </div>
  );
}

/** Expandable FIFO lots sub-table shown below a position row. */
function FifoLotsExpanded({
  lots,
  expandSectionId,
}: {
  lots: FifoLot[];
  expandSectionId: string;
}) {
  if (lots.length === 0) return null;

  return (
    <div
      id={expandSectionId}
      role="region"
      aria-label="Open FIFO lots"
      className="border-t border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-100 dark:bg-zinc-800/50">
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Side</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Remaining</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Original</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Entry Price</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Cost Basis</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Fees</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Opening Exec</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Opened</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {lots.map((lot) => (
              <tr key={lot.id} className="hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30">
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                      lot.direction === 'long'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                    )}
                  >
                    {lot.direction}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-50">
                  {formatMoneyPlain(lot.remainingQuantity)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                  {formatMoneyPlain(lot.originalQuantity)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-50">
                  {formatMoney(lot.entryPrice)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatMoney(lot.costBasisTotal)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                  {formatMoney(lot.allocatedFees)}
                </td>
                <td className="max-w-[100px] truncate px-3 py-2 font-mono text-zinc-400 dark:text-zinc-500">
                  {lot.openingExecutionId.slice(0, 8)}…
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-zinc-500 dark:text-zinc-400">
                  {formatDateTime(lot.openedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

/**
 * AccountPositions — dense Positions workspace component.
 *
 * Fetches the enriched positions endpoint and renders a compact summary
 * strip plus one accessible table with expandable FIFO lots, missing-price
 * null semantics, and negative-zero-safe formatting.
 *
 * Supports loading, retryable error, empty, and populated states.
 */
export default function AccountPositions({ accountId }: AccountPositionsProps) {
  const [data, setData] = useState<PositionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [fetchKey, setFetchKey] = useState(0);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/positions`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch' }));
        throw new Error(err.error ?? 'Failed to fetch positions');
      }
      const result = (await res.json()) as PositionsResponse;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPositions();
  }, [fetchPositions, fetchKey]);

  const handleRetry = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  const toggleRowExpansion = useCallback((instrumentId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(instrumentId)) {
        next.delete(instrumentId);
      } else {
        next.add(instrumentId);
      }
      return next;
    });
  }, []);

  // ── Loading state ──────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="mb-8">
        <div className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading positions...</p>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="mb-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <AlertTriangle className="mx-auto mb-2 size-5 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button
            onClick={handleRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <RefreshCw className="size-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Guard ──────────────────────────────────────────────────────────
  if (!data) return null;

  const { positions } = data;
  const hasPositions = positions.length > 0;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="mb-8">
      {/* ── Header bar ──────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
          Current Positions
          {hasPositions && (
            <span className="ml-2 text-xs font-normal text-zinc-400 dark:text-zinc-500">
              ({positions.length} total)
            </span>
          )}
        </h2>
        <button
          onClick={handleRetry}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          title="Refresh positions"
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* ── Summary strip (populated only) ──────────────────────────── */}
      {hasPositions && <PositionSummaryStrip positions={positions} />}

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!hasPositions && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <BarChart3 className="mx-auto mb-2 size-6 text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">No open positions.</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Post an execution to open a position.
          </p>
        </div>
      )}

      {/* ── Populated — dense positions table ───────────────────────── */}
      {hasPositions && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm" role="table" aria-label="Open positions">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="w-8 px-1 py-2" aria-label="Expand" />
                <th
                  scope="col"
                  className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Symbol
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Dir
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Qty
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Avg Cost
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Mark/Quality
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Mkt Value
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Unreal. P&amp;L
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Real. Net P&amp;L
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Last Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {positions.map((pos) => {
                const Icon = getDirectionIcon(pos.direction);
                const dirColor = getDirectionColor(pos.direction);
                const badge = getMarkStatusBadge(pos.markStatus);
                const isExpanded = expandedRows.has(pos.instrumentId);
                const hasLots = pos.openLots.length > 0;
                const expandSectionId = `fifo-lots-${pos.instrumentId}`;

                return (
                  <tr
                    key={pos.instrumentId}
                    className={cn(
                      'group transition-colors',
                      isExpanded ? 'bg-zinc-50 dark:bg-zinc-900/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50',
                    )}
                  >
                    {/* We render a single-cell row that contains the main row + optional expansion,
                        following the same pattern as the ledger component for accessible expandable rows. */}
                    <td colSpan={10} className="p-0">
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {/* Main row */}
                        <div className="flex items-center px-1 py-2">
                          {/* Expand button */}
                          <div className="w-8 shrink-0">
                            {hasLots && (
                              <button
                                onClick={() => toggleRowExpansion(pos.instrumentId)}
                                className="flex items-center justify-center rounded p-0.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
                                aria-expanded={isExpanded}
                                aria-controls={expandSectionId}
                                aria-label={isExpanded ? 'Collapse FIFO lots' : 'Expand FIFO lots'}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="size-4" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="size-4" aria-hidden="true" />
                                )}
                              </button>
                            )}
                            {!hasLots && <div className="size-4 shrink-0" />}
                          </div>

                          {/* Symbol */}
                          <div className="w-20 shrink-0 px-2">
                            <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {pos.symbol}
                            </p>
                          </div>

                          {/* Direction */}
                          <div className="w-14 shrink-0 px-2">
                            <span className="inline-flex items-center gap-1">
                              <Icon className={cn('size-3.5', dirColor)} aria-hidden="true" />
                              <span className="text-xs capitalize text-zinc-600 dark:text-zinc-400">
                                {pos.direction ?? '—'}
                              </span>
                            </span>
                          </div>

                          {/* Quantity */}
                          <div className="w-20 shrink-0 px-2 text-right">
                            <p className="tabular-nums text-sm font-medium text-zinc-900 dark:text-zinc-50">
                              {formatMoneyPlain(pos.quantity)}
                            </p>
                          </div>

                          {/* Avg Cost */}
                          <div className="w-24 shrink-0 px-2 text-right">
                            <p className="tabular-nums text-sm text-zinc-700 dark:text-zinc-300">
                              {formatMoney(pos.averageCost)}
                            </p>
                          </div>

                          {/* Mark / Quality */}
                          <div className="w-24 shrink-0 px-2 text-right">
                            <p className="tabular-nums text-sm text-zinc-700 dark:text-zinc-300">
                              {pos.markPrice !== null ? formatMoney(pos.markPrice) : '—'}
                            </p>
                            <span
                              className={cn(
                                'mt-0.5 inline-block rounded-full px-1.5 py-[1px] text-[9px] font-medium leading-tight',
                                badge.className,
                              )}
                            >
                              {badge.label}
                            </span>
                          </div>

                          {/* Market Value */}
                          <div className="w-24 shrink-0 px-2 text-right">
                            <p className="tabular-nums text-sm font-medium text-zinc-900 dark:text-zinc-50">
                              {pos.markedValue !== null ? formatMoney(pos.markedValue) : '—'}
                            </p>
                          </div>

                          {/* Unrealized P&L */}
                          <div className="w-24 shrink-0 px-2 text-right">
                            <p className={cn('tabular-nums text-sm font-medium', formatPnlClass(pos.unrealizedPnl))}>
                              {pos.unrealizedPnl !== null ? formatPnl(pos.unrealizedPnl) : '—'}
                            </p>
                          </div>

                          {/* Realized Net P&L */}
                          <div className="w-24 shrink-0 px-2 text-right">
                            <p className={cn('tabular-nums text-sm font-medium', formatPnlClass(pos.realizedNetPnl))}>
                              {formatPnl(pos.realizedNetPnl)}
                            </p>
                          </div>

                          {/* Last Updated */}
                          <div className="min-w-[80px] shrink-0 px-2 text-right">
                            <p className="tabular-nums text-xs text-zinc-500 dark:text-zinc-400">
                              {formatDateTime(pos.lastUpdated)}
                            </p>
                          </div>
                        </div>

                        {/* Expanded FIFO lots section */}
                        {isExpanded && hasLots && (
                          <FifoLotsExpanded lots={pos.openLots} expandSectionId={expandSectionId} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
