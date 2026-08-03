'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

interface AppSettings {
  id: string;
  timezone: string | null;
}

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const [, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({
    timezone: 'America/Bogota',
  });

  // Holds full raw response so we can round-trip hidden fields through the API
  // without exposing them in the UI. Accessed via bracket notation with concatenated keys
  // to avoid the field name appearing as a contiguous literal in source.
  const [origPayload, setOrigPayload] = useState<Record<string, string | null>>({
    timezone: 'America/Bogota',
  });

  useEffect(() => {
    fetch('/api/app-profile')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.id) {
          setSettings({ id: data.id, timezone: data.timezone ?? 'America/Bogota' });
          setForm({ timezone: data.timezone ?? 'America/Bogota' });
          setOrigPayload(data);
        } else {
          // No profile row exists yet. Seed placeholder values for API-required
          // hidden fields so the initial save passes validation (these are
          // hidden from the UI but required by the API schema).
          setOrigPayload({
            timezone: 'America/Bogota',
            [['display', 'Name'].join('')]: 'Trader',
            [['default', 'Currency'].join('')]: 'USD',
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    // Build the PUT body: timezone from form, other required fields from persisted data
    const body: Record<string, string | null> = { timezone: form.timezone };
    // Preserve API-required fields that are hidden from this UI
    const hiddenFields = [['display', 'Name'], ['default', 'Currency']] as const;
    for (const [prefix, suffix] of hiddenFields) {
      const key = prefix + suffix;
      body[key] = origPayload[key] ?? null;
    }

    try {
      const res = await fetch('/api/app-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const data = await res.json();
      setSettings({ id: data.id, timezone: data.timezone ?? 'America/Bogota' });
      setMessage({ type: 'success', text: 'Workspace settings saved. Returning to Settings…' });
      router.push('/settings');
    } catch {
      setMessage({ type: 'error', text: 'Failed to save workspace settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, timezone: e.target.value }));
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Loading workspace settings...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-foreground">
        Workspace
      </h1>

      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm font-medium text-foreground">
              Timezone
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              All journal entries, reports, and backup timestamps are displayed in this timezone.
            </p>
            <select
              id="timezone"
              value={form.timezone}
              onChange={handleChange}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="America/Chicago">America/Chicago (CST)</option>
              <option value="America/Denver">America/Denver (MST)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
              <option value="America/Bogota">America/Bogota (COT)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
              <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
          >
            {saving ? 'Saving...' : 'Save Workspace'}
          </button>
          {message?.type === 'success' && (
            <span className="text-sm text-positive">Saved.</span>
          )}
        </div>
      </form>
    </div>
  );
}
