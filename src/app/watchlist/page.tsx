'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
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

import { useAppTimezone } from '@/lib/timezone-context';
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
  direction: 'long' | 'short';
  setup: string | null;
  keyLevel: number | null;
  triggerPrice: number | null;
  status: 'pending' | 'watching' | 'triggered' | 'skipped' | 'expired';
  dateAdded: string | null;
  sector: string | null;
  thesis: string | null;
  plannedStop: number | null;
  targetPrice: number | null;
  alertConfig: unknown;
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
  direction: 'long' | 'short';
  setup: string;
  keyLevel: string;
  triggerPrice: string;
  plannedStop: string;
  targetPrice: string;
  status: WatchlistItem['status'];
}

const EMPTY_FORM: WatchlistForm = {
  symbol: '',
  direction: 'long',
  setup: '',
  keyLevel: '',
  triggerPrice: '',
  plannedStop: '',
  targetPrice: '',
  status: 'pending',
};

// ── Helpers ────────────────────────────────────────────────────────────

function statusBadgeClass(status: WatchlistItem['status']): string {
  switch (status) {
    case 'pending':
      return 'bg-muted text-muted-foreground';
    case 'watching':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'triggered':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'skipped':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'expired':
      return 'bg-muted text-muted-foreground';
  }
}

function directionBadgeClass(direction: 'long' | 'short'): string {
  return direction === 'long'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
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
  const [rsiAboveThreshold, setRsiAboveThreshold] = useState('70');
  const [rsiBelowThreshold, setRsiBelowThreshold] = useState('30');

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

  // ── Live price polling ──────────────────────────────────────────────

  useEffect(() => {
    const symbols = items.map((i) => i.symbol);
    if (symbols.length === 0) return;

    const doFetch = () => {
      const params = new URLSearchParams({ symbols: symbols.join(',') });
      fetch(`/api/watchlist/prices?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          if (data.prices) setPriceData(data.prices);
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
  }, [items]);

  // ── Filter ──────────────────────────────────────────────────────────

  const filteredItems =
    statusFilter === 'all'
      ? items
      : items.filter((item) => item.status === statusFilter);

  // ── Form helpers ────────────────────────────────────────────────────

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setAlertConfig(null);
    setRsiAboveThreshold('70');
    setRsiBelowThreshold('30');
    setEditingId(null);
    setMessage(null);
  };

  const openEdit = useCallback((item: WatchlistItem) => {
    setForm({
      symbol: item.symbol,
      direction: item.direction,
      setup: item.setup ?? '',
      keyLevel: item.keyLevel?.toString() ?? '',
      triggerPrice: item.triggerPrice?.toString() ?? '',
      plannedStop: item.plannedStop?.toString() ?? '',
      targetPrice: item.targetPrice?.toString() ?? '',
      status: item.status,
    });
    // Parse alertConfig from the API response
    const raw = item.alertConfig;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const config = raw as Record<string, { enabled: boolean; threshold?: number }>;
      setAlertConfig(config);
      // Extract RSI thresholds
      if (config.rsiAbove?.threshold) setRsiAboveThreshold(String(config.rsiAbove.threshold));
      if (config.rsiBelow?.threshold) setRsiBelowThreshold(String(config.rsiBelow.threshold));
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as Record<string, { enabled: boolean; threshold?: number }>;
        setAlertConfig(parsed);
        if (parsed.rsiAbove?.threshold) setRsiAboveThreshold(String(parsed.rsiAbove.threshold));
        if (parsed.rsiBelow?.threshold) setRsiBelowThreshold(String(parsed.rsiBelow.threshold));
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
        direction: form.direction,
        setup: form.setup.trim() || null,
        keyLevel: form.keyLevel ? parseFloat(form.keyLevel) : null,
        triggerPrice: form.triggerPrice ? parseFloat(form.triggerPrice) : null,
        plannedStop: form.plannedStop ? parseFloat(form.plannedStop) : null,
        targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : null,
        status: form.status,
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

  const { formatDate } = useAppTimezone();

  const formatPrice = (v: number | null) => {
    if (v === null || v === undefined) return '-';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // ── Column definitions ─────────────────────────────────────────────

  const columns = useMemo<ColumnDef<WatchlistItem>[]>(() => [
    { id: 'symbol', header: 'Symbol', accessorKey: 'symbol', cell: ({ getValue }) => <span className="font-semibold text-foreground">{getValue<string>()}</span> },
    // ── Live Price column ──
    {
      id: 'price',
      header: 'Price',
      accessorKey: 'symbol',
      enableSorting: true,
      sortingFn: (rowA, rowB) => {
        const pA = priceData?.[rowA.original.symbol]?.price ?? -Infinity;
        const pB = priceData?.[rowB.original.symbol]?.price ?? -Infinity;
        return pA - pB;
      },
      cell: ({ row }) => {
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
      sortingFn: (rowA, rowB) => {
        const cA = priceData?.[rowA.original.symbol]?.change ?? 0;
        const cB = priceData?.[rowB.original.symbol]?.change ?? 0;
        return cA - cB;
      },
      cell: ({ row }) => {
        const quote = priceData?.[row.original.symbol];
        if (!quote || quote.change == null || quote.changePercent == null) {
          return <span className="text-muted-foreground">—</span>;
        }
        const isUp = quote.change >= 0;
        const sign = isUp ? '+' : '';
        const colorClass = isUp
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400';
        return (
          <span className={`tabular-nums ${colorClass}`}>
            {sign}{quote.change.toFixed(2)} ({sign}{quote.changePercent.toFixed(2)}%)
          </span>
        );
      },
    },
    { id: 'direction', header: 'Direction', accessorKey: 'direction', cell: ({ getValue }) => {
      const v = getValue<string>();
      return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${directionBadgeClass(v as 'long' | 'short')}`}>{v === 'long' ? 'Long' : 'Short'}</span>;
    }},
    { id: 'setup', header: 'Setup', accessorKey: 'setup', cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>() || '\u2014'}</span> },
    { id: 'keyLevel', header: 'Key Level', accessorKey: 'keyLevel', cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{formatPrice(getValue<number | null>())}</span> },
    { id: 'triggerPrice', header: 'Trigger Price', accessorKey: 'triggerPrice', cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{formatPrice(getValue<number | null>())}</span> },
    { id: 'plannedStop', header: 'Planned Stop', accessorKey: 'plannedStop', cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{formatPrice(getValue<number | null>())}</span> },
    { id: 'targetPrice', header: 'Target Price', accessorKey: 'targetPrice', cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{formatPrice(getValue<number | null>())}</span> },
    { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ getValue }) => {
      const s = getValue<string>();
      return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(s as WatchlistItem['status'])}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>;
    }},
    { id: 'dateAdded', header: 'Added', accessorKey: 'dateAdded', cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{formatDate(getValue<string | null>())}</span> },
    { id: 'sector', header: 'Sector', accessorKey: 'sector', cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>() || '\u2014'}</span> },
    { id: 'thesis', header: 'Thesis', accessorKey: 'thesis', cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return v ? <span className="block max-w-[200px] truncate text-xs text-muted-foreground" title={v}>{v}</span> : <span className="text-muted-foreground">\u2014</span>;
    }},
    { id: 'actions', header: 'Actions', enableSorting: false, cell: ({ row }) => (
      <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
        <button onClick={() => openEdit(row.original)} className="text-sm text-muted-foreground hover:text-foreground">Edit</button>
        <button onClick={() => handleDelete(row.original.id, row.original.symbol)} className="text-sm text-destructive hover:text-destructive/80">Remove</button>
      </div>
    )},
  ], [handleDelete, openEdit, formatDate, priceData]);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <p className="text-sm text-muted-foreground">Loading watchlist...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
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
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="watchlist-direction" className="mb-1 block text-sm font-medium text-muted-foreground">
                    Direction
                  </label>
                  <select
                    id="watchlist-direction"
                    value={form.direction}
                    onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as 'long' | 'short' }))}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="watchlist-status" className="mb-1 block text-sm font-medium text-muted-foreground">
                    Status
                  </label>
                  <select
                    id="watchlist-status"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as WatchlistItem['status'] }))}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="pending">Pending</option>
                    <option value="watching">Watching</option>
                    <option value="triggered">Triggered</option>
                    <option value="skipped">Skipped</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="setup" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Setup
                </label>
                <input
                  id="setup"
                  type="text"
                  value={form.setup}
                  onChange={(e) => setForm((f) => ({ ...f, setup: e.target.value }))}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="e.g. Breakout, Pullback"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
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

                <div>
                  <label htmlFor="triggerPrice" className="mb-1 block text-sm font-medium text-muted-foreground">
                    Trigger Price
                  </label>
                  <input
                    id="triggerPrice"
                    type="number"
                    step="any"
                    value={form.triggerPrice}
                    onChange={(e) => setForm((f) => ({ ...f, triggerPrice: e.target.value }))}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* ── Planned Stop / Target Price ── */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="plannedStop" className="mb-1 block text-sm font-medium text-muted-foreground">
                    Planned Stop
                  </label>
                  <input
                    id="plannedStop"
                    type="number"
                    step="any"
                    value={form.plannedStop}
                    onChange={(e) => setForm((f) => ({ ...f, plannedStop: e.target.value }))}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label htmlFor="targetPrice" className="mb-1 block text-sm font-medium text-muted-foreground">
                    Target Price
                  </label>
                  <input
                    id="targetPrice"
                    type="number"
                    step="any"
                    value={form.targetPrice}
                    onChange={(e) => setForm((f) => ({ ...f, targetPrice: e.target.value }))}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* ── Alert Conditions ── */}
              <details className="rounded-lg border">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
                  Alert Conditions
                </summary>
                <div className="space-y-3 border-t px-3 py-3">
                  <p className="text-xs text-muted-foreground">
                    Trigger alerts when the current price crosses these levels.
                  </p>

                  {/* Price crossing toggles */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Key Level
                    </p>
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

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Trigger Price
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        id="priceAboveTrigger"
                        type="checkbox"
                        checked={!!alertConfig?.priceAboveTrigger?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, priceAboveTrigger: { enabled: e.target.checked } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="priceAboveTrigger" className="text-xs text-foreground">
                        Price above trigger
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="priceBelowTrigger"
                        type="checkbox"
                        checked={!!alertConfig?.priceBelowTrigger?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, priceBelowTrigger: { enabled: e.target.checked } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="priceBelowTrigger" className="text-xs text-foreground">
                        Price below trigger
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Planned Stop
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        id="priceAboveStop"
                        type="checkbox"
                        checked={!!alertConfig?.priceAboveStop?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, priceAboveStop: { enabled: e.target.checked } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="priceAboveStop" className="text-xs text-foreground">
                        Price above stop
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="priceBelowStop"
                        type="checkbox"
                        checked={!!alertConfig?.priceBelowStop?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, priceBelowStop: { enabled: e.target.checked } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="priceBelowStop" className="text-xs text-foreground">
                        Price below stop
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Target Price
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        id="priceAboveTarget"
                        type="checkbox"
                        checked={!!alertConfig?.priceAboveTarget?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, priceAboveTarget: { enabled: e.target.checked } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="priceAboveTarget" className="text-xs text-foreground">
                        Price above target
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="priceBelowTarget"
                        type="checkbox"
                        checked={!!alertConfig?.priceBelowTarget?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, priceBelowTarget: { enabled: e.target.checked } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="priceBelowTarget" className="text-xs text-foreground">
                        Price below target
                      </label>
                    </div>
                  </div>

                  {/* RSI alerts */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      RSI
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        id="rsiAbove"
                        type="checkbox"
                        checked={!!alertConfig?.rsiAbove?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, rsiAbove: { enabled: e.target.checked, threshold: parseFloat(rsiAboveThreshold) || 70 } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="rsiAbove" className="text-xs text-foreground">
                        RSI above
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={rsiAboveThreshold}
                        onChange={(e) => {
                          setRsiAboveThreshold(e.target.value);
                          setAlertConfig((prev) => ({ ...prev, rsiAbove: { enabled: prev?.rsiAbove?.enabled ?? false, threshold: parseFloat(e.target.value) || 70 } }));
                        }}
                        className="ml-auto w-16 rounded border bg-background px-1.5 py-1 text-xs text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="70"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="rsiBelow"
                        type="checkbox"
                        checked={!!alertConfig?.rsiBelow?.enabled}
                        onChange={(e) => setAlertConfig((prev) => ({ ...prev, rsiBelow: { enabled: e.target.checked, threshold: parseFloat(rsiBelowThreshold) || 30 } }))}
                        className="size-3.5 rounded"
                      />
                      <label htmlFor="rsiBelow" className="text-xs text-foreground">
                        RSI below
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={rsiBelowThreshold}
                        onChange={(e) => {
                          setRsiBelowThreshold(e.target.value);
                          setAlertConfig((prev) => ({ ...prev, rsiBelow: { enabled: prev?.rsiBelow?.enabled ?? false, threshold: parseFloat(e.target.value) || 30 } }));
                        }}
                        className="ml-auto w-16 rounded border bg-background px-1.5 py-1 text-xs text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="30"
                      />
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
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
          {message.text}
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
        initialVisibility={{ plannedStop: false, targetPrice: false, sector: false, thesis: false }}
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
