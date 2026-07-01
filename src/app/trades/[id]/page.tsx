'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, Loader2, TrendingUp, TrendingDown, Target, DollarSign, Activity } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import {
  calculatePnL,
  calculateRMultiple,
  deriveTradeStatus,
  type ExecutionData,
} from '@/lib/trade-calc';

// ── Types ──────────────────────────────────────────────────────────────

interface Trade {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: 'long' | 'short';
  setupId: string | null;
  marketConditionId: string | null;
  status: 'idea' | 'planned' | 'open' | 'partially_closed' | 'closed' | 'scratched';
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedTarget2: number | null;
  thesis: string | null;
  invalidationCondition: string | null;
  preTradePlan: string | null;
  openedAt: string | null;
  closedAt: string | null;
  exitNotes: string | null;
  lesson: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface Execution {
  id: string;
  tradeId: string;
  action: string;
  quantity: number;
  price: number;
  fees: number | null;
  executedAt: string | null;
  reasonId: string | null;
  notes: string | null;
  createdAt: string | null;
}

interface RiskSnapshot {
  id: string;
  tradeId: string;
  accountEquityAtOpen: number | null;
  initialEntryPrice: number | null;
  initialStopPrice: number | null;
  initialQuantity: number | null;
  riskPerShare: number | null;
  initialRiskAmount: number | null;
  accountRiskPct: number | null;
  plannedRewardRisk: number | null;
  createdAt: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function statusBadgeVariant(status: Trade['status']): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className: string;
} {
  switch (status) {
    case 'idea':
      return { variant: 'secondary', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' };
    case 'planned':
      return { variant: 'secondary', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'open':
      return { variant: 'default', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    case 'partially_closed':
      return { variant: 'default', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    case 'closed':
      return { variant: 'outline', className: 'text-zinc-500 dark:text-zinc-400' };
    case 'scratched':
      return { variant: 'outline', className: 'text-zinc-500 dark:text-zinc-400 line-through' };
  }
}

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v >= 0 ? `$${formatted}` : `-$${formatted}`;
}

function formatDate(d: string | null): string {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
}

function formatAction(action: string): string {
  const labels: Record<string, string> = {
    buy: 'Buy',
    sell: 'Sell',
    buy_to_cover: 'Buy to Cover',
    sell_short: 'Sell Short',
    add: 'Add',
    reduce: 'Reduce',
  };
  return labels[action] ?? action;
}

function toExecutionData(executions: Execution[]): ExecutionData[] {
  return executions.map((e) => ({
    action: e.action,
    quantity: e.quantity,
    price: e.price,
    fees: e.fees ?? 0,
    executedAt: e.executedAt ?? e.createdAt ?? '',
  }));
}

function statusLabel(status: Trade['status']): string {
  switch (status) {
    case 'partially_closed': return 'Partially Closed';
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

// ── Page ───────────────────────────────────────────────────────────────

export default function TradeDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [trade, setTrade] = useState<Trade | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [riskSnapshot, setRiskSnapshot] = useState<RiskSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const [tradeRes, executionsRes, riskRes] = await Promise.all([
          fetch(`/api/trades/${id}`),
          fetch(`/api/trades/${id}/executions`),
          fetch(`/api/trades/${id}/risk-snapshot`),
        ]);

        if (cancelled) return;

        // Handle trade not found
        if (!tradeRes.ok) {
          if (tradeRes.status === 404) {
            setError('Trade not found.');
          } else {
            const err = await tradeRes.json().catch(() => ({}));
            setError(err.error ?? 'Failed to load trade.');
          }
          return;
        }

        const tradeData: Trade = await tradeRes.json();
        setTrade(tradeData);

        // Executions — 404 means none exist, which is valid
        if (executionsRes.ok) {
          const execData: Execution[] = await executionsRes.json();
          setExecutions(execData);
        }

        // Risk snapshot — 404 means none exists (trade not yet executed), which is valid
        if (riskRes.ok) {
          const riskData: RiskSnapshot = await riskRes.json();
          setRiskSnapshot(riskData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, [id]);

  // ── Derived P&L-R ──────────────────────────────────────────────────

  let pnlResult: ReturnType<typeof calculatePnL> | null = null;
  let rMultiple: ReturnType<typeof calculateRMultiple> | null = null;

  if (trade && executions.length > 0) {
    const execData = toExecutionData(executions);
    pnlResult = calculatePnL(execData, trade.direction);

    const riskAmount = riskSnapshot?.initialRiskAmount ?? null;
    rMultiple = calculateRMultiple(pnlResult.totalRealizedPnL, riskAmount);
  }

  // ── Derived lifecycle status ───────────────────────────────────────

  let derivedStatus: ReturnType<typeof deriveTradeStatus> | null = null;
  if (trade && executions.length > 0) {
    const execData = toExecutionData(executions);
    derivedStatus = deriveTradeStatus(execData, trade.direction);
  }

  // ── Render: Loading ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-8 py-20">
        <Loader2 className="mr-2 size-5 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500">Loading trade details...</p>
      </div>
    );
  }

  // ── Render: Error ──────────────────────────────────────────────────

  if (error || !trade) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <Link
          href="/trades"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          Back to Trade Log
        </Link>
        <EmptyState
          icon={<AlertCircle className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title={error ?? 'Trade not found'}
          description="The trade you are looking for does not exist or could not be loaded."
          action={
            <Link
              href="/trades"
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Back to Trade Log
            </Link>
          }
        />
      </div>
    );
  }

  // ── Render: Trade Detail ───────────────────────────────────────────

  const badgeInfo = statusBadgeVariant(trade.status);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      {/* Back link */}
      <Link
        href="/trades"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Trade Log
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {trade.symbol}
            </h1>
            <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
              {statusLabel(trade.status)}
            </Badge>
            {trade.direction === 'long' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <TrendingUp className="size-3" />
                Long
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                <TrendingDown className="size-3" />
                Short
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
            {trade.tradeCode}
          </p>
        </div>
      </div>

      {/* Grid: Trade Metadata + Risk Snapshot */}
      <div className="mb-8 grid gap-6 md:grid-cols-2">
        {/* Trade Metadata Card */}
        <Card>
          <CardHeader>
            <CardTitle>Trade Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-zinc-500 dark:text-zinc-400">Planned Entry</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatPrice(trade.plannedEntry)}
              </div>

              <div className="text-zinc-500 dark:text-zinc-400">Planned Stop</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatPrice(trade.plannedStop)}
              </div>

              <div className="text-zinc-500 dark:text-zinc-400">Target 1</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatPrice(trade.plannedTarget1)}
              </div>

              <div className="text-zinc-500 dark:text-zinc-400">Target 2</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatPrice(trade.plannedTarget2)}
              </div>
            </div>

            {trade.thesis && (
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Thesis</div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.thesis}</p>
              </div>
            )}

            {trade.invalidationCondition && (
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Invalidation</div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.invalidationCondition}</p>
              </div>
            )}

            {trade.preTradePlan && (
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Pre-Trade Plan</div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.preTradePlan}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Risk Snapshot Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-4 text-zinc-500" />
              Risk Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent>
            {riskSnapshot ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="text-zinc-500 dark:text-zinc-400">Initial Entry</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(riskSnapshot.initialEntryPrice)}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Initial Stop</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(riskSnapshot.initialStopPrice)}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Initial Qty</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {riskSnapshot.initialQuantity?.toLocaleString() ?? '-'}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Risk/Share</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(riskSnapshot.riskPerShare)}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Risk Amount</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(riskSnapshot.initialRiskAmount)}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Account Risk</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {riskSnapshot.accountRiskPct != null
                    ? `${riskSnapshot.accountRiskPct.toFixed(2)}%`
                    : '-'}
                </div>

                {riskSnapshot.plannedRewardRisk != null && (
                  <>
                    <div className="text-zinc-500 dark:text-zinc-400">Planned R:R</div>
                    <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                      {riskSnapshot.plannedRewardRisk.toFixed(2)}
                    </div>
                  </>
                )}

                {riskSnapshot.accountEquityAtOpen != null && (
                  <>
                    <div className="text-zinc-500 dark:text-zinc-400">Equity at Open</div>
                    <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                      {formatCurrency(riskSnapshot.accountEquityAtOpen)}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                No risk snapshot recorded. Executions have not been added yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lifecycle Timeline Card */}
      {derivedStatus && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-zinc-500" />
              Lifecycle Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Status</div>
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  {statusLabel(trade.status)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Opened At</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatDate(trade.openedAt ?? derivedStatus.openedAt)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Closed At</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatDate(trade.closedAt ?? derivedStatus.closedAt)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Open Qty</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {derivedStatus.openQuantity.toLocaleString()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* P&L-R Metrics Card */}
      {pnlResult && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="size-4 text-zinc-500" />
              P&amp;L-R Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Realized P&amp;L</div>
                <div
                  className={`tabular-nums font-medium ${
                    pnlResult.totalRealizedPnL >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatCurrency(pnlResult.totalRealizedPnL)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">R Multiple</div>
                <div
                  className={`tabular-nums font-medium ${
                    rMultiple?.rMultiple != null
                      ? rMultiple.rMultiple >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                      : ''
                  }`}
                >
                  {rMultiple?.rMultiple != null ? rMultiple.rMultiple.toFixed(2) : '-'}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Avg Entry Price</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(pnlResult.avgEntryPrice)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Total Qty</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {pnlResult.totalEntryQty.toLocaleString()} / {pnlResult.totalExitQty.toLocaleString()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Executions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Executions</CardTitle>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No executions recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((exec) => (
                  <TableRow key={exec.id}>
                    <TableCell className="tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatDate(exec.executedAt)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          exec.action === 'buy' || exec.action === 'add'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : exec.action === 'sell' || exec.action === 'reduce'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : exec.action === 'sell_short'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}
                      >
                        {formatAction(exec.action)}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      {exec.quantity.toLocaleString()}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      {formatPrice(exec.price)}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-500 dark:text-zinc-400">
                      {exec.fees != null ? formatCurrency(exec.fees) : '-'}
                    </TableCell>
                    <TableCell className="text-zinc-500 dark:text-zinc-400">
                      {exec.notes ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Exit notes and lesson */}
      {(trade.exitNotes || trade.lesson) && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {trade.exitNotes && (
            <Card>
              <CardHeader>
                <CardTitle>Exit Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.exitNotes}</p>
              </CardContent>
            </Card>
          )}
          {trade.lesson && (
            <Card>
              <CardHeader>
                <CardTitle>Lesson</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.lesson}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Created/Updated timestamps */}
      <p className="mt-8 text-xs text-zinc-400 dark:text-zinc-600">
        Created {formatDate(trade.createdAt)}
        {trade.updatedAt && ` · Updated ${formatDate(trade.updatedAt)}`}
      </p>
    </div>
  );
}
