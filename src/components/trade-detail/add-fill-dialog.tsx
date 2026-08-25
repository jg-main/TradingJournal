'use client';

import { useRef, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppTimezone } from '@/lib/timezone-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
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

/**
 * Fill actions the executions API accepts (POST /api/trades/[id]/executions).
 * The server enforces a per-direction subset, so the client select only
 * offers the actions valid for the trade's direction (see FILL_ACTIONS_BY_DIRECTION).
 */
export type FillAction =
  | 'buy'
  | 'add'
  | 'sell'
  | 'reduce'
  | 'sell_short'
  | 'buy_to_cover';

export interface AddFillTradeData {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  plannedQuantity: number | null;
}

interface AddFillDialogProps {
  trade: AddFillTradeData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

interface FormState {
  action: FillAction | '';
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

// ── Direction-filtered action catalog ──────────────────────────────────

/**
 * Valid fill actions per trade direction. MUST mirror the canonical
 * DIRECTION_ACTIONS table in src/lib/trade-execution-engine.ts (the engine
 * rejects any action outside this set for the trade's direction with a typed
 * ActionDirectionError), so the client never offers an option the API would
 * refuse. Add / Reduce are direction-independent workflow management actions
 * (Fix 9): the engine resolves short add → economic sell_short and short
 * reduce → economic buy_to_cover (M002-A5), keeping the journal's management
 * vocabulary while accounting/FIFO apply the concrete economic side.
 */
export const FILL_ACTIONS_BY_DIRECTION: Record<'long' | 'short', FillAction[]> = {
  long: ['buy', 'add', 'sell', 'reduce'],
  short: ['sell_short', 'add', 'buy_to_cover', 'reduce'],
};

export const FILL_ACTION_LABELS: Record<FillAction, string> = {
  buy: 'Buy',
  add: 'Add',
  sell: 'Sell',
  reduce: 'Reduce',
  sell_short: 'Sell Short',
  buy_to_cover: 'Buy to Cover',
};

/** Entry-side actions: actions that establish or increase the position. */
export function isEntryAction(action: FillAction): boolean {
  return action === 'buy' || action === 'add' || action === 'sell_short';
}

/** Exit-side actions: actions that decrease or close the position. */
export function isExitAction(action: FillAction): boolean {
  return !isEntryAction(action);
}

/** Fill actions available for a given trade direction, in API order. */
export function getFillActions(direction: 'long' | 'short'): FillAction[] {
  return FILL_ACTIONS_BY_DIRECTION[direction];
}

// ── Helpers ────────────────────────────────────────────────────────────

const labelClass =
  'mb-1 block text-sm font-medium text-foreground';

const textareaClass =
  'w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 md:text-sm';

// ── Component ──────────────────────────────────────────────────────────

/**
 * AddFillDialog (M019/S04/T01).
 *
 * Creates a new entry or exit execution for a trade via the existing
 * POST /api/trades/[id]/executions contract — the same endpoint AddExitDialog
 * and the planned ExecuteDialog funnel through, so accounting stays true for
 * non-planned trades. The action select is filtered by trade direction
 * (long: buy/add/sell/reduce; short: sell_short/add/buy_to_cover/reduce) so
 * the client only offers actions the API accepts — including the generic
 * Add / Reduce management actions for short trades (Fix 9). On success, onComplete() lets the
 * page refetch executions and the unified history feed.
 */
export function AddFillDialog({
  trade,
  open,
  onOpenChange,
  onComplete,
}: AddFillDialogProps) {
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
  // M002-A13: ONE idempotency key per LOGICAL submission, reused across
  // retries of that submission. A fresh key per attempt would let a network
  // retry create a duplicate fill; the server replays same-key retries.
  const submissionKeyRef = useRef<string | null>(null);

  const fillActions = getFillActions(trade.direction);

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

      // M002-A13 (S03): one idempotency key per logical submission — the
      // engine replays retries with the same key instead of creating a
      // duplicate execution. The key is minted on the FIRST attempt and
      // reused for every retry of that submission (cleared on success/close).
      if (!submissionKeyRef.current) {
        submissionKeyRef.current = crypto.randomUUID();
      }
      body.idempotencyKey = submissionKeyRef.current;

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
          : err.error ?? 'Failed to add fill.';
        setServerError(detailMsg);
        setSubmitting(false);
        return;
      }

      submissionKeyRef.current = null;
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
      setServerError('Failed to add fill. Please check your connection.');
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
      // A new dialog session is a new logical submission: drop the previous
      // submission's idempotency key so the next fill mints its own.
      submissionKeyRef.current = null;
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
            Add Fill: {trade.symbol}
          </DialogTitle>
          <DialogDescription>
            Record a new entry or exit execution for this trade.
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
            <label htmlFor="fill-action" className={labelClass}>
              Action *
            </label>
            <Select
              value={form.action}
              onValueChange={(value: string) => {
                setForm((prev) => ({ ...prev, action: value as FillAction }));
                if (fieldErrors.action) {
                  setFieldErrors((prev) => ({ ...prev, action: undefined }));
                }
              }}
            >
              <SelectTrigger id="fill-action" className="w-full">
                <SelectValue placeholder="Select action" />
              </SelectTrigger>
              <SelectContent>
                {fillActions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {FILL_ACTION_LABELS[action]}
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
              <label htmlFor="fill-quantity" className={labelClass}>
                Quantity *
              </label>
              <Input
                id="fill-quantity"
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
              <label htmlFor="fill-price" className={labelClass}>
                Price *
              </label>
              <Input
                id="fill-price"
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
              <label htmlFor="fill-executedAt" className={labelClass}>
                Executed At
              </label>
              <Input
                id="fill-executedAt"
                type="datetime-local"
                value={form.executedAt}
                onChange={setField('executedAt')}
              />
            </div>
            <div>
              <label htmlFor="fill-fees" className={labelClass}>
                Fees
              </label>
              <Input
                id="fill-fees"
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
            <label htmlFor="fill-notes" className={labelClass}>
              Notes
            </label>
            <textarea
              id="fill-notes"
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
                {submitting ? 'Adding Fill...' : 'Add Fill'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
