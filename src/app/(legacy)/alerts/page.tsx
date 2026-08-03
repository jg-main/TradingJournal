'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, Eye, AlertCircle } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import DynamicTable from '@/components/dynamic-table';
import { EmptyState } from '@/components/empty-state';
import { useAppTimezone } from '@/lib/timezone-context';

// ── Types ──────────────────────────────────────────────────────────────

interface WatchlistItem {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  status: 'pending' | 'watching' | 'triggered' | 'skipped' | 'expired';
  keyLevel: number | null;
  triggerPrice: number | null;
  plannedStop: number | null;
  targetPrice: number | null;
  setupId: string | null;
  sectorId: string | null;
  thesis: string | null;
  marketContext: string | null;
  notes: string | null;
  promotedTradeId: string | null;
  alertConfig: string | null;
  dateAdded: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface AlertLogEntry {
  id: string;
  watchlistItemId: string;
  symbol: string;
  condition: 'above' | 'below' | 'rsiAbove' | 'rsiBelow';
  threshold: number | null;
  actualValue: number | null;
  firedAt: string;
  readAt: string | null;
  createdAt: string | null;
}

interface AlertConfig {
  priceAboveKeyLevel?: { enabled: boolean };
  priceBelowKeyLevel?: { enabled: boolean };
  priceAboveTrigger?: { enabled: boolean };
  priceBelowTrigger?: { enabled: boolean };
  priceAboveStop?: { enabled: boolean };
  priceBelowStop?: { enabled: boolean };
  priceAboveTarget?: { enabled: boolean };
  priceBelowTarget?: { enabled: boolean };
  rsiAbove?: { enabled: boolean; threshold: number };
  rsiBelow?: { enabled: boolean; threshold: number };
}

// ── Helpers ────────────────────────────────────────────────────────────

function parseAlertConfig(raw: string | null): AlertConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as AlertConfig;
  } catch {
    return null;
  }
}

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

const CONDITION_LABELS: Record<string, string> = {
  priceAboveKeyLevel: 'Price Above Key Level',
  priceBelowKeyLevel: 'Price Below Key Level',
  priceAboveTrigger: 'Price Above Trigger',
  priceBelowTrigger: 'Price Below Trigger',
  priceAboveStop: 'Price Above Stop',
  priceBelowStop: 'Price Below Stop',
  priceAboveTarget: 'Price Above Target',
  priceBelowTarget: 'Price Below Target',
  rsiAbove: 'RSI Above',
  rsiBelow: 'RSI Below',
};

const ALERT_LOG_CONDITION_LABELS: Record<string, string> = {
  above: 'Above',
  below: 'Below',
  rsiAbove: 'RSI Above',
  rsiBelow: 'RSI Below',
};

function summarizeEnabledConditions(config: AlertConfig | null): string {
  if (!config) return 'None';
  const enabled: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (value && value.enabled) {
      const label = CONDITION_LABELS[key] ?? key;
      if (key === 'rsiAbove' || key === 'rsiBelow') {
        enabled.push(`${label} (${value.threshold})`);
      } else {
        enabled.push(label);
      }
    }
  }
  return enabled.length > 0 ? enabled.join(', ') : 'None';
}

function directoryBadgeClass(direction: string): string {
  return direction === 'long'
    ? 'bg-positive/10 text-positive'
    : 'bg-negative/10 text-negative';
}

// ── Columns: Configured Alerts ─────────────────────────────────────────

function buildConfiguredAlertColumns(): ColumnDef<WatchlistItem>[] {
  return [
    {
      id: 'symbol',
      header: 'Symbol',
      accessorFn: (row) => row.symbol,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.symbol}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'direction',
      header: 'Dir',
      accessorFn: (row) => row.direction,
      cell: ({ row }) => (
        <span
          className={
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
            directoryBadgeClass(row.original.direction)
          }
        >
          {row.original.direction === 'long' ? 'Long' : 'Short'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'conditions',
      header: 'Conditions',
      accessorFn: (row) => summarizeEnabledConditions(parseAlertConfig(row.alertConfig)),
      cell: ({ row }) => {
        const summary = summarizeEnabledConditions(parseAlertConfig(row.original.alertConfig));
        return (
          <span className="text-xs text-muted-foreground max-w-[200px] truncate block" title={summary}>
            {summary}
          </span>
        );
      },
      enableSorting: false,
    },
    {
      id: 'keyLevel',
      header: 'Key Level',
      accessorFn: (row) => row.keyLevel,
      cell: ({ row }) => (
        <span className="tabular-nums">{formatPrice(row.original.keyLevel)}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'triggerPrice',
      header: 'Trigger',
      accessorFn: (row) => row.triggerPrice,
      cell: ({ row }) => (
        <span className="tabular-nums">{formatPrice(row.original.triggerPrice)}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (row) => row.status,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground capitalize">{row.original.status}</span>
      ),
      enableSorting: true,
    },
  ];
}

// ── Columns: Alert History ─────────────────────────────────────────────

function buildAlertHistoryColumns(): ColumnDef<AlertLogEntry>[] {
  return [
    {
      id: 'symbol',
      header: 'Symbol',
      accessorFn: (row) => row.symbol,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.symbol}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'condition',
      header: 'Condition',
      accessorFn: (row) => ALERT_LOG_CONDITION_LABELS[row.condition] ?? row.condition,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {ALERT_LOG_CONDITION_LABELS[row.original.condition] ?? row.original.condition}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'threshold',
      header: 'Threshold',
      accessorFn: (row) => row.threshold,
      cell: ({ row }) => (
        <span className="tabular-nums">{formatPrice(row.original.threshold)}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'actualValue',
      header: 'Actual Value',
      accessorFn: (row) => row.actualValue,
      cell: ({ row }) => (
        <span className="tabular-nums">{formatPrice(row.original.actualValue)}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'firedAt',
      header: 'Fired At',
      accessorFn: (row) => row.firedAt,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatTimestamp(row.original.firedAt)}
        </span>
      ),
      enableSorting: true,
    },
  ];
}

// ── Page ───────────────────────────────────────────────────────────────

export default function AlertsPage() {
  useEffect(() => { document.title = 'Alerts — Trading Journal'; }, []);
  const { formatDate: tzFormatDate } = useAppTimezone();

  // Configured Alerts state
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);

  // Alert History state
  const [alertLogEntries, setAlertLogEntries] = useState<AlertLogEntry[]>([]);
  const [alertLogLoading, setAlertLogLoading] = useState(true);

  // ── Data fetching ────────────────────────────────────────────────────

  const fetchWatchlist = useCallback(async () => {
    setWatchlistLoading(true);
    try {
      const res = await fetch('/api/watchlist');
      if (!res.ok) throw new Error(`Failed to fetch watchlist: ${res.status}`);
      const data: WatchlistItem[] = await res.json();
      // Filter to items that have alertConfig set
      const withAlerts = data.filter(
        (item) => item.alertConfig !== null && item.alertConfig !== undefined && item.alertConfig !== ''
      );
      setWatchlistItems(withAlerts);
    } catch (err) {
      console.error('[alerts] Failed to fetch watchlist:', err);
      setWatchlistItems([]);
    } finally {
      setWatchlistLoading(false);
    }
  }, []);

  const fetchAlertLog = useCallback(async () => {
    setAlertLogLoading(true);
    try {
      const res = await fetch('/api/alert-log');
      if (!res.ok) throw new Error(`Failed to fetch alert log: ${res.status}`);
      const data: AlertLogEntry[] = await res.json();
      setAlertLogEntries(data);
    } catch (err) {
      console.error('[alerts] Failed to fetch alert log:', err);
      setAlertLogEntries([]);
    } finally {
      setAlertLogLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchWatchlist();
    fetchAlertLog();
  }, [fetchWatchlist, fetchAlertLog]);

  // ── Memoized columns ─────────────────────────────────────────────────

  const [configuredAlertColumns] = useState(() => buildConfiguredAlertColumns());
  const [alertHistoryColumns] = useState(() => buildAlertHistoryColumns());

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Bell className="size-6" />
          Alerts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configured alert conditions and notification history.
        </p>
      </div>

      {/* ── Configured Alerts Section ── */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Configured Alerts
          {!watchlistLoading && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {watchlistItems.length} alert{watchlistItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </h2>

        {watchlistLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
          </div>
        ) : (
          <DynamicTable
            data={watchlistItems}
            columns={configuredAlertColumns}
            storageKey="alerts-configured"
            emptyState={
              <EmptyState
                icon={<Bell className="size-12 text-muted-foreground" strokeWidth={1} />}
                title="No alerts configured"
                description={
                  'Configure price or RSI alerts on your watchlist items. ' +
                  'Go to the Watchlist page, add or edit an item, and set alert conditions.'
                }
                action={
                  <a
                    href="/watchlist"
                    className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
                  >
                    <Eye className="size-4" />
                    Go to Watchlist
                  </a>
                }
              />
            }
          />
        )}
      </section>

      {/* ── Alert History Section ── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Alert History
          {!alertLogLoading && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {alertLogEntries.length} event{alertLogEntries.length !== 1 ? 's' : ''}
            </span>
          )}
        </h2>

        {alertLogLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
          </div>
        ) : (
          <DynamicTable
            data={alertLogEntries}
            columns={alertHistoryColumns}
            storageKey="alerts-history"
            emptyState={
              <EmptyState
                icon={<AlertCircle className="size-12 text-muted-foreground" strokeWidth={1} />}
                title="No alert events yet"
                description={
                  'When configured alert conditions are met during price polling, ' +
                  'notifications and log entries will appear here.'
                }
              />
            }
          />
        )}
      </section>
    </div>
  );
}
