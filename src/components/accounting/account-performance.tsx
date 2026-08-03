'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertTriangle, TrendingUp, TrendingDown, CircleDollarSign, GanttChartSquare, ArrowUpDown, DollarSign } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────

interface ValuationPosition {
  instrumentId: string;
  symbol: string;
  direction: 'long' | 'short' | null;
  quantity: string;
  averageCost: string;
  totalCostBasis: string;
  realizedPnl: string;
  realizedFees: string;
  realizedNetPnl: string;
  markPrice: string | null;
  markStatus: 'fresh' | 'stale' | 'missing';
  markedValue: string | null;
  unrealizedPnl: string | null;
  markTimestamp: string | null;
  markSource: 'user' | 'market_data' | 'import' | 'system' | null;
  markAgeMinutes: number | null;
}

interface PerformanceResponse {
  accountId: string;
  computedAt: string;
  netCash: string;
  nav: string;
  markedPositions: string;
  realizedPnl: string;
  unrealizedPnl: string;
  totalPnl: string;
  realizedFees: string;
  grossExposure: string;
  netExposure: string;
  modifiedDietzReturn: string | null;
  twr: string | null;
  highWaterMark: string | null;
  drawdown: string | null;
  drawdownPct: string | null;
  warnings: string[];
  positions: ValuationPosition[];
  rebuildCount: number;
  lastRebuiltAt: string;
}

interface RebuildResponse {
  accountId: string;
  success: boolean;
  rebuildCount: number;
  computedAt: string;
  positionCount: number;
  markCount: number;
  nav: string | null;
  warnings: string[];
}

// ── Props ───────────────────────────────────────────────────────────────

interface AccountPerformanceProps {
  accountId: string;
  /**
   * External refresh trigger.  Bumping this value triggers a refetch
   * so callers can coordinate refresh after mutations (execution post,
   * valuation mark, rebuild, etc.).
   */
  refreshKey?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatCurrency(v: string | number): string {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(v: string | null): string {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

function formatDateTime(isoString: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPnlClass(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return 'text-zinc-600 dark:text-zinc-400';
  return n >= 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';
}

function getMarkStatusBadge(status: 'fresh' | 'stale' | 'missing'): { label: string; className: string } {
  switch (status) {
    case 'fresh':
      return { label: 'Fresh', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    case 'stale':
      return { label: 'Stale', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    case 'missing':
      return { label: 'Missing', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
  }
}

function getDirectionIcon(direction: 'long' | 'short' | null) {
  if (direction === 'long') return <TrendingUp className="size-3 text-emerald-600 dark:text-emerald-400" />;
  if (direction === 'short') return <TrendingDown className="size-3 text-red-600 dark:text-red-400" />;
  return null;
}

// ── Component ──────────────────────────────────────────────────────────

export default function AccountPerformance({ accountId, refreshKey = 0 }: AccountPerformanceProps) {
  const [performance, setPerformance] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);

  const fetchPerformance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/performance`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch' }));
        throw new Error(err.error ?? 'Failed to fetch performance');
      }
      const data = (await res.json()) as PerformanceResponse;
      setPerformance(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    // The async loader updates loading/error state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPerformance();
  }, [fetchPerformance, refreshKey]);

  const handleRebuild = async () => {
    setRebuilding(true);
    setRebuildMessage(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/performance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Rebuild failed' }));
        throw new Error(err.error ?? 'Failed to rebuild performance');
      }
      const data = (await res.json()) as RebuildResponse;
      setRebuildMessage(
        `Rebuild #${data.rebuildCount}: ${data.positionCount} positions, ${data.markCount} marks. ${data.warnings.length > 0 ? data.warnings.length + ' warning(s).' : ''}`,
      );
      await fetchPerformance();
    } catch (err) {
      setRebuildMessage(`Error: ${err instanceof Error ? err.message : 'Rebuild failed'}`);
    } finally {
      setRebuilding(false);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────

  const hasPerformance = performance && parseFloat(performance.nav) > 0;
  const hasPositions = performance && performance.positions.length > 0;
  const hasWarnings = performance && performance.warnings.length > 0;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
          Performance &amp; Valuation
        </h2>
        <div className="flex items-center gap-2">
          {performance && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              v{performance.rebuildCount}
            </span>
          )}
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            title="Rebuild performance projection"
            aria-label="Rebuild performance projection"
          >
            <RefreshCw className={`size-3.5 ${rebuilding ? 'animate-spin' : ''}`} />
            Rebuild
          </button>
        </div>
      </div>

      {/* Rebuild message */}
      {rebuildMessage && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            rebuildMessage.startsWith('Error:')
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
          }`}
          role="status"
          aria-live="polite"
        >
          {rebuildMessage}
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {performance!.warnings.length} data quality warning{performance!.warnings.length !== 1 ? 's' : ''}
              </p>
              <ul className="mt-1 space-y-0.5">
                {performance!.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-600 dark:text-amber-500">{w}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="mb-4 rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading performance data...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <AlertTriangle className="mx-auto mb-2 size-5 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && performance && !hasPerformance && !hasPositions && (
        <div className="mb-4 rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <CircleDollarSign className="mx-auto mb-2 size-6 text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">No performance data yet.</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Post financial events and executions, then rebuild to see valuation and performance metrics.
          </p>
        </div>
      )}

      {/* ── Performance Metrics Grid ──────────────────────────────────── */}
      {!loading && !error && performance && hasPerformance && (
        <>
          {/* Main NAV card */}
          <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Net Asset Value
                </p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${
                  parseFloat(performance.nav) >= 0
                    ? 'text-zinc-900 dark:text-zinc-50'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  ${formatCurrency(performance.nav)}
                </p>
              </div>
              <DollarSign className="size-8 text-zinc-300 dark:text-zinc-600" />
            </div>
          </div>

          {/* KPI grid */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {/* Cash */}
            <MetricCard
              label="Net Cash"
              value={`$${formatCurrency(performance.netCash)}`}
              valueClass={parseFloat(performance.netCash) >= 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-red-600 dark:text-red-400'}
            />
            {/* Marked Positions */}
            <MetricCard
              label="Marked Pos."
              value={`$${formatCurrency(performance.markedPositions)}`}
              valueClass={parseFloat(performance.markedPositions) >= 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-red-600 dark:text-red-400'}
            />
            {/* Realized P&L */}
            <MetricCard
              label="Realized P&amp;L"
              value={`${parseFloat(performance.realizedPnl) >= 0 ? '+' : ''}$${formatCurrency(performance.realizedPnl)}`}
              valueClass={getPnlClass(performance.realizedPnl)}
            />
            {/* Unrealized P&L */}
            <MetricCard
              label="Unrealized P&amp;L"
              value={performance.unrealizedPnl !== '0.00'
                ? `${parseFloat(performance.unrealizedPnl) >= 0 ? '+' : ''}$${formatCurrency(performance.unrealizedPnl)}`
                : '$0.00'}
              valueClass={getPnlClass(performance.unrealizedPnl)}
            />
            {/* Total P&L */}
            <MetricCard
              label="Total P&amp;L"
              value={`${parseFloat(performance.totalPnl) >= 0 ? '+' : ''}$${formatCurrency(performance.totalPnl)}`}
              valueClass={getPnlClass(performance.totalPnl)}
            />
            {/* Fees */}
            <MetricCard
              label="Realized Fees"
              value={`$${formatCurrency(performance.realizedFees)}`}
              valueClass={parseFloat(performance.realizedFees) > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-zinc-600 dark:text-zinc-400'}
            />
            {/* Gross Exposure */}
            <MetricCard
              label="Gross Exposure"
              value={`$${formatCurrency(performance.grossExposure)}`}
            />
            {/* Net Exposure */}
            <MetricCard
              label="Net Exposure"
              value={`${parseFloat(performance.netExposure) >= 0 ? '+' : ''}$${formatCurrency(performance.netExposure)}`}
              valueClass={getPnlClass(performance.netExposure)}
            />
          </div>

          {/* Performance metrics sub-grid (TWR, HWM, Drawdown) */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* TWR */}
            <MetricCard
              label="TWR"
              value={formatPct(performance.twr)}
              valueClass={
                performance.twr !== null
                  ? parseFloat(performance.twr) >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }
            />
            {/* Modified Dietz */}
            <MetricCard
              label="Mod. Dietz"
              value={formatPct(performance.modifiedDietzReturn)}
              valueClass={
                performance.modifiedDietzReturn !== null
                  ? parseFloat(performance.modifiedDietzReturn) >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }
            />
            {/* High-Water Mark */}
            <MetricCard
              label="High-Water Mark"
              value={performance.highWaterMark !== null ? `$${formatCurrency(performance.highWaterMark)}` : '—'}
            />
            {/* Drawdown */}
            <MetricCard
              label="Drawdown"
              value={
                performance.drawdown !== null
                  ? `${performance.drawdownPct !== null ? formatPct(performance.drawdownPct) : ''}`
                  : '—'
              }
              valueClass={
                performance.drawdownPct !== null && parseFloat(performance.drawdownPct) < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-zinc-600 dark:text-zinc-400'
              }
            />
          </div>

          {/* Computed at timestamp */}
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">
            As of {formatDateTime(performance.computedAt)}
            {performance.lastRebuiltAt ? ` · Last rebuilt ${formatDateTime(performance.lastRebuiltAt)}` : ''}
          </p>

          {/* ── Positions Table ────────────────────────────────────────── */}
          {hasPositions && (
            <div>
              <h3 className="mb-3 text-xs font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
                Valuation Positions
              </h3>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Symbol</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Dir</th>
                      <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Qty</th>
                      <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Mark</th>
                      <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Mkt Value</th>
                      <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Unreal.</th>
                      <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Real.</th>
                      <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {performance.positions.map((pos) => {
                      const markBadge = getMarkStatusBadge(pos.markStatus);
                      return (
                        <tr key={pos.instrumentId} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                            {pos.symbol}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className="inline-flex items-center gap-1">
                              {getDirectionIcon(pos.direction)}
                              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                {pos.direction ?? '—'}
                              </span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {parseFloat(pos.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {pos.markPrice !== null ? `$${formatCurrency(pos.markPrice)}` : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {pos.markedValue !== null ? `$${formatCurrency(pos.markedValue)}` : '—'}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${getPnlClass(pos.unrealizedPnl ?? '0.00')}`}>
                            {pos.unrealizedPnl !== null
                              ? `${parseFloat(pos.unrealizedPnl) >= 0 ? '+' : ''}$${formatCurrency(pos.unrealizedPnl)}`
                              : '—'}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${getPnlClass(pos.realizedNetPnl)}`}>
                            ${formatCurrency(pos.realizedNetPnl)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${markBadge.className}`}
                              title={pos.markStatus === 'stale' && pos.markAgeMinutes !== null
                                ? `Stale (${pos.markAgeMinutes.toFixed(0)} min ago)`
                                : pos.markStatus === 'fresh'
                                ? pos.markAgeMinutes !== null
                                  ? `Fresh (${pos.markAgeMinutes.toFixed(0)} min ago)`
                                  : 'Fresh'
                                : 'No mark posted'}
                            >
                              {markBadge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty positions state */}
          {!hasPositions && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center dark:border-zinc-700">
              <GanttChartSquare className="mx-auto mb-1 size-5 text-zinc-400" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">No open positions to value.</p>
            </div>
          )}
        </>
      )}

      {/* Fallback for performance object present but no meaningful data */}
      {!loading && !error && performance && !hasPerformance && !hasPositions && !loading && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center dark:border-zinc-700">
          <ArrowUpDown className="mx-auto mb-1 size-5 text-zinc-400" />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Rebuild to compute performance metrics.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Metric Card Sub-Component ──────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  valueClass?: string;
}

function MetricCard({ label, value, valueClass }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
        {label}
      </p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums truncate ${valueClass ?? 'text-zinc-900 dark:text-zinc-50'}`}>
        {value}
      </p>
    </div>
  );
}
