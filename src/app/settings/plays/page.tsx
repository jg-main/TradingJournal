'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface SetupDefinition {
  id: string;
  name: string;
  description: string | null;
  howToPlay: string | null;
  entryRules: string | null;
  exitRules: string | null;
  tags: string | null;
  defaultRiskPct: number | null;
  positionSizingRules: string | null;
  chartPatterns: string | null;
  isActive: boolean;
}

const emptyForm = {
  name: '',
  description: '',
  howToPlay: '',
  entryRules: '',
  exitRules: '',
  tags: '',
  defaultRiskPct: '',
  positionSizingRules: '',
  chartPatterns: '',
};

export default function PlaysSettingsPage() {
  const router = useRouter();
  const [setups, setSetups] = useState<SetupDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchSetups = useCallback(async () => {
    try {
      const res = await fetch('/api/setup-definitions?includeInactive=true');
      const data = await res.json();
      setSetups(data.data ?? []);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load setup definitions.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSetups();
  }, [fetchSetups]);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
  };

  const openEdit = (setup: SetupDefinition) => {
    setForm({
      name: setup.name,
      description: setup.description ?? '',
      howToPlay: setup.howToPlay ?? '',
      entryRules: setup.entryRules ?? '',
      exitRules: setup.exitRules ?? '',
      tags: setup.tags ?? '',
      defaultRiskPct: setup.defaultRiskPct?.toString() ?? '',
      positionSizingRules: setup.positionSizingRules ?? '',
      chartPatterns: setup.chartPatterns ?? '',
    });
    setEditingId(setup.id);
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const payload: Record<string, unknown> = {
      name: form.name,
    };
    if (form.description) payload.description = form.description;
    if (form.howToPlay) payload.howToPlay = form.howToPlay;
    if (form.entryRules) payload.entryRules = form.entryRules;
    if (form.exitRules) payload.exitRules = form.exitRules;
    if (form.tags) payload.tags = form.tags;
    if (form.defaultRiskPct) payload.defaultRiskPct = parseFloat(form.defaultRiskPct);
    if (form.positionSizingRules) payload.positionSizingRules = form.positionSizingRules;
    if (form.chartPatterns) payload.chartPatterns = form.chartPatterns;

    try {
      const url = editingId
        ? `/api/setup-definitions/${editingId}`
        : '/api/setup-definitions';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      setMessage({ type: 'success', text: editingId ? 'Setup updated. Returning to Settings…' : 'Setup created. Returning to Settings…' });
      setDialogOpen(false);
      resetForm();
      await fetchSetups();
      router.push('/settings');
    } catch {
      setMessage({ type: 'error', text: 'Failed to save setup.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (setup: SetupDefinition) => {
    if (!confirm(`Deactivate "${setup.name}"? Existing trades with this setup will still display correctly.`)) return;

    setMessage(null);
    try {
      const res = await fetch(`/api/setup-definitions/${setup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error });
        return;
      }

      setMessage({ type: 'success', text: `${setup.name} deactivated.` });
      await fetchSetups();
    } catch {
      setMessage({ type: 'error', text: 'Failed to deactivate setup.' });
    }
  };

  const handleDelete = async (setup: SetupDefinition) => {
    if (!confirm(`Permanently delete "${setup.name}"? This cannot be undone.`)) return;

    setMessage(null);
    try {
      const res = await fetch(`/api/setup-definitions/${setup.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error });
        return;
      }

      setMessage({ type: 'success', text: `${setup.name} permanently deleted.` });
      await fetchSetups();
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete setup.' });
    }
  };

  const handleReactivate = async (setup: SetupDefinition) => {
    setMessage(null);
    try {
      const res = await fetch(`/api/setup-definitions/${setup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error });
        return;
      }

      setMessage({ type: 'success', text: `${setup.name} reactivated.` });
      await fetchSetups();
    } catch {
      setMessage({ type: 'error', text: 'Failed to reactivate setup.' });
    }
  };

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-zinc-500">Loading plays...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Plays
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Manage trading setups that appear in the Plan Trade dropdown.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
              New Play
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={handleSave}>
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit Play' : 'New Play'}</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="name" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Name *
                  </label>
                  <input
                    id="name"
                    type="text"
                    required
                    value={form.name}
                    onChange={handleChange('name')}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                    placeholder="e.g. Breakout Pullback"
                  />
                </div>
                <div>
                  <label htmlFor="description" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Description
                  </label>
                  <textarea
                    id="description"
                    rows={2}
                    value={form.description}
                    onChange={handleChange('description')}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                    placeholder="Brief description of this setup"
                  />
                </div>
                <div>
                  <label htmlFor="howToPlay" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    How to Play
                  </label>
                  <textarea
                    id="howToPlay"
                    rows={2}
                    value={form.howToPlay}
                    onChange={handleChange('howToPlay')}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                    placeholder="How to execute this setup"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="entryRules" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Entry Rules
                    </label>
                    <textarea
                      id="entryRules"
                      rows={2}
                      value={form.entryRules}
                      onChange={handleChange('entryRules')}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="exitRules" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Exit Rules
                    </label>
                    <textarea
                      id="exitRules"
                      rows={2}
                      value={form.exitRules}
                      onChange={handleChange('exitRules')}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="defaultRiskPct" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Default Risk (%)
                    </label>
                    <input
                      id="defaultRiskPct"
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={form.defaultRiskPct}
                      onChange={handleChange('defaultRiskPct')}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                      placeholder="1.5"
                    />
                  </div>
                  <div>
                    <label htmlFor="tags" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Tags (JSON array)
                    </label>
                    <input
                      id="tags"
                      type="text"
                      value={form.tags}
                      onChange={handleChange('tags')}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                      placeholder='["breakout","trend"]'
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="chartPatterns" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Chart Patterns
                  </label>
                  <input
                    id="chartPatterns"
                    type="text"
                    value={form.chartPatterns}
                    onChange={handleChange('chartPatterns')}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                    placeholder="Flag, Pennant, Cup & Handle"
                  />
                </div>
                <div>
                  <label htmlFor="positionSizingRules" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Position Sizing Rules
                  </label>
                  <textarea
                    id="positionSizingRules"
                    rows={2}
                    value={form.positionSizingRules}
                    onChange={handleChange('positionSizingRules')}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                    placeholder="Risk 1% of account, scale into position"
                  />
                </div>
              </div>

              <DialogFooter showCloseButton className="mt-6">
                <Button type="submit" disabled={saving || !form.name.trim()}>
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {setups.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            No plays defined yet. Create your first trading setup to see it in the Plan Trade dropdown.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {setups.map((setup) => (
            <div
              key={setup.id}
              className={`rounded-lg border bg-white p-5 dark:bg-zinc-900 ${
                setup.isActive
                  ? 'border-zinc-200 dark:border-zinc-800'
                  : 'border-zinc-100 opacity-60 dark:border-zinc-800/50'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {setup.name}
                    </h3>
                    {!setup.isActive && (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </div>
                  {setup.description && (
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      {setup.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {setup.defaultRiskPct !== null && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Risk: {setup.defaultRiskPct}%
                      </span>
                    )}
                    {setup.tags && (() => {
                      try {
                        const parsed = JSON.parse(setup.tags);
                        return Array.isArray(parsed) ? parsed.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary">{tag}</Badge>
                        )) : null;
                      } catch { return null; }
                    })()}
                    {setup.chartPatterns && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Patterns: {setup.chartPatterns}
                      </span>
                    )}
                  </div>
                  {(setup.howToPlay || setup.entryRules || setup.exitRules) && (
                    <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      {setup.howToPlay && <p><span className="font-medium">How:</span> {setup.howToPlay}</p>}
                      {setup.entryRules && <p><span className="font-medium">Entry:</span> {setup.entryRules}</p>}
                      {setup.exitRules && <p><span className="font-medium">Exit:</span> {setup.exitRules}</p>}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {setup.isActive ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(setup)}>
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeactivate(setup)}
                      >
                        Deactivate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                        onClick={() => handleDelete(setup)}
                      >
                        Delete
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReactivate(setup)}
                      >
                        Reactivate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                        onClick={() => handleDelete(setup)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
