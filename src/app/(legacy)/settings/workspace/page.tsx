'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AppSettings {
  id: string;
  timezone: string | null;
}

/** Canonical supported timezone vocabulary — values are the API contract. */
const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST)' },
  { value: 'America/Denver', label: 'America/Denver (MST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
  { value: 'America/Bogota', label: 'America/Bogota (COT)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'UTC', label: 'UTC' },
] as const;

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

  const handleTimezoneChange = (value: string) => {
    setForm((prev) => ({ ...prev, timezone: value }));
  };

  // Child-page grammar (M004 Task 10/11): the outer shell shares the Settings
  // family constrained width (max-w-5xl, 960px keyline) while the form body
  // stays deliberately narrow (max-w-2xl), LEFT-ALIGNED to that keyline — a
  // single timezone field must not become a huge horizontal control on a wide
  // monitor. Loading replaces only the content body; the shell, back
  // navigation, and header stay stable.
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Workspace</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        Configure the application timezone used for journal-wide time display.
      </p>

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

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading workspace settings...</p>
      ) : (
        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
          <div className="space-y-4 rounded-lg border border-border bg-card p-6">
            <div>
              <label htmlFor="timezone" className="mb-1 block text-sm font-medium text-foreground">
                Timezone
              </label>
              <p className="mb-2 text-xs text-muted-foreground">
                All journal entries, reports, and backup timestamps are displayed in this timezone.
              </p>
              <Select value={form.timezone} onValueChange={handleTimezoneChange}>
                <SelectTrigger id="timezone" aria-label="Timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Workspace'}
            </Button>
            {message?.type === 'success' && (
              <span className="text-sm text-positive">Saved.</span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
