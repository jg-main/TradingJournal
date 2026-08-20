'use client';

import React, { useEffect, useState } from 'react';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DatePreset, AccountScopeMode, PerformanceUnit } from '@/lib/performance-view-types';

// ── Account Shape (matches GET /api/accounts) ───────────────────────────────

export interface FilterBarAccount {
  id: string;
  name: string;
  broker: string | null;
  currency: string | null;
  isActive: boolean | number;
}

// ── Option Catalogues ───────────────────────────────────────────────────────

const ACCOUNT_SCOPE_OPTIONS: Array<{ value: AccountScopeMode; label: string }> = [
  { value: 'all', label: 'All Accounts' },
  { value: 'single', label: 'Single Account' },
  { value: 'multiple', label: 'Multiple Accounts' },
];

const DATE_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: 'Whole period', label: 'Whole Period' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1 Year' },
  { value: '6M', label: '6 Months' },
  { value: '3M', label: '3 Months' },
  { value: '1M', label: '1 Month' },
  { value: 'Custom', label: 'Custom' },
];

const UNIT_OPTIONS: Array<{ value: PerformanceUnit; label: string }> = [
  { value: 'currency', label: '$' },
  { value: 'percent', label: '%' },
  { value: 'r', label: 'R' },
];

// ── Date Preset Helpers ─────────────────────────────────────────────────────

function presetToDateRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();

  switch (preset) {
    case 'Whole period':
      return { from: '', to: '' };
    case 'YTD':
      return { from: `${now.getFullYear()}-01-01`, to: '' };
    case '1Y': {
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(now.getFullYear() - 1);
      return { from: oneYearAgo.toISOString().split('T')[0], to: '' };
    }
    case '6M': {
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(now.getMonth() - 6);
      return { from: sixMonthsAgo.toISOString().split('T')[0], to: '' };
    }
    case '3M': {
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(now.getMonth() - 3);
      return { from: threeMonthsAgo.toISOString().split('T')[0], to: '' };
    }
    case '1M': {
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setMonth(now.getMonth() - 1);
      return { from: oneMonthAgo.toISOString().split('T')[0], to: '' };
    }
    case 'Custom':
      return { from: '', to: '' };
    default:
      return { from: '', to: '' };
  }
}

// ── Filter Bar Component ────────────────────────────────────────────────────

/**
 * Global filter bar for the Performance dashboard.
 *
 * Owns no state of its own beyond transient UI (account list + custom range
 * inputs); every filter decision is pushed into the shared
 * PerformanceDashboardContext so the KPI row and chart grid react together.
 *
 * Controls are TradingJournal primitives (Select/Button/Input) at the
 * --density-control-h-lg (36px) height — the sizing that lands inside the
 * R002 34-36px control-height window at 1440px (the default 32px and sm 28px
 * token values both sit below it).
 *
 * States:
 * - Accounts: scope mode (all/single/multiple) + an account picker for
 *   single/multiple modes, populated from GET /api/accounts. Loading shows a
 *   placeholder; a failed account fetch degrades to an inline error while the
 *   rest of the bar keeps working (all-accounts mode is still usable).
 * - Period: relative presets + Custom with from/to date inputs and Apply.
 * - Unit: $/%/R presentation toggle (client-side only — never refetches).
 */
export function PerformanceFilterBar() {
  const { filter, setAccountScope, setDateRange, setUnit } = usePerformanceDashboard();
  const [customFrom, setCustomFrom] = useState(filter.dateRange.from);
  const [customTo, setCustomTo] = useState(filter.dateRange.to);

  // Account list for the single/multiple pickers.
  const [accounts, setAccounts] = useState<FilterBarAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountsLoading(true);
    setAccountsError(null);

    fetch('/api/accounts')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load accounts');
        return res.json() as Promise<FilterBarAccount[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setAccounts(data);
        setAccountsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setAccountsError(err instanceof Error ? err.message : 'Failed to load accounts');
        setAccountsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePresetChange = (preset: DatePreset) => {
    if (preset === 'Custom') {
      setDateRange({ preset: 'Custom', from: customFrom, to: customTo });
    } else {
      const range = presetToDateRange(preset);
      setDateRange({ preset, ...range });
    }
  };

  const handleAccountModeChange = (mode: AccountScopeMode) => {
    if (mode === 'all') {
      setAccountScope({ mode: 'all', accountIds: [] });
      return;
    }
    // Preserve existing ids when they are still valid for this mode; otherwise
    // default to the first account so a single/multiple scope is immediately
    // actionable instead of erroring with an empty accountIds list.
    const existing = filter.accountScope.accountIds.filter((id) => accounts.some((a) => a.id === id));
    const ids =
      existing.length > 0
        ? existing
        : accounts.length > 0
          ? mode === 'single'
            ? [accounts[0].id]
            : [accounts[0].id]
          : [];
    setAccountScope({ mode, accountIds: ids });
  };

  const handleUnitChange = (unit: PerformanceUnit) => {
    setUnit(unit);
  };

  const handleCustomDateApply = () => {
    setDateRange({ preset: 'Custom', from: customFrom, to: customTo });
  };

  const toggleAccount = (id: string) => {
    const current = filter.accountScope.accountIds;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setAccountScope({ mode: 'multiple', accountIds: next });
  };

  // Mixed-currency warning: only when the concrete selection spans >1 currency.
  const selectedCurrencies = new Set(
    filter.accountScope.accountIds
      .map((id) => accounts.find((a) => a.id === id)?.currency)
      .filter((c): c is string => Boolean(c)),
  );
  const mixedCurrencies = filter.accountScope.mode !== 'all' && selectedCurrencies.size > 1;

  const accountsAvailable = !accountsLoading && !accountsError && accounts.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-border bg-card">
      {/* Account Scope */}
      <div className="flex items-center gap-2">
        <label htmlFor="perf-account-scope" className="text-sm font-medium text-muted-foreground">
          Accounts:
        </label>
        <Select
          value={filter.accountScope.mode}
          onValueChange={(v) => handleAccountModeChange(v as AccountScopeMode)}
        >
          <SelectTrigger id="perf-account-scope" size="lg" aria-label="Account scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCOUNT_SCOPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filter.accountScope.mode === 'single' && (
          <Select
            value={filter.accountScope.accountIds[0] ?? ''}
            onValueChange={(v) => setAccountScope({ mode: 'single', accountIds: [v] })}
          >
            <SelectTrigger
              size="lg"
              aria-label="Select account"
              data-testid="account-single-select"
              disabled={!accountsAvailable}
            >
              <SelectValue
                placeholder={
                  accountsLoading ? 'Loading accounts…' : accountsError ? 'Accounts unavailable' : 'Select account'
                }
              />
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

        {filter.accountScope.mode === 'multiple' && (
          <div className="flex items-center gap-3 text-sm" data-testid="account-multi-select">
            {accountsLoading ? (
              <span className="text-xs text-muted-foreground">Loading accounts…</span>
            ) : accountsError ? (
              <span className="text-xs text-destructive">{accountsError}</span>
            ) : (
              accounts.map((acc) => (
                <label key={acc.id} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filter.accountScope.accountIds.includes(acc.id)}
                    onChange={() => toggleAccount(acc.id)}
                    className="size-4 accent-primary"
                  />
                  {acc.name}
                </label>
              ))
            )}
          </div>
        )}
      </div>

      {/* Date Range Presets */}
      <div className="flex items-center gap-2">
        <label htmlFor="perf-date-period" className="text-sm font-medium text-muted-foreground">
          Period:
        </label>
        <Select value={filter.dateRange.preset} onValueChange={(v) => handlePresetChange(v as DatePreset)}>
          <SelectTrigger id="perf-date-period" size="lg" aria-label="Date period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESET_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Custom Date Range (shown when Custom is selected) */}
      {filter.dateRange.preset === 'Custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-(--density-control-h-lg) w-auto"
            aria-label="Custom from date"
            placeholder="From"
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-(--density-control-h-lg) w-auto"
            aria-label="Custom to date"
            placeholder="To"
          />
          <Button type="button" size="lg" onClick={handleCustomDateApply}>
            Apply
          </Button>
        </div>
      )}

      {/* Performance Unit */}
      <div className="flex items-center gap-2">
        <span id="perf-unit-label" className="text-sm font-medium text-muted-foreground">
          Unit:
        </span>
        <div
          role="group"
          aria-labelledby="perf-unit-label"
          className="flex rounded-lg border border-border overflow-hidden"
        >
          {UNIT_OPTIONS.map((opt, index) => {
            const active = filter.unit === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                size="lg"
                variant={active ? 'default' : 'outline'}
                aria-pressed={active}
                className={cn(
                  'rounded-none px-3',
                  index > 0 ? 'border-0 border-l border-border' : 'border-0',
                )}
                onClick={() => handleUnitChange(opt.value)}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Mixed Currency Warning */}
      {mixedCurrencies && (
        <div className="ml-auto text-xs text-warning" data-testid="mixed-currency-warning">
          Note: Multi-account aggregation uses USD only
        </div>
      )}
    </div>
  );
}
