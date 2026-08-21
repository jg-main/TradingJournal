'use client';

import { useState } from 'react';
import { AlertCircle, ArrowLeft, Banknote, CheckCircle2, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { extractApiErrorMessage } from '@/lib/error-utils';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────

interface AccountInitializationProps {
  /** Account ID used for the activation PUT and the opening-balance form. */
  accountId: string;
  /** Account display name for the headline. */
  accountName: string;
  /** Base currency shown when recording an opening balance. */
  currency: string;
  /**
   * Called after the account is successfully initialized ("Start with zero"
   * activates the account). The caller owns refreshing shared account state
   * (AccountProvider) and the overview workspace.
   */
  onInitialized: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Extract a human-readable message from an API error body. API routes in
 * this repo return `{ error, details }`; shared extraction lives in
 * `src/lib/error-utils.ts`. When the response body is not a usable object
 * (non-JSON, empty), fall back to the caller's message.
 */
function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    return extractApiErrorMessage(data as Record<string, unknown>);
  }
  return fallback;
}

// ── Path Card Sub-Component ─────────────────────────────────────────────

interface PathCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}

function PathCard({ icon, title, description, onClick, disabled, busy }: PathCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy ?? undefined}
      className={cn(
        'group flex flex-col items-start rounded-lg border border-border bg-background p-4 text-left transition-colors',
        'hover:border-ring/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      <span className="mb-2 text-muted-foreground">{icon}</span>
      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {busy ? 'Activating...' : title}
        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
      </span>
      <span className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</span>
    </button>
  );
}

// ── Component ───────────────────────────────────────────────────────────

/**
 * Empty-account initialization state (S02/T02).
 *
 * Rendered by AccountOverview for draft accounts (inactive with no financial
 * events and no positions). Presents two paths:
 * - "Add opening balance" — hands off to the opening-balance panel whose form
 *   (OpeningBalanceForm) is wired in S02/T03.
 * - "Start with zero" — activates the account via PUT /api/accounts/:id with
 *   `{ isActive: true }`, then reports success through `onInitialized`.
 *
 * Loading, error (API message with retry), and success states are all
 * handled here; the opening balance itself is a financial event, never an
 * editable account property.
 */
export function AccountInitialization({
  accountId,
  accountName,
  currency,
  onInitialized,
}: AccountInitializationProps) {
  const [view, setView] = useState<'paths' | 'opening-balance'>('paths');
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartWithZero = async () => {
    setActivating(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError(apiErrorMessage(data, 'Could not activate the account. Please try again.'));
        return;
      }

      onInitialized();
    } catch {
      setError('Could not activate the account. Please try again.');
    } finally {
      setActivating(false);
    }
  };

  // ── Opening-balance panel (form wired in T03) ────────────────────
  if (view === 'opening-balance') {
    return (
      <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <div
          role="region"
          aria-label="Opening balance"
          className="mx-auto max-w-xl rounded-lg border border-border bg-background p-5"
        >
          <h2 className="text-sm font-semibold text-foreground">Opening balance</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Enter the cash that was already in this account when you started
            journaling. It is recorded as a financial event in {currency} — never
            as an editable account property.
          </p>

          {/* OpeningBalanceForm (amount, optional description and date) is
              mounted here in S02/T03. */}
          <div className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            Amount, description, and date are collected here.
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setView('paths')}
            className="mt-4"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  // ── Two initialization paths ─────────────────────────────────────
  return (
    <div
      aria-busy={activating}
      className="rounded-lg border border-border bg-card p-6 sm:p-8"
    >
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
          <Wallet className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold text-foreground">Set up {accountName}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          This account has no balance yet. Record the cash it started with, or
          activate it now with a zero balance. You can add funds at any time.
        </p>
      </div>

      <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
        <PathCard
          icon={<Banknote className="size-5" aria-hidden="true" />}
          title="Add opening balance"
          description="Record the cash already in this account as a financial event."
          onClick={() => setView('opening-balance')}
          disabled={activating}
        />
        <PathCard
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
          title="Start with zero"
          description="Activate this account with a $0 balance. You can add cash later."
          onClick={handleStartWithZero}
          disabled={activating}
          busy={activating}
        />
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="mx-auto mt-4 flex max-w-2xl items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
