'use client';

import { useEffect, useState } from 'react';
import { Download, NotebookPen, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

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
  accountId: string | null;
  setup: string | null;
  setupName: string | null;
  thesis: string | null;
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedQuantity: number | null;
  setupId: string | null;
  invalidationCondition: string | null;
  preTradePlan: string | null;

  status: 'planned' | 'open' | 'closed' | 'deleted';
  createdAt: string | null;
}

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'planned', label: 'Planned' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'deleted', label: 'Deleted' },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────

function statusBadgeClass(status: Trade['status']): string {
  switch (status) {
    case 'planned':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'open':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'closed':
      return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
    case 'deleted':
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
  const router = useRouter();
  useEffect(() => { document.title = "Trades — Trading Journal"; }, []);
  const [data, setData] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');


  // ── Data ────────────────────────────────────────────────────────────

  const fetchItems = async (targetPage: number, status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('limit', String(PAGE_SIZE));
      if (status && status !== 'all') params.set('status', status);

      const res = await fetch(`/api/trades?${params.toString()}`);
      const result = await res.json();
      if (result.data) {
        setData(
          result.data.map((item: Record<string, unknown>) => {
            const i = item as { setupName?: string | null; setupId?: string | null };
            return {
              ...item,
              setup: i.setupName ?? null,
            };
          }) as Trade[]
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
    void Promise.resolve().then(() => fetchItems(1, statusFilter));
  }, [statusFilter]);



  // ── Filter ──────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / PAGE_SIZE);



  const handleDelete = async (id: string, tradeCode: string) => {
    if (!window.confirm(`Permanently remove ${tradeCode} and all its executions?`)) return;
    try {
      const res = await fetch(`/api/trades/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setMessage({ type: 'error', text: 'Failed to delete trade.' });
        return;
      }
      setMessage({ type: 'success', text: 'Trade deleted.' });
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
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
        <p className="text-sm text-zinc-500">Loading trades...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Trade Log
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/trades/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <NotebookPen className="size-4" />
            Plan Trade
          </Link>
          <button
            onClick={() => { window.location.href = '/api/trades/export'; }}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <Download className="size-4" />
            Export CSV
          </button>

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
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
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
          action={undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Trade Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Setup</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Planned Entry</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Stop</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Target</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Created</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => router.push('/trades/' + item.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push('/trades/' + item.id); }}
                  tabIndex={0}
                  role="link"
                  className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                    {item.tradeCode}
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
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    {formatDate(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
<div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleDelete(item.id, item.tradeCode); }}
                        title="Remove"
                        className="text-zinc-400 hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
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
