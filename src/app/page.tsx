'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  NotebookPen,
} from 'lucide-react';
import { useVisibilityPolling } from '@/hooks/use-visibility-polling';

import { EmptyState } from '@/components/empty-state';
import { DashboardFilters } from '@/components/dashboard-filters';
import { DashboardV2 } from '@/components/dashboard-v2';
import { DashboardLayout } from '@/components/dashboard/dashboard-layout';
import { EquityDrawdownChart } from '@/components/dashboard/equity-drawdown-chart';
import { CalendarHeatmapWidget } from '@/components/dashboard/calendar-heatmap-widget';
import { PeriodMatrixWidget } from '@/components/dashboard/period-matrix-widget';
import { SetupRankingWidget } from '@/components/dashboard/setup-ranking-widget';
import { ThemeToggle } from '@/components/theme-toggle';
import { ProcessDisciplineWidget } from '@/components/dashboard/process-discipline-widget';
import { AttentionInsightsWidget } from '@/components/dashboard/attention-insights-widget';
import { MonthlyPerformanceChart } from '@/components/dashboard/monthly-performance-chart';
import { RDistributionChart } from '@/components/dashboard/r-distribution-chart';
import { DirectionalPerformanceWidget } from '@/components/dashboard/directional-performance-widget';
import { DashboardWidget } from '@/components/dashboard/dashboard-widget';
import { useDashboardLayout } from '@/components/dashboard/use-dashboard-layout';
import {
  FilterProvider,
  useDashboardFilters,
} from '@/components/dashboard/filter-context';
import {
  KPI_WIDGET_MAP,
  DEFAULT_KPI_LAYOUT,
  KpiSectionHeader,
  SECTION_TINTS,
  PTD_WIDGET_IDS,
  CURRENT_STATE_WIDGET_IDS,
} from '@/components/dashboard/kpi-widgets';
import type { Layout } from 'react-grid-layout';
import type { KpiMetrics, MtmData } from '@/components/dashboard/kpi-widgets';
import type { EquityDataPoint, DrawdownDataPoint, TradeMarkerPoint } from '@/lib/equity';
import type { CalendarHeatmapYearData } from '@/lib/calendar-heatmap';
import type { PeriodMatrixResult } from '@/lib/period-matrix';
import type {
  MonthlyPerformanceItem,
  RDistributionBin,
  DirectionalPerformanceResult,
  ProcessScoreBin,
} from '@/lib/dashboard';
import type { SetupPerfResult } from '@/lib/review-dashboard';
import type { AttentionInsight } from '@/lib/attention-insights';

// ── Types ──────────────────────────────────────────────────────────────


interface DashboardResponse {
  kpis: KpiMetrics;
  mtm: MtmData;
  equityCurve: EquityDataPoint[];
  drawdown: DrawdownDataPoint[];
  monthlyPerformance: MonthlyPerformanceItem[];
  rDistribution: RDistributionBin[];
  directionalPerformance?: DirectionalPerformanceResult;
  processScoreDistribution?: ProcessScoreBin[];
  tradeMarkers?: TradeMarkerPoint[];
  calendarHeatmap: CalendarHeatmapYearData[];
  periodMatrix: Record<string, PeriodMatrixResult>;
  setupRanking: SetupPerfResult[];
  attentionInsights: { insights: AttentionInsight[]; tradeCount: number };
}

// ── Default chart layout (12 cols: 2 charts per row) ──────────────────

const CHART_WIDGET_IDS = [
  'equity-drawdown',
  'calendar-heatmap',
  'setup-ranking',
  'process-discipline',
  'monthly-performance',
  'r-distribution',
  'period-matrix',
  'attention-insights',
  'directional-performance',
] as const;

const DEFAULT_CHART_LAYOUT = [
  { i: 'equity-drawdown', x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 4 },
  { i: 'calendar-heatmap', x: 0, y: 5, w: 12, h: 6, minW: 6, minH: 4 },
  { i: 'setup-ranking', x: 0, y: 11, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'process-discipline', x: 6, y: 11, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'monthly-performance', x: 0, y: 16, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'r-distribution', x: 6, y: 16, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'period-matrix', x: 0, y: 21, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'attention-insights', x: 6, y: 21, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'directional-performance', x: 0, y: 26, w: 12, h: 3, minW: 6, minH: 3 },
];

const CHART_TITLES: Record<string, string> = {
  'equity-drawdown': 'Equity & Drawdown',
  'calendar-heatmap': 'Calendar Heatmap',
  'setup-ranking': 'Setup Ranking',
  'process-discipline': 'Process Discipline',
  'monthly-performance': 'Monthly Performance',
  'r-distribution': 'R Distribution',
  'period-matrix': 'Period Comparison',
  'attention-insights': 'Attention Insights',
  'directional-performance': 'Directional Performance',
};

// ── Skeleton Card ──────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 size-9 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      <div className="mb-1 h-7 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-3 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

// ── Page Content ───────────────────────────────────────────────────────

function HomeContent() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [showMoreAnalytics, setShowMoreAnalytics] = useState(false);

  const router = useRouter();
  const { filters, actions } = useDashboardFilters();

  // Dashboard Layout hooks
  const {
    layout: kpiLayout,
    setLayout: setKpiLayout,
    isLoaded: kpiLoaded,
  } = useDashboardLayout({
    defaultLayout: DEFAULT_KPI_LAYOUT,
    storageKey: 'dashboard:kpi-layout:v1',
  });
  const {
    layout: chartLayout,
    setLayout: setChartLayout,
    isLoaded: chartLoaded,
  } = useDashboardLayout({
    defaultLayout: DEFAULT_CHART_LAYOUT,
    storageKey: 'dashboard:chart-layout:v1',
  });

  // ── Data Fetching ──────────────────────────────────────────────────

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.accountId) params.set('accountId', filters.accountId);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      const qs = params.toString();
      const url = `/api/dashboard${qs ? `?${qs}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to load dashboard');
      }
      const result: DashboardResponse = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDashboard();
  }, [fetchDashboard]);

  // Sync filter state to URL search params
  useEffect(() => {
    const params = actions.toSearchParams();
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : '/', { scroll: false });
  }, [filters, router, actions]);

  // Cooldown countdown timer for Refresh Prices
  const isCooldownActive = cooldownSeconds > 0;
  useEffect(() => {
    if (!isCooldownActive) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isCooldownActive]);

  // Refresh Prices handler — calls POST /api/trades/mtm/refresh then refetches dashboard
  const handleRefreshPrices = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/trades/mtm/refresh', { method: 'POST' });
      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') ?? '10', 10);
          setCooldownSeconds(retryAfter);
          return;
        }
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Refresh failed (${res.status})`);
      }
      // Success — refetch dashboard to get updated MTM values
      await fetchDashboard();
      // Client-side cooldown to prevent rapid re-clicks
      setCooldownSeconds(10);
    } catch (err) {
      console.error('Failed to refresh prices:', err);
    } finally {
      setRefreshing(false);
    }
  }, [fetchDashboard]);

  // Destructure data
  const kpis = data?.kpis ?? null;
  const mtm = data?.mtm ?? null;
  const equityCurve = data?.equityCurve ?? [];
  const drawdown = data?.drawdown ?? [];
  const monthlyPerformance = data?.monthlyPerformance ?? [];
  const rDistribution = data?.rDistribution ?? [];
  const directionalPerformance = data?.directionalPerformance ?? null;
  const processScoreDistribution = data?.processScoreDistribution ?? null;
  const setupRanking = data?.setupRanking ?? [];
  const attentionInsights = data?.attentionInsights ?? { insights: [], tradeCount: 0 };
  const tradeMarkers = data?.tradeMarkers ?? [];
  const calendarHeatmap = data?.calendarHeatmap ?? [];
  const periodMatrix = data?.periodMatrix ?? null;

  // Detect empty state
  const isEmpty =
    kpis !== null &&
    kpis.totalTrades === 0 &&
    kpis.winRate === null &&
    kpis.netPnl === 0 &&
    kpis.avgR === null &&
    kpis.avgGrade === null &&
    kpis.currentDrawdown === null &&
    kpis.accountValue === null;

  // ── Render chart content helper ─────────────────────────────────────

  const renderChartContent = (id: string) => {
    switch (id) {
      case 'equity-drawdown':
        return (
          <EquityDrawdownChart
            equityCurve={equityCurve}
            drawdown={drawdown}
            tradeMarkers={tradeMarkers}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-equity-drawdown"
          />
        );
      case 'monthly-performance':
        return (
          <MonthlyPerformanceChart
            monthlyPerformance={monthlyPerformance}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-monthly-performance"
          />
        );
      case 'r-distribution':
        return (
          <RDistributionChart
            rDistribution={rDistribution}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-r-distribution"
          />
        );
      case 'directional-performance':
        return (
          <DirectionalPerformanceWidget
            directionalPerformance={directionalPerformance}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-directional-performance"
          />
        );
      case 'calendar-heatmap':
        return (
          <CalendarHeatmapWidget
            heatmapData={calendarHeatmap}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-calendar-heatmap"
          />
        );
      case 'period-matrix':
        return (
          <PeriodMatrixWidget
            periodMatrixData={periodMatrix}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-period-matrix"
          />
        );
      case 'setup-ranking':
        return (
          <SetupRankingWidget
            setupRanking={setupRanking}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-setup-ranking"
          />
        );
      case 'process-discipline':
        return (
          <ProcessDisciplineWidget
            processScoreDistribution={processScoreDistribution ?? []}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-process-discipline"
          />
        );
      case 'attention-insights':
        return (
          <AttentionInsightsWidget
            insights={attentionInsights.insights}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-attention-insights"
          />
        );
      default:
        return null;
    }
  };

  /** Whether we have dashboard data (used to show/hide widget sections) */
  const hasData = kpis !== null && !isEmpty;

  // Wire visibility-aware MTM polling: refetch every 30s while the tab is visible,
  // pause when backgrounded. Only active after initial data has loaded.
  useVisibilityPolling(fetchDashboard, 30000, hasData);

  /** Whether we're refetching while stale data is still visible */
  const isRefetching = loading && hasData;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-3 sm:px-8 sm:py-10">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 [text-wrap:balance]">
          Dashboard
        </h1>
        <ThemeToggle />
      </div>
      <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
        Overview of your trading performance and activity.
      </p>

      {/* Global Filter Bar */}
      <DashboardFilters
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        accountId={filters.accountId}
        onDateFromChange={actions.setDateFrom}
        onDateToChange={actions.setDateTo}
        onAccountIdChange={actions.setAccountId}
      />

      {/* Quick date filters — wired to FilterProvider actions */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[
          { label: '1W', days: 7 },
          { label: '1M', days: 30 },
          { label: '3M', days: 90 },
          { label: '6M', days: 180 },
          { label: 'YTD', days: null },
          { label: 'All', days: null, clear: true },
        ].map((preset) => (
          <button
            key={preset.label}
            onClick={() => {
              if (preset.clear) {
                actions.setDatePreset('All');
              } else if (preset.label === 'YTD') {
                actions.setDatePreset('YTD');
              } else if (preset.days) {
                const key = preset.label as '1W' | '1M' | '3M' | '6M';
                actions.setDatePreset(key);
              }
            }}
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && !data && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={fetchDashboard}
            className="ml-2 shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-800/50"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state — pulse-animated skeleton rectangles */}
      {loading && !data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {Array.from({ length: 11 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          {/* Charts loading skeleton */}
          <section className="mt-8">
            <div className="mb-4 h-5 w-40 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-3 h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
                  <div className="h-[300px] w-full rounded bg-zinc-100 dark:bg-zinc-800" />
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Account Performance (V2 Dashboard) */}
      <DashboardV2 initialAccountId={filters.accountId ?? undefined} />

      {/* KPI Widgets — Journal Performance section */}
      {hasData && (
        <>
          {/* Period-to-Date Section */}
          <div className={SECTION_TINTS.PTD + ' rounded-lg mb-6'}>
            <KpiSectionHeader
              title="Period-to-Date"
              description="Metrics derived from closed trades in the filtered date range."
              tint="bg-blue-50/40 dark:bg-blue-950/20"
            />
            {kpiLoaded && (
              <DashboardLayout
                layout={kpiLayout.filter((l) => PTD_WIDGET_IDS.includes(l.i))}
                onLayoutChange={(newLayout: Layout) => {
                  const other = kpiLayout.filter((l) => !PTD_WIDGET_IDS.includes(l.i));
                  const full = [...newLayout, ...other];
                  setKpiLayout(full);
                }}
                cols={4}
                rowHeight={80}
                margin={[12, 12]}
              >
                {kpiLayout
                  .filter((l) => PTD_WIDGET_IDS.includes(l.i))
                  .map((item) => {
                    const Widget = KPI_WIDGET_MAP[item.i];
                    if (!Widget) return <div key={item.i} />;
                    return (
                      <div key={item.i}>
                        <Widget
                          kpis={kpis}
                          mtm={mtm}
                          isLoading={isRefetching}
                          error={isRefetching && error ? error : null}
                          onRefresh={item.i === 'unrealized-pnl' ? handleRefreshPrices : undefined}
                          isRefreshing={item.i === 'unrealized-pnl' ? refreshing : undefined}
                        />
                      </div>
                    );
                  })}
              </DashboardLayout>
            )}
          </div>

          {/* Current-State Section */}
          <div className={SECTION_TINTS.CURRENT + ' rounded-lg mb-6'}>
            <KpiSectionHeader
              title="Current State"
              description="Metrics reflecting your current account position and open trades."
              tint="bg-amber-50/40 dark:bg-amber-950/20"
            />
            {kpiLoaded && (
              <DashboardLayout
                layout={kpiLayout.filter((l) => CURRENT_STATE_WIDGET_IDS.includes(l.i))}
                onLayoutChange={(newLayout: Layout) => {
                  const other = kpiLayout.filter((l) => !CURRENT_STATE_WIDGET_IDS.includes(l.i));
                  const full = [...other, ...newLayout];
                  setKpiLayout(full);
                }}
                cols={4}
                rowHeight={80}
                margin={[12, 12]}
              >
                {kpiLayout
                  .filter((l) => CURRENT_STATE_WIDGET_IDS.includes(l.i))
                  .map((item) => {
                    const Widget = KPI_WIDGET_MAP[item.i];
                    if (!Widget) return <div key={item.i} />;
                    return (
                      <div key={item.i}>
                        <Widget
                          kpis={kpis}
                          mtm={mtm}
                          isLoading={isRefetching}
                          error={isRefetching && error ? error : null}
                          onRefresh={item.i === 'unrealized-pnl' ? handleRefreshPrices : undefined}
                          isRefreshing={item.i === 'unrealized-pnl' ? refreshing : undefined}
                        />
                      </div>
                    );
                  })}
              </DashboardLayout>
            )}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && (kpis === null || isEmpty) && (
        <EmptyState
          icon={<NotebookPen className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title="No trades yet"
          description="Plan your first trade from the Trade Log. Track setups, entries, and outcomes to build your performance history."
        />
      )}

      {/* Chart Widgets Grid */}
      {hasData && chartLoaded && (
        <section className="mb-6">
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 [text-wrap:balance]">
            Performance Charts
          </h2>
          <DashboardLayout
            layout={chartLayout}
            onLayoutChange={(newLayout: Layout) => setChartLayout([...newLayout])}
            cols={12}
            rowHeight={80}
            margin={[12, 12]}
          >
            {chartLayout
              .filter((l) => CHART_WIDGET_IDS.includes(l.i as typeof CHART_WIDGET_IDS[number]))
              .map((item) => {
                const content = renderChartContent(item.i);
                // Widgets that include their own DashboardWrapper (EquityDrawdownChart,
                // MonthlyPerformanceChart, RDistributionChart, DirectionalPerformanceWidget)
                if (['equity-drawdown', 'monthly-performance', 'r-distribution', 'directional-performance'].includes(item.i)) {
                  return <div key={item.i}>{content}</div>;
                }
                return (
                  <div key={item.i}>
                    <DashboardWidget title={CHART_TITLES[item.i] ?? item.i} isLoading={isRefetching} error={isRefetching && error ? error : null}>
                      {content}
                    </DashboardWidget>
                  </div>
                );
              })}
          </DashboardLayout>
        </section>
      )}

      {/* Toggle for additional analytics */}
      {hasData && (
        <div className="mb-6 flex justify-center">
          <button
            onClick={() => setShowMoreAnalytics(!showMoreAnalytics)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {showMoreAnalytics ? '\u25BC Hide' : '\u25B6 Show'} detailed analytics
          </button>
        </div>
      )}

      {/* Directional Performance (shown when toggled) */}
      {showMoreAnalytics && hasData && directionalPerformance && chartLoaded && (
        <section className="mb-6">
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 [text-wrap:balance]">
            Directional Performance
          </h2>
          <DashboardLayout
            layout={chartLayout.filter((l) => l.i === 'directional-performance')}
            onLayoutChange={(newLayout: Layout) => {
              const other = chartLayout.filter((l) => l.i !== 'directional-performance');
              setChartLayout([...other, ...newLayout]);
            }}
            cols={12}
            rowHeight={80}
            margin={[12, 12]}
          >
            <div key="directional-performance">
              {renderChartContent('directional-performance')}
            </div>
          </DashboardLayout>
        </section>
      )}


    </div>
  );
}

// ── Home Export ────────────────────────────────────────────────────────

export default function Home() {
  useEffect(() => {
    document.title = 'Dashboard — Trading Journal';
  }, []);

  return (
    <Suspense fallback={null}>
      <FilterProviderWrapper />
    </Suspense>
  );
}

/**
 * Inner wrapper that extracts searchParams and initializes FilterProvider.
 * Must be inside <Suspense> because useSearchParams() requires it.
 */
function FilterProviderWrapper() {
  const searchParams = useSearchParams();

  return (
    <FilterProvider
      initialFilters={{
        dateFrom: searchParams.get('dateFrom') ?? '',
        dateTo: searchParams.get('dateTo') ?? '',
        accountId: searchParams.get('accountId') ?? null,
      }}
    >
      <HomeContent />
    </FilterProvider>
  );
}
