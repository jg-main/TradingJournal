'use client';

import { useState, useCallback } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

// ── Types ──────────────────────────────────────────────────────────────

export interface ExecuteTradeData {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: 'long' | 'short';
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedQuantity: number | null;
}

interface ExecuteDialogProps {
  trade: ExecuteTradeData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

interface FormState {
  entryPrice: string;
  stopPrice: string;
  entryQuantity: string;
  exit1Price: string;
  exit1Quantity: string;
  showExit2: boolean;
  exit2Price: string;
  exit2Quantity: string;
  executedAt: string;
  fees: string;
}

function buildInitialState(trade: ExecuteTradeData): FormState {
  return {
    entryPrice: trade.plannedEntry?.toString() ?? '',
    stopPrice: trade.plannedStop?.toString() ?? '',
    entryQuantity: trade.plannedQuantity?.toString() ?? '',
    exit1Price: trade.plannedTarget1?.toString() ?? '',
    exit1Quantity: trade.plannedQuantity?.toString() ?? '',
    showExit2: false,
    exit2Price: '',
    exit2Quantity: '',
    executedAt: new Date().toISOString().slice(0, 16),
    fees: '0',
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

const labelClass =
  'mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300';

// ── Component ──────────────────────────────────────────────────────────

export function ExecuteDialog({
  trade,
  open,
  onOpenChange,
  onComplete,
}: ExecuteDialogProps) {
  const [form, setForm] = useState<FormState>(() => buildInitialState(trade));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Derived state ──────────────────────────────────────────────────

  const exit1QuantityValue = parseFloat(form.exit1Quantity) || 0;
  const exit2QuantityValue = parseFloat(form.exit2Quantity) || 0;
  const entryQuantityValue = parseFloat(form.entryQuantity) || 0;
  const totalExitQty = exit1QuantityValue + exit2QuantityValue;

  // ── Validation ─────────────────────────────────────────────────────

  const validate = useCallback((): string | null => {
    const ep = parseFloat(form.entryPrice);
    const eq = parseFloat(form.entryQuantity);
    if (!ep || ep <= 0) return 'Entry price must be greater than 0.';
    if (!eq || eq <= 0) return 'Entry quantity must be greater than 0.';

    const e1p = form.exit1Price.trim();
    const e1q = form.exit1Quantity.trim();
    const hasExit1 = e1p !== '';
    if (hasExit1) {
      const p = parseFloat(e1p);
      const q = parseFloat(e1q);
      if (!p || p <= 0) return 'Exit 1 price must be greater than 0.';
      if (!q || q <= 0) return 'Exit 1 quantity must be greater than 0.';
    }

    if (form.showExit2) {
      const e2p = parseFloat(form.exit2Price);
      const e2q = parseFloat(form.exit2Quantity);
      if (!e2p || e2p <= 0) return 'Exit 2 price must be greater than 0.';
      if (!e2q || e2q <= 0) return 'Exit 2 quantity must be greater than 0.';
    }

    if (totalExitQty > entryQuantityValue) {
      return 'Total exit quantity exceeds entry quantity.';
    }

    const fee = parseFloat(form.fees);
    if (isNaN(fee) || fee < 0) return 'Fees must be 0 or greater.';

    return null;
  }, [form, totalExitQty, entryQuantityValue]);

  // ── Submit ─────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      // Build the body for the execute endpoint
      const body: Record<string, unknown> = {
        entryPrice: parseFloat(form.entryPrice),
        entryQuantity: parseFloat(form.entryQuantity),
        fees: parseFloat(form.fees) || 0,
      };

      if (form.stopPrice.trim()) {
        body.stopPrice = parseFloat(form.stopPrice);
      }

      if (form.executedAt.trim()) {
        body.executedAt = form.executedAt;
      }

      const e1p = form.exit1Price.trim();
      const e1q = form.exit1Quantity.trim();
      if (e1p) {
        body.exit1Price = parseFloat(e1p);
        // Default exit1 quantity to entry quantity when not explicitly provided
        body.exit1Quantity = e1q ? parseFloat(e1q) : parseFloat(form.entryQuantity);
      }

      if (form.showExit2) {
        const e2p = form.exit2Price.trim();
        const e2q = form.exit2Quantity.trim();
        if (e2p && e2q) {
          body.exit2Price = parseFloat(e2p);
          body.exit2Quantity = parseFloat(e2q);
        }
      }

      const res = await fetch(`/api/trades/${trade.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        const detailMsg = err.details
          ? typeof err.details === 'string'
            ? err.details
            : JSON.stringify(err.details)
          : err.error ?? 'Execution failed.';
        setError(detailMsg);
        setSubmitting(false);
        return;
      }

      onComplete();
      onOpenChange(false);
      // Reset state for next open
      setForm(buildInitialState(trade));
      setError(null);
    } catch {
      setError('Failed to execute trade. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Field updater ──────────────────────────────────────────────────

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  // ── Reset on dialog close ──────────────────────────────────────────

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setForm(buildInitialState(trade));
      setError(null);
    }
    onOpenChange(open);
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Execute {trade.direction === 'long' ? 'Long' : 'Short'}: {trade.symbol}
          </DialogTitle>
          <DialogDescription>
            Record entry and optional exit(s) for trade {trade.tradeCode}.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ── Entry / Stop row ──────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="entryPrice" className={labelClass}>
                Entry Price *
              </label>
              <input
                id="entryPrice"
                type="number"
                step="any"
                value={form.entryPrice}
                onChange={set('entryPrice')}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="stopPrice" className={labelClass}>
                Stop Price
              </label>
              <input
                id="stopPrice"
                type="number"
                step="any"
                value={form.stopPrice}
                onChange={set('stopPrice')}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="entryQuantity" className={labelClass}>
                Size *
              </label>
              <input
                id="entryQuantity"
                type="number"
                step="any"
                value={form.entryQuantity}
                onChange={set('entryQuantity')}
                className={inputClass}
                placeholder="0"
              />
            </div>
          </div>

          {/* ── Fees / Date ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fees" className={labelClass}>
                Fees
              </label>
              <input
                id="fees"
                type="number"
                step="any"
                min="0"
                value={form.fees}
                onChange={set('fees')}
                className={inputClass}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="executedAt" className={labelClass}>
                Executed At
              </label>
              <input
                id="executedAt"
                type="datetime-local"
                value={form.executedAt}
                onChange={set('executedAt')}
                className={inputClass}
              />
            </div>
          </div>

          {/* ── Divider ────────────────────────────────────────────────── */}
          <hr className="border-zinc-200 dark:border-zinc-700" />

          {/* ── Exit 1 ─────────────────────────────────────────────────── */}
          <div>
            <h4 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Exit 1
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="exit1Price" className={labelClass}>
                  Exit 1 Price
                </label>
                <input
                  id="exit1Price"
                  type="number"
                  step="any"
                  value={form.exit1Price}
                  onChange={set('exit1Price')}
                  className={inputClass}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="exit1Quantity" className={labelClass}>
                  Exit 1 Quantity
                </label>
                <input
                  id="exit1Quantity"
                  type="number"
                  step="any"
                  value={form.exit1Quantity}
                  onChange={set('exit1Quantity')}
                  className={inputClass}
                  placeholder="Defaults to entry size"
                />
              </div>
            </div>
          </div>

          {/* ── Exit 2 toggle + fields ─────────────────────────────────── */}
          {form.showExit2 ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Exit 2
                </h4>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      showExit2: false,
                      exit2Price: '',
                      exit2Quantity: '',
                    }))
                  }
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  <X className="size-3" />
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="exit2Price" className={labelClass}>
                    Exit 2 Price *
                  </label>
                  <input
                    id="exit2Price"
                    type="number"
                    step="any"
                    value={form.exit2Price}
                    onChange={set('exit2Price')}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label htmlFor="exit2Quantity" className={labelClass}>
                    Exit 2 Quantity *
                  </label>
                  <input
                    id="exit2Quantity"
                    type="number"
                    step="any"
                    value={form.exit2Quantity}
                    onChange={set('exit2Quantity')}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({ ...prev, showExit2: true }))
              }
              className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <Plus className="size-4" />
              Add Exit 2
            </button>
          )}

          {/* ── Total exit indicator ──────────────────────────────────── */}
          {(form.exit1Price.trim() || form.showExit2) && entryQuantityValue > 0 && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Exit total: {totalExitQty.toFixed(4)} of {entryQuantityValue.toFixed(4)} shares
              {totalExitQty > entryQuantityValue ? (
                <span className="ml-1 text-red-500">(exceeds entry!)</span>
              ) : totalExitQty === entryQuantityValue ? (
                <span className="ml-1 text-emerald-500">(full exit)</span>
              ) : (
                <span className="ml-1 text-amber-500">(partial exit)</span>
              )}
            </p>
          )}

          {/* ── Footer ────────────────────────────────────────────────── */}
          <DialogFooter>
            <div className="flex w-full justify-end gap-2">
              <DialogClose asChild>
                <button
                  type="button"
                  className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  Cancel
                </button>
              </DialogClose>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {submitting && <Loader2 className="size-3.5 animate-spin" />}
                {submitting ? 'Executing...' : 'Execute'}
              </button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
