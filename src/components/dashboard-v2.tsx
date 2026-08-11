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
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

export type IntegrityStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

/** Freshness classification of one mark — produced by the central policy, never by the UI. */
export type MarkStatus = 'fresh' | 'stale' | 'missing';

/** Completeness of a price-derived aggregate — produced by the central policy. */
export type SnapshotCompletenessState =
  | 'complete'
  | 'partial'
  | 'stale'
  | 'unavailable';

export interface DashboardPositionSummary {
  instrumentId: string;
  symbol: string;
  direction: string | null;
  quantity: string;
  averageCost: string;
  markStatus: MarkStatus;
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
  /** Completeness state of every price-derived aggregate in this snapshot. */
  state: SnapshotCompletenessState;
  /** Freshness coverage as a percentage (canonical, already ×100), or null when no positions. */
  coveragePct: string | null;
  /**
   * Qualified display hint the UI renders instead of a signed total:
   * '— Partial — N unpriced' / '— Unavailable — N unpriced', or null when
   * the aggregate is safe to present as-is (complete or stale).
   */
  presentationLabel: string | null;
  /**
   * Known P&L over the freshly marked subset (M of N coverage), or null
   * when no position has a fresh mark. Subordinate display only — never
   * presented as Open P&L.
   */
  markedSubsetPnl: string | null;
  positions: DashboardPositionSummary[];
}

/** Stop coverage across open journal trades. */
export interface StopCoverage {
  /** Number of open trades. */
  openTrades: number;
  /** Number of open trades with a valid planned stop. */
  withStop: number;
  /** Number of open trades without a valid planned stop. */
  withoutStop: number;
  /** 'complete' when every open trade has a stop (or none exist), else 'partial'. */
  state: SnapshotCompletenessState;
  /**
   * Qualified display hint: 'Incomplete — N without a valid stop' when
   * coverage is 'partial', else null. The UI renders this instead of a
   * deceptively complete Open risk / Portfolio heat numeric total.
   */
  presentationLabel: string | null;
}

/** Risk summary derived from open positions and journal trades. */
export interface RiskSummary {
  /**
   * Sum of unrealizedPnl across all open positions, or null when any position
   * lacks a fresh mark — a partial sum is never presented as complete.
   */
  openPnl: string | null;
  /**
   * Sum of initialRiskAmount from open journal trades, or null when some open
   * trades have no risk snapshot (partial data).
   */
  openRisk: string | null;
  /** openRisk / NAV * 100 as a percentage (canonical decimal), or null when NAV is zero. */
  portfolioHeat: string | null;
  /** Number of open trades without a planned_stop. */
  missingStops: number;
  /** Number of open trades with a planned_stop set. */
  positionsWithStop: number;
  /**
   * Sum of per-position risk-to-stop, or null when any open position cannot be
   * evaluated (missing mark or missing valid stop).
   */
  openRiskToStop: string | null;
  /** Stop coverage completeness across open journal trades. */
  stopCoverage: StopCoverage;
}

export interface JournalAttribution {
  hasJournalTrades: boolean;
  journalExecutionCount: number;
  accountOnlyExecutionCount: number;
}

export interface DashboardV2Response {
  account: { id: string; name: string; currency: string };
  metrics: {
    cash: string | null;
    nav: string | null;
    markedPositions: string | null;
    realizedPnl: string | null;
    unrealizedPnl: string | null;
    totalPnl: string | null;
    realizedFees: string | null;
    grossExposure: string | null;
    netExposure: string | null;
    drawdown: string | null;
    drawdownPct: string | null;
    modifiedDietzReturn: string | null;
    twr: string | null;
  };
  valuation: ValuationCompleteness;
  journalAttribution: JournalAttribution;
  riskSummary: RiskSummary;
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
  if (v === null || v === undefined) return 'text-muted-foreground';
  const n = parseFloat(v);
  if (isNaN(n)) return 'text-muted-foreground';
  if (n > 0) return 'text-positive';
  if (n < 0) return 'text-negative';
  return 'text-muted-foreground';
}

function integrityColor(status: IntegrityStatus): string {
  switch (status) {
    case 'healthy':
      return 'border-positive/30 bg-positive/10 text-positive';
    case 'warning':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'critical':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'unknown':
      return 'border-border bg-muted text-muted-foreground';
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
    <div className="animate-pulse rounded-xl border border-border bg-card p-5">
      <div className="mb-3 size-9 rounded-lg bg-muted" />
      <div className="mb-1 h-7 w-20 rounded bg-muted" />
      <div className="h-3 w-16 rounded bg-muted" />
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
          className={cn(
            'text-2xl font-bold tabular-nums text-foreground',
            valueClassName,
          )}
        >
          {value}
        </p>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="cursor-help text-xs text-muted-foreground underline decoration-dotted decoration-muted-foreground underline-offset-2">
                {label}
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          <p className="text-xs text-muted-foreground">{label}</p>
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

/** Human label for an aggregate completeness state — read from the API, never re-derived. */
const VALUATION_STATE_LABEL: Record<SnapshotCompletenessState, string> = {
  complete: 'Complete',
  partial: 'Partial',
  stale: 'Stale',
  unavailable: 'Unavailable',
};

const VALUATION_STATE_CLASS: Record<SnapshotCompletenessState, string> = {
  complete: 'border-positive/30 bg-positive/10 text-positive',
  partial: 'border-warning/30 bg-warning/10 text-warning',
  stale: 'border-border bg-muted text-muted-foreground',
  unavailable: 'border-destructive/30 bg-destructive/10 text-destructive',
};

/** Badge showing the API-classified completeness state of the snapshot's aggregates. */
function ValuationStateBadge({ state }: { state: SnapshotCompletenessState }) {
  return (
    <Badge variant="outline" className={VALUATION_STATE_CLASS[state]}>
      {VALUATION_STATE_LABEL[state]}
    </Badge>
  );
}

/** Format a coverage percentage already expressed ×100 (canonical decimal * 100). */
function formatCoveragePct(v: string | null | undefined): string {
  if (v === null || v === undefined) return '--';
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  return `${n.toFixed(1)}%`;
}

/** Direction icon helper */
function DirectionIcon({ direction }: { direction: string | null }) {
  if (direction === 'long') {
    return <ArrowUp className="size-3 text-positive" />;
  }
  if (direction === 'short') {
    return <ArrowDown className="size-3 text-negative" />;
  }
  return <Minus className="size-3 text-muted-foreground" />;
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
      <div className="h-9 w-48 animate-pulse rounded-lg border border-border bg-muted" />
    );
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
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
        className="h-9 rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
  const integrity = dashboard?.integrity;

  // The primary Open P&L value is the API's qualified display hint whenever
  // the aggregate is partial or unavailable — a signed total is never
  // rendered for an incomplete aggregate.
  const openPnlPresentationLabel = valuation?.presentationLabel ?? null;

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <section aria-labelledby="dashboard-v2-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2
          id="dashboard-v2-heading"
          className="text-lg font-semibold tracking-tight text-foreground"
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={handleRefresh}
            className="shrink-0 rounded-md border border-destructive/40 bg-card px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
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
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4" />
            <span>
              {dashboard.account.name}
            </span>
            <span className="text-muted-foreground">·</span>
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



          {/* Metrics grid — Key account financial metrics */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Cash */}
            <MetricCard
              icon={<DollarSign className="size-4 text-foreground" />}
              iconBg="bg-muted"
              value={formatCurrency(metrics.cash)}
              label="Cash"
              tooltip="Available cash balance in the account."
            />

            {/* NAV */}
            <MetricCard
              icon={<Wallet className="size-4 text-foreground" />}
              iconBg="bg-muted"
              value={formatCurrency(metrics.nav)}
              label="NAV"
              tooltip="Net asset value: cash plus marked positions value."
            />

            {/* Marked Positions */}
            <MetricCard
              icon={<BarChart3 className="size-4 text-foreground" />}
              iconBg="bg-muted"
              value={formatCurrency(metrics.markedPositions)}
              label="Marked Positions"
              tooltip="Total value of open positions at latest mark prices."
            />

            {/* Realized P&L */}
            <MetricCard
              icon={<Target className="size-4 text-foreground" />}
              iconBg="bg-muted"
              value={formatCurrencySigned(metrics.realizedPnl)}
              valueClassName={pnlColorValue(metrics.realizedPnl)}
              label="Realized P&amp;L"
              tooltip="Net realized profit and loss from closed positions."
            />

            {/* Unrealized P&L */}
            <MetricCard
              icon={<TrendingUp className="size-4 text-foreground" />}
              iconBg={
                openPnlPresentationLabel
                  ? 'bg-muted'
                  : metrics.unrealizedPnl !== null
                    ? parseFloat(metrics.unrealizedPnl) >= 0
                      ? 'bg-positive/10'
                      : 'bg-negative/10'
                    : 'bg-muted'
              }
              value={
                openPnlPresentationLabel ??
                formatCurrencySigned(metrics.unrealizedPnl)
              }
              valueClassName={
                openPnlPresentationLabel
                  ? 'text-lg leading-tight'
                  : pnlColorValue(metrics.unrealizedPnl)
              }
              label="Unrealized P&amp;L"
              tooltip={
                openPnlPresentationLabel
                  ? `Open P&L is not a complete total (${openPnlPresentationLabel}). ` +
                    `Known P&L over the freshly marked subset: ${formatCurrencySigned(valuation?.markedSubsetPnl)}.`
                  : 'Unrealized profit and loss on open positions at latest marks.'
              }
            />

            {/* Realized Fees */}
            <MetricCard
              icon={<Activity className="size-4 text-foreground" />}
              iconBg="bg-muted"
              value={formatCurrencySigned(metrics.realizedFees)}
              valueClassName="text-negative"
              label="Realized Fees"
              tooltip="Total fees and commissions incurred on closed positions."
            />

            {/* Gross Exposure */}
            <MetricCard
              icon={<Layers className="size-4 text-foreground" />}
              iconBg="bg-muted"
              value={formatCurrency(metrics.grossExposure)}
              label="Gross Exposure"
              tooltip="Absolute value of all open positions (long + short)."
            />

            {/* Net Exposure */}
            <MetricCard
              icon={<LineChart className="size-4 text-foreground" />}
              iconBg="bg-muted"
              value={formatCurrencySigned(metrics.netExposure)}
              valueClassName={pnlColorValue(metrics.netExposure)}
              label="Net Exposure"
              tooltip="Long minus short exposure."
            />

            {/* Drawdown */}
            <MetricCard
              icon={<TrendingDown className="size-4 text-negative" />}
              iconBg="bg-muted"
              value={
                metrics.drawdown !== null && metrics.drawdownPct !== null
                  ? `${formatCurrency(metrics.drawdown)} (${formatPercent(metrics.drawdownPct)})`
                  : '--'
              }
              valueClassName="text-negative"
              label="Drawdown"
              tooltip="Peak-to-trough decline from the highest account NAV."
            />
          </div>

          {/* Account Performance vs Journal Attribution labels */}
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
              <div className="flex w-full items-center justify-between gap-2">
                <CardTitle>Valuation Completeness</CardTitle>
                {valuation?.state && (
                  <ValuationStateBadge state={valuation.state} />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Qualified display hint: never present a partial sum as a complete total */}
              {valuation?.presentationLabel && (
                <div
                  role="status"
                  className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-warning">
                    {valuation.presentationLabel}
                  </span>
                  {valuation.markedSubsetPnl !== null && (
                    <span className="text-muted-foreground">
                      Known over marked subset:{' '}
                      {formatCurrencySigned(valuation.markedSubsetPnl)}
                    </span>
                  )}
                </div>
              )}

              <div className="mb-4 flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Positions:
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
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
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Coverage:
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {formatCoveragePct(valuation?.coveragePct)}
                  </span>
                </div>
              </div>

              {/* Position detail table */}
              {valuation && valuation.positions.length > 0 && (
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Position valuation details">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 pr-2 font-medium text-muted-foreground">
                          Symbol
                        </th>
                        <th className="pb-2 pr-2 font-medium text-muted-foreground">
                          Dir
                        </th>
                        <th className="pb-2 pr-2 font-medium text-muted-foreground">
                          Qty
                        </th>
                        <th className="pb-2 pr-2 font-medium text-muted-foreground">
                          Avg Cost
                        </th>
                        <th className="pb-2 pr-2 font-medium text-muted-foreground">
                          Mark
                        </th>
                        <th className="pb-2 pr-2 font-medium text-muted-foreground">
                          Marked Value
                        </th>
                        <th className="pb-2 pr-2 font-medium text-muted-foreground">
                          Unrealized
                        </th>
                        <th className="pb-2 pr-2 font-medium text-muted-foreground">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {valuation.positions.map((pos) => (
                        <tr
                          key={pos.instrumentId}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-2 pr-2 font-medium text-foreground">
                            {pos.symbol}
                          </td>
                          <td className="py-2 pr-2">
                            <DirectionIcon direction={pos.direction} />
                          </td>
                          <td className="py-2 pr-2 text-foreground">
                            {pos.quantity}
                          </td>
                          <td className="py-2 pr-2 text-foreground">
                            {formatCurrency(pos.averageCost)}
                          </td>
                          <td className="py-2 pr-2 text-foreground">
                            {pos.markPrice !== null
                              ? formatCurrency(pos.markPrice)
                              : '--'}
                          </td>
                          <td className="py-2 pr-2 text-foreground">
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
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0}>
                                  <ValuationBadge status={pos.markStatus} />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-56 text-xs">
                                {pos.markStatus === 'missing'
                                  ? 'No mark available for this position — classified by the central freshness policy.'
                                  : `Mark as of ${pos.markTimestamp ? new Date(pos.markTimestamp).toLocaleString() : 'unknown'}${pos.markAgeMinutes !== null ? ` · ${pos.markAgeMinutes} min old` : ''} — classified by the central freshness policy.`}
                              </TooltipContent>
                            </Tooltip>
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
                  icon={<BarChart3 className="size-8 text-muted-foreground" />}
                  title="No open positions"
                  description="This account has no open positions to valuate."
                />
              )}
            </CardContent>
          </Card>



          {/* Computed at timestamp */}
          {dashboard.computedAt && (
            <p className="text-right text-xs text-muted-foreground">
              Last computed:{' '}
              {new Date(dashboard.computedAt).toLocaleString()}
            </p>
          )}
        </>
      )}

      {/* Empty state: no dashboard data (account exists but no accounting data) */}
      {!loading && !error && !dashboard && !selectedAccountId && (
        <EmptyState
          icon={<Wallet className="size-10 text-muted-foreground" />}
          title="Select an account"
          description="Choose an account above to view account-level performance metrics."
        />
      )}

      {!loading && !error && !dashboard && selectedAccountId && (
        <EmptyState
          icon={<BarChart3 className="size-10 text-muted-foreground" />}
          title="No account data"
          description="This account has no accounting data yet. Post an opening balance or execution to get started."
        />
      )}
    </section>
  );
}
