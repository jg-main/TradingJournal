'use client';

import { useState } from 'react';
import { Pencil, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatPrice } from './helpers';
import { deriveCurrentStop, deriveCurrentTarget } from '@/lib/trade-levels';
import type { Trade, StopAdjustment, TargetAdjustment } from './types';

interface TradeDetailsCardProps {
  plannedValues?: Pick<Trade, 'direction' | 'plannedEntry' | 'plannedStop' | 'plannedQuantity' | 'plannedTarget1'> | null;
  initialEntryPrice?: number | null;
  initialStopPrice?: number | null;
  initialQuantity?: number | null;
  currentQuantity?: number | null;
  actualEntryPrice?: number | null;
  totalEntryQuantity?: number | null;
  totalExitQuantity?: number | null;
  stopAdjustments?: StopAdjustment[];
  targetAdjustments?: TargetAdjustment[];
  tradeStatus?: Trade['status'];
  tradeId?: string;
  onAdjustmentsChanged?: () => Promise<void>;
  onAddFill?: () => void;
}

type EditingLevel = 'stop' | 'target';

/**
 * Current position facts and their management controls.
 *
 * This component deliberately excludes plan and market comparison columns:
 * Avg Entry and Open Size derive from executions, while Stop and Target derive
 * from append-only management adjustments. The historical second target is
 * not surfaced for active management; new adjustments always affect Target.
 */
export default function TradeDetailsCard({
  plannedValues,
  initialEntryPrice,
  initialStopPrice,
  initialQuantity,
  currentQuantity,
  actualEntryPrice,
  totalEntryQuantity,
  totalExitQuantity,
  stopAdjustments = [],
  targetAdjustments = [],
  tradeStatus,
  tradeId,
  onAdjustmentsChanged,
  onAddFill,
}: TradeDetailsCardProps) {
  const [editingLevel, setEditingLevel] = useState<EditingLevel | null>(null);
  const [editForm, setEditForm] = useState({ value: '', reason: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const currentEntry = actualEntryPrice ?? initialEntryPrice ?? null;
  const currentStop = deriveCurrentStop(
    plannedValues?.plannedStop ?? null,
    initialStopPrice ?? null,
    stopAdjustments,
  );
  const currentTarget = deriveCurrentTarget(
    plannedValues?.plannedTarget1 ?? null,
    1,
    targetAdjustments,
  );
  const openSize = currentQuantity ?? initialQuantity ?? null;
  const canEditLevels = tradeStatus === 'open' && !!tradeId;
  const canAddFill = tradeStatus === 'open' && !!onAddFill;

  const startEdit = (level: EditingLevel) => {
    const currentValue = level === 'stop' ? currentStop : currentTarget;
    setEditingLevel(level);
    setEditForm({ value: currentValue != null ? String(currentValue) : '', reason: '' });
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingLevel(null);
    setEditForm({ value: '', reason: '' });
    setMessage(null);
  };

  const handleSubmitEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (!editingLevel || !tradeId) return;

    const value = Number.parseFloat(editForm.value);
    if (!editForm.value || !Number.isFinite(value) || value <= 0) {
      setMessage({ type: 'error', text: 'New level must be a positive number.' });
      return;
    }

    const isStop = editingLevel === 'stop';
    try {
      const response = await fetch(
        isStop
          ? `/api/trades/${tradeId}/stop-adjustments`
          : `/api/trades/${tradeId}/target-adjustments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isStop
              ? { newStop: value, reason: editForm.reason.trim() || null }
              : { targetIndex: 1, newTarget: value, reason: editForm.reason.trim() || null },
          ),
        },
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setMessage({ type: 'error', text: error.error ?? 'Failed to save.' });
        return;
      }

      cancelEdit();
      await onAdjustmentsChanged?.();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save. Check your connection and try again.' });
    }
  };

  const editButton = (level: EditingLevel, label: string) => (
    <button
      type="button"
      onClick={() => startEdit(level)}
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Adjust ${label}`}
      title={`Adjust ${label}`}
    >
      <Pencil className="size-3" />
    </button>
  );

  return (
    <div className="space-y-3">
      {canAddFill && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onAddFill}>
            <PlusCircle className="mr-1.5 size-3.5" />
            Add Fill
          </Button>
        </div>
      )}

      <dl className="divide-y divide-border text-sm">
        <div className="flex items-center justify-between gap-4 py-2">
          <dt className="text-muted-foreground">Side</dt>
          <dd className="font-medium capitalize text-foreground">{plannedValues?.direction ?? '—'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-muted-foreground">Avg Entry</dt>
          <dd className="tabular-nums text-foreground">{formatPrice(currentEntry)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-muted-foreground">Open Size</dt>
          <dd className="text-right tabular-nums text-foreground">
            <div>{openSize != null ? openSize.toLocaleString() : '—'}</div>
            {totalEntryQuantity != null && totalExitQuantity != null && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {totalEntryQuantity.toLocaleString()} entered / {totalExitQuantity.toLocaleString()} exited
              </div>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-2">
          <dt className="text-muted-foreground">Stop</dt>
          <dd className="inline-flex items-center gap-1 tabular-nums text-foreground">
            {formatPrice(currentStop)}
            {canEditLevels && editButton('stop', 'Stop')}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-2">
          <dt className="text-muted-foreground">Target</dt>
          <dd className="inline-flex items-center gap-1 tabular-nums text-foreground">
            {formatPrice(currentTarget)}
            {canEditLevels && editButton('target', 'Target')}
          </dd>
        </div>
      </dl>

      {editingLevel && (
        <form onSubmit={handleSubmitEdit} className="space-y-3 rounded-md border bg-muted p-3" aria-label={`Adjust ${editingLevel === 'stop' ? 'Stop' : 'Target'}`}>
          {message?.type === 'error' && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {message.text}
            </div>
          )}
          <label className="block text-xs font-medium text-muted-foreground">
            New {editingLevel === 'stop' ? 'Stop' : 'Target'}
            <Input
              type="number"
              step="any"
              min="0"
              value={editForm.value}
              onChange={(event) => setEditForm((form) => ({ ...form, value: event.target.value }))}
              autoFocus
              className="mt-1"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Reason <span className="font-normal">(optional)</span>
            <textarea
              value={editForm.reason}
              onChange={(event) => setEditForm((form) => ({ ...form, reason: event.target.value }))}
              rows={2}
              placeholder={`Why is the ${editingLevel} being adjusted?`}
              className="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">Save {editingLevel === 'stop' ? 'Stop' : 'Target'}</Button>
            <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
