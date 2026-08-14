'use client';

import { useState } from 'react';
import { Pencil, PlusCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatPrice, formatCurrency } from './helpers';
import { deriveCurrentStop, deriveCurrentTarget } from '@/lib/trade-levels';
import type { Trade, StopAdjustment, TargetAdjustment, MtmData } from './types';

interface TradeDetailsCardProps {
  plannedValues?: Pick<Trade, 'direction' | 'plannedEntry' | 'plannedStop' | 'plannedQuantity' | 'plannedTarget1' | 'plannedTarget2'> | null;
  initialEntryPrice?: number | null;
  initialStopPrice?: number | null;
  initialQuantity?: number | null;
  /** Canonical remaining position quantity, when executions exist. */
  currentQuantity?: number | null;
  actualEntryPrice?: number | null;
  stopAdjustments?: StopAdjustment[];
  targetAdjustments?: TargetAdjustment[];
  mtmData?: MtmData;
  tradeStatus?: Trade['status'];
  /** Open-trade inline editing (M019/S02/T02): trade id for the S01 adjustment APIs. */
  tradeId?: string;
  /** Called after a successful level edit so the page refetches both adjustment chains. */
  onAdjustmentsChanged?: () => Promise<void>;
  /** M019/S04/T02: opens the page-owned AddFillDialog. Only surfaced for open trades. */
  onAddFill?: () => void;
}

type EditingLevel = 'stop' | 'target1' | 'target2';

/**
 * Trade Details card (M019/S02).
 *
 * Shows Plan / Current / Market level columns. The "Current" stop and targets
 * are live values derived from the append-only adjustment chains via
 * trade-levels.ts — never the planned values once the trade is live. Planned
 * values stay in the Plan column as immutable reference points.
 *
 * Open trades get inline edit affordances on Stop / Target 1 / Target 2
 * (S02/T02 must-have #3): the edit form POSTs to the S01 stop-adjustments /
 * target-adjustments APIs and triggers a refetch via onAdjustmentsChanged.
 * Closed / planned / deleted trades stay read-only (must-have #5).
 */
export default function TradeDetailsCard({
  plannedValues,
  initialEntryPrice,
  initialStopPrice,
  initialQuantity,
  currentQuantity,
  actualEntryPrice,
  stopAdjustments = [],
  targetAdjustments = [],
  mtmData,
  tradeStatus,
  tradeId,
  onAdjustmentsChanged,
  onAddFill,
}: TradeDetailsCardProps) {
  const [editingLevel, setEditingLevel] = useState<EditingLevel | null>(null);
  const [editForm, setEditForm] = useState({ value: '', reason: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const planEntry = plannedValues?.plannedEntry;
  const planStop = plannedValues?.plannedStop;
  const planQty = plannedValues?.plannedQuantity;
  const planTarget1 = plannedValues?.plannedTarget1 ?? null;
  const planTarget2 = plannedValues?.plannedTarget2 ?? null;

  // ── Live "Current" values ──
  // Current stop/targets are derived from the server-side adjustment chains:
  // the latest adjustment wins, else the initial level, else the plan.
  const currentEntry = actualEntryPrice ?? initialEntryPrice ?? null;
  const currentStop = deriveCurrentStop(planStop ?? null, initialStopPrice ?? null, stopAdjustments);
  const currentTarget1 = deriveCurrentTarget(planTarget1, 1, targetAdjustments);
  const currentTarget2 = deriveCurrentTarget(planTarget2, 2, targetAdjustments);
  const currentQty = currentQuantity ?? initialQuantity ?? null;

  // ── Market-column metrics ──
  const hasMtm = mtmData?.price != null && tradeStatus === 'open';
  const mtmPrice = hasMtm ? mtmData!.price! : null;
  const mtmMarketValue = hasMtm && currentQty != null ? mtmPrice! * currentQty : null;

  function mtmDistTo(level: number | null | undefined): { dollar: number; pct: number } | null {
    if (mtmPrice == null || level == null || level === 0) return null;
    const dollar = Math.abs(mtmPrice - level);
    const pct = (dollar / level) * 100;
    return { dollar, pct };
  }
  const mtmDistStop = mtmDistTo(currentStop);
  const mtmDistTarget1 = mtmDistTo(currentTarget1);
  const mtmDistTarget2 = mtmDistTo(currentTarget2);

  const hasPlan = !!plannedValues;
  // Edit affordances only on open trades (S02/T02 must-have #3 / #5).
  const canEdit = tradeStatus === 'open' && !!tradeId;
  // M019/S04/T02: fill creation (Add Entry / Add Exit) lives on this card for
  // open trades; closed / planned / deleted trades stay read-only (S02 policy).
  const canAddFill = tradeStatus === 'open' && !!onAddFill;

  const editingLabel =
    editingLevel === 'stop'
      ? 'Stop'
      : editingLevel === 'target1'
        ? 'Target 1'
        : editingLevel === 'target2'
          ? 'Target 2'
          : null;

  const startEdit = (level: EditingLevel) => {
    const current =
      level === 'stop' ? currentStop : level === 'target1' ? currentTarget1 : currentTarget2;
    setEditingLevel(level);
    setEditForm({ value: current != null ? String(current) : '', reason: '' });
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingLevel(null);
    setEditForm({ value: '', reason: '' });
    setMessage(null);
  };

  /** POSTs to the S01 adjustment APIs (stop-adjustments / target-adjustments).
   *  previousStop/previousTarget are server-derived — never client-supplied
   *  (M019 policy). Errors surface inline, same pattern as TradeStopAdjustmentsCard. */
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!editingLevel || !tradeId) return;

    const value = parseFloat(editForm.value);
    if (!editForm.value || !isFinite(value) || value <= 0) {
      setMessage({ type: 'error', text: 'New level must be a positive number.' });
      return;
    }

    try {
      const isStop = editingLevel === 'stop';
      const url = isStop
        ? `/api/trades/${tradeId}/stop-adjustments`
        : `/api/trades/${tradeId}/target-adjustments`;
      const body = isStop
        ? { newStop: value, reason: editForm.reason.trim() || null }
        : {
            targetIndex: editingLevel === 'target1' ? 1 : 2,
            newTarget: value,
            reason: editForm.reason.trim() || null,
          };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Failed to save.'),
        });
        return;
      }

      // Success — close the inline form and let the page refetch both chains
      // so the derived Current values update immediately.
      setEditingLevel(null);
      setEditForm({ value: '', reason: '' });
      await onAdjustmentsChanged?.();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save. Check your connection and try again.' });
    }
  };

  const T = 'text-muted-foreground';
  const V = 'tabular-nums text-foreground';
  const D = 'tabular-nums text-muted-foreground';

  const mtmPositiveClass = 'text-warning';
  const mtmBadge = (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-warning/10 px-1.5 py-0 text-[10px] font-medium text-warning">
      MTM
    </span>
  );

  const editButton = (level: EditingLevel, label: string) => (
    <button
      type="button"
      onClick={() => startEdit(level)}
      className="ml-1.5 inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Adjust ${label}`}
      title={`Adjust ${label}`}
    >
      <Pencil className="size-3" />
    </button>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Trade Details
          </CardTitle>
          {canAddFill && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAddFill?.()}
              aria-label="Add Fill"
            >
              <PlusCircle className="mr-1.5 size-3.5" />
              Add Fill
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-1.5 text-left text-xs font-normal text-muted-foreground"></th>
              {hasPlan && <th className="pb-1.5 text-right text-xs font-normal text-muted-foreground">Plan</th>}
              <th className="pb-1.5 text-right text-xs font-normal text-muted-foreground">Current</th>
              {hasMtm && <th className="pb-1.5 text-right text-xs font-normal text-warning">Market</th>}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className={'py-1.5 ' + T}>Entry</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planEntry)}</td>}
              <td className={'py-1.5 text-right ' + (currentEntry != null ? V : D)}>{currentEntry != null ? formatPrice(currentEntry) : '—'}</td>
              {hasMtm && <td className={'py-1.5 text-right ' + mtmPositiveClass}>{formatPrice(mtmPrice)}{mtmBadge}</td>}
            </tr>
            <tr className="border-b border-border">
              <td className={'py-1.5 ' + T}>Stop</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planStop)}</td>}
              <td className={'py-1.5 text-right ' + (currentStop != null ? V : D)}>
                <span className="inline-flex items-center justify-end gap-1.5">
                  {currentStop != null ? formatPrice(currentStop) : '—'}
                  {canEdit && editButton('stop', 'Stop')}
                </span>
              </td>
              {hasMtm && <td className={'py-1.5 text-right ' + D}>{mtmDistStop != null ? `${formatPrice(mtmDistStop.dollar)} (${mtmDistStop.pct.toFixed(1)}%)` : '—'}</td>}
            </tr>
            <tr className="border-b border-border">
              <td className={'py-1.5 ' + T}>Target 1</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planTarget1)}</td>}
              <td className={'py-1.5 text-right ' + (currentTarget1 != null ? V : D)}>
                <span className="inline-flex items-center justify-end gap-1.5">
                  {currentTarget1 != null ? formatPrice(currentTarget1) : '—'}
                  {canEdit && editButton('target1', 'Target 1')}
                </span>
              </td>
              {hasMtm && <td className={'py-1.5 text-right ' + D}>{mtmDistTarget1 != null ? `${formatPrice(mtmDistTarget1.dollar)} (${mtmDistTarget1.pct.toFixed(1)}%)` : '—'}</td>}
            </tr>
            <tr className="border-b border-border">
              <td className={'py-1.5 ' + T}>Target 2</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planTarget2)}</td>}
              <td className={'py-1.5 text-right ' + (currentTarget2 != null ? V : D)}>
                <span className="inline-flex items-center justify-end gap-1.5">
                  {currentTarget2 != null ? formatPrice(currentTarget2) : '—'}
                  {canEdit && editButton('target2', 'Target 2')}
                </span>
              </td>
              {hasMtm && <td className={'py-1.5 text-right ' + D}>{mtmDistTarget2 != null ? `${formatPrice(mtmDistTarget2.dollar)} (${mtmDistTarget2.pct.toFixed(1)}%)` : '—'}</td>}
            </tr>
            <tr>
              <td className={'py-1.5 ' + T}>Qty</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{planQty ?? '—'}</td>}
              <td className={'py-1.5 text-right ' + V}>{currentQty != null ? currentQty.toLocaleString() : '—'}</td>
              {hasMtm && <td className={'py-1.5 text-right ' + V}>{mtmMarketValue != null ? formatCurrency(mtmMarketValue) : '—'}</td>}
            </tr>
          </tbody>
        </table>

        {/* ── Inline edit form (open trades only, S02/T02) ── */}
        {canEdit && editingLevel && editingLabel && (
          <form onSubmit={handleSubmitEdit} className="mt-4 space-y-3 rounded-md border bg-muted p-4" aria-label={`Edit ${editingLabel}`}>
            {message && (
              <div
                role="alert"
                className={`rounded-md border px-3 py-2 text-xs ${
                  message.type === 'success'
                    ? 'border-positive/30 bg-positive/10 text-positive'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
                }`}
              >
                {message.text}
              </div>
            )}
            <div>
              <label htmlFor="level-new" className="mb-1 block text-xs font-medium text-muted-foreground">
                New {editingLabel} *
              </label>
              <Input
                id="level-new"
                type="number"
                step="any"
                min="0"
                value={editForm.value}
                onChange={(e) => setEditForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="level-reason" className="mb-1 block text-xs font-medium text-muted-foreground">
                Reason
              </label>
              <textarea
                id="level-reason"
                value={editForm.reason}
                onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                placeholder={`Why is the ${editingLabel.toLowerCase()} being adjusted?`}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm">Save {editingLabel}</Button>
              <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
