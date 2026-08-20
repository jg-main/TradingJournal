'use client';

import React, { useEffect, useState } from 'react';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import type { DatePreset, AccountScopeMode, PerformanceUnit } from '@/lib/performance-view-types';

// ── Account Shape (matches GET /api/accounts) ───────────────────────────────

export interface FilterBarAccount {
  id: string;
  name: string;
  broker: string | null;
  currency: string | null;
  isActive: boolean | number;
}

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
 * States:
 * - Accounts: scope mode (all/single/multiple) + an account picker for
 *   single/multiple modes, populated from GET /api/accounts. Loading shows a
 *   skeleton; a failed account fetch degrades to an inline error while the
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

  return (
    <div className="ws-filter-bar flex flex-wrap items-center gap-3 px-4 py-2 border-b border-border bg-card">
      {/* Account Scope */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Accounts:</label>
        <select
          value={filter.accountScope.mode}
          onChange={(e) => handleAccountModeChange(e.target.value as AccountScopeMode)}
          className="ws-select text-sm rounded-md border border-border bg-background px-2 py-1"
          aria-label="Account scope"
        >
          <option value="all">All Accounts</option>
          <option value="single">Single Account</option>
          <option value="multiple">Multiple Accounts</option>
        </select>

        {filter.accountScope.mode === 'single' && (
          <select
            value={filter.accountScope.accountIds[0] ?? ''}
            onChange={(e) => setAccountScope({ mode: 'single', accountIds: [e.target.value] })}
            className="ws-select text-sm rounded-md border border-border bg-background px-2 py-1"
            aria-label="Select account"
            data-testid="account-single-select"
          >
            {accountsLoading ? (
              <option value="">Loading accounts…</option>
            ) : accountsError ? (
              <option value="">Accounts unavailable</option>
            ) : (
              accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                  {acc.broker ? ` (${acc.broker})` : ''}
                </option>
              ))
            )}
          </select>
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
                    className="ws-checkbox accent-primary"
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
        <label className="text-sm font-medium text-muted-foreground">Period:</label>
        <select
          value={filter.dateRange.preset}
          onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
          className="ws-select text-sm rounded-md border border-border bg-background px-2 py-1"
          aria-label="Date period"
        >
          <option value="Whole period">Whole Period</option>
          <option value="YTD">YTD</option>
          <option value="1Y">1 Year</option>
          <option value="6M">6 Months</option>
          <option value="3M">3 Months</option>
          <option value="1M">1 Month</option>
          <option value="Custom">Custom</option>
        </select>
      </div>

      {/* Custom Date Range (shown when Custom is selected) */}
      {filter.dateRange.preset === 'Custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="ws-input text-sm rounded-md border border-border bg-background px-2 py-1"
            aria-label="Custom from date"
            placeholder="From"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="ws-input text-sm rounded-md border border-border bg-background px-2 py-1"
            aria-label="Custom to date"
            placeholder="To"
          />
          <button
            onClick={handleCustomDateApply}
            className="ws-button text-sm rounded-md bg-primary text-primary-foreground px-3 py-1 hover:bg-primary/90"
          >
            Apply
          </button>
        </div>
      )}

      {/* Performance Unit */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Unit:</label>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => handleUnitChange('currency')}
            className={`text-sm px-3 py-1 ${
              filter.unit === 'currency'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-foreground hover:bg-muted'
            }`}
            aria-pressed={filter.unit === 'currency'}
          >
            $
          </button>
          <button
            onClick={() => handleUnitChange('percent')}
            className={`text-sm px-3 py-1 border-l border-border ${
              filter.unit === 'percent'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-foreground hover:bg-muted'
            }`}
            aria-pressed={filter.unit === 'percent'}
          >
            %
          </button>
          <button
            onClick={() => handleUnitChange('r')}
            className={`text-sm px-3 py-1 border-l border-border ${
              filter.unit === 'r'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-foreground hover:bg-muted'
            }`}
            aria-pressed={filter.unit === 'r'}
          >
            R
          </button>
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
