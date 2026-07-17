'use client';

import React, { useState } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { EmptyState } from '@/components/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent, formatDecimal } from '@/components/dashboard/formatting';
import type { PeriodMatrixResult, PeriodComparisonType } from '@/lib/period-matrix';

// ── Types ──────────────────────────────────────────────────────────────

export interface PeriodMatrixWidgetProps {
  /** Period matrix data for all comparison types (keyed by type) */
  periodMatrixData: Record<string, PeriodMatrixResult> | null;
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "Period Comparison") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Period Type Labels ─────────────────────────────────────────────────

const PERIOD_TYPE_OPTIONS: { value: PeriodComparisonType; label: string; shortLabel: string; description: string }[] = [
  { value: 'wow', label: 'Week over Week', shortLabel: 'WoW', description: 'This week vs last week' },
  { value: 'mom', label: 'Month over Month', shortLabel: 'MoM', description: 'This month vs last month' },
  { value: 'qoq', label: 'Quarter over Quarter', shortLabel: 'QoQ', description: 'This quarter vs last quarter' },
];

// ── Delta Helpers ──────────────────────────────────────────────────────

type DeltaDirection = 'up' | 'down' | 'flat' | 'none';

/**
 * Determine the direction indicator for a delta value.
 *
 * For metrics where higher is better (winRate, pnl, avgR):
 * positive → up (green), negative → down (red), zero → flat (grey)
 *
 * @param value   The delta value (or null if unavailable)
 * @param metric  Which metric is being displayed
 * @returns       Arrow character and color class
 */
function getDeltaIndicator(value: number | null, metric: 'winRate' | 'pnl' | 'tradeCount' | 'avgR'): {
  direction: DeltaDirection;
  arrow: string;
  colorClass: string;
} {
  if (value === null || value === undefined) {
    return { direction: 'none', arrow: '\u2014', colorClass: 'text-zinc-400 dark:text-zinc-500' };
  }

  // For all metrics, positive/negative/zero determines direction.
  // "Higher is better" metrics are winRate, pnl, avgR.
  // tradeCount is neutral (no inherent better/worse).
  if (value > 0) {
    const isImprovement = metric === 'winRate' || metric === 'pnl' || metric === 'avgR';
    return {
      direction: 'up',
      arrow: '\u25B2',
      colorClass: isImprovement
        ? 'text-green-600 dark:text-green-400'
        : 'text-zinc-500 dark:text-zinc-400',
    };
  }
  if (value < 0) {
    const isImprovement = metric === 'winRate' || metric === 'pnl' || metric === 'avgR';
    return {
      direction: 'down',
      arrow: '\u25BC',
      colorClass: isImprovement
        ? 'text-red-600 dark:text-red-400'
        : 'text-zinc-500 dark:text-zinc-400',
    };
  }
  return { direction: 'flat', arrow: '\u25B6', colorClass: 'text-zinc-400 dark:text-zinc-500' };
}

/**
 * Format a delta value with sign and appropriate display.
 *
 * @param value  The delta to format
 * @param metric Which metric this belongs to
 * @returns      Formatted string (e.g. "+$500.00", "-15.2%", "+3")
 */
function formatDeltaValue(value: number | null, metric: 'winRate' | 'pnl' | 'tradeCount' | 'avgR'): string {
  if (value === null || value === undefined) return '\u2014';

  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  switch (metric) {
    case 'winRate':
      return `${prefix}${formatPercent(Math.abs(value))}`;
    case 'pnl':
      return `${prefix}${formatCurrency(Math.abs(value))}`;
    case 'tradeCount':
      return `${prefix}${Math.abs(value)}`;
    case 'avgR':
      return `${prefix}${formatDecimal(Math.abs(value))}R`;
  }
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Period-over-period comparison matrix widget.
 *
 * Shows a configurable comparison table (WoW/MoM/QoQ) with win rate,
 * P&L, trade count, and avg R columns. Each row compares a current
 * period against its immediate predecessor, with delta indicators
 * (arrows/colors) showing improvement or deterioration.
 *
 * Wraps in a DashboardWidget for consistent loading/error/empty state
 * handling.
 *
 * @example
 * ```tsx
 * <PeriodMatrixWidget
 *   periodMatrixData={data.periodMatrix}
 *   isLoading={loading}
 * />
 * ```
 */
export function PeriodMatrixWidget({
  periodMatrixData,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'Period Comparison',
  testId,
}: PeriodMatrixWidgetProps) {
  const [selectedType, setSelectedType] = useState<PeriodComparisonType>('wow');

  // Determine if data exists for the selected type
  const currentResult = periodMatrixData?.[selectedType] ?? null;
  const hasRows = currentResult !== null && currentResult.rows.length > 0;
  const hasAnyData =
    periodMatrixData !== null &&
    Object.values(periodMatrixData).some((r) => r.rows.length > 0);

  // On data change, auto-switch to a type with data if the current
  // selection has no rows. Does NOT react to user interaction clicks
  // (selectedType omitted from deps array intentionally).
  React.useEffect(() => {
    if (periodMatrixData && !periodMatrixData[selectedType]?.rows.length) {
      const hasAnyData = Object.values(periodMatrixData).some((r) => r.rows.length > 0);
      if (hasAnyData) {
        for (const opt of PERIOD_TYPE_OPTIONS) {
          if (periodMatrixData[opt.value]?.rows.length) {
            setSelectedType(opt.value);
            break;
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodMatrixData]);

  return (
    <DashboardWidget
      title={title}
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty && !isLoading}
      testId={testId}
    >
      {!hasAnyData && !isLoading && (
        <div className="px-(--card-spacing) pb-(--card-spacing)">
          <EmptyState
            icon={<BarChart3 className="size-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
            title="No comparison data available"
            description="Your period-over-period performance matrix will appear here after you close trades across multiple periods."
          />
        </div>
      )}
      {hasAnyData && (
        <>
          {/* Period type selector */}
          <div className="mb-2 flex flex-wrap gap-1 px-(--card-spacing)">
            {PERIOD_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedType(opt.value)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  selectedType === opt.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/30 dark:text-blue-300'
                    : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
                )}
                title={opt.description}
              >
                {opt.shortLabel}
              </button>
            ))}
          </div>

          {hasRows ? (
            <div className="overflow-x-auto px-(--card-spacing)">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Period</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">P&amp;L</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Avg R</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentResult!.rows.map((row, rowIdx) => {
                    const pairLabel = `${row.current.periodLabel} vs ${row.previous.periodLabel}`;
                    const isLastRow = rowIdx === currentResult!.rows.length - 1;

                    return (
                      <React.Fragment key={`pair-${row.current.periodId}-${row.previous.periodId}`}>
                        {/* Section header: pair label */}
                        <TableRow className="border-0">
                          <TableCell
                            colSpan={5}
                            className="px-0 pb-0 pt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                          >
                            {pairLabel}
                          </TableCell>
                        </TableRow>

                        {/* Current period row */}
                        <TableRow className="hover:bg-transparent">
                          <TableCell className="font-medium text-zinc-900 dark:text-zinc-100">
                            {row.current.periodLabel}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(row.current.winRate)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums font-medium',
                              (row.current.pnl) >= 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400',
                            )}
                          >
                            {formatCurrency(row.current.pnl, { sign: true })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.current.tradeCount}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.current.avgR !== null ? `${formatDecimal(row.current.avgR)}R` : '\u2014'}
                          </TableCell>
                        </TableRow>

                        {/* Previous period row */}
                        <TableRow className="text-zinc-500 dark:text-zinc-400 hover:bg-transparent">
                          <TableCell>{row.previous.periodLabel}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(row.previous.winRate)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              (row.previous.pnl) >= 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400',
                            )}
                          >
                            {formatCurrency(row.previous.pnl, { sign: true })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.previous.tradeCount}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.previous.avgR !== null ? `${formatDecimal(row.previous.avgR)}R` : '\u2014'}
                          </TableCell>
                        </TableRow>

                        {/* Delta row */}
                        {row.delta && (
                          <TableRow
                            className={cn(
                              'border-0 text-xs hover:bg-transparent',
                              isLastRow ? 'border-b-0' : '',
                            )}
                          >
                            <TableCell className="text-zinc-500 dark:text-zinc-400 italic">
                              Change
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {renderDeltaCell(row.delta.winRate, 'winRate')}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {renderDeltaCell(row.delta.pnl, 'pnl')}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {renderDeltaCell(row.delta.tradeCount, 'tradeCount')}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {renderDeltaCell(row.delta.avgR, 'avgR')}
                            </TableCell>
                          </TableRow>
                        )}

                        {/* Spacer between comparison pairs (except last) */}
                        {!isLastRow && (
                          <TableRow className="border-0 hover:bg-transparent">
                            <TableCell colSpan={5} className="py-0">
                              <div className="border-b border-dashed border-zinc-200 dark:border-zinc-700" />
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-6">
              <EmptyState
                icon={<TrendingUp className="size-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
                title="No comparison data"
                description={`No data available for ${PERIOD_TYPE_OPTIONS.find((o) => o.value === selectedType)?.label ?? selectedType} comparison.`}
              />
            </div>
          )}
        </>
      )}
    </DashboardWidget>
  );
}

// ── Delta Cell Renderer ────────────────────────────────────────────────

/**
 * Render a single delta cell with arrow indicator and coloured value.
 */
function renderDeltaCell(value: number | null, metric: 'winRate' | 'pnl' | 'tradeCount' | 'avgR') {
  const { arrow, colorClass } = getDeltaIndicator(value, metric);
  const formatted = formatDeltaValue(value, metric);

  return (
    <span className={cn('inline-flex items-center gap-1', colorClass)}>
      <span className="text-[10px] leading-none">{arrow}</span>
      <span>{formatted}</span>
    </span>
  );
}
