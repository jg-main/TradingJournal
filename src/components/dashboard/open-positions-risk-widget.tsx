/**
 * OpenPositionsRiskWidget — combined dashboard widget displaying a compact
 * risk summary row above the open positions detail table.
 *
 * Risk Summary: Open P&L, Open Risk, Portfolio Heat, Missing Stops, and
 * Fresh-Stale-Missing mark-status coverage.
 * Position Table: Symbol, Dir, Qty, P&L, Status — per-position details.
 *
 * Consumes ValuationCompleteness (positions + mark-status) and RiskSummary
 * (aggregate risk metrics) from the DashboardV2 API response.
 *
 * Run: npx vitest run src/components/dashboard/open-positions-risk-widget.test.tsx
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
import type {
  ValuationCompleteness,
  DashboardPositionSummary,
  RiskSummary,
} from '@/components/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

export interface OpenPositionsRiskWidgetProps {
  /** Valuation completeness data (positions + mark-status counts). */
  valuation: ValuationCompleteness | null;
  /** Risk summary data (openPnl, openRisk, portfolioHeat, missingStops). */
  riskSummary: RiskSummary | null;
  /** Whether data is currently loading. */
  isLoading?: boolean;
  /** Error message to display. */
  error?: string | null;
  /** Additional CSS class override. */
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

function fmtPct(v: string | null | undefined): string {
  if (v === null || v === undefined) return '--';
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  return `${n.toFixed(1)}%`;
}

function pnlColor(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  const n = parseFloat(v);
  if (isNaN(n)) return '';
  if (n > 0) return 'text-positive';
  if (n < 0) return 'text-negative';
  return 'text-muted-foreground';
}

function pnlBg(v: string | null | undefined): string {
  if (v === null || v === undefined) return 'bg-muted';
  const n = parseFloat(v);
  if (isNaN(n)) return 'bg-muted';
  if (n > 0) return 'bg-positive/10';
  if (n < 0) return 'bg-negative/10';
  return 'bg-muted';
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

/** Direction arrow icon for a position's direction attribute. */
function DirectionIcon({ direction }: { direction: string | null }) {
  if (direction === 'long') {
    return <ArrowUp className="size-3 text-positive" />;
  }
  if (direction === 'short') {
    return <ArrowDown className="size-3 text-negative" />;
  }
  return <Minus className="size-3 text-muted-foreground" />;
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

// ═══════════════════════════════════════════════════════════════════════════
// Risk Summary Row
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compact risk summary row showing aggregate risk metrics and mark-status
 * coverage counts.
 *
 * Layout: Open P&L | Open Risk | Portfolio Heat | Missing Stops | Fresh/Stale/Missing
 */
function RiskSummaryRow({
  risk,
  valuation,
}: {
  risk: RiskSummary;
  valuation: ValuationCompleteness;
}) {
  const missingStopsBadge = risk.missingStops > 0 ? 'destructive' : 'secondary';

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {/* Open P&L */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          Open P&amp;L:
        </span>
        <span
          className={`text-sm font-semibold tabular-nums ${pnlColor(risk.openPnl)}`}
        >
          {fmtSigned(risk.openPnl)}
        </span>
      </div>

      {/* Divider */}
      <span className="hidden text-muted-foreground sm:inline">|</span>

      {/* Open Risk */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          Open Risk:
        </span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {fmt(risk.openRisk)}
        </span>
      </div>

      {/* Divider */}
      <span className="hidden text-muted-foreground sm:inline">|</span>

      {/* Portfolio Heat */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          Portfolio Heat:
        </span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {fmtPct(risk.portfolioHeat)}
        </span>
      </div>

      {/* Divider */}
      <span className="hidden text-muted-foreground sm:inline">|</span>

      {/* Missing Stops */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          Missing Stops:
        </span>
        <Badge variant={missingStopsBadge}>{risk.missingStops}</Badge>
      </div>

      {/* Divider */}
      <span className="hidden text-muted-foreground sm:inline">|</span>

      {/* Fresh / Stale / Missing badges */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          Marks:
        </span>
        <Badge variant="default">Fresh: {valuation.fresh}</Badge>
        <Badge variant="secondary">Stale: {valuation.stale}</Badge>
        <Badge variant="destructive">Missing: {valuation.missing}</Badge>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Position Detail Table
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Position detail table rendering all open positions with risk-relevant
 * columns: Symbol, Dir, Qty, P&L, Status — compact enough to remain
 * readable at minimum widget dimensions (minW: 6, minH: 4).
 */
function PositionTable({
  positions,
}: {
  positions: DashboardPositionSummary[];
}) {
  return (
    <div
      className="overflow-x-auto [&_tr]:h-7 [&_th]:h-7"
      tabIndex={0}
      role="region"
      aria-label="Open positions detail"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Symbol</TableHead>
            <TableHead className="text-xs">Dir</TableHead>
            <TableHead className="text-xs">Qty</TableHead>
            <TableHead className="text-xs">P&amp;L</TableHead>
            <TableHead className="text-xs">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((pos) => (
            <TableRow key={pos.instrumentId}>
              <TableCell className="py-0.5 font-medium text-foreground">
                {pos.symbol}
              </TableCell>
              <TableCell className="py-0.5">
                <DirectionIcon direction={pos.direction} />
              </TableCell>
              <TableCell className="py-0.5 text-foreground">
                {pos.quantity}
              </TableCell>
              <TableCell className={cn('py-0.5', pnlColor(pos.unrealizedPnl))}>
                {pos.unrealizedPnl !== null
                  ? fmtSigned(pos.unrealizedPnl)
                  : '--'}
              </TableCell>
              <TableCell className="py-0.5">
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
 * Combined dashboard widget displaying a compact risk summary row (Open P&L,
 * Open Risk, Portfolio Heat, Missing Stops, Fresh-Stale-Missing counts) above
 * the open positions detail table.
 *
 * This widget subsumes the functionality of ValuationPositionsWidget by
 * incorporating its position table with additional risk context at the
 * aggregate level. It is registered in the widget registry and replaces
 * ValuationPositionsWidget in the default dashboard layout.
 */
export function OpenPositionsRiskWidget({
  valuation,
  riskSummary,
  isLoading = false,
  error = null,
  className,
}: OpenPositionsRiskWidgetProps) {
  return (
    <DashboardWidget
      title="Open Positions & Risk"
      testId="widget-open-positions-risk"
      isLoading={isLoading}
      error={error}
      className={cn('h-full', className)}
    >
      {!valuation || !riskSummary ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No position data available
          </p>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          {/* ── Risk Summary Row ───────────────────────────────────── */}
          <RiskSummaryRow risk={riskSummary} valuation={valuation} />

          {/* ── Position Detail Table ──────────────────────────────── */}
          {valuation.positions.length > 0 ? (
            <PositionTable positions={valuation.positions} />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <BarChart3 className="mb-2 size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-muted-foreground">
                No open positions
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This account has no open positions to display.
              </p>
            </div>
          )}
        </div>
      )}
    </DashboardWidget>
  );
}
