/**
 * CurrentRiskPanel — compact grouped metric panel replacing the 3
 * individual current-state KPI widgets.
 *
 * Groups all current-state metrics (Account Value, Current Drawdown,
 * Unrealized P&L) into a single dense 3-column grid with no per-metric
 * icons.
 *
 * Accepts KpiMetrics for Account Value / Drawdown, and MtmData for
 * Unrealized P&L (including special "Awaiting prices" / "No open positions"
 * states). The parent component coordinates fetch and passes data down.
 *
 * Run: npx vitest run src/components/dashboard/current-risk-panel.test.tsx
 */

'use client';

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DashboardWidget } from './dashboard-widget';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  formatCurrency,
  formatPercent,
  pnlColorClass,
} from './formatting';
import type { KpiMetrics, MtmData } from './kpi-widgets';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CurrentRiskPanelProps {
  /** KPI metrics data — when null, shows loading or empty */
  data: KpiMetrics | null;
  /** MTM data for the Unrealized P&L row */
  mtm?: MtmData | null;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Callback for refresh action (triggers MTM re-fetch) */
  onRefresh?: () => void;
  /** Whether a refresh is currently in progress */
  isRefreshing?: boolean;
  /** Additional CSS class override */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Metric Cell
// ═══════════════════════════════════════════════════════════════════════════

interface MetricCellProps {
  value: React.ReactNode;
  label: string;
  tooltip?: string;
  valueClassName?: string;
}

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
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compact grouped metric panel for current risk / state data.
 *
 * Displays 3 key metrics in a single 3-column row:
 * - Account Value, Current Drawdown, Unrealized P&L
 *
 * Unrealized P&L supports three states: formatted P&L, "Awaiting prices"
 * (open positions with no price data), and "No open positions".
 */
export function CurrentRiskPanel({
  data,
  mtm,
  isLoading = false,
  error = null,
  onRefresh,
  isRefreshing = false,
  className,
}: CurrentRiskPanelProps) {
  // ── Derive the Unrealized P&L value node ─────────────────────────
  const unrealizedValue = React.useMemo(() => {
    if (!mtm) return '--';
    if (mtm.netUnrealizedPnl !== null && mtm.netUnrealizedPnl !== undefined) {
      return formatCurrency(mtm.netUnrealizedPnl, { sign: true });
    }
    if (mtm.openTradeCount > 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 italic">
          <AlertCircle className="size-3 shrink-0" />
          Awaiting prices
        </span>
      );
    }
    return (
      <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">
        No open positions
      </span>
    );
  }, [mtm]);

  const unrealizedValueClass =
    mtm?.netUnrealizedPnl !== null && mtm?.netUnrealizedPnl !== undefined
      ? pnlColorClass(mtm.netUnrealizedPnl)
      : '';

  return (
    <DashboardWidget
      title="Current Risk"
      testId="widget-current-risk"
      isLoading={isLoading}
      error={error}
      className={cn('h-full', className)}
    >
      {!data ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No risk data available
          </p>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-2">
          {/* ── Metrics Grid (3 columns, 1 row = 3 metrics) ───────────── */}
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg border border-zinc-100 bg-zinc-50/50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
            <MetricCell
              value={formatCurrency(data.accountValue)}
              label="Account Value"
              tooltip="Current total value of your trading account."
            />
            <MetricCell
              value={
                data.currentDrawdown !== null && data.currentDrawdown !== undefined
                  ? `${formatCurrency(Math.abs(data.currentDrawdown))}${
                      data.currentDrawdownPct !== null && data.currentDrawdownPct !== undefined
                        ? ` (${formatPercent(Math.abs(data.currentDrawdownPct))})`
                        : ''
                    }`
                  : '--'
              }
              label="Current Drawdown"
              valueClassName="text-red-600 dark:text-red-400"
              tooltip="Peak-to-trough decline from your highest account value."
            />
            <MetricCell
              value={unrealizedValue}
              label="Unrealized P&amp;L"
              valueClassName={unrealizedValueClass}
              tooltip="Total unrealized profit/loss across all open positions based on current market prices."
            />
          </div>

          {/* ── Footer: Attribution + MTM Refresh ────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-1">
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[10px] font-normal"
            >
              <AlertCircle className="size-2.5" />
              Current state
            </Badge>

            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed dark:hover:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                title={
                  isRefreshing
                    ? 'Refreshing...'
                    : 'Refresh prices from market data'
                }
              >
                <RefreshCw
                  className={cn('size-3', isRefreshing && 'animate-spin')}
                />
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
          </div>
        </div>
      )}
    </DashboardWidget>
  );
}
