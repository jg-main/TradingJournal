'use client';

import { RefreshCw } from 'lucide-react';
import { AccountSelector } from '@/components/dashboard/account-selector';
import { ViewSwitcher } from '@/components/dashboard/view-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import type { DashboardView } from '@/types/dashboard-view';
import type { DatePreset } from '@/components/dashboard/filter-context';

// ── Date Presets ───────────────────────────────────────────────────────

const DATE_PRESETS: { label: string; preset: DatePreset }[] = [
  { label: '1W', preset: '1W' },
  { label: '1M', preset: '1M' },
  { label: '3M', preset: '3M' },
  { label: '6M', preset: '6M' },
  { label: 'YTD', preset: 'YTD' },
  { label: 'All', preset: 'All' },
];

// ── Types ──────────────────────────────────────────────────────────────

export interface DashboardToolbarProps {
  // Date filters
  dateFrom: string;
  dateTo: string;
  accountId: string | null;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onAccountIdChange: (v: string | null) => void;
  onDatePreset: (preset: DatePreset) => void;

  // View switcher
  views: DashboardView[];
  activeViewId: string;
  onSelectView: (id: string) => void;
  onCreateView: (name: string) => void;
  onManageViews: () => void;
  writeFailed?: boolean;

  // Customization mode
  isCustomizing: boolean;
  onEnterCustomization: () => void;
  onSaveCustomization: () => void;
  onCancelCustomization: () => void;
  onResetLayout: () => void;
  onAddWidget: () => void;

  // Refresh prices
  refreshing: boolean;
  cooldownSeconds: number;
  onRefreshPrices: () => void;
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Unified dashboard toolbar that consolidates all page-level controls
 * into one compact row.
 *
 * Contains: title, date inputs, date presets, account selector,
 * view switcher, Edit Layout (with customization buttons),
 * Refresh Prices, and ThemeToggle.
 *
 * Renders inside a flex-wrap container so it adapts to narrow viewports.
 * Items use compact sizing (h-7, text-xs) to keep the row under 56px.
 */
export function DashboardToolbar({
  dateFrom,
  dateTo,
  accountId,
  onDateFromChange,
  onDateToChange,
  onAccountIdChange,
  onDatePreset,
  views,
  activeViewId,
  onSelectView,
  onCreateView,
  onManageViews,
  writeFailed,
  isCustomizing,
  onEnterCustomization,
  onSaveCustomization,
  onCancelCustomization,
  onResetLayout,
  onAddWidget,
  refreshing,
  cooldownSeconds,
  onRefreshPrices,
}: DashboardToolbarProps) {
  const isCooldownActive = cooldownSeconds > 0;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 py-1.5"
      data-testid="dashboard-toolbar"
    >
      {/* Title */}
      <h1
        className="mr-0.5 shrink-0 text-lg font-semibold tracking-tight text-foreground [text-wrap:balance]"
        data-testid="toolbar-title"
      >
        Dashboard
      </h1>

      {/* Date From */}
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => onDateFromChange(e.target.value)}
        aria-label="From date"
        data-testid="toolbar-date-from"
        className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 [color-scheme:light] dark:[color-scheme:dark]"
      />

      {/* Date To */}
      <input
        type="date"
        value={dateTo}
        onChange={(e) => onDateToChange(e.target.value)}
        aria-label="To date"
        data-testid="toolbar-date-to"
        className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 [color-scheme:light] dark:[color-scheme:dark]"
      />

      {/* Account Selector */}
      <AccountSelector
        value={accountId}
        onValueChange={onAccountIdChange}
        className="h-7 w-32 text-xs"
      />

      {/* Date Presets */}
      <div className="flex items-center gap-0.5">
        {DATE_PRESETS.map(({ label, preset }) => (
          <button
            key={label}
            onClick={() => onDatePreset(preset)}
            data-testid={`toolbar-preset-${label.toLowerCase()}`}
            className="rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {label}
          </button>
        ))}
      </div>

      {/* View Switcher */}
      <ViewSwitcher
        views={views}
        activeViewId={activeViewId}
        onSelectView={onSelectView}
        onCreateView={onCreateView}
        onManageViews={onManageViews}
        writeFailed={writeFailed}
      />

      {/* Customization / Edit Layout area */}
      {isCustomizing ? (
        <>
          <button
            onClick={onAddWidget}
            data-testid="toolbar-add-widget"
            className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Add Widget
          </button>
          <button
            onClick={onSaveCustomization}
            data-testid="toolbar-save-layout"
            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Save
          </button>
          <button
            onClick={onCancelCustomization}
            data-testid="toolbar-cancel-layout"
            className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onResetLayout}
            data-testid="toolbar-reset-layout"
            className="rounded-md border border-destructive/40 bg-card px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            Reset
          </button>
        </>
      ) : (
        <button
          onClick={onEnterCustomization}
          data-testid="toolbar-edit-layout"
          className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          Edit Layout
        </button>
      )}

      {/* Refresh Prices */}
      <button
        onClick={onRefreshPrices}
        disabled={refreshing || isCooldownActive}
        data-testid="toolbar-refresh-prices"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw
          className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
        />
        {isCooldownActive ? `${cooldownSeconds}s` : 'Refresh'}
      </button>

      {/* Theme Toggle */}
      <ThemeToggle />
    </div>
  );
}
