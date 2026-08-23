'use client';

import { useCallback, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Minus,
  Receipt,
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
import { extractApiErrorMessage } from '@/lib/error-utils';
import { cn } from '@/lib/utils';
import { isSupportedAccountCurrency, UNSUPPORTED_CURRENCY_GUIDANCE } from '@/lib/accounting/currency-contract';

// ── Constants ────────────────────────────────────────────────────────────

/**
 * How long the success confirmation stays visible before the caller-refresh
 * handoff. Short enough to feel snappy, long enough to be perceivable.
 */
export const POST_SUCCESS_DELAY_MS = 450;

/**
 * The 7 R014-curated cash-flow event types postable from the composer.
 *
 * Deliberately excludes `opening_balance` (initialization-only), `transfer`
 * and `stock_split` (not in the curated set). The API accepts more types;
 * the composer only offers these.
 */
export const EVENT_TYPE_OPTIONS = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'dividend', label: 'Dividend' },
  { value: 'interest', label: 'Interest' },
  { value: 'fee', label: 'Fee' },
  { value: 'tax', label: 'Tax' },
  { value: 'manual_adjustment', label: 'Manual Adjustment' },
] as const;

export type ComposerEventType = (typeof EVENT_TYPE_OPTIONS)[number]['value'];

/** Positive canonical decimal: "100", "100.5", "100.50". */
const POSITIVE_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
/** Signed canonical decimal for manual_adjustment: "100", "-100.50". */
const SIGNED_AMOUNT_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/** Event types whose cash effect increases the account balance. */
const CASH_INCREASING_TYPES: ReadonlySet<ComposerEventType> = new Set([
  'deposit',
  'dividend',
  'interest',
]);

/** Human-readable label for an event type value. */
export function eventTypeLabel(eventType: ComposerEventType): string {
  return EVENT_TYPE_OPTIONS.find((o) => o.value === eventType)?.label ?? eventType;
}

// ── Types ────────────────────────────────────────────────────────────────

interface FinancialTransactionComposerProps {
  /** Account the event is posted to. */
  accountId: string;
  /** Base currency, shown in labels and the effect preview. */
  currency: string;
  /** Whether the dialog is open. */
  open: boolean;
  /** Callback when dialog open state changes. */
  onOpenChange: (open: boolean) => void;
  /**
   * Called after a successful post. The caller owns refreshing shared
   * account state (AccountProvider.refresh), the overview workspace, and
   * the header badge — the same handoff path used by other event flows.
   */
  onPosted?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Date as a local datetime-local input value (YYYY-MM-DDTHH:mm).
 * Datetime-local values are interpreted in local time, so building the
 * value from local components avoids the UTC offset mis-display you get
 * from `new Date().toISOString().slice(0, 16)`.
 */
function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format a numeric string as a currency display value. */
function formatCurrency(v: string, currency: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Compute the economic effect (direction + display amount) for the current
 * event type and signed amount. Mirrors the server-side `computeEffect`
 * semantics: deposit/dividend/interest increase cash, withdrawal/fee/tax
 * decrease it, and manual_adjustment follows the sign of the amount.
 */
function effectFor(
  eventType: ComposerEventType,
  amount: string,
  currency: string,
): { direction: 'increase' | 'decrease' | null; display: string } {
  const trimmed = amount.trim();
  if (!trimmed) return { direction: null, display: '—' };

  if (eventType === 'manual_adjustment') {
    if (!SIGNED_AMOUNT_PATTERN.test(trimmed) || parseFloat(trimmed) === 0) {
      return { direction: null, display: '—' };
    }
    const positive = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
    return {
      direction: trimmed.startsWith('-') ? 'decrease' : 'increase',
      display: formatCurrency(positive, currency),
    };
  }

  if (!POSITIVE_AMOUNT_PATTERN.test(trimmed) || parseFloat(trimmed) <= 0) {
    return { direction: null, display: '—' };
  }
  return {
    direction: CASH_INCREASING_TYPES.has(eventType) ? 'increase' : 'decrease',
    display: formatCurrency(trimmed, currency),
  };
}

/** Human-readable message from an API error body, with a caller fallback. */
function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    return extractApiErrorMessage(data as Record<string, unknown>);
  }
  return fallback;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * Financial Transaction Composer (S03/T01).
 *
 * A dialog that posts a curated cash-flow financial event
 * (deposit, withdrawal, dividend, interest, fee, tax, manual_adjustment)
 * through the canonical POST /api/accounts/:id/financial-events surface.
 *
 * - Event-type selector offers exactly the 7 R014-curated types.
 * - Each type renders the shared amount/date/description fields plus its
 *   type-specific extras (perShareAmount/shares for dividend, rate for
 *   interest, feeType for fee, taxType for tax, signed amount + reason for
 *   manual_adjustment).
 * - An economic-effect preview shows cash direction and amount live.
 * - Client-side validation rejects empty, zero, negative (except
 *   manual_adjustment) and >2-decimal amounts before any API round-trip.
 * - On success a perceivable confirmation renders, then `onPosted` fires so
 *   the caller refreshes AccountProvider + overview state.
 * - API errors (400 field errors, 409/500 strings, network fallback) surface
 *   in a role=alert banner with a retry path that keeps the entered values.
 */
export function FinancialTransactionComposer({
  accountId,
  currency,
  open,
  onOpenChange,
  onPosted,
}: FinancialTransactionComposerProps) {
  const currencySupported = isSupportedAccountCurrency(currency);
  const [eventType, setEventType] = useState<ComposerEventType>('deposit');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [postedAt, setPostedAt] = useState(() => toLocalDateTimeInput(new Date()));
  // Type-specific extras
  const [perShareAmount, setPerShareAmount] = useState('');
  const [shares, setShares] = useState('');
  const [rate, setRate] = useState('');
  const [feeType, setFeeType] = useState('');
  const [taxType, setTaxType] = useState('');
  const [reason, setReason] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // ── Reset form state when the dialog opens ──────────────────────────

  const resetState = useCallback(() => {
    setEventType('deposit');
    setAmount('');
    setDescription('');
    setPostedAt(toLocalDateTimeInput(new Date()));
    setPerShareAmount('');
    setShares('');
    setRate('');
    setFeeType('');
    setTaxType('');
    setReason('');
    setFieldErrors({});
    setError(null);
    setSubmitting(false);
    setSuccess(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return; // Prevent closing while submitting
    resetState();
    onOpenChange(false);
  }, [submitting, resetState, onOpenChange]);

  // ── Event type switch: clear stale errors and the error banner ──────

  const handleEventTypeChange = (value: string) => {
    setEventType(value as ComposerEventType);
    setFieldErrors({});
    setError(null);
  };

  // ── Client-side validation ──────────────────────────────────────────

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedAmount = amount.trim();

    if (!trimmedAmount) {
      errors.amount = 'Enter an amount.';
    } else if (eventType === 'manual_adjustment') {
      if (!SIGNED_AMOUNT_PATTERN.test(trimmedAmount)) {
        errors.amount = 'Enter an amount with up to 2 decimal places (negative allowed).';
      } else if (parseFloat(trimmedAmount) === 0) {
        errors.amount = 'Enter a non-zero adjustment amount.';
      }
    } else if (
      !POSITIVE_AMOUNT_PATTERN.test(trimmedAmount) ||
      parseFloat(trimmedAmount) <= 0
    ) {
      errors.amount = 'Enter a positive amount with up to 2 decimal places.';
    }

    // Dividend extras (optional, but validated when present)
    if (eventType === 'dividend') {
      const trimmedPerShare = perShareAmount.trim();
      if (
        trimmedPerShare &&
        (!POSITIVE_AMOUNT_PATTERN.test(trimmedPerShare) || parseFloat(trimmedPerShare) <= 0)
      ) {
        errors.perShareAmount = 'Per-share amount must be positive with up to 2 decimal places.';
      }
      const trimmedShares = shares.trim();
      if (trimmedShares) {
        const n = Number(trimmedShares);
        if (!Number.isInteger(n) || n <= 0) {
          errors.shares = 'Shares must be a positive whole number.';
        }
      }
    }

    // Interest rate (optional, positive decimal when present)
    if (eventType === 'interest' && rate.trim()) {
      const n = Number(rate.trim());
      if (isNaN(n) || n <= 0) {
        errors.rate = 'Rate must be a positive number.';
      }
    }

    // Manual adjustment requires a reason for auditability
    if (eventType === 'manual_adjustment' && !reason.trim()) {
      errors.reason = 'Enter a reason for the adjustment.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Submit ──────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // USD-only contract: never submit a transaction for an unsupported
    // currency account. The domain/API guard is authoritative regardless;
    // this keeps the workflow blocked before the user completes the form.
    if (!currencySupported) {
      setError(
        `Unsupported account currency "${currency}". ${UNSUPPORTED_CURRENCY_GUIDANCE}`,
      );
      return;
    }

    if (!validate()) return;

    setSubmitting(true);

    const body: Record<string, unknown> = {
      eventType,
      amount: parseFloat(amount.trim()).toFixed(2),
    };

    const trimmedDescription = description.trim();
    if (trimmedDescription) body.description = trimmedDescription;
    // Date is optional: empty field omits postedAt so the server timestamps.
    if (postedAt) body.postedAt = new Date(postedAt).toISOString();

    if (eventType === 'dividend') {
      const trimmedPerShare = perShareAmount.trim();
      if (trimmedPerShare) body.perShareAmount = parseFloat(trimmedPerShare).toFixed(2);
      const trimmedShares = shares.trim();
      if (trimmedShares) body.shares = Number(trimmedShares);
    } else if (eventType === 'interest') {
      const trimmedRate = rate.trim();
      if (trimmedRate) body.rate = trimmedRate;
    } else if (eventType === 'fee') {
      const trimmedFeeType = feeType.trim();
      if (trimmedFeeType) body.feeType = trimmedFeeType;
    } else if (eventType === 'tax') {
      const trimmedTaxType = taxType.trim();
      if (trimmedTaxType) body.taxType = trimmedTaxType;
    } else if (eventType === 'manual_adjustment') {
      body.reason = reason.trim();
    }

    try {
      const res = await fetch(`/api/accounts/${accountId}/financial-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError(apiErrorMessage(data, 'Failed to post the transaction. Please try again.'));
        return;
      }

      setSuccess(true);
      window.setTimeout(() => {
        resetState();
        onOpenChange(false);
        onPosted?.();
      }, POST_SUCCESS_DELAY_MS);
    } catch {
      setError('Could not post the transaction. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────

  const fieldError = (field: string): string | undefined => fieldErrors[field];
  const inputClass = (field: string): string =>
    fieldError(field)
      ? 'border-destructive focus:border-destructive focus:ring-destructive/30'
      : '';

  const preview = effectFor(eventType, amount, currency);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-lg"
        aria-describedby="financial-transaction-composer-description"
      >
        <DialogHeader>
          <DialogTitle>Add Transaction</DialogTitle>
          <DialogDescription id="financial-transaction-composer-description">
            Post a cash-flow event to the account ledger. Each event creates a balanced
            double-entry posting and updates account cash.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4">
            {/* Event type selector */}
            <div>
              <label
                htmlFor="ftc-event-type"
                className="mb-1.5 block text-xs font-medium text-foreground"
              >
                Event Type
              </label>
              <select
                id="ftc-event-type"
                value={eventType}
                onChange={(e) => handleEventTypeChange(e.target.value)}
                disabled={submitting || success}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {EVENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div>
              <label
                htmlFor="ftc-amount"
                className="mb-1.5 block text-xs font-medium text-foreground"
              >
                Amount ({currency})
                {eventType === 'manual_adjustment' && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    (negative for a decrease)
                  </span>
                )}
              </label>
              <Input
                id="ftc-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (fieldErrors.amount) {
                    setFieldErrors((prev) => ({ ...prev, amount: '' }));
                  }
                  if (error) setError(null);
                }}
                placeholder={
                  eventType === 'manual_adjustment' ? 'e.g. -50.00 or 75.00' : 'e.g. 1000.00'
                }
                aria-required="true"
                aria-invalid={fieldError('amount') ? true : undefined}
                aria-describedby={fieldError('amount') ? 'ftc-amount-error' : undefined}
                disabled={submitting || success}
                autoFocus
              />
              {fieldError('amount') && (
                <p id="ftc-amount-error" role="alert" className="mt-1 text-xs text-destructive">
                  {fieldError('amount')}
                </p>
              )}
            </div>

            {/* Description (optional) */}
            <div>
              <label
                htmlFor="ftc-description"
                className="mb-1.5 block text-xs font-medium text-foreground"
              >
                Description (optional)
              </label>
              <Input
                id="ftc-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Cash transfer from bank"
                maxLength={500}
                disabled={submitting || success}
              />
            </div>

            {/* Date (optional, defaults to now) */}
            <div>
              <label
                htmlFor="ftc-date"
                className="mb-1.5 block text-xs font-medium text-foreground"
              >
                Date (optional)
              </label>
              <Input
                id="ftc-date"
                type="datetime-local"
                value={postedAt}
                onChange={(e) => setPostedAt(e.target.value)}
                disabled={submitting || success}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                When the event occurred. Defaults to now; clear to use the server time.
              </p>
            </div>

            {/* ── Type-specific extras ─────────────────────────────────── */}
            {eventType === 'dividend' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="ftc-per-share-amount"
                    className="mb-1.5 block text-xs font-medium text-foreground"
                  >
                    Per-Share Amount (optional)
                  </label>
                  <Input
                    id="ftc-per-share-amount"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    value={perShareAmount}
                    onChange={(e) => setPerShareAmount(e.target.value)}
                    placeholder="e.g. 0.50"
                    className={inputClass('perShareAmount')}
                    aria-invalid={fieldError('perShareAmount') ? true : undefined}
                    aria-describedby={
                      fieldError('perShareAmount') ? 'ftc-per-share-amount-error' : undefined
                    }
                    disabled={submitting || success}
                  />
                  {fieldError('perShareAmount') && (
                    <p
                      id="ftc-per-share-amount-error"
                      role="alert"
                      className="mt-1 text-xs text-destructive"
                    >
                      {fieldError('perShareAmount')}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="ftc-shares"
                    className="mb-1.5 block text-xs font-medium text-foreground"
                  >
                    Shares (optional)
                  </label>
                  <Input
                    id="ftc-shares"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="1"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    placeholder="e.g. 100"
                    className={inputClass('shares')}
                    aria-invalid={fieldError('shares') ? true : undefined}
                    aria-describedby={fieldError('shares') ? 'ftc-shares-error' : undefined}
                    disabled={submitting || success}
                  />
                  {fieldError('shares') && (
                    <p id="ftc-shares-error" role="alert" className="mt-1 text-xs text-destructive">
                      {fieldError('shares')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {eventType === 'interest' && (
              <div>
                <label
                  htmlFor="ftc-rate"
                  className="mb-1.5 block text-xs font-medium text-foreground"
                >
                  Rate (optional)
                </label>
                <Input
                  id="ftc-rate"
                  type="text"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="e.g. 4.5%"
                  className={inputClass('rate')}
                  aria-invalid={fieldError('rate') ? true : undefined}
                  aria-describedby={fieldError('rate') ? 'ftc-rate-error' : undefined}
                  disabled={submitting || success}
                />
                {fieldError('rate') && (
                  <p id="ftc-rate-error" role="alert" className="mt-1 text-xs text-destructive">
                    {fieldError('rate')}
                  </p>
                )}
              </div>
            )}

            {eventType === 'fee' && (
              <div>
                <label
                  htmlFor="ftc-fee-type"
                  className="mb-1.5 block text-xs font-medium text-foreground"
                >
                  Fee Type (optional)
                </label>
                <Input
                  id="ftc-fee-type"
                  value={feeType}
                  onChange={(e) => setFeeType(e.target.value)}
                  placeholder="e.g. Margin interest, Maintenance"
                  disabled={submitting || success}
                />
              </div>
            )}

            {eventType === 'tax' && (
              <div>
                <label
                  htmlFor="ftc-tax-type"
                  className="mb-1.5 block text-xs font-medium text-foreground"
                >
                  Tax Type (optional)
                </label>
                <Input
                  id="ftc-tax-type"
                  value={taxType}
                  onChange={(e) => setTaxType(e.target.value)}
                  placeholder="e.g. Withholding, Estimated"
                  disabled={submitting || success}
                />
              </div>
            )}

            {eventType === 'manual_adjustment' && (
              <div>
                <label
                  htmlFor="ftc-reason"
                  className="mb-1.5 block text-xs font-medium text-foreground"
                >
                  Reason
                </label>
                <Input
                  id="ftc-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Broker cash balance correction"
                  maxLength={1000}
                  className={inputClass('reason')}
                  aria-required="true"
                  aria-invalid={fieldError('reason') ? true : undefined}
                  aria-describedby={fieldError('reason') ? 'ftc-reason-error' : undefined}
                  disabled={submitting || success}
                />
                {fieldError('reason') && (
                  <p id="ftc-reason-error" role="alert" className="mt-1 text-xs text-destructive">
                    {fieldError('reason')}
                  </p>
                )}
              </div>
            )}

            {/* ── Economic-effect preview ──────────────────────────────── */}
            <div
              data-testid="ftc-effect-preview"
              className={cn(
                'flex items-center justify-between rounded-lg border px-3 py-2.5 text-xs',
                preview.direction === 'increase'
                  ? 'border-positive/30 bg-positive/10 text-positive'
                  : preview.direction === 'decrease'
                    ? 'border-negative/30 bg-negative/10 text-negative'
                    : 'border-border bg-muted text-muted-foreground',
              )}
              aria-live="polite"
            >
              <span className="flex items-center gap-1.5 font-medium">
                {preview.direction === 'increase' ? (
                  <>
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    Cash increase
                  </>
                ) : preview.direction === 'decrease' ? (
                  <>
                    <ArrowDownRight className="size-3.5" aria-hidden="true" />
                    Cash decrease
                  </>
                ) : (
                  <>
                    <Minus className="size-3.5" aria-hidden="true" />
                    Effect
                  </>
                )}
              </span>
              <span className="font-semibold tabular-nums">{preview.display}</span>
            </div>

            {/* Error banner (API errors) */}
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">{error}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setError(null)}
                  className="h-6 px-2 text-[11px]"
                >
                  Dismiss
                </Button>
              </div>
            )}

            {/* Success confirmation */}
            {success && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 rounded-lg border border-positive/30 bg-positive/10 px-3 py-2.5 text-xs text-positive"
              >
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{eventTypeLabel(eventType)} posted</span>
              </div>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || success}>
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Posting...
                </>
              ) : (
                <>
                  <Receipt className="size-3.5" aria-hidden="true" />
                  Post Transaction
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
