/**
 * Tests for PerformanceFilterBar.
 *
 * Covers: control rendering, preset + custom date range updates propagated to
 * shared context, $/%/R unit toggle, account scope selection with a real
 * account picker, accounts-fetch failure degradation, and the mixed-currency
 * warning.
 *
 * The bar is built on TradingJournal primitives (radix-based Select/Button/
 * Input at --density-control-h-lg height), so select interactions follow the
 * repository pattern for radix Select: open the combobox trigger, then click
 * the option rendered in the portal.
 *
 * Run: npx vitest run src/components/performance/__tests__/performance-filter-bar.test.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PerformanceFilterBar } from '../performance-filter-bar';
import { PerformanceDashboardProvider, usePerformanceDashboard } from '@/hooks/use-performance-dashboard';

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
        preset: filter.dateRange.preset,
        from: filter.dateRange.from,
        to: filter.dateRange.to,
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

/** Open a radix Select by combobox name and click the given option label. */
async function chooseSelectOption(comboboxName: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  // Radix renders the option list in a portal after the open state settles;
  // flush microtasks under fake timers before querying the option.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
  const option = screen.getByRole('option', { name: optionName });
  fireEvent.click(option);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
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
        if (url.startsWith('/api/accounts')) {
          return Promise.resolve(okResponse(ACCOUNTS));
        }
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

  it('renders account scope, period, and unit controls', async () => {
    renderBar();
    expect(screen.getByText('Accounts:')).toBeDefined();
    expect(screen.getByText('Period:')).toBeDefined();
    expect(screen.getByText('Unit:')).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Account scope' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Date period' })).toBeDefined();
    // Default unit is currency ($ pressed).
    expect(screen.getByRole('button', { name: '$' }).getAttribute('aria-pressed')).toBe('true');
    await flushAsync();
  });

  it('applies a relative preset to the shared date range', async () => {
    renderBar();
    await flushAsync();
    await chooseSelectOption('Date period', '1 Month');
    expect(probe().preset).toBe('1M');
    // 1M preset computes a concrete from date (today minus one month).
    expect(probe().from).not.toBe('');
  });

  it('applies a custom date range via the Apply button', async () => {
    renderBar();
    await flushAsync();

    await chooseSelectOption('Date period', 'Custom');
    expect(screen.getByLabelText('Custom from date')).toBeDefined();
    expect(screen.getByLabelText('Custom to date')).toBeDefined();

    fireEvent.change(screen.getByLabelText('Custom from date'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Custom to date'), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByText('Apply'));

    expect(probe().preset).toBe('Custom');
    expect(probe().from).toBe('2026-01-01');
    expect(probe().to).toBe('2026-06-30');
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

  it('selects a single account and writes it into the shared scope', async () => {
    renderBar();
    await flushAsync();

    await chooseSelectOption('Account scope', 'Single Account');
    // Single mode auto-selects the first account.
    expect(probe().mode).toBe('single');
    expect(probe().accountIds).toEqual(['acc-usd']);

    // Switching to the EUR account updates the scope (option name includes
    // the broker suffix, e.g. "Cash EUR (IBKR)").
    await chooseSelectOption('Select account', /Cash EUR/);
    expect(probe().accountIds).toEqual(['acc-eur']);
  });

  it('toggles multiple accounts with checkboxes and shows the mixed-currency warning', async () => {
    renderBar();
    await flushAsync();

    await chooseSelectOption('Account scope', 'Multiple Accounts');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);

    fireEvent.click(checkboxes[1]); // add EUR account
    expect(probe().mode).toBe('multiple');
    expect(probe().accountIds).toContain('acc-eur');

    // USD + EUR → warning shown.
    expect(screen.getByTestId('mixed-currency-warning')).toBeDefined();

    // Unchecking back to a single currency hides the warning.
    fireEvent.click(checkboxes[1]);
    expect(screen.queryByTestId('mixed-currency-warning')).toBeNull();
  });

  it('degrades gracefully when the accounts fetch fails (all-accounts still usable)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string) => {
        if (url.startsWith('/api/accounts')) {
          return Promise.reject(new Error('Network error'));
        }
        if (url.startsWith('/api/lookups')) {
          return Promise.resolve(okResponse(SETUPS));
        }
        return Promise.resolve(okResponse(ANALYTICS_BODY));
      });

    renderBar();
    await flushAsync();

    // Accounts: controls still render.
    expect(screen.getByRole('combobox', { name: 'Account scope' })).toBeDefined();

    // Switching to single mode shows the degraded "unavailable" placeholder,
    // not a crash.
    await chooseSelectOption('Account scope', 'Single Account');
    expect(screen.getByTestId('account-single-select')).toBeDefined();
    expect(screen.getByText('Accounts unavailable')).toBeDefined();

    // Switching to multiple shows the inline error message.
    await chooseSelectOption('Account scope', 'Multiple Accounts');
    expect(screen.getByText('Network error')).toBeDefined();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Filters popover (advanced dimensions)
  // ═════════════════════════════════════════════════════════════════════════

  describe('Filters popover (advanced dimensions)', () => {
    /** Open the Filters popover by clicking its trigger button. */
    async function openFilters() {
      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
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
