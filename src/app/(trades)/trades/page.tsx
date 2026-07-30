'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { NotebookPen, EllipsisVertical } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  // Nested metrics
  metrics: TradeMetricsResult;
}

interface TradesResponse {
  data: TradeRow[];
  total: number;
  page: number;
  limit: number;
  totals: {
    grossRealizedPnl: number;
    netRealizedPnl: number;
    totalFees: number;
    grossUnrealizedPnl: number;
    netUnrealizedPnl: number;
    totalOpenRisk: number;
  };
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

/** Ellipsis actions button (placeholder for future action menus) */
function ActionsCell() {
  return (
    <button
      type="button"
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Trade actions"
      tabIndex={0}
    >
      <EllipsisVertical className="size-4" />
    </button>
  );
}

/** Totals footer row rendered below the DynamicTable */
function TotalsFooter({
  totals,
  tabId,
}: {
  totals: TradesResponse['totals'];
  tabId: TabId;
}) {
  if (tabId === 'open') {
    return (
      <div className="flex items-center gap-6 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          Unrealized P&L:{' '}
          <PnlCell value={totals.netUnrealizedPnl} />
        </span>
        <span>
          Open Risk: <span className="tabular-nums">{formatCurrency(totals.totalOpenRisk)}</span>
        </span>
      </div>
    );
  }

  if (tabId === 'closed') {
    return (
      <div className="flex items-center gap-6 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          Gross Realized P&L:{' '}
          <PnlCell value={totals.grossRealizedPnl} />
        </span>
        <span>
          Fees: <span className="tabular-nums">{formatCurrency(totals.totalFees)}</span>
        </span>
        <span>
          Net Realized P&L:{' '}
          <PnlCell value={totals.netRealizedPnl} />
        </span>
      </div>
    );
  }

  // Planned tab — no meaningful monetary totals
  return null;
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
  {
    id: 'actions',
    header: '',
    accessorFn: () => null,
    cell: () => <ActionsCell />,
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
  {
    id: 'actions',
    header: '',
    accessorFn: () => null,
    cell: () => <ActionsCell />,
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
    accessorFn: (row) => row.metrics?.risk?.riskToAccount,
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
  {
    id: 'actions',
    header: '',
    accessorFn: () => null,
    cell: () => <ActionsCell />,
    enableSorting: false,
  },
];

// ── Page Component ─────────────────────────────────────────────────────

export default function TradesPage() {
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
  const [activeTab, setActiveTab] = useState<TabId>('open');

  // Filter state
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [accountId, setAccountId] = useState('all');

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

      const res = await fetch(`/api/trades?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch trades' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const result: TradesResponse = await res.json();
      setTabData((prev) => ({ ...prev, [tab.id]: result.data }));
      setTabTotal((prev) => ({ ...prev, [tab.id]: result.total }));
      setTabTotals((prev) => ({ ...prev, [tab.id]: result.totals }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setTabError((prev) => ({ ...prev, [tab.id]: msg }));
      setTabData((prev) => ({ ...prev, [tab.id]: [] }));
      setTabTotal((prev) => ({ ...prev, [tab.id]: 0 }));
    } finally {
      setTabLoading((prev) => ({ ...prev, [tab.id]: false }));
    }
  }, [fromDate, toDate, accountId]);

  // Fetch all tabs — fires when filters change (debounced)
  useEffect(() => {
    // Clear any pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
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
        </p>
        <DynamicTable<TradeRow>
          data={rows}
          columns={colMap[tab.id]}
          storageKey={`trades:${tab.id}`}
        />
        <TotalsFooter totals={totals} tabId={tab.id} />
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">
        Trades
      </h1>

      {/* ── Filter controls ─────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        {/* From date */}
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-from" className="text-xs font-medium text-muted-foreground">
            From
          </label>
          <Input
            id="filter-from"
            type="date"
            className="h-8 w-44"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>

        {/* To date */}
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-to" className="text-xs font-medium text-muted-foreground">
            To
          </label>
          <Input
            id="filter-to"
            type="date"
            className="h-8 w-44"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
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
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabId)}
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
