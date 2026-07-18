'use client';

import { AccountSelector } from '@/components/dashboard/account-selector';

// ── Types ──────────────────────────────────────────────────────────────

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
  return (
    <div className="mb-6 flex flex-wrap items-end gap-4">
      {/* Date From */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="filter-date-from"
          className="text-xs font-medium text-zinc-600 dark:text-zinc-300"
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
          className="text-xs font-medium text-zinc-600 dark:text-zinc-300"
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
          className="text-xs font-medium text-zinc-600 dark:text-zinc-300"
        >
          Account
        </label>
        <AccountSelector
          value={accountId}
          onValueChange={onAccountIdChange}
          className="w-40"
        />
      </div>
    </div>
  );
}
