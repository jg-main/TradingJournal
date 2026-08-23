'use client';

import { useState } from 'react';
import { AlertCircle, Banknote, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { extractApiErrorMessage } from '@/lib/error-utils';
import { isSupportedAccountCurrency, UNSUPPORTED_CURRENCY_GUIDANCE } from '@/lib/accounting/currency-contract';

// ── Constants ────────────────────────────────────────────────────────────

/**
 * How long the success confirmation stays visible before the parent swaps
 * the initialization view for the live overview. Short enough to feel
 * snappy, long enough to be perceived as a real success state.
 */
export const POST_SUCCESS_DELAY_MS = 450;

/** Positive amount with up to 2 decimal places ("100", "100.5", "100.50"). */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

// ── Types ────────────────────────────────────────────────────────────────

interface OpeningBalanceFormProps {
  /** Account the opening-balance event is posted to. */
  accountId: string;
  /** Base currency, shown next to the amount field. */
  currency: string;
  /**
   * Called after the opening balance posts successfully. The caller owns
   * refreshing shared account state (AccountProvider) and the overview
   * workspace — the same handoff path as "Start with zero".
   */
  onInitialized: () => void;
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

/** Human-readable message from an API error body, with a caller fallback. */
function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    return extractApiErrorMessage(data as Record<string, unknown>);
  }
  return fallback;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * Opening balance form (S02/T03, A2).
 *
 * Collects the amount (required, positive, up to 2 decimal places) plus an
 * optional description and date, then completes account initialization via
 * POST /api/accounts/:id/initialize with { mode: 'opening_balance' }. The
 * server posts the immutable opening_balance financial event AND activates
 * the account in one authoritative transaction — success means the whole
 * initialization is coherent. The opening balance is a financial event —
 * never an editable account property. On success the form shows a
 * confirmation and hands off through `onInitialized` so the caller
 * refreshes AccountProvider, the overview workspace, and the header badge.
 */
export function OpeningBalanceForm({
  accountId,
  currency,
  onInitialized,
}: OpeningBalanceFormProps) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [postedAt, setPostedAt] = useState(() => toLocalDateTimeInput(new Date()));
  const [amountError, setAmountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setAmountError(null);

    // USD-only contract: never post an opening balance for an unsupported
    // currency account. The domain/API guard is authoritative regardless;
    // this keeps the UI from labeling a USD posting as another currency.
    if (!isSupportedAccountCurrency(currency)) {
      setError(
        `Unsupported account currency "${currency}". ${UNSUPPORTED_CURRENCY_GUIDANCE}`,
      );
      setSubmitting(false);
      return;
    }

    // Client-side validation: the API requires a positive canonical decimal
    // ("100.00"), so reject empty, zero/negative, and >2-decimal input here
    // instead of relying on a round-trip.
    const trimmedAmount = amount.trim();
    if (!trimmedAmount) {
      setAmountError('Enter the opening balance amount.');
      setSubmitting(false);
      return;
    }
    if (!AMOUNT_PATTERN.test(trimmedAmount) || parseFloat(trimmedAmount) <= 0) {
      setAmountError('Enter a positive amount with up to 2 decimal places.');
      setSubmitting(false);
      return;
    }

    const body: Record<string, unknown> = {
      mode: 'opening_balance',
      amount: parseFloat(trimmedAmount).toFixed(2),
    };
    const trimmedDescription = description.trim();
    if (trimmedDescription) body.description = trimmedDescription;
    // Date is optional: empty field omits postedAt so the server timestamps.
    if (postedAt) body.postedAt = new Date(postedAt).toISOString();

    try {
      // Initialization endpoint: posts the opening balance AND activates the
      // account in one server-side transaction (A2).
      const res = await fetch(`/api/accounts/${accountId}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError(apiErrorMessage(data, 'Failed to record the opening balance. Please try again.'));
        return;
      }

      setSuccess(true);
      window.setTimeout(() => onInitialized(), POST_SUCCESS_DELAY_MS);
    } catch {
      setError('Could not record the opening balance. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4">
      <div className="space-y-4">
        {/* Amount */}
        <div>
          <label
            htmlFor="opening-balance-amount"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Amount ({currency})
          </label>
          <Input
            id="opening-balance-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (amountError) setAmountError(null);
            }}
            placeholder="e.g. 1000.00"
            aria-required="true"
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? 'opening-balance-amount-error' : undefined}
            disabled={submitting || success}
            autoFocus
          />
          {amountError && (
            <p
              id="opening-balance-amount-error"
              role="alert"
              className="mt-1 text-xs text-destructive"
            >
              {amountError}
            </p>
          )}
        </div>

        {/* Description (optional) */}
        <div>
          <label
            htmlFor="opening-balance-description"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Description (optional)
          </label>
          <Input
            id="opening-balance-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Cash transferred from previous broker"
            maxLength={500}
            disabled={submitting || success}
          />
        </div>

        {/* Date (optional, defaults to now) */}
        <div>
          <label
            htmlFor="opening-balance-date"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Date (optional)
          </label>
          <Input
            id="opening-balance-date"
            type="datetime-local"
            value={postedAt}
            onChange={(e) => setPostedAt(e.target.value)}
            disabled={submitting || success}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            When the balance existed. Defaults to now; clear to use the server time.
          </p>
        </div>
      </div>

      {/* Error banner (API errors) */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Success confirmation */}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 flex items-start gap-2 rounded-lg border border-positive/30 bg-positive/10 px-3 py-2.5 text-xs text-positive"
        >
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>Opening balance recorded</span>
        </div>
      )}

      <Button type="submit" disabled={submitting || success} className="mt-4">
        {submitting ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Posting...
          </>
        ) : (
          <>
            <Banknote className="size-3.5" aria-hidden="true" />
            Record Opening Balance
          </>
        )}
      </Button>
    </form>
  );
}
