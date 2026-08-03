'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Pencil,
} from 'lucide-react';
import AccountCorrectionForm from '@/components/accounting/account-correction-form';

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
        className: 'bg-positive/10 text-positive',
        icon: 'buy',
      };
    case 'sell':
      return {
        label: 'Sell',
        className: 'bg-negative/10 text-negative',
        icon: 'sell',
      };
    case 'sell_short':
      return {
        label: 'Short',
        className: 'bg-negative/10 text-negative',
        icon: 'short',
      };
    case 'buy_to_cover':
      return {
        label: 'Cover',
        className: 'bg-info/10 text-info',
        icon: 'cover',
      };
    case 'add':
      return {
        label: 'Add',
        className: 'bg-positive/10 text-positive',
        icon: 'neutral',
      };
    case 'reduce':
      return {
        label: 'Reduce',
        className: 'bg-negative/10 text-negative',
        icon: 'neutral',
      };
    default:
      return {
        label: action,
        className: 'bg-muted text-muted-foreground',
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
  const [correctingExecution, setCorrectingExecution] = useState<Execution | null>(null);
  const [correctDialogOpen, setCorrectDialogOpen] = useState(false);

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

  // ── Handle opening correction dialog ───────────────────────────────

  const openCorrection = useCallback((exec: Execution) => {
    setCorrectingExecution(exec);
    setCorrectDialogOpen(true);
  }, []);

  const handleCorrectionComplete = useCallback(() => {
    // Refresh executions to show reversal + replacement
    void fetchExecutions();
  }, [fetchExecutions]);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mb-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Execution Activity
        </h2>
        <button
          onClick={fetchExecutions}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-input bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          title="Refresh executions"
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Loading State ───────────────────────────────────────────── */}
      {loading && (
        <div className="rounded-lg border border-border p-8 text-center">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading executions...</p>
        </div>
      )}

      {/* ── Error State ─────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-8 text-center">
          <XCircle className="mx-auto mb-2 size-5 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* ── Empty State ─────────────────────────────────────────────── */}
      {!loading && !error && data && data.executions.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Minus className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="text-sm text-foreground">No executions yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Post a trade execution to see activity.
          </p>
        </div>
      )}

      {/* ── Execution List ──────────────────────────────────────────── */}
      {!loading && !error && data && data.executions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Symbol
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Qty
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Price
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Fees
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Journal Trade
                </th>
                <th className="w-20 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.executions.map((exec) => {
                const badge = getActionBadge(exec.action);
                const DirIcon = getActionDirectionIcon(badge.icon);
                const recent = isRecent(exec.postedAt);

                return (
                  <tr
                    key={exec.id}
                    className={`hover:bg-muted/50 ${
                      recent ? 'bg-positive/10' : ''
                    }`}
                  >
                    {/* Date */}
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDateTime(exec.postedAt)}
                      {recent && (
                        <span className="ml-1.5 inline-block rounded bg-positive/10 px-1 py-0.5 text-[10px] font-medium text-positive">
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
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {exec.symbol}
                    </td>

                    {/* Quantity */}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-foreground">
                      {formatCurrency(exec.quantity)}
                    </td>

                    {/* Price */}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                      ${formatCurrency(exec.price)}
                    </td>

                    {/* Fees */}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {parseFloat(exec.fees) > 0 ? `$${formatCurrency(exec.fees)}` : '—'}
                    </td>

                    {/* Description */}
                    <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">
                      {exec.description ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Journal Trade ID */}
                    <td className="max-w-[120px] truncate px-4 py-3 font-mono text-xs text-muted-foreground">
                      {exec.journalTradeId ? (
                        <span title={exec.journalTradeId}>{exec.journalTradeId.slice(0, 8)}...</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Correct Action */}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => openCorrection(exec)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Correct this execution"
                        aria-label={`Correct execution ${exec.symbol} ${exec.action} ${exec.quantity} @ ${exec.price}`}
                      >
                        <Pencil className="size-3" />
                        <span className="sr-only sm:not-sr-only">Correct</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
            {data.total} execution{data.total !== 1 ? 's' : ''}
            {data.total > data.limit && ` (showing ${data.limit})`}
          </div>
        </div>
      )}

      {/* ── Correction Dialog ─────────────────────────────────────── */}
      {correctingExecution && (
        <AccountCorrectionForm
          accountId={accountId}
          execution={{
            id: correctingExecution.id,
            symbol: correctingExecution.symbol,
            action: correctingExecution.action,
            quantity: correctingExecution.quantity,
            price: correctingExecution.price,
            fees: correctingExecution.fees,
            postedAt: correctingExecution.postedAt,
          }}
          open={correctDialogOpen}
          onOpenChange={setCorrectDialogOpen}
          onCorrectionComplete={handleCorrectionComplete}
        />
      )}
    </div>
  );
}
