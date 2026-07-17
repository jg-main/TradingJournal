/**
 * KPI metric widget components for the dashboard widget grid.
 *
 * Each metric is its own DashboardWidget-wrapped component, grouped by
 * hierarchy: period-to-date vs current-state metrics.
 *
 * Widget IDs follow a `kebab-case` convention for use as react-grid-layout
 * `i` keys. The `DEFAULT_KPI_LAYOUT` export provides the initial grid
 * positions used by T05's page.tsx refactor.
 *
 * Run: npx vitest run src/components/dashboard/kpi-widgets.test.tsx
 */

'use client';

import React from 'react';
import {
  NotebookPen,
  TrendingUp,
  Target,
  Star,
  TrendingDown,
  Wallet,
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DashboardWidget } from './dashboard-widget';
import { KpiCardContent } from './kpi-card';
import {
  formatCurrency,
  formatPercent,
  formatDecimal,
  gradeLabelFromScore,
  pnlColorClass,
} from './formatting';
import type { LayoutItem } from 'react-grid-layout';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Shape of the KPI metrics returned by /api/dashboard */
export interface KpiMetrics {
  totalTrades: number;
  openTrades: number;
  winRate: number | null;
  netPnl: number;
  avgR: number | null;
  avgGrade: number | null;
  currentDrawdown: number | null;
  currentDrawdownPct: number | null;
  accountValue: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
}

/** Shape of the MTM data returned by /api/dashboard */
export interface MtmData {
  netUnrealizedPnl: number | null;
  openTradeCount: number;
  tradesWithPrices: number;
  tradesAwaitingData: number;
}

/** Base props every KPI widget component accepts */
export interface KpiWidgetBaseProps {
  /** KPI metrics data — when null, widget shows loading state */
  kpis: KpiMetrics | null;
  /** MTM data for the unrealized P&L widget */
  mtm?: MtmData | null;
  /** Force loading state (e.g. during initial page load) */
  isLoading?: boolean;
  /** Error message to display in the widget's error state */
  error?: string | null;
  /** Whether the widget has no data to display */
  isEmpty?: boolean;
  /** Callback for refresh actions (Unrealized P&L widget) */
  onRefresh?: () => void;
  /** Whether a refresh is currently in progress */
  isRefreshing?: boolean;
  /** Optional CSS class override */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Widget IDs (react-grid-layout keys)
// ═══════════════════════════════════════════════════════════════════════════

export const WIDGET_IDS = {
  NET_PNL: 'net-pnl',
  TOTAL_TRADES: 'total-trades',
  WIN_RATE: 'win-rate',
  AVG_R: 'avg-r',
  AVG_GRADE: 'avg-grade',
  PROFIT_FACTOR: 'profit-factor',
  AVG_WIN: 'avg-win',
  AVG_LOSS: 'avg-loss',
  ACCOUNT_VALUE: 'account-value',
  CURRENT_DRAWDOWN: 'current-drawdown',
  UNREALIZED_PNL: 'unrealized-pnl',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Metric Grouping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Period-to-date metric widget IDs (first visual group).
 * Metrics derived from closed-trade journal data over the filtered date range.
 */
export const PTD_WIDGET_IDS: readonly string[] = [
  WIDGET_IDS.NET_PNL,
  WIDGET_IDS.TOTAL_TRADES,
  WIDGET_IDS.WIN_RATE,
  WIDGET_IDS.AVG_R,
  WIDGET_IDS.AVG_GRADE,
  WIDGET_IDS.PROFIT_FACTOR,
  WIDGET_IDS.AVG_WIN,
  WIDGET_IDS.AVG_LOSS,
];

/**
 * Current-state metric widget IDs (second visual group).
 * Metrics reflecting the current account position and open trades.
 */
export const CURRENT_STATE_WIDGET_IDS: readonly string[] = [
  WIDGET_IDS.ACCOUNT_VALUE,
  WIDGET_IDS.CURRENT_DRAWDOWN,
  WIDGET_IDS.UNREALIZED_PNL,
];

/** All KPI widget IDs in display order */
export const ALL_KPI_WIDGET_IDS: readonly string[] = [
  ...PTD_WIDGET_IDS,
  ...CURRENT_STATE_WIDGET_IDS,
];

// ═══════════════════════════════════════════════════════════════════════════
// Section Headers
// ═══════════════════════════════════════════════════════════════════════════

export interface KpiSectionHeaderProps {
  title: string;
  description?: string;
  /** Background tint class for the section, e.g. "bg-blue-50/40" */
  tint?: string;
}

/**
 * Visual section header for a group of KPI widgets.
 * Used between widget grids to separate metric groups.
 *
 * @example
 * ```tsx
 * <KpiSectionHeader
 *   title="Period-to-Date"
 *   description="Metrics from closed trades in the filtered date range."
 *   tint="bg-blue-50/40 dark:bg-blue-950/20"
 * />
 * ```
 */
export function KpiSectionHeader({ title, description, tint }: KpiSectionHeaderProps) {
  return (
    <div className={cn('mb-4 rounded-lg px-5 py-4', tint)}>
      <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      {description && (
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Individual KPI Widgets
// ═══════════════════════════════════════════════════════════════════════════

// ── Net P&L ────────────────────────────────────────────────────────────

export function NetPnlWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  return (
    <DashboardWidget
      title="Net P&L"
      testId="widget-net-pnl"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<Target className="size-4 text-zinc-700 dark:text-zinc-300" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={kpis ? formatCurrency(kpis.netPnl, { sign: true }) : '--'}
        valueClassName={kpis ? pnlColorClass(kpis.netPnl) : ''}
        label="Net P&amp;L"
      />
    </DashboardWidget>
  );
}

// ── Total Trades ───────────────────────────────────────────────────────

export function TotalTradesWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  return (
    <DashboardWidget
      title="Total Trades"
      testId="widget-total-trades"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<NotebookPen className="size-4 text-zinc-700 dark:text-zinc-300" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={kpis?.totalTrades ?? '--'}
        label="Total Trades"
      />
    </DashboardWidget>
  );
}

// ── Win Rate ───────────────────────────────────────────────────────────

export function WinRateWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  return (
    <DashboardWidget
      title="Win Rate"
      testId="widget-win-rate"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<TrendingUp className="size-4 text-zinc-700 dark:text-zinc-300" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={formatPercent(kpis?.winRate ?? null)}
        label="Win Rate"
      />
    </DashboardWidget>
  );
}

// ── Avg R ──────────────────────────────────────────────────────────────

export function AvgRWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  return (
    <DashboardWidget
      title="Avg R"
      testId="widget-avg-r"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<Star className="size-4 text-zinc-700 dark:text-zinc-300" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={formatDecimal(kpis?.avgR ?? null)}
        label="Avg R"
      />
    </DashboardWidget>
  );
}

// ── Avg Grade ──────────────────────────────────────────────────────────

export function AvgGradeWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  return (
    <DashboardWidget
      title="Avg Grade"
      testId="widget-avg-grade"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<Star className="size-4 text-zinc-600 dark:text-zinc-400" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={
          kpis?.avgGrade !== null && kpis?.avgGrade !== undefined
            ? `${formatDecimal(kpis.avgGrade)} (${gradeLabelFromScore(kpis.avgGrade)})`
            : '--'
        }
        label="Avg Grade"
      />
    </DashboardWidget>
  );
}

// ── Profit Factor ──────────────────────────────────────────────────────

export function ProfitFactorWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  const profitFactorValueClassName =
    kpis?.profitFactor !== null && kpis?.profitFactor !== undefined
      ? kpis.profitFactor > 1.5
        ? 'text-green-600 dark:text-green-400'
        : kpis.profitFactor >= 1.0
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400'
      : '';

  return (
    <DashboardWidget
      title="Profit Factor"
      testId="widget-profit-factor"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<BarChart3 className="size-4 text-zinc-700 dark:text-zinc-300" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={formatDecimal(kpis?.profitFactor ?? null)}
        valueClassName={profitFactorValueClassName}
        label="Profit Factor"
      />
    </DashboardWidget>
  );
}

// ── Avg Win ────────────────────────────────────────────────────────────

export function AvgWinWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  const isPositive = kpis?.avgWin !== null && kpis?.avgWin !== undefined && kpis.avgWin > 0;

  return (
    <DashboardWidget
      title="Avg Win"
      testId="widget-avg-win"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<TrendingUp className="size-4 text-green-600 dark:text-green-400" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={formatCurrency(kpis?.avgWin ?? null)}
        valueClassName={isPositive ? 'text-green-600 dark:text-green-400' : ''}
        label="Avg Win"
      />
    </DashboardWidget>
  );
}

// ── Avg Loss ───────────────────────────────────────────────────────────

export function AvgLossWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  const isNegative = kpis?.avgLoss !== null && kpis?.avgLoss !== undefined && kpis.avgLoss > 0;

  return (
    <DashboardWidget
      title="Avg Loss"
      testId="widget-avg-loss"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<TrendingDown className="size-4 text-red-600 dark:text-red-400" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={formatCurrency(kpis?.avgLoss ?? null)}
        valueClassName={isNegative ? 'text-red-600 dark:text-red-400' : ''}
        label="Avg Loss"
      />
    </DashboardWidget>
  );
}

// ── Current Drawdown ───────────────────────────────────────────────────

export function CurrentDrawdownWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  return (
    <DashboardWidget
      title="Current Drawdown"
      testId="widget-current-drawdown"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<TrendingDown className="size-4 text-red-600 dark:text-red-400" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={
          kpis?.currentDrawdown !== null && kpis?.currentDrawdown !== undefined
            ? `${formatCurrency(Math.abs(kpis.currentDrawdown))}${
                kpis.currentDrawdownPct !== null && kpis.currentDrawdownPct !== undefined
                  ? ` (${formatPercent(Math.abs(kpis.currentDrawdownPct))})`
                  : ''
              }`
            : '--'
        }
        valueClassName="text-red-600 dark:text-red-400"
        label="Current Drawdown"
      />
    </DashboardWidget>
  );
}

// ── Account Value ──────────────────────────────────────────────────────

export function AccountValueWidget({
  kpis,
  isLoading,
  error,
  isEmpty,
  className,
}: KpiWidgetBaseProps) {
  return (
    <DashboardWidget
      title="Account Value"
      testId="widget-account-value"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <KpiCardContent
        icon={<Wallet className="size-4 text-zinc-700 dark:text-zinc-300" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value={formatCurrency(kpis?.accountValue ?? null)}
        label="Account Value"
      />
    </DashboardWidget>
  );
}

// ── Unrealized P&L ─────────────────────────────────────────────────────

export function UnrealizedPnlWidget({
  kpis,
  mtm,
  isLoading,
  error,
  isEmpty,
  onRefresh,
  isRefreshing,
  className,
}: KpiWidgetBaseProps) {
  const renderValue = () => {
    if (!mtm) {
      // Loading — show placeholder
      return '--';
    }
    if (mtm.netUnrealizedPnl !== null && mtm.netUnrealizedPnl !== undefined) {
      return formatCurrency(mtm.netUnrealizedPnl, { sign: true });
    }
    if (mtm.openTradeCount > 0) {
      return (
        <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">
          Awaiting prices
        </span>
      );
    }
    return (
      <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">
        No open positions
      </span>
    );
  };

  const pnlValue =
    mtm?.netUnrealizedPnl !== null && mtm?.netUnrealizedPnl !== undefined
      ? mtm.netUnrealizedPnl
      : 0;

  const unrealizedValueClass =
    mtm?.netUnrealizedPnl !== null && mtm?.netUnrealizedPnl !== undefined
      ? pnlColorClass(pnlValue)
      : '';

  return (
    <DashboardWidget
      title="Unrealized P&L"
      testId="widget-unrealized-pnl"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      className={className}
    >
      <div>
        <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <TrendingUp className="size-4 text-zinc-700 dark:text-zinc-300" />
        </div>
        <p
          className={cn(
            'text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100',
            unrealizedValueClass,
          )}
        >
          {renderValue()}
        </p>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 underline decoration-dotted decoration-zinc-300 dark:decoration-zinc-600 underline-offset-2 cursor-help">
                Unrealized P&amp;L
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 text-xs">
              Total unrealized profit/loss across all open positions based on
              current market prices.
            </TooltipContent>
          </Tooltip>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed dark:hover:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              title={
                isRefreshing
                  ? 'Refreshing...'
                  : 'Refresh prices from market data'
              }
            >
              <RefreshCw
                className={cn('size-3', isRefreshing && 'animate-spin')}
              />
              {isRefreshing ? 'Refreshing...' : ''}
            </button>
          )}
        </div>
      </div>
    </DashboardWidget>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Grid Layout
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default react-grid-layout layout items for KPI widgets.
 *
 * 4-column grid layout:
 * - Row 0-1: 8 PTD widgets (2 rows × 4 cols)
 * - Row 2: 3 current-state widgets (1 row: 4+4+4)
 *
 * Each widget is `h: 2` to match a typical KPI card height.
 *
 * @example
 * ```tsx
 * <GridLayout
 *   className="layout"
 *   layout={layout}
 *   cols={4}
 *   rowHeight={100}
 *   onLayoutChange={setLayout}
 * >
 *   {layout.map((item) => (
 *     <div key={item.i}>{widgetMap[item.i]}</div>
 *   ))}
 * </GridLayout>
 * ```
 */
export const DEFAULT_KPI_LAYOUT: LayoutItem[] = [
  // ── Period-to-Date (8 widgets: 2 rows × 4 columns) ──────────────
  { i: WIDGET_IDS.NET_PNL, x: 0, y: 0, w: 1, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.TOTAL_TRADES, x: 1, y: 0, w: 1, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.WIN_RATE, x: 2, y: 0, w: 1, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.AVG_R, x: 3, y: 0, w: 1, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.AVG_GRADE, x: 0, y: 1, w: 1, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.PROFIT_FACTOR, x: 1, y: 1, w: 1, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.AVG_WIN, x: 2, y: 1, w: 1, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.AVG_LOSS, x: 3, y: 1, w: 1, h: 2, minW: 1, minH: 2 },

  // ── Current State (3 widgets: 1 row, first takes 2 cols) ────────
  { i: WIDGET_IDS.ACCOUNT_VALUE, x: 0, y: 2, w: 2, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.CURRENT_DRAWDOWN, x: 2, y: 2, w: 1, h: 2, minW: 1, minH: 2 },
  { i: WIDGET_IDS.UNREALIZED_PNL, x: 3, y: 2, w: 1, h: 2, minW: 1, minH: 2 },
];

/**
 * Section background tint class map for metric hierarchy visual separation.
 *
 * @example
 * ```tsx
 * // Wrap PTD widgets in a tinted container
 * <div className={SECTION_TINTS.PTD}>
 *   {ptdWidgets}
 * </div>
 * ```
 */
export const SECTION_TINTS = {
  /** Blue-tinted background for period-to-date metrics */
  PTD: 'bg-blue-50/40 dark:bg-blue-950/20',
  /** Amber-tinted background for current-state metrics */
  CURRENT: 'bg-amber-50/40 dark:bg-amber-950/20',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Widget Map (for dynamic rendering from layout)
// ═══════════════════════════════════════════════════════════════════════════

/** Record mapping widget ID to its component for dynamic rendering. */
export const KPI_WIDGET_MAP: Record<
  string,
  React.ComponentType<KpiWidgetBaseProps>
> = {
  [WIDGET_IDS.NET_PNL]: NetPnlWidget,
  [WIDGET_IDS.TOTAL_TRADES]: TotalTradesWidget,
  [WIDGET_IDS.WIN_RATE]: WinRateWidget,
  [WIDGET_IDS.AVG_R]: AvgRWidget,
  [WIDGET_IDS.AVG_GRADE]: AvgGradeWidget,
  [WIDGET_IDS.PROFIT_FACTOR]: ProfitFactorWidget,
  [WIDGET_IDS.AVG_WIN]: AvgWinWidget,
  [WIDGET_IDS.AVG_LOSS]: AvgLossWidget,
  [WIDGET_IDS.ACCOUNT_VALUE]: AccountValueWidget,
  [WIDGET_IDS.CURRENT_DRAWDOWN]: CurrentDrawdownWidget,
  [WIDGET_IDS.UNREALIZED_PNL]: UnrealizedPnlWidget,
};
