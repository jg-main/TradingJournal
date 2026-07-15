'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Plus, Eye } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import DynamicTable from '@/components/dynamic-table';

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
  status: WatchlistItem['status'];
}

const EMPTY_FORM: WatchlistForm = {
  symbol: '',
  direction: 'long',
  setup: '',
  keyLevel: '',
  triggerPrice: '',
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

  const [form, setForm] = useState(EMPTY_FORM);

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

  // ── Filter ──────────────────────────────────────────────────────────

  const filteredItems =
    statusFilter === 'all'
      ? items
      : items.filter((item) => item.status === statusFilter);

  // ── Form helpers ────────────────────────────────────────────────────

  const resetForm = () => {
    setForm(EMPTY_FORM);
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
      status: item.status,
    });
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

      const body: Record<string, unknown> = {
        symbol: form.symbol.trim().toUpperCase(),
        direction: form.direction,
        setup: form.setup.trim() || null,
        keyLevel: form.keyLevel ? parseFloat(form.keyLevel) : null,
        triggerPrice: form.triggerPrice ? parseFloat(form.triggerPrice) : null,
        status: form.status,
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
  ], [handleDelete, openEdit, formatDate]);

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
