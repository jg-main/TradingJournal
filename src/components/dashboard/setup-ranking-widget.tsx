'use client';

import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
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
import { formatPercent, formatDecimal } from '@/components/dashboard/formatting';
import { cn } from '@/lib/utils';
import type { SetupPerfResult, SampleSizeWarning } from '@/lib/review-dashboard';

// ── Types ──────────────────────────────────────────────────────────────

export interface SetupRankingWidgetProps {
  /** Per-setup performance metrics from the dashboard API */
  setupRanking: SetupPerfResult[];
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "Setup Ranking") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Sample Size Configuration ──────────────────────────────────────────

interface SampleSizeConfig {
  label: string;
  dotColor: string;
  textColor: string;
}

const SAMPLE_SIZE_CONFIG: Record<SampleSizeWarning, SampleSizeConfig> = {
  very_small: {
    label: 'Very small',
    dotColor: 'bg-red-500',
    textColor: 'text-red-600 dark:text-red-400',
  },
  small: {
    label: 'Small',
    dotColor: 'bg-amber-500',
    textColor: 'text-amber-600 dark:text-amber-400',
  },
  moderate: {
    label: 'Moderate',
    dotColor: 'bg-blue-500',
    textColor: 'text-blue-600 dark:text-blue-400',
  },
  adequate: {
    label: 'Adequate',
    dotColor: 'bg-green-500',
    textColor: 'text-green-600 dark:text-green-400',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Sort setup rankings by win rate descending.
 *
 * Items with null win rate sort to the bottom (past items with a win rate),
 * and among nulls they sort by trade count descending.
 */
function sortByWinRateDesc(items: SetupPerfResult[]): SetupPerfResult[] {
  return [...items].sort((a, b) => {
    // Nulls last
    if (a.winRate === null && b.winRate === null) return b.count - a.count;
    if (a.winRate === null) return 1;
    if (b.winRate === null) return -1;
    // Descending by win rate
    return b.winRate - a.winRate;
  });
}

// ── Sample Size Badge ──────────────────────────────────────────────────

function SampleSizeBadge({ warning }: { warning: SampleSizeWarning }) {
  const config = SAMPLE_SIZE_CONFIG[warning];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', config.textColor)}>
      <span className={cn('inline-block size-2 rounded-full', config.dotColor)} />
      {config.label}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Setup ranking widget showing per-setup performance metrics sorted by
 * win rate descending, with sample size warnings (red/amber/blue/green
 * dot indicators).
 *
 * Wraps in a DashboardWidget for consistent loading/error/empty state
 * handling.
 *
 * Columns:
 * - Setup Name: Display name of the trading setup
 * - Win Rate: Win rate percentage
 * - Avg R: Average R-multiple
 * - Trades: Number of closed trades
 * - Sample Size: Visual indicator with colour-coded dot and label
 *
 * @example
 * ```tsx
 * <SetupRankingWidget
 *   setupRanking={data.setupRanking}
 *   isLoading={loading}
 * />
 * ```
 */
export function SetupRankingWidget({
  setupRanking,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'Setup Ranking',
  testId,
}: SetupRankingWidgetProps) {
  const sortedItems = useMemo(
    () => sortByWinRateDesc(setupRanking),
    [setupRanking],
  );

  const hasData = setupRanking.length > 0;

  return (
    <DashboardWidget
      title={title}
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty && !isLoading}
      testId={testId}
    >
      {!hasData && !isLoading && (
        <div className="px-(--card-spacing) pb-(--card-spacing)">
          <EmptyState
            icon={<BarChart3 className="size-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
            title="No setup data available"
            description="Your setup ranking will appear here after you close trades with assigned setups."
          />
        </div>
      )}
      {hasData && (
        <div className="overflow-x-auto px-(--card-spacing)">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Setup Name</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead className="text-right">Avg R</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Sample Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map((item) => (
                <TableRow key={item.setupId ?? '__unknown__'}>
                  <TableCell className="font-medium text-zinc-900 dark:text-zinc-100">
                    {item.setupName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(item.winRate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.avgR !== null ? `${formatDecimal(item.avgR)}R` : '\u2014'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.count}
                  </TableCell>
                  <TableCell className="text-right">
                    <SampleSizeBadge warning={item.sampleSizeWarning} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </DashboardWidget>
  );
}
