'use client';

import { useEffect, useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ── Types ──────────────────────────────────────────────────────────────

interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean | number;
}

interface DashboardFiltersProps {
  dateFrom: string;
  dateTo: string;
  accountId: string | null;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onAccountIdChange: (v: string | null) => void;
}

// ── Component ──────────────────────────────────────────────────────────

export function DashboardFilters({
  dateFrom,
  dateTo,
  accountId,
  onDateFromChange,
  onDateToChange,
  onAccountIdChange,
}: DashboardFiltersProps) {
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

  return (
    <div className="mb-6 flex flex-wrap items-end gap-4">
      {/* Date From */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="filter-date-from"
          className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
        >
          From
        </label>
        <input
          id="filter-date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-zinc-900 transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 dark:text-zinc-100 [color-scheme:light] dark:[color-scheme:dark]"
        />
      </div>

      {/* Date To */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="filter-date-to"
          className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
        >
          To
        </label>
        <input
          id="filter-date-to"
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-zinc-900 transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 dark:text-zinc-100 [color-scheme:light] dark:[color-scheme:dark]"
        />
      </div>

      {/* Account Selector */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="filter-account"
          className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
        >
          Account
        </label>
        {loading ? (
          <div className="h-8 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
        ) : error ? (
          <div className="flex h-8 items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </div>
        ) : (
          <Select
            value={accountId ?? ''}
            onValueChange={(v: string) => onAccountIdChange(v || null)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All accounts" />
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
        )}
      </div>
    </div>
  );
}
