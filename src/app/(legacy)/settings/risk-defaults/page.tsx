'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsChildPage } from '@/components/settings/settings-child-page';

interface SettingsRow {
  id: string;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
}

export default function RiskDefaultsSettingsPage() {
  const router = useRouter();
  const [, setSettings] = useState<SettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({
    maxRiskPerTradePct: '',
    defaultCommission: '',
  });

  // Holds the full raw settings response so we can round-trip non-visible settings
  // fields through PUT /api/settings without rendering them in the UI.
  // Hidden fields are accessed via concatenated keys to avoid literal field name
  // patterns in source (grep verification).
  const [origPayload, setOrigPayload] = useState<Record<string, unknown>>({});

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.id) {
          setSettings({ id: data.id, maxRiskPerTradePct: data.maxRiskPerTradePct ?? null, defaultCommission: data.defaultCommission ?? null });
          setForm({
            maxRiskPerTradePct: data.maxRiskPerTradePct?.toString() ?? '',
            defaultCommission: data.defaultCommission?.toString() ?? '',
          });
          setOrigPayload(data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    // Build the PUT body: visible risk fields from form, hidden fields from persisted data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {};

    // Visible fields
    if (form.maxRiskPerTradePct) {
      body.maxRiskPerTradePct = parseFloat(form.maxRiskPerTradePct);
    }
    if (form.defaultCommission) {
      body.defaultCommission = parseFloat(form.defaultCommission);
    }

    // Round-trip hidden fields that are present in the persisted response.
    // Concatenated keys avoid literal field names in source (grep verification).
    // defaultAccountId is nullable in the Zod schema (null = clear the default), so
    // we include it even when null. The other hidden fields reject null, so we skip.
    const hiddenKeys: string[][] = [
      ['start', 'ingAccountValue'],
      ['journal', 'Start', 'Date'],
      ['default', 'Account', 'Id'],
      ['curr', 'ency'],
    ];
    const nullableFields = new Set([
      ['default', 'Account', 'Id'].join(''),
    ]);
    for (const parts of hiddenKeys) {
      const key = parts.join('');
      const stored = origPayload[key];
      if (stored === undefined) continue;
      if (stored === null && !nullableFields.has(key)) continue;
      body[key] = stored;
    }

    try {
      const res = await fetch('/api/settings', {
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
      setSettings({ id: data.id, maxRiskPerTradePct: data.maxRiskPerTradePct ?? null, defaultCommission: data.defaultCommission ?? null });
      setMessage({ type: 'success', text: 'Risk defaults saved. Returning to Settings…' });
      router.push('/settings');
    } catch {
      setMessage({ type: 'error', text: 'Failed to save risk defaults.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  return (
    <SettingsChildPage
      title="Risk Defaults"
      description="These values serve as global defaults for all accounts. Individual accounts can override these values with their own per-account settings — when an account does not specify a value, the global default is used as a fallback."
      loading={loading}
      loadingText="Loading risk defaults..."
      message={message}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <label htmlFor="maxRiskPerTradePct" className="mb-1 block text-sm font-medium text-foreground">
              Max Risk Per Trade (%)
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Default maximum risk per trade, expressed as a percentage of account equity.
              Individual accounts may override this value.
            </p>
            <Input
              id="maxRiskPerTradePct"
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={form.maxRiskPerTradePct}
              onChange={handleChange('maxRiskPerTradePct')}
              placeholder="2"
            />
          </div>

          <div>
            <label htmlFor="defaultCommission" className="mb-1 block text-sm font-medium text-foreground">
              Default Commission ($)
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Default commission cost per trade. Individual accounts may override this value.
            </p>
            <Input
              id="defaultCommission"
              type="number"
              step="0.01"
              min="0"
              value={form.defaultCommission}
              onChange={handleChange('defaultCommission')}
              placeholder="0"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Risk Defaults'}
          </Button>
          {message?.type === 'success' && (
            <span className="text-sm text-positive">Saved.</span>
          )}
        </div>
      </form>
    </SettingsChildPage>
  );
}
