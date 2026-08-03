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

// ── Constants ────────────────────────────────────────────────────────────

const EXECUTION_ACTIONS = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'sell_short', label: 'Sell Short' },
  { value: 'buy_to_cover', label: 'Buy to Cover' },
  { value: 'add', label: 'Add' },
  { value: 'reduce', label: 'Reduce' },
] as const;

// ── Types ────────────────────────────────────────────────────────────────

/** Minimal execution data needed to populate the correction form. */
interface ExecutionBrief {
  id: string;
  symbol: string;
  action: string;
  quantity: string;
  price: string;
  fees: string;
  postedAt: string;
}

interface CorrectionResult {
  success: boolean;
  correction?: {
    id: string;
    originalExecutionId: string;
    reversalExecutionId: string;
    replacementExecutionId: string;
    reason: string | null;
    correctedAt: string;
  };
  originalExecution?: {
    id: string;
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
  };
  reversalExecution?: {
    id: string;
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
  };
  replacementExecution?: {
    id: string;
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
  };
  error?: string;
  code?: string;
  details?: string | Record<string, unknown>;
  message?: string;
}

type CorrectionStep = 'form' | 'confirm' | 'submitting' | 'success' | 'error';

// ── Component Props ─────────────────────────────────────────────────────

interface AccountCorrectionFormProps {
  /** Account ID the execution belongs to. */
  accountId: string;
  /** Execution to correct (the original). */
  execution: ExecutionBrief;
  /** Whether the dialog is open. */
  open: boolean;
  /** Callback when dialog open state changes. */
  onOpenChange: (open: boolean) => void;
  /** Called after a successful correction. */
  onCorrectionComplete?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatCurrency(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function actionLabel(action: string): string {
  return EXECUTION_ACTIONS.find((a) => a.value === action)?.label ?? action;
}

function readableErrorCode(code: string | undefined): string {
  if (!code) return '';
  const map: Record<string, string> = {
    EXECUTION_ALREADY_CORRECTED: 'This execution has already been corrected.',
    EXECUTION_NOT_MUTABLE: 'This execution is a reversal or replacement and cannot be corrected.',
    DUPLICATE_CORRECTION_IDEMPOTENCY: 'Duplicate correction request detected.',
    FIFO_ALLOCATION_REJECTED: 'The replacement values would create an invalid position state.',
  };
  return map[code] ?? code;
}

// ── Component ───────────────────────────────────────────────────────────

export default function AccountCorrectionForm({
  accountId,
  execution,
  open,
  onOpenChange,
  onCorrectionComplete,
}: AccountCorrectionFormProps) {
  const [step, setStep] = useState<CorrectionStep>('form');

  // Replacement form state (pre-filled from original execution)
  const [symbol, setSymbol] = useState(execution.symbol);
  const [action, setAction] = useState(execution.action);
  const [quantity, setQuantity] = useState(execution.quantity);
  const [price, setPrice] = useState(execution.price);
  const [fees, setFees] = useState(execution.fees);
  const [reason, setReason] = useState('');

  // Error state
  const [errorData, setErrorData] = useState<{
    error: string;
    code?: string;
    details?: string | Record<string, unknown>;
  } | null>(null);

  // Success state
  const [successResult, setSuccessResult] = useState<CorrectionResult | null>(null);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── Reset form state when dialog opens ─────────────────────────────

  const resetState = useCallback(() => {
    setStep('form');
    setSymbol(execution.symbol);
    setAction(execution.action);
    setQuantity(execution.quantity);
    setPrice(execution.price);
    setFees(execution.fees);
    setReason('');
    setErrorData(null);
    setSuccessResult(null);
    setFieldErrors({});
  }, [execution]);

  // ── Handle dialog close ───────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (step === 'submitting') return; // Prevent closing while submitting
    resetState();
    onOpenChange(false);
  }, [step, resetState, onOpenChange]);

  // ── Validation ────────────────────────────────────────────────────

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!symbol.trim()) {
      errors.symbol = 'Symbol is required';
    } else if (!/^[A-Z0-9.]+$/.test(symbol.trim())) {
      errors.symbol = 'Symbol must be uppercase alphanumeric (e.g. AAPL)';
    }

    const qty = parseFloat(quantity);
    if (!quantity.trim() || isNaN(qty) || qty <= 0) {
      errors.quantity = 'Must be a positive number';
    }

    const p = parseFloat(price);
    if (!price.trim() || isNaN(p) || p <= 0) {
      errors.price = 'Must be a positive number';
    }

    const f = parseFloat(fees);
    if (fees.trim() && (isNaN(f) || f < 0)) {
      errors.fees = 'Must be a non-negative number';
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

    const canonicalQuantity = parseFloat(quantity).toFixed(2);
    const canonicalPrice = parseFloat(price).toFixed(2);
    const canonicalFees = fees.trim() ? parseFloat(fees).toFixed(2) : '0.00';

    const body: Record<string, unknown> = {
      symbol: symbol.trim().toUpperCase(),
      action,
      quantity: canonicalQuantity,
      price: canonicalPrice,
      fees: canonicalFees,
    };

    if (reason.trim()) {
      body.reason = reason.trim();
    }

    try {
      const res = await fetch(
        `/api/accounts/${accountId}/executions/${execution.id}/correct`,
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
          error: 'Account or execution not found.',
          code: data.code,
        });
        setStep('error');
      } else {
        setErrorData({
          error: data.error ?? 'Failed to correct execution.',
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
      <DialogContent className="sm:max-w-lg" aria-describedby="correction-form-description">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Correct Execution</DialogTitle>
            {stepIndicator}
          </div>
          <DialogDescription id="correction-form-description">
            Replace a posted execution through an auditable reversal-and-replacement flow.
            The original execution remains unchanged; a linked reversal and replacement are created.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: Form ──────────────────────────────────────────────── */}
        {step === 'form' && (
          <div className="space-y-4">
            {/* Original execution (read-only reference) */}
            <div className="rounded-lg border border-border bg-muted p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Original Execution
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Action:</span>
                <span className="font-medium text-foreground">{actionLabel(execution.action)}</span>
                <span className="text-muted-foreground">Symbol:</span>
                <span className="font-medium text-foreground">{execution.symbol}</span>
                <span className="text-muted-foreground">Qty:</span>
                <span className="font-medium text-foreground">{formatCurrency(execution.quantity)}</span>
                <span className="text-muted-foreground">Price:</span>
                <span className="font-medium text-foreground">${formatCurrency(execution.price)}</span>
                <span className="text-muted-foreground">Fees:</span>
                <span className="font-medium text-foreground">${formatCurrency(execution.fees)}</span>
                <span className="text-muted-foreground">Posted:</span>
                <span className="font-medium text-foreground">{formatDateTime(execution.postedAt)}</span>
              </div>
            </div>

            {/* Replacement form */}
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Replacement Values
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="corr-action"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Action
                </label>
                <select
                  id="corr-action"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {EXECUTION_ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="corr-symbol"
                  className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground"
                >
                  Symbol
                  <HelpTooltip content="The ticker symbol for the replacement. Can differ from the original if the ticker changed." />
                </label>
                <Input
                  id="corr-symbol"
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. AAPL"
                  className={inputClass('symbol')}
                  autoFocus
                  aria-invalid={!!fieldError('symbol')}
                  aria-describedby={fieldError('symbol') ? 'corr-symbol-error' : undefined}
                />
                {fieldError('symbol') && (
                  <p id="corr-symbol-error" className="mt-1 text-xs text-destructive" role="alert">
                    {fieldError('symbol')}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="corr-quantity"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Quantity
                </label>
                <Input
                  id="corr-quantity"
                  type="number"
                  step="any"
                  min="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 100"
                  className={inputClass('quantity')}
                  aria-invalid={!!fieldError('quantity')}
                  aria-describedby={fieldError('quantity') ? 'corr-quantity-error' : undefined}
                />
                {fieldError('quantity') && (
                  <p id="corr-quantity-error" className="mt-1 text-xs text-destructive" role="alert">
                    {fieldError('quantity')}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="corr-price"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Price ($)
                </label>
                <Input
                  id="corr-price"
                  type="number"
                  step="any"
                  min="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="e.g. 150.75"
                  className={inputClass('price')}
                  aria-invalid={!!fieldError('price')}
                  aria-describedby={fieldError('price') ? 'corr-price-error' : undefined}
                />
                {fieldError('price') && (
                  <p id="corr-price-error" className="mt-1 text-xs text-destructive" role="alert">
                    {fieldError('price')}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label
                htmlFor="corr-fees"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Fees ($) <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="corr-fees"
                type="number"
                step="0.01"
                min="0"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                placeholder="0.00"
                className={inputClass('fees')}
                aria-invalid={!!fieldError('fees')}
                aria-describedby={fieldError('fees') ? 'corr-fees-error' : undefined}
              />
              {fieldError('fees') && (
                <p id="corr-fees-error" className="mt-1 text-xs text-destructive" role="alert">
                  {fieldError('fees')}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="corr-reason"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Reason <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="corr-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Wrong quantity entered"
              />
            </div>

            {/* Confirmation checkbox */}
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-xs text-warning">
                This will reverse the original execution and post a replacement. The original
                remains unchanged for audit purposes. FIFO positions and performance projections
                will be rebuilt automatically.
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
                record and cannot be undone for the original execution.
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
                    <td className="px-3 py-2 text-muted-foreground">Action</td>
                    <td className="px-3 py-2 text-foreground">{actionLabel(execution.action)}</td>
                    <td className="px-3 py-2 font-semibold text-foreground">{actionLabel(action)}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground">Symbol</td>
                    <td className="px-3 py-2 text-foreground">{execution.symbol}</td>
                    <td className="px-3 py-2 font-semibold text-foreground">{symbol.trim().toUpperCase() || '—'}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground">Quantity</td>
                    <td className="px-3 py-2 tabular-nums text-foreground">{formatCurrency(execution.quantity)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-foreground">
                      {quantity ? formatCurrency(quantity) : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground">Price</td>
                    <td className="px-3 py-2 tabular-nums text-foreground">${formatCurrency(execution.price)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-foreground">
                      ${price ? formatCurrency(price) : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground">Fees</td>
                    <td className="px-3 py-2 tabular-nums text-foreground">${formatCurrency(execution.fees)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-foreground">
                      ${fees ? formatCurrency(fees) : '0.00'}
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
                The reversal mirrors the original (opposite action). The replacement creates a new
                execution with the values above. Both are added to the audit log.
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
                The replacement execution has been posted. Closing...
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
                    {successResult.correction.reversalExecutionId.slice(0, 12)}...
                  </span>
                  <span className="text-positive">Replacement:</span>
                  <span className="font-mono text-positive">
                    {successResult.correction.replacementExecutionId.slice(0, 12)}...
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
