'use client';

import React from 'react';
import { TrendingUp } from 'lucide-react';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import {
  formatCurrency,
  formatPercent,
} from '@/components/dashboard/formatting';
import type { DirectionalPerformanceResult } from '@/lib/dashboard';

// ── Types ──────────────────────────────────────────────────────────────

export interface DirectionalPerformanceWidgetProps {
  /** Directional performance data (long/short breakdown), or null if unavailable */
  directionalPerformance: DirectionalPerformanceResult | null;
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "Directional Performance") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Sub-components ─────────────────────────────────────────────────────

interface DirectionColumnProps {
  label: string;
  netPnl: number;
  winRate: number | null;
  tradeCount: number;
}

function DirectionColumn({ label, netPnl, winRate, tradeCount }: DirectionColumnProps) {
  const pnlClass =
    netPnl > 0
      ? 'text-zinc-700 dark:text-zinc-300'
      : netPnl < 0
        ? 'text-red-600 dark:text-red-400'
        : '';

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1.5 p-3">
        <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className={`text-base font-bold tabular-nums ${pnlClass}`}>
              {formatCurrency(netPnl, { sign: true })}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">P&amp;L</p>
          </div>
          <div>
            <p className="text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatPercent(winRate)}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Win Rate</p>
          </div>
          <div>
            <p className="text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {tradeCount}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Trades</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Directional performance widget showing long/short P&L breakdown.
 *
 * Renders a two-column card layout comparing:
 * - Long trades (P&L, Win Rate, Trade Count)
 * - Short trades (P&L, Win Rate, Trade Count)
 *
 * Wraps the content in a DashboardWidget for consistent loading/error/empty
 * state handling.
 *
 * Does NOT use ECharts — this is a pure card-layout widget.
 *
 * @example
 * ```tsx
 * <DirectionalPerformanceWidget
 *   directionalPerformance={data.directionalPerformance}
 * />
 * ```
 */
export function DirectionalPerformanceWidget({
  directionalPerformance,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'Directional Performance',
  testId,
}: DirectionalPerformanceWidgetProps) {
  const hasData = directionalPerformance !== null;

  return (
    <DashboardWidget
      title={title}
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty && !isLoading}
      testId={testId}
    >
      {!hasData && !isLoading && (
        <div className="flex items-center justify-center py-6">
          <EmptyState
            icon={
              <TrendingUp
                className="size-10 text-zinc-300 dark:text-zinc-600"
                strokeWidth={1}
              />
            }
            title="No directional data"
            description="Long/short performance breakdown will appear after you close trades in both directions."
          />
        </div>
      )}
      {hasData && (
        <div className="grid gap-2 sm:grid-cols-2">
          <DirectionColumn
            label="Long"
            netPnl={directionalPerformance.long.netPnl}
            winRate={directionalPerformance.long.winRate}
            tradeCount={directionalPerformance.long.tradeCount}
          />
          <DirectionColumn
            label="Short"
            netPnl={directionalPerformance.short.netPnl}
            winRate={directionalPerformance.short.winRate}
            tradeCount={directionalPerformance.short.tradeCount}
          />
        </div>
      )}
    </DashboardWidget>
  );
}
