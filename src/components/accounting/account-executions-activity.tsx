'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

interface Execution {
  id: string;
  accountId: string;
  instrumentId: string;
  symbol: string;
  action: string;
  quantity: string;
  price: string;
  fees: string;
  idempotencyKey: string | null;
  journalTradeId: string | null;
  description: string | null;
  postedAt: string;
  createdAt: string;
}

interface ExecutionsResponse {
  executions: Execution[];
  total: number;
  limit: number;
  offset: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getActionBadge(action: string): {
  label: string;
  className: string;
  icon: 'buy' | 'sell' | 'short' | 'cover' | 'neutral';
} {
  switch (action) {
    case 'buy':
      return {
        label: 'Buy',
        className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        icon: 'buy',
      };
    case 'sell':
      return {
        label: 'Sell',
        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        icon: 'sell',
      };
    case 'sell_short':
      return {
        label: 'Short',
        className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
        icon: 'short',
      };
    case 'buy_to_cover':
      return {
        label: 'Cover',
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
        icon: 'cover',
      };
    case 'add':
      return {
        label: 'Add',
        className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
        icon: 'neutral',
      };
    case 'reduce':
      return {
        label: 'Reduce',
        className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
        icon: 'neutral',
      };
    default:
      return {
        label: action,
        className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',
        icon: 'neutral',
      };
  }
}

function getActionDirectionIcon(icon: 'buy' | 'sell' | 'short' | 'cover' | 'neutral') {
  switch (icon) {
    case 'buy':
    case 'cover':
      return ArrowUpRight;
    case 'sell':
    case 'short':
      return ArrowDownRight;
    default:
      return Minus;
  }
}

function formatCurrency(value: string): string {
  const n = parseFloat(value);
  if (isNaN(n)) return value;
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

function isRecent(isoString: string): boolean {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  return now - then < 60_000; // within the last minute
}

// ── Component Props ────────────────────────────────────────────────────

interface AccountExecutionsActivityProps {
  accountId: string;
  refreshKey?: number;
}

// ── Component ──────────────────────────────────────────────────────────

export default function AccountExecutionsActivity({
  accountId,
  refreshKey = 0,
}: AccountExecutionsActivityProps) {
  const [data, setData] = useState<ExecutionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExecutions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/executions?limit=50&offset=0`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch' }));
        throw new Error(err.error ?? 'Failed to fetch executions');
      }
      const json: ExecutionsResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    // The async loader updates loading/error state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchExecutions();
  }, [fetchExecutions, refreshKey]);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mb-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
          Execution Activity
        </h2>
        <button
          onClick={fetchExecutions}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          title="Refresh executions"
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Loading State ───────────────────────────────────────────── */}
      {loading && (
        <div className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading executions...</p>
        </div>
      )}

      {/* ── Error State ─────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-900/20">
          <XCircle className="mx-auto mb-2 size-5 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* ── Empty State ─────────────────────────────────────────────── */}
      {!loading && !error && data && data.executions.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <Minus className="mx-auto mb-2 size-5 text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">No executions yet.</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Post a trade execution to see activity.
          </p>
        </div>
      )}

      {/* ── Execution List ──────────────────────────────────────────── */}
      {!loading && !error && data && data.executions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Symbol
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Qty
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Price
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Fees
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Journal Trade
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.executions.map((exec) => {
                const badge = getActionBadge(exec.action);
                const DirIcon = getActionDirectionIcon(badge.icon);
                const recent = isRecent(exec.postedAt);

                return (
                  <tr
                    key={exec.id}
                    className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
                      recent ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''
                    }`}
                  >
                    {/* Date */}
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {formatDateTime(exec.postedAt)}
                      {recent && (
                        <span className="ml-1.5 inline-block rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          NEW
                        </span>
                      )}
                    </td>

                    {/* Action Badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                      >
                        <DirIcon className="size-3" />
                        {badge.label}
                      </span>
                    </td>

                    {/* Symbol */}
                    <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-50">
                      {exec.symbol}
                    </td>

                    {/* Quantity */}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-50">
                      {formatCurrency(exec.quantity)}
                    </td>

                    {/* Price */}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                      ${formatCurrency(exec.price)}
                    </td>

                    {/* Fees */}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      {parseFloat(exec.fees) > 0 ? `$${formatCurrency(exec.fees)}` : '—'}
                    </td>

                    {/* Description */}
                    <td className="max-w-[160px] truncate px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {exec.description ?? (
                        <span className="text-zinc-400 dark:text-zinc-500">—</span>
                      )}
                    </td>

                    {/* Journal Trade ID */}
                    <td className="max-w-[120px] truncate px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {exec.journalTradeId ? (
                        <span title={exec.journalTradeId}>{exec.journalTradeId.slice(0, 8)}...</span>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {data.total} execution{data.total !== 1 ? 's' : ''}
            {data.total > data.limit && ` (showing ${data.limit})`}
          </div>
        </div>
      )}
    </div>
  );
}
