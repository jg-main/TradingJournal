'use client';

import { useEffect, useState } from 'react';

interface Settings {
  id: string;
  startingAccountValue: number | null;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  defaultAccountId: string | null;
  currency: string | null;
  journalStartDate: string | null;
}

interface Account {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    startingAccountValue: '',
    maxRiskPerTradePct: '',
    defaultCommission: '',
    defaultAccountId: '',
    currency: 'USD',
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
          startingAccountValue: settingsData.startingAccountValue?.toString() ?? '',
          maxRiskPerTradePct: settingsData.maxRiskPerTradePct?.toString() ?? '',
          defaultCommission: settingsData.defaultCommission?.toString() ?? '',
          defaultAccountId: settingsData.defaultAccountId ?? '',
          currency: settingsData.currency ?? 'USD',
          journalStartDate: settingsData.journalStartDate ?? '',
        });
      }
      if (Array.isArray(accountsData)) {
        setAccounts(accountsData);
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const payload: Record<string, unknown> = {};
    if (form.startingAccountValue) payload.startingAccountValue = parseFloat(form.startingAccountValue);
    if (form.maxRiskPerTradePct) payload.maxRiskPerTradePct = parseFloat(form.maxRiskPerTradePct);
    if (form.defaultCommission) payload.defaultCommission = parseFloat(form.defaultCommission);
    payload.defaultAccountId = form.defaultAccountId || null;
    if (form.currency) payload.currency = form.currency;
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
      setMessage({ type: 'success', text: 'Settings saved successfully.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-zinc-500">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Settings
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
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            General
          </h2>

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
            <label htmlFor="currency" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Currency
            </label>
            <input
              id="currency"
              type="text"
              maxLength={3}
              value={form.currency}
              onChange={handleChange('currency')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              placeholder="USD"
            />
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            Risk & Commission
          </h2>

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
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {message?.type === 'success' && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>
          )}
        </div>
      </form>
    </div>
  );
}
