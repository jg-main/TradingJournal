'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

interface Account {
  id: string;
  name: string;
}

interface RiskSettings {
  id: string;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  startingAccountValue: number | null;
  defaultAccountId: string | null;
  journalStartDate: string | null;
}

export default function RiskSettingsPage() {
  const router = useRouter();
  const [, setSettings] = useState<RiskSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({
    maxRiskPerTradePct: '',
    defaultCommission: '',
    startingAccountValue: '',
    defaultAccountId: '',
    journalStartDate: '',
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then((r) => r.json()),
      fetch('/api/accounts').then((r) => r.json()),
    ]).then(([settingsData, accountsData]) => {
      if (settingsData && settingsData.id) {
        setSettings(settingsData);
        setForm({
          maxRiskPerTradePct: settingsData.maxRiskPerTradePct?.toString() ?? '',
          defaultCommission: settingsData.defaultCommission?.toString() ?? '',
          startingAccountValue: settingsData.startingAccountValue?.toString() ?? '',
          defaultAccountId: settingsData.defaultAccountId ?? '',
          journalStartDate: settingsData.journalStartDate ?? '',
        });
      }
      if (Array.isArray(accountsData)) {
        setAccounts(accountsData);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const payload: Record<string, unknown> = {};
    if (form.maxRiskPerTradePct) payload.maxRiskPerTradePct = parseFloat(form.maxRiskPerTradePct);
    if (form.defaultCommission) payload.defaultCommission = parseFloat(form.defaultCommission);
    if (form.startingAccountValue) payload.startingAccountValue = parseFloat(form.startingAccountValue);
    payload.defaultAccountId = form.defaultAccountId || null;
    if (form.journalStartDate) payload.journalStartDate = form.journalStartDate;

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const data = await res.json();
      setSettings(data);
      setMessage({ type: 'success', text: 'Risk settings saved. Returning to Settings…' });
      router.push('/settings');
    } catch {
      setMessage({ type: 'error', text: 'Failed to save risk settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading risk settings...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Risk Settings
      </h1>

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

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <label htmlFor="maxRiskPerTradePct" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Max Risk Per Trade (%)
            </label>
            <input
              id="maxRiskPerTradePct"
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={form.maxRiskPerTradePct}
              onChange={handleChange('maxRiskPerTradePct')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              placeholder="2"
            />
          </div>

          <div>
            <label htmlFor="defaultCommission" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Default Commission ($)
            </label>
            <input
              id="defaultCommission"
              type="number"
              step="0.01"
              min="0"
              value={form.defaultCommission}
              onChange={handleChange('defaultCommission')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              placeholder="0"
            />
          </div>

          <div>
            <label htmlFor="startingAccountValue" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Starting Account Value ($)
            </label>
            <input
              id="startingAccountValue"
              type="number"
              step="0.01"
              min="0"
              value={form.startingAccountValue}
              onChange={handleChange('startingAccountValue')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              placeholder="50000"
            />
          </div>

          <div>
            <label htmlFor="journalStartDate" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Journal Start Date
            </label>
            <input
              id="journalStartDate"
              type="date"
              value={form.journalStartDate}
              onChange={handleChange('journalStartDate')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div>
            <label htmlFor="defaultAccountId" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Default Account
            </label>
            <select
              id="defaultAccountId"
              value={form.defaultAccountId}
              onChange={handleChange('defaultAccountId')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">-- No default --</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving ? 'Saving...' : 'Save Risk Settings'}
          </button>
          {message?.type === 'success' && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>
          )}
        </div>
      </form>
    </div>
  );
}
