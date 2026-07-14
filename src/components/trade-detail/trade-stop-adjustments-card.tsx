'use client';

import { useState } from 'react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { formatPrice, formatDate } from './helpers';
import type { StopAdjustment } from './types';

interface TradeStopAdjustmentsCardProps {
  stopAdjustments: StopAdjustment[];
  tradeId: string;
  tradeStatus: string;
  onAdjustmentAdded: () => Promise<void>;
}

export default function TradeStopAdjustmentsCard({
  stopAdjustments,
  tradeId,
  tradeStatus,
  onAdjustmentAdded,
}: TradeStopAdjustmentsCardProps) {
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({
    previousStop: '',
    newStop: '',
    reason: '',
    ruleBased: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!form.previousStop || !form.newStop) {
      setMessage({ type: 'error', text: 'Previous Stop and New Stop are required.' });
      return;
    }

    try {
      const res = await fetch(`/api/trades/${tradeId}/stop-adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previousStop: parseFloat(form.previousStop),
          newStop: parseFloat(form.newStop),
          reason: form.reason.trim() || null,
          ruleBased: form.ruleBased,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Failed to save.'),
        });
        return;
      }

      setMessage({ type: 'success', text: 'Stop adjustment added.' });
      setForm({ previousStop: '', newStop: '', reason: '', ruleBased: false });
      setShowForm(false);
      await onAdjustmentAdded();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save stop adjustment.' });
    }
  };

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Stop Adjustments</CardTitle>
          {tradeStatus === 'open' && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {showForm ? 'Cancel' : '+ Add Adjustment'}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Collapsible form — only on open trades */}
        {tradeStatus === 'open' && showForm && (
          <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="stop-previous" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Previous Stop *
                </label>
                <input
                  id="stop-previous"
                  type="number"
                  step="any"
                  value={form.previousStop}
                  onChange={(e) => setForm((f) => ({ ...f, previousStop: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="stop-new" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  New Stop *
                </label>
                <input
                  id="stop-new"
                  type="number"
                  step="any"
                  value={form.newStop}
                  onChange={(e) => setForm((f) => ({ ...f, newStop: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label htmlFor="stop-reason" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Reason
              </label>
              <textarea
                id="stop-reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                rows={2}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="Why is the stop being adjusted?"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ruleBased"
                checked={form.ruleBased}
                onChange={(e) => setForm((f) => ({ ...f, ruleBased: e.target.checked }))}
                className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700"
              />
              <label htmlFor="ruleBased" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Rule-based adjustment (e.g. trailing stop, volatility-based)
              </label>
            </div>
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Add Stop Adjustment
            </button>
          </form>
        )}

        {/* Adjustments table */}
        {stopAdjustments.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No stop adjustments recorded yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Previous Stop</TableHead>
                <TableHead className="text-right">New Stop</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Rule-Based</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stopAdjustments.map((adj) => {
                const change =
                  adj.previousStop != null && adj.newStop != null
                    ? adj.newStop - adj.previousStop
                    : null;
                return (
                  <TableRow key={adj.id}>
                    <TableCell className="tabular-nums text-zinc-600 dark:text-zinc-300">
                      {formatDate(adj.adjustedAt ?? adj.createdAt)}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      {formatPrice(adj.previousStop)}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      {formatPrice(adj.newStop)}
                    </TableCell>
                    <TableCell
                      className={`tabular-nums text-right ${
                        change != null
                          ? change > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : change < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-zinc-600 dark:text-zinc-300'
                          : 'text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {change != null
                        ? `${change >= 0 ? '+' : ''}${change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-zinc-600 dark:text-zinc-300">
                      {adj.reason ?? '-'}
                    </TableCell>
                    <TableCell>
                      {adj.ruleBased != null ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            adj.ruleBased
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                          }`}
                        >
                          {adj.ruleBased ? 'Auto' : 'Manual'}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
