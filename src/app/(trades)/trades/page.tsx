'use client';

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { NotebookPen, EllipsisVertical, Eye, Pencil, PlusCircle, SlidersHorizontal, RefreshCw, Star, AlertTriangle } from 'lucide-react';
import type { ColumnDef, VisibilityState } from '@tanstack/react-table';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DynamicTable from '@/components/dynamic-table';
import {
  formatCurrency,
  formatPrice,
  formatDateShort,
  formatHoldingPeriod,
  PnlCell,
  PercentCell,
  RCell,
  DirectionBadge,
  computePlannedRisk,
  computePlannedRR,
  formatNumber,
} from '@/lib/trade-formatters';
import type { TradeMetricsResult } from '@/lib/trade-metrics';

// ── Types (mirrors the S02 API response shape) ─────────────────────────

interface TradeRow {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: 'long' | 'short';
  accountId: string | null;
  setupName: string | null;
  sectorId: string | null;
  marketConditionId: string | null;
  status: 'planned' | 'open' | 'closed' | 'deleted';
  thesis: string | null;
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedQuantity: number | null;
  invalidationCondition: string | null;
  preTradePlan: string | null;
  openedAt: string | null;
  closedAt: string | null;
  currentPrice: number | null;
  exitNotes: string | null;
  lesson: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  currentPriceFetchedAt: string | null;
  // Convenience flat fields from metrics
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  returnPct: number | null;
  riskPct: number | null;
  // Planned risk-to-account (computed from plannedEntry/plannedStop/plannedQuantity)
  plannedRiskToAccount?: number | null;
  // Nested metrics
  metrics: TradeMetricsResult;
}

interface TotalsShape {
  grossRealizedPnl: number;
  netRealizedPnl: number;
  totalFees: number;
  grossUnrealizedPnl: number;
  netUnrealizedPnl: number;
  totalOpenRisk: number;
  portfolioHeat?: number;
}

interface PlannedTotalsShape {
  totalPlannedRisk: number;
  totalPlannedCapital: number;
  count: number;
}

interface TradesResponse {
  data: TradeRow[];
  total: number;
  page: number;
  limit: number;
  totals: TotalsShape;
  totalsByCurrency?: Record<string, TotalsShape>;
  plannedTotals?: PlannedTotalsShape;
}

interface AccountOption {
  id: string;
  name: string;
  broker: string | null;
}

// ── Tab definitions ────────────────────────────────────────────────────

type TabId = 'open' | 'closed' | 'planned';

interface TabDef {
  id: TabId;
  label: string;
  apiStatus: string;
}

const TABS: TabDef[] = [
  { id: 'open', label: 'Open', apiStatus: 'open' },
  { id: 'closed', label: 'Closed', apiStatus: 'closed' },
  { id: 'planned', label: 'Planned', apiStatus: 'planned' },
];

const PAGE_SIZE = 50;

// ── Helpers ────────────────────────────────────────────────────────────

/** Convert a YYYY-MM-DD date string to an ISO 8601 datetime for the from bound (start of day). */
function toFromIso(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

/** Convert a YYYY-MM-DD date string to an ISO 8601 datetime for the to bound (end of day). */
function toToIso(dateStr: string): string {
  return `${dateStr}T23:59:59.999Z`;
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <span>{message}</span>
      <button
        onClick={onDismiss}
        className="ml-4 rounded p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-800/50"
        aria-label="Dismiss error"
      >
        ×
      </button>
    </div>
  );
}

/** Pagination controls — Previous/Next with Page X of Y */
function PaginationControls({
  currentPage,
  totalPages,
  total,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        Page {currentPage} of {totalPages}{" "}
        <span className="text-xs">({total.toLocaleString()} total)</span>
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 bg-muted text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 bg-muted text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Status-aware actions dropdown menu */
function ActionsCell({ row }: { row: TradeRow }) {
  const router = useRouter();

  const viewTrade = () => router.push(`/trades/${row.id}`);
  const editTrade = () => router.push(`/trades/${row.id}`);
  const addExit = () => router.push(`/trades/${row.id}`);
  const adjustStop = () => router.push(`/trades/${row.id}`);
  const gradeTrade = () => router.push(`/trades/${row.id}`);
  const logMistake = () => router.push(`/trades/${row.id}`);

  const statusActions = useMemo(() => {
    switch (row.status) {
      case 'planned':
        return (
          <DropdownMenuItem onClick={editTrade}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
        );
      case 'open':
        return (
          <>
            <DropdownMenuItem onClick={addExit}>
              <PlusCircle className="size-4" />
              Add Exit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={adjustStop}>
              <SlidersHorizontal className="size-4" />
              Adjust Stop
            </DropdownMenuItem>
          </>
        );
      case 'closed':
        return (
          <>
            <DropdownMenuItem onClick={gradeTrade}>
              <Star className="size-4" />
              Grade
            </DropdownMenuItem>
            <DropdownMenuItem onClick={logMistake}>
              <AlertTriangle className="size-4" />
              Log Mistake
            </DropdownMenuItem>
          </>
        );
      default:
        return null;
    }
  }, [row.status]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Trade actions"
          tabIndex={0}
        >
          <EllipsisVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={viewTrade}>
          <Eye className="size-4" />
          View Details
        </DropdownMenuItem>
        {statusActions && <DropdownMenuSeparator />}
        {statusActions}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Totals summary card rendered below the DynamicTable */
/** A single totals group rendered as labelled items */
function TotalsGroup({
  label,
  isOpen,
  totals,
}: {
  label?: string;
  isOpen: boolean;
  totals: TradesResponse['totals'];
}) {
  const openItems = [
    { label: 'Unrealized P&L', content: <PnlCell value={totals.netUnrealizedPnl} /> },
    { label: 'Open Risk', content: <span className="tabular-nums">{formatCurrency(totals.totalOpenRisk)}</span> },
  ];
  const portfolioHeatItem = totals.portfolioHeat != null
    ? [{ label: 'Portfolio Heat', content: <span className="tabular-nums">{totals.portfolioHeat.toFixed(2)}%</span> }]
    : [];

  const items = isOpen
    ? [...openItems, ...portfolioHeatItem]
    : [
        { label: 'Gross P&L', content: <PnlCell value={totals.grossRealizedPnl} /> },
        { label: 'Fees', content: <span className="tabular-nums text-red-600 dark:text-red-400">{formatCurrency(totals.totalFees)}</span> },
        { label: 'Net P&L', content: <PnlCell value={totals.netRealizedPnl} /> },
      ];

  return (
    <div>
      {label && (
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      )}
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <span className="text-lg font-semibold tabular-nums">{item.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Totals summary card rendered below the DynamicTable */
function TotalsFooter({
  totals,
  totalsByCurrency,
  tabId,
  plannedTotals,
}: {
  totals: TradesResponse['totals'];
  totalsByCurrency?: Record<string, TradesResponse['totals']>;
  tabId: TabId;
  plannedTotals: PlannedTotalsShape;
}) {
  if (tabId === 'planned') {
    return (
      <div className="mt-3 rounded-lg border bg-muted/30 p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Planned Totals
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Planned Risk</span>
            <span className="text-lg font-semibold tabular-nums">{formatCurrency(plannedTotals.totalPlannedRisk)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Planned Capital</span>
            <span className="text-lg font-semibold tabular-nums">{formatCurrency(plannedTotals.totalPlannedCapital)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Trades</span>
            <span className="text-lg font-semibold tabular-nums">{plannedTotals.count}</span>
          </div>
        </div>
      </div>
    );
  }

  const isOpen = tabId === 'open';
  const currencies = Object.keys(totalsByCurrency ?? {});
  const hasMultipleCurrencies = currencies.length > 1;

  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-4">
      <TotalsGroup
        label={isOpen ? 'Open Positions Total' : 'Closed Totals'}
        isOpen={isOpen}
        totals={totals}
      />
      {hasMultipleCurrencies && (
        <>
          <hr className="my-4 border-border" />
          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            By Currency
          </div>
          <div className="space-y-4">
            {currencies.map((currency) => (
              <TotalsGroup
                key={currency}
                label={currency}
                isOpen={isOpen}
                totals={totalsByCurrency![currency]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Column Definitions per Spec Sections 7.1-7.3 ───────────────────────

/** Open tab columns (Section 7.1) */
const openColumns: ColumnDef<TradeRow>[] = [
  {
    id: 'symbol',
    header: 'Symbol',
    accessorKey: 'symbol',
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'direction',
    header: 'Direction',
    accessorKey: 'direction',
    cell: ({ getValue }) => <DirectionBadge direction={getValue<string>()} />,
  },
  {
    id: 'setup',
    header: 'Setup',
    accessorKey: 'setupName',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'opened',
    header: 'Opened',
    accessorFn: (row) => row.openedAt,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatDateShort(getValue<string | null>())}</span>
    ),
  },
  {
    id: 'holdingPeriod',
    header: 'Holding Period',
    accessorFn: (row) => row.metrics?.position?.holdingPeriodDays,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatHoldingPeriod(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'size',
    header: 'Size',
    accessorFn: (row) => row.metrics?.size?.sizeDisplay,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'openAvgCost',
    header: 'Open Avg Cost',
    accessorFn: (row) => row.metrics?.averagePrices?.openAvgCost,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'market',
    header: 'Market',
    accessorKey: 'currentPrice',
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'activeStop',
    header: 'Active Stop',
    accessorFn: (row) => row.metrics?.risk?.activeStop,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'unrealizedPnl',
    header: 'Unrealized P&L',
    accessorKey: 'unrealizedPnl',
    cell: ({ getValue }) => <PnlCell value={getValue<number | null>()} />,
  },
  {
    id: 'totalPnl',
    header: 'Total P&L',
    accessorFn: (row) => row.metrics?.position?.totalNetPnl,
    cell: ({ getValue }) => <PnlCell value={getValue<number | null>()} />,
  },
  {
    id: 'openRisk',
    header: 'Open Risk',
    accessorFn: (row) => row.metrics?.risk?.openRisk,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatCurrency(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'riskToAccount',
    header: 'Risk to Account',
    accessorFn: (row) => row.metrics?.risk?.riskToAccount,
    cell: ({ getValue }) => <PercentCell value={getValue<number | null>()} />,
  },
  // ── Optional hidden-by-default columns ───────────────────────────
  {
    id: 'tradeCode',
    header: 'Trade Code',
    accessorKey: 'tradeCode',
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'account',
    header: 'Account',
    accessorKey: 'accountId',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'sector',
    header: 'Sector',
    accessorKey: 'sectorId',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'entryQty',
    header: 'Entry Qty',
    accessorFn: (row) => row.metrics?.size?.entryQuantity,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatNumber(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'openQty',
    header: 'Open Qty',
    accessorFn: (row) => row.metrics?.size?.openQuantity,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatNumber(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'avgEntryPrice',
    header: 'Avg Entry',
    accessorFn: (row) => row.metrics?.averagePrices?.avgEntryPrice,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'marketValue',
    header: 'Market Value',
    accessorFn: (row) => row.metrics?.position?.marketValue,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatCurrency(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'positionWeight',
    header: 'Pos Weight',
    accessorFn: (row) => row.metrics?.position?.positionWeight,
    cell: ({ getValue }) => <PercentCell value={getValue<number | null>()} />,
  },
  {
    id: 'initialRisk',
    header: 'Initial Risk',
    accessorFn: (row) => row.metrics?.risk?.initialRisk,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatCurrency(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'created',
    header: 'Created',
    accessorKey: 'createdAt',
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatDateShort(getValue<string | null>())}</span>
    ),
  },
  {
    id: 'actions',
    header: '',
    accessorFn: () => null,
    cell: ({ row }) => <ActionsCell row={row.original} />,
    enableSorting: false,
  },
];

/** Closed tab columns (Section 7.2) */
const closedColumns: ColumnDef<TradeRow>[] = [
  {
    id: 'symbol',
    header: 'Symbol',
    accessorKey: 'symbol',
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'direction',
    header: 'Direction',
    accessorKey: 'direction',
    cell: ({ getValue }) => <DirectionBadge direction={getValue<string>()} />,
  },
  {
    id: 'setup',
    header: 'Setup',
    accessorKey: 'setupName',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'entryDate',
    header: 'Entry Date',
    accessorFn: (row) => row.metrics?.position?.openedAt,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatDateShort(getValue<string | null>())}</span>
    ),
  },
  {
    id: 'exitDate',
    header: 'Exit Date',
    accessorFn: (row) => row.metrics?.position?.closedAt ?? row.closedAt,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatDateShort(getValue<string | null>())}</span>
    ),
  },
  {
    id: 'holdingPeriod',
    header: 'Holding Period',
    accessorFn: (row) => row.metrics?.position?.holdingPeriodDays,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatHoldingPeriod(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'size',
    header: 'Size',
    accessorFn: (row) => row.metrics?.size?.sizeDisplay,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'avgEntry',
    header: 'Avg Entry',
    accessorFn: (row) => row.metrics?.averagePrices?.avgEntryPrice,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'avgExit',
    header: 'Avg Exit',
    accessorFn: (row) => row.metrics?.averagePrices?.avgExitPrice,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'grossPnl',
    header: 'Gross P&L',
    accessorFn: (row) => row.metrics?.realizedPnl?.grossRealizedPnl,
    cell: ({ getValue }) => <PnlCell value={getValue<number | null>()} />,
  },
  {
    id: 'fees',
    header: 'Fees',
    accessorFn: (row) => row.metrics?.fees?.totalFees,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatCurrency(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'netPnl',
    header: 'Net P&L',
    accessorKey: 'realizedPnl',
    cell: ({ getValue }) => <PnlCell value={getValue<number | null>()} />,
  },
  {
    id: 'returnPct',
    header: 'Return %',
    accessorKey: 'returnPct',
    cell: ({ getValue }) => <PercentCell value={getValue<number | null>()} />,
  },
  {
    id: 'rMultiple',
    header: 'R-Multiple',
    accessorFn: (row) => row.metrics?.returnMetrics?.rMultiple,
    cell: ({ getValue }) => <RCell value={getValue<number | null>()} />,
  },
  // ── Optional hidden-by-default columns (Section 2.2) ──────────────
  {
    id: 'initialRisk',
    header: 'Initial Risk',
    accessorFn: (row) => row.metrics?.risk?.initialRisk,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatCurrency(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'initialRiskPct',
    header: 'Initial Risk %',
    accessorFn: (row) => row.metrics?.risk?.initialRiskPct,
    cell: ({ getValue }) => <PercentCell value={getValue<number | null>()} />,
  },
  {
    id: 'totalEntryNotional',
    header: 'Tot Entry Notional',
    accessorFn: (row) => {
      const qty = row.metrics?.size?.entryQuantity;
      const price = row.metrics?.averagePrices?.avgEntryPrice;
      if (qty != null && price != null) return qty * price;
      return null;
    },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatCurrency(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'executionCount',
    header: 'Execution Count',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'entryFillCount',
    header: 'Entry Fill Count',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'exitFillCount',
    header: 'Exit Fill Count',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'mfe',
    header: 'MFE',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'mae',
    header: 'MAE',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'account',
    header: 'Account',
    accessorKey: 'accountId',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'sector',
    header: 'Sector',
    accessorKey: 'sectorId',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'grade',
    header: 'Grade',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'followedPlan',
    header: 'Followed Plan',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'ruleViolation',
    header: 'Rule Violation',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'highestMistakeSeverity',
    header: 'Mistake Severity',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'thesis',
    header: 'Thesis',
    accessorKey: 'thesis',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'exitNotes',
    header: 'Exit Notes',
    accessorKey: 'exitNotes',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'lesson',
    header: 'Lesson',
    accessorKey: 'lesson',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'actions',
    header: '',
    accessorFn: () => null,
    cell: ({ row }) => <ActionsCell row={row.original} />,
    enableSorting: false,
  },
];

/** Planned tab columns (Section 7.3) */
const plannedColumns: ColumnDef<TradeRow>[] = [
  {
    id: 'symbol',
    header: 'Symbol',
    accessorKey: 'symbol',
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'direction',
    header: 'Direction',
    accessorKey: 'direction',
    cell: ({ getValue }) => <DirectionBadge direction={getValue<string>()} />,
  },
  {
    id: 'setup',
    header: 'Setup',
    accessorKey: 'setupName',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'plannedDate',
    header: 'Planned Date',
    accessorKey: 'createdAt',
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatDateShort(getValue<string | null>())}</span>
    ),
  },
  {
    id: 'plannedSize',
    header: 'Planned Size',
    accessorKey: 'plannedQuantity',
    cell: ({ getValue }) => {
      const qty = getValue<number | null>();
      return <span className="tabular-nums text-muted-foreground">{qty != null ? qty.toLocaleString() : '—'}</span>;
    },
  },
  {
    id: 'entryTrigger',
    header: 'Entry Trigger',
    accessorKey: 'plannedEntry',
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'stop',
    header: 'Stop',
    accessorKey: 'plannedStop',
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'target',
    header: 'Target',
    accessorKey: 'plannedTarget1',
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'plannedRisk',
    header: 'Planned Risk',
    accessorFn: (row) =>
      computePlannedRisk(row.direction, row.plannedEntry, row.plannedStop, row.plannedQuantity),
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatCurrency(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'riskToAccount',
    header: 'Risk to Account',
    accessorFn: (row) => row.plannedRiskToAccount ?? row.metrics?.risk?.riskToAccount,
    cell: ({ getValue }) => <PercentCell value={getValue<number | null>()} />,
  },
  {
    id: 'plannedRR',
    header: 'Planned R:R',
    accessorFn: (row) => {
      const rr = computePlannedRR(row.direction, row.plannedEntry, row.plannedStop, row.plannedTarget1);
      return rr != null ? rr : null;
    },
    cell: ({ getValue }) => {
      const rr = getValue<number | null>();
      if (rr == null || rr <= 0) return <span className="text-muted-foreground">—</span>;
      return <span className="tabular-nums">1:{rr.toFixed(1)}</span>;
    },
  },
  // ── Optional hidden-by-default columns (Section 2.3) ──────────────
  {
    id: 'account',
    header: 'Account',
    accessorKey: 'accountId',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'sector',
    header: 'Sector',
    accessorKey: 'sectorId',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'thesis',
    header: 'Thesis',
    accessorKey: 'thesis',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'invalidation',
    header: 'Invalidation',
    accessorKey: 'invalidationCondition',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'preTradePlan',
    header: 'Pre-trade Plan',
    accessorKey: 'preTradePlan',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'plannedCapital',
    header: 'Planned Capital',
    accessorFn: (row) => {
      const entry = row.plannedEntry;
      const qty = row.plannedQuantity;
      if (entry != null && qty != null) return entry * qty;
      return null;
    },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatCurrency(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'target2',
    header: 'Target 2',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'marketCondition',
    header: 'Market Condition',
    accessorKey: 'marketConditionId',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>() ?? '—'}</span>
    ),
  },
  {
    id: 'dateAdded',
    header: 'Date Added',
    accessorKey: 'createdAt',
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatDateShort(getValue<string | null>())}</span>
    ),
  },
  {
    id: 'expirationDate',
    header: 'Expiration Date',
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'distanceToTrigger',
    header: 'Dist to Trigger',
    accessorFn: (row) => {
      const current = row.currentPrice;
      const trigger = row.plannedEntry;
      if (current != null && trigger != null && trigger !== 0) {
        return ((current - trigger) / trigger) * 100;
      }
      return null;
    },
    cell: ({ getValue }) => <PercentCell value={getValue<number | null>()} />,
  },
  {
    id: 'currentMarketPrice',
    header: 'Market Price',
    accessorKey: 'currentPrice',
    cell: ({ getValue }) => (
      <span className="tabular-nums">{formatPrice(getValue<number | null>())}</span>
    ),
  },
  {
    id: 'actions',
    header: '',
    accessorFn: () => null,
    cell: ({ row }) => <ActionsCell row={row.original} />,
    enableSorting: false,
  },
];

// ── Per-tab default visibility (optional columns hidden by default) ──────

const openDefaultVisibility: VisibilityState = {
  tradeCode: false,
  account: false,
  sector: false,
  entryQty: false,
  openQty: false,
  avgEntryPrice: false,
  marketValue: false,
  positionWeight: false,
  initialRisk: false,
  created: false,
};

const closedDefaultVisibility: VisibilityState = {
  initialRisk: false,
  initialRiskPct: false,
  totalEntryNotional: false,
  executionCount: false,
  entryFillCount: false,
  exitFillCount: false,
  mfe: false,
  mae: false,
  account: false,
  sector: false,
  grade: false,
  followedPlan: false,
  ruleViolation: false,
  highestMistakeSeverity: false,
  thesis: false,
  exitNotes: false,
  lesson: false,
};

const plannedDefaultVisibility: VisibilityState = {
  account: false,
  sector: false,
  thesis: false,
  invalidation: false,
  preTradePlan: false,
  plannedCapital: false,
  target2: false,
  marketCondition: false,
  dateAdded: false,
  expirationDate: false,
  distanceToTrigger: false,
  currentMarketPrice: false,
};

const visibilityDefaults: Record<TabId, VisibilityState> = {
  open: openDefaultVisibility,
  closed: closedDefaultVisibility,
  planned: plannedDefaultVisibility,
};

// ── Page Component ─────────────────────────────────────────────────────

export default function TradesPage() {
  return (
    <Suspense fallback={<div className="px-4 py-3 sm:px-8 sm:py-10"><div className="mb-6 text-2xl font-semibold">Trades</div></div>}>
      <TradesPageInner />
    </Suspense>
  );
}

function TradesPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    document.title = 'Trades — Trading Journal';
  }, []);

  // ── State ──────────────────────────────────────────────────────────

  const [tabData, setTabData] = useState<Record<TabId, TradeRow[]>>({
    open: [],
    closed: [],
    planned: [],
  });
  const [tabTotal, setTabTotal] = useState<Record<TabId, number>>({
    open: 0,
    closed: 0,
    planned: 0,
  });
  const [tabTotals, setTabTotals] = useState<Record<TabId, TradesResponse['totals']>>({
    open: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
    closed: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
    planned: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
  });
  const [plannedTotalsState, setPlannedTotalsState] = useState<PlannedTotalsShape>({
    totalPlannedRisk: 0,
    totalPlannedCapital: 0,
    count: 0,
  });
  const [tabTotalsByCurrency, setTabTotalsByCurrency] = useState<Record<TabId, Record<string, TradesResponse['totals']>>>({
    open: {},
    closed: {},
    planned: {},
  });
  const [tabLoading, setTabLoading] = useState<Record<TabId, boolean>>({
    open: true,
    closed: true,
    planned: true,
  });
  const [tabError, setTabError] = useState<Record<TabId, string | null>>({
    open: null,
    closed: null,
    planned: null,
  });
  const [tabPage, setTabPage] = useState<Record<TabId, number>>({
    open: 1,
    closed: 1,
    planned: 1,
  });
  const [activeTab, setActiveTab] = useState<TabId>('open');

  // Filter state
  // Filter state — initialised from URL search params, falling back to localStorage
  const [fromDate, setFromDate] = useState(() => {
    const urlVal = searchParams.get('from');
    if (urlVal) return urlVal;
    try { return localStorage.getItem('trades:fromDate') ?? ''; } catch { return ''; }
  });
  const [toDate, setToDate] = useState(() => {
    const urlVal = searchParams.get('to');
    if (urlVal) return urlVal;
    try { return localStorage.getItem('trades:toDate') ?? ''; } catch { return ''; }
  });
  const [accountId, setAccountId] = useState(() => {
    const urlVal = searchParams.get('accountId');
    if (urlVal) return urlVal;
    try { return localStorage.getItem('trades:accountId') ?? 'all'; } catch { return 'all'; }
  });
  const [direction, setDirection] = useState(() => {
    const urlVal = searchParams.get('direction');
    if (urlVal) return urlVal;
    try { return localStorage.getItem('trades:direction') ?? 'all'; } catch { return 'all'; }
  });
  const [activePreset, setActivePreset] = useState<string | null>(() => {
    const urlVal = searchParams.get('preset');
    if (urlVal) return urlVal;
    try { return localStorage.getItem('trades:preset') || null; } catch { return null; }
  });

  // Date-range presets
  const datePresets = useMemo(() => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthsAgo = (n: number) => {
      const d = new Date(today.getFullYear(), today.getMonth() - n, 1);
      return d;
    };
    return [
      { label: 'Max', from: '' },
      { label: 'YTD', from: fmt(startOfYear) },
      { label: '1Y', from: fmt(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())) },
      { label: '6M', from: fmt(monthsAgo(6)) },
      { label: '3M', from: fmt(monthsAgo(3)) },
      { label: 'MTD', from: fmt(startOfMonth) },
      { label: '1M', from: fmt(monthsAgo(1)) },
    ];
  }, []);

  const clearDates = useCallback(() => {
    setFromDate('');
    setToDate('');
    setActivePreset(null);
  }, []);

  const applyDatePreset = useCallback((preset: { label: string; from: string }) => {
    if (preset.label === 'Max') {
      clearDates();
      setActivePreset(preset.label);
    } else {
      setFromDate(preset.from);
      setToDate('');
      setActivePreset(preset.label);
    }
  }, [clearDates]);

  // Clear preset highlight when user manually edits dates
  const handleFromDateChange = useCallback((value: string) => {
    setFromDate(value);
    setActivePreset(null);
  }, []);

  const handleToDateChange = useCallback((value: string) => {
    setToDate(value);
    setActivePreset(null);
  }, []);

  // Sync filter state to URL search params and localStorage for persistence
  useEffect(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (accountId && accountId !== 'all') params.set('accountId', accountId);
    if (direction && direction !== 'all') params.set('direction', direction);
    if (activePreset) params.set('preset', activePreset);
    const qs = params.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    router.replace(newUrl, { scroll: false });
    // Also persist to localStorage — survives plain sidebar link navigation
    try {
      localStorage.setItem('trades:fromDate', fromDate);
      localStorage.setItem('trades:toDate', toDate);
      localStorage.setItem('trades:accountId', accountId);
      localStorage.setItem('trades:direction', direction);
      if (activePreset) localStorage.setItem('trades:preset', activePreset);
      else localStorage.removeItem('trades:preset');
    } catch { /* localStorage unavailable */ }
  }, [fromDate, toDate, accountId, direction, activePreset, router]);

  // Account options for the filter dropdown
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Fetch accounts list
  useEffect(() => {
    async function loadAccounts() {
      try {
        const res = await fetch('/api/accounts');
        if (res.ok) {
          const data: AccountOption[] = await res.json();
          setAccounts(data);
        }
      } catch {
        // Non-critical — leave empty list
      } finally {
        setAccountsLoading(false);
      }
    }
    loadAccounts();
  }, []);

  // Debounce ref to avoid rapid re-fetches while typing dates
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data fetching ─────────────────────────────────────────────────

  const fetchTab = useCallback(async (tab: TabDef, page: number = 1) => {
    setTabLoading((prev) => ({ ...prev, [tab.id]: true }));
    setTabError((prev) => ({ ...prev, [tab.id]: null }));
    try {
      const params = new URLSearchParams();
      params.set('status', tab.apiStatus);
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));

      // Append active filter values
      if (fromDate) params.set('from', toFromIso(fromDate));
      if (toDate) params.set('to', toToIso(toDate));
      if (accountId && accountId !== 'all') params.set('accountId', accountId);
      if (direction && direction !== 'all') params.set('direction', direction);

      const res = await fetch(`/api/trades?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch trades' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const result: TradesResponse = await res.json();
      setTabData((prev) => ({ ...prev, [tab.id]: result.data }));
      setTabTotal((prev) => ({ ...prev, [tab.id]: result.total }));
      setTabTotals((prev) => ({ ...prev, [tab.id]: result.totals }));
      setTabTotalsByCurrency((prev) => ({ ...prev, [tab.id]: result.totalsByCurrency ?? {} }));
      if (result.plannedTotals) {
        setPlannedTotalsState(result.plannedTotals);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setTabError((prev) => ({ ...prev, [tab.id]: msg }));
      setTabData((prev) => ({ ...prev, [tab.id]: [] }));
      setTabTotal((prev) => ({ ...prev, [tab.id]: 0 }));
    } finally {
      setTabLoading((prev) => ({ ...prev, [tab.id]: false }));
    }
  }, [fromDate, toDate, accountId, direction]);

  // Page change handler — fetches a single tab at the given page
  const handlePageChange = useCallback((tabId: TabId, newPage: number) => {
    setTabPage((prev) => ({ ...prev, [tabId]: newPage }));
    const tabDef = TABS.find((t) => t.id === tabId);
    if (tabDef) fetchTab(tabDef, newPage);
  }, [fetchTab]);

  // Tab switch handler — fetches the new tab at its stored page
  const handleTabChange = useCallback((v: string) => {
    const tabId = v as TabId;
    setActiveTab(tabId);
    const tabDef = TABS.find((t) => t.id === tabId);
    if (tabDef) fetchTab(tabDef, tabPage[tabId]);
  }, [fetchTab, tabPage]);

  // Fetch all tabs — fires when filters change (debounced)
  useEffect(() => {
    // Clear any pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      // Reset all pages to 1 when filters change
      setTabPage({ open: 1, closed: 1, planned: 1 });
      TABS.forEach((tab) => fetchTab(tab, 1));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchTab]); // fetchTab changes when fromDate, toDate, or accountId change

  // Memoized column definitions per tab
  const colMap = useMemo<
    Record<TabId, ColumnDef<TradeRow>[]>
  >(() => ({
    open: openColumns,
    closed: closedColumns,
    planned: plannedColumns,
  }), []);

  // ── Render per-tab content ───────────────────────────────────────

  function renderTabContent(tab: TabDef) {
    const loading = tabLoading[tab.id];
    const error = tabError[tab.id];
    const rows = tabData[tab.id];
    const total = tabTotal[tab.id];
    const page = tabPage[tab.id];
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const totals = tabTotals[tab.id];

    if (error) {
      return (
        <ErrorBanner
          message={error}
          onDismiss={() => setTabError((prev) => ({ ...prev, [tab.id]: null }))}
        />
      );
    }

    if (loading) {
      return <SkeletonRows />;
    }

    if (rows.length === 0) {
      const messages: Record<TabId, { title: string; description: string }> = {
        open: {
          title: 'No open trades',
          description: 'You have no open positions. Open trades appear here once an execution is added.',
        },
        closed: {
          title: 'No closed trades',
          description: 'Closed trades will appear here once you close a position and mark it complete.',
        },
        planned: {
          title: 'No planned trades',
          description: 'Plan your next trade to see it here. Use the Plan Trade button to get started.',
        },
      };
      const msg = messages[tab.id];
      return (
        <EmptyState
          icon={<NotebookPen className="size-12 text-muted-foreground" strokeWidth={1} />}
          title={msg.title}
          description={msg.description}
        />
      );
    }

    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Showing {rows.length} of {total.toLocaleString()} {tab.label.toLowerCase()} trades.
          {totalPages > 1 && (
            <span className="ml-1">
              (Page {page} of {totalPages})
            </span>
          )}
        </p>
        <DynamicTable<TradeRow>
          data={rows}
          columns={colMap[tab.id]}
          storageKey={`trades:${tab.id}:v2`}
          onRowClick={(row) => router.push(`/trades/${row.original.id}`)}
          columnSelector
          alwaysVisible={['symbol', 'actions']}
          initialVisibility={visibilityDefaults[tab.id]}
        />
        {totalPages > 1 && (
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            total={total}
            onPageChange={(p) => handlePageChange(tab.id, p)}
          />
        )}
        <TotalsFooter totals={totals} totalsByCurrency={tabTotalsByCurrency[tab.id]} tabId={tab.id} plannedTotals={plannedTotalsState} />
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="px-4 py-3 sm:px-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">
        Trades
      </h1>

      {/* ── Filter controls ─────────────────────────────────────── */}
      <div className="mb-6 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Date section */}
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Dates</div>
            <div className="flex flex-wrap items-end gap-3">
              {/* From date */}
              <div className="flex flex-col gap-1">
                <label htmlFor="filter-from" className="text-xs text-muted-foreground">
                  From
                </label>
                <Input
                  id="filter-from"
                  type="date"
                  className="h-8 w-44"
                  value={fromDate}
                  onChange={(e) => handleFromDateChange(e.target.value)}
                />
              </div>

              {/* To date */}
              <div className="flex flex-col gap-1">
                <label htmlFor="filter-to" className="text-xs text-muted-foreground">
                  To
                </label>
                <Input
                  id="filter-to"
                  type="date"
                  className="h-8 w-44"
                  value={toDate}
                  onChange={(e) => handleToDateChange(e.target.value)}
                />
              </div>
            </div>

            {/* Date-range presets */}
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {datePresets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyDatePreset(p)}
                  className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${
                    activePreset === p.label
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {(activePreset || fromDate) && (
                <button
                  type="button"
                  onClick={clearDates}
                  className="ml-0.5 h-7 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Clear date filter"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Account filter */}
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-account" className="text-xs font-medium text-muted-foreground">
              Account
            </label>
            <Select
              value={accountId}
              onValueChange={(v) => setAccountId(v)}
              disabled={accountsLoading}
            >
              <SelectTrigger id="filter-account" className="h-8 w-48">
                <SelectValue placeholder={accountsLoading ? 'Loading...' : 'All accounts'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {accounts.map((acct) => (
                  <SelectItem key={acct.id} value={acct.id}>
                    {acct.name}
                    {acct.broker ? ` (${acct.broker})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Direction filter */}
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-direction" className="text-xs font-medium text-muted-foreground">
              Direction
            </label>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v)}
            >
              <SelectTrigger id="filter-direction" className="h-8 w-36">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="long">Long</SelectItem>
                <SelectItem value="short">Short</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
      >
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
              {tabTotal[tab.id] > 0 && (
                <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-xs tabular-nums">
                  {tabTotal[tab.id]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            {renderTabContent(tab)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
