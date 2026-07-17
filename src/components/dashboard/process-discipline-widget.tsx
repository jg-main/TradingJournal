'use client';

import React from 'react';
import { BarChart3 } from 'lucide-react';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { DashboardChart } from '@/components/dashboard-chart';
import { EmptyState } from '@/components/empty-state';
import type { ProcessScoreBin } from '@/lib/dashboard';

// ── Types ──────────────────────────────────────────────────────────────

export interface ProcessDisciplineWidgetProps {
  /** Grade distribution bins from the dashboard API */
  processScoreDistribution: ProcessScoreBin[];
  /** Whether the widget is loading data (shows skeleton) */
  isLoading?: boolean;
  /** Error message to display when data fetching fails */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Widget title (default: "Process Discipline") */
  title?: string;
  /** Data attribute for test targeting */
  testId?: string;
}

// ── Grade Colour Config ────────────────────────────────────────────────

interface GradeColorConfig {
  barColor: string;
  labelColor: string;
}

const GRADE_COLORS: Record<string, GradeColorConfig> = {
  'A (54-60)': { barColor: '#22c55e', labelColor: '#16a34a' },
  'B (42-53)': { barColor: '#3b82f6', labelColor: '#2563eb' },
  'C (30-41)': { barColor: '#f59e0b', labelColor: '#d97706' },
  'D (18-29)': { barColor: '#f97316', labelColor: '#ea580c' },
  'F (0-17)':  { barColor: '#ef4444', labelColor: '#dc2626' },
};

export function getGradeColor(label: string): GradeColorConfig {
  return GRADE_COLORS[label] ?? { barColor: '#6b7280', labelColor: '#6b7280' };
}

// ── Chart Option Builder ───────────────────────────────────────────────

/**
 * Build the ECharts option for the process discipline bar chart.
 *
 * Single Y-axis showing trade count. Each grade tier (A-F) is a
 * colour-coded bar with the count label displayed directly on top.
 */
export function buildChartOption(bins: ProcessScoreBin[]): Record<string, unknown> | null {
  if (bins.length === 0) return null;

  const labels = bins.map((b) => b.label);
  const counts = bins.map((b) => b.count);
  const colors = bins.map((b) => getGradeColor(b.label).barColor);

  const maxCount = Math.max(...counts, 1);

  return {
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: Array<{ name: string; value: number }>) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const p = params[0];
        return `<strong>${p.name}</strong><br/>Trades: ${p.value}`;
      },
    },
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLabel: {
        fontSize: 12,
        fontWeight: 'bold' as const,
      },
    },
    yAxis: {
      type: 'value' as const,
      min: 0,
      max: Math.ceil(maxCount * 1.25),
      splitLine: {
        lineStyle: {
          type: 'dashed' as const,
          color: 'rgba(0,0,0,0.08)',
        },
      },
    },
    series: [
      {
        type: 'bar' as const,
        barWidth: '60%' as const,
        itemStyle: {
          borderRadius: [4, 4, 0, 0] as [number, number, number, number],
          color: (_params: unknown) => {
            // params is an object with dataIndex; extract it
            const idx = typeof _params === 'object' && _params !== null && 'dataIndex' in _params
              ? (_params as { dataIndex: number }).dataIndex
              : 0;
            return colors[idx] ?? '#6b7280';
          },
        },
        label: {
          show: true,
          position: 'top' as const,
          fontSize: 13,
          fontWeight: 'bold' as const,
          color: '#374151',
          formatter: (params: { value: number }) => {
            return params.value > 0 ? String(params.value) : '';
          },
        },
        data: counts,
      },
    ],
    grid: {
      left: 50,
      right: 20,
      top: 30,
      bottom: 30,
    },
  };
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Process discipline widget showing grade distribution as a colour-coded
 * bar chart (A through F tiers).
 *
 * Each bar is colour-coded by grade tier:
 * - A (54-60): green
 * - B (42-53): blue
 * - C (30-41): amber
 * - D (18-29): orange
 * - F (0-17):  red
 *
 * Trade count labels appear above each bar. The chart shows the count
 * distribution across all five grade tiers.
 *
 * Wraps in a DashboardWidget for consistent loading/error/empty state
 * handling.
 *
 * @example
 * ```tsx
 * <ProcessDisciplineWidget
 *   processScoreDistribution={data.processScoreDistribution}
 *   isLoading={loading}
 * />
 * ```
 */
export function ProcessDisciplineWidget({
  processScoreDistribution,
  isLoading = false,
  error = null,
  isEmpty = false,
  title = 'Process Discipline',
  testId,
}: ProcessDisciplineWidgetProps) {
  const hasData = processScoreDistribution.length > 0;
  const chartOption = hasData ? buildChartOption(processScoreDistribution) : null;

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
            title="No process data available"
            description="Your grade distribution chart will appear here after you grade your trades."
          />
        </div>
      )}
      {hasData && chartOption && (
        <DashboardChart option={chartOption} height={280} />
      )}
    </DashboardWidget>
  );
}
