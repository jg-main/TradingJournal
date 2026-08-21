'use client';

import React from 'react';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import { getKpiMetricDefinition, applyUnit } from '@/lib/performance-kpi-catalogue';
import { MicroViz } from './kpi-micro-viz';
import { WidgetActionsMenu } from './widget-actions-menu';
import { Skeleton } from '@/components/ui/skeleton';
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

// ── KPI Card Component ──────────────────────────────────────────────────────

export interface KpiCardProps {
  instanceId: string;
  widgetType: string;
  config: WidgetConfig;
  onConfigure?: (instanceId: string, config: WidgetConfig) => void;
  onDuplicate?: (instanceId: string) => void;
  onRemove?: (instanceId: string) => void;
  onReset?: (instanceId: string) => void;
  editMode?: boolean;
}

export function KpiCard({ instanceId, widgetType, config, onConfigure, onDuplicate, onRemove, onReset, editMode }: KpiCardProps) {
  const { analyticsData, filter, isLoading, error } = usePerformanceDashboard();

  const definition = getKpiMetricDefinition(widgetType);
  const rawValue = definition ? definition.accessor((analyticsData?.kpiMetrics ?? {}) as Record<string, unknown>) : null;

  // Determine period-start equity for % conversion (sum of starting balances).
  const metadata = analyticsData?.metadata as { periodStartEquity?: number | null } | undefined;
  const periodStartEquity = metadata?.periodStartEquity ?? null;

  // Determine total initial risk for R conversion (from risk snapshots via kpi metrics)
  const totalInitialRisk = computeTotalInitialRisk(analyticsData?.kpiMetrics);

  const unit: PerformanceUnit = filter.unit;
  const converted = definition
    ? applyUnit(rawValue, definition, unit, { periodStartEquity, totalInitialRisk })
    : { value: null, unit: 'currency' as PerformanceUnit };

  const title = config.titleOverride || definition?.title || widgetType;
  const displayValue = formatValue(converted.value, definition?.formatKind ?? 'currency', converted.unit);

  // Micro-visualization: sparkline for Net P&L (cumulative trend), donut for Win Rate.
  const charts = analyticsData?.charts as Record<string, unknown> | undefined;
  const cumulative = charts?.cumulativeDailyPnl as Array<{ cumulativePnl: number }> | undefined;
  const microViz =
    widgetType === 'net-pnl' && cumulative && cumulative.length > 1
      ? { kind: 'sparkline' as const, values: cumulative.map((d) => d.cumulativePnl) }
      : widgetType === 'win-rate' && rawValue !== null
        ? { kind: 'donut' as const, fraction: Math.max(0, Math.min(1, rawValue)) }
        : null;

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
            onConfigure={onConfigure ? () => onConfigure(instanceId, config) : undefined}
            onDuplicate={onDuplicate ? () => onDuplicate(instanceId) : undefined}
            onRemove={onRemove ? () => onRemove(instanceId) : undefined}
            onReset={onReset ? () => onReset(instanceId) : undefined}
          />
        )}
      </div>
      {/* Primary value — fixed top block, aligned across all cards */}
      <div className="mt-1 text-lg font-semibold leading-none tabular-nums" data-kpi-value={widgetType}>
        {isLoading && rawValue === null && !error ? (
          <div data-testid={`kpi-skeleton-${widgetType}`} aria-hidden="true">
            <Skeleton className="h-5 w-16" />
            <span className="sr-only">Loading</span>
          </div>
        ) : error && !analyticsData ? (
          <span className="text-xs font-normal text-destructive" title={error} data-testid={`kpi-error-${widgetType}`}>
            Error loading
          </span>
        ) : (
          displayValue
        )}
      </div>
      {/* Micro-viz — reserved fixed slot pinned to the card bottom. The slot is
          fixed-size with overflow-hidden, so the visualization can never change
          card height or escape the card bounds. */}
      {!editMode && microViz && (
        <div className="mt-auto flex h-10 shrink-0 items-end justify-end overflow-hidden" data-kpi-microviz-slot>
          <MicroViz
            kind={microViz.kind}
            values={microViz.kind === 'sparkline' ? microViz.values : undefined}
            fraction={microViz.kind === 'donut' ? microViz.fraction : undefined}
          />
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
function computeTotalInitialRisk(kpiMetrics: unknown): number | null {
  const k = kpiMetrics as Record<string, unknown> | null | undefined;
  const v = k?.totalInitialRisk;
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
