'use client';

import React from 'react';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import { getKpiMetricDefinition, applyUnit, kpiValueClass } from '@/lib/performance-kpi-catalogue';
import { MicroViz } from './kpi-micro-viz';
import { WidgetActionsMenu } from './widget-actions-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { WidgetConfig, PerformanceUnit } from '@/lib/performance-view-types';

// ── Formatting Helpers ──────────────────────────────────────────────────────

function formatCurrencyValue(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercentValue(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRatioValue(value: number): string {
  return value.toFixed(2);
}

function formatRValue(value: number): string {
  return `${value.toFixed(2)}R`;
}

function formatCountValue(value: number): string {
  return value.toString();
}

function formatDurationValue(value: number): string {
  if (value < 1) return `${Math.round(value * 24)}h`;
  return `${value.toFixed(1)}d`;
}

// ── Per-metric supporting data extraction ───────────────────────────────────

interface KpiSupportingData {
  /** Sparkline values (Net P&L): cumulative daily P&L trend. */
  sparklineValues?: number[];
  /** Donut fraction (Win Rate). */
  donutFraction?: number;
  /** Profit-vs-loss split magnitudes (Profit Factor, Payoff Ratio). */
  pnlSplit?: { positive: number; negative: number };
  positiveLabel?: string;
  negativeLabel?: string;
  positiveValue?: string;
  negativeValue?: string;
  showCaptions?: boolean;
  /** Caption layout: stacked (label above value) or inline (label+value on one row). */
  captionLayout?: 'stacked' | 'inline';
}

/**
 * Resolve the supporting micro-visualization data for a KPI card from the
 * canonical analytics payload. Each metric only renders a visualization when
 * the underlying canonical data is present and meaningful — no fabricated
 * or decorative graphics. Formatting stays with the presentation layer; the
 * magnitudes themselves are canonical (grossPnl, avgWin/avgLoss).
 */
function resolveSupportingData(
  widgetType: string,
  kpiMetrics: Record<string, unknown>,
  charts: Record<string, unknown> | undefined,
): KpiSupportingData | null {
  switch (widgetType) {
    case 'net-pnl': {
      const cumulative = charts?.cumulativeDailyPnl as Array<{ cumulativePnl: number }> | undefined;
      const values = cumulative?.map((d) => d.cumulativePnl).filter((v): v is number => typeof v === 'number');
      return values && values.length > 1 ? { sparklineValues: values } : null;
    }
    case 'win-rate': {
      const winRate = kpiMetrics.winRate;
      return typeof winRate === 'number' && Number.isFinite(winRate)
        ? { donutFraction: Math.max(0, Math.min(1, winRate)) }
        : null;
    }
    case 'profit-factor': {
      // Canonical gross profit/loss magnitudes (grossPnl { grossProfit, grossLoss }).
      const grossPnl = kpiMetrics.grossPnl as { grossProfit?: number; grossLoss?: number } | null | undefined;
      const grossProfit = typeof grossPnl?.grossProfit === 'number' ? grossPnl.grossProfit : null;
      const grossLoss = typeof grossPnl?.grossLoss === 'number' ? grossPnl.grossLoss : null;
      if (grossProfit === null || grossLoss === null || grossProfit <= 0 || grossLoss <= 0) return null;
      return {
        pnlSplit: { positive: grossProfit, negative: grossLoss },
        positiveLabel: 'Profit',
        negativeLabel: 'Loss',
        positiveValue: formatCurrencyValue(grossProfit),
        negativeValue: formatCurrencyValue(grossLoss),
        showCaptions: true,
        // Two-sided stacked captions keep both label and value fully readable
        // at 5-across widths (1280-1440px) even with large gross amounts.
        captionLayout: 'stacked',
      };
    }
    case 'payoff-ratio': {
      // Canonical average win/loss magnitudes (avgWin / avgLoss, positive).
      const avgWin = typeof kpiMetrics.avgWin === 'number' ? kpiMetrics.avgWin : null;
      const avgLoss = typeof kpiMetrics.avgLoss === 'number' ? kpiMetrics.avgLoss : null;
      if (avgWin === null || avgLoss === null || avgWin <= 0 || avgLoss <= 0) return null;
      return {
        pnlSplit: { positive: avgWin, negative: avgLoss },
        positiveLabel: 'Avg win',
        negativeLabel: 'Avg loss',
        positiveValue: formatCurrencyValue(avgWin),
        negativeValue: `-${formatCurrencyValue(avgLoss)}`,
        showCaptions: true,
        // Two-sided stacked captions: "Avg win / +$3,363" left, "Avg loss /
        // -$1,373" right — fully readable, no truncation.
        captionLayout: 'stacked',
      };
    }
    default:
      // Average R and other value-first metrics: no supporting visualization.
      return null;
  }
}

// ── KPI Card Component ──────────────────────────────────────────────────────

export interface KpiCardProps {
  instanceId: string;
  widgetType: string;
  config: WidgetConfig;
  onConfigure?: (instanceId: string) => void;
  onDuplicate?: (instanceId: string) => void;
  onRemove?: (instanceId: string) => void;
  onReset?: (instanceId: string) => void;
  editMode?: boolean;
}

export function KpiCard({ instanceId, widgetType, config, onConfigure, onDuplicate, onRemove, onReset, editMode }: KpiCardProps) {
  const { analyticsData, filter, isLoading, error } = usePerformanceDashboard();

  const definition = getKpiMetricDefinition(widgetType);
  const kpiMetrics = (analyticsData?.kpiMetrics ?? {}) as Record<string, unknown>;
  const rawValue = definition ? definition.accessor(kpiMetrics) : null;

  // Determine period-start equity for % conversion (sum of starting balances).
  const metadata = analyticsData?.metadata as { periodStartEquity?: number | null } | undefined;
  const periodStartEquity = metadata?.periodStartEquity ?? null;

  // Determine total initial risk for R conversion (from risk snapshots via kpi metrics)
  const totalInitialRisk = computeTotalInitialRisk(kpiMetrics);

  const unit: PerformanceUnit = config.unit ?? filter.unit;
  const converted = definition
    ? applyUnit(rawValue, definition, unit, { periodStartEquity, totalInitialRisk })
    : { value: null, unit: 'currency' as PerformanceUnit };

  const title = config.titleOverride || definition?.title || widgetType;
  const displayValue = formatValue(converted.value, definition?.formatKind ?? 'currency', converted.unit);

  // P&L direction carried by the value itself → semantic class (tokens.md
  // financial conventions: text-positive / text-negative / muted for zero).
  const valueClass = definition
    ? kpiValueClass(definition.valueSemantics, converted.value)
    : '';

  // Missing ≠ zero (tokens.md): an empty period (no trades in scope) renders
  // em dashes, never a fabricated $0 from a zero sum over zero trades.
  const hasTrades = (analyticsData?.metadata.tradeCount ?? 0) > 0;

  // Supporting micro-visualization (canonical data only; null when absent).
  const charts = analyticsData?.charts as Record<string, unknown> | undefined;
  const support = resolveSupportingData(widgetType, kpiMetrics, charts);

  const microViz = support
    ? support.sparklineValues
      ? ({ kind: 'sparkline' as const, values: support.sparklineValues })
      : support.donutFraction !== undefined
        ? ({ kind: 'donut' as const, fraction: support.donutFraction })
        : support.pnlSplit
          ? ({
              kind: 'pnl-split' as const,
              positive: support.pnlSplit.positive,
              negative: support.pnlSplit.negative,
              positiveLabel: support.positiveLabel,
              negativeLabel: support.negativeLabel,
              positiveValue: support.positiveValue,
              negativeValue: support.negativeValue,
              showCaptions: support.showCaptions,
              captionLayout: support.captionLayout ?? 'stacked',
            })
          : null
    : null;

  // Microviz slot height: right-side sparkline/donut sit in a taller slot than
  // the pnl-split bar. The slot is still fixed and overflow-clipped, so the
  // visualization can never change card height or escape bounds.
  const slotIsSplit = microViz?.kind === 'pnl-split';

  return (
    <div
      data-kpi-card={widgetType}
      className="flex h-kpi-card flex-col rounded-lg border border-border bg-card p-3"
    >
      {/* Header row: title + ⋯ actions menu (edit mode) — pinned to the shared top edge */}
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-xs text-muted-foreground" title={title}>
          {title}
        </div>
        {editMode && (
          <WidgetActionsMenu
            widgetTitle={title}
            onConfigure={onConfigure ? () => onConfigure(instanceId) : undefined}
            onDuplicate={onDuplicate ? () => onDuplicate(instanceId) : undefined}
            onRemove={onRemove ? () => onRemove(instanceId) : undefined}
            onReset={onReset ? () => onReset(instanceId) : undefined}
          />
        )}
      </div>
      {/* Primary value — dominant metric, aligned across all cards */}
      <div
        className={`mt-1 text-kpi font-semibold leading-none tabular-nums ${valueClass}`}
        data-kpi-value={widgetType}
      >
        {isLoading && rawValue === null && !error ? (
          <div data-testid={`kpi-skeleton-${widgetType}`} aria-hidden="true">
            <Skeleton className="h-7 w-20" />
            <span className="sr-only">Loading</span>
          </div>
        ) : error && !analyticsData ? (
          <span className="text-sm font-normal text-destructive" title={error} data-testid={`kpi-error-${widgetType}`}>
            Error loading
          </span>
        ) : rawValue === null || !hasTrades ? (
          '—'
        ) : (
          displayValue
        )}
      </div>
      {/* Micro-viz — reserved fixed slot pinned to the card bottom. The slot is
          fixed-size with overflow-hidden, so the visualization can never change
          card height or escape the card bounds. */}
      {!editMode && microViz && (
        <div
          className={cn(
            'mt-auto flex shrink-0 items-end overflow-hidden',
            slotIsSplit ? 'w-full justify-stretch pt-1' : 'h-14 justify-end',
          )}
          data-kpi-microviz-slot
        >
          {slotIsSplit ? (
            <div className="w-full">
              <MicroViz
                kind="pnl-split"
                positive={microViz.positive}
                negative={microViz.negative}
                positiveLabel={microViz.positiveLabel}
                negativeLabel={microViz.negativeLabel}
                positiveValue={microViz.positiveValue}
                negativeValue={microViz.negativeValue}
                showCaptions={microViz.showCaptions}
                captionLayout={microViz.captionLayout}
              />
            </div>
          ) : (
            <MicroViz
              kind={microViz.kind}
              values={microViz.kind === 'sparkline' ? microViz.values : undefined}
              fraction={microViz.kind === 'donut' ? microViz.fraction : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract total initial risk from kpi metrics if available.
 * Currently the analytics API does not surface total initial risk;
 * R conversion falls back to null (R-multiple guard) when unavailable.
 */
function computeTotalInitialRisk(kpiMetrics: Record<string, unknown>): number | null {
  const v = kpiMetrics.totalInitialRisk;
  return typeof v === 'number' && v > 0 ? v : null;
}

function formatValue(value: number | null, formatKind: string, unit: string): string {
  if (value === null) return '—';
  // Converted unit takes precedence over the native format kind.
  if (unit === 'percent') return formatPercentValue(value);
  if (unit === 'r') return formatRValue(value);
  switch (formatKind) {
    case 'currency':
      return formatCurrencyValue(value);
    case 'percent':
      return formatPercentValue(value);
    case 'ratio':
      return formatRatioValue(value);
    case 'r':
      return formatRValue(value);
    case 'count':
      return formatCountValue(value);
    case 'duration':
      return formatDurationValue(value);
    default:
      return value.toString();
  }
}
