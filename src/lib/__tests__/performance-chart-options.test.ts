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
  formatAxisValue,
  formatTooltipValue,
  formatDateLabel,
  formatDurationBucketLabel,
  formatRBinLabel,
  rBinColor,
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
      const data = (option!.series[0] as { data: Array<{ value: number }> }).data;
      expect(data.map((d) => d.value)).toEqual([3, 5]);
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

  // ── Corrective Task 2: global $ / % / R unit propagation ────────────────

  describe('global unit conversion (Corrective Task 2)', () => {
    const ctx = {
      unit: 'percent' as const,
      periodStartEquity: 10000,
      totalInitialRisk: 200,
    };

    it('Daily Cumulative P&L converts series values currency → percent → R', () => {
      const data = [
        { date: '2024-01-01', cumulativePnl: 1000 },
        { date: '2024-01-02', cumulativePnl: 2000 },
      ];
      // currency (default)
      const cur = dailyCumulativePnlOption(data, palette);
      expect((cur!.series[0] as { data: number[] }).data).toEqual([1000, 2000]);
      // percent of period-start equity
      const pct = dailyCumulativePnlOption(data, palette, ['cumulativePnl'], { unit: 'percent', periodStartEquity: 10000 });
      expect((pct!.series[0] as { data: number[] }).data).toEqual([0.1, 0.2]);
      // R-multiples of aggregate eligible initial risk
      const r = dailyCumulativePnlOption(data, palette, ['cumulativePnl'], { unit: 'r', totalInitialRisk: 200 });
      expect((r!.series[0] as { data: number[] }).data).toEqual([5, 10]);
    });

    it('Daily Cumulative P&L renders unavailable (null) values when the denominator is missing', () => {
      const data = [{ date: '2024-01-01', cumulativePnl: 1000 }];
      const pct = dailyCumulativePnlOption(data, palette, ['cumulativePnl'], { unit: 'percent', periodStartEquity: null });
      expect((pct!.series[0] as { data: (number | null)[] }).data).toEqual([null]);
      const r = dailyCumulativePnlOption(data, palette, ['cumulativePnl'], { unit: 'r', totalInitialRisk: 0 });
      expect((r!.series[0] as { data: (number | null)[] }).data).toEqual([null]);
    });

    it('Net Daily P&L converts each bar currency → percent → R with sign-preserving color', () => {
      const data = [
        { date: '2024-01-01', netPnl: 1000 },
        { date: '2024-01-02', netPnl: -500 },
      ];
      const cur = netDailyPnlOption(data, palette);
      const curBars = (cur!.series[0] as { data: Array<{ value: number; itemStyle: { color: string } }> }).data;
      expect(curBars.map((b) => b.value)).toEqual([1000, -500]);
      expect(curBars[0].itemStyle.color).toBe(palette.positive);
      expect(curBars[1].itemStyle.color).toBe(palette.negative);

      const pct = netDailyPnlOption(data, palette, ['netPnl'], { unit: 'percent', periodStartEquity: 10000 });
      const pctBars = (pct!.series[0] as { data: Array<{ value: number; itemStyle: { color: string } }> }).data;
      expect(pctBars.map((b) => b.value)).toEqual([0.1, -0.05]);

      const r = netDailyPnlOption(data, palette, ['netPnl'], { unit: 'r', totalInitialRisk: 200 });
      const rBars = (r!.series[0] as { data: Array<{ value: number; itemStyle: { color: string } }> }).data;
      expect(rBars.map((b) => b.value)).toEqual([5, -2.5]);
    });

    it('Trade Duration, Day of Week, Time of Day, Long vs Short, Monthly convert only P&L series', () => {
      const dur = [{ bucket: '0-1 days', netPnl: 1000, count: 3, winRate: 0.6 }];
      expect(((tradeDurationOption(dur, palette, ['netPnl'], ctx)!.series[0] as { data: Array<{ value: number }> }).data.map((b) => b.value))).toEqual([0.1]);

      const dow = [{ day: 'Mon', netPnl: 1000, count: 3, winRate: 0.6 }];
      expect(((performanceByDayOfWeekOption(dow, palette, ['netPnl'], ctx)!.series[0] as { data: Array<{ value: number }> }).data.map((b) => b.value))).toEqual([0.1]);

      const tod = [{ hour: '09:00', netPnl: 1000, count: 3 }];
      expect(((performanceByTimeOfDayOption(tod, palette, ['netPnl'], ctx)!.series[0] as { data: number[] }).data)).toEqual([0.1]);

      const lvs = [{ direction: 'long' as const, netPnl: 1000, count: 2, winRate: 0.6 }];
      expect(((longVsShortOption(lvs, palette, ['long', 'short'], ctx)!.series[0] as { data: number[] }).data)).toEqual([0.1]);

      const monthly = [{ month: '2024-01', netPnl: 1000, winRate: 0.6 }];
      const m = monthlyPnlOption(monthly, palette, ['netPnl', 'winRate'], ctx)!;
      expect(((m.series[0] as { data: Array<{ value: number }> }).data.map((b) => b.value))).toEqual([0.1]);
    });

    it('Performance by Setup converts only the Net P&L metric; Win Rate / Avg R / Count stay fixed', () => {
      const data = [{ setup: 'Breakout', netPnl: 1000, winRate: 0.6, avgR: 0.8, count: 10 }];
      // netPnl metric converts under R
      const net = performanceBySetupOption(data, palette, { metric: 'netPnl', unit: 'r', totalInitialRisk: 200 });
      expect((net!.series[0] as { data: number[] }).data).toEqual([5]);
      // winRate stays its native percentage fraction under global R
      const wr = performanceBySetupOption(data, palette, { metric: 'winRate', unit: 'r', totalInitialRisk: 200 });
      expect((wr!.series[0] as { data: number[] }).data).toEqual([0.6]);
      // avgR stays R
      const ar = performanceBySetupOption(data, palette, { metric: 'avgR', unit: 'r', totalInitialRisk: 200 });
      expect((ar!.series[0] as { data: number[] }).data).toEqual([0.8]);
      // count stays count
      const cnt = performanceBySetupOption(data, palette, { metric: 'count', unit: 'r', totalInitialRisk: 200 });
      expect((cnt!.series[0] as { data: number[] }).data).toEqual([10]);
    });

    it('R-Multiple Distribution semantics are fixed (counts) under any unit', () => {
      const data = [{ label: '0 to 1R', count: 5 }];
      const extract = (opt: NonNullable<ReturnType<typeof rDistributionOption>>) =>
        (opt.series[0] as { data: Array<{ value: number }> }).data.map((d) => d.value);
      const base = rDistributionOption(data, palette);
      expect(extract(base!)).toEqual([5]);
      const pct = rDistributionOption(data, palette, ['count'], { unit: 'percent', periodStartEquity: 10000 });
      expect(extract(pct!)).toEqual([5]);
      const r = rDistributionOption(data, palette, ['count'], { unit: 'r', totalInitialRisk: 200 });
      expect(extract(r!)).toEqual([5]);
    });

    it('Monthly Win Rate line stays fixed-semantic under global R (never becomes R-like)', () => {
      const data = [{ month: '2024-01', netPnl: 1000, winRate: 0.6 }];
      const m = monthlyPnlOption(data, palette, ['netPnl', 'winRate'], { unit: 'r', totalInitialRisk: 200 })!;
      // winRate line unchanged (native fraction)
      expect((m.series[1] as { data: number[] }).data).toEqual([0.6]);
    });
  });
});
  // ── Corrective Task 2A: registry supportedUnits enforcement ──────────────

  describe('registry supportedUnits enforcement (Corrective Task 2A)', () => {
    it('Drawdown Curve amount converts under percent but stays currency under R (partial support)', () => {
      const data = [
        { date: '2024-01-01', drawdownAmount: 500, drawdownPct: 0.02 },
        { date: '2024-01-02', drawdownAmount: 800, drawdownPct: 0.03 },
      ];
      // currency (default): raw amounts.
      const cur = drawdownCurveOption(data, palette);
      expect(((cur!.series[0] as { data: number[] }).data)).toEqual([500, 800]);
      // percent: amount / periodStartEquity.
      const pct = drawdownCurveOption(data, palette, ['drawdownAmount', 'drawdownPct'], { unit: 'percent', periodStartEquity: 10000 });
      expect(((pct!.series[0] as { data: number[] }).data)).toEqual([0.05, 0.08]);
      // R: drawdown-curve does NOT declare R — ChartWidget resolves the
      // effective unit to currency before calling the builder (registry is
      // authoritative). When the builder receives unit:'currency' the amount
      // series stays raw (never becomes R-multiples).
      const r = drawdownCurveOption(data, palette, ['drawdownAmount', 'drawdownPct'], { unit: 'currency', totalInitialRisk: 200 });
      expect(((r!.series[0] as { data: number[] }).data)).toEqual([500, 800]);
      // drawdownPct series stays its native percentage in all cases.
      expect(((r!.series[1] as { data: number[] }).data)).toEqual([0.02, 0.03]);
    });

    it('R-Multiple Distribution stays fixed (counts) under every global unit', () => {
      const data = [{ label: '0 to 1R', count: 5 }, { label: '1 to 2R', count: 3 }];
      const extract = (opt: NonNullable<ReturnType<typeof rDistributionOption>>) =>
        (opt.series[0] as { data: Array<{ value: number }> }).data.map((d) => d.value);
      for (const unit of ['currency', 'percent', 'r'] as const) {
        const opt = rDistributionOption(data, palette, ['count'], { unit, periodStartEquity: 10000, totalInitialRisk: 200 });
        expect(extract(opt!)).toEqual([5, 3]);
      }
    });
  });
  // ── Corrective Task 3: shared presentation helpers ───────────────────────

  describe('shared presentation helpers (Corrective Task 3)', () => {
    describe('formatAxisValue', () => {
      it('formats currency compactly', () => {
        expect(formatAxisValue(0, 'currency')).toBe('$0');
        expect(formatAxisValue(500, 'currency')).toBe('$500');
        expect(formatAxisValue(1000, 'currency')).toBe('$1k');
        expect(formatAxisValue(2500, 'currency')).toBe('$2.5k');
        expect(formatAxisValue(-1500, 'currency')).toBe('-$1.5k');
        expect(formatAxisValue(10000, 'currency')).toBe('$10k');
      });

      it('formats percent from internal ratios', () => {
        expect(formatAxisValue(0.025, 'percent')).toBe('2.5%');
        expect(formatAxisValue(-0.04, 'percent')).toBe('-4%');
        expect(formatAxisValue(0, 'percent')).toBe('0%');
      });

      it('formats R', () => {
        expect(formatAxisValue(0, 'r')).toBe('0R');
        expect(formatAxisValue(0.5, 'r')).toBe('0.5R');
        expect(formatAxisValue(1.25, 'r')).toBe('1.25R');
        expect(formatAxisValue(-1, 'r')).toBe('-1R');
      });

      it('formats count as integers only', () => {
        expect(formatAxisValue(0, 'count')).toBe('0');
        expect(formatAxisValue(1.5, 'count')).toBe('2');
        expect(formatAxisValue(5, 'count')).toBe('5');
      });
    });

    describe('formatTooltipValue', () => {
      it('uses full precision for currency tooltips', () => {
        expect(formatTooltipValue(7266, 'currency')).toBe('$7,266');
        expect(formatTooltipValue(-1356, 'currency')).toBe('-$1,356');
      });

      it('formats percent and R tooltips', () => {
        expect(formatTooltipValue(0.073, 'percent')).toBe('7.3%');
        expect(formatTooltipValue(5.42, 'r')).toBe('5.42R');
        expect(formatTooltipValue(8, 'count')).toBe('8');
      });
    });

    describe('label formatters', () => {
      it('formats dates as abbreviated month', () => {
        expect(formatDateLabel('2026-08-21')).toBe('Aug 21');
        expect(formatDateLabel('2026-06-08')).toBe('Jun 08');
      });

      it('compacts duration buckets for the axis without changing canonical definitions', () => {
        expect(formatDurationBucketLabel('0-1 days')).toBe('0-1d');
        expect(formatDurationBucketLabel('11+ days')).toBe('11+d');
      });

      it('compacts R buckets for the axis without changing canonical definitions', () => {
        expect(formatRBinLabel('<= -3')).toBe('≤-3R');
        expect(formatRBinLabel('-3 to -2')).toBe('-3R to -2R');
        expect(formatRBinLabel('> 3')).toBe('>3R');
      });
    });

    describe('rBinColor', () => {
      it('colors negative buckets with the negative semantic and positive with positive', () => {
        expect(rBinColor('<= -3', palette)).toBe(palette.negative);
        expect(rBinColor('-2 to -1', palette)).toBe(palette.negative);
        expect(rBinColor('> 3', palette)).toBe(palette.positive);
        expect(rBinColor('1 to 2', palette)).toBe(palette.positive);
      });

      it('uses neutral for the zero-boundary bucket', () => {
        expect(rBinColor('0 to 1', palette)).toBe(palette.info);
      });
    });

    describe('metric-dependent setup axis', () => {
      it('renders the correct axis name and semantics for each Setup metric', () => {
        const data = [{ setup: 'Breakout', netPnl: 500, winRate: 0.6, avgR: 0.8, count: 10 }];
        const net = performanceBySetupOption(data, palette, { metric: 'netPnl' })!;
        expect((net.yAxis as { name: string }).name).toBe('Net P&L');
        const wr = performanceBySetupOption(data, palette, { metric: 'winRate' })!;
        expect((wr.yAxis as { name: string }).name).toBe('Win Rate');
        const ar = performanceBySetupOption(data, palette, { metric: 'avgR' })!;
        expect((ar.yAxis as { name: string }).name).toBe('Average R');
        const cnt = performanceBySetupOption(data, palette, { metric: 'count' })!;
        expect((cnt.yAxis as { name: string }).name).toBe('Trades');
      });

      it('uses integer minInterval for the Trades setup axis', () => {
        const data = [{ setup: 'Breakout', netPnl: 500, winRate: 0.6, avgR: 0.8, count: 10 }];
        const opt = performanceBySetupOption(data, palette, { metric: 'count' })!;
        expect((opt.yAxis as { minInterval?: number }).minInterval).toBe(1);
      });
    });
  });
