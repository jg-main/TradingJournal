'use client';

import { useCallback, useRef } from 'react';
import type { ECharts } from 'echarts';
import type { EChartsReactProps, EChartsOption } from 'echarts-for-react';
import ReactECharts from 'echarts-for-react';
import { cn } from '@/lib/utils';
import { useChartResize } from '@/hooks/use-chart-resize';

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
  /**
   * When true, uses flex-based layout (h-full) instead of fixed pixel height.
   * The chart fills its parent container via min-h-0 flex-1 h-full w-full classes.
   * A ResizeObserver (via useChartResize hook) keeps echarts in sync with the
   * container dimensions during RGL drag and resize.
   * Default: false.
   */
  flexHeight?: boolean;
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
  flexHeight = false,
  ...divProps
}: DashboardChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const echartsInstanceRef = useRef<ECharts | null>(null);

  // ResizeObserver keeps chart in sync with container during RGL drag
  useChartResize(containerRef, echartsInstanceRef);

  const handleChartReady = useCallback(
    (instance: ECharts) => {
      echartsInstanceRef.current = instance;
      onChartReady?.(instance);
    },
    [onChartReady],
  );

  if (flexHeight) {
    return (
      <div
        ref={containerRef}
        className={cn('dashboard-chart min-h-0 flex-1 h-full w-full', className)}
        style={{ width, ...style }}
        {...divProps}
      >
        <ReactECharts
          option={option}
          theme={theme}
          notMerge={notMerge}
          lazyUpdate={lazyUpdate}
          showLoading={showLoading}
          loadingOption={loadingOption}
          onChartReady={handleChartReady}
          onEvents={onEvents}
          opts={{ renderer: 'canvas' }}
          autoResize
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    );
  }

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
