'use client';

import { useCallback, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HelpTooltip } from '@/components/help-tooltip';

// ── Eligibility ──────────────────────────────────────────────────────────

/**
 * Financial event types that may be corrected from the ledger.
 *
 * Mirrors the service-side `CORRECTABLE_EVENT_TYPES` in
 * `src/lib/accounting/financial-event-correction.ts`. stock_split,
 * trade_execution, adjustment, and transfer are excluded — they carry no
 * independent reversible cash effect. opening_balance is correctable (A4)
 * through the immutable reversal + replacement flow; its replacement must
 * stay a positive canonical amount.
 */
export const CORRECTABLE_FINANCIAL_EVENT_TYPES = [
  'deposit',
  'withdrawal',
  'dividend',
  'interest',
  'fee',
  'tax',
  'manual_adjustment',
  'opening_balance',
] as const;

/** True when an event type is eligible for financial-event correction. */
export function isCorrectableFinancialEventType(eventType: string): boolean {
  return (CORRECTABLE_FINANCIAL_EVENT_TYPES as readonly string[]).includes(eventType);
}

/** Human-readable label for a financial event type. */
export function financialEventTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    deposit: 'Deposit',
    withdrawal: 'Withdrawal',
    dividend: 'Dividend',
    interest: 'Interest',
    fee: 'Fee',
    tax: 'Tax',
    manual_adjustment: 'Manual Adjustment',
    opening_balance: 'Opening Balance',
  };
  return labels[eventType] ?? eventType;
}

// ── Types ────────────────────────────────────────────────────────────────

/** Minimal financial event data needed to populate the correction form. */
export interface FinancialEventBrief {
  id: string;
  eventType: string;
  description: string | null;
  postedAt: string;
  /**
   * Pre-fill amount in canonical decimal form. Signed for
   * manual_adjustment (positive = inflow, negative = outflow); always
   * positive for the other correctable types.
   */
  amount: string;
}

interface CorrectionResult {
  success: boolean;
  correction?: {
    id: string;
    accountId: string;
    originalEventId: string;
    reversalEventId: string;
    replacementEventId: string;
    reason: string;
    correctedAt: string;
  };
  error?: string;
  code?: string;
  details?: string | Record<string, unknown>;
  message?: string;
}

type CorrectionStep = 'form' | 'confirm' | 'submitting' | 'success' | 'error';

// ── Component Props ─────────────────────────────────────────────────────

interface FinancialEventCorrectionDialogProps {
  /** Account ID the financial event belongs to. */
  accountId: string;
  /** Financial event to correct (the original). */
  event: FinancialEventBrief;
  /** Whether the dialog is open. */
  open: boolean;
  /** Callback when dialog open state changes. */
  onOpenChange: (open: boolean) => void;
  /** Called after a successful correction. */
  onCorrectionComplete?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const CANONICAL_DECIMAL_RE = /^-?\d+\.\d{2}$/;

function formatCurrency(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format a signed canonical amount: "-150.00" → "-$150.00". */
function formatSignedCurrency(amount: string): string {
  if (amount.startsWith('-')) {
    return `-$${formatCurrency(amount.slice(1))}`;
  }
  return `$${formatCurrency(amount)}`;
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readableErrorCode(code: string | undefined): string {
  if (!code) return '';
  const map: Record<string, string> = {
    EVENT_ALREADY_CORRECTED: 'This event has already been corrected.',
    EVENT_NOT_CORRECTABLE:
      'This event cannot be corrected — it is not eligible, or it is a reversal or replacement of a prior correction.',
    DUPLICATE_CORRECTION_IDEMPOTENCY_KEY: 'Duplicate correction request detected.',
  };
  return map[code] ?? code;
}

// ── Component ───────────────────────────────────────────────────────────

/**
 * FinancialEventCorrectionDialog — correct a posted financial event.
 *
 * Follows the same reversal-and-replacement flow as the execution
 * correction form, adapted for financial events: the form captures a
 * replacement amount (canonical decimal; signed for manual_adjustment),
 * an optional description, and a required correction reason. On submit it
 * POSTs to /api/accounts/:id/financial-events/:eventId/correct and walks
 * the form → confirm → submitting → success/error steps. The original
 * event is never modified.
 */
export default function FinancialEventCorrectionDialog({
  accountId,
  event,
  open,
  onOpenChange,
  onCorrectionComplete,
}: FinancialEventCorrectionDialogProps) {
  const [step, setStep] = useState<CorrectionStep>('form');

  // Replacement form state (pre-filled from original event)
  const [amount, setAmount] = useState(event.amount);
  const [description, setDescription] = useState(event.description ?? '');
  const [reason, setReason] = useState('');

  // Error / success state
  const [errorData, setErrorData] = useState<{
    error: string;
    code?: string;
    details?: string | Record<string, unknown>;
  } | null>(null);
  const [successResult, setSuccessResult] = useState<CorrectionResult | null>(null);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── Reset form state when dialog opens ─────────────────────────────

  const resetState = useCallback(() => {
    setStep('form');
    setAmount(event.amount);
    setDescription(event.description ?? '');
    setReason('');
    setErrorData(null);
    setSuccessResult(null);
    setFieldErrors({});
  }, [event]);

  // ── Handle dialog close ───────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (step === 'submitting') return; // Prevent closing while submitting
    resetState();
    onOpenChange(false);
  }, [step, resetState, onOpenChange]);

  // ── Validation (mirrors the API contract) ─────────────────────────

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedAmount = amount.trim();

    if (!trimmedAmount) {
      errors.amount = 'Amount is required';
    } else if (!CANONICAL_DECIMAL_RE.test(trimmedAmount)) {
      errors.amount = 'Amount must be a canonical decimal (e.g. 500.00)';
    } else if (trimmedAmount === '0.00' || trimmedAmount === '-0.00') {
      errors.amount = 'Amount must be non-zero';
    } else if (event.eventType !== 'manual_adjustment' && trimmedAmount.startsWith('-')) {
      errors.amount = 'Amount must be positive for this event type';
    }

    if (description.trim().length > 500) {
      errors.description = 'Description must be 500 characters or fewer';
    }

    if (!reason.trim()) {
      errors.reason = 'Correction reason is required';
    } else if (reason.trim().length > 1000) {
      errors.reason = 'Reason must be 1000 characters or fewer';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Proceed to confirmation ───────────────────────────────────────

  const handleReview = () => {
    if (!validate()) return;
    setStep('confirm');
  };

  // ── Submit correction ──────────────────────────────────────────────

  const handleSubmit = async () => {
    setStep('submitting');
    setErrorData(null);

    const body: Record<string, unknown> = {
      amount: amount.trim(),
      reason: reason.trim(),
    };
    if (description.trim()) {
      body.description = description.trim();
    }

    try {
      const res = await fetch(
        `/api/accounts/${accountId}/financial-events/${event.id}/correct`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      const data: CorrectionResult = await res.json().catch(() => ({}));

      if (res.ok) {
        setSuccessResult(data);
        setStep('success');
        // Auto-close after showing success
        setTimeout(() => {
          resetState();
          onOpenChange(false);
          onCorrectionComplete?.();
        }, 2000);
      } else if (res.status === 409 || res.status === 422 || res.status === 400) {
        // Conflict (already corrected / duplicate idempotency), unprocessable, validation error
        setErrorData({
          error: data.error ?? 'Correction rejected',
          code: data.code,
          details: data.details ?? data.message,
        });
        setStep('error');
      } else if (res.status === 404) {
        setErrorData({
          error: 'Account or financial event not found.',
          code: data.code,
        });
        setStep('error');
      } else {
        setErrorData({
          error: data.error ?? 'Failed to correct financial event.',
          code: data.code,
          details: data.details ?? data.message,
        });
        setStep('error');
      }
    } catch (err) {
      setErrorData({
        error: err instanceof Error ? err.message : 'Network error. Please try again.',
      });
      setStep('error');
    }
  };

  // ── Retry from error ──────────────────────────────────────────────

  const handleRetry = () => {
    setStep('form');
    setErrorData(null);
  };

  // ── Render helpers ─────────────────────────────────────────────────

  const fieldError = (field: string): string | undefined => fieldErrors[field];
  const inputClass = (field: string): string =>
    fieldError(field)
      ? 'border-destructive focus:border-destructive focus:ring-destructive/30'
      : '';

  // ── Render: Step indicator ────────────────────────────────────────

  const stepIndicator = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
      <span className={step === 'form' ? 'font-medium text-foreground' : ''}>
        Edit
      </span>
      <ArrowRight className="size-3" />
      <span className={step === 'confirm' ? 'font-medium text-foreground' : ''}>
        Review
      </span>
      <ArrowRight className="size-3" />
      <span className={step === 'success' ? 'font-medium text-positive' : ''}>
        Confirm
      </span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" aria-describedby="financial-correction-description">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Correct Financial Event</DialogTitle>
            {stepIndicator}
          </div>
          <DialogDescription id="financial-correction-description">
            Replace a posted financial event through an auditable reversal-and-replacement flow.
            The original event remains unchanged; a linked reversal and replacement are created.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: Form ──────────────────────────────────────────────── */}
        {step === 'form' && (
          <div className="space-y-4">
            {/* Original event (read-only reference) */}
            <div className="rounded-lg border border-border bg-muted p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Original Event
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Type:</span>
                <span className="font-medium text-foreground">{financialEventTypeLabel(event.eventType)}</span>
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatSignedCurrency(event.amount)}
                </span>
                <span className="text-muted-foreground">Description:</span>
                <span className="font-medium text-foreground">
                  {event.description ?? <span className="text-muted-foreground">—</span>}
                </span>
                <span className="text-muted-foreground">Posted:</span>
                <span className="font-medium text-foreground">{formatDateTime(event.postedAt)}</span>
              </div>
            </div>

            {/* Replacement form */}
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Replacement Values
            </p>

            <div>
              <label
                htmlFor="corr-amount"
                className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground"
              >
                Amount ($)
                <HelpTooltip
                  content={
                    event.eventType === 'manual_adjustment'
                      ? 'Signed amount: positive adds cash, negative removes cash. Must be non-zero.'
                      : 'The corrected amount for this event. Must be a positive dollar amount (e.g. 500.00).'
                  }
                />
              </label>
              <Input
                id="corr-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500.00"
                className={inputClass('amount')}
                autoFocus
                aria-invalid={!!fieldError('amount')}
                aria-describedby={fieldError('amount') ? 'corr-amount-error' : undefined}
              />
              {fieldError('amount') && (
                <p id="corr-amount-error" className="mt-1 text-xs text-destructive" role="alert">
                  {fieldError('amount')}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="corr-description"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="corr-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Corrected deposit amount"
                className={inputClass('description')}
                aria-invalid={!!fieldError('description')}
                aria-describedby={fieldError('description') ? 'corr-description-error' : undefined}
              />
              {fieldError('description') && (
                <p id="corr-description-error" className="mt-1 text-xs text-destructive" role="alert">
                  {fieldError('description')}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="corr-reason"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Reason <span className="font-normal text-destructive">(required)</span>
              </label>
              <Input
                id="corr-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Wrong amount entered"
                className={inputClass('reason')}
                aria-invalid={!!fieldError('reason')}
                aria-describedby={fieldError('reason') ? 'corr-reason-error' : undefined}
              />
              {fieldError('reason') && (
                <p id="corr-reason-error" className="mt-1 text-xs text-destructive" role="alert">
                  {fieldError('reason')}
                </p>
              )}
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-xs text-warning">
                This will reverse the original event and post a replacement. The original remains
                unchanged for audit purposes. The account balance and performance projections will
                be rebuilt automatically.
              </p>
            </div>
          </div>
        )}

        {/* ── Step: Confirm ────────────────────────────────────────────── */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
                <p className="text-sm font-medium text-warning">
                  Confirm Correction
                </p>
              </div>
              <p className="mt-1 text-xs text-warning">
                Please review the changes below. This action creates an auditable correction
                record and cannot be undone for the original event.
              </p>
            </div>

            {/* Comparison table */}
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Field</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Original</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Replacement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground">Amount</td>
                    <td className="px-3 py-2 tabular-nums text-foreground">{formatSignedCurrency(event.amount)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-foreground">
                      {formatSignedCurrency(amount.trim() || '0.00')}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground">Description</td>
                    <td className="px-3 py-2 text-foreground">{event.description ?? '—'}</td>
                    <td className="px-3 py-2 font-semibold text-foreground">
                      {description.trim() || '—'}
                    </td>
                  </tr>
                  {reason.trim() && (
                    <tr>
                      <td className="px-3 py-2 text-muted-foreground">Reason</td>
                      <td className="px-3 py-2 text-muted-foreground">—</td>
                      <td className="px-3 py-2 font-semibold text-foreground">{reason.trim()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1">
                <RotateCcw className="size-3" aria-hidden="true" />
                The reversal mirrors the original (opposite cash direction). The replacement creates
                a new event with the values above. Both are added to the ledger with a linked
                correction lineage record.
              </p>
            </div>
          </div>
        )}

        {/* ── Step: Submitting ─────────────────────────────────────────── */}
        {step === 'submitting' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="mt-4 text-sm font-medium text-foreground">Creating correction...</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reversing original and posting replacement.
            </p>
          </div>
        )}

        {/* ── Step: Success ────────────────────────────────────────────── */}
        {step === 'success' && successResult && (
          <div className="space-y-4">
            <div className="flex flex-col items-center py-4">
              <CheckCircle2 className="size-12 text-positive" />
              <p className="mt-3 text-sm font-medium text-foreground">Correction Posted</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The replacement event has been posted. Closing...
              </p>
            </div>

            {successResult.correction && (
              <div className="rounded-lg border border-positive/30 bg-positive/10 p-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-positive">Correction ID:</span>
                  <span className="font-mono text-positive">
                    {successResult.correction.id.slice(0, 12)}...
                  </span>
                  <span className="text-positive">Reversal:</span>
                  <span className="font-mono text-positive">
                    {successResult.correction.reversalEventId.slice(0, 12)}...
                  </span>
                  <span className="text-positive">Replacement:</span>
                  <span className="font-mono text-positive">
                    {successResult.correction.replacementEventId.slice(0, 12)}...
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step: Error ──────────────────────────────────────────────── */}
        {step === 'error' && errorData && (
          <div className="space-y-4">
            <div className="flex flex-col items-center py-4">
              <XCircle className="size-12 text-destructive" />
              <p className="mt-3 text-sm font-medium text-destructive">Correction Failed</p>
            </div>

            <div
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm text-destructive">{errorData.error}</p>

              {/* Show readable error code without leaking internals */}
              {errorData.code && (
                <p className="mt-1 text-xs text-destructive">
                  {readableErrorCode(errorData.code)}
                </p>
              )}

              {/* Show actionable detail string without leaking secrets */}
              {errorData.details && typeof errorData.details === 'string' && !errorData.details.includes('api') && !errorData.details.includes('key') && !errorData.details.includes('secret') && (
                <p className="mt-1 text-xs text-destructive">
                  {errorData.details}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Footer Actions ──────────────────────────────────────────── */}
        <DialogFooter>
          {/* Form step: Review button */}
          {step === 'form' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleReview}>
                Review Correction
              </Button>
            </>
          )}

          {/* Confirm step: Submit + Back */}
          {step === 'confirm' && (
            <>
              <Button variant="outline" onClick={() => setStep('form')}>
                Back
              </Button>
              <Button onClick={handleSubmit}>
                Confirm Correction
              </Button>
            </>
          )}

          {/* Error step: Dismiss or Try Again */}
          {step === 'error' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Dismiss
              </Button>
              <Button onClick={handleRetry}>
                Try Again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
