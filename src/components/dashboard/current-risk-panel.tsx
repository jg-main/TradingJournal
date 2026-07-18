/**
 * CurrentRiskPanel — compact 9-metric risk panel from /api/dashboard/v2.
 *
 * Displays a dense 3x3 grid of live risk metrics using RiskSummary and
 * ValuationCompleteness from the v2 API endpoint. Metrics include: Open
 * Positions, Open P&L, Open Risk, Portfolio Heat, Positions Without Stops,
 * Fresh/Stale/Missing Prices, and Largest Exposure.
 *
 * No standalone refresh button — live MTM refresh is handled by the parent
 * via visibility polling (S05).
 *
 * Run: npx vitest run src/components/dashboard/current-risk-panel.test.tsx
 */

'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';
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
import type {
  RiskSummary,
  ValuationCompleteness,
  DashboardPositionSummary,
} from '@/components/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CurrentRiskPanelProps {
  /** Risk summary data from /api/dashboard/v2 — when null, shows empty state */
  riskSummary: RiskSummary | null;
  /** Valuation completeness data from /api/dashboard/v2 */
  valuation: ValuationCompleteness | null;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Additional CSS class override */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the largest exposure (max markedValue) from an array of positions.
 * Returns null for empty positions or when no positions have a parsable marked value.
 */
export function computeLargestExposure(
  positions: DashboardPositionSummary[],
): number | null {
  if (!positions || positions.length === 0) return null;
  const values = positions
    .map((p) => (p.markedValue !== null ? parseFloat(p.markedValue) : null))
    .filter((v): v is number => v !== null && !isNaN(v));
  if (values.length === 0) return null;
  return Math.max(...values);
}

/**
 * Safely parse a canonical decimal string to a number.
 * Returns null for null/undefined/NaN inputs.
 */
function parseDecimal(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
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
 * Compact 3x3 risk metric panel driven by /api/dashboard/v2 data.
 *
 * Row 1: Open Positions | Open P&L | Open Risk
 * Row 2: Portfolio Heat | Positions Without Stops | Largest Exposure
 * Row 3: Fresh Prices | Stale Prices | Missing Prices
 *
 * No standalone refresh button — live MTM comes from parent visibility polling.
 */
export function CurrentRiskPanel({
  riskSummary,
  valuation,
  isLoading = false,
  error = null,
  className,
}: CurrentRiskPanelProps) {
  // ── Derive values ────────────────────────────────────────────────

  const openPnlNum = parseDecimal(riskSummary?.openPnl ?? null);
  const openRiskNum = parseDecimal(riskSummary?.openRisk ?? null);
  const portfolioHeatNum = parseDecimal(riskSummary?.portfolioHeat ?? null);
  const largestExposure = valuation?.positions
    ? computeLargestExposure(valuation.positions)
    : null;

  // ── Empty state ──────────────────────────────────────────────────

  const showEmpty = !riskSummary;

  return (
    <DashboardWidget
      title="Current Risk"
      testId="widget-current-risk"
      isLoading={isLoading}
      error={error}
      className={cn('h-full', className)}
    >
      {showEmpty ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No risk data available
          </p>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-2">
          {/* ── 3x3 Metrics Grid ─────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg border border-zinc-100 bg-zinc-50/50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
            {/* Row 1: Open Positions */}
            <MetricCell
              value={valuation?.positionsTotal ?? '--'}
              label="Open Positions"
              tooltip="Total number of open positions across all instruments."
            />

            {/* Row 1: Open P&L */}
            <MetricCell
              value={
                openPnlNum !== null
                  ? formatCurrency(openPnlNum, { sign: true })
                  : '--'
              }
              label="Open P&amp;L"
              valueClassName={
                openPnlNum !== null ? pnlColorClass(openPnlNum) : ''
              }
              tooltip="Total unrealized profit/loss across all open positions."
            />

            {/* Row 1: Open Risk */}
            <MetricCell
              value={
                openRiskNum !== null
                  ? formatCurrency(openRiskNum)
                  : '--'
              }
              label="Open Risk"
              tooltip="Total initial risk (R) across all open journal trades."
            />

            {/* Row 2: Portfolio Heat */}
            <MetricCell
              value={
                portfolioHeatNum !== null
                  ? formatPercent(portfolioHeatNum)
                  : '--'
              }
              label="Portfolio Heat"
              tooltip="Open risk as a percentage of net asset value."
            />

            {/* Row 2: Positions Without Stops */}
            <MetricCell
              value={
                <Badge
                  variant={
                    (riskSummary?.missingStops ?? 0) > 0
                      ? 'destructive'
                      : 'outline'
                  }
                  className="text-xs"
                >
                  {riskSummary?.missingStops ?? '--'}
                </Badge>
              }
              label="Positions Without Stops"
              tooltip="Number of open trades without a planned stop loss."
            />

            {/* Row 2: Largest Exposure */}
            <MetricCell
              value={
                largestExposure !== null
                  ? formatCurrency(largestExposure)
                  : '--'
              }
              label="Largest Exposure"
              tooltip="Largest single position by marked value."
            />

            {/* Row 3: Fresh Prices */}
            <MetricCell
              value={
                <Badge variant="default" className="text-xs">
                  {valuation?.fresh ?? '--'}
                </Badge>
              }
              label="Fresh Prices"
              tooltip="Number of positions with current market prices."
            />

            {/* Row 3: Stale Prices */}
            <MetricCell
              value={
                <Badge variant="secondary" className="text-xs">
                  {valuation?.stale ?? '--'}
                </Badge>
              }
              label="Stale Prices"
              tooltip="Number of positions with prices older than the freshness threshold."
            />

            {/* Row 3: Missing Prices */}
            <MetricCell
              value={
                <Badge variant="destructive" className="text-xs">
                  {valuation?.missing ?? '--'}
                </Badge>
              }
              label="Missing Prices"
              tooltip="Number of positions with no price data available."
            />
          </div>

          {/* ── Footer: Attribution Badge ────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[10px] font-normal"
            >
              <AlertCircle className="size-2.5" />
              Current state
            </Badge>
          </div>
        </div>
      )}
    </DashboardWidget>
  );
}
