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
import Link from 'next/link';

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
  analysisConfig: string | null;
  isActive: boolean;
}

export default function PlaysSettingsPage() {
  const router = useRouter();
  const [setups, setSetups] = useState<SetupDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/setup-definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const created = await res.json();
      setDialogOpen(false);
      setNewName('');
      await fetchSetups();
      // Navigate to the new play's detail page
      router.push(`/settings/plays/${created.id}`);
    } catch {
      setMessage({ type: 'error', text: 'Failed to create play.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (setup: SetupDefinition) => {
    if (!confirm(`Deactivate "${setup.name}"?`)) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/setup-definitions/${setup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
      if (!res.ok) { const err = await res.json(); setMessage({ type: 'error', text: err.error }); return; }
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
      const res = await fetch(`/api/setup-definitions/${setup.id}`, { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); setMessage({ type: 'error', text: err.error }); return; }
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
      if (!res.ok) { const err = await res.json(); setMessage({ type: 'error', text: err.error }); return; }
      setMessage({ type: 'success', text: `${setup.name} reactivated.` });
      await fetchSetups();
    } catch {
      setMessage({ type: 'error', text: 'Failed to reactivate setup.' });
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading plays...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Plays</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Trading setups that appear in the Plan Trade dropdown. Click a play to configure its rules, checks, and AI assessment data.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setNewName(''); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setDialogOpen(true)}>New Play</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>New Play</DialogTitle>
              </DialogHeader>
              <div className="mt-4">
                <label htmlFor="newName" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Name *
                </label>
                <input
                  id="newName"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  placeholder="e.g. Breakout Pullback"
                />
              </div>
              <DialogFooter showCloseButton className="mt-6">
                <Button type="submit" disabled={saving || !newName.trim()}>
                  {saving ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {message && (
        <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
            : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
        }`}>
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
                <Link href={`/settings/plays/${setup.id}`} className="min-w-0 flex-1 group">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-zinc-900 group-hover:text-zinc-600 dark:text-zinc-100 dark:group-hover:text-zinc-300">
                      {setup.name}
                    </h3>
                    {!setup.isActive && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  {setup.description && (
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{setup.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {setup.defaultRiskPct !== null && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Risk: {setup.defaultRiskPct}%</span>
                    )}
                    {setup.tags && (() => {
                      try {
                        const parsed = JSON.parse(setup.tags);
                        return Array.isArray(parsed) ? parsed.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary">{tag}</Badge>
                        )) : null;
                      } catch { return null; }
                    })()}
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {setup.isActive ? (
                    <>
                      <Link href={`/settings/plays/${setup.id}`}>
                        <Button variant="ghost" size="sm">Edit</Button>
                      </Link>
                      <Button variant="outline" size="sm" onClick={() => handleDeactivate(setup)}>Deactivate</Button>
                      <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300" onClick={() => handleDelete(setup)}>Delete</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => handleReactivate(setup)}>Reactivate</Button>
                      <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300" onClick={() => handleDelete(setup)}>Delete</Button>
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
