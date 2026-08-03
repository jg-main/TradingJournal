'use client';

import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppTimezone } from '@/lib/timezone-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Types ──────────────────────────────────────────────────────────────

export interface AddExitTradeData {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  plannedQuantity: number | null;
}

interface AddExitDialogProps {
  trade: AddExitTradeData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

type ExitAction = 'sell' | 'reduce' | 'buy_to_cover';

interface FormState {
  action: ExitAction | '';
  quantity: string;
  price: string;
  executedAt: string;
  fees: string;
  notes: string;
}

interface FieldErrors {
  action?: string;
  quantity?: string;
  price?: string;
  fees?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');
const toLocalDatetime = (d: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`;
};

function getExitActions(direction: 'long' | 'short'): ExitAction[] {
  return direction === 'long' ? ['sell', 'reduce'] : ['buy_to_cover'];
}

const labelClass =
  'mb-1 block text-sm font-medium text-foreground';

const textareaClass =
  'w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 md:text-sm';

// ── Component ──────────────────────────────────────────────────────────

export function AddExitDialog({
  trade,
  open,
  onOpenChange,
  onComplete,
}: AddExitDialogProps) {
  const { nowDatetimeLocal } = useAppTimezone();
  const initiallyExecutedAt = nowDatetimeLocal();
  const [form, setForm] = useState<FormState>({
    action: '',
    quantity: '',
    price: '',
    executedAt: initiallyExecutedAt,
    fees: '0',
    notes: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const exitActions = getExitActions(trade.direction);

  // ── Validation ─────────────────────────────────────────────────────

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};

    if (!form.action) {
      errors.action = 'Action must be selected.';
    }

    const qty = parseFloat(form.quantity);
    if (!form.quantity || isNaN(qty) || qty <= 0) {
      errors.quantity = 'Quantity must be greater than 0.';
    }

    const pr = parseFloat(form.price);
    if (!form.price || isNaN(pr) || pr <= 0) {
      errors.price = 'Price must be greater than 0.';
    }

    const fee = parseFloat(form.fees);
    if (isNaN(fee) || fee < 0) {
      errors.fees = 'Fees must be 0 or greater.';
    }

    return errors;
  }, [form]);

  // ── Submit ─────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFieldErrors({});

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        action: form.action,
        quantity: parseFloat(form.quantity),
        price: parseFloat(form.price),
        fees: parseFloat(form.fees) || 0,
      };

      if (form.executedAt.trim()) {
        body.executedAt = form.executedAt;
      }

      if (form.notes.trim()) {
        body.notes = form.notes;
      }

      const res = await fetch(`/api/trades/${trade.id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        const detailMsg = err.details
          ? typeof err.details === 'string'
            ? err.details
            : typeof err.details === 'object' && err.details.fieldErrors
              ? Object.values(err.details.fieldErrors).flat().join('; ')
              : JSON.stringify(err.details)
          : err.error ?? 'Failed to add exit.';
        setServerError(detailMsg);
        setSubmitting(false);
        return;
      }

      onComplete();
      onOpenChange(false);
      setForm({
        action: '',
        quantity: '',
        price: '',
        executedAt: nowDatetimeLocal(),
        fees: '0',
        notes: '',
      });
      setFieldErrors({});
      setServerError(null);
    } catch {
      setServerError('Failed to add exit. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Field updater ──────────────────────────────────────────────────

  const setField = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (fieldErrors[field as keyof FieldErrors]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  // ── Reset on dialog close ──────────────────────────────────────────

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setForm({
        action: '',
        quantity: '',
        price: '',
        executedAt: nowDatetimeLocal(),
        fees: '0',
        notes: '',
      });
      setFieldErrors({});
      setServerError(null);
    }
    onOpenChange(open);
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Add Exit: {trade.symbol}
          </DialogTitle>
          <DialogDescription>
            Record a {trade.direction === 'long' ? 'sell' : 'cover'}
            {' '}execution for this trade.
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ── Action ────────────────────────────────────────────────── */}
          <div>
            <label htmlFor="action" className={labelClass}>
              Action *
            </label>
            <Select
              value={form.action}
              onValueChange={(value: string) => {
                setForm((prev) => ({ ...prev, action: value as ExitAction }));
                if (fieldErrors.action) {
                  setFieldErrors((prev) => ({ ...prev, action: undefined }));
                }
              }}
            >
              <SelectTrigger id="action" className="w-full">
                <SelectValue placeholder="Select action" />
              </SelectTrigger>
              <SelectContent>
                {exitActions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action === 'sell'
                      ? 'Sell'
                      : action === 'reduce'
                        ? 'Reduce'
                        : 'Buy to Cover'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.action && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.action}</p>
            )}
          </div>

          {/* ── Quantity / Price row ──────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="quantity" className={labelClass}>
                Quantity *
              </label>
              <Input
                id="quantity"
                type="number"
                step="any"
                placeholder="0"
                value={form.quantity}
                onChange={setField('quantity')}
                aria-invalid={!!fieldErrors.quantity || undefined}
              />
              {fieldErrors.quantity && (
                <p className="mt-1 text-xs text-destructive">
                  {fieldErrors.quantity}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="price" className={labelClass}>
                Price *
              </label>
              <Input
                id="price"
                type="number"
                step="any"
                placeholder="0.00"
                value={form.price}
                onChange={setField('price')}
                aria-invalid={!!fieldErrors.price || undefined}
              />
              {fieldErrors.price && (
                <p className="mt-1 text-xs text-destructive">
                  {fieldErrors.price}
                </p>
              )}
            </div>
          </div>

          {/* ── Executed At / Fees row ────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="executedAt" className={labelClass}>
                Executed At
              </label>
              <Input
                id="executedAt"
                type="datetime-local"
                value={form.executedAt}
                onChange={setField('executedAt')}
              />
            </div>
            <div>
              <label htmlFor="fees" className={labelClass}>
                Fees
              </label>
              <Input
                id="fees"
                type="number"
                step="any"
                placeholder="0"
                value={form.fees}
                onChange={setField('fees')}
                aria-invalid={!!fieldErrors.fees || undefined}
              />
              {fieldErrors.fees && (
                <p className="mt-1 text-xs text-destructive">
                  {fieldErrors.fees}
                </p>
              )}
            </div>
          </div>

          {/* ── Notes ─────────────────────────────────────────────────── */}
          <div>
            <label htmlFor="notes" className={labelClass}>
              Notes
            </label>
            <textarea
              id="notes"
              value={form.notes}
              onChange={setField('notes')}
              className={textareaClass}
              rows={3}
              placeholder="Optional notes..."
            />
          </div>

          {/* ── Footer ──────────────────────────────────────────────── */}
          <DialogFooter>
            <div className="flex w-full justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {submitting ? 'Adding Exit...' : 'Add Exit'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
