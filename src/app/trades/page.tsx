'use client';

import { useEffect, useState } from 'react';
import { Download, Plus, NotebookPen } from 'lucide-react';
import Link from 'next/link';

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

interface Trade {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: 'long' | 'short';
  setup: string | null;
  thesis: string | null;
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedTarget2: number | null;
  invalidationCondition: string | null;
  preTradePlan: string | null;
  status: 'idea' | 'planned' | 'open' | 'closed' | 'scratched';
  createdAt: string | null;
}

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'idea', label: 'Idea' },
  { value: 'planned', label: 'Planned' },
  { value: 'scratched', label: 'Scratched' },
] as const;

interface TradeForm {
  symbol: string;
  direction: 'long' | 'short';
  status: Trade['status'];
  setup: string;
  thesis: string;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget1: string;
  plannedTarget2: string;
  invalidationCondition: string;
  preTradePlan: string;
}

const EMPTY_FORM: TradeForm = {
  symbol: '',
  direction: 'long',
  status: 'planned',
  setup: '',
  thesis: '',
  plannedEntry: '',
  plannedStop: '',
  plannedTarget1: '',
  plannedTarget2: '',
  invalidationCondition: '',
  preTradePlan: '',
};

// ── Helpers ────────────────────────────────────────────────────────────

function statusBadgeClass(status: Trade['status']): string {
  switch (status) {
    case 'idea':
      return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
    case 'planned':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'open':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'closed':
      return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
    case 'scratched':
      return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  }
}

function directionBadgeClass(direction: 'long' | 'short'): string {
  return direction === 'long'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

// ── Page ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function TradesPage() {
  const [data, setData] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);

  // ── Data ────────────────────────────────────────────────────────────

  const fetchItems = async (targetPage: number, status: string) => {
    try {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('limit', String(PAGE_SIZE));
      if (status && status !== 'all') params.set('status', status);

      const res = await fetch(`/api/trades?${params.toString()}`);
      const result = await res.json();
      if (result.data) {
        setData(
          result.data.map((item: Record<string, unknown>) => ({
            ...item,
            setup: (item as { setupId?: string | null }).setupId ?? null,
          })) as Trade[]
        );
        setTotal(result.total);
        setPage(result.page);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load trades.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setPage(1);
    fetchItems(1, statusFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // ── Filter ──────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Form helpers ────────────────────────────────────────────────────

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setMessage(null);
  };

  const openEdit = (item: Trade) => {
    setForm({
      symbol: item.symbol,
      direction: item.direction,
      status: item.status,
      setup: item.setup ?? '',
      thesis: item.thesis ?? '',
      plannedEntry: item.plannedEntry?.toString() ?? '',
      plannedStop: item.plannedStop?.toString() ?? '',
      plannedTarget1: item.plannedTarget1?.toString() ?? '',
      plannedTarget2: item.plannedTarget2?.toString() ?? '',
      invalidationCondition: item.invalidationCondition ?? '',
      preTradePlan: item.preTradePlan ?? '',
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
      const url = editingId ? `/api/trades/${editingId}` : '/api/trades';
      const method = editingId ? 'PUT' : 'POST';

      const body: Record<string, unknown> = {
        setup: form.setup.trim() || null,
        thesis: form.thesis.trim() || null,
        plannedEntry: form.plannedEntry ? parseFloat(form.plannedEntry) : null,
        plannedStop: form.plannedStop ? parseFloat(form.plannedStop) : null,
        plannedTarget1: form.plannedTarget1 ? parseFloat(form.plannedTarget1) : null,
        plannedTarget2: form.plannedTarget2 ? parseFloat(form.plannedTarget2) : null,
        invalidationCondition: form.invalidationCondition.trim() || null,
        preTradePlan: form.preTradePlan.trim() || null,
      };

      if (!editingId) {
        body.symbol = form.symbol.trim().toUpperCase();
        body.direction = form.direction;
      }

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

      setMessage({ type: 'success', text: editingId ? 'Trade updated.' : 'Trade created.' });
      setDialogOpen(false);
      resetForm();
      fetchItems(1, statusFilter);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save trade.' });
    }
  };

  const handleDelete = async (id: string, tradeCode: string) => {
    if (!confirm(`Scratch trade "${tradeCode}"? This will mark it as scratched.`)) return;

    try {
      const res = await fetch(`/api/trades/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setMessage({ type: 'error', text: 'Failed to delete trade.' });
        return;
      }
      setMessage({ type: 'success', text: `Trade ${tradeCode} scratched.` });
      fetchItems(1, statusFilter);
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete trade.' });
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return d;
    }
  };

  const formatPrice = (v: number | null) => {
    if (v === null || v === undefined) return '-';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <p className="text-sm text-zinc-500">Loading trades...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Trade Log
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { window.location.href = '/api/trades/export'; }}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <Download className="size-4" />
            Export CSV
          </button>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Plus className="size-4" />
              Plan Trade
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Trade' : 'Plan Trade'}</DialogTitle>
              <DialogDescription>
                {editingId
                  ? 'Update the details for this planned trade.'
                  : 'Define a new planned trade with entry, stop, and target levels.'}
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
              <div className="grid grid-cols-3 gap-4">
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
                    readOnly={!!editingId}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Direction
                  </label>
                  <select
                    value={form.direction}
                    onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as 'long' | 'short' }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    disabled={!!editingId}
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
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Trade['status'] }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="idea">Idea</option>
                    <option value="planned">Planned</option>
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
                  placeholder="e.g. Breakout, Pullback, Trend reversal"
                />
              </div>

              <div>
                <label htmlFor="thesis" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Thesis
                </label>
                <textarea
                  id="thesis"
                  value={form.thesis}
                  onChange={(e) => setForm((f) => ({ ...f, thesis: e.target.value }))}
                  rows={2}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="Why this trade should work..."
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="plannedEntry" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Planned Entry
                  </label>
                  <input
                    id="plannedEntry"
                    type="number"
                    step="any"
                    value={form.plannedEntry}
                    onChange={(e) => setForm((f) => ({ ...f, plannedEntry: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label htmlFor="plannedStop" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Planned Stop
                  </label>
                  <input
                    id="plannedStop"
                    type="number"
                    step="any"
                    value={form.plannedStop}
                    onChange={(e) => setForm((f) => ({ ...f, plannedStop: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label htmlFor="plannedTarget1" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Target 1
                  </label>
                  <input
                    id="plannedTarget1"
                    type="number"
                    step="any"
                    value={form.plannedTarget1}
                    onChange={(e) => setForm((f) => ({ ...f, plannedTarget1: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="plannedTarget2" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Target 2
                </label>
                <input
                  id="plannedTarget2"
                  type="number"
                  step="any"
                  value={form.plannedTarget2}
                  onChange={(e) => setForm((f) => ({ ...f, plannedTarget2: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label htmlFor="invalidationCondition" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Invalidation Condition
                </label>
                <textarea
                  id="invalidationCondition"
                  value={form.invalidationCondition}
                  onChange={(e) => setForm((f) => ({ ...f, invalidationCondition: e.target.value }))}
                  rows={2}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="What would invalidate this thesis..."
                />
              </div>

              <div>
                <label htmlFor="preTradePlan" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Pre-Trade Plan
                </label>
                <textarea
                  id="preTradePlan"
                  value={form.preTradePlan}
                  onChange={(e) => setForm((f) => ({ ...f, preTradePlan: e.target.value }))}
                  rows={2}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="Entry criteria, position sizing, risk management rules..."
                />
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
                    {editingId ? 'Update' : 'Plan Trade'}
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
      {total > 0 && (
        <div className="mb-6 flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Filter:</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {data.length} of {total.toLocaleString()}
          </span>
        </div>
      )}

      {/* Empty state */}
      {data.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title="No trades yet"
          description={
            statusFilter !== 'all'
              ? 'No trades match the selected status filter.'
              : 'Your first trade is the hardest — once logged, this page will show your full trade history with entry and exit details.'
          }
          action={
            statusFilter !== 'all' ? undefined : (
              <button
                onClick={() => setDialogOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Plus className="size-4" />
                Plan Trade
              </button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Trade Code</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Symbol</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Direction</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Setup</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">Planned Entry</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">Stop</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">Target</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Created</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    <Link
                      href={'/trades/' + item.id}
                      className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {item.tradeCode}
                    </Link>
                  </td>
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
                    {formatPrice(item.plannedEntry)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {formatPrice(item.plannedStop)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {formatPrice(item.plannedTarget1)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
                    >
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    {formatDate(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(item)}
                      className="mr-2 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.tradeCode)}
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

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
          <span>
            Page {page} of {totalPages.toLocaleString()} ({total.toLocaleString()} total trades)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setLoading(true);
                fetchItems(page - 1, statusFilter);
              }}
              disabled={page <= 1}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
            >
              Previous
            </button>
            <button
              onClick={() => {
                setLoading(true);
                fetchItems(page + 1, statusFilter);
              }}
              disabled={page >= totalPages}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
