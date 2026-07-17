/**
 * KPI card content components extracted from page.tsx.
 *
 * `KpiCardContent` is the inner display (icon, value, label with tooltip)
 * designed to be placed inside `DashboardWidget` or `Card`.
 * `KpiCardSkeleton` provides a matching loading placeholder.
 *
 * Run: npx vitest run src/components/dashboard/kpi-card.test.tsx
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ── Tooltip Content Map ────────────────────────────────────────────────

/**
 * Label-to-tooltip-content mapping for each known KPI metric.
 * Matches the inline ternaries in the original page.tsx.
 */
export const KPI_TOOLTIPS: Record<string, string> = {
  'Profit Factor':
    'Gross profit / gross loss. > 1.5 is excellent, < 1.0 means losses exceed profits.',
  'Avg Win': 'Average P&L of winning trades. Higher is better.',
  'Avg Loss': 'Average absolute P&L of losing trades. Lower (absolute) is better.',
  'Avg R':
    'Average risk multiple (R) per trade. R = |entry - stop| / risk per share. Higher is better.',
  'Avg Grade':
    'Average process quality score. Grades range from A (54-60) to F (0-17).',
  'Current Drawdown':
    "Peak-to-trough decline from your highest account value.",
  'Account Value': 'Current total value of your trading account.',
  'Net P&L': 'Total realized profit and loss across all closed trades.',
  'Win Rate': 'Percentage of closed trades that were profitable.',
  'Total Trades': 'Total number of trades in your journal.',
  'Unrealized P&L':
    'Total unrealized profit/loss across all open positions based on current market prices.',
  'Open Trades': 'Trades currently in an open position.',
};

// ── Types ──────────────────────────────────────────────────────────────

export interface KpiCardContentProps {
  /** Icon element shown in the card header circle */
  icon: React.ReactNode;
  /** Background color class for the icon circle e.g. "bg-zinc-100 dark:bg-zinc-800" */
  iconBg: string;
  /** The rendered value node (formatted string, JSX, etc.) */
  value: React.ReactNode;
  /** Human-readable label for tooltip display */
  label: string;
  /** Optional class override for the value text */
  valueClassName?: string;
  /** Optional tooltip content override. Falls back to KPI_TOOLTIPS map, then the label. */
  tooltipContent?: string;
}

// ── KpiCardContent ─────────────────────────────────────────────────────

/**
 * Inner content of a KPI metric card.
 *
 * Renders the icon, value, and label with tooltip.
 * Designed to be used inside `DashboardWidget` or `Card` wrapper.
 *
 * @example
 * ```tsx
 * <DashboardWidget title="Net P&L">
 *   <KpiCardContent
 *     icon={<Target className="size-4" />}
 *     iconBg="bg-zinc-100 dark:bg-zinc-800"
 *     value={formatCurrency(netPnl, { sign: true })}
 *     label="Net P&amp;L"
 *   />
 * </DashboardWidget>
 * ```
 */
export function KpiCardContent({
  icon,
  iconBg,
  value,
  label,
  valueClassName,
  tooltipContent,
}: KpiCardContentProps) {
  return (
    <div className="flex flex-col gap-0">
      <div
        className={cn(
          'mb-3 flex size-9 items-center justify-center rounded-lg',
          iconBg,
        )}
      >
        {icon}
      </div>
      <p
        className={cn(
          'text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100',
          valueClassName,
        )}
      >
        {value}
      </p>
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 underline decoration-dotted decoration-zinc-300 dark:decoration-zinc-600 underline-offset-2 cursor-help">
            {label}
          </p>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64 text-xs">
          {tooltipContent ?? KPI_TOOLTIPS[label] ?? label}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ── KpiCardSkeleton ────────────────────────────────────────────────────

/**
 * Skeleton placeholder matching the KpiCardContent layout.
 * Used when the widget is loading and DashboardWidget's generic
 * skeleton isn't appropriate.
 */
export function KpiCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-3 size-9 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      <div className="mb-1 h-7 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-3 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}
