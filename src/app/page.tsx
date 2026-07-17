'use client';

import { Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useVisibilityPolling } from '@/hooks/use-visibility-polling';

import { useCustomizationMode } from '@/hooks/use-customization-mode';
import { AddRemoveWidgetsDialog } from '@/components/dashboard/add-remove-widgets-dialog';
import { CustomizingProvider } from '@/lib/customizing-context';
import { DashboardFilters } from '@/components/dashboard-filters';
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
import { AccountPerformancePanel } from '@/components/dashboard/account-performance-panel';
import { PtdPerformancePanel } from '@/components/dashboard/ptd-performance-panel';
import { CurrentRiskPanel } from '@/components/dashboard/current-risk-panel';
import { ValuationPositionsWidget } from '@/components/dashboard/valuation-positions-widget';
import { useDashboardLayout } from '@/components/dashboard/use-dashboard-layout';
import {
  FilterProvider,
  useDashboardFilters,
} from '@/components/dashboard/filter-context';
import {
  WIDGET_IDS,
  WIDGET_REGISTRY,
  DEFAULT_UNIFIED_LAYOUT,
} from '@/components/dashboard/widget-registry';
import type { WidgetId } from '@/components/dashboard/widget-registry';
import type { Layout } from 'react-grid-layout';
import type { KpiMetrics, MtmData } from '@/components/dashboard/kpi-widgets';
import type { DashboardV2Response } from '@/components/dashboard-v2';
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

// ── Loading Skeleton ───────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-3 size-9 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
          <div className="mb-1 h-7 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-3 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
      ))}
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

  // DashboardV2 (account-level /api/dashboard/v2) state
  const [v2Data, setV2Data] = useState<DashboardV2Response | null>(null);
  const [v2Loading, setV2Loading] = useState(true);
  const [v2Error, setV2Error] = useState<string | null>(null);

  const router = useRouter();
  const { filters, actions } = useDashboardFilters();

  // Single unified dashboard layout — replaces the two separate
  // kpi-layout and chart-layout hooks from the old implementation.
  const {
    layout: unifiedLayout,
    setLayout: setUnifiedLayout,
    isLoaded: unifiedLoaded,
  } = useDashboardLayout({
    defaultLayout: DEFAULT_UNIFIED_LAYOUT,
    storageKey: 'dashboard:layout:v2',
  });

  // ── Customization Mode ──────────────────────────────────────────────

  /** Persisted hidden widget IDs — survives page reloads. */
  const [storedHiddenWidgetIds, setStoredHiddenWidgetIds] = useState<string[]>(
    () => {
      if (typeof window === 'undefined') return [];
      try {
        const raw = localStorage.getItem('dashboard:hidden-widgets:v2');
        return raw ? (JSON.parse(raw) as string[]) : [];
      } catch {
        return [];
      }
    },
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const preEditHiddenRef = useRef<string[]>([]);

  const cm = useCustomizationMode({
    defaultLayout: DEFAULT_UNIFIED_LAYOUT,
    allWidgetIds: Object.values(WIDGET_IDS) as string[],
  });

  /** Persist hidden widget IDs to localStorage whenever they change. */
  useEffect(() => {
    try {
      localStorage.setItem(
        'dashboard:hidden-widgets:v2',
        JSON.stringify(storedHiddenWidgetIds),
      );
    } catch {
      /* localStorage may be full or disabled — silently ignore */
    }
  }, [storedHiddenWidgetIds]);

  /**
   * Filter layout items based on the current visibility state.
   * During customization, the hook tracks toggled-off widgets.
   * Outside customization, persisted hidden IDs apply.
   */
  const visibleLayout = useMemo(() => {
    const hidden = cm.isCustomizing
      ? cm.hiddenWidgetIds
      : storedHiddenWidgetIds;
    return unifiedLayout.filter((item) => !hidden.includes(item.i));
  }, [unifiedLayout, cm.isCustomizing, cm.hiddenWidgetIds, storedHiddenWidgetIds]);

  const handleEnterCustomization = useCallback(() => {
    preEditHiddenRef.current = storedHiddenWidgetIds;
    cm.enterCustomization(unifiedLayout);
    setDialogOpen(true);
  }, [storedHiddenWidgetIds, unifiedLayout, cm]);

  const handleSave = useCallback(() => {
    const saved = cm.saveCustomization(unifiedLayout);
    if (saved) {
      setStoredHiddenWidgetIds(saved.hiddenWidgetIds);
    }
    setDialogOpen(false);
  }, [unifiedLayout, cm]);

  const handleCancel = useCallback(() => {
    const restored = cm.cancelCustomization();
    if (restored) {
      setUnifiedLayout(restored);
      setStoredHiddenWidgetIds(preEditHiddenRef.current);
    }
    setDialogOpen(false);
  }, [cm, setUnifiedLayout]);

  const handleReset = useCallback(() => {
    const defaults = cm.resetToDefaults();
    setUnifiedLayout(defaults);
    setStoredHiddenWidgetIds([]);
    setDialogOpen(false);
  }, [cm, setUnifiedLayout]);

  const handleToggleWidget = useCallback(
    (widgetId: WidgetId) => {
      cm.toggleWidgetVisibility(widgetId);
    },
    [cm],
  );

  // ── Data Fetch: /api/dashboard ──────────────────────────────────────

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

  // ── Data Fetch: /api/dashboard/v2 ───────────────────────────────────

  const fetchDashboardV2 = useCallback(async () => {
    setV2Loading(true);
    setV2Error(null);
    try {
      const params = new URLSearchParams();
      if (filters.accountId) params.set('accountId', filters.accountId);
      const qs = params.toString();
      const url = `/api/dashboard/v2${qs ? `?${qs}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to load account data');
      }
      const result: DashboardV2Response = await res.json();
      setV2Data(result);
    } catch (err) {
      setV2Error(err instanceof Error ? err.message : 'Failed to load account data');
      setV2Data(null);
    } finally {
      setV2Loading(false);
    }
  }, [filters]);

  // ── Effects ────────────────────────────────────────────────────────

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDashboardV2();
  }, [fetchDashboardV2]);

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

  // ── Handlers ────────────────────────────────────────────────────────

  /** Refresh MTM prices via POST /api/trades/mtm/refresh, then refetch both datasets. */
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
      // Success — refetch both endpoints to get updated MTM/V2 values
      await Promise.all([fetchDashboard(), fetchDashboardV2()]);
      // Client-side cooldown to prevent rapid re-clicks
      setCooldownSeconds(10);
    } catch (err) {
      console.error('Failed to refresh prices:', err);
    } finally {
      setRefreshing(false);
    }
  }, [fetchDashboard, fetchDashboardV2]);

  /** Standalone refresh for the Account Performance panel (V2 data only). */
  const handleRefreshV2 = useCallback(() => {
    fetchDashboardV2();
  }, [fetchDashboardV2]);

  // ── Derived State ───────────────────────────────────────────────────

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

  const isEmpty =
    kpis !== null &&
    kpis.totalTrades === 0 &&
    kpis.winRate === null &&
    kpis.netPnl === 0 &&
    kpis.avgR === null &&
    kpis.avgGrade === null &&
    kpis.currentDrawdown === null &&
    kpis.accountValue === null;

  const hasData = kpis !== null && !isEmpty;
  const isRefetching = loading && hasData;
  const hasV2Data = v2Data !== null;
  const isV2Refetching = v2Loading && hasV2Data;

  // Wire visibility-aware MTM polling: refetch every 30s while the tab is visible,
  // pause when backgrounded. Only active after initial data has loaded.
  useVisibilityPolling(fetchDashboard, 30000, hasData);

  // ── Widget Renderer ─────────────────────────────────────────────────

  /** Map a WidgetId to its React component with the appropriate data slices. */
  function renderWidget(id: WidgetId): React.ReactNode {
    switch (id) {
      // ── Grouped Metric Panels ────────────────────────────────────────
      case WIDGET_IDS.ACCOUNT_PERFORMANCE:
        return (
          <AccountPerformancePanel
            data={v2Data}
            isLoading={isV2Refetching}
            error={v2Error}
            onRefresh={handleRefreshV2}
            isRefreshing={v2Loading && v2Data !== null}
          />
        );
      case WIDGET_IDS.PTD_PERFORMANCE:
        return (
          <PtdPerformancePanel
            data={kpis}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
          />
        );
      case WIDGET_IDS.CURRENT_RISK:
        return (
          <CurrentRiskPanel
            data={kpis}
            mtm={mtm}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            onRefresh={handleRefreshPrices}
            isRefreshing={refreshing}
          />
        );

      // ── Valuation / Account Details ──────────────────────────────────
      case WIDGET_IDS.VALUATION_POSITIONS:
        return (
          <ValuationPositionsWidget
            data={v2Data?.valuation ?? null}
            isLoading={isV2Refetching}
            error={v2Error}
          />
        );

      // ── Primary Chart Widgets ────────────────────────────────────────
      case WIDGET_IDS.EQUITY_DRAWDOWN:
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
      case WIDGET_IDS.MONTHLY_PERFORMANCE:
        return (
          <MonthlyPerformanceChart
            monthlyPerformance={monthlyPerformance}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-monthly-performance"
          />
        );
      case WIDGET_IDS.R_DISTRIBUTION:
        return (
          <RDistributionChart
            rDistribution={rDistribution}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-r-distribution"
          />
        );
      case WIDGET_IDS.DIRECTIONAL_PERFORMANCE:
        return (
          <DirectionalPerformanceWidget
            directionalPerformance={directionalPerformance}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-directional-performance"
          />
        );

      // ── Secondary Chart Widgets ──────────────────────────────────────
      case WIDGET_IDS.CALENDAR_HEATMAP:
        return (
          <CalendarHeatmapWidget
            heatmapData={calendarHeatmap}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-calendar-heatmap"
          />
        );
      case WIDGET_IDS.PERIOD_MATRIX:
        return (
          <PeriodMatrixWidget
            periodMatrixData={periodMatrix}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-period-matrix"
          />
        );
      case WIDGET_IDS.SETUP_RANKING:
        return (
          <SetupRankingWidget
            setupRanking={setupRanking}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-setup-ranking"
          />
        );
      case WIDGET_IDS.PROCESS_DISCIPLINE:
        return (
          <ProcessDisciplineWidget
            processScoreDistribution={processScoreDistribution ?? []}
            isLoading={isRefetching}
            error={isRefetching && error ? error : null}
            testId="dashboard-widget-process-discipline"
          />
        );
      case WIDGET_IDS.ATTENTION_INSIGHTS:
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
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-3 sm:px-8 sm:py-10">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 [text-wrap:balance]">
          Dashboard
        </h1>
        <div className="flex items-center gap-2">
          {cm.isCustomizing ? (
            <>
              <button
                onClick={() => setDialogOpen(true)}
                className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Add Widget
              </button>
              <button
                onClick={handleSave}
                className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Reset
              </button>
            </>
          ) : (
            <button
              onClick={handleEnterCustomization}
              className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Edit Layout
            </button>
          )}
          <ThemeToggle />
        </div>
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

      {/* Error state — initial load failure */}
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
      {loading && !data && <SkeletonGrid />}

      {/* Unified Widget Grid — renders all registered widgets through a
          single DashboardLayout driven by the WidgetRegistry. */}
      {unifiedLoaded && (
        <CustomizingProvider value={cm.isCustomizing}>
          <DashboardLayout
            layout={visibleLayout}
            onLayoutChange={(newLayout: Layout) => setUnifiedLayout([...newLayout])}
            cols={12}
            rowHeight={80}
            margin={[12, 12]}
            isCustomizing={cm.isCustomizing}
          >
            {visibleLayout.map((item) => (
              <div key={item.i}>{renderWidget(item.i as WidgetId)}</div>
            ))}
          </DashboardLayout>
        </CustomizingProvider>
      )}

      {/* Add/Remove Widgets Dialog — only relevant during customization */}
      <AddRemoveWidgetsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        hiddenWidgetIds={cm.hiddenWidgetIds}
        onToggleWidget={handleToggleWidget}
      />
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
