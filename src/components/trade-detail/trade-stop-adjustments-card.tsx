'use client';

import { useState } from 'react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? 'Cancel' : '+ Add Adjustment'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Collapsible form — only on open trades */}
        {tradeStatus === 'open' && showForm && (
          <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-md border bg-muted p-4">
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
                <label htmlFor="stop-previous" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Previous Stop *
                </label>
                <Input
                  id="stop-previous"
                  type="number"
                  step="any"
                  value={form.previousStop}
                  onChange={(e) => setForm((f) => ({ ...f, previousStop: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="stop-new" className="mb-1 block text-xs font-medium text-muted-foreground">
                  New Stop *
                </label>
                <Input
                  id="stop-new"
                  type="number"
                  step="any"
                  value={form.newStop}
                  onChange={(e) => setForm((f) => ({ ...f, newStop: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label htmlFor="stop-reason" className="mb-1 block text-xs font-medium text-muted-foreground">
                Reason
              </label>
              <textarea
                id="stop-reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                placeholder="Why is the stop being adjusted?"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ruleBased"
                checked={form.ruleBased}
                onChange={(e) => setForm((f) => ({ ...f, ruleBased: e.target.checked }))}
                className="rounded border text-foreground focus:ring-ring"
              />
              <label htmlFor="ruleBased" className="text-xs font-medium text-muted-foreground">
                Rule-based adjustment (e.g. trailing stop, volatility-based)
              </label>
            </div>
            <Button type="submit">
              Add Stop Adjustment
            </Button>
          </form>
        )}

        {/* Adjustments table */}
        {stopAdjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
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
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDate(adj.adjustedAt ?? adj.createdAt)}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-foreground">
                      {formatPrice(adj.previousStop)}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-foreground">
                      {formatPrice(adj.newStop)}
                    </TableCell>
                    <TableCell
                      className={`tabular-nums text-right ${
                        change != null
                          ? change > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : change < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-muted-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {change != null
                        ? `${change >= 0 ? '+' : ''}${change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {adj.reason ?? '-'}
                    </TableCell>
                    <TableCell>
                      {adj.ruleBased != null ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            adj.ruleBased
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-muted text-muted-foreground'
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
