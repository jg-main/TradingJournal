'use client';

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { NotebookPen, PlusCircle, RefreshCw, Download, Clock } from 'lucide-react';
import type { ColumnDef, VisibilityState } from '@tanstack/react-table';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActionsCell } from '@/components/trades/actions-cell';
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
  computeDistanceToStop,
  computeDistanceToTrigger,
  formatNumber,
} from '@/lib/trade-formatters';
import type { TradeListMetrics } from '@/lib/trade-metrics';

// ── Types (mirrors the S02 API response shape) ─────────────────────────

interface TradeRow {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: 'long' | 'short';
  accountId: string | null;
  accountName: string | null;
  accountCurrency: string | null;
  setupName: string | null;
  sectorId: string | null;
  sectorName: string | null;
  marketConditionId: string | null;
  marketConditionName: string | null;
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
  // Nested metrics (compact for list view; FIFO debugging detail excluded)
  metrics: TradeListMetrics;
}

interface TotalsShape {
  grossRealizedPnl: number;
  netRealizedPnl: number;
  totalFees: number;
  // M013/S01: unrealized aggregates are null when any open position lacks a
  // currentPrice market mark — never a partial sum presented as complete.
  grossUnrealizedPnl: number | null;
  netUnrealizedPnl: number | null;
  totalOpenRisk: number;
  portfolioHeat?: number;
  portfolioHeatAmount?: number;
  portfolioHeatPct?: number;
  // M013/S01: machine-readable count of open positions blocking the unrealized
  // aggregate (optional for backward compat with older responses / fallback state).
  unpricedOpenPositions?: number;
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

/**
 * Browser-local timezone offset suffix, e.g. "-05:00" or "+02:00".
 * Date-range bounds must be interpreted against the user's local day
 * boundaries, not hardcoded UTC, so the ISO strings carry the local offset.
 */
function localOffsetSuffix(): string {
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/** Convert a YYYY-MM-DD date string to an ISO 8601 datetime for the from bound (start of local day). */
function toFromIso(dateStr: string): string {
  return `${dateStr}T00:00:00.000${localOffsetSuffix()}`;
}

/** Convert a YYYY-MM-DD date string to an ISO 8601 datetime for the to bound (end of local day). */
function toToIso(dateStr: string): string {
  return `${dateStr}T23:59:59.999${localOffsetSuffix()}`;
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
    <div className="mb-4 flex items-center justify-between rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <span>{message}</span>
      <button
        onClick={onDismiss}
        className="ml-4 rounded p-1 text-destructive hover:bg-destructive/10"
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

/** A single totals group rendered as labelled items (closed-tab totals + optional trade count) */
function TotalsGroup({
  label,
  totals,
  currency,
  count,
}: {
  label?: string;
  totals: TradesResponse['totals'];
  currency?: string;
  count?: number;
}) {
  const items = [
    { label: 'Gross P&L', content: <PnlCell value={totals.grossRealizedPnl} /> },
    { label: 'Fees', content: <span className="tabular-nums text-negative">{formatCurrency(totals.totalFees, currency)}</span> },
    { label: 'Net P&L', content: <PnlCell value={totals.netRealizedPnl} /> },
    ...(count != null ? [{ label: 'Trades', content: <span className="tabular-nums">{count}</span> }] : []),
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

/**
 * M013/S01: Unrealized P&L aggregate completeness states for the Open footer.
 * The totals route returns null (never 0) for netUnrealizedPnl when any open
 * position lacks a currentPrice market mark, plus an unpricedOpenPositions
 * count. The footer must never present a partial or unknown aggregate as a
 * complete-looking number:
 *  - numeric value       → all open positions priced (normal aggregate)
 *  - null, all unpriced  → "Awaiting market prices"
 *  - null, some unpriced → "Partial — N unpriced"
 */
function UnrealizedPnlFooterValue({
  totals,
  count,
}: {
  totals: TradesResponse['totals'];
  count: number;
}) {
  if (totals.netUnrealizedPnl !== null && totals.netUnrealizedPnl !== undefined) {
    return <PnlCell value={totals.netUnrealizedPnl} />;
  }
  const unpriced = totals.unpricedOpenPositions ?? 0;
  if (unpriced > 0 && unpriced >= count) {
    // Every open position lacks a market mark — the aggregate is entirely unknown.
    return (
      <span className="text-lg font-semibold tabular-nums italic text-muted-foreground">
        Awaiting market prices
      </span>
    );
  }
  if (unpriced > 0) {
    // Some positions priced, some not — the aggregate is partial, never complete.
    return (
      <span className="text-lg font-semibold tabular-nums text-warning">
        Partial — {unpriced} unpriced
      </span>
    );
  }
  // Defensive: null aggregate without an unpriced count — render the null placeholder.
  return <PnlCell value={null} />;
}

function TotalsFooter({
  totals,
  tabId,
  plannedTotals,
  count,
}: {
  totals: TradesResponse['totals'];
  tabId: TabId;
  plannedTotals: PlannedTotalsShape;
  count: number;
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

  // Open tab: single authoritative 'Open Positions Total' section.
  // Unrealized P&L (net) is restored alongside Portfolio Heat $/% and the open
  // position count. portfolioHeatAmount is the sum of open risk across all
  // currencies (== totalOpenRisk). portfolioHeatPct follows the M010
  // decimal-fraction contract (0.0125 = 1.25%), displayed via ×100 formatting.
  if (tabId === 'open') {
    return (
      <div className="mt-3 rounded-lg border bg-muted/30 p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Open Positions Total
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Unrealized P&L</span>
            <UnrealizedPnlFooterValue totals={totals} count={count} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Portfolio Heat $</span>
            <span className="text-lg font-semibold tabular-nums">{formatCurrency(totals.portfolioHeatAmount ?? 0)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Portfolio Heat %</span>
            <span className="text-lg font-semibold tabular-nums">{((totals.portfolioHeatPct ?? 0) * 100).toFixed(2)}%</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Open Positions</span>
            <span className="text-lg font-semibold tabular-nums">{count}</span>
          </div>
        </div>
      </div>
    );
  }

  // Closed tab: single authoritative 'Closed Trades Total' section (R023).
  // The top-level totals are the single-currency view; the per-currency
  // breakdown is no longer surfaced in this footer.
  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-4">
      <TotalsGroup label="Closed Trades Total" totals={totals} count={count} />
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
    cell: ({ getValue, row }) => {
      const value = getValue<number | null>();
      if (value == null && row.original.status === 'open') {
        return <span className="text-muted-foreground">— Awaiting market price</span>;
      }
      return <PnlCell value={value} />;
    },
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
    accessorFn: (row) => row.accountName,
    cell: ({ getValue }) => {
      const name = getValue<string | null>();
      return (
        <span className="text-muted-foreground">{name ?? '—'}</span>
      );
    },
  },
  {
    id: 'sector',
    header: 'Sector',
    accessorFn: (row) => row.sectorName,
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
    id: 'initialRiskPct',
    header: 'Initial Risk %',
    accessorFn: (row) => row.metrics?.risk?.initialRiskPct,
    cell: ({ getValue }) => <PercentCell value={getValue<number | null>()} />,
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
    id: 'grossUnrealizedPnl',
    header: 'Gross Unrealized P&L',
    accessorFn: (row) => row.metrics?.unrealizedPnl?.grossUnrealizedPnl,
    cell: ({ getValue }) => <PnlCell value={getValue<number | null>()} />,
  },
  {
    id: 'lockedPnl',
    header: 'Locked-in P&L',
    accessorFn: (row) => row.metrics?.risk?.lockedPnl,
    cell: ({ getValue }) => <PnlCell value={getValue<number | null>()} />,
  },
  {
    id: 'returnPctCol',
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
  {
    id: 'distanceToStop',
    header: 'Dist to Stop %',
    accessorFn: (row) =>
      computeDistanceToStop(row.currentPrice, row.metrics?.risk?.activeStop, row.direction),
    cell: ({ getValue }) => <PercentCell value={getValue<number | null>()} />,
  },
  {
    id: 'grossRealizedPnlToDate',
    header: 'Gross Realized P&L to Date',
    accessorFn: (row) => row.metrics?.realizedPnl?.grossRealizedPnl,
    cell: ({ getValue }) => <PnlCell value={getValue<number | null>()} />,
  },
  {
    id: 'netRealizedPnlToDate',
    header: 'Net Realized P&L to Date',
    accessorKey: 'realizedPnl',
    cell: ({ getValue }) => <PnlCell value={getValue<number | null>()} />,
  },
  {
    id: 'realizedFees',
    header: 'Realized Fees to Date',
    accessorFn: (row) => row.metrics?.fees?.realizedFees,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground">{formatCurrency(getValue<number | null>())}</span>
    ),
  },

  {
    id: 'priceTimestamp',
    header: 'Price Timestamp',
    accessorKey: 'currentPriceFetchedAt',
    cell: ({ getValue }) => (
      <span className="tabular-nums text-muted-foreground text-xs">{formatDateShort(getValue<string | null>())}</span>
    ),
  },
  {
    id: 'priceAge',
    header: 'Price Age',
    accessorFn: (row) => {
      const fetchedAt = row.currentPriceFetchedAt;
      if (!fetchedAt) return null;
      const diffMs = Date.now() - new Date(fetchedAt).getTime();
      const diffMin = Math.floor(diffMs / 60_000);
      if (diffMin < 1) return 0;
      return diffMin;
    },
    cell: ({ getValue }) => {
      const minutes = getValue<number | null>();
      if (minutes == null) return <span className="text-muted-foreground">—</span>;
      if (minutes < 1) return <span className="inline-flex items-center gap-1 text-xs text-positive"><Clock className="size-3" /> fresh</span>;
      if (minutes < 5) return <span className="inline-flex items-center gap-1 text-xs text-warning"><Clock className="size-3" /> {minutes}m ago</span>;
      return <span className="inline-flex items-center gap-1 text-xs text-destructive"><Clock className="size-3" /> {minutes}m ago</span>;
    },
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
    id: 'account',
    header: 'Account',
    accessorFn: (row) => row.accountName,
    cell: ({ getValue }) => {
      const name = getValue<string | null>();
      return (
        <span className="text-muted-foreground">{name ?? '—'}</span>
      );
    },
  },
  {
    id: 'sector',
    header: 'Sector',
    accessorFn: (row) => row.sectorName,
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
    accessorFn: (row) => row.accountName,
    cell: ({ getValue }) => {
      const name = getValue<string | null>();
      return (
        <span className="text-muted-foreground">{name ?? '—'}</span>
      );
    },
  },
  {
    id: 'sector',
    header: 'Sector',
    accessorFn: (row) => row.sectorName,
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
    id: 'marketCondition',
    header: 'Market Condition',
    accessorKey: 'marketConditionName',
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
    id: 'distanceToTrigger',
    header: 'Dist to Trigger',
    accessorFn: (row) =>
      computeDistanceToTrigger(row.currentPrice, row.plannedEntry, row.direction),
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
  initialRiskPct: false,
  avgExit: false,
  grossUnrealizedPnl: false,
  lockedPnl: false,
  returnPctCol: false,
  rMultiple: false,
  distanceToStop: false,
  grossRealizedPnlToDate: false,
  netRealizedPnlToDate: false,
  realizedFees: false,
  priceTimestamp: false,
  priceAge: false,
  created: false,
};

const closedDefaultVisibility: VisibilityState = {
  initialRisk: false,
  initialRiskPct: false,
  totalEntryNotional: false,
  account: false,
  sector: false,
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
  marketCondition: false,
  dateAdded: false,
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
    open: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0, unpricedOpenPositions: 0 },
    closed: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0, unpricedOpenPositions: 0 },
    planned: { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0, unpricedOpenPositions: 0 },
  });
  const [plannedTotalsState, setPlannedTotalsState] = useState<PlannedTotalsShape>({
    totalPlannedRisk: 0,
    totalPlannedCapital: 0,
    count: 0,
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

  // Filter state starts from the URL so the server render and first client
  // render are identical. Persisted browser-only values are restored after
  // hydration below.
  const [fromDate, setFromDate] = useState(() => {
    return searchParams.get('from') ?? '';
  });
  const [toDate, setToDate] = useState(() => {
    return searchParams.get('to') ?? '';
  });
  const [accountId, setAccountId] = useState(() => {
    return searchParams.get('accountId') ?? 'all';
  });
  const [direction, setDirection] = useState(() => {
    return searchParams.get('direction') ?? 'all';
  });
  const [refreshing, setRefreshing] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(() => {
    return searchParams.get('preset');
  });
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  useEffect(() => {
    const restorePersistedFilters = window.setTimeout(() => {
      try {
        if (!searchParams.has('from')) setFromDate(localStorage.getItem('trades:fromDate') ?? '');
        if (!searchParams.has('to')) setToDate(localStorage.getItem('trades:toDate') ?? '');
        if (!searchParams.has('accountId')) setAccountId(localStorage.getItem('trades:accountId') ?? 'all');
        if (!searchParams.has('direction')) setDirection(localStorage.getItem('trades:direction') ?? 'all');
        if (!searchParams.has('preset')) setActivePreset(localStorage.getItem('trades:preset') || null);
      } catch {
        // Browser storage may be unavailable; URL/default state remains valid.
      } finally {
        setFiltersHydrated(true);
      }
    }, 0);

    return () => window.clearTimeout(restorePersistedFilters);
  }, [searchParams]);

  // Date-range presets
  const datePresets = useMemo(() => {
    const today = new Date();
    // Local-calendar formatting — never toISOString(), which would shift the
    // date by the UTC offset (e.g. a July 31 local midnight becomes July 30
    // 14:00Z when the browser is east of UTC).
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    // Trailing-day arithmetic (not calendar-month snapping): "1M" on July 31
    // is June 30 (31 days back), "3M" is May 1 (91 days back), "6M" is
    // February 1 (180 days back).
    const daysAgo = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d;
    };
    return [
      { label: 'Max', from: '' },
      { label: 'YTD', from: fmt(startOfYear) },
      { label: '1Y', from: fmt(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())) },
      { label: '6M', from: fmt(daysAgo(180)) },
      { label: '3M', from: fmt(daysAgo(91)) },
      { label: 'MTD', from: fmt(startOfMonth) },
      { label: '1M', from: fmt(daysAgo(31)) },
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
    if (!filtersHydrated) return;

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
  }, [fromDate, toDate, accountId, direction, activePreset, filtersHydrated, router]);

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

  // ── Page header button handlers ──────────────────────────────────────

  const handlePlanTrade = useCallback(() => {
    router.push('/trades/new');
  }, [router]);

  const handleExportCsv = useCallback(async () => {
    const params = new URLSearchParams();
    if (accountId && accountId !== 'all') params.set('accountId', accountId);
    const url = `/api/trades/export?${params.toString()}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error('Export CSV failed:', res.status, res.statusText);
        return;
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `trades-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Export CSV failed:', err);
    }
  }, [accountId]);

  const handleRefreshPrices = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/trades/mtm/refresh', { method: 'POST' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('Refresh prices failed:', res.status, errBody.error ?? res.statusText);
        return;
      }
      await res.json();
      // Re-fetch the current tab's data after prices are refreshed
      const tabDef = TABS.find((t) => t.id === activeTab);
      if (tabDef) fetchTab(tabDef, tabPage[activeTab]);
    } catch (err) {
      console.error('Refresh prices failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, tabPage, fetchTab]);

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
        <TotalsFooter totals={totals} tabId={tab.id} plannedTotals={plannedTotalsState} count={total} />
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="px-4 py-3 sm:px-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">
        Trades
      </h1>

      {/* ── Page header buttons ─────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePlanTrade}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <PlusCircle className="size-4" />
          Plan Trade
        </button>
        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground transition-colors"
        >
          <Download className="size-4" />
          Export CSV
        </button>
        <button
          type="button"
          onClick={handleRefreshPrices}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </button>
      </div>

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
