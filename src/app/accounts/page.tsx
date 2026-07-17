'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function AccountsPage() {
  useEffect(() => { document.title = "Accounts — Trading Journal"; }, []);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [persistedDefaultAccountId, setPersistedDefaultAccountId] = useState<string | null>(null);
  const [defaultAccountDraft, setDefaultAccountDraft] = useState('');
  const [defaultSettingsStatus, setDefaultSettingsStatus] = useState<'ready' | 'unavailable'>('unavailable');
  const [savingDefault, setSavingDefault] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', broker: '', currency: 'USD' });

  const fetchAccounts = async () => {
    try {
      const [accountsResult, settingsResult] = await Promise.allSettled([
        fetch('/api/accounts'),
        fetch('/api/settings'),
      ]);

      if (accountsResult.status === 'rejected' || !accountsResult.value.ok) {
        setAccounts([]);
        setMessage({ type: 'error', text: 'Failed to load accounts.' });
      } else {
        const accountsData: unknown = await accountsResult.value.json();
        if (Array.isArray(accountsData)) {
          setAccounts(accountsData);
        } else {
          setAccounts([]);
          setMessage({ type: 'error', text: 'The server returned invalid account data.' });
        }
      }

      if (settingsResult.status === 'rejected' || !settingsResult.value.ok) {
        setDefaultSettingsStatus('unavailable');
      } else {
        const settingsData: unknown = await settingsResult.value.json();
        if (settingsData && typeof settingsData === 'object') {
          const candidate = settingsData as Record<string, unknown>;
          const value = candidate.defaultAccountId;
          const noSettingsRow = typeof candidate.message === 'string' && value === undefined;

          if (value === null || typeof value === 'string' || noSettingsRow) {
            const defaultAccountId = typeof value === 'string' ? value : null;
            setPersistedDefaultAccountId(defaultAccountId);
            setDefaultAccountDraft(defaultAccountId ?? '');
            setDefaultSettingsStatus('ready');
          } else {
            setDefaultSettingsStatus('unavailable');
          }
        } else {
          setDefaultSettingsStatus('unavailable');
        }
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load accounts.' });
      setDefaultSettingsStatus('unavailable');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAccounts(); }, []);

  const resetForm = () => {
    setForm({ name: '', broker: '', currency: 'USD' });
    setEditingId(null);
    setShowForm(false);
    setMessage(null);
  };

  const openEdit = (account: Account) => {
    setForm({ name: account.name, broker: account.broker ?? '', currency: account.currency });
    setEditingId(account.id);
    setShowForm(true);
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!form.name.trim()) {
      setMessage({ type: 'error', text: 'Account name is required.' });
      return;
    }

    try {
      const url = editingId ? `/api/accounts/${editingId}` : '/api/accounts';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          broker: form.broker.trim() || null,
          currency: form.currency,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      setMessage({ type: 'success', text: editingId ? 'Account updated.' : 'Account created.' });
      resetForm();
      fetchAccounts();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save account.' });
    }
  };

  const handleDefaultAccountSave = async () => {
    setSavingDefault(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAccountId: defaultAccountDraft || null }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const errorData = data && typeof data === 'object'
          ? data as Record<string, unknown>
          : null;
        const details = errorData?.details;
        const text = typeof errorData?.error === 'string'
          ? errorData.error
          : typeof details === 'string'
            ? details
            : 'Failed to save the default account.';
        setMessage({ type: 'error', text });
        return;
      }

      if (!data || typeof data !== 'object') {
        setMessage({ type: 'error', text: 'The server returned an invalid settings response.' });
        return;
      }

      const value = (data as Record<string, unknown>).defaultAccountId;
      if (value !== null && typeof value !== 'string') {
        setMessage({ type: 'error', text: 'The server returned an invalid settings response.' });
        return;
      }

      setPersistedDefaultAccountId(value);
      setDefaultAccountDraft(value ?? '');
      setDefaultSettingsStatus('ready');
      setMessage({ type: 'success', text: 'Default account saved.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save the default account.' });
    } finally {
      setSavingDefault(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Deactivate account "${name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setMessage({ type: 'error', text: 'Failed to deactivate account.' });
        return;
      }
      setMessage({ type: 'success', text: 'Account deactivated.' });
      fetchAccounts();
    } catch {
      setMessage({ type: 'error', text: 'Failed to deactivate account.' });
    }
  };

  if (loading) {
    return (
      <div className="p-8" role="status" aria-live="polite">
        <p className="text-zinc-500">Loading accounts...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Accounts
        </h1>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            + Add Account
          </button>
        )}
      </div>

      {message && (
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <section
        aria-labelledby="default-account-heading"
        className="mb-8 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 id="default-account-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Default account
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              New trades use this account unless you choose another one.
            </p>
            <label htmlFor="default-account" className="mt-4 mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Account used by default
            </label>
            <select
              id="default-account"
              value={defaultAccountDraft}
              onChange={(event) => setDefaultAccountDraft(event.target.value)}
              aria-describedby="default-account-status"
              className="min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">No default account</option>
              {accounts.filter((account) => account.isActive).map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
              {persistedDefaultAccountId &&
                !accounts.some((account) => account.id === persistedDefaultAccountId && account.isActive) && (
                  <option value={persistedDefaultAccountId} disabled>
                    Current default is inactive or unavailable
                  </option>
                )}
            </select>
            <p id="default-account-status" className="mt-2 text-xs text-zinc-500 dark:text-zinc-400" role="status">
              {defaultSettingsStatus === 'unavailable'
                ? 'Saved default unavailable. Choose an account and save to retry.'
                : persistedDefaultAccountId
                  ? `Saved default: ${accounts.find((account) => account.id === persistedDefaultAccountId)?.name ?? 'Unavailable account'}`
                  : 'No default account is saved.'}
              {defaultSettingsStatus === 'ready' && defaultAccountDraft !== (persistedDefaultAccountId ?? '')
                ? ' Selection not saved.'
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDefaultAccountSave}
            disabled={savingDefault}
            className="min-h-10 shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {savingDefault ? 'Saving default...' : 'Save default'}
          </button>
        </div>
      </section>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
            {editingId ? 'Edit Account' : 'New Account'}
          </h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Name *
              </label>
              <input
                id="name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="e.g. Main Brokerage"
              />
            </div>
            <div>
              <label htmlFor="broker" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Broker
              </label>
              <input
                id="broker"
                type="text"
                value={form.broker}
                onChange={(e) => setForm((f) => ({ ...f, broker: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="e.g. Interactive Brokers"
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
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {editingId ? 'Update' : 'Create'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-zinc-600 dark:text-zinc-300">No accounts yet. Add your first brokerage account to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Broker</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Currency</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Status</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {accounts.map((account) => (
                <tr key={account.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={'/accounts/' + account.id}
                      className="text-zinc-900 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-400"
                    >
                      {account.name}
                    </Link>
                    {persistedDefaultAccountId === account.id && (
                      <span className="ml-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        Default
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{account.broker ?? '-'}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{account.currency}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        account.isActive
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {account.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(account)}
                      className="mr-2 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      Edit
                    </button>
                    {account.isActive && (
                      <button
                        onClick={() => handleDelete(account.id, account.name)}
                        className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
