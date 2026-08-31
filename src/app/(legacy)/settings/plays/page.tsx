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
import { ArrowLeft } from 'lucide-react';

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

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="max-w-3xl">
        {/* ── Parent navigation ─────────────────────────────────── */}
        <Link
          href="/settings/journal-setup"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Journal Setup
        </Link>

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Plays</h1>
            <p className="mt-1 text-sm text-muted-foreground">
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
                  <label htmlFor="newName" className="mb-1 block text-sm font-medium text-foreground">
                    Name *
                  </label>
                  <input
                    id="newName"
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
            ? 'border-positive/30 bg-positive/10 text-positive'
            : 'border-destructive/30 bg-destructive/10 text-destructive'
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading plays...</p>
      ) : setups.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No plays defined yet. Create your first trading setup to see it in the Plan Trade dropdown.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {setups.map((setup) => (
            <div
              key={setup.id}
              className={`rounded-lg border border-border bg-card p-5 ${
                setup.isActive
                  ? 'border-border'
                  : 'border-border opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <Link href={`/settings/plays/${setup.id}`} className="min-w-0 flex-1 group">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground group-hover:text-muted-foreground">
                      {setup.name}
                    </h3>
                    {!setup.isActive && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  {setup.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{setup.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {setup.defaultRiskPct !== null && (
                      <span className="text-xs text-muted-foreground">Risk: {setup.defaultRiskPct}%</span>
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
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(setup)}>Delete</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => handleReactivate(setup)}>Reactivate</Button>
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(setup)}>Delete</Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
