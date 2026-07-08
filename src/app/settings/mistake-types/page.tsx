'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Loader2, Plus } from 'lucide-react';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// ── Types ───────────────────────────────────────────────────────────────

interface MistakeType {
  id: string;
  type: string;
  value: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Zod Schema ──────────────────────────────────────────────────────────

const mistakeTypeSchema = z.object({
  value: z.string().min(1, 'Value is required').max(200, 'Value must be 200 characters or less'),
  description: z.string().min(1, 'Description is required').max(500, 'Description must be 500 characters or less'),
});

// ── Form State ──────────────────────────────────────────────────────────

const emptyForm = { value: '', description: '' };

type FormErrors = Partial<Record<keyof typeof emptyForm, string>>;

// ── Page ────────────────────────────────────────────────────────────────

export default function MistakeTypesPage() {
  const router = useRouter();

  const [mistakeTypes, setMistakeTypes] = useState<MistakeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // ── Fetch ───────────────────────────────────────────────────────────

  const fetchMistakeTypes = useCallback(async () => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await fetch('/api/lookups?type=mistake_type');
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error((err && err.error) || `Failed to load mistake types (HTTP ${res.status})`);
      }
      const data = await res.json();
      setMistakeTypes(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load mistake types.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMistakeTypes();
  }, [fetchMistakeTypes]);

  // ── Form helpers ─────────────────────────────────────────────────────

  const resetForm = () => {
    setForm({ ...emptyForm });
    setFormErrors({});
    setEditingId(null);
  };

  const openEdit = (mt: MistakeType) => {
    setForm({ value: mt.value, description: mt.description ?? '' });
    setFormErrors({});
    setEditingId(mt.id);
    setDialogOpen(true);
  };

  const handleChange = (field: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    // Clear field error on change
    if (formErrors[field]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // ── Validate ─────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const result = mistakeTypeSchema.safeParse(form);
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors;
      setFormErrors({
        value: flat.value?.[0],
        description: flat.description?.[0],
      });
      return false;
    }
    setFormErrors({});
    return true;
  };

  // ── Save (Create / Update) ───────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    setMessage(null);

    try {
      const url = editingId
        ? `/api/lookups/${editingId}`
        : '/api/lookups';
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId
        ? { value: form.value, description: form.description }
        : { type: 'mistake_type', value: form.value, description: form.description, sortOrder: 0 };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setMessage({
          type: 'error',
          text: err?.details ? (typeof err.details === 'string' ? err.details : JSON.stringify(err.details)) : (err?.error || 'Failed to save mistake type.'),
        });
        return;
      }

      setMessage({
        type: 'success',
        text: editingId ? 'Mistake type updated.' : 'Mistake type created.',
      });
      setDialogOpen(false);
      resetForm();
      await fetchMistakeTypes();
      router.refresh();
    } catch {
      setMessage({ type: 'error', text: 'Network error. Failed to save mistake type.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete (soft delete) ─────────────────────────────────────────────

  const handleDelete = async (mt: MistakeType) => {
    if (!confirm(`Deactivate mistake type "${mt.value}"? It will be hidden from trade forms but existing records are preserved.`)) {
      return;
    }

    setMessage(null);
    try {
      const res = await fetch(`/api/lookups/${mt.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setMessage({ type: 'error', text: err?.error || 'Failed to delete mistake type.' });
        return;
      }
      setMessage({ type: 'success', text: `"${mt.value}" deactivated.` });
      await fetchMistakeTypes();
    } catch {
      setMessage({ type: 'error', text: 'Network error. Failed to delete mistake type.' });
    }
  };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/settings"
          className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Mistake Types
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Manage mistake categories for trade reviews.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
                <Plus className="mr-1.5 size-4" />
                Add Mistake Type
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={handleSave}>
                <DialogHeader>
                  <DialogTitle>{editingId ? 'Edit Mistake Type' : 'Add Mistake Type'}</DialogTitle>
                </DialogHeader>

                <div className="mt-4 space-y-4">
                  {/* Value */}
                  <div>
                    <label htmlFor="value" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Value *
                    </label>
                    <input
                      id="value"
                      type="text"
                      required
                      value={form.value}
                      onChange={handleChange('value')}
                      className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 ${
                        formErrors.value
                          ? 'border-red-400 focus:border-red-500 focus:ring-red-300 dark:border-red-600 dark:focus:border-red-500 dark:focus:ring-red-800'
                          : 'border-zinc-300 focus:border-zinc-500 focus:ring-zinc-500 dark:border-zinc-700'
                      }`}
                      placeholder="e.g. fomo_entry"
                    />
                    {formErrors.value && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{formErrors.value}</p>
                    )}
                  </div>

                  {/* Description */}
                  <div>
                    <label htmlFor="description" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Description *
                    </label>
                    <textarea
                      id="description"
                      rows={3}
                      required
                      value={form.description}
                      onChange={handleChange('description')}
                      className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 ${
                        formErrors.description
                          ? 'border-red-400 focus:border-red-500 focus:ring-red-300 dark:border-red-600 dark:focus:border-red-500 dark:focus:ring-red-800'
                          : 'border-zinc-300 focus:border-zinc-500 focus:ring-zinc-500 dark:border-zinc-700'
                      }`}
                      placeholder="Describe this mistake type and when to use it"
                    />
                    {formErrors.description && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{formErrors.description}</p>
                    )}
                  </div>
                </div>

                <DialogFooter showCloseButton className="mt-6">
                  <Button type="submit" disabled={saving || !form.value.trim() || !form.description.trim()}>
                    {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'error' && <AlertTriangle className="size-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="size-8 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading mistake types...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && mistakeTypes.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            No mistake types defined yet. Click &ldquo;Add Mistake Type&rdquo; to create one.
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && mistakeTypes.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Value
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Description
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
              {mistakeTypes.map((mt) => (
                <tr key={mt.id} className="group hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                    {mt.value}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    {mt.description}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(mt)}>
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                        onClick={() => handleDelete(mt)}
                      >
                        Delete
                      </Button>
                    </div>
                    {/* Fallback for touch devices that don't support hover */}
                    <div className="flex items-center justify-end gap-2 md:hidden">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(mt)}>
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                        onClick={() => handleDelete(mt)}
                      >
                        Delete
                      </Button>
                    </div>
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
