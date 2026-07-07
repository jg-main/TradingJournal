'use client';

import { useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TradeMistake, LookupValue } from './types';

interface TradeMistakesCardProps {
  mistakes: TradeMistake[];
  mistakeTypes: LookupValue[];
  tradeId: string;
  onMistakesChanged: () => Promise<void>;
}

const severityColors: Record<string, string> = {
  minor: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  major: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const statusColors: Record<string, string> = {
  open: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  addressed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  improved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const defaultForm = {
  mistakeType: '',
  phase: 'entry' as string,
  severity: 'minor' as string,
  rootCause: '',
  correctiveAction: '',
  status: 'open' as string,
};

export default function TradeMistakesCard({
  mistakes,
  mistakeTypes,
  tradeId,
  onMistakesChanged,
}: TradeMistakesCardProps) {
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({ ...defaultForm });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!form.mistakeType) {
      setMessage({ type: 'error', text: 'Mistake type is required.' });
      return;
    }

    if (!form.rootCause.trim()) {
      setMessage({ type: 'error', text: 'Root cause is required.' });
      return;
    }

    if (!form.correctiveAction.trim()) {
      setMessage({ type: 'error', text: 'Corrective action is required.' });
      return;
    }

    try {
      const res = await fetch(`/api/trades/${tradeId}/mistakes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mistakeType: form.mistakeType,
          phase: form.phase,
          severity: form.severity,
          rootCause: form.rootCause.trim(),
          correctiveAction: form.correctiveAction.trim(),
          status: form.status,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Failed to save mistake.'),
        });
        return;
      }

      setMessage({ type: 'success', text: 'Mistake recorded.' });
      setForm({ ...defaultForm });
      setShowForm(false);
      await onMistakesChanged();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save mistake.' });
    }
  };

  const handleDelete = async (mistakeId: string) => {
    try {
      const res = await fetch(`/api/trades/${tradeId}/mistakes?id=${mistakeId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('Failed to delete mistake', err);
        return;
      }

      await onMistakesChanged();
    } catch (err) {
      console.error('Failed to delete mistake', err);
    }
  };

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="size-4 text-zinc-500" />
            Mistakes
          </CardTitle>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {showForm ? 'Cancel' : '+ Add Mistake'}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Collapsible form */}
        {showForm && (
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Mistake Type *
                </label>
                <Select
                  value={form.mistakeType}
                  onValueChange={(v) => setForm((f) => ({ ...f, mistakeType: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {mistakeTypes.map((mt) => (
                      <SelectItem key={mt.id} value={mt.value}>
                        {mt.description ?? mt.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Phase *
                </label>
                <Select
                  value={form.phase}
                  onValueChange={(v) => setForm((f) => ({ ...f, phase: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select phase" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_trade">Pre-Trade</SelectItem>
                    <SelectItem value="entry">Entry</SelectItem>
                    <SelectItem value="management">Management</SelectItem>
                    <SelectItem value="exit">Exit</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Severity *
                </label>
                <Select
                  value={form.severity}
                  onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minor">Minor</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="major">Major</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Status *
                </label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="addressed">Addressed</SelectItem>
                    <SelectItem value="improved">Improved</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Root Cause *
              </label>
              <input
                type="text"
                value={form.rootCause}
                onChange={(e) => setForm((f) => ({ ...f, rootCause: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="What caused this mistake?"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Corrective Action *
              </label>
              <input
                type="text"
                value={form.correctiveAction}
                onChange={(e) => setForm((f) => ({ ...f, correctiveAction: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="How will you prevent this in the future?"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Add Mistake
            </button>
          </form>
        )}

        {/* Mistakes table */}
        {mistakes.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No mistakes recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Phase</th>
                  <th className="py-2 pr-4">Severity</th>
                  <th className="py-2 pr-4">Root Cause</th>
                  <th className="py-2 pr-4">Corrective Action</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {mistakes.map((m) => {
                  const typeInfo = mistakeTypes.find((mt) => mt.id === m.mistakeTypeId);
                  return (
                    <tr key={m.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-2.5 pr-4 text-zinc-900 dark:text-zinc-100">
                        {typeInfo?.description ?? typeInfo?.value ?? m.mistakeTypeId ?? '-'}
                      </td>
                      <td className="py-2.5 pr-4 capitalize text-zinc-600 dark:text-zinc-400">
                        {m.phase.replace('_', ' ')}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${severityColors[m.severity] ?? 'bg-zinc-100 text-zinc-600'}`}
                        >
                          {m.severity.charAt(0).toUpperCase() + m.severity.slice(1)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px] truncate text-zinc-700 dark:text-zinc-300" title={m.rootCause ?? ''}>
                        {m.rootCause ?? '-'}
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px] truncate text-zinc-700 dark:text-zinc-300" title={m.correctiveAction ?? ''}>
                        {m.correctiveAction ?? '-'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[m.status] ?? 'bg-zinc-100 text-zinc-600'}`}
                        >
                          {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-900/30"
                          aria-label="Delete mistake"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
