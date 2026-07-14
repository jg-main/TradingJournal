'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Download, NotebookPen, Trash2, Columns3 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import DynamicTable from '@/components/dynamic-table';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useAppTimezone } from '@/lib/timezone-context';

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
  plannedTarget2: number | null;
  plannedQuantity: number | null;
  actualEntry: number | null;
  currentPrice: number | null;
  avgExitPrice: number | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  returnPct: number | null;
  riskPct: number | null;
  setupId: string | null;
  invalidationCondition: string | null;
  preTradePlan: string | null;
  status: 'planned' | 'open' | 'closed' | 'deleted';
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
}

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'planned', label: 'Planned' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'deleted', label: 'Deleted' },
] as const;

function statusBadgeClass(status: Trade['status']): string {
  switch (status) {
    case 'planned': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'open': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'closed': return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
    case 'deleted': return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  }
}

function directionBadgeClass(direction: 'long' | 'short'): string {
  return direction === 'long'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

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
  const [showColumns, setShowColumns] = useState(false);

  const [colVisibility, setColVisibility] = useState<Record<string, boolean>>(() => {
    try { const raw = localStorage.getItem('trades:visibility'); return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
  });

  const fetchItems = useCallback(async (targetPage: number, status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('limit', String(PAGE_SIZE));
      if (status && status !== 'all') params.set('status', status);
      const res = await fetch(`/api/trades?${params.toString()}`);
      const result = await res.json();
      if (result.data) { setData(result.data); setTotal(result.total); setPage(targetPage); }
      else setMessage({ type: 'error', text: result.error ?? 'Failed to fetch trades.' });
    } catch { setMessage({ type: 'error', text: 'Network error.' }); }
    finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchItems(1, statusFilter); }, [fetchItems, statusFilter]);

  const handleDelete = useCallback(async (id: string, tradeCode: string) => {
    if (!confirm(`Delete trade ${tradeCode}?`)) return;
    try {
      const res = await fetch(`/api/trades/${id}`, { method: 'DELETE' });
      if (res.ok) { setMessage({ type: 'success', text: `Deleted ${tradeCode}.` }); fetchItems(page, statusFilter); }
      else { const err = await res.json().catch(() => ({})); setMessage({ type: 'error', text: err.error ?? 'Failed to delete.' }); }
    } catch { setMessage({ type: 'error', text: 'Network error.' }); }
  }, [fetchItems, page, statusFilter]);

  const { formatDate } = useAppTimezone();
  const formatPrice = (v: number | null) => v != null ? v.toFixed(2) : '—';

  // ── Column definitions ─────────────────────────────────────────────

  const columns = useMemo<ColumnDef<Trade>[]>(() => [
    { id: 'symbol', header: 'Symbol', accessorKey: 'symbol', cell: ({ getValue }) => <span className="font-semibold text-zinc-900 dark:text-zinc-100">{getValue<string>()}</span> },
    { id: 'direction', header: 'Direction', accessorKey: 'direction', cell: ({ getValue }) => {
      const v = getValue<string>();
      return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${directionBadgeClass(v as 'long' | 'short')}`}>{v === 'long' ? 'Long' : 'Short'}</span>;
    }},
    { id: 'setup', header: 'Setup', accessorKey: 'setupName', cell: ({ getValue }) => <span className="text-zinc-600 dark:text-zinc-400">{getValue<string>() || '—'}</span> },
    { id: 'entry', header: 'Entry', cell: ({ row }) => {
      const t = row.original;
      const val = t.status !== 'planned' && t.actualEntry != null ? t.actualEntry : t.plannedEntry;
      return <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{formatPrice(val)}</span>;
    }},
    { id: 'stop', header: 'Stop', accessorKey: 'plannedStop', cell: ({ getValue }) => <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{formatPrice(getValue<number | null>())}</span> },
    { id: 'target', header: 'Target', accessorKey: 'plannedTarget1', cell: ({ getValue }) => <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{formatPrice(getValue<number | null>())}</span> },
    { id: 'exit', header: 'Exit', cell: ({ row }) => {
      const t = row.original;
      if (t.status === 'closed' && t.avgExitPrice != null) return <span className="tabular-nums font-medium text-zinc-800 dark:text-zinc-200">{formatPrice(t.avgExitPrice)}</span>;
      if (t.currentPrice != null) return <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{formatPrice(t.currentPrice)}</span>;
      return <span className="tabular-nums text-zinc-400">—</span>;
    }},
    { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ getValue }) => {
      const s = getValue<string>();
      return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(s as Trade['status'])}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>;
    }},
    { id: 'entryDate', header: 'Entry Date', accessorKey: 'openedAt', cell: ({ getValue }) => <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(getValue<string | null>())}</span> },
    { id: 'exitDate', header: 'Exit Date', cell: ({ row }) => {
      const t = row.original;
      return <span className="text-xs text-zinc-500 dark:text-zinc-400">{t.status === 'closed' ? formatDate(t.closedAt) : '—'}</span>;
    }},
    { id: 'actions', header: 'Actions', enableSorting: false, cell: ({ row }) => (
      <div className="flex items-center justify-center gap-0.5" onClick={e => e.stopPropagation()}>
        <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(row.original.id, row.original.tradeCode)} title="Remove" className="text-zinc-400 hover:text-red-600"><Trash2 className="size-3.5" /></Button>
      </div>
    )},
    // ── Extra columns (hidden by default) ──
    { id: 'qty', header: 'Qty', accessorKey: 'plannedQuantity', cell: ({ getValue }) => <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{getValue<number | null>() ?? '—'}</span> },
    { id: 'target2', header: 'Target 2', accessorKey: 'plannedTarget2', cell: ({ getValue }) => <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{formatPrice(getValue<number | null>())}</span> },
    { id: 'thesis', header: 'Thesis', accessorKey: 'thesis', cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return v ? <span className="block max-w-[200px] truncate text-xs text-zinc-500 dark:text-zinc-400" title={v}>{v}</span> : <span className="text-zinc-400">—</span>;
    }},
    { id: 'account', header: 'Account', accessorKey: 'accountId', cell: () => <span className="text-zinc-400">—</span> },
    // ── Computed columns (hidden by default) ──
    { id: 'pnl', header: 'P&L', cell: ({ row }) => {
      const t = row.original;
      let pnl: number | null = null;
      if (t.status === 'closed' && t.realizedPnl != null) {
        pnl = t.realizedPnl;
      } else if (t.status === 'open' && t.unrealizedPnl != null) {
        pnl = t.unrealizedPnl;
      }
      if (pnl == null) return <span className="tabular-nums text-zinc-400">—</span>;
      return <span className={`tabular-nums text-xs font-medium ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>;
    }},
    { id: 'riskPct', header: 'Risk %', cell: ({ row }) => {
      const v = row.original.riskPct;
      if (v == null) return <span className="tabular-nums text-zinc-400">—</span>;
      return <span className="tabular-nums text-zinc-500">{v.toFixed(2)}%</span>;
    }},
    { id: 'returnPct', header: 'Return %', cell: ({ row }) => {
      const v = row.original.returnPct;
      if (v == null) return <span className="tabular-nums text-zinc-400">—</span>;
      return <span className={`tabular-nums text-xs font-medium ${v >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
    }},
  ], [handleDelete, formatDate]);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading && data.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
        <p className="text-sm text-zinc-500">Loading trades...</p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Trade Log</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setShowColumns(!showColumns)}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
              <Columns3 className="size-4" />Columns
            </button>
            {showColumns && (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {columns.map(col => (
                  <label key={col.id!} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <input type="checkbox" checked={colVisibility[col.id!] !== false}
                      onChange={e => { const n = { ...colVisibility, [col.id!]: e.target.checked }; setColVisibility(n); localStorage.setItem('trades:visibility', JSON.stringify(n)); }}
                      className="size-3.5 rounded" />
                    <span className="text-zinc-700 dark:text-zinc-300">{typeof col.header === 'string' ? col.header : col.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <Link href="/trades/new"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <NotebookPen className="size-4" />Plan Trade
          </Link>
          <button onClick={() => { window.location.href = '/api/trades/export'; }}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <Download className="size-4" />Export CSV
          </button>
        </div>
      </div>

      {/* Status message */}
      {message && message.type === 'success' && (
        <div className="mb-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{message.text}</div>
      )}
      {message && message.type === 'error' && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">{message.text}</div>
      )}

      {/* Filters */}
      {data.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Filter:</label>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{data.length} of {total.toLocaleString()}</span>
        </div>
      )}

      {/* Table */}
      {data.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title="No trades yet"
          description={statusFilter !== 'all' ? 'No trades match the selected status filter.' : 'Your first trade is the hardest — once logged, this page will show your full trade history with entry and exit details.'}
        />
      ) : (
        <DynamicTable
          data={data}
          columns={columns}
          storageKey="trades"
          initialVisibility={{ qty: false, target2: false, thesis: false, account: false, pnl: false, riskPct: false, returnPct: false }}
          onRowClick={row => router.push('/trades/' + row.original.id)}
        />
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
          <span>Page {page} of {totalPages.toLocaleString()} ({total.toLocaleString()} total trades)</span>
          <div className="flex gap-2">
            <button onClick={() => fetchItems(page - 1, statusFilter)} disabled={page <= 1}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800">Previous</button>
            <button onClick={() => fetchItems(page + 1, statusFilter)} disabled={page >= totalPages}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
