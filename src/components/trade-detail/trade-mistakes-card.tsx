'use client';

import { useState } from 'react';
import { AlertCircle, Pencil, Trash2 } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TradeMistake, LookupValue } from './types';

interface TradeMistakesCardProps {
  mistakes: TradeMistake[];
  mistakeTypes: LookupValue[];
  tradeId: string;
  onMistakesChanged: () => Promise<void>;
}

const severityColors: Record<string, string> = {
  minor: 'bg-muted text-muted-foreground',
  moderate: 'bg-warning/10 text-warning',
  major: 'bg-warning/10 text-warning',
  critical: 'bg-destructive/10 text-destructive',
};

const statusColors: Record<string, string> = {
  open: 'bg-destructive/10 text-destructive',
  addressed: 'bg-warning/10 text-warning',
  improved: 'bg-info/10 text-info',
  resolved: 'bg-positive/10 text-positive',
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
  const [editingMistake, setEditingMistake] = useState<TradeMistake | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({ ...defaultForm });

  const handleEdit = (m: TradeMistake) => {
    const typeInfo = mistakeTypes.find((mt) => mt.id === m.mistakeTypeId);
    setForm({
      mistakeType: typeInfo?.value ?? '',
      phase: m.phase,
      severity: m.severity,
      rootCause: m.rootCause ?? '',
      correctiveAction: m.correctiveAction ?? '',
      status: m.status,
    });
    setEditingMistake(m);
    setShowForm(true);
    setMessage(null);
  };

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

    const isEditing = !!editingMistake;

    try {
      const url = isEditing
        ? `/api/trades/${tradeId}/mistakes?id=${editingMistake!.id}`
        : `/api/trades/${tradeId}/mistakes`;

      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
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
        // Extract a clean error message from the API response
        const fieldMsg = err.details?.fieldErrors?.mistakeType?.[0];
        const apiMsg = err.error;
        setMessage({
          type: 'error',
          text: fieldMsg || apiMsg || 'Failed to save mistake.',
        });
        return;
      }

      setMessage({ type: 'success', text: isEditing ? 'Mistake updated.' : 'Mistake recorded.' });
      setForm({ ...defaultForm });
      setEditingMistake(null);
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
            <AlertCircle className="size-4 text-muted-foreground" />
            Mistakes
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowForm((v) => !v);
              setEditingMistake(null);
              setForm({ ...defaultForm });
            }}
          >
            {showForm ? 'Cancel' : '+ Add Mistake'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Collapsible form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-md border bg-muted p-4">
            <div className="mb-3 text-sm font-semibold text-foreground">
              {editingMistake ? 'Edit Mistake' : 'Add Mistake'}
            </div>
            {message && (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  message.type === 'success'
                    ? 'border-positive/30 bg-positive/10 text-positive'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
                }`}
              >
                {message.text}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <label htmlFor="mistake-type" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Mistake Type *
                </label>
                <Select
                  value={form.mistakeType}
                  onValueChange={(v) => setForm((f) => ({ ...f, mistakeType: v }))}
                >
                  <SelectTrigger id="mistake-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {mistakeTypes.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        No mistake types configured.{' '}
                        <a href="/settings/mistake-types" className="underline underline-offset-2 hover:text-foreground">
                          Add some in Settings
                        </a>
                      </div>
                    ) : (
                      mistakeTypes.map((mt) => (
                        <SelectItem key={mt.id} value={mt.value}>
                          {mt.value}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="mistake-phase" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Phase *
                </label>
                <Select
                  value={form.phase}
                  onValueChange={(v) => setForm((f) => ({ ...f, phase: v }))}
                >
                  <SelectTrigger id="mistake-phase">
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
                <label htmlFor="mistake-severity" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Severity *
                </label>
                <Select
                  value={form.severity}
                  onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}
                >
                  <SelectTrigger id="mistake-severity">
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
                <label htmlFor="mistake-status" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Status *
                </label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger id="mistake-status">
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
              <label htmlFor="mistake-rootCause" className="mb-1 block text-xs font-medium text-muted-foreground">
                Root Cause *
              </label>
              <Input
                id="mistake-rootCause"
                type="text"
                value={form.rootCause}
                onChange={(e) => setForm((f) => ({ ...f, rootCause: e.target.value }))}
                placeholder="What caused this mistake?"
              />
            </div>
            <div>
              <label htmlFor="mistake-correctiveAction" className="mb-1 block text-xs font-medium text-muted-foreground">
                Corrective Action *
              </label>
              <Input
                id="mistake-correctiveAction"
                type="text"
                value={form.correctiveAction}
                onChange={(e) => setForm((f) => ({ ...f, correctiveAction: e.target.value }))}
                placeholder="How will you prevent this in the future?"
              />
            </div>
            <Button type="submit">
              {editingMistake ? 'Update Mistake' : 'Add Mistake'}
            </Button>
          </form>
        )}

        {/* Mistakes table */}
        {mistakes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No mistakes recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
                    <tr key={m.id} className="border-b dark:border-muted/50">
                      <td className="py-2.5 pr-4 text-foreground">
                        {typeInfo?.value ?? typeInfo?.description ?? m.mistakeTypeId ?? '-'}
                      </td>
                      <td className="py-2.5 pr-4 capitalize text-muted-foreground">
                        {m.phase.replace('_', ' ')}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${severityColors[m.severity] ?? 'bg-muted text-muted-foreground'}`}
                        >
                          {m.severity.charAt(0).toUpperCase() + m.severity.slice(1)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px] truncate text-foreground/70" title={m.rootCause ?? ''}>
                        {m.rootCause ?? '-'}
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px] truncate text-foreground/70" title={m.correctiveAction ?? ''}>
                        {m.correctiveAction ?? '-'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[m.status] ?? 'bg-muted text-muted-foreground'}`}
                        >
                          {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={() => handleEdit(m)}
                            aria-label="Edit mistake"
                            className="min-w-11 min-h-11"
                          >
                            <Pencil className="size-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={() => handleDelete(m.id)}
                            aria-label="Delete mistake"
                            className="min-w-11 min-h-11 text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
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
