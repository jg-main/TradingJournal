import { describe, it, expect } from 'vitest';
import {
  dailyCumulativePnlOption,
  netDailyPnlOption,
  tradeDurationOption,
  tradeDurationScatterOption,
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
  formatDurationMinutes,
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
    it('builds a single downside series (no dual-axis model)', () => {
      const option = drawdownCurveOption(
        [
          { date: '2024-01-01', drawdownAmount: 100, drawdownPct: 0.01 },
          { date: '2024-01-02', drawdownAmount: 200, drawdownPct: 0.02 },
        ],
        palette,
      );
      expect(option!.series).toHaveLength(1);
      // Single value Y axis; no yAxisIndex 1 anywhere.
      expect(Array.isArray(option!.yAxis)).toBe(false);
      expect((option!.series[0] as { yAxisIndex?: number }).yAxisIndex).toBeUndefined();
      // Downside domain: zero is the natural upper bound.
      expect((option!.yAxis as { max?: number }).max).toBe(0);
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
    const values = (opt: NonNullable<ReturnType<typeof performanceBySetupOption>>) =>
      (opt.series[0] as { data: Array<{ value: number }> }).data.map((b) => b.value);

    it('defaults to netPnl metric', () => {
      const option = performanceBySetupOption(data, palette);
      expect(values(option!)).toEqual([500, -200]);
    });

    it('selects winRate metric', () => {
      const option = performanceBySetupOption(data, palette, { metric: 'winRate' });
      expect(values(option!)).toEqual([0.6, 0.4]);
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
      const values = (opt: NonNullable<ReturnType<typeof performanceBySetupOption>>) =>
        (opt.series[0] as { data: Array<{ value: number }> }).data.map((b) => b.value);
      // netPnl metric converts under R
      const net = performanceBySetupOption(data, palette, { metric: 'netPnl', unit: 'r', totalInitialRisk: 200 });
      expect(values(net!)).toEqual([5]);
      // winRate stays its native percentage fraction under global R
      const wr = performanceBySetupOption(data, palette, { metric: 'winRate', unit: 'r', totalInitialRisk: 200 });
      expect(values(wr!)).toEqual([0.6]);
      // avgR stays R
      const ar = performanceBySetupOption(data, palette, { metric: 'avgR', unit: 'r', totalInitialRisk: 200 });
      expect(values(ar!)).toEqual([0.8]);
      // count stays count
      const cnt = performanceBySetupOption(data, palette, { metric: 'count', unit: 'r', totalInitialRisk: 200 });
      expect(values(cnt!)).toEqual([10]);
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
    it('Drawdown Curve shows one unit-driven downside series; R falls back to currency', () => {
      const data = [
        { date: '2024-01-01', drawdownAmount: 500, drawdownPct: 0.02 },
        { date: '2024-01-02', drawdownAmount: 800, drawdownPct: 0.03 },
      ];
      // currency (default): negated canonical amounts — presentation maps the
      // positive magnitude to a negative downside series.
      const cur = drawdownCurveOption(data, palette);
      expect(((cur!.series[0] as { data: number[] }).data)).toEqual([-500, -800]);
      // percent: negated canonical drawdownPct (never re-derived from amount).
      const pct = drawdownCurveOption(data, palette, ['drawdownAmount'], { unit: 'percent', periodStartEquity: 10000 });
      expect(((pct!.series[0] as { data: number[] }).data)).toEqual([-0.02, -0.03]);
      // R: drawdown-curve does NOT declare R — ChartWidget resolves the
      // effective unit to currency before calling the builder (registry is
      // authoritative). The builder also guards: unit R → currency. No
      // aggregate-risk division ever occurs.
      const r = drawdownCurveOption(data, palette, ['drawdownAmount'], { unit: 'r', totalInitialRisk: 200 });
      expect(((r!.series[0] as { data: number[] }).data)).toEqual([-500, -800]);
      // Single series only in every mode.
      expect(cur!.series).toHaveLength(1);
      expect(pct!.series).toHaveLength(1);
      expect(r!.series).toHaveLength(1);
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
        // Horizontal orientation: the metric value axis is now xAxis.
        const net = performanceBySetupOption(data, palette, { metric: 'netPnl' })!;
        expect((net.xAxis as { name: string }).name).toBe('Net P&L');
        const wr = performanceBySetupOption(data, palette, { metric: 'winRate' })!;
        expect((wr.xAxis as { name: string }).name).toBe('Win Rate');
        const ar = performanceBySetupOption(data, palette, { metric: 'avgR' })!;
        expect((ar.xAxis as { name: string }).name).toBe('Average R');
        const cnt = performanceBySetupOption(data, palette, { metric: 'count' })!;
        expect((cnt.xAxis as { name: string }).name).toBe('Trades');
      });

      it('uses integer minInterval for the Trades setup axis', () => {
        const data = [{ setup: 'Breakout', netPnl: 500, winRate: 0.6, avgR: 0.8, count: 10 }];
        const opt = performanceBySetupOption(data, palette, { metric: 'count' })!;
        expect((opt.xAxis as { minInterval?: number }).minInterval).toBe(1);
      });
    });

    describe('formatDurationMinutes (Corrective Task 3A)', () => {
      it('humanizes sub-hour, hourly and day/week durations', () => {
        expect(formatDurationMinutes(4)).toBe('4m');
        expect(formatDurationMinutes(54)).toBe('54m');
        expect(formatDurationMinutes(104)).toBe('1h 44m');
        expect(formatDurationMinutes(199)).toBe('3h 19m');
        expect(formatDurationMinutes(360)).toBe('6h');
        expect(formatDurationMinutes(1440)).toBe('1d');
        expect(formatDurationMinutes(4320)).toBe('3d');
        expect(formatDurationMinutes(10080)).toBe('1w');
        expect(formatDurationMinutes(60)).toBe('1h');
      });
    });

    describe('tradeDurationScatterOption (Corrective Task 3A)', () => {
      const points = [
        // Trade A: 30m hold, +$500, R +2
        { tradeId: 't-a', symbol: 'AAA', holdingDurationMinutes: 30, netPnl: 500, rMultiple: 2, setupId: 's1', setupName: 'Breakout', closedAt: '2026-08-18T15:00:00Z' },
        // Trade B: 90m hold, -$250, R -1
        { tradeId: 't-b', symbol: 'BBB', holdingDurationMinutes: 90, netPnl: -250, rMultiple: -1, setupId: 's2', setupName: 'Pullback', closedAt: '2026-08-17T15:00:00Z' },
        // Trade C: 240m hold, +$100, R unavailable
        { tradeId: 't-c', symbol: 'CCC', holdingDurationMinutes: 240, netPnl: 100, rMultiple: null, setupId: null, setupName: null, closedAt: '2026-08-16T15:00:00Z' },
      ];
      const ctx = { periodStartEquity: 10000, totalInitialRisk: 1000 };

      it('returns null for empty data', () => {
        expect(tradeDurationScatterOption([], palette)).toBeNull();
      });

      it('X is continuous holding duration; Y is the individual outcome under $', () => {
        const opt = tradeDurationScatterOption(points, palette, ['netPnl'], ctx)!;
        const xAxis = opt.xAxis as { type: string; name: string; minInterval?: number };
        expect(xAxis.type).toBe('value');
        expect(xAxis.name).toBe('Holding duration');
        expect(xAxis.minInterval).toBe(1);
        const data = (opt.series as Array<{ type: string; data: Array<{ value: [number, number] }> }>)[0];
        expect(data.type).toBe('scatter');
        expect(data.data.map((d) => d.value)).toEqual([[30, 500], [90, -250], [240, 100]]);
        expect((opt.yAxis as { name: string }).name).toBe('Trade result');
      });

      it('X tick formatter humanizes durations', () => {
        const opt = tradeDurationScatterOption(points, palette, ['netPnl'], ctx)!;
        const xAxis = opt.xAxis as { axisLabel: { formatter: (v: number) => string } };
        expect(xAxis.axisLabel.formatter(104)).toBe('1h 44m');
        expect(xAxis.axisLabel.formatter(4)).toBe('4m');
      });

      it('percent mode uses period-start equity (never return-on-capital)', () => {
        const opt = tradeDurationScatterOption(points, palette, ['netPnl'], { ...ctx, unit: 'percent' })!;
        const data = (opt.series as Array<{ data: Array<{ value: [number, number] }> }>)[0];
        expect(data.data.map((d) => d.value[1])).toEqual([0.05, -0.025, 0.01]);
      });

      it('R mode uses each trade canonical individual R — never aggregate totalInitialRisk', () => {
        // aggregate risk = 1000 would make +500 → 0.5R and -250 → -0.25R if
        // mis-derived; the individual R semantics must win (+2 / -1).
        const opt = tradeDurationScatterOption(points, palette, ['netPnl'], { ...ctx, unit: 'r' })!;
        const data = (opt.series as Array<{ data: Array<{ value: [number, number] }> }>)[0];
        expect(data.data.map((d) => d.value)).toEqual([[30, 2], [90, -1]]);
        // The missing-R trade is omitted (never fabricated as 0R).
        expect(data.data).toHaveLength(2);
      });

      it('points use semantic outcome colors (positive/negative/zero)', () => {
        const zeroPoint = { tradeId: 't-z', symbol: 'ZZZ', holdingDurationMinutes: 60, netPnl: 0, rMultiple: 0, setupId: null, setupName: null, closedAt: '2026-08-15T15:00:00Z' };
        const opt = tradeDurationScatterOption([...points, zeroPoint], palette, ['netPnl'], ctx)!;
        const data = (opt.series as Array<{ data: Array<{ itemStyle: { color: string } }> }>)[0];
        expect(data.data[0].itemStyle.color).toBe(palette.positive);
        expect(data.data[1].itemStyle.color).toBe(palette.negative);
        expect(data.data[2].itemStyle.color).toBe(palette.positive);
        expect(data.data[3].itemStyle.color).toBe(palette.info); // scratch → neutral
      });

      it('renders a zero reference line and no labels/trend', () => {
        const opt = tradeDurationScatterOption(points, palette, ['netPnl'], ctx)!;
        const series = (opt.series as Array<{ markLine?: { data: Array<{ yAxis?: number }> }; label?: { show?: boolean }; markPoint?: unknown; markArea?: unknown }>)[0];
        expect(series.markLine?.data?.[0]?.yAxis).toBe(0);
        expect(series.label?.show).toBe(false);
        expect(series.markPoint).toBeUndefined();
        // No regression/trend line: markLine carries only the zero baseline.
        expect(series.markLine?.data).toHaveLength(1);
      });

      it('tooltip heading is the trade symbol with trade-specific context rows', () => {
        const opt = tradeDurationScatterOption(points, palette, ['netPnl'], ctx)!;
        const tooltip = opt.tooltip as { trigger: string; formatter: (params: unknown) => string };
        expect(tooltip.trigger).toBe('item');
        const html = tooltip.formatter([{ dataIndex: 0, seriesName: 'Trade result' }]);
        expect(html).toContain('<b>AAA</b>');
        expect(html).toContain('Holding time');
        expect(html).toContain('30m');
        expect(html).toContain('Net P&L');
        expect(html).toContain('+$500');
        expect(html).toContain('R');
        expect(html).toContain('+2R');
        expect(html).toContain('Setup');
        expect(html).toContain('Breakout');
        expect(html).toContain('Closed');
        expect(html).toContain('Aug 18');
        // No UUIDs, no raw ISO timestamp, no duration bucket.
        expect(html).not.toContain('t-a');
        expect(html).not.toContain('2026-08-18T15:00:00Z');
        expect(html).not.toContain('0-1 days');
      });

      it('missing-R trade tooltip omits the R row (never 0R)', () => {
        const opt = tradeDurationScatterOption(points, palette, ['netPnl'], ctx)!;
        const tooltip = opt.tooltip as { formatter: (params: unknown) => string };
        const html = tooltip.formatter([{ dataIndex: 2, seriesName: 'Trade result' }]);
        expect(html).toContain('<b>CCC</b>');
        expect(html).toContain('+$100');
        expect(html).not.toContain('>R</span>');
        expect(html).not.toContain('0R');
      });

      it('negative trade tooltip carries negative semantics', () => {
        const opt = tradeDurationScatterOption(points, palette, ['netPnl'], ctx)!;
        const tooltip = opt.tooltip as { formatter: (params: unknown) => string };
        const html = tooltip.formatter([{ dataIndex: 1, seriesName: 'Trade result' }]);
        expect(html).toContain('<b>BBB</b>');
        expect(html).toContain('-$250');
        expect(html).toContain('-1R');
        expect(html).toContain('Pullback');
        expect(html).toContain('Aug 17');
      });
    });

    describe('tooltip heading contract (Corrective Task 3A)', () => {
      /** Invoke a builder's tooltip formatter with synthetic axis params. */
      const tooltipHtml = (opt: NonNullable<ReturnType<typeof dailyCumulativePnlOption>>, category: string) => {
        const t = opt.tooltip as { formatter: (params: unknown) => string };
        return t.formatter([{ dataIndex: 0, seriesName: 's', axisValueLabel: category, name: category }]);
      };

      it('date charts format the heading with the shared date formatter', () => {
        const cum = dailyCumulativePnlOption([{ date: '2026-08-21', cumulativePnl: 7266 }], palette)!;
        const html = tooltipHtml(cum, '2026-08-21');
        expect(html).toContain('<b>Aug 21</b>');
        expect(html).not.toContain('2026-08-21');

        const net = netDailyPnlOption([{ date: '2026-08-21', netPnl: 719 }], palette)!;
        expect(tooltipHtml(net, '2026-08-21')).toContain('<b>Aug 21</b>');

        const dd = drawdownCurveOption([{ date: '2026-08-21', drawdownAmount: 2430, drawdownPct: 0.048 }], palette)!;
        expect(tooltipHtml(dd, '2026-08-21')).toContain('<b>Aug 21</b>');
      });

      it('R distribution heading is the R bucket, not a date', () => {
        const rdist = rDistributionOption([{ label: '1 to 2', count: 5 }], palette)!;
        const html = tooltipHtml(rdist, '1 to 2');
        expect(html).toContain('<b>1R to 2R</b>');
        expect(html).toContain('Trades');
      });

      it('setup heading is the full setup display name — never date-formatted', () => {
        const setup = performanceBySetupOption([{ setup: 'Episodic Pivot', netPnl: 4250, winRate: 0.615, avgR: 0.8, count: 10 }], palette, { metric: 'netPnl' })!;
        const html = tooltipHtml(setup, 'Episodic Pi…');
        // Full name comes from the data row even when the axis label truncates.
        expect(html).toContain('<b>Episodic Pivot</b>');
        expect(html).toContain('Net P&L');
        // A setup-like category string is never passed through date formatting.
        const wr = performanceBySetupOption([{ setup: '2026-08-21', netPnl: 0, winRate: 0.5, avgR: 0, count: 1 }], palette, { metric: 'winRate' })!;
        expect(tooltipHtml(wr, '2026-08-21')).toContain('<b>2026-08-21</b>');
      });

      it('category strings are preserved verbatim (not date-formatted) on non-date charts', () => {
        // Day-of-week chart: 'Monday' must not become a date.
        const dow = performanceByDayOfWeekOption([{ day: 'Monday', netPnl: 100, count: 3, winRate: 0.6 }], palette)!;
        expect(tooltipHtml(dow, 'Monday')).toContain('<b>Monday</b>');
      });
    });

    describe('performanceBySetupOption horizontal ranking (Corrective Task 4)', () => {
      // Deliberately out of order so sorting is proven (never input order).
      const data = [
        { setup: 'Pullback', netPnl: -500, winRate: 0.4, avgR: -0.5, count: 8 },
        { setup: 'Episodic', netPnl: 1500, winRate: 0.7, avgR: 1.1, count: 5 },
        { setup: 'Breakout', netPnl: 3000, winRate: 0.9, avgR: 1.8, count: 12 },
      ];
      const cats = (opt: NonNullable<ReturnType<typeof performanceBySetupOption>>) =>
        (opt.yAxis as { data: string[] }).data;
      const values = (opt: NonNullable<ReturnType<typeof performanceBySetupOption>>) =>
        (opt.series[0] as { data: Array<{ value: number }> }).data.map((b) => b.value);
      const colors = (opt: NonNullable<ReturnType<typeof performanceBySetupOption>>) =>
        (opt.series[0] as { data: Array<{ itemStyle: { color: string } }> }).data.map((b) => b.itemStyle.color);

      it('uses horizontal categorical bars: yAxis category + xAxis value', () => {
        const opt = performanceBySetupOption(data, palette)!;
        expect((opt.yAxis as { type: string }).type).toBe('category');
        expect((opt.xAxis as { type: string }).type).toBe('value');
        // Highest-ranked setup at the top (first category + inverse axis).
        expect((opt.yAxis as { inverse?: boolean }).inverse).toBe(true);
        expect(cats(opt)).toEqual(['Breakout', 'Episodic', 'Pullback']);
      });

      it('ranks highest metric value first for every metric (never input order)', () => {
        const net = performanceBySetupOption(data, palette)!;
        expect(cats(net)).toEqual(['Breakout', 'Episodic', 'Pullback']);
        expect(values(net)).toEqual([3000, 1500, -500]);

        const wr = performanceBySetupOption(data, palette, { metric: 'winRate' })!;
        expect(cats(wr)).toEqual(['Breakout', 'Episodic', 'Pullback']);
        expect(values(wr)).toEqual([0.9, 0.7, 0.4]);

        const ar = performanceBySetupOption(data, palette, { metric: 'avgR' })!;
        expect(cats(ar)).toEqual(['Breakout', 'Episodic', 'Pullback']);
        expect(values(ar)).toEqual([1.8, 1.1, -0.5]);

        const cnt = performanceBySetupOption(data, palette, { metric: 'count' })!;
        expect(cats(cnt)).toEqual(['Breakout', 'Pullback', 'Episodic']);
        expect(values(cnt)).toEqual([12, 8, 5]);
      });

      it('sorts missing values to the bottom without fabricating zeros', () => {
        const sparse = [
          { setup: 'A', netPnl: 100, winRate: null, avgR: null, count: 2 },
          { setup: 'B', netPnl: 50, winRate: 0.5, avgR: 0.4, count: 3 },
        ];
        const wr = performanceBySetupOption(sparse, palette, { metric: 'winRate' })!;
        expect(cats(wr)).toEqual(['B', 'A']);
        const ar = performanceBySetupOption(sparse, palette, { metric: 'avgR' })!;
        expect(cats(ar)).toEqual(['B', 'A']);
      });

      it('does not mutate the shared analytics data', () => {
        const before = JSON.stringify(data);
        performanceBySetupOption(data, palette, { metric: 'count' });
        performanceBySetupOption(data, palette, { metric: 'netPnl' });
        expect(JSON.stringify(data)).toBe(before);
      });

      it('colors signed metrics by polarity and rates/counts neutrally', () => {
        const net = performanceBySetupOption(data, palette)!;
        expect(colors(net)).toEqual([palette.positive, palette.positive, palette.negative]);

        const ar = performanceBySetupOption(data, palette, { metric: 'avgR' })!;
        expect(colors(ar)).toEqual([palette.positive, palette.positive, palette.negative]);

        // Win Rate is a rate, not signed P&L — never green just because > 0.
        const wr = performanceBySetupOption(data, palette, { metric: 'winRate' })!;
        expect(colors(wr)).toEqual([palette.info, palette.info, palette.info]);

        const cnt = performanceBySetupOption(data, palette, { metric: 'count' })!;
        expect(colors(cnt)).toEqual([palette.info, palette.info, palette.info]);
      });

      it('zero Net P&L uses neutral coloring', () => {
        const zero = [{ setup: 'Scratch', netPnl: 0, winRate: 0.5, avgR: 0, count: 1 }];
        const opt = performanceBySetupOption(zero, palette)!;
        expect(colors(opt)).toEqual([palette.info]);
      });

      it('adds a vertical zero reference line for signed metrics only', () => {
        const net = performanceBySetupOption(data, palette)!;
        const netMark = (net.series[0] as { markLine?: { data: Array<{ xAxis?: number }> } }).markLine;
        expect(netMark?.data?.[0]?.xAxis).toBe(0);

        const ar = performanceBySetupOption(data, palette, { metric: 'avgR' })!;
        const arMark = (ar.series[0] as { markLine?: { data: Array<{ xAxis?: number }> } }).markLine;
        expect(arMark?.data?.[0]?.xAxis).toBe(0);

        const wr = performanceBySetupOption(data, palette, { metric: 'winRate' })!;
        expect((wr.series[0] as { markLine?: unknown }).markLine).toBeUndefined();

        const cnt = performanceBySetupOption(data, palette, { metric: 'count' })!;
        expect((cnt.series[0] as { markLine?: unknown }).markLine).toBeUndefined();
      });

      it('metric-aware value axis formatters ($/%/R, %, R, integer Trades)', () => {
        const fmt = (opt: NonNullable<ReturnType<typeof performanceBySetupOption>>) =>
          (opt.xAxis as { axisLabel: { formatter: (v: number) => string } }).axisLabel.formatter;
        const net = performanceBySetupOption(data, palette)!;
        expect(fmt(net)(2500)).toBe('$2.5k');
        const netPct = performanceBySetupOption(data, palette, { metric: 'netPnl', unit: 'percent', periodStartEquity: 100000 })!;
        expect(fmt(netPct)(0.025)).toBe('2.5%');
        const netR = performanceBySetupOption(data, palette, { metric: 'netPnl', unit: 'r', totalInitialRisk: 1000 })!;
        expect(fmt(netR)(1.5)).toBe('1.5R');
        const wr = performanceBySetupOption(data, palette, { metric: 'winRate' })!;
        expect(fmt(wr)(0.5)).toBe('50%');
        const ar = performanceBySetupOption(data, palette, { metric: 'avgR' })!;
        expect(fmt(ar)(-1.25)).toBe('-1.25R');
        const cnt = performanceBySetupOption(data, palette, { metric: 'count' })!;
        expect(fmt(cnt)(7.5)).toBe('8'); // integer ticks only
      });

      it('tooltip heading is the full setup name with primary metric first + supporting fields', () => {
        const opt = performanceBySetupOption(data, palette)!;
        const t = opt.tooltip as { formatter: (params: unknown) => string };
        const html = t.formatter([{ dataIndex: 0, seriesName: 'Net P&L', axisValueLabel: 'Breakout', name: 'Breakout' }]);
        expect(html).toContain('<b>Breakout</b>');
        expect(html).toContain('Net P&L');
        expect(html).toContain('+$3,000');
        expect(html).toContain('Trades');
        expect(html).toContain('12');
        expect(html).toContain('Win Rate');
        expect(html).toContain('90%');
        expect(html).toContain('Average R');
        expect(html).toContain('+1.8R');
        // Primary metric appears before supporting rows.
        expect(html.indexOf('Net P&L')).toBeLessThan(html.indexOf('Trades'));
        // No UUIDs, no date heading.
        expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
        expect(html).not.toContain('<b>Aug ');
      });

      it('tooltip primary metric changes with the configured metric', () => {
        const opt = performanceBySetupOption(data, palette, { metric: 'winRate' })!;
        const t = opt.tooltip as { formatter: (params: unknown) => string };
        const html = t.formatter([{ dataIndex: 0, seriesName: 'Win Rate', axisValueLabel: 'Breakout', name: 'Breakout' }]);
        expect(html).toContain('<b>Breakout</b>');
        expect(html).toContain('Win Rate');
        expect(html).toContain('90%');
        expect(html).toContain('Net P&L');
        expect(html).toContain('+$3,000'); // canonical $ supporting context
        expect(html.indexOf('Win Rate')).toBeLessThan(html.indexOf('Trades'));
      });

      it('long setup names stay full in the tooltip despite axis truncation', () => {
        const long = [{ setup: 'Qullamaggie Breakout', netPnl: 4250, winRate: 0.583, avgR: 1.24, count: 12 }];
        const opt = performanceBySetupOption(long, palette)!;
        const t = opt.tooltip as { formatter: (params: unknown) => string };
        const html = t.formatter([{ dataIndex: 0, seriesName: 'Net P&L', axisValueLabel: 'Qullamaggie…', name: 'Qullamaggie…' }]);
        expect(html).toContain('<b>Qullamaggie Breakout</b>');
        expect(html).toContain('+$4,250');
        expect(html).toContain('12');
        expect(html).toContain('58.3%');
        expect(html).toContain('+1.24R');
      });
    });

    describe('drawdownCurveOption downside area (Corrective Task 5)', () => {
      const seq = [
        { date: '2026-08-01', drawdownAmount: 0, drawdownPct: 0 },
        { date: '2026-08-05', drawdownAmount: 500, drawdownPct: 0.05 },
        { date: '2026-08-10', drawdownAmount: 800, drawdownPct: 0.08 },
        { date: '2026-08-15', drawdownAmount: 200, drawdownPct: 0.02 },
        { date: '2026-08-20', drawdownAmount: 0, drawdownPct: 0 },
      ];
      const extract = (opt: NonNullable<ReturnType<typeof drawdownCurveOption>>) =>
        (opt.series[0] as { data: number[] }).data;
      const before = JSON.stringify(seq);

      it('plots negated currency magnitudes below zero (canonical input untouched)', () => {
        const opt = drawdownCurveOption(seq, palette)!;
        expect(extract(opt)).toEqual([0, -500, -800, -200, 0]);
        expect(JSON.stringify(seq)).toBe(before);
      });

      it('plots negated canonical percentages under percent mode (never re-derived from amount)', () => {
        const opt = drawdownCurveOption(seq, palette, ['drawdownAmount'], { unit: 'percent' })!;
        expect(extract(opt)).toEqual([0, -0.05, -0.08, -0.02, 0]);
      });

      it('percent axis formatter displays -5% / -8% (never -0.05%)', () => {
        const opt = drawdownCurveOption(seq, palette, ['drawdownAmount'], { unit: 'percent' })!;
        const fmt = (opt.yAxis as { axisLabel: { formatter: (v: number) => string } }).axisLabel.formatter;
        expect(fmt(-0.05)).toBe('-5%');
        expect(fmt(-0.08)).toBe('-8%');
        expect(fmt(0)).toBe('0%');
      });

      it('global R resolves to currency: no R-labelled drawdown, no aggregate-risk division', () => {
        const opt = drawdownCurveOption(seq, palette, ['drawdownAmount'], { unit: 'r', totalInitialRisk: 200 })!;
        expect(extract(opt)).toEqual([0, -500, -800, -200, 0]);
      });

      it('renders exactly one visible series and one Y axis (no yAxisIndex 1, no dual axes)', () => {
        const opt = drawdownCurveOption(seq, palette)!;
        expect(opt.series).toHaveLength(1);
        expect(Array.isArray(opt.yAxis)).toBe(false);
        expect((opt.series[0] as { yAxisIndex?: number }).yAxisIndex).toBeUndefined();
        const pct = drawdownCurveOption(seq, palette, ['drawdownAmount'], { unit: 'percent' })!;
        expect(pct.series).toHaveLength(1);
        expect(Array.isArray(pct.yAxis)).toBe(false);
      });

      it('anchors the domain at zero (max 0) with an adaptive lower bound', () => {
        const opt = drawdownCurveOption(seq, palette)!;
        expect((opt.yAxis as { max?: number }).max).toBe(0);
        expect((opt.yAxis as { min?: number }).min).toBeUndefined(); // not hardcoded
        // No artificial positive region: the series never exceeds zero.
        expect(extract(opt).every((v) => v <= 0)).toBe(true);
      });

      it('currency tooltip shows amount first then percentage (negative signs)', () => {
        const point = { date: '2026-08-21', drawdownAmount: 2430, drawdownPct: 0.048 };
        const opt = drawdownCurveOption([point], palette)!;
        const t = opt.tooltip as { formatter: (params: unknown) => string };
        const html = t.formatter([{ dataIndex: 0, seriesName: 'Drawdown', axisValueLabel: '2026-08-21', name: '2026-08-21' }]);
        expect(html).toContain('<b>Aug 21</b>');
        expect(html).toContain('Drawdown');
        expect(html).toContain('-$2,430');
        expect(html).toContain('Drawdown %');
        expect(html).toContain('-4.8%');
        expect(html.indexOf('Drawdown&nbsp;&nbsp;')).toBeLessThan(html.indexOf('Drawdown %&nbsp;&nbsp;'));
      });

      it('percent tooltip shows percentage first then amount', () => {
        const point = { date: '2026-08-21', drawdownAmount: 2430, drawdownPct: 0.048 };
        const opt = drawdownCurveOption([point], palette, ['drawdownAmount'], { unit: 'percent' })!;
        const t = opt.tooltip as { formatter: (params: unknown) => string };
        const html = t.formatter([{ dataIndex: 0, seriesName: 'Drawdown %', axisValueLabel: '2026-08-21', name: '2026-08-21' }]);
        expect(html).toContain('<b>Aug 21</b>');
        expect(html).toContain('Drawdown %');
        expect(html).toContain('-4.8%');
        expect(html).toContain('Drawdown');
        expect(html).toContain('-$2,430');
        expect(html.indexOf('Drawdown %&nbsp;&nbsp;')).toBeLessThan(html.indexOf('Drawdown&nbsp;&nbsp;'));
      });

      it('distinguishes no data from a valid all-zero drawdown series', () => {
        // No rollforward points → empty state (builder returns null).
        expect(drawdownCurveOption([], palette)).toBeNull();
        // Valid points with every drawdown value zero → a real flat zero series.
        const flat = [
          { date: '2026-08-01', drawdownAmount: 0, drawdownPct: 0 },
          { date: '2026-08-02', drawdownAmount: 0, drawdownPct: 0 },
        ];
        const opt = drawdownCurveOption(flat, palette)!;
        expect(opt).not.toBeNull();
        expect(extract(opt)).toEqual([0, 0]);
      });

      it('keeps the date heading and a prominent zero baseline', () => {
        const opt = drawdownCurveOption(seq, palette)!;
        const t = opt.tooltip as { formatter: (params: unknown) => string };
        const html = t.formatter([{ dataIndex: 1, seriesName: 'Drawdown', axisValueLabel: '2026-08-05', name: '2026-08-05' }]);
        expect(html).toContain('<b>Aug 05</b>');
        const mark = (opt.series[0] as { markLine?: { data: Array<{ yAxis?: number }> } }).markLine;
        expect(mark?.data?.[0]?.yAxis).toBe(0);
      });
    });
  });
