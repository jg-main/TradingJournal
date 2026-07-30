'use client';

import { useEffect, useState, useCallback } from 'react';
import { NotebookPen } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

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
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  returnPct: number | null;
  riskPct: number | null;
  metrics: unknown;
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
  };
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

// ── Page Component ─────────────────────────────────────────────────────

export default function TradesPage() {
  useEffect(() => {
    document.title = 'Trades — Trading Journal';
  }, []);

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

  const fetchTab = useCallback(async (tab: TabDef) => {
    setTabLoading((prev) => ({ ...prev, [tab.id]: true }));
    setTabError((prev) => ({ ...prev, [tab.id]: null }));
    try {
      const params = new URLSearchParams();
      params.set('status', tab.apiStatus);
      params.set('page', '1');
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(`/api/trades?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch trades' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const result: TradesResponse = await res.json();
      setTabData((prev) => ({ ...prev, [tab.id]: result.data }));
      setTabTotal((prev) => ({ ...prev, [tab.id]: result.total }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setTabError((prev) => ({ ...prev, [tab.id]: msg }));
      setTabData((prev) => ({ ...prev, [tab.id]: [] }));
      setTabTotal((prev) => ({ ...prev, [tab.id]: 0 }));
    } finally {
      setTabLoading((prev) => ({ ...prev, [tab.id]: false }));
    }
  }, []);

  // Fetch all tabs on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    TABS.forEach((tab) => fetchTab(tab));
  }, [fetchTab]);

  // ── Render per-tab content ───────────────────────────────────────

  function renderTabContent(tab: TabDef) {
    const loading = tabLoading[tab.id];
    const error = tabError[tab.id];
    const rows = tabData[tab.id];
    const total = tabTotal[tab.id];

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

    // Table will be built in T02
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Showing {rows.length} of {total.toLocaleString()} {tab.label.toLowerCase()} trades.
        </p>
        {/* Table placeholder — replaced in T02 */}
        {rows.slice(0, 5).map((trade) => (
          <div
            key={trade.id}
            className="flex items-center justify-between rounded-md border px-4 py-2 text-sm"
          >
            <span className="font-medium">{trade.symbol}</span>
            <span className="text-muted-foreground">{trade.tradeCode}</span>
          </div>
        ))}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">
        Trades
      </h1>

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
