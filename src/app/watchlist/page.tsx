'use client';

import { useEffect, useState } from 'react';
import { Plus, Eye } from 'lucide-react';

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
      return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
    case 'watching':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'triggered':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'skipped':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'expired':
      return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
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

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/watchlist');
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load watchlist.' });
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchItems(); }, []);

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

  const openEdit = (item: WatchlistItem) => {
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
  };

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

  const handleDelete = async (id: string, symbol: string) => {
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
  };

  const { formatDate } = useAppTimezone();

  const formatPrice = (v: number | null) => {
    if (v === null || v === undefined) return '-';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <p className="text-sm text-zinc-500">Loading watchlist...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Watchlist
        </h1>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
                <label htmlFor="symbol" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Symbol *
                </label>
                <input
                  id="symbol"
                  type="text"
                  value={form.symbol}
                  onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="e.g. AAPL"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Direction
                  </label>
                  <select
                    value={form.direction}
                    onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as 'long' | 'short' }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as WatchlistItem['status'] }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
                <label htmlFor="setup" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Setup
                </label>
                <input
                  id="setup"
                  type="text"
                  value={form.setup}
                  onChange={(e) => setForm((f) => ({ ...f, setup: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="e.g. Breakout, Pullback"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="keyLevel" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Key Level
                  </label>
                  <input
                    id="keyLevel"
                    type="number"
                    step="any"
                    value={form.keyLevel}
                    onChange={(e) => setForm((f) => ({ ...f, keyLevel: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label htmlFor="triggerPrice" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Trigger Price
                  </label>
                  <input
                    id="triggerPrice"
                    type="number"
                    step="any"
                    value={form.triggerPrice}
                    onChange={(e) => setForm((f) => ({ ...f, triggerPrice: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <DialogFooter className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <div className="flex w-full justify-end gap-2">
                  <DialogClose asChild>
                    <button
                      type="button"
                      className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      Cancel
                    </button>
                  </DialogClose>
                  <button
                    type="submit"
                    className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Filter:</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
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
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {filteredItems.length} of {items.length}
          </span>
        </div>
      )}

      {/* Empty state */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={<Eye className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
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
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Plus className="size-4" />
                Add Symbol
              </button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Setup</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Key Level</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Trigger Price</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Added</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                    {item.symbol}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${directionBadgeClass(item.direction)}`}
                    >
                      {item.direction === 'long' ? 'Long' : 'Short'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {item.setup ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {formatPrice(item.keyLevel)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {formatPrice(item.triggerPrice)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
                    >
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    {formatDate(item.dateAdded)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(item)}
                      className="mr-2 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.symbol)}
                      className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
