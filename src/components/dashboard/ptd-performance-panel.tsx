/**
 * PtdPerformancePanel — compact grouped metric panel replacing the 8
 * individual period-to-date KPI widgets.
 *
 * Groups all PTD metrics (Net P&L, Total Trades, Win Rate, Avg R,
 * Avg Grade, Profit Factor, Avg Win, Avg Loss) into a single dense
 * 3-column grid with no per-metric icons.
 *
 * Loads data via a data-prop pattern — the parent component coordinates
 * fetch and passes KpiMetrics down.
 *
 * Run: npx vitest run src/components/dashboard/ptd-performance-panel.test.tsx
 */

'use client';

import React from 'react';
import { TrendingUp } from 'lucide-react';
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
  formatDecimal,
  gradeLabelFromScore,
  pnlColorClass,
} from './formatting';
import type { KpiMetrics } from './kpi-widgets';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

export interface PtdPerformancePanelProps {
  /** KPI metrics data — when null, shows loading or empty */
  data: KpiMetrics | null;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
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
    <div className="flex flex-col h-10 items-center justify-center">
      <span
        className={cn(
          'text-base font-bold tabular-nums leading-tight text-zinc-900 dark:text-zinc-100',
          valueClassName,
        )}
      >
        {value}
      </span>
      <span className="mt-0.5 text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
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
// Color Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Deterministic color class for profit factor thresholds */
function profitFactorColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (v > 1.5) return 'text-green-600 dark:text-green-400';
  if (v >= 1.0) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compact grouped metric panel for period-to-date performance data.
 *
 * Displays 8 PTD metrics in a dense 3-column grid:
 * - Net P&L, Total Trades, Win Rate
 * - Avg R, Avg Grade, Profit Factor
 * - Avg Win, Avg Loss
 */
export function PtdPerformancePanel({
  data,
  isLoading = false,
  error = null,
  className,
}: PtdPerformancePanelProps) {
  return (
    <DashboardWidget
      title="PTD Performance"
      testId="widget-ptd-performance"
      isLoading={isLoading}
      error={error}
      className={cn('h-full', className)}
    >
      {!data ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No performance data available
          </p>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-2">
          {/* ── Metrics Grid (3 columns, 3 rows = 8 metrics) ──────────── */}
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg border border-zinc-100 bg-zinc-50/50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
            {/* Row 1: Net P&L, Total Trades, Win Rate */}
            <MetricCell
              value={formatCurrency(data.netPnl, { sign: true })}
              label="Net P&amp;L"
              valueClassName={pnlColorClass(data.netPnl)}
              tooltip="Total realized profit and loss across all closed trades."
            />
            <MetricCell
              value={data.totalTrades}
              label="Total Trades"
              tooltip="Total number of trades in your journal."
            />
            <MetricCell
              value={formatPercent(data.winRate)}
              label="Win Rate"
              tooltip="Percentage of closed trades that were profitable."
            />

            {/* Row 2: Avg R, Avg Grade, Profit Factor */}
            <MetricCell
              value={formatDecimal(data.avgR)}
              label="Avg R"
              tooltip="Average risk multiple (R) per trade. R = |entry - stop| / risk per share. Higher is better."
            />
            <MetricCell
              value={
                data.avgGrade !== null && data.avgGrade !== undefined
                  ? `${formatDecimal(data.avgGrade)} (${gradeLabelFromScore(data.avgGrade)})`
                  : '--'
              }
              label="Avg Grade"
              tooltip="Average process quality score. Grades range from A (54-60) to F (0-17)."
            />
            <MetricCell
              value={formatDecimal(data.profitFactor)}
              label="Profit Factor"
              valueClassName={profitFactorColor(data.profitFactor)}
              tooltip="Gross profit / gross loss. &gt; 1.5 is excellent, &lt; 1.0 means losses exceed profits."
            />

            {/* Row 3: Avg Win, Avg Loss */}
            <MetricCell
              value={formatCurrency(data.avgWin)}
              label="Avg Win"
              valueClassName={
                data.avgWin !== null && data.avgWin !== undefined && data.avgWin > 0
                  ? 'text-green-600 dark:text-green-400'
                  : ''
              }
              tooltip="Average P&amp;L of winning trades. Higher is better."
            />
            <MetricCell
              value={formatCurrency(data.avgLoss)}
              label="Avg Loss"
              valueClassName={
                data.avgLoss !== null && data.avgLoss !== undefined && data.avgLoss > 0
                  ? 'text-red-600 dark:text-red-400'
                  : ''
              }
              tooltip="Average absolute P&amp;L of losing trades. Lower (absolute) is better."
            />
            {/* 3rd cell intentionally empty — 8 metrics in a 3-column grid */}
            <div />
          </div>

          {/* ── Footer: Attribution ──────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
                <TrendingUp className="size-2.5" />
                Period-to-Date
              </Badge>
            </div>
          </div>
        </div>
      )}
    </DashboardWidget>
  );
}
