'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Plus } from 'lucide-react';
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
import { SettingsManagementPage } from '@/components/settings/settings-management-page';

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

  const fetchMistakeTypes = useCallback(async (options?: { clearMessage?: boolean }) => {
    try {
      setLoading(true);
      // Mutation-driven refreshes pass { clearMessage: false } so a
      // just-reported success message survives the follow-up list GET;
      // initial/manual loads keep clearing stale messages.
      if (options?.clearMessage !== false) {
        setMessage(null);
      }
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
      await fetchMistakeTypes({ clearMessage: false });
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
      await fetchMistakeTypes({ clearMessage: false });
    } catch {
      setMessage({ type: 'error', text: 'Network error. Failed to delete mistake type.' });
    }
  };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <SettingsManagementPage
      title="Mistake Types"
      description="Manage mistake categories for trade reviews."
      action={
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
                  <label htmlFor="value" className="mb-1 block text-sm font-medium text-foreground">
                    Value *
                  </label>
                  <input
                    id="value"
                    type="text"
                    required
                    value={form.value}
                    onChange={handleChange('value')}
                    className={`w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 ${
                      formErrors.value
                        ? 'border-destructive focus:border-destructive focus:ring-destructive/30'
                        : 'border-input focus:border-ring focus:ring-ring'
                    }`}
                    placeholder="e.g. fomo_entry"
                  />
                  {formErrors.value && (
                    <p className="mt-1 text-xs text-destructive">{formErrors.value}</p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="description" className="mb-1 block text-sm font-medium text-foreground">
                    Description *
                  </label>
                  <textarea
                    id="description"
                    rows={3}
                    required
                    value={form.description}
                    onChange={handleChange('description')}
                    className={`w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 ${
                      formErrors.description
                        ? 'border-destructive focus:border-destructive focus:ring-destructive/30'
                        : 'border-input focus:border-ring focus:ring-ring'
                    }`}
                    placeholder="Describe this mistake type and when to use it"
                  />
                  {formErrors.description && (
                    <p className="mt-1 text-xs text-destructive">{formErrors.description}</p>
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
        }
      >

      {/* Status message */}
      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
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
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading mistake types...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && mistakeTypes.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No mistake types defined yet. Click &ldquo;Add Mistake Type&rdquo; to create one.
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && mistakeTypes.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Value
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Description
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {mistakeTypes.map((mt) => (
                <tr key={mt.id} className="group hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {mt.value}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
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
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
    </SettingsManagementPage>
  );
}
