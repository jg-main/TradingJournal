'use client';

import { useState } from 'react';
import { AlertCircle, Landmark, Loader2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { DEFAULT_ACCOUNT_CURRENCY, UNSUPPORTED_CURRENCY_GUIDANCE } from '@/lib/accounting/currency-contract';

// ── Types ───────────────────────────────────────────────────────────────

/** Account row returned by POST /api/accounts (subset the dialog needs). */
export interface CreatedAccount {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
}

interface AddAccountDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Close/open callback from the Dialog primitive. */
  onOpenChange: (open: boolean) => void;
  /**
   * Called after the account is created (POST /api/accounts 201).
   * `warning` is set when the account was created but the optional
   * "make default" settings update failed.
   */
  onCreated: (account: CreatedAccount, warning?: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Extract a human-readable message from an API error body. API routes in
 * this repo return `{ error, details }` where `details` on a 400 is the
 * flattened zod result (`{ fieldErrors, formErrors }`). Prefer the first
 * field error so validation problems read naturally.
 */
function extractApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const candidate = data as Record<string, unknown>;
  const details = candidate.details;

  if (details && typeof details === 'object') {
    const flattened = details as Record<string, unknown>;
    const fieldErrors = flattened.fieldErrors;
    if (fieldErrors && typeof fieldErrors === 'object') {
      for (const messages of Object.values(fieldErrors as Record<string, unknown>)) {
        if (Array.isArray(messages) && typeof messages[0] === 'string') {
          return messages[0];
        }
      }
    }
    if (Array.isArray(flattened.formErrors) && typeof flattened.formErrors[0] === 'string') {
      return flattened.formErrors[0];
    }
  }

  if (typeof candidate.error === 'string') return candidate.error;
  return fallback;
}

function isCreatedAccount(value: unknown): value is CreatedAccount {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CreatedAccount>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    (typeof candidate.broker === 'string' || candidate.broker === null) &&
    typeof candidate.currency === 'string' &&
    typeof candidate.isActive === 'boolean'
  );
}

// ── Form (mounted only while the dialog is open) ────────────────────────

function AddAccountForm({
  onOpenChange,
  onCreated,
}: Pick<AddAccountDialogProps, 'onOpenChange' | 'onCreated'>) {
  const [name, setName] = useState('');
  const [broker, setBroker] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setNameError('Account name is required.');
      return;
    }
    setNameError(null);
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          broker: broker.trim() || null,
          // USD-only contract: the dialog offers no currency choices and
          // always creates USD accounts. The API also defaults to USD, so
          // omitting the field is the canonical request.
          currency: DEFAULT_ACCOUNT_CURRENCY,
        }),
      });

      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError(extractApiError(data, 'Failed to create account.'));
        return;
      }

      if (!isCreatedAccount(data)) {
        setError('The server returned an invalid account response.');
        return;
      }

      // Optional: make the new account the saved default. A failure here is
      // non-fatal — the account exists, so surface a warning and continue.
      let warning: string | undefined;
      if (makeDefault) {
        const settingsRes = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultAccountId: data.id }),
        });
        if (!settingsRes.ok) {
          const settingsData: unknown = await settingsRes.json().catch(() => null);
          warning = `Account created, but could not set it as the default: ${extractApiError(settingsData, 'Settings update failed.')}`;
        }
      }

      onOpenChange(false);
      onCreated(data, warning);
    } catch {
      setError('Failed to create account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>Add Account</DialogTitle>
        <DialogDescription>
          Create a new brokerage account. You can record an opening balance or start
          from zero right after.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        {/* Name */}
        <div>
          <label
            htmlFor="add-account-name"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Account name
          </label>
          <Input
            id="add-account-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="e.g. Main Brokerage"
            aria-required="true"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'add-account-name-error' : undefined}
            disabled={submitting}
            autoFocus
          />
          {nameError && (
            <p
              id="add-account-name-error"
              role="alert"
              className="mt-1 text-xs text-destructive"
            >
              {nameError}
            </p>
          )}
        </div>

        {/* Broker */}
        <div>
          <label
            htmlFor="add-account-broker"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Broker
          </label>
          <Input
            id="add-account-broker"
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
            placeholder="e.g. Interactive Brokers"
            disabled={submitting}
          />
        </div>

        {/* Base currency — USD only (product contract) */}
        <div>
          <label
            id="add-account-currency-label"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Base currency
          </label>
          <div className="flex h-9 w-full items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">
            {DEFAULT_ACCOUNT_CURRENCY}
          </div>
          <p
            id="add-account-currency-help"
            className="mt-1 text-xs text-muted-foreground"
          >
            {UNSUPPORTED_CURRENCY_GUIDANCE}
          </p>
        </div>

        {/* Make default */}
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border accent-foreground"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
            disabled={submitting}
          />
          <span>
            <span className="font-medium text-foreground">
              Make this my default account
            </span>
            <span className="block text-xs text-muted-foreground">
              New trades use this account unless you choose another one.
            </span>
          </span>
        </label>
      </div>

      {/* Error banner */}
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

      <DialogFooter className="mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Creating...
            </>
          ) : (
            <>
              <Landmark className="size-3.5" aria-hidden="true" />
              Create Account
            </>
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────

/**
 * Polished Add Account dialog (S02/T01).
 *
 * Creates the account through POST /api/accounts, optionally saves it as
 * the default via PUT /api/settings, and hands the created account to
 * `onCreated` so the caller can refresh shared account state and navigate
 * into the new account workspace. The form is mounted only while the
 * dialog is open so its state resets on every open.
 */
export function AddAccountDialog({ open, onOpenChange, onCreated }: AddAccountDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md')}>
        {open && <AddAccountForm onOpenChange={onOpenChange} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}
