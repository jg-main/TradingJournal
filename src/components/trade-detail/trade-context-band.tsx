'use client';

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ContextField = 'thesis' | 'invalidationCondition' | 'preTradePlan';

interface TradeContextBandProps {
  tradeId?: string;
  thesis?: string | null;
  invalidationCondition?: string | null;
  preTradePlan?: string | null;
  onTradeChanged?: () => Promise<void>;
  /**
   * M002-A4: true once the trade has any accepted economic execution history.
   * The narrative pre-trade context is then historical evidence — rendered
   * read-only with no edit affordance (the API rejects these fields).
   */
  preTradeFrozen?: boolean;
}

const fields: Array<{ key: ContextField; label: string; placeholder: string }> = [
  { key: 'thesis', label: 'Thesis', placeholder: 'Why is this trade compelling?' },
  { key: 'invalidationCondition', label: 'Invalidation', placeholder: 'What proves the thesis wrong?' },
  { key: 'preTradePlan', label: 'Pre-Trade Plan', placeholder: 'How will this trade be entered and managed?' },
];

/**
 * The narrative record lives in Context and is edited in place, one field at
 * a time. This keeps management information visible while a trader corrects
 * the relevant note instead of reopening a broad trade-edit dialog.
 */
export default function TradeContextBand({
  tradeId,
  thesis,
  invalidationCondition,
  preTradePlan,
  onTradeChanged,
  preTradeFrozen = false,
}: TradeContextBandProps) {
  const values: Record<ContextField, string> = {
    thesis: thesis ?? '',
    invalidationCondition: invalidationCondition ?? '',
    preTradePlan: preTradePlan ?? '',
  };
  const [editingField, setEditingField] = useState<ContextField | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // M002-A4: executed trades render the narrative pre-trade context read-only.
  const canEdit = Boolean(tradeId && onTradeChanged && !preTradeFrozen);

  const startEdit = (field: ContextField) => {
    setEditingField(field);
    setDraft(values[field]);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setDraft('');
    setError(null);
  };

  const saveField = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingField || !tradeId || !onTradeChanged) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/trades/${tradeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [editingField]: draft.trim() || null }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'Failed to save this field.');
        return;
      }
      cancelEdit();
      await onTradeChanged();
    } catch {
      setError('Failed to save this field. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const visibleFields = canEdit ? fields : fields.filter((field) => values[field.key]);
  if (visibleFields.length === 0) return null;

  return (
    <div className="space-y-3">
      {visibleFields.map((field) => {
        const isEditing = editingField === field.key;
        const value = values[field.key];
        return (
          <section key={field.key} className="min-w-0">
            <div className="mb-1 flex items-center gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{field.label}</h3>
              {canEdit && !isEditing && (
                <button
                  type="button"
                  onClick={() => startEdit(field.key)}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${value ? 'Edit' : 'Add'} ${field.label}`}
                >
                  {value ? <Pencil className="size-3" /> : <Plus className="size-3" />}
                </button>
              )}
            </div>

            {isEditing ? (
              <form onSubmit={saveField} className="space-y-2">
                {error && (
                  <p role="alert" className="text-xs text-destructive">{error}</p>
                )}
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  placeholder={field.placeholder}
                  autoFocus
                  className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : value ? (
              <p className="text-sm leading-relaxed text-foreground">{value}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No {field.label.toLowerCase()} recorded.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
