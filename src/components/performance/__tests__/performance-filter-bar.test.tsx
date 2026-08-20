/**
 * Tests for PerformanceFilterBar.
 *
 * Covers: control rendering, preset + custom date range updates propagated to
 * shared context, $/%/R unit toggle, account scope selection with a real
 * account picker, accounts-fetch failure degradation, and the mixed-currency
 * warning.
 *
 * Run: npx vitest run src/components/performance/__tests__/performance-filter-bar.test.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PerformanceFilterBar } from '../performance-filter-bar';
import { PerformanceDashboardProvider, usePerformanceDashboard } from '@/hooks/use-performance-dashboard';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures & helpers
// ═══════════════════════════════════════════════════════════════════════════

const ACCOUNTS = [
  { id: 'acc-usd', name: 'Cash USD', broker: 'IBKR', currency: 'USD', isActive: true },
  { id: 'acc-eur', name: 'Cash EUR', broker: 'IBKR', currency: 'EUR', isActive: true },
];

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
        if (url.startsWith('/api/accounts')) {
          return Promise.resolve(okResponse(ACCOUNTS));
        }
        return Promise.resolve(
          okResponse({
            kpiMetrics: {},
            charts: {},
            metadata: { accountCount: 1, mixedCurrencies: false, tradeCount: 0, dateRange: { from: null, to: null } },
          }),
        );
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

  it('renders account scope, period, and unit controls', async () => {
    renderBar();
    expect(screen.getByText('Accounts:')).toBeDefined();
    expect(screen.getByText('Period:')).toBeDefined();
    expect(screen.getByText('Unit:')).toBeDefined();
    expect(screen.getByLabelText('Account scope')).toBeDefined();
    expect(screen.getByLabelText('Date period')).toBeDefined();
    // Default unit is currency ($ pressed).
    expect(screen.getByRole('button', { name: '$' }).getAttribute('aria-pressed')).toBe('true');
    await flushAsync();
  });

  it('applies a relative preset to the shared date range', async () => {
    renderBar();
    await flushAsync();
    fireEvent.change(screen.getByLabelText('Date period'), { target: { value: '1M' } });
    expect(probe().preset).toBe('1M');
    // 1M preset computes a concrete from date (today minus one month).
    expect(probe().from).not.toBe('');
  });

  it('applies a custom date range via the Apply button', async () => {
    renderBar();
    await flushAsync();

    fireEvent.change(screen.getByLabelText('Date period'), { target: { value: 'Custom' } });
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

    fireEvent.change(screen.getByLabelText('Account scope'), { target: { value: 'single' } });
    // Single mode auto-selects the first account.
    expect(probe().mode).toBe('single');
    expect(probe().accountIds).toEqual(['acc-usd']);

    // Switching to the EUR account updates the scope.
    fireEvent.change(screen.getByTestId('account-single-select'), { target: { value: 'acc-eur' } });
    expect(probe().accountIds).toEqual(['acc-eur']);
  });

  it('toggles multiple accounts with checkboxes and shows the mixed-currency warning', async () => {
    renderBar();
    await flushAsync();

    fireEvent.change(screen.getByLabelText('Account scope'), { target: { value: 'multiple' } });
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
        return Promise.resolve(
          okResponse({
            kpiMetrics: {},
            charts: {},
            metadata: { accountCount: 1, mixedCurrencies: false, tradeCount: 0, dateRange: { from: null, to: null } },
          }),
        );
      });

    renderBar();
    await flushAsync();

    // Accounts: controls still render.
    expect(screen.getByLabelText('Account scope')).toBeDefined();

    // Switching to single mode shows the degraded "unavailable" option, not a crash.
    fireEvent.change(screen.getByLabelText('Account scope'), { target: { value: 'single' } });
    expect(screen.getByTestId('account-single-select')).toBeDefined();

    // Switching to multiple shows the inline error message.
    fireEvent.change(screen.getByLabelText('Account scope'), { target: { value: 'multiple' } });
    expect(screen.getByText('Network error')).toBeDefined();
  });
});
