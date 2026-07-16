'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  CheckCircle2,
  DollarSign,
  Info,
  Layers,
  LineChart,
  Minus,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  XCircle,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

export type IntegrityStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export interface DashboardPositionSummary {
  instrumentId: string;
  symbol: string;
  direction: string | null;
  quantity: string;
  averageCost: string;
  markStatus: string;
  markPrice: string | null;
  markedValue: string | null;
  unrealizedPnl: string | null;
  markTimestamp: string | null;
  markAgeMinutes: number | null;
}

export interface ValuationCompleteness {
  positionsTotal: number;
  fresh: number;
  stale: number;
  missing: number;
  positions: DashboardPositionSummary[];
}

export interface JournalAttribution {
  hasJournalTrades: boolean;
  journalExecutionCount: number;
  accountOnlyExecutionCount: number;
}

export interface DashboardV2Response {
  account: { id: string; name: string; currency: string };
  metrics: {
    cash: string;
    nav: string;
    markedPositions: string;
    realizedPnl: string;
    unrealizedPnl: string;
    totalPnl: string;
    realizedFees: string;
    grossExposure: string;
    netExposure: string;
    drawdown: string | null;
    drawdownPct: string | null;
    modifiedDietzReturn: string | null;
    twr: string | null;
  };
  valuation: ValuationCompleteness;
  journalAttribution: JournalAttribution;
  reconciliation: {
    eligible: boolean;
    refusalReasons: string[];
    comparisons: Array<unknown> | null;
    totals: {
      comparisons: number;
      matching: number;
      explained: number;
      anomalies: number;
      unexplained: number;
    } | null;
  };
  integrity: {
    status: IntegrityStatus;
    warnings: string[];
  };
  computedAt: string;
}

interface AccountSummary {
  id: string;
  name: string;
  currency: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatCurrency(v: string | null | undefined): string {
  if (v === null || v === undefined) return '--';
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCurrencySigned(v: string | null | undefined): string {
  if (v === null || v === undefined) return '--';
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    signDisplay: 'exceptZero',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(v: string | null | undefined): string {
  if (v === null || v === undefined) return '--';
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  return `${(n * 100).toFixed(1)}%`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Color helpers
// ═══════════════════════════════════════════════════════════════════════════

function pnlColorValue(v: string | null): string {
  if (v === null || v === undefined) return 'text-zinc-500 dark:text-zinc-400';
  const n = parseFloat(v);
  if (isNaN(n)) return 'text-zinc-500 dark:text-zinc-400';
  if (n > 0) return 'text-zinc-700 dark:text-zinc-300';
  if (n < 0) return 'text-red-600 dark:text-red-400';
  return 'text-zinc-500 dark:text-zinc-400';
}

function integrityColor(status: IntegrityStatus): string {
  switch (status) {
    case 'healthy':
      return 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'critical':
      return 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400';
    case 'unknown':
      return 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400';
  }
}

function integrityIcon(status: IntegrityStatus) {
  switch (status) {
    case 'healthy':
      return <CheckCircle2 className="size-4 shrink-0" />;
    case 'warning':
      return <AlertTriangle className="size-4 shrink-0" />;
    case 'critical':
      return <XCircle className="size-4 shrink-0" />;
    case 'unknown':
      return <Info className="size-4 shrink-0" />;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

/** Skeleton placeholders during loading */
function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 size-9 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      <div className="mb-1 h-7 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-3 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

/** Single metric card following the KPI card pattern */
function MetricCard({
  icon,
  iconBg,
  value,
  label,
  valueClassName,
  tooltip,
}: {
  icon: React.ReactNode;
  iconBg: string;
  value: React.ReactNode;
  label: string;
  valueClassName?: string;
  tooltip?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-0 p-5">
        <div className={`mb-3 flex size-9 items-center justify-center rounded-lg ${iconBg}`}>
          {icon}
        </div>
        <p
          className={`text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100 ${valueClassName ?? ''}`}
        >
          {value}
        </p>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="cursor-help text-xs text-zinc-500 underline decoration-dotted decoration-zinc-300 underline-offset-2 dark:text-zinc-400 dark:decoration-zinc-600">
                {label}
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Integrity status banner */
function IntegrityBanner({
  status,
  warnings,
}: {
  status: IntegrityStatus;
  warnings: string[];
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${integrityColor(status)}`}
      role="alert"
      aria-live="polite"
      aria-label={`Account integrity status: ${status}. ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`}
    >
      <div className="mt-0.5 shrink-0">{integrityIcon(status)}</div>
      <div className="flex-1">
        <p className="font-medium capitalize">{status}</p>
        {warnings.length > 0 && (
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Valuation badge helper */
function ValuationBadge({ status }: { status: string }) {
  const variant =
    status === 'fresh'
      ? 'default'
      : status === 'stale'
        ? 'secondary'
        : 'destructive';
  return (
    <Badge variant={variant}>
      {status === 'fresh' ? 'Fresh' : status === 'stale' ? 'Stale' : 'Missing'}
    </Badge>
  );
}

/** Direction icon helper */
function DirectionIcon({ direction }: { direction: string | null }) {
  if (direction === 'long') {
    return <ArrowUp className="size-3 text-green-600 dark:text-green-400" />;
  }
  if (direction === 'short') {
    return <ArrowDown className="size-3 text-red-600 dark:text-red-400" />;
  }
  return <Minus className="size-3 text-zinc-400" />;
}

/** Account selector dropdown */
function AccountSelector({
  accounts,
  selectedAccountId,
  loading,
  onSelect,
}: {
  accounts: AccountSummary[];
  selectedAccountId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="h-9 w-48 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800" />
    );
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No accounts found
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="account-selector-v2" className="sr-only">
        Select account
      </label>
      <select
        id="account-selector-v2"
        value={selectedAccountId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="h-9 rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-100"
        aria-label="Select account"
      >
        {accounts.map((acc) => (
          <option key={acc.id} value={acc.id}>
            {acc.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

interface DashboardV2Props {
  /** Optional initial account ID. When omitted, the API resolves one. */
  initialAccountId?: string;
}

export function DashboardV2({ initialAccountId }: DashboardV2Props) {
  // ── State ────────────────────────────────────────────────────────────

  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    initialAccountId ?? null,
  );
  const [dashboard, setDashboard] = useState<DashboardV2Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch Accounts ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountsLoading(true);

    fetch('/api/accounts')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: AccountSummary[]) => {
        if (!cancelled) {
          const list = Array.isArray(data) ? data : [];
          setAccounts(list);
          setAccountsLoading(false);

          // Auto-select first account if none selected
          if (!selectedAccountId && list.length > 0) {
            setSelectedAccountId(list[0].id);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch Dashboard V2 ──────────────────────────────────────────────

  const fetchDashboard = useCallback(async (accountId: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (accountId) params.set('accountId', accountId);

      const qs = params.toString();
      const url = `/api/dashboard/v2${qs ? `?${qs}` : ''}`;
      const res = await fetch(url);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to load dashboard');
      }

      const data: DashboardV2Response = await res.json();
      setDashboard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // fetchDashboard is stable (useCallback with [] deps), safe to omit from deps
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDashboard(selectedAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleAccountChange = useCallback((id: string) => {
    setSelectedAccountId(id);
  }, []);

  const handleRefresh = useCallback(() => {
    fetchDashboard(selectedAccountId);
  }, [fetchDashboard, selectedAccountId]);

  // ── Render helpers ───────────────────────────────────────────────────

  const metrics = dashboard?.metrics;
  const valuation = dashboard?.valuation;
  const journalAttribution = dashboard?.journalAttribution;
  const reconciliation = dashboard?.reconciliation;
  const integrity = dashboard?.integrity;

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <section aria-labelledby="dashboard-v2-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2
          id="dashboard-v2-heading"
          className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          Account Performance
        </h2>
        <div className="flex items-center gap-3">
          <AccountSelector
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            loading={accountsLoading}
            onSelect={handleAccountChange}
          />
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Refresh dashboard data"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={handleRefresh}
            className="shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-800/50"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state: no account data */}
      {!loading && !error && dashboard && metrics && (
        <>
          {/* Account info header */}
          <div className="mb-4 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Wallet className="size-4" />
            <span>
              {dashboard.account.name}
            </span>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span>{dashboard.account.currency}</span>
          </div>

          {/* Integrity Banner */}
          {integrity && integrity.warnings.length > 0 && (
            <div className="mb-4">
              <IntegrityBanner
                status={integrity.status}
                warnings={integrity.warnings}
              />
            </div>
          )}

          {/* Reconciliation eligibility banner */}
          {reconciliation && !reconciliation.eligible && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              <Info className="mt-0.5 size-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Cutover not ready</p>
                {reconciliation.refusalReasons.length > 0 && (
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {reconciliation.refusalReasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Metrics grid — Key account financial metrics */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Cash */}
            <MetricCard
              icon={<DollarSign className="size-4 text-zinc-700 dark:text-zinc-300" />}
              iconBg="bg-zinc-100 dark:bg-zinc-800"
              value={formatCurrency(metrics.cash)}
              label="Cash"
              tooltip="Available cash balance in the account."
            />

            {/* NAV */}
            <MetricCard
              icon={<Wallet className="size-4 text-zinc-700 dark:text-zinc-300" />}
              iconBg="bg-zinc-100 dark:bg-zinc-800"
              value={formatCurrency(metrics.nav)}
              label="NAV"
              tooltip="Net asset value: cash plus marked positions value."
            />

            {/* Marked Positions */}
            <MetricCard
              icon={<BarChart3 className="size-4 text-zinc-700 dark:text-zinc-300" />}
              iconBg="bg-zinc-100 dark:bg-zinc-800"
              value={formatCurrency(metrics.markedPositions)}
              label="Marked Positions"
              tooltip="Total value of open positions at latest mark prices."
            />

            {/* Realized P&L */}
            <MetricCard
              icon={<Target className="size-4 text-zinc-700 dark:text-zinc-300" />}
              iconBg="bg-zinc-100 dark:bg-zinc-800"
              value={formatCurrencySigned(metrics.realizedPnl)}
              valueClassName={pnlColorValue(metrics.realizedPnl)}
              label="Realized P&amp;L"
              tooltip="Net realized profit and loss from closed positions."
            />

            {/* Unrealized P&L */}
            <MetricCard
              icon={<TrendingUp className="size-4 text-zinc-700 dark:text-zinc-300" />}
              iconBg={
                metrics.unrealizedPnl !== null
                  ? parseFloat(metrics.unrealizedPnl) >= 0
                    ? 'bg-emerald-100 dark:bg-emerald-900/30'
                    : 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-zinc-100 dark:bg-zinc-800'
              }
              value={formatCurrencySigned(metrics.unrealizedPnl)}
              valueClassName={pnlColorValue(metrics.unrealizedPnl)}
              label="Unrealized P&amp;L"
              tooltip="Unrealized profit and loss on open positions at latest marks."
            />

            {/* Realized Fees */}
            <MetricCard
              icon={<Activity className="size-4 text-zinc-700 dark:text-zinc-300" />}
              iconBg="bg-zinc-100 dark:bg-zinc-800"
              value={formatCurrencySigned(metrics.realizedFees)}
              valueClassName="text-red-600 dark:text-red-400"
              label="Realized Fees"
              tooltip="Total fees and commissions incurred on closed positions."
            />

            {/* Gross Exposure */}
            <MetricCard
              icon={<Layers className="size-4 text-zinc-700 dark:text-zinc-300" />}
              iconBg="bg-zinc-100 dark:bg-zinc-800"
              value={formatCurrency(metrics.grossExposure)}
              label="Gross Exposure"
              tooltip="Absolute value of all open positions (long + short)."
            />

            {/* Net Exposure */}
            <MetricCard
              icon={<LineChart className="size-4 text-zinc-700 dark:text-zinc-300" />}
              iconBg="bg-zinc-100 dark:bg-zinc-800"
              value={formatCurrencySigned(metrics.netExposure)}
              valueClassName={pnlColorValue(metrics.netExposure)}
              label="Net Exposure"
              tooltip="Long minus short exposure."
            />

            {/* Drawdown */}
            <MetricCard
              icon={<TrendingDown className="size-4 text-red-600 dark:text-red-400" />}
              iconBg="bg-zinc-100 dark:bg-zinc-800"
              value={
                metrics.drawdown !== null && metrics.drawdownPct !== null
                  ? `${formatCurrency(metrics.drawdown)} (${formatPercent(metrics.drawdownPct)})`
                  : '--'
              }
              valueClassName="text-red-600 dark:text-red-400"
              label="Drawdown"
              tooltip="Peak-to-trough decline from the highest account NAV."
            />
          </div>

          {/* Account Performance vs Journal Attribution labels */}
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Badge variant="outline" className="gap-1">
              <BookOpen className="size-3" />
              Account performance
            </Badge>
            {journalAttribution && (
              <Badge variant="outline" className="gap-1">
                <Activity className="size-3" />
                Journal attribution: {journalAttribution.journalExecutionCount}{' '}
                linked, {journalAttribution.accountOnlyExecutionCount} direct
              </Badge>
            )}
          </div>

          {/* Valuation completeness section */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Valuation Completeness</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    Positions:
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {valuation?.positionsTotal ?? '--'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="default">Fresh: {valuation?.fresh ?? '--'}</Badge>
                  <Badge variant="secondary">
                    Stale: {valuation?.stale ?? '--'}
                  </Badge>
                  <Badge variant="destructive">
                    Missing: {valuation?.missing ?? '--'}
                  </Badge>
                </div>
              </div>

              {/* Position detail table */}
              {valuation && valuation.positions.length > 0 && (
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Position valuation details">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-700">
                        <th className="pb-2 pr-2 font-medium text-zinc-500 dark:text-zinc-400">
                          Symbol
                        </th>
                        <th className="pb-2 pr-2 font-medium text-zinc-500 dark:text-zinc-400">
                          Dir
                        </th>
                        <th className="pb-2 pr-2 font-medium text-zinc-500 dark:text-zinc-400">
                          Qty
                        </th>
                        <th className="pb-2 pr-2 font-medium text-zinc-500 dark:text-zinc-400">
                          Avg Cost
                        </th>
                        <th className="pb-2 pr-2 font-medium text-zinc-500 dark:text-zinc-400">
                          Mark
                        </th>
                        <th className="pb-2 pr-2 font-medium text-zinc-500 dark:text-zinc-400">
                          Marked Value
                        </th>
                        <th className="pb-2 pr-2 font-medium text-zinc-500 dark:text-zinc-400">
                          Unrealized
                        </th>
                        <th className="pb-2 pr-2 font-medium text-zinc-500 dark:text-zinc-400">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {valuation.positions.map((pos) => (
                        <tr
                          key={pos.instrumentId}
                          className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                        >
                          <td className="py-2 pr-2 font-medium text-zinc-900 dark:text-zinc-100">
                            {pos.symbol}
                          </td>
                          <td className="py-2 pr-2">
                            <DirectionIcon direction={pos.direction} />
                          </td>
                          <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-300">
                            {pos.quantity}
                          </td>
                          <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-300">
                            {formatCurrency(pos.averageCost)}
                          </td>
                          <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-300">
                            {pos.markPrice !== null
                              ? formatCurrency(pos.markPrice)
                              : '--'}
                          </td>
                          <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-300">
                            {pos.markedValue !== null
                              ? formatCurrency(pos.markedValue)
                              : '--'}
                          </td>
                          <td
                            className={`py-2 pr-2 ${pnlColorValue(pos.unrealizedPnl)}`}
                          >
                            {pos.unrealizedPnl !== null
                              ? formatCurrencySigned(pos.unrealizedPnl)
                              : '--'}
                          </td>
                          <td className="py-2">
                            <ValuationBadge status={pos.markStatus} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Empty position state */}
              {valuation && valuation.positions.length === 0 && (
                <EmptyState
                  icon={<BarChart3 className="size-8 text-zinc-400" />}
                  title="No open positions"
                  description="This account has no open positions to valuate."
                />
              )}
            </CardContent>
          </Card>

          {/* Reconciliation summary card */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Reconciliation</CardTitle>
            </CardHeader>
            <CardContent>
              {reconciliation && reconciliation.eligible ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">
                      Account is eligible for cutover
                    </span>
                  </div>
                  {reconciliation.totals && (
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>
                        Comparisons: {reconciliation.totals.comparisons}
                      </span>
                      <span>Matching: {reconciliation.totals.matching}</span>
                      <span>Explained: {reconciliation.totals.explained}</span>
                      <span>
                        Anomalies: {reconciliation.totals.anomalies}
                      </span>
                      <span>
                        Unexplained: {reconciliation.totals.unexplained}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <XCircle className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        Account not eligible for cutover
                      </p>
                      {reconciliation && reconciliation.refusalReasons.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-xs text-amber-600 dark:text-amber-400">
                          {reconciliation.refusalReasons.map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Computed at timestamp */}
          {dashboard.computedAt && (
            <p className="text-right text-xs text-zinc-400 dark:text-zinc-500">
              Last computed:{' '}
              {new Date(dashboard.computedAt).toLocaleString()}
            </p>
          )}
        </>
      )}

      {/* Empty state: no dashboard data (account exists but no accounting data) */}
      {!loading && !error && !dashboard && !selectedAccountId && (
        <EmptyState
          icon={<Wallet className="size-10 text-zinc-300 dark:text-zinc-600" />}
          title="Select an account"
          description="Choose an account above to view account-level performance metrics."
        />
      )}

      {!loading && !error && !dashboard && selectedAccountId && (
        <EmptyState
          icon={<BarChart3 className="size-10 text-zinc-300 dark:text-zinc-600" />}
          title="No account data"
          description="This account has no accounting data yet. Post an opening balance or execution to get started."
        />
      )}
    </section>
  );
}
