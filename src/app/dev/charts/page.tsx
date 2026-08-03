'use client';

/**
 * /dev/charts — M014/S04 chart palette proof surface.
 *
 * Dev-only page that renders all 9 dashboard chart widgets with realistic
 * deterministic fixture data, in both light and dark themes, so agents and
 * reviewers can verify the Graphite + Steel Blue chart palette end-to-end:
 *
 *   1. equity-drawdown       2. monthly-performance   3. r-distribution
 *   4. calendar-heatmap      5. process-discipline    6. period-matrix
 *   7. setup-ranking         8. attention-insights    9. directional-performance
 *
 * The widgets are the real production components; the data is seeded fixture
 * data (deterministic — identical on server and client, no hydration drift).
 * Theme switching goes through the real ThemeToggle (localStorage + `.dark`
 * class on <html>), so the useChartPalette MutationObserver path is exercised
 * exactly as it is on the live dashboard: flipping the theme recolors every
 * ECharts option in place.
 *
 * This page follows the S01 `/dev/tokens` pattern: a standalone dev root
 * layout with no product shell, deliberately outside app navigation.
 */

import { useMemo, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useChartTheme, useChartPalette } from '@/hooks/use-chart-palette';
import { chartPalette } from '@/lib/chart-palette';
import { EquityDrawdownChart } from '@/components/dashboard/equity-drawdown-chart';
import { MonthlyPerformanceChart } from '@/components/dashboard/monthly-performance-chart';
import { RDistributionChart } from '@/components/dashboard/r-distribution-chart';
import { CalendarHeatmapWidget } from '@/components/dashboard/calendar-heatmap-widget';
import { ProcessDisciplineWidget } from '@/components/dashboard/process-discipline-widget';
import { PeriodMatrixWidget } from '@/components/dashboard/period-matrix-widget';
import { SetupRankingWidget } from '@/components/dashboard/setup-ranking-widget';
import { AttentionInsightsWidget } from '@/components/dashboard/attention-insights-widget';
import { DirectionalPerformanceWidget } from '@/components/dashboard/directional-performance-widget';
import type { EquityDataPoint, DrawdownDataPoint, TradeMarkerPoint } from '@/lib/equity';
import type { MonthlyPerformanceItem, RDistributionBin, ProcessScoreBin, DirectionalPerformanceResult } from '@/lib/dashboard';
import type { CalendarHeatmapYearData } from '@/lib/calendar-heatmap';
import type { PeriodMatrixResult } from '@/lib/period-matrix';
import type { SetupPerfResult } from '@/lib/review-dashboard';
import type { AttentionInsight } from '@/lib/attention-insights';

/* ── Deterministic seeded PRNG (mulberry32) ──────────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5a04); // fixed seed → identical SSR + client

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function weekdayDates(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/* ── Fixtures ────────────────────────────────────────────────────────── */

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'SPY', 'QQQ', 'AMD', 'COIN'] as const;
const DIRECTIONS = ['long', 'short'] as const;

// 1. Equity & drawdown: ~120 weekday points, HWM-aware drawdown, 12 trade markers.
const EQUITY_DATES = weekdayDates('2026-01-02', '2026-06-30');
const EQUITY: EquityDataPoint[] = (() => {
  let equity = 25000;
  let hwm = equity;
  const points: EquityDataPoint[] = [];
  for (const date of EQUITY_DATES) {
    const drift = 0.0006;
    const vol = 0.009;
    equity = equity * (1 + (rand() - 0.5) * 2 * vol + drift);
    if (equity > hwm) hwm = equity;
    points.push({
      date,
      equity: Math.round(equity * 100) / 100,
      cumulativePnl: Math.round((equity - 25000) * 100) / 100,
      highWaterMark: Math.round(hwm * 100) / 100,
    });
  }
  return points;
})();

const DRAWDOWN: DrawdownDataPoint[] = EQUITY.map((p) => ({
  date: p.date,
  drawdownAmount: Math.round((p.equity - p.highWaterMark) * 100) / 100,
  drawdownPct: p.highWaterMark > 0 ? (p.equity - p.highWaterMark) / p.highWaterMark : 0,
}));

const TRADE_MARKERS: TradeMarkerPoint[] = (() => {
  const markers: TradeMarkerPoint[] = [];
  const idxs = [5, 12, 21, 29, 38, 47, 55, 64, 73, 82, 91, 101];
  for (let i = 0; i < idxs.length; i++) {
    const idx = Math.min(idxs[i], EQUITY.length - 1);
    const point = EQUITY[idx];
    const direction = pick(DIRECTIONS);
    const symbol = pick(SYMBOLS);
    const pnl = Math.round((rand() * 900 - 400) * 100) / 100;
    markers.push({
      date: point.date,
      equity: point.equity,
      tradeId: `t-${i + 1}`,
      symbol,
      direction,
      markerType: i % 2 === 0 ? 'entry' : 'exit',
      price: Math.round((20 + rand() * 480) * 100) / 100,
      pnl,
    });
  }
  return markers;
})();

// 2. Monthly performance: 12 months.
const MONTHLY: MonthlyPerformanceItem[] = [
  { month: '2025-07', netPnl: 1240, winRate: 0.58, tradeCount: 14 },
  { month: '2025-08', netPnl: -680, winRate: 0.42, tradeCount: 18 },
  { month: '2025-09', netPnl: 2310, winRate: 0.64, tradeCount: 16 },
  { month: '2025-10', netPnl: 875, winRate: 0.55, tradeCount: 13 },
  { month: '2025-11', netPnl: -1420, winRate: 0.38, tradeCount: 21 },
  { month: '2025-12', netPnl: 3180, winRate: 0.67, tradeCount: 19 },
  { month: '2026-01', netPnl: 1965, winRate: 0.61, tradeCount: 17 },
  { month: '2026-02', netPnl: -940, winRate: 0.44, tradeCount: 15 },
  { month: '2026-03', netPnl: 2675, winRate: 0.66, tradeCount: 20 },
  { month: '2026-04', netPnl: 1505, winRate: 0.59, tradeCount: 16 },
  { month: '2026-05', netPnl: -310, winRate: 0.48, tradeCount: 12 },
  { month: '2026-06', netPnl: 4020, winRate: 0.71, tradeCount: 22 },
];

// 3. R distribution: 8 bins.
const R_DISTRIBUTION: RDistributionBin[] = [
  { label: '<= -3', count: 2 },
  { label: '-3 to -2', count: 5 },
  { label: '-2 to -1', count: 9 },
  { label: '-1 to 0', count: 14 },
  { label: '0 to 1', count: 22 },
  { label: '1 to 2', count: 16 },
  { label: '2 to 3', count: 8 },
  { label: '> 3', count: 4 },
];

// 4. Calendar heatmap: ~150 trading days in 2026 with realistic P&L spread.
const HEATMAP_2026 = weekdayDates('2026-01-02', '2026-12-31')
  .map((date) => {
    const r = rand();
    const pnl =
      r < 0.18
        ? -Math.round((150 + rand() * 900) * 100) / 100 // losing days
        : r < 0.62
          ? 0 // flat / scratch
          : Math.round((100 + rand() * 1100) * 100) / 100; // winning days
    return { date, pnl };
  })
  .filter((d) => d.pnl !== 0);
const HEATMAP_DATA: CalendarHeatmapYearData[] = [
  { year: 2026, days: HEATMAP_2026 },
];

// 5. Process discipline: A–F bins.
const PROCESS_BINS: ProcessScoreBin[] = [
  { label: 'A (54-60)', count: 11, minScore: 54 },
  { label: 'B (42-53)', count: 19, minScore: 42 },
  { label: 'C (30-41)', count: 16, minScore: 30 },
  { label: 'D (18-29)', count: 7, minScore: 18 },
  { label: 'F (0-17)', count: 4, minScore: 0 },
];

// 6. Period matrix: wow / mom / qoq comparisons.
function pmRow(comparisonType: string, i: number): PeriodMatrixResult['rows'][number] {
  const now = new Date('2026-07-05T00:00:00Z');
  const back = (weeks: number): string => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - weeks * 7);
    return d.toISOString().slice(0, 10);
  };
  const pnlCur = 600 - i * 40 + Math.round(rand() * 200);
  const pnlPrev = 400 - i * 30 + Math.round(rand() * 180);
  return {
    current: {
      periodId: `${comparisonType}-cur-${i}`,
      periodLabel: `Period ${i + 1}`,
      startDate: back(i * 2 + 1),
      endDate: back(i * 2),
      winRate: 0.58 - i * 0.03,
      pnl: pnlCur,
      tradeCount: 14 + i,
      avgR: 1.3 - i * 0.08,
    },
    previous: {
      periodId: `${comparisonType}-prev-${i}`,
      periodLabel: `Period ${i + 2}`,
      startDate: back(i * 2 + 3),
      endDate: back(i * 2 + 2),
      winRate: 0.51 - i * 0.02,
      pnl: pnlPrev,
      tradeCount: 12 + i,
      avgR: 1.1 - i * 0.05,
    },
    delta: {
      winRate: 0.07 - i * 0.01,
      pnl: pnlCur - pnlPrev,
      tradeCount: 2,
      avgR: 0.2 - i * 0.03,
    },
  };
}

const PERIOD_MATRIX: Record<string, PeriodMatrixResult> = {
  wow: { comparisonType: 'wow', rows: [pmRow('wow', 0), pmRow('wow', 1), pmRow('wow', 2)] },
  mom: { comparisonType: 'mom', rows: [pmRow('mom', 0), pmRow('mom', 1)] },
  qoq: { comparisonType: 'qoq', rows: [pmRow('qoq', 0)] },
};

// 7. Setup ranking: 5 setups.
const SETUP_RANKING: SetupPerfResult[] = [
  { setupName: 'Pullback', setupId: 'setup-1', count: 42, winRate: 0.61, avgR: 1.6, avgProcessScore: 44, sampleSizeWarning: 'adequate' },
  { setupName: 'Breakout', setupId: 'setup-2', count: 28, winRate: 0.54, avgR: 1.2, avgProcessScore: 38, sampleSizeWarning: 'adequate' },
  { setupName: 'Reversal', setupId: 'setup-3', count: 15, winRate: 0.73, avgR: 2.2, avgProcessScore: 35, sampleSizeWarning: 'small' },
  { setupName: 'Gap Fill', setupId: 'setup-4', count: 8, winRate: 0.38, avgR: 0.9, avgProcessScore: 29, sampleSizeWarning: 'small' },
  { setupName: 'Scalp', setupId: 'setup-5', count: 3, winRate: 0.33, avgR: 0.6, avgProcessScore: 26, sampleSizeWarning: 'very_small' },
];

// 8. Attention insights.
const ATTENTION_INSIGHTS: AttentionInsight[] = [
  {
    type: 'concentration',
    severity: 'critical',
    title: 'NVDA is 38% of your gross exposure',
    message: 'A single-symbol concentration above 30% materially raises tail risk. Consider trimming or hedging the position.',
    value: '38%',
  },
  {
    type: 'losing_streak',
    severity: 'warning',
    title: 'On a 4-trade losing streak',
    message: "You've lost 4 consecutive trades. Consider reducing position size or taking a break to reassess.",
    value: 4,
  },
  {
    type: 'avg_r_trend',
    severity: 'warning',
    title: 'Average R trending down',
    message: 'Your 20-trade average R fell from 1.4R to 0.9R. Entries may be drifting from the plan.',
    value: '0.9R',
  },
  {
    type: 'day_of_week_best',
    severity: 'info',
    title: 'Tuesday is your best trading day',
    message: "Tuesday: 68% win rate across 22 trades. That's 2.1x better than Wednesday (32% across 19 trades).",
    value: '68%',
  },
  {
    type: 'top_trade',
    severity: 'info',
    title: 'Best trade: 4.2R',
    message: 'Your best trade returned 4.2R with a P&L of $1,260.00.',
    value: '4.2R',
  },
];

// 9. Directional performance.
const DIRECTIONAL: DirectionalPerformanceResult = {
  long: { netPnl: 4860, winRate: 0.62, tradeCount: 58 },
  short: { netPnl: -1240, winRate: 0.41, tradeCount: 27 },
};

/* ── Page ────────────────────────────────────────────────────────────── */

const PALETTE_KEYS = ['primary', 'positive', 'negative', 'warning', 'missing', 'grid', 'axis', 'reference'] as const;
const SERIES_LABELS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const;

function SectionCard({
  title,
  caption,
  children,
  className = '',
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{caption}</span>
      </div>
      <div className="h-[300px] w-full">{children}</div>
    </section>
  );
}

export default function ChartsProofPage() {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const [showPalette, setShowPalette] = useState(true);
  const heatmapData = useMemo(() => HEATMAP_DATA, []);
  const periodMatrix = useMemo(() => PERIOD_MATRIX, []);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            Chart Palette Proof — {theme} theme
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            9 dashboard widgets · Graphite + Steel Blue palette · toggle switches colors in place
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPalette((v) => !v)}
            className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {showPalette ? 'Hide palette' : 'Show palette'}
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Palette swatches */}
      {showPalette && (
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Resolved ECharts palette ({theme})
          </p>
          <div className="flex flex-wrap gap-4">
            {PALETTE_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span
                  className="inline-block size-5 rounded border border-black/10 dark:border-white/20"
                  style={{ backgroundColor: palette[key] }}
                />
                <span className="text-xs text-zinc-600 dark:text-zinc-300">{key}</span>
                <code className="text-[10px] text-zinc-400 dark:text-zinc-500">{palette[key]}</code>
              </div>
            ))}
            <div className="w-full" />
            {SERIES_LABELS.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className="inline-block size-5 rounded border border-black/10 dark:border-white/20"
                  style={{ backgroundColor: palette.series[i] }}
                />
                <span className="text-xs text-zinc-600 dark:text-zinc-300">{label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="inline-block size-5 rounded border border-black/10 dark:border-white/20" style={{ background: `linear-gradient(90deg, ${palette.heatmap.join(', ')})` }} />
              <span className="text-xs text-zinc-600 dark:text-zinc-300">heatmap (8 stops)</span>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Light: {chartPalette.light.primary} · Dark: {chartPalette.dark.primary}
          </p>
        </div>
      )}

      {/* Widgets */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <SectionCard title="1 · Equity & Drawdown" caption="equity-drawdown-chart.tsx">
            <EquityDrawdownChart equityCurve={EQUITY} drawdown={DRAWDOWN} tradeMarkers={TRADE_MARKERS} />
          </SectionCard>
        </div>

        <div className="lg:col-span-2">
          <SectionCard title="4 · Calendar Heatmap" caption="calendar-heatmap-widget.tsx (visualMap ← palette.heatmap)">
            <CalendarHeatmapWidget heatmapData={heatmapData} />
          </SectionCard>
        </div>

        <SectionCard title="2 · Monthly Performance" caption="monthly-performance-chart.tsx (positive/negative bars)">
          <MonthlyPerformanceChart monthlyPerformance={MONTHLY} />
        </SectionCard>

        <SectionCard title="3 · R Distribution" caption="r-distribution-chart.tsx (missing/positive/negative)">
          <RDistributionChart rDistribution={R_DISTRIBUTION} />
        </SectionCard>

        <SectionCard title="5 · Process Discipline" caption="process-discipline-widget.tsx (series[0..4], F → negative)">
          <ProcessDisciplineWidget processScoreDistribution={PROCESS_BINS} />
        </SectionCard>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">6 · Period Matrix</h2>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">period-matrix-widget.tsx (token-clean)</span>
          </div>
          <PeriodMatrixWidget periodMatrixData={periodMatrix} />
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">7 · Setup Ranking</h2>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">setup-ranking-widget.tsx (token-clean)</span>
          </div>
          <SetupRankingWidget setupRanking={SETUP_RANKING} />
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">8 · Attention Insights</h2>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">attention-insights-widget.tsx (token-clean)</span>
          </div>
          <AttentionInsightsWidget insights={ATTENTION_INSIGHTS} />
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">9 · Directional Performance</h2>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">directional-performance-widget.tsx (token-clean)</span>
          </div>
          <DirectionalPerformanceWidget directionalPerformance={DIRECTIONAL} />
        </section>
      </div>

      {/* Data-fidelity readout */}
      <footer className="mt-8 rounded-xl border border-dashed border-zinc-300 p-4 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <p className="mb-1 font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Fixture data (deterministic, seed 0x5A04)</p>
        <p>
          Equity: {EQUITY.length} days, start $25,000 · Final equity ${EQUITY[EQUITY.length - 1]?.equity?.toLocaleString()} · {TRADE_MARKERS.length} trade markers ·
          Monthly net P&amp;L {MONTHLY.reduce((s, m) => s + m.netPnl, 0) > 0 ? '+' : ''}${MONTHLY.reduce((s, m) => s + m.netPnl, 0).toLocaleString()} ·
          R bins: {R_DISTRIBUTION.reduce((s, b) => s + b.count, 0)} trades · Heatmap: {HEATMAP_2026.length} days ·
          Grades: {PROCESS_BINS.reduce((s, b) => s + b.count, 0)} scores · Periods: wow {PERIOD_MATRIX.wow.rows.length} + mom {PERIOD_MATRIX.mom.rows.length} + qoq {PERIOD_MATRIX.qoq.rows.length} ·
          Setups: {SETUP_RANKING.length} · Insights: {ATTENTION_INSIGHTS.length} · Long +${DIRECTIONAL.long.netPnl.toLocaleString()} / Short {DIRECTIONAL.short.netPnl.toLocaleString()}
        </p>
      </footer>
    </main>
  );
}
