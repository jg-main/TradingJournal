/**
 * AccountPerformancePanel — compact grouped metric panel replacing the 9
 * individual MetricCard components from DashboardV2.
 *
 * Displays all account-level financial metrics (Cash, NAV, Marked Positions,
 * Realized/Unrealized P&L, Realized Fees, Gross/Net Exposure, Drawdown) in a
 * single dense 3-column grid with no per-metric icons.
 *
 * Loads data via a render-prop / data-prop pattern — the parent component
 * coordinates fetch and passes the DashboardV2Response down.
 *
 * Run: npx vitest run src/components/dashboard/account-performance-panel.test.tsx
 */

'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Info,
  RefreshCw,
  Wallet,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DashboardWidget } from './dashboard-widget';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { DashboardV2Response, IntegrityStatus } from '@/components/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AccountPerformancePanelProps {
  /** Full DashboardV2 response data — when null, shows loading or empty */
  data: DashboardV2Response | null;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Callback for refresh action */
  onRefresh?: () => void;
  /** Whether a refresh is currently in progress */
  isRefreshing?: boolean;
  /** Additional CSS class override */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Metric Definition
// ═══════════════════════════════════════════════════════════════════════════

/** One compact metric cell definition */
interface MetricCellProps {
  value: React.ReactNode;
  label: string;
  tooltip?: string;
  valueClassName?: string;
}

/** A single compact metric cell — value on top, label below */
function MetricCell({ value, label, tooltip, valueClassName }: MetricCellProps) {
  const content = (
    <div className="flex flex-col">
      <span
        className={cn(
          'text-base font-bold tabular-nums leading-tight text-zinc-900 dark:text-zinc-100',
          valueClassName,
        )}
      >
        {value}
      </span>
      <span className="mt-0.5 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{content}</div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-56 text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting Helpers (string-based, matching dashboard-v2 API contract)
// ═══════════════════════════════════════════════════════════════════════════

function fmt(v: string | null | undefined): string {
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

function fmtSigned(v: string | null | undefined): string {
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

function fmtPct(v: string | null | undefined): string {
  if (v === null || v === undefined) return '--';
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  return `${(n * 100).toFixed(1)}%`;
}

function pnlColor(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  const n = parseFloat(v);
  if (isNaN(n)) return '';
  if (n > 0) return 'text-zinc-700 dark:text-zinc-300';
  if (n < 0) return 'text-red-600 dark:text-red-400';
  return 'text-zinc-500 dark:text-zinc-400';
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

/** Integrity banner — compact variant */
function IntegrityBadge({
  status,
  count,
}: {
  status: IntegrityStatus;
  count: number;
}) {
  // Always render the status badge — even healthy shows a visual indicator

  const colors: Record<IntegrityStatus, string> = {
    healthy: 'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/30',
    warning: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30',
    critical: 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-900/30',
    unknown: 'text-zinc-600 bg-zinc-50 dark:text-zinc-400 dark:bg-zinc-900/30',
  };

  const icons: Record<IntegrityStatus, React.ReactNode> = {
    healthy: <CheckCircle2 className="size-3 shrink-0" />,
    warning: <AlertTriangle className="size-3 shrink-0" />,
    critical: <XCircle className="size-3 shrink-0" />,
    unknown: <Info className="size-3 shrink-0" />,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        colors[status],
      )}
    >
      {icons[status]}
      <span className="capitalize">{status}</span>
      {count > 0 && <span>({count})</span>}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compact grouped metric panel for account-level financial data.
 *
 * Displays 9 key account metrics in a dense 3-column grid:
 * - Cash, NAV, Marked Positions
 * - Realized P&L, Unrealized P&L, Realized Fees
 * - Gross Exposure, Net Exposure, Drawdown
 *
 * Also renders the account header (name, currency), integrity status,
 * journal attribution badges, and computed-at timestamp.
 */
export function AccountPerformancePanel({
  data,
  isLoading = false,
  error = null,
  onRefresh,
  isRefreshing = false,
  className,
}: AccountPerformancePanelProps) {
  const metrics = data?.metrics;

  return (
    <DashboardWidget
      title="Account Performance"
      testId="widget-account-performance"
      isLoading={isLoading}
      error={error}
      className={cn('h-full', className)}
    >
      {!data || !metrics ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No account data available
          </p>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-2">
          {/* ── Account Header Row ─────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Wallet className="size-3.5 shrink-0" />
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {data.account.name}
              </span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span>{data.account.currency}</span>
            </div>

            <div className="flex items-center gap-2">
              {/* Integrity badge (compact pill) */}
              {data.integrity && (
                <IntegrityBadge
                  status={data.integrity.status}
                  count={data.integrity.warnings.length}
                />
              )}

              {/* Refresh button */}
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed dark:hover:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                  title={isRefreshing ? 'Refreshing...' : 'Refresh'}
                >
                  <RefreshCw
                    className={cn('size-3', isRefreshing && 'animate-spin')}
                  />
                  {isRefreshing ? '' : ''}
                </button>
              )}
            </div>
          </div>

          {/* ── Metrics Grid (3 columns, 3 rows = 9 metrics) ───────────── */}
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg border border-zinc-100 bg-zinc-50/50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
            {/* Row 1: Cash, NAV, Marked Positions */}
            <MetricCell
              value={fmt(metrics.cash)}
              label="Cash"
              tooltip="Available cash balance in the account."
            />
            <MetricCell
              value={fmt(metrics.nav)}
              label="NAV"
              tooltip="Net asset value: cash plus marked positions value."
            />
            <MetricCell
              value={fmt(metrics.markedPositions)}
              label="Marked Positions"
              tooltip="Total value of open positions at latest mark prices."
            />

            {/* Row 2: Realized P&L, Unrealized P&L, Realized Fees */}
            <MetricCell
              value={fmtSigned(metrics.realizedPnl)}
              label="Realized P&amp;L"
              valueClassName={pnlColor(metrics.realizedPnl)}
              tooltip="Net realized profit and loss from closed positions."
            />
            <MetricCell
              value={fmtSigned(metrics.unrealizedPnl)}
              label="Unrealized P&amp;L"
              valueClassName={pnlColor(metrics.unrealizedPnl)}
              tooltip="Unrealized profit and loss on open positions at latest marks."
            />
            <MetricCell
              value={fmtSigned(metrics.realizedFees)}
              label="Realized Fees"
              valueClassName="text-red-600 dark:text-red-400"
              tooltip="Total fees and commissions incurred on closed positions."
            />

            {/* Row 3: Gross Exposure, Net Exposure, Drawdown */}
            <MetricCell
              value={fmt(metrics.grossExposure)}
              label="Gross Exposure"
              tooltip="Absolute value of all open positions (long + short)."
            />
            <MetricCell
              value={fmtSigned(metrics.netExposure)}
              label="Net Exposure"
              valueClassName={pnlColor(metrics.netExposure)}
              tooltip="Long minus short exposure."
            />
            <MetricCell
              value={
                metrics.drawdown !== null && metrics.drawdownPct !== null
                  ? `${fmt(metrics.drawdown)} (${fmtPct(metrics.drawdownPct)})`
                  : '--'
              }
              label="Drawdown"
              valueClassName="text-red-600 dark:text-red-400"
              tooltip="Peak-to-trough decline from the highest account NAV."
            />
          </div>

          {/* ── Footer: Attribution + Timestamp ─────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
                <BookOpen className="size-2.5" />
                Account performance
              </Badge>
              {data.journalAttribution && (
                <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
                  <Activity className="size-2.5" />
                  Journal: {data.journalAttribution.journalExecutionCount} linked,{' '}
                  {data.journalAttribution.accountOnlyExecutionCount} direct
                </Badge>
              )}
            </div>
            {data.computedAt && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                {new Date(data.computedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}
    </DashboardWidget>
  );
}
