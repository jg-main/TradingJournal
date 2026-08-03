'use client';

import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Pencil, Trash2, Loader2 } from 'lucide-react';
import { useAppTimezone } from '@/lib/timezone-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { formatAction, formatDate, formatPrice, formatCurrency } from './helpers';
import type { Execution } from './types';

// ── Props ──────────────────────────────────────────────────────────────

interface TradeExecutionsCardProps {
  executions: Execution[];
  tradeId: string;
  actions?: ReactNode;
  onComplete: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────

const LABEL_CLASS =
  'mb-1 block text-sm font-medium text-foreground';

const TEXTAREA_CLASS =
  'w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 md:text-sm';

const ACTION_OPTIONS = [
  { value: 'buy', label: 'Buy' },
  { value: 'add', label: 'Add' },
  { value: 'sell', label: 'Sell' },
  { value: 'reduce', label: 'Reduce' },
  { value: 'sell_short', label: 'Sell Short' },
  { value: 'buy_to_cover', label: 'Buy to Cover' },
] as const;

// ── Types ──────────────────────────────────────────────────────────────

interface EditFormState {
  action: string;
  quantity: string;
  price: string;
  fees: string;
  executedAt: string;
  notes: string;
}

interface FieldErrors {
  action?: string;
  quantity?: string;
  price?: string;
  fees?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Convert a UTC ISO timestamp to a local datetime string suitable
 * for an <input type="datetime-local"> value, in the given timezone.
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

/**
 * Convert a Date object to a local datetime string in the format
 * expected by <input type="datetime-local">: YYYY-MM-DDTHH:MM,
 * using the given IANA timezone.
 */
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

// ── Component ──────────────────────────────────────────────────────────

export default function TradeExecutionsCard({
  executions,
  tradeId,
  actions,
  onComplete,
}: TradeExecutionsCardProps) {
  const { timezone, nowDatetimeLocal, formatDateTime } = useAppTimezone();
  // ── Edit dialog state ──────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExecution, setEditingExecution] = useState<Execution | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    action: '',
    quantity: '',
    price: '',
    fees: '0',
    executedAt: nowDatetimeLocal(),
    notes: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // ── Validation ─────────────────────────────────────────────────────
  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};

    if (!editForm.action) {
      errors.action = 'Action must be selected.';
    }

    const qty = parseFloat(editForm.quantity);
    if (!editForm.quantity || isNaN(qty) || qty <= 0) {
      errors.quantity = 'Quantity must be greater than 0.';
    }

    const pr = parseFloat(editForm.price);
    if (!editForm.price || isNaN(pr) || pr <= 0) {
      errors.price = 'Price must be greater than 0.';
    }

    const fee = parseFloat(editForm.fees);
    if (isNaN(fee) || fee < 0) {
      errors.fees = 'Fees must be 0 or greater.';
    }

    return errors;
  }, [editForm]);

  // ── Open edit dialog ───────────────────────────────────────────────
  const handleEdit = useCallback((exec: Execution) => {
    setEditingExecution(exec);
    setEditForm({
      action: exec.action,
      quantity: String(exec.quantity),
      price: String(exec.price),
      fees: exec.fees != null ? String(exec.fees) : '0',
      executedAt: toDatetimeLocal(exec.executedAt, timezone),
      notes: exec.notes ?? '',
    });
    setFieldErrors({});
    setServerError(null);
    setDialogOpen(true);
  }, []);

  // ── Dialog open/close ──────────────────────────────────────────────
  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingExecution(null);
    }
    setDialogOpen(open);
  }, []);

  // ── Field updater ──────────────────────────────────────────────────
  const setField = useCallback(
    (field: keyof EditFormState) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setEditForm((prev) => ({ ...prev, [field]: e.target.value }));
        if (fieldErrors[field as keyof FieldErrors]) {
          setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
        }
      },
    [fieldErrors],
  );

  // ── Submit edit ────────────────────────────────────────────────────
  const handleSubmitEdit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setServerError(null);
      setFieldErrors({});

      const errors = validate();
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }

      if (!editingExecution) return;

      setSubmitting(true);

      try {
        const body: Record<string, unknown> = {
          action: editForm.action,
          quantity: parseFloat(editForm.quantity),
          price: parseFloat(editForm.price),
          fees: parseFloat(editForm.fees) || 0,
        };

        if (editForm.executedAt.trim()) {
          body.executedAt = editForm.executedAt;
        }

        if (editForm.notes.trim()) {
          body.notes = editForm.notes;
        }

        const res = await fetch(
          `/api/trades/${tradeId}/executions/${editingExecution.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );

        if (!res.ok) {
          const err = await res.json();
          const detailMsg = err.details
            ? typeof err.details === 'string'
              ? err.details
              : typeof err.details === 'object' && err.details.fieldErrors
                ? Object.values(err.details.fieldErrors).flat().join('; ')
                : JSON.stringify(err.details)
            : err.error ?? 'Failed to update execution.';
          setServerError(detailMsg);
          setSubmitting(false);
          return;
        }

        onComplete();
        setDialogOpen(false);
        setEditingExecution(null);
        setFieldErrors({});
        setServerError(null);
      } catch {
        setServerError('Failed to update execution. Please check your connection.');
      } finally {
        setSubmitting(false);
      }
    },
    [editingExecution, editForm, tradeId, onComplete, validate],
  );

  // ── Delete execution ───────────────────────────────────────────────
  const handleDelete = useCallback(
    async (exec: Execution) => {
      if (!window.confirm('Delete this execution? This cannot be undone.')) return;

      try {
        const res = await fetch(
          `/api/trades/${tradeId}/executions/${exec.id}`,
          { method: 'DELETE' },
        );

        if (!res.ok) {
          const err = await res.json();
          console.error('Failed to delete execution:', err);
          return;
        }

        onComplete();
      } catch (error) {
        console.error('Failed to delete execution:', error);
      }
    },
    [tradeId, onComplete],
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Executions</CardTitle>
            {actions && <div>{actions}</div>}
          </div>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No executions recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[70px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((exec) => {
                  const actionColorClass =
                    exec.action === 'buy' || exec.action === 'add'
                      ? 'bg-positive/10 text-positive'
                      : exec.action === 'sell' ||
                          exec.action === 'reduce' ||
                          exec.action === 'sell_short'
                        ? 'bg-negative/10 text-negative'
                        : 'bg-info/10 text-info';

                  return (
                    <TableRow key={exec.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatDateTime(exec.executedAt)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${actionColorClass}`}
                        >
                          {formatAction(exec.action)}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums text-right text-foreground">
                        {exec.quantity.toLocaleString()}
                      </TableCell>
                      <TableCell className="tabular-nums text-right text-foreground">
                        {formatPrice(exec.price)}
                      </TableCell>
                      <TableCell className="tabular-nums text-right text-muted-foreground">
                        {exec.fees != null ? formatCurrency(exec.fees) : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {exec.notes ?? '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => handleEdit(exec)}
                            title="Edit execution"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20"
                            onClick={() => handleDelete(exec)}
                            title="Delete execution"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Edit Execution Dialog ─────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Execution</DialogTitle>
          </DialogHeader>

          {serverError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmitEdit} className="space-y-4">
            {/* ── Action ────────────────────────────────────────────── */}
            <div>
              <label htmlFor="edit-action" className={LABEL_CLASS}>
                Action *
              </label>
              <Select
                value={editForm.action}
                onValueChange={(value: string) => {
                  setEditForm((prev) => ({ ...prev, action: value }));
                  if (fieldErrors.action) {
                    setFieldErrors((prev) => ({ ...prev, action: undefined }));
                  }
                }}
              >
                <SelectTrigger id="edit-action" className="w-full">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.action && (
                <p className="mt-1 text-xs text-destructive">
                  {fieldErrors.action}
                </p>
              )}
            </div>

            {/* ── Quantity / Price row ──────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-quantity" className={LABEL_CLASS}>
                  Quantity *
                </label>
                <Input
                  id="edit-quantity"
                  type="number"
                  step="any"
                  placeholder="0"
                  value={editForm.quantity}
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
                <label htmlFor="edit-price" className={LABEL_CLASS}>
                  Price *
                </label>
                <Input
                  id="edit-price"
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={editForm.price}
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

            {/* ── Executed At / Fees row ────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-executedAt" className={LABEL_CLASS}>
                  Executed At
                </label>
                <Input
                  id="edit-executedAt"
                  type="datetime-local"
                  value={editForm.executedAt}
                  onChange={setField('executedAt')}
                />
              </div>
              <div>
                <label htmlFor="edit-fees" className={LABEL_CLASS}>
                  Fees
                </label>
                <Input
                  id="edit-fees"
                  type="number"
                  step="any"
                  placeholder="0"
                  value={editForm.fees}
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

            {/* ── Notes ─────────────────────────────────────────────── */}
            <div>
              <label htmlFor="edit-notes" className={LABEL_CLASS}>
                Notes
              </label>
              <textarea
                id="edit-notes"
                value={editForm.notes}
                onChange={setField('notes')}
                className={TEXTAREA_CLASS}
                rows={3}
                placeholder="Optional notes..."
              />
            </div>

            {/* ── Footer ──────────────────────────────────────────── */}
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
                  {submitting ? 'Updating Execution...' : 'Update Execution'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
