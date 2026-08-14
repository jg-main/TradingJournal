'use client';

import { useState, useCallback } from 'react';
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
import { getFillActions, FILL_ACTION_LABELS } from './add-fill-dialog';
import type { Execution } from './types';

// ── Types ──────────────────────────────────────────────────────────────

export type TradeStatus = 'planned' | 'open' | 'closed' | 'deleted';

/**
 * Trade subset the correction dialog needs. accountId is nullable: trades
 * without an account have no accounting record to correct, and the dialog
 * renders the "No accounting record" state inline instead of opening the
 * form (M019/S04 must-have #5).
 */
export interface CorrectionTradeData {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  accountId: string | null;
  status: TradeStatus;
}

/** Corrected fill values collected from the form (legacy numeric units). */
export interface CorrectionValues {
  action: string;
  quantity: number;
  price: number;
  fees: number;
  executedAt: string;
  notes: string;
  reason: string;
}

interface CorrectionDialogProps {
  trade: CorrectionTradeData;
  /** The execution being corrected. Null until the page selects one. */
  execution: Execution | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

interface FormState {
  action: string;
  quantity: string;
  price: string;
  fees: string;
  executedAt: string;
  notes: string;
  reason: string;
}

interface FieldErrors {
  action?: string;
  quantity?: string;
  price?: string;
  fees?: string;
}

// ── Pure routing helpers (source-contract tested) ──────────────────────

/**
 * Convert a legacy numeric fill value to the accounting engine's canonical
 * decimal string (e.g. 150 → "150.00"), matching the correctionInputSchema
 * regex `^\d+\.\d{2}$` for quantity/price and non-negative fees.
 */
export function toCanonicalDecimal(value: number): string {
  return value.toFixed(2);
}

/** Planned trades keep the existing direct PUT path (must-have #4). */
export function isPlannedTrade(status: TradeStatus): boolean {
  return status === 'planned';
}

/** Non-planned fills are corrected through the accounting engine. */
export function resolveCorrectionRoute(
  trade: CorrectionTradeData,
): 'planned-put' | 'accounting-correct' {
  return isPlannedTrade(trade.status) ? 'planned-put' : 'accounting-correct';
}

/**
 * Body for the planned-trade direct PUT path — the legacy update schema
 * (numbers, optional executedAt/notes), same shape TradeExecutionsCard sent.
 */
export function buildDirectUpdateBody(values: CorrectionValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    action: values.action,
    quantity: values.quantity,
    price: values.price,
    fees: values.fees,
  };
  if (values.executedAt.trim()) body.executedAt = values.executedAt;
  if (values.notes.trim()) body.notes = values.notes;
  return body;
}

/**
 * Body for the accounting correction endpoint — the canonical
 * correctionInputSchema (symbol + canonical decimal strings + optional
 * reason/postedAt). A fresh idempotency key makes the correction retry-safe.
 */
export function buildCorrectionBody(
  trade: CorrectionTradeData,
  values: CorrectionValues,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    symbol: trade.symbol,
    action: values.action,
    quantity: toCanonicalDecimal(values.quantity),
    price: toCanonicalDecimal(values.price),
    fees: toCanonicalDecimal(values.fees),
    idempotencyKey: crypto.randomUUID(),
  };
  if (values.executedAt.trim()) body.postedAt = new Date(values.executedAt).toISOString();
  if (values.reason.trim()) body.reason = values.reason;
  return body;
}

export interface CorrectionSubmitResult {
  ok: boolean;
  route: 'planned-put' | 'accounting-correct';
  status: number;
  body: unknown;
}

/**
 * Trade-level correction handler (must-haves #3, #4): routes planned trades
 * to the existing direct PUT /api/trades/[id]/executions/[execId] path and
 * non-planned trades to the accounting-true correction endpoint
 * POST /api/trades/[id]/executions/[execId]/correct.
 */
export async function submitExecutionCorrection(params: {
  trade: CorrectionTradeData;
  executionId: string;
  values: CorrectionValues;
}): Promise<CorrectionSubmitResult> {
  const { trade, executionId, values } = params;
  const route = resolveCorrectionRoute(trade);
  const url =
    route === 'planned-put'
      ? `/api/trades/${trade.id}/executions/${executionId}`
      : `/api/trades/${trade.id}/executions/${executionId}/correct`;
  const payload =
    route === 'planned-put'
      ? buildDirectUpdateBody(values)
      : buildCorrectionBody(trade, values);
  const res = await fetch(url, {
    method: route === 'planned-put' ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, route, status: res.status, body: data };
}

// ── Helpers ────────────────────────────────────────────────────────────

const labelClass = 'mb-1 block text-sm font-medium text-foreground';

const textareaClass =
  'w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 md:text-sm';

/**
 * Convert a UTC ISO timestamp to a local datetime string suitable for
 * <input type="datetime-local">, in the given timezone.
 */
function toDatetimeLocal(iso: string | null, timezone: string): string {
  if (!iso) return toLocalDatetimeString(new Date(), timezone);
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return toLocalDatetimeString(new Date(), timezone);
    return toLocalDatetimeString(d, timezone);
  } catch {
    return toLocalDatetimeString(new Date(), timezone);
  }
}

function toLocalDatetimeString(d: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`;
}

function errorMessageFromBody(err: unknown): string {
  const data = err as { error?: string; details?: unknown; message?: string };
  if (!data) return 'Failed to correct execution.';
  const details = data.details;
  if (typeof details === 'string') return details;
  if (details && typeof details === 'object' && (details as { fieldErrors?: Record<string, string[]> }).fieldErrors) {
    return Object.values((details as { fieldErrors: Record<string, string[]> }).fieldErrors)
      .flat()
      .join('; ');
  }
  if (typeof details === 'object' && details !== null) return JSON.stringify(details);
  return data.error ?? data.message ?? 'Failed to correct execution.';
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * CorrectionDialog (M019/S04/T03).
 *
 * Corrects one execution from the Trade Details surface. Non-planned fills
 * route through the canonical accounting correction flow (reversal +
 * replacement + correction_lineage) via POST /api/trades/[id]/executions/
 * [execId]/correct; planned executions keep the existing direct PUT path.
 * Trades without an accountId render the "No accounting record" state inline
 * instead of opening the form (must-have #5). onComplete lets the page
 * refetch executions and the unified history feed (must-have #6).
 */
export function CorrectionDialog({
  trade,
  execution,
  open,
  onOpenChange,
  onComplete,
}: CorrectionDialogProps) {
  const { timezone, nowDatetimeLocal } = useAppTimezone();

  // Build the form state for a given execution (or defaults when none is
  // selected). Used both for the initial state and for re-prefilling when a
  // new execution is selected — see the during-render adjustment below.
  const initialForm = useCallback(
    (exec: Execution | null): FormState => {
      if (!exec) {
        return {
          action: '',
          quantity: '',
          price: '',
          fees: '0',
          executedAt: nowDatetimeLocal(),
          notes: '',
          reason: '',
        };
      }
      return {
        action: exec.action,
        quantity: String(exec.quantity),
        price: String(exec.price),
        fees: exec.fees != null ? String(exec.fees) : '0',
        executedAt: toDatetimeLocal(exec.executedAt, timezone),
        notes: exec.notes ?? '',
        reason: '',
      };
    },
    [nowDatetimeLocal, timezone],
  );

  const [form, setForm] = useState<FormState>(() => initialForm(execution));
  const [prevExecutionId, setPrevExecutionId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const fillActions = getFillActions(trade.direction);
  const noAccountingRecord = !trade.accountId && !isPlannedTrade(trade.status);

  // Adjust the form when a new execution is selected — the React-recommended
  // during-render pattern (react.dev/learn/you-might-not-need-an-effect), so
  // pre-filling never cascades a setState-in-effect render. prevExecutionId
  // is reset on dialog close (handleOpenChange) so re-selecting the same
  // execution re-prefills.
  if (execution && execution.id !== prevExecutionId) {
    setPrevExecutionId(execution.id);
    setForm(initialForm(execution));
    setFieldErrors({});
    setServerError(null);
  }

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

  // ── Reset on dialog close ──────────────────────────────────────────
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setPrevExecutionId(null);
      setForm(initialForm(null));
      setFieldErrors({});
      setServerError(null);
    }
    onOpenChange(open);
  };

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

    if (!execution) return;
    setSubmitting(true);

    try {
      const result = await submitExecutionCorrection({
        trade,
        executionId: execution.id,
        values: {
          action: form.action,
          quantity: parseFloat(form.quantity),
          price: parseFloat(form.price),
          fees: parseFloat(form.fees) || 0,
          executedAt: form.executedAt,
          notes: form.notes,
          reason: form.reason,
        },
      });

      if (!result.ok) {
        setServerError(errorMessageFromBody(result.body));
        setSubmitting(false);
        return;
      }

      onComplete();
      onOpenChange(false);
      setFieldErrors({});
      setServerError(null);
    } catch {
      setServerError('Failed to correct execution. Please check your connection.');
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

  // ── Render ─────────────────────────────────────────────────────────

  // No execution selected — render nothing (the page only opens with one).
  if (open && !execution) return null;

  // Trades without an accountId have no accounting record to correct
  // (must-have #5): render the message inline instead of the form.
  if (noAccountingRecord) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct Execution</DialogTitle>
            <DialogDescription>No accounting record</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This trade has no accounting account, so its executions have no
            accounting record to correct.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Correct Execution: {trade.symbol}
          </DialogTitle>
          <DialogDescription>
            Correct this fill through the accounting correction flow.
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
            <label htmlFor="correction-action" className={labelClass}>
              Action *
            </label>
            <Select
              value={form.action}
              onValueChange={(value: string) => {
                setForm((prev) => ({ ...prev, action: value }));
                if (fieldErrors.action) {
                  setFieldErrors((prev) => ({ ...prev, action: undefined }));
                }
              }}
            >
              <SelectTrigger id="correction-action" className="w-full">
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
              <label htmlFor="correction-quantity" className={labelClass}>
                Quantity *
              </label>
              <Input
                id="correction-quantity"
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
              <label htmlFor="correction-price" className={labelClass}>
                Price *
              </label>
              <Input
                id="correction-price"
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
              <label htmlFor="correction-executedAt" className={labelClass}>
                Executed At
              </label>
              <Input
                id="correction-executedAt"
                type="datetime-local"
                value={form.executedAt}
                onChange={setField('executedAt')}
              />
            </div>
            <div>
              <label htmlFor="correction-fees" className={labelClass}>
                Fees
              </label>
              <Input
                id="correction-fees"
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
            <label htmlFor="correction-notes" className={labelClass}>
              Notes
            </label>
            <textarea
              id="correction-notes"
              value={form.notes}
              onChange={setField('notes')}
              className={textareaClass}
              rows={2}
              placeholder="Optional notes..."
            />
          </div>

          {/* ── Reason ────────────────────────────────────────────────── */}
          <div>
            <label htmlFor="correction-reason" className={labelClass}>
              Correction Reason
            </label>
            <textarea
              id="correction-reason"
              value={form.reason}
              onChange={setField('reason')}
              className={textareaClass}
              rows={2}
              placeholder="Why is this fill being corrected?"
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
                {submitting ? 'Correcting...' : 'Correct Execution'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
