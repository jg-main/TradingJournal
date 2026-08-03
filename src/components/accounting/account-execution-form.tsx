'use client';

import { useState, useCallback } from 'react';
import {
  Plus,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Constants ────────────────────────────────────────────────────────────

const EXECUTION_ACTIONS = [
  { value: 'buy', label: 'Buy', description: 'Open or add to a long position' },
  { value: 'sell', label: 'Sell', description: 'Close or reduce a long position' },
  { value: 'sell_short', label: 'Sell Short', description: 'Open or add to a short position' },
  { value: 'buy_to_cover', label: 'Buy to Cover', description: 'Close or reduce a short position' },
  { value: 'add', label: 'Add', description: 'Add to existing position (same side)' },
  { value: 'reduce', label: 'Reduce', description: 'Reduce existing position (opposite side)' },
] as const;

// ── Types ────────────────────────────────────────────────────────────────

interface ExecutionFormState {
  symbol: string;
  action: string;
  quantity: string;
  price: string;
  fees: string;
  description: string;
  journalTradeId: string;
}

interface ExecutionResponse {
  success?: boolean;
  execution?: {
    id: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
    symbol?: string;
  };
  position?: {
    direction: string | null;
    quantity: string;
    averageCost: string;
    realizedNetPnl: string;
    realizedFees: string;
    realizedGrossPnl: string;
    openLots?: Array<{
      id: string;
      remainingQuantity: string;
      originalQuantity: string;
      entryPrice: string;
      direction: string;
    }>;
  };
  error?: string;
  code?: string;
  details?: string | Record<string, unknown>;
  message?: string;
}

interface FieldError {
  field: string;
  message: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function generateIdempotencyKey(): string {
  // Generate a UUID v4 on the client for idempotent retry safety
  const hex = '0123456789abcdef';
  const segments = [8, 4, 4, 4, 12];
  return segments
    .map((len) => {
      let s = '';
      for (let i = 0; i < len; i++) s += hex[Math.floor(Math.random() * 16)];
      return s;
    })
    .join('-');
}

function parseFieldErrors(
  details: string | Record<string, unknown> | undefined,
): FieldError[] {
  if (!details) return [];
  if (typeof details === 'string') return [{ field: 'general', message: details }];
  const flattened = details as Record<string, unknown>;
  if (flattened.fieldErrors && Array.isArray(flattened.fieldErrors)) {
    return flattened.fieldErrors as FieldError[];
  }
  // Zod flatten structure: { fieldErrors: { symbol?: string[], action?: string[], ... } }
  if (flattened.fieldErrors && typeof flattened.fieldErrors === 'object') {
    const errors: FieldError[] = [];
    for (const [field, msgs] of Object.entries(flattened.fieldErrors as Record<string, unknown>)) {
      if (Array.isArray(msgs) && msgs.length > 0) {
        errors.push({ field, message: msgs.join('; ') });
      }
    }
    return errors;
  }
  if (flattened.formErrors && Array.isArray(flattened.formErrors) && flattened.formErrors.length > 0) {
    return [{ field: 'general', message: (flattened.formErrors as string[]).join('; ') }];
  }
  return [{ field: 'general', message: JSON.stringify(details) }];
}

// ── Component Props ─────────────────────────────────────────────────────

interface AccountExecutionFormProps {
  accountId: string;
  onExecutionPosted?: () => void;
}

// ── Component ───────────────────────────────────────────────────────────

export default function AccountExecutionForm({
  accountId,
  onExecutionPosted,
}: AccountExecutionFormProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | 'conflict' | 'validation';
    text: string;
    details?: string;
    fieldErrors?: FieldError[];
  } | null>(null);
  const [successResult, setSuccessResult] = useState<ExecutionResponse | null>(null);

  // Form state
  const [form, setForm] = useState<ExecutionFormState>({
    symbol: '',
    action: 'buy',
    quantity: '',
    price: '',
    fees: '0.00',
    description: '',
    journalTradeId: '',
  });

  const updateField = useCallback(
    (field: keyof ExecutionFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const resetForm = useCallback(() => {
    setForm({
      symbol: '',
      action: 'buy',
      quantity: '',
      price: '',
      fees: '0.00',
      description: '',
      journalTradeId: '',
    });
    setMessage(null);
    setSuccessResult(null);
    setShowForm(false);
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setSuccessResult(null);

    // Client-side validation
    if (!form.symbol.trim()) {
      setMessage({
        type: 'validation',
        text: 'Symbol is required.',
        fieldErrors: [{ field: 'symbol', message: 'Must not be empty' }],
      });
      setSaving(false);
      return;
    }

    const qty = form.quantity.trim();
    if (!qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0) {
      setMessage({
        type: 'validation',
        text: 'Quantity must be a positive number.',
        fieldErrors: [{ field: 'quantity', message: 'Must be a positive number' }],
      });
      setSaving(false);
      return;
    }

    const p = form.price.trim();
    if (!p || isNaN(parseFloat(p)) || parseFloat(p) <= 0) {
      setMessage({
        type: 'validation',
        text: 'Price must be a positive number.',
        fieldErrors: [{ field: 'price', message: 'Must be a positive number' }],
      });
      setSaving(false);
      return;
    }

    // Format quantity, price, fees as canonical decimals
    const canonicalQuantity = parseFloat(qty).toFixed(2);
    const canonicalPrice = parseFloat(p).toFixed(2);
    const canonicalFees = form.fees.trim()
      ? parseFloat(form.fees).toFixed(2)
      : '0.00';

    // Generate idempotency key for retry safety
    const idempotencyKey = generateIdempotencyKey();

    // Build request body
    const body: Record<string, unknown> = {
      symbol: form.symbol.trim().toUpperCase(),
      action: form.action,
      quantity: canonicalQuantity,
      price: canonicalPrice,
      fees: canonicalFees,
      idempotencyKey,
    };

    if (form.description.trim()) {
      body.description = form.description.trim();
    }

    if (form.journalTradeId.trim()) {
      body.journalTradeId = form.journalTradeId.trim();
    }

    try {
      const res = await fetch(`/api/accounts/${accountId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: ExecutionResponse = await res.json().catch(() => ({}));

      if (res.ok && res.status === 201) {
        // Success — data contains the execution and updated position
        setSuccessResult(data);
        setMessage({
          type: 'success',
          text: `${EXECUTION_ACTIONS.find((a) => a.value === form.action)?.label ?? form.action} ${canonicalQuantity} ${form.symbol.toUpperCase()} @ ${canonicalPrice} posted.`,
        });
        // Reset form after brief delay so the success message is visible
        setTimeout(() => {
          resetForm();
          onExecutionPosted?.();
        }, 1500);
      } else if (res.status === 409) {
        // Conflict — duplicate idempotency key (shouldn't happen with fresh keys, but handle gracefully)
        setMessage({
          type: 'conflict',
          text: 'Duplicate request detected. This execution was already posted.',
          details: data.details as string | undefined,
        });
      } else if (res.status === 422) {
        // Unprocessable — FIFO rejection (over-close, flip)
        setMessage({
          type: 'error',
          text: data.message ?? data.error ?? 'Execution rejected.',
          details: `Code: ${data.code ?? 'unknown'}. Action: ${form.action}, Quantity: ${canonicalQuantity}`,
        });
      } else if (res.status === 404) {
        setMessage({
          type: 'error',
          text: 'Account not found. It may have been deactivated.',
        });
      } else if (res.status === 400) {
        // Validation error
        const fieldErrors = parseFieldErrors(data.details);
        setMessage({
          type: 'validation',
          text: data.error ?? 'Validation failed.',
          details: fieldErrors.length > 0 ? undefined : JSON.stringify(data.details),
          fieldErrors,
        });
      } else {
        setMessage({
          type: 'error',
          text: data.error ?? 'Failed to post execution.',
          details: data.details as string | undefined,
        });
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────

  const fieldError = (field: string): string | undefined => {
    return message?.fieldErrors?.find((fe) => fe.field === field)?.message;
  };

  const inputClass = (field: string): string => {
    return fieldError(field)
      ? 'border-destructive focus:border-destructive focus:ring-destructive/30'
      : '';
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="mb-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <h2 className="mb-4 text-sm font-medium text-muted-foreground uppercase tracking-wider">
        Trade Executions
      </h2>

      {/* ── Success Result Card ─────────────────────────────────────── */}
      {successResult && (
        <div className="mb-4 rounded-lg border border-positive/30 bg-positive/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-positive">
                Execution Posted
              </p>
              <p className="mt-1 text-xs text-positive">
                {successResult.execution?.action?.toUpperCase()}{' '}
                {successResult.execution?.quantity} {successResult.execution?.symbol}{' '}
                @ {successResult.execution?.price}
                {successResult.execution?.fees !== '0.00'
                  ? ` (fees: ${successResult.execution?.fees})`
                  : ''}
              </p>
            </div>
          </div>
          {successResult.position && (
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-positive/30 pt-3">
              <div>
                <p className="text-xs text-positive">Position</p>
                <p className="text-sm font-semibold tabular-nums text-positive">
                  {successResult.position.direction ?? 'Flat'}{' '}
                  {successResult.position.quantity}
                </p>
              </div>
              <div>
                <p className="text-xs text-positive">Avg Cost</p>
                <p className="text-sm font-semibold tabular-nums text-positive">
                  ${parseFloat(successResult.position.averageCost).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-positive">Realized P&amp;L</p>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    parseFloat(successResult.position.realizedNetPnl) >= 0
                      ? 'text-positive'
                      : 'text-negative'
                  }`}
                >
                  {parseFloat(successResult.position.realizedNetPnl) >= 0 ? '+' : ''}
                  ${parseFloat(successResult.position.realizedNetPnl).toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Message Alert ──────────────────────────────────────────── */}
      {message && !successResult && (
        <div
          role="alert"
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : message.type === 'conflict'
              ? 'border-warning/30 bg-warning/10 text-warning'
              : message.type === 'validation'
              ? 'border-warning/30 bg-warning/10 text-warning'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          <div className="flex items-start gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : message.type === 'conflict' ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            ) : message.type === 'validation' ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <div>
              <p className="font-medium">{message.text}</p>
              {message.details && (
                <p className="mt-0.5 text-xs opacity-80">{message.details}</p>
              )}
              {message.fieldErrors && message.fieldErrors.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs opacity-80">
                  {message.fieldErrors.map((fe, i) => (
                    <li key={i}>
                      <span className="font-medium">{fe.field}</span>: {fe.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Toggle / Form ───────────────────────────────────────────── */}
      {!showForm ? (
        <Button
          onClick={() => {
            setShowForm(true);
            setMessage(null);
            setSuccessResult(null);
          }}
        >
          <Plus className="size-4" />
          Post Execution
        </Button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-border bg-card p-6"
        >
          <h3 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Post Execution Fill
          </h3>

          <div className="space-y-4">
            {/* Row 1: Action + Symbol */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="exec-action"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Action
                </label>
                <select
                  id="exec-action"
                  value={form.action}
                  onChange={(e) => updateField('action', e.target.value)}
                  className={`w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring ${inputClass('action')}`}
                >
                  {EXECUTION_ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {fieldError('action') && (
                  <p className="mt-1 text-xs text-destructive">{fieldError('action')}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="exec-symbol"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Symbol
                </label>
                <Input
                  id="exec-symbol"
                  type="text"
                  value={form.symbol}
                  onChange={(e) => updateField('symbol', e.target.value.toUpperCase())}
                  placeholder="e.g. AAPL"
                  className={inputClass('symbol')}
                  autoFocus
                />
                {fieldError('symbol') && (
                  <p className="mt-1 text-xs text-destructive">{fieldError('symbol')}</p>
                )}
              </div>
            </div>

            {/* Row 2: Quantity + Price */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="exec-quantity"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Quantity
                </label>
                <Input
                  id="exec-quantity"
                  type="number"
                  step="any"
                  min="0.01"
                  value={form.quantity}
                  onChange={(e) => updateField('quantity', e.target.value)}
                  placeholder="e.g. 100"
                  className={inputClass('quantity')}
                />
                {fieldError('quantity') && (
                  <p className="mt-1 text-xs text-destructive">{fieldError('quantity')}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="exec-price"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Price ($)
                </label>
                <Input
                  id="exec-price"
                  type="number"
                  step="any"
                  min="0.01"
                  value={form.price}
                  onChange={(e) => updateField('price', e.target.value)}
                  placeholder="e.g. 150.75"
                  className={inputClass('price')}
                />
                {fieldError('price') && (
                  <p className="mt-1 text-xs text-destructive">{fieldError('price')}</p>
                )}
              </div>
            </div>

            {/* Row 3: Fees */}
            <div>
              <label
                htmlFor="exec-fees"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Fees ($) <span className="font-normal text-muted-foreground">(optional, defaults to 0)</span>
              </label>
              <Input
                id="exec-fees"
                type="number"
                step="0.01"
                min="0"
                value={form.fees}
                onChange={(e) => updateField('fees', e.target.value)}
                placeholder="0.00"
                className={inputClass('fees')}
              />
              {fieldError('fees') && (
                <p className="mt-1 text-xs text-destructive">{fieldError('fees')}</p>
              )}
            </div>

            {/* Row 4: Description */}
            <div>
              <label
                htmlFor="exec-description"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="exec-description"
                type="text"
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="e.g. Q3 earnings play"
              />
            </div>

            {/* Row 5: Journal Trade ID */}
            <div>
              <label
                htmlFor="exec-journal-trade"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Journal Trade ID <span className="font-normal text-muted-foreground">(optional, attribution only)</span>
              </label>
              <Input
                id="exec-journal-trade"
                type="text"
                value={form.journalTradeId}
                onChange={(e) => updateField('journalTradeId', e.target.value)}
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Links this execution to a journal trade for attribution. Not used for P&amp;L calculation.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Posting...' : 'Post Execution'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
