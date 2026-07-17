'use client';

import React from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Lightbulb,
} from 'lucide-react';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import type { AttentionInsight, InsightSeverity } from '@/lib/attention-insights';

// ── Types ──────────────────────────────────────────────────────────────

export interface AttentionInsightsWidgetProps {
  /** Attention insights array from the attention-insights library */
  insights: AttentionInsight[];
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "Attention Insights") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Severity Configuration ─────────────────────────────────────────────

interface SeverityConfig {
  label: string;
  borderColor: string;
  iconColor: string;
  bgColor: string;
  badgeBg: string;
  badgeText: string;
  Icon: React.ComponentType<{ className?: string; size?: number }>;
}

const SEVERITY_CONFIG: Record<InsightSeverity, SeverityConfig> = {
  critical: {
    label: 'Critical',
    borderColor: 'border-l-red-500',
    iconColor: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-950/20',
    badgeBg: 'bg-red-100 dark:bg-red-900/40',
    badgeText: 'text-red-700 dark:text-red-300',
    Icon: AlertTriangle,
  },
  warning: {
    label: 'Warning',
    borderColor: 'border-l-amber-500',
    iconColor: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/20',
    badgeBg: 'bg-amber-100 dark:bg-amber-900/40',
    badgeText: 'text-amber-700 dark:text-amber-300',
    Icon: AlertCircle,
  },
  info: {
    label: 'Info',
    borderColor: 'border-l-blue-500',
    iconColor: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/20',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/40',
    badgeText: 'text-blue-700 dark:text-blue-300',
    Icon: Info,
  },
};

// ── Type Label Map ─────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  no_stop_loss: 'Risk',
  day_of_week_best: 'Pattern',
  day_of_week_worst: 'Pattern',
  ungraded_trades: 'Process',
  top_trade: 'Performance',
  worst_trade: 'Performance',
  win_streak: 'Momentum',
  losing_streak: 'Momentum',
  setup_diversity: 'Setup',
  setup_concentration: 'Setup',
  unclassified_setups: 'Setup',
};

function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

// ── Sub-components ─────────────────────────────────────────────────────

function SeverityBadge({
  severity,
  type,
}: {
  severity: InsightSeverity;
  type: string;
}) {
  const config = SEVERITY_CONFIG[severity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        config.badgeBg,
        config.badgeText,
      )}
    >
      <config.Icon className="size-3" />
      {getTypeLabel(type)}
    </span>
  );
}

function InsightValueBadge({ value }: { value: number | string }) {
  const displayValue = typeof value === 'number' ? String(value) : value;
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
      {displayValue}
    </span>
  );
}

function InsightCard({ insight }: { insight: AttentionInsight }) {
  const config = SEVERITY_CONFIG[insight.severity];
  const { Icon } = config;

  return (
    <div
      className={cn(
        'flex gap-2 border-l-4 p-2',
        config.borderColor,
        config.bgColor,
      )}
    >
      <div className={cn('mt-0.5 shrink-0', config.iconColor)}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <SeverityBadge severity={insight.severity} type={insight.type} />
          </div>
          {insight.value !== undefined && (
            <InsightValueBadge value={insight.value} />
          )}
        </div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {insight.title}
        </h4>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {insight.message}
        </p>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Attention insights widget showing deterministic observations surfaced
 * from trade data by the attention-insights.ts library.
 *
 * Each insight is displayed as a severity-coloured card with:
 * - Left border stripe matching severity (red=critical, amber=warning, blue=info)
 * - Type badge (Risk, Pattern, Process, Performance, Momentum, Setup)
 * - Title (short headline)
 * - Message (human-readable description)
 * - Optional value badge (numeric or string)
 *
 * Insights are sorted by severity: critical first, then warning, then info.
 *
 * Wraps in a DashboardWidget for consistent loading/error/empty state
 * handling.
 *
 * @example
 * ```tsx
 * <AttentionInsightsWidget
 *   insights={data.attentionInsights}
 *   isLoading={loading}
 * />
 * ```
 */
export function AttentionInsightsWidget({
  insights,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'Attention Insights',
  testId,
}: AttentionInsightsWidgetProps) {
  const hasData = insights.length > 0;

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
            icon={
              <Lightbulb
                className="size-10 text-zinc-300 dark:text-zinc-600"
                strokeWidth={1}
              />
            }
            title="No insights yet"
            description="Trading insights will appear here as you build a track record. They surface useful patterns and potential issues from your trade data."
          />
        </div>
      )}
      {hasData && (
        <div className="flex flex-col gap-2 px-(--card-spacing)">
          {insights.map((insight, index) => (
            <InsightCard
              key={`${insight.type}-${index}`}
              insight={insight}
            />
          ))}
        </div>
      )}
    </DashboardWidget>
  );
}
