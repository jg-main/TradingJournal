'use client';

import React, { useState } from 'react';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import type { DatePreset, AccountScopeMode, PerformanceUnit } from '@/lib/performance-view-types';

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

export function PerformanceFilterBar() {
  const { filter, setAccountScope, setDateRange, setUnit } = usePerformanceDashboard();
  const [customFrom, setCustomFrom] = useState(filter.dateRange.from);
  const [customTo, setCustomTo] = useState(filter.dateRange.to);

  const handlePresetChange = (preset: DatePreset) => {
    if (preset === 'Custom') {
      setDateRange({ preset: 'Custom', from: customFrom, to: customTo });
    } else {
      const range = presetToDateRange(preset);
      setDateRange({ preset, ...range });
    }
  };

  const handleAccountScopeChange = (mode: AccountScopeMode) => {
    setAccountScope({ mode, accountIds: [] });
  };

  const handleUnitChange = (unit: PerformanceUnit) => {
    setUnit(unit);
  };

  const handleCustomDateApply = () => {
    setDateRange({ preset: 'Custom', from: customFrom, to: customTo });
  };

  return (
    <div className="ws-filter-bar flex flex-wrap items-center gap-3 px-4 py-2 border-b border-border bg-card">
      {/* Account Scope */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Accounts:</label>
        <select
          value={filter.accountScope.mode}
          onChange={(e) => handleAccountScopeChange(e.target.value as AccountScopeMode)}
          className="ws-select text-sm rounded-md border border-border bg-background px-2 py-1"
        >
          <option value="all">All Accounts</option>
          <option value="single">Single Account</option>
          <option value="multiple">Multiple Accounts</option>
        </select>
      </div>

      {/* Date Range Presets */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Period:</label>
        <select
          value={filter.dateRange.preset}
          onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
          className="ws-select text-sm rounded-md border border-border bg-background px-2 py-1"
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
            placeholder="From"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="ws-input text-sm rounded-md border border-border bg-background px-2 py-1"
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
          >
            R
          </button>
        </div>
      </div>

      {/* Mixed Currency Warning */}
      {filter.accountScope.mode !== 'all' && (
        <div className="ml-auto text-xs text-warning">
          Note: Multi-account aggregation uses USD only
        </div>
      )}
    </div>
  );
}
