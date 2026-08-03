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
  if (direction === 'long') return 'text-positive';
  if (direction === 'short') return 'text-negative';
  return 'text-muted-foreground';
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
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          Open Positions
        </p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
          {positions.length}
        </p>
      </div>

      {/* Total Market Value */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          Market Value
        </p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
          {totalMktVal !== null ? formatMoney(totalMktVal) : '—'}
        </p>
      </div>

      {/* Total Unrealized P&L */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          Unrealized P&amp;L
        </p>
        <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', formatPnlClass(totalUnrealized))}>
          {totalUnrealized !== null ? formatPnl(totalUnrealized) : '—'}
        </p>
      </div>

      {/* Total Realized Net P&L */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
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
      className="border-t border-border bg-muted/50"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Side</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Remaining</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Original</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Entry Price</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cost Basis</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Fees</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Opening Exec</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Opened</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lots.map((lot) => (
              <tr key={lot.id} className="hover:bg-muted/50">
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                      lot.direction === 'long'
                        ? 'bg-positive/10 text-positive'
                        : 'bg-negative/10 text-negative',
                    )}
                  >
                    {lot.direction}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground">
                  {formatMoneyPlain(lot.remainingQuantity)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatMoneyPlain(lot.originalQuantity)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground">
                  {formatMoney(lot.entryPrice)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatMoney(lot.costBasisTotal)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatMoney(lot.allocatedFees)}
                </td>
                <td className="max-w-[100px] truncate px-3 py-2 font-mono text-muted-foreground">
                  {lot.openingExecutionId.slice(0, 8)}…
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
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
        <div className="rounded-lg border border-border p-8 text-center">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading positions...</p>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="mb-8">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 size-5 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={handleRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
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
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Current Positions
          {hasPositions && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({positions.length} total)
            </span>
          )}
        </h2>
        <button
          onClick={handleRetry}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-input bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
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
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <BarChart3 className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm text-foreground">No open positions.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Post an execution to open a position.
          </p>
        </div>
      )}

      {/* ── Populated — dense positions table ───────────────────────── */}
      {hasPositions && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm" role="table" aria-label="Open positions">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="w-8 px-1 py-2" aria-label="Expand" />
                <th
                  scope="col"
                  className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Symbol
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Dir
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Qty
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Avg Cost
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Mark/Quality
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Mkt Value
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Unreal. P&amp;L
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Real. Net P&amp;L
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Last Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
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
                      isExpanded ? 'bg-muted/50' : 'hover:bg-muted/50',
                    )}
                  >
                    {/* We render a single-cell row that contains the main row + optional expansion,
                        following the same pattern as the ledger component for accessible expandable rows. */}
                    <td colSpan={10} className="p-0">
                      <div className="divide-y divide-border">
                        {/* Main row */}
                        <div className="flex items-center px-1 py-2">
                          {/* Expand button */}
                          <div className="w-8 shrink-0">
                            {hasLots && (
                              <button
                                onClick={() => toggleRowExpansion(pos.instrumentId)}
                                className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
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
                            <p className="font-semibold text-foreground">
                              {pos.symbol}
                            </p>
                          </div>

                          {/* Direction */}
                          <div className="w-14 shrink-0 px-2">
                            <span className="inline-flex items-center gap-1">
                              <Icon className={cn('size-3.5', dirColor)} aria-hidden="true" />
                              <span className="text-xs capitalize text-muted-foreground">
                                {pos.direction ?? '—'}
                              </span>
                            </span>
                          </div>

                          {/* Quantity */}
                          <div className="w-20 shrink-0 px-2 text-right">
                            <p className="tabular-nums text-sm font-medium text-foreground">
                              {formatMoneyPlain(pos.quantity)}
                            </p>
                          </div>

                          {/* Avg Cost */}
                          <div className="w-24 shrink-0 px-2 text-right">
                            <p className="tabular-nums text-sm text-foreground">
                              {formatMoney(pos.averageCost)}
                            </p>
                          </div>

                          {/* Mark / Quality */}
                          <div className="w-24 shrink-0 px-2 text-right">
                            <p className="tabular-nums text-sm text-foreground">
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
                            <p className="tabular-nums text-sm font-medium text-foreground">
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
                            <p className="tabular-nums text-xs text-muted-foreground">
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
