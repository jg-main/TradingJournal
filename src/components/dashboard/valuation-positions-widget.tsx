/**
 * ValuationPositionsWidget — registered dashboard widget wrapping DashboardV2's
 * valuation completeness section.
 *
 * Displays the position detail table with Fresh/Stale/Missing status badges,
 * a summary row showing total position count and mark-status breakdown, and
 * empty/loading/error states consistent with other registered dashboard widgets.
 *
 * Accepts ValuationCompleteness via a data prop — the parent page component
 * coordinates data fetching from /api/dashboard/v2.
 *
 * Run: npx vitest run src/components/dashboard/valuation-positions-widget.test.tsx
 */

'use client';

import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DashboardWidget } from './dashboard-widget';
import type { ValuationCompleteness, DashboardPositionSummary } from '@/components/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ValuationPositionsWidgetProps {
  /** Valuation completeness data — when null, shows loading or empty state */
  data: ValuationCompleteness | null;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Additional CSS class override */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting Helpers (string-based, matching DashboardV2 API contract)
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

/** Direction arrow icon for a position's direction attribute. */
function DirectionIcon({ direction }: { direction: string | null }) {
  if (direction === 'long') {
    return <ArrowUp className="size-3 text-green-600 dark:text-green-400" />;
  }
  if (direction === 'short') {
    return <ArrowDown className="size-3 text-red-600 dark:text-red-400" />;
  }
  return <Minus className="size-3 text-zinc-400" />;
}

/** Badge showing the valuation status of a position. */
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

/**
 * Summary row showing total positions and Fresh/Stale/Missing badge counts.
 */
function ValuationSummary({ data }: { data: ValuationCompleteness }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Positions:
        </span>
        <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {data.positionsTotal}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Badge variant="default">Fresh: {data.fresh}</Badge>
        <Badge variant="secondary">Stale: {data.stale}</Badge>
        <Badge variant="destructive">Missing: {data.missing}</Badge>
      </div>
    </div>
  );
}

/**
 * Position detail table rendering all open positions with mark status.
 */
function PositionTable({ positions }: { positions: DashboardPositionSummary[] }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Position valuation details">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Symbol</TableHead>
            <TableHead className="text-xs">Dir</TableHead>
            <TableHead className="text-xs">Qty</TableHead>
            <TableHead className="text-xs">Avg Cost</TableHead>
            <TableHead className="text-xs">Mark</TableHead>
            <TableHead className="text-xs">Marked Value</TableHead>
            <TableHead className="text-xs">Unrealized</TableHead>
            <TableHead className="text-xs">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((pos) => (
            <TableRow key={pos.instrumentId}>
              <TableCell className="font-medium text-zinc-900 dark:text-zinc-100">
                {pos.symbol}
              </TableCell>
              <TableCell>
                <DirectionIcon direction={pos.direction} />
              </TableCell>
              <TableCell className="text-zinc-700 dark:text-zinc-300">
                {pos.quantity}
              </TableCell>
              <TableCell className="text-zinc-700 dark:text-zinc-300">
                {fmt(pos.averageCost)}
              </TableCell>
              <TableCell className="text-zinc-700 dark:text-zinc-300">
                {pos.markPrice !== null ? fmt(pos.markPrice) : '--'}
              </TableCell>
              <TableCell className="text-zinc-700 dark:text-zinc-300">
                {pos.markedValue !== null ? fmt(pos.markedValue) : '--'}
              </TableCell>
              <TableCell className={pnlColor(pos.unrealizedPnl)}>
                {pos.unrealizedPnl !== null ? fmtSigned(pos.unrealizedPnl) : '--'}
              </TableCell>
              <TableCell>
                <ValuationBadge status={pos.markStatus} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registered dashboard widget displaying valuation completeness for all open
 * positions.
 *
 * Shows a summary row with total position count and Fresh/Stale/Missing badges,
 * followed by a detail table with per-position mark-to-market data:
 * symbol, direction, quantity, average cost, mark price, marked value,
 * unrealized P&L, and mark status.
 */
export function ValuationPositionsWidget({
  data,
  isLoading = false,
  error = null,
  className,
}: ValuationPositionsWidgetProps) {
  return (
    <DashboardWidget
      title="Valuation Positions"
      testId="widget-valuation-positions"
      isLoading={isLoading}
      error={error}
      className={cn('h-full', className)}
    >
      {!data ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No valuation data available
          </p>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          {/* ── Summary Row ───────────────────────────────────────── */}
          <ValuationSummary data={data} />

          {/* ── Position Detail Table ─────────────────────────────── */}
          {data.positions.length > 0 ? (
            <PositionTable positions={data.positions} />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center dark:border-zinc-700">
              <BarChart3 className="mb-2 size-6 text-zinc-300 dark:text-zinc-600" />
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                No open positions
              </p>
              <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                This account has no open positions to valuate.
              </p>
            </div>
          )}
        </div>
      )}
    </DashboardWidget>
  );
}
