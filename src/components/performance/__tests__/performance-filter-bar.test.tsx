/**
 * Tests for PerformanceFilterBar (M004/T9C).
 *
 * Covers: control rendering (page-local advanced filters + unit only — the
 * global period lives in the sidebar), $/%/R unit toggle, advanced filters,
 * and the Fix 4 contract — the bar renders NO account selector (the sidebar
 * AccountProvider is the sole account owner), NO period selector, and never
 * fetches /api/accounts.
 *
 * Run: npx vitest run src/components/performance/__tests__/performance-filter-bar.test.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PerformanceFilterBar } from '../performance-filter-bar';
import { PerformanceDashboardProvider, usePerformanceDashboard } from '@/hooks/use-performance-dashboard';

// Canonical account scope (M007/D037 / Fix 4): the sidebar AccountProvider is
// the sole account owner — a resolved global account (acc-001) is mocked.
vi.mock('@/lib/account-context', () => ({
  useAccount: () => ({
    accounts: [
      { id: 'acc-001', name: 'Cash USD', broker: 'IBKR', currency: 'USD', isActive: true },
    ],
    loading: false,
    error: null,
    accountId: 'acc-001',
    setAccountId: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Canonical global operational period (M004/T9C): the sidebar Period selector
// owns it. The filter bar must never touch the provider setters.
const mockPeriod = vi.hoisted(() => ({
  selection: { preset: 'YTD' as string, from: '' as string, to: '' as string },
  resolvedRange: { from: '' as string, to: '' as string },
  hydrated: true,
  setPreset: vi.fn(),
  setCustomRange: vi.fn(),
}));
vi.mock('@/lib/operational-date-range-context', () => ({
  useOperationalDateRange: () => mockPeriod,
}));

// jsdom does not implement Element.prototype.scrollIntoView; Radix Select calls
// it when opening its option list, so stub it out (matches the repo pattern in
// plan-trade-form.test.tsx and watchlist-panel.test.tsx).
Element.prototype.scrollIntoView = () => {};

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures & helpers
// ═══════════════════════════════════════════════════════════════════════════

const ACCOUNTS = [
  { id: 'acc-usd', name: 'Cash USD', broker: 'IBKR', currency: 'USD', isActive: true },
  { id: 'acc-eur', name: 'Cash EUR', broker: 'IBKR', currency: 'EUR', isActive: true },
];

/** Rows returned by GET /api/lookups?type=setup. */
const SETUPS = [
  { id: 'setup-breakout', value: 'Breakout' },
  { id: 'setup-pullback', value: 'Pullback' },
];

/** Default /api/performance/analytics body incl. the distinct-symbol facet. */
const ANALYTICS_BODY = {
  kpiMetrics: {},
  charts: {},
  metadata: {
    accountCount: 1,
    mixedCurrencies: false,
    tradeCount: 0,
    dateRange: { from: null, to: null },
    distinctSymbols: ['AAPL', 'NVDA'],
  },
};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

/** Probe that renders the live filter state so tests can assert context updates. */
function FilterProbe() {
  const { filter } = usePerformanceDashboard();
  return (
    <pre data-testid="filter-probe">
      {JSON.stringify({
        mode: filter.accountScope.mode,
        accountIds: filter.accountScope.accountIds,
        unit: filter.unit,
        advancedFilters: filter.advancedFilters,
      })}
    </pre>
  );
}

function renderBar() {
  return render(
    <PerformanceDashboardProvider>
      <PerformanceFilterBar />
      <FilterProbe />
    </PerformanceDashboardProvider>,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('PerformanceFilterBar', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string) => {
        if (url.startsWith('/api/lookups')) {
          return Promise.resolve(okResponse(SETUPS));
        }
        return Promise.resolve(okResponse(ANALYTICS_BODY));
      });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    globalThis.fetch = originalFetch;
  });

  /** Flush the debounced analytics fetch and the accounts fetch. */
  async function flushAsync() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  /** Read the live filter state from the probe. */
  function probe(): Record<string, unknown> {
    return JSON.parse(screen.getByTestId('filter-probe').textContent ?? '{}');
  }

  /** Read the committed advanced filters (typed). */
  function advancedProbe(): {
    setupIds: string[];
    directions: string[];
    symbols: string[];
    tradeResults: string[];
  } {
    return (probe().advancedFilters ?? {}) as unknown as {
      setupIds: string[];
      directions: string[];
      symbols: string[];
      tradeResults: string[];
    };
  }

  it('renders the compact toolbar with accessible names and no visible form labels', async () => {
    renderBar();
    // CT7: the redundant visible form labels are gone…
    expect(screen.queryByText('Accounts:')).toBeNull();
    expect(screen.queryByText('Period:')).toBeNull();
    expect(screen.queryByText('Unit:')).toBeNull();
    // Fix 4: NO account selector exists — the sidebar is the account owner.
    expect(screen.queryByRole('combobox', { name: 'Performance accounts' })).toBeNull();
    expect(screen.queryByTestId('account-single-select')).toBeNull();
    expect(screen.queryByTestId('account-multi-select')).toBeNull();
    // M004/T9C: NO period selector or Custom date inputs — the sidebar Period
    // selector owns the analytical period.
    expect(screen.queryByRole('combobox', { name: 'Performance period' })).toBeNull();
    expect(screen.queryByLabelText('Custom from date')).toBeNull();
    expect(screen.queryByLabelText('Custom to date')).toBeNull();
    expect(screen.queryByText('Apply')).toBeNull();
    expect(screen.getByRole('button', { name: 'Performance filters' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Performance unit' })).toBeDefined();
    // Default unit is currency ($ pressed).
    expect(screen.getByRole('button', { name: '$' }).getAttribute('aria-pressed')).toBe('true');
    await flushAsync();
  });

  it('never calls a global Period setter (sidebar owns the period)', async () => {
    renderBar();
    await flushAsync();
    expect(mockPeriod.setPreset).not.toHaveBeenCalled();
    expect(mockPeriod.setCustomRange).not.toHaveBeenCalled();
  });

  it('toggles the presentation unit without touching the query', async () => {
    renderBar();
    await flushAsync();

    fireEvent.click(screen.getByRole('button', { name: '%' }));
    expect(probe().unit).toBe('percent');

    fireEvent.click(screen.getByRole('button', { name: 'R' }));
    expect(probe().unit).toBe('r');

    // Unit is presentation-only: advancing past the debounce window must not
    // schedule a second analytics fetch (identical serialized query).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const analyticsCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[0] as string).startsWith('/api/performance/analytics'),
    );
    expect(analyticsCalls).toHaveLength(1);
  });

  it('never fetches /api/accounts (AccountProvider owns the catalogue)', async () => {
    renderBar();
    await flushAsync();
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('/api/accounts'))).toBe(false);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Filters popover (advanced dimensions)
  // ═════════════════════════════════════════════════════════════════════════

  describe('Filters popover (advanced dimensions)', () => {
    /** Open the Filters popover by clicking its trigger button. */
    async function openFilters() {
      fireEvent.click(screen.getByRole('button', { name: 'Performance filters' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    it('opens a lightweight popover with Setup, Direction, Symbol and Trade Result dimensions', async () => {
      renderBar();
      await flushAsync();

      // No active filters → no count badge on the trigger.
      expect(screen.queryByTestId('filters-active-count')).toBeNull();

      await openFilters();

      // Four dimension groups.
      expect(screen.getByText('Setup')).toBeDefined();
      expect(screen.getByText('Direction')).toBeDefined();
      expect(screen.getByText('Symbol')).toBeDefined();
      expect(screen.getByText('Trade Result')).toBeDefined();

      // Setup options come from /api/lookups?type=setup (names → IDs).
      expect(screen.getByRole('checkbox', { name: 'Breakout' })).toBeDefined();
      expect(screen.getByRole('checkbox', { name: 'Pullback' })).toBeDefined();
      // Direction options are the fixed long/short pair.
      expect(screen.getByRole('checkbox', { name: 'Long' })).toBeDefined();
      expect(screen.getByRole('checkbox', { name: 'Short' })).toBeDefined();
      // Symbol options come from the analytics metadata facet.
      expect(screen.getByRole('checkbox', { name: 'AAPL' })).toBeDefined();
      expect(screen.getByRole('checkbox', { name: 'NVDA' })).toBeDefined();
      // Trade result options are the fixed win/loss/scratch triple.
      expect(screen.getByRole('checkbox', { name: 'Winner' })).toBeDefined();
      expect(screen.getByRole('checkbox', { name: 'Loser' })).toBeDefined();
      expect(screen.getByRole('checkbox', { name: 'Scratch' })).toBeDefined();
    });

    it('commits each dimension selection to the shared advanced filters', async () => {
      renderBar();
      await flushAsync();
      await openFilters();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Long' }));
      expect(advancedProbe().directions).toEqual(['long']);

      fireEvent.click(screen.getByRole('checkbox', { name: 'Breakout' }));
      expect(advancedProbe().setupIds).toEqual(['setup-breakout']);

      fireEvent.click(screen.getByRole('checkbox', { name: 'AAPL' }));
      expect(advancedProbe().symbols).toEqual(['AAPL']);

      fireEvent.click(screen.getByRole('checkbox', { name: 'Winner' }));
      expect(advancedProbe().tradeResults).toEqual(['win']);

      // Active-count badge + summary reflect the committed selections.
      expect(screen.getByTestId('filters-active-count').textContent).toBe('4');
      expect(screen.getByTestId('filters-summary').textContent).toContain('4 active');
    });

    it('unchecks a selected dimension by toggling the same checkbox', async () => {
      renderBar();
      await flushAsync();
      await openFilters();

      const long = screen.getByRole('checkbox', { name: 'Long' });
      fireEvent.click(long);
      expect(advancedProbe().directions).toEqual(['long']);
      fireEvent.click(long);
      expect(advancedProbe().directions).toEqual([]);
    });

    it('pushes advanced filter selections into the analytics query params', async () => {
      renderBar();
      await flushAsync();
      await openFilters();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Long' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Winner' }));
      await flushAsync(); // advance past the debounced analytics fetch

      const analyticsCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0] as string)
        .filter((u) => u.startsWith('/api/performance/analytics'));
      const last = analyticsCalls[analyticsCalls.length - 1];
      expect(last).toContain('directions=long');
      expect(last).toContain('tradeResults=win');
    });

    it('Clear all resets every dimension and hides the badge', async () => {
      renderBar();
      await flushAsync();
      await openFilters();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Long' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Breakout' }));
      expect(screen.getByTestId('filters-active-count').textContent).toBe('2');

      fireEvent.click(screen.getByTestId('filters-clear'));
      expect(advancedProbe()).toEqual({
        setupIds: [],
        directions: [],
        symbols: [],
        tradeResults: [],
      });
      expect(screen.queryByTestId('filters-active-count')).toBeNull();
    });

    it('degrades the Setup dimension when the lookups fetch fails', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('/api/accounts')) return Promise.resolve(okResponse(ACCOUNTS));
        if (url.startsWith('/api/lookups')) return Promise.reject(new Error('Network error'));
        return Promise.resolve(okResponse(ANALYTICS_BODY));
      });

      renderBar();
      await flushAsync();
      await openFilters();

      expect(screen.getByText('Setups unavailable')).toBeDefined();
      // Other dimensions still render.
      expect(screen.getByRole('checkbox', { name: 'Long' })).toBeDefined();
      expect(screen.getByRole('checkbox', { name: 'AAPL' })).toBeDefined();
    });
  });
});
