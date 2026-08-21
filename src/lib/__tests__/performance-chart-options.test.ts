import { describe, it, expect } from 'vitest';
import {
  dailyCumulativePnlOption,
  netDailyPnlOption,
  tradeDurationOption,
  drawdownCurveOption,
  rDistributionOption,
  performanceBySetupOption,
  performanceByDayOfWeekOption,
  performanceByTimeOfDayOption,
  longVsShortOption,
  monthlyPnlOption,
} from '../performance-chart-options';
import { chartPalette } from '../chart-palette';

const palette = chartPalette.light;

describe('performance-chart-options', () => {
  describe('dailyCumulativePnlOption', () => {
    it('builds a line chart from data', () => {
      const option = dailyCumulativePnlOption(
        [{ date: '2024-01-01', cumulativePnl: 100 }, { date: '2024-01-02', cumulativePnl: 250 }],
        palette,
      );
      expect(option).not.toBeNull();
      expect(option!.series).toHaveLength(1);
      expect((option!.series[0] as { data: number[] }).data).toEqual([100, 250]);
    });

    it('returns null for empty data', () => {
      expect(dailyCumulativePnlOption([], palette)).toBeNull();
    });

    it('respects visibleSeries filtering', () => {
      const option = dailyCumulativePnlOption(
        [{ date: '2024-01-01', cumulativePnl: 100 }],
        palette,
        ['other-series'],
      );
      expect((option!.series[0] as { data: number[] }).data).toEqual([]);
    });
  });

  describe('netDailyPnlOption', () => {
    it('colors positive and negative bars', () => {
      const option = netDailyPnlOption(
        [{ date: '2024-01-01', netPnl: 100 }, { date: '2024-01-02', netPnl: -50 }],
        palette,
      );
      const data = option!.series[0].data as Array<{ value: number; itemStyle: { color: string } }>;
      expect(data[0].itemStyle.color).toBe(palette.positive);
      expect(data[1].itemStyle.color).toBe(palette.negative);
    });

    it('returns null for empty data', () => {
      expect(netDailyPnlOption([], palette)).toBeNull();
    });
  });

  describe('tradeDurationOption', () => {
    it('builds buckets with counts', () => {
      const option = tradeDurationOption(
        [
          { bucket: '0-1 days', netPnl: 100, count: 5, winRate: 0.6 },
          { bucket: '2-5 days', netPnl: 0, count: 0, winRate: null },
        ],
        palette,
      );
      expect(option).not.toBeNull();
    });

    it('returns null when no trades in any bucket', () => {
      expect(tradeDurationOption([{ bucket: '0-1 days', netPnl: 0, count: 0, winRate: null }], palette)).toBeNull();
    });
  });

  describe('drawdownCurveOption', () => {
    it('builds dual series', () => {
      const option = drawdownCurveOption(
        [
          { date: '2024-01-01', drawdownAmount: 100, drawdownPct: 0.01 },
          { date: '2024-01-02', drawdownAmount: 200, drawdownPct: 0.02 },
        ],
        palette,
      );
      expect(option!.series).toHaveLength(2);
    });

    it('respects visibleSeries filtering (dual series)', () => {
      const option = drawdownCurveOption(
        [
          { date: '2024-01-01', drawdownAmount: 100, drawdownPct: 0.01 },
          { date: '2024-01-02', drawdownAmount: 200, drawdownPct: 0.02 },
        ],
        palette,
        ['drawdownAmount'],
      );
      expect((option!.series[0] as { data: number[] }).data).toHaveLength(2);
      expect((option!.series[1] as { data: number[] }).data).toEqual([]);
    });

    it('returns null for empty data', () => {
      expect(drawdownCurveOption([], palette)).toBeNull();
    });
  });

  describe('rDistributionOption', () => {
    it('returns null when all buckets empty', () => {
      expect(rDistributionOption([{ label: '-3R', count: 0 }, { label: '0R', count: 0 }], palette)).toBeNull();
    });

    it('builds with counts', () => {
      const option = rDistributionOption([{ label: '-2R', count: 3 }, { label: '+2R', count: 5 }], palette);
      expect(option).not.toBeNull();
      expect((option!.series[0] as { data: number[] }).data).toEqual([3, 5]);
    });
  });

  describe('performanceBySetupOption', () => {
    const data = [
      { setup: 'Breakout', netPnl: 500, winRate: 0.6, avgR: 0.8, count: 10 },
      { setup: 'Pullback', netPnl: -200, winRate: 0.4, avgR: -0.3, count: 8 },
    ];

    it('defaults to netPnl metric', () => {
      const option = performanceBySetupOption(data, palette);
      expect((option!.series[0] as { data: number[] }).data).toEqual([500, -200]);
    });

    it('selects winRate metric', () => {
      const option = performanceBySetupOption(data, palette, { metric: 'winRate' });
      expect((option!.series[0] as { data: Array<number | null> }).data).toEqual([0.6, 0.4]);
    });

    it('returns null for empty data', () => {
      expect(performanceBySetupOption([], palette)).toBeNull();
    });
  });

  describe('performanceByDayOfWeekOption', () => {
    it('builds for populated days', () => {
      const option = performanceByDayOfWeekOption(
        [
          { day: 'Monday', netPnl: 100, count: 3, winRate: 0.66 },
          { day: 'Tuesday', netPnl: 0, count: 0, winRate: null },
        ],
        palette,
      );
      expect(option).not.toBeNull();
    });

    it('returns null when all days empty', () => {
      expect(performanceByDayOfWeekOption([{ day: 'Monday', netPnl: 0, count: 0, winRate: null }], palette)).toBeNull();
    });
  });

  describe('performanceByTimeOfDayOption', () => {
    it('builds for populated hours', () => {
      const option = performanceByTimeOfDayOption(
        [{ hour: '10:00', netPnl: 100, count: 0 }, { hour: '11:00', netPnl: -20, count: 0 }],
        palette,
      );
      expect(option).not.toBeNull();
    });
  });

  describe('longVsShortOption', () => {
    it('builds grouped series', () => {
      const option = longVsShortOption(
        [
          { direction: 'long', netPnl: 300, count: 10, winRate: 0.6 },
          { direction: 'short', netPnl: -100, count: 5, winRate: 0.4 },
        ],
        palette,
      );
      expect(option!.series).toHaveLength(2);
    });

    it('respects series visibility', () => {
      const option = longVsShortOption(
        [
          { direction: 'long', netPnl: 300, count: 10, winRate: 0.6 },
          { direction: 'short', netPnl: -100, count: 5, winRate: 0.4 },
        ],
        palette,
        ['long'],
      );
      expect((option!.series[0] as { data: number[] }).data).toEqual([300]);
      expect((option!.series[1] as { data: number[] }).data).toEqual([]);
    });
  });

  describe('monthlyPnlOption', () => {
    it('builds dual-axis chart', () => {
      const option = monthlyPnlOption(
        [
          { month: '2024-01', netPnl: 100, winRate: 0.6 },
          { month: '2024-02', netPnl: -50, winRate: 0.5 },
        ],
        palette,
      );
      expect(option!.series).toHaveLength(2);
      expect((option!.yAxis as unknown[]).length).toBe(2);
    });

    it('respects visibleSeries filtering', () => {
      const option = monthlyPnlOption(
        [
          { month: '2024-01', netPnl: 100, winRate: 0.6 },
          { month: '2024-02', netPnl: -50, winRate: 0.5 },
        ],
        palette,
        ['netPnl'],
      );
      expect((option!.series[0] as { data: unknown[] }).data).toHaveLength(2);
      expect((option!.series[1] as { data: unknown[] }).data).toEqual([]);
    });

    it('returns null for empty data', () => {
      expect(monthlyPnlOption([], palette)).toBeNull();
    });
  });

  describe('legend visibility (Configure-dialog driven)', () => {
    it('keeps the dense default: no legend unless legendVisible', () => {
      const option = dailyCumulativePnlOption([{ date: '2024-01-01', cumulativePnl: 100 }], palette);
      expect(option!.legend).toBeUndefined();
    });

    it('renders the legend when legendVisible is set', () => {
      const option = dailyCumulativePnlOption(
        [{ date: '2024-01-01', cumulativePnl: 100 }],
        palette,
        ['cumulativePnl'],
        { legendVisible: true },
      );
      expect((option!.legend as { show: boolean }).show).toBe(true);
    });

    it('honors legendVisible for the config-object builder (performance-by-setup)', () => {
      const option = performanceBySetupOption(
        [{ setup: 'Breakout', netPnl: 500, winRate: 0.6, avgR: 0.8, count: 10 }],
        palette,
        { legendVisible: true },
      );
      expect((option!.legend as { show: boolean }).show).toBe(true);
    });
  });
});
