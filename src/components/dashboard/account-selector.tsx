'use client';

import { useEffect, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Types ──────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean | number;
}

export interface AccountSelectorProps {
  /** Currently selected account ID, or null for "all accounts" */
  value: string | null;
  /** Called when the user selects an account (null = cleared / "all") */
  onValueChange: (value: string | null) => void;
  /** Placeholder text when no account is selected */
  placeholder?: string;
  /** Optional CSS class name for the trigger width */
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Self-contained account selector that fetches accounts from /api/accounts.
 *
 * States:
 * - loading: animated pulse skeleton
 * - error: inline error message
 * - loaded: shadcn Select dropdown populated with accounts
 */
export function AccountSelector({
  value,
  onValueChange,
  placeholder = 'All accounts',
  className,
}: AccountSelectorProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    fetch('/api/accounts')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load accounts');
        return res.json() as Promise<Account[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setAccounts(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load accounts');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Loading state ────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className={`h-8 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700 ${className ?? ''}`}
        data-testid="account-selector-loading"
      />
    );
  }

  // ── Error state ──────────────────────────────────────────────────

  if (error) {
    return (
      <div
        className={`flex h-8 items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400 ${className ?? ''}`}
        data-testid="account-selector-error"
      >
        {error}
      </div>
    );
  }

  // ── Loaded state ─────────────────────────────────────────────────

  return (
    <Select
      value={value ?? ''}
      onValueChange={(v: string) => onValueChange(v || null)}
    >
      <SelectTrigger
        className={className}
        data-testid="account-selector-trigger"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((acc) => (
          <SelectItem key={acc.id} value={acc.id}>
            {acc.name}
            {acc.broker ? ` (${acc.broker})` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
