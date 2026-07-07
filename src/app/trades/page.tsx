'use client';

import { useEffect, useState } from 'react';
import { Download, Plus, NotebookPen, Play, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ExecuteDialog } from '@/components/execute-dialog';
import type { ExecuteTradeData } from '@/components/execute-dialog';
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

interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  startingBalance: number | null;
}

interface SetupDefinition {
  id: string;
  name: string;
  description: string | null;
  howToPlay: string | null;
  entryRules: string | null;
  exitRules: string | null;
  isActive: boolean;
}

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

interface TradeForm {
  symbol: string;
  direction: 'long' | 'short';
  accountId: string;
  setupId: string;
  thesis: string;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget1: string;
  plannedQuantity: string;
}

const EMPTY_FORM: TradeForm = {
  symbol: '',
  direction: 'long',
  accountId: '',
  setupId: '',
  thesis: '',
  plannedEntry: '',
  plannedStop: '',
  plannedTarget1: '',
  plannedQuantity: '',
};

type ExecutionAction = 'buy' | 'sell' | 'buy_to_cover' | 'sell_short' | 'add' | 'reduce';

interface TradeExecution {
  id: string;
  action: ExecutionAction;
  quantity: number;
  price: number;
  fees: number | null;
  executedAt: string | null;
  notes: string | null;
}

interface ExecutionForm {
  action: ExecutionAction;
  quantity: string;
  price: string;
  fees: string;
  executedAt: string;
  notes: string;
}

const EXECUTION_ACTION_OPTIONS: Array<{ value: ExecutionAction; label: string }> = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'buy_to_cover', label: 'Buy to Cover' },
  { value: 'sell_short', label: 'Sell Short' },
  { value: 'add', label: 'Add' },
  { value: 'reduce', label: 'Reduce' },
];

const toDateTimeLocalValue = (value: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const toExecutionForm = (execution: TradeExecution): ExecutionForm => ({
  action: execution.action,
  quantity: execution.quantity.toString(),
  price: execution.price.toString(),
  fees: (execution.fees ?? 0).toString(),
  executedAt: toDateTimeLocalValue(execution.executedAt),
  notes: execution.notes ?? '',
});

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
  useEffect(() => { document.title = "Trades — Trading Journal"; }, []);
  const [data, setData] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; tradeCode: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [editTab, setEditTab] = useState<'plan' | 'executions'>('plan');
  const [executeTrade, setExecuteTrade] = useState<ExecuteTradeData | null>(null);
  const [executions, setExecutions] = useState<TradeExecution[]>([]);
  const [executionForms, setExecutionForms] = useState<Record<string, ExecutionForm>>({});
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [executionsSaving, setExecutionsSaving] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [setups, setSetups] = useState<SetupDefinition[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);

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

  const fetchSetups = async () => {
    try {
      const res = await fetch('/api/setup-definitions');
      const data = await res.json();
      setSetups(data.data ?? []);
    } catch {
      // Non-critical — setups just won't show in dropdown
    }
  };

  // Pre-fetch accounts, settings, and setups on mount
  useEffect(() => {
    void Promise.resolve().then(async () => {
      await fetchSetups();

        try {
          const [accountsRes, settingsRes] = await Promise.all([
            fetch('/api/accounts'),
            fetch('/api/settings'),
          ]);
          const accountsData = await accountsRes.json();
          const settingsData = await settingsRes.json();
          const accounts = Array.isArray(accountsData) ? accountsData : [];
          setAccounts(accounts);

          let defaultId: string | null = null;
          if (settingsData?.defaultAccountId) {
            defaultId = settingsData.defaultAccountId;
          } else {
            const firstActive = accounts.find((a: Account) => a.isActive);
            if (firstActive) defaultId = firstActive.id;
          }
          setDefaultAccountId(defaultId);
          if (defaultId) {
            setForm((f) => ({ ...f, accountId: defaultId }));
          }
        } catch {
          // Non-critical
        }
    });
  }, []);

  // ── Filter ──────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Form helpers ────────────────────────────────────────────────────


  const resetForm = () => {
    setForm({ ...EMPTY_FORM, accountId: defaultAccountId ?? '' });
    setEditingId(null);
    setEditingTrade(null);
    setEditTab('plan');
    setExecutions([]);
    setExecutionForms({});
    setMessage(null);
  };

  const fetchExecutionsForEdit = async (tradeId: string) => {
    setExecutionsLoading(true);
    try {
      const res = await fetch(`/api/trades/${tradeId}/executions`);
      if (!res.ok) {
        setConfirmDelete(null);
        setMessage({ type: 'error', text: 'Failed to load executions.' });
        return;
      }
      const rows = (await res.json()) as TradeExecution[];
      setExecutions(rows);
      setExecutionForms(Object.fromEntries(rows.map((row) => [row.id, toExecutionForm(row)])));
    } catch {
      setMessage({ type: 'error', text: 'Failed to load executions.' });
    } finally {
      setExecutionsLoading(false);
    }
  };

  const openEdit = async (item: Trade) => {
    setEditTab('plan');
    setEditingTrade(item);
    setExecutions([]);
    setExecutionForms({});
    setForm({
      symbol: item.symbol,
      direction: item.direction,
      accountId: item.accountId ?? '',
      setupId: item.setupId ?? '',
      thesis: item.thesis ?? '',
      plannedEntry: item.plannedEntry?.toString() ?? '',
      plannedStop: item.plannedStop?.toString() ?? '',
      plannedTarget1: item.plannedTarget1?.toString() ?? '',
      plannedQuantity: item.plannedQuantity?.toString() ?? '',
    });
    setEditingId(item.id);
    setDialogOpen(true);
    setMessage(null);

    if (item.status !== 'planned') {
      await fetchExecutionsForEdit(item.id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!editingId && !form.symbol.trim()) {
      setMessage({ type: 'error', text: 'Symbol is required.' });
      return;
    }

    try {
      const url = editingId ? `/api/trades/${editingId}` : '/api/trades';
      const method = editingId ? 'PUT' : 'POST';

      const body: Record<string, unknown> = {
        setupId: form.setupId || null,
        thesis: form.thesis.trim() || null,
        plannedEntry: form.plannedEntry ? parseFloat(form.plannedEntry) : null,
        plannedStop: form.plannedStop ? parseFloat(form.plannedStop) : null,
        plannedTarget1: form.plannedTarget1 ? parseFloat(form.plannedTarget1) : null,
        plannedQuantity: form.plannedQuantity ? parseFloat(form.plannedQuantity) : null,
        accountId: form.accountId || null,
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
        setConfirmDelete(null);
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

  const updateExecutionForm = (id: string, patch: Partial<ExecutionForm>) => {
    setExecutionForms((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  };

  const handleExecutionSave = async (executionId: string) => {
    if (!editingId) return;
    const executionForm = executionForms[executionId];
    if (!executionForm) return;

    const quantity = parseFloat(executionForm.quantity);
    const price = parseFloat(executionForm.price);
    const fees = executionForm.fees ? parseFloat(executionForm.fees) : 0;
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(fees) || fees < 0) {
      setMessage({ type: 'error', text: 'Execution quantity and price must be positive, and fees cannot be negative.' });
      return;
    }

    setExecutionsSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/trades/${editingId}/executions/${executionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: executionForm.action,
          quantity,
          price,
          fees,
          executedAt: executionForm.executedAt ? new Date(executionForm.executedAt).toISOString() : undefined,
          notes: executionForm.notes.trim() || null,
        }),
      });

      if (!res.ok) {
        setConfirmDelete(null);
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Failed to update execution.') });
        return;
      }

      setMessage({ type: 'success', text: 'Execution updated.' });
      await fetchExecutionsForEdit(editingId);
      fetchItems(page, statusFilter);
    } catch {
      setMessage({ type: 'error', text: 'Failed to update execution.' });
    } finally {
      setExecutionsSaving(false);
    }
  };

  const handleDelete = (id: string, tradeCode: string) => {
    setConfirmDelete({ id, tradeCode });
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
          <button
            onClick={() => { window.location.href = '/api/trades/export'; }}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <Download className="size-4" />
            Export CSV
          </button>
          <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) { setDialogOpen(true); } else { setDialogOpen(false); resetForm(); } }}>
          <DialogTrigger asChild>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Plus className="size-4" />
              Plan Trade
            </button>
          </DialogTrigger>
          <DialogContent
            className="max-w-2xl"
            onInteractOutside={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            onFocusOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>{editingId && editingTrade && editingTrade.status !== 'planned' ? 'Edit Trade' : editingId ? 'Edit Trade' : 'Plan Trade'}</DialogTitle>
              <DialogDescription>
                {editingId
                  ? 'Update the details for this trade.'
                  : 'Set the ticker, direction, account, setup, and planned price levels.'}
              </DialogDescription>
            </DialogHeader>

            {editingId && editingTrade && editingTrade.status !== 'planned' && (
              <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
                <button
                  type="button"
                  onClick={() => setEditTab('plan')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    editTab === 'plan'
                      ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
                  }`}
                >
                  Plan
                </button>
                <button
                  type="button"
                  onClick={() => setEditTab('executions')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    editTab === 'executions'
                      ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
                  }`}
                >
                  Executions
                </button>
              </div>
            )}

            {editingId && editTab === 'executions' && editingTrade && (
              <div className="space-y-4 py-2">
                {executionsLoading ? (
                  <div className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    Loading executions...
                  </div>
                ) : executions.length === 0 ? (
                  <div className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    This trade has no execution rows yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {executions.map((execution, index) => {
                      const executionForm = executionForms[execution.id];
                      if (!executionForm) return null;

                      return (
                        <div key={execution.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Execution {index + 1}</p>
                            <button
                              type="button"
                              onClick={() => handleExecutionSave(execution.id)}
                              disabled={executionsSaving}
                              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                            >
                              Save execution
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Action</label>
                              <Select
                                value={executionForm.action}
                                onValueChange={(value) => updateExecutionForm(execution.id, { action: value as ExecutionAction })}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {EXECUTION_ACTION_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label htmlFor={`execution-${execution.id}-executedAt`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Executed At</label>
                              <input
                                id={`execution-${execution.id}-executedAt`}
                                type="datetime-local"
                                value={executionForm.executedAt}
                                onChange={(e) => updateExecutionForm(execution.id, { executedAt: e.target.value })}
                                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                              />
                            </div>
                            <div>
                              <label htmlFor={`execution-${execution.id}-quantity`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Quantity</label>
                              <input
                                id={`execution-${execution.id}-quantity`}
                                type="number"
                                step="any"
                                value={executionForm.quantity}
                                onChange={(e) => updateExecutionForm(execution.id, { quantity: e.target.value })}
                                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                              />
                            </div>
                            <div>
                              <label htmlFor={`execution-${execution.id}-price`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Price</label>
                              <input
                                id={`execution-${execution.id}-price`}
                                type="number"
                                step="any"
                                value={executionForm.price}
                                onChange={(e) => updateExecutionForm(execution.id, { price: e.target.value })}
                                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                              />
                            </div>
                            <div>
                              <label htmlFor={`execution-${execution.id}-fees`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Fees</label>
                              <input
                                id={`execution-${execution.id}-fees`}
                                type="number"
                                step="any"
                                value={executionForm.fees}
                                onChange={(e) => updateExecutionForm(execution.id, { fees: e.target.value })}
                                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                              />
                            </div>
                            <div className="col-span-2">
                              <label htmlFor={`execution-${execution.id}-notes`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Notes</label>
                              <textarea
                                id={`execution-${execution.id}-notes`}
                                rows={2}
                                value={executionForm.notes}
                                onChange={(e) => updateExecutionForm(execution.id, { notes: e.target.value })}
                                className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <DialogFooter className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <div className="flex w-full justify-end gap-2">
                    <DialogClose asChild>
                      <button
                        type="button"
                        className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        Close
                      </button>
                    </DialogClose>
                  </div>
                </DialogFooter>
              </div>
            )}

            {(!editingId || editTab === 'plan') && message && (
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

            {(!editingId || editTab === 'plan') && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="symbol" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Symbol *
                  </label>
                  <input
                    id="symbol"
                    type="text"
                    value={form.symbol}
                    onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="e.g. AAPL"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
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
              </div>

              <div>
                <label htmlFor="account" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Account
                </label>
                <Select
                  value={form.accountId}
                  onValueChange={(val) => setForm((f) => ({ ...f, accountId: val }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select an account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}{a.broker ? ` (${a.broker})` : ''}
                      </SelectItem>
                    ))}
                    {accounts.length === 0 && (
                      <SelectItem value="__none__" disabled>
                        No accounts found — create one in Settings &gt; Accounts
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="setup" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Setup
                </label>
                <Select
                  value={form.setupId || undefined}
                  onValueChange={(val) => {
                    if (val === '__none__') return;
                    setForm((f) => ({ ...f, setupId: val }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a setup..." />
                  </SelectTrigger>
                  <SelectContent>
                    {form.setupId && editingTrade?.setup && !setups.some((s) => s.id === form.setupId) && (
                      <SelectItem value={form.setupId}>{editingTrade.setup}</SelectItem>
                    )}
                    {setups.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                    {setups.length === 0 && !form.setupId && (
                      <SelectItem value="__none__" disabled>
                        No setups available — create one in Settings &gt; Plays
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>

              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label htmlFor="plannedEntry" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
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
                  <label htmlFor="plannedStop" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Stop Loss
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
                  <label htmlFor="plannedTarget1" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
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

                <div>
                  <label htmlFor="plannedQuantity" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Qty
                  </label>
                  <input
                    id="plannedQuantity"
                    type="number"
                    step="any"
                    value={form.plannedQuantity}
                    onChange={(e) => setForm((f) => ({ ...f, plannedQuantity: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="0"
                  />
                </div>

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
            )}
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Execute Dialog */}
      {executeTrade && (
        <ExecuteDialog
          trade={executeTrade}
          open={true}
          onOpenChange={(open) => { if (!open) setExecuteTrade(null); }}
          onComplete={() => {
            setExecuteTrade(null);
            fetchItems(1, statusFilter);
          }}
        />
      )}

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
                <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
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
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    {formatDate(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {item.status === 'planned' && (
                        <Button variant="ghost" size="icon-sm" onClick={() => setExecuteTrade(item)} title="Execute">
                          <Play className="size-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(item)} title="Edit">
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(item.id, item.tradeCode)}
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
      
          <ConfirmDialog
            open={confirmDelete !== null}
            onOpenChange={(o) => !o && setConfirmDelete(null)}
            onConfirm={async () => {
              if (!confirmDelete) return;
              try {
                const res = await fetch(`/api/trades/${confirmDelete.id}`, { method: 'DELETE' });
                setConfirmDelete(null);
                if (!res.ok) {
                  setMessage({ type: 'error', text: 'Failed to delete trade.' });
                  return;
                }
                setMessage({ type: 'success', text: 'Trade deleted.' });
                fetchItems(1, statusFilter);
              } catch {
                setMessage({ type: 'error', text: 'Failed to delete trade.' });
              }
            }}
            title="Delete Trade"
            description={`Permanently remove ${confirmDelete?.tradeCode ?? 'this trade'} and all its executions?`}
            confirmLabel="Delete"
            destructive
          />
    </div>
        </div>
      )}
    </div>
  );
}
