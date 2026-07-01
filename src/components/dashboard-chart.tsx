'use client';

import type { EChartsReactProps, EChartsOption } from 'echarts-for-react';
import ReactECharts from 'echarts-for-react';
import { cn } from '@/lib/utils';

export interface DashboardChartProps
  extends Omit<EChartsReactProps, 'option' | 'opts'> {
  /** ECharts option object defining the chart configuration */
  option: EChartsOption;
  /** Chart height in pixels (default: 300) */
  height?: number;
  /** Chart width as CSS value (default: '100%') */
  width?: string | number;
  /** Optional className for the container div */
  className?: string;
}

/**
 * Reusable ECharts chart wrapper for dashboard visualizations.
 *
 * Handles:
 * - Canvas renderer for optimal performance
 * - Auto-resize on window resize (built into echarts-for-react)
 * - Clean disposal on unmount (built into echarts-for-react)
 *
 * Downstream slices provide their own option objects for specific chart types.
 */
export function DashboardChart({
  option,
  height = 300,
  width = '100%',
  theme,
  className,
  showLoading,
  loadingOption,
  onChartReady,
  onEvents,
  notMerge,
  lazyUpdate,
  style,
  ...divProps
}: DashboardChartProps) {
  return (
    <div
      className={cn('dashboard-chart', className)}
      style={{ width, height, ...style }}
      {...divProps}
    >
      <ReactECharts
        option={option}
        theme={theme}
        notMerge={notMerge}
        lazyUpdate={lazyUpdate}
        showLoading={showLoading}
        loadingOption={loadingOption}
        onChartReady={onChartReady}
        onEvents={onEvents}
        opts={{ renderer: 'canvas' }}
        autoResize
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
