'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  XCircle,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

interface FifoLot {
  id: string;
  remainingQuantity: string;
  originalQuantity: string;
  entryPrice: string;
  costBasisTotal: string;
  allocatedFees: string;
  direction: string;
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

// ── Helpers ──────────────────────────────────────────────────────────────

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

function getDirectionIcon(direction: string | null) {
  if (direction === 'long') return TrendingUp;
  if (direction === 'short') return TrendingDown;
  return Minus;
}

function getDirectionLabel(direction: string | null): string {
  return direction ?? 'Flat';
}

// ── Component Props ────────────────────────────────────────────────────

interface AccountPositionsProps {
  accountId: string;
  refreshKey?: number;
}

// ── Component ──────────────────────────────────────────────────────────

export default function AccountPositions({
  accountId,
  refreshKey = 0,
}: AccountPositionsProps) {
  const [positions, setPositions] = useState<PositionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/positions`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch' }));
        throw new Error(err.error ?? 'Failed to fetch positions');
      }
      const data = await res.json();
      setPositions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    // The async loader updates loading/error state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPositions();
  }, [fetchPositions, refreshKey]);

  const toggleLots = (positionId: string) => {
    setExpandedLots((prev) => {
      const next = new Set(prev);
      if (next.has(positionId)) {
        next.delete(positionId);
      } else {
        next.add(positionId);
      }
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mb-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
          Current Positions
        </h2>
        <button
          onClick={fetchPositions}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          title="Refresh positions"
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Loading State ───────────────────────────────────────────── */}
      {loading && (
        <div className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading positions...</p>
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
      {!loading && !error && positions && positions.positions.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <Minus className="mx-auto mb-2 size-5 text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">No open positions.</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Post an execution to open a position.
          </p>
        </div>
      )}

      {/* ── Positions List ──────────────────────────────────────────── */}
      {!loading && !error && positions && positions.positions.length > 0 && (
        <div className="space-y-4">
          {positions.positions.map((pos) => {
            const Icon = getDirectionIcon(pos.direction);
            const isExpanded = expandedLots.has(pos.instrumentId);
            const netPnl = parseFloat(pos.realizedNetPnl);
            const grossPnl = parseFloat(pos.realizedGrossPnl);
            const fees = parseFloat(pos.realizedFees);

            return (
              <div
                key={pos.instrumentId}
                className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                {/* Position Card Header */}
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`size-5 ${
                        pos.direction === 'long'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : pos.direction === 'short'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-zinc-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                        {pos.symbol}
                      </span>
                      <span
                        className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          pos.direction === 'long'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : pos.direction === 'short'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {getDirectionLabel(pos.direction)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                      {pos.quantity}
                    </p>
                  </div>
                </div>

                {/* Position Details Grid */}
                <div className="grid grid-cols-3 gap-4 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Avg Cost</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                      ${formatCurrency(pos.averageCost)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total Cost Basis</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                      ${formatCurrency(pos.totalCostBasis)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Realized Gross P&amp;L</p>
                    <p
                      className={`mt-0.5 text-sm font-semibold tabular-nums ${
                        grossPnl >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {grossPnl >= 0 ? '+' : ''}${formatCurrency(pos.realizedGrossPnl)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Realized Fees</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">
                      -${formatCurrency(pos.realizedFees)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Realized Net P&amp;L</p>
                    <p
                      className={`mt-0.5 text-sm font-semibold tabular-nums ${
                        netPnl >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {netPnl >= 0 ? '+' : ''}${formatCurrency(pos.realizedNetPnl)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Last Updated</p>
                    <p className="mt-0.5 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                      {formatDateTime(pos.lastUpdated)}
                    </p>
                  </div>
                </div>

                {/* Open FIFO Lots */}
                {pos.openLots.length > 0 && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800">
                    <button
                      onClick={() => toggleLots(pos.instrumentId)}
                      className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
                    >
                      <span>
                        {pos.openLots.length} open lot{pos.openLots.length !== 1 ? 's' : ''}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronRight className="size-3" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="overflow-x-auto border-t border-zinc-100 dark:border-zinc-800">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                              <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">ID</th>
                              <th className="px-4 py-2 text-center font-medium text-zinc-500 dark:text-zinc-400">Side</th>
                              <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Remaining</th>
                              <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Original</th>
                              <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Entry Price</th>
                              <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Cost Basis</th>
                              <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">Fees</th>
                              <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Opened</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {pos.openLots.map((lot) => {
                              const remaining = parseFloat(lot.remainingQuantity);
                              const original = parseFloat(lot.originalQuantity);
                              return (
                                <tr key={lot.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                                  <td className="max-w-[80px] truncate px-4 py-2 font-mono text-zinc-500 dark:text-zinc-400">
                                    {lot.id.slice(0, 8)}...
                                  </td>
                                  <td className="px-4 py-2 text-center">
                                    <span
                                      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                                        lot.direction === 'long'
                                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                      }`}
                                    >
                                      {lot.direction}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-50">
                                    {remaining.toFixed(2)}
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                                    {original.toFixed(2)}
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-50">
                                    ${formatCurrency(lot.entryPrice)}
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                                    ${formatCurrency(lot.costBasisTotal)}
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                                    ${formatCurrency(lot.allocatedFees)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-2 text-zinc-500 dark:text-zinc-400">
                                    {formatDateTime(lot.openedAt)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
