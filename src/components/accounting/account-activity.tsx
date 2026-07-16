'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  accountId: string;
  eventType: string;
  idempotencyKey: string | null;
  description: string | null;
  payload: string | null;
  effect: string | null;
  postedAt: string;
  createdAt: string;
}

interface ActivityItem {
  event: ActivityEvent;
  entry: { id: string; financialEventId: string; accountId: string; description: string | null; postedAt: string; createdAt: string } | null;
  postings: null;
  status: {
    hasEntry: boolean;
    isBalanced: boolean;
    postingCount: number;
  };
}

interface ActivityResponse {
  events: ActivityItem[];
  total: number;
}

/** Parsed effect from the JSON string stored in the event. */
interface ParsedEffect {
  kind: string;
  direction?: string;
  amount?: string;
  symbol?: string;
  details?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseEffect(effectStr: string | null): ParsedEffect | null {
  if (!effectStr) return null;
  try {
    return JSON.parse(effectStr) as ParsedEffect;
  } catch {
    return null;
  }
}

/** Derive trade cash from its immutable execution payload for legacy rows. */
function getDisplayEffect(event: ActivityEvent): ParsedEffect | null {
  const storedEffect = parseEffect(event.effect);
  if (event.eventType !== 'trade_execution' || !event.payload) return storedEffect;

  try {
    const payload = JSON.parse(event.payload) as { action?: string; quantity?: string; price?: string };
    const quantity = Number(payload.quantity);
    const price = Number(payload.price);
    if (!payload.action || !Number.isFinite(quantity) || !Number.isFinite(price)) return storedEffect;

    return {
      kind: 'cash',
      direction: ['sell', 'reduce', 'sell_short'].includes(payload.action) ? 'increase' : 'decrease',
      amount: (quantity * price).toFixed(2),
    };
  } catch {
    return storedEffect;
  }
}

function getEffectLabel(effect: ParsedEffect | null): string {
  if (!effect) return '—';
  if (effect.kind === 'cash') {
    return effect.direction === 'increase' ? 'Cash In' : 'Cash Out';
  }
  if (effect.kind === 'market') return 'Corporate Action';
  if (effect.kind === 'none') return 'No Effect';
  return effect.kind;
}

function getEffectClass(effect: ParsedEffect | null): string {
  if (!effect) return '';
  if (effect.kind === 'cash') {
    return effect.direction === 'increase'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';
  }
  if (effect.kind === 'market') return 'text-blue-600 dark:text-blue-400';
  return 'text-zinc-500 dark:text-zinc-400';
}

function getEventTypeBadge(eventType: string): { label: string; className: string } {
  switch (eventType) {
    case 'opening_balance':
      return { label: 'Opening', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'deposit':
      return { label: 'Deposit', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    case 'withdrawal':
      return { label: 'Withdrawal', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    case 'dividend':
      return { label: 'Dividend', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' };
    case 'interest':
      return { label: 'Interest', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    case 'fee':
      return { label: 'Fee', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };
    case 'tax':
      return { label: 'Tax', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' };
    case 'stock_split':
      return { label: 'Stock Split', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' };
    case 'manual_adjustment':
      return { label: 'Manual Adj.', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300' };
    default:
      return { label: eventType, className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300' };
  }
}

function formatCurrency(v: number | string): string {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return v as string;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getEffectAmount(effect: ParsedEffect | null, eventType: string): string | null {
  if (!effect) return null;
  if (effect.kind === 'cash' && effect.amount) {
    const sign = effect.direction === 'increase' ? '+' : '-';
    return `${sign}$${formatCurrency(effect.amount)}`;
  }
  if (eventType === 'stock_split') return '—';
  return null;
}

// ── Event Type Options for the Post Form ────────────────────────────────

interface EventTypeOption {
  value: string;
  label: string;
  requiresSymbol: boolean;
  requiresReason: boolean;
  rateLabel?: string;
}

const EVENT_TYPE_OPTIONS: EventTypeOption[] = [
  { value: 'deposit', label: 'Deposit', requiresSymbol: false, requiresReason: false },
  { value: 'withdrawal', label: 'Withdrawal', requiresSymbol: false, requiresReason: false },
  { value: 'dividend', label: 'Dividend', requiresSymbol: false, requiresReason: false },
  { value: 'interest', label: 'Interest', requiresSymbol: false, requiresReason: false, rateLabel: 'Rate (e.g. 3.5%)' },
  { value: 'fee', label: 'Fee', requiresSymbol: false, requiresReason: false },
  { value: 'tax', label: 'Tax', requiresSymbol: false, requiresReason: false },
  { value: 'stock_split', label: 'Stock Split', requiresSymbol: true, requiresReason: false },
  { value: 'manual_adjustment', label: 'Manual Adjustment', requiresSymbol: false, requiresReason: true },
];

// ── Component Props ────────────────────────────────────────────────────

interface AccountActivityProps {
  accountId: string;
}

// ── Component ──────────────────────────────────────────────────────────

export default function AccountActivity({ accountId }: AccountActivityProps) {
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'conflict'; text: string } | null>(null);

  // Form fields
  const [eventType, setEventType] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [symbol, setSymbol] = useState('');
  const [ratio, setRatio] = useState('');
  const [oldShares, setOldShares] = useState('');
  const [newShares, setNewShares] = useState('');

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/financial-events`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch' }));
        throw new Error(err.error ?? 'Failed to fetch activity');
      }
      const data = await res.json();
      setActivity(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    // The async loader updates loading/error state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchActivity();
  }, [fetchActivity]);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const body: Record<string, unknown> = {
        eventType,
      };
      if (description.trim()) body.description = description.trim();

      // Build the request body based on event type
      if (eventType === 'stock_split') {
        // Stock split has no amount field — validate split-specific fields
        if (!symbol.trim() || !ratio.trim() || !oldShares || !newShares) {
          setMessage({ type: 'error', text: 'All stock split fields are required.' });
          setSaving(false);
          return;
        }
        body.symbol = symbol.trim();
        body.ratio = ratio.trim();
        body.oldShares = parseInt(oldShares, 10);
        body.newShares = parseInt(newShares, 10);
      } else if (eventType === 'manual_adjustment') {
        // Manual adjustment uses signed amount
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) === 0) {
          setMessage({ type: 'error', text: 'Enter a non-zero amount. Use positive for increase, negative for decrease.' });
          setSaving(false);
          return;
        }
        body.amount = parseFloat(amount).toFixed(2);
        if (reason.trim()) body.reason = reason.trim();
      } else {
        // Cash events: amount must be positive
        const parsedAmount = parseFloat(amount);
        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
          setMessage({ type: 'error', text: 'Amount must be a positive number.' });
          setSaving(false);
          return;
        }
        body.amount = parsedAmount.toFixed(2);
      }

      const res = await fetch(`/api/accounts/${accountId}/financial-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 409) {
        const err = await res.json().catch(() => ({ error: 'Duplicate conflict' }));
        setMessage({ type: 'conflict', text: err.details ?? 'Duplicate idempotency key — event already exists.' });
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Post failed' }));
        setMessage({
          type: 'error',
          text: err.details
            ? (typeof err.details === 'string' ? err.details : JSON.stringify(err.details))
            : (err.error ?? 'Failed to post event.'),
        });
        return;
      }

      setMessage({ type: 'success', text: `${EVENT_TYPE_OPTIONS.find((o) => o.value === eventType)?.label ?? eventType} posted.` });
      resetForm();
      await fetchActivity();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to post event.' });
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setAmount('');
    setDescription('');
    setReason('');
    setSymbol('');
    setRatio('');
    setOldShares('');
    setNewShares('');
    setShowForm(false);
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Message Banner ───────────────────────────────────────────── */}
      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : message.type === 'conflict'
              ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : message.type === 'conflict' ? (
              <AlertTriangle className="size-4 shrink-0" />
            ) : (
              <XCircle className="size-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* ── Post Event Button / Form ─────────────────────────────────── */}
      <div className="mb-6">
        {!showForm ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setShowForm(true); setMessage(null); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Plus className="size-4" />
              Post Event
            </button>
            <button
              onClick={fetchActivity}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              title="Refresh"
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        ) : (
          <form onSubmit={handlePost} className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
              Post Financial Event
            </h2>

            {/* Event Type Selector */}
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Event Type</label>
              <select
                value={eventType}
                onChange={(e) => { setEventType(e.target.value); setMessage(null); }}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {EVENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Stock Split Fields */}
            {eventType === 'stock_split' ? (
              <div className="mb-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Symbol</label>
                  <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="e.g. AAPL"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Ratio</label>
                  <input
                    type="text"
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="e.g. 4:1"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Old Shares</label>
                  <input
                    type="number"
                    value={oldShares}
                    onChange={(e) => setOldShares(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="100"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">New Shares</label>
                  <input
                    type="number"
                    value={newShares}
                    onChange={(e) => setNewShares(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="400"
                    min="1"
                    required
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Amount */}
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {eventType === 'manual_adjustment' ? 'Amount (signed: positive = increase, negative = decrease)' : 'Amount ($)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={eventType === 'manual_adjustment' ? undefined : '0.01'}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                    placeholder={eventType === 'manual_adjustment' ? 'e.g. 100.00 or -50.00' : 'e.g. 1000.00'}
                    autoFocus
                  />
                </div>

                {/* Reason (manual_adjustment only) */}
                {eventType === 'manual_adjustment' && (
                  <div className="mb-4">
                    <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Reason</label>
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                      placeholder="e.g. Rounding correction"
                    />
                  </div>
                )}
              </>
            )}

            {/* Description (all types) */}
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                placeholder={eventType === 'stock_split' ? 'e.g. 4:1 forward split' : 'e.g. Wire transfer deposit'}
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {saving ? 'Posting...' : 'Post Event'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setMessage(null); }}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Activity List ────────────────────────────────────────────── */}
      <h2 className="mb-4 text-sm font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
        Account Activity
      </h2>

      {/* Loading State */}
      {loading && (
        <div className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading activity...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-900/20">
          <XCircle className="mx-auto mb-2 size-5 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && activity && activity.events.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">No financial events yet.</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Post a deposit, withdrawal, or other event to see activity.
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && activity && activity.events.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Effect</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Description</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {activity.events.map((item) => {
                const ev = item.event;
                const badge = getEventTypeBadge(ev.eventType);
                const effect = getDisplayEffect(ev);
                const effectLabel = getEffectLabel(effect);
                const effectClass = getEffectClass(effect);
                const effectAmount = getEffectAmount(effect, ev.eventType);

                return (
                  <tr key={ev.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    {/* Date */}
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {formatDateTime(ev.postedAt)}
                    </td>

                    {/* Event Type Badge */}
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>

                    {/* Effect Label */}
                    <td className={`px-4 py-3 text-xs font-medium ${effectClass}`}>
                      {effectLabel}
                    </td>

                    {/* Amount */}
                    <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium ${
                      effectAmount?.startsWith('+')
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : effectAmount?.startsWith('-')
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-zinc-600 dark:text-zinc-400'
                    }`}>
                      {effectAmount ?? '—'}
                    </td>

                    {/* Description */}
                    <td className="max-w-[220px] truncate px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {ev.description ? (
                        ev.description
                      ) : ev.eventType === 'stock_split' ? (
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {(() => {
                            try {
                              const p = JSON.parse(ev.payload ?? '{}');
                              return `${p.symbol ?? '?'} split ${p.ratio ?? '?'}`;
                            } catch { return 'stock split'; }
                          })()}
                        </span>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">—</span>
                      )}
                    </td>

                    {/* Posting Status */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium ${
                          item.status.hasEntry && item.status.isBalanced
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {item.status.hasEntry && item.status.isBalanced ? (
                          <>
                            <CheckCircle2 className="size-3" />
                            Posted
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="size-3" />
                            Pending
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {activity.total} event{activity.total !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
