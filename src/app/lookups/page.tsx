'use client';

import { useEffect, useState } from 'react';

const LOOKUP_TYPES = [
  { key: 'setup', label: 'Setups' },
  { key: 'sector', label: 'Sectors' },
  { key: 'market_condition', label: 'Market Conditions' },
  { key: 'mistake_type', label: 'Mistake Types' },
  { key: 'execution_reason', label: 'Execution Reasons' },
  { key: 'phase', label: 'Phases' },
] as const;

interface LookupValue {
  id: string;
  type: string;
  value: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type LookupGroup = Record<string, LookupValue[]>;

export default function LookupsPage() {
  const [groups, setGroups] = useState<LookupGroup>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof LOOKUP_TYPES)[number]['key']>(LOOKUP_TYPES[0].key);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ type: '' as string, value: '', description: '', sortOrder: 0 });
  const formType = activeTab;

  const fetchLookups = async () => {
    try {
      const res = await fetch('/api/lookups');
      const data = await res.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) setGroups(data);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load lookups.' });
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchLookups(); }, []);

  const resetForm = () => {
    setForm({ type: activeTab, value: '', description: '', sortOrder: 0 });
    setEditingId(null);
    setShowForm(false);
    setMessage(null);
  };

  const openEdit = (item: LookupValue) => {
    setForm({ type: item.type, value: item.value, description: item.description ?? '', sortOrder: item.sortOrder ?? 0 });
    setEditingId(item.id);
    setShowForm(true);
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!form.value.trim()) {
      setMessage({ type: 'error', text: 'Value is required.' });
      return;
    }

    try {
      const url = editingId ? `/api/lookups/${editingId}` : '/api/lookups';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: editingId ? form.type : formType,
          value: form.value.trim(),
          description: form.description.trim() || null,
          sortOrder: form.sortOrder,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      setMessage({ type: 'success', text: editingId ? 'Lookup updated.' : 'Lookup created.' });
      resetForm();
      fetchLookups();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save lookup.' });
    }
  };

  const handleDelete = async (id: string, value: string) => {
    if (!confirm(`Deactivate "${value}"? It will be hidden but existing references are preserved.`)) return;

    try {
      const res = await fetch(`/api/lookups/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setMessage({ type: 'error', text: 'Failed to deactivate lookup.' });
        return;
      }
      setMessage({ type: 'success', text: 'Lookup deactivated.' });
      fetchLookups();
    } catch {
      setMessage({ type: 'error', text: 'Failed to deactivate lookup.' });
    }
  };

  if (loading) {
    return <div className="p-8"><p className="text-zinc-500">Loading lookups...</p></div>;
  }

  const activeValues = groups[activeTab]?.filter((v) => v.isActive) ?? [];
  const inactiveValues = groups[activeTab]?.filter((v) => !v.isActive) ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Lookups
        </h1>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            + Add Value
          </button>
        )}
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

      {/* Tab bar */}
      <div className="mb-6 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {LOOKUP_TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); resetForm(); }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
            {editingId ? 'Edit Value' : 'New Value'}
          </h2>
          <div className="space-y-4">
            {!editingId && (
              <div>
                <label htmlFor="formType" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Type
                </label>
                <select
                  id="formType"
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {LOOKUP_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="formValue" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Value *
              </label>
              <input
                id="formValue"
                type="text"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label htmlFor="formDesc" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Description
              </label>
              <input
                id="formDesc"
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label htmlFor="formSort" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Sort Order
              </label>
              <input
                id="formSort"
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
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

      {/* Active values table */}
      {activeValues.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-zinc-600 dark:text-zinc-300">No values for this type yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Value</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Description</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Order</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {activeValues.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{item.value}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{item.description ?? '-'}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{item.sortOrder}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(item)}
                      className="mr-2 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.value)}
                      className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inactive values (collapsed) */}
      {inactiveValues.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            {inactiveValues.length} inactive value{inactiveValues.length !== 1 ? 's' : ''}
          </summary>
          <ul className="mt-2 space-y-1 pl-4">
            {inactiveValues.map((item) => (
              <li key={item.id} className="text-sm text-zinc-500 dark:text-zinc-400">
                {item.value}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
