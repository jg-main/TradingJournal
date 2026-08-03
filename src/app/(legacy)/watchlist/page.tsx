'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Plus, Eye, Columns3, Clock } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import DynamicTable from '@/components/dynamic-table';
import { getStalenessLabel } from '@/components/trade-detail/helpers';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import {
  evaluateAlertPoll,
  createAlertState,
  parseAlertConfig,
  mapConditionToApi,
  type AlertEvent,
  type AlertState,
  type AlertItemInput,
} from '@/lib/alert-polling';

import { useNotification } from '@/lib/useNotification';
import { EmptyState } from '@/components/empty-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Types ──────────────────────────────────────────────────────────────

interface WatchlistItem {
  id: string;
  symbol: string;
  name: string | null;
  keyLevel: number | null;
  sector: string | null;
  industry: string | null;
  alertConfig: unknown;
  status: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'watching', label: 'Watching' },
  { value: 'triggered', label: 'Triggered' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'expired', label: 'Expired' },
] as const;

interface WatchlistForm {
  symbol: string;
  keyLevel: string;
}

const EMPTY_FORM: WatchlistForm = {
  symbol: '',
  keyLevel: '',
};

// ── Helpers ────────────────────────────────────────────────────────────

// ── Alert helpers (module-level, used by evaluateWatchlistAlerts) ────

/**
 * Fetch OHLC bars for symbols with RSI alerts and update the corresponding
 * AlertItemInput entries with computed RSI values.
 */
/**
 * POST a new alert event to /api/alert-log for persistent history.
 * Fire-and-forget — errors degrade silently.
 */
async function persistAlertEvent(event: AlertEvent): Promise<void> {
  const res = await fetch('/api/alert-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      watchlistItemId: event.watchlistItemId,
      symbol: event.symbol,
      condition: mapConditionToApi(event.condition),
      threshold: event.threshold ?? null,
      actualValue: event.actualValue ?? null,
      firedAt: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    console.warn(
      `[alert] Failed to persist alert event for ${event.symbol}: ${res.status}`,
    );
  }
}

// ── Page ───────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  useEffect(() => { document.title = "Watchlist — Trading Journal"; }, []);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [priceData, setPriceData] = useState<Record<string, { symbol: string; price: number | null; marketState: string; fetchedAt: string; change?: number; changePercent?: number; error?: string }> | null>(null);
  const [colVisibility, setColVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('watchlist:visibility');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [form, setForm] = useState(EMPTY_FORM);
  const [alertConfig, setAlertConfig] = useState<Record<string, { enabled: boolean; threshold?: number }> | null>(null);

  // ── Data ────────────────────────────────────────────────────────────

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist');
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load watchlist.' });
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchItems(); }, [fetchItems]);

  // ── Alert state (persists across poll cycles) ───────────────────────
  const alertStateRef = useRef<AlertState>(createAlertState());
  /**
   * Callback ref for T04 (Web Notification Integration).
   * T04 sets this to its showNotification function.
   */
  const onAlertEventRef = useRef<((event: AlertEvent) => void) | null>(null);
  /**
   * Deduplication window: events with the same (symbol, condition) pair
   * are skipped if they were acknowledged in the last 30 seconds.
   * This prevents duplicate notifications on rapid price oscillations.
   */
  const acknowledgedEventIdsRef = useRef<Set<string>>(new Set());

  // ── Web Notification Integration (T04) ──────────────────────────────
  const { requestPermission, fireNotification, isSupported, denied } =
    useNotification();

  // Wire the notification callback ref to fireNotification.
  // Called from evaluateWatchlistAlerts within the price polling setInterval.
  // Safe because permission was already granted from a user gesture (handleSubmit below).
  // PERF: fireNotification is stable (useCallback with [isSupported]) so this runs once.
  useEffect(() => {
    onAlertEventRef.current = (event: AlertEvent) => {
      fireNotification({
        symbol: event.symbol,
        message: event.message,
        url: '/watchlist',
      });
    };
  }, [fireNotification]);

  // ── Alert evaluation helper ─────────────────────────────────────────
  // Runs after each price poll cycle. Evaluates alert conditions, detects
  // unmet→met transitions, POSTs new events to /api/alert-log, and fires
  // the notification callback (registered by T04).
  // Errors degrade silently to no-notification (not user-visible).
  const evaluateWatchlistAlerts = useCallback(
    async (prices: Record<string, { symbol: string; price: number | null }>) => {
      const symbols = Object.keys(prices);
      if (symbols.length === 0 || items.length === 0) return;

      // Build AlertItemInput array from current items + price data
      const inputs: AlertItemInput[] = [];

      for (const item of items) {
        const quote = prices[item.symbol];
        if (!quote) continue;

        const config = parseAlertConfig(item.alertConfig);
        const price = quote.price ?? null;

        inputs.push({
          id: item.id,
          symbol: item.symbol,
          alertConfig: config,
          currentPrice: price,
          rsi: null,
          keyLevel: item.keyLevel,
        });
      }

      if (inputs.length === 0) return;

      // Evaluate alerts
      const { events, nextState } = evaluateAlertPoll(alertStateRef.current, inputs);
      alertStateRef.current = nextState;

      // Fire callbacks and persist new events
      for (const event of events) {
        // Deduplicate: skip if same (symbol, condition) acknowledged in last 30s
        const dedupKey = `${event.symbol}:${event.condition}`;
        if (acknowledgedEventIdsRef.current.has(dedupKey)) continue;
        acknowledgedEventIdsRef.current.add(dedupKey);
        // Clear dedup key after 30 seconds
        setTimeout(() => {
          acknowledgedEventIdsRef.current.delete(dedupKey);
        }, 30000);

        // Fire notification callback (registered by T04)
        onAlertEventRef.current?.(event);

        // Persist to /api/alert-log (fire-and-forget)
        persistAlertEvent(event).catch(() => {
          /* silent — persistence failure degrades gracefully */
        });
      }
    },
    [items],
  );

  // ── Live price polling ──────────────────────────────────────────────

  useEffect(() => {
    const symbols = items.map((i) => i.symbol);
    if (symbols.length === 0) return;

    const doFetch = () => {
      const params = new URLSearchParams({ symbols: symbols.join(',') });
      fetch(`/api/watchlist/prices?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          if (data.prices) {
            setPriceData(data.prices);
            // Evaluate alerts after price update (fire-and-forget)
            evaluateWatchlistAlerts(data.prices).catch(() => {});
          }
        })
        .catch(() => {
          /* silent — UI shows "—" with staleness indicator */
        });
    };

    let intervalId: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      doFetch();
      intervalId = setInterval(doFetch, 15000);
    };

    const stop = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        doFetch();
        start();
      } else {
        stop();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [items, evaluateWatchlistAlerts]);

  // ── Filter ──────────────────────────────────────────────────────────

  const filteredItems =
    statusFilter === 'all'
      ? items
      : items.filter((item) => item.status === statusFilter);

  // ── Form helpers ────────────────────────────────────────────────────

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setAlertConfig(null);
    setEditingId(null);
    setMessage(null);
  };

  const openEdit = useCallback((item: WatchlistItem) => {
    setForm({
      symbol: item.symbol,
      keyLevel: item.keyLevel?.toString() ?? '',
    });
    // Parse alertConfig from the API response
    const raw = item.alertConfig;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const config = raw as Record<string, { enabled: boolean; threshold?: number }>;
      setAlertConfig(config);
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as Record<string, { enabled: boolean; threshold?: number }>;
        setAlertConfig(parsed);
      } catch {
        setAlertConfig(null);
      }
    } else {
      setAlertConfig(null);
    }
    setEditingId(item.id);
    setDialogOpen(true);
    setMessage(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!form.symbol.trim()) {
      setMessage({ type: 'error', text: 'Symbol is required.' });
      return;
    }

    try {
      const url = editingId ? `/api/watchlist/${editingId}` : '/api/watchlist';
      const method = editingId ? 'PUT' : 'POST';

      // Build alertConfig from toggles state
      const alertConfigBody: Record<string, { enabled: boolean; threshold?: number }> = {};
      if (alertConfig) {
        for (const [key, val] of Object.entries(alertConfig)) {
          if (val.enabled) {
            alertConfigBody[key] = val;
          }
        }
      }

      const body: Record<string, unknown> = {
        symbol: form.symbol.trim().toUpperCase(),
        keyLevel: form.keyLevel ? parseFloat(form.keyLevel) : null,
        alertConfig: Object.keys(alertConfigBody).length > 0 ? alertConfigBody : null,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Request failed.') });
        return;
      }

      setMessage({ type: 'success', text: editingId ? 'Watchlist item updated.' : 'Watchlist item added.' });
      setDialogOpen(false);

      // Request notification permission on alert config save (user gesture context).
      // MEM581: Chrome suppresses Notification.requestPermission() from non-gesture
      // callbacks. The form submit button provides the required user gesture.
      if (Object.keys(alertConfigBody).length > 0) {
        requestPermission().catch(() => {});
      }

      resetForm();
      fetchItems();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save watchlist item.' });
    }
  };

  const handleDelete = useCallback(async (id: string, symbol: string) => {
    if (!confirm(`Remove "${symbol}" from watchlist?`)) return;

    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setMessage({ type: 'error', text: 'Failed to remove item.' });
        return;
      }
      setMessage({ type: 'success', text: `"${symbol}" removed from watchlist.` });
      fetchItems();
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove item.' });
    }
  }, [fetchItems]);

  const formatPrice = (v: number | null) => {
    if (v === null || v === undefined) return '-';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // ── Column definitions ─────────────────────────────────────────────

  const columns = useMemo<ColumnDef<WatchlistItem>[]>(() => [
    { id: 'symbol', header: 'Symbol', accessorKey: 'symbol', cell: ({ getValue }) => <span className="font-semibold text-foreground">{getValue<string>()}</span> },
    { id: 'name', header: 'Name', accessorKey: 'name', cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>() || '\u2014'}</span> },
    // ── Live Price column ──
    {
      id: 'price',
      header: 'Price',
      accessorKey: 'symbol',
      enableSorting: true,
      sortingFn: (rowA: { original: WatchlistItem }, rowB: { original: WatchlistItem }) => {
        const pA = priceData?.[rowA.original.symbol]?.price ?? -Infinity;
        const pB = priceData?.[rowB.original.symbol]?.price ?? -Infinity;
        return pA - pB;
      },
      cell: ({ row }: { row: { original: WatchlistItem } }) => {
        const quote = priceData?.[row.original.symbol];
        if (!quote || (quote.price == null && !quote.error)) {
          return <span className="text-muted-foreground">—</span>;
        }
        if (quote.price == null) {
          const label = getStalenessLabel(quote.marketState, quote.fetchedAt);
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-default items-center gap-1 text-muted-foreground">
                    <Clock className="size-3.5" />
                    <span>—</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }
        return <span className="tabular-nums font-medium text-foreground">{formatPrice(quote.price)}</span>;
      },
    },
    // ── Change column ──
    {
      id: 'change',
      header: 'Change',
      accessorKey: 'symbol',
      enableSorting: true,
      sortingFn: (rowA: { original: WatchlistItem }, rowB: { original: WatchlistItem }) => {
        const cA = priceData?.[rowA.original.symbol]?.change ?? 0;
        const cB = priceData?.[rowB.original.symbol]?.change ?? 0;
        return cA - cB;
      },
      cell: ({ row }: { row: { original: WatchlistItem } }) => {
        const quote = priceData?.[row.original.symbol];
        if (!quote || quote.change == null || quote.changePercent == null) {
          return <span className="text-muted-foreground">—</span>;
        }
        const isUp = quote.change >= 0;
        const sign = isUp ? '+' : '';
        const colorClass = isUp
          ? 'text-positive'
          : 'text-negative';
        return (
          <span className={`tabular-nums ${colorClass}`}>
            {sign}{quote.change.toFixed(2)} ({sign}{quote.changePercent.toFixed(2)}%)
          </span>
        );
      },
    },
    { id: 'keyLevel', header: 'Key Level', accessorKey: 'keyLevel', cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{formatPrice(getValue<number | null>())}</span> },
    { id: 'sector', header: 'Sector', accessorKey: 'sector', cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>() || '\u2014'}</span> },
    { id: 'industry', header: 'Industry', accessorKey: 'industry', cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>() || '\u2014'}</span> },
    { id: 'actions', header: 'Actions', enableSorting: false, cell: ({ row }) => (
      <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
        <button onClick={() => openEdit(row.original)} className="text-sm text-muted-foreground hover:text-foreground">Edit</button>
        <button onClick={() => handleDelete(row.original.id, row.original.symbol)} className="text-sm text-destructive hover:text-destructive/80">Remove</button>
      </div>
    )},
  ], [handleDelete, openEdit, priceData]);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <p className="text-sm text-muted-foreground">Loading watchlist...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Watchlist
        </h1>
        <div className="flex items-center gap-2">
          {/* Columns button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColumns(!showColumns)}
              className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Columns3 className="size-4" />
              Columns
            </button>
            {showColumns && (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border bg-popover p-2 shadow-lg">
                {columns.filter(col => col.id !== 'actions').map((col) => (
                  <label key={col.id!} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={colVisibility[col.id!] !== false}
                      onChange={(e) => {
                        const n = { ...colVisibility, [col.id!]: e.target.checked };
                        setColVisibility(n);
                        localStorage.setItem('watchlist:visibility', JSON.stringify(n));
                      }}
                      className="size-3.5 rounded"
                    />
                    <span className="text-foreground">{typeof col.header === 'string' ? col.header : col.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <button
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
              >
                <Plus className="size-4" />
                Add Symbol
              </button>
            </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Symbol' : 'Add to Watchlist'}</DialogTitle>
              <DialogDescription>
                {editingId
                  ? 'Update the details for this watchlist entry.'
                  : 'Add a stock or symbol to monitor.'}
              </DialogDescription>
            </DialogHeader>

            {message && (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  message.type === 'success'
                    ? 'border-positive/30 bg-positive/10 text-positive'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
                }`}
              >
                {message.text}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="symbol" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Symbol *
                </label>
                <input
                  id="symbol"
                  type="text"
                  value={form.symbol}
                  onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="e.g. AAPL"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Name, sector, and industry are auto-fetched from market data.
                </p>
              </div>

              <div>
                <label htmlFor="keyLevel" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Key Level
                </label>
                <input
                  id="keyLevel"
                  type="number"
                  step="any"
                  value={form.keyLevel}
                  onChange={(e) => setForm((f) => ({ ...f, keyLevel: e.target.value }))}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="0.00"
                />
              </div>

              {/* ── Alert Conditions ── */}
              <details className="rounded-lg border">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
                  Alert Conditions
                </summary>
                <div className="space-y-3 border-t px-3 py-3">
                  <p className="text-xs text-muted-foreground">
                    Trigger alerts when the current price crosses the key level.
                  </p>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        id="priceAboveKeyLevel"
                        type="checkbox"
                        checked={!!alertConfig?.priceAboveKeyLevel?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, priceAboveKeyLevel: { enabled: e.target.checked } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="priceAboveKeyLevel" className="text-xs text-foreground">
                        Price above key level
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="priceBelowKeyLevel"
                        type="checkbox"
                        checked={!!alertConfig?.priceBelowKeyLevel?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, priceBelowKeyLevel: { enabled: e.target.checked } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="priceBelowKeyLevel" className="text-xs text-foreground">
                        Price below key level
                      </label>
                    </div>
                  </div>
                </div>
              </details>

              <DialogFooter className="border-t pt-4">
                <div className="flex w-full justify-end gap-2">
                  <DialogClose asChild>
                    <button
                      type="button"
                      className="rounded-md border bg-background px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </DialogClose>
                  <button
                    type="submit"
                    className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
                  >
                    {editingId ? 'Update' : 'Add'}
                  </button>
                </div>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Status message */}
      {message && message.type === 'success' && (
        <div className="mb-6 rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm text-positive">
          {message.text}
        </div>
      )}

      {/* Notification permission state */}
      {denied && isSupported && (
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
          Notifications blocked · enable browser notifications for alerts.
        </div>
      )}

      {/* Filter */}
      {items.length > 0 && (
        <div className="mb-6 flex items-center gap-2">
          <label htmlFor="watchlist-filter" className="text-sm font-medium text-muted-foreground">Filter:</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="watchlist-filter" className="w-36">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {filteredItems.length} of {items.length}
          </span>
        </div>
      )}

      <DynamicTable
        data={filteredItems}
        columns={columns}
        storageKey="watchlist"
        initialVisibility={{ name: false, industry: false }}
        emptyState={
          <EmptyState
            icon={<Eye className="size-12 text-muted-foreground" strokeWidth={1} />}
            title="No stocks on watch"
            description={
              statusFilter !== 'all'
                ? 'No items match the selected status filter.'
                : 'Track stocks you are monitoring for potential entries. Add symbols to your watchlist and set price alerts.'
            }
            action={
              statusFilter !== 'all' ? undefined : (
                <button
                  onClick={() => setDialogOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
                >
                  <Plus className="size-4" />
                  Add Symbol
                </button>
              )
            }
          />
        }
      />
    </div>
  );
}
