'use client';

import React, { useEffect, useState } from 'react';
import { usePerformanceDashboard } from '@/hooks/use-performance-dashboard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SlidersHorizontalIcon } from 'lucide-react';
import type {
  PerformanceUnit,
  AdvancedFilters,
} from '@/lib/performance-view-types';

// ── Option Catalogues ───────────────────────────────────────────────────────

const UNIT_OPTIONS: Array<{ value: PerformanceUnit; label: string }> = [
  { value: 'currency', label: '$' },
  { value: 'percent', label: '%' },
  { value: 'r', label: 'R' },
];

// ── Advanced-Filter Dimensions (Filters popover) ───────────────────────────

/** Row shape from GET /api/lookups?type=setup (id = setup UUID, value = name). */
export interface SetupLookupRow {
  id: string;
  value: string;
}

const DIRECTION_OPTIONS: Array<{ value: 'long' | 'short'; label: string }> = [
  { value: 'long', label: 'Long' },
  { value: 'short', label: 'Short' },
];

const TRADE_RESULT_OPTIONS: Array<{ value: 'win' | 'loss' | 'scratch'; label: string }> = [
  { value: 'win', label: 'Winner' },
  { value: 'loss', label: 'Loser' },
  { value: 'scratch', label: 'Scratch' },
];

/** Checkbox row used inside the Filters popover (matches the account multi-picker style). */
function AdvancedFilterCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-primary"
        checked={checked}
        onChange={onChange}
      />
      <span className="truncate">{children}</span>
    </label>
  );
}

/** One dimension group (fieldset) inside the Filters popover. */
function FilterDimensionSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

// ── Filter Bar Component ────────────────────────────────────────────────────

/**
 * Global filter bar for the Performance dashboard.
 *
 * Owns no state of its own beyond transient UI (custom-range inputs for the
 * advanced Filters popover is not present here); every filter decision is
 * pushed into the shared PerformanceDashboardContext so the KPI row and chart
 * grid react together.
 *
 * Controls are TradingJournal primitives (Select/Button/Input) at the
 * --density-control-h-lg (36px) height — the sizing that lands inside the
 * R002 34-36px control-height window at 1440px (the default 32px and sm 28px
 * token values both sit below it).
 *
 * M004/T9C: the analytical PERIOD is NOT here. The global operational period
 * (OperationalDateRangeProvider / sidebar Period selector) is the sole date
 * owner; Performance's analytics derive their dates from its resolved range.
 * This bar contains only page-local controls: advanced filters and unit.
 *
 * States:
 * - Account scope: the sidebar AccountProvider is the sole account owner
 *   (M007/D037) — this bar renders NO account selector and never fetches
 *   /api/accounts. Every analytics request is scoped to the global account.
 * - Period: NOT here — the global operational period owns Performance dates.
 * - Unit: $/%/R presentation toggle (client-side only — never refetches).
 */
export function PerformanceFilterBar() {
  const { filter, setUnit, setAdvancedFilters, analyticsData } =
    usePerformanceDashboard();

  // Setup options for the Filters popover (GET /api/lookups?type=setup).
  const [setupOptions, setSetupOptions] = useState<SetupLookupRow[]>([]);
  const [setupOptionsLoading, setSetupOptionsLoading] = useState(true);
  const [setupOptionsError, setSetupOptionsError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/lookups?type=setup')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load setups');
        return res.json() as Promise<SetupLookupRow[]>;
      })
      .then((rows) => {
        if (cancelled) return;
        // Guard against malformed/non-array responses (e.g. an error envelope
        // that slips past the ok check) so the Setup dimension never crashes.
        setSetupOptions(Array.isArray(rows) ? rows : []);
        setSetupOptionsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSetupOptionsError(true);
        setSetupOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleUnitChange = (unit: PerformanceUnit) => {
    setUnit(unit);
  };

  // ── Advanced filters (Filters popover) ──────────────────────────────────
  // Each checkbox toggle commits immediately to the shared context so every
  // widget reacts through the single debounced analytics fetch — no per-widget
  // fetching. buildQueryParams serializes the dimension into the query string.
  const setAdvancedDimension = <K extends keyof AdvancedFilters>(
    dimension: K,
    value: AdvancedFilters[K][number],
  ) => {
    // Indexing a union of array types makes .includes/.filter infer a `never`
    // parameter, so pin the element type explicitly before mutating.
    const current = filter.advancedFilters[dimension] as unknown as AdvancedFilters[K][number][];
    const next = (
      current.includes(value)
        ? current.filter((x) => x !== value)
        : [...current, value]
    ) as AdvancedFilters[K];
    setAdvancedFilters({ ...filter.advancedFilters, [dimension]: next });
  };

  const clearAdvancedFilters = () => {
    setAdvancedFilters({ setupIds: [], directions: [], symbols: [], tradeResults: [] });
  };

  const activeFilterCount =
    filter.advancedFilters.setupIds.length +
    filter.advancedFilters.directions.length +
    filter.advancedFilters.symbols.length +
    filter.advancedFilters.tradeResults.length;

  // Symbol facet comes from the analytics metadata (distinct symbols in the
  // current scope, stable under the symbol filter itself).
  const symbolOptions = analyticsData?.metadata.distinctSymbols ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      {/* Account scope is owned by the sidebar AccountProvider (M007/D037)
          and the analytical PERIOD by the global OperationalDateRangeProvider
          (sidebar Period selector, M004/T9C) — neither lives here. The bar
          offers only page-local controls: advanced filters and unit. */}

      {/* Filters (advanced dimensions: Setup / Direction / Symbol / Trade Result) */}
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="lg"
              aria-label="Performance filters"
              aria-haspopup="dialog"
              data-testid="filters-trigger"
              className="gap-1.5"
            >
              <SlidersHorizontalIcon />
              Filters
              {activeFilterCount > 0 && (
                <Badge
                  data-testid="filters-active-count"
                  className="ml-0.5 h-5 min-w-5 justify-center rounded-4xl px-1.5"
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={8} className="w-80">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-heading text-sm font-medium">Filters</h3>
              <span className="text-xs text-muted-foreground" data-testid="filters-summary">
                {activeFilterCount > 0 ? `${activeFilterCount} active` : 'No active filters'}
              </span>
            </div>

            <div className="grid max-h-80 grid-cols-2 gap-x-4 gap-y-4 overflow-y-auto pr-1">
              <FilterDimensionSection title="Setup">
                {setupOptionsLoading ? (
                  <p className="text-xs text-muted-foreground">Loading setups…</p>
                ) : setupOptionsError ? (
                  <p className="text-xs text-muted-foreground">Setups unavailable</p>
                ) : setupOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No setups</p>
                ) : (
                  <div className="space-y-1">
                    {setupOptions.map((s) => (
                      <AdvancedFilterCheckbox
                        key={s.id}
                        checked={filter.advancedFilters.setupIds.includes(s.id)}
                        onChange={() => setAdvancedDimension('setupIds', s.id)}
                      >
                        {s.value}
                      </AdvancedFilterCheckbox>
                    ))}
                  </div>
                )}
              </FilterDimensionSection>

              <FilterDimensionSection title="Direction">
                <div className="space-y-1">
                  {DIRECTION_OPTIONS.map((d) => (
                    <AdvancedFilterCheckbox
                      key={d.value}
                      checked={filter.advancedFilters.directions.includes(d.value)}
                      onChange={() => setAdvancedDimension('directions', d.value)}
                    >
                      {d.label}
                    </AdvancedFilterCheckbox>
                  ))}
                </div>
              </FilterDimensionSection>

              <FilterDimensionSection title="Symbol">
                {symbolOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {analyticsData ? 'No symbols in period' : 'Loading symbols…'}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {symbolOptions.map((sym) => (
                      <AdvancedFilterCheckbox
                        key={sym}
                        checked={filter.advancedFilters.symbols.includes(sym)}
                        onChange={() => setAdvancedDimension('symbols', sym)}
                      >
                        {sym}
                      </AdvancedFilterCheckbox>
                    ))}
                  </div>
                )}
              </FilterDimensionSection>

              <FilterDimensionSection title="Trade Result">
                <div className="space-y-1">
                  {TRADE_RESULT_OPTIONS.map((r) => (
                    <AdvancedFilterCheckbox
                      key={r.value}
                      checked={filter.advancedFilters.tradeResults.includes(r.value)}
                      onChange={() => setAdvancedDimension('tradeResults', r.value)}
                    >
                      {r.label}
                    </AdvancedFilterCheckbox>
                  ))}
                </div>
              </FilterDimensionSection>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Applies to all widgets</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAdvancedFilters}
                data-testid="filters-clear"
              >
                Clear all
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Performance Unit — segmented $/%/R; accessible name via aria-label
          (the visible 'Unit:' form label is gone, CT7). */}
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label="Performance unit"
          className="flex h-(--density-control-h-lg) rounded-lg border border-border overflow-hidden"
        >
          {UNIT_OPTIONS.map((opt, index) => {
            const active = filter.unit === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                variant={active ? 'default' : 'outline'}
                aria-pressed={active}
                className={cn(
                  'h-full rounded-none px-3',
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

    </div>
  );
}
